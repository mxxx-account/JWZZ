"""Local-only Java -> Python -> fake model smoke test, without installing packages."""

import http.cookiejar
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from contextlib import ExitStack
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


ROOT = Path(__file__).resolve().parents[1]
LOOPBACK = "127.0.0.1"
PASSWORD = "SyntheticStage3Review123!"
FAKE_PROVIDER_KEY = "jwzz-smoke-local-only"


class FakeProvider(ThreadingHTTPServer):
    def __init__(self):
        super().__init__((LOOPBACK, 0), FakeHandler)
        self.requests = []
        self.reply = "valid"


class FakeHandler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_POST(self):
        if self.path != "/v1/chat/completions" or self.headers.get("Authorization") != f"Bearer {FAKE_PROVIDER_KEY}":
            self.send_error(403)
            return
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        self.server.requests.append(body)
        if self.server.reply == "limited":
            self.send_error(429)
            return
        selection = (
            {"opening": "DIRECT", "topics": ["COMPARE_RECORDS", "FOLLOW_UP"]}
            if self.server.reply == "valid"
            else {"opening": "DIRECT", "topics": ["COMPARE_RECORDS", "FOLLOW_UP"], "draft": "untrusted prose"}
        )
        content = json.dumps({"choices": [{"message": {"content": json.dumps(selection)}, "finish_reason": "stop"}]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)


def free_port():
    with socket.socket() as listener:
        listener.bind((LOOPBACK, 0))
        return listener.getsockname()[1]


def stop_process(process):
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(8)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


def start_process(stack, args, env):
    process = subprocess.Popen(args, cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    stack.callback(stop_process, process)
    return process


def wait_ready(url, process, service):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"{service} exited before startup (code {process.returncode}); start it manually to inspect startup errors.")
        try:
            with opener.open(url, timeout=1) as response:
                if response.status == 200:
                    return
        except (OSError, urllib.error.URLError):
            time.sleep(0.4)
    raise RuntimeError(f"{service} health endpoint did not become ready.")


class Client:
    def __init__(self, base):
        self.base = base
        self.opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
        )

    def request(self, path, body=None, *, form=False, expected=200):
        headers, data = {}, None
        if body is not None:
            headers["X-XSRF-TOKEN"] = self.request("/api/auth/csrf")["token"]
            headers["Content-Type"] = "application/x-www-form-urlencoded" if form else "application/json"
            data = (urllib.parse.urlencode(body) if form else json.dumps(body)).encode()
        request = urllib.request.Request(self.base + path, data=data, headers=headers)
        try:
            response = self.opener.open(request, timeout=15)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            if response.status != expected:
                raise AssertionError(f"{path} returned {response.status}; expected {expected}")
            result = response.read()
            return json.loads(result) if result and expected < 400 else None


def reading(client, date, systolic, diastolic):
    return client.request("/api/indicators", {
        "category": "BP", "measuredAt": date, "context": "HOME", "ageYears": 22, "pregnant": False,
        "values": {"systolic_bp": {"value": systolic, "unit": "mmHg"}, "diastolic_bp": {"value": diastolic, "unit": "mmHg"}},
    }, expected=201)["entryId"]


