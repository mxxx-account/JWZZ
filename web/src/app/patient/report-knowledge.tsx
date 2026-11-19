"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/api";
import styles from "./report-assistant.module.css";

type Topic = { id: string; question: string };
type Passage = { text: string; publisher: string; title: string; section: string; url: string };
type Answer = { corpusVersion: string; notice: string } & (
  { status: "ANSWERED"; topic: Topic; passages: Passage[] } |
  { status: "INSUFFICIENT_EVIDENCE"; topic: null; passages: [] }
);

export function ReportKnowledge({ reportId }: { reportId: number }) {
  const titleId = useId(), questionId = useId();
  const [question, setQuestion] = useState("");
  const [topics, setTopics] = useState<Topic[]>([]);
  const [topicError, setTopicError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  const endpoint = `/api/reports/${reportId}/assistant/knowledge`;

  useEffect(() => {
    const controller = new AbortController();
    api<Topic[]>(endpoint, "GET", undefined, controller.signal)
      .then(next => { if (!controller.signal.aborted) { setTopics(next); setTopicError(false); } })
      .catch(() => { if (!controller.signal.aborted) setTopicError(true); });
    return () => controller.abort();
  }, [endpoint, attempt]);
  useEffect(() => () => request.current?.abort(), []);

  async function ask(event: FormEvent) {
    event.preventDefault();
    if (request.current || !question.trim()) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true); setAnswer(null); setError("");
    try {
      const result = await api<Answer>(endpoint, "POST", { question: question.trim() }, controller.signal);
      if (!controller.signal.aborted) setAnswer(result);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof ApiError && cause.status === 401
        ? "登录已过期，请重新登录。" : "暂时无法查询资料，请稍后重试。不影响手动咨询。");
    } finally {
      if (request.current === controller) request.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  function edit(value: string) { setQuestion(value); setAnswer(null); setError(""); }
  return <section className={styles.panel} aria-labelledby={titleId}>
    <div className={styles.heading}>
      <h3 id={titleId}>带来源的知识解释</h3><span className={styles.badge}>本地资料检索 · 不调用 AI</span>
    </div>
    <p className="note">目前覆盖血压测量条件、记录比较和咨询准备。支持部分已收录的问法；请勿输入个人信息、实际测量值或症状。</p>
    <div className={styles.actions} aria-label="常见问题">
      {topics.map(topic => <button key={topic.id} type="button" className="secondary" disabled={busy}
        onClick={() => edit(topic.question)}>{topic.question}</button>)}
      {topicError && <button type="button" className="secondary" onClick={() => setAttempt(value => value + 1)}>重试加载常见问题</button>}
    </div>
    <form className={styles.knowledgeForm} onSubmit={ask}>
      <label htmlFor={questionId}>输入知识问题</label>
      <textarea id={questionId} rows={2} maxLength={200} required disabled={busy} value={question}
        onChange={event => edit(event.target.value)} />
      <button type="submit" disabled={busy || !question.trim()}>{busy ? "查找资料中…" : "查找资料并解释"}</button>
    </form>
    {error && <p role="alert" className={styles.feedback}>{error}</p>}
    {answer && <div className={styles.knowledgeAnswer} aria-live="polite">
      {answer.status === "ANSWERED" && <>
        <h4>{answer.topic.question}</h4>
        {answer.passages.map((passage, index) => <article key={index}>
          <p>{passage.text} [{index + 1}]</p>
          <a href={passage.url} target="_blank" rel="noopener noreferrer">[{index + 1}] {passage.publisher} · {passage.title}</a>
          <small>原文章节：{passage.section}；以上为中文转述</small>
        </article>)}
      </>}
      <p className={styles.notice}>{answer.notice}</p>
      <small>资料库版本：{answer.corpusVersion}</small>
    </div>}
  </section>;
}
