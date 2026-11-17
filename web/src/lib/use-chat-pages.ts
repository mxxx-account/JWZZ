"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";

type Peer = { id: number; unreadCount: number };
type Message = { id: number; senderId: number; body: string; createdAt: string };
type Detail<C, M> = { conversation: C; messages: M[]; hasMore: boolean };
type Page<C> = { items: C[]; hasMore: boolean };
const merge = <T extends { id: number }>(a: T[], b: T[]) =>
  [...new Map([...a, ...b].map(item => [item.id, item])).values()].sort((x, y) => x.id - y.id);

// Sharing transport/scroll behavior does not share either domain's authorization or data.
export function useChatPages<C extends Peer, M extends Message>(endpoint: string, enabled: boolean,
  heartbeat?: () => Promise<void>) {
  const [items, setItems] = useState<C[]>([]);
  const [activeId, setActiveIdState] = useState<number | null>(null);
  const [detail, setDetail] = useState<Detail<C, M> | null>(null);
  const [notice, setNotice] = useState("");
  const [moreConversations, setMoreConversations] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const thread = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<C[]>([]);
  const detailRef = useRef<Detail<C, M> | null>(null);
  const active = useRef<number | null>(null);
  const generation = useRef(0);
  const pages = useRef(1);
  const listRun = useRef(0);
  const listBusy = useRef(false);
  const requestBusy = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const ack = useRef(0);
  const ackBusy = useRef(false);
  const adjustment = useRef<{ bottom?: boolean; height?: number; top?: number } | null>(null);

  const refreshList = useCallback(async (more = false) => {
    if (listBusy.current) return itemsRef.current;
    listBusy.current = true;
    setLoadingList(true);
    const run = ++listRun.current;
    const wanted = pages.current + (more ? 1 : 0);
    try {
      let cursor: number | undefined;
      let collected: C[] = [];
      let hasMore = false;
      for (let page = 0; page < wanted; page++) {
        const result = await api<Page<C>>(`${endpoint}/page?size=20${cursor ? `&beforeId=${cursor}` : ""}`);
        if (run !== listRun.current) return itemsRef.current;
        collected = [...collected, ...result.items];
        hasMore = result.hasMore;
        cursor = result.items.at(-1)?.id;
        if (!hasMore || !cursor) break;
      }
      pages.current = wanted;
      itemsRef.current = collected;
      setItems(collected);
      setMoreConversations(hasMore);
      return collected;
    } finally {
      if (run === listRun.current) { listBusy.current = false; setLoadingList(false); }
    }
  }, [endpoint]);

  const markVisible = useCallback(async () => {
    const element = thread.current, current = detailRef.current, id = active.current;
    if (!element || !current || id !== current.conversation.id || document.visibilityState !== "visible" || ackBusy.current) return;
    const box = element.getBoundingClientRect();
    // Only acknowledge rows actually intersecting the visible thread, never MAX(id) at the server.
    const visible = [...element.querySelectorAll<HTMLElement>("[data-message-id]")].filter(row => {
      const rect = row.getBoundingClientRect();
      return rect.top < box.bottom && rect.bottom > box.top;
    }).map(row => Number(row.dataset.messageId));
    const seen = Math.max(0, ...visible);
    if (seen <= ack.current) return;
    const epoch = generation.current;
    ackBusy.current = true;
    try {
      await api<void>(`${endpoint}/${id}/read`, "POST", { lastReadMessageId: seen }, abort.current?.signal);
      if (epoch !== generation.current) return;
      ack.current = Math.max(ack.current, seen);
      await refreshList();
    } catch { /* Retry on the next scroll/poll/visibility event without inventing a read receipt. */ }
    finally { if (epoch === generation.current) ackBusy.current = false; }
  }, [endpoint, refreshList]);

  const fetchMessages = useCallback(async (older = false) => {
    const id = active.current, epoch = generation.current;
    if (id === null || requestBusy.current) return;
    const previous = detailRef.current;
    if (older && (!previous?.hasMore || !previous.messages.length)) return;
    requestBusy.current = true;
    if (older) setLoadingHistory(true);
    try {
      let batches = 0;
      let more = false;
      do {
        const current = detailRef.current;
        const cursor = older ? current?.messages[0]?.id : current?.messages.at(-1)?.id;
        const query = cursor ? `&${older ? "beforeId" : "afterId"}=${cursor}` : "";
        const result = await api<Detail<C, M>>(`${endpoint}/${id}?size=50${query}`, "GET", undefined, abort.current?.signal);
        if (epoch !== generation.current) return;
        const element = thread.current;
        const atBottom = !element || element.scrollHeight - element.scrollTop - element.clientHeight < 60;
        adjustment.current = older && element ? { height: element.scrollHeight, top: element.scrollTop }
          : { bottom: !current || atBottom };
        const next = {
          conversation: result.conversation,
          messages: merge(current?.messages ?? [], result.messages),
          hasMore: older || !current ? result.hasMore : current.hasMore,
        };
        detailRef.current = next;
        setDetail(next);
        more = !older && Boolean(cursor) && result.hasMore && result.messages.length > 0;
        // Bounded catch-up per tick. The next tick resumes at the last *received* ID.
      } while (more && ++batches < 10 && epoch === generation.current);
      setNotice(value => ["连接暂不可用，稍后自动重试。", "消息暂未同步，已保留记录；恢复网络后会自动重试。"].includes(value) ? "" : value);
    } catch (error) {
      if (epoch !== generation.current || (error instanceof Error && error.name === "AbortError")) return;
      if (error instanceof ApiError && [403, 404].includes(error.status)) {
        detailRef.current = null; setDetail(null);
        itemsRef.current = itemsRef.current.filter(item => item.id !== id);
        setItems(itemsRef.current);
        setNotice("此会话已不可访问，请检查授权或返回首页。");
      } else setNotice("消息暂未同步，已保留记录；恢复网络后会自动重试。");
    } finally {
      if (epoch === generation.current) { requestBusy.current = false; setLoadingHistory(false); }
    }
  }, [endpoint]);

  const setActiveId = useCallback((id: number | null) => {
    if (id === active.current) { void fetchMessages(); void markVisible(); return; }
    abort.current?.abort();
    abort.current = new AbortController();
    generation.current++;
    active.current = id;
    ack.current = 0; ackBusy.current = false; requestBusy.current = false;
    detailRef.current = null; adjustment.current = null;
    setDetail(null); setLoadingHistory(false); setActiveIdState(id);
  }, [fetchMessages, markVisible]);

  useEffect(() => { if (enabled && activeId !== null) void fetchMessages(); }, [enabled, activeId, fetchMessages]);
  useLayoutEffect(() => {
    const element = thread.current, change = adjustment.current;
    if (element && change) {
      if (change.bottom) element.scrollTop = element.scrollHeight;
      else if (change.height !== undefined) element.scrollTop = (change.top ?? 0) + element.scrollHeight - change.height;
    }
    adjustment.current = null;
    void markVisible();
  }, [detail, markVisible]);

  useEffect(() => {
    if (!enabled) return;
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        if (heartbeat) await heartbeat();
        await refreshList();
        await fetchMessages();
        await markVisible();
      } catch { setNotice("连接暂不可用，稍后自动重试。"); }
      finally { running = false; }
    };
    const timer = window.setInterval(() => void tick(), 8000);
    const resume = () => { if (document.visibilityState === "visible") void tick(); };
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [enabled, heartbeat, fetchMessages, refreshList, markVisible]);

  useEffect(() => () => {
    generation.current++; listRun.current++; listBusy.current = false;
    abort.current?.abort();
  }, []);

  const onScroll = () => {
    void markVisible();
    if (thread.current && thread.current.scrollTop < 32) void fetchMessages(true);
  };
  const refreshDetail = async (id: number) => { if (active.current === id) await fetchMessages(); };
  const loadMore = () => void refreshList(true).catch(() => setNotice("会话加载失败，请重试。"));
  const latest = () => { if (thread.current) thread.current.scrollTop = thread.current.scrollHeight; void markVisible(); };
  return { items, activeId, setActiveId, detail, notice, setNotice, thread, refreshList, refreshDetail,
    moreConversations, loadingList, loadMore, loadingHistory, loadOlder: () => void fetchMessages(true), onScroll, latest };
}
