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
function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}
function csvCell(value) {
  const text = String(value ?? "").replace(/"/g, '""');
  return `"${text}"`;
}
function downloadTextFile(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
function xmlEscape(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function workbookXml(sheets) {
  const rowsXml = rows => rows.map(row => `<Row>${row.map(cell => `<Cell><Data ss:Type="${typeof cell === "number" ? "Number" : "String"}">${xmlEscape(cell)}</Data></Cell>`).join("")}</Row>`).join("");
  return `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${sheets.map(sheet => `<Worksheet ss:Name="${xmlEscape(sheet.name)}"><Table>${rowsXml(sheet.rows)}</Table></Worksheet>`).join("")}</Workbook>`;
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
  const [customStartDate, setCustomStartDate] = useState(localDateKey());
  const [customEndDate, setCustomEndDate] = useState(localDateKey());
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
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [savingNewProduct, setSavingNewProduct] = useState(false);
  const [newProduct, setNewProduct] = useState({ name: "", category_id: "", pricing_type: "fixed", price: 0, min_amount: 100, max_amount: 1000, amount_step: 100, sort_order: 0, is_active: true });
  const [savingCategory, setSavingCategory] = useState(null);
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [savingNewCategory, setSavingNewCategory] = useState(false);
  const [newCategory, setNewCategory] = useState({ name: "", sort_order: 0, is_active: true });

  const [analyticsStart, setAnalyticsStart] = useState(localDateKey());
  const [analyticsEnd, setAnalyticsEnd] = useState(localDateKey());
  const [analyticsStatus, setAnalyticsStatus] = useState("all");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session || null); setAuthLoading(false); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => { setSession(nextSession || null); setAuthLoading(false); });
    return () => listener.subscription.unsubscribe();
  }, []);

  const loadDashboard = useCallback(async () => {
    if (!session) return;
    setLoading(true); setError("");
    try {
      const { data: setting, error: settingError } = await supabase.from("store_settings").select("is_open,closed_message").eq("id", 1).single();
      if (settingError) throw settingError;

      const orderRows = [];
      const pageSize = 1000;
      for (let from = 0; ; from += pageSize) {
        const { data, error: ordersError } = await supabase.from("orders").select("id,order_number,customer_name,customer_phone,note,total_amount,status,created_at").order("created_at", { ascending: false }).range(from, from + pageSize - 1);
        if (ordersError) throw ordersError;
        orderRows.push(...(data || []));
        if (!data || data.length < pageSize) break;
      }
      setOrders(orderRows);
      setStoreSettings({ is_open: setting?.is_open !== false, closed_message: setting?.closed_message || CLOSED_DEFAULT });

      const orderIds = orderRows.map(o => o.id);
      const itemRows = [];
      for (let i = 0; i < orderIds.length; i += 200) {
        const chunk = orderIds.slice(i, i + 200);
        const { data, error: itemsError } = await supabase.from("order_items").select("id,order_id,product_name,pricing_type,quantity,unit_price,selected_amount,subtotal").in("order_id", chunk);
        if (itemsError) throw itemsError;
        itemRows.push(...(data || []));
      }
      const grouped = {};
      for (const item of itemRows) { if (!grouped[item.order_id]) grouped[item.order_id] = []; grouped[item.order_id].push(item); }
      setItemsByOrder(grouped);
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
      const dateOk = dateFilter === "all" ? true : dateFilter === "today" ? orderKey === todayKey : dateFilter === "yesterday" ? orderKey === yesterdayKey : orderKey >= customStartDate && orderKey <= customEndDate;
      const searchOk = !q || String(order.order_number || "").includes(q) || String(order.customer_name || "").toLowerCase().includes(q) || String(order.customer_phone || "").includes(q);
      return statusOk && dateOk && searchOk;
    });
  }, [orders, filter, search, dateFilter, customStartDate, customEndDate, todayKey, yesterdayKey]);

  const analyticsOrders = useMemo(() => {
    const start = analyticsStart || "0000-01-01";
    const end = analyticsEnd || "9999-12-31";
    return orders.filter(order => {
      const key = localDateKey(order.created_at);
      const dateOk = key >= start && key <= end;
      const statusOk = analyticsStatus === "all" || order.status === analyticsStatus;
      return dateOk && statusOk;
    });
  }, [orders, analyticsStart, analyticsEnd, analyticsStatus]);

  const analyticsSummary = useMemo(() => {
    const revenueOrders = analyticsOrders.filter(o => o.status !== "cancelled");
    const revenue = revenueOrders.reduce((sum, o) => sum + Number(o.total_amount || 0), 0);
    return {
      orders: analyticsOrders.length, revenue,
      avg: revenueOrders.length ? Math.round(revenue / revenueOrders.length) : 0,
      completed: analyticsOrders.filter(o => o.status === "completed").length,
      cancelled: analyticsOrders.filter(o => o.status === "cancelled").length,
    };
  }, [analyticsOrders]);

  const productStats = useMemo(() => {
    const map = new Map();
    for (const order of analyticsOrders) {
      if (order.status === "cancelled") continue;
      for (const item of itemsByOrder[order.id] || []) {
        const key = item.product_name || "未命名商品";
        const row = map.get(key) || { name: key, quantity: 0, orders: 0, revenue: 0, amountSelections: 0 };
        row.quantity += Number(item.quantity || 0);
        row.orders += 1;
        row.revenue += Number(item.subtotal || 0);
        if (item.pricing_type === "amount") row.amountSelections += Number(item.selected_amount || 0) * Number(item.quantity || 0);
        map.set(key, row);
      }
    }
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue || b.quantity - a.quantity);
  }, [analyticsOrders, itemsByOrder]);

  const customerStats = useMemo(() => {
    const map = new Map();
    for (const order of analyticsOrders) {
      if (order.status === "cancelled") continue;
      const phone = normalizePhone(order.customer_phone);
      const key = phone || `name:${String(order.customer_name || "未填姓名").trim()}`;
      const row = map.get(key) || { name: order.customer_name || "未填姓名", phone: order.customer_phone || "", orders: 0, revenue: 0, latest: order.created_at, orderNumbers: [] };
      row.orders += 1; row.revenue += Number(order.total_amount || 0); row.orderNumbers.push(order.order_number);
      if (new Date(order.created_at) > new Date(row.latest)) row.latest = order.created_at;
      map.set(key, row);
    }
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue || b.orders - a.orders);
  }, [analyticsOrders]);

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
  function exportCsv() {
    const header = ["訂單編號","日期時間","客戶姓名","電話","狀態","商品","計價方式","數量","單價","選擇金額","商品小計","訂單總額","備註"];
    const rows = [header];
    for (const order of analyticsOrders) {
      const items = itemsByOrder[order.id] || [];
      if (!items.length) rows.push([order.order_number, formatTime(order.created_at), order.customer_name || "", order.customer_phone || "", STATUS_META[order.status]?.label || order.status, "", "", "", "", "", "", Number(order.total_amount || 0), order.note || ""]);
      for (const item of items) rows.push([order.order_number, formatTime(order.created_at), order.customer_name || "", order.customer_phone || "", STATUS_META[order.status]?.label || order.status, item.product_name, item.pricing_type === "amount" ? "彈性金額" : "固定價格", Number(item.quantity || 0), Number(item.unit_price || 0), Number(item.selected_amount || 0), Number(item.subtotal || 0), Number(order.total_amount || 0), order.note || ""]);
    }
    const csv = "\ufeff" + rows.map(row => row.map(csvCell).join(",")).join("\r\n");
    downloadTextFile(`漁光閃閃_訂單_${analyticsStart}_${analyticsEnd}.csv`, csv, "text/csv;charset=utf-8");
  }

  function exportExcel() {
    const summaryRows = [["漁光閃閃 訂單分析"],["開始日期",analyticsStart],["結束日期",analyticsEnd],["狀態",analyticsStatus === "all" ? "全部" : (STATUS_META[analyticsStatus]?.label || analyticsStatus)],["訂單數",analyticsSummary.orders],["營業額",analyticsSummary.revenue],["平均客單",analyticsSummary.avg],["已完成",analyticsSummary.completed],["已取消",analyticsSummary.cancelled]];
    const detailRows = [["訂單編號","日期時間","客戶姓名","電話","狀態","商品","計價方式","數量","單價","選擇金額","商品小計","訂單總額","備註"]];
    for (const order of analyticsOrders) for (const item of (itemsByOrder[order.id] || [])) detailRows.push([String(order.order_number || ""), formatTime(order.created_at), order.customer_name || "", order.customer_phone || "", STATUS_META[order.status]?.label || order.status, item.product_name || "", item.pricing_type === "amount" ? "彈性金額" : "固定價格", Number(item.quantity || 0), Number(item.unit_price || 0), Number(item.selected_amount || 0), Number(item.subtotal || 0), Number(order.total_amount || 0), order.note || ""]);
    const customerRows = [["客戶姓名","電話","訂單次數","累積消費","最近消費","訂單編號"]].concat(customerStats.map(c => [c.name,c.phone,c.orders,c.revenue,formatTime(c.latest),c.orderNumbers.map(n => `#${n}`).join("、")]));
    const productRows = [["商品","購買量","購買筆數","銷售額","彈性選購總額"]].concat(productStats.map(p => [p.name,p.quantity,p.orders,p.revenue,p.amountSelections]));
    const xml = workbookXml([{ name: "營業摘要", rows: summaryRows }, { name: "訂單明細", rows: detailRows }, { name: "客戶統計", rows: customerRows }, { name: "商品統計", rows: productRows }]);
    downloadTextFile(`漁光閃閃_訂單分析_${analyticsStart}_${analyticsEnd}.xls`, xml, "application/vnd.ms-excel;charset=utf-8");
  }

  function editCategory(id, field, value) { setCategories(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c)); }
  function openAddCategory() {
    setNewCategory({ name: "", sort_order: categories.reduce((max, c) => Math.max(max, Number(c.sort_order || 0)), 0) + 1, is_active: true });
    setError(""); setShowAddCategory(true);
  }
  async function createCategory(e) {
    e.preventDefault();
    const name = newCategory.name.trim();
    if (!name) { setError("請輸入分類名稱。"); return; }
    if (categories.some(c => c.name.trim().toLowerCase() === name.toLowerCase())) { setError(`分類「${name}」已存在。`); return; }
    setSavingNewCategory(true); setError("");
    const { error } = await supabase.from("categories").insert({ id: crypto.randomUUID(), name, sort_order: Number(newCategory.sort_order || 0), is_active: !!newCategory.is_active });
    if (error) setError(friendlyError(error, "新增分類失敗。請先執行 V8.2.1 分類管理 SQL。"));
    else { setShowAddCategory(false); await loadProducts(); }
    setSavingNewCategory(false);
  }
  async function saveCategory(category) {
    const name = String(category.name || "").trim();
    if (!name) { setError("分類名稱不能空白。"); return; }
    if (categories.some(c => c.id !== category.id && c.name.trim().toLowerCase() === name.toLowerCase())) { setError(`分類「${name}」已存在。`); return; }
    setSavingCategory(category.id); setError("");
    const { error } = await supabase.from("categories").update({ name, sort_order: Number(category.sort_order || 0), is_active: !!category.is_active }).eq("id", category.id);
    if (error) setError(friendlyError(error, "分類儲存失敗。請先執行 V8.2.1 分類管理 SQL。"));
    else await loadProducts();
    setSavingCategory(null);
  }
  async function deleteCategory(category) {
    setError("");
    const usedCount = products.filter(p => p.category_id === category.id).length;
    if (usedCount > 0) { setError(`「${category.name}」底下還有 ${usedCount} 個商品，請先將商品移到其他分類後再刪除；若只是暫停使用，可直接將分類下架。`); return; }
    if (!window.confirm(`確定要永久刪除分類「${category.name}」嗎？此動作無法復原。`)) return;
    setSavingCategory(category.id);
    const { error } = await supabase.from("categories").delete().eq("id", category.id);
    if (error) setError(friendlyError(error, "分類刪除失敗。請先執行 V8.2.1 分類管理 SQL。"));
    else await loadProducts();
    setSavingCategory(null);
  }

  function editProduct(id, field, value) { setProducts(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p)); }
  function resetNewProduct() {
    setNewProduct({ name: "", category_id: categories[0]?.id || "", pricing_type: "fixed", price: 0, min_amount: 100, max_amount: 1000, amount_step: 100, sort_order: (products.reduce((max, p) => Math.max(max, Number(p.sort_order || 0)), 0) + 1), is_active: true });
  }
  function openAddProduct() { resetNewProduct(); setError(""); setShowAddProduct(true); }
  async function createProduct(e) {
    e.preventDefault();
    const name = newProduct.name.trim();
    if (!name) { setError("請輸入商品名稱。"); return; }
    if (!newProduct.category_id) { setError("請選擇商品分類。"); return; }
    setSavingNewProduct(true); setError("");
    const payload = {
      id: crypto.randomUUID(),
      name,
      category_id: newProduct.category_id,
      pricing_type: newProduct.pricing_type,
      sort_order: Number(newProduct.sort_order || 0),
      is_active: !!newProduct.is_active,
      price: newProduct.pricing_type === "fixed" ? Number(newProduct.price || 0) : 0,
      min_amount: newProduct.pricing_type === "amount" ? Number(newProduct.min_amount || 0) : 0,
      max_amount: newProduct.pricing_type === "amount" ? Number(newProduct.max_amount || 0) : 0,
      amount_step: newProduct.pricing_type === "amount" ? Math.max(1, Number(newProduct.amount_step || 100)) : 100,
    };
    const { error } = await supabase.from("products").insert(payload);
    if (error) {
      console.error("create product error", error);
      const detail = [error.code, error.message, error.details, error.hint].filter(Boolean).join(" · ");
      setError(detail ? `新增商品失敗：${detail}` : "新增商品失敗。請確認 Supabase 商品新增權限。");
    }
    else { setShowAddProduct(false); await loadProducts(); }
    setSavingNewProduct(false);
  }
  async function saveProduct(product) {
    if (!String(product.name || "").trim()) { setError("商品名稱不能空白。"); return; }
    setSavingProduct(product.id); setError("");
    const payload = {
      name: String(product.name).trim(), category_id: product.category_id, pricing_type: product.pricing_type,
      is_active: !!product.is_active, sort_order: Number(product.sort_order || 0),
      price: product.pricing_type === "fixed" ? Number(product.price || 0) : 0,
      min_amount: product.pricing_type === "amount" ? Number(product.min_amount || 0) : 0,
      max_amount: product.pricing_type === "amount" ? Number(product.max_amount || 0) : 0,
      amount_step: product.pricing_type === "amount" ? Math.max(1, Number(product.amount_step || 100)) : 100,
    };
    const { error } = await supabase.from("products").update(payload).eq("id", product.id);
    if (error) setError(friendlyError(error, "商品儲存失敗。請確認 V8.1 商品權限 SQL 已執行。"));
    else await loadProducts();
    setSavingProduct(null);
  }
  async function deleteProduct(product) {
    setError("");
    const { data: usedRows, error: usedError } = await supabase.from("order_items").select("id").eq("product_id", product.id).limit(1);
    if (usedError) { setError(friendlyError(usedError, "無法確認商品歷史訂單，因此沒有刪除商品。")); return; }
    if ((usedRows || []).length > 0) { setError(`「${product.name}」已有歷史訂單紀錄，為保留訂單資料不能刪除；請改用下架。`); return; }
    if (!window.confirm(`確定要永久刪除「${product.name}」嗎？此動作無法復原。`)) return;
    setSavingProduct(product.id);
    const { error } = await supabase.from("products").delete().eq("id", product.id);
    if (error) setError(friendlyError(error, "商品刪除失敗。請確認 V8.1 商品權限 SQL 已執行。"));
    else await loadProducts();
    setSavingProduct(null);
  }

  if (authLoading) return <main className="admin-shell"><div className="admin-state">正在開啟店家後台…</div></main>;
  if (!session) return <main className="admin-login-page"><div className="admin-login-card"><div className="admin-brand-mark">漁</div><h1>漁光閃閃</h1><p>店家管理後台</p><form onSubmit={signIn}><label>管理員帳號</label><input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" placeholder="Email" required/><label>密碼</label><input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" placeholder="請輸入密碼" required/>{loginError && <div className="admin-error">{loginError}</div>}<button className="primary" disabled={loggingIn}>{loggingIn ? "登入中…" : "登入"}</button></form></div></main>;

  return <main className="admin-shell">
    <header className="admin-topbar"><div><span className="admin-kicker">漁光閃閃</span><h1>店家後台</h1></div><button className="admin-logout" onClick={() => supabase.auth.signOut()}>登出</button></header>
    <nav className="admin-main-tabs"><button className={section === "orders" ? "active" : ""} onClick={() => setSection("orders")}>訂單管理</button><button className={section === "analytics" ? "active" : ""} onClick={() => setSection("analytics")}>訂單分析</button><button className={section === "products" ? "active" : ""} onClick={() => setSection("products")}>商品管理</button></nav>

    <div className="admin-content">
      {section === "orders" && <>
        <section className={`admin-store-panel ${storeSettings.is_open ? "is-open" : "is-closed"}`}><div className="admin-store-main"><div className={`store-indicator ${storeSettings.is_open ? "open" : "closed"}`}></div><div><span className="admin-section-label">目前店家狀態</span><strong>{storeSettings.is_open ? "營業中" : "休息中"}</strong></div></div><button className={`store-toggle ${storeSettings.is_open ? "open" : "closed"}`} disabled={savingStore} onClick={() => updateStore(!storeSettings.is_open)}>{savingStore ? "更新中…" : storeSettings.is_open ? "結束營業" : "開始營業"}</button>{!storeSettings.is_open && <div className="closed-message-box"><label>前台休息訊息</label><textarea className="input" rows="2" value={storeSettings.closed_message} onChange={e => setStoreSettings(prev => ({ ...prev, closed_message: e.target.value }))}/><button onClick={saveClosedMessage} disabled={savingStore}>儲存休息訊息</button></div>}</section>

        <section className="admin-summary v8-summary"><div><span>今日訂單</span><strong>{todayOrders.length}</strong></div><div><span>今日營業額</span><strong>${todayRevenue.toLocaleString()}</strong></div><div><span>新訂單</span><strong>{pendingCount}</strong></div><div><span>製作中</span><strong>{acceptedCount}</strong></div><div><span>已完成</span><strong>{completedCount}</strong></div></section>

        <section className="admin-orders-card"><div className="admin-orders-head"><div><h2>訂單</h2><span>{loading ? "更新中…" : `顯示 ${visibleOrders.length} 筆`}</span></div><button className="refresh-button" onClick={loadDashboard} disabled={loading}>{loading ? "更新中" : "重新整理"}</button></div>
          <div className="admin-search-row"><input className="input" value={search} onChange={e => setSearch(e.target.value)} placeholder="搜尋訂單編號、姓名或電話"/><select className="input" value={dateFilter} onChange={e => setDateFilter(e.target.value)}><option value="today">今天</option><option value="yesterday">昨天</option><option value="all">全部日期</option><option value="custom">指定區間</option></select>{dateFilter === "custom" && <><input className="input" type="date" value={customStartDate} onChange={e => setCustomStartDate(e.target.value)}/><input className="input" type="date" value={customEndDate} onChange={e => setCustomEndDate(e.target.value)}/></>}</div>
          <div className="admin-filters">{[["active","待處理"],["pending","新訂單"],["accepted","製作中"],["completed","已完成"],["cancelled","已取消"],["all","全部"]].map(([value,label]) => <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{label}</button>)}</div>
          {error && <div className="admin-error">{error}</div>}{!loading && visibleOrders.length === 0 && <div className="admin-empty">找不到符合條件的訂單。</div>}
          <div className="admin-order-list">{visibleOrders.map(order => { const meta = STATUS_META[order.status] || { label: "未知狀態", className: "" }; const itemCount = (itemsByOrder[order.id] || []).reduce((sum,item) => sum + Number(item.quantity || 0), 0); return <button key={order.id} className={`admin-order-card status-${meta.className}`} onClick={() => setSelectedOrder(order)}><div className="order-card-top"><div><span className="order-number">#{order.order_number}</span><span className="order-time">{formatTime(order.created_at)}</span></div><span className={`status-pill ${meta.className}`}>{meta.label}</span></div><div className="order-card-middle"><div><strong>{order.customer_name || "未填姓名"}</strong><span>{itemCount} 份商品{order.note ? " · 有備註" : ""}</span></div><strong className="order-price">${Number(order.total_amount || 0).toLocaleString()}</strong></div><div className="order-card-action">查看訂單內容 <span>›</span></div></button>; })}</div>
        </section>
      </>}

      {section === "analytics" && <section className="admin-orders-card admin-analytics-card">
        <div className="admin-orders-head"><div><h2>訂單分析</h2><span>日期區間可設定同一天</span></div><button className="refresh-button" onClick={loadDashboard} disabled={loading}>{loading ? "更新中" : "重新整理"}</button></div>
        <div className="analytics-filter-grid"><label><span>開始日期</span><input className="input" type="date" value={analyticsStart} onChange={e => setAnalyticsStart(e.target.value)}/></label><label><span>結束日期</span><input className="input" type="date" value={analyticsEnd} onChange={e => setAnalyticsEnd(e.target.value)}/></label><label><span>訂單狀態</span><select className="input" value={analyticsStatus} onChange={e => setAnalyticsStatus(e.target.value)}><option value="all">全部</option><option value="pending">新訂單</option><option value="accepted">製作中</option><option value="completed">已完成</option><option value="cancelled">已取消</option></select></label></div>
        {analyticsStart > analyticsEnd && <div className="admin-error">開始日期不能晚於結束日期。</div>}
        <div className="analytics-actions"><button onClick={exportCsv} disabled={analyticsStart > analyticsEnd}>匯出 CSV</button><button className="excel" onClick={exportExcel} disabled={analyticsStart > analyticsEnd}>匯出 Excel</button></div>
        <section className="admin-summary analytics-summary"><div><span>訂單數</span><strong>{analyticsSummary.orders}</strong></div><div><span>營業額</span><strong>${analyticsSummary.revenue.toLocaleString()}</strong></div><div><span>平均客單</span><strong>${analyticsSummary.avg.toLocaleString()}</strong></div><div><span>已完成</span><strong>{analyticsSummary.completed}</strong></div><div><span>已取消</span><strong>{analyticsSummary.cancelled}</strong></div></section>
        <div className="analytics-grid">
          <section className="analytics-panel"><div className="analytics-panel-head"><h3>客戶統計</h3><span>電話優先分組</span></div><div className="analytics-table-wrap"><table><thead><tr><th>客戶</th><th>訂單</th><th>累積</th><th>最近</th></tr></thead><tbody>{customerStats.map((c,i) => <tr key={`${c.phone}-${c.name}-${i}`}><td><strong>{c.name}</strong><small>{c.phone || "無電話"}</small><small>訂單：{c.orderNumbers.map(n => `#${n}`).join("、")}</small></td><td>{c.orders}</td><td>${c.revenue.toLocaleString()}</td><td>{formatTime(c.latest)}</td></tr>)}</tbody></table></div>{customerStats.length === 0 && <div className="admin-empty compact">沒有符合條件的客戶資料。</div>}</section>
          <section className="analytics-panel"><div className="analytics-panel-head"><h3>商品統計</h3><span>取消訂單不計營業額</span></div><div className="analytics-table-wrap"><table><thead><tr><th>商品</th><th>購買量</th><th>銷售額</th></tr></thead><tbody>{productStats.map(p => <tr key={p.name}><td><strong>{p.name}</strong><small>{p.orders} 筆明細</small></td><td>{p.quantity}</td><td>${p.revenue.toLocaleString()}</td></tr>)}</tbody></table></div>{productStats.length === 0 && <div className="admin-empty compact">沒有符合條件的商品資料。</div>}</section>
        </div>
      </section>}

      {section === "products" && <section className="admin-orders-card admin-products-card"><div className="admin-orders-head"><div><h2>商品管理</h2><span>分類、商品、上下架與排序</span></div><div className="admin-product-head-actions"><button className="refresh-button" onClick={loadProducts} disabled={productLoading}>{productLoading ? "更新中" : "重新整理"}</button><button className="admin-add-product" onClick={openAddProduct}>＋ 新增商品</button></div></div>
        <section className="admin-category-panel"><div className="admin-category-title"><div><h3>分類管理</h3><span>前台依排序顯示；下架後前台隱藏</span></div><button className="admin-add-category" onClick={openAddCategory}>＋ 新增分類</button></div><div className="admin-category-list">{categories.map(category => <article className={`admin-category-item ${!category.is_active ? "inactive" : ""}`} key={category.id}><div className="admin-category-fields"><label><span>分類名稱</span><input className="input" value={category.name} onChange={e => editCategory(category.id,"name",e.target.value)}/></label><label><span>排序</span><input className="input" type="number" step="1" value={category.sort_order ?? 0} onChange={e => editCategory(category.id,"sort_order",e.target.value)}/></label><label className="admin-category-active"><span>狀態</span><span className="admin-switch"><input type="checkbox" checked={!!category.is_active} onChange={e => editCategory(category.id,"is_active",e.target.checked)}/><b>{category.is_active ? "上架" : "下架"}</b></span></label></div><div className="admin-category-actions"><button className="admin-product-delete" disabled={savingCategory === category.id} onClick={() => deleteCategory(category)}>刪除</button><button className="admin-product-save" disabled={savingCategory === category.id} onClick={() => saveCategory(category)}>{savingCategory === category.id ? "處理中…" : "儲存分類"}</button></div></article>)}</div></section>
        <div className="admin-product-note">修改後按「儲存商品」才會更新。曾出現在歷史訂單的商品只能下架，不能永久刪除。</div><input className="input admin-product-search" value={productSearch} onChange={e => setProductSearch(e.target.value)} placeholder="搜尋商品或分類"/>{error && <div className="admin-error">{error}</div>}
        <div className="admin-product-list">{visibleProducts.map(product => <article className={`admin-product-item ${!product.is_active ? "inactive" : ""}`} key={product.id}><div className="admin-product-head"><div><span>{categoryName(product.category_id)}</span><strong>{product.name}</strong></div><label className="admin-switch"><input type="checkbox" checked={!!product.is_active} onChange={e => editProduct(product.id,"is_active",e.target.checked)}/><span>{product.is_active ? "上架" : "下架"}</span></label></div><div className="admin-product-fields"><label className="full"><span>商品名稱</span><input className="input" value={product.name} onChange={e => editProduct(product.id,"name",e.target.value)}/></label><label><span>分類</span><select className="input" value={product.category_id || ""} onChange={e => editProduct(product.id,"category_id",e.target.value)}>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label><span>計價方式</span><select className="input" value={product.pricing_type} onChange={e => editProduct(product.id,"pricing_type",e.target.value)}><option value="fixed">固定價格</option><option value="amount">彈性金額</option></select></label>{product.pricing_type === "fixed" ? <label><span>價格</span><input className="input" type="number" min="0" step="1" value={product.price ?? 0} onChange={e => editProduct(product.id,"price",e.target.value)}/></label> : <><label><span>最低金額</span><input className="input" type="number" min="0" step="1" value={product.min_amount ?? 0} onChange={e => editProduct(product.id,"min_amount",e.target.value)}/></label><label><span>最高金額</span><input className="input" type="number" min="0" step="1" value={product.max_amount ?? 0} onChange={e => editProduct(product.id,"max_amount",e.target.value)}/></label><label><span>金額級距</span><input className="input" type="number" min="1" step="1" value={product.amount_step ?? 100} onChange={e => editProduct(product.id,"amount_step",e.target.value)}/></label></>}<label><span>排序</span><input className="input" type="number" value={product.sort_order ?? 0} onChange={e => editProduct(product.id,"sort_order",e.target.value)}/></label></div><div className="admin-product-actions"><button className="admin-product-delete" disabled={savingProduct === product.id} onClick={() => deleteProduct(product)}>刪除</button><button className="admin-product-save" disabled={savingProduct === product.id} onClick={() => saveProduct(product)}>{savingProduct === product.id ? "處理中…" : "儲存商品"}</button></div></article>)}</div>
      </section>}
    </div>

    {showAddCategory && <div className="overlay admin-overlay" onClick={() => !savingNewCategory && setShowAddCategory(false)}><form className="modal admin-product-modal" onSubmit={createCategory} onClick={e => e.stopPropagation()}><div className="admin-modal-handle"></div><button type="button" className="close" disabled={savingNewCategory} onClick={() => setShowAddCategory(false)}>×</button><div className="admin-modal-title-row"><div><span>商品管理</span><h2>新增分類</h2></div></div><div className="admin-new-product-fields"><label><span>分類名稱</span><input className="input" value={newCategory.name} onChange={e => setNewCategory(c => ({ ...c, name: e.target.value }))} placeholder="例如：烤物" required/></label><label><span>排序</span><input className="input" type="number" step="1" value={newCategory.sort_order} onChange={e => setNewCategory(c => ({ ...c, sort_order: e.target.value }))}/></label><label className="admin-new-active"><input type="checkbox" checked={newCategory.is_active} onChange={e => setNewCategory(c => ({ ...c, is_active: e.target.checked }))}/><span>新增後立即上架</span></label></div>{error && <div className="admin-error">{error}</div>}<button className="primary" disabled={savingNewCategory}>{savingNewCategory ? "新增中…" : "新增分類"}</button></form></div>}

    {showAddProduct && <div className="overlay admin-overlay" onClick={() => !savingNewProduct && setShowAddProduct(false)}><form className="modal admin-product-modal" onSubmit={createProduct} onClick={e => e.stopPropagation()}><div className="admin-modal-handle"></div><button type="button" className="close" disabled={savingNewProduct} onClick={() => setShowAddProduct(false)}>×</button><div className="admin-modal-title-row"><div><span>商品管理</span><h2>新增商品</h2></div></div><div className="admin-new-product-fields"><label><span>商品名稱</span><input className="input" value={newProduct.name} onChange={e => setNewProduct(p => ({ ...p, name: e.target.value }))} placeholder="例如：鮭魚握壽司" required/></label><label><span>分類</span><select className="input" value={newProduct.category_id} onChange={e => setNewProduct(p => ({ ...p, category_id: e.target.value }))} required><option value="">請選擇分類</option>{categories.filter(c => c.is_active !== false).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label><span>計價方式</span><select className="input" value={newProduct.pricing_type} onChange={e => setNewProduct(p => ({ ...p, pricing_type: e.target.value }))}><option value="fixed">固定價格</option><option value="amount">彈性金額</option></select></label>{newProduct.pricing_type === "fixed" ? <label><span>價格</span><input className="input" type="number" min="0" step="1" value={newProduct.price} onChange={e => setNewProduct(p => ({ ...p, price: e.target.value }))} required/></label> : <><label><span>最低金額</span><input className="input" type="number" min="0" step="1" value={newProduct.min_amount} onChange={e => setNewProduct(p => ({ ...p, min_amount: e.target.value }))} required/></label><label><span>最高金額</span><input className="input" type="number" min="0" step="1" value={newProduct.max_amount} onChange={e => setNewProduct(p => ({ ...p, max_amount: e.target.value }))} required/></label><label><span>每次增加</span><input className="input" type="number" min="1" step="1" value={newProduct.amount_step} onChange={e => setNewProduct(p => ({ ...p, amount_step: e.target.value }))} required/></label></>}<label><span>排序</span><input className="input" type="number" value={newProduct.sort_order} onChange={e => setNewProduct(p => ({ ...p, sort_order: e.target.value }))}/></label><label className="admin-new-active"><input type="checkbox" checked={newProduct.is_active} onChange={e => setNewProduct(p => ({ ...p, is_active: e.target.checked }))}/><span>新增後立即上架</span></label></div>{error && <div className="admin-error">{error}</div>}<button className="primary" disabled={savingNewProduct}>{savingNewProduct ? "新增中…" : "新增商品"}</button></form></div>}

    {selectedOrder && <div className="overlay admin-overlay" onClick={() => setSelectedOrder(null)}><div className="modal admin-order-modal" onClick={e => e.stopPropagation()}><div className="admin-modal-handle"></div><button className="close" onClick={() => setSelectedOrder(null)}>×</button><div className="admin-modal-title-row"><div><span>訂單 #{selectedOrder.order_number}</span><h2>{selectedOrder.customer_name || "未填姓名"}</h2></div><span className={`status-pill ${(STATUS_META[selectedOrder.status] || {}).className || ""}`}>{(STATUS_META[selectedOrder.status] || {}).label || "未知狀態"}</span></div><div className="admin-detail-meta"><span>{formatTime(selectedOrder.created_at)}</span>{selectedOrder.customer_phone && <a href={`tel:${selectedOrder.customer_phone}`}>{selectedOrder.customer_phone}</a>}</div><div className="admin-detail-items">{(itemsByOrder[selectedOrder.id] || []).map(item => <div key={item.id}><div><strong>{item.product_name}</strong><span>{item.pricing_type === "amount" && item.selected_amount ? `選擇金額 $${Number(item.selected_amount).toLocaleString()} · ${item.quantity} 份` : item.unit_price ? `$${Number(item.unit_price).toLocaleString()} × ${item.quantity}` : `${item.quantity} 份`}</span></div><strong>${Number(item.subtotal || 0).toLocaleString()}</strong></div>)}</div>{selectedOrder.note && <div className="admin-note"><span>客人備註</span><strong>{selectedOrder.note}</strong></div>}<div className="admin-detail-total"><span>訂單總額</span><strong>${Number(selectedOrder.total_amount || 0).toLocaleString()}</strong></div><div className="admin-status-actions">{selectedOrder.status === "pending" && <button className="accept" disabled={updatingOrder === selectedOrder.id} onClick={() => updateStatus(selectedOrder.id,"accepted")}>{updatingOrder === selectedOrder.id ? "處理中…" : "接單並開始製作"}</button>}{selectedOrder.status === "accepted" && <button className="complete" disabled={updatingOrder === selectedOrder.id} onClick={() => updateStatus(selectedOrder.id,"completed")}>{updatingOrder === selectedOrder.id ? "處理中…" : "完成訂單"}</button>}{["pending","accepted"].includes(selectedOrder.status) && <button className="cancel" disabled={updatingOrder === selectedOrder.id} onClick={() => updateStatus(selectedOrder.id,"cancelled")}>取消訂單</button>}{["completed","cancelled"].includes(selectedOrder.status) && <button className="restore" disabled={updatingOrder === selectedOrder.id} onClick={() => updateStatus(selectedOrder.id,"accepted")}>恢復為製作中</button>}</div></div></div>}
  </main>;
}
