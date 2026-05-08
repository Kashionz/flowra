import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;

// We only install Chromium in CI/local to keep the install footprint small.
// `devices["iPhone SE"]` defaults to webkit; force chromium so we don't need
// the WebKit binary (we're testing layout clamping, not engine quirks).
const iphoneSe = {
  ...devices["iPhone SE"],
  defaultBrowserType: "chromium",
  browserName: "chromium",
};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `pnpm preview --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /.*\.mobile\.spec\.js/,
    },
    {
      name: "iphone-se",
      use: iphoneSe,
      testMatch: /.*\.mobile\.spec\.js/,
    },
  ],
});
