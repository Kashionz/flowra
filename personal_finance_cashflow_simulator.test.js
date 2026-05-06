import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./personal_finance_cashflow_simulator.jsx", import.meta.url), "utf8");

test("scenario dirty effect persists local draft and pending cloud sync record", () => {
  assert.match(source, /writeDraftScenario/);
  assert.match(source, /writePendingCloudSync/);
  assert.match(source, /const persisted = toPersistedScenario\(scenario\)/);
  assert.match(source, /const updatedAt = new Date\(\)\.toISOString\(\)/);
  assert.match(source, /writeDraftScenario\(window\.localStorage,\s*persisted\)/);
  assert.match(source, /writePendingCloudSync\(window\.localStorage,\s*persisted,\s*updatedAt\)/);
  assert.match(source, /hasLocalDraftRef\.current = true/);
  assert.match(source, /hasPendingCloudSyncRef\.current = true/);
});
