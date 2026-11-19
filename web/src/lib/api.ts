export type Role = "USER" | "DOCTOR" | "MERCHANT";
export type CurrentUser = { id: number; email: string; role: Role; name: string };
export type MerchantStore = { id: number; merchantId: number; name: string; description: string; city: string; address: string; status: "DRAFT" | "OPEN"; createdAt: string; updatedAt: string };
export type ShopOffer = { skuId: number; storeId: number; storeName: string; storeCity: string; storeAddress: string; productName: string; category: string; description: string; priceCents: number; available: number };
export type ShopPage = { items: ShopOffer[]; total: number; page: number; size: number };
export type CartItem = { id: number; skuId: number; storeId: number; storeName: string; productName: string; priceCents: number; quantity: number; available: number; purchasable: boolean };
export type ShopOrderStatus = "PENDING_PAYMENT" | "PAID" | "ACCEPTED" | "SHIPPED" | "COMPLETED" | "REFUND_PENDING" | "REFUNDED" | "CANCELLED" | "EXPIRED";
export type ShopOrder = { id: number; userId: number; storeId: number; storeName: string; status: ShopOrderStatus; totalCents: number; expiresAt: string; createdAt: string; paidAt: string | null; acceptedAt: string | null; closedAt: string | null };
export type ShopOrderItem = { id: number; skuId: number; productName: string; unitPriceCents: number; quantity: number };
export type ShopOrderDetail = { order: ShopOrder; items: ShopOrderItem[] };
export type ShopConversation = { id: number; orderId: number; peerId: number; peerName: string; orderStatus: ShopOrderStatus; lastMessage: string; updatedAt: string; unreadCount: number };
export type ShopMessage = { id: number; conversationId: number; senderId: number; body: string; createdAt: string };
export type ShopConversationDetail = { conversation: ShopConversation; messages: ShopMessage[]; hasMore: boolean };
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
export type BloodPressureReading = { measuredAt: string; context: "HOME" | "CLINIC"; systolic: number; diastolic: number };
export type ReportEvidence = {
  reportId: number;
  status: "AVAILABLE" | "NO_COMPARABLE_HISTORY" | "UNSUPPORTED_CATEGORY" | "UNSUPPORTED_SNAPSHOT";
  indicators: { code: string; label: string; unit: string; description: string }[];
  current: BloodPressureReading | null;
  previous: BloodPressureReading | null;
  change: { systolic: number; diastolic: number } | null;
  notice: string;
};
export type ReportAssistantFocus = "BALANCED" | "MEASUREMENT" | "COMPARISON" | "FOLLOW_UP";
export type ReportAssistantDraft = { reportId: number; questions: string[]; draft: string } & (
  | { mode: "MODEL"; modelStatus: "USED" }
  | { mode: "TEMPLATE"; modelStatus: "NOT_REQUESTED" | "DISABLED" | "UNAVAILABLE" }
);
export type Grant = { doctorId: number; doctorEmail: string };
export type Specialty = "GENERAL" | "CARDIOLOGY" | "ENDOCRINOLOGY";
export type Doctor = { id: number; email: string; displayName: string; specialty: Specialty; lastSeenAt: string | null; online: boolean };
export type Consultation = { id: number; reportId: number; userId: number; targetDoctorId: number | null; question: string; status: "OPEN" | "CLAIMED" | "ANSWERED" | "CLOSED"; claimedDoctorId: number | null; answer: string | null; createdAt: string; claimedAt: string | null; answeredAt: string | null };
export type ChatMessage = { id: number; consultationId: number; senderId: number; body: string; createdAt: string };
export type Conversation = { id: number; reportId: number; peerId: number; peerName: string; peerSpecialty: Specialty | "用户" | ""; peerOnline: boolean; status: "OPEN" | "CLAIMED" | "ANSWERED" | "CLOSED"; lastMessage: string; updatedAt: string; unreadCount: number; canSend: boolean };
export type ConversationDetail = { conversation: Conversation; messages: ChatMessage[]; hasMore: boolean };
export type IndicatorCatalog = { version: string; items: { code: string; name: string; unit: string; description: string }[] };
export type NormalizedValue = { code: string; rawValue: number; rawUnit: string; value: number; unit: string; conversionVersion: string };
export type DraftInterpretation = { ruleCode: string; ruleVersion: string; reviewStatus: string; label: string; explanation: string; applicability: string; sourceTitle: string; sourceUrl: string };
export type IndicatorEntryResponse = { entryId: string; values: NormalizedValue[]; rulesStatus: string; draftInterpretations: DraftInterpretation[] };
export type StoredIndicator = { id: number; entryId: string; code: string; rawValue: number; rawUnit: string; value: number; unit: string; conversionVersion: string; context: string; measuredAt: string; ageYears: number; pregnant: boolean };

const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function csrfToken(signal?: AbortSignal): Promise<string> {
  const response = await fetch(`${base}/api/auth/csrf`, { credentials: "include", cache: "no-store", signal });
  if (!response.ok) throw new ApiError(response.status, "无法获取安全令牌，请确认后端正在运行。");
  return (await response.json()).token;
}

export async function api<T>(path: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET") headers["X-XSRF-TOKEN"] = await csrfToken(signal);
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    credentials: "include",
    cache: "no-store",
    signal,
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
