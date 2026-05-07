import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const appPath = resolve("personal_finance_cashflow_simulator.jsx");
const source = readFileSync(appPath, "utf8");

const forbiddenTexts = [
  "名稱：",
  "唯讀分享",
  "複製成自己的版本",
  "讀取雲端版本",
  "載入選中版本",
  "已讀取 ${items.length} 筆雲端版本。",
];

const forbiddenCodeSnippets = [
  "createShortShareLink(",
  "resolveShortShareLink(",
  "listCloudScenarios(",
  "loadCloudScenario =",
  "restoreEditable =",
];

const failures = [
  ...forbiddenTexts
    .filter((text) => source.includes(text))
    .map((text) => `仍有情境/版本 UI 文案: ${text}`),
  ...forbiddenCodeSnippets
    .filter((text) => source.includes(text))
    .map((text) => `仍有情境/版本流程程式碼: ${text}`),
];

if (failures.length) {
  console.error("check-no-scenario-mode failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("check-no-scenario-mode passed");
