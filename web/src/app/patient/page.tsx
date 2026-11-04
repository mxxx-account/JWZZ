"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, type CurrentUser, type Grant, type Report } from "@/lib/api";

export default function PatientPage() {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [grants, setGrants] = useState<Record<number, Grant[]>>({});
  const [doctorEmail, setDoctorEmail] = useState("doctor@jwzz.local");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const nextReports = await api<Report[]>("/api/reports");
    setReports(nextReports);
    const pairs = await Promise.all(nextReports.map(async report => [report.id, await api<Grant[]>(`/api/reports/${report.id}/grants`)] as const));
    setGrants(Object.fromEntries(pairs));
  }

  useEffect(() => {
    api<CurrentUser>("/api/auth/me").then(async current => {
      if (current.role !== "USER") { router.replace("/doctor"); return; }
      setUser(current);
      await refresh();
    }).catch(() => router.replace("/"));
  }, [router]);

  async function action(run: () => Promise<unknown>) {
    setBusy(true); setMessage("");
    try { await run(); await refresh(); setMessage("操作成功。") }
    catch (error) { setMessage(error instanceof Error ? error.message : "操作失败。"); }
    finally { setBusy(false); }
  }

  return <main className="shell dashboard">
    <nav><Link href="/">见微知著</Link><span>用户工作台</span><button onClick={async () => { await api<void>("/api/auth/logout", "POST"); router.push("/"); }}>退出登录</button></nav>
    <p className="eyebrow">已登录：{user?.email ?? "加载中…"}</p>
    <h1>我的报告与授权</h1>
    <p className="lead">这一阶段用虚构报告验收谁能查看数据。实际体检报告将在后续阶段实现。</p>
    <button disabled={busy} onClick={() => action(() => api<{id:number}>("/api/dev/reports", "POST"))}>创建一份虚构演示报告</button>
    {message && <p role="status" className="notice">{message}</p>}
    {reports.length === 0 && <p className="notice">还没有报告。点击上方按钮创建演示报告。</p>}
    <div className="report-list">{reports.map(report => <article key={report.id}>
      <div className="report-heading"><h2>{report.content.title ?? `报告 #${report.id}`}</h2><small>#{report.id} · {new Date(report.createdAt).toLocaleString("zh-CN")}</small></div>
      <p>{report.content.message}</p>
      <p className="note">当前授权：{grants[report.id]?.length ? grants[report.id].map(grant => grant.doctorEmail).join("、") : "无"}</p>
      <div className="inline-form"><input aria-label="医生邮箱" type="email" value={doctorEmail} onChange={event => setDoctorEmail(event.target.value)} /><button disabled={busy} onClick={() => action(() => api<Grant>(`/api/reports/${report.id}/grants`, "POST", {doctorEmail}))}>授权医生查看</button></div>
      {grants[report.id]?.map(grant => <button className="secondary" key={grant.doctorId} disabled={busy} onClick={() => action(() => api<void>(`/api/reports/${report.id}/grants/${grant.doctorId}`, "DELETE"))}>撤销 {grant.doctorEmail} 的权限</button>)}
    </article>)}</div>
  </main>;
}
