"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError, homeForRole, type CurrentUser, type Report } from "@/lib/api";
import { AppNav } from "../app-nav";
import { ReportContent } from "../report-content";

type Task={id:number;title:string;dueAt:string|null;status:string;reportId:number|null;reportHidden:boolean};
type Detail={consultationId:number;reportId:number;status:string;summary:string|null;closedAt:string|null;tasks:Task[]};
type Summary={id:number;reportId:number;summary:string;closedAt:string};
const labels:Record<string,string>={PROPOSED:"待你确认",ACTIVE:"提醒已设置",NOTIFIED:"提醒已到期",CANCELLED:"已取消",COMPLETED:"已完成"};
const instant=(text:string)=>new Date(text).toISOString();
const errorText=(error:unknown)=>error instanceof ApiError && error.status===404
  ? "咨询或报告不存在，或授权已撤销。请刷新列表确认。"
  : error instanceof Error?error.message:"操作失败，请重试。";
const localTime=(value:string|null)=>{
  if(!value)return "";
  const date=new Date(value);return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);
};

function TaskCard({task,role,busy,change,showReport}:{task:Task;role:"USER"|"DOCTOR";busy:boolean;change:(id:number,action:string,body:unknown)=>Promise<void>;showReport:(id:number)=>void}) {
  const [due,setDue]=useState(localTime(task.dueAt)),[report,setReport]=useState("");
  useEffect(()=>setDue(localTime(task.dueAt)),[task.dueAt]);
  return <article className="followup-task" data-task-id={task.id}>
    <strong>{task.title}</strong><span className="followup-status">{role==="DOCTOR"&&task.status==="PROPOSED"?"待用户确认":labels[task.status]}</span>
    <p>{task.dueAt?`${task.status==="PROPOSED"?"建议时间":"提醒时间"}：${new Date(task.dueAt).toLocaleString("zh-CN")}`:"尚未指定时间"}</p>
    {role==="USER" && task.status==="PROPOSED" && <form onSubmit={event=>{event.preventDefault();void change(task.id,"confirm",{dueAt:instant(due)});}}>
      <label>确认提醒时间<input type="datetime-local" required value={due} onChange={e=>setDue(e.target.value)}/></label><button disabled={busy}>确认并启用提醒</button></form>}
    {role==="USER" && ["ACTIVE","NOTIFIED"].includes(task.status) && <form onSubmit={event=>{event.preventDefault();void change(task.id,"complete",{reportId:report?Number(report):null});}}>
      <label>关联新报告编号（选填）<input type="number" min="1" step="1" value={report} onChange={e=>setReport(e.target.value)} placeholder="在首页生成报告后填写编号"/></label>
      <p className="note">只关联你自己的新报告；不会自动授权医生。也可以不关联报告，直接完成待办。</p><button disabled={busy}>完成待办</button></form>}
    {role==="USER" && !["CANCELLED","COMPLETED"].includes(task.status) && <button className="secondary" disabled={busy} onClick={()=>void change(task.id,"cancel",{})}>取消此提醒</button>}
    {task.reportId && <button disabled={busy} onClick={()=>showReport(task.reportId!)}>查看关联报告 #{task.reportId}</button>}
    {task.reportHidden && <p className="notice">用户已关联新报告，但尚未授权或已撤销授权，不能查看。</p>}
  </article>;
}

export function FollowupCenter({role}:{role:"USER"|"DOCTOR"}) {
  const router=useRouter(), [ready,setReady]=useState(false),[rows,setRows]=useState<Summary[]>([]),[more,setMore]=useState(false);
  const [id,setId]=useState<number|null>(null),[detail,setDetail]=useState<Detail|null>(null),[error,setError]=useState(""),[success,setSuccess]=useState(""),[busy,setBusy]=useState(false);
  const [summary,setSummary]=useState(""),[proposal,setProposal]=useState(""),[proposedTime,setProposedTime]=useState("");
  const [title,setTitle]=useState(""),[due,setDue]=useState(""),[report,setReport]=useState<Report|null>(null);
  const selected=useRef(id);selected.current=id;
  const key=useRef<string|null>(null),version=useRef(0);
  const home=homeForRole(role);
  const list=useCallback(async(before?:number)=>{
    const page=await api<{items:Summary[];hasMore:boolean}>(`/api/followups?size=20${before?`&beforeId=${before}`:""}`);
    setRows(old=>before?[...old,...page.items.filter(item=>!old.some(previous=>previous.id===item.id))]:page.items);setMore(page.hasMore);
  },[]);
  useEffect(()=>{
    let cancelled=false;
    api<CurrentUser>("/api/auth/me").then(async user=>{
      if(cancelled)return;if(user.role!==role){router.replace(homeForRole(user.role));return;}
      setReady(true);await list();if(cancelled)return;
      const requested=Number(new URLSearchParams(window.location.search).get("consultation"));
      if(Number.isSafeInteger(requested)&&requested>0)setId(requested);
    }).catch(()=>{if(!cancelled)setError("无法加载随访，请确认已登录并刷新重试。");});return()=>{cancelled=true;};
  },[role,router,list]);
  const refresh=useCallback(async()=>{
    if(id===null)return;const run=++version.current;
    try {const result=await api<Detail>(`/api/followups/${id}`);if(selected.current===id&&version.current===run){setDetail(result);setError("");}}
    catch(e){if(selected.current===id&&version.current===run){setDetail(null);setReport(null);setError(errorText(e));}}
  },[id]);
  useEffect(()=>{
    setDetail(null);setReport(null);setSuccess("");setSummary("");setProposal("");setProposedTime("");setTitle("");setDue("");key.current=null;
    if(!ready||id===null)return;void refresh();
    const sync=()=>{void refresh();};
    const timer=window.setInterval(sync,8000);window.addEventListener("online",sync);
    return()=>{version.current++;window.clearInterval(timer);window.removeEventListener("online",sync);};
  },[ready,id,refresh]);
  const shownReportId=report?.id;
  useEffect(()=>{
    if(!shownReportId)return;let cancelled=false;
    const timer=window.setInterval(()=>{
      void api<Report>(`/api/reports/${shownReportId}`).then(next=>{if(!cancelled)setReport(next);})
        .catch(()=>{if(!cancelled){setReport(null);setError("关联报告暂不可访问，请检查授权或稍后重试。");}});
    },8000);
    return()=>{cancelled=true;window.clearInterval(timer);};
  },[shownReportId,id]);
  async function mutate(path:string,body:unknown) {
    if(busy||id===null)return;const current=id;version.current++;setBusy(true);setError("");setSuccess("");
    try {const next=await api<Detail>(`/api/followups/${id}${path}`,"POST",body);if(selected.current===current){version.current++;setDetail(next);setSuccess("操作成功，随访记录已保存。");}await list();window.dispatchEvent(new Event("jwzz-notifications-changed"));}
    catch(e){if(selected.current===current)setError(errorText(e));}
    finally{setBusy(false);}
  }
  async function showReport(reportId:number) {
    const current=id;setReport(null);
    try {const next=await api<Report>(`/api/reports/${reportId}`);if(selected.current===current)setReport(next);}
    catch(e){setError(errorText(e));}
  }
  return <><AppNav role={role} active="followups"/><main className="followup-center">
    <header><p className="eyebrow">见微知著 · 沟通记录</p><h1>咨询与随访</h1><p>记录沟通小结和待办。提醒时间由用户自行设置或确认，系统不决定治疗或复查时间。</p></header>
    <div className="followup-layout"><aside className="followup-list" aria-label="已结束咨询">
      <h2>已结束咨询</h2><button disabled={busy} onClick={()=>void list().catch(()=>setError("列表刷新失败，请重试"))}>刷新咨询列表</button>
      {rows.map(row=><button className={id===row.id?"selected":"secondary"} key={row.id} disabled={busy} onClick={()=>{setId(row.id);window.history.replaceState(null,"",`?consultation=${row.id}`);}}>咨询 #{row.id} · 报告 #{row.reportId}<small>{row.summary.slice(0,65)}</small></button>)}
      {more&&<button disabled={busy} onClick={()=>void list(rows.at(-1)?.id).catch(()=>setError("加载失败，请重试"))}>加载更多咨询</button>}
      {!rows.length&&<p>暂无已结束的咨询。进行中的咨询可从聊天窗口进入。</p>}
    </aside><section className="followup-detail" aria-label="随访详情">
      {error&&<p role="alert" className="error-notice">{error}</p>}{success&&<p role="status" className="notice">{success}</p>}
      {!detail?<p>请选择一次咨询，或从咨询消息进入。<button onClick={()=>void refresh()}>刷新详情</button></p>:<>
        <h2>咨询 #{detail.consultationId} · {detail.status==="CLOSED"?"已结束":"进行中"}</h2><Link href={`${home}/messages?conversation=${id}`}>查看完整沟通记录 →</Link>
        {detail.status!=="CLOSED"?(role==="DOCTOR"?<form className="followup-form" onSubmit={e=>{e.preventDefault();void mutate("/close",{summary,tasks:proposal.trim()?[{title:proposal,dueAt:proposedTime?instant(proposedTime):null}]:[]});}}>
          <label>沟通小结<textarea required maxLength={2000} value={summary} onChange={e=>setSummary(e.target.value)}/></label>
          <label>待办建议（选填）<input maxLength={300} value={proposal} onChange={e=>setProposal(e.target.value)}/></label>
          <label>建议提醒时间（选填，仍须用户确认）<input type="datetime-local" value={proposedTime} onChange={e=>setProposedTime(e.target.value)}/></label>
          <p className="note">结束后聊天转为只读，小结不能覆盖修改。请确认已沟通完毕再提交。</p><button disabled={busy||detail.status==="OPEN"}>结束咨询并保存小结</button></form>:<p className="notice">咨询仍在进行，结束后可查看小结并设置记录提醒。</p>):<>
          <h3>沟通小结</h3><p className="followup-summary">{detail.summary}</p>
          <h3>随访待办</h3>{!detail.tasks.length&&<p>暂无待办。</p>}
          {detail.tasks.map(task=><TaskCard key={task.id} task={task} role={role} busy={busy} change={(taskId,action,body)=>mutate(`/tasks/${taskId}/${action}`,body)} showReport={showReport}/>)}
          {role==="USER"&&<form className="followup-form" onSubmit={e=>{e.preventDefault();key.current??=crypto.randomUUID();void mutate("/tasks",{title,dueAt:instant(due),clientKey:key.current});}}>
            <h3>自己设置记录提醒</h3><label>提醒内容<input required maxLength={300} value={title} onChange={e=>{setTitle(e.target.value);key.current=null;}}/></label>
            <label>提醒时间<input type="datetime-local" required value={due} onChange={e=>{setDue(e.target.value);key.current=null;}}/></label><button disabled={busy}>保存我的提醒</button>
            <p><Link href="/patient">前往首页录入新指标、生成报告或管理报告授权 →</Link></p></form>}
          {report&&<section aria-label="关联报告内容"><ReportContent report={report}/></section>}
        </>}
      </>}
    </section></div></main></>;
}
