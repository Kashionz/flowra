import { expect, test } from "@playwright/test";

// Tier-1 自動驗收 #1：清空 localStorage 進站，預設情境是空白模板。
test("blank scenario on first visit (cleared localStorage)", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();

  await expect(page.getByRole("heading", { name: "Flowra", level: 1 })).toBeVisible();

  const finalBalance = page
    .locator("p", { hasText: "最後剩餘現金" })
    .locator("..")
    .locator("p")
    .last();
  await expect(finalBalance).toHaveText("NT$ 0");

  const minBalance = page
    .locator("p", { hasText: "最低剩餘現金" })
    .locator("..")
    .locator("p")
    .last();
  await expect(minBalance).toHaveText("NT$ 0");
});
