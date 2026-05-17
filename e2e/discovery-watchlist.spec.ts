/**
 * Phase 13 / Plan 13-01 / DISCO-01 — Watchlist e2e contract.
 *
 * Proves the cross-stack guarantee: an allocator can star a strategy, reload
 * the page, and see it persisted in `user_favorites` (migration 024) via the
 * PUT /api/watchlist/[strategyId] route.
 *
 * AUDIT-2026-05-07 (cluster C) hardening:
 *  - Replaces the hardcoded `matratzentester24@gmail.com / Test12` shared
 *    account with a per-run seeded allocator via `seedTestAllocator()`.
 *    Spec is `test.skip`'d when `TEST_SUPABASE_*` env is missing (matches
 *    sister `discovery-hide-examples-default.spec.ts`). The shared account
 *    pattern caused state pollution across CI shards and meant a CI-only
 *    failure mode (cred rotation) was indistinguishable from a real
 *    regression.
 *  - Cleanup uses `test.afterAll` + admin `deleteUser` (FK CASCADE removes
 *    `user_favorites` rows automatically per migration 024). The previous
 *    cleanup gated on `.isVisible().catch(()=>false)` silently skipped on
 *    any earlier assertion failure or StarToggle aria-label drift, leaking
 *    starred rows across runs.
 *  - `waitForResponse` predicates match on URL+method only (no status filter).
 *    Status is asserted separately so a 401/500 surfaces the real status
 *    code instead of timing out after 30s with a generic "Timeout exceeded".
 *  - Adds two new tests required by the e2e/all-user-groups rule
 *    (`feedback_e2e_all_user_groups`):
 *      (a) unauthenticated PUT returns 401 — public path coverage.
 *      (b) user-B cannot read user-A's favorites via GET — RLS proof,
 *          the entire reason the table is RLS-scoped.
 *  - Reload assertion polls via `expect(...).toBeVisible({ timeout })`
 *    instead of synchronous expect, so a hydration-delay failure is
 *    distinguishable from a state-not-persisted failure.
 */

import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import {
  seedBridgeCandidate,
  seedTestAllocator,
  type SeededStrategy,
} from "./helpers/seed-test-project";
import {
  cleanupTestAllocator,
  cleanupTestStrategy,
} from "./helpers/cleanup-test-project";

const HAS_SEED_ENV =
  !!process.env.TEST_SUPABASE_URL &&
  !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

async function loginViaForm(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto("/login");
  await page.fill(
    'input[name="email"], input[placeholder*="email" i]',
    email,
  );
  await page.fill('input[type="password"]', password);
  await page.click('button:has-text("Sign in")');
  await page.waitForURL(/\/(discovery|strategies|dashboard)/, {
    timeout: 15000,
  });
}

