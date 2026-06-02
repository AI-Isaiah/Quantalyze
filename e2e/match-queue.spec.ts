import { test, expect } from "@playwright/test";
import { SELECTORS, type E2EPage } from "./helpers/discovery-selectors";

// Match Queue E2E tests (Phase 4 Task 14 from the perfect-match plan).
//
// These tests follow the existing E2E pattern in this repo: hit the real dev
// server, log in as the admin test account, and verify the admin-gate
// behavior + the founder workflow (open queue → view candidates → send intro).
//
// Assumptions:
// - Dev server is running at http://localhost:3000
// - Migration 011 has been applied
//
// H-1050 (red-team CHAIN) test-side remediation:
//   The prior version hardcoded `matratzentester24@gmail.com / Test12` in
//   source. A committed plaintext credential is a security finding in its own
//   right (it lives in git history forever); the CONVENTION for this repo is
//   to source test creds from the environment (the macOS-Keychain-backed
//   E2E_* envs, see reference_test_credentials), NOT to commit them. The
//   credential already in git history and the `authenticated`-grant on the
//   send_intro RPC are production/infra concerns out of this file's scope; the
//   testable defect closed here is the SILENT-NO-OP half of the chain:
//   admin-path tests that bailed out (wrapped `if (hasDashboard)`, early
//   `return`) silently flipped from real coverage to vacuous green when the
//   account lacked admin — so a credential rotation that dropped the admin
//   role was invisible (CI stayed green). We now:
//     1. read creds from E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD (no committed
//        secret) and EXPLICITLY skip when they are absent (a reported skip,
//        not a green vacuous pass);
//     2. when creds ARE present, assert the account actually reaches the
//        admin surface — a dropped admin role then FAILS LOUD instead of
//        no-op-passing.
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD;
const HAS_ADMIN_CREDS = !!ADMIN_EMAIL && !!ADMIN_PASSWORD;

async function login(page: E2EPage) {
  // Selectors centralized in helpers/discovery-selectors.ts (H-1040) so a
  // login-form rename rots one place and fails the AuthForms unit test
  // instead of silently 0-matching here.
  await page.goto("/login");
  await page.fill(SELECTORS.loginEmail, ADMIN_EMAIL!);
  await page.fill(SELECTORS.loginPassword, ADMIN_PASSWORD!);
  await page.click(SELECTORS.loginSubmit);
  await page.waitForURL(/\/(discovery|strategies)/, { timeout: 10000 });
}

test.describe("Match Queue — admin gate", () => {
  test("unauthenticated user is redirected from /admin/match", async ({
    page,
  }) => {
    await page.goto("/admin/match");
    // proxy should bounce to /login (admin routes are protected)
    await expect(page).toHaveURL(/\/(login|discovery)/, { timeout: 10000 });
  });

  test("unauthenticated user is redirected from /admin/match/[id]", async ({
    page,
  }) => {
    await page.goto("/admin/match/00000000-0000-0000-0000-000000000000");
    await expect(page).toHaveURL(/\/(login|discovery)/, { timeout: 10000 });
  });

  test("/admin/match/eval is reachable by the admin account", async ({
    page,
  }) => {
    test.skip(
      !HAS_ADMIN_CREDS,
      "E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD not wired — admin-path coverage " +
        "is REPORTED-SKIPPED (not silently green). See H-1050.",
    );
    await login(page);
    await page.goto("/admin/match/eval");
    // H-1050: the prior version branched `if (isAdmin) {...} else {...}` so
    // it passed whether or not the account was admin — meaning a credential
    // rotation that DROPPED the admin role left CI green while the admin
    // path was never exercised. Now that creds are env-gated to the admin
    // account, we assert the admin path POSITIVELY: the eval surface MUST
    // render and the URL MUST be the eval route. A demoted admin (bounced
    // to /discovery) now FAILS this test loudly.
    await expect(
      page.locator("text=Match engine eval"),
      "admin account did NOT reach the match-engine eval dashboard — the " +
        "test admin role was dropped (credential rotation) OR the admin gate " +
        "regressed. This used to pass silently via the non-admin branch.",
    ).toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain("/admin/match/eval");
  });
});

