// lib/scenarioCompare.js
// Pure helpers for comparing two projection row arrays from buildProjection().

function lastBalance(rows) {
  return rows.length === 0 ? 0 : Number(rows[rows.length - 1].balance) || 0;
}

function minBalance(rows) {
  if (rows.length === 0) return 0;
  return rows.reduce((acc, r) => Math.min(acc, Number(r.balance) || 0), Infinity);
}

function firstNegativeMonth(rows) {
  const hit = rows.find((r) => (Number(r.balance) || 0) < 0);
  return hit ? hit.monthKey : null;
}

export function computeDiffSummary(rowsA, rowsB) {
  return {
    endingBalanceA: lastBalance(rowsA),
    endingBalanceB: lastBalance(rowsB),
    endingBalanceDelta: lastBalance(rowsB) - lastBalance(rowsA),
    maxDebtA: rowsA.length ? minBalance(rowsA) : 0,
    maxDebtB: rowsB.length ? minBalance(rowsB) : 0,
    firstNegativeA: firstNegativeMonth(rowsA),
    firstNegativeB: firstNegativeMonth(rowsB),
  };
}
