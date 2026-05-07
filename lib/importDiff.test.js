import test from "node:test";
import assert from "node:assert/strict";

import { IMPORT_DIFF_FIELDS, computeImportDiff } from "./importDiff.js";

function makeScenario(overrides = {}) {
  return {
    basics: {
      startingTwd: 0,
      jpyCash: 0,
      monthlySalary: 0,
      monthlySubsidy: 0,
      monthlyRent: 0,
      monthlyLivingCost: 0,
      monthlyStudentLoan: 0,
      monthsToProject: 12,
      ...(overrides.basics || {}),
    },
    oneTimeItems: overrides.oneTimeItems || [],
    installments: overrides.installments || [],
  };
}

test("returns one row per IMPORT_DIFF_FIELDS entry, in declared order", () => {
  const diff = computeImportDiff(makeScenario(), makeScenario());
  assert.equal(diff.basics.length, IMPORT_DIFF_FIELDS.length);
  diff.basics.forEach((row, index) => {
    assert.equal(row.key, IMPORT_DIFF_FIELDS[index].key);
    assert.equal(row.label, IMPORT_DIFF_FIELDS[index].label);
    assert.equal(row.suffix, IMPORT_DIFF_FIELDS[index].suffix);
  });
});

test("identical scenarios produce no `changed` rows", () => {
  const sameBasics = { startingTwd: 1000, monthlyRent: 15000 };
  const diff = computeImportDiff(
    makeScenario({ basics: sameBasics }),
    makeScenario({ basics: sameBasics }),
  );
  for (const row of diff.basics) {
    assert.equal(row.changed, false, `row ${row.key} should be unchanged`);
  }
});

test("different basics produce changed rows with both values", () => {
  const current = makeScenario({ basics: { startingTwd: 1000, monthlyRent: 15000 } });
  const incoming = makeScenario({ basics: { startingTwd: 5000, monthlyRent: 15000 } });
  const diff = computeImportDiff(current, incoming);
  const startingRow = diff.basics.find((row) => row.key === "startingTwd");
  const rentRow = diff.basics.find((row) => row.key === "monthlyRent");
  assert.equal(startingRow.changed, true);
  assert.equal(startingRow.current, 1000);
  assert.equal(startingRow.incoming, 5000);
  assert.equal(rentRow.changed, false);
});

test("missing basics fields are coerced to 0", () => {
  const current = makeScenario();
  const incoming = { basics: {}, oneTimeItems: [], installments: [] };
  const diff = computeImportDiff(current, incoming);
  for (const row of diff.basics) {
    assert.equal(row.incoming, 0);
  }
});

test("non-numeric basics values are coerced to 0", () => {
  const current = makeScenario({ basics: { startingTwd: 1000 } });
  const incoming = makeScenario({ basics: { startingTwd: "garbage" } });
  const diff = computeImportDiff(current, incoming);
  const row = diff.basics.find((r) => r.key === "startingTwd");
  assert.equal(row.incoming, 0);
  assert.equal(row.changed, true);
});

test("counts oneTimeItems and installments on both sides", () => {
  const current = makeScenario({
    oneTimeItems: [{ id: "1" }, { id: "2" }],
    installments: [{ id: "x" }],
  });
  const incoming = makeScenario({
    oneTimeItems: [{ id: "a" }],
    installments: [{ id: "y" }, { id: "z" }, { id: "w" }],
  });
  const diff = computeImportDiff(current, incoming);
  assert.deepEqual(diff.oneTime, { current: 2, incoming: 1 });
  assert.deepEqual(diff.installments, { current: 1, incoming: 3 });
});

test("handles undefined current scenario gracefully (e.g. fresh app)", () => {
  const diff = computeImportDiff(undefined, makeScenario());
  for (const row of diff.basics) {
    assert.equal(row.current, 0);
  }
  assert.equal(diff.oneTime.current, 0);
  assert.equal(diff.installments.current, 0);
});
