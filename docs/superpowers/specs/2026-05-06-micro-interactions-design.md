# Flowra Micro-interactions Design

日期：2026-05-06

## 目標

在不調整目前版型、資訊架構與資料流程的前提下，為 Flowra 補上低強度的微互動，提升操作回饋與視覺流暢度。

## 範圍

本次只處理互動細節，不做下列事項：

- 不新增功能
- 不重排版面
- 不更換色系
- 不加入高存在感動畫

## 選定方向

使用者已選擇 `B 平衡推薦`。

這個方向的原則：

- 所有動態都要短、輕、可預期
- hover 與 press 要能明顯感知，但不干擾閱讀
- 卡片與圖表可有輕微浮動，不做誇張縮放
- 所有動畫節奏維持一致

## 設計內容

### 1. 按鈕與操作控制

- 主要按鈕在 hover 時提高亮度、增加陰影、上移 1 到 2px
- 次要按鈕在 hover 時只做背景與邊框強化
- 按下時恢復位移並略微縮短陰影，形成按壓感
- disabled 狀態取消位移與陰影動態

### 2. 表單欄位與數字 stepper

- 輸入框 hover 時邊框顏色略微加深
- focus 時加入更清楚的外圈或陰影
- 數字 stepper 上下按鈕加入 hover 底色與按壓回饋
- 輸入框與 stepper 保持一體化視覺，不新增額外裝飾

### 3. 卡片與區塊

- 摘要卡、一般卡片、圖表卡在 hover 時輕微上浮
- 卡片 hover 時陰影加深，但不改變卡片尺寸
- drop-down、popover、modal 維持既有結構，只補淡入與小幅位移

### 4. 圖表互動

- 圖表外框在 hover 時維持穩定，不整塊大幅移動
- bar、legend、分類切換 pill 補小幅 hover 回饋
- 圖表切換月份或類別時，沿用現有 200ms 淡化節奏
- 不新增會分散注意力的連續動畫

### 5. 清單與表格

- 表格列 hover 時增加淡色背景
- 可點擊列或可展開區塊補上輕微背景變化
- 拖拉項目的 handle 在 hover 時增加視覺提示

## 動畫節奏

- 標準 hover / focus / press：`140ms - 180ms`
- 卡片與 popover 淡入：`180ms - 220ms`
- easing：以 `ease` 或 `ease-out` 為主

## 實作方式

- 優先沿用現有 `styles` inline object 結構
- 只在必要處補充 `onMouseEnter / onMouseLeave / onFocus / onBlur` 或共用 style 狀態
- 不引入新套件
- 不改動既有資料計算與 Supabase 流程

## 成功標準

- 使用者能清楚感受到 hover、focus、press 回饋
- 畫面不會變得花俏或分心
- 手機與桌面版都維持可用
- `npm run build:check` 通過

## 風險與控制

- 若互動狀態散落太多地方，維護成本會上升
  - 控制方式：盡量抽成共用 style token 與共用 helper
- 若 hover 太多，畫面會顯得忙
  - 控制方式：以按鈕、卡片、表格列、stepper 為主，不對所有元素加動態

## 實作後驗證

- 手動檢查按鈕、輸入框、stepper、卡片、圖表卡、表格列、popover
- 重新啟動本地預覽並確認 `5173` 為最新版
- 執行 `npm run build:check`
