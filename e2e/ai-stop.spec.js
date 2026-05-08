import { expect, test } from "@playwright/test";
import { mockAiAccess } from "./helpers/mockAiAccess.js";

const FAKE_DIFF = {
  kind: "diff",
  diff: {
    summary: "stop test 車貸",
    changes: [
      {
        op: "add_installment",
        value: { name: "車貸", principal: 600000, apr: 3, terms: 60, startMonth: "2027-06" },
      },
    ],
    warnings: [],
    explanation: "delayed response",
  },
  used: 1,
  quota: 20,
};

test("AI scenario request can be stopped before the delayed response arrives", async ({ page }) => {
  await mockAiAccess(page);

  await page.route("**/functions/v1/ai-scenario", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(FAKE_DIFF),
    });
  });

  await page.goto("/");

  await page.getByTestId("ai-trigger").click();
  await page.getByTestId("ai-input").fill("這是一則送錯的訊息");
  await page.locator("button[type=submit]").click();

  await expect(page.getByTestId("ai-stop")).toBeVisible();
  await expect(page.getByText("我先整理你目前的情境與提問。")).toBeVisible();
  await page.getByTestId("ai-stop").click();

  await expect(page.getByTestId("ai-stop")).toBeHidden();
  await expect(page.getByText("AI 正在分析…")).toBeHidden();

  await page.waitForTimeout(1500);
  await expect(page.getByTestId("ai-proposal-card")).toHaveCount(0);
  await expect(page.getByText("stop test 車貸")).toHaveCount(0);
});
