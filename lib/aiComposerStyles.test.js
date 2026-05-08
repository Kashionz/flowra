import test from "node:test";
import assert from "node:assert/strict";
import { getAiComposerButtonTone } from "./aiComposerStyles.js";

test("getAiComposerButtonTone returns send styling when idle", () => {
  const tone = getAiComposerButtonTone({ loading: false, disabled: false });

  assert.equal(tone.label, "送出");
  assert.equal(tone.background, "#0284c7");
  assert.equal(tone.borderColor, "#0284c7");
});

test("getAiComposerButtonTone returns stop styling while loading", () => {
  const tone = getAiComposerButtonTone({ loading: true, disabled: false });

  assert.equal(tone.label, "停止");
  assert.equal(tone.background, "#dc2626");
  assert.equal(tone.borderColor, "#dc2626");
});

test("getAiComposerButtonTone returns disabled styling when unavailable", () => {
  const tone = getAiComposerButtonTone({ loading: false, disabled: true });

  assert.equal(tone.label, "送出");
  assert.equal(tone.background, "#cbd5e1");
  assert.equal(tone.borderColor, "#cbd5e1");
});
