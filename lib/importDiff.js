import { n } from "./finance.js";

/**
 * Field configuration for the JSON import preview modal. Order is
 * deliberate (mirrors the on-screen layout).
 */
export const IMPORT_DIFF_FIELDS = [
  { label: "手上台幣", key: "startingTwd", suffix: "元" },
  { label: "日幣現金", key: "jpyCash", suffix: "円" },
  { label: "每月薪資", key: "monthlySalary", suffix: "元" },
  { label: "每月補貼", key: "monthlySubsidy", suffix: "元" },
  { label: "每月房租", key: "monthlyRent", suffix: "元" },
  { label: "每月生活費", key: "monthlyLivingCost", suffix: "元" },
  { label: "每月學貸", key: "monthlyStudentLoan", suffix: "元" },
  { label: "試算月數", key: "monthsToProject", suffix: "月" },
];

/**
 * Compute a side-by-side diff between the current scenario and the
 * incoming-from-import scenario for the preview modal.
 *
 * Pure: no React, no DOM. Returns:
 *   {
 *     basics: [{ label, key, suffix, current, incoming, changed }, …],
 *     oneTime:     { current, incoming },
 *     installments:{ current, incoming },
 *   }
 */
export function computeImportDiff(currentScenario, incoming) {
  const basics = IMPORT_DIFF_FIELDS.map(({ label, key, suffix }) => {
    const current = n(currentScenario?.basics?.[key]);
    const next = n(incoming?.basics?.[key]);
    return {
      label,
      key,
      suffix,
      current,
      incoming: next,
      changed: current !== next,
    };
  });
  return {
    basics,
    oneTime: {
      current: currentScenario?.oneTimeItems?.length || 0,
      incoming: incoming?.oneTimeItems?.length || 0,
    },
    installments: {
      current: currentScenario?.installments?.length || 0,
      incoming: incoming?.installments?.length || 0,
    },
  };
}
