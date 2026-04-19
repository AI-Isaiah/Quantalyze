import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

/**
 * Phase 2 — Mandate Profile Builder E2E spec.
 *
 * Mirrors e2e/bridge-outcome.spec.ts structure: per-test allocator provisioning
 * via admin.auth.admin.createUser + profile update (no shared seeded allocator
 * — avoids cross-test contention, matches the Phase 1 isolation fix in 73a3a5b).
 *
 * Requires:
 *   HAS_SEEDED_SUPABASE=1           — seed infrastructure available
 *   NEXT_PUBLIC_SUPABASE_URL        — project URL
 *   SUPABASE_SERVICE_ROLE_KEY       — admin key (creates users + profile rows)
 *
 * Skips cleanly when any of these are absent so CI stays green without them.
 */

const TEST_PASSWORD = "MandateE2E!-9f2c";

type AllocatorCtx = {
  userId: string;
  email: string;
};

function makeAdminClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

async function provisionAllocator(admin: SupabaseClient): Promise<AllocatorCtx> {
  const slug = randomUUID().slice(0, 8);
  const email = `e2e-mandate-${Date.now()}-${slug}@test.local`;

  const { data: userData, error: userErr } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (userErr || !userData.user) {
    throw userErr ?? new Error("createUser returned no user");
  }
  const userId = userData.user.id;

  const { error: profileErr } = await admin
    .from("profiles")
    .update({
      display_name: `E2E Mandate ${slug}`,
      role: "allocator",
      allocator_status: "verified",
    })
    .eq("id", userId);
  if (profileErr) throw profileErr;

  // Do NOT pre-seed allocator_preferences — first-visit renders blank form per D-09.
  return { userId, email };
}

async function destroyAllocator(admin: SupabaseClient, ctx: AllocatorCtx) {
  // profiles.id FK -> auth.users(id) ON DELETE CASCADE; deleting the auth
  // user also wipes the row in allocator_preferences (if any was created
  // during the test by the RPC path).
  await admin.auth.admin.deleteUser(ctx.userId);
}

test.describe("Phase 2 — Mandate Profile Builder", () => {
  test.skip(
    !process.env.HAS_SEEDED_SUPABASE ||
      !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !process.env.SUPABASE_SERVICE_ROLE_KEY,
    "requires seeded Supabase + service role key",
  );

  test.setTimeout(60_000);

  let admin: SupabaseClient;
  let ctx: AllocatorCtx;

  test.beforeAll(() => {
    admin = makeAdminClient();
  });

  test.beforeEach(async ({ page }) => {
    ctx = await provisionAllocator(admin);

    await page.goto("/login");
    await page.getByLabel(/email/i).fill(ctx.email);
    await page.getByLabel(/password/i).fill(TEST_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"));
    await page.goto("/preferences");
    // Gate on networkidle so React has hydrated before interactions (otherwise
    // onBlur / onPointerUp handlers may not be attached yet).
    await page.waitForLoadState("networkidle");
  });

  test.afterEach(async () => {
    if (ctx) await destroyAllocator(admin, ctx);
  });

  test("first visit renders 'Not saved yet' and blank Basics fields", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "My Allocation Settings" }),
    ).toBeVisible();
    await expect(page.getByText(/Tell us about your mandate/)).toBeVisible();

    const status = page.getByTestId("mandate-save-status");
    await expect(status).toContainText("Not saved yet");

    await expect(page.getByText("Basics").first()).toBeVisible();

    const advancedTrigger = page.getByRole("button", { name: "Advanced constraints" });
    await expect(advancedTrigger).toHaveAttribute("aria-expanded", "false");
  });

  test("max_weight slider: set, release, sees 'Mandate saved'; reload — value persists", async ({ page }) => {
    const slider = page.getByLabel("Max weight per strategy");

    await slider.focus();
    await slider.evaluate((el) => {
      const input = el as HTMLInputElement;
      input.value = "0.25";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await slider.dispatchEvent("pointerup");

    const status = page.getByTestId("mandate-save-status");
    await expect(status).toContainText("Mandate saved");
    // After the 2s fade, status reverts to the "Last saved" / "just now" line.
    await expect(status).toContainText(/Last saved:|just now/, { timeout: 4000 });

    await page.reload();
    await page.waitForLoadState("networkidle");

    const sliderAfter = page.getByLabel("Max weight per strategy");
    await expect(sliderAfter).toHaveValue("0.25");
    await expect(page.getByTestId("mandate-save-status")).not.toContainText("Not saved yet");
  });

  test("Advanced accordion expands and correlation_ceiling slider is reachable", async ({ page }) => {
    const trigger = page.getByRole("button", { name: "Advanced constraints" });
    await expect(trigger).toHaveAttribute("aria-expanded", "false");

    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");

    await expect(page.getByLabel("Correlation ceiling")).toBeVisible();
    await expect(page.getByLabel("Max drawdown tolerance")).toBeVisible();
    await expect(
      page.getByRole("radiogroup", { name: "Liquidity preference" }),
    ).toBeVisible();
  });

  test("Reset link clears a previously-saved field", async ({ page }) => {
    const slider = page.getByLabel("Max weight per strategy");
    await slider.evaluate((el) => {
      const input = el as HTMLInputElement;
      input.value = "0.30";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await slider.dispatchEvent("pointerup");
    await expect(page.getByTestId("mandate-save-status")).toContainText("Mandate saved");

    // Reset link for the max_weight field is the first Reset button visible.
    const maxWeightResetLink = page.getByRole("button", { name: "Reset" }).first();
    await expect(maxWeightResetLink).toBeVisible();
    await maxWeightResetLink.click();

    // Auto-save fires again; after 2s it reverts to the "Last saved" timestamp.
    await expect(page.getByTestId("mandate-save-status")).toContainText("Mandate saved");

    await page.reload();
    await page.waitForLoadState("networkidle");

    // After reload the field is null again → Reset link is absent.
    await expect(page.getByRole("button", { name: "Reset" })).toHaveCount(0);
  });
});
