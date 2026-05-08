import test from "node:test";
import assert from "node:assert/strict";
import { applyDiff, validateDiff } from "./aiScenarioDiff.js";

const baseScenario = () => ({
  schemaVersion: 1,
  meta: { name: "test", description: "", baseMonth: "2026-01", createdAt: "", updatedAt: "" },
  basics: {
    startingTwd: 100000,
    jpyCash: 0,
    jpyCashTwd: 0,
    includeJpyCash: false,
    monthlySalary: 50000,
    salaryStartsMonth: "2026-01",
    monthlySubsidy: 0,
    subsidyStartsMonth: "2026-01",
    monthlyRent: 15000,
    monthlyLivingCost: 25000,
    monthlyStudentLoan: 0,
    monthsToProject: 24,
  },
  oneTimeItems: [
    {
      id: "one-time-1",
      name: "舊筆電",
      amount: 30000,
      month: "2026-03",
      type: "expense",
      category: "other",
    },
  ],
  installments: [],
});

test("add_installment appends to installments with deterministic id", () => {
  const out = applyDiff(baseScenario(), {
    summary: "車貸",
    changes: [
      {
        op: "add_installment",
        value: { name: "車貸", principal: 600000, apr: 3, terms: 60, startMonth: "2027-06" },
      },
    ],
    warnings: [],
    explanation: "",
  });
  assert.equal(out.installments.length, 1);
  assert.equal(out.installments[0].name, "車貸");
  assert.match(out.installments[0].id, /^ai-installment-/);
});

test("set_basic with allowed field updates basics", () => {
  const out = applyDiff(baseScenario(), {
    summary: "",
    changes: [{ op: "set_basic", field: "monthlyLivingCost", value: 28000 }],
    warnings: [],
    explanation: "",
  });
  assert.equal(out.basics.monthlyLivingCost, 28000);
});

test("set_basic with forbidden field throws", () => {
  assert.throws(
    () =>
      applyDiff(baseScenario(), {
        summary: "",
        changes: [{ op: "set_basic", field: "startingTwd", value: 9999999 }],
        warnings: [],
        explanation: "",
      }),
    /forbidden field|不允許/,
  );
});

test("remove_one_time by name removes matching item", () => {
  const out = applyDiff(baseScenario(), {
    summary: "",
    changes: [{ op: "remove_one_time", name: "舊筆電" }],
    warnings: [],
    explanation: "",
  });
  assert.equal(out.oneTimeItems.length, 0);
});

test("update_one_time by id mutates that item only", () => {
  const out = applyDiff(baseScenario(), {
    summary: "",
    changes: [
      {
        op: "update_one_time",
        id: "one-time-1",
        value: { amount: 35000 },
      },
    ],
    warnings: [],
    explanation: "",
  });
  assert.equal(out.oneTimeItems[0].amount, 35000);
  assert.equal(out.oneTimeItems[0].name, "舊筆電");
});

test("unknown op throws", () => {
  assert.throws(
    () =>
      applyDiff(baseScenario(), {
        summary: "",
        changes: [{ op: "delete_everything" }],
        warnings: [],
        explanation: "",
      }),
    /unknown op|未知操作/,
  );
});

test("does not mutate input scenario", () => {
  const input = baseScenario();
  applyDiff(input, {
    summary: "",
    changes: [{ op: "set_basic", field: "monthlySalary", value: 60000 }],
    warnings: [],
    explanation: "",
  });
  assert.equal(input.basics.monthlySalary, 50000);
});

test("validateDiff rejects installment startMonth before baseMonth", () => {
  const errors = validateDiff(baseScenario(), {
    summary: "",
    changes: [
      {
        op: "add_installment",
        value: { name: "X", principal: 100, apr: 1, terms: 12, startMonth: "2025-01" },
      },
    ],
    warnings: [],
    explanation: "",
  });
  assert.ok(errors.length >= 1);
  assert.match(errors[0], /startMonth/);
});

test("validateDiff rejects negative amount", () => {
  const errors = validateDiff(baseScenario(), {
    summary: "",
    changes: [
      { op: "add_one_time", value: { name: "X", amount: -1, month: "2026-06", type: "expense" } },
    ],
    warnings: [],
    explanation: "",
  });
  assert.ok(errors.length >= 1);
});

test("validateDiff returns empty array for valid diff", () => {
  const errors = validateDiff(baseScenario(), {
    summary: "",
    changes: [
      {
        op: "add_installment",
        value: { name: "車貸", principal: 600000, apr: 3, terms: 60, startMonth: "2027-06" },
      },
    ],
    warnings: [],
    explanation: "",
  });
  assert.deepEqual(errors, []);
});
