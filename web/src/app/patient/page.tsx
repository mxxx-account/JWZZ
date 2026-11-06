"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type CurrentUser } from "@/lib/api";
import { AppNav } from "../app-nav";
import { IndicatorPanel } from "./indicator-panel";
import { EntryHistory } from "./entry-history";
import { TrendPanel } from "./trend-panel";
import { ReportArchive } from "./report-archive";

type View = "entry" | "history" | "trends" | "reports";
const views: { id: View; label: string; description: string }[] = [
  { id: "entry", label: "录入体检指标", description: "记录新的测量结果" },
  { id: "history", label: "最近录入", description: "查看记录并生成报告" },
  { id: "trends", label: "同类指标趋势", description: "对比历次测量" },
  { id: "reports", label: "我的报告与授权", description: "查找、授权与咨询" },
];

export default function PatientPage() {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [view, setView] = useState<View>("entry");
  const [indicatorRefreshKey, setIndicatorRefreshKey] = useState(0);
  const [archiveRefreshKey, setArchiveRefreshKey] = useState(0);
  const [reportFocusId, setReportFocusId] = useState<number | null>(null);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("view");
    if (views.some(item => item.id === requested)) setView(requested as View);
    api<CurrentUser>("/api/auth/me").then(current => {
      if (current.role !== "USER") { router.replace("/doctor"); return; }
      setUser(current);
    }).catch(() => router.replace("/"));
  }, [router]);

  function selectView(next: View) {
    setView(next);
    const url = new URL(window.location.href);
    if (next === "entry") url.searchParams.delete("view");
    else url.searchParams.set("view", next);
    window.history.replaceState(window.history.state, "", url);
  }

  return <><AppNav role="USER" active="home" /><div className="patient-layout">
    <aside className="patient-sidebar" aria-label="用户工作区">
      <div className="patient-sidebar-title"><span>工作区</span><strong>体检指标管理</strong></div>
      <div className="patient-side-links">{views.map(item => <button key={item.id} type="button" className={view === item.id ? "active" : ""} aria-current={view === item.id ? "page" : undefined} onClick={() => { if (item.id === "reports") setReportFocusId(null); selectView(item.id); }}><strong>{item.label}</strong><small>{item.description}</small></button>)}</div>
      <p className="patient-sidebar-note">仅展示研发阶段参考规则，不提供疾病诊断或患病概率。</p>
    </aside>
    <main className="patient-main">
      <div className="patient-welcome"><div><p className="eyebrow">已登录：{user?.name || user?.email || "加载中…"} · {user?.email}</p><h1>指标与报告首页</h1></div><p>从左侧选择要处理的事项。报告会保留在“我的报告与授权”，无需翻过长长的首页。</p></div>
      {view === "entry" && <IndicatorPanel onSaved={() => setIndicatorRefreshKey(value => value + 1)} />}
      {view === "history" && <EntryHistory refreshKey={indicatorRefreshKey} onGenerated={async reportId => { setReportFocusId(reportId); setArchiveRefreshKey(value => value + 1); selectView("reports"); }} />}
      {view === "trends" && <TrendPanel refreshKey={indicatorRefreshKey} />}
      {view === "reports" && <ReportArchive refreshKey={archiveRefreshKey} focusId={reportFocusId} />}
    </main>
  </div></>;
}
