"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppNav } from "../app-nav";
import { api, homeForRole, type CurrentUser, type ShopConversation, type ShopMessage } from "@/lib/api";
import { useChatPages } from "@/lib/use-chat-pages";
import { outboxKey, pendingMessage, prepareMessage } from "@/lib/message-outbox";

const time = (value: string) => new Date(value).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function ShopChatWorkspace({ role }: { role: "USER" | "MERCHANT" }) {
  const router = useRouter();
  const endpoint = role === "MERCHANT" ? "/api/merchant/conversations" : "/api/shop/conversations";
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [query, setQuery] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const { items, activeId, setActiveId, detail, notice, setNotice, thread, refreshList, refreshDetail,
    moreConversations, loadingList, loadMore, loadingHistory, loadOlder, onScroll, latest } =
    useChatPages<ShopConversation, ShopMessage>(endpoint, Boolean(user));
  useEffect(() => {
    let cancelled = false;
    api<CurrentUser>("/api/auth/me").then(async current => {
      if (cancelled) return;
      if (current.role !== role) { router.replace(homeForRole(current.role)); return; }
      setUser(current);
      const next = await refreshList();
      if (cancelled) return;
      const requested = Number(new URLSearchParams(window.location.search).get("conversation"));
      // Deep links remain usable even when the conversation is outside the first list page.
      setActiveId(Number.isSafeInteger(requested) && requested > 0 ? requested : next[0]?.id ?? null);
    }).catch(() => { if (!cancelled) setNotice("无法加载会话，请确认已登录并刷新重试。"); });
    return () => { cancelled = true; };
  }, [role, router, refreshList, setActiveId, setNotice]);
  useEffect(() => {
    setDraft(user && activeId !== null ? pendingMessage(outboxKey(user.id, "shop", activeId))?.body ?? "" : "");
  }, [user, activeId]);
  const selected = useRef(activeId);
  selected.current = activeId;
  async function send() {
    const body = draft.trim(), id = activeId;
    if (!body || busy || id === null || !user || !detail) return;
    setBusy(true); setNotice("");
    const key = outboxKey(user.id, "shop", id);
    try {
      await api(`${endpoint}/${id}/messages`, "POST", prepareMessage(key, body));
      sessionStorage.removeItem(key);
      if (selected.current === id) setDraft("");
      await refreshDetail(id);
      await refreshList();
    } catch (error) { if (selected.current === id) setNotice(error instanceof Error ? error.message : "发送失败。"); }
    finally { setBusy(false); }
  }

  const visible = items.filter(item => (!unreadOnly || item.unreadCount > 0)
    && `${item.peerName} ${item.orderId} ${item.lastMessage}`.toLowerCase().includes(query.toLowerCase()));
  const current = detail?.conversation;
  return <main className="chat-page">
    <AppNav role={role} active="shop-messages" />
    <div className="chat-frame">
      <aside className="chat-sidebar">
        <div className="chat-sidebar-head"><h1>商家消息</h1><span>{items.reduce((sum, item) => sum + item.unreadCount, 0)} 条未读（已加载）</span></div>
        {role === "USER" && <p className="shop-chat-switch"><Link href="/patient/messages">查看医生咨询消息 →</Link></p>}
        <label className="chat-search"><span className="sr-only">搜索订单会话</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索已加载的商家、用户或订单号" /></label>
        <div className="chat-filters"><button className={!unreadOnly ? "active" : ""} onClick={() => setUnreadOnly(false)}>全部</button><button className={unreadOnly ? "active" : ""} onClick={() => setUnreadOnly(true)}>未读</button></div>
        <div className="chat-conversation-list">{visible.map(item => <button key={item.id} data-shop-conversation-id={item.id} className={`chat-conversation ${activeId === item.id ? "selected" : ""}`} onClick={() => { if (activeId === item.id) void refreshDetail(item.id).catch(error => setNotice(error instanceof Error ? error.message : "会话读取失败。")); else setActiveId(item.id); window.history.replaceState(null, "", `?conversation=${item.id}`); }}>
          <span className="chat-avatar" aria-hidden="true">{item.peerName.slice(0, 1)}</span><span className="chat-conversation-text"><strong>{item.peerName}</strong><small>演示订单 #{item.orderId} · {item.orderStatus}</small><span>{item.lastMessage}</span></span><span className="chat-meta"><small>{time(item.updatedAt)}</small>{item.unreadCount > 0 && <b>{item.unreadCount}</b>}</span>
        </button>)}{moreConversations && <button className="chat-load-more" disabled={loadingList} onClick={loadMore}>{loadingList ? "加载中…" : "加载更多会话"}</button>}</div>
        {visible.length === 0 && <p className="chat-empty-list">{items.length ? "没有符合条件的订单会话。" : role === "USER" ? "还没有商家会话。可在药店的我的订单中联系商家。" : "还没有用户发来的订单消息。"}</p>}
      </aside>
      <section className="chat-main" aria-label="商家聊天内容">
        {current ? <><div className="chat-peer-head"><span className="chat-avatar" aria-hidden="true">{current.peerName.slice(0, 1)}</span><div><h2>{current.peerName}</h2><p>关联演示订单 #{current.orderId} · {current.orderStatus}</p></div><span className="chat-status">订单消息</span></div>
          <div className="chat-safety">仅讨论此演示订单，不提供医疗诊断或用药指导。请勿发送体检报告、病历、处方或其他敏感健康信息。</div>
          <div className="chat-thread" ref={thread} onScroll={onScroll}>{detail?.hasMore && <button className="chat-load-more" disabled={loadingHistory} onClick={loadOlder}>{loadingHistory ? "加载中…" : "加载更早消息"}</button>}{detail?.messages.map(message => <div key={message.id} data-message-id={message.id} className={`chat-row ${message.senderId === user?.id ? "mine" : "theirs"}`}><div className="chat-bubble">{message.body}</div><small>{time(message.createdAt)}</small></div>)}</div>
          <div className="chat-compose"><button className="chat-jump-latest" type="button" onClick={latest}>回到最新消息</button><textarea aria-label="输入商家消息" maxLength={2000} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} placeholder="输入订单相关消息… Enter 发送，Shift+Enter 换行" disabled={busy}/><div className="chat-compose-foot"><small>异步消息 · 不保证即时回复</small><button onClick={() => void send()} disabled={busy || !draft.trim()}>发送</button></div></div>
        </> : <div className="chat-placeholder"><span>✉</span><h2>选择订单会话</h2><p>{role === "USER" ? "在药店的我的订单中点击“联系商家”。" : "用户从订单发起消息后，会话会出现在左侧。"}</p><Link href={role === "USER" ? "/patient/pharmacy" : "/merchant"}>返回{role === "USER" ? "药店" : "首页"}</Link></div>}
      </section>
    </div>
    {notice && <p className="chat-toast" role="status">{notice}<button onClick={() => setNotice("")} aria-label="关闭提示">×</button></p>}
  </main>;
}
