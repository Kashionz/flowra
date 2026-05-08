import { spawn } from "node:child_process";

import { getPlaywrightRunnerPlan } from "../lib/playwrightRunner.js";

const plan = getPlaywrightRunnerPlan({
  env: process.env,
  args: process.argv.slice(2),
});

if (plan.mode === "blocked") {
  console.error(plan.message);
  process.exit(1);
}

const child = spawn(plan.command, plan.args, {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
