import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAiConversationHistory } from "./aiScenarioHistory.js";

test("normalizeAiConversationHistory converts assistant clarification questions into text content", () => {
  const result = normalizeAiConversationHistory([
    { role: "user", content: "明年買車" },
    { role: "assistant", questions: ["預計哪一個月份買？", "頭期款多少？"] },
  ]);

  assert.deepEqual(result, [
    { role: "user", content: "明年買車" },
    {
      role: "assistant",
      content: "請補充以下資訊：\n- 預計哪一個月份買？\n- 頭期款多少？",
    },
  ]);
});

test("normalizeAiConversationHistory drops malformed entries without role/content", () => {
  const result = normalizeAiConversationHistory([
    null,
    { role: "assistant", questions: [] },
    { role: "user", content: "  " },
    { role: "assistant", content: "已收到" },
  ]);

  assert.deepEqual(result, [{ role: "assistant", content: "已收到" }]);
});
