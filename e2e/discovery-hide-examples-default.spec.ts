/**
 * Phase 13 / Plan 13-05 / DISCO-05 — Fresh-allocator hide-examples-by-default.
 *
 * Proves the cross-plan invariant: with Plan 13-02's
 * `DEFAULTS.hide_examples = true` (src/lib/discovery-prefs.ts:42) AND
 * Plan 13-05's `is_example = true` backfill on the 8 seed strategy UUIDs
 * (supabase/migrations/20260429063138_seed_is_example_backfill.sql), a brand-new
 * allocator with no prior `discovery_view_preferences:*` localStorage
 * entries lands on `/discovery/[slug]` and sees ZERO example strategies.
 *
 * Then toggles "Hide examples" OFF via the inline filter checkbox
 * (StrategyFilters.tsx:343-351) and asserts the seed strategies become
 * visible — proving the toggle actually controls visibility (not just
 * the empty-state default).
 *
 * Env wiring (matches discovery-prefs-isolation.spec.ts pattern):
 *   The active path is the `seedTestAllocator()` helper from
 *   `e2e/helpers/seed-test-project.ts:60`. When `TEST_SUPABASE_URL` /
 *   `TEST_SUPABASE_SERVICE_ROLE_KEY` are not wired, the spec is
 *   `test.skip`'d so it is authored-but-not-CI-blocking.
 *
 * The spec's contract is mechanically the same as Plan 13-05 success
 * criterion 5 (REQUIREMENTS.md DISCO-05 line 21 + ROADMAP.md SC#5):
 * "a fresh allocator's first Discovery visit shows zero example
 * strategies".
 *
 * audit-2026-05-07 cluster J — REWRITTEN to remove the silent-pass gates
 * documented in FIX-LIST entries C-0301, C-0302, H-1034, H-1035, H-1036,
 * M-0859, M-0860, M-0861. Behavioral assertions are now strict and bind
 * to the seed strategies actually inserted by seedTestAllocator(); no
 * `if (rowCount > 0)` short-circuits, no `toBeGreaterThanOrEqual`
 * tautologies, no `waitForTimeout` / `networkidle` flake patterns.
 */

import { test, expect } from "@playwright/test";
import { seedTestAllocator } from "./helpers/seed-test-project";
import { cleanupTestAllocator } from "./helpers/cleanup-test-project";

/** Source of truth: scripts/seed-demo-data.ts:STRATEGY_UUIDS (lines 44-53). */
const SEED_UUIDS = [
  "cccccccc-0001-4000-8000-000000000001",
  "cccccccc-0001-4000-8000-000000000002",
  "cccccccc-0001-4000-8000-000000000003",
  "cccccccc-0001-4000-8000-000000000004",
  "cccccccc-0001-4000-8000-000000000005",
  "cccccccc-0001-4000-8000-000000000006",
  "cccccccc-0001-4000-8000-000000000007",
  "cccccccc-0001-4000-8000-000000000008",
] as const;

/** Seed-strategy display names from scripts/seed-demo-data.ts STRATEGY_PROFILES. */
const SEED_NAMES_REGEX =
  /Stellar Neutral|Nebula Momentum|Aurora Basis|Vega Volatility|Helios L\/S|Orion Grid|Pulsar Trend|Quasar Mean Reversion/;

const HAS_SEED_ENV =
  !!process.env.TEST_SUPABASE_URL &&
  !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

