// Bounded, read-only load after seeding a synthetic user. Never point at a production service.
import { mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

const base = (process.env.LOAD_BASE_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");
const reportCount = Number(process.env.LOAD_REPORTS ?? 60);
const requests = Number(process.env.LOAD_REQUESTS ?? 400);
const concurrency = Number(process.env.LOAD_CONCURRENCY ?? 20);
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) throw new Error("Load test is restricted to localhost");
if (reportCount < 1 || reportCount > 200 || requests < 1 || requests > 2000 || concurrency < 1 || concurrency > 50)
  throw new Error("Load size exceeds the bounded test limits");

const cookies = new Map();
function remember(response) {
  for (const line of response.headers.getSetCookie()) {
    const pair = line.split(";", 1)[0];
    const split = pair.indexOf("=");
    if (split > 0) cookies.set(pair.slice(0, split), pair.slice(split + 1));
  }
}
function cookieHeader() { return [...cookies].map(([key, value]) => `${key}=${value}`).join("; "); }
let csrf = "";
async function request(path, method = "GET", body) {
  const headers = { Cookie: cookieHeader() };
  if (method !== "GET") headers["X-XSRF-TOKEN"] = csrf;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  remember(response);
  const content = await response.text();
  if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status} ${content.slice(0, 180)}`);
  return content ? JSON.parse(content) : null;
}

const tokenResponse = await request("/api/auth/csrf");
csrf = tokenResponse.token;
const email = `load-${Date.now()}@example.invalid`;
const password = "BoundedLoadTest123!";
await request("/api/auth/register", "POST", { email, password, name: "压测用户", role: "USER" });
const login = await fetch(`${base}/api/auth/login`, {
  method: "POST", headers: { Cookie: cookieHeader(), "X-XSRF-TOKEN": csrf, "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ email, password }),
});
remember(login);
if (!login.ok) throw new Error(`login: HTTP ${login.status}`);
csrf = (await request("/api/auth/csrf")).token;

for (let i = 0; i < reportCount; i++) {
  const entry = await request("/api/indicators", "POST", {
    category: "BP", measuredAt: new Date(Date.now() - (i + 2) * 60_000).toISOString().slice(0, 19),
    context: "HOME", ageYears: 22, pregnant: false,
    values: { systolic_bp: { value: 120 + i % 20, unit: "mmHg" }, diastolic_bp: { value: 75 + i % 10, unit: "mmHg" } },
  });
  await request("/api/reports", "POST", { entryId: entry.entryId });
}

function percentile(sorted, p) { return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)]; }
async function bench(label, path) {
  for (let i = 0; i < 15; i++) await fetch(`${base}${path}`, { headers: { Cookie: cookieHeader() } }).then(response => response.arrayBuffer());
  let next = 0;
  let bytes = 0;
  const latencies = [];
  const errors = {};
  const started = performance.now();
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (true) {
      const index = next++;
      if (index >= requests) break;
      const begin = performance.now();
      try {
        const response = await fetch(`${base}${path}`, { headers: { Cookie: cookieHeader() } });
        const body = await response.arrayBuffer();
        bytes += body.byteLength;
        if (!response.ok) errors[response.status] = (errors[response.status] ?? 0) + 1;
      } catch (error) { errors.network = (errors.network ?? 0) + 1; }
      latencies.push(performance.now() - begin);
    }
  }));
  const elapsedSeconds = (performance.now() - started) / 1000;
  latencies.sort((a, b) => a - b);
  return {
    label, path, requests, concurrency, elapsedSeconds: +elapsedSeconds.toFixed(3),
    throughputRps: +(requests / elapsedSeconds).toFixed(1), bytes,
    p50Ms: +percentile(latencies, 0.5).toFixed(1), p95Ms: +percentile(latencies, 0.95).toFixed(1),
    p99Ms: +percentile(latencies, 0.99).toFixed(1), maxMs: +latencies.at(-1).toFixed(1), errors,
  };
}

const results = [];
for (const [label, path] of [
  ["health", "/api/health"], ["catalog", "/api/public/indicators"],
  ["indicator-history", "/api/indicators"], ["report-list", "/api/reports"],
]) {
  const result = await bench(label, path);
  results.push(result);
  process.stdout.write(`${label}: ${result.throughputRps} req/s, p95 ${result.p95Ms} ms, errors ${JSON.stringify(result.errors)}\n`);
}
const output = {
  measuredAt: new Date().toISOString(), base, nodeVersion: process.version, platform: process.platform,
  syntheticReports: reportCount, requestsPerRoute: requests, concurrency, warmupPerRoute: 15, results,
};
mkdirSync("reports", { recursive: true });
const file = `reports/load-test-r${reportCount}-n${requests}-c${concurrency}.json`;
writeFileSync(file, JSON.stringify(output, null, 2));
process.stdout.write(`Raw results: ${file}\n`);
