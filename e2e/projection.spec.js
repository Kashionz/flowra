import { expect, test } from "@playwright/test";

// Tier-1 自動驗收 #2：輸入幾個值後試算結果對得上。
//
// 純函式 buildProjection 已被 lib/finance.test.js 涵蓋；這支 e2e 確認
// React 表單 → state → buildProjection → 摘要卡片這整條 wiring 沒有
// 在重構中走鐘。
//
// Field 元件的 <label> 沒包住 <input>（無 htmlFor 關聯），所以走
// 「找 label 的祖父 div、再抓底下唯一的 number input」這條路徑。
function numberFieldByLabel(page, labelText) {
  // span(label text) → label → field root div(ancestor::div[1])
  return page
    .getByText(labelText, { exact: true })
    .locator("xpath=ancestor::div[1]")
    .locator("input[type='number']");
}

test("projection updates after entering basic values", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();

  // 預設 monthsToProject = 12，所以 startingTwd 100000 + 月薪 50000 × 12
  // = 100000 + 600000 = 700000，最後剩餘現金 NT$ 700,000。
  await numberFieldByLabel(page, "目前手上台幣").fill("100000");
  await numberFieldByLabel(page, "每月薪水").fill("50000");

  const finalBalance = page
    .locator("p", { hasText: "最後剩餘現金" })
    .locator("..")
    .locator("p")
    .last();

  await expect(finalBalance).toHaveText("NT$ 700,000", { timeout: 5_000 });
});
