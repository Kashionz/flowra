import test from "node:test";
import assert from "node:assert/strict";

import { getPlaywrightRunnerPlan } from "./playwrightRunner.js";

test("在 Codex seatbelt 沙盒內預設阻擋 Playwright 瀏覽器啟動並提供明確說明", () => {
  const plan = getPlaywrightRunnerPlan({
    env: { CODEX_SANDBOX: "seatbelt" },
    args: ["test", "e2e/ai-ime.spec.js"],
  });

  assert.equal(plan.mode, "blocked");
  assert.match(plan.message, /CODEX_SANDBOX=seatbelt/);
  assert.match(plan.message, /無法直接啟動 Chromium/);
  assert.match(plan.message, /PLAYWRIGHT_ALLOW_SANDBOXED_BROWSER=1/);
});

test("顯式允許時仍可在沙盒環境內嘗試執行 Playwright", () => {
  const plan = getPlaywrightRunnerPlan({
    env: {
      CODEX_SANDBOX: "seatbelt",
      PLAYWRIGHT_ALLOW_SANDBOXED_BROWSER: "1",
    },
    args: ["test", "--project=desktop-chromium"],
  });

  assert.deepEqual(plan, {
    mode: "run",
    command: "playwright",
    args: ["test", "--project=desktop-chromium"],
  });
});

test("一般環境不阻擋 Playwright", () => {
  const plan = getPlaywrightRunnerPlan({
    env: {},
    args: ["test", "--ui"],
  });

  assert.deepEqual(plan, {
    mode: "run",
    command: "playwright",
    args: ["test", "--ui"],
  });
});
