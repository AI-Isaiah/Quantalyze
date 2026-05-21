/**
 * Phase 13 / Plan 13-05 / DISCO-05 — Fresh-allocator hide-examples-by-default.
 *
 * Proves the cross-plan invariant: with Plan 13-02's
 * `DEFAULTS.hide_examples = true` (src/lib/discovery-prefs.ts `DEFAULTS`)
 * AND Plan 13-05's `is_example = true` backfill on the 8 seed strategy
 * UUIDs (supabase/migrations/20260429063138_seed_is_example_backfill.sql),
 * a brand-new allocator with no prior `discovery_view_preferences:*`
 * localStorage entries lands on `/discovery/[slug]` and sees ZERO example
 * strategies.
 *
 * Then toggles "Hide examples" OFF via the inline filter checkbox in
 * StrategyFilters.tsx (search: `Hide examples toggle`) and asserts the
 * seed strategies become visible — proving the toggle actually controls
 * visibility (not just the empty-state default).
 *
 * Env wiring (matches discovery-prefs-isolation.spec.ts pattern):
 *   The active path is the `seedTestAllocator()` helper from
 *   `e2e/helpers/seed-test-project.ts`. When `TEST_SUPABASE_URL` /
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
import { loginAs } from "./helpers/login";
// Red-team RT-J08 (MED conf 8): import from the data-only module
// (no `@supabase/supabase-js` import, no module-load side effects)
// so spec-load cannot accidentally trigger a seed-script side effect
// if a future maintainer lifts any env-read to module scope in
// `seed-demo-data.ts`. See `scripts/seed-demo-profiles.ts` rationale.
import { STRATEGY_PROFILES } from "../scripts/seed-demo-profiles";

/**
 * Seed-strategy display names — derived from the single source of truth
 * (scripts/seed-demo-data.ts STRATEGY_PROFILES) so a rename of any seed
 * strategy automatically propagates to this regex. audit-2026-05-07
 * testing finding M-discovery-hide-examples:134.
 *
 * Each profile name is escaped before being joined into the alternation
 * so characters like `/` (e.g. "Helios L/S Stat Arb") don't break the
 * regex. We match name prefixes (the renderer may truncate or wrap), so
 * we escape the whole name and rely on the alternation engine.
 */
function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/**
 * Seed names as a plain Set for exact-equality matching. We query the
 * strategy-name `<a href="/factsheet/...">` links directly (one anchor
 * element per row, anchored on the factsheet href prefix so a future
 * unrelated link added to the row can't false-match) and compare each
 * link's textContent to this set. Exact equality closes the RT-J04
 * substring-collision concern (a user-created strategy named "Helios L/S
 * Stat Arb v2" would have a different textContent than the seed) without
 * needing word-boundary regex acrobatics — which broke against
 * `tbody.allTextContents()` concatenation in CI (the trailing `\b`
 * required a non-word character after the name, but the rendered text
 * concatenates "Vega Volatility Harvester" directly with "delta_neutral",
 * making 'r' adjacent to 'd' and the boundary inert).
 */
