"use client";

import { useState, type FormEvent } from "react";
import { api, type IndicatorEntryResponse } from "@/lib/api";

type Category = "BP" | "GLUCOSE" | "LIPID";
type Field = { code: string; label: string; unit: "mmHg" | "%" | "mmol/L"; optional?: boolean };
const fields: Record<Category, Field[]> = {
  BP: [{ code: "systolic_bp", label: "收缩压", unit: "mmHg" }, { code: "diastolic_bp", label: "舒张压", unit: "mmHg" }],
  GLUCOSE: [{ code: "blood_glucose", label: "血糖", unit: "mmol/L" }, { code: "hba1c", label: "糖化血红蛋白", unit: "%", optional: true }],
  LIPID: [{ code: "total_cholesterol", label: "总胆固醇", unit: "mmol/L", optional: true }, { code: "ldl_cholesterol", label: "LDL 胆固醇", unit: "mmol/L", optional: true }, { code: "hdl_cholesterol", label: "HDL 胆固醇", unit: "mmol/L", optional: true }, { code: "triglycerides", label: "甘油三酯", unit: "mmol/L", optional: true }],
};
const contexts: Record<Category, { value: string; label: string }[]> = {
  BP: [{ value: "HOME", label: "居家测量" }, { value: "CLINIC", label: "诊室测量" }],
  GLUCOSE: [{ value: "FASTING_PLASMA", label: "空腹实验室血浆" }, { value: "RANDOM", label: "随机实验室血糖" }, { value: "POST_MEAL", label: "餐后血糖" }, { value: "CAPILLARY", label: "指尖血糖" }],
  LIPID: [{ value: "FASTING", label: "空腹实验室血脂" }, { value: "NON_FASTING", label: "非空腹实验室血脂" }],
};
function localDateTime() {
  const date = new Date();
  const two = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}T${two(date.getHours())}:${two(date.getMinutes())}`;
}

export function IndicatorPanel() {
  const [category, setCategory] = useState<Category>("BP");
  const [context, setContext] = useState("HOME");
  const [measuredAt, setMeasuredAt] = useState(localDateTime);
  const [ageYears, setAgeYears] = useState("22");
  const [pregnant, setPregnant] = useState(false);
  const [input, setInput] = useState<Record<string, string>>({});
  const [units, setUnits] = useState<Record<string, string>>({});
  const [result, setResult] = useState<IndicatorEntryResponse | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(""); setResult(null); setBusy(true);
    try {
      const values = Object.fromEntries(fields[category].filter(field => input[field.code]?.trim()).map(field => [field.code, {
        value: Number(input[field.code]), unit: units[field.code] ?? field.unit,
      }]));
      const created = await api<IndicatorEntryResponse>("/api/indicators", "POST", {
        category, measuredAt, context, ageYears: Number(ageYears), pregnant, values,
      });
      setResult(created);
      setMessage("指标已保存。原始值和换算后的标准值均已记录。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败，请核对输入。");
    } finally { setBusy(false); }
  }

  return <section className="indicator-panel">
    <h2>录入体测指标</h2>
    <p className="note">可分次录入血压、血糖或血脂。这里只展示研发阶段的参考规则，不提供疾病诊断或患病概率。</p>
    <form onSubmit={submit}>
      <div className="form-grid">
        <label>指标分类<select value={category} onChange={event => { const next = event.target.value as Category; setCategory(next); setContext(contexts[next][0].value); setResult(null); }}>
          <option value="BP">血压</option><option value="GLUCOSE">血糖</option><option value="LIPID">血脂</option>
        </select></label>
        <label>测量时间<input type="datetime-local" required value={measuredAt} onChange={event => setMeasuredAt(event.target.value)} /></label>
        <label>测量条件<select value={context} onChange={event => setContext(event.target.value)}>{contexts[category].map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label>测量时年龄<input type="number" min="0" max="120" required value={ageYears} onChange={event => setAgeYears(event.target.value)} /></label>
      </div>
      <label className="check-row"><input type="checkbox" checked={pregnant} onChange={event => setPregnant(event.target.checked)} />测量时处于妊娠期（暂不适用成人参考规则）</label>
      <div className="form-grid">{fields[category].map(field => <div className="value-field" key={field.code}>
        <label>{field.label}{field.optional ? "（可选）" : ""}<input type="number" step="any" min="0.0001" required={!field.optional} value={input[field.code] ?? ""} onChange={event => setInput(previous => ({ ...previous, [field.code]: event.target.value }))} /></label>
        {field.unit === "mmol/L" && <select aria-label={`${field.label}单位`} value={units[field.code] ?? field.unit} onChange={event => setUnits(previous => ({ ...previous, [field.code]: event.target.value }))}><option value="mmol/L">mmol/L</option><option value="mg/dL">mg/dL</option></select>}
        {field.unit !== "mmol/L" && <span className="unit">{field.unit}</span>}
      </div>)}</div>
      <button type="submit" disabled={busy}>{busy ? "保存中…" : "保存指标并查看研发预览"}</button>
    </form>
    {message && <p role="status" className="notice">{message}</p>}
    {result && <div className="preview-result">
      <h3>保存结果</h3>
      <p>规则状态：待临床审核；以下仅为本地开发预览。</p>
      <ul>{result.values.map(value => <li key={value.code}>{fields[category].find(field => field.code === value.code)?.label ?? value.code}：{value.rawValue} {value.rawUnit} → {value.value} {value.unit}</li>)}</ul>
      {result.draftInterpretations.length === 0 && <p>这组指标目前没有适用的研发参考规则；记录仍已保存。“没有规则”不代表数值安全，若读数异常或身体不适，请联系医疗人员。</p>}
      {result.draftInterpretations.map(item => <article key={item.ruleCode}>
        <h4>{item.label}</h4><p>{item.explanation}</p><p className="note">适用范围：{item.applicability} · 规则版本：{item.ruleVersion} · 状态：待临床审核</p>
        <a href={item.sourceUrl} target="_blank" rel="noreferrer">查看来源：{item.sourceTitle}</a>
      </article>)}
    </div>}
  </section>;
}
