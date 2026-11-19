import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const apiBase = process.env.TEST_API_URL ?? "http://localhost:8080";
const password = "SyntheticAssistantTest123!";
const assistantName = "报告解读与咨询准备";

async function csrf(client: APIRequestContext): Promise<string> {
  const response = await client.get(`${apiBase}/api/auth/csrf`);
  expect(response.ok()).toBe(true);
  return (await response.json()).token;
}

async function api<T = void>(client: APIRequestContext, path: string, method = "GET", data?: unknown): Promise<T> {
  const headers = method === "GET" ? undefined : { "X-XSRF-TOKEN": await csrf(client) };
  const response = await client.fetch(`${apiBase}${path}`, { method, headers, data });
  expect(response.ok(), `${method} ${path}: HTTP ${response.status()}`).toBe(true);
  return response.status() === 204 ? undefined as T : await response.json() as T;
}

async function loginSynthetic(client: APIRequestContext, role: "USER" | "DOCTOR") {
  const email = `e2e-assistant-${role.toLowerCase()}-${randomUUID()}@example.invalid`;
  const name = role === "USER" ? "助手验收用户" : "助手验收医生";
  await api(client, "/api/auth/register", "POST", { email, name, password, role, specialty: role === "DOCTOR" ? "GENERAL" : undefined });
  const login = await client.post(`${apiBase}/api/auth/login`, {
    headers: { "X-XSRF-TOKEN": await csrf(client) },
    form: { email, password },
  });
  expect(login.ok()).toBe(true);
  return email;
}

async function reading(client: APIRequestContext, measuredAt: string, context: "HOME" | "CLINIC", systolic: number, diastolic: number) {
  const result = await api<{ entryId: string }>(client, "/api/indicators", "POST", {
    category: "BP", measuredAt, context, ageYears: 22, pregnant: false,
    values: { systolic_bp: { value: systolic, unit: "mmHg" }, diastolic_bp: { value: diastolic, unit: "mmHg" } },
  });
  return result.entryId;
}

async function generateReport(client: APIRequestContext, entryId: string) {
  return (await api<{ id: number }>(client, "/api/reports", "POST", { entryId })).id;
}

async function selectReport(page: Page, id: number) {
  const row = page.locator(".archive-row").filter({ hasText: new RegExp(`#${id}(?!\\d)`) });
  await row.click();
  await expect(row).toHaveAttribute("aria-current", "true");
  await expect(page.locator(".archive-detail .report-heading small")).toHaveText(new RegExp(`^#${id}\\s`));
}

function assistant(page: Page) { return page.getByRole("region", { name: assistantName }); }
function generateButton(page: Page) { return assistant(page).getByRole("button", { name: "生成咨询草稿", exact: true }); }
function draftInput(page: Page) { return assistant(page).getByRole("textbox", { name: "咨询草稿", exact: true }); }
function questionInput(page: Page) { return page.getByRole("textbox", { name: "咨询问题", exact: true }); }

