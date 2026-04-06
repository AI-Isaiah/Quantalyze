import { test, expect, type Page } from "@playwright/test";

/**
 * API Key Connection Flow (Task 2.2)
 *
 * Tests the strategy edit page's API key management UI:
 * exchange selector, form validation, key submission, and connected keys list.
 *
 * Tests that require a real authenticated session or valid exchange credentials
 * are marked with test.skip and a comment explaining why.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Navigate to a strategy edit page. Requires authentication. */
async function goToStrategyEdit(page: Page, strategyId: string) {
  await page.goto(`/strategies/${strategyId}/edit`);
}

// ---------------------------------------------------------------------------
// API-level tests (no auth required — verify JSON contract)
// ---------------------------------------------------------------------------

test.describe("API Key Connection Flow", () => {
  test.describe("API endpoint contract", () => {
    test("validate-and-encrypt returns JSON, not HTML redirect", async ({ request }) => {
      const res = await request.post("/api/keys/validate-and-encrypt", {
        data: { exchange: "binance", api_key: "test", api_secret: "test" },
      });

      const contentType = res.headers()["content-type"] ?? "";
      expect(contentType).toContain("application/json");
      expect(res.status()).not.toBe(307);

      const body = await res.json();
      expect(body).toHaveProperty("error");
    });

    test("validate-and-encrypt returns 401 for unauthenticated request", async ({ request }) => {
      const res = await request.post("/api/keys/validate-and-encrypt", {
        data: {
          exchange: "okx",
          api_key: "fake-key",
          api_secret: "fake-secret",
          passphrase: "fake-pass",
        },
      });

      expect(res.status()).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Unauthorized");
    });

    test("validate-and-encrypt rejects request with missing fields", async ({ request }) => {
      const res = await request.post("/api/keys/validate-and-encrypt", {
        data: { exchange: "binance" },
      });

      const contentType = res.headers()["content-type"] ?? "";
      expect(contentType).toContain("application/json");
      // Either 401 (unauthenticated) or 400 (missing fields) — both valid
      expect([400, 401]).toContain(res.status());
    });
  });

  // -------------------------------------------------------------------------
  // UI tests — strategy edit page with API key form
  // These require an authenticated session and a real strategy ID.
  // -------------------------------------------------------------------------

  test.describe("Edit page — API key form rendering", () => {
    test.skip(true, "Requires authenticated session with a valid strategy ID in the database");

    const TEST_STRATEGY_ID = "00000000-0000-0000-0000-000000000000";

    test("edit page renders ApiKeyManager section", async ({ page }) => {
      await goToStrategyEdit(page, TEST_STRATEGY_ID);

      await expect(
        page.getByRole("heading", { name: /Exchange API Keys/i }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: /Add Key/i }),
      ).toBeVisible();
    });

    test("clicking Add Key reveals the API key form with exchange selector", async ({ page }) => {
      await goToStrategyEdit(page, TEST_STRATEGY_ID);

      await page.getByRole("button", { name: /Add Key/i }).click();

      // Form heading
      await expect(
        page.getByText("Connect Exchange API Key"),
      ).toBeVisible();

      // Exchange selector with the three supported exchanges
      const exchangeSelect = page.locator("select");
      await expect(exchangeSelect).toBeVisible();
      for (const exchange of ["Binance", "OKX", "Bybit"]) {
        await expect(exchangeSelect.locator(`option:has-text("${exchange}")`)).toBeAttached();
      }

      // Required input fields
      await expect(page.getByLabel(/Label/i)).toBeVisible();
      await expect(page.getByLabel(/API Key/i)).toBeVisible();
      await expect(page.getByLabel(/API Secret/i)).toBeVisible();

      // Action buttons
      await expect(page.getByRole("button", { name: /Cancel/i })).toBeVisible();
      await expect(page.getByRole("button", { name: /Connect Key/i })).toBeVisible();
    });

    test("selecting OKX exchange shows passphrase field", async ({ page }) => {
      await goToStrategyEdit(page, TEST_STRATEGY_ID);
      await page.getByRole("button", { name: /Add Key/i }).click();

      // Passphrase should not be visible for Binance (default)
      await expect(page.getByLabel(/Passphrase/i)).not.toBeVisible();

      // Switch to OKX
      await page.locator("select").selectOption("okx");

      // Passphrase field should now appear
      await expect(page.getByLabel(/Passphrase/i)).toBeVisible();
    });

    test("form shows validation when submitting without required fields", async ({ page }) => {
      await goToStrategyEdit(page, TEST_STRATEGY_ID);
      await page.getByRole("button", { name: /Add Key/i }).click();

      // Clear the label and try to submit — HTML5 required validation kicks in
      const labelInput = page.getByLabel(/Label/i);
      await labelInput.clear();

      await page.getByRole("button", { name: /Connect Key/i }).click();

      // The form should not submit — required fields block it.
      // Verify we are still on the form (Connect Key button still visible).
      await expect(
        page.getByRole("button", { name: /Connect Key/i }),
      ).toBeVisible();
    });

    test("Cancel button hides the form and shows Add Key again", async ({ page }) => {
      await goToStrategyEdit(page, TEST_STRATEGY_ID);
      await page.getByRole("button", { name: /Add Key/i }).click();

      await expect(page.getByText("Connect Exchange API Key")).toBeVisible();

      await page.getByRole("button", { name: /Cancel/i }).click();

      // Form should be gone, Add Key button should reappear
      await expect(page.getByText("Connect Exchange API Key")).not.toBeVisible();
      await expect(page.getByRole("button", { name: /Add Key/i })).toBeVisible();
    });

    test("empty state shows helpful message when no keys exist", async ({ page }) => {
      await goToStrategyEdit(page, TEST_STRATEGY_ID);

      await expect(
        page.getByText(/No API keys connected/i),
      ).toBeVisible();
      await expect(
        page.getByText(/read-only exchange key/i),
      ).toBeVisible();
    });
  });

  // -------------------------------------------------------------------------
  // Key submission + connected keys list
  // Requires real exchange credentials — skipped in CI.
  // -------------------------------------------------------------------------

  test.describe("Key submission and connected keys list", () => {
    test.skip(
      true,
      "Requires authenticated session, valid strategy, AND real exchange API credentials. " +
        "Run locally with PLAYWRIGHT_TEST_EXCHANGE_KEY / PLAYWRIGHT_TEST_EXCHANGE_SECRET env vars.",
    );

    const TEST_STRATEGY_ID = "00000000-0000-0000-0000-000000000000";

    test("successful key submission shows key in connected keys list", async ({ page }) => {
      await goToStrategyEdit(page, TEST_STRATEGY_ID);
      await page.getByRole("button", { name: /Add Key/i }).click();

      // Fill form with test credentials
      await page.locator("select").selectOption("binance");
      await page.getByLabel(/Label/i).fill("E2E Test Key");
      await page.getByLabel(/API Key/i).fill(process.env.PLAYWRIGHT_TEST_EXCHANGE_KEY ?? "");
      await page.getByLabel(/API Secret/i).fill(process.env.PLAYWRIGHT_TEST_EXCHANGE_SECRET ?? "");

      await page.getByRole("button", { name: /Connect Key/i }).click();

      // Button should show loading state
      await expect(page.getByRole("button", { name: /Validating/i })).toBeVisible();

      // After success, form should close and key should appear in list
      await expect(page.getByText("E2E Test Key")).toBeVisible({ timeout: 15000 });

      // The key card should show the exchange name and action buttons
      await expect(page.getByText(/Binance/i)).toBeVisible();
      await expect(
        page.getByRole("button", { name: /Resync|Use & Sync/i }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: /Delete/i })).toBeVisible();
    });

    test("submitting invalid credentials shows error message", async ({ page }) => {
      await goToStrategyEdit(page, TEST_STRATEGY_ID);
      await page.getByRole("button", { name: /Add Key/i }).click();

      await page.locator("select").selectOption("binance");
      await page.getByLabel(/Label/i).fill("Bad Key");
      await page.getByLabel(/API Key/i).fill("invalid-key-value");
      await page.getByLabel(/API Secret/i).fill("invalid-secret-value");

      await page.getByRole("button", { name: /Connect Key/i }).click();

      // Should show an error message inside the form
      await expect(page.locator(".text-negative")).toBeVisible({ timeout: 10000 });
    });

    test("delete key shows confirmation modal", async ({ page }) => {
      await goToStrategyEdit(page, TEST_STRATEGY_ID);

      // Assumes at least one key exists
      await page.getByRole("button", { name: /Delete/i }).first().click();

      // Confirmation modal should appear
      await expect(page.getByText(/Delete API Key/i)).toBeVisible();
      await expect(page.getByText(/permanently remove/i)).toBeVisible();
      await expect(page.getByRole("button", { name: /Cancel/i })).toBeVisible();
      await expect(
        page.getByRole("button", { name: /Delete/i }).last(),
      ).toBeVisible();
    });
  });
});
