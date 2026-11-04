export type CurrentUser = { id: number; email: string; role: "USER" | "DOCTOR" };
export type Report = {
  id: number;
  ownerId: number;
  ruleVersion: string;
  content: { title?: string; message?: string };
  createdAt: string;
};
export type Grant = { doctorId: number; doctorEmail: string };

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
  if (!response.ok) throw new ApiError(response.status, `请求失败（HTTP ${response.status}）`);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
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
