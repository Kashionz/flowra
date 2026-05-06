# Supabase Migration Runbook

這份文件說明 Flowra 從舊的多情境 / 分享模型，收斂到單一雲端備份模型時，建議的 migration 套用順序與回滾注意事項。

## 套用順序

請依序執行以下 migration，不要跳號：

1. `supabase/migrations/20260505162604_flowra_cloud.sql`
2. `supabase/migrations/20260506120000_flowra_share_view_count_rpc.sql`
3. `supabase/migrations/20260506123000_flowra_single_backup.sql`

原因：

- `20260505162604_flowra_cloud.sql` 先建立舊的 `flowra_scenarios` / `flowra_share_links` 表與 RLS。
- `20260506120000_flowra_share_view_count_rpc.sql` 先補上舊分享功能用的 RPC，讓既有環境能完整對齊。
- `20260506123000_flowra_single_backup.sql` 最後才會：
  - 建立新的 `flowra_backups`
  - 從 `flowra_scenarios` 回填每位使用者最新一筆資料
  - 刪除 `flowra_share_links`
  - 刪除分享 RPC
  - 刪除 `flowra_scenarios`

## 套用前檢查

正式環境建議先做這些事：

1. 匯出資料庫備份，至少備份 `public.flowra_scenarios`、`public.flowra_share_links`。
2. 確認前端程式已部署到使用 `flowra_backups` 的版本。
3. 確認目前沒有仍依賴短網址分享或多版本清單的舊前端在使用。

## 建議執行方式

若你用 Supabase CLI：

```bash
supabase db push
```

若你是手動在 SQL Editor 套用，請務必照檔名順序執行，不要先跑 `20260506123000_flowra_single_backup.sql`。

## Migration 會做什麼

`20260506123000_flowra_single_backup.sql` 的行為是：

- 建立 `public.flowra_backups`
- 以 `user_id` 當主鍵，保證每位使用者只有一筆備份
- 從 `public.flowra_scenarios` 取每位使用者 `updated_at` 最新的一筆搬進新表
- 建立 `flowra_backups` 的 RLS policy
- 刪除：
  - `public.increment_flowra_share_view_count(text)`
  - `public.flowra_share_links`
  - `public.flowra_scenarios`

## 回滾注意事項

這批 migration 不是無損可逆。

原因：

- `20260506123000_flowra_single_backup.sql` 會刪掉舊表與分享 RPC。
- 一旦刪除後，若沒有事先備份，就不能直接還原到「多情境 / 分享」狀態。

所以回滾原則是：

1. 不要把回滾建立在「直接寫一支 down migration」的假設上。
2. 要把回滾建立在「先前備份 + 重新建立舊 schema + 回灌資料」。

## 建議回滾流程

如果 migration 套完後要回退，建議流程如下：

1. 先停止前端對資料庫的寫入。
2. 還原 migration 前的資料庫備份。
3. 重新部署仍使用舊 schema 的前端版本。

如果沒有完整資料庫備份，只能做有限回復：

1. 從 `flowra_backups` 匯出每位使用者最新 `payload`
2. 重新建立舊的 `flowra_scenarios` 結構
3. 把 `payload` 回灌成單筆 scenario

這種做法只能救回最新一筆資料，救不回：

- 舊的多情境清單
- 舊的分享短網址
- 舊的 `view_count`

## 風險提醒

以下情況不要直接在正式環境套用：

- 還有使用者正在使用舊版前端
- 你仍需要保留短網址分享
- 你還沒有做 migration 前備份

## 套用後驗證

套完後至少確認：

1. `public.flowra_backups` 存在
2. `public.flowra_scenarios` 不存在
3. `public.flowra_share_links` 不存在
4. 前端可以：
   - 同步備份
   - 還原最近備份
5. Supabase RLS 下，使用者只能讀寫自己的 `flowra_backups`
