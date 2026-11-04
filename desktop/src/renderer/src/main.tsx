import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

type NumberField = Exclude<keyof AssessmentInput, 'gender'>
const fields: Array<{name:NumberField; label:string; unit:string; hint:string}> = [
  {name:'age',label:'年龄',unit:'岁',hint:'18–100'}, {name:'HbA1c',label:'糖化血红蛋白',unit:'%',hint:'例如 7.2'},
  {name:'diabetes_duration',label:'糖尿病病程',unit:'年',hint:'例如 5'}, {name:'systolic_bp',label:'收缩压',unit:'mmHg',hint:'例如 130'},
  {name:'diastolic_bp',label:'舒张压',unit:'mmHg',hint:'例如 80'}, {name:'total_cholesterol',label:'总胆固醇',unit:'mg/dL',hint:'例如 190'},
  {name:'triglycerides',label:'甘油三酯',unit:'mg/dL',hint:'例如 150'}, {name:'HDL',label:'高密度脂蛋白胆固醇',unit:'mg/dL',hint:'例如 45'},
  {name:'glucose',label:'血糖',unit:'mg/dL',hint:'例如 140'}, {name:'uric_acid',label:'尿酸',unit:'mg/dL',hint:'例如 6.0'}
]
const initialValues: AssessmentInput = {age:55,gender:1,HbA1c:7.2,diabetes_duration:8,systolic_bp:130,diastolic_bp:80,total_cholesterol:190,triglycerides:150,HDL:45,glucose:140,uric_acid:6}

function App(): React.JSX.Element {
  const [values, setValues] = useState<AssessmentInput>(initialValues)
  const [result, setResult] = useState<AssessmentResult | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const setNumber = (name:NumberField, value:string): void => setValues((current) => ({...current, [name]:Number(value)}))
  async function submit(event:React.FormEvent): Promise<void> {
    event.preventDefault(); setError(''); setLoading(true)
    try { setResult(await window.assessment.predict(values)) }
    catch (reason) { setResult(null); setError(reason instanceof Error ? reason.message : '评估失败，请检查输入后重试。') }
    finally { setLoading(false) }
  }
  return <main>
    <header><p className="eyebrow">RESEARCH PROTOTYPE · LOCAL ONLY</p><h1>见微知著 · DKD 风险筛查</h1><p>输入近期体检数据，获得研究性风险评估与模型影响因素说明。</p></header>
    <section className="notice">本工具不会上传或保存本次输入；结果仅用于科研原型与风险筛查，不能替代医生诊断或治疗决策。</section>
    <div className="layout">
      <form onSubmit={submit} className="panel"><h2>体检数据</h2><p className="muted">请按检验报告原始单位填写。所有项目均为完整评估模型的必填项。</p>
        <label><span>性别</span><select value={values.gender} onChange={(event) => setValues((current) => ({...current, gender:Number(event.target.value) as 1|2}))}><option value={1}>编码 1</option><option value={2}>编码 2</option></select><small>当前数据沿用原始编码；发布前需根据数据字典改为清晰标签。</small></label>
        <div className="grid">{fields.map((field) => <label key={field.name}><span>{field.label} <em>{field.unit}</em></span><input type="number" required step="any" value={values[field.name]} onChange={(event) => setNumber(field.name, event.target.value)} /><small>{field.hint}</small></label>)}</div>
        {error && <p className="error">{error}</p>}<button type="submit" disabled={loading}>{loading ? '正在评估…' : '开始风险评估'}</button>
      </form>
      <section className="panel" aria-live="polite"><h2>评估结果</h2>{!result && <p className="placeholder">完成填写后，模型结果会显示在这里。</p>}{result && <>
        <div className={result.screening_flag ? 'risk risk-alert' : 'risk'}><span>模型估计风险</span><strong>{(result.risk_probability * 100).toFixed(1)}%</strong><p>{result.screening_message}</p></div>
        <h3>主要模型影响因素</h3><ul>{result.top_factors.map((factor) => <li key={factor.feature}><b>{factor.feature}</b><span className={factor.direction === '增加模型风险' ? 'up' : 'down'}>{factor.direction}</span></li>)}</ul>
        <h3>建议</h3><p>{result.recommendation}</p><p className="disclaimer">{result.disclaimer}<br/>模型版本：{result.model_version}</p>
      </>}</section>
    </div>
  </main>
}
createRoot(document.getElementById('root')!).render(<App />)

