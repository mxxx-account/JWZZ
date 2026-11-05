"use client";

import { useEffect, useState } from "react";
import { api, type StoredIndicator } from "@/lib/api";

const labels: Record<string, string> = {
  systolic_bp: "收缩压", diastolic_bp: "舒张压", blood_glucose: "血糖", hba1c: "糖化血红蛋白",
  total_cholesterol: "总胆固醇", ldl_cholesterol: "LDL 胆固醇", hdl_cholesterol: "HDL 胆固醇", triglycerides: "甘油三酯",
};
const contextLabels: Record<string, string> = {
  HOME: "居家", CLINIC: "诊室", FASTING_PLASMA: "空腹实验室血浆", RANDOM: "随机实验室血糖",
  POST_MEAL: "餐后", CAPILLARY: "指尖", FASTING: "空腹实验室血脂", NON_FASTING: "非空腹实验室血脂",
};

function TrendChart({ rows }: { rows: StoredIndicator[] }) {
  if (rows.length < 2) return <p className="notice">同条件下至少录入两次，才会显示趋势线。</p>;
  const values = rows.map(row => Number(row.value));
  const low = Math.min(...values), high = Math.max(...values);
  const pad = Math.max((high - low) * 0.15, 0.1);
  const min = low - pad, max = high + pad;
  const times = rows.map(row => new Date(row.measuredAt).getTime());
  const first = Math.min(...times), last = Math.max(...times);
  const points = rows.map((row, index) => ({
    x: first === last ? 40 + index * 560 / (rows.length - 1) : 40 + (times[index] - first) * 560 / (last - first),
    y: 190 - (Number(row.value) - min) * 150 / (max - min),
    row,
  }));
  return <div className="trend-chart">
    <svg viewBox="0 0 640 220" role="img" aria-label={`${labels[rows[0].code]}的历史趋势，共 ${rows.length} 次测量`}>
      <line x1="40" y1="190" x2="600" y2="190" stroke="#a9c1ca" />
      <line x1="40" y1="40" x2="40" y2="190" stroke="#a9c1ca" />
      <polyline fill="none" stroke="#126a69" strokeWidth="3" points={points.map(point => `${point.x},${point.y}`).join(" ")} />
      {points.map(point => <circle key={point.row.id} cx={point.x} cy={point.y} r="5" fill="#126a69"><title>{new Date(point.row.measuredAt).toLocaleString("zh-CN")}：{point.row.value} {point.row.unit}</title></circle>)}
      <text x="40" y="20" fontSize="13" fill="#526978">{max.toFixed(2)} {rows[0].unit}</text>
      <text x="40" y="212" fontSize="13" fill="#526978">{min.toFixed(2)}</text>
    </svg>
    <ol>{rows.map(row => <li key={row.id}>{new Date(row.measuredAt).toLocaleString("zh-CN")}：{row.value} {row.unit}</li>)}</ol>
  </div>;
}

export function TrendPanel({ refreshKey }: { refreshKey: number }) {
  const [options, setOptions] = useState<{ code: string; context: string }[]>([]);
  const [selected, setSelected] = useState("");
  const [rows, setRows] = useState<StoredIndicator[]>([]);
  const [message, setMessage] = useState("");
  useEffect(() => {
    api<StoredIndicator[]>("/api/indicators").then(all => {
      const unique = [...new Map(all.map(row => [`${row.code}|${row.context}`, { code: row.code, context: row.context }])).values()];
      setOptions(unique);
      setSelected(previous => unique.some(option => `${option.code}|${option.context}` === previous) ? previous
        : unique.length ? `${unique[0].code}|${unique[0].context}` : "");
    }).catch(() => setMessage("无法加载可用趋势。"));
  }, [refreshKey]);
  useEffect(() => {
    if (!selected) { setRows([]); return; }
    const [code, context] = selected.split("|");
    api<StoredIndicator[]>(`/api/indicators/trends?code=${encodeURIComponent(code)}&context=${encodeURIComponent(context)}`)
      .then(setRows).catch(() => setMessage("无法读取趋势数据。"));
  }, [selected, refreshKey]);
  return <section className="workspace-panel history-section">
    <h2>同类指标趋势</h2>
    <p className="note">只比较同一指标和同一测量条件下最近 50 次标准化数值。折线仅表示记录变化，不代表病情变化或诊断结论。</p>
    {options.length ? <label className="trend-select">选择指标与条件<select value={selected} onChange={event => setSelected(event.target.value)}>
      {options.map(option => <option key={`${option.code}|${option.context}`} value={`${option.code}|${option.context}`}>
        {labels[option.code] ?? option.code} · {contextLabels[option.context] ?? option.context}
      </option>)}
    </select></label> : <p className="notice">录入至少一条指标后可选择趋势。</p>}
    {message && <p role="status" className="error">{message}</p>}
    {selected && <TrendChart rows={rows} />}
  </section>;
}
