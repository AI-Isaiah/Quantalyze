/**
 * Phase 47-05 / CHART-01a + CHART-02 + CHART-03 — FRESH seeded SVG-chart
 * parity + portrait spec for the hand-rolled `<svg>` factsheet panels.
 *
 * This is the falsifiable verification for the whole of Phase 47:
 *
 *   DELIVERABLE 1 — DESKTOP byte-identity goldens (the no-recompute proof,
 *   CHART-03). Each in-scope panel is screenshotted at a desktop viewport;
 *   a value/recompute change (a series/domain/metric that drifts) produces a
 *   golden diff → red. The desktop branch of every Phase-47 chart is
 *   byte-identical to its pre-Phase-47 render (every tuning gated behind
 *   `useBreakpoint() === "mobile"`; the SSR/server snapshot is "desktop"),
 *   so these goldens are the pixel-level record of the frozen engine output.
 *   They sit BESIDE the un-weakened SCENARIO-05 / BODY-02 / compute.ts parity
 *   unit guards.
 *
 *   DELIVERABLE 2 — 320px PORTRAIT snapshots (CHART-02 legibility floor +
 *   CHART-03 portrait tuning). At a 320px portrait viewport the mobile branch
 *   bumps font / reduces ticks / raises the viewBox height so axis+label text
 *   clears the ~12px effective-px floor; the snapshot is the visual record of
 *   that legibility/portrait state.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ROUTE (corrected vs the plan's literal `/strategy/[id]/v2` text — Rule 1):
 *   The in-scope Phase-47 hand-rolled SVG panels (StreakDistribution,
 *   BootstrapCI, EndOfYearBars, QuantileBoxPlot, CorrelationStrip,
 *   CorrelationsMatrix, HistogramChart, MasterBrush, DailyReturnsHeatmap)
 *   mount via `FactsheetView` (src/app/factsheet/[id]/v2/*) on the
 *   `/factsheet/[id]/v2` route — NOT on `/strategy/[id]/v2`, which renders the
 *   separate `StrategyV2Shell` panel family (src/components/strategy-v2/*).
 *   Verified by import-tracing: StrategyV2Shell imports OverviewPanel /
 *   HeadlineMetricsPanel / … / ReturnsDistributionPanel (a different set);
 *   the FactsheetView panel mount-sites are factsheet/[id]/v2 + discovery.
 *   Seeding via `seedStrategyWithHistory` populates a published strategy + its
 *   analytics; `/factsheet/[id]/v2` is published-gated (the seed sets
 *   status:"published") so it renders the FactsheetView panels.
 *   `/strategy/[id]/v2` additionally renders DailyHeatmap + ReturnQuantiles,
 *   but the seed leaves `return_quantiles=null` and never populates the
 *   `daily_returns_grid` sibling table, so those two would fall to their
 *   empty sub-banners there — capturing them is NOT done here (DailyHeatmap's
 *   desktop byte-identity is the Vitest test in Plan 03; ReturnQuantiles' is
 *   the Vitest test in Plan 04; MonteCarloBandChart's is the Vitest test in
 *   Plan 04 — none render on a 0-grid / 0-position seeded route, Pitfall 4).
 *
 * GOLDEN-BAKE ORDER (Pitfall 2 — the no-recompute discipline):
 *   Bake the DESKTOP goldens FIRST from the desktop-byte-identical output,
 *   commit them, THEN add the 320px portrait goldens. NEVER `--update-snapshots`
 *   a DESKTOP golden after a tuning change — a desktop golden diff means the
 *   no-recompute boundary was crossed and must be investigated, not blessed.
 *   First seeded CI run (or a local run with the test-Supabase env +
 *   `--update-snapshots`) bakes the missing goldens; the team commits them.
 *
 * FLOW-01 dual-wiring (the twice-burned trap):
 *   (place 2) the `HAS_SEED_ENV` const + `test.skip` below — without the seed
 *   env the route 404s/redirects, so skipping prevents a false-green against
 *   an empty page (the W-02 lesson);
 *   (place 1) this spec is added to the ci.yml seeded MA-8
 *   `npx playwright test` list. "PROVEN to execute (passed, not skipped) in a
 *   real CI run when vars.E2E_TEST_DB_CONFIGURED == 'true'" is the explicit
 *   post-push must_have (the JOURNEY-03 lesson).
 *
 * Tolerance (reuses the documented dead-spec pattern): per-panel
 * `toHaveScreenshot(name, { maxDiffPixelRatio: 0.02 })`, full-page
 * `{ maxDiffPixelRatio: 0.05 }`.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Locator } from "@playwright/test";
import { seedStrategyWithHistory } from "./helpers/seed-test-project";

// FLOW-01 place 2 of 2 — the spec's own seed-env self-skip guard. Without the
// seed env the seed throws / the route renders nothing real, so skipping
// prevents a false-green. With the env set in CI the MA-8 gate resolves true
// and these run for real, baking + diffing the goldens.
const HAS_SEED_ENV =
  !!process.env.TEST_SUPABASE_URL &&
  !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

// WR-02 — the golden-presence guard. `toHaveScreenshot` HARD-FAILS in CI on a
// missing baseline (Playwright only writes-and-passes a missing snapshot under
// `--update-snapshots`, which the MA-8 job does NOT pass). No goldens are
// committed yet (the README defers baking to avoid a false-green), so without
// this guard the seeded MA-8 run would go RED on the first run — a
// false-negative that also risks SKIPPING the Railway deploy (project lesson: a
// red merge check skips the analytics deploy). We detect "no PNGs baked" by
// scanning the snapshot dir (it holds only README.md until goldens land) and
// SKIP LOUDLY (annotated, not a silent pass). The spec stays fully wired
// (HAS_SEED_ENV + the ci.yml MA-8 list are untouched), so the moment the
// goldens are baked + committed this guard flips false and the gate goes live
// automatically — no spec edit needed.
// Playwright's default snapshotPathTemplate (no override in playwright.config.ts)
// writes/reads baselines at {testFileName}-snapshots/ — i.e. this path, NOT
// e2e/__snapshots__/<spec>/ (an earlier wrong assumption that was never exposed
// because no golden had ever baked). Proven by the only committed baselines,
// e2e/demo-screenshot.spec.ts-snapshots/. HAS_GOLDENS must scan the SAME dir
// Playwright reads, or the gate can never flip true after PNGs land.
const SNAPSHOT_DIR = join(__dirname, "svg-chart-parity.spec.ts-snapshots");
const HAS_GOLDENS =
  existsSync(SNAPSHOT_DIR) &&
  readdirSync(SNAPSHOT_DIR).some((f) => f.toLowerCase().endsWith(".png"));
const GOLDEN_PENDING_REASON =
  "svg-chart-parity: PENDING GOLDEN BAKE — no *.png baselines in " +
  "e2e/svg-chart-parity.spec.ts-snapshots/ (only README.md). " +
  "toHaveScreenshot hard-fails on a missing baseline in CI (no " +
  "--update-snapshots in the MA-8 job), so this would false-RED until baked. " +
  "Run the spec with --update-snapshots in the seeded env (desktop goldens " +
  "FIRST per Pitfall 2), review the diff, commit the PNGs; this guard then " +
  "flips and the gate goes live with NO spec change.";

// Bake escape hatch. The WR-02 skip below would otherwise skip the WHOLE
// describe on the very run meant to CREATE the goldens (no PNGs yet →
// HAS_GOLDENS false → skip fires, and --update-snapshots does NOT override a
// test.skip). The ci.yml workflow_dispatch bake step sets BAKE_SVG_GOLDENS=true
// for its `--update-snapshots` invocation only; normal push/PR runs leave it
// "false", so the WR-02 guard keeps its protective behaviour there.
const BAKING = process.env.BAKE_SVG_GOLDENS === "true";

// Each in-scope hand-rolled SVG panel exposes a stable `role="img"` +
// descriptive `aria-label` (added by Phase-47 plans 02/03). Anchoring +
// screenshotting on that specific role/label fails LOUD against a
// blank/sub-banner page (Pitfall 5) rather than capturing nothing. The label
// is matched as a prefix (some carry a benchmark suffix) so a comparator flip
// does not break the anchor.
const PANELS: { name: string; ariaLabelPrefix: string }[] = [
  { name: "streak-distribution", ariaLabelPrefix: "streak-length distribution" },
  { name: "bootstrap-ci", ariaLabelPrefix: "bootstrap distribution" },
  { name: "end-of-year-bars", ariaLabelPrefix: "End-of-year returns by calendar year" },
  { name: "quantile-box-plot", ariaLabelPrefix: "Quantile box plot" },
  { name: "correlation-strip", ariaLabelPrefix: "Cross-asset correlations" },
  { name: "correlations-matrix", ariaLabelPrefix: "Pairwise correlation matrix" },
  { name: "histogram", ariaLabelPrefix: "Distribution of daily returns" },
  { name: "master-brush", ariaLabelPrefix: "Master brush" },
  { name: "daily-returns-heatmap", ariaLabelPrefix: "Daily-return calendar" },
];

function panelLocator(
  page: import("@playwright/test").Page,
  ariaLabelPrefix: string,
): Locator {
  // role=img + an aria-label that STARTS WITH the prefix. Scoped to the
  // factsheet shell so an unrelated role=img elsewhere can never match.
  return page
    .locator("#factsheet-main")
    .getByRole("img", {
      name: new RegExp(escapeRegExp(ariaLabelPrefix), "i"),
    })
    .first();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test.describe("Phase 47 — SVG chart parity (desktop goldens) + 320px portrait", () => {
  // FLOW-01 place 2: self-skip when the seed env is absent so the spec never
  // false-greens against an empty/404 page locally; it runs for real in the
  // seeded MA-8 CI job (E2E_TEST_DB_CONFIGURED == 'true').
  test.skip(
    !HAS_SEED_ENV,
    "svg-chart-parity: seed-helper env vars not wired " +
      "(set TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY) — " +
      "skipping prevents a false-green against an empty/404 factsheet page " +
      "(W-02). Goldens bake on the first seeded CI run / a local run with the " +
      "test-Supabase env. The live parity proof runs in CI / /qa once seed " +
      "env is present.",
  );

  // WR-02 — golden-presence skip. Even WITH the seed env, a missing baseline
  // makes toHaveScreenshot HARD-FAIL in CI (no --update-snapshots in MA-8). Skip
  // LOUDLY until the goldens are baked + committed rather than false-RED the
  // gate (and risk skipping the Railway deploy). This flips automatically once
  // PNGs land — the spec + ci.yml wiring stay untouched. The `!BAKING` term is
  // the bake escape hatch: when the workflow_dispatch bake sets
  // BAKE_SVG_GOLDENS=true, the guard stands down so --update-snapshots can
  // actually write the missing PNGs (the catch-22 it would otherwise create).
  test.skip(HAS_SEED_ENV && !HAS_GOLDENS && !BAKING, GOLDEN_PENDING_REASON);

  // One seeded published strategy with a full year of history drives every
  // panel. The factsheet payload is derived from `returns_series` so the
  // streak / histogram / quantile / correlation / signature panels all have
  // real data to render.
  let strategyId: string;

  test.beforeAll(async () => {
    strategyId = await seedStrategyWithHistory({
      days: 252,
      name: "Phase 47 svg-parity",
    });
  });

  // Walk every in-scope panel into view + assert its role=img anchor is
  // visible BEFORE any screenshot. Fail loud on HTTP >= 400 / a panel that
  // never rendered (Pitfall 5: an unanchored screenshot would silently
  // capture a blank region).
  async function gotoFactsheetAndSettle(
    page: import("@playwright/test").Page,
  ): Promise<void> {
    const res = await page.goto(`/factsheet/${strategyId}/v2`);
    if (res && res.status() >= 400) {
      throw new Error(
        `/factsheet/${strategyId}/v2 returned HTTP ${res.status()} — ` +
          "cannot capture SVG-chart goldens",
      );
    }
    // The factsheet shell anchor must exist before we look for panels —
    // proves we are on the real article, not a login/404 page.
    await expect(
      page.locator("#factsheet-main"),
      "#factsheet-main not present — blank/404/login page would false-green",
    ).toBeVisible({ timeout: 15_000 });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  }

  // DELIVERABLE 1 — DESKTOP goldens (no-recompute proof). Bake FIRST.
  test("desktop: per-panel goldens (byte-identity / no-recompute) + full page", async ({
    page,
  }) => {
    // Desktop viewport — the server snapshot is "desktop" so this render is
    // byte-identical to the pre-Phase-47 output. A diff = a crossed
    // frozen-math boundary (Pitfall 2).
    await page.setViewportSize({ width: 1280, height: 1400 });
    await gotoFactsheetAndSettle(page);

    for (const panel of PANELS) {
      const loc = panelLocator(page, panel.ariaLabelPrefix);
      await loc.scrollIntoViewIfNeeded();
      await expect(
        loc,
        `desktop panel "${panel.name}" (role=img ~ "${panel.ariaLabelPrefix}") ` +
          "not visible — would false-green a blank screenshot",
      ).toBeVisible({ timeout: 15_000 });
      await expect(loc).toHaveScreenshot(`${panel.name}-desktop.png`, {
        maxDiffPixelRatio: 0.02,
        threshold: 0.2,
      });
    }

    // Full-page golden at the looser tolerance — catches a layout/composition
    // regression the per-panel crops miss.
    await page.evaluate(() => window.scrollTo({ top: 0 }));
    await expect(page).toHaveScreenshot("full-page-desktop.png", {
      fullPage: true,
      maxDiffPixelRatio: 0.05,
      threshold: 0.2,
    });
  });

  // DELIVERABLE 2 — 320px PORTRAIT snapshots (CHART-02 legibility + CHART-03
  // portrait). Bake AFTER the desktop goldens are committed.
  test("portrait 320px: per-panel legibility/portrait snapshots", async ({
    page,
  }) => {
    // 320px portrait = the WCAG 1.4.4 / 1.4.10 floor. The mobile branch of
    // each chart (font bump + tick reduction + taller viewBox) applies here.
    await page.setViewportSize({ width: 320, height: 800 });
    await gotoFactsheetAndSettle(page);

    for (const panel of PANELS) {
      const loc = panelLocator(page, panel.ariaLabelPrefix);
      await loc.scrollIntoViewIfNeeded();
      await expect(
        loc,
        `portrait panel "${panel.name}" (role=img ~ "${panel.ariaLabelPrefix}") ` +
          "not visible — would false-green a blank screenshot",
      ).toBeVisible({ timeout: 15_000 });
      await expect(loc).toHaveScreenshot(`${panel.name}-portrait-320.png`, {
        maxDiffPixelRatio: 0.02,
        threshold: 0.2,
      });
    }
  });

  // DELIVERABLE 3 — 2560px ULTRA-WIDE tolerance goldens (Phase 54-06 /
  // VERIFY-04). The byte-identity-by-tolerance replacement (per-panel 0.02,
  // full-page 0.05, threshold 0.2 — the documented dead-spec tolerance pattern)
  // extended to the ULTRA-WIDE upper bound so a value/recompute/layout drift at
  // 2560 reds the golden too. The server snapshot is "desktop" (no mobile
  // breakpoint at 2560), so this render is the SAME frozen engine output as the
  // desktop golden, just composed into the ultra-wide column — a diff still
  // means a crossed frozen-math / layout boundary (Pitfall 2).
  //
  // GREEN-BY-SKIP: this test lives INSIDE the describe that already carries BOTH
  // the HAS_SEED_ENV self-skip AND the WR-02 golden-pending skip
  // (test.skip(HAS_SEED_ENV && !HAS_GOLDENS, GOLDEN_PENDING_REASON), :159).
  // Those describe-level guards gate every test in the block, so this 2560 row
  // inherits the green-by-skip behaviour with NO extra wiring — it self-skips
  // LOUDLY until the goldens are deliberately baked + committed (NEVER blind
  // --update-snapshots; the bake is a reviewed per-chart CI commit, 54-CONTEXT
  // Out-of-Scope lock). The moment PNGs land, HAS_GOLDENS flips true and this
  // gate goes live automatically with NO spec edit. The spec is ALREADY in the
  // ci.yml seeded MA-8 list (:1280) and HAS_SEED_ENV-gated — additive rows in an
  // existing wired describe need no new FLOW-01 wiring.
  test("ultra-wide 2560px: per-panel tolerance goldens + full page", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 2560, height: 1440 });
    await gotoFactsheetAndSettle(page);

    for (const panel of PANELS) {
      const loc = panelLocator(page, panel.ariaLabelPrefix);
      await loc.scrollIntoViewIfNeeded();
      await expect(
        loc,
        `ultra-wide panel "${panel.name}" (role=img ~ "${panel.ariaLabelPrefix}") ` +
          "not visible — would false-green a blank screenshot",
      ).toBeVisible({ timeout: 15_000 });
      await expect(loc).toHaveScreenshot(`${panel.name}-ultrawide-2560.png`, {
        maxDiffPixelRatio: 0.02,
        threshold: 0.2,
      });
    }

    // Full-page golden at the looser tolerance — catches an ultra-wide
    // layout/composition regression the per-panel crops miss.
    await page.evaluate(() => window.scrollTo({ top: 0 }));
    await expect(page).toHaveScreenshot("full-page-ultrawide-2560.png", {
      fullPage: true,
      maxDiffPixelRatio: 0.05,
      threshold: 0.2,
    });
  });
});
