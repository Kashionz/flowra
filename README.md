# Flowra

Flowra 是一個前端導向的個人現金流試算工具，用來模擬未來幾個月的收入、固定支出、一次性收支與分期付款，並用圖表快速看出月底現金變化。

目前專案已包含：

- 現金流試算主頁
- 月底現金趨勢圖
- 每月收入與支出圖
- 支出組成堆疊面積圖
- 一次性收支與分期清單管理
- JSON / PNG / PDF / XLSX / 列印匯出
- Supabase 雲端備份與還原最近備份

## 技術棧

- React 19
- Vite 7
- Recharts
- shadcn-style chart wrapper
- Supabase JS
- dnd-kit
- html-to-image
- jsPDF
- SheetJS (`xlsx`)

## 本機開發

先安裝依賴：

```bash
pnpm install
```

啟動開發伺服器：

```bash
pnpm dev
```

預設網址：

```text
http://127.0.0.1:5173/
```

## 建置檢查

```bash
npm run build:check
```

這個指令會用 `esbuild` 檢查主檔是否可正常 bundle。

## 專案結構

```text
.
├─ components/
│  └─ ui/
│     └─ chart.jsx
├─ docs/
│  └─ superpowers/
│     ├─ plans/
│     └─ specs/
├─ lib/
│  ├─ flowraSupabase.js
│  ├─ templates/
│  └─ utils.js
├─ styles/
│  ├─ flowra.css
│  └─ flowra.tailwind.css
├─ supabase/
│  └─ migrations/
├─ index.html
├─ main.jsx
└─ personal_finance_cashflow_simulator.jsx
```

## 環境變數

可參考 `.env.example`：

```env
FLOWRA_SUPABASE_URL=https://your-project-ref.supabase.co
FLOWRA_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

本機開發通常使用：

- `.env.local`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

## Supabase 設定

若要啟用雲端備份，除了環境變數以外，還要先套用 migration：

```text
supabase/migrations/20260505162604_flowra_cloud.sql
supabase/migrations/20260506120000_flowra_share_view_count_rpc.sql
supabase/migrations/20260506123000_flowra_single_backup.sql
```

目前雲端能力包含：

- 同步最新備份
- 還原最近備份

## 目前產品行為

這個版本是依照目前需求收斂後的版本，幾點需要先知道：

- 不保留本機草稿內容，只保留時間資訊
- 已移除 Sankey 金流圖
- 已移除月度熱力圖
- 已移除草稿與範本 UI
- 已移除隱私模式
- 已移除「還原預設」操作

## 匯出能力

目前支援：

- 整頁 PNG
- 單張圖 PNG
- PDF 報表
- Excel 明細
- JSON 匯出
- 列印

## 文件

- 原始需求規格：[`flowra-spec.md`](./flowra-spec.md)
- Supabase migration runbook：[`docs/supabase-migration-runbook.md`](./docs/supabase-migration-runbook.md)
- Supabase 遠端驗證清單：[`docs/supabase-remote-verification-checklist.md`](./docs/supabase-remote-verification-checklist.md)
