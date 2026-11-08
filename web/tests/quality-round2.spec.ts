import { test as base, expect, type APIRequestContext, type Page } from "@playwright/test";
import type { ConversationDetail, MerchantProduct, MerchantStore, ShopConversationDetail, ShopOrderDetail } from "../src/lib/api";

const apiBase = "http://localhost:8080";
const password = "QualityRoundTwo123!";
async function call<T>(client: APIRequestContext, path: string, method = "GET", data?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (method !== "GET") headers["X-XSRF-TOKEN"] = (await (await client.get(`${apiBase}/api/auth/csrf`)).json()).token;
  const response = await client.fetch(`${apiBase}${path}`, { method, headers, data });
  expect(response.ok(), `${method} ${path}: ${response.status()} ${await response.text()}`).toBe(true);
  return response.status() === 204 ? undefined as T : await response.json() as T;
}
async function login(client: APIRequestContext, email: string) {
  const token = (await (await client.get(`${apiBase}/api/auth/csrf`)).json()).token;
  const response = await client.post(`${apiBase}/api/auth/login`, {
    headers: { "X-XSRF-TOKEN": token }, form: { email, password },
  });
  expect(response.ok()).toBe(true);
}
async function register(client: APIRequestContext, role: string, email: string) {
  await call(client, "/api/auth/register", "POST", { role, email, password, name: "二轮虚构测试", specialty: role === "DOCTOR" ? "GENERAL" : undefined });
  await login(client, email);
}
type Shop = { sku: number; store: MerchantStore; order: () => Promise<ShopOrderDetail>; conversation: (order: number) => Promise<ShopConversationDetail> };
type Clinic = { id: number; doctor: APIRequestContext };
const test = base.extend<{ shop: Shop; clinic: Clinic }>({
  clinic: async ({ page, browser }, use) => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const doctorContext = await browser.newContext();
    let reportId = 0, doctorId = 0;
    try {
      const doctorEmail = `q2-doctor-${suffix}@example.invalid`;
      await register(page.request, "USER", `q2-patient-${suffix}@example.invalid`);
      await register(doctorContext.request, "DOCTOR", doctorEmail);
      const entry = await call<{ entryId: string }>(page.request, "/api/indicators", "POST", {
        category: "BP", measuredAt: new Date(Date.now() - 60000).toISOString().slice(0, 19), context: "HOME", ageYears: 22, pregnant: false,
        values: { systolic_bp: { value: 125, unit: "mmHg" }, diastolic_bp: { value: 80, unit: "mmHg" } },
      });
      reportId = (await call<{ id: number }>(page.request, "/api/reports", "POST", { entryId: entry.entryId })).id;
      doctorId = (await call<{ doctorId: number }>(page.request, `/api/reports/${reportId}/grants`, "POST", { doctorEmail })).doctorId;
      const chat = await call<{ id: number }>(page.request, "/api/consultations", "POST", { reportId, doctorId, question: "二轮虚构咨询" });
      await call(doctorContext.request, `/api/doctor/consultations/${chat.id}/claim`, "POST", {});
      await use({ id: chat.id, doctor: doctorContext.request });
    } finally {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      if (reportId && doctorId) await call(page.request, `/api/reports/${reportId}/grants/${doctorId}`, "DELETE");
      await doctorContext.close();
    }
  },
  shop: async ({ page, browser }, use, testInfo) => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const merchantContext = await browser.newContext();
    const merchant = merchantContext.request;
    const user = page.request;
    const email = `q2-user-${suffix}@example.invalid`;
    const orderIds: number[] = [];
    let store: MerchantStore | undefined;
    try {
      await register(merchant, "MERCHANT", `q2-merchant-${suffix}@example.invalid`);
      await register(user, "USER", email);
      store = await call<MerchantStore>(merchant, "/api/merchant/store", "POST", { name: `二轮测试店-${suffix}`, city: "武汉", address: "虚构测试地址" });
      const product = (await call<MerchantProduct[]>(merchant, "/api/merchant/products"))[0];
      await call(merchant, `/api/merchant/products/${product.id}/inventory`, "PUT", { available: 20, note: "二轮测试" });
      await call(merchant, `/api/merchant/products/${product.id}/status`, "PUT", { status: "ON_SHELF" });
      await call(merchant, "/api/merchant/store/status", "PUT", { status: "OPEN" });
      await use({ sku: product.id, store,
        order: async () => {
          await call(user, "/api/shop/cart/items", "POST", { skuId: product.id, quantity: 1 });
          const result = await call<ShopOrderDetail>(user, "/api/shop/orders", "POST", { idempotencyKey: crypto.randomUUID() });
          orderIds.push(result.order.id); return result;
        },
        conversation: async id => call<ShopConversationDetail>(user, `/api/shop/orders/${id}/conversation`, "POST", { body: `真实持久化首消息：订单 ${id}` }),
      });
    } finally {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      if (store) {
        await login(user, email);
        // Include orders made by the UI even when their response was deliberately lost.
        const orders = await call<{ id: number }[]>(user, "/api/shop/orders");
        for (const order of orders) await call(user, `/api/shop/orders/${order.id}/cancel`, "POST");
        await call(merchant, "/api/merchant/store/status", "PUT", { status: "DRAFT" });
        const products = await call<MerchantProduct[]>(merchant, "/api/merchant/products");
        expect(products.every(product => product.reserved === 0)).toBe(true);
        expect((await call<MerchantStore>(merchant, "/api/merchant/store")).status).toBe("DRAFT");
        await testInfo.attach("cleanup", { body: JSON.stringify({ storeId: store.id, orderIds, cancelledOrders: orders.map(order => order.id), reserved: 0, storeStatus: "DRAFT" }), contentType: "application/json" });
      }
      await merchantContext.close();
    }
  },
});

