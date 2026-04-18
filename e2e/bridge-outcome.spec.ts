import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

/**
 * Phase 1 Bridge Outcome recording — E2E spec.
 *
 * Each test provisions its OWN allocator with exactly ONE sent_as_intro
 * match_decision via the Supabase admin API, logs in as that user, runs
 * the flow, and tears the user down in afterEach. This eliminates
 * cross-test pollution and parallel contention over a single shared
 * seeded allocator with multiple banners (the prior flakiness source).
 *
 * Requires:
 *   HAS_SEEDED_SUPABASE=1           — seeded demo strategies must exist
 *   NEXT_PUBLIC_SUPABASE_URL        — project URL
 *   SUPABASE_SERVICE_ROLE_KEY       — admin key (creates users, writes RLS-protected rows)
 *
 * Tests skip cleanly when any of these are absent so CI remains green.
 */

// Polaris Cross-Exchange Arb — one of the seeded is_example strategies in
// the staging DB. Reusing an existing strategy row is the cheapest way to
// satisfy the portfolio_strategies + match_decisions FKs without also
// seeding a manager profile + strategy_analytics row per test.
const STRATEGY_ID = "51a111ed-0000-4000-8000-000000000001";

const TEST_PASSWORD = "BridgeOutcomeE2E!-9f2c";

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

async function provisionAllocator(
  admin: SupabaseClient,
): Promise<AllocatorCtx> {
  const slug = randomUUID().slice(0, 8);
  const email = `e2e-bridge-${Date.now()}-${slug}@test.local`;

  const { data: userData, error: userErr } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (userErr || !userData.user) throw userErr ?? new Error("createUser returned no user");
  const userId = userData.user.id;

  // A handle_new_user trigger on auth.users insert (migration 002) already
  // populated the profile with default display_name/role. Overwrite to the
  // allocator role + verified status the dashboard queries expect.
  const { error: profileErr } = await admin
    .from("profiles")
    .update({
      display_name: `E2E Bridge ${slug}`,
      role: "allocator",
      allocator_status: "verified",
    })
    .eq("id", userId);
  if (profileErr) throw profileErr;

  const { error: prefErr } = await admin.from("allocator_preferences").insert({
    user_id: userId,
    mandate_archetype: "Market Neutral",
    target_ticket_size_usd: 5_000_000,
    excluded_exchanges: [],
    min_sharpe: 1.0,
    min_track_record_days: 180,
  });
  if (prefErr) throw prefErr;

  const { data: portfolioData, error: portErr } = await admin
    .from("portfolios")
    .insert({
      user_id: userId,
      name: `E2E Bridge Portfolio ${slug}`,
      description: "E2E per-test allocator portfolio.",
    })
    .select("id")
    .single();
  if (portErr || !portfolioData) throw portErr ?? new Error("portfolios insert returned no row");

  const { error: psErr } = await admin.from("portfolio_strategies").insert({
    portfolio_id: portfolioData.id as string,
    strategy_id: STRATEGY_ID,
    current_weight: 1.0,
    allocated_amount: 5_000_000,
  });
  if (psErr) throw psErr;

  const { error: mdErr } = await admin.from("match_decisions").insert({
    allocator_id: userId,
    strategy_id: STRATEGY_ID,
    decision: "sent_as_intro",
    founder_note: `E2E bridge outcome ${slug}`,
    decided_by: userId,
  });
  if (mdErr) throw mdErr;

  return { userId, email };
}

async function destroyAllocator(admin: SupabaseClient, ctx: AllocatorCtx) {
  // profiles.id -> auth.users(id) ON DELETE CASCADE, and every downstream
  // row (portfolios, portfolio_strategies, match_decisions, bridge_outcomes,
  // bridge_outcome_dismissals) cascades from profiles. Wiping the auth user
  // tears everything down in one shot.
  await admin.auth.admin.deleteUser(ctx.userId);
}

test.describe("Phase 1 — Bridge Outcome recording", () => {
  test.skip(
    !process.env.HAS_SEEDED_SUPABASE ||
      !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !process.env.SUPABASE_SERVICE_ROLE_KEY,
    "requires seeded Supabase + service role key",
  );

  // Provisioning a user + navigating the dashboard easily chews ~15s against
  // a cold dev server. Widen the per-test budget so a slow compile-on-demand
  // doesn't mask the flow under test.
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
    await page.goto("/allocations");
    // Gate on networkidle so React has hydrated before tests start clicking.
    // Without this, the banner/form button clicks can land on the server-
    // rendered DOM before handlers attach, and the action silently no-ops.
    await page.waitForLoadState("networkidle");
  });

  test.afterEach(async () => {
    if (ctx) {
      await destroyAllocator(admin, ctx);
    }
  });

  test("allocator records an Allocated outcome on an eligible row", async ({
    page,
  }) => {
    const banner = page.getByTestId("bridge-outcome-banner");
    await expect(banner).toBeVisible();

    await banner.getByRole("button", { name: /^Allocated$/ }).click();

    const form = page.getByTestId("allocated-form");
    await expect(form).toBeVisible();

    await form.locator("input[type='number']").fill("10");
    await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes("/api/bridge/outcome") &&
          !r.url().includes("/dismiss") &&
          r.request().method() === "POST",
      ),
      form.getByRole("button", { name: /^Record allocation$/ }).click(),
    ]);

    const recorded = page.getByTestId("outcome-recorded-row");
    await expect(recorded).toBeVisible();
    await expect(recorded).toContainText(/Recorded: Allocated\s+10%/);
  });

  test("allocator records a Rejected outcome with reason=Mandate conflict", async ({
    page,
  }) => {
    const banner = page.getByTestId("bridge-outcome-banner");
    await expect(banner).toBeVisible();

    await banner.getByRole("button", { name: /^Rejected$/ }).click();

    const form = page.getByTestId("rejected-form");
    await expect(form).toBeVisible();

    await form.locator("select").selectOption("mandate_conflict");
    await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes("/api/bridge/outcome") &&
          !r.url().includes("/dismiss") &&
          r.request().method() === "POST",
      ),
      form.getByRole("button", { name: /^Record rejection$/ }).click(),
    ]);

    const recorded = page.getByTestId("outcome-recorded-row");
    await expect(recorded).toBeVisible();
    await expect(recorded).toContainText("Recorded: Rejected \u2014 Mandate conflict");
  });

  test("dismiss button hides the banner for the session", async ({ page }) => {
    const banner = page.getByTestId("bridge-outcome-banner");
    await expect(banner).toBeVisible();

    // Gate on the dismiss POST response. Playwright's auto-wait confirms the
    // button is actionable, but the component attaches its onClick during
    // React hydration — if the click lands in the server-rendered DOM before
    // hydration completes, the fetch never fires. Pairing the click with
    // waitForResponse guarantees the server recorded the dismissal before we
    // assert the UI.
    await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes("/api/bridge/outcome/dismiss") &&
          r.request().method() === "POST",
      ),
      banner.getByRole("button", { name: /dismiss for today/i }).click(),
    ]);

    // With exactly one eligible row, the banner must fully disappear —
    // no sibling banner slides into first place.
    await expect(page.getByTestId("bridge-outcome-banner")).toHaveCount(0);
  });
});
