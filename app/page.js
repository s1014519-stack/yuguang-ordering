"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

export default function Home() {
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]);
  const [selected, setSelected] = useState(null);
  const [amount, setAmount] = useState(null);
  const [qty, setQty] = useState(1);
  const [showCart, setShowCart] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [successOrder, setSuccessOrder] = useState(null);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadMenu() {
      setLoading(true);
      const { data: cats, error: catError } = await supabase
        .from("categories")
        .select("id,name,sort_order")
        .eq("is_active", true)
        .order("sort_order");
      const { data: prods, error: productError } = await supabase
        .from("products")
        .select("id,category_id,name,description,image_url,pricing_type,price,min_amount,max_amount,amount_step,sort_order")
        .eq("is_active", true)
        .order("sort_order");
      if (catError || productError) setError(catError?.message || productError?.message || "菜單讀取失敗");
      else { setCategories(cats || []); setProducts(prods || []); }
      setLoading(false);
    }
    loadMenu();
  }, []);

  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const cartTotal = cart.reduce((sum, item) => sum + item.subtotal, 0);
  const productItems = productId => cart.filter(item => item.product_id === productId);
  const isSashimiCategory = categoryId => {
    const category = categories.find(c => c.id === categoryId);
    return category?.name === "生魚片";
  };
  const sashimiTotal = cart.reduce((sum, item) => {
    const product = products.find(p => p.id === item.product_id);
    return isSashimiCategory(product?.category_id) ? sum + item.subtotal : sum;
  }, 0);
  const sashimiShortfall = Math.max(0, 200 - sashimiTotal);

  function openProduct(product, preferredAmount = null) {
    const items = productItems(product.id);
    const initialAmount = preferredAmount ?? (product.name === "綜合生魚片" ? 300 : product.pricing_type === "amount" ? (items[0]?.unit_price ?? (isSashimiCategory(product.category_id) ? 100 : product.min_amount)) : product.price);
    setSelected(product); setQty(1); setAmount(Number(initialAmount));
  }

  function amountOptions(product) {
    const values = [], step = isSashimiCategory(product.category_id) ? 100 : Number(product.amount_step), min = isSashimiCategory(product.category_id) ? 100 : Number(product.min_amount), max = Number(product.max_amount);
    if (!step || step <= 0) return [min];
    for (let n = min; n <= max; n += step) values.push(n);
    if (values.at(-1) !== max && max > min) values.push(max);
    return values;
  }

  function addToCart() {
    if (!selected) return;
    const unitPrice = selected.name === "綜合生魚片" ? 300 : selected.pricing_type === "amount" ? Number(amount) : Number(selected.price);
    if (!unitPrice) return;
    const key = `${selected.id}-${unitPrice}`;
    setCart(prev => {
      const found = prev.find(item => item.key === key);
      if (found) return prev.map(item => item.key === key ? { ...item, quantity: item.quantity + qty, subtotal: (item.quantity + qty) * unitPrice } : item);
      return [...prev, { key, product_id: selected.id, name: selected.name, pricing_type: selected.pricing_type, unit_price: unitPrice, quantity: qty, subtotal: qty * unitPrice }];
    });
    setSelected(null);
  }

  function changeCartItem(key, delta) {
    setCart(prev => prev.map(item => item.key === key ? { ...item, quantity: item.quantity + delta, subtotal: (item.quantity + delta) * item.unit_price } : item).filter(item => item.quantity > 0));
  }

  const grouped = useMemo(() => categories.map(category => ({
    ...category,
    products: products.filter(p => p.category_id === category.id).sort((a,b) => a.sort_order - b.sort_order)
  })).filter(c => c.products.length > 0), [categories, products]);

  return (
    <main>
      <header className="hero"><div><div className="eyebrow">YU GUANG SHAN SHAN</div><h1>漁光閃閃</h1><p>線上點餐</p></div></header>
      {loading && <div className="state">正在載入菜單…</div>}
      {error && <div className="state error">菜單讀取失敗：{error}</div>}
      {!loading && !error && grouped.map(category => (
        <section className="section" key={category.id}>
          <div className="section-title"><h2>{category.name}</h2></div>
          <div className="grid">
            {category.products.map(product => {
              const selectedItems = productItems(product.id);
              return <div className={`product ${selectedItems.length ? "product-selected" : ""}`} key={product.id}>
                <button className="product-click" onClick={() => openProduct(product)}>
                  <div className="product-main"><h3>{product.name}</h3>{product.description && <p>{product.description}</p>}<strong>{product.name === "綜合生魚片" ? "$300／份" : product.pricing_type === "amount" ? `$${isSashimiCategory(product.category_id) ? 100 : Number(product.min_amount).toLocaleString()}～$${Number(product.max_amount).toLocaleString()}／份` : `$${Number(product.price).toLocaleString()}／份`}</strong></div>
                </button>
                {selectedItems.length === 0 ? <button className="plus" aria-label={`選擇${product.name}`} onClick={() => openProduct(product)}>＋</button> :
                  <div className="selected-controls">
                    {selectedItems.map(item => <div className="selected-line" key={item.key}><span className="selected-price">${item.unit_price.toLocaleString()}／份</span><div className="mini-quantity"><button onClick={() => changeCartItem(item.key, -1)}>−</button><strong>{item.quantity}份</strong><button onClick={() => openProduct(product, item.unit_price)}>＋</button></div></div>)}
                    {product.pricing_type === "amount" && <button className="add-price" onClick={() => openProduct(product)}>＋ 新增金額</button>}
                  </div>}
              </div>;
            })}
          </div>
        </section>
      ))}

      <button className="cartbar" onClick={() => cartCount > 0 && setShowCart(true)} disabled={cartCount === 0}><div><span>購物車</span><small>{cartCount} 項</small></div><strong>${cartTotal.toLocaleString()}</strong></button>

      {selected && <div className="overlay" onClick={() => setSelected(null)}><div className="modal" onClick={e => e.stopPropagation()}>
        <button className="close" onClick={() => setSelected(null)}>×</button><div className="eyebrow">商品</div><h2>{selected.name}</h2>
        {selected.pricing_type === "amount" && selected.name !== "綜合生魚片" ? <><p className="label">選擇每份金額</p><div className="amount-grid">{amountOptions(selected).map(value => <button key={value} className={amount === value ? "amount active" : "amount"} onClick={() => setAmount(value)}>${value.toLocaleString()}</button>)}</div></> : <div className="fixed-price">${Number(selected.price).toLocaleString()}／份</div>}
        <p className="label">份數</p><div className="quantity"><button onClick={() => setQty(Math.max(1, qty - 1))}>−</button><strong>{qty} 份</strong><button onClick={() => setQty(qty + 1)}>＋</button></div>
        <button className="primary" onClick={addToCart}>加入購物車　${(Number(amount) * qty).toLocaleString()}</button>
      </div></div>}

      {showCart && <div className="overlay" onClick={() => setShowCart(false)}><div className="modal cart-modal" onClick={e => e.stopPropagation()}>
        <button className="close" onClick={() => setShowCart(false)}>×</button><div className="eyebrow">購物車</div><h2>確認購物內容</h2>
        {cart.map(item => <div className="cart-item" key={item.key}><div><strong>{item.name}</strong><div className="cart-item-price">${item.unit_price.toLocaleString()}／份</div></div><div className="cart-item-right"><div className="mini-quantity"><button onClick={() => changeCartItem(item.key, -1)}>−</button><strong>{item.quantity}份</strong><button onClick={() => changeCartItem(item.key, 1)}>＋</button></div><strong>${item.subtotal.toLocaleString()}</strong></div></div>)}
        <div className="cart-total"><span>合計</span><strong>${cartTotal.toLocaleString()}</strong></div>
        {sashimiTotal > 0 && sashimiTotal < 200 && <div className="sashimi-warning">生魚片目前合計 ${sashimiTotal.toLocaleString()}，還差 ${sashimiShortfall.toLocaleString()} 才能點餐。</div>}
        <button className="primary" disabled={sashimiTotal > 0 && sashimiTotal < 200} onClick={() => { setShowCart(false); setShowConfirm(true); }}>前往確認點餐</button>
      </div></div>}

      {successOrder && <div className="overlay"><div className="modal success-modal">
        <div className="success-icon">✓</div><div className="eyebrow">ORDER RECEIVED</div><h2>點餐成功</h2>
        <p className="success-text">您的訂單已送出，請稍候。</p>
        <div className="success-card"><span>訂單編號</span><strong>{successOrder.order_number}</strong></div>
        <div className="success-card"><span>訂單金額</span><strong>${Number(successOrder.total_amount).toLocaleString()}</strong></div>
        <button className="primary" onClick={() => setSuccessOrder(null)}>回到菜單</button>
      </div></div>}

      {showConfirm && <div className="overlay" onClick={() => setShowConfirm(false)}><div className="modal" onClick={e => e.stopPropagation()}>
        <button className="close" onClick={() => setShowConfirm(false)}>×</button><div className="eyebrow">最後確認</div><h2>確認點餐</h2>
        <div className="confirm-summary"><div><span>共 {cartCount} 項</span><strong>${cartTotal.toLocaleString()}</strong></div>{cart.map(item => <div className="confirm-line" key={item.key}><span>{item.name}　${item.unit_price.toLocaleString()} × {item.quantity}份</span><strong>${item.subtotal.toLocaleString()}</strong></div>)}</div>
        <p className="label">姓名（選填）</p><input className="input" value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="請輸入姓名" />
        <p className="label">電話（選填）</p><input className="input" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} placeholder="請輸入電話" inputMode="tel" />
        <p className="label">備註（選填）</p><textarea className="input textarea" value={note} onChange={e => setNote(e.target.value)} placeholder="例如：不要芥末、分開裝…" />
        <button className="primary" disabled={submitting} onClick={async () => {
              if (!cart.length || submitting) return;
              if (sashimiTotal > 0 && sashimiTotal < 200) { alert(`生魚片合計至少需要 $200，目前為 $${sashimiTotal.toLocaleString()}，還差 $${sashimiShortfall.toLocaleString()}。`); return; }
              setSubmitting(true);
              try {
                const { data, error } = await supabase.rpc("create_order", {
                  p_customer_name: customerName,
                  p_customer_phone: customerPhone,
                  p_note: note,
                  p_total_amount: cartTotal,
                  p_items: cart.map(item => ({
                    product_id: item.product_id,
                    product_name: item.name,
                    pricing_type: item.pricing_type,
                    quantity: item.quantity,
                    unit_price: item.unit_price,
                    selected_amount: item.pricing_type === "amount" ? item.unit_price : null,
                    subtotal: item.subtotal
                  }))
                });
                if (error) throw error;
                const result = Array.isArray(data) ? data[0] : data;
                if (!result?.order_number || !result?.order_id) {
                  throw new Error("訂單已送出，但沒有取得訂單編號，請檢查 create_order 函式回傳值。");
                }
                const submittedTotal = cartTotal;
                setCart([]);
                setShowConfirm(false);
                setSuccessOrder({ ...result, total_amount: submittedTotal });
              } catch (err) {
                alert(`送出失敗：${err?.message || "未知錯誤"}`);
              } finally {
                setSubmitting(false);
              }
            }}>
              {submitting ? "送出中…" : "送出點餐"}
            </button>
      </div></div>}
    </main>
  );
}
