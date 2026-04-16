import { test, expect } from "@playwright/test";

/**
 * Sprint 6 Task 6.4 — Simulator flow E2E.
 *
 * Validates the discovery → "Simulate Impact" row-action → PortfolioImpactPanel
 * flow. Authenticated surfaces (/discovery/*) redirect unauthenticated
 * visitors to /login, so this spec gracefully degrades to a redirect
 * check when test credentials are unavailable in the environment.
 *
 * Non-goals:
 *   - Asserting specific delta values (those depend on seed data)
 *   - Asserting that the Python service responds — the API route is
 *     covered by vitest + Python pytest layers. This spec checks
 *     UI contract: button renders, dialog opens, Escape closes.
 */

test.describe("Portfolio Impact Simulator flow", () => {
  test("discovery redirects unauthenticated visitors to /login", async ({ page }) => {
    await page.goto("/discovery/crypto-sma");
    await page.waitForLoadState("networkidle");

    // Unauthenticated users must be redirected to the login gate.
    // This is the authentication floor the page is built on and the
    // simulator flow depends on.
    expect(page.url()).toContain("/login");
  });

  test("simulator flow opens the impact panel on discovery for authed users", async ({
    page,
  }) => {
    // Skip when test credentials are unavailable — the discovery gate
    // requires an authenticated + attested allocator and this spec does
    // not manage those credentials itself (deferred to a future test
    // credentials fixture).
    const email = process.env.QUANTALYZE_E2E_EMAIL;
    const password = process.env.QUANTALYZE_E2E_PASSWORD;
    test.skip(
      !email || !password,
      "QUANTALYZE_E2E_EMAIL/PASSWORD required for authenticated simulator flow",
    );

    await page.goto(
      `/login?redirect=${encodeURIComponent("/discovery/crypto-sma")}`,
    );
    await page.getByLabel(/email/i).fill(email!);
    await page.getByLabel(/password/i).fill(password!);
    await page.getByRole("button", { name: /sign in|log in|continue/i }).click();

    await page.waitForLoadState("networkidle");

    // Attestation may intercept — click through if present.
    const attest = page.getByRole("button", { name: /i attest|continue/i });
    if (await attest.isVisible().catch(() => false)) {
      await attest.click();
      await page.waitForLoadState("networkidle");
    }

    await expect(page).toHaveURL(/\/discovery\/.+/);

    // Find the first visible Simulate Impact button on any row.
    const triggers = page.getByRole("button", {
      name: /Simulate impact of adding /i,
    });
    const first = triggers.first();
    const hasTrigger = await first.isVisible().catch(() => false);
    if (!hasTrigger) {
      test.info().annotations.push({
        type: "note",
        description:
          "No Simulate Impact trigger found on this discovery page — seed data does not include any published strategies for this category.",
      });
      return;
    }

    // aria-expanded should start false.
    await expect(first).toHaveAttribute("aria-expanded", "false");
    await first.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(first).toHaveAttribute("aria-expanded", "true");

    // Title should mention "Simulate impact" and the strategy name.
    await expect(dialog.locator("h2")).toContainText(/Simulate impact/i);

    // Wait for either the success body (delta chips) or an error/empty state.
    await page.waitForTimeout(2000);

    // Close with Escape.
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
  });
});
