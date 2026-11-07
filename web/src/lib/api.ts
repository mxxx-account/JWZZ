export type Role = "USER" | "DOCTOR" | "MERCHANT";
export type CurrentUser = { id: number; email: string; role: Role; name: string };
export type MerchantStore = { id: number; merchantId: number; name: string; description: string; city: string; address: string; status: "DRAFT"; createdAt: string; updatedAt: string };
export type ProductTemplate = { id: number; code: string; name: string; category: string; description: string };
export type MerchantProduct = { id: number; storeId: number; templateId: number | null; name: string; category: string; description: string; priceCents: number; status: "ON_SHELF" | "OFF_SHELF" | "ARCHIVED"; available: number; reserved: number };
export type InventoryLedger = { id: number; skuId: number; actorId: number; delta: number; beforeAvailable: number; afterAvailable: number; reason: string; note: string; createdAt: string };
export function homeForRole(role: Role) { return role === "DOCTOR" ? "/doctor" : role === "MERCHANT" ? "/merchant" : "/patient"; }
export type Report = {
  id: number;
  ownerId: number;
  ruleVersion: string;
  content: {
    schemaVersion?: string;
    title?: string;
    message?: string;
    sourceEntryId?: string;
    category?: string;
    context?: string;
    measuredAt?: string;
    rulesStatus?: string;
    values?: NormalizedValue[];
    interpretations?: DraftInterpretation[];
  };
  createdAt: string;
};
export type Grant = { doctorId: number; doctorEmail: string };
export type Specialty = "GENERAL" | "CARDIOLOGY" | "ENDOCRINOLOGY";
export type Doctor = { id: number; email: string; displayName: string; specialty: Specialty; lastSeenAt: string | null; online: boolean };
export type Consultation = { id: number; reportId: number; userId: number; targetDoctorId: number | null; question: string; status: "OPEN" | "CLAIMED" | "ANSWERED"; claimedDoctorId: number | null; answer: string | null; createdAt: string; claimedAt: string | null; answeredAt: string | null };
export type ChatMessage = { id: number; consultationId: number; senderId: number; body: string; createdAt: string };
export type Conversation = { id: number; reportId: number; peerId: number; peerName: string; peerSpecialty: Specialty | "用户" | ""; peerOnline: boolean; status: "OPEN" | "CLAIMED" | "ANSWERED"; lastMessage: string; updatedAt: string; unreadCount: number; canSend: boolean };
export type ConversationDetail = { conversation: Conversation; messages: ChatMessage[] };
export type IndicatorCatalog = { version: string; items: { code: string; name: string; unit: string; description: string }[] };
export type NormalizedValue = { code: string; rawValue: number; rawUnit: string; value: number; unit: string; conversionVersion: string };
export type DraftInterpretation = { ruleCode: string; ruleVersion: string; reviewStatus: string; label: string; explanation: string; applicability: string; sourceTitle: string; sourceUrl: string };
export type IndicatorEntryResponse = { entryId: string; values: NormalizedValue[]; rulesStatus: string; draftInterpretations: DraftInterpretation[] };
export type StoredIndicator = { id: number; entryId: string; code: string; rawValue: number; rawUnit: string; value: number; unit: string; conversionVersion: string; context: string; measuredAt: string; ageYears: number; pregnant: boolean };

const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function csrfToken(): Promise<string> {
  const response = await fetch(`${base}/api/auth/csrf`, { credentials: "include", cache: "no-store" });
  if (!response.ok) throw new ApiError(response.status, "无法获取安全令牌，请确认后端正在运行。");
  return (await response.json()).token;
}

export async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET") headers["X-XSRF-TOKEN"] = await csrfToken();
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    credentials: "include",
    cache: "no-store",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const detail = typeof payload?.message === "string" ? payload.message : null;
    const fallback = response.status === 400 ? "输入未通过校验，请检查填写内容。"
      : response.status === 401 ? "登录已过期，请重新登录。"
      : response.status === 403 ? "当前账号无权执行此操作。"
      : response.status === 409 ? "操作与现有记录冲突，请刷新后重试。"
      : `请求失败（HTTP ${response.status}）`;
    throw new ApiError(response.status, detail ?? fallback);
  }
  const payload = await response.text();
  return payload ? JSON.parse(payload) as T : undefined as T;
}

export async function login(email: string, password: string): Promise<void> {
  const token = await csrfToken();
  const response = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-XSRF-TOKEN": token },
    body: new URLSearchParams({ email, password }),
  });
  if (!response.ok) throw new ApiError(response.status, "邮箱或密码错误。");
}
