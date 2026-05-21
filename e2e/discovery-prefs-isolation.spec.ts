/**
 * Phase 13 / Plan 13-02 / DISCO-02 — Allocator preferences isolation contract.
 *
 * audit-2026-05-07 finding C-0303:
 *   The previous version of this spec asserted ONLY client-side localStorage
 *   key isolation (`discovery_view_preferences:{uid}:*`), which is a fixture-
 *   layer property (the client never writes another user's uid into its own
 *   localStorage, so the keys couldn't leak even with broken backend RLS).
 *   That meant an RLS / session-bypass regression on the server-side
 *   `allocator_preferences` row would have been UNDETECTABLE by this spec.
 *
 *   This rewrite pivots the contract to the real isolation surface:
 *     1. Sign in as user A, mutate prefs via PUT /api/preferences (sets
 *        `excluded_exchanges=['bybit']` on A's row).
 *     2. Sign out, sign in as user B.
 *     3. GET /api/preferences as user B — assert B does NOT see A's
 *        `excluded_exchanges=['bybit']`. The API derives `user.id` from the
 *        session cookie (route.ts:14, route.ts:33), so this asserts the
 *        cookie/session boundary AND the row scoping.
 *     4. Direct PostgREST proof (no client-side filter): sign in as user B
 *        against Supabase auth, issue a bare `SELECT * FROM
 *        allocator_preferences` with user B's JWT, assert user A's row is
 *        NOT visible. This pins the migration 057 RLS policy
 *        `allocator_prefs_self_read USING (user_id = auth.uid())` —
 *        the policy is the only thing that can scope this bare select.
 *
 *   What CANNOT be tested at this layer:
 *     - "Smuggle user A's user_id through the API as user B." The
 *       /api/preferences route (src/app/api/preferences/route.ts) does NOT
 *       accept a user_id param; identity is always derived from the session
 *       cookie. There is no API path to smuggle another uid through.
 *       Documented here so a future refactor that introduces such a param
 *       gets a forced-rewrite signal at code-review time.
 *
 * Env wiring:
 *   - Server-side path needs TEST_SUPABASE_URL + TEST_SUPABASE_SERVICE_ROLE_KEY
 *     (used by seedTestAllocator / cleanupTestAllocator).
 *   - Direct-PostgREST RLS proof additionally needs TEST_SUPABASE_ANON_KEY
 *     (mirrors discovery-watchlist.spec.ts:368). When the anon key is
 *     absent the RLS-proof step is skipped but the API-level isolation
 *     step still runs.
 *
 * When seed env is missing the whole describe block is `test.skip`'d (the
 * contract is at least PINNED for next CI cycle).
 */

import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { seedTestAllocator } from "./helpers/seed-test-project";
import { cleanupTestAllocator } from "./helpers/cleanup-test-project";
import { loginAs } from "./helpers/login";

const HAS_SEED_ENV =
  !!process.env.TEST_SUPABASE_URL &&
  !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

async function signOut(page: import("@playwright/test").Page) {
  // Try the user-menu sign-out button first (TODOS.md Q3 — there is no
  // /logout page; logout flows through the user-menu).
  const menuBtn = page.locator(
    'button[aria-label*="user menu" i], button[aria-label*="account" i]',
  );
  if (await menuBtn.first().isVisible().catch(() => false)) {
    await menuBtn.first().click();
    const signOut = page.locator(
      'button:has-text("Sign out"), button:has-text("Log out"), a:has-text("Sign out")',
    );
    if (await signOut.first().isVisible().catch(() => false)) {
      await signOut.first().click();
      await page.waitForURL(/\/(login|$)/, { timeout: 10000 });
      return;
    }
  }
  // Fallback: clear sb-* localStorage + cookies. The user-menu path above
  // already triggers SignOutButton; this fallback runs when the menu isn't
  // visible (e.g., the seeded test user doesn't render the header).
  await page.evaluate(() => {
    Object.keys(localStorage)
      .filter((k) => k.startsWith("sb-"))
      .forEach((k) => localStorage.removeItem(k));
  });
  await page.context().clearCookies();
}

