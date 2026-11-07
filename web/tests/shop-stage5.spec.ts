import { test, expect, type Page } from "@playwright/test";

const password = "ShopStage5Pass123!";

async function register(page: Page, role: "MERCHANT" | "USER" | "DOCTOR", email: string, name: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await page.getByLabel("身份").selectOption(role);
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("姓名").fill(name);
  await page.getByLabel("密码").fill(password);
  if (role === "DOCTOR") await page.getByLabel("科室").selectOption("GENERAL");
  await page.getByRole("button", { name: "注册并登录" }).click();
}

async function login(page: Page, role: "MERCHANT" | "USER", email: string) {
  await page.getByLabel("身份").selectOption(role);
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).last().click();
  await expect(page).toHaveURL(role === "MERCHANT" ? /\/merchant$/ : /\/patient$/);
}

async function createStore(page: Page, name: string) {
  await expect(page).toHaveURL(/\/merchant$/);
  await page.getByLabel("店铺名称").fill(name);
  await page.getByLabel("所在城市").fill("武汉市");
  await page.getByLabel("店铺地址").fill("演示路 1 号");
  await page.getByRole("button", { name: "创建店铺" }).click();
  const product = page.locator(".merchant-product-item").filter({ hasText: "电子血压计" });
  await product.getByRole("button", { name: "调整库存" }).click();
  await product.getByLabel("目标库存").fill("2");
  await product.getByRole("button", { name: "保存库存" }).click();
  await expect(product).toContainText("可售库存：2");
  await product.getByRole("button", { name: "上架", exact: true }).click();
  await expect(product).toContainText("已上架");
  await page.getByRole("button", { name: "开始演示营业" }).click();
  await expect(page.getByText("演示营业中", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "退出登录" }).click();
}

async function startOrderChat(page: Page, storeName: string) {
  await page.getByRole("link", { name: "药店" }).click();
  await expect(page.getByText(/共 \d+ 项有货商品/)).toBeVisible();
  await page.getByLabel("搜索商品或店铺").fill(storeName);
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  const store = page.locator(".shop-store").filter({ hasText: storeName });
  await expect(store).toBeVisible();
  await store.getByRole("button", { name: "加入购物车" }).click();
  await page.getByRole("button", { name: "购物车（1）" }).click();
  await page.getByRole("button", { name: "提交演示订单" }).click();
  await expect(page.locator(".shop-order-detail")).toContainText("待模拟支付");
  await page.getByRole("button", { name: "联系商家" }).click();
  await expect(page).toHaveURL(/\/patient\/shop-messages\?conversation=\d+$/);
  await expect(page.getByRole("heading", { name: storeName })).toBeVisible();
  await expect(page.locator(".chat-thread")).toContainText("您好，我想咨询订单");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 720 });
  return Number(new URL(page.url()).searchParams.get("conversation"));
}

test("不同用户与商家订单消息隔离，医生咨询不出现在商家端", async ({ page }) => {
  test.setTimeout(150_000);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const merchantA = `shop-chat-ma-${suffix}@example.invalid`;
  const merchantB = `shop-chat-mb-${suffix}@example.invalid`;
  const userA = `shop-chat-ua-${suffix}@example.invalid`;
  const userB = `shop-chat-ub-${suffix}@example.invalid`;
  const storeA = `消息演示店甲-${suffix}`;
  const storeB = `消息演示店乙-${suffix}`;
  await register(page, "MERCHANT", merchantA, "消息商家甲");
  await createStore(page, storeA);
  await register(page, "MERCHANT", merchantB, "消息商家乙");
  await createStore(page, storeB);

  await register(page, "USER", userA, "消息用户甲");
  const conversationA = await startOrderChat(page, storeA);
  await page.getByLabel("输入商家消息").fill("甲用户的订单问题");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator(".chat-thread")).toContainText("甲用户的订单问题");
  await page.getByRole("button", { name: "退出登录" }).click();

  await register(page, "USER", userB, "消息用户乙");
  const conversationB = await startOrderChat(page, storeB);
  expect(conversationB).not.toBe(conversationA);
  expect((await page.request.get(`http://localhost:8080/api/shop/conversations/${conversationA}`)).status()).toBe(404);
  await page.getByRole("button", { name: "退出登录" }).click();

  await login(page, "MERCHANT", merchantB);
  await page.getByRole("link", { name: "消息" }).click();
  await expect(page.locator(".chat-conversation-list")).toContainText("消息用户乙");
  await expect(page.locator(".chat-conversation-list")).not.toContainText("消息用户甲");
  expect((await page.request.get(`http://localhost:8080/api/merchant/conversations/${conversationA}`)).status()).toBe(404);
  expect((await page.request.get("http://localhost:8080/api/messages/conversations")).status()).toBe(403);
  expect((await page.request.get("http://localhost:8080/api/doctor/reports")).status()).toBe(403);
  await expect(page.locator(".chat-main")).not.toContainText("报告 #");
  await page.getByRole("button", { name: "退出登录" }).click();

  await login(page, "MERCHANT", merchantA);
  const beforeRead = await (await page.request.get("http://localhost:8080/api/merchant/conversations")).json();
  expect(beforeRead.find((item: { id: number }) => item.id === conversationA).unreadCount).toBe(2);
  await page.getByRole("link", { name: "消息" }).click();
  await expect(page.locator(".chat-conversation-list")).toContainText("消息用户甲");
  await expect(page.locator(".chat-conversation-list")).not.toContainText("消息用户乙");
  await expect.poll(async () => {
    const list = await (await page.request.get("http://localhost:8080/api/merchant/conversations")).json();
    return list.find((item: { id: number }) => item.id === conversationA).unreadCount;
  }).toBe(0);
  await page.getByLabel("输入商家消息").fill("商家甲已经看到订单问题");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator(".chat-thread")).toContainText("商家甲已经看到订单问题");
  await page.getByRole("button", { name: "退出登录" }).click();

  await login(page, "USER", userA);
  const userUnread = await (await page.request.get("http://localhost:8080/api/shop/conversations")).json();
  expect(userUnread.find((item: { id: number }) => item.id === conversationA).unreadCount).toBe(1);
  await page.getByRole("link", { name: "商家消息" }).click();
  await expect(page.locator(".chat-thread")).toContainText("商家甲已经看到订单问题");
  await expect.poll(async () => {
    const list = await (await page.request.get("http://localhost:8080/api/shop/conversations")).json();
    return list.find((item: { id: number }) => item.id === conversationA).unreadCount;
  }).toBe(0);
  expect((await page.request.get(`http://localhost:8080/api/shop/conversations/${conversationB}`)).status()).toBe(404);
  await page.getByRole("button", { name: "退出登录" }).click();

  await register(page, "DOCTOR", `shop-chat-doctor-${suffix}@example.invalid`, "消息测试医生");
  await expect(page).toHaveURL(/\/doctor$/);
  expect((await page.request.get("http://localhost:8080/api/merchant/conversations")).status()).toBe(403);
  expect((await page.request.get("http://localhost:8080/api/shop/conversations")).status()).toBe(403);

  await page.getByRole("button", { name: "退出登录" }).click();
  for (const email of [merchantA, merchantB]) {
    await login(page, "MERCHANT", email);
    await page.getByRole("button", { name: "暂停演示营业" }).click();
    await expect(page.getByText("草稿店铺", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "退出登录" }).click();
  }
});
