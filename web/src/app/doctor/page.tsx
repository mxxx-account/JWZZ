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
  const [message, setMessage] = useState("");

  useEffect(() => {
    api<CurrentUser>("/api/auth/me").then(async current => {
      if (current.role !== "DOCTOR") { router.replace("/patient"); return; }
      setUser(current);
      await api<void>("/api/doctor/presence", "POST");
      setReports(await api<Report[]>("/api/doctor/reports"));
      setConsultations(await api<Consultation[]>("/api/doctor/consultations"));
    }).catch(() => router.replace("/"));
  }, [router]);

  useEffect(() => {
    const timer = window.setInterval(() => api<void>("/api/doctor/presence", "POST").catch(() => undefined), 30000);
    return () => window.clearInterval(timer);
  }, []);

  async function refresh() {
    try { setReports(await api<Report[]>("/api/doctor/reports")); setConsultations(await api<Consultation[]>("/api/doctor/consultations")); setMessage("已更新授权列表与咨询。"); }
    catch { setMessage("无法读取授权列表。"); }
  }

  return <main className="shell dashboard">
    <nav><Link href="/">见微知著</Link><span>医生演示工作台</span><Link href="/doctor/messages">消息</Link><button onClick={async () => { await api<void>("/api/auth/logout", "POST"); router.push("/"); }}>退出登录</button></nav>
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
    <section className="workspace-panel doctor-consultations"><h2>收到的咨询</h2><p className="note">点击进入消息页接单、查看完整对话及回复；撤销授权后该会话会从医生列表消失。</p>
      {consultations.length === 0 && <p className="notice">目前没有可处理的咨询。</p>}
      <div className="entry-list">{consultations.map(item => <article key={item.id}><h3>咨询 #{item.id} · 报告 #{item.reportId}</h3><p>{item.question}</p><Link href={`/doctor/messages?conversation=${item.id}`}>打开消息 →</Link></article>)}</div>
    </section>
  </main>;
}
