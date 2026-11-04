"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api, login, type CurrentUser } from "@/lib/api";

export function AuthPanel() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    setBusy(true);
    try {
      if (mode === "register") await api<CurrentUser>("/api/auth/register", "POST", { email, password });
      await login(email, password);
      const user = await api<CurrentUser>("/api/auth/me");
      router.push(user.role === "DOCTOR" ? "/doctor" : "/patient");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  return <section className="auth-card">
    <div className="tabs">
      <button type="button" className={mode === "login" ? "selected" : ""} onClick={() => setMode("login")}>登录</button>
      <button type="button" className={mode === "register" ? "selected" : ""} onClick={() => setMode("register")}>注册用户</button>
    </div>
    <form onSubmit={submit}>
      <label>邮箱<input type="email" required autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} /></label>
      <label>密码<input type="password" required minLength={mode === "register" ? 12 : undefined} autoComplete={mode === "register" ? "new-password" : "current-password"} value={password} onChange={event => setPassword(event.target.value)} /></label>
      <button type="submit" disabled={busy}>{busy ? "处理中…" : mode === "register" ? "注册并登录" : "登录"}</button>
      {message && <p role="alert" className="error">{message}</p>}
    </form>
    <p className="note">医生演示账号由本地开发环境创建，不开放自行注册。新用户密码至少 12 位。</p>
  </section>;
}
