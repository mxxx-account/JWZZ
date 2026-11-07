import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  const alternateApi = process.env.TEST_API_URL;
  if (alternateApi) await page.route("http://localhost:8080/api/**", route =>
    route.continue({ url: route.request().url().replace("http://localhost:8080", alternateApi) }));
});

test("商家管理预置与自定义商品、库存流水并隔离另一商家", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await page.getByLabel("身份").selectOption("MERCHANT");
  await page.getByLabel("邮箱").fill(`merchant-catalog-${Date.now()}@example.invalid`);
  await page.getByLabel("姓名").fill("商品测试商家");
  await page.getByLabel("密码").fill("MerchantCatalogPass123!");
  await page.getByRole("button", { name: "注册并登录" }).click();
  await expect(page).toHaveURL(/\/merchant$/);
  await expect(page.getByText("尚未创建")).toBeVisible();
  await page.getByLabel("店铺名称").fill("演示健康用品店");
  await page.getByLabel("所在城市").fill("武汉市");
  await page.getByLabel("店铺地址").fill("演示路 8 号");
  await page.getByRole("button", { name: "创建店铺" }).click();
  await expect(page.locator(".merchant-product-item")).toHaveCount(3);
  await expect(page.locator(".merchant-product-item").first()).toContainText("可售库存：0");
  await expect(page.locator(".merchant-product-item").first()).toContainText("未上架");

  await page.getByLabel("商品模板").selectOption({ label: "防护口罩 · 日常用品" });
  await page.locator(".merchant-product-form").first().getByLabel("演示售价（元）").fill("9.90");
  await page.getByRole("button", { name: "加入店铺" }).click();
  await expect(page.locator(".merchant-product-item")).toHaveCount(4);
  await expect(page.locator(".merchant-product-item").filter({ hasText: "防护口罩" })).toContainText("¥9.90");

  await page.getByLabel("商品名称").fill("自定义演示护具");
  await page.locator(".merchant-product-form").last().getByLabel("品类").selectOption("日常用品");
  await page.locator(".merchant-product-form").last().getByLabel("演示售价（元）").fill("12.50");
  await page.getByRole("button", { name: "添加用品" }).click();
  await expect(page.locator(".merchant-product-item")).toHaveCount(5);
  const card = page.locator(".merchant-product-item").filter({ hasText: "自定义演示护具" });
  const skuId = await card.getAttribute("data-sku-id");
  expect(skuId).toBeTruthy();
  await card.getByRole("button", { name: "调整库存" }).click();
  await card.getByLabel("目标库存").fill("5");
  await card.getByLabel("调整说明").fill("演示入库 5 件");
  await card.getByRole("button", { name: "保存库存" }).click();
  await expect(card).toContainText("可售库存：5");
  await card.getByRole("button", { name: "库存流水" }).click();
  await expect(card.locator(".merchant-ledger")).toContainText("0 → 5（+5）");

  await card.getByRole("button", { name: "编辑资料" }).click();
  await card.locator(".merchant-inline-form").getByLabel("演示售价（元）").fill("15.75");
  await card.getByRole("button", { name: "保存商品" }).click();
  await expect(card).toContainText("¥15.75");
  await card.getByRole("button", { name: "上架", exact: true }).click();
  await expect(card).toContainText("已上架");
  await card.getByRole("button", { name: "下架" }).click();
  await expect(card).toContainText("未上架");
  await card.getByRole("button", { name: "移除" }).click();
  await expect(card).toContainText("已移除");
  await card.getByRole("button", { name: "恢复" }).click();
  await expect(card).toContainText("未上架");
  expect(await page.evaluate(async id => {
    const token = await fetch("http://localhost:8080/api/auth/csrf", { credentials: "include" }).then(response => response.json());
    return fetch(`http://localhost:8080/api/merchant/products/${id}/inventory`, {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json", "X-XSRF-TOKEN": token.token },
      body: JSON.stringify({ available: -1, note: "非法负库存" }),
    }).then(response => response.status);
  }, skuId)).toBe(400);
  await page.reload();
  await expect(page.locator(".merchant-product-item").filter({ hasText: "自定义演示护具" })).toContainText("可售库存：5");

  await page.getByRole("button", { name: "退出登录" }).click();
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await page.getByLabel("身份").selectOption("MERCHANT");
  await page.getByLabel("邮箱").fill(`merchant-catalog-other-${Date.now()}@example.invalid`);
  await page.getByLabel("姓名").fill("另一商家");
  await page.getByLabel("密码").fill("MerchantCatalogPass123!");
  await page.getByRole("button", { name: "注册并登录" }).click();
  await page.getByLabel("店铺名称").fill("第二家演示店");
  await page.getByLabel("所在城市").fill("上海市");
  await page.getByLabel("店铺地址").fill("演示路 9 号");
  await page.getByRole("button", { name: "创建店铺" }).click();
  await expect(page.locator(".merchant-product-item")).toHaveCount(3);
  expect(await page.evaluate(async id => {
    const token = await fetch("http://localhost:8080/api/auth/csrf", { credentials: "include" }).then(response => response.json());
    return fetch(`http://localhost:8080/api/merchant/products/${id}/inventory`, {
      method: "PUT", credentials: "include",
      headers: { "Content-Type": "application/json", "X-XSRF-TOKEN": token.token },
      body: JSON.stringify({ available: 99, note: "越权修改" }),
    }).then(response => response.status);
  }, skuId)).toBe(404);
  expect(await page.evaluate(id => fetch(`http://localhost:8080/api/merchant/products/${id}/inventory/ledger`, {
    credentials: "include",
  }).then(response => response.status), skuId)).toBe(404);
});
