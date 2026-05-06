# Supabase 遠端驗證清單

這份清單用來在 migration 套用完成後，快速確認正式資料庫已切到單一備份模型。

## 1. Migration 歷史

在專案目錄執行：

```bash
supabase migration list
```

應確認遠端至少有這三筆：

- `20260505162604`
- `20260506120000`
- `20260506123000`

## 2. 資料表狀態

在 Supabase SQL Editor 執行：

```sql
select
  to_regclass('public.flowra_backups') as backups_table,
  to_regclass('public.flowra_scenarios') as scenarios_table,
  to_regclass('public.flowra_share_links') as share_links_table;
```

預期結果：

- `backups_table` = `public.flowra_backups`
- `scenarios_table` = `null`
- `share_links_table` = `null`

## 3. 備份資料是否存在

在 Supabase SQL Editor 執行：

```sql
select user_id, updated_at
from public.flowra_backups
order by updated_at desc
limit 10;
```

預期結果：

- 查得到既有使用者的最新備份
- 同一個 `user_id` 不應出現多筆

若要直接檢查唯一性：

```sql
select user_id, count(*)
from public.flowra_backups
group by user_id
having count(*) > 1;
```

預期結果：

- `0 rows`

## 4. RLS 是否開啟

在 Supabase SQL Editor 執行：

```sql
select relname, relrowsecurity
from pg_class
where relname = 'flowra_backups';
```

預期結果：

- `relrowsecurity` = `true`

## 5. 前端最小行為驗證

用實際帳號登入前端後，至少驗證兩件事：

1. 修改任一筆資料後按「同步備份」，畫面出現成功訊息
2. 再修改資料，按「還原最近備份」，內容會回到剛同步的版本

## 6. 失敗時先看哪裡

如果驗證失敗，先優先檢查：

1. `supabase migration list` 的遠端版本是否少一筆
2. `public.flowra_backups` 是否存在
3. 前端環境變數是否正確：
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
4. 前端是否已部署到使用 `flowra_backups` 的版本
