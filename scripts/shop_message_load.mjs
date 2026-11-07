// Bounded local-only shop message load test. Creates synthetic accounts/order; no production traffic.
import { performance } from "node:perf_hooks";

const base = (process.env.SHOP_LOAD_BASE_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");
const requests = Number(process.env.SHOP_LOAD_REQUESTS ?? 300);
const concurrency = Number(process.env.SHOP_LOAD_CONCURRENCY ?? 20);
const sends = Number(process.env.SHOP_LOAD_SENDS ?? 30);
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) throw new Error("Local HTTP only");
if (!Number.isInteger(requests) || requests < 10 || requests > 500
  || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 30
  || !Number.isInteger(sends) || sends < 1 || sends > 50) throw new Error("Load exceeds bounded limits");

class Client {
  cookies = new Map();
  csrf = "";
  remember(response) {
    for (const line of response.headers.getSetCookie()) {
      const pair = line.split(";", 1)[0];
      const split = pair.indexOf("=");
      if (split > 0) this.cookies.set(pair.slice(0, split), pair.slice(split + 1));
    }
  }
  cookieHeader() { return [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; "); }
  async raw(path, method = "GET", body) {
    const headers = { Cookie: this.cookieHeader() };
    if (method !== "GET") headers["X-XSRF-TOKEN"] = this.csrf;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${base}${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
    this.remember(response);
    return response;
  }
  async request(path, method = "GET", body) {
    const response = await this.raw(path, method, body);
    const content = await response.text();
    if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status} ${content.slice(0, 120)}`);
    return content ? JSON.parse(content) : null;
  }
  async init() { this.csrf = (await this.request("/api/auth/csrf")).token; }
  async registerAndLogin(email, name, role, password) {
    await this.request("/api/auth/register", "POST", { email, name, role, password });
    const response = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { Cookie: this.cookieHeader(), "X-XSRF-TOKEN": this.csrf,
        "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email, password }),
    });
    this.remember(response);
    if (!response.ok) throw new Error(`login ${role}: HTTP ${response.status}`);
    this.csrf = (await this.request("/api/auth/csrf")).token;
  }
}

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const password = "ShopMessageLoad123!";
const merchant = new Client();
const user = new Client();
await merchant.init(); await user.init();
await merchant.registerAndLogin(`shop-load-merchant-${suffix}@example.invalid`, "压测商家", "MERCHANT", password);
await user.registerAndLogin(`shop-load-user-${suffix}@example.invalid`, "压测用户", "USER", password);

let store, order, id;
const results = [];
try {
store = await merchant.request("/api/merchant/store", "POST", {
  name: `消息压测店-${suffix}`, city: "武汉", address: "演示地址", description: "仅供本机压测",
});
const product = (await merchant.request("/api/merchant/products")).find(item => item.name === "电子血压计");
if (!product) throw new Error("Starter product not found");
await merchant.request(`/api/merchant/products/${product.id}/inventory`, "PUT", { available: 1, note: "消息压测" });
await merchant.request(`/api/merchant/products/${product.id}/status`, "PUT", { status: "ON_SHELF" });
await merchant.request("/api/merchant/store/status", "PUT", { status: "OPEN" });
await user.request("/api/shop/cart/items", "POST", { skuId: product.id, quantity: 1 });
order = await user.request("/api/shop/orders", "POST", { idempotencyKey: `load-${suffix}` });
const conversation = await user.request(`/api/shop/orders/${order.order.id}/conversation`, "POST", {
  body: "您好，这是订单消息压测会话。",
});
id = conversation.conversation.id;

function percentile(sorted, p) { return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)]; }
async function bench(label, client, path, method, count, workers) {
  if (method === "GET") {
    for (let i = 0; i < 10; i++) await client.raw(path).then(response => response.arrayBuffer());
  }
  let next = 0;
  let bytes = 0;
  const latencies = [];
  const errors = {};
  const started = performance.now();
  await Promise.all(Array.from({ length: workers }, async () => {
    while (true) {
      const index = next++;
      if (index >= count) break;
      const began = performance.now();
      try {
        const response = await client.raw(path, method, method === "POST" ? { body: `并发演示消息 ${index}` } : undefined);
        bytes += (await response.arrayBuffer()).byteLength;
        if (!response.ok) errors[response.status] = (errors[response.status] ?? 0) + 1;
      } catch { errors.network = (errors.network ?? 0) + 1; }
      latencies.push(performance.now() - began);
    }
  }));
  const elapsedSeconds = (performance.now() - started) / 1000;
  latencies.sort((a, b) => a - b);
  return { label, method, path: path.replaceAll(String(id), "{conversationId}"), requests: count, concurrency: workers,
    elapsedSeconds: +elapsedSeconds.toFixed(3), throughputRps: +(count / elapsedSeconds).toFixed(1), bytes,
    p50Ms: +percentile(latencies, .5).toFixed(1), p95Ms: +percentile(latencies, .95).toFixed(1),
    p99Ms: +percentile(latencies, .99).toFixed(1), maxMs: +latencies.at(-1).toFixed(1), errors };
}

  results.push(await bench("user-conversation-list", user, "/api/shop/conversations", "GET", requests, concurrency));
  results.push(await bench("user-conversation-detail", user, `/api/shop/conversations/${id}`, "GET", requests, concurrency));
  results.push(await bench("merchant-conversation-list", merchant, "/api/merchant/conversations", "GET", requests, concurrency));
  results.push(await bench("user-message-send", user, `/api/shop/conversations/${id}/messages`, "POST", sends, Math.min(concurrency, 10)));
  const saved = await user.request(`/api/shop/conversations/${id}`);
  if (saved.messages.length !== sends + 1) throw new Error(`Expected ${sends + 1} persisted messages, got ${saved.messages.length}`);
  results.push(await bench(`user-conversation-detail-after-${sends}-sends`, user,
    `/api/shop/conversations/${id}`, "GET", requests, concurrency));
} finally {
  if (order) await user.request(`/api/shop/orders/${order.order.id}/cancel`, "POST").catch(() => {});
  if (store) await merchant.request("/api/merchant/store/status", "PUT", { status: "DRAFT" }).catch(() => {});
}

const output = { measuredAt: new Date().toISOString(), base, nodeVersion: process.version,
  platform: process.platform, syntheticStoreId: store.id, syntheticOrderId: order.order.id,
  syntheticConversationId: id, warmupPerReadRoute: 10, results };
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
