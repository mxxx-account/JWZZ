"""Loopback-only HTTP gateway; no database, report IDs, or outbound measurements."""

from __future__ import annotations

import hmac
import json
import math
import os
import sys
from contextlib import suppress
from dataclasses import dataclass
from http.client import HTTPException
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import BoundedSemaphore
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener


TOPICS = frozenset(("CURRENT_REVIEW", "MEASUREMENT_DETAILS", "COMPARE_RECORDS", "FOLLOW_UP"))
PRIORITY = {"MEASUREMENT": "MEASUREMENT_DETAILS", "COMPARISON": "COMPARE_RECORDS", "FOLLOW_UP": "FOLLOW_UP"}
OPENINGS = frozenset(("DIRECT", "POLITE"))
REQUEST_LIMIT = 1_024
RESPONSE_LIMIT = 32_768
MAX_CHOICES_BYTES = 1_024

SYSTEM_PROMPT = """You are selecting two safe editorial topics for a Chinese consultation question.
Return only one JSON object with opening and topics, e.g.
{"opening":"POLITE","topics":["CURRENT_REVIEW","FOLLOW_UP"]}.
Do not return prose, interpretation, treatment, diagnosis, numbers, or additional keys.
Opening is DIRECT or POLITE. Topics must be exactly two distinct identifiers:
CURRENT_REVIEW (ask what to clarify about this record), MEASUREMENT_DETAILS (ask what conditions to document),
COMPARE_RECORDS (ask what could make two records comparable), FOLLOW_UP (ask what to bring next time).
Never use COMPARE_RECORDS when hasComparableHistory is false.
Put the selected focus topic first: MEASUREMENT -> MEASUREMENT_DETAILS,
COMPARISON -> COMPARE_RECORDS, FOLLOW_UP -> FOLLOW_UP. BALANCED does not constrain first topic."""


class ContractError(ValueError):
    """Malformed JSON or data outside the fixed request/response vocabulary."""


class ProviderError(Exception):
    """Upstream failed or returned content that cannot be safely used."""


def _unique_keys(items: list[tuple[str, object]]) -> dict[str, object]:
    parsed: dict[str, object] = {}
    for key, value in items:
        if key in parsed:
            raise ContractError("duplicate key")
        parsed[key] = value
    return parsed


def _invalid_constant(_: str) -> object:
    raise ContractError("non-JSON constant")


def parse_json(raw: bytes | str) -> object:
    try:
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8")
        return json.loads(raw, object_pairs_hook=_unique_keys, parse_constant=_invalid_constant)
    except (ValueError, RecursionError):
        raise ContractError("invalid JSON") from None


@dataclass(frozen=True)
class DraftInput:
    context: str
    has_history: bool
    focus: str

    @classmethod
    def parse(cls, data: object) -> DraftInput:
        if not isinstance(data, dict) or data.keys() != {"context", "hasComparableHistory", "focus"}:
            raise ContractError("invalid input")
        context, history, focus = data["context"], data["hasComparableHistory"], data["focus"]
        if context not in ("HOME", "CLINIC") or type(history) is not bool:
            raise ContractError("invalid context or history")
        if not isinstance(focus, str) or (focus != "BALANCED" and focus not in PRIORITY):
            raise ContractError("invalid focus")
        if not history and focus == "COMPARISON":
            raise ContractError("comparison requires history")
        return cls(context, history, focus)

    def data(self) -> dict[str, object]:
        return {"context": self.context, "hasComparableHistory": self.has_history, "focus": self.focus}


def validate_choices(data: object, draft: DraftInput) -> dict[str, object]:
    if not isinstance(data, dict) or data.keys() != {"opening", "topics"}:
        raise ContractError("invalid choices")
    opening, topics = data["opening"], data["topics"]
    if not isinstance(opening, str) or opening not in OPENINGS:
        raise ContractError("invalid opening")
    if (not isinstance(topics, list) or len(topics) != 2
            or any(not isinstance(topic, str) or topic not in TOPICS for topic in topics)
            or topics[0] == topics[1]):
        raise ContractError("invalid topics")
    if (not draft.has_history and "COMPARE_RECORDS" in topics
            or draft.focus in PRIORITY and topics[0] != PRIORITY[draft.focus]):
        raise ContractError("choices outside the request scope")
    return {"opening": opening, "topics": topics}


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # The configured upstream is the only destination allowed to receive its credential.
        return None


