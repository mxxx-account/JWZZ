"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AppNav } from "../app-nav";
import { useRouter } from "next/navigation";
import { api, homeForRole, type Conversation, type ConversationDetail, type CurrentUser } from "@/lib/api";
import { specialtyLabels } from "@/lib/specialty";

const time = (value: string) => new Date(value).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function ChatWorkspace({ role }: { role: "USER" | "DOCTOR" }) {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [items, setItems] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [query, setQuery] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const bottom = useRef<HTMLDivElement>(null);

  const refreshList = useCallback(async () => {
    const next = await api<Conversation[]>("/api/messages/conversations");
    setItems(next.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()));
    return next;
  }, []);

  const refreshDetail = useCallback(async (id: number) => {
    const next = await api<ConversationDetail>(`/api/messages/conversations/${id}`);
    setDetail(next);
    await api<void>(`/api/messages/conversations/${id}/read`, "POST");
    setItems(previous => previous.map(item => item.id === id ? { ...item, unreadCount: 0 } : item));
    setDetail(previous => previous?.conversation.id === id
      ? { ...previous, conversation: { ...previous.conversation, unreadCount: 0 } } : previous);
  }, []);

  useEffect(() => {
    let cancelled = false;
    api<CurrentUser>("/api/auth/me").then(async current => {
      if (cancelled) return;
      if (current.role !== role) { router.replace(homeForRole(current.role)); return; }
      setUser(current);
      if (role === "DOCTOR") await api<void>("/api/doctor/presence", "POST");
      const next = await refreshList();
      if (cancelled) return;
      const requested = Number(new URLSearchParams(window.location.search).get("conversation"));
      setActiveId(next.some(item => item.id === requested) ? requested : next[0]?.id ?? null);
    }).catch(() => { if (!cancelled) router.replace("/"); });
    return () => { cancelled = true; };
  }, [role, router, refreshList]);

  useEffect(() => {
    if (activeId === null || !user) { setDetail(null); return; }
    refreshDetail(activeId).catch(error => { setDetail(null); setNotice(error instanceof Error ? error.message : "无法读取会话。"); });
  }, [activeId, user, refreshDetail]);

  useEffect(() => {
    if (!user) return;
    const timer = window.setInterval(async () => {
      try {
        if (role === "DOCTOR") await api<void>("/api/doctor/presence", "POST");
        const next = await refreshList();
        if (activeId !== null) {
          if (next.some(item => item.id === activeId)) await refreshDetail(activeId);
          else { setActiveId(null); setDetail(null); setNotice("此会话目前不可访问，可能是报告授权已撤销。"); }
        }
      } catch { /* Keep the last visible state during a temporary network interruption. */ }
    }, 8000);
    return () => window.clearInterval(timer);
  }, [user, role, activeId, refreshList, refreshDetail]);

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [detail?.messages.length, activeId]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function send() {
    const body = draft.trim();
    if (!body || activeId === null || !detail?.conversation.canSend || busy) return;
    setBusy(true); setNotice("");
    try {
      await api(`/api/messages/conversations/${activeId}`, "POST", { body });
      setDraft("");
      await refreshDetail(activeId);
      await refreshList();
    } catch (error) { setNotice(error instanceof Error ? error.message : "发送失败。"); }
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
        <div className="chat-sidebar-head"><h1>消息</h1><span>{items.reduce((sum, item) => sum + item.unreadCount, 0)} 条未读</span></div>
        <label className="chat-search"><span className="sr-only">搜索会话</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索联系人、科室或报告" /></label>
        <div className="chat-filters"><button className={!unreadOnly ? "active" : ""} onClick={() => setUnreadOnly(false)}>全部</button><button className={unreadOnly ? "active" : ""} onClick={() => setUnreadOnly(true)}>未读</button></div>
        <div className="chat-conversation-list">{visible.map(item => <button key={item.id} data-conversation-id={item.id} className={`chat-conversation ${activeId === item.id ? "selected" : ""}`} onClick={() => { if (activeId === item.id) void refreshDetail(item.id).catch(error => setNotice(error instanceof Error ? error.message : "无法读取会话。")); else setActiveId(item.id); window.history.replaceState(null, "", `?conversation=${item.id}`); }}>
          <span className="chat-avatar" aria-hidden="true">{item.peerName.slice(0, 1)}</span><span className="chat-conversation-text"><strong>{item.peerName}</strong><small>{item.peerSpecialty in specialtyLabels ? specialtyLabels[item.peerSpecialty as keyof typeof specialtyLabels] : item.peerSpecialty} · 报告 #{item.reportId}</small><span>{item.lastMessage}</span></span><span className="chat-meta"><small>{time(item.updatedAt)}</small>{item.unreadCount > 0 && <b>{item.unreadCount}</b>}</span>
        </button>)}</div>
        {visible.length === 0 && <p className="chat-empty-list">{items.length ? "没有符合筛选条件的会话。" : role === "USER" ? "还没有会话。请先到报告页授权医生并提交咨询。" : "还没有已接受的咨询。请到首页查看待咨询列表。"}</p>}
      </aside>
      <section className="chat-main" aria-label="聊天内容">
        {current ? <><div className="chat-peer-head"><span className="chat-avatar" aria-hidden="true">{current.peerName.slice(0, 1)}</span><div><h2>{current.peerName}</h2><p>{current.peerSpecialty in specialtyLabels ? specialtyLabels[current.peerSpecialty as keyof typeof specialtyLabels] : current.peerSpecialty} · 报告 #{current.reportId} · {current.peerOnline ? "页面活跃" : "当前离线"}</p></div><span className="chat-status">{current.status === "OPEN" ? "待医生接受" : "对话中"}</span></div>
          <div className="chat-safety">本页面仅用于项目流程演示，不提供正式诊断、处方或急症响应。如出现胸痛、严重呼吸困难等急症，请及时寻求线下急救。</div>
          <div className="chat-thread">{detail?.messages.map(message => <div key={message.id} className={`chat-row ${message.senderId === user?.id ? "mine" : "theirs"}`}><div className="chat-bubble">{message.body}</div><small>{time(message.createdAt)}</small></div>)}<div ref={bottom} /></div>
          <div className="chat-compose">
            <textarea aria-label="输入消息" maxLength={2000} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} disabled={!current.canSend || busy} placeholder={current.canSend ? "输入消息… Enter 发送，Shift+Enter 换行" : role === "DOCTOR" ? "请先在首页接受咨询" : "报告授权已撤销，暂不能继续发送"}/>
            <div className="chat-compose-foot"><small>异步消息 · 不保证医生即时回复</small><button disabled={busy || !current.canSend || !draft.trim()} onClick={send}>发送</button></div>
          </div></> : <div className="chat-placeholder"><span>✉</span><h2>选择一个会话</h2><p>{role === "USER" ? "到首页的报告板块可以选择医生并发起咨询。" : "用户提交咨询后，会话会出现在左侧。"}</p><Link href={dashboard}>返回首页</Link></div>}
      </section>
    </div>
    {notice && <p className="chat-toast" role="status">{notice}<button onClick={() => setNotice("")} aria-label="关闭提示">×</button></p>}
  </main>;
}
