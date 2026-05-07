import test from "node:test";
import assert from "node:assert/strict";

import { normalizeNumericInput, stepNumericValue } from "./numberField.js";

test("APR 輸入可保留到小數點後 1 位", () => {
  assert.equal(normalizeNumericInput("10.14", { precision: 1 }), 10.1);
  assert.equal(normalizeNumericInput("10.15", { precision: 1 }), 10.2);
});

test("APR 步進可用 0.1 增減", () => {
  assert.equal(stepNumericValue(10, 0.1, "up", { precision: 1 }), 10.1);
  assert.equal(stepNumericValue(10.1, 0.1, "down", { precision: 1, min: 0 }), 10);
});