def _visible_token(value: str, maximum: int) -> bool:
    return bool(value) and len(value) <= maximum and all(33 <= ord(char) <= 126 for char in value)


class ChatCompletionsProvider:
    def __init__(self, base_url: str, model: str, api_key: str, timeout: float, allow_local: bool = False):
        try:
            url = urlsplit(base_url)
            host = url.hostname
            port = url.port
        except ValueError:
            raise ValueError("invalid JWZZ_AI_BASE_URL") from None
        local_http = url.scheme == "http" and host in ("127.0.0.1", "::1") and allow_local
        if (not host or url.username is not None or url.password is not None or url.query or url.fragment
                or "\\" in base_url or any(char.isspace() or ord(char) < 32 for char in base_url) or port == 0
                or (url.scheme != "https" and not local_http)):
            raise ValueError("JWZZ_AI_BASE_URL must be an HTTPS base URL (or explicit local test HTTP)")
        if not _visible_token(api_key, 4_096):
            raise ValueError("set JWZZ_AI_API_KEY")
        if not _visible_token(model, 200):
            raise ValueError("set JWZZ_AI_MODEL")
        if not math.isfinite(timeout) or not 0 < timeout <= 30:
            raise ValueError("JWZZ_AI_TIMEOUT_SECONDS must be between 0 and 30")
        self.endpoint = base_url.rstrip("/") + "/chat/completions"
        self.model = model
        self.api_key = api_key
        self.timeout = timeout
        self.is_deepseek = host == "api.deepseek.com"
        # Do not proxy a local fake provider through any ambient proxy environment.
        self.opener = build_opener(ProxyHandler({}), _NoRedirect()) if local_http else build_opener(_NoRedirect())

    def choose(self, draft: DraftInput) -> dict[str, object]:
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": json.dumps(draft.data(), separators=(",", ":"))},
            ],
            "response_format": {"type": "json_object"},
            "stream": False,
            "max_tokens": 256,
        }
        if self.is_deepseek:
            payload["thinking"] = {"type": "disabled"}
        request = Request(
            self.endpoint, data=json.dumps(payload).encode("utf-8"), method="POST",
            headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
        )
        try:
            with self.opener.open(request, timeout=self.timeout) as response:
                raw = response.read(RESPONSE_LIMIT + 1)
            if len(raw) > RESPONSE_LIMIT:
                raise ProviderError()
            parsed = parse_json(raw)
            choices = parsed["choices"]
            if not isinstance(choices, list) or len(choices) != 1:
                raise ProviderError()
            choice = choices[0]
            if choice["finish_reason"] != "stop":
                raise ProviderError()
            content = choice["message"]["content"]
            if not isinstance(content, str) or not content.strip() or len(content.encode("utf-8")) > MAX_CHOICES_BYTES:
                raise ProviderError()
            return validate_choices(parse_json(content), draft)
        except HTTPError as error:
            error.close()
            raise ProviderError() from None
        except (URLError, OSError, HTTPException, ValueError, KeyError, TypeError, IndexError):
            raise ProviderError() from None


class GatewayServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, port: int, token: str, provider: ChatCompletionsProvider, workers: int = 4):
        if not _visible_token(token, 512):
            raise ValueError("set JWZZ_AGENT_SHARED_TOKEN")
        self.token = "Bearer " + token
        self.provider = provider
        self.provider_slots = BoundedSemaphore(workers)
        # Keep a few slots available to reject excess calls cleanly and serve health.
        self._slots = BoundedSemaphore(workers + 4)
        super().__init__(("127.0.0.1", port), GatewayHandler)

    def get_request(self):
        connection, address = super().get_request()
        connection.settimeout(3)
        return connection, address

    def process_request(self, request, client_address):
        if not self._slots.acquire(blocking=False):
            with suppress(OSError):
                request.settimeout(0.3)
                request.sendall(b"HTTP/1.0 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n")
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self._slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self._slots.release()

    def handle_error(self, request, client_address):
        print("Report draft gateway request failed.", file=sys.stderr, flush=True)


