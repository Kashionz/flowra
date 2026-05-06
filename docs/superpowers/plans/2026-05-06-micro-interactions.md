# Flowra Micro-interactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改動目前版型與資料流程的前提下，為 Flowra 補上低強度的 hover、focus、press 與卡片回饋，讓操作更順但不浮誇。

**Architecture:** 互動效果集中在 [personal_finance_cashflow_simulator.jsx](/Users/kashionz/Desktop/flowra/personal_finance_cashflow_simulator.jsx:1) 的 `styles` object 與少數共用元件。做法以共用 style token、短時長 transition 和必要的 hover/focus 事件為主，不引入新套件，也不更動 Supabase、資料模型與圖表資料計算。

**Tech Stack:** React、inline style object、Recharts、現有 Vite 開發環境

---

## File Structure

- Modify: [personal_finance_cashflow_simulator.jsx](/Users/kashionz/Desktop/flowra/personal_finance_cashflow_simulator.jsx:1)
  - 主頁面所有互動樣式、按鈕、輸入框、卡片、表格列、popover 與 modal 的微互動
- Reference: [docs/superpowers/specs/2026-05-06-micro-interactions-design.md](/Users/kashionz/Desktop/flowra/docs/superpowers/specs/2026-05-06-micro-interactions-design.md:1)
  - 本次互動規格基準

### Task 1: 建立共用互動樣式基底

**Files:**
- Modify: [personal_finance_cashflow_simulator.jsx](/Users/kashionz/Desktop/flowra/personal_finance_cashflow_simulator.jsx:1109)

- [ ] **Step 1: 先找到現有樣式集中區與重複按鈕樣式**

Run:
```bash
rg -n "button:|smallButton:|tinyButton:|card:|statCard:|input:|select:|tableWrap:" personal_finance_cashflow_simulator.jsx
```
Expected: 列出 `styles` 內主要互動元件的定義位置。

- [ ] **Step 2: 新增共用 transition token 與 surface/button/input 狀態樣式**

在 `styles` object 上方或內部相鄰區塊加入可重用設定，包含：

```js
const MOTION = {
  fast: "160ms ease",
  medium: "200ms ease",
};
```

並擴充既有 style，讓以下屬性集中管理：

```js
transition: "transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease, background 160ms ease, opacity 160ms ease",
willChange: "transform, box-shadow",
```

調整對象：
- `button`
- `smallButton`
- `tinyButton`
- `pillButton`
- `activePill`
- `dangerButton`
- `card`
- `statCard`
- `item`
- `input`
- `select`
- `numberFieldWrap`
- `stepperButton`

- [ ] **Step 3: 用最小變更補上 hover/focus/press 需要的衍生 style key**

加入新 style key，避免每個元件重複硬寫：

```js
buttonHover
smallButtonHover
tinyButtonHover
cardHover
statCardHover
inputHover
inputFocus
stepperButtonHover
tableRowHover
popoverMotion
modalMotion
```

Expected: 之後渲染時只需條件合併 style，不需要再散落多組 magic values。

- [ ] **Step 4: 確認檔案仍可編譯**

Run:
```bash
npm run build:check
```
Expected: `build:check` 成功。

### Task 2: 為按鈕、欄位與 stepper 接上互動狀態

**Files:**
- Modify: [personal_finance_cashflow_simulator.jsx](/Users/kashionz/Desktop/flowra/personal_finance_cashflow_simulator.jsx:845)
- Modify: [personal_finance_cashflow_simulator.jsx](/Users/kashionz/Desktop/flowra/personal_finance_cashflow_simulator.jsx:2200)

- [ ] **Step 1: 盤點需要互動回饋的共用欄位與主要按鈕**

Run:
```bash
rg -n "style=\\{styles\\.(button|smallButton|tinyButton|input|select|numberFieldWrap)" personal_finance_cashflow_simulator.jsx
```
Expected: 找出共用按鈕與欄位主要使用點。

- [ ] **Step 2: 在 `Field` 元件內加入 hover / focus 狀態**

將 `Field` 改成局部 state 控制，例如：

```js
const [isHovered, setIsHovered] = useState(false);
const [isFocused, setIsFocused] = useState(false);
```

並套用在：
- `numberFieldWrap`
- `numberInput`
- `stepperButton`

需要接入：

```jsx
onMouseEnter={() => setIsHovered(true)}
onMouseLeave={() => setIsHovered(false)}
onFocus={() => setIsFocused(true)}
onBlur={() => setIsFocused(false)}
```

Expected:
- hover 時外框與陰影更明顯
- focus 時外圈更清楚
- stepper 上下鍵 hover 有底色回饋

- [ ] **Step 3: 在一般 `<input>` 與 `<select>` 也套用相同互動規則**

