import { test, expect } from "@playwright/test";

test("药店首页定位、搜索和按距离展示药店", async ({ page, context }) => {
  const email = `pharmacy-e2e-${Date.now()}@example.invalid`;
  await page.route("**/api/pharmacies/nearby?*", async route => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      source: "OPENSTREETMAP", radiusMeters: 5000,
      pharmacies: [
        { id: "node/1", name: "近处药店", latitude: 30.593, longitude: 114.306, distanceMeters: 180, address: "测试路 1 号", openingHours: "", phone: "", osmUrl: "https://www.openstreetmap.org/node/1" },
        { id: "way/2", name: "远处药店", latitude: 30.6, longitude: 114.31, distanceMeters: 1350, address: "测试路 2 号", openingHours: "", phone: "123456", osmUrl: "https://www.openstreetmap.org/way/2" },
      ],
    }) });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("姓名").fill("药店测试用户");
  await page.getByLabel("密码").fill("PharmacyTest123!");
  await page.getByRole("button", { name: "注册并登录" }).click();
  await page.getByRole("link", { name: "药店" }).click();
  await expect(page).toHaveURL(/\/patient\/pharmacy$/);
  await expect(page.getByRole("link", { name: "药店" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("尚未选择位置")).toBeVisible();
  await page.getByLabel("示例位置").selectOption("武汉市中心（示例）");
  await expect(page.locator(".pharmacy-store-card")).toHaveCount(2);
  await expect(page.locator(".pharmacy-store-card").first()).toContainText("近处药店");
  await page.getByLabel("搜索药品或健康用品").fill("血压计");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(page.getByRole("heading", { name: "“血压计”的搜索结果" })).toBeVisible();
  await expect(page.getByText("无法核实“血压计”是否有货", { exact: false })).toBeVisible();
  await expect(page.locator(".pharmacy-results-layout .pharmacy-store-card")).toHaveCount(2);
  await expect(page.locator(".pharmacy-results-layout .pharmacy-store-card").first()).toContainText("180 m");
  await page.getByRole("button", { name: "← 返回药店首页" }).click();
  await expect(page.getByRole("heading", { name: "常见健康用品" })).toBeVisible();

  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 30.5928, longitude: 114.3055 });
  await page.getByRole("button", { name: "使用当前位置" }).click();
  await expect(page.getByText("⌖ 当前位置")).toBeVisible();
  await expect(page.locator(".pharmacy-store-card")).toHaveCount(2);
});

test("药店页窄屏不横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await page.getByLabel("邮箱").fill(`pharmacy-mobile-${Date.now()}@example.invalid`);
  await page.getByLabel("姓名").fill("窄屏用户");
  await page.getByLabel("密码").fill("PharmacyMobile123!");
  await page.getByRole("button", { name: "注册并登录" }).click();
  await page.getByRole("link", { name: "药店" }).click();
  await expect(page.getByRole("heading", { name: "健康用品与附近药店" })).toBeVisible();
  expect(await page.locator(".pharmacy-page").evaluate(element => element.getBoundingClientRect().right <= window.innerWidth + 1)).toBe(true);
});

test("地图服务失败时仅示例位置使用明确标注的虚构商家", async ({ page }) => {
  await page.route("**/api/pharmacies/nearby?*", route => route.fulfill({ status: 502, contentType: "application/json", body: "{}" }));
  await page.goto("/");
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await page.getByLabel("邮箱").fill(`pharmacy-fallback-${Date.now()}@example.invalid`);
  await page.getByLabel("姓名").fill("地图失败测试");
  await page.getByLabel("密码").fill("PharmacyFallback123!");
  await page.getByRole("button", { name: "注册并登录" }).click();
  await page.getByRole("link", { name: "药店" }).click();
  await page.waitForLoadState("networkidle");
  await page.getByLabel("示例位置").selectOption("上海市中心（示例）");
  await expect(page.getByText("虚构的演示药店", { exact: false })).toBeVisible();
  await expect(page.locator(".pharmacy-store-card")).toHaveCount(3);
  await expect(page.locator(".pharmacy-store-card").first()).toContainText("虚构演示");
  await expect(page.locator(".pharmacy-store-card a")).toHaveCount(0);
});
