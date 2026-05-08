import test from "node:test";
import assert from "node:assert/strict";

import { shouldSubmitTextareaOnEnter } from "./enterKeySubmission.js";

test("IME 組字中按 Enter 選字時不應送出", () => {
  assert.equal(
    shouldSubmitTextareaOnEnter(
      {
        key: "Enter",
        shiftKey: false,
        nativeEvent: { isComposing: true },
      },
      { isComposing: false },
    ),
    false,
  );

  assert.equal(
    shouldSubmitTextareaOnEnter(
      {
        key: "Enter",
        shiftKey: false,
        nativeEvent: { isComposing: false, keyCode: 229 },
      },
      { isComposing: false },
    ),
    false,
  );

  assert.equal(
    shouldSubmitTextareaOnEnter(
      {
        key: "Enter",
        shiftKey: false,
        nativeEvent: { isComposing: false },
      },
      { isComposing: true },
    ),
    false,
  );
});

test("非組字狀態的 Enter 才會送出", () => {
  assert.equal(
    shouldSubmitTextareaOnEnter(
      {
        key: "Enter",
        shiftKey: false,
        nativeEvent: { isComposing: false },
      },
      { isComposing: false },
    ),
    true,
  );

  assert.equal(
    shouldSubmitTextareaOnEnter(
      {
        key: "Enter",
        shiftKey: true,
        nativeEvent: { isComposing: false },
      },
      { isComposing: false },
    ),
    false,
  );

  assert.equal(
    shouldSubmitTextareaOnEnter(
      {
        key: "a",
        shiftKey: false,
        nativeEvent: { isComposing: false },
      },
      { isComposing: false },
    ),
    false,
  );
});
