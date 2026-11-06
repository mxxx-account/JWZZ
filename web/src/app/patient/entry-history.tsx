"use client";

import { useEffect, useState } from "react";
import { api, type Report, type StoredIndicator } from "@/lib/api";

const labels: Record<string, string> = {
  systolic_bp: "收缩压", diastolic_bp: "舒张压", blood_glucose: "血糖", hba1c: "糖化血红蛋白",
  total_cholesterol: "总胆固醇", ldl_cholesterol: "LDL 胆固醇", hdl_cholesterol: "HDL 胆固醇", triglycerides: "甘油三酯",
};
const contextLabels: Record<string, string> = {
  HOME: "居家血压", CLINIC: "诊室血压", FASTING_PLASMA: "空腹实验室血浆",
  RANDOM: "随机实验室血糖", POST_MEAL: "餐后血糖", CAPILLARY: "指尖血糖",
  FASTING: "空腹实验室血脂", NON_FASTING: "非空腹实验室血脂",
};

export function EntryHistory({ refreshKey, onGenerated }: { refreshKey: number; onGenerated: (reportId: number) => Promise<void> }) {
  const [entries, setEntries] = useState<StoredIndicator[][]>([]);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    api<StoredIndicator[]>("/api/indicators").then(rows => {
      const grouped = new Map<string, StoredIndicator[]>();
      rows.forEach(row => grouped.set(row.entryId, [...(grouped.get(row.entryId) ?? []), row]));
      setEntries([...grouped.values()]);
    }).catch(() => setMessage("无法加载指标历史。"));
  }, [refreshKey]);

  async function generate(entryId: string) {
    setBusy(entryId); setMessage("");
    try {
      const report = await api<Report>("/api/reports", "POST", { entryId });
      await onGenerated(report.id);
      setMessage(`报告 #${report.id} 已生成；重复点击会返回同一份报告。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "生成失败。"); }
    finally { setBusy(""); }
  }

  return <section className="workspace-panel history-section">
    <h2>最近录入</h2>
    <p className="note">按一次录入分组展示最近 100 条指标明细。点击生成报告会固定当时的数值与研发规则版本。</p>
    {message && <p role="status" className="notice">{message}</p>}
    {entries.length === 0 && <p className="notice">还没有指标记录。</p>}
    <div className="entry-list">{entries.map(rows => <article key={rows[0].entryId}>
      <div className="report-heading"><h3>{new Date(rows[0].measuredAt).toLocaleString("zh-CN")}</h3><small>{contextLabels[rows[0].context] ?? rows[0].context}</small></div>
      <p>{rows.map(row => `${labels[row.code] ?? row.code} ${row.rawValue} ${row.rawUnit}`).join(" · ")}</p>
      <button disabled={busy !== ""} onClick={() => generate(rows[0].entryId)}>{busy === rows[0].entryId ? "生成中…" : "生成／查看这次的报告"}</button>
    </article>)}</div>
  </section>;
}
