import test from "node:test";
import assert from "node:assert/strict";
import { getAiStreamingStatusText } from "./aiStreamingStatus.js";

test("getAiStreamingStatusText immediately shows the first analysis step", () => {
  assert.equal(getAiStreamingStatusText(0), "我先整理你目前的情境與提問。");
});

test("getAiStreamingStatusText appends more analysis steps over time", () => {
  assert.equal(
    getAiStreamingStatusText(900),
    [
      "我先整理你目前的情境與提問。",
      "正在檢查月份、金額與固定支出的影響。",
      "接著會估算現金流壓力與可能的風險。",
    ].join("\n"),
  );
});

test("getAiStreamingStatusText stops growing after the final step", () => {
  assert.equal(
    getAiStreamingStatusText(99999),
    [
      "我先整理你目前的情境與提問。",
      "正在檢查月份、金額與固定支出的影響。",
      "接著會估算現金流壓力與可能的風險。",
      "快整理好了，正在收斂成可預覽的 B 情境提議。",
    ].join("\n"),
  );
});
