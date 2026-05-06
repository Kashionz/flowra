import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const supabaseClientPath = resolve("lib/flowraSupabase.js");
const migrationPath = resolve("supabase/migrations/20260506123000_flowra_single_backup.sql");

const source = readFileSync(supabaseClientPath, "utf8");
const failures = [];

if (!existsSync(migrationPath)) {
  failures.push("缺少單一備份 migration：20260506123000_flowra_single_backup.sql");
}

if (!source.includes('const BACKUP_TABLE = "flowra_backups"')) {
  failures.push("Supabase client 尚未切到 flowra_backups");
}

const forbiddenSnippets = [
  'const SCENARIO_TABLE = "flowra_scenarios"',
  'const SHARE_TABLE = "flowra_share_links"',
  "export async function listCloudScenarios()",
  "export async function createShortShareLink(",
  "export async function resolveShortShareLink(",
  "export { SCENARIO_TABLE, SHARE_TABLE }",
];

for (const snippet of forbiddenSnippets) {
  if (source.includes(snippet)) {
    failures.push(`仍保留舊模型程式碼：${snippet}`);
  }
}

if (failures.length) {
  console.error("check-cloud-backup-backend failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("check-cloud-backup-backend passed");
