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

      if (catError || productError) {
        setError(catError?.message || productError?.message || "菜單讀取失敗");
      } else {
        setCategories(cats || []);
        setProducts(prods || []);
      }
      setLoading(false);
    }
    loadMenu();
  }, []);

  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const cartTotal = cart.reduce((sum, item) => sum + item.subtotal, 0);

  function openProduct(product) {
    setSelected(product);
    setQty(1);
    setAmount(product.pricing_type === "amount" ? product.min_amount : product.price);
  }

  function addToCart() {
    if (!selected) return;
    const unitPrice = selected.pricing_type === "amount" ? amount : selected.price;
    const key = `${selected.id}-${unitPrice}`;

    setCart(prev => {
      const found = prev.find(item => item.key === key);
      if (found) {
        return prev.map(item =>
          item.key === key
            ? { ...item, quantity: item.quantity + qty, subtotal: (item.quantity + qty) * unitPrice }
            : item
        );
      }
      return [...prev, {
        key,
        product_id: selected.id,
        name: selected.name,
        pricing_type: selected.pricing_type,
        unit_price: unitPrice,
        quantity: qty,
        subtotal: qty * unitPrice
      }];
    });
    setSelected(null);
  }

  function amountOptions(product) {
    const values = [];
    for (let n = product.min_amount; n <= product.max_amount; n += product.amount_step) {
      values.push(n);
    }
    return values;
  }

  const grouped = useMemo(() =>
    categories.map(category => ({
      ...category,
      products: products
        .filter(p => p.category_id === category.id)
        .sort((a,b) => a.sort_order - b.sort_order)
    })).filter(c => c.products.length > 0), [categories, products]);

  return (
    <main>
      <header className="hero">
        <div>
          <div className="eyebrow">YU GUANG SHAN SHAN</div>
          <h1>漁光閃閃</h1>
          <p>線上點餐</p>
        </div>
      </header>

      {loading && <div className="state">正在載入菜單…</div>}
      {error && <div className="state error">菜單讀取失敗：{error}</div>}

      {!loading && !error && grouped.map(category => (
        <section className="section" key={category.id}>
          <div className="section-title">
            <h2>{category.name}</h2>
          </div>
          <div className="grid">
            {category.products.map(product => (
              <button className="product" key={product.id} onClick={() => openProduct(product)}>
                <div className="product-main">
                  <h3>{product.name}</h3>
                  {product.description && <p>{product.description}</p>}
                  <strong>
                    {product.pricing_type === "amount"
                      ? `$${product.min_amount.toLocaleString()}～$${product.max_amount.toLocaleString()}`
                      : `$${product.price.toLocaleString()}`}
                  </strong>
                </div>
                <span className="plus">＋</span>
              </button>
            ))}
          </div>
        </section>
      ))}

      <div className="cartbar">
        <div>
          <span>購物車</span>
          <small>{cartCount} 項</small>
        </div>
        <strong>${cartTotal.toLocaleString()}</strong>
      </div>

      {selected && (
        <div className="overlay" onClick={() => setSelected(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <button className="close" onClick={() => setSelected(null)}>×</button>
            <div className="eyebrow">商品</div>
            <h2>{selected.name}</h2>

            {selected.pricing_type === "amount" ? (
              <>
                <p className="label">選擇金額</p>
                <div className="amount-grid">
                  {amountOptions(selected).map(value => (
                    <button
                      key={value}
                      className={amount === value ? "amount active" : "amount"}
                      onClick={() => setAmount(value)}
                    >
                      ${value.toLocaleString()}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="fixed-price">${selected.price.toLocaleString()}</div>
            )}

            <p className="label">數量</p>
            <div className="quantity">
              <button onClick={() => setQty(Math.max(1, qty - 1))}>−</button>
              <strong>{qty}</strong>
              <button onClick={() => setQty(qty + 1)}>＋</button>
            </div>

            <button className="primary" onClick={addToCart}>
              加入購物車
            </button>
          </div>
        </div>
      )}
    </main>
  );
}