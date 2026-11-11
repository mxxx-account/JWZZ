"use client";

import { useEffect, useId, useRef, useState } from "react";
import { api, type BloodPressureReading, type ReportAssistantDraft, type ReportEvidence } from "@/lib/api";
import styles from "./report-assistant.module.css";

export const CONSULTATION_QUESTION_LIMIT = 1000;
type EvidenceState = { kind: "loading" | "error" } | { kind: "ready"; evidence: ReportEvidence };
type Props = {
  reportId: number;
  canFill: boolean;
  busy: boolean;
  question: string;
  onFill: (question: string) => void;
};

const numberFormat = new Intl.NumberFormat("zh-CN", { useGrouping: false, maximumFractionDigits: 4 });
const contextLabels: Record<BloodPressureReading["context"], string> = { HOME: "居家测量", CLINIC: "诊室测量" };

function signed(value: number) {
  return (value > 0 ? "+" : "") + numberFormat.format(value);
}

function ReadingRow({ label, reading }: { label: string; reading: BloodPressureReading }) {
  return <tr>
    <th scope="row">{label}<small>{contextLabels[reading.context]} · {new Date(reading.measuredAt).toLocaleString("zh-CN")}</small></th>
    <td>{numberFormat.format(reading.systolic)}</td>
    <td>{numberFormat.format(reading.diastolic)}</td>
  </tr>;
}

function EvidenceDetails({ evidence }: { evidence: ReportEvidence }) {
  if (evidence.status === "UNSUPPORTED_CATEGORY") {
    return <p className="note">目前仅支持血压报告的对比与草稿。你仍可查看原报告、授权并手动提交咨询。</p>;
  }
  if (evidence.status === "UNSUPPORTED_SNAPSHOT" || !evidence.current) {
    return <p className="note">这份报告的快照格式或字段暂不支持解读。你仍可手动提交咨询。</p>;
  }

  return <>
    <table className={styles.evidence}>
      <caption className="sr-only">本次血压与同条件历史记录</caption>
      <thead><tr><th scope="col">测量记录</th><th scope="col">收缩压 <small>mmHg</small></th><th scope="col">舒张压 <small>mmHg</small></th></tr></thead>
      <tbody>
        <ReadingRow label="本次报告" reading={evidence.current} />
        {evidence.previous && <ReadingRow label="上次同条件记录" reading={evidence.previous} />}
        {evidence.change && <tr className={styles.change}>
          <th scope="row">变化 <small>本次减上次</small></th>
          <td>{signed(evidence.change.systolic)}</td><td>{signed(evidence.change.diastolic)}</td>
        </tr>}
      </tbody>
    </table>
    {!evidence.previous && <p className="note">没有可比较的同条件历史记录，仅展示本次报告。</p>}
    {evidence.indicators.length > 0 && <details className={styles.glossary}>
      <summary>指标说明</summary>
      <dl>{evidence.indicators.map(item => <div key={item.code}>
        <dt>{item.label}（{item.unit}）</dt><dd>{item.description}</dd>
      </div>)}</dl>
    </details>}
  </>;
}

