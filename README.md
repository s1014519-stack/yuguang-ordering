# 漁光閃閃 QR 點餐 V1

這是顧客端 V1：從 Supabase 讀取啟用中的 categories / products，支援固定價格與按金額商品，並可加入購物車。

## 1. 安裝

```bash
npm install
```

## 2. 設定 Supabase

複製 `.env.local.example` 成 `.env.local`：

```bash
cp .env.local.example .env.local
```

填入：
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

不要放 service role key。

## 3. 啟動

```bash
npm run dev
```

開啟 http://localhost:3000

## 已完成
- 讀取 active categories
- 讀取 active products
- 固定價格商品
- 按金額商品（依 min/max/step 動態產生）
- 商品選擇視窗
- 數量調整
- 購物車計算

## 下一版
- 購物車完整頁
- customer_name / customer_phone / note
- 寫入 orders
- 寫入 order_items
- 訂單成功頁


## V5 新增：營業狀態
1. 先在 Supabase SQL Editor 執行 `supabase-v5-store-settings.sql`。
2. `store_settings.id = 1` 的 `is_open = true` 時正常點餐。
3. `is_open = false` 時前端顯示休息通知、停用商品選擇與購物車送單。
4. 送單前會再次讀取營業狀態，降低客人停留舊頁面後仍送單的風險。
5. 前端也訂閱 `store_settings` 更新；若 Supabase Realtime 已允許此資料表，切換狀態可即時反映。
