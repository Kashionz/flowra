import { expect, test } from "@playwright/test";

// Tier-1 自動驗收 #3：iPhone SE viewport（375 × 667），打開 JPY tooltip
// 與匯出 dropdown，確認它們都被 clampViewport 邏輯壓在視窗內、不會
// 跑到 x < 0 或 x + width > 螢幕寬。
//
// 純函式 clampTooltipLeft / clampDropdownRight 已被 lib/clampViewport.test.js
// 覆蓋；這支只確認 React + Portal 真的有把回傳值套上去。
test.describe("mobile-clamp", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => window.localStorage.clear());
    await page.reload();
  });

  test("JPY exchange-rate tooltip stays inside the viewport", async ({ page }) => {
    const trigger = page.getByLabel("顯示目前匯率資訊").first();
    await expect(trigger).toBeVisible();
    await trigger.click();

    const tooltip = page.locator("text=目前匯率").first();
    await expect(tooltip).toBeVisible();

    const box = await tooltip.boundingBox();
    expect(box).not.toBeNull();
    const viewport = page.viewportSize();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  });

  test("export dropdown stays inside the viewport", async ({ page }) => {
    const exportButton = page.getByRole("button", { name: "匯出" }).first();
    await expect(exportButton).toBeVisible();
    await exportButton.click();

    // Dropdown 用 portal 渲染，第一個項目固定是「下載整頁圖片」。
    const menuItem = page.getByRole("button", { name: "下載整頁圖片" });
    await expect(menuItem).toBeVisible();

    const box = await menuItem.boundingBox();
    expect(box).not.toBeNull();
    const viewport = page.viewportSize();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  });
});
