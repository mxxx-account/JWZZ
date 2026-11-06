"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, type Consultation, type CurrentUser, type Doctor, type Grant, type Report } from "@/lib/api";
import { IndicatorPanel } from "./indicator-panel";
import { EntryHistory } from "./entry-history";
import { TrendPanel } from "./trend-panel";
import { ReportContent } from "../report-content";
import { DoctorChooser } from "./doctor-chooser";
import { AppNav } from "../app-nav";

export default function PatientPage() {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [grants, setGrants] = useState<Record<number, Grant[]>>({});
  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [selectedDoctors, setSelectedDoctors] = useState<Record<number, number>>({});
  const [questions, setQuestions] = useState<Record<number, string>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [indicatorRefreshKey, setIndicatorRefreshKey] = useState(0);

  async function refresh() {
    const nextReports = await api<Report[]>("/api/reports");
    setReports(nextReports);
    const pairs = await Promise.all(nextReports.map(async report => [report.id, await api<Grant[]>(`/api/reports/${report.id}/grants`)] as const));
    setGrants(Object.fromEntries(pairs));
    try { setDoctors(await api<Doctor[]>("/api/doctors")); }
    catch { /* Existing reports remain usable if the directory is unavailable. */ }
    try { setConsultations(await api<Consultation[]>("/api/consultations")); }
    catch { /* Report and grant state must still refresh if consultations are temporarily unavailable. */ }
  }

  useEffect(() => {
    api<CurrentUser>("/api/auth/me").then(async current => {
      if (current.role !== "USER") { router.replace("/doctor"); return; }
      setUser(current);
      await refresh();
    }).catch(() => router.replace("/"));
  }, [router]);

  useEffect(() => {
    const timer = window.setInterval(() => api<Doctor[]>("/api/doctors").then(setDoctors).catch(() => undefined), 30000);
    return () => window.clearInterval(timer);
  }, []);

  async function action(run: () => Promise<unknown>, successMessage = "操作成功。") {
    setBusy(true); setMessage("");
    try { await run(); await refresh(); setMessage(successMessage); }
    catch (error) { setMessage(error instanceof Error ? error.message : "操作失败。"); }
    finally { setBusy(false); }
  }

  async function askDoctor(reportId: number) {
    const doctorId = selectedDoctors[reportId] ?? grants[reportId]?.[0]?.doctorId;
    if (!doctorId || !grants[reportId]?.some(grant => grant.doctorId === doctorId)) {
      setMessage("请先选择并授权要咨询的医生。"); return;
    }
    setBusy(true); setMessage("");
    try {
      const created = await api<Consultation>("/api/consultations", "POST", { reportId, doctorId, question: questions[reportId]?.trim() ?? "" });
      router.push(`/patient/messages?conversation=${created.id}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "咨询提交失败。"); }
    finally { setBusy(false); }
  }

  return <><AppNav role="USER" active="home" /><main className="shell dashboard">
    <p className="eyebrow">已登录：{user?.name || user?.email || "加载中…"} · {user?.email}</p>
    <h1>指标与报告首页</h1>
    <IndicatorPanel onSaved={() => setIndicatorRefreshKey(value => value + 1)} />
    <EntryHistory refreshKey={indicatorRefreshKey} onGenerated={refresh} />
    <TrendPanel refreshKey={indicatorRefreshKey} />
    <section className="workspace-panel report-section" aria-labelledby="report-section-title">
      <h2 id="report-section-title">我的报告与授权</h2>
      <p className="note">报告固定生成时的指标和规则版本。只有你明确授权后，对应医生账号才能查看。</p>
      {message && <p role="status" className="notice">{message}</p>}
      {reports.length === 0 && <p className="notice">还没有报告。请先录入指标，再在“最近录入”中生成报告。</p>}
      <div className="report-list">{reports.map(report => <article key={report.id}>
      <div className="report-heading"><h2>{report.content.title ?? `报告 #${report.id}`}</h2><small>#{report.id} · {new Date(report.createdAt).toLocaleString("zh-CN")}</small></div>
      <ReportContent report={report} />
      <p className="note">当前授权：{grants[report.id]?.length ? grants[report.id].map(grant => doctors.find(doctor => doctor.id === grant.doctorId)?.displayName ?? grant.doctorEmail).join("、") : "无"}</p>
      <DoctorChooser report={report} allReports={reports} doctors={doctors} grants={grants[report.id] ?? []} selectedId={selectedDoctors[report.id] ?? null} busy={busy} onSelect={doctorId => setSelectedDoctors(previous => ({...previous, [report.id]: doctorId}))} onGrant={doctor => action(() => api<Grant>(`/api/reports/${report.id}/grants`, "POST", {doctorEmail: doctor.email}), "授权成功，可以向这位医生提交咨询。")} onGrantEmail={email => action(async () => { const granted = await api<Grant>(`/api/reports/${report.id}/grants`, "POST", {doctorEmail: email}); setSelectedDoctors(previous => ({ ...previous, [report.id]: granted.doctorId })); }, "授权成功，可以向这位医生提交咨询。")} />
      {grants[report.id]?.map(grant => <button className="secondary" key={grant.doctorId} disabled={busy} onClick={() => action(() => api<void>(`/api/reports/${report.id}/grants/${grant.doctorId}`, "DELETE"), "撤销成功。")}>撤销 {grant.doctorEmail} 的权限</button>)}
      <div className="consultation-area">
        <h3>向医生发起消息</h3><p className="note">仅演示异步消息，不是实时问诊。未填写时将发送“您好，请帮我看看我的指标报告！”。如有胸痛、胸闷等急症不适，请及时线下就医，不要等待聊天回复。</p>
        {Boolean(grants[report.id]?.length) && <div className="consultation-form"><textarea aria-label={`关于报告 ${report.id} 的问题`} maxLength={1000} placeholder="可填写想咨询的问题；留空则发送默认问候语" value={questions[report.id] ?? ""} onChange={event => setQuestions(previous => ({ ...previous, [report.id]: event.target.value }))} /><button disabled={busy} onClick={() => askDoctor(report.id)}>提交咨询并打开消息</button></div>}
        {!grants[report.id]?.length && <p className="note">先授权医生查看这份报告，才能提交咨询请求。</p>}
        {consultations.filter(item => item.reportId === report.id).map(item => <div className="consultation-item" key={item.id}><Link href={`/patient/messages?conversation=${item.id}`}>咨询 #{item.id} · {item.status === "OPEN" ? "待医生接受" : item.status === "CLAIMED" ? "医生已接受" : "查看消息"}</Link></div>)}
      </div>
      </article>)}</div>
    </section>
  </main></>;
}
