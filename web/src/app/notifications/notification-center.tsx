"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AppNav } from "../app-nav";
import { api, homeForRole, type CurrentUser, type Role } from "@/lib/api";

type Notice = { id: number; type: string; resourceId: number; title: string; description: string; href: string; createdAt: string; readAt: string | null };
type NoticePage = { items: Notice[]; hasMore: boolean };

export function NotificationCenter({ role }: { role: Role }) {
  const router=useRouter();
  const [ready,setReady]=useState(false), [unreadOnly,setUnreadOnly]=useState(false);
  const [items,setItems]=useState<Notice[]>([]), [hasMore,setHasMore]=useState(false);
  const [busy,setBusy]=useState(false), [error,setError]=useState("");
  const generation=useRef(0), pages=useRef(1), pending=useRef(false);
  const load=useCallback(async (more=false) => {
    if(pending.current) return;
    pending.current=true; setBusy(true);
    const run=generation.current, wanted=pages.current+(more?1:0);
    try {
      let before: number|undefined, next: Notice[]=[], remaining=false;
      for(let p=0;p<wanted;p++) {
        const result=await api<NoticePage>(`/api/notifications?size=20&unreadOnly=${unreadOnly}${before ? `&beforeId=${before}`:""}`);
        if(run!==generation.current) return;
        next.push(...result.items); remaining=result.hasMore; before=result.items.at(-1)?.id;
        if(!remaining || !before) break;
      }
      pages.current=wanted; setItems(next); setHasMore(remaining); setError("");
    } catch { if(run===generation.current) setError("通知暂时无法同步，请稍后刷新重试。"); }
    finally { if(run===generation.current) { pending.current=false; setBusy(false); } }
  },[unreadOnly]);

  useEffect(() => {
    let cancelled=false;
    api<CurrentUser>("/api/auth/me").then(user => {
      if(cancelled) return;
      if(user.role!==role) { router.replace(homeForRole(user.role)); return; }
      setReady(true);
    }).catch(() => { if(!cancelled) router.replace("/"); });
    return () => { cancelled=true; };
  },[role,router]);
  useEffect(() => {
    if(!ready) return;
    generation.current++; pending.current=false; pages.current=1; setItems([]); setHasMore(false);
    void load();
    const refresh=()=>{ if(document.visibilityState==="visible") void load(); };
    const timer=window.setInterval(refresh,8000);
    window.addEventListener("online",refresh); document.addEventListener("visibilitychange",refresh);
    return () => { generation.current++; pending.current=false; window.clearInterval(timer); window.removeEventListener("online",refresh); document.removeEventListener("visibilitychange",refresh); };
  },[ready,load]);

  async function acknowledge(item: Notice, open=false) {
    const run=generation.current;
    setError("");
    try {
      await api<void>(`/api/notifications/${item.id}/read`,"POST");
      window.dispatchEvent(new Event("jwzz-notifications-changed"));
      if(open) router.push(item.href);
      else if(run===generation.current) {
        // Discard a list response started before the successful acknowledgement.
        generation.current++; pending.current=false; await load();
      }
    } catch { setError("操作未完成，通知可能已不可访问；请刷新重试。"); }
  }

  return <main><AppNav role={role} active="notifications" />
    <section className="notification-center" aria-label="通知中心">
      <div className="notification-heading"><div><p className="notification-kicker">见微知著 · 站内通知</p><h1>通知中心</h1>
        <p>集中查看咨询与订单动态。通知已读与聊天已读相互独立。</p></div><button disabled={busy || !ready} onClick={()=>void load()}>刷新通知</button></div>
      <div className="notification-filters"><button aria-pressed={!unreadOnly} className={!unreadOnly?"active":""} onClick={()=>setUnreadOnly(false)}>全部通知</button><button aria-pressed={unreadOnly} className={unreadOnly?"active":""} onClick={()=>setUnreadOnly(true)}>未读通知</button></div>
      {error && <p className="error-notice" role="alert">{error}</p>}
      {!busy && items.length===0 && <p className="notification-empty">{unreadOnly ? "暂无未读通知。":"暂无通知。后续咨询和订单动态会显示在这里。"}</p>}
      <div className="notification-list">{items.map(item=><article key={item.id} data-notification-id={item.id} className={item.readAt?"notification-item":"notification-item unread"}>
        <div><span className="notification-kind">{item.type.startsWith("ORDER_")?"订单动态":"咨询动态"} · {item.readAt?"已读":"未读"}</span>
          <h2>{item.title}</h2><p>{item.description}</p><small>关联{item.type.startsWith("ORDER_")?"订单":"咨询"} #{item.resourceId} · {new Date(item.createdAt).toLocaleString("zh-CN")}</small></div>
        <div className="notification-actions"><button onClick={()=>void acknowledge(item,true)}>查看详情</button>{!item.readAt && <button className="secondary" onClick={()=>void acknowledge(item)}>标为已读</button>}</div>
      </article>)}</div>
      {hasMore && <button className="notification-more" disabled={busy} onClick={()=>void load(true)}>加载更多通知</button>}
      {busy && <p role="status">正在同步通知…</p>}
      <p className="note">站内通知通常在数秒后更新，不是急症响应或即时送达承诺。记录提醒将在后续随访阶段开放。</p>
    </section></main>;
}