async function openChat(page: Page, id: number) {
  await page.goto(`/patient/shop-messages?conversation=${id}`);
  await expect(page.locator(".chat-thread .chat-row").first()).toBeVisible();
}

test("真实36条消息与12个订单会话在四种窗口下独立滚动", async ({ page, shop }) => {
  test.setTimeout(120_000);
  let first = 0;
  for (let i = 0; i < 12; i++) {
    const order = await shop.order();
    const chat = await shop.conversation(order.order.id);
    if (!first) first = chat.conversation.id;
    await call(page.request, `/api/shop/orders/${order.order.id}/cancel`, "POST");
  }
  for (let i = 1; i <= 35; i++) await call(page.request, `/api/shop/conversations/${first}/messages`, "POST", { body: `真实长记录 ${i}：${"测试中文与长文本".repeat(18)}` });
  await openChat(page, first);
  await expect(page.locator(".chat-thread .chat-row")).toHaveCount(36);
  await expect(page.locator(".chat-conversation")).toHaveCount(12);
  for (const [width, height] of [[1536, 864], [1280, 720], [1024, 600], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await expect(page.getByRole("button", { name: "发送", exact: true })).toBeInViewport();
    const geometry = await page.evaluate(() => {
      const thread = document.querySelector<HTMLElement>(".chat-thread")!;
      const list = document.querySelector<HTMLElement>(".chat-conversation-list")!;
      thread.scrollTop = 0; list.scrollTop = 0;
      const top = [thread.scrollTop, list.scrollTop];
      thread.scrollTop = thread.scrollHeight; list.scrollTop = list.scrollHeight;
      return { top, bottom: [thread.scrollTop, list.scrollTop], composeBottom: document.querySelector(".chat-compose")!.getBoundingClientRect().bottom,
        pageScroll: window.scrollY, fits: document.documentElement.scrollWidth <= innerWidth + 1 };
    });
    expect(geometry.top).toEqual([0, 0]);
    expect(geometry.bottom[0]).toBeGreaterThan(0); expect(geometry.bottom[1]).toBeGreaterThan(0);
    expect(geometry.composeBottom).toBeLessThanOrEqual(height); expect(geometry.fits).toBe(true); expect(geometry.pageScroll).toBe(0);
  }
  await page.reload();
  await expect(page.locator(".chat-thread .chat-row")).toHaveCount(36);
});

test("发送请求未到服务端时保留草稿，恢复后只保存一次；慢请求禁用重复发送", async ({ page, shop }) => {
  const order = await shop.order(), chat = await shop.conversation(order.order.id);
  await openChat(page, chat.conversation.id);
  const path = `**/api/shop/conversations/${chat.conversation.id}/messages`;
  await page.route(path, route => route.abort("internetdisconnected"));
  await page.getByLabel("输入商家消息").fill("断网前的草稿");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator(".chat-toast")).toBeVisible();
  await expect(page.getByLabel("输入商家消息")).toHaveValue("断网前的草稿");
  expect((await call<ShopConversationDetail>(page.request, `/api/shop/conversations/${chat.conversation.id}`)).messages).toHaveLength(1);
  await page.unroute(path);
  let sent = 0;
  await page.route(path, async route => { sent++; await new Promise(resolve => setTimeout(resolve, 1200)); await route.continue(); });
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeDisabled();
  await expect(page.locator(".chat-thread")).toContainText("断网前的草稿");
  expect(sent).toBe(1);
  expect((await call<ShopConversationDetail>(page.request, `/api/shop/conversations/${chat.conversation.id}`)).messages).toHaveLength(2);
});

