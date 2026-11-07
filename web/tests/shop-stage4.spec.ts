import { test, expect, type Page } from "@playwright/test";

const password = "ShopStage4Pass123!";

async function register(page: Page, role: "MERCHANT" | "USER", email: string, name: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await page.getByLabel("身份").selectOption(role);
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("姓名").fill(name);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "注册并登录" }).click();
}

test("演示订单可取消释放库存、再次下单模拟支付并由商家接单", async ({ page }) => {
  test.setTimeout(120_000);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const merchantEmail = `order-merchant-${suffix}@example.invalid`;
  await register(page, "MERCHANT", merchantEmail, "订单演示商家");
  await expect(page).toHaveURL(/\/merchant$/);
  await page.getByLabel("店铺名称").fill(`订单演示店-${suffix}`);
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

  await register(page, "USER", `order-user-${suffix}@example.invalid`, "订单演示用户");
  await page.getByRole("link", { name: "药店" }).click();
  await expect(page.getByText(/共 \d+ 项有货商品/)).toBeVisible();
  await page.getByLabel("搜索商品或店铺").fill(suffix);
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(page.getByRole("heading", { name: `“${suffix}”的搜索结果` })).toBeVisible();
  const store = page.locator(".shop-store").filter({ hasText: `订单演示店-${suffix}` });
  await expect(store).toBeVisible();
  await store.getByRole("button", { name: "加入购物车" }).click();
  await page.getByRole("button", { name: "购物车（1）" }).click();
  await page.getByRole("button", { name: "提交演示订单" }).click();
  await expect(page.getByRole("heading", { name: "我的订单" })).toBeVisible();
  await expect(page.locator(".shop-order-detail")).toContainText("待模拟支付");
  await page.getByRole("button", { name: "取消订单" }).click();
  await expect(page.locator(".shop-order-detail")).toContainText("已取消");

  await page.getByRole("button", { name: "商品与店铺" }).click();
  await store.getByRole("button", { name: "加入购物车" }).click();
  await page.getByRole("button", { name: "购物车（1）" }).click();
  await page.getByRole("button", { name: "提交演示订单" }).click();
  await page.getByRole("button", { name: "模拟支付", exact: true }).click();
  await expect(page.locator(".shop-order-detail")).toContainText("已模拟支付，待商家接单");
  await page.getByRole("button", { name: "退出登录" }).click();

  await page.getByLabel("身份").selectOption("MERCHANT");
  await page.getByLabel("邮箱").fill(merchantEmail);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).last().click();
  await expect(page).toHaveURL(/\/merchant$/);
  const paid = page.locator(".merchant-order-list article").filter({ hasText: "待接单" });
  await expect(paid).toBeVisible();
  await paid.getByRole("button", { name: "查看明细" }).click();
  await expect(page.locator(".merchant-order-detail")).toContainText("电子血压计");
  await paid.getByRole("button", { name: "接受演示订单" }).click();
  await expect(page.locator(".merchant-order-list")).toContainText("已接单");
  await page.getByRole("button", { name: "暂停演示营业" }).click();
});