class GatewayHandler(BaseHTTPRequestHandler):
    server: GatewayServer
    server_version = "JWZZReportGateway"
    sys_version = ""

    def log_message(self, format, *args):
        # No request target, token, prompt, or upstream error body in logs.
        pass

    def _json(self, status: int, data: dict[str, object]):
        raw = json.dumps(data, separators=(",", ":")).encode("utf-8")
        with suppress(OSError):
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(raw)

    def do_GET(self):
        if self.path == "/health":
            self._json(200, {"status": "ok"})
        else:
            self._json(404, {"error": "not_found"})

    def do_POST(self):
        if self.path != "/v1/report-draft":
            self._json(404, {"error": "not_found"})
            return
        authorization = self.headers.get_all("Authorization") or []
        if (len(authorization) != 1 or not authorization[0].isascii()
                or not hmac.compare_digest(authorization[0], self.server.token)):
            self._json(401, {"error": "unauthorized"})
            return
        if self.headers.get_content_type() != "application/json":
            self._json(415, {"error": "expected_json"})
            return
        lengths = self.headers.get_all("Content-Length") or []
        if (self.headers.get("Transfer-Encoding") is not None or len(lengths) != 1
                or not lengths[0].isascii() or not lengths[0].isdecimal() or len(lengths[0]) > 10):
            self._json(400, {"error": "invalid_length"})
            return
        length = int(lengths[0])
        if length > REQUEST_LIMIT:
            self._json(413, {"error": "body_too_large"})
            return
        try:
            raw = self.rfile.read(length)
            if len(raw) != length:
                raise ContractError("incomplete body")
            draft = DraftInput.parse(parse_json(raw))
        except (ContractError, OSError):
            self._json(400, {"error": "invalid_input"})
            return
        if not self.server.provider_slots.acquire(blocking=False):
            self._json(503, {"error": "busy"})
            return
        try:
            try:
                result = self.server.provider.choose(draft)
            except ProviderError:
                self._json(502, {"error": "provider_unavailable"})
                return
        finally:
            self.server.provider_slots.release()
        self._json(200, result)


def main() -> int:
    try:
        try:
            port = int(os.environ.get("JWZZ_AI_PORT", "8091"))
        except ValueError:
            raise ValueError("JWZZ_AI_PORT must be an integer") from None
        if not 1 <= port <= 65_535:
            raise ValueError("JWZZ_AI_PORT must be between 1 and 65535")
        try:
            timeout = float(os.environ.get("JWZZ_AI_TIMEOUT_SECONDS", "5"))
        except ValueError:
            raise ValueError("JWZZ_AI_TIMEOUT_SECONDS must be numeric") from None
        provider = ChatCompletionsProvider(
            os.environ.get("JWZZ_AI_BASE_URL", "https://api.deepseek.com"),
            os.environ.get("JWZZ_AI_MODEL", ""),
            os.environ.get("JWZZ_AI_API_KEY", ""),
            timeout,
            os.environ.get("JWZZ_AI_ALLOW_LOCAL_PROVIDER", "").lower() == "true",
        )
        server = GatewayServer(port, os.environ.get("JWZZ_AGENT_SHARED_TOKEN", ""), provider)
    except ValueError as error:
        print(f"Configuration error: {error}", file=sys.stderr)
        return 2
    except OSError:
        print("Cannot bind the local report draft gateway port.", file=sys.stderr)
        return 2
    print(f"Report draft gateway listening on 127.0.0.1:{port}.", flush=True)
    with server:
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
    return 0
