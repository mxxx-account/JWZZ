import { test, expect } from "@playwright/test";

test("患者录入、生成报告、授权咨询，医生接单回复，撤销授权", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const doctorPassword = process.env.DEMO_DOCTOR_PASSWORD;
  test.skip(!doctorPassword, "先在运行测试的终端加载 server/.env.local.ps1");
  const email = `e2e-${Date.now()}@example.invalid`;
  const password = "E2eFlowTest123!";

  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await expect(page.getByRole("button", { name: "注册并登录" })).toBeVisible();
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("姓名").fill("浏览器测试用户");
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "注册并登录" }).click();
  await expect(page).toHaveURL(/\/patient$/);
  await expect(page.getByRole("link", { name: "首页" })).toHaveAttribute("aria-current", "page");
  await page.getByRole("link", { name: "见微知著" }).click();
  await expect(page).toHaveURL(/\/patient$/);

  await page.getByLabel("指标分类").selectOption("BP");
  await page.getByRole("button", { name: "保存指标并查看研发预览" }).click();
  await expect(page.locator(".indicator-panel .error-notice")).toContainText("请先修正下方标红的输入");
  await page.locator(".value-field").filter({ hasText: "收缩压" }).locator("input").fill("130");
  await page.locator(".value-field").filter({ hasText: "舒张压" }).locator("input").fill("80");
  await page.getByRole("button", { name: "保存指标并查看研发预览" }).click();
  await expect(page.getByText("指标已保存。", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: /最近录入/ }).click();
  await page.getByRole("button", { name: "生成／查看这次的报告" }).first().click();
  await expect(page.locator(".archive-row")).toHaveCount(1);

  const report = page.locator(".archive-detail");
  const reportId = (await report.locator(".report-heading small").textContent())?.match(/#(\d+)/)?.[1];
  expect(reportId).toBeTruthy();
  await expect(report.locator(".doctor-option").first()).toBeVisible();
  const doctorViewport = await report.locator(".doctor-options").evaluate(element => ({
    height: element.clientHeight,
    fullHeight: element.scrollHeight,
    overflow: getComputedStyle(element).overflowY,
    columns: getComputedStyle(element).gridTemplateColumns.split(" ").length,
    count: element.childElementCount,
  }));
  expect(doctorViewport.height).toBeLessThanOrEqual(312);
  expect(doctorViewport.overflow).toBe("scroll");
  if (doctorViewport.count > doctorViewport.columns * 2) {
    expect(doctorViewport.fullHeight).toBeGreaterThan(doctorViewport.height);
    await report.locator(".doctor-option").last().scrollIntoViewIfNeeded();
    await report.locator(".doctor-option").last().click();
    await expect(report.locator(".doctor-option").last()).toHaveAttribute("aria-pressed", "true");
  }
  await page.getByLabel("指标类别").selectOption("GLUCOSE");
  await page.getByRole("button", { name: "查找报告" }).click();
  await expect(page.locator(".archive-row")).toHaveCount(0);
  await page.getByRole("button", { name: "清空筛选" }).click();
  await expect(page.locator(".archive-row")).toHaveCount(1);
  await page.getByLabel("报告编号").fill(reportId!);
  await page.getByLabel("排序").selectOption("OLDEST");
  await page.getByRole("button", { name: "查找报告" }).click();
  await expect(page.locator(".archive-row")).toContainText(`#${reportId}`);
  await expect(report.getByLabel("医生在线状态")).toBeVisible();
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
  await expect(page.getByRole("link", { name: "查看商家订单消息" })).toBeInViewport();
  await expect(page.locator(".chat-peer-head")).toBeInViewport();
  await expect(page.locator(".chat-safety")).toBeInViewport();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  const doctorContext = await browser.newContext();
  const doctor = await doctorContext.newPage();
  try {
    await doctor.goto("/");
    await doctor.getByLabel("身份").selectOption("DOCTOR");
    await doctor.getByLabel("邮箱").fill("doctor.cardiology@jwzz.local");
    await doctor.getByLabel("密码").fill(doctorPassword!);
    await doctor.getByRole("button", { name: "登录", exact: true }).last().click();
    await expect(doctor).toHaveURL(/\/doctor$/);
    const pending = doctor.locator(`.report-list > article[data-report-id="${reportId}"]`);
    await expect(pending).toBeVisible();
    await expect(pending.locator(".doctor-request")).toContainText("您好，请帮我看看我的指标报告！");
    await doctor.getByRole("link", { name: "见微知著" }).click();
    await expect(doctor).toHaveURL(/\/doctor$/);
    await pending.getByRole("button", { name: "接受咨询并进入消息" }).click();
    await expect(doctor).toHaveURL(new RegExp(`/doctor/messages\\?conversation=${conversationId}$`));
    await expect(doctor.locator(".chat-bubble").first()).toHaveText("您好，请帮我看看我的指标报告！");
    await doctor.getByLabel("输入消息").fill("请整理测量记录，再与线下医生核对。");
    await doctor.getByRole("button", { name: "发送", exact: true }).click();
    await expect(page.locator(".chat-bubble").filter({ hasText: "请整理测量记录，再与线下医生核对。" })).toBeVisible();

    await page.goto("/patient?view=reports");
    await expect(report.getByRole("button", { name: "提交咨询并打开消息" })).toBeVisible();
    await report.getByRole("button", { name: "提交咨询并打开消息" }).click();
    await expect(page).toHaveURL(/\/patient\/messages\?conversation=\d+/);
    const secondId = new URL(page.url()).searchParams.get("conversation");
    expect(secondId).not.toBe(conversationId);
    const newConversation = doctor.locator(`.chat-conversation[data-conversation-id="${secondId}"]`);
    await expect(newConversation).toHaveCount(0);
    await doctor.getByRole("link", { name: "首页" }).click();
    const secondPending = doctor.locator(`.report-list > article[data-consultation-id="${secondId}"]`);
    await expect(secondPending).toBeVisible({ timeout: 20_000 });
    await secondPending.getByRole("button", { name: "接受咨询并进入消息" }).click();
    await expect(doctor).toHaveURL(new RegExp(`/doctor/messages\\?conversation=${secondId}$`));
    await doctor.locator(`.chat-conversation[data-conversation-id="${conversationId}"]`).click();
    await page.getByLabel("输入消息").fill("我补充了新的测量记录。");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(newConversation.locator(".chat-meta b")).toHaveText("1", { timeout: 20_000 });
    await newConversation.click();
    await expect(doctor.locator(".chat-peer-head")).toBeVisible();
    await expect(newConversation.locator(".chat-meta b")).toHaveCount(0);

    await page.goto("/patient?view=reports");
    await expect(report.getByRole("button", { name: /撤销 doctor\.cardiology@jwzz\.local 的权限/ })).toBeVisible();
    await report.getByRole("button", { name: /撤销 doctor\.cardiology@jwzz\.local 的权限/ }).click();
    await expect(report.getByText("当前授权：无")).toBeVisible();
    await expect(doctor.locator(".chat-conversation").filter({ hasText: email })).toHaveCount(0, { timeout: 15_000 });
  } finally {
    if (doctorContext.browser()?.isConnected()) await doctorContext.close();
  }
});