test("订单已提交但响应丢失，重试仍只生成一单和一次库存预留", async ({ page, shop }, testInfo) => {
  await call(page.request, "/api/shop/cart/items", "POST", { skuId: shop.sku, quantity: 1 });
  await page.goto("/patient/pharmacy");
  await page.getByRole("button", { name: "购物车（1）" }).click();
  let dropped = false;
  let committedId = 0;
  await page.route("**/api/shop/orders", async route => {
    if (route.request().method() === "POST" && !dropped) {
      dropped = true; const response = await route.fetch(); expect(response.ok()).toBe(true);
      committedId = (await response.json()).order.id;
      await testInfo.attach("server-committed-order", { body: JSON.stringify({ committedId, status: response.status() }), contentType: "application/json" });
      await route.abort("connectionreset");
    } else await route.continue();
  });
  await page.getByRole("button", { name: "提交演示订单" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect.poll(() => committedId, { message: "fault must happen AFTER an order was committed" }).toBeGreaterThan(0);
  const before = await call<ShopOrderDetail["order"][]>(page.request, "/api/shop/orders"); expect(before).toHaveLength(1);
  await page.getByRole("button", { name: "提交演示订单" }).click();
  await expect(page.locator(".shop-order-detail")).toContainText(`订单 #${before[0].id}`);
  expect((await call<ShopOrderDetail["order"][]>(page.request, "/api/shop/orders")).map(order => order.id)).toEqual([before[0].id]);
});

test("消息已保存但响应丢失后，人工重试不应产生重复消息", async ({ page, shop }) => {
  const order = await shop.order(), chat = await shop.conversation(order.order.id);
  await openChat(page, chat.conversation.id);
  let dropped = false;
  await page.route(`**/api/shop/conversations/${chat.conversation.id}/messages`, async route => {
    if (!dropped) { dropped = true; const response = await route.fetch(); expect(response.ok()).toBe(true); await route.abort("connectionreset"); }
    else await route.continue();
  });
  await page.getByLabel("输入商家消息").fill("响应丢失后的唯一消息");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator(".chat-toast")).toBeVisible();
  await expect(page.getByLabel("输入商家消息")).toHaveValue("响应丢失后的唯一消息");
  const saved = await call<ShopConversationDetail>(page.request, `/api/shop/conversations/${chat.conversation.id}`);
  expect(saved.messages.filter(message => message.body === "响应丢失后的唯一消息")).toHaveLength(1);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByLabel("输入商家消息")).toHaveValue("");
  const retried = await call<ShopConversationDetail>(page.request, `/api/shop/conversations/${chat.conversation.id}`);
  expect(retried.messages.filter(message => message.body === "响应丢失后的唯一消息")).toHaveLength(1);
});

test("会话失效时发送被拒绝，草稿保留且不伪装成功", async ({ page, shop }) => {
  const order = await shop.order(), chat = await shop.conversation(order.order.id);
  await openChat(page, chat.conversation.id);
  await call(page.request, "/api/auth/logout", "POST");
  await page.getByLabel("输入商家消息").fill("登录过期时的草稿");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator(".chat-toast")).toContainText("登录已过期");
  await expect(page.getByLabel("输入商家消息")).toHaveValue("登录过期时的草稿");
});

test("咨询消息41条真实记录在四种窗口下可滚动且发送区完整", async ({ page, clinic }) => {
  for (let i = 0; i < 35; i++) await call(clinic.doctor, `/api/messages/conversations/${clinic.id}`, "POST", { body: `虚构医生消息 ${i}：${"布局测试文本".repeat(20)}` });
  for (let i = 0; i < 5; i++) await call(page.request, `/api/messages/conversations/${clinic.id}`, "POST", { body: `虚构用户回复 ${i}` });
  await page.goto(`/patient/messages?conversation=${clinic.id}`);
  await expect(page.locator(".chat-thread .chat-row")).toHaveCount(41);
  for (const [width, height] of [[1536, 864], [1280, 720], [1024, 600], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await expect(page.getByRole("button", { name: "发送", exact: true })).toBeInViewport();
    await expect(page.locator(".chat-peer-head")).toBeInViewport();
    const result = await page.locator(".chat-thread").evaluate(element => {
      element.scrollTop = 0;
      const top = element.scrollTop; element.scrollTop = element.scrollHeight;
      return { top, bottom: element.scrollTop, fits: document.documentElement.scrollWidth <= innerWidth + 1,
        composeBottom: document.querySelector(".chat-compose")!.getBoundingClientRect().bottom };
    });
    expect(result.top).toBe(0); expect(result.bottom).toBeGreaterThan(0); expect(result.fits).toBe(true);
    expect(result.composeBottom).toBeLessThanOrEqual(height);
  }
  await page.reload(); await expect(page.locator(".chat-thread .chat-row")).toHaveCount(41);
});

test("咨询消息响应丢失后重试不应产生重复消息", async ({ page, clinic }) => {
  await page.goto(`/patient/messages?conversation=${clinic.id}`);
  await expect(page.locator(".chat-thread .chat-row")).toHaveCount(1);
  let dropped = false;
  await page.route(`**/api/messages/conversations/${clinic.id}`, async route => {
    if (route.request().method() === "POST" && !dropped) {
      dropped = true; const response = await route.fetch(); expect(response.ok()).toBe(true); await route.abort("connectionreset");
    } else await route.continue();
  });
  await page.getByLabel("输入消息", { exact: true }).fill("咨询响应丢失后的唯一消息");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator(".chat-toast")).toBeVisible();
  expect((await call<ConversationDetail>(page.request, `/api/messages/conversations/${clinic.id}`)).messages.filter(message => message.body === "咨询响应丢失后的唯一消息")).toHaveLength(1);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByLabel("输入消息", { exact: true })).toHaveValue("");
  expect((await call<ConversationDetail>(page.request, `/api/messages/conversations/${clinic.id}`)).messages.filter(message => message.body === "咨询响应丢失后的唯一消息")).toHaveLength(1);
});
