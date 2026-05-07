import test from "node:test";
import assert from "node:assert/strict";

import { CATEGORY_META, CATEGORY_OPTIONS } from "./expenseCategories.js";

test("娛樂分類會出現在分類選單與對應文案中", () => {
  assert.equal(CATEGORY_META.entertainment.label, "娛樂");
  assert.ok(CATEGORY_META.entertainment.color);
  assert.ok(CATEGORY_OPTIONS.includes("entertainment"));
});
