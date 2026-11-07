"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AppNav } from "../../app-nav";
import { api, homeForRole, type CurrentUser } from "@/lib/api";
import { commonProducts as products, type CommonProduct as Product } from "./common-products";

type Pharmacy = { id: string; name: string; latitude: number; longitude: number; distanceMeters: number; address: string; openingHours: string; phone: string; osmUrl: string; demo?: boolean };
type NearbyResult = { source: "OPENSTREETMAP"; radiusMeters: number; pharmacies: Pharmacy[] };
type RegionResult = { label: string; source: "OPENSTREETMAP" };
type Location = { latitude: number; longitude: number; label: string; sample: boolean };
const sampleLocations = [
  { label: "武汉市中心（示例）", latitude: 30.5928, longitude: 114.3055 },
  { label: "上海市中心（示例）", latitude: 31.2304, longitude: 121.4737 },
  { label: "北京市中心（示例）", latitude: 39.9042, longitude: 116.4074 },
];
const categories = ["全部", "健康器械", "日常用品", "营养补充"] as const;
// 暂停位置发现功能：保留定位、地图查询和列表实现，日后可通过环境变量恢复。
const locationDiscoveryEnabled = process.env.NEXT_PUBLIC_ENABLE_LOCATION_DISCOVERY === "true";

function distanceText(meters: number) { return meters < 1000 ? `${meters} m` : `${(meters / 1000).toFixed(1)} km`; }
function productMatches(product: Product, query: string) {
  return `${product.name} ${product.category} ${product.keywords}`.toLowerCase().includes(query.toLowerCase());
}
function demoStores(location: Location): Pharmacy[] {
  return [320, 850, 1500].map((distanceMeters, index) => ({
    id: `demo-${index}`, name: `演示药店 · ${["中心店", "街区店", "西路店"][index]}`,
    latitude: location.latitude, longitude: location.longitude, distanceMeters,
    address: "虚构地址，仅供界面体验", openingHours: "", phone: "", osmUrl: "", demo: true,
  }));
}

