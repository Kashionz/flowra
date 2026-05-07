import { readDraftScenario, readPendingCloudSync } from "./scenarioPersistence.js";

const SESSION_META_FALLBACK = {
  lastOpenedAt: "",
  lastSyncedAt: "",
  lastSyncAttemptAt: "",
};

/**
 * Reads the three pieces of state we want to seed lazily on first
 * render — local draft, pending cloud-sync record, persisted session
 * metadata — in one synchronous pass.
 *
 * The host component captures the result via `useState(readInitialBoot)`
 * and threads each slice into the relevant hook initialiser, which is
 * what lets us avoid a setState-in-effect mount sequence.
 *
 * `readSessionMeta` is injected (defaulted to `() => SESSION_META_FALLBACK`)
 * so this module doesn't depend on the main component's session-meta
 * helpers — keeps the logic testable without touching localStorage.
 */
export function readInitialBoot({
  storage = typeof window !== "undefined" ? window.localStorage : null,
  readSessionMeta = () => SESSION_META_FALLBACK,
} = {}) {
  if (!storage) {
    return {
      localDraft: null,
      pendingCloudSync: null,
      sessionMeta: SESSION_META_FALLBACK,
    };
  }
  return {
    localDraft: readDraftScenario(storage),
    pendingCloudSync: readPendingCloudSync(storage),
    sessionMeta: readSessionMeta(),
  };
}

/**
 * True when the scenario is in its zero-everything starting state
 * (no balances, no salary, no items, no installments). Used by the
 * main component to decide whether to render the empty-state guidance
 * card with template-load shortcuts.
 *
 * Pure: only reads scenario.basics + array lengths, returns boolean.
 */
export function isScenarioEmpty(scenario) {
  if (!scenario || typeof scenario !== "object") return true;
  const b = scenario.basics || {};
  const numericKeys = [
    "startingTwd",
    "jpyCash",
    "jpyCashTwd",
    "monthlySalary",
    "monthlySubsidy",
    "monthlyRent",
    "monthlyLivingCost",
    "monthlyStudentLoan",
  ];
  for (const key of numericKeys) {
    if (Number(b[key]) > 0) return false;
  }
  if ((scenario.oneTimeItems || []).length > 0) return false;
  if ((scenario.installments || []).length > 0) return false;
  return true;
}
