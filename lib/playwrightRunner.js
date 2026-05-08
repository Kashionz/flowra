function isSeatbeltSandbox(env = {}) {
  return env.CODEX_SANDBOX === "seatbelt";
}

function isSandboxBypassEnabled(env = {}) {
  return env.PLAYWRIGHT_ALLOW_SANDBOXED_BROWSER === "1";
}

export function getPlaywrightRunnerPlan({ env = process.env, args = [] } = {}) {
  if (isSeatbeltSandbox(env) && !isSandboxBypassEnabled(env)) {
    return {
      mode: "blocked",
      message: [
        "偵測到 `CODEX_SANDBOX=seatbelt`，這個環境無法直接啟動 Chromium/Chrome，",
        "Playwright 在這裡會被沙盒攔下，",
        "並在啟動階段觸發 macOS `bootstrap_check_in ... Permission denied`。",
        "",
        "請改用下列其中一種方式：",
        "1. 在 Codex 中允許這個命令以非沙盒模式執行。",
        "2. 在你的本機終端機直接執行 `pnpm test:e2e`。",
        "3. 若你就是要強制在目前沙盒內嘗試，請加上 `PLAYWRIGHT_ALLOW_SANDBOXED_BROWSER=1`。",
      ].join("\n"),
    };
  }

  return {
    mode: "run",
    command: "playwright",
    args,
  };
}
