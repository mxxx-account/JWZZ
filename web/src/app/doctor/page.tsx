"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, type Consultation, type CurrentUser, type Report } from "@/lib/api";
import { ReportContent } from "../report-content";

export default function DoctorPage() {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    api<CurrentUser>("/api/auth/me").then(async current => {
      if (current.role !== "DOCTOR") { router.replace("/patient"); return; }
      setUser(current);
      setReports(await api<Report[]>("/api/doctor/reports"));
      setConsultations(await api<Consultation[]>("/api/doctor/consultations"));
    }).catch(() => router.replace("/"));
  }, [router]);

  async function refresh() {
    try { setReports(await api<Report[]>("/api/doctor/reports")); setConsultations(await api<Consultation[]>("/api/doctor/consultations")); setMessage("已更新授权列表与咨询。"); }
    catch { setMessage("无法读取授权列表。"); }
  }

  async function mutate(run: () => Promise<unknown>, success: string) {
    setBusy(true); setMessage("");
    try { await run(); await refresh(); setMessage(success); }
    catch (error) { setMessage(error instanceof Error ? error.message : "操作失败。"); }
    finally { setBusy(false); }
  }

  return <main className="shell dashboard">
    <nav><Link href="/">见微知著</Link><span>医生演示工作台</span><button onClick={async () => { await api<void>("/api/auth/logout", "POST"); router.push("/"); }}>退出登录</button></nav>
    <p className="eyebrow">已登录：{user?.email ?? "加载中…"}</p>
    <h1>获授权的报告</h1>
    <p className="lead">此账号仅用于本地权限验收，不代表真实在线诊疗服务。</p>
    <button onClick={refresh}>刷新授权列表</button>
    {message && <p role="status" className="notice">{message}</p>}
    {reports.length === 0 && <p className="notice">目前没有用户授权的报告。</p>}
    <div className="report-list">{reports.map(report => <article key={report.id}>
      <div className="report-heading"><h2>{report.content.title ?? `报告 #${report.id}`}</h2><small>用户编号 #{report.ownerId} · {new Date(report.createdAt).toLocaleString("zh-CN")}</small></div>
      <ReportContent report={report} />
      <p className="note">这份报告会在用户撤销授权后从列表中消失。</p>
    </article>)}</div>
    <section className="workspace-panel doctor-consultations"><h2>演示咨询</h2><p className="note">仅处理仍获授权的报告。回复是流程演示，不应写诊断、处方或用药剂量。</p>
      {consultations.length === 0 && <p className="notice">目前没有可处理的咨询。</p>}
      <div className="entry-list">{consultations.map(item => <article key={item.id}>
        <h3>咨询 #{item.id} · 报告 #{item.reportId}</h3><p>用户问题：{item.question}</p><p>状态：{item.status === "OPEN" ? "待接单" : item.status === "CLAIMED" ? "已接单" : "已回复"}</p>
        {item.status === "OPEN" && <button disabled={busy} onClick={() => mutate(() => api<Consultation>(`/api/doctor/consultations/${item.id}/claim`, "POST"), "接单成功。")}>接单</button>}
        {item.status === "CLAIMED" && item.claimedDoctorId === user?.id && <div className="consultation-form"><textarea aria-label={`回复咨询 ${item.id}`} maxLength={2000} minLength={10} placeholder="输入至少 10 个字的演示回复" value={answers[item.id] ?? ""} onChange={event => setAnswers(previous => ({ ...previous, [item.id]: event.target.value }))} /><button disabled={busy || (answers[item.id]?.trim().length ?? 0) < 10} onClick={() => mutate(() => api<Consultation>(`/api/doctor/consultations/${item.id}/reply`, "POST", { answer: answers[item.id]?.trim() }), "回复已发送。")}>发送回复</button></div>}
        {item.answer && <p>演示回复：{item.answer}</p>}
      </article>)}</div>
    </section>
  </main>;
}