test("医生填写姓名和科室注册，单次登录后进入医生首页", async ({ page }) => {
  const email = `e2e-doctor-${Date.now()}@example.invalid`;
  const password = "DoctorFlowTest123!";
  await page.goto("/");
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await page.getByLabel("身份").selectOption("DOCTOR");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("姓名").fill("测试医生");
  await page.getByLabel("科室").selectOption("GENERAL");
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "注册并登录" }).click();
  await expect(page).toHaveURL(/\/doctor$/);
  await expect(page.getByText(`测试医生 · ${email}`)).toBeVisible();
  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.route("**/api/doctor/presence", route => route.fulfill({ status: 503, body: "temporary failure" }));
  await page.getByLabel("身份").selectOption("DOCTOR");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).last().click();
  await expect(page).toHaveURL(/\/doctor$/);
});

test("用户工作区可在窄屏切换四项功能并查找历史报告", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "注册", exact: true }).click();
  await page.getByLabel("邮箱").fill(`workspace-${Date.now()}@example.invalid`);
  await page.getByLabel("姓名").fill("工作区测试用户");
  await page.getByLabel("密码").fill("WorkspaceTest123!");
  await page.getByRole("button", { name: "注册并登录" }).click();
  await expect(page.locator(".indicator-panel")).toBeVisible();
  await expect(page.getByText(/已登录：工作区测试用户/)).toBeVisible();
  for (const [label, expected] of [
    ["最近录入", ".history-section"],
    ["同类指标趋势", ".patient-main > .history-section"],
    ["我的报告与授权", ".archive-workspace"],
  ]) {
    await page.getByRole("button", { name: new RegExp(label) }).click();
    await expect(page.locator(expected)).toBeVisible();
  }
  await page.getByLabel("排序").selectOption("OLDEST");
  await page.getByRole("button", { name: "查找报告" }).click();
  await expect(page.getByText("找到 0 份报告")).toBeVisible();
  expect(await page.locator(".patient-layout").evaluate(element => element.getBoundingClientRect().right <= window.innerWidth + 1)).toBe(true);
});

