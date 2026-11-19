"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type ShopOrder } from "@/lib/api";

type Refund={id:number;originalStatus:string;status:string;reason:string;reviewNote:string|null;returnCode:string|null;disposition:string|null;createdAt:string;completedAt:string|null};
type Lifecycle={order:ShopOrder;shipment:{trackingCode:string;shippedAt:string;receivedAt:string|null}|null;refunds:Refund[];ledger:{id:number;refundId:number;amountCents:number;createdAt:string}[]};
const refundText:Record<string,string>={REQUESTED:"待商家审核",REJECTED:"已拒绝",AWAITING_RETURN:"待用户模拟退货",RETURNED:"待商家验收",REFUNDED:"模拟退款成功"};
const dispositionText:Record<string,string>={RELEASE_RESERVED:"释放预留库存",UNSHIPPED_RESTOCK:"未发货商品恢复库存",RESTOCK:"退货验收后重新入库",DISCARD:"报损，不回补库存"};
export const orderStatusText:Record<ShopOrder["status"],string>={PENDING_PAYMENT:"待模拟支付",PAID:"已模拟支付，待商家接单",ACCEPTED:"商家已接单",SHIPPED:"已模拟发货",COMPLETED:"已确认收货，订单完成",REFUND_PENDING:"退款处理中",REFUNDED:"已模拟退款",CANCELLED:"已取消",EXPIRED:"超时关闭"};

