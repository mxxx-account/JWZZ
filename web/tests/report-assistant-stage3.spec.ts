import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const apiBase = process.env.TEST_API_URL ?? "http://localhost:8080";
const consentLabel = "允许外部模型辅助（仅限虚构数据）";

async function csrf(client: APIRequestContext) {
  const response = await client.get(`${apiBase}/api/auth/csrf`);
  expect(response.ok()).toBe(true);
  return { "X-XSRF-TOKEN": (await response.json()).token as string };
}

async function seedReports(client: APIRequestContext) {
  const email = `e2e-assistant-model-${randomUUID()}@example.invalid`;
  const password = "SyntheticAssistantModel123!";
  const registration = await client.post(`${apiBase}/api/auth/register`, {
    headers: await csrf(client), data: { email, password, name: "模型流程虚构用户", role: "USER" },
  });
  expect(registration.ok()).toBe(true);
  const login = await client.post(`${apiBase}/api/auth/login`, {
    headers: await csrf(client), form: { email, password },
  });
  expect(login.ok()).toBe(true);

  async function saveReport(measuredAt: string, systolic: number) {
    const indicator = await client.post(`${apiBase}/api/indicators`, {
      headers: await csrf(client), data: {
        category: "BP", measuredAt, context: "HOME", ageYears: 22, pregnant: false,
        values: { systolic_bp: { value: systolic, unit: "mmHg" }, diastolic_bp: { value: 78, unit: "mmHg" } },
      },
    });
    expect(indicator.ok()).toBe(true);
    const report = await client.post(`${apiBase}/api/reports`, {
      headers: await csrf(client), data: { entryId: (await indicator.json()).entryId },
    });
    expect(report.ok()).toBe(true);
    return (await report.json()).id as number;
  }

  const old = await saveReport("2026-01-02T09:00:00", 122);
  const recent = await saveReport("2026-01-05T09:00:00", 128);
  return { old, recent };
}

function assistant(page: Page) {
  return page.getByRole("region", { name: "报告解读与咨询准备" });
}

function assistantUrl(reportId: number) { return `${apiBase}/api/reports/${reportId}/assistant`; }
function interceptDraft(page: Page, reportId: number, mode: "MODEL" | "TEMPLATE", modelStatus: string) {
  return page.route(`**/api/reports/${reportId}/assistant`, async route => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({
      status: 200,
      headers: { "Access-Control-Allow-Origin": new URL(page.url()).origin, "Access-Control-Allow-Credentials": "true" },
      json: { reportId, mode, modelStatus, draft: "您好，想请您帮我看看这份记录。", questions: ["需要补充哪些测量信息？"] },
    });
  });
}

test("明确勾选后请求模型与咨询重点，切换报告重置选择且不发送咨询", async ({ page }) => {
  const { old, recent } = await seedReports(page.request);
  await interceptDraft(page, recent, "MODEL", "USED");
  await interceptDraft(page, old, "TEMPLATE", "NOT_REQUESTED");
  await page.goto("/patient?view=reports");
  const panel = assistant(page);
  const focus = panel.getByLabel("咨询重点");
  const consent = panel.getByRole("checkbox", { name: consentLabel });
  await expect(panel.getByRole("rowheader", { name: /^上次同条件记录/ })).toBeVisible();
  await expect(consent).not.toBeChecked();
  await expect(focus).toHaveValue("BALANCED");
  await focus.selectOption("COMPARISON");
  await consent.check();
  const modelRequest = page.waitForRequest(request => request.url() === assistantUrl(recent) && request.method() === "POST");
  await panel.getByRole("button", { name: "生成咨询草稿" }).click();
  expect((await modelRequest).postDataJSON()).toEqual({ action: "PREPARE_CONSULTATION", focus: "COMPARISON", useModel: true });
  await expect(panel.getByText("Python 模型辅助", { exact: true })).toBeVisible();
  await expect(panel.getByRole("textbox", { name: "咨询草稿" })).toHaveValue("您好，想请您帮我看看这份记录。");
  await expect(panel.getByRole("button", { name: "填入咨询草稿" })).toBeDisabled();

  const consultations = await page.request.get(`${apiBase}/api/consultations`);
  expect(consultations.ok()).toBe(true);
  expect(await consultations.json()).toEqual([]);

  await page.locator(".archive-row").filter({ hasText: new RegExp(`#${old}(?!\\d)`) }).click();
  await expect(panel.getByText("没有可比较的同条件历史记录，仅展示本次报告。")).toBeVisible();
  await expect(panel.getByText("Python 模型辅助", { exact: true })).toHaveCount(0);
  await expect(consent).not.toBeChecked();
  await expect(focus).toHaveValue("BALANCED");
  await expect(focus.locator('option[value="COMPARISON"]')).toBeDisabled();
  const templateRequest = page.waitForRequest(request => request.url() === assistantUrl(old) && request.method() === "POST");
  await panel.getByRole("button", { name: "生成咨询草稿" }).click();
  expect((await templateRequest).postDataJSON()).toEqual({ action: "PREPARE_CONSULTATION", focus: "BALANCED", useModel: false });
  await expect(panel.getByRole("textbox", { name: "咨询草稿" })).toBeVisible();
  await expect(panel.getByText("本地模板 · 未调用 AI", { exact: true })).toBeVisible();
});

test("模型关闭或不可用时显示原因，仍可使用和编辑本地草稿", async ({ page }) => {
  const { recent } = await seedReports(page.request);
  await interceptDraft(page, recent, "TEMPLATE", "DISABLED");
  await page.goto("/patient?view=reports");
  const panel = assistant(page);
  await panel.getByRole("checkbox", { name: consentLabel }).check();
  await panel.getByRole("button", { name: "生成咨询草稿" }).click();
  await expect(panel.getByText("模型暂未启用，已使用本地模板生成草稿。")).toBeVisible();
  await expect(panel.getByText("本地模板 · 模型未启用", { exact: true })).toBeVisible();
  const draft = panel.getByRole("textbox", { name: "咨询草稿" });
  await draft.fill("我手写的草稿。");
  await panel.getByRole("button", { name: "调整生成选项" }).click();
  await expect(draft).toHaveValue("我手写的草稿。");
  await expect(panel.getByText("重新生成成功后会替换此草稿，不会改动咨询框中的内容。")).toBeVisible();
  await page.unroute(`**/api/reports/${recent}/assistant`);
  await interceptDraft(page, recent, "TEMPLATE", "UNAVAILABLE");
  await panel.getByRole("button", { name: "重新生成草稿" }).click();
  await expect(panel.getByText("模型暂不可用，已使用本地模板生成草稿。")).toBeVisible();
  await expect(panel.getByText("本地模板 · 模型结果未采用", { exact: true })).toBeVisible();
  await expect(panel.getByText("Python 模型辅助", { exact: true })).toHaveCount(0);
  await expect(draft).toHaveValue("您好，想请您帮我看看这份记录。");
});
