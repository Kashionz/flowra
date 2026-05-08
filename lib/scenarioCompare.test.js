import test from "node:test";
import assert from "node:assert/strict";
import { computeDiffSummary } from "./scenarioCompare.js";

const rowsA = [
  { monthKey: "2026-01", balance: 100000 },
  { monthKey: "2026-02", balance: 80000 },
  { monthKey: "2026-03", balance: 60000 },
  { monthKey: "2026-04", balance: 50000 },
];
const rowsB = [
  { monthKey: "2026-01", balance: 100000 },
  { monthKey: "2026-02", balance: 50000 },
  { monthKey: "2026-03", balance: -10000 },
  { monthKey: "2026-04", balance: -30000 },
];

test("computeDiffSummary returns ending balance delta", () => {
  const s = computeDiffSummary(rowsA, rowsB);
  assert.equal(s.endingBalanceDelta, -30000 - 50000);
});

test("computeDiffSummary returns max debt (lowest balance) delta", () => {
  const s = computeDiffSummary(rowsA, rowsB);
  assert.equal(s.maxDebtA, 50000);
  assert.equal(s.maxDebtB, -30000);
});

test("computeDiffSummary returns first month balance < 0 (bottom-out)", () => {
  const s = computeDiffSummary(rowsA, rowsB);
  assert.equal(s.firstNegativeA, null);
  assert.equal(s.firstNegativeB, "2026-03");
});

test("empty rows returns null fields without throwing", () => {
  const s = computeDiffSummary([], []);
  assert.equal(s.endingBalanceDelta, 0);
  assert.equal(s.firstNegativeA, null);
  assert.equal(s.firstNegativeB, null);
});