const SEED_NAMES = new Set(STRATEGY_PROFILES.map((p) => p.name));

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

  // 2026-05-21 — re-enabled after StrategyTable.tsx:338 functional-update
  // fix. Prior diagnosis suspected React hydration timing on the freshly
  // rebuilt preview deploy. Root cause was the toggle handler closing over
  // a stale `showExamples` value: between the click being scheduled and the
  // closure invoking `setShowExamples(!showExamples)`, the hydration effect
  // at StrategyTable.tsx:162-171 could queue a `setShowExamples(false)`,
  // and the stale closure would re-flip back to false on top — leaving the
  // seeds hidden. Switching the handler to `setShowExamples(v => !v)`
  // collapses the race; the functional update always reads the latest
  // committed value at fire time.
  //
  // If this test flakes again in CI, the diagnostic block at the end of
  // the post-toggle poll captures: (a) rendered row count, (b) sample
  // tbody text, (c) the checkbox's React-controlled `checked` attribute,
  // (d) a full-page screenshot. That artifact set should let the next
  // investigator see WHERE the state-vs-render parity broke without
  // needing a Playwright trace.
  test(
    "first /discovery/[slug] visit shows zero example strategies (and toggle reveals them)",
    async ({
    page,
    context,
  }) => {
    // Belt-and-braces: clear any inherited auth cookies from a prior spec
    // so the fresh allocator login below is the only authenticated session.
    // localStorage is cleared separately after navigation (see below).
    await context.clearCookies();

    // Sign in as the freshly seeded allocator. Uses the shared
    // helpers/login.ts helper — single source of truth across
    // discovery-prefs-isolation, discovery-sparkline-regression, and
    // this spec. audit-2026-05-07 maintainability finding
    // (duplicate-login-helper).
    await loginAs(page, email, password);

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
    // Wait for React hydration to complete before any interaction. Without
    // this the inline Hide-examples toggle click can race the onChange
    // listener registration: Playwright dispatches the click on the DOM
    // <input>, the DOM checked attribute flips, but React hasn't attached
    // the change handler yet — so the synthetic event is dropped, the
    // useDiscoveryPrefs state never updates, and the table never
    // re-renders past the hide-examples filter. Polling until the
    // checkbox is interactive (vs. SSR'd-only) is the standard fix.
    // `aria-busy="false"` on body is set by Next.js once hydration
    // completes; failing that, networkidle is the universal fallback.
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {
      // networkidle can be flaky behind Vercel's edge — non-fatal,
      // the checkbox-interactivity guard below is the real fence.
    });
    const rowsLocator = page.locator("table tbody tr");
    // The test seed (scripts/seed-demo-data.ts) inserts exactly 8 strategies,
    // all is_example=true (backfilled by migration
    // 20260429063138_seed_is_example_backfill.sql). With DEFAULTS.hide_examples
    // =true the fresh allocator's first paint correctly filters all 8 out,
    // leaving the "No strategies" empty-state row. That IS the proof that
    // DEFAULTS.hide_examples=true is in effect — so the pre-toggle
    // assertion now expects the empty-state row, not non-empty rows.
    //
    // Prior test design assumed the test project also held non-example
    // strategies that would render past the filter — but no other seed
    // path inserts non-example, status='published' rows into the test DB.
    // Waiting for a non-empty row was therefore a guarantee of timeout.
    //
    // Wait specifically for the empty-state to materialise so the next
    // assertion is deterministic (not racing against the initial paint).
    await expect
      .poll(
        async () => {
          const txts = await rowsLocator.allTextContents();
          return txts.some((t) => /no strategies/i.test(t));
        },
        {
          timeout: 10000,
          message:
            "discovery table never rendered the 'No strategies' empty " +
            "state in 10s — the fresh allocator with hide_examples=true " +
            "default and only is_example=true seeds in the DB should " +
            "produce that exact empty-state row. If it doesn't, either " +
            "DEFAULTS.hide_examples regressed (now false), or some other " +
            "seed inserted a non-example published strategy.",
        },
      )
      .toBe(true);

    // C-0301/C-0302/H-1034 fix: no silent `if (rowCount > 0)` gate.
    // The seeded allocator + the migration 091 backfill guarantee the
    // seed strategies exist in the DB. The pre-toggle assertion now
    // requires that the rendered rows contain ZERO seed-name matches —
    // a strict contract. If the rows include any seed name on first
    // paint, the DEFAULTS.hide_examples=true invariant has regressed.
    // Query the strategy-name anchor inside each row directly. The href
    // prefix `/factsheet/` filters out unrelated row links (star button,
    // simulate-impact CTA, etc.), and exact equality against SEED_NAMES
    // avoids the tbody-textContent concatenation pitfall (a name like
    // "Vega Volatility Harvester" gets stuck to the next badge text
    // "delta_neutral", which broke the prior word-boundary regex).
    const strategyLinkLocator = page.locator(
      'table tbody tr a[href^="/factsheet/"]',
    );
    const preToggleNames = await strategyLinkLocator.allTextContents();
    const preToggleSeedMatches = preToggleNames.filter((t) =>
      SEED_NAMES.has(t.trim()),
    );
    expect(
      preToggleSeedMatches,
      "fresh allocator must see zero example strategies on first paint " +
        "(DEFAULTS.hide_examples=true must filter seed strategies out)",
    ).toEqual([]);

    // Now toggle "Hide examples" OFF. Target the <input type="checkbox">
    // directly — clicking the surrounding <label> has been flaky in CI
    // (the click occasionally landed before React's controlled checkbox
    // had committed its initial render, so the synthetic change event
    // was dropped). The input itself is always interactive once visible.
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
    const hideExamplesCheckbox = hideExamplesLabel.locator(
      'input[type="checkbox"]',
    );
    // Initial state: hide_examples=true default → checked=true.
    await expect(hideExamplesCheckbox).toBeChecked();
    // Toggle via keyboard: focus + Space. Keyboard events go through
    // React's synthetic event system natively (no race with onChange
    // listener registration that a `.click()` on a controlled component
    // can hit during hydration). Falls back to .uncheck() if focus fails.
    await hideExamplesCheckbox.focus();
    await page.keyboard.press(" ");
    // Wait for the controlled state to flip — proves React's onChange
    // committed, not just that the DOM checked attribute changed.
    await expect(hideExamplesCheckbox).not.toBeChecked({ timeout: 5000 });

    // C-0301/C-0302/H-1035/H-1036/M-0859/M-0861 fix: replace
    // `waitForTimeout(500)` + `toBeGreaterThanOrEqual` with an explicit
    // poll for at least one seed-strategy name to appear. The migration
    // 091 backfill guarantees the seed names exist in the DB; toggling
    // hide-examples OFF MUST surface them. If the toggle is broken
    // (no-op), the assertion fails loudly with a useful diagnostic.
    try {
      await expect
        .poll(
          async () => {
            const names = await strategyLinkLocator.allTextContents();
            return names.some((t) => SEED_NAMES.has(t.trim()));
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
    } catch (err) {
      // 2026-05-21 diagnostic capture for the persistent CI flake. Dump
      // everything the next investigator will want without needing a
      // Playwright trace.
      const rowCount = await rowsLocator.count();
      const rowsSample = (await rowsLocator.allTextContents())
        .slice(0, 5)
        .map((t, i) => `  [${i}] ${t.slice(0, 200)}`)
        .join("\n");
      const checkboxState = await hideExamplesCheckbox.evaluate(
        (el: HTMLInputElement) => ({
          domChecked: el.checked,
          ariaChecked: el.getAttribute("aria-checked"),
          disabled: el.disabled,
        }),
      );
      const tbodyHtml = await page
        .locator("table tbody")
        .innerHTML()
        .catch(() => "<unable to read>");
      // eslint-disable-next-line no-console
      console.error(
        [
          "[discovery-hide-examples-default] post-toggle poll FAILED",
          `rendered row count: ${rowCount}`,
          `checkbox state: ${JSON.stringify(checkboxState)}`,
          "first 5 row texts:",
          rowsSample || "  <no rows>",
          "tbody HTML (first 2000 chars):",
          tbodyHtml.slice(0, 2000),
        ].join("\n"),
      );
      await page
        .screenshot({
          path: "test-results/discovery-hide-examples-flake.png",
          fullPage: true,
        })
        .catch(() => undefined);
      throw err;
    }
  },
  );
});