對基本設定與清單內各輸入欄位，將：

```jsx
style={styles.input}
style={styles.select}
```

改成條件合併，例如：

```jsx
style={{
  ...styles.input,
  ...(hovered ? styles.inputHover : null),
  ...(focused ? styles.inputFocus : null),
}}
```

如果個別欄位太多，先抽出小型包裝 helper，避免每個欄位都重複 `useState`。

- [ ] **Step 4: 為主要操作按鈕加上 hover / press 視覺回饋**

目標按鈕：
- 頁首工具按鈕
- 分享 popover 內按鈕
- 匯出 dropdown 內按鈕
- `同步雲端`
- `讀取雲端版本`

回饋內容：
- hover：上移 1 到 2px、陰影加深、背景更亮
- active：位移歸零、陰影縮短
- disabled：維持靜態

- [ ] **Step 5: 執行編譯驗證**

Run:
```bash
npm run build:check
```
Expected: `build:check` 成功。

### Task 3: 為卡片、圖表區、表格列補上低強度 surface 回饋

**Files:**
- Modify: [personal_finance_cashflow_simulator.jsx](/Users/kashionz/Desktop/flowra/personal_finance_cashflow_simulator.jsx:1223)
- Modify: [personal_finance_cashflow_simulator.jsx](/Users/kashionz/Desktop/flowra/personal_finance_cashflow_simulator.jsx:2400)

- [ ] **Step 1: 找出卡片與表格主要渲染位置**

Run:
```bash
rg -n "styles\\.card|styles\\.statCard|styles\\.item|<table|<tr|sharePopover|modalCard" personal_finance_cashflow_simulator.jsx
```
Expected: 找到摘要卡、圖表卡、清單卡、表格列、popover、modal 的渲染位置。

- [ ] **Step 2: 對摘要卡、一般卡片、圖表卡補上 hover 上浮**

以局部 `hoveredCardId` 或簡單包裝元件處理，目標效果：

```js
transform: "translateY(-3px)"
boxShadow: "0 18px 36px rgba(37,99,235,0.09)"
```

限制：
- 不改變寬高
- 不做 scale
- 不對整個大區塊容器加過度動態

- [ ] **Step 3: 對表格列與可展開清單項目加入 hover 背景**

目標：
- 月度明細表格列 hover 時有非常淡的背景色
- 可展開區塊標題列 hover 時有輕微底色或邊框變化
- 拖拉 handle hover 時加深邊框與背景

- [ ] **Step 4: 為 popover、dropdown、modal 補上輕量進場樣式**

將現有：
- `dropdownMenu`
- `sharePopover`
- `modalCard`

補上：

```js
opacity
transform: "translateY(4px)"
transition: "opacity 180ms ease, transform 180ms ease"
```

只做一次性進場，不做循環動畫。

- [ ] **Step 5: 執行編譯驗證**

Run:
```bash
npm run build:check
```
Expected: `build:check` 成功。

### Task 4: 整體驗證與本地預覽確認

**Files:**
- Modify: [personal_finance_cashflow_simulator.jsx](/Users/kashionz/Desktop/flowra/personal_finance_cashflow_simulator.jsx:1)

- [ ] **Step 1: 啟動或重啟本地預覽**

Run:
```bash
pnpm dev --host 127.0.0.1 --port 5173
```
Expected: 顯示 `Local: http://127.0.0.1:5173/`。

- [ ] **Step 2: 檢查伺服器是否送出新版模組**

Run:
```bash
curl -s http://127.0.0.1:5173/personal_finance_cashflow_simulator.jsx | rg -n "buttonHover|cardHover|inputFocus|stepperButtonHover|tableRowHover"
```
Expected: 可找到本次新增的互動 style key。

- [ ] **Step 3: 手動驗證主要互動點**

檢查清單：
- 按鈕 hover / active
- 數字欄位 hover / focus / stepper hover
- 一般輸入框與 select focus
- 摘要卡與圖表卡 hover
- 表格列 hover
- popover / dropdown / modal 進場感

Expected: 有回饋，但不誇張，不影響閱讀。

- [ ] **Step 4: 最終編譯驗證**

Run:
```bash
npm run build:check
```
Expected: `build:check` 成功。

## Self-Review

- Spec coverage:
  - 按鈕、表單、stepper、卡片、圖表、表格、popover、modal 都有對應 task。
  - 無新增功能、無改版型、無新套件，符合 spec。
- Placeholder scan:
  - 已給出明確檔案、命令、目標 style key 與驗證方式，沒有 `TODO` 或 `之後補`。
- Type consistency:
  - 使用的 style key 僅限本計畫中定義名稱，沒有前後命名不一致。
