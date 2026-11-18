"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AppNav } from "../app-nav";
import { useRouter } from "next/navigation";
import { api, homeForRole, type Conversation, type ChatMessage, type CurrentUser } from "@/lib/api";
import { specialtyLabels } from "@/lib/specialty";
import { useChatPages } from "@/lib/use-chat-pages";
import { outboxKey, pendingMessage, prepareMessage } from "@/lib/message-outbox";

const time = (value: string) => new Date(value).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function ChatWorkspace({ role }: { role: "USER" | "DOCTOR" }) {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [query, setQuery] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const endpoint = "/api/messages/conversations";
  const heartbeat = useCallback(async () => { if (role === "DOCTOR") await api<void>("/api/doctor/presence", "POST"); }, [role]);
  const { items, activeId, setActiveId, detail, notice, setNotice, thread, refreshList, refreshDetail,
    moreConversations, loadingList, loadMore, loadingHistory, loadOlder, onScroll, latest } =
    useChatPages<Conversation, ChatMessage>(endpoint, Boolean(user), heartbeat);
  useEffect(() => {
    let cancelled = false;
    api<CurrentUser>("/api/auth/me").then(async current => {
      if (cancelled) return;
      if (current.role !== role) { router.replace(homeForRole(current.role)); return; }
      setUser(current);
      await heartbeat();
      const next = await refreshList();
      if (cancelled) return;
      const requested = Number(new URLSearchParams(window.location.search).get("conversation"));
      // Deep links remain usable even when the conversation is outside the first list page.
      setActiveId(Number.isSafeInteger(requested) && requested > 0 ? requested : next[0]?.id ?? null);
    }).catch(() => { if (!cancelled) setNotice("无法加载会话，请确认已登录并刷新重试。"); });
    return () => { cancelled = true; };
  }, [role, router, heartbeat, refreshList, setActiveId, setNotice]);
  useEffect(() => {
    setDraft(user && activeId !== null ? pendingMessage(outboxKey(user.id, "consultation", activeId))?.body ?? "" : "");
  }, [user, activeId]);
  const selected = useRef(activeId);
  selected.current = activeId;
  async function send() {
    const body = draft.trim(), id = activeId;
    if (!body || busy || id === null || !user || !detail || !detail.conversation.canSend) return;
    setBusy(true); setNotice("");
    const key = outboxKey(user.id, "consultation", id);
    try {
      await api(`${endpoint}/${id}`, "POST", prepareMessage(key, body));
      sessionStorage.removeItem(key);
      if (selected.current === id) setDraft("");
      await refreshDetail(id);
      await refreshList();
    } catch (error) { if (selected.current === id) setNotice(error instanceof Error ? error.message : "发送失败。"); }
    finally { setBusy(false); }
  }

  const visible = items.filter(item => (!unreadOnly || item.unreadCount > 0)
    && `${item.peerName} ${item.peerSpecialty} ${item.lastMessage} ${item.reportId}`.toLowerCase().includes(query.toLowerCase()));
  const current = detail?.conversation;
  const dashboard = role === "USER" ? "/patient" : "/doctor";

  return <main className="chat-page">
    <AppNav role={role} active="messages" />
    <div className="chat-frame">
      <aside className="chat-sidebar">
        <div className="chat-sidebar-head"><h1>咨询消息</h1><span>{items.reduce((sum, item) => sum + item.unreadCount, 0)} 条未读（已加载）</span></div>
        {role === "USER" && <p className="shop-chat-switch"><Link href="/patient/shop-messages">查看商家订单消息 →</Link></p>}
        <label className="chat-search"><span className="sr-only">搜索会话</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索已加载的联系人、科室或报告" /></label>
        <div className="chat-filters"><button className={!unreadOnly ? "active" : ""} onClick={() => setUnreadOnly(false)}>全部</button><button className={unreadOnly ? "active" : ""} onClick={() => setUnreadOnly(true)}>未读</button></div>
        <div className="chat-conversation-list">{visible.map(item => <button key={item.id} data-conversation-id={item.id} className={`chat-conversation ${activeId === item.id ? "selected" : ""}`} onClick={() => { if (activeId === item.id) void refreshDetail(item.id).catch(error => setNotice(error instanceof Error ? error.message : "无法读取会话。")); else setActiveId(item.id); window.history.replaceState(null, "", `?conversation=${item.id}`); }}>
          <span className="chat-avatar" aria-hidden="true">{item.peerName.slice(0, 1)}</span><span className="chat-conversation-text"><strong>{item.peerName}</strong><small>{item.peerSpecialty in specialtyLabels ? specialtyLabels[item.peerSpecialty as keyof typeof specialtyLabels] : item.peerSpecialty} · 报告 #{item.reportId}</small><span>{item.lastMessage}</span></span><span className="chat-meta"><small>{time(item.updatedAt)}</small>{item.unreadCount > 0 && <b>{item.unreadCount}</b>}</span>
        </button>)}{moreConversations && <button className="chat-load-more" disabled={loadingList} onClick={loadMore}>{loadingList ? "加载中…" : "加载更多会话"}</button>}</div>
        {visible.length === 0 && <p className="chat-empty-list">{items.length ? "没有符合筛选条件的会话。" : role === "USER" ? "还没有会话。请先到报告页授权医生并提交咨询。" : "还没有已接受的咨询。请到首页查看待咨询列表。"}</p>}
      </aside>
      <section className="chat-main" aria-label="聊天内容">
        {current ? <><div className="chat-peer-head"><span className="chat-avatar" aria-hidden="true">{current.peerName.slice(0, 1)}</span><div><h2>{current.peerName}</h2><p>{current.peerSpecialty in specialtyLabels ? specialtyLabels[current.peerSpecialty as keyof typeof specialtyLabels] : current.peerSpecialty} · 报告 #{current.reportId} · {current.peerOnline ? "页面活跃" : "当前离线"}</p></div><span className="chat-status">{current.status === "CLOSED" ? "已结束" : current.status === "OPEN" ? "待医生接受" : "对话中"}</span></div>
          <div className="chat-safety">本页面仅用于项目流程演示，不提供正式诊断、处方或急症响应。如出现胸痛、严重呼吸困难等急症，请及时寻求线下急救。</div>
          <div className="chat-thread" ref={thread} onScroll={onScroll}>{detail?.hasMore && <button className="chat-load-more" disabled={loadingHistory} onClick={loadOlder}>{loadingHistory ? "加载中…" : "加载更早消息"}</button>}{detail?.messages.map(message => <div key={message.id} data-message-id={message.id} className={`chat-row ${message.senderId === user?.id ? "mine" : "theirs"}`}><div className="chat-bubble">{message.body}</div><small>{time(message.createdAt)}</small></div>)}</div>
          <div className="chat-compose"><Link className="followup-chat-link" href={`${dashboard}/followups?consultation=${current.id}`}>{current.status === "CLOSED" ? "查看小结与随访" : role === "DOCTOR" ? "结束咨询 / 整理随访" : "查看随访进度"}</Link><button className="chat-jump-latest" type="button" onClick={latest}>回到最新消息</button>
            <textarea aria-label="输入消息" maxLength={2000} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} disabled={!current.canSend || busy} placeholder={current.canSend ? "输入消息… Enter 发送，Shift+Enter 换行" : current.status === "CLOSED" ? "咨询已结束，聊天记录仅供查看" : role === "DOCTOR" ? "请先在首页接受咨询" : "报告授权已撤销，暂不能继续发送"}/>
            <div className="chat-compose-foot"><small>异步消息 · 不保证医生即时回复</small><button disabled={busy || !current.canSend || !draft.trim()} onClick={send}>发送</button></div>
          </div></> : <div className="chat-placeholder"><span>✉</span><h2>选择一个会话</h2><p>{role === "USER" ? "到首页的报告板块可以选择医生并发起咨询。" : "用户提交咨询后，会话会出现在左侧。"}</p><Link href={dashboard}>返回首页</Link></div>}
      </section>
    </div>
    {notice && <p className="chat-toast" role="status">{notice}<button onClick={() => setNotice("")} aria-label="关闭提示">×</button></p>}
  </main>;
}
