import { test, expect, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  // Optional alternate backend for local tests while another project instance occupies :8080.
  const alternateApi = process.env.TEST_API_URL;
  if (alternateApi) await page.route("http://localhost:8080/api/**", route =>
    route.continue({ url: route.request().url().replace("http://localhost:8080", alternateApi) }));
});

async function register(page: Page, role: "商家" | "用户", suffix: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await page.getByLabel("身份").selectOption({ label: role });
  await page.getByLabel("邮箱").fill(`merchant-stage1-${suffix}-${Date.now()}@example.invalid`);
  await page.getByLabel("姓名").fill(role === "商家" ? "演示商家" : "演示用户");
  await page.getByLabel("密码").fill("MerchantStage1Pass123!");
  await page.getByRole("button", { name: "注册并登录" }).click();
}

test("商家创建与编辑店铺；不同商家相互隔离，用户不能访问商家接口", async ({ page }) => {
  await register(page, "商家", "owner");
  await expect(page).toHaveURL(/\/merchant$/);
  await expect(page.getByText("尚未创建")).toBeVisible();
  await page.getByLabel("店铺名称").fill("健康用品演示店甲");
  await page.getByLabel("所在城市").fill("武汉市");
  await page.getByLabel("店铺地址").fill("演示路 1 号");
  await page.getByLabel("店铺简介").fill("仅供项目演示");
  await page.getByRole("button", { name: "创建店铺" }).click();
  await expect(page.getByText("店铺已创建，可继续完善资料。")).toBeVisible();
  await expect(page.getByText("草稿店铺")).toBeVisible();
  await page.getByLabel("店铺名称").fill("健康用品演示店甲（更新）");
  await page.getByRole("button", { name: "保存店铺资料" }).click();
  await expect(page.getByText("店铺资料已保存。")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("店铺名称")).toHaveValue("健康用品演示店甲（更新）");
  expect(await page.evaluate(async () => {
    const token = await fetch("http://localhost:8080/api/auth/csrf", { credentials: "include" }).then(response => response.json());
    return fetch("http://localhost:8080/api/merchant/store", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json", "X-XSRF-TOKEN": token.token },
      body: JSON.stringify({ name: "重复店铺", city: "武汉市", address: "演示路 2 号", description: "" }),
    }).then(response => response.status);
  })).toBe(409);
  expect(await page.evaluate(() => fetch("http://localhost:8080/api/doctor/reports", { credentials: "include" }).then(response => response.status))).toBe(403);
  expect(await page.evaluate(() => fetch("http://localhost:8080/api/messages/conversations", { credentials: "include" }).then(response => response.status))).toBe(403);
  expect(await page.evaluate(() => fetch("http://localhost:8080/api/reports/1", { credentials: "include" }).then(response => response.status))).toBe(403);
  await page.goto("/patient");
  await expect(page).toHaveURL(/\/merchant$/);

  await page.getByRole("button", { name: "退出登录" }).click();
  await register(page, "商家", "other");
  await expect(page).toHaveURL(/\/merchant$/);
  await expect(page.getByText("尚未创建")).toBeVisible();
  await expect(page.getByLabel("店铺名称")).toHaveValue("");

  await page.getByRole("button", { name: "退出登录" }).click();
  await register(page, "用户", "patient");
  await expect(page).toHaveURL(/\/patient$/);
  expect(await page.evaluate(() => fetch("http://localhost:8080/api/merchant/store", { credentials: "include" }).then(response => response.status))).toBe(403);
});
