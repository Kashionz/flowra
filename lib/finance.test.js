import test from "node:test";
import assert from "node:assert/strict";

import {
  addMonths,
  decorateInstallments,
  buildProjection,
  diffMonths,
  formatMonthLabel,
  formatYearMonth,
  monthlyPayment,
  n,
  parseYearMonth,
  reserveTarget,
  resolveJpyCashTwd,
} from "./finance.js";

// ----- n -----------------------------------------------------------------

test("n returns numeric values for valid inputs", () => {
  assert.equal(n(42), 42);
  assert.equal(n("10"), 10);
  assert.equal(n("3.14"), 3.14);
});

test("n returns 0 for non-numeric or non-finite inputs", () => {
  assert.equal(n(""), 0);
  assert.equal(n(null), 0);
  assert.equal(n(undefined), 0);
  assert.equal(n("abc"), 0);
  assert.equal(n(NaN), 0);
  assert.equal(n(Infinity), 0);
});

// ----- parseYearMonth / addMonths / diffMonths / formatMonthLabel -------

test("parseYearMonth parses YYYY-MM strings and clamps month to 1..12", () => {
  assert.deepEqual(parseYearMonth("2026-05"), { year: 2026, month: 5 });
  assert.deepEqual(parseYearMonth("2026-13"), { year: 2026, month: 12 });
  assert.deepEqual(parseYearMonth("2026-00"), { year: 2026, month: 1 });
});

test("parseYearMonth falls back to a deterministic default for invalid inputs", () => {
  assert.deepEqual(parseYearMonth(""), { year: 2026, month: 5 });
  assert.deepEqual(parseYearMonth("abc"), { year: 2026, month: 5 });
  assert.deepEqual(parseYearMonth(null), { year: 2026, month: 5 });
});

test("formatYearMonth zero-pads single-digit months", () => {
  assert.equal(formatYearMonth(2026, 1), "2026-01");
  assert.equal(formatYearMonth(2026, 12), "2026-12");
});

test("addMonths rolls year boundaries forward and backward", () => {
  assert.equal(addMonths("2026-01", 0), "2026-01");
  assert.equal(addMonths("2026-01", 1), "2026-02");
  assert.equal(addMonths("2026-12", 1), "2027-01");
  assert.equal(addMonths("2026-01", -1), "2025-12");
  assert.equal(addMonths("2026-01", 24), "2028-01");
});

test("diffMonths returns the signed month delta between two month keys", () => {
  assert.equal(diffMonths("2026-01", "2026-01"), 0);
  assert.equal(diffMonths("2026-01", "2026-05"), 4);
  assert.equal(diffMonths("2026-12", "2027-03"), 3);
  assert.equal(diffMonths("2026-05", "2026-01"), -4);
});

test("formatMonthLabel produces full and short Chinese labels", () => {
  assert.equal(formatMonthLabel("2026-05"), "2026年5月");
  assert.equal(formatMonthLabel("2026-05", true), "5月");
});

// ----- monthlyPayment ----------------------------------------------------

test("monthlyPayment evenly divides principal when APR is zero", () => {
  assert.equal(monthlyPayment(120000, 0, 12), 10000);
  assert.equal(monthlyPayment(0, 0, 12), 0);
});

test("monthlyPayment uses standard amortisation when APR is positive", () => {
  // APR 12% (1% monthly), 12 terms, principal 1200 → ~106.62 per month
  const payment = monthlyPayment(1200, 12, 12);
  assert.ok(Math.abs(payment - 106.62) < 0.01, `expected ~106.62, got ${payment}`);
});

test("monthlyPayment guards against zero or negative terms by clamping to 1", () => {
  assert.equal(monthlyPayment(1000, 0, 0), 1000);
  assert.equal(monthlyPayment(1000, 0, -5), 1000);
});

test("decorateInstallments keeps the latest editable fields while adding payment metadata", () => {
  const result = decorateInstallments([
    { id: "installment-1", name: "機車分期", principal: 12000, apr: 12, terms: 12 },
  ]);

  assert.equal(result.length, 1);
  assert.equal(result[0].id, "installment-1");
  assert.equal(result[0].name, "機車分期");
  assert.equal(result[0].terms, 12);
  assert.ok(
    Math.abs(result[0].payment - 1066.19) < 0.01,
    `unexpected payment ${result[0].payment}`,
  );
  assert.ok(
    Math.abs(result[0].interest - 794.23) < 0.02,
    `unexpected interest ${result[0].interest}`,
  );
});

// ----- resolveJpyCashTwd -------------------------------------------------

test("resolveJpyCashTwd uses jpyCash * rate when both are positive", () => {
  assert.equal(
    resolveJpyCashTwd({ jpyCash: 10000, jpyCashTwd: 0 }, 0.21),
    Math.round(10000 * 0.21),
  );
});

test("resolveJpyCashTwd falls back to legacy jpyCashTwd when jpyCash is zero", () => {
  assert.equal(resolveJpyCashTwd({ jpyCash: 0, jpyCashTwd: 18321 }, 0.21), 18321);
});

