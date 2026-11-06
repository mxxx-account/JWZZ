"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, type Consultation, type CurrentUser, type Report } from "@/lib/api";
import { ReportContent } from "../report-content";
import { AppNav } from "../app-nav";

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
      void api<void>("/api/doctor/presence", "POST").catch(() => undefined);
      const [reportResult, consultationResult] = await Promise.allSettled([
        api<Report[]>("/api/doctor/reports"), api<Consultation[]>("/api/doctor/consultations")
      ]);
      if (reportResult.status === "fulfilled") setReports(reportResult.value);
      else setMessage("授权报告读取失败，请点击刷新重试。");
      if (consultationResult.status === "fulfilled") setConsultations(consultationResult.value);
      else setMessage(previous => previous ? `${previous} 咨询列表读取失败。` : "咨询列表读取失败，请点击刷新重试。");
    }).catch(() => router.replace("/"));
  }, [router]);

  useEffect(() => {
    if (!user) return;
    async function sync() {
      await api<void>("/api/doctor/presence", "POST").catch(() => undefined);
      const [reportResult, consultationResult] = await Promise.allSettled([
        api<Report[]>("/api/doctor/reports"), api<Consultation[]>("/api/doctor/consultations")
      ]);
      if (reportResult.status === "fulfilled") setReports(reportResult.value);
      if (consultationResult.status === "fulfilled") setConsultations(consultationResult.value);
    }
    const timer = window.setInterval(() => { void sync(); }, 8000);
    const onFocus = () => { void sync(); };
    window.addEventListener("focus", onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [user]);

  async function refresh() {
    const [reportResult, consultationResult] = await Promise.allSettled([
      api<Report[]>("/api/doctor/reports"), api<Consultation[]>("/api/doctor/consultations")
    ]);
    if (reportResult.status === "fulfilled") setReports(reportResult.value);
    if (consultationResult.status === "fulfilled") setConsultations(consultationResult.value);
    setMessage(reportResult.status === "fulfilled" && consultationResult.status === "fulfilled"
      ? "已更新授权列表与咨询。" : "部分数据读取失败，请稍后重试。");
  }

  return <><AppNav role="DOCTOR" active="home" /><main className="shell dashboard">
    <p className="eyebrow">已登录：{user?.name || user?.email || "加载中…"} · {user?.email}</p>
    <h1>获授权的报告</h1>
    <p className="lead">当前医生账号仅用于项目演示，不代表执业资质已核验或真实在线诊疗服务。</p>
    <button onClick={refresh}>刷新授权列表</button>
    {message && <p role="status" className="notice">{message}</p>}
    {reports.length === 0 && <p className="notice">目前没有用户授权的报告。</p>}
    <div className="report-list">{reports.map(report => <article key={report.id} data-report-id={report.id}>
      <div className="report-heading"><h2>{report.content.title ?? `报告 #${report.id}`}</h2><small>用户编号 #{report.ownerId} · {new Date(report.createdAt).toLocaleString("zh-CN")}</small></div>
      <ReportContent report={report} />
      <p className="note">这份报告会在用户撤销授权后从列表中消失。</p>
    </article>)}</div>
    <section className="workspace-panel doctor-consultations"><h2>收到的咨询</h2><p className="note">点击进入消息页接单、查看完整对话及回复；撤销授权后该会话会从医生列表消失。</p>
      {consultations.length === 0 && <p className="notice">目前没有可处理的咨询。</p>}
      <div className="entry-list">{consultations.map(item => <article key={item.id}><h3>咨询 #{item.id} · 报告 #{item.reportId}</h3><p>{item.question}</p><Link href={`/doctor/messages?conversation=${item.id}`}>打开消息 →</Link></article>)}</div>
    </section>
  </main></>;
}
