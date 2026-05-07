import test from "node:test";
import assert from "node:assert/strict";

import { isScenarioEmpty, readInitialBoot } from "./initialBoot.js";

class MemoryStorage {
  constructor(initial = {}) {
    this.store = new Map(Object.entries(initial));
  }
  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }
  setItem(key, value) {
    this.store.set(key, String(value));
  }
  removeItem(key) {
    this.store.delete(key);
  }
}

// ----- readInitialBoot -------------------------------------------------

test("readInitialBoot returns null draft / pending / fallback meta when storage is missing", () => {
  const result = readInitialBoot({ storage: null });
  assert.equal(result.localDraft, null);
  assert.equal(result.pendingCloudSync, null);
  assert.deepEqual(result.sessionMeta, {
    lastOpenedAt: "",
    lastSyncedAt: "",
    lastSyncAttemptAt: "",
  });
});

test("readInitialBoot reads localDraft from storage", () => {
  const draft = { schemaVersion: 1, meta: { name: "x" }, basics: {} };
  const storage = new MemoryStorage({
    "flowra.cashflow.draft": JSON.stringify(draft),
  });
  const result = readInitialBoot({ storage });
  assert.deepEqual(result.localDraft, draft);
  assert.equal(result.pendingCloudSync, null);
});

test("readInitialBoot reads pendingCloudSync from storage", () => {
  const pending = {
    payload: { schemaVersion: 1, meta: { name: "y" }, basics: {} },
    updatedAt: "2026-05-07T10:00:00.000Z",
  };
  const storage = new MemoryStorage({
    "flowra.cashflow.pending-cloud-sync": JSON.stringify(pending),
  });
  const result = readInitialBoot({ storage });
  assert.deepEqual(result.pendingCloudSync, pending);
});

test("readInitialBoot uses injected readSessionMeta", () => {
  const sessionMeta = {
    lastOpenedAt: "2026-05-07T08:00:00.000Z",
    lastSyncedAt: "2026-05-07T08:30:00.000Z",
    lastSyncAttemptAt: "2026-05-07T08:30:00.000Z",
  };
  const result = readInitialBoot({
    storage: new MemoryStorage(),
    readSessionMeta: () => sessionMeta,
  });
  assert.deepEqual(result.sessionMeta, sessionMeta);
});

test("readInitialBoot is synchronous and returns ready data on first call", () => {
  // Documents the no-flash invariant: useUndoableState's lazy
  // initialiser receives the draft on the very first render, so the
  // UI never paints with createDefaultScenario() first.
  const draft = { schemaVersion: 1, meta: { name: "x" }, basics: {} };
  const storage = new MemoryStorage({
    "flowra.cashflow.draft": JSON.stringify(draft),
  });
  const before = Date.now();
  const result = readInitialBoot({ storage });
  const elapsed = Date.now() - before;
  assert.equal(result.localDraft.meta.name, "x");
  assert.ok(elapsed < 50, "readInitialBoot must complete synchronously");
});

// ----- isScenarioEmpty -------------------------------------------------

const emptyScenario = {
  basics: {
    startingTwd: 0,
    jpyCash: 0,
    jpyCashTwd: 0,
    monthlySalary: 0,
    monthlySubsidy: 0,
    monthlyRent: 0,
    monthlyLivingCost: 0,
    monthlyStudentLoan: 0,
  },
  oneTimeItems: [],
  installments: [],
};

test("isScenarioEmpty: zero-everything scenario is empty", () => {
  assert.equal(isScenarioEmpty(emptyScenario), true);
});

test("isScenarioEmpty: any positive numeric basics field disqualifies", () => {
  for (const key of [
    "startingTwd",
    "jpyCash",
    "jpyCashTwd",
    "monthlySalary",
    "monthlySubsidy",
    "monthlyRent",
    "monthlyLivingCost",
    "monthlyStudentLoan",
  ]) {
    const scenario = {
      ...emptyScenario,
      basics: { ...emptyScenario.basics, [key]: 1 },
    };
    assert.equal(isScenarioEmpty(scenario), false, `${key}=1 should NOT be empty`);
  }
});

test("isScenarioEmpty: any oneTime or installment item disqualifies", () => {
  assert.equal(isScenarioEmpty({ ...emptyScenario, oneTimeItems: [{ id: "x" }] }), false);
  assert.equal(isScenarioEmpty({ ...emptyScenario, installments: [{ id: "y" }] }), false);
});

test("isScenarioEmpty: missing or non-object scenario is treated as empty", () => {
  assert.equal(isScenarioEmpty(null), true);
  assert.equal(isScenarioEmpty(undefined), true);
  assert.equal(isScenarioEmpty("not-an-object"), true);
});

test("isScenarioEmpty: missing basics / arrays default to empty (no crash)", () => {
  assert.equal(isScenarioEmpty({}), true);
  assert.equal(isScenarioEmpty({ basics: {} }), true);
});

test("isScenarioEmpty: ignores irrelevant truthy basics like meta names", () => {
  // Only the numeric fields and array lengths matter. A scenario with
  // a non-empty meta.name but zero balances is still "empty" from the
  // empty-state UI's perspective.
  const scenario = { ...emptyScenario, meta: { name: "副本" } };
  assert.equal(isScenarioEmpty(scenario), true);
});