test.describe("DISCO-01 watchlist", () => {
  test.skip(
    !HAS_SEED_ENV,
    "discovery-watchlist: TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY " +
      "not wired — spec authored but CI-skip per Plan 13-02 / 13-05 fallback " +
      "pattern. See e2e/helpers/seed-test-project.ts.",
  );

  let userAId: string | undefined;
  let userAEmail: string;
  let userAPassword: string;
  let userBId: string | undefined;
  let userBEmail: string;
  let userBPassword: string;
  let seededStrategy: SeededStrategy | undefined;

  test.beforeAll(async () => {
    // Seed both users AND a published strategy serially.
    //
    // audit-2026-05-07 SPECIALIST-testing e2e/discovery-watchlist.spec.ts:110 —
    // the previous beforeAll did NOT seed a strategy, so the spec
    // silently skipped the happy-path test on every clean test DB
    // (`test.skip(tableRowCount === 0, …)`). That made the cross-stack
    // PUT → reload → persist contract structurally unverifiable in CI.
    //
    // audit-2026-05-07 SPECIALIST-red-team `parallel-seed-burst` — the
    // previous `Promise.all([...])` fired three admin.auth.createUser
    // calls per worker (×4 workers ≈ 12 concurrent) within ~50ms.
    // Supabase auth-admin endpoints rate-limit createUser bursts and
    // `e2e-onboarding-${Date.now()}` resolves at millisecond
    // granularity, so two parallel calls in the same tick could collide
    // on the unique email constraint and 409 the entire beforeAll.
    // Serializing costs ~240ms vs ~80ms parallel — invisible next to
    // a single PDF render — and removes the burst entirely. The email
    // helper now also includes a Math.random suffix as belt-and-braces.
    //
    // audit-2026-05-07 SPECIALIST-red-team
    // `seed-strategy-missing-category` — seedBridgeCandidate now
    // accepts a `categorySlug` so the seeded strategy actually carries
    // a `category_id` matching `/discovery/crypto-sma`'s slug filter
    // (`getStrategiesByCategory` uses an inner-join on
    // `discovery_categories.slug`). Without this the row would never
    // render in the discovery table, and the happy-path star button
    // assertion would 30s-timeout while the RLS-leak detector could
    // not see a real leak.
    const seedA = await seedTestAllocator();
    const seedB = await seedTestAllocator();
    const strategy = await seedBridgeCandidate({ categorySlug: "crypto-sma" });
    userAId = seedA.userId;
    userAEmail = seedA.email;
    userAPassword = seedA.password;
    userBId = seedB.userId;
    userBEmail = seedB.email;
    userBPassword = seedB.password;
    seededStrategy = strategy;
  });

  test.afterAll(async () => {
    // FK CASCADE on auth.users.id removes user_favorites rows when the
    // user is deleted (migration 024 line 30). Cleanup is best-effort:
    // any failure is logged in cleanupTestAllocator() and does not fail
    // the spec, per the helper's contract.
    if (userAId) await cleanupTestAllocator(userAId);
    if (userBId) await cleanupTestAllocator(userBId);
    if (seededStrategy) await cleanupTestStrategy(seededStrategy);
  });

  test("watchlist toggle persists across reload", async ({ page }) => {
    await loginViaForm(page, userAEmail, userAPassword);

    // audit-2026-05-07 SPECIALIST-red-team `seed-strategy-missing-category` —
    // before clicking into /discovery/crypto-sma, verify the seeded
    // strategy is structurally queryable by the inner-join filter that
    // backs the page. If the row is missing here (regressed category_id,
    // RLS hiding it from authenticated allocators, etc.) the spec fails
    // with a precise diagnosis instead of a 30s star-button timeout
    // chasing an empty-row table.
    expect(
      seededStrategy?.categorySlug,
      "seededStrategy.categorySlug missing — seedBridgeCandidate did not " +
        "resolve a discovery_categories.slug, /discovery/crypto-sma will " +
        "render zero rows",
    ).toBe("crypto-sma");
    expect(
      seededStrategy?.categoryId,
      "seededStrategy.categoryId missing — strategy was inserted with " +
        "category_id=NULL, getStrategiesByCategory inner-join filters it out",
    ).toBeTruthy();

    await page.goto("/discovery/crypto-sma");
    // beforeAll seeded one published strategy with the matching
    // category_id, so the table MUST render the seeded row. A zero-row
    // state here is a real regression (e.g. the published-status filter
    // regressed, or RLS hid the row from an authenticated allocator,
    // or `discovery_categories!inner(slug)` was widened to a left-join
    // and a different category accidentally won) — NOT a "skip me,
    // no data" condition.
    // audit-2026-05-07 SPECIALIST-testing fix:
    // e2e/discovery-watchlist.spec.ts:110 — the previous test.skip on
    // tableRowCount === 0 silently masked the entire happy-path
    // assertion on every clean test DB.
    await page.waitForSelector("table tbody tr", { timeout: 15000 });
    const firstRow = page.locator("table tbody tr").first();
    await expect(
      firstRow,
      "discovery table rendered zero rows despite a seeded published " +
        "strategy with category_id=crypto-sma — published-filter, RLS, " +
        "or discovery_categories.slug inner-join regression",
    ).toBeVisible();
    // Belt-and-braces: the seeded strategy's star button must actually
    // exist on the first row. If the table renders the "no strategies
    // match your filters" empty-state row (a <tr> with no star button)
    // this assertion surfaces the structural failure immediately.
    const starButton = firstRow
      .locator('button[aria-label*="to watchlist"]')
      .first();
    await expect(
      starButton,
      "first discovery row has no watchlist star button — empty-state row " +
        "rendered instead of the seeded strategy (category_id mismatch?)",
    ).toBeVisible({ timeout: 10000 });

    // 1. Click the FIRST row's star (unstarred → starred). Match the
    // PUT request on URL+method only — asserting status separately so a
    // non-200 surfaces the real status code instead of a 30s timeout.
    const starredResponsePromise = page.waitForResponse(
      (r) =>
        r.url().includes("/api/watchlist/") && r.request().method() === "PUT",
    );
    await starButton.click();
    const starredResponse = await starredResponsePromise;
    expect(
      starredResponse.status(),
      `PUT /api/watchlist failed — body=${await starredResponse.text().catch(() => "<unreadable>")}`,
    ).toBe(200);

    // 2. Reload and confirm the star is still filled (server-persisted).
    // Use a polling expect on the aria-label so a hydration delay is
    // distinguishable from a state-not-persisted regression — the
    // previous synchronous expect raced StarToggle hydration.
    await page.reload();
    await page.waitForSelector("table tbody tr", { timeout: 15000 });
    const firstRowAfterReload = page.locator("table tbody tr").first();
    await expect(
      firstRowAfterReload.locator('button[aria-label*="from watchlist"]'),
      "StarToggle did not persist 'starred' state across reload",
    ).toBeVisible({ timeout: 5000 });

    // 3. The My Watchlist tab badge must read "1".
    const watchTab = page.getByRole("tab", { name: /My Watchlist/ });
    await expect(watchTab).toContainText("1");

    // 4. Clicking My Watchlist filters to exactly 1 row.
    await watchTab.click();
    await expect(page.locator("table tbody tr")).toHaveCount(1);
  });

  test("unauthenticated PUT to /api/watchlist returns 401 (public-path RLS guard)", async ({
    request,
    baseURL,
  }) => {
    // This is the public/anon coverage required by feedback_e2e_all_user_groups:
    // the RLS-scoped watchlist endpoint MUST reject unauthenticated requests
    // before doing any work. Without this test a regression that dropped
    // the `if (!user) return 401` guard would only fail when an actual
    // anon user happened to call the route — never in CI.
    //
    // We use a syntactically-valid UUID so the failure can only come
    // from the auth check, not a 400 on malformed input.
    const someStrategyId = "cccccccc-0001-4000-8000-000000000001";
    // audit-2026-05-07 SPECIALIST-red-team
    // `e2e/discovery-watchlist.spec.ts:178:csrf-precedes-auth` —
    // assertSameOrigin runs BEFORE the auth check, so an env where
    // NEXT_PUBLIC_VERCEL_URL is not exposed at build-time (Playwright's
    // baseURL is then not in ALLOWED_HOSTS) would produce 403, masking
    // the auth-guard regression we actually want to detect. Explicitly
    // setting Origin to the baseURL guarantees assertSameOrigin passes
    // and the 401 path is the only failure mode — decoupling this
    // assertion from CSRF env wiring.
    const origin = baseURL ?? process.env.PLAYWRIGHT_BASE_URL ?? "";
    const res = await request.put(`/api/watchlist/${someStrategyId}`, {
      data: { action: "add" },
      headers: origin ? { origin } : undefined,
    });
    // Anon MUST be rejected with 401 specifically. With Origin pinned to
    // baseURL, assertSameOrigin PASSES and the route reaches the
    // `if (!user) return 401` check.
    //
    // audit-2026-05-07 SPECIALIST-testing fix:
    // e2e/discovery-watchlist.spec.ts:178 — accepting 403 as an
    // alternative converted a real-regression detector into a noise-tolerant
    // probe: a regression that dropped the auth guard would NOT fail this
    // test if the CSRF guard happened to reject the test's origin for an
    // unrelated config-drift reason. If this assertion ever fails with 403
    // in CI, the fix is to set NEXT_PUBLIC_SITE_URL correctly — not to
    // widen the assertion.
    expect(res.status()).toBe(401);
  });

  test("user-B cannot read user-A's favorites (RLS proof)", async ({
    page,
  }) => {
    // Per feedback_e2e_all_user_groups + migration 024 RLS contract, a
    // second allocator MUST NOT be able to read the first allocator's
    // watchlist rows. This is the RLS proof — without a second user the
    // entire RLS scope of user_favorites is untested.
    //
    // Strategy: seed a favorite row server-side for user-A via the admin
    // client, then log in as user-B in the browser and assert the GET
    // /api/watchlist/me path (or the StrategyTable watchlist column)
    // shows zero rows. Falls back to a direct REST query with user-B's
    // anon JWT if no in-app surface exists.
    const url = process.env.TEST_SUPABASE_URL!;
    const serviceKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!;
    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Use the strategy seeded in beforeAll. Prior implementation queried
    // for any published strategy and skipped when none existed — that
    // skip silently hid the RLS proof on every clean test DB.
    // audit-2026-05-07 SPECIALIST-testing fix:
    // e2e/discovery-watchlist.spec.ts:208 — beforeAll now guarantees a
    // seeded strategy, so this test always runs.
    expect(
      seededStrategy,
      "seededStrategy missing — beforeAll did not seed a published strategy",
    ).toBeDefined();
    const strategyId = seededStrategy!.strategyId;

    // Insert a favorite row for user-A directly (bypasses the RLS-scoped
    // PUT route because we want to seed cross-user state without going
    // through user-A's session).
    const { error: insertError } = await admin
      .from("user_favorites")
      .upsert(
        { user_id: userAId!, strategy_id: strategyId },
        { onConflict: "user_id,strategy_id" },
      );
    expect(
      insertError,
      `seed user-A favorite failed: ${insertError?.message}`,
    ).toBeNull();

    // audit-2026-05-07 SPECIALIST-red-team
    // `rls-masked-by-explicit-filter` — the previous UI-based RLS
    // proof was indirect: `getMyWatchlist(userBId)` applies an explicit
    // `.eq('user_id', userBId)` filter (src/lib/queries.ts:2554) on
    // top of RLS. If RLS leaked, the explicit filter would still hide
    // user-A's row, so the My Watchlist tab badge would stay empty for
    // user-B and the spec would pass with the RLS policy actually
    // broken. The leak only surfaces when BOTH the server-side
    // user_id filter AND the RLS policy regress simultaneously — a
    // coincidence, not the canonical RLS-leak shape.
    //
    // Bind the RLS proof DIRECTLY: sign in as user-B against the
    // Supabase auth endpoint to mint a user-scoped JWT, then issue a
    // bare `SELECT * FROM user_favorites` against PostgREST with that
    // JWT. NO `.eq('user_id', userBId)` filter is applied client-side
    // — the only thing that can return zero rows is the RLS policy
    // `auth.uid() = user_id` (migration 024). A leak surfaces here
    // even if every server-side filter is intact.
    const anonKey = process.env.TEST_SUPABASE_ANON_KEY;
    if (anonKey) {
      const userBClient = createClient(url, anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error: signInErr } =
        await userBClient.auth.signInWithPassword({
          email: userBEmail,
          password: userBPassword,
        });
      expect(
        signInErr,
        `user-B signInWithPassword failed: ${signInErr?.message}`,
      ).toBeNull();
      // Bare SELECT — no client-side filter. Only RLS can scope this.
      const { data: leakRows, error: leakErr } = await userBClient
        .from("user_favorites")
        .select("user_id, strategy_id");
      expect(
        leakErr,
        `user-B SELECT user_favorites failed: ${leakErr?.message}`,
      ).toBeNull();
      // RLS contract: user-B's session may ONLY see rows where
      // user_id = userBId. user-A's seeded row MUST NOT appear.
      const aRowsVisibleToB = (leakRows ?? []).filter(
        (r) => r.user_id === userAId,
      );
      expect(
        aRowsVisibleToB,
        `user-B's session sees ${aRowsVisibleToB.length} of user-A's ` +
          `user_favorites rows — RLS LEAK on migration 024 policy`,
      ).toHaveLength(0);
      await userBClient.auth.signOut();
    }

    // Belt-and-braces UI assertion. Coincidence requirement: this only
    // fires when BOTH the explicit user_id filter AND RLS regress.
    // The direct-bind check above is the primary RLS-leak detector;
    // this stays as cross-layer confirmation.
    await loginViaForm(page, userBEmail, userBPassword);
    await page.goto("/discovery/crypto-sma");

    // Wait for the table or empty state.
    await Promise.race([
      page.waitForSelector("table tbody tr", { timeout: 15000 }),
      page.waitForSelector("text=/no strategies/i", { timeout: 15000 }),
    ]);

    // Per WatchlistTabs.tsx:69-91 the "My Watchlist" tab is ALWAYS
    // rendered; only the count badge span (lines 86-90) is conditional
    // on `count > 0`. So user-B (zero favorites) sees the tab present
    // with no digit in its text; the plain text is literally
    // "My Watchlist". A leaked count would surface as a digit anywhere
    // in the tab text.
    //
    // audit-2026-05-07 SPECIALIST-testing fix:
    // e2e/discovery-watchlist.spec.ts:244 — previously both assertions
    // were guarded by `if (await watchTab.isVisible().catch(() => false))`.
    // If the tab were ever conditionally suppressed (refactor, render
    // bug), both RLS-leak assertions would silently no-op and the test
    // would pass with ZERO assertions actually firing. Inverted to assert
    // the tab IS visible first, so a hidden tab is an explicit failure.
    const watchTab = page.getByRole("tab", { name: /My Watchlist/ });
    await expect(
      watchTab,
      "My Watchlist tab not visible — render regression masks the entire " +
        "RLS-leak assertion. Tab is always rendered per WatchlistTabs.tsx.",
    ).toBeVisible();
    const tabText = (await watchTab.textContent()) ?? "";
    // Any digit anywhere in the tab text indicates a leaked count.
    // Stricter than `/\b1\b/` — covers leaks of size 1, 2, 11, 100, etc.
    expect(
      tabText.replace(/\s+/g, " ").trim(),
      `user-B sees a count digit in My Watchlist tab text — RLS LEAK ` +
        `of user-A's favorites (expected exactly "My Watchlist", got "${tabText}")`,
    ).not.toMatch(/\d/);

    // Belt-and-braces: click into the My Watchlist tab and assert the
    // resulting table is empty. If RLS leaked, user-B would see user-A's
    // favorited strategy here.
    await watchTab.click();
    // If the table renders rows under "My Watchlist" for user-B, RLS
    // has leaked. The expected state is the "no strategies" empty
    // state OR an empty tbody.
    const watchlistRowCount = await page
      .locator("table tbody tr")
      .count();
    expect(
      watchlistRowCount,
      "user-B sees rows under My Watchlist — RLS LEAK",
    ).toBe(0);

    // Cleanup the seeded row so the next run starts clean. cleanupTestAllocator
    // handles CASCADE in afterAll, but explicit row cleanup is faster
    // and survives if the user delete is best-effort.
    await admin
      .from("user_favorites")
      .delete()
      .eq("user_id", userAId!)
      .eq("strategy_id", strategyId);
  });
});
