"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, homeForRole, type Role } from "@/lib/api";

export function AppNav({ role, active }: { role: Role; active: "home" | "messages" | "shop-messages" | "pharmacy" | "notifications" }) {
  const router = useRouter();
  const home = homeForRole(role);
  const messages = `${home}/messages`;
  const [unread,setUnread]=useState<number|null>(null);
  useEffect(() => {
    let cancelled=false, busy=false;
    const refresh=async()=>{
      if(busy || document.visibilityState!=="visible") return;
      busy=true;
      try { const count=await api<{unreadCount:number}>("/api/notifications/unread-count"); if(!cancelled) setUnread(count.unreadCount); }
      catch { if(!cancelled) setUnread(null); }
      finally { busy=false; }
    };
    void refresh(); const timer=window.setInterval(()=>void refresh(),8000);
    window.addEventListener("jwzz-notifications-changed",refresh); window.addEventListener("online",refresh); document.addEventListener("visibilitychange",refresh);
    return ()=>{ cancelled=true;window.clearInterval(timer);window.removeEventListener("jwzz-notifications-changed",refresh);window.removeEventListener("online",refresh);document.removeEventListener("visibilitychange",refresh); };
  },[role]);
  return <header className="chat-nav app-nav">
    <Link className="chat-brand" href={home}>见微知著</Link>
    <Link aria-current={active === "home" ? "page" : undefined} href={home}>首页</Link>
    {role !== "MERCHANT" && <Link aria-current={active === "messages" ? "page" : undefined} href={messages}>咨询消息</Link>}
    {role === "USER" && <Link aria-current={active === "pharmacy" ? "page" : undefined} href="/patient/pharmacy">药店</Link>}
    {role === "USER" && <Link aria-current={active === "shop-messages" ? "page" : undefined} href="/patient/shop-messages">商家消息</Link>}
    {role === "MERCHANT" && <Link aria-current={active === "shop-messages" ? "page" : undefined} href="/merchant/messages">消息</Link>}
    <Link className="notification-nav" aria-current={active === "notifications" ? "page" : undefined} href={`${home}/notifications`} aria-label={unread===null ? "通知中心，未读数暂不可用":`通知中心，${unread} 条未读`}>通知{unread!==null && unread>0 && <span className="notification-count">{unread>99?"99+":unread}</span>}</Link>
    <button onClick={async () => { await api<void>("/api/auth/logout", "POST"); router.replace("/"); }}>退出登录</button>
  </header>;
}
