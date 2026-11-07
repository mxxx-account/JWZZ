"use client";

import { useState, type FormEvent } from "react";
import { api, homeForRole, login, type CurrentUser, type Role } from "@/lib/api";

export function AuthPanel() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("USER");
  const [specialty, setSpecialty] = useState("GENERAL");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    setBusy(true);
    try {
      if (mode === "register") await api<CurrentUser>("/api/auth/register", "POST", { email, name, password, role, specialty: role === "DOCTOR" ? specialty : null });
      await login(email, password);
      const user = await api<CurrentUser>("/api/auth/me");
      if (user.role !== role) {
        await api<void>("/api/auth/logout", "POST");
        throw new Error("所选身份与账号身份不一致，请切换后重试。");
      }
      window.location.replace(homeForRole(user.role));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  return <section className="auth-card">
    <div className="tabs">
      <button type="button" className={mode === "login" ? "selected" : ""} onClick={() => setMode("login")}>登录</button>
      <button type="button" className={mode === "register" ? "selected" : ""} onClick={() => setMode("register")}>注册</button>
    </div>
    <form onSubmit={submit}>
      <label>身份<select value={role} onChange={event => setRole(event.target.value as Role)}><option value="USER">用户</option><option value="DOCTOR">医生</option><option value="MERCHANT">商家</option></select></label>
      <label>邮箱<input type="email" required autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} /></label>
      {mode === "register" && <label>姓名<input required maxLength={80} autoComplete="name" value={name} onChange={event => setName(event.target.value)} /></label>}
      {mode === "register" && role === "DOCTOR" && <label>科室<select value={specialty} onChange={event => setSpecialty(event.target.value)}><option value="GENERAL">全科</option><option value="CARDIOLOGY">心血管内科</option><option value="ENDOCRINOLOGY">内分泌科</option></select></label>}
      <label>密码<input type="password" required minLength={mode === "register" ? 12 : undefined} autoComplete={mode === "register" ? "new-password" : "current-password"} value={password} onChange={event => setPassword(event.target.value)} /></label>
      <button type="submit" disabled={busy}>{busy ? "处理中…" : mode === "register" ? "注册并登录" : "登录"}</button>
      {message && <p role="alert" className="error">{message}</p>}
    </form>
    <p className="note">密码至少 12 位。医生与商家自行注册仅供本地项目演示，不代表已核验执业或经营资质；请勿输入真实患者资料。</p>
  </section>;
}
