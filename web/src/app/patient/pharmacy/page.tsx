"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AppNav } from "../../app-nav";
import { api, ApiError, homeForRole, type CartItem, type CurrentUser, type ShopOffer, type ShopOrder, type ShopOrderDetail, type ShopPage } from "@/lib/api";

const categories = ["全部", "健康器械", "日常用品", "营养补充"];
const yuan = (cents: number) => `¥${(cents / 100).toFixed(2)}`;
const orderStatus: Record<ShopOrder["status"], string> = { PENDING_PAYMENT: "待模拟支付", PAID: "已模拟支付，待商家接单", ACCEPTED: "商家已接单", CANCELLED: "已取消", EXPIRED: "超时关闭" };

export default function PharmacyPage() {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [view, setView] = useState<"catalog" | "cart" | "orders">("catalog");
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部");
  const [sort, setSort] = useState("NEWEST");
  const [page, setPage] = useState(0);
  const [results, setResults] = useState<ShopPage>({ items: [], total: 0, page: 0, size: 12 });
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orders, setOrders] = useState<ShopOrder[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<ShopOrderDetail | null>(null);
  const [detail, setDetail] = useState<ShopOffer | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api<CurrentUser>("/api/auth/me").then(current => {
      if (current.role !== "USER") { router.replace(homeForRole(current.role)); return; }
      setUser(current);
      void api<CartItem[]>("/api/shop/cart").then(setCart).catch(() => setError("购物车读取失败，请刷新后重试。"));
    }).catch(() => router.replace("/"));
  }, [router]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({ query, category: category === "全部" ? "" : category, sort, page: String(page), size: "12" });
    api<ShopPage>(`/api/shop/products?${params}`).then(result => { if (!cancelled) setResults(result); })
      .catch(() => { if (!cancelled) setError("商品搜索失败，请稍后重试。"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user, query, category, sort, page]);

  function search(event: FormEvent) {
    event.preventDefault(); setPage(0); setQuery(draft.trim()); setDetail(null); setView("catalog");
  }

  async function openDetail(skuId: number) {
    setError("");
    try { setDetail(await api<ShopOffer>(`/api/shop/products/${skuId}`)); }
    catch { setError("该商品已不可购买，请刷新搜索结果。"); }
  }

  async function addToCart(skuId: number) {
    setBusy(true); setError(""); setMessage("");
    try {
      setCart(await api<CartItem[]>("/api/shop/cart/items", "POST", { skuId, quantity: 1 }));
      setMessage("已加入购物车。下单时会重新核对价格与库存。");
    } catch (cause) {
      setError(cause instanceof ApiError && cause.status === 409
        ? "库存不足，或购物车中已有另一家店铺的商品。请先查看购物车并清理后重试。"
        : cause instanceof Error ? cause.message : "加入购物车失败，请重试。");
    } finally { setBusy(false); }
  }

  async function changeQuantity(item: CartItem, quantity: number) {
    if (quantity < 1 || quantity > 99) return;
    setBusy(true); setError("");
    try { setCart(await api<CartItem[]>(`/api/shop/cart/items/${item.id}`, "PUT", { quantity })); }
    catch (cause) { setError(cause instanceof ApiError && cause.status === 409 ? "库存已变化，无法设置该数量。" : "修改数量失败，请重试。"); }
    finally { setBusy(false); }
  }

  async function remove(item: CartItem) {
    setBusy(true); setError("");
    try { await api<void>(`/api/shop/cart/items/${item.id}`, "DELETE"); setCart(await api<CartItem[]>("/api/shop/cart")); }
    catch { setError("移除失败，请刷新后重试。"); }
    finally { setBusy(false); }
  }

  async function loadOrders() {
    try { setOrders(await api<ShopOrder[]>("/api/shop/orders")); }
    catch { setError("订单读取失败，请稍后重试。"); }
  }

  async function checkout() {
    setBusy(true); setError(""); setMessage("");
    const storageKey = "jwzz-checkout-key";
    const key = sessionStorage.getItem(storageKey) || crypto.randomUUID();
    sessionStorage.setItem(storageKey, key);
    try {
      const result = await api<ShopOrderDetail>("/api/shop/orders", "POST", { idempotencyKey: key });
      sessionStorage.removeItem(storageKey);
      setSelectedOrder(result); setCart([]); setView("orders");
      await loadOrders();
      setMessage(`演示订单 #${result.order.id} 已创建，库存已预留，请在 15 分钟内模拟支付。`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "下单失败，请刷新购物车重试。"); }
    finally { setBusy(false); }
  }

  async function openOrder(id: number) {
    setError("");
    try { setSelectedOrder(await api<ShopOrderDetail>(`/api/shop/orders/${id}`)); }
    catch { setError("订单详情读取失败。"); }
  }

  async function changeOrder(action: "pay" | "cancel") {
    if (!selectedOrder) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await api<ShopOrderDetail>(`/api/shop/orders/${selectedOrder.order.id}/${action}`, "POST");
      setSelectedOrder(result); await loadOrders();
      setMessage(result.order.status === "EXPIRED" ? "订单已超时，预留库存已释放。"
        : action === "pay" ? "模拟支付成功：没有发生真实资金交易。" : "订单已取消，预留库存已释放。");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "订单操作失败。"); }
    finally { setBusy(false); }
  }

  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const totalCents = cart.reduce((sum, item) => sum + item.priceCents * item.quantity, 0);
  const grouped = new Map<number, { storeName: string; city: string; address: string; offers: ShopOffer[] }>();
  for (const offer of results.items) {
    if (!grouped.has(offer.storeId)) grouped.set(offer.storeId, {
      storeName: offer.storeName, city: offer.storeCity, address: offer.storeAddress, offers: [],
    });
    grouped.get(offer.storeId)!.offers.push(offer);
  }

  return <><AppNav role="USER" active="pharmacy" /><main className="pharmacy-page shop-page">
    <section className="pharmacy-hero">
      <div className="pharmacy-hero-copy"><p className="pharmacy-kicker">见微知著 · 演示商城</p><h1>健康用品与演示店铺</h1><p>仅展示演示营业中、已上架且有可售库存的店铺商品。订单和支付仅作教学模拟，不发生真实交易。</p></div>
      <div className="pharmacy-hero-mark" aria-hidden="true"><span>＋</span><i>用品探索</i></div>
      <form className="pharmacy-search" role="search" onSubmit={search}><label className="sr-only" htmlFor="shop-search">搜索商品或店铺</label><span aria-hidden="true">⌕</span><input id="shop-search" value={draft} onChange={event => setDraft(event.target.value)} placeholder="搜索商品或演示店铺" /><button type="submit">搜索</button></form>
    </section>
    <div className="shop-toolbar"><div><button type="button" className={view === "catalog" ? "active" : ""} onClick={() => setView("catalog")}>商品与店铺</button><button type="button" className={view === "cart" ? "active" : ""} onClick={() => { setView("cart"); setDetail(null); }}>购物车（{cartCount}）</button><button type="button" className={view === "orders" ? "active" : ""} onClick={() => { setView("orders"); setDetail(null); void loadOrders(); }}>我的订单</button></div><p>不展示定位或附近药店；订单与支付均为模拟。</p></div>
    {message && <p role="status" className="notice">{message}</p>}
    {error && <p role="alert" className="error">{error}</p>}
    {view === "catalog" ? <>
      <section className="pharmacy-section shop-results"><div className="pharmacy-section-heading"><div><p className="pharmacy-kicker">IN-STOCK CATALOG</p><h2>{query ? `“${query}”的搜索结果` : "有货的演示用品"}</h2></div><p>{loading ? "正在搜索…" : `共 ${results.total} 项有货商品`}</p></div>
        <div className="shop-filters"><div className="pharmacy-category-tabs">{categories.map(item => <button type="button" key={item} className={category === item ? "active" : ""} onClick={() => { setCategory(item); setPage(0); setDetail(null); }}>{item}</button>)}</div><label>排序<select aria-label="商品排序" value={sort} onChange={event => { setSort(event.target.value); setPage(0); }}><option value="NEWEST">默认排序</option><option value="PRICE_ASC">价格从低到高</option><option value="PRICE_DESC">价格从高到低</option></select></label></div>
        {detail && <article className="shop-detail"><button type="button" className="shop-detail-close" onClick={() => setDetail(null)}>关闭详情</button><p className="pharmacy-kicker">商品详情 · #{detail.skuId}</p><h3>{detail.productName}</h3><p>{detail.description || "暂无商品说明。"}</p><p>{detail.category} · {detail.storeName} · {detail.storeCity} {detail.storeAddress}</p><strong>{yuan(detail.priceCents)}</strong><p>当前可售库存：{detail.available}；加入购物车不预留库存。</p><button type="button" disabled={busy} onClick={() => void addToCart(detail.skuId)}>加入购物车</button></article>}
        {loading ? <div className="pharmacy-empty">正在读取演示店铺商品…</div> : grouped.size === 0 ? <div className="pharmacy-empty">暂无符合条件的有货商品。请换个关键词或分类；商家商品需上架、有库存且店铺开启演示营业。</div> : <div className="shop-store-list">{Array.from(grouped, ([storeId, store]) => <article className="shop-store" key={storeId}><div className="shop-store-heading"><div><small>演示店铺 #{storeId} · {store.city}</small><h3>{store.storeName}</h3><p>{store.address}</p></div><span>仅供项目演示</span></div><div className="shop-offer-list">{store.offers.map(offer => <div className="shop-offer" key={offer.skuId}><div><small>{offer.category}</small><h4>{offer.productName}</h4><p>{offer.description}</p><span>可售 {offer.available} 件</span></div><div className="shop-offer-action"><strong>{yuan(offer.priceCents)}</strong><button type="button" onClick={() => void openDetail(offer.skuId)}>查看详情</button><button type="button" disabled={busy} onClick={() => void addToCart(offer.skuId)}>加入购物车</button></div></div>)}</div></article>)}</div>}
        {results.total > results.size && <div className="shop-pagination"><button type="button" disabled={page === 0} onClick={() => setPage(value => value - 1)}>上一页</button><span>第 {page + 1} 页</span><button type="button" disabled={(page + 1) * results.size >= results.total} onClick={() => setPage(value => value + 1)}>下一页</button></div>}
      </section>
    </> : view === "cart" ? <section className="pharmacy-section shop-cart"><div className="pharmacy-section-heading"><div><p className="pharmacy-kicker">YOUR CART</p><h2>购物车</h2></div><p>当前仅支持同一家店铺的商品</p></div>
      {cart.length === 0 ? <div className="pharmacy-empty">购物车还是空的。先去浏览有货的演示用品吧。</div> : <><p className="shop-cart-store">店铺：{cart[0].storeName}</p><div className="shop-cart-items">{cart.map(item => <article className="shop-cart-item" key={item.id}><div><h3>{item.productName}</h3><p>{yuan(item.priceCents)} / 件 · 当前可售 {item.available} 件</p>{!item.purchasable && <p className="error">商品已下架、店铺暂停或库存不足；请移除或稍后再试。</p>}</div><div className="shop-cart-actions"><button type="button" disabled={busy || item.quantity <= 1} onClick={() => void changeQuantity(item, item.quantity - 1)} aria-label={`减少${item.productName}数量`}>−</button><strong>{item.quantity}</strong><button type="button" disabled={busy || item.quantity >= 99} onClick={() => void changeQuantity(item, item.quantity + 1)} aria-label={`增加${item.productName}数量`}>＋</button><span>{yuan(item.priceCents * item.quantity)}</span><button type="button" onClick={() => void remove(item)} disabled={busy}>移除</button></div></article>)}</div><div className="shop-cart-total"><strong>商品合计：{yuan(totalCents)}</strong><p>提交订单时服务端会重新核对价格与库存，并预留 15 分钟；模拟支付不产生真实扣款。</p><button type="button" disabled={busy || cart.some(item => !item.purchasable)} onClick={() => void checkout()}>{busy ? "提交中…" : "提交演示订单"}</button></div></>}
    </section> : <section className="pharmacy-section shop-orders"><div className="pharmacy-section-heading"><div><p className="pharmacy-kicker">DEMO ORDERS</p><h2>我的订单</h2></div><p>最近 100 单 · 模拟支付</p></div><div className="shop-order-layout"><div className="shop-order-list">{orders.length === 0 ? <div className="pharmacy-empty">暂无演示订单。</div> : orders.map(order => <button type="button" key={order.id} className={selectedOrder?.order.id === order.id ? "active" : ""} onClick={() => void openOrder(order.id)}><strong>订单 #{order.id} · {order.storeName}</strong><span>{orderStatus[order.status]} · {yuan(order.totalCents)}</span></button>)}</div><div className="shop-order-detail">{selectedOrder ? <><h3>订单 #{selectedOrder.order.id}</h3><p>{selectedOrder.order.storeName} · {orderStatus[selectedOrder.order.status]}</p><p>创建时间：{new Date(selectedOrder.order.createdAt).toLocaleString("zh-CN")}</p>{selectedOrder.order.status === "PENDING_PAYMENT" && <p>支付截止：{new Date(selectedOrder.order.expiresAt).toLocaleString("zh-CN")}</p>}<div>{selectedOrder.items.map(item => <p key={item.id}>{item.productName} × {item.quantity} · {yuan(item.unitPriceCents * item.quantity)}</p>)}</div><strong>合计 {yuan(selectedOrder.order.totalCents)}</strong>{selectedOrder.order.status === "PENDING_PAYMENT" && <div className="shop-order-actions"><button type="button" disabled={busy} onClick={() => void changeOrder("pay")}>模拟支付</button><button type="button" disabled={busy} onClick={() => void changeOrder("cancel")}>取消订单</button></div>}<p className="note">此订单仅供演示，没有真实支付、发货或配送。</p></> : <p>选择左侧订单查看明细与可执行操作。</p>}</div></div></section>}
    <footer className="pharmacy-footer">本页只做教学演示，不提供药品销售、处方审核、真实支付或配送；不根据体检指标自动推荐药品或保健品。</footer>
  </main></>;
}
