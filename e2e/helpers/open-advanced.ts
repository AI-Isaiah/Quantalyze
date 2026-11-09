import { expect, type Page } from "@playwright/test";

/**
 * Phase 196 (D-04) — the factsheet opens as a summary strip, one equity figure and one
 * Main metrics table; every other section lives behind the collapsed `details#factsheet-advanced`
 * disclosure, and its contents mount only on the first open. A spec whose locators reach
 * Performance, Distribution, Heatmaps, Stress, Signatures, Streaks or the Detailed metrics rail
 * opens it first. Fails loud when the disclosure is absent (a 404 or login page must not pass).
 *
 * Clicks the summary only when the disclosure is closed, so a viewer whose stored state is
 * already open does not get it toggled shut.
 */
export async function openAdvanced(page: Page): Promise<void> {
  const advanced = page.locator("details#factsheet-advanced");
  await expect(advanced, "details#factsheet-advanced did not render").toBeVisible({ timeout: 15_000 });
  if (!(await advanced.evaluate((el) => (el as HTMLDetailsElement).open))) {
    await page.locator("#factsheet-advanced > summary").click();
  }
  await expect(page.locator("#factsheet-advanced [data-advanced-contents]")).toBeVisible({ timeout: 15_000 });
}
