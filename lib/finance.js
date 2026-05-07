// Pure helpers for cashflow projection. Anything that depends on React,
// browser globals, or module-level mutable state belongs elsewhere.

import { CATEGORY_OPTIONS } from "./expenseCategories.js";

export function n(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function currency(value) {
  return Math.round(n(value)).toLocaleString("zh-TW");
}

export function maskCurrency(value, hidden) {
  return hidden ? "★★★" : `NT$ ${currency(value)}`;
}

export function clampMonthIndex(value) {
  return Math.max(0, Math.round(n(value)));
}

export function pad2(value) {
  return String(value).padStart(2, "0");
}

export function currentBaseMonth(now = new Date()) {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
}

export function exportFileBase(baseMonth) {
  return `flowra-report-${baseMonth}`;
}

export function parseYearMonth(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(value || ""));
  if (!match) {
    return { year: 2026, month: 5 };
  }
  const year = Number(match[1]);
  const month = Math.min(12, Math.max(1, Number(match[2])));
  return { year, month };
}

export function formatYearMonth(year, month) {
  return `${year}-${pad2(month)}`;
}

export function addMonths(baseMonth, offset) {
  const { year, month } = parseYearMonth(baseMonth);
  const date = new Date(year, month - 1 + Math.round(n(offset)), 1);
  return formatYearMonth(date.getFullYear(), date.getMonth() + 1);
}

export function diffMonths(baseMonth, targetMonth) {
  const a = parseYearMonth(baseMonth);
  const b = parseYearMonth(targetMonth);
  return (b.year - a.year) * 12 + (b.month - a.month);
}

export function formatMonthLabel(monthKey, short = false) {
  const { year, month } = parseYearMonth(monthKey);
  return short ? `${month}月` : `${year}年${month}月`;
}

export function monthlyPayment(principal, aprPercent, terms) {
  const p = Math.max(0, n(principal));
  const months = Math.max(1, Math.round(n(terms)));
  const monthlyRate = n(aprPercent) / 100 / 12;
  if (monthlyRate === 0) return p / months;
  return (p * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -months));
}

export function resolveJpyCashTwd(basics, jpyRate) {
  const cash = n(basics.jpyCash);
  if (cash > 0) {
    const rate = n(jpyRate);
    if (rate > 0) return Math.round(cash * rate);
  }
  return n(basics.jpyCashTwd);
}

export function reserveTarget(scenario) {
  const basics = scenario.basics;
  return (n(basics.monthlyRent) + n(basics.monthlyLivingCost) + n(basics.monthlyStudentLoan)) * 3;
}

export function buildProjection(scenario, jpyRate = 0) {
  const { basics, oneTimeItems, installments, meta } = scenario;
  const totalMonths = Math.max(0, Math.round(n(basics.monthsToProject)));
  if (totalMonths === 0) {
    return [];
  }

  const jpyTwd = resolveJpyCashTwd(basics, jpyRate);
  let balance = n(basics.startingTwd) + (basics.includeJpyCash ? jpyTwd : 0);
  const rows = [];

  const installmentRows = installments.map((item) => {
    const terms = Math.max(1, Math.round(n(item.terms)));
    const payment = monthlyPayment(item.principal, item.apr, terms);
    return {
      ...item,
      terms,
      payment,
      totalPaid: payment * terms,
      interest: payment * terms - n(item.principal),
    };
  });

  for (let monthIndex = 0; monthIndex < totalMonths; monthIndex += 1) {
    const monthKey = addMonths(meta.baseMonth, monthIndex);
    const salary =
      diffMonths(basics.salaryStartsMonth, monthKey) >= 0 ? n(basics.monthlySalary) : 0;
    const subsidy =
      diffMonths(basics.subsidyStartsMonth, monthKey) >= 0 ? n(basics.monthlySubsidy) : 0;
    const rent = n(basics.monthlyRent);
    const living = n(basics.monthlyLivingCost);
    const studentLoan = n(basics.monthlyStudentLoan);
    const oneTimeForMonth = oneTimeItems.filter((item) => item.month === monthKey);
    const oneTimeIncome = oneTimeForMonth
      .filter((item) => item.type === "income")
      .reduce((sum, item) => sum + n(item.amount), 0);
    const oneTimeExpense = oneTimeForMonth
      .filter((item) => item.type === "expense")
      .reduce((sum, item) => sum + n(item.amount), 0);
    const installmentExpense = installmentRows.reduce((sum, item) => {
      const start = diffMonths(meta.baseMonth, item.startMonth);
      const endExclusive = start + item.terms;
      return monthIndex >= start && monthIndex < endExclusive ? sum + item.payment : sum;
    }, 0);
    const totalIncome = salary + subsidy + oneTimeIncome;
    const totalExpense = rent + living + studentLoan + oneTimeExpense + installmentExpense;
    const startBalance = balance;
    const net = totalIncome - totalExpense;
    balance += net;

    const expenseByCategory = oneTimeForMonth
      .filter((item) => item.type === "expense")
      .reduce((acc, item) => {
        const category = CATEGORY_OPTIONS.includes(item.category) ? item.category : "other";
        acc[category] = (acc[category] || 0) + n(item.amount);
        return acc;
      }, {});

    rows.push({
      monthIndex,
      monthKey,
      name: formatMonthLabel(monthKey, true),
      fullLabel: formatMonthLabel(monthKey),
      startBalance,
      salary,
      subsidy,
      oneTimeIncome,
      income: totalIncome,
      rent,
      living,
      studentLoan,
      oneTimeExpense,
      installments: installmentExpense,
      expense: totalExpense,
      net,
      balance,
      oneTimeItems: oneTimeForMonth,
      expenseByCategory,
      expenseByGroup: {
        fixed: rent + studentLoan,
        variable: living + installmentExpense,
        oneTime: oneTimeExpense,
      },
    });
  }

  return { rows, installmentRows };
}