test.describe("Match Queue — API admin gate", () => {
  test("GET /api/admin/match/allocators requires admin", async ({
    request,
  }) => {
    const res = await request.get("/api/admin/match/allocators");
    // 403 or 401 depending on auth state
    // Unauthenticated requests are redirected by the proxy (307); authenticated
    // non-admin requests get a 401/403 from withAdminAuth.
    expect([307, 401, 403]).toContain(res.status());
  });

  test("POST /api/admin/match/recompute requires admin", async ({
    request,
  }) => {
    const res = await request.post("/api/admin/match/recompute", {
      data: { allocator_id: "00000000-0000-0000-0000-000000000000" },
    });
    // Unauthenticated requests are redirected by the proxy (307); authenticated
    // non-admin requests get a 401/403 from withAdminAuth.
    expect([307, 401, 403]).toContain(res.status());
  });

  test("POST /api/admin/match/send-intro requires admin", async ({
    request,
  }) => {
    const res = await request.post("/api/admin/match/send-intro", {
      data: {
        allocator_id: "00000000-0000-0000-0000-000000000000",
        strategy_id: "00000000-0000-0000-0000-000000000000",
        admin_note: "test",
      },
    });
    // Unauthenticated requests are redirected by the proxy (307); authenticated
    // non-admin requests get a 401/403 from withAdminAuth.
    expect([307, 401, 403]).toContain(res.status());
  });

  test("GET /api/admin/match/kill-switch requires admin", async ({
    request,
  }) => {
    const res = await request.get("/api/admin/match/kill-switch");
    // Unauthenticated requests are redirected by the proxy (307); authenticated
    // non-admin requests get a 401/403 from withAdminAuth.
    expect([307, 401, 403]).toContain(res.status());
  });

  test("POST /api/admin/match/decisions requires admin", async ({
    request,
  }) => {
    const res = await request.post("/api/admin/match/decisions", {
      data: {
        allocator_id: "00000000-0000-0000-0000-000000000000",
        strategy_id: "00000000-0000-0000-0000-000000000000",
        decision: "thumbs_up",
      },
    });
    // Unauthenticated requests are redirected by the proxy (307); authenticated
    // non-admin requests get a 401/403 from withAdminAuth.
    expect([307, 401, 403]).toContain(res.status());
  });
});

