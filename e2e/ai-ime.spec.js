import { expect, test } from "@playwright/test";
import { mockAiAccess } from "./helpers/mockAiAccess.js";

const FAKE_DIFF = {
  kind: "diff",
  diff: {
    summary: "IME 測試提議",
    changes: [],
    warnings: [],
    explanation: "IME regression test",
  },
  used: 1,
  quota: 20,
};

test("AI 輸入框在 IME 組字按 Enter 選字時不會提早送出", async ({ page }) => {
  await mockAiAccess(page);

  let requestCount = 0;
  await page.route("**/functions/v1/ai-scenario", async (route) => {
    requestCount += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(FAKE_DIFF),
    });
  });

  await page.goto("/");

  await page.getByTestId("ai-trigger").click();

  const input = page.getByTestId("ai-input");
  await input.fill("明年買車");

  await input.evaluate((element) => {
    element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));

    const composingEnter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(composingEnter, "isComposing", { value: true });
    Object.defineProperty(composingEnter, "keyCode", { value: 229 });
    element.dispatchEvent(composingEnter);
  });

  await expect(input).toHaveValue("明年買車");
  await expect.poll(() => requestCount).toBe(0);

  await input.evaluate((element) => {
    element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
  });
  await input.press("Enter");

  await expect.poll(() => requestCount).toBe(1);
  await expect(page.getByText("IME 測試提議")).toBeVisible();
});
