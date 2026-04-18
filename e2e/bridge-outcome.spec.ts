import { test, expect } from "@playwright/test";

/**
 * Phase 1 Bridge Outcome recording — E2E spec.
 *
 * D-20: Gated on HAS_SEEDED_SUPABASE — seeded Supabase CI is a follow-up.
 * Without the env var, both tests skip cleanly so CI remains green.
 *
 * When HAS_SEEDED_SUPABASE is set, the tests require:
 *   SEEDED_ALLOCATOR_EMAIL    — email for a seeded allocator account
 *   SEEDED_ALLOCATOR_PASSWORD — password for that account
 *   The allocator must have at least one strategy row with eligible_for_outcome=true
 *   (i.e. match_decisions.decision='sent_as_intro' + no existing bridge_outcomes row
 *   + no active dismissal) so the banner renders.
 *
 */

test.describe("Phase 1 — Bridge Outcome recording", () => {
  test.skip(!process.env.HAS_SEEDED_SUPABASE, "requires seeded Supabase CI — Phase 1 D-20 follow-up");

  test("allocator records an Allocated outcome on an eligible row", async ({
    page,
  }) => {
    // Login as the seeded allocator
    await page.goto("/signin");
    await page.getByLabel(/email/i).fill(process.env.SEEDED_ALLOCATOR_EMAIL!);
    await page
      .getByLabel(/password/i)
      .fill(process.env.SEEDED_ALLOCATOR_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/allocations/);

    // Banner must be visible on at least one eligible row
    const banner = page.getByTestId("bridge-outcome-banner").first();
    await expect(banner).toBeVisible();

    // Click [Allocated] — opens AllocatedForm in-place (no modal, D-08)
    await banner.getByRole("button", { name: /^Allocated$/ }).click();

    // AllocatedForm replaces the banner
    const form = page.getByTestId("allocated-form").first();
    await expect(form).toBeVisible();

    // Fill percent_allocated — allocated_at defaults to today
    await form.locator("input[type='number']").fill("10");

    // Submit
    await form.getByRole("button", { name: /^Record allocation$/ }).click();

    // OutcomeRecordedRow must appear with D-11 copy
    const recorded = page.getByTestId("outcome-recorded-row").first();
    await expect(recorded).toBeVisible();
    await expect(recorded).toContainText(/Recorded: Allocated\s+10%/);
  });

  test("allocator records a Rejected outcome with reason=Mandate conflict", async ({
    page,
  }) => {
    // Login as the seeded allocator
    await page.goto("/signin");
    await page.getByLabel(/email/i).fill(process.env.SEEDED_ALLOCATOR_EMAIL!);
    await page
      .getByLabel(/password/i)
      .fill(process.env.SEEDED_ALLOCATOR_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/allocations/);

    // Banner must be visible on at least one eligible row
    const banner = page.getByTestId("bridge-outcome-banner").first();
    await expect(banner).toBeVisible();

    // Click [Rejected] — opens RejectedForm in-place (no modal, D-08)
    await banner.getByRole("button", { name: /^Rejected$/ }).click();

    // RejectedForm replaces the banner
    const form = page.getByTestId("rejected-form").first();
    await expect(form).toBeVisible();

    // Select "Mandate conflict" reason
    await form.locator("select").selectOption("mandate_conflict");

    // Submit
    await form.getByRole("button", { name: /^Record rejection$/ }).click();

    // OutcomeRecordedRow must appear with D-11 exact copy (em-dash)
    const recorded = page.getByTestId("outcome-recorded-row").first();
    await expect(recorded).toBeVisible();
    await expect(recorded).toContainText("Recorded: Rejected \u2014 Mandate conflict");
  });

  test("dismiss button hides the banner for the session", async ({ page }) => {
    // Login as the seeded allocator
    await page.goto("/signin");
    await page.getByLabel(/email/i).fill(process.env.SEEDED_ALLOCATOR_EMAIL!);
    await page
      .getByLabel(/password/i)
      .fill(process.env.SEEDED_ALLOCATOR_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/allocations/);

    const banner = page.getByTestId("bridge-outcome-banner").first();
    await expect(banner).toBeVisible();

    // Click [×] dismiss button
    await banner.getByRole("button", { name: /dismiss for today/i }).click();

    // Banner must disappear
    await expect(banner).not.toBeVisible();
  });
});