test.describe("Match Queue — admin UI", () => {
  // H-1050: env-gate the whole admin-UI block. When creds are absent the
  // tests are REPORTED-SKIPPED (visible in the CI summary) rather than
  // running against a hardcoded committed account and silently no-op-passing
  // when that account lacks admin.
  test.skip(
    !HAS_ADMIN_CREDS,
    "E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD not wired — admin-UI coverage is " +
      "REPORTED-SKIPPED (not silently green). See H-1050.",
  );

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("admin opens match queue and sees the filter chip row", async ({
    page,
  }) => {
    // H-1050: the prior version branched `if (url.endsWith("/admin/match"))
    // {...} else {...}` so the NON-admin redirect branch made the test pass
    // even when the account had lost admin. With creds env-gated to the
    // admin account, we assert the admin path POSITIVELY: navigation MUST
    // land on /admin/match and the filter chip row MUST render. A demoted
    // admin (bounced to /discovery) now fails loudly.
    await page.goto("/admin/match");
    await expect(
      page,
      "admin account was bounced from /admin/match — admin role dropped " +
        "(credential rotation) or admin gate regressed. Used to pass " +
        "silently via the non-admin redirect branch.",
    ).toHaveURL(/\/admin\/match$/, { timeout: 10000 });
    await expect(
      page.locator('button:has-text("Needs attention")'),
    ).toBeVisible();
  });

  test("match queue index renders filter chips, search, and engine pill", async ({
    page,
  }) => {
    // H-1050: the prior version did `if (!url.endsWith("/admin/match"))
    // return;` — an early return that silently SKIPPED every assertion when
    // the account wasn't admin. With admin creds env-gated, the account MUST
    // reach /admin/match; a bounce is a loud failure, not a vacuous pass.
    await page.goto("/admin/match");
    await expect(
      page,
      "admin account did not reach /admin/match — admin role dropped or gate " +
        "regressed. Prior version silently `return`ed here and passed.",
    ).toHaveURL(/\/admin\/match$/, { timeout: 10000 });

    // Loud failure if the migration isn't applied — the page would show
    // the error card from MatchQueueIndex.tsx instead of the filter chips.
    await expect(
      page.locator("text=/Match engine schema not found/"),
    ).not.toBeVisible();

    // All four filter chips
    await expect(
      page.locator('button:has-text("Needs attention")'),
    ).toBeVisible();
    await expect(
      page.locator('button:has-text("New candidates")'),
    ).toBeVisible();
    await expect(page.locator('button:has-text("All")')).toBeVisible();
    // Search input
    await expect(
      page.locator('input[placeholder*="Search allocators"]'),
    ).toBeVisible();
    // Engine status pill (ON or OFF)
    await expect(page.locator("text=/Engine:/")).toBeVisible();
  });

  test("eval dashboard renders 4 KPIs and the window selector", async ({
    page,
  }) => {
    // H-1050: the prior version wrapped the entire body in
    // `if (hasDashboard) {...}` — a regression that demoted the admin (so
    // the dashboard never rendered) made the test pass with ZERO assertions
    // firing. With admin creds env-gated, the dashboard MUST render; its
    // absence is now a loud failure.
    await page.goto("/admin/match/eval");
    await expect(
      page.locator("text=Match engine eval"),
      "admin account did not reach the eval dashboard — admin role dropped " +
        "or gate regressed. Prior `if (hasDashboard)` wrapper passed with " +
        "no assertions when the dashboard was absent.",
    ).toBeVisible({ timeout: 10000 });

    // Four KPI labels
    await expect(page.locator("text=Intros shipped")).toBeVisible();
    await expect(page.locator("text=Hit rate top-3")).toBeVisible();
    await expect(page.locator("text=Hit rate top-10")).toBeVisible();
    await expect(page.locator("text=Graduation gate")).toBeVisible();
    // Window selector
    await expect(page.locator('button:has-text("7d")')).toBeVisible();
    await expect(page.locator('button:has-text("28d")')).toBeVisible();
    await expect(page.locator('button:has-text("90d")')).toBeVisible();
  });
});

test.describe("Preferences page", () => {
  // H-1050: this block logs in via the shared `login()` helper, which now
  // sources creds from E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD. Skip (reported,
  // not silently green) when they are absent so the login helper never
  // dereferences undefined creds.
  test.skip(
    !HAS_ADMIN_CREDS,
    "E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD not wired — preferences-page " +
      "coverage is REPORTED-SKIPPED. See H-1050.",
  );

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("preferences page loads for logged-in user", async ({ page }) => {
    const response = await page.goto("/preferences");
    expect(response?.status()).toBeLessThan(400);
    // Should show form fields
    await expect(
      page.locator("text=Mandate (one sentence)"),
    ).toBeVisible();
    await expect(
      page.locator("text=Typical ticket size"),
    ).toBeVisible();
    await expect(page.locator("text=Excluded exchanges")).toBeVisible();
  });

  test("preferences form submit shows feedback (saved or error)", async ({
    page,
  }) => {
    await page.goto("/preferences");

    // Clear and fill the mandate field
    const mandate = page.locator("textarea").first();
    await mandate.fill("E2E test mandate — diversified crypto SMA");

    // Fill ticket size
    const ticket = page.locator('input[type="number"]').first();
    await ticket.fill("50000");

    // Save
    await page.click('button:has-text("Save preferences")');

    // Wait for one of the two explicit feedback states. If neither appears
    // within 5 seconds, the form is broken and the test FAILS.
    const savedLocator = page.locator("text=/Saved at/");
    const errorLocator = page.locator(".text-negative");
    await Promise.race([
      savedLocator.waitFor({ state: "visible", timeout: 5000 }),
      errorLocator.waitFor({ state: "visible", timeout: 5000 }),
    ]);

    // Assert one of the two is visible (not a tautology — waitFor threw if neither)
    const sawSaved = await savedLocator.isVisible().catch(() => false);
    const sawError = await errorLocator.isVisible().catch(() => false);
    expect(sawSaved || sawError).toBe(true);
  });
});