def check_model_flow(client, fake):
    email = f"agent-stage3-smoke-{uuid.uuid4().hex}@example.invalid"
    client.request("/api/auth/register", {"email": email, "name": "第三阶段虚构用户", "password": PASSWORD, "role": "USER"}, expected=201)
    client.request("/api/auth/login", {"email": email, "password": PASSWORD}, form=True)
    reading(client, "2026-01-02T09:00:00", 122.25, 78)
    entry_id = reading(client, "2026-01-05T09:00:00", 129.5001, 76)
    report_id = client.request("/api/reports", {"entryId": entry_id})["id"]
    endpoint = f"/api/reports/{report_id}/assistant"
    request = {"action": "PREPARE_CONSULTATION", "focus": "COMPARISON"}

    opted_out = client.request(endpoint, request)
    assert (opted_out["mode"], opted_out["modelStatus"]) == ("TEMPLATE", "NOT_REQUESTED")
    assert not fake.requests
    print("PASS opt-out does not call Python/provider")

    request["useModel"] = True
    model = client.request(endpoint, request)
    assert (model["mode"], model["modelStatus"]) == ("MODEL", "USED")
    assert len(model["questions"]) == 2 and model["draft"]
    assert len(fake.requests) == 1
    provider_body = fake.requests[0]
    assert provider_body["response_format"] == {"type": "json_object"}
    assert json.loads(provider_body["messages"][-1]["content"]) == {
        "context": "HOME", "hasComparableHistory": True, "focus": "COMPARISON",
    }
    serialized = json.dumps(provider_body, ensure_ascii=False)
    for private_value in (email, PASSWORD, "第三阶段虚构用户", entry_id, "122.25", "129.5001", "2026-01-05"):
        assert private_value not in serialized, "Raw fixture information reached the provider"
    print("PASS real Java/Python HTTP chain renders validated model choices; raw fixture stays local")

    for response in ("invalid", "limited"):
        fake.reply = response
        fallback = client.request(endpoint, request)
        assert (fallback["mode"], fallback["modelStatus"]) == ("TEMPLATE", "UNAVAILABLE")
        assert fallback["draft"] and "untrusted prose" not in fallback["draft"]
    assert len(fake.requests) == 3, "Provider errors should not be retried"
    assert client.request("/api/consultations") == []
    assert client.request(f"/api/reports/{report_id}/grants") == []
    print("PASS invalid model output and 429 fall back without retry, grant or consultation")


def main():
    db_url = os.environ.get("DB_URL", "")
    if not db_url.startswith("jdbc:mysql://") or urllib.parse.urlsplit(db_url[5:]).hostname not in (LOOPBACK, "localhost", "::1"):
        raise SystemExit("Load server/.env.local.ps1 with a local MySQL DB_URL before running.")
    jar = ROOT / "server" / "target" / "server-0.1.0-SNAPSHOT.jar"
    if not jar.is_file():
        raise SystemExit("Package the stage-three backend before running.")

    shared_token = secrets.token_urlsafe(36)
    with ExitStack() as stack:
        fake = stack.enter_context(FakeProvider())
        threading.Thread(target=fake.serve_forever, daemon=True).start()
        stack.callback(fake.shutdown)
        ai_port, java_port = free_port(), free_port()
        while java_port == ai_port:
            java_port = free_port()
        worker_url = f"http://{LOOPBACK}:{ai_port}"
        worker_env = {key: value for key, value in os.environ.items()
                      if not key.startswith(("DB_", "DEMO_DOCTOR_", "SPRING_DATASOURCE_")) and key != "MYSQL_PWD"}
        worker = start_process(stack, [sys.executable, "-m", "ai_service"], {
            **worker_env, "JWZZ_AI_PORT": str(ai_port), "JWZZ_AGENT_SHARED_TOKEN": shared_token,
            "JWZZ_AI_API_KEY": FAKE_PROVIDER_KEY, "JWZZ_AI_BASE_URL": f"http://{LOOPBACK}:{fake.server_port}/v1",
            "JWZZ_AI_MODEL": "local-smoke-model", "JWZZ_AI_ALLOW_LOCAL_PROVIDER": "true", "JWZZ_AI_TIMEOUT_SECONDS": "3",
        })
        wait_ready(worker_url + "/health", worker, "Python gateway")
        # Java gets the internal token only, even if this shell contains a real provider key.
        java_env = {key: value for key, value in os.environ.items() if not key.startswith("JWZZ_AI_")}
        java_env.update(JWZZ_AGENT_MODEL_ENABLED="true", JWZZ_AGENT_URL=worker_url + "/v1/report-draft",
                        JWZZ_AGENT_SHARED_TOKEN=shared_token, JWZZ_REDIS_ENABLED="false",
                        DEMO_DOCTOR_EMAIL="", DEMO_DOCTOR_PASSWORD="")
        backend = start_process(stack, ["java", "-jar", str(jar), "--spring.profiles.active=dev",
            f"--server.address={LOOPBACK}", f"--server.port={java_port}"], java_env)
        base = f"http://{LOOPBACK}:{java_port}"
        wait_ready(base + "/api/health", backend, "Java backend")
        check_model_flow(Client(base), fake)
    print("Agent stage-three local integration passed; no external API contacted.")


if __name__ == "__main__":
    main()
