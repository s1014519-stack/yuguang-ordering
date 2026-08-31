"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";

const STATUS_META = {
  pending: { label: "新訂單", className: "pending" },
  accepted: { label: "已接單", className: "accepted" },
  completed: { label: "已完成", className: "completed" },
  cancelled: { label: "已取消", className: "cancelled" },
};

function formatTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-TW", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(value));
}

export default function AdminPage() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);

  const [orders, setOrders] = useState([]);
  const [itemsByOrder, setItemsByOrder] = useState({});
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [filter, setFilter] = useState("active");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [storeSettings, setStoreSettings] = useState({ is_open: true, closed_message: "目前尚未營業，請稍後再來。" });
  const [savingStore, setSavingStore] = useState(false);
  const [updatingOrder, setUpdatingOrder] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session || null);
      setAuthLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession || null);
      setAuthLoading(false);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const loadDashboard = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError("");
    try {
      const [{ data: orderRows, error: ordersError }, { data: setting, error: settingError }] = await Promise.all([
        supabase.from("orders").select("id,order_number,customer_name,customer_phone,note,total_amount,status,created_at").order("created_at", { ascending: false }).limit(100),
        supabase.from("store_settings").select("is_open,closed_message").eq("id", 1).single(),
      ]);
      if (ordersError) throw ordersError;
      if (settingError) throw settingError;
      setOrders(orderRows || []);
      setStoreSettings({
        is_open: setting?.is_open !== false,
        closed_message: setting?.closed_message || "目前尚未營業，請稍後再來。",
      });

      const orderIds = (orderRows || []).map(order => order.id);
      if (orderIds.length) {
        const { data: itemRows, error: itemsError } = await supabase
          .from("order_items")
          .select("id,order_id,product_name,pricing_type,quantity,unit_price,selected_amount,subtotal")
          .in("order_id", orderIds);
        if (itemsError) throw itemsError;
        const grouped = {};
        for (const item of itemRows || []) {
          if (!grouped[item.order_id]) grouped[item.order_id] = [];
          grouped[item.order_id].push(item);
        }
        setItemsByOrder(grouped);
      } else {
        setItemsByOrder({});
      }
    } catch (err) {
      setError(err?.message || "後台資料讀取失敗");
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (!session) return;
    loadDashboard();
    const channel = supabase
      .channel("admin-orders")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => loadDashboard())
      .on("postgres_changes", { event: "*", schema: "public", table: "order_items" }, () => loadDashboard())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "store_settings", filter: "id=eq.1" }, payload => {
        const next = payload.new || {};
        setStoreSettings({ is_open: next.is_open !== false, closed_message: next.closed_message || "目前尚未營業，請稍後再來。" });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [session, loadDashboard]);

  const visibleOrders = useMemo(() => {
    if (filter === "all") return orders;
    if (filter === "active") return orders.filter(order => ["pending", "accepted"].includes(order.status));
    return orders.filter(order => order.status === filter);
  }, [orders, filter]);

  const activeCount = orders.filter(order => ["pending", "accepted"].includes(order.status)).length;
  const pendingCount = orders.filter(order => order.status === "pending").length;

  async function signIn(e) {
    e.preventDefault();
    setLoggingIn(true);
    setLoginError("");
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setLoginError(error.message);
    setLoggingIn(false);
  }

  async function updateStore(nextOpen) {
    setSavingStore(true);
    setError("");
    const { error } = await supabase.from("store_settings").update({
      is_open: nextOpen,
      closed_message: storeSettings.closed_message,
      updated_at: new Date().toISOString(),
    }).eq("id", 1);
    if (error) setError(error.message);
    else setStoreSettings(prev => ({ ...prev, is_open: nextOpen }));
    setSavingStore(false);
  }

  async function saveClosedMessage() {
    setSavingStore(true);
    setError("");
    const { error } = await supabase.from("store_settings").update({
      closed_message: storeSettings.closed_message,
      updated_at: new Date().toISOString(),
    }).eq("id", 1);
    if (error) setError(error.message);
    setSavingStore(false);
  }

  async function updateStatus(orderId, status) {
    setUpdatingOrder(orderId);
    setError("");
    const { error } = await supabase.from("orders").update({ status }).eq("id", orderId);
    if (error) setError(error.message);
    else {
      setOrders(prev => prev.map(order => order.id === orderId ? { ...order, status } : order));
      setSelectedOrder(prev => prev?.id === orderId ? { ...prev, status } : prev);
    }
    setUpdatingOrder(null);
  }

  if (authLoading) return <main className="admin-shell"><div className="admin-state">正在確認登入狀態…</div></main>;

  if (!session) {
    return <main className="admin-login-page">
      <div className="admin-login-card">
        <div className="admin-brand-mark">漁</div>
        <div className="eyebrow">YU GUANG SHAN SHAN</div>
        <h1>店家後台</h1>
        <p>請使用 Supabase Auth 建立的管理員帳號登入。</p>
        <form onSubmit={signIn}>
          <label>電子信箱</label>
          <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" required />
          <label>密碼</label>
          <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required />
          {loginError && <div className="admin-error">登入失敗：{loginError}</div>}
          <button className="primary" disabled={loggingIn}>{loggingIn ? "登入中…" : "登入後台"}</button>
        </form>
      </div>
    </main>;
  }

  return <main className="admin-shell">
    <header className="admin-topbar">
      <div><div className="eyebrow">YU GUANG SHAN SHAN</div><h1>漁光閃閃後台</h1></div>
      <button className="admin-logout" onClick={() => supabase.auth.signOut()}>登出</button>
    </header>

    <section className="admin-store-card">
      <div>
        <span className={`store-dot ${storeSettings.is_open ? "open" : "closed"}`}></span>
        <div><strong>{storeSettings.is_open ? "目前營業中" : "目前休息中"}</strong><small>切換後前台會依狀態開放或停止點餐</small></div>
      </div>
      <button className={`store-toggle ${storeSettings.is_open ? "open" : "closed"}`} disabled={savingStore} onClick={() => updateStore(!storeSettings.is_open)}>
        {savingStore ? "更新中…" : storeSettings.is_open ? "切換休息" : "開始營業"}
      </button>
      <div className="closed-message-row">
        <input className="input" value={storeSettings.closed_message} onChange={e => setStoreSettings(prev => ({ ...prev, closed_message: e.target.value }))} placeholder="休息時顯示給客人的訊息" />
        <button onClick={saveClosedMessage} disabled={savingStore}>儲存訊息</button>
      </div>
    </section>

    <section className="admin-summary">
      <div><span>待處理</span><strong>{activeCount}</strong></div>
      <div><span>新訂單</span><strong>{pendingCount}</strong></div>
      <div><span>今日訂單</span><strong>{orders.filter(order => new Date(order.created_at).toDateString() === new Date().toDateString()).length}</strong></div>
    </section>

    <section className="admin-orders-card">
      <div className="admin-orders-head">
        <div><h2>訂單</h2><span>{loading ? "更新中…" : `最近 ${orders.length} 筆`}</span></div>
        <button onClick={loadDashboard} disabled={loading}>重新整理</button>
      </div>
      <div className="admin-filters">
        {[['active','待處理'],['pending','新訂單'],['accepted','已接單'],['completed','已完成'],['cancelled','已取消'],['all','全部']].map(([value,label]) =>
          <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{label}</button>
        )}
      </div>
      {error && <div className="admin-error">{error}</div>}
      {!loading && visibleOrders.length === 0 && <div className="admin-empty">目前沒有符合條件的訂單。</div>}
      <div className="admin-order-list">
        {visibleOrders.map(order => {
          const meta = STATUS_META[order.status] || { label: order.status, className: "" };
          return <button key={order.id} className="admin-order-row" onClick={() => setSelectedOrder(order)}>
            <div className="admin-order-number"><strong>#{order.order_number}</strong><span>{formatTime(order.created_at)}</span></div>
            <div className="admin-order-customer"><strong>{order.customer_name}</strong><span>{(itemsByOrder[order.id] || []).reduce((sum,item) => sum + item.quantity, 0)} 份商品</span></div>
            <div className="admin-order-total"><strong>${Number(order.total_amount).toLocaleString()}</strong><span className={`status-pill ${meta.className}`}>{meta.label}</span></div>
          </button>;
        })}
      </div>
    </section>

    {selectedOrder && <div className="overlay admin-overlay" onClick={() => setSelectedOrder(null)}>
      <div className="modal admin-order-modal" onClick={e => e.stopPropagation()}>
        <button className="close" onClick={() => setSelectedOrder(null)}>×</button>
        <div className="eyebrow">ORDER #{selectedOrder.order_number}</div>
        <h2>{selectedOrder.customer_name}</h2>
        <div className="admin-detail-meta">
          <span>{formatTime(selectedOrder.created_at)}</span>
          {selectedOrder.customer_phone && <span>{selectedOrder.customer_phone}</span>}
        </div>
        <div className="admin-detail-items">
          {(itemsByOrder[selectedOrder.id] || []).map(item => <div key={item.id}>
            <div><strong>{item.product_name}</strong><span>{item.unit_price ? `$${Number(item.unit_price).toLocaleString()} × ${item.quantity}` : `${item.quantity} 份`}</span></div>
            <strong>${Number(item.subtotal).toLocaleString()}</strong>
          </div>)}
        </div>
        {selectedOrder.note && <div className="admin-note"><span>備註</span><strong>{selectedOrder.note}</strong></div>}
        <div className="admin-detail-total"><span>合計</span><strong>${Number(selectedOrder.total_amount).toLocaleString()}</strong></div>
        <div className="admin-status-actions">
          {selectedOrder.status === "pending" && <button className="accept" disabled={updatingOrder === selectedOrder.id} onClick={() => updateStatus(selectedOrder.id, "accepted")}>接單</button>}
          {selectedOrder.status === "accepted" && <button className="complete" disabled={updatingOrder === selectedOrder.id} onClick={() => updateStatus(selectedOrder.id, "completed")}>完成訂單</button>}
          {["pending","accepted"].includes(selectedOrder.status) && <button className="cancel" disabled={updatingOrder === selectedOrder.id} onClick={() => updateStatus(selectedOrder.id, "cancelled")}>取消訂單</button>}
          {["completed","cancelled"].includes(selectedOrder.status) && <button className="restore" disabled={updatingOrder === selectedOrder.id} onClick={() => updateStatus(selectedOrder.id, "accepted")}>恢復為已接單</button>}
        </div>
      </div>
    </div>}
  </main>;
}
