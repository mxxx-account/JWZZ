"use client";

import { useEffect, useState } from "react";
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
  const [acceptingId, setAcceptingId] = useState<number | null>(null);

  useEffect(() => {
    api<CurrentUser>("/api/auth/me").then(async current => {
      if (current.role !== "DOCTOR") { router.replace("/patient"); return; }
      setUser(current);
      void api<void>("/api/doctor/presence", "POST").catch(() => undefined);
      const [reportResult, consultationResult] = await Promise.allSettled([
        api<Report[]>("/api/doctor/reports"), api<Consultation[]>("/api/doctor/consultations")
      ]);
      if (reportResult.status === "fulfilled") setReports(reportResult.value);
      else setMessage("待咨询报告读取失败，请点击刷新重试。");
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
      ? "待咨询列表已更新。" : "部分待咨询数据读取失败，请稍后重试。");
  }

  async function accept(id: number) {
    setAcceptingId(id); setMessage("");
    try {
      await api(`/api/doctor/consultations/${id}/claim`, "POST");
      setConsultations(previous => previous.filter(item => item.id !== id));
      router.push(`/doctor/messages?conversation=${id}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "接受咨询失败，请刷新后重试。");
      await refresh();
    } finally { setAcceptingId(null); }
  }

  const pending = consultations.filter(item => item.status === "OPEN");
  const reportById = new Map(reports.map(report => [report.id, report]));

  return <><AppNav role="DOCTOR" active="home" /><main className="shell dashboard">
    <p className="eyebrow">已登录：{user?.name || user?.email || "加载中…"} · {user?.email}</p>
    <h1>待咨询的报告</h1>
    <p className="lead">当前医生账号仅用于项目演示，不代表执业资质已核验或真实在线诊疗服务。</p>
    <button onClick={refresh}>刷新待咨询列表</button>
    {message && <p role="status" className="notice">{message}</p>}
    <p className="note">用户授权并提交咨询后，报告与附带消息会出现在这里。接受后进入消息页继续交流；仅授权、尚未提交咨询的报告不会列入待咨询。</p>
    {pending.length === 0 && <p className="notice">目前没有待接受的咨询。</p>}
    <div className="report-list">{pending.map(item => {
      const report = reportById.get(item.reportId);
      return <article key={item.id} data-consultation-id={item.id} data-report-id={item.reportId}>
        <div className="report-heading"><h2>{report?.content.title ?? `报告 #${item.reportId}`}</h2><small>咨询 #{item.id} · 用户编号 #{item.userId}</small></div>
        {report ? <ReportContent report={report} /> : <p className="notice">报告内容暂未加载，请刷新待咨询列表。</p>}
        <div className="doctor-request"><strong>用户附带的消息</strong><p>{item.question}</p></div>
        <button disabled={acceptingId !== null || !report} onClick={() => accept(item.id)}>{acceptingId === item.id ? "正在接受…" : "接受咨询并进入消息"}</button>
      </article>;
    })}</div>
  </main></>;
}