test("血压知识解释引用来源，未覆盖的问题拒答，切换报告不保留内容", async ({ page }, info) => {
  await loginSynthetic(page.request, "USER");
  const first = await generateReport(page.request, await reading(page.request, "2026-01-04T09:00:00", "HOME", 121, 76));
  const second = await generateReport(page.request, await reading(page.request, "2026-01-05T09:00:00", "CLINIC", 129, 77));
  await page.goto("/patient?view=reports");
  await selectReport(page, first);
  const panel = page.getByRole("region", { name: "带来源的知识解释" });
  const field = panel.getByRole("textbox", { name: "输入知识问题" });
  const ask = panel.getByRole("button", { name: "查找资料并解释" });
  await panel.getByRole("button", { name: "为什么这两次记录不能直接比较？" }).click();
  await ask.click();
  await expect(panel.getByRole("link", { name: /CDC/ })).toHaveAttribute("href", /^https:\/\/www\.cdc\.gov\//);
  await expect(panel.getByRole("link", { name: /AHA/ })).toHaveAttribute("href", /^https:\/\/www\.heart\.org\//);
  await expect(panel).toContainText("bp-basics-2026-11-19-v1");
  await panel.screenshot({ path: info.outputPath("source-backed-explanation.png") });
  await field.fill("为什么要记录测量条件，我需要停药吗？");
  await ask.click();
  await expect(panel).toContainText("资料没有覆盖这个问法");
  await expect(panel.getByRole("link")).toHaveCount(0);
  await selectReport(page, second);
  await expect(field).toHaveValue("");
  await expect(panel).not.toContainText("资料没有覆盖这个问法");
  await panel.getByRole("button", { name: "为什么要记录测量条件？" }).click();
  await page.route("**/assistant/knowledge", route => route.request().method() === "POST" ? route.abort() : route.continue());
  await ask.click();
  await expect(panel.getByRole("alert")).toContainText("暂时无法查询资料");
  await page.unroute("**/assistant/knowledge");
  await ask.click();
  await expect(panel.getByRole("link", { name: /CDC/ })).toBeVisible();
  await expect(panel.getByRole("alert")).toHaveCount(0);
});
function fillButton(page: Page) { return assistant(page).getByRole("button", { name: "填入咨询草稿", exact: true }); }

async function authorizeInUI(page: Page, doctorEmail: string) {
  await page.getByLabel("通过医生账号（邮箱）授权").fill(doctorEmail);
  await page.getByRole("button", { name: "授权此医生", exact: true }).click();
  await expect(questionInput(page)).toBeVisible();
}

async function revokeTestGrants(client: APIRequestContext, reportId: number) {
  if (!reportId) return;
  const path = `/api/reports/${reportId}/grants`;
  for (const { doctorId } of await api<{ doctorId: number }[]>(client, path)) {
    await api(client, `${path}/${doctorId}`, "DELETE");
  }
}

test("报告事实与模板草稿：先编辑、再授权，追加或替换后才由用户提交", async ({ page, browser }) => {
  const doctor = await browser.newContext();
  let reportId = 0;
  try {
    const doctorEmail = await loginSynthetic(doctor.request, "DOCTOR");
    await loginSynthetic(page.request, "USER");
    const client = page.request;
    await reading(client, "2026-01-02T09:00:00", "HOME", 122.25, 78);
    await reading(client, "2026-01-03T09:00:00", "CLINIC", 170, 95);
    reportId = await generateReport(client, await reading(client, "2026-01-05T09:00:00", "HOME", 129.5001, 76));
    await reading(client, "2026-01-07T09:00:00", "HOME", 155, 92);
    await page.goto("/patient?view=reports");
    await selectReport(page, reportId);
    const panel = assistant(page);
    for (const value of ["129.5001", "76", "122.25", "78", "+7.2501", "-2"]) {
      await expect(panel.getByText(value, { exact: true })).toBeVisible();
    }

    await generateButton(page).click();
    await expect(panel.getByText("本地模板 · 未调用 AI", { exact: true })).toBeVisible();
    await expect(draftInput(page)).not.toHaveValue("");
    const edited = "您好，请帮我核对两次居家记录的测量条件。";
    await draftInput(page).fill(edited);
    await expect(fillButton(page)).toBeDisabled();
    await expect(questionInput(page)).toHaveCount(0);
    expect(await api<unknown[]>(client, `/api/reports/${reportId}/grants`)).toHaveLength(0);
    expect(await api<unknown[]>(client, "/api/consultations")).toHaveLength(0);

    await authorizeInUI(page, doctorEmail);
    await expect(draftInput(page)).toHaveValue(edited);
    await fillButton(page).click();
    await expect(questionInput(page)).toHaveValue(edited);
    const manual = "我已经写好的问题。";
    await questionInput(page).fill(manual);
    await fillButton(page).click();
    await expect(questionInput(page)).toHaveValue(manual);
    await panel.getByRole("button", { name: "追加到咨询问题", exact: true }).click();
    await expect(questionInput(page)).toHaveValue(new RegExp(`^${manual}\\s+${edited}$`));
    await fillButton(page).click();
    await expect(questionInput(page)).toHaveValue(new RegExp(`^${manual}\\s+${edited}$`));
    await panel.getByRole("button", { name: "替换咨询问题", exact: true }).click();
    await expect(questionInput(page)).toHaveValue(edited);

    expect(await api<unknown[]>(client, "/api/consultations")).toHaveLength(0);
    expect(await api<unknown[]>(doctor.request, "/api/doctor/consultations")).toHaveLength(0);
    await page.getByRole("button", { name: "提交咨询并打开消息" }).click();
    await expect(page).toHaveURL(/\/patient\/messages\?conversation=\d+$/);
    await expect(page.locator(".chat-bubble").first()).toHaveText(edited);
    const doctorHome = await doctor.newPage();
    await doctorHome.goto("/doctor");
    await expect(doctorHome.locator(`.report-list > article[data-report-id="${reportId}"] .doctor-request`)).toContainText(edited);
  } finally {
    try { await revokeTestGrants(page.request, reportId); }
    finally { await doctor.close(); }
  }
});

test("草稿请求失败不影响手写内容或报告事实，重试可以恢复", async ({ page, browser }) => {
  const doctor = await browser.newContext();
  let reportId = 0;
  try {
    const doctorEmail = await loginSynthetic(doctor.request, "DOCTOR");
    await loginSynthetic(page.request, "USER");
    reportId = await generateReport(page.request, await reading(page.request, "2026-01-05T09:00:00", "HOME", 125, 79));
    await page.goto("/patient?view=reports");
    await selectReport(page, reportId);
    await authorizeInUI(page, doctorEmail);
    const manual = "手写的咨询问题，不应被重试覆盖。";
    await questionInput(page).fill(manual);
    const route = `**/api/reports/${reportId}/assistant`;
    await page.route(route, intercepted => intercepted.abort("connectionreset"));
    await generateButton(page).click();
    await expect(assistant(page).getByRole("alert")).toContainText("暂时无法生成咨询草稿");
    await expect(assistant(page).getByText("125", { exact: true })).toBeVisible();
    await expect(questionInput(page)).toHaveValue(manual);
    await page.unroute(route);
    await generateButton(page).click();
    await expect(draftInput(page)).not.toHaveValue("");
    await expect(questionInput(page)).toHaveValue(manual);
    expect(await api<unknown[]>(page.request, "/api/consultations")).toHaveLength(0);
  } finally {
    try { await revokeTestGrants(page.request, reportId); }
    finally { await doctor.close(); }
  }
});

test("切换报告后不会显示前一份报告迟到的草稿", async ({ page }) => {
  await loginSynthetic(page.request, "USER");
  const old = await generateReport(page.request, await reading(page.request, "2026-01-03T09:00:00", "HOME", 141, 81));
  const next = await generateReport(page.request, await reading(page.request, "2026-01-05T09:00:00", "CLINIC", 121, 71));
  await page.goto("/patient?view=reports");
  await selectReport(page, old);

  let allowReply!: () => void;
  let responseReady = false;
  let markFinished!: () => void;
  const replyGate = new Promise<void>(resolve => { allowReply = resolve; });
  const finished = new Promise<void>(resolve => { markFinished = resolve; });
  const oldEndpoint = `**/api/reports/${old}/assistant`;
  await page.route(oldEndpoint, async route => {
    try {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      responseReady = true;
      await replyGate;
      // The browser may cancel the request on report switch; otherwise deliver it late.
      await route.fulfill({ response }).catch(() => undefined);
    } finally { markFinished(); }
  });
  try {
    await generateButton(page).click();
    await expect.poll(() => responseReady).toBe(true);
    await selectReport(page, next);
    await expect(assistant(page).getByText("121", { exact: true })).toBeVisible();
    await expect(assistant(page).getByText("没有可比较的同条件历史记录，仅展示本次报告。", { exact: true })).toBeVisible();
    allowReply();
    await finished;
    await expect(draftInput(page)).toHaveCount(0);
    await expect(assistant(page).getByText("141", { exact: true })).toHaveCount(0);
    await generateButton(page).click();
    await expect(draftInput(page)).not.toHaveValue("");
  } finally {
    allowReply();
    await page.unrouteAll({ behavior: "ignoreErrors" });
  }
});