test.describe("DISCO-02 allocator preferences isolation", () => {
  test.skip(
    !HAS_SEED_ENV,
    "discovery prefs isolation: TEST_SUPABASE_URL / " +
      "TEST_SUPABASE_SERVICE_ROLE_KEY not wired — spec authored but " +
      "CI-skip per Plan 13-02 / 13-05 fallback. See " +
      "e2e/helpers/seed-test-project.ts.",
  );

  let userAId: string | undefined;
  let userAEmail: string;
  let userAPassword: string;
  let userBId: string | undefined;
  let userBEmail: string;
  let userBPassword: string;

  test.beforeAll(async () => {
    // Serial seeding (matches discovery-watchlist.spec.ts:112 —
    // parallel-seed-burst red-team finding: Supabase auth-admin rate
    // limits createUser bursts).
    const seedA = await seedTestAllocator();
    const seedB = await seedTestAllocator();
    userAId = seedA.userId;
    userAEmail = seedA.email;
    userAPassword = seedA.password;
    userBId = seedB.userId;
    userBEmail = seedB.email;
    userBPassword = seedB.password;
  });

  test.afterAll(async () => {
    // FK CASCADE on auth.users.id removes allocator_preferences rows when
    // the user is deleted (migration 057 / perfect_match.sql). Best-effort.
    if (userAId) await cleanupTestAllocator(userAId);
    if (userBId) await cleanupTestAllocator(userBId);
  });

  test("user B cannot read user A's allocator_preferences (server-side RLS contract)", async ({
    page,
  }) => {
    // ---- Step 1: log in as A, write a distinguishing prefs row. ----
    await loginAs(page, userAEmail, userAPassword);

    // PUT /api/preferences derives user.id from the session cookie
    // (src/app/api/preferences/route.ts:33) and routes the value through
    // the `update_allocator_mandates` RPC. We use a distinguishing sentinel
    // (`bybit`) so user B's later GET cannot pass by accident if both rows
    // happen to be empty.
    //
    // CSRF guard: src/app/api/preferences/route.ts:29 calls
    // assertSameOrigin(req) which requires Origin or Referer matching the
    // allowlist (localhost:3000 in non-prod, per src/lib/csrf.ts:67).
    // Playwright's APIRequestContext does NOT set Origin automatically for
    // programmatic requests even when initiated through `page.request`, so
    // we set it explicitly from the page's current origin. Without this the
    // route 403s with `{"error":"Missing Origin or Referer header"}` and
    // the rest of the isolation contract becomes unverifiable.
    const pageOrigin = new URL(page.url()).origin;
    const putRes = await page.request.put("/api/preferences", {
      data: { excluded_exchanges: ["bybit"] },
      headers: { "content-type": "application/json", origin: pageOrigin },
    });
    expect(
      putRes.ok(),
      `user-A PUT /api/preferences failed: ${putRes.status()} ${await putRes.text()}`,
    ).toBe(true);

    // Sanity check: A reading their own row sees the sentinel.
    const getResA = await page.request.get("/api/preferences");
    expect(getResA.ok()).toBe(true);
    const aBody = await getResA.json();
    expect(
      aBody?.preferences?.excluded_exchanges,
      "user-A's prefs row did not persist excluded_exchanges=['bybit'] — " +
        "seed mutation failed; rest of the isolation contract is unverifiable",
    ).toEqual(["bybit"]);

    // ---- Step 2: sign out, sign in as user B in the same browser. ----
    await signOut(page);
    await loginAs(page, userBEmail, userBPassword);

    // ---- Step 3: GET /api/preferences as user B. Must NOT see A's ----
    // ---- sentinel. The route derives identity from the session       ----
    // ---- cookie (src/app/api/preferences/route.ts:14), so a positive ----
    // ---- match here means the cookie boundary collapsed (session    ----
    // ---- mix-up, shared-cache leak, etc.). page.request inherits    ----
    // ---- the browser context cookies so the GET rides B's session. ----
    const getResB = await page.request.get("/api/preferences");
    expect(getResB.ok()).toBe(true);
    const bBody = await getResB.json();
    // B's preferences row may not exist yet (null) OR may be empty/[] —
    // both satisfy the contract. What's forbidden is seeing A's sentinel.
    const bExcluded = bBody?.preferences?.excluded_exchanges ?? null;
    expect(
      bExcluded,
      "user-B's GET /api/preferences returned user-A's " +
        "excluded_exchanges=['bybit'] sentinel — SESSION/RLS LEAK on " +
        "allocator_preferences (migration 057 self_read policy or the " +
        "src/app/api/preferences/route.ts:33 user.id derivation)",
    ).not.toEqual(["bybit"]);

    // Belt-and-braces: the `user_id` in B's response (if any) must be B's
    // own uid, never A's.
    if (bBody?.preferences?.user_id) {
      expect(
        bBody.preferences.user_id,
        "user-B's GET /api/preferences returned a row owned by user-A",
      ).toBe(userBId);
      expect(bBody.preferences.user_id).not.toBe(userAId);
    }

    // ---- Step 4: direct PostgREST RLS proof (no client-side filter). ----
    // Sign in as user B against Supabase auth, then issue a BARE
    // `SELECT user_id, excluded_exchanges FROM allocator_preferences`. The
    // ONLY thing that can scope this query to "B's rows only" is the
    // migration 057 RLS policy `allocator_prefs_self_read USING
    // (user_id = auth.uid())`. If the policy regresses, A's seeded row
    // will surface here even though the API layer above is intact.
    //
    // Mirrors discovery-watchlist.spec.ts:368-399 (the canonical RLS-leak
    // detector pattern).
    const anonKey = process.env.TEST_SUPABASE_ANON_KEY;
    test.skip(
      !anonKey,
      "TEST_SUPABASE_ANON_KEY not wired — direct PostgREST RLS proof " +
        "skipped (API-level isolation step above still ran). Set the env " +
        "var to enable the bare-SELECT RLS proof.",
    );
    const url = process.env.TEST_SUPABASE_URL!;
    const userBClient = createClient(url, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: signInErr } = await userBClient.auth.signInWithPassword({
      email: userBEmail,
      password: userBPassword,
    });
    expect(
      signInErr,
      `user-B signInWithPassword failed: ${signInErr?.message}`,
    ).toBeNull();
    const { data: leakRows, error: leakErr } = await userBClient
      .from("allocator_preferences")
      .select("user_id, excluded_exchanges");
    expect(
      leakErr,
      `user-B SELECT allocator_preferences failed: ${leakErr?.message}`,
    ).toBeNull();
    const aRowsVisibleToB = (leakRows ?? []).filter(
      (r) => r.user_id === userAId,
    );
    expect(
      aRowsVisibleToB,
      `user-B's session sees ${aRowsVisibleToB.length} of user-A's ` +
        `allocator_preferences rows — RLS LEAK on migration 057 ` +
        `allocator_prefs_self_read policy`,
    ).toHaveLength(0);
  });
});
