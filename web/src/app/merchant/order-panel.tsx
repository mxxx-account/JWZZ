"use client";

import { useEffect, useState } from "react";
import { api, type ShopOrder, type ShopOrderDetail } from "@/lib/api";

const statusText: Record<ShopOrder["status"], string> = {
  PENDING_PAYMENT: "待用户模拟支付", PAID: "待接单", ACCEPTED: "已接单",
  CANCELLED: "用户已取消", EXPIRED: "超时关闭",
};

export function OrderPanel() {
  const [orders, setOrders] = useState<ShopOrder[]>([]);
  const [selected, setSelected] = useState<ShopOrderDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function reload() {
    try { setOrders(await api<ShopOrder[]>("/api/merchant/orders")); setError(""); }
    catch { setError("订单读取失败，请稍后重试。"); }
  }

  useEffect(() => { void reload(); }, []);

  async function open(id: number) {
    try { setSelected(await api<ShopOrderDetail>(`/api/merchant/orders/${id}`)); setError(""); }
    catch { setError("订单明细读取失败。"); }
  }

  async function accept(id: number) {
    setBusy(true); setMessage(""); setError("");
    try {
      const result = await api<ShopOrderDetail>(`/api/merchant/orders/${id}/accept`, "POST");
      setSelected(result);
      setMessage(`订单 #${result.order.id} 已演示接单，预留库存转为已售。`);
      await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "接单失败。"); }
    finally { setBusy(false); }
  }

  return <section className="workspace-panel merchant-orders-panel">
    <div className="merchant-panel-heading"><div><p className="pharmacy-kicker">DEMO ORDERS</p><h2>演示订单</h2></div><button type="button" onClick={() => void reload()}>刷新订单</button></div>
    <p className="note">用户先提交订单并模拟支付；只有已模拟支付的订单可接单。这里没有真实资金、发货或配送。</p>
    {message && <p role="status" className="notice">{message}</p>}{error && <p role="alert" className="error">{error}</p>}
    {orders.length === 0 ? <p>目前没有来自本店的演示订单。</p> : <div className="merchant-order-list">{orders.map(order => <article key={order.id}>
      <div><strong>订单 #{order.id} · {statusText[order.status]}</strong><p>用户 #{order.userId} · ¥{(order.totalCents / 100).toFixed(2)} · {new Date(order.createdAt).toLocaleString("zh-CN")}</p></div>
      <div className="merchant-order-actions"><button type="button" onClick={() => void open(order.id)}>查看明细</button>{order.status === "PAID" && <button type="button" disabled={busy} onClick={() => void accept(order.id)}>接受演示订单</button>}</div>
    </article>)}</div>}
    {selected && <div className="merchant-order-detail"><h3>订单 #{selected.order.id} · {statusText[selected.order.status]}</h3><p>用户 #{selected.order.userId} · 合计 ¥{(selected.order.totalCents / 100).toFixed(2)}</p>{selected.items.map(item => <p key={item.id}>{item.productName} × {item.quantity} · ¥{(item.unitPriceCents * item.quantity / 100).toFixed(2)}</p>)}</div>}
  </section>;
}
