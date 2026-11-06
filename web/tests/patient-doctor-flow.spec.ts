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
  await report.getByLabel("医生在线状态").selectOption("OFFLINE");
  await report.getByLabel("医生在线状态").selectOption("ALL");
  await report.locator(".doctor-option").filter({ hasText: "李华医生（演示）" }).click();
  await expect(report.locator(".doctor-option").filter({ hasText: "李华医生（演示）" })).toContainText("doctor.cardiology@jwzz.local");
  await report.getByRole("button", { name: "授权 李华医生（演示） 查看此报告" }).click();
  await expect(report.getByText("当前授权：李华医生（演示）")).toBeVisible();
  await report.getByLabel("通过医生账号（邮箱）授权").fill("doctor.cardiology@jwzz.local");
  await report.getByRole("button", { name: "授权此医生", exact: true }).click();
  await expect(report.getByText("当前授权：李华医生（演示）")).toBeVisible();
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
    await doctor.getByRole("button", { name: "接受咨询并开始回复" }).click();
    await doctor.getByLabel("输入消息").fill("请整理测量记录，再与线下医生核对。");
    await doctor.getByRole("button", { name: "发送", exact: true }).click();
    await expect(page.locator(".chat-bubble").filter({ hasText: "请整理测量记录，再与线下医生核对。" })).toBeVisible();

    await page.goto("/patient");
    await expect(report).toBeVisible();
    await report.getByRole("button", { name: "提交咨询并打开消息" }).click();
    await expect(page).toHaveURL(/\/patient\/messages\?conversation=\d+/);
    const secondId = new URL(page.url()).searchParams.get("conversation");
    expect(secondId).not.toBe(conversationId);
    const newConversation = doctor.locator(`.chat-conversation[data-conversation-id="${secondId}"]`);
    await expect(newConversation.locator(".chat-meta b")).toHaveText("1", { timeout: 20_000 });
    await newConversation.click();
    await expect(doctor.locator(".chat-peer-head")).toBeVisible();
    await expect(newConversation.locator(".chat-meta b")).toHaveCount(0);

    await page.goto("/patient");
    await expect(report).toBeVisible();
    await report.getByRole("button", { name: /撤销 doctor\.cardiology@jwzz\.local 的权限/ }).click();
    await expect(report.getByText("当前授权：无")).toBeVisible();
    await expect(doctor.locator(".chat-conversation").filter({ hasText: email })).toHaveCount(0, { timeout: 15_000 });
  } finally {
    if (doctorContext.browser()?.isConnected()) await doctorContext.close();
  }
});