export function OrderLifecycle({order,role,onChanged}:{order:ShopOrder;role:"USER"|"MERCHANT";onChanged:(next:ShopOrder)=>void}) {
  const [data,setData]=useState<Lifecycle|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const [reason,setReason]=useState(""),[note,setNote]=useState(""),[disposition,setDisposition]=useState("DISCARD");
  const key=useRef<string|null>(null),generation=useRef(0),pending=useRef(false),callback=useRef(onChanged),lastStatus=useRef(order.status);
  callback.current=onChanged;
  const endpoint=`/api/${role==="USER"?"shop":"merchant"}/orders/${order.id}`;
  const errorText=(e:unknown)=>e instanceof ApiError&&e.status===409?"订单状态或审核结果已变化，请刷新后确认；重复操作不会重复退款。":e instanceof ApiError&&e.status===404?"订单不存在或无权访问。":e instanceof Error?e.message:"操作失败，请重试。";
  const load=useCallback(async()=>{
    if(pending.current)return;const run=++generation.current;
    try {const next=await api<Lifecycle>(`${endpoint}/lifecycle`);if(generation.current!==run)return;setData(next);setError("");if(next.order.status!==lastStatus.current){lastStatus.current=next.order.status;callback.current(next.order);}}
    catch(e){if(generation.current===run){setData(null);setError(errorText(e));}}
  },[endpoint]);
  useEffect(()=>{setData(null);setMessage("");setReason("");setNote("");key.current=null;void load();const refresh=()=>{if(document.visibilityState==="visible")void load();};const timer=setInterval(refresh,8000);window.addEventListener("online",refresh);return()=>{generation.current++;clearInterval(timer);window.removeEventListener("online",refresh);};},[load,order.status]);
  async function act(path:string,body?:unknown) {
    if(pending.current)return;pending.current=true;setBusy(true);setError("");generation.current++;const run=generation.current;
    try {const next=await api<Lifecycle>(endpoint+path,"POST",body);if(generation.current!==run)return;setData(next);lastStatus.current=next.order.status;setMessage("操作成功，仅更新演示订单，不涉及真实资金或物流。");callback.current(next.order);}
    catch(e){if(generation.current===run)setError(errorText(e));}
    finally{pending.current=false;setBusy(false);}
  }
  const latest=data?.refunds[0];
  return <section className="order-lifecycle" aria-label="模拟履约与退款">
    <div className="lifecycle-heading"><h3>模拟履约与退款</h3><button className="secondary" disabled={busy} onClick={()=>void load()}>刷新履约状态</button></div>
    <p className="note">仅整单全额模拟退款；不填写真实物流单号。退款处理中暂停接单、发货和收货。已发货商品须退货验收后才退款。</p>
    {error&&<p role="alert" className="error-notice">{error}</p>}{message&&<p role="status" className="notice">{message}</p>}
    {data&&<><p>当前状态：<strong>{orderStatusText[data.order.status]}</strong></p>
      {data.shipment&&<div className="shipment-card"><p>模拟发货单号：{data.shipment.trackingCode}</p><p>发货时间：{new Date(data.shipment.shippedAt).toLocaleString("zh-CN")}</p>{data.shipment.receivedAt&&<p>收货时间：{new Date(data.shipment.receivedAt).toLocaleString("zh-CN")}</p>}</div>}
      {role==="MERCHANT"&&data.order.status==="ACCEPTED"&&<button disabled={busy} onClick={()=>void act("/ship",{code:`DEMO-SHIP-${order.id}`})}>模拟发货</button>}
      {role==="USER"&&data.order.status==="SHIPPED"&&<button disabled={busy} onClick={()=>void act("/receive")}>确认模拟收货</button>}
      {role==="USER"&&["PAID","ACCEPTED","SHIPPED","COMPLETED"].includes(data.order.status)&&<form onSubmit={e=>{e.preventDefault();key.current??=crypto.randomUUID();void act("/refunds",{reason,clientKey:key.current});}}>
        <label>退款原因<textarea required maxLength={500} value={reason} onChange={e=>{setReason(e.target.value);key.current=null;}} placeholder="请输入演示退款原因，请勿填写健康隐私"/></label><button disabled={busy}>申请整单模拟退款</button></form>}
      {latest&&role==="MERCHANT"&&latest.status==="REQUESTED"&&<form onSubmit={e=>{e.preventDefault();void act(`/refunds/${latest.id}/review`,{approve:true,note});}}>
        <label>审核说明<textarea required maxLength={500} value={note} onChange={e=>setNote(e.target.value)}/></label><div className="lifecycle-actions"><button disabled={busy}>同意退款申请</button><button type="button" className="secondary" disabled={busy||!note.trim()} onClick={()=>void act(`/refunds/${latest.id}/review`,{approve:false,note})}>拒绝退款申请</button></div></form>}
      {latest&&role==="USER"&&latest.status==="AWAITING_RETURN"&&<button disabled={busy} onClick={()=>void act(`/refunds/${latest.id}/return`,{code:`DEMO-RETURN-${latest.id}`})}>提交模拟退货</button>}
      {latest&&role==="MERCHANT"&&latest.status==="RETURNED"&&<form onSubmit={e=>{e.preventDefault();void act(`/refunds/${latest.id}/inspect`,{disposition});}}>
        <label>退货验收库存处理<select value={disposition} onChange={e=>setDisposition(e.target.value)}><option value="DISCARD">报损，不回补库存</option><option value="RESTOCK">确认可再售，重新入库</option></select></label><p className="note">默认不入库。只有确认演示商品可再次销售时，才选择重新入库；验收提交后不可更改。</p><button disabled={busy}>确认验收并模拟退款</button></form>}
      {data.refunds.length>0&&<div className="refund-history" aria-label="退款申请记录"><h4>退款申请记录</h4>{data.refunds.map(r=><article key={r.id}><strong>申请 #{r.id} · {refundText[r.status]}</strong><p>原因：{r.reason}</p>{r.reviewNote&&<p>审核：{r.reviewNote}</p>}{r.returnCode&&<p>模拟退货单号：{r.returnCode}</p>}{r.disposition&&<p>库存处理：{dispositionText[r.disposition]}</p>}</article>)}</div>}
      <div aria-label="模拟退款流水"><h4>模拟退款流水</h4>{data.ledger.length?data.ledger.map(entry=><p key={entry.id}>流水 #{entry.id} · 退款申请 #{entry.refundId} · ¥{(entry.amountCents/100).toFixed(2)} · {new Date(entry.createdAt).toLocaleString("zh-CN")}（无真实资金）</p>):<p>暂无退款流水。</p>}</div>
    </>}
  </section>;
}
