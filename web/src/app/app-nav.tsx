"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

export function AppNav({ role, active }: { role: "USER" | "DOCTOR"; active: "home" | "messages" }) {
  const router = useRouter();
  const home = role === "DOCTOR" ? "/doctor" : "/patient";
  const messages = `${home}/messages`;
  return <header className="chat-nav app-nav">
    <Link className="chat-brand" href={home}>见微知著</Link>
    <Link aria-current={active === "home" ? "page" : undefined} href={home}>首页</Link>
    <Link aria-current={active === "messages" ? "page" : undefined} href={messages}>消息</Link>
    <button onClick={async () => { await api<void>("/api/auth/logout", "POST"); router.replace("/"); }}>退出登录</button>
  </header>;
}
