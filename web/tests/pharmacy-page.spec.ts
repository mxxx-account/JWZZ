import { test, expect, type Page } from "@playwright/test";

async function openPharmacy(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await page.getByLabel("邮箱").fill(`pharmacy-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.invalid`);
  await page.getByLabel("姓名").fill("药店测试用户");
  await page.getByLabel("密码").fill("PharmacyTest123!");
  await page.getByRole("button", { name: "注册并登录" }).click();
  await page.getByRole("link", { name: "药店" }).click();
  await expect(page).toHaveURL(/\/patient\/pharmacy$/);
}

test("药店页隐藏定位和附近药店，保留用品浏览与搜索", async ({ page }) => {
  let locationRequests = 0;
  await page.route(/\/api\/pharmacies\/(nearby|region)\?/, route => { locationRequests += 1; return route.abort(); });
  await openPharmacy(page);
  await expect(page.getByRole("heading", { name: "健康用品目录" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "常见健康用品" })).toBeVisible();
  await expect(page.locator(".pharmacy-product-card")).toHaveCount(6);
  await expect(page.locator(".pharmacy-location-bar")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "使用当前位置" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "附近药店" })).toHaveCount(0);
  await expect(page.locator(".pharmacy-store-card")).toHaveCount(0);

  await page.getByRole("button", { name: "营养补充", exact: true }).click();
  await expect(page.locator(".pharmacy-product-card")).toHaveCount(2);
  await page.getByLabel("搜索健康用品").fill("血压计");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(page.getByRole("heading", { name: "“血压计”的搜索结果" })).toBeVisible();
  await expect(page.locator(".pharmacy-product-card")).toHaveCount(1);
  await expect(page.locator(".pharmacy-product-card")).toContainText("电子血压计");
  await expect(page.getByText("仅展示健康用品示例品类", { exact: false })).toBeVisible();
  await expect(page.locator(".pharmacy-store-card")).toHaveCount(0);
  expect(locationRequests).toBe(0);
});

test("无匹配用品时显示空状态，返回目录后分类仍可用", async ({ page }) => {
  await openPharmacy(page);
  await page.getByLabel("搜索健康用品").fill("不存在的用品123");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(page.getByText("暂无匹配的示例用品，请尝试其他关键词。")).toBeVisible();
  await page.getByRole("button", { name: "← 返回用品目录" }).click();
  await page.getByRole("button", { name: "健康器械", exact: true }).click();
  await expect(page.locator(".pharmacy-product-card")).toHaveCount(3);
});

test("药店页窄屏不横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPharmacy(page);
  await expect(page.getByRole("heading", { name: "健康用品目录" })).toBeVisible();
  expect(await page.locator(".pharmacy-page").evaluate(element => element.getBoundingClientRect().right <= window.innerWidth + 1)).toBe(true);
});
