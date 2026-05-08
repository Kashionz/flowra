// e2e/ai-scenario.spec.js
import { expect, test } from "@playwright/test";

const FAKE_DIFF = {
  kind: "diff",
  diff: {
    summary: "test 車貸",
    changes: [
      {
        op: "add_installment",
        value: { name: "車貸", principal: 600000, apr: 3, terms: 60, startMonth: "2027-06" },
      },
    ],
    warnings: ["test warning"],
    explanation: "test explanation",
  },
  used: 1,
  quota: 20,
};

test("AI scenario flow: open drawer, mock response, apply, compare, adopt", async ({ page }) => {
  // Mock supabase auth: pretend user is signed in
  await page.addInitScript(() => {
    window.__FLOWRA_AI_TEST = true;
    window.localStorage.setItem(
      "flowra-supabase-auth",
      JSON.stringify({ access_token: "fake-jwt", user: { id: "fake-uuid" } }),
    );
  });

  // Intercept edge function call
  await page.route("**/functions/v1/ai-scenario", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(FAKE_DIFF),
    }),
  );

  await page.goto("/");

  const aiBtn = page.getByTestId("ai-trigger");
  // 若無 supabase 設定或無登入態，按鈕 disabled，跳過後續斷言
  if (await aiBtn.isDisabled())
    test.skip(true, "supabase not configured or not authenticated in this environment");

  await aiBtn.click();
  await expect(page.getByTestId("ai-scenario-drawer")).toBeVisible();

  await page.getByTestId("ai-input").fill("明年 6 月買車 60 萬車貸 60 期 3%");
  await page.locator("button[type=submit]").click();

  await expect(page.getByText("test 車貸")).toBeVisible();
  await page.getByTestId("ai-apply-proposal").click();

  await expect(page.getByTestId("scenario-compare-view")).toBeVisible();
  await expect(page.locator("text=A 當前 vs B AI 提議")).toBeVisible();

  await page.getByTestId("ai-adopt-as-main").click();
  await expect(page.getByTestId("scenario-compare-view")).toBeHidden();
});
