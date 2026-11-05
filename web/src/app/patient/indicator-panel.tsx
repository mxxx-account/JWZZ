"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api, type IndicatorCatalog, type IndicatorEntryResponse } from "@/lib/api";

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

export function IndicatorPanel({ onSaved }: { onSaved: () => void }) {
  const [category, setCategory] = useState<Category | "">("");
  const [context, setContext] = useState("");
  const [measuredAt, setMeasuredAt] = useState(localDateTime);
  const [ageYears, setAgeYears] = useState("22");
  const [pregnant, setPregnant] = useState(false);
  const [input, setInput] = useState<Record<string, string>>({});
  const [units, setUnits] = useState<Record<string, string>>({});
  const [result, setResult] = useState<IndicatorEntryResponse | null>(null);
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error">("success");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [catalog, setCatalog] = useState<IndicatorCatalog | null>(null);
  const activeFields = category ? fields[category] : [];
  const activeContexts = category ? contexts[category] : [];

  useEffect(() => {
    api<IndicatorCatalog>("/api/public/indicators").then(setCatalog).catch(() => {});
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(""); setResult(null);
    if (!category) {
      setMessageKind("error");
      setMessage("请先选择指标分类：血压、血糖或血脂。指标尚未保存。");
      return;
    }
    const errors: Record<string, string> = {};
    if (!measuredAt || Number.isNaN(new Date(measuredAt).getTime())) errors.measuredAt = "请选择有效的测量时间。";
    else if (new Date(measuredAt).getTime() > Date.now() + 60 * 60 * 1000) errors.measuredAt = "测量时间不能晚于当前时间。";
    if (!Number.isInteger(Number(ageYears)) || Number(ageYears) < 0 || Number(ageYears) > 120 || ageYears.trim() === "")
      errors.ageYears = "年龄应为 0–120 岁的整数。";
    for (const field of activeFields) {
      const raw = input[field.code]?.trim() ?? "";
      if (!raw) { if (!field.optional) errors[field.code] = `请填写${field.label}。`; continue; }
      if (!/^\d+(?:\.\d{1,4})?$/.test(raw) || Number(raw) <= 0)
        errors[field.code] = `${field.label}须为正数，最多保留 4 位小数。`;
      else if (field.code === "systolic_bp" && (Number(raw) < 40 || Number(raw) > 350))
        errors[field.code] = "收缩压仅接受 40–350 mmHg；这是录入校验范围，不是医学正常范围。";
      else if (field.code === "diastolic_bp" && (Number(raw) < 20 || Number(raw) > 350))
        errors[field.code] = "舒张压仅接受 20–350 mmHg；这是录入校验范围，不是医学正常范围。";
    }
    if (category === "BP" && input.systolic_bp && input.diastolic_bp
      && Number(input.systolic_bp) <= Number(input.diastolic_bp))
      errors.systolic_bp = `${errors.systolic_bp ? `${errors.systolic_bp} ` : ""}收缩压应高于舒张压。`;
    if (category === "LIPID" && fields.LIPID.every(field => !input[field.code]?.trim()))
      errors.values = "请至少填写一项血脂指标。";
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      setMessageKind("error");
      setMessage("请先修正下方标红的输入，指标尚未保存。");
      return;
    }
    setBusy(true);
    try {
      const values = Object.fromEntries(activeFields.filter(field => input[field.code]?.trim()).map(field => [field.code, {
        value: Number(input[field.code]), unit: units[field.code] ?? field.unit,
      }]));
      const created = await api<IndicatorEntryResponse>("/api/indicators", "POST", {
        category, measuredAt, context, ageYears: Number(ageYears), pregnant, values,
      });
      setResult(created);
      setMessageKind("success");
      setMessage("指标已保存。若要生成固定报告，请在下方“最近录入”中点击“生成／查看这次的报告”。");
      onSaved();
    } catch (error) {
      setMessageKind("error");
      setMessage(error instanceof Error ? error.message : "保存失败，请核对输入。");
    } finally { setBusy(false); }
  }

  return <section className="workspace-panel indicator-panel">
    <h2>录入体检指标</h2>
    <p className="note">可分次录入血压、血糖或血脂。这里只展示研发阶段的参考规则，不提供疾病诊断或患病概率。</p>
    {catalog && <details className="catalog-help"><summary>指标填写说明</summary><ul>{catalog.items.map(item => <li key={item.code}><strong>{item.name}</strong>（{item.unit}）：{item.description}</li>)}</ul><small>说明版本：{catalog.version}</small></details>}
    <form onSubmit={submit} noValidate>
      <div className="form-grid">
        <label>指标分类<select value={category} onChange={event => { const next = event.target.value as Category; setCategory(next); setContext(contexts[next][0].value); setResult(null); setFieldErrors({}); setMessage(""); }}>
          <option value="" disabled>请先选择指标分类</option>
          <option value="BP">血压</option><option value="GLUCOSE">血糖</option><option value="LIPID">血脂</option>
        </select></label>
        <label>测量时间<input type="datetime-local" required aria-invalid={Boolean(fieldErrors.measuredAt)} value={measuredAt} onChange={event => { setMeasuredAt(event.target.value); setFieldErrors(previous => ({ ...previous, measuredAt: "" })); setMessage(""); }} />{fieldErrors.measuredAt && <span className="field-error">{fieldErrors.measuredAt}</span>}</label>
        <label>测量条件<select value={context} disabled={!category} onChange={event => setContext(event.target.value)}>{!category && <option value="">请先选择分类</option>}{activeContexts.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label>测量时年龄<input type="number" min="0" max="120" required aria-invalid={Boolean(fieldErrors.ageYears)} value={ageYears} onChange={event => { setAgeYears(event.target.value); setFieldErrors(previous => ({ ...previous, ageYears: "" })); setMessage(""); }} />{fieldErrors.ageYears && <span className="field-error">{fieldErrors.ageYears}</span>}</label>
      </div>
      <label className="check-row"><input type="checkbox" checked={pregnant} onChange={event => setPregnant(event.target.checked)} />测量时处于妊娠期（暂不适用成人参考规则）</label>
      {!category && <p className="input-hint">先选择指标分类，再按体检单或测量设备上的数值和单位填写。</p>}
      {category === "BP" && <p className="input-hint">请按血压计实际结果填写；格式示例：收缩压 120、舒张压 80 mmHg。</p>}
      <div className="form-grid">{activeFields.map(field => <div className="value-field" key={field.code}>
        <label>{field.label}{field.optional ? "（可选）" : ""}<input type="number" step="any" min="0.0001" required={!field.optional} aria-invalid={Boolean(fieldErrors[field.code])} value={input[field.code] ?? ""} onChange={event => { setInput(previous => ({ ...previous, [field.code]: event.target.value })); setFieldErrors(previous => ({ ...previous, [field.code]: "", values: "" })); setMessage(""); }} />{fieldErrors[field.code] && <span className="field-error">{fieldErrors[field.code]}</span>}</label>
        {field.unit === "mmol/L" && <select aria-label={`${field.label}单位`} value={units[field.code] ?? field.unit} onChange={event => setUnits(previous => ({ ...previous, [field.code]: event.target.value }))}><option value="mmol/L">mmol/L</option><option value="mg/dL">mg/dL</option></select>}
        {field.unit !== "mmol/L" && <span className="unit">{field.unit}</span>}
      </div>)}</div>
      {fieldErrors.values && <p className="field-error">{fieldErrors.values}</p>}
      <button type="submit" disabled={busy}>{busy ? "保存中…" : "保存指标并查看研发预览"}</button>
    </form>
    {message && <p role={messageKind === "error" ? "alert" : "status"} className={messageKind === "error" ? "error-notice" : "notice"}>{message}</p>}
    {result && <div className="preview-result">
      <h3>保存结果</h3>
      <p>规则状态：待临床审核；以下仅为本地开发预览。</p>
      <ul>{result.values.map(value => <li key={value.code}>{activeFields.find(field => field.code === value.code)?.label ?? value.code}：{value.rawValue} {value.rawUnit} → {value.value} {value.unit}</li>)}</ul>
      {result.draftInterpretations.length === 0 && <p>这组指标目前没有适用的研发参考规则；记录仍已保存。“没有规则”不代表数值安全，若读数异常或身体不适，请联系医疗人员。</p>}
      {result.draftInterpretations.map(item => <article key={item.ruleCode}>
        <h4>{item.label}</h4><p>{item.explanation}</p><p className="note">适用范围：{item.applicability} · 规则版本：{item.ruleVersion} · 状态：待临床审核</p>
        <a href={item.sourceUrl} target="_blank" rel="noreferrer">查看来源：{item.sourceTitle}</a>
      </article>)}
    </div>}
  </section>;
}
