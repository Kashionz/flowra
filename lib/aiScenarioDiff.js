// lib/aiScenarioDiff.js
// Pure functions: validate then apply AI-proposed changes to a scenario.
// Throws on unknown ops or forbidden fields. Never mutates the input.

import { ALLOWED_BASIC_FIELDS, ALLOWED_OPS, FORBIDDEN_BASIC_FIELDS } from "./aiPrompts.js";

let counter = 0;
function nextId(prefix) {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

function clone(scenario) {
  return typeof structuredClone === "function"
    ? structuredClone(scenario)
    : JSON.parse(JSON.stringify(scenario));
}

function compareYearMonth(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function validateDiff(scenario, diff) {
  const errors = [];
  const baseMonth = scenario?.meta?.baseMonth || "1970-01";

  for (const change of diff?.changes || []) {
    if (!ALLOWED_OPS.includes(change.op)) {
      errors.push(`unknown op: ${change.op}`);
      continue;
    }
    if (change.op === "set_basic") {
      if (FORBIDDEN_BASIC_FIELDS.includes(change.field)) {
        errors.push(`forbidden field: ${change.field}`);
      } else if (!ALLOWED_BASIC_FIELDS.includes(change.field)) {
        errors.push(`unsupported basic field: ${change.field}`);
      }
    }
    if (change.op === "add_installment" || change.op === "update_installment") {
      const v = change.value || {};
      if (v.principal !== undefined && Number(v.principal) < 0)
        errors.push("principal must be ≥ 0");
      if (v.terms !== undefined && Number(v.terms) < 1) errors.push("terms must be ≥ 1");
      if (v.startMonth && compareYearMonth(v.startMonth, baseMonth) < 0) {
        errors.push(`installment startMonth ${v.startMonth} is before baseMonth ${baseMonth}`);
      }
    }
    if (change.op === "add_one_time" || change.op === "update_one_time") {
      const v = change.value || {};
      if (v.amount !== undefined && Number(v.amount) < 0) errors.push("amount must be ≥ 0");
      if (v.month && compareYearMonth(v.month, baseMonth) < 0) {
        errors.push(`one-time month ${v.month} is before baseMonth ${baseMonth}`);
      }
    }
  }
  return errors;
}

export function applyDiff(scenario, diff) {
  const errors = validateDiff(scenario, diff);
  if (errors.length > 0) throw new Error(errors.join("; "));

  const next = clone(scenario);
  for (const change of diff?.changes || []) {
    switch (change.op) {
      case "add_one_time":
        next.oneTimeItems.push({
          id: nextId("ai-one-time"),
          category: "other",
          ...change.value,
        });
        break;
      case "update_one_time": {
        const idx = next.oneTimeItems.findIndex(
          (i) => (change.id && i.id === change.id) || (change.name && i.name === change.name),
        );
        if (idx >= 0) next.oneTimeItems[idx] = { ...next.oneTimeItems[idx], ...change.value };
        break;
      }
      case "remove_one_time":
        next.oneTimeItems = next.oneTimeItems.filter(
          (i) => !((change.id && i.id === change.id) || (change.name && i.name === change.name)),
        );
        break;
      case "add_installment":
        next.installments.push({ id: nextId("ai-installment"), ...change.value });
        break;
      case "update_installment": {
        const idx = next.installments.findIndex(
          (i) => (change.id && i.id === change.id) || (change.name && i.name === change.name),
        );
        if (idx >= 0) next.installments[idx] = { ...next.installments[idx], ...change.value };
        break;
      }
      case "remove_installment":
        next.installments = next.installments.filter(
          (i) => !((change.id && i.id === change.id) || (change.name && i.name === change.name)),
        );
        break;
      case "set_basic":
        next.basics[change.field] = change.value;
        break;
      default:
        throw new Error(`unknown op: ${change.op}`);
    }
  }
  return next;
}
