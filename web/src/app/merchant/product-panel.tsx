"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api, type InventoryLedger, type MerchantProduct, type ProductTemplate } from "@/lib/api";

const categories = ["健康器械", "日常用品", "营养补充"];
const statusName = { ON_SHELF: "已上架", OFF_SHELF: "未上架", ARCHIVED: "已移除" };
const yuan = (cents: number) => `¥${(cents / 100).toFixed(2)}`;

function priceToCents(input: string): number | null {
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(input)) return null;
  const [whole, decimal = ""] = input.split(".");
  const cents = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
  return cents >= 1 && cents <= 100_000_000 ? cents : null;
}

export function ProductPanel({ storeId, refreshRevision }: { storeId: number; refreshRevision: number }) {
  const refreshSequence = useRef(0);
  const [products, setProducts] = useState<MerchantProduct[]>([]);
  const [templates, setTemplates] = useState<ProductTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [templatePrice, setTemplatePrice] = useState("100.00");
  const [custom, setCustom] = useState({ name: "", category: categories[0], description: "", price: "" });
  const [editing, setEditing] = useState<{ id: number; name: string; description: string; price: string } | null>(null);
  const [stock, setStock] = useState<{ id: number; available: string; note: string } | null>(null);
  const [ledgerId, setLedgerId] = useState<number | null>(null);
  const [ledger, setLedger] = useState<InventoryLedger[]>([]);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    try {
      const [productResult, templateResult] = await Promise.all([
        api<MerchantProduct[]>("/api/merchant/products"), api<ProductTemplate[]>("/api/merchant/templates"),
      ]);
      if (sequence === refreshSequence.current) {
        setProducts(productResult); setTemplates(templateResult); setError("");
      }
    } catch { if (sequence === refreshSequence.current) setError("商品资料读取失败，请点击刷新商品与库存重试。"); }
    finally { if (sequence === refreshSequence.current) setLoading(false); }
  }, []);

  useEffect(() => {
    void refresh();
    return () => { refreshSequence.current++; };
  }, [storeId, refreshRevision, refresh]);

  async function run(action: () => Promise<unknown>, success: string): Promise<boolean> {
    setBusy(true); setError(""); setMessage("");
    try { await action(); await refresh(); setMessage(success); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败，请重试。"); return false; }
    finally { setBusy(false); }
  }

  async function addTemplate(event: FormEvent) {
    event.preventDefault();
    const cents = priceToCents(templatePrice);
    if (!templateId || cents === null) { setError("请选择模板，并填写大于 0、最多两位小数的演示价格。"); return; }
    if (await run(() => api("/api/merchant/products", "POST", { templateId: Number(templateId), priceCents: cents }), "模板商品已加入店铺，初始库存为 0、默认未上架。")) setTemplateId("");
  }

  async function addCustom(event: FormEvent) {
    event.preventDefault();
    const cents = priceToCents(custom.price);
    if (cents === null) { setError("请填写大于 0、最多两位小数的演示价格。"); return; }
    if (await run(() => api("/api/merchant/products", "POST", {
      name: custom.name, category: custom.category, description: custom.description, priceCents: cents,
    }), "自定义演示用品已添加，初始库存为 0、默认未上架。"))
      setCustom({ name: "", category: categories[0], description: "", price: "" });
  }

  async function saveProduct(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    const cents = priceToCents(editing.price);
    if (cents === null) { setError("请填写大于 0、最多两位小数的演示价格。"); return; }
    if (await run(() => api(`/api/merchant/products/${editing.id}`, "PUT", {
      name: editing.name, description: editing.description, priceCents: cents,
    }), "商品资料已保存。")) setEditing(null);
  }

  async function saveStock(event: FormEvent) {
    event.preventDefault();
    if (!stock) return;
    const target = Number(stock.available);
    if (!/^\d+$/.test(stock.available) || target > 1_000_000) {
      setError("可售库存必须是 0 至 1000000 的整数。"); return;
    }
    if (await run(() => api(`/api/merchant/products/${stock.id}/inventory`, "PUT", {
      available: target, note: stock.note,
    }), "库存已更新，变动已记入流水。")) setStock(null);
  }

  async function showLedger(id: number) {
    if (ledgerId === id) { setLedgerId(null); return; }
    try {
      setLedger(await api<InventoryLedger[]>(`/api/merchant/products/${id}/inventory/ledger`));
      setLedgerId(id); setError("");
    } catch { setError("库存流水读取失败，请重试。"); }
  }

  const availableTemplates = templates.filter(item => !products.some(product => product.templateId === item.id));

  return <section className="workspace-panel merchant-products" aria-label="商品与库存管理">
    <div className="merchant-panel-heading"><div><p className="pharmacy-kicker">PRODUCTS & STOCK</p><h2>商品与库存管理</h2></div><span className="merchant-store-status">{products.length} 项商品</span><button type="button" disabled={busy} onClick={() => void refresh()}>刷新商品与库存</button></div>
    <p className="note">系统预置三项演示器械，价格可修改，初始库存为 0、默认未上架。这里的“上架”仅用于商家后台演示；草稿店铺不会出现在用户药店页。</p>
    {message && <p role="status" className="notice">{message}</p>}
    {error && <p role="alert" className="error">{error}</p>}
    {loading ? <p>正在读取商品…</p> : <>
      <div className="merchant-add-grid">
        <form onSubmit={addTemplate} className="merchant-product-form">
          <h3>从示例目录选品</h3>
          <label>商品模板<select value={templateId} onChange={event => setTemplateId(event.target.value)} required><option value="">选择尚未加入的用品</option>{availableTemplates.map(item => <option key={item.id} value={item.id}>{item.name} · {item.category}</option>)}</select></label>
          <label>演示售价（元）<input inputMode="decimal" value={templatePrice} onChange={event => setTemplatePrice(event.target.value)} required /></label>
          <button type="submit" disabled={busy || availableTemplates.length === 0}>加入店铺</button>
        </form>
        <form onSubmit={addCustom} className="merchant-product-form">
          <h3>添加自定义演示用品</h3>
          <label>商品名称<input required maxLength={80} value={custom.name} onChange={event => setCustom({ ...custom, name: event.target.value })} /></label>
          <label>品类<select value={custom.category} onChange={event => setCustom({ ...custom, category: event.target.value })}>{categories.map(item => <option key={item}>{item}</option>)}</select></label>
          <label>演示售价（元）<input inputMode="decimal" required value={custom.price} onChange={event => setCustom({ ...custom, price: event.target.value })} /></label>
          <label>说明<textarea maxLength={500} value={custom.description} onChange={event => setCustom({ ...custom, description: event.target.value })} /></label>
          <button type="submit" disabled={busy}>添加用品</button>
        </form>
      </div>
      <h3>本店商品</h3>
      <div className="merchant-product-list">{products.map(product => <article className="merchant-product-item" key={product.id} data-sku-id={product.id}>
        <div className="merchant-product-summary"><div><small>{product.category} · {product.templateId ? "示例模板" : "自定义"} · 编号 #{product.id}</small><h4>{product.name}</h4><p>{product.description || "暂无说明"}</p></div><span className="merchant-product-price">{yuan(product.priceCents)}</span></div>
        <div className="merchant-product-meta"><span className={product.status === "ON_SHELF" ? "is-listed" : ""}>{statusName[product.status]}</span><span>可售库存：<strong>{product.available}</strong></span><span>已预留：{product.reserved}</span></div>
        <div className="merchant-product-actions">
          {product.status !== "ARCHIVED" && <button type="button" disabled={busy} onClick={() => { setEditing({ id: product.id, name: product.name, description: product.description, price: (product.priceCents / 100).toFixed(2) }); setStock(null); }}>编辑资料</button>}
          {product.status !== "ARCHIVED" && <button type="button" disabled={busy} onClick={() => { setStock({ id: product.id, available: String(product.available), note: "" }); setEditing(null); }}>调整库存</button>}
          <button type="button" disabled={busy} onClick={() => void showLedger(product.id)}>库存流水</button>
          <button type="button" disabled={busy} onClick={() => void run(() => api(`/api/merchant/products/${product.id}/status`, "PUT", { status: product.status === "ON_SHELF" || product.status === "ARCHIVED" ? "OFF_SHELF" : "ON_SHELF" }), product.status === "ON_SHELF" ? "商品已下架。" : product.status === "ARCHIVED" ? "商品已恢复为未上架。" : "商品已上架（仅商家后台演示）。")}>{product.status === "ON_SHELF" ? "下架" : product.status === "ARCHIVED" ? "恢复" : "上架"}</button>
          {product.status !== "ARCHIVED" && <button className="merchant-remove" type="button" disabled={busy} onClick={() => void run(() => api(`/api/merchant/products/${product.id}/status`, "PUT", { status: "ARCHIVED" }), "商品已从在售目录移除，历史库存流水保留。")}>移除</button>}
        </div>
        {editing?.id === product.id && <form className="merchant-inline-form" onSubmit={saveProduct}><h5>编辑商品 #{product.id}</h5><label>商品名称<input required maxLength={80} value={editing.name} onChange={event => setEditing({ ...editing, name: event.target.value })} /></label><label>演示售价（元）<input required inputMode="decimal" value={editing.price} onChange={event => setEditing({ ...editing, price: event.target.value })} /></label><label>说明<textarea maxLength={500} value={editing.description} onChange={event => setEditing({ ...editing, description: event.target.value })} /></label><div><button type="submit" disabled={busy}>保存商品</button><button type="button" onClick={() => setEditing(null)}>取消</button></div></form>}
        {stock?.id === product.id && <form className="merchant-inline-form" onSubmit={saveStock}><h5>调整 #{product.id} 可售库存</h5><label>目标库存<input type="number" min={0} max={1_000_000} step={1} required value={stock.available} onChange={event => setStock({ ...stock, available: event.target.value })} /></label><label>调整说明<textarea maxLength={200} value={stock.note} onChange={event => setStock({ ...stock, note: event.target.value })} placeholder="例如：演示入库 5 件" /></label><div><button type="submit" disabled={busy}>保存库存</button><button type="button" onClick={() => setStock(null)}>取消</button></div></form>}
        {ledgerId === product.id && <div className="merchant-ledger"><strong>最近 100 条库存流水</strong>{ledger.length ? <ul>{ledger.map(item => <li key={item.id}>{new Date(item.createdAt).toLocaleString("zh-CN")} · {item.beforeAvailable} → {item.afterAvailable}（{item.delta > 0 ? "+" : ""}{item.delta}）{item.note && ` · ${item.note}`}</li>)}</ul> : <p>暂无库存变动。</p>}</div>}
      </article>)}</div>
    </>}
  </section>;
}