test("resolveJpyCashTwd falls back when rate is zero or missing", () => {
  assert.equal(resolveJpyCashTwd({ jpyCash: 10000, jpyCashTwd: 1500 }, 0), 1500);
  assert.equal(resolveJpyCashTwd({ jpyCash: 10000, jpyCashTwd: 0 }, 0), 0);
});

// ----- reserveTarget -----------------------------------------------------

test("reserveTarget is three months of fixed costs", () => {
  const scenario = {
    basics: { monthlyRent: 15000, monthlyLivingCost: 10000, monthlyStudentLoan: 5000 },
  };
  assert.equal(reserveTarget(scenario), (15000 + 10000 + 5000) * 3);
});

test("reserveTarget treats missing fields as zero", () => {
  assert.equal(reserveTarget({ basics: {} }), 0);
});

// ----- buildProjection --------------------------------------------------

function makeScenario(overrides = {}) {
  return {
    meta: { baseMonth: "2026-01" },
    basics: {
      startingTwd: 0,
      jpyCash: 0,
      jpyCashTwd: 0,
      includeJpyCash: false,
      monthlySalary: 0,
      salaryStartsMonth: "2026-01",
      monthlySubsidy: 0,
      subsidyStartsMonth: "2026-01",
      monthlyRent: 0,
      monthlyLivingCost: 0,
      monthlyStudentLoan: 0,
      monthsToProject: 1,
      ...overrides.basics,
    },
    oneTimeItems: overrides.oneTimeItems || [],
    installments: overrides.installments || [],
  };
}

test("buildProjection returns [] when monthsToProject is zero", () => {
  const result = buildProjection(makeScenario({ basics: { monthsToProject: 0 } }));
  assert.deepEqual(result, []);
});

test("buildProjection: minimal one-month scenario carries starting balance through", () => {
  const result = buildProjection(makeScenario({ basics: { startingTwd: 5000 } }));
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].startBalance, 5000);
  assert.equal(result.rows[0].balance, 5000);
  assert.equal(result.rows[0].income, 0);
  assert.equal(result.rows[0].expense, 0);
});

test("buildProjection: salary applies from salaryStartsMonth onwards", () => {
  const result = buildProjection(
    makeScenario({
      basics: {
        startingTwd: 0,
        monthlySalary: 30000,
        salaryStartsMonth: "2026-02",
        monthsToProject: 3,
      },
    }),
  );
  assert.equal(result.rows[0].salary, 0);
  assert.equal(result.rows[1].salary, 30000);
  assert.equal(result.rows[2].salary, 30000);
  assert.equal(result.rows[2].balance, 60000);
});

test("buildProjection: jpyCash * rate is added when includeJpyCash is true", () => {
  const result = buildProjection(
    makeScenario({
      basics: {
        startingTwd: 1000,
        jpyCash: 10000,
        includeJpyCash: true,
        monthsToProject: 1,
      },
    }),
    0.2,
  );
  assert.equal(result.rows[0].startBalance, 1000 + 10000 * 0.2);
});

test("buildProjection: legacy jpyCashTwd is used when jpyCash is zero", () => {
  const result = buildProjection(
    makeScenario({
      basics: {
        startingTwd: 1000,
        jpyCashTwd: 5000,
        includeJpyCash: true,
        monthsToProject: 1,
      },
    }),
    0.2,
  );
  assert.equal(result.rows[0].startBalance, 6000);
});

test("buildProjection: one-time income and expense roll into income/expense totals", () => {
  const result = buildProjection(
    makeScenario({
      basics: { startingTwd: 0, monthsToProject: 1 },
      oneTimeItems: [
        { month: "2026-01", type: "income", amount: 3000, category: "other" },
        { month: "2026-01", type: "expense", amount: 1000, category: "tech" },
      ],
    }),
  );
  assert.equal(result.rows[0].oneTimeIncome, 3000);
  assert.equal(result.rows[0].oneTimeExpense, 1000);
  assert.equal(result.rows[0].balance, 2000);
});

test("buildProjection: installments only apply within their term window", () => {
  const result = buildProjection(
    makeScenario({
      basics: { startingTwd: 0, monthsToProject: 4 },
      installments: [{ name: "test", principal: 12000, apr: 0, terms: 3, startMonth: "2026-02" }],
    }),
  );
  assert.equal(result.rows[0].installments, 0); // before start
  assert.equal(result.rows[1].installments, 4000); // 12000 / 3
  assert.equal(result.rows[2].installments, 4000);
  assert.equal(result.rows[3].installments, 4000);
});

test("buildProjection: installmentRows are returned with payment / totalPaid / interest", () => {
  const result = buildProjection(
    makeScenario({
      basics: { startingTwd: 0, monthsToProject: 1 },
      installments: [
        { name: "no-interest", principal: 6000, apr: 0, terms: 6, startMonth: "2026-01" },
      ],
    }),
  );
  assert.equal(result.installmentRows.length, 1);
  assert.equal(result.installmentRows[0].payment, 1000);
  assert.equal(result.installmentRows[0].totalPaid, 6000);
  assert.equal(result.installmentRows[0].interest, 0);
});
