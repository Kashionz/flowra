import test from "node:test";
import assert from "node:assert/strict";

import {
  makeItemId,
  resetItemIdSequenceForTests,
  syncItemIdSequenceFromScenario,
} from "./itemIds.js";

test("syncItemIdSequenceFromScenario advances the counter past existing ids", () => {
  resetItemIdSequenceForTests();

  syncItemIdSequenceFromScenario({
    oneTimeItems: [{ id: "one-time-2" }, { id: "one-time-7" }],
    installments: [{ id: "installment-4" }],
  });

  assert.equal(makeItemId("one-time"), "one-time-8");
});

test("syncItemIdSequenceFromScenario ignores malformed ids and keeps generator usable", () => {
  resetItemIdSequenceForTests();

  syncItemIdSequenceFromScenario({
    oneTimeItems: [{ id: "legacy" }, { id: "" }, {}],
    installments: [{ id: "installment-x" }],
  });

  assert.equal(makeItemId("installment"), "installment-2");
});
