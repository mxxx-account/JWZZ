"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AppNav } from "../app-nav";
import { api, ApiError, homeForRole, type CurrentUser, type MerchantStore } from "@/lib/api";

type StoreForm = { name: string; description: string; city: string; address: string };
const emptyStore: StoreForm = { name: "", description: "", city: "", address: "" };

export default function MerchantPage() {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [store, setStore] = useState<MerchantStore | null>(null);
  const [form, setForm] = useState<StoreForm>(emptyStore);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api<CurrentUser>("/api/auth/me").then(async current => {
      if (current.role !== "MERCHANT") { router.replace(homeForRole(current.role)); return; }
      setUser(current);
      try {
        const ownStore = await api<MerchantStore>("/api/merchant/store");
        setStore(ownStore);
        setForm({ name: ownStore.name, description: ownStore.description, city: ownStore.city, address: ownStore.address });
      } catch (cause) {
        if (!(cause instanceof ApiError && cause.status === 404)) setError("店铺资料读取失败，请刷新后重试。");
      } finally { setLoading(false); }
    }).catch(() => router.replace("/"));
  }, [router]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true); setMessage(""); setError("");
    try {
      const updated = await api<MerchantStore>("/api/merchant/store", store ? "PUT" : "POST", form);
      setStore(updated);
      setMessage(store ? "店铺资料已保存。" : "店铺已创建，可继续完善资料。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败，请稍后重试。");
    } finally { setSaving(false); }
  }

  return <><AppNav role="MERCHANT" active="home" /><main className="shell merchant-home">
    <p className="eyebrow">商家账号：{user?.name || user?.email || "加载中…"} · {user?.email}</p>
    <h1>商家首页</h1>
    <p className="lead">创建并维护你的演示店铺</p>
    <p className="note">当前是第一阶段：仅管理店铺资料。商品、库存、订单、模拟支付和商家消息会在后续阶段逐项开发。商家注册和店铺资料不代表真实经营资质已审核。</p>
    {loading ? <p role="status" className="notice">正在读取店铺资料…</p> : <section className="workspace-panel merchant-store-panel">
      <div className="merchant-panel-heading"><div><p className="pharmacy-kicker">STORE PROFILE</p><h2>{store ? store.name : "创建店铺"}</h2></div><span className="merchant-store-status">{store ? "草稿店铺" : "尚未创建"}</span></div>
      <p className="note">每个商家账号目前只能创建一家店铺。资料只在商家端显示；商品上架功能上线前，不会出现在用户搜索结果中。</p>
      <form className="merchant-store-form" onSubmit={save}>
        <label>店铺名称<input required maxLength={80} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="例如：健康用品演示店" /></label>
        <label>所在城市<input required maxLength={80} value={form.city} onChange={event => setForm({ ...form, city: event.target.value })} placeholder="例如：武汉市" /></label>
        <label className="merchant-wide">店铺地址<input required maxLength={200} value={form.address} onChange={event => setForm({ ...form, address: event.target.value })} placeholder="填写演示地址，不要冒用真实药店" /></label>
        <label className="merchant-wide">店铺简介<textarea maxLength={500} value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} placeholder="介绍店铺经营方向（选填）" /></label>
        <button type="submit" disabled={saving}>{saving ? "保存中…" : store ? "保存店铺资料" : "创建店铺"}</button>
      </form>
      {message && <p role="status" className="notice">{message}</p>}
      {error && <p role="alert" className="error">{error}</p>}
    </section>}
  </main></>;
}
