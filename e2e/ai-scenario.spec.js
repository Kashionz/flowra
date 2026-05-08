// e2e/ai-scenario.spec.js
import { expect, test } from "@playwright/test";
import { mockAiAccess } from "./helpers/mockAiAccess.js";

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
  await mockAiAccess(page);

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

  await aiBtn.click();
  await expect(page.getByTestId("ai-scenario-drawer")).toBeVisible();

  await page.getByTestId("ai-input").fill("明年 6 月買車 60 萬車貸 60 期 3%");
  await page.locator("button[type=submit]").click();

  await expect(page.getByText("test 車貸")).toBeVisible();
  await page.getByTestId("ai-apply-proposal").click();

  const compareView = page.getByTestId("scenario-compare-view");
  await expect(compareView).toBeVisible();
  await expect(compareView.getByRole("banner").getByText("A 當前")).toBeVisible();
  await expect(compareView.getByRole("banner").getByText("B AI 提議")).toBeVisible();

  await page.getByTestId("ai-adopt-as-main").click();
  await expect(compareView).toBeHidden();
});
