import { test, expect } from "@playwright/test";

test("患者录入、生成报告、授权咨询，医生接单回复，撤销授权", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const doctorPassword = process.env.DEMO_DOCTOR_PASSWORD;
  test.skip(!doctorPassword, "先在运行测试的终端加载 server/.env.local.ps1");
  const email = `e2e-${Date.now()}@example.invalid`;
  const password = "E2eFlowTest123!";

  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "注册用户" }).click();
  await expect(page.getByRole("button", { name: "注册并登录" })).toBeVisible();
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "注册并登录" }).click();
  await expect(page).toHaveURL(/\/patient$/);

  await page.getByLabel("指标分类").selectOption("BP");
  await page.getByRole("button", { name: "保存指标并查看研发预览" }).click();
  await expect(page.locator(".indicator-panel .error-notice")).toContainText("请先修正下方标红的输入");
  await page.locator(".value-field").filter({ hasText: "收缩压" }).locator("input").fill("130");
  await page.locator(".value-field").filter({ hasText: "舒张压" }).locator("input").fill("80");
  await page.getByRole("button", { name: "保存指标并查看研发预览" }).click();
  await expect(page.getByText("指标已保存。", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "生成／查看这次的报告" }).first().click();
  await expect(page.locator(".report-section .report-list > article")).toHaveCount(1);

  const report = page.locator(".report-section .report-list > article").first();
  await report.locator(".doctor-option").filter({ hasText: "心血管演示医生" }).click();
  await report.getByRole("button", { name: "授权 心血管演示医生 查看此报告" }).click();
  await expect(report.getByText("当前授权：心血管演示医生")).toBeVisible();
  await report.getByRole("button", { name: "提交咨询并打开消息" }).click();
  await expect(page).toHaveURL(/\/patient\/messages\?conversation=\d+/);
  const conversationId = new URL(page.url()).searchParams.get("conversation");
  await expect(page.locator(".chat-bubble").first()).toHaveText("您好，请帮我看看我的指标报告！");

  const doctorContext = await browser.newContext();
  const doctor = await doctorContext.newPage();
  try {
    await doctor.goto("/");
    await doctor.getByLabel("邮箱").fill("doctor.cardiology@jwzz.local");
    await doctor.getByLabel("密码").fill(doctorPassword!);
    await doctor.getByRole("button", { name: "登录", exact: true }).last().click();
    await expect(doctor).toHaveURL(/\/doctor$/);
    await doctor.goto(`/doctor/messages?conversation=${conversationId}`);
    await expect(doctor.locator(".chat-bubble").first()).toHaveText("您好，请帮我看看我的指标报告！");
    await doctor.getByRole("button", { name: "接单并开始回复" }).click();
    await doctor.getByLabel("输入消息").fill("请整理测量记录，再与线下医生核对。");
    await doctor.getByRole("button", { name: "发送", exact: true }).click();
    await expect(page.locator(".chat-bubble").filter({ hasText: "请整理测量记录，再与线下医生核对。" })).toBeVisible();

    await page.goto("/patient");
    await expect(report).toBeVisible();
    await report.getByRole("button", { name: /撤销 doctor\.cardiology@jwzz\.local 的权限/ }).click();
    await expect(report.getByText("当前授权：无")).toBeVisible();
    await expect(doctor.locator(".chat-conversation").filter({ hasText: email })).toHaveCount(0, { timeout: 15_000 });
  } finally {
    if (doctorContext.browser()?.isConnected()) await doctorContext.close();
  }
});