export default function PharmacyPage() {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [location, setLocation] = useState<Location | null>(null);
  const [locating, setLocating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [locationFeedback, setLocationFeedback] = useState("");
  const locationRequest = useRef(0);
  const [lookupError, setLookupError] = useState("");
  const [pharmacies, setPharmacies] = useState<Pharmacy[]>([]);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<(typeof categories)[number]>("全部");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    api<CurrentUser>("/api/auth/me").then(current => {
      if (current.role !== "USER") { router.replace(homeForRole(current.role)); return; }
      setUser(current);
    }).catch(() => router.replace("/"));
  }, [router]);

  useEffect(() => {
    if (!locationDiscoveryEnabled || !user || !location) return;
    let cancelled = false;
    setLoading(true); setLookupError(""); setPharmacies([]);
    api<NearbyResult>(`/api/pharmacies/nearby?lat=${location.latitude}&lon=${location.longitude}`)
      .then(result => { if (!cancelled) setPharmacies(result.pharmacies); })
      .catch(() => { if (!cancelled) {
        if (location.sample) {
          setPharmacies(demoStores(location));
          setLookupError("地图服务暂不可用；以下是虚构的演示药店，仅供查看页面流程，不能用于实际购药。");
        } else setLookupError("地图服务暂时无法返回附近药店。请稍后重试，或切换示例位置。");
      } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user, location, reload]);

  function useCurrentLocation() {
    setLocationError(""); setLocationFeedback("");
    if (!navigator.geolocation) { setLocationError("当前浏览器不支持定位。请使用示例位置体验页面。"); return; }
    const requestId = ++locationRequest.current;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(position => {
      if (requestId !== locationRequest.current) return;
      const latitude = position.coords.latitude;
      const longitude = position.coords.longitude;
      setLocation({ latitude, longitude, label: "当前位置（地区识别中）", sample: false });
      setLocationFeedback("定位成功，正在识别所在地区…");
      setLocating(false);
      api<RegionResult>(`/api/pharmacies/region?lat=${latitude}&lon=${longitude}`)
        .then(region => {
          if (requestId !== locationRequest.current) return;
          setLocation({ latitude, longitude, label: region.label, sample: false });
          setLocationFeedback(`定位成功，当前大致地区：${region.label}`);
        })
        .catch(() => {
          if (requestId !== locationRequest.current) return;
          setLocation({ latitude, longitude, label: "当前位置（地区名称暂不可用）", sample: false });
          setLocationFeedback(`定位成功，但地区名称暂时无法解析；位置约为北纬 ${latitude.toFixed(2)}°、东经 ${longitude.toFixed(2)}°。`);
        });
    }, error => {
      if (requestId !== locationRequest.current) return;
      setLocationError(error.code === 1 ? "未获得定位权限。你可以在浏览器中允许定位，或使用示例位置。"
        : "暂时无法获取定位。请稍后重试，或使用示例位置。");
      setLocating(false);
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
  }

  function useSampleLocation(label: string) {
    const selected = sampleLocations.find(item => item.label === label);
    if (!selected) return;
    locationRequest.current += 1;
    setLocating(false); setLocationError("");
    setLocation({ ...selected, sample: true });
    setLocationFeedback(`已选择${selected.label}；这不是你的当前定位。`);
  }

  function search(event: FormEvent) {
    event.preventDefault();
    setQuery(draft.trim());
  }

  function searchFor(value: string) { setDraft(value); setQuery(value); window.scrollTo({ top: 0, behavior: "smooth" }); }
  const filteredProducts = products.filter(product => category === "全部" || product.category === category);
  const matches = query ? products.filter(product => productMatches(product, query)) : [];

  return <><AppNav role="USER" active="pharmacy" /><main className="pharmacy-page">
    <section className="pharmacy-hero">
      <div className="pharmacy-hero-copy"><p className="pharmacy-kicker">见微知著 · 健康用品</p><h1>健康用品目录</h1><p>浏览和搜索健康用品示例，了解常见品类。本页暂无商家库存、价格或在线购买功能。</p></div>
      <div className="pharmacy-hero-mark" aria-hidden="true"><span>＋</span><i>用品探索</i></div>
      <form className="pharmacy-search" role="search" onSubmit={search}><label className="sr-only" htmlFor="pharmacy-search-input">搜索健康用品</label><span aria-hidden="true">⌕</span><input id="pharmacy-search-input" value={draft} onChange={event => setDraft(event.target.value)} placeholder="搜索健康用品示例" /><button type="submit">搜索</button></form>
    </section>

    {locationDiscoveryEnabled && <>
      <div className="pharmacy-location-bar"><div><strong>⌖ {location?.label ?? "尚未选择位置"}</strong><small>{location ? `${location.sample ? "示例位置 · " : ""}附近 5 km · 按直线距离排序` : "定位仅在你点击后获取，不会写入账号资料"}</small></div><div className="pharmacy-location-actions"><button type="button" onClick={useCurrentLocation} disabled={locating}>{locating ? "正在定位…" : "使用当前位置"}</button><label>或选择示例位置<select aria-label="示例位置" value="" onChange={event => useSampleLocation(event.target.value)}><option value="">选择城市</option>{sampleLocations.map(item => <option key={item.label} value={item.label}>{item.label}</option>)}</select></label></div></div>
      {locationFeedback && <p role="status" className="pharmacy-location-success">{locationFeedback}</p>}
      {locationError && <p role="status" className="pharmacy-alert">{locationError}</p>}
      {lookupError && <p role="status" className="pharmacy-alert">{lookupError} <button type="button" onClick={() => setReload(value => value + 1)}>重试</button></p>}
    </>}

    {!query ? <>
      <section className="pharmacy-section"><div className="pharmacy-section-heading"><div><p className="pharmacy-kicker">SHOP BY NEED</p><h2>常见健康用品</h2></div><p>示例品类，不是销量榜或个人医疗推荐</p></div><div className="pharmacy-category-tabs">{categories.map(item => <button type="button" key={item} className={category === item ? "active" : ""} onClick={() => setCategory(item)}>{item}</button>)}</div><div className="pharmacy-product-grid">{filteredProducts.map(product => <button type="button" className="pharmacy-product-card" key={product.name} onClick={() => searchFor(product.name)}><span className={`pharmacy-product-icon ${product.category === "营养补充" ? "supplement" : product.category === "日常用品" ? "daily" : "device"}`} aria-hidden="true">{product.icon}</span><span className="pharmacy-product-type">{product.category}</span><strong>{product.name}</strong><small>{product.description}</small><span className="pharmacy-product-link">查看用品信息 →</span></button>)}</div></section>
      {locationDiscoveryEnabled && <section className="pharmacy-section"><div className="pharmacy-section-heading"><div><p className="pharmacy-kicker">NEAR YOU</p><h2>附近药店</h2></div><p>仅按位置展示，不代表好评、资质或商品库存</p></div><PharmacyList pharmacies={pharmacies.slice(0, 6)} loading={loading} hasLocation={Boolean(location)} emptyText="附近暂未找到地图标注的药店。" />{pharmacies.length > 6 && <button className="pharmacy-show-all" type="button" onClick={() => searchFor("药店")}>查看全部 {pharmacies.length} 家附近药店 →</button>}</section>}
    </> : <>
      <button className="pharmacy-back" type="button" onClick={() => { setQuery(""); setDraft(""); }}>← 返回用品目录</button>
      <section className="pharmacy-section"><div className="pharmacy-section-heading"><div><p className="pharmacy-kicker">SEARCH RESULTS</p><h2>“{query}”的搜索结果</h2></div><p>示例用品 · {matches.length} 项</p></div><div className="pharmacy-search-disclaimer">仅展示健康用品示例品类，不代表商家有货、价格或个人医疗推荐。本页暂不提供下单和配送服务。</div>{matches.length ? <div className="pharmacy-product-grid">{matches.map(product => <article className="pharmacy-product-card" key={product.name}><span className={`pharmacy-product-icon ${product.category === "营养补充" ? "supplement" : product.category === "日常用品" ? "daily" : "device"}`} aria-hidden="true">{product.icon}</span><span className="pharmacy-product-type">{product.category}</span><strong>{product.name}</strong><small>{product.description}</small></article>)}</div> : <div className="pharmacy-empty">暂无匹配的示例用品，请尝试其他关键词。</div>}</section>
    </>}
    <footer className="pharmacy-footer"><span>本页内容仅供了解常见健康用品，不提供诊断或处方建议。</span>{locationDiscoveryEnabled && <span>药店位置数据：<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a></span>}</footer>
  </main></>;
}

function PharmacyList({ pharmacies, loading, hasLocation, emptyText }: { pharmacies: Pharmacy[]; loading: boolean; hasLocation: boolean; emptyText: string }) {
  if (!hasLocation) return <div className="pharmacy-empty">选择“使用当前位置”或一个示例城市后，这里会显示附近药店。</div>;
  if (loading) return <div className="pharmacy-empty">正在查询附近药店…</div>;
  if (pharmacies.length === 0) return <div className="pharmacy-empty">{emptyText}</div>;
  return <div className="pharmacy-store-list">{pharmacies.map((store, index) => <article className="pharmacy-store-card" key={store.id}><span className="pharmacy-store-avatar" aria-hidden="true">药</span><div className="pharmacy-store-body"><div className="pharmacy-store-top"><div><small>{store.demo ? "虚构演示" : "附近药店"} #{index + 1}</small><h3>{store.name}</h3></div><strong>{distanceText(store.distanceMeters)}</strong></div><p>{store.address || "地图暂未提供详细地址"}</p>{store.openingHours && <small>地图标注营业时间：{store.openingHours}（可能变化）</small>}<div className="pharmacy-store-actions"><span>{store.demo ? "不可用于实际购药" : "库存与价格待核实"}</span>{store.phone && !store.demo && <a href={`tel:${store.phone.replace(/[^+\d]/g, "")}`}>致电药店</a>}{!store.demo && <a href={store.osmUrl} target="_blank" rel="noreferrer">查看地图 ↗</a>}</div></div></article>)}</div>;
}