test("医生首页已打开时，新待咨询报告自动出现", async ({ page, browser }) => {
  const doctorPassword = process.env.DEMO_DOCTOR_PASSWORD;
  test.skip(!doctorPassword, "先加载本地医生演示密码");
  const doctorContext = await browser.newContext();
  const doctor = await doctorContext.newPage();
  try {
    await doctor.goto("/");
    await doctor.getByLabel("身份").selectOption("DOCTOR");
    await doctor.getByLabel("邮箱").fill("doctor.cardiology@jwzz.local");
    await doctor.getByLabel("密码").fill(doctorPassword!);
    await doctor.getByRole("button", { name: "登录", exact: true }).last().click();
    await expect(doctor).toHaveURL(/\/doctor$/);

    await page.goto("/");
    await page.getByRole("button", { name: "注册", exact: true }).click();
    await page.getByLabel("邮箱").fill(`grant-live-${Date.now()}@example.invalid`);
    await page.getByLabel("姓名").fill("授权测试用户");
    await page.getByLabel("密码").fill("GrantLiveTest123!");
    await page.getByRole("button", { name: "注册并登录" }).click();
    await expect(page).toHaveURL(/\/patient$/);
    await page.getByLabel("指标分类").selectOption("BP");
    await page.locator(".value-field").filter({ hasText: "收缩压" }).locator("input").fill("130");
    await page.locator(".value-field").filter({ hasText: "舒张压" }).locator("input").fill("80");
    await page.getByRole("button", { name: "保存指标并查看研发预览" }).click();
    await page.getByRole("button", { name: /最近录入/ }).click();
    await page.getByRole("button", { name: "生成／查看这次的报告" }).first().click();
    const report = page.locator(".archive-detail");
    await expect(report).toBeVisible();
    const reportId = (await report.locator(".report-heading small").textContent())?.match(/#(\d+)/)?.[1];
    expect(reportId).toBeTruthy();
    await expect(doctor.locator(`.report-list > article[data-report-id="${reportId}"]`)).toHaveCount(0);
    await report.getByLabel("通过医生账号（邮箱）授权").fill("doctor.cardiology@jwzz.local");
    await report.getByRole("button", { name: "授权此医生", exact: true }).click();
    await expect(report.getByText("当前授权：李华医生（演示）")).toBeVisible();
    await expect(doctor.locator(`.report-list > article[data-report-id="${reportId}"]`)).toHaveCount(0);
    await report.getByRole("button", { name: "提交咨询并打开消息" }).click();
    await expect(page).toHaveURL(/\/patient\/messages\?conversation=\d+/);
    await expect(doctor.locator(`.report-list > article[data-report-id="${reportId}"]`)).toBeVisible({ timeout: 20_000 });
  } finally {
    await doctorContext.close();
  }
});
