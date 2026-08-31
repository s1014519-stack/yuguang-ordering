# 漁光閃閃店家後台 V1

後台網址：`https://你的網址/admin`

## 第一次設定

1. 到 Supabase Dashboard → Authentication → Users。
2. 建立一個店家管理員 Email / Password 帳號。
3. 到 SQL Editor 執行 `supabase-admin-v1.sql`。
4. 重新部署這份專案到 Vercel。
5. 開啟 `/admin`，使用剛建立的管理員帳號登入。

## V1 已完成

- 管理員 Email / Password 登入
- 營業中 / 休息中切換
- 修改休息提示訊息
- 最近 100 筆訂單列表
- 新訂單 / 已接單 / 已完成 / 已取消篩選
- 訂單明細
- 接單
- 完成訂單
- 取消訂單
- 恢復已完成 / 已取消訂單
- Supabase Realtime 訂單更新

## 安全說明

前端使用的仍是 publishable key，不要把 service_role key 放進 `.env.local` 或 Vercel 前端環境變數。
後台修改功能由 Supabase Auth + RLS 保護。
