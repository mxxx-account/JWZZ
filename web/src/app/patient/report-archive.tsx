"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, type Consultation, type Doctor, type Grant, type Report } from "@/lib/api";
import { DoctorChooser } from "./doctor-chooser";
import { ReportContent } from "../report-content";
import { CONSULTATION_QUESTION_LIMIT, ReportAssistant } from "./report-assistant";
import { ReportKnowledge } from "./report-knowledge";

type Summary = { id: number; title: string | null; category: string | null; createdAt: string };
type Page = { items: Summary[]; total: number; page: number; size: number };
type Filters = { reportId: string; category: string; from: string; to: string; sort: "NEWEST" | "OLDEST" };
const initialFilters: Filters = { reportId: "", category: "", from: "", to: "", sort: "NEWEST" };
const categoryLabels: Record<string, string> = { BP: "血压", GLUCOSE: "血糖", LIPID: "血脂" };

export function ReportArchive({ refreshKey, focusId }: { refreshKey: number; focusId: number | null }) {
  const router = useRouter();
  const [draftFilters, setDraftFilters] = useState<Filters>({ ...initialFilters, reportId: focusId ? String(focusId) : "" });
  const [filters, setFilters] = useState<Filters>({ ...initialFilters, reportId: focusId ? String(focusId) : "" });
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<Page | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loadedReport, setReport] = useState<Report | null>(null);
  const [contextReports, setContextReports] = useState<Report[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [selectedDoctorId, setSelectedDoctorId] = useState<number | null>(null);
  const [question, setQuestion] = useState("");
  const [message, setMessage] = useState("");
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const activeDetail = useRef<symbol | null>(null);
  const report = loadedReport?.id === selectedId ? loadedReport : null;

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ page: String(page), size: "12", sort: filters.sort });
    if (filters.category) params.set("category", filters.category);
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    if (filters.reportId) params.set("reportId", filters.reportId);
    setLoadingList(true); setMessage("");
    api<Page>(`/api/reports/archive?${params}`).then(next => {
      if (cancelled) return;
      setResult(next);
      setSelectedId(previous => next.items.some(item => item.id === previous) ? previous : next.items[0]?.id ?? null);
    }).catch(error => { if (!cancelled) setMessage(error instanceof Error ? error.message : "无法加载报告列表。"); })
      .finally(() => { if (!cancelled) setLoadingList(false); });
    return () => { cancelled = true; };
  }, [filters, page, refreshKey, reload]);

  useEffect(() => {
    setReport(null); setGrants([]); setQuestion(""); setSelectedDoctorId(null); setBusy(false);
    setLoadingDetail(selectedId !== null);
    if (selectedId === null) return;
    const detail = Symbol();
    activeDetail.current = detail;
    Promise.allSettled([
      api<Report>(`/api/reports/${selectedId}`),
      api<Grant[]>(`/api/reports/${selectedId}/grants`),
      api<Doctor[]>("/api/doctors"),
      api<Report[]>("/api/reports/context"),
      api<Consultation[]>("/api/consultations"),
    ]).then(([nextReport, nextGrants, nextDoctors, nextContext, nextConsultations]) => {
      if (activeDetail.current !== detail) return;
      if (nextReport.status === "rejected") throw nextReport.reason;
      if (nextGrants.status === "rejected") throw nextGrants.reason;
      setReport(nextReport.value); setGrants(nextGrants.value);
      setDoctors(nextDoctors.status === "fulfilled" ? nextDoctors.value : []);
      setContextReports(nextContext.status === "fulfilled" ? nextContext.value : []);
      setConsultations(nextConsultations.status === "fulfilled" ? nextConsultations.value : []);
    }).catch(error => { if (activeDetail.current === detail) setMessage(error instanceof Error ? error.message : "无法加载报告详情。"); })
      .finally(() => { if (activeDetail.current === detail) setLoadingDetail(false); });
    return () => { activeDetail.current = null; };
  }, [selectedId]);

  useEffect(() => {
    const timer = window.setInterval(() => api<Doctor[]>("/api/doctors").then(setDoctors).catch(() => undefined), 30000);
    return () => window.clearInterval(timer);
  }, []);

  function search(event: FormEvent) {
    event.preventDefault();
    if (draftFilters.from && draftFilters.to && draftFilters.from > draftFilters.to) {
      setMessage("起始日期不能晚于结束日期。"); return;
    }
    setPage(0); setFilters({ ...draftFilters, reportId: draftFilters.reportId.trim() });
  }

  function clearFilters() {
    setDraftFilters(initialFilters); setFilters(initialFilters); setPage(0);
  }

  async function action<T>(run: () => Promise<T>, success: string, after?: (result: T) => void) {
    const detail = activeDetail.current;
    if (!detail || !report || busy) return;
    setBusy(true); setMessage("");
    try {
      const result = await run();
      if (activeDetail.current !== detail) return;
      const nextGrants = await api<Grant[]>(`/api/reports/${report.id}/grants`);
      if (activeDetail.current !== detail) return;
      setGrants(nextGrants);
      after?.(result);
      setMessage(success);
    } catch (error) {
      if (activeDetail.current === detail) setMessage(error instanceof Error ? error.message : "操作失败。");
    } finally {
      if (activeDetail.current === detail) setBusy(false);
    }
  }

  async function askDoctor() {
    const detail = activeDetail.current;
    if (!detail || !report || busy) return;
    const doctorId = selectedDoctorId ?? grants[0]?.doctorId;
    if (!doctorId || !grants.some(grant => grant.doctorId === doctorId)) {
      setMessage("请先选择并授权要咨询的医生。"); return;
    }
    setBusy(true); setMessage("");
    try {
      const created = await api<Consultation>("/api/consultations", "POST", { reportId: report.id, doctorId, question: question.trim() });
      if (activeDetail.current === detail) router.push(`/patient/messages?conversation=${created.id}`);
    } catch (error) {
      if (activeDetail.current === detail) setMessage(error instanceof Error ? error.message : "咨询提交失败。");
    } finally {
      if (activeDetail.current === detail) setBusy(false);
    }
  }

  const totalPages = Math.ceil((result?.total ?? 0) / (result?.size ?? 12));
  return <section className="archive-workspace" aria-label="我的报告与授权">
    <div className="archive-heading"><div><h2>我的报告与授权</h2><p>按条件查找历史报告，选择一份后查看完整内容、授权医生和提交咨询。</p></div><button type="button" onClick={() => setReload(value => value + 1)}>刷新报告</button></div>
    <form className="archive-filters" onSubmit={search}>
      <label>报告编号<input type="number" min="1" placeholder="精确查找，例如 18" value={draftFilters.reportId} onChange={event => setDraftFilters(previous => ({ ...previous, reportId: event.target.value }))} /></label>
      <label>指标类别<select value={draftFilters.category} onChange={event => setDraftFilters(previous => ({ ...previous, category: event.target.value }))}><option value="">全部</option><option value="BP">血压</option><option value="GLUCOSE">血糖</option><option value="LIPID">血脂</option></select></label>
      <label>开始日期<input type="date" value={draftFilters.from} onChange={event => setDraftFilters(previous => ({ ...previous, from: event.target.value }))} /></label>
      <label>结束日期<input type="date" value={draftFilters.to} onChange={event => setDraftFilters(previous => ({ ...previous, to: event.target.value }))} /></label>
      <label>排序<select value={draftFilters.sort} onChange={event => setDraftFilters(previous => ({ ...previous, sort: event.target.value as Filters["sort"] }))}><option value="NEWEST">最新优先</option><option value="OLDEST">最早优先</option></select></label>
      <div className="archive-filter-actions"><button type="submit">查找报告</button><button type="button" className="archive-clear" onClick={clearFilters}>清空筛选</button></div>
    </form>
    {message && <p role="status" className="notice">{message}</p>}
    <div className="archive-split">
      <div className="archive-list" aria-label="报告列表">
        <div className="archive-list-head">{loadingList ? "正在查找…" : `找到 ${result?.total ?? 0} 份报告`}</div>
        {!loadingList && result?.items.length === 0 && <p className="archive-empty">没有符合条件的报告。可清空筛选后重试。</p>}
        {result?.items.map(item => <button type="button" key={item.id} className={`archive-row ${selectedId === item.id ? "selected" : ""}`} aria-current={selectedId === item.id ? "true" : undefined} onClick={() => setSelectedId(item.id)}>
          <strong>{categoryLabels[item.category ?? ""] ?? item.title ?? "指标"}报告 #{item.id}</strong><span>{item.title ?? "指标记录快照"}</span><small>{new Date(item.createdAt).toLocaleString("zh-CN")}</small>
        </button>)}
        {totalPages > 1 && <nav className="archive-pagination" aria-label="报告分页"><button type="button" disabled={page === 0 || loadingList} onClick={() => setPage(value => value - 1)}>上一页</button><span>第 {page + 1} / {totalPages} 页</span><button type="button" disabled={page + 1 >= totalPages || loadingList} onClick={() => setPage(value => value + 1)}>下一页</button></nav>}
      </div>
      <div className="archive-detail" aria-label="报告详情">
        {loadingDetail && <p className="notice">正在加载报告详情…</p>}
        {!loadingDetail && !report && <p className="notice">选择左侧报告查看详情。</p>}
        {report && <>
          <div className="report-heading"><h2>{report.content.title ?? `报告 #${report.id}`}</h2><small>#{report.id} · {new Date(report.createdAt).toLocaleString("zh-CN")}</small></div>
          <ReportContent report={report} />
          {report.content.category === "BP" && <ReportKnowledge key={`knowledge-${report.id}`} reportId={report.id} />}
          <ReportAssistant key={`assistant-${report.id}`} reportId={report.id} canFill={grants.length > 0} busy={busy} question={question} onFill={setQuestion} />
          <p className="note">当前授权：{grants.length ? grants.map(grant => doctors.find(doctor => doctor.id === grant.doctorId)?.displayName ?? grant.doctorEmail).join("、") : "无"}</p>
          <DoctorChooser report={report} allReports={contextReports.length ? contextReports : [report]} doctors={doctors} grants={grants} selectedId={selectedDoctorId} busy={busy} onSelect={setSelectedDoctorId} onGrant={doctor => action(() => api<Grant>(`/api/reports/${report.id}/grants`, "POST", { doctorEmail: doctor.email }), "授权成功，可以向这位医生提交咨询。")}
            onGrantEmail={email => action(() => api<Grant>(`/api/reports/${report.id}/grants`, "POST", { doctorEmail: email }), "授权成功，可以向这位医生提交咨询。", granted => setSelectedDoctorId(granted.doctorId))} />
          {grants.map(grant => <button className="secondary" key={grant.doctorId} disabled={busy} onClick={() => action(() => api<void>(`/api/reports/${report.id}/grants/${grant.doctorId}`, "DELETE"), "撤销成功。")}>撤销 {grant.doctorEmail} 的权限</button>)}
          <div className="consultation-area"><h3>向医生发起消息</h3><p className="note">仅演示异步消息，不是实时问诊。留空将发送默认问候语；如有急症不适，请及时线下就医。</p>
            {grants.length ? <div className="consultation-form"><textarea aria-label="咨询问题" maxLength={CONSULTATION_QUESTION_LIMIT} value={question} onChange={event => setQuestion(event.target.value)} placeholder="可填写想咨询的问题；留空则发送默认问候语" /><button disabled={busy} onClick={askDoctor}>提交咨询并打开消息</button></div>
              : <p className="note">先授权医生查看这份报告，才能提交咨询请求。</p>}
            {consultations.filter(item => item.reportId === report.id).map(item => <div className="consultation-item" key={item.id}><Link href={`/patient/messages?conversation=${item.id}`}>咨询 #{item.id} · {item.status === "OPEN" ? "待医生接受" : item.status === "CLAIMED" ? "医生已接受" : "查看消息"}</Link></div>)}
          </div>
        </>}
      </div>
    </div>
  </section>;
}
