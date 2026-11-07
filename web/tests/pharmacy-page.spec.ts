import { test, expect, type Page } from "@playwright/test";

async function openShop(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await page.getByLabel("邮箱").fill(`shop-view-${Date.now()}-${Math.random().toString(36).slice(2)}@example.invalid`);
  await page.getByLabel("姓名").fill("商品页测试用户");
  await page.getByLabel("密码").fill("ShopViewTest123!");
  await page.getByRole("button", { name: "注册并登录" }).click();
  await page.getByRole("link", { name: "药店" }).click();
  await expect(page).toHaveURL(/\/patient\/pharmacy$/);
  await expect(page.getByRole("heading", { name: "健康用品与演示店铺" })).toBeVisible();
  await expect(page.getByLabel("搜索商品或店铺")).toBeEnabled();
  await expect(page.getByRole("heading", { name: "常见健康用品" })).toBeVisible();
  await expect(page.locator(".pharmacy-product-card")).toHaveCount(6);
}

test("默认用品首页、商品与店铺及搜索结果各自独立，且不触发定位", async ({ page }) => {
  let locationCalls = 0;
  await page.route(/\/api\/pharmacies\/(nearby|region)\?/, route => { locationCalls++; return route.abort(); });
  await openShop(page);
  const tabs = page.locator(".shop-toolbar button");
  await expect(tabs.first()).toHaveText("常见健康用品");
  await expect(tabs.nth(1)).toHaveText("商品与店铺");
  await expect(page.getByRole("button", { name: "使用当前位置" })).toHaveCount(0);
  await expect(page.locator(".pharmacy-location-bar")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "附近药店" })).toHaveCount(0);
  await page.getByRole("button", { name: "日常用品", exact: true }).click();
  await expect(page.locator(".pharmacy-product-card")).toHaveCount(1);
  await page.getByRole("button", { name: "医用口罩", exact: false }).click();
  await expect(page.getByRole("heading", { name: "“医用口罩”的搜索结果" })).toBeVisible();
  await page.getByRole("button", { name: "商品与店铺" }).click();
  await expect(page.getByRole("heading", { name: "为您推荐的店铺" })).toBeVisible();
  await expect(page.getByLabel("搜索商品或店铺")).toHaveValue("");
  await page.getByRole("button", { name: "常见健康用品" }).click();
  await expect(page.getByRole("heading", { name: "常见健康用品" })).toBeVisible();
  await page.getByLabel("搜索商品或店铺").fill("不存在的演示商品123");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(page.getByRole("heading", { name: "“不存在的演示商品123”的搜索结果" })).toBeVisible();
  await expect(page.getByText("暂无符合条件的有货商品", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "购物车（0）" }).click();
  await expect(page.getByText("购物车还是空的。先去商品与店铺看看吧。")).toBeVisible();
  expect(locationCalls).toBe(0);
});

test("演示商城窄屏不横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openShop(page);
  expect(await page.locator(".pharmacy-page").evaluate(element => element.getBoundingClientRect().right <= window.innerWidth + 1)).toBe(true);
});
