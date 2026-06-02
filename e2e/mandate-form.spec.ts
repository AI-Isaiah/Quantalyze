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

/**
 * Provision a test user. Defaults to a VERIFIED allocator (the golden-path
 * subject of the original four tests). H-1049 (pr-test-analyzer) added
 * wrong-role and unverified coverage, so role / allocator_status are now
 * overridable instead of hardcoded — a regression in the role/status gating
 * (ProfileTabs allocatorOnly filter at ProfileTabs.tsx:83, approval-gate at
 * src/lib/api/approval-gate.ts) is now exercised end-to-end rather than only
 * for the happy path.
 */
async function provisionAllocator(
  admin: SupabaseClient,
  opts?: { role?: string; allocatorStatus?: string },
): Promise<AllocatorCtx> {
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
      role: opts?.role ?? "allocator",
      allocator_status: opts?.allocatorStatus ?? "verified",
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

  // ── H-1049: non-golden-path coverage (pr-test-analyzer) ───────────────
  // The four tests above all run as a freshly-provisioned VERIFIED allocator
  // logged in via beforeEach. The cases below were the documented gaps:
  // wrong-role, unverified, and the RPC/validation fail-loud contract. They
  // provision their OWN subject (the beforeEach verified-allocator login is
  // irrelevant or actively wrong for these), so each cleans up its own user.

  test("wrong-role (strategy_manager) sees NO Mandate tab on /profile", async ({
    page,
  }) => {
    // ProfileTabs.tsx:83 filters out `allocatorOnly` tabs when !isAllocator,
    // and :105 renders <MandateForm> only when `activeTab === "mandate" &&
    // isAllocator`. /preferences permanently redirects to /profile?tab=mandate
    // (preferences/page.tsx:11); parseTabParam (ProfileTabs.tsx:40) then drops
    // the disallowed `mandate` param for a non-allocator. So a strategy_manager
    // must NOT see the Mandate tab nor the "My Allocation Settings" form. A
    // regression that dropped the isAllocator gate would surface here.
    const sm = await provisionAllocator(admin, {
      role: "strategy_manager",
      allocatorStatus: "pending",
    });
    try {
      await page.goto("/login");
      await page.getByLabel(/email/i).fill(sm.email);
      await page.getByLabel(/password/i).fill(TEST_PASSWORD);
      await page.getByRole("button", { name: /sign in/i }).click();
      await page.waitForURL((url) => !url.pathname.startsWith("/login"));
      await page.goto("/preferences");
      await page.waitForLoadState("networkidle");

      // The Mandate tab button must be absent for a non-allocator.
      await expect(
        page.getByRole("button", { name: "Mandate" }),
        "strategy_manager sees a Mandate tab — ProfileTabs allocatorOnly " +
          "filter regression (tab leaked to a non-allocator)",
      ).toHaveCount(0);
      // The mandate form heading must NOT render.
      await expect(
        page.getByRole("heading", { name: "My Allocation Settings" }),
        "strategy_manager sees the mandate form — isAllocator render gate " +
          "regression (MandateForm leaked to a non-allocator)",
      ).toHaveCount(0);
    } finally {
      await destroyAllocator(admin, sm);
    }
  });

  test("logged-out user hitting /preferences is redirected to /login", async ({
    page,
  }) => {
    // /preferences is NOT in proxy PUBLIC_ROUTES (src/proxy.ts:7) and
    // /profile redirects `if (!user)` to /login (profile/page.tsx:19). A
    // logged-out visitor must NEVER render the mandate form. Without this
    // test a regression that dropped either guard would let an anon user
    // reach the allocator-only surface and only fail in production.
    //
    // This test uses NO seeded user — it asserts the redirect chain works
    // before any auth. Fresh context (no beforeEach login state leaks in
    // because Playwright isolates contexts per test).
    await page.context().clearCookies();
    await page.goto("/preferences");
    await page.waitForLoadState("networkidle");
    await expect(
      page,
      "logged-out /preferences did not land on /login — the anon redirect " +
        "chain (proxy + profile/page.tsx if(!user)) regressed and the " +
        "mandate form is reachable without auth",
    ).toHaveURL(/\/login/);
    // The mandate form must not have rendered.
    await expect(
      page.getByRole("heading", { name: "My Allocation Settings" }),
    ).toHaveCount(0);
  });

  test("PUT /api/preferences with out-of-range max_weight fails loud (400, not silent)", async ({
    page,
  }) => {
    // H-1049 case (4): the slider UI is BOUND to 0.05–0.50, so the
    // fail-loud bounds contract (validateSelfEditableInput in
    // src/lib/preferences.ts:127 → 400; RPC 22023 backstop at
    // src/app/api/preferences/route.ts) can ONLY be exercised by hitting the
    // route directly with an out-of-range value. The original four UI tests
    // never reach this path. A regression that dropped the bounds check
    // would let an out-of-range max_weight persist (e.g. 0.90 = 90% in one
    // strategy, defeating diversification) and NO existing test would fail.
    //
    // We log in as a verified allocator (passes the approval gate) so the
    // 400 we observe is the VALIDATION failure, not a 401/403 gate.
    const allocator = await provisionAllocator(admin); // verified allocator
    try {
      await page.goto("/login");
      await page.getByLabel(/email/i).fill(allocator.email);
      await page.getByLabel(/password/i).fill(TEST_PASSWORD);
      await page.getByRole("button", { name: /sign in/i }).click();
      await page.waitForURL((url) => !url.pathname.startsWith("/login"));

      // CSRF: assertSameOrigin requires Origin to match the allowlist
      // (mirrors discovery-prefs-isolation.spec.ts) — set it from the
      // page origin so the 400 we get is the bounds rejection, not a 403.
      const origin = new URL(page.url()).origin;
      const res = await page.request.put("/api/preferences", {
        data: { max_weight: 0.9 }, // > 0.50 upper bound
        headers: { "content-type": "application/json", origin },
      });
      expect(
        res.status(),
        `out-of-range max_weight=0.9 was NOT rejected with 400 (got ` +
          `${res.status()} ${await res.text()}) — bounds check ` +
          "(validateSelfEditableInput / RPC 22023) regressed; an " +
          "out-of-range concentration limit would silently persist",
      ).toBe(400);
      const body = await res.json();
      expect(
        body?.error,
        "400 body did not carry the max_weight bounds message — the " +
          "fail-loud contract (D-17 / migration scoring_weight_overrides) " +
          "regressed to a generic/empty error",
      ).toContain("max_weight must be between 0.05 and 0.50");

      // Belt-and-braces: the bad value did NOT persist. A subsequent GET
      // must NOT report max_weight=0.9.
      const after = await page.request.get("/api/preferences");
      expect(after.ok()).toBe(true);
      const afterBody = await after.json();
      expect(
        afterBody?.preferences?.max_weight ?? null,
        "out-of-range max_weight=0.9 was persisted despite the 400 — the " +
          "validation rejected the response but the write still landed",
      ).not.toBe(0.9);
    } finally {
      await destroyAllocator(admin, allocator);
    }
  });

  test("PUT /api/preferences as an UNVERIFIED allocator is gated (403)", async ({
    page,
  }) => {
    // H-1049 case (5): the original beforeEach hardcoded
    // allocator_status:"verified". An unverified allocator must be blocked
    // by the approval gate (assertProfileApproved → 403 "Account pending
    // approval", src/lib/api/approval-gate.ts) BEFORE the mandate write. A
    // regression that dropped the gate on the preferences route would let a
    // not-yet-approved allocator mutate their mandate. The verified-only
    // tests above can never catch this.
    const pending = await provisionAllocator(admin, {
      role: "allocator",
      allocatorStatus: "pending",
    });
    try {
      await page.goto("/login");
      await page.getByLabel(/email/i).fill(pending.email);
      await page.getByLabel(/password/i).fill(TEST_PASSWORD);
      await page.getByRole("button", { name: /sign in/i }).click();
      await page.waitForURL((url) => !url.pathname.startsWith("/login"));

      const origin = new URL(page.url()).origin;
      const res = await page.request.put("/api/preferences", {
        data: { max_weight: 0.25 }, // in-range — only the gate should block
        headers: { "content-type": "application/json", origin },
      });
      // Must be the approval gate, not a validation 400 (value is valid) and
      // not a success.
      expect(
        res.status(),
        `unverified allocator PUT was not gated — got ${res.status()} ` +
          `${await res.text()} (expected 403 from assertProfileApproved). ` +
          "A pending-approval allocator could mutate their mandate.",
      ).toBe(403);
    } finally {
      await destroyAllocator(admin, pending);
    }
  });
});