export function ReportAssistant({ reportId, canFill, busy, question, onFill }: Props) {
  const headingId = useId();
  const draftId = useId();
  const [load, setLoad] = useState<EvidenceState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [generated, setGenerated] = useState<ReportAssistantDraft | null>(null);
  const [draft, setDraft] = useState("");
  const [generating, setGenerating] = useState(false);
  const [draftError, setDraftError] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [filled, setFilled] = useState(false);
  const draftRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    api<ReportEvidence>(`/api/reports/${reportId}/assistant/evidence`, "GET", undefined, controller.signal)
      .then(evidence => {
        if (controller.signal.aborted) return;
        setLoad(evidence.reportId === reportId ? { kind: "ready", evidence } : { kind: "error" });
      })
      .catch(() => { if (!controller.signal.aborted) setLoad({ kind: "error" }); });
    return () => controller.abort();
  }, [reportId, attempt]);

  useEffect(() => () => { draftRequest.current?.abort(); }, []);

  async function generateDraft() {
    if (draftRequest.current) return;
    const controller = new AbortController();
    draftRequest.current = controller;
    setGenerating(true);
    setDraftError(false);
    try {
      const response = await api<ReportAssistantDraft>(`/api/reports/${reportId}/assistant`, "POST",
        { action: "PREPARE_CONSULTATION" }, controller.signal);
      if (controller.signal.aborted) return;
      if (response.reportId !== reportId || response.mode !== "TEMPLATE" ||
          !Array.isArray(response.questions) || response.questions.some(question => typeof question !== "string") ||
          typeof response.draft !== "string" || !response.draft.trim() || response.draft.length > CONSULTATION_QUESTION_LIMIT) {
        throw new Error("Invalid draft");
      }
      setGenerated(response);
      setDraft(response.draft);
    } catch {
      if (!controller.signal.aborted) setDraftError(true);
    } finally {
      if (draftRequest.current === controller) draftRequest.current = null;
      if (!controller.signal.aborted) setGenerating(false);
    }
  }

  const trimmedDraft = draft.trim();
  const combinedQuestion = question.trim() ? `${question}\n\n${trimmedDraft}` : trimmedDraft;
  const appendTooLong = combinedQuestion.length > CONSULTATION_QUESTION_LIMIT;
  function fill(mode?: "append" | "replace") {
    if (!canFill || busy || !trimmedDraft) return;
    if (!mode && question.trim()) { setChoosing(true); return; }
    const next = mode === "append" ? combinedQuestion : trimmedDraft;
    if (next.length > CONSULTATION_QUESTION_LIMIT) return;
    onFill(next);
    setChoosing(false);
    setFilled(true);
  }

  const evidence = load.kind === "ready" ? load.evidence : null;
  const canGenerate = evidence?.current && (evidence.status === "AVAILABLE" || evidence.status === "NO_COMPARABLE_HISTORY");
  return <section className={styles.panel} aria-labelledby={headingId}>
    <div className={styles.heading}>
      <h3 id={headingId}>报告解读与咨询准备</h3>
      <span className={styles.badge}>本地模板 · 未调用 AI</span>
    </div>
    {load.kind === "loading" && <p role="status" className="note">正在加载报告对比…</p>}
    {load.kind === "error" && <div className={styles.actions}>
      <p role="status" className="note">暂时无法加载报告对比，不影响查看原报告或手动咨询。</p>
      <button type="button" className="secondary" onClick={() => { setLoad({ kind: "loading" }); setAttempt(value => value + 1); }}>重试加载对比</button>
    </div>}
    {evidence && <EvidenceDetails evidence={evidence} />}
    <p className={styles.notice}>{evidence?.notice ?? "仅整理记录与数值变化，不提供诊断、治疗或用药建议。"}</p>

    {canGenerate && <div className={styles.draft}>
      {!generated && <>
        <p className="note">先整理想问医生的问题。生成草稿不会授权或发送消息。</p>
        <button type="button" disabled={generating} onClick={() => void generateDraft()}>{generating ? "正在生成草稿…" : "生成咨询草稿"}</button>
        {draftError && <p role="alert" className={styles.feedback}>暂时无法生成咨询草稿，可以重试或手动填写咨询问题。</p>}
      </>}
      {generated && <>
        {generated.questions.length > 0 && <div className={styles.suggestions}>
          <strong>可以向医生提问</strong>
          <ul>{generated.questions.map((item, index) => <li key={index}>{item}</li>)}</ul>
        </div>}
        <label htmlFor={draftId}>咨询草稿</label>
        <textarea id={draftId} value={draft} rows={4} maxLength={CONSULTATION_QUESTION_LIMIT}
          onChange={event => { setDraft(event.target.value); setFilled(false); }} />
        <div className={styles.actions}>
          <button type="button" disabled={!canFill || busy || !trimmedDraft} onClick={() => fill()}>填入咨询草稿</button>
          {!canFill && <p className="note">可先编辑草稿，授权医生后即可填入。这份草稿尚未发送。</p>}
        </div>
        {choosing && canFill && <div className={styles.merge} role="group" aria-label="选择如何填入草稿">
          <p>咨询框已有内容，请选择追加、替换或取消。</p>
          <div className={styles.actions}>
            <button type="button" className="secondary" disabled={busy || !trimmedDraft || appendTooLong} onClick={() => fill("append")}>追加到咨询问题</button>
            <button type="button" className="secondary" disabled={busy || !trimmedDraft} onClick={() => fill("replace")}>替换咨询问题</button>
            <button type="button" className="secondary" onClick={() => setChoosing(false)}>取消</button>
          </div>
          {appendTooLong && <p className="note">追加将超过 {CONSULTATION_QUESTION_LIMIT} 字，请先缩短内容或选择替换。</p>}
        </div>}
        {filled && <p role="status" className={styles.feedback}>已填入咨询问题，尚未发送。</p>}
      </>}
    </div>}
  </section>;
}
