"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";

const STATUS_META = {
  pending: { label: "新訂單", className: "pending" },
  accepted: { label: "製作中", className: "accepted" },
  completed: { label: "已完成", className: "completed" },
  cancelled: { label: "已取消", className: "cancelled" },
};
const CLOSED_DEFAULT = "目前尚未營業，請稍後再來。";

function formatTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}
function localDateKey(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function friendlyError(error, fallback = "操作失敗，請稍後再試。") {
  const message = String(error?.message || error || "").toLowerCase();
  if (!message) return fallback;
  if (message.includes("invalid login credentials")) return "帳號或密碼不正確。";
  if (message.includes("email not confirmed")) return "此管理員帳號尚未完成 Email 驗證。";
  if (message.includes("failed to fetch") || message.includes("network")) return "網路連線異常，請確認網路後再試。";
  if (message.includes("permission denied") || message.includes("row-level security")) return "目前帳號沒有操作權限，請確認 Supabase 後台權限設定。";
  if (message.includes("jwt") || message.includes("session")) return "登入已過期，請重新登入。";
  return fallback;
}

export default function AdminPage() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [section, setSection] = useState("orders");

  const [orders, setOrders] = useState([]);
  const [itemsByOrder, setItemsByOrder] = useState({});
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [filter, setFilter] = useState("active");
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState("today");
  const [customDate, setCustomDate] = useState(localDateKey());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [storeSettings, setStoreSettings] = useState({ is_open: true, closed_message: CLOSED_DEFAULT });
  const [savingStore, setSavingStore] = useState(false);
  const [updatingOrder, setUpdatingOrder] = useState(null);

  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [productLoading, setProductLoading] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [savingProduct, setSavingProduct] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session || null); setAuthLoading(false); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => { setSession(nextSession || null); setAuthLoading(false); });
    return () => listener.subscription.unsubscribe();
  }, []);

  const loadDashboard = useCallback(async () => {
    if (!session) return;
    setLoading(true); setError("");
    try {
      const [{ data: orderRows, error: ordersError }, { data: setting, error: settingError }] = await Promise.all([
        supabase.from("orders").select("id,order_number,customer_name,customer_phone,note,total_amount,status,created_at").order("created_at", { ascending: false }).limit(500),
        supabase.from("store_settings").select("is_open,closed_message").eq("id", 1).single(),
      ]);
      if (ordersError) throw ordersError;
      if (settingError) throw settingError;
      setOrders(orderRows || []);
      setStoreSettings({ is_open: setting?.is_open !== false, closed_message: setting?.closed_message || CLOSED_DEFAULT });
      const orderIds = (orderRows || []).map(o => o.id);
      if (orderIds.length) {
        const { data: itemRows, error: itemsError } = await supabase.from("order_items").select("id,order_id,product_name,pricing_type,quantity,unit_price,selected_amount,subtotal").in("order_id", orderIds);
        if (itemsError) throw itemsError;
        const grouped = {};
        for (const item of itemRows || []) { if (!grouped[item.order_id]) grouped[item.order_id] = []; grouped[item.order_id].push(item); }
        setItemsByOrder(grouped);
      } else setItemsByOrder({});
    } catch (err) { setError(friendlyError(err, "後台資料讀取失敗，請重新整理。")); }
    finally { setLoading(false); }
  }, [session]);

  const loadProducts = useCallback(async () => {
    if (!session) return;
    setProductLoading(true); setError("");
    try {
      const [{ data: catRows, error: catError }, { data: prodRows, error: prodError }] = await Promise.all([
        supabase.from("categories").select("id,name,sort_order,is_active").order("sort_order"),
        supabase.from("products").select("id,category_id,name,pricing_type,price,min_amount,max_amount,amount_step,sort_order,is_active").order("sort_order"),
      ]);
      if (catError) throw catError; if (prodError) throw prodError;
      setCategories(catRows || []); setProducts(prodRows || []);
    } catch (err) { setError(friendlyError(err, "商品資料讀取失敗。請先執行 V8 權限 SQL。")); }
    finally { setProductLoading(false); }
  }, [session]);

  useEffect(() => {
    if (!session) return;
    loadDashboard(); loadProducts();
    const channel = supabase.channel("admin-v8")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => loadDashboard())
      .on("postgres_changes", { event: "*", schema: "public", table: "order_items" }, () => loadDashboard())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "store_settings", filter: "id=eq.1" }, payload => {
        const next = payload.new || {}; setStoreSettings({ is_open: next.is_open !== false, closed_message: next.closed_message || CLOSED_DEFAULT });
      }).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [session, loadDashboard, loadProducts]);

  const todayKey = localDateKey();
  const yesterdayKey = localDateKey(new Date(Date.now() - 86400000));
  const todayOrders = useMemo(() => orders.filter(o => localDateKey(o.created_at) === todayKey), [orders, todayKey]);
  const todayRevenue = todayOrders.filter(o => o.status !== "cancelled").reduce((s, o) => s + Number(o.total_amount || 0), 0);
  const pendingCount = todayOrders.filter(o => o.status === "pending").length;
  const acceptedCount = todayOrders.filter(o => o.status === "accepted").length;
  const completedCount = todayOrders.filter(o => o.status === "completed").length;

  const visibleOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter(order => {
      const statusOk = filter === "all" ? true : filter === "active" ? ["pending", "accepted"].includes(order.status) : order.status === filter;
      const orderKey = localDateKey(order.created_at);
      const dateOk = dateFilter === "all" ? true : dateFilter === "today" ? orderKey === todayKey : dateFilter === "yesterday" ? orderKey === yesterdayKey : orderKey === customDate;
      const searchOk = !q || String(order.order_number || "").includes(q) || String(order.customer_name || "").toLowerCase().includes(q) || String(order.customer_phone || "").includes(q);
      return statusOk && dateOk && searchOk;
    });
  }, [orders, filter, search, dateFilter, customDate, todayKey, yesterdayKey]);

  const categoryName = id => categories.find(c => c.id === id)?.name || "未分類";
  const visibleProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    return products.filter(p => !q || p.name.toLowerCase().includes(q) || categoryName(p.category_id).toLowerCase().includes(q));
  }, [products, productSearch, categories]);

  async function signIn(e) {
    e.preventDefault(); setLoggingIn(true); setLoginError("");
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setLoginError(friendlyError(error, "登入失敗，請確認帳號與密碼。"));
    setLoggingIn(false);
  }
  async function updateStore(nextOpen) {
    setSavingStore(true); setError("");
    const { error } = await supabase.from("store_settings").update({ is_open: nextOpen, closed_message: storeSettings.closed_message, updated_at: new Date().toISOString() }).eq("id", 1);
    if (error) setError(friendlyError(error, "營業狀態更新失敗。")); else setStoreSettings(prev => ({ ...prev, is_open: nextOpen }));
    setSavingStore(false);
  }
  async function saveClosedMessage() {
    setSavingStore(true); setError("");
    const { error } = await supabase.from("store_settings").update({ closed_message: storeSettings.closed_message, updated_at: new Date().toISOString() }).eq("id", 1);
    if (error) setError(friendlyError(error, "休息訊息儲存失敗。")); setSavingStore(false);
  }
  async function updateStatus(orderId, status) {
    const labels = { accepted: "開始製作這筆訂單", completed: "將這筆訂單標記為完成", cancelled: "取消這筆訂單", pending: "恢復這筆訂單" };
    if (!window.confirm(`確定要${labels[status] || "變更訂單狀態"}嗎？`)) return;
    setUpdatingOrder(orderId); setError("");
    const { error } = await supabase.from("orders").update({ status }).eq("id", orderId);
    if (error) setError(friendlyError(error, "訂單狀態更新失敗。"));
    else { setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status } : o)); setSelectedOrder(prev => prev?.id === orderId ? { ...prev, status } : prev); }
    setUpdatingOrder(null);
  }
  function editProduct(id, field, value) { setProducts(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p)); }
  async function saveProduct(product) {
    setSavingProduct(product.id); setError("");
    const payload = { is_active: !!product.is_active, sort_order: Number(product.sort_order || 0) };
    if (product.pricing_type === "fixed") payload.price = Number(product.price || 0);
    else { payload.min_amount = Number(product.min_amount || 0); payload.max_amount = Number(product.max_amount || 0); payload.amount_step = Number(product.amount_step || 0); }
    const { error } = await supabase.from("products").update(payload).eq("id", product.id);
    if (error) setError(friendlyError(error, "商品儲存失敗。請確認 V8 商品權限 SQL 已執行。"));
    setSavingProduct(null);
  }

  if (authLoading) return <main className="admin-shell"><div className="admin-state">正在開啟店家後台…</div></main>;
  if (!session) return <main className="admin-login-page"><div className="admin-login-card"><div className="admin-brand-mark">漁</div><h1>漁光閃閃</h1><p>店家管理後台</p><form onSubmit={signIn}><label>管理員帳號</label><input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" placeholder="Email" required/><label>密碼</label><input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" placeholder="請輸入密碼" required/>{loginError && <div className="admin-error">{loginError}</div>}<button className="primary" disabled={loggingIn}>{loggingIn ? "登入中…" : "登入"}</button></form></div></main>;

  return <main className="admin-shell">
    <header className="admin-topbar"><div><span className="admin-kicker">漁光閃閃</span><h1>店家後台</h1></div><button className="admin-logout" onClick={() => supabase.auth.signOut()}>登出</button></header>
    <nav className="admin-main-tabs"><button className={section === "orders" ? "active" : ""} onClick={() => setSection("orders")}>訂單管理</button><button className={section === "products" ? "active" : ""} onClick={() => setSection("products")}>商品管理</button></nav>

    <div className="admin-content">
      {section === "orders" && <>
        <section className={`admin-store-panel ${storeSettings.is_open ? "is-open" : "is-closed"}`}><div className="admin-store-main"><div className={`store-indicator ${storeSettings.is_open ? "open" : "closed"}`}></div><div><span className="admin-section-label">目前店家狀態</span><strong>{storeSettings.is_open ? "營業中" : "休息中"}</strong></div></div><button className={`store-toggle ${storeSettings.is_open ? "open" : "closed"}`} disabled={savingStore} onClick={() => updateStore(!storeSettings.is_open)}>{savingStore ? "更新中…" : storeSettings.is_open ? "結束營業" : "開始營業"}</button>{!storeSettings.is_open && <div className="closed-message-box"><label>前台休息訊息</label><textarea className="input" rows="2" value={storeSettings.closed_message} onChange={e => setStoreSettings(prev => ({ ...prev, closed_message: e.target.value }))}/><button onClick={saveClosedMessage} disabled={savingStore}>儲存休息訊息</button></div>}</section>

        <section className="admin-summary v8-summary"><div><span>今日訂單</span><strong>{todayOrders.length}</strong></div><div><span>今日營業額</span><strong>${todayRevenue.toLocaleString()}</strong></div><div><span>新訂單</span><strong>{pendingCount}</strong></div><div><span>製作中</span><strong>{acceptedCount}</strong></div><div><span>已完成</span><strong>{completedCount}</strong></div></section>

        <section className="admin-orders-card"><div className="admin-orders-head"><div><h2>訂單</h2><span>{loading ? "更新中…" : `顯示 ${visibleOrders.length} 筆`}</span></div><button className="refresh-button" onClick={loadDashboard} disabled={loading}>{loading ? "更新中" : "重新整理"}</button></div>
          <div className="admin-search-row"><input className="input" value={search} onChange={e => setSearch(e.target.value)} placeholder="搜尋訂單編號、姓名或電話"/><select className="input" value={dateFilter} onChange={e => setDateFilter(e.target.value)}><option value="today">今天</option><option value="yesterday">昨天</option><option value="all">全部日期</option><option value="custom">指定日期</option></select>{dateFilter === "custom" && <input className="input" type="date" value={customDate} onChange={e => setCustomDate(e.target.value)}/>}</div>
          <div className="admin-filters">{[["active","待處理"],["pending","新訂單"],["accepted","製作中"],["completed","已完成"],["cancelled","已取消"],["all","全部"]].map(([value,label]) => <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{label}</button>)}</div>
          {error && <div className="admin-error">{error}</div>}{!loading && visibleOrders.length === 0 && <div className="admin-empty">找不到符合條件的訂單。</div>}
          <div className="admin-order-list">{visibleOrders.map(order => { const meta = STATUS_META[order.status] || { label: "未知狀態", className: "" }; const itemCount = (itemsByOrder[order.id] || []).reduce((sum,item) => sum + Number(item.quantity || 0), 0); return <button key={order.id} className={`admin-order-card status-${meta.className}`} onClick={() => setSelectedOrder(order)}><div className="order-card-top"><div><span className="order-number">#{order.order_number}</span><span className="order-time">{formatTime(order.created_at)}</span></div><span className={`status-pill ${meta.className}`}>{meta.label}</span></div><div className="order-card-middle"><div><strong>{order.customer_name || "未填姓名"}</strong><span>{itemCount} 份商品{order.note ? " · 有備註" : ""}</span></div><strong className="order-price">${Number(order.total_amount || 0).toLocaleString()}</strong></div><div className="order-card-action">查看訂單內容 <span>›</span></div></button>; })}</div>
        </section>
      </>}

      {section === "products" && <section className="admin-orders-card admin-products-card"><div className="admin-orders-head"><div><h2>商品管理</h2><span>價格、上下架與排序</span></div><button className="refresh-button" onClick={loadProducts} disabled={productLoading}>{productLoading ? "更新中" : "重新整理"}</button></div><div className="admin-product-note">修改後按「儲存」才會更新。下架商品會從客人菜單隱藏。</div><input className="input admin-product-search" value={productSearch} onChange={e => setProductSearch(e.target.value)} placeholder="搜尋商品或分類"/>{error && <div className="admin-error">{error}</div>}
        <div className="admin-product-list">{visibleProducts.map(product => <article className={`admin-product-item ${!product.is_active ? "inactive" : ""}`} key={product.id}><div className="admin-product-head"><div><span>{categoryName(product.category_id)}</span><strong>{product.name}</strong></div><label className="admin-switch"><input type="checkbox" checked={!!product.is_active} onChange={e => editProduct(product.id,"is_active",e.target.checked)}/><span>{product.is_active ? "上架" : "下架"}</span></label></div><div className="admin-product-fields">{product.pricing_type === "fixed" ? <label><span>價格</span><input className="input" type="number" min="0" step="10" value={product.price ?? 0} onChange={e => editProduct(product.id,"price",e.target.value)}/></label> : <><label><span>最低金額</span><input className="input" type="number" min="0" step="50" value={product.min_amount ?? 0} onChange={e => editProduct(product.id,"min_amount",e.target.value)}/></label><label><span>最高金額</span><input className="input" type="number" min="0" step="50" value={product.max_amount ?? 0} onChange={e => editProduct(product.id,"max_amount",e.target.value)}/></label><label><span>金額級距</span><input className="input" type="number" min="1" step="50" value={product.amount_step ?? 0} onChange={e => editProduct(product.id,"amount_step",e.target.value)}/></label></>}<label><span>排序</span><input className="input" type="number" value={product.sort_order ?? 0} onChange={e => editProduct(product.id,"sort_order",e.target.value)}/></label></div><button className="admin-product-save" disabled={savingProduct === product.id} onClick={() => saveProduct(product)}>{savingProduct === product.id ? "儲存中…" : "儲存商品"}</button></article>)}</div>
      </section>}
    </div>

    {selectedOrder && <div className="overlay admin-overlay" onClick={() => setSelectedOrder(null)}><div className="modal admin-order-modal" onClick={e => e.stopPropagation()}><div className="admin-modal-handle"></div><button className="close" onClick={() => setSelectedOrder(null)}>×</button><div className="admin-modal-title-row"><div><span>訂單 #{selectedOrder.order_number}</span><h2>{selectedOrder.customer_name || "未填姓名"}</h2></div><span className={`status-pill ${(STATUS_META[selectedOrder.status] || {}).className || ""}`}>{(STATUS_META[selectedOrder.status] || {}).label || "未知狀態"}</span></div><div className="admin-detail-meta"><span>{formatTime(selectedOrder.created_at)}</span>{selectedOrder.customer_phone && <a href={`tel:${selectedOrder.customer_phone}`}>{selectedOrder.customer_phone}</a>}</div><div className="admin-detail-items">{(itemsByOrder[selectedOrder.id] || []).map(item => <div key={item.id}><div><strong>{item.product_name}</strong><span>{item.pricing_type === "amount" && item.selected_amount ? `選擇金額 $${Number(item.selected_amount).toLocaleString()} · ${item.quantity} 份` : item.unit_price ? `$${Number(item.unit_price).toLocaleString()} × ${item.quantity}` : `${item.quantity} 份`}</span></div><strong>${Number(item.subtotal || 0).toLocaleString()}</strong></div>)}</div>{selectedOrder.note && <div className="admin-note"><span>客人備註</span><strong>{selectedOrder.note}</strong></div>}<div className="admin-detail-total"><span>訂單總額</span><strong>${Number(selectedOrder.total_amount || 0).toLocaleString()}</strong></div><div className="admin-status-actions">{selectedOrder.status === "pending" && <button className="accept" disabled={updatingOrder === selectedOrder.id} onClick={() => updateStatus(selectedOrder.id,"accepted")}>{updatingOrder === selectedOrder.id ? "處理中…" : "接單並開始製作"}</button>}{selectedOrder.status === "accepted" && <button className="complete" disabled={updatingOrder === selectedOrder.id} onClick={() => updateStatus(selectedOrder.id,"completed")}>{updatingOrder === selectedOrder.id ? "處理中…" : "完成訂單"}</button>}{["pending","accepted"].includes(selectedOrder.status) && <button className="cancel" disabled={updatingOrder === selectedOrder.id} onClick={() => updateStatus(selectedOrder.id,"cancelled")}>取消訂單</button>}{["completed","cancelled"].includes(selectedOrder.status) && <button className="restore" disabled={updatingOrder === selectedOrder.id} onClick={() => updateStatus(selectedOrder.id,"accepted")}>恢復為製作中</button>}</div></div></div>}
  </main>;
}