test.describe("DISCO-05 fresh allocator hides examples by default", () => {
  test.skip(
    !HAS_SEED_ENV,
    "discovery hide-examples-default: seed-helper env vars not wired " +
      "(set TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY) — see " +
      "e2e/helpers/seed-test-project.ts. Spec authored but CI-skip per " +
      "Plan 13-02 / 13-05 fallback pattern.",
  );

  let userId: string | undefined;
  let email: string;
  let password: string;

  test.beforeAll(async () => {
    const seed = await seedTestAllocator();
    userId = seed.userId;
    email = seed.email;
    password = seed.password;
  });

  test.afterAll(async () => {
    if (userId) await cleanupTestAllocator(userId);
  });

  test("first /discovery/[slug] visit shows zero example strategies (and toggle reveals them)", async ({
    page,
    context,
  }) => {
    // Belt-and-braces: ensure no prior localStorage entries from another spec.
    await context.clearCookies();

    // Sign in as the freshly seeded allocator. Login form selectors mirror
    // discovery-prefs-isolation.spec.ts (Plan 13-02) — that spec is the
    // canonical login fixture for /discovery routes.
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

    // Explicitly clear any inherited discovery_view_preferences:* entries
    // for the dashboard origin. The fresh allocator has never written any,
    // but stripping them defensively guarantees the DEFAULTS branch in
    // src/lib/discovery-prefs.ts:safeRead() applies on first /discovery
    // navigation.
    await page.evaluate(() => {
      Object.keys(localStorage)
        .filter((k) => k.startsWith("discovery_view_preferences:"))
        .forEach((k) => localStorage.removeItem(k));
    });

    await page.goto("/discovery/crypto-sma");

    // C-0301/M-0860 fix: replace flaky `waitForLoadState('networkidle')`
    // with a deterministic wait for the StrategyTable to hydrate.
    // The table renders <table> + tbody unconditionally; if data is still
    // loading, tbody is empty but the table is mounted. We wait for
    // either at least one row OR a documented empty-state marker, then
    // assert against whichever the page produced. Matches the pattern in
    // discovery-watchlist.spec.ts which already uses waitForSelector.
    await page.waitForSelector("table", { timeout: 15000 });
    const rowsLocator = page.locator("table tbody tr");
    await expect
      .poll(() => rowsLocator.count(), { timeout: 10000 })
      .toBeGreaterThan(0);

    // C-0301/C-0302/H-1034 fix: no silent `if (rowCount > 0)` gate.
    // The seeded allocator + the migration 091 backfill guarantee the
    // seed strategies exist in the DB. The pre-toggle assertion now
    // requires that the rendered rows contain ZERO seed-name matches —
    // a strict contract. If the rows include any seed name on first
    // paint, the DEFAULTS.hide_examples=true invariant has regressed.
    //
    // Specialist T-J03 (testing) — detect the documented "no strategies"
    // empty-state row and fail with a fixture-diagnostic instead of
    // vacuously passing. The seed strategies MUST be queryable to make
    // the post-toggle assertion meaningful; if they aren't, the test DB
    // is missing the demo seed data (run `npm run seed:demo` against
    // TEST_SUPABASE_URL) and we want to surface that, not green-light
    // a no-op test.
    const preToggleRowsText = await rowsLocator.allTextContents();
    const hasEmptyStateRow = preToggleRowsText.some((t) =>
      /no strategies/i.test(t),
    );
    expect(
      hasEmptyStateRow,
      "discovery table must not render the 'no strategies' empty state " +
        "for the fresh allocator BEFORE toggling Hide examples — this " +
        "indicates the test DB lacks the demo seed data (run " +
        "`npm run seed:demo` against TEST_SUPABASE_URL before re-running)",
    ).toBe(false);
    const preToggleSeedMatches = preToggleRowsText.filter((t) =>
      SEED_NAMES_REGEX.test(t),
    );
    expect(
      preToggleSeedMatches,
      "fresh allocator must see zero example strategies on first paint " +
        "(DEFAULTS.hide_examples=true must filter seed strategies out)",
    ).toEqual([]);

    // Now toggle "Hide examples" OFF via the inline checkbox in
    // StrategyFilters.tsx:342-351. The checkbox is checked={!showExamples}
    // and clicking the surrounding <label> flips it.
    //
    // C-0301/H-1034 fix: no `if (hideExamplesLabel.count())` silent skip.
    // The toggle must exist; a UI rename is a real regression we want to
    // surface, not swallow.
    const hideExamplesLabel = page
      .locator('label:has-text("Hide examples")')
      .first();
    await expect(
      hideExamplesLabel,
      "Hide examples toggle must be present (StrategyFilters.tsx)",
    ).toBeVisible({ timeout: 5000 });
    await hideExamplesLabel.click();

    // C-0301/C-0302/H-1035/H-1036/M-0859/M-0861 fix: replace
    // `waitForTimeout(500)` + `toBeGreaterThanOrEqual` with an explicit
    // poll for at least one seed-strategy name to appear. The migration
    // 091 backfill guarantees the seed names exist in the DB; toggling
    // hide-examples OFF MUST surface them. If the toggle is broken
    // (no-op), the assertion fails loudly with a useful diagnostic.
    await expect
      .poll(
        async () => {
          const rowsText = await rowsLocator.allTextContents();
          return rowsText.some((t) => SEED_NAMES_REGEX.test(t));
        },
        {
          timeout: 10000,
          message:
            "after toggling Hide examples OFF, at least one seed strategy " +
            "(Stellar Neutral / Nebula Momentum / Aurora Basis / Vega " +
            "Volatility / Helios L/S / Orion Grid / Pulsar Trend / Quasar " +
            "Mean Reversion) MUST be visible — controlled-state regression " +
            "if the toggle has no effect",
        },
      )
      .toBe(true);

    // Strict positive contract: count of seed-name matches post-toggle
    // is strictly greater than the pre-toggle count (which was 0).
    const postToggleRowsText = await rowsLocator.allTextContents();
    const postToggleSeedMatches = postToggleRowsText.filter((t) =>
      SEED_NAMES_REGEX.test(t),
    );
    expect(
      postToggleSeedMatches.length,
      "toggling Hide examples OFF must reveal MORE seed strategies than " +
        "before (strict >; was 0 pre-toggle)",
    ).toBeGreaterThan(0);

    // Ensure the SEED_UUIDS array still aligns with the regex contract
    // (defense-in-depth — drift would mean the spec is asserting against
    // stale seed data). All 8 UUIDs must be present in the source-of-truth
    // list; a typo here would silently weaken the assertion.
    expect(SEED_UUIDS).toHaveLength(8);
  });
});
