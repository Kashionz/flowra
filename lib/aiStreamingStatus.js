const AI_STREAMING_STATUS_STEPS = [
  { afterMs: 0, text: "我先整理你目前的情境與提問。" },
  { afterMs: 350, text: "正在檢查月份、金額與固定支出的影響。" },
  { afterMs: 800, text: "接著會估算現金流壓力與可能的風險。" },
  { afterMs: 1400, text: "快整理好了，正在收斂成可預覽的 B 情境提議。" },
];

export function getAiStreamingStatusText(elapsedMs = 0) {
  const safeElapsedMs = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;

  return AI_STREAMING_STATUS_STEPS.filter((step) => safeElapsedMs >= step.afterMs)
    .map((step) => step.text)
    .join("\n");
}
