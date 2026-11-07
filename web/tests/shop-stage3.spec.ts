import { test, expect, type Page } from "@playwright/test";

const password = "ShopStage3Pass123!";

async function register(page: Page, role: "MERCHANT" | "USER", name: string, email: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await page.getByLabel("身份").selectOption(role);
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("姓名").fill(name);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "注册并登录" }).click();
}

async function makeStore(page: Page, name: string, stock: string, price?: string) {
  await expect(page).toHaveURL(/\/merchant$/);
  await page.getByLabel("店铺名称").fill(name);
  await page.getByLabel("所在城市").fill("武汉市");
  await page.getByLabel("店铺地址").fill("演示路 1 号");
  await page.getByRole("button", { name: "创建店铺" }).click();
  const card = page.locator(".merchant-product-item").filter({ hasText: "电子血压计" });
  await expect(card).toBeVisible();
  await page.getByRole("button", { name: "开始演示营业" }).click();
  await expect(page.getByText("请先将至少一项有库存的商品上架，再开始演示营业。")).toBeVisible();
  if (price) {
    await card.getByRole("button", { name: "编辑资料" }).click();
    await card.locator(".merchant-inline-form").getByLabel("演示售价（元）").fill(price);
    await card.getByRole("button", { name: "保存商品" }).click();
    await expect(card).toContainText(`¥${price}`);
  }
  await card.getByRole("button", { name: "调整库存" }).click();
  await card.getByLabel("目标库存").fill(stock);
  await card.getByRole("button", { name: "保存库存" }).click();
  await expect(card).toContainText(`可售库存：${stock}`);
  await card.getByRole("button", { name: "上架", exact: true }).click();
  await page.getByRole("button", { name: "开始演示营业" }).click();
  await expect(page.getByText("演示营业中", { exact: true })).toBeVisible();
}

test("只搜索有货演示店铺商品，购物车单店持久化且不锁库存", async ({ page }) => {
  test.setTimeout(120_000);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const firstEmail = `shop-a-${suffix}@example.invalid`;
  const secondEmail = `shop-b-${suffix}@example.invalid`;
  await register(page, "MERCHANT", "甲商家", firstEmail);
  await makeStore(page, `甲演示店-${suffix}`, "2");
  await page.getByRole("button", { name: "退出登录" }).click();

  await register(page, "MERCHANT", "乙商家", secondEmail);
  await makeStore(page, `乙演示店-${suffix}`, "5", "80.00");
  await page.getByRole("button", { name: "退出登录" }).click();

  await register(page, "USER", "购物测试用户", `shop-user-${suffix}@example.invalid`);
  await page.getByRole("link", { name: "药店" }).click();
  await page.getByLabel("搜索商品或店铺").fill("电子血压计");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(page.locator(".shop-store").first()).toContainText("电子血压计");
  await page.getByLabel("搜索商品或店铺").fill(suffix);
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await page.getByLabel("商品排序").selectOption("PRICE_ASC");
  const stores = page.locator(".shop-store");
  await expect(stores).toHaveCount(2);
  await expect(stores.first()).toContainText(`乙演示店-${suffix}`);
  const first = stores.filter({ hasText: `甲演示店-${suffix}` });
  const second = stores.filter({ hasText: `乙演示店-${suffix}` });
  await first.getByRole("button", { name: "查看详情" }).click();
  await expect(page.locator(".shop-detail")).toContainText("电子血压计");
  await page.locator(".shop-detail").getByRole("button", { name: "关闭详情" }).click();
  await first.getByRole("button", { name: "加入购物车" }).click();
  await expect(page.getByRole("button", { name: "购物车（1）" })).toBeVisible();
  await second.getByRole("button", { name: "加入购物车" }).click();
  await expect(page.getByText("购物车中已有另一家店铺", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "购物车（1）" }).click();
  await expect(page.locator(".shop-cart-item")).toHaveCount(1);
  await page.getByRole("button", { name: "增加电子血压计数量" }).click();
  await expect(page.locator(".shop-cart-item")).toContainText("¥200.00");
  await page.getByRole("button", { name: "增加电子血压计数量" }).click();
  await expect(page.getByText("库存已变化，无法设置该数量。")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "购物车（2）" }).click();
  await expect(page.locator(".shop-cart-item")).toContainText("¥200.00");
  await page.locator(".shop-cart-item").getByRole("button", { name: "移除" }).click();
  await expect(page.getByText("购物车还是空的。先去浏览有货的演示用品吧。")).toBeVisible();
  await page.getByRole("button", { name: "商品与店铺" }).click();
  await second.getByRole("button", { name: "加入购物车" }).click();
  await expect(page.getByRole("button", { name: "购物车（1）" })).toBeVisible();

  // Return test stores to draft so repeated E2E runs do not grow the user's visible catalog.
  await page.getByRole("button", { name: "退出登录" }).click();
  for (const email of [firstEmail, secondEmail]) {
    await page.getByLabel("身份").selectOption("MERCHANT");
    await page.getByLabel("邮箱").fill(email);
    await page.getByLabel("密码").fill(password);
    await page.getByRole("button", { name: "登录", exact: true }).last().click();
    await expect(page).toHaveURL(/\/merchant$/);
    await page.getByRole("button", { name: "暂停演示营业" }).click();
    await expect(page.getByText("草稿店铺", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "退出登录" }).click();
  }
});
