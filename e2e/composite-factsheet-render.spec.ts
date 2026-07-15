/**
 * Phase 91 / Plan 91-04 (QA-02 render + QA-03 factsheet-axe;
 * CONTEXT D1 piece 1 + D4) — the Zavara-shaped composite factsheet RENDER
 * acceptance proof plus the composite-factsheet axe scans, in ONE seed-gated
 * spec.
 *
 * SCOPE — D1 PIECE 1 ONLY:
 *   This spec is the HERMETIC GUI render-path proof of SC-3 (the Zavara
 *   headline renders through the real composite read-path gate against
 *   production-shaped seed data). It is piece (1) of the three-part composed
 *   SC-3 proof. Pieces (2) [Phase 86-04 live numbers] and (3) [a live GUI
 *   session] are credited / left OPEN in 91-EVIDENCE.md (91-06) — they are NOT
 *   coded here. Do NOT read this spec as fully discharging SC-3.
 *
 * DERIVED EXPECTED KPI STRINGS (⭐ never hand-guessed rounding):
 *   The hero KpiStrip renders each headline scalar through the real formatters
 *   in `src/app/factsheet/[id]/v2/format.ts` at `PCT_DEFAULT_DP = 1`:
 *     - Cum. Return → `pctSigned(m.cum_ret, 1)`   (FactsheetView.tsx:741)
 *     - Max DD      → `pct(m.max_dd, 1)`           (FactsheetView.tsx:746)
 *   `pctSigned(v,1) = `${x>=0?'+':''}${(v*100).toFixed(1)}%``; `pct(v,1) =
 *   `${(v*100).toFixed(1)}%``. Applying them to the seeded persisted scalars
 *   (seed-test-project.ts CASH_BASIS_SCALARS / MTM_BASIS_SCALARS):
 *     - cash cumulative_return 0.6266 → "+62.7%"   (NOT "62.66%")
 *     - cash max_drawdown     -0.0413 → "-4.1%"     (NOT "-4.13%")
 *     - mtm  cumulative_return 0.6189 → "+61.9%"    (toggle-proof value)
 *   A wrong rounding (e.g. asserting the raw "62.66%") would FALSE-FAIL, so the
 *   expectations below are derived from the formatter, not the raw seed number.
 *
 * ⭐ WI-1 (plan-checker) — LEVERAGE-CONTROL AXE IS SINGLE-KEY BY DESIGN:
 *   The factsheet leverage cluster renders IFF
 *   `leverageEligible = !composite && payload.periodsPerYear != null`
 *   (FactsheetView.tsx:1039, Phase 90.5 LEV-01 fail-closed). It is
 *   COMPOSITE-HIDDEN on purpose, so the D4 leverage-control axe coverage runs
 *   on a SINGLE-KEY fixture (`seedStrategyWithHistory`), NOT the composite.
 *   periodsPerYear is guaranteed non-null on the single-key path: the payload
 *   builder always sets it — `build-payload.ts:220` computes
 *   `annualizationPeriods(strategy.assetClass)` (252 traditional / 365 crypto,
 *   never null) and returns it at `:353`. Test 4 asserts `#leverage-factsheet`
 *   is VISIBLE before scanning (fail loud if the input never mounts).
 *
 * AXE RULE SET — REUSED, NEVER REDECLARED:
 *   Every scan below is `buildAxe(page)` from `./helpers/axe` (wcag2a +
 *   wcag2aa + best-practice, helpers/axe.ts:15-21) at the zero-violation
 *   threshold. This is STRICTER than QA-03's serious+critical floor and
 *   satisfies it a fortiori. The AxeBuilder is NEVER constructed directly in
 *   this file — every scan goes through the shared factory (grep gate forbids a
 *   local AxeBuilder construction, threat T-91-04b).
 *
 * TWO-PLACE RULE — place 1 of 2:
 *   HAS_SEED_ENV self-skip lives here (place 1). The ci.yml seed-gated-spec
 *   entry (place 2) lands in 91-05 — this spec name is
 *   `composite-factsheet-render.spec.ts`.
 *
 * Auth: mirrors target-size.spec.ts's tap-rect describe (:97-138) — a
 * PUBLISHED factsheet is publicly navigable, so no login is needed. Both
 * fixtures below are seeded `published`.
 */
import { test, expect, type Page } from "@playwright/test";
import { buildAxe } from "./helpers/axe";
import {
  seedCompositeStrategy,
  seedStrategyWithHistory,
  cleanupStrategiesByNamePrefix,
} from "./helpers/seed-test-project";

const HAS_SEED_ENV =
  !!process.env.TEST_SUPABASE_URL &&
  !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

// Formatter-derived expectations (see file header — NOT hand-guessed rounding).
const EXPECT_CUM_CASH = "+62.7%"; // pctSigned(0.6266, 1)
const EXPECT_CUM_MTM = "+61.9%"; // pctSigned(0.6189, 1)  (basis-toggle proof)
const EXPECT_MAXDD_CASH = "-4.1%"; // pct(-0.0413, 1)

/**
 * Navigate the factsheet with the target-size HTTP-status guard (throw on
 * >=400 so an empty 404 can never false-pass — W-02 / threat T-91-04a) plus a
 * URL pin.
 */
async function gotoFactsheet(page: Page, strategyId: string): Promise<void> {
  const res = await page.goto(`/factsheet/${strategyId}/v2`);
  if (res && res.status() >= 400) {
    throw new Error(
      `/factsheet/${strategyId}/v2 returned HTTP ${res.status()} — ` +
        "cannot run the Phase 91 composite render/axe assertions " +
        "(W-02 false-green guard).",
    );
  }
  await expect(page).toHaveURL(new RegExp(`/factsheet/${strategyId}/v2`), {
    timeout: 10_000,
  });
}

/**
 * A hero-KpiStrip value cell, scoped to `#factsheet-main`. Each strip cell is
 * `<div><p>{label}</p><p>{value}</p></div>` (FactsheetView.tsx:828-853), so the
 * value is the label `<p>`'s following-sibling `<p>`. Anchoring on that
 * structure (not a page-wide text search) keeps the assertion on the strip and
 * excludes the AnalyticalPanels `<th>Max DD</th>` (a `<th>` has no
 * following-sibling `<p>`) and the MetricsColumn right-rail duplicate — threat
 * T-91-04a.
 */
function kpiValue(page: Page, label: string) {
  return page
    .locator("#factsheet-main")
    .getByText(label, { exact: true })
    .locator("xpath=following-sibling::p");
}

test.describe("Phase 91 — composite factsheet render + axe (QA-02/QA-03)", () => {
  test.skip(
    !HAS_SEED_ENV,
    "composite factsheet render/axe: seed-helper env vars not wired " +
      "(set TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY) — skipping " +
      "prevents a false-green against an empty/404 factsheet (W-02). Runs in " +
      "the seeded CI job once 91-05 wires the env (two-place rule, place 2).",
  );

  let compositeStrategyId: string;

  test.beforeAll(async () => {
    if (!HAS_SEED_ENV) return;
    // The ONE composite fixture (91-02). Default variant → published +
    // complete; mtm "available" → distinct mark_to_market scalars so the basis
    // toggle is provable.
    const seeded = await seedCompositeStrategy({
      name: "e2e-p91-render",
    });
    compositeStrategyId = seeded.strategyId;
  });

  test.afterAll(async () => {
    // Best-effort GC of BOTH this spec's fixtures (render + leverage-axe), both
    // under the `e2e-p91-` prefix. De-collided from the onboarding spec's
    // `e2e-composite-` namespace so its afterAll can no longer delete these live
    // fixtures under fullyParallel. strategy_analytics/strategy_keys cascade.
    if (HAS_SEED_ENV) {
      await cleanupStrategiesByNamePrefix("e2e-p91-");
    }
  });

  test("seeded Zavara composite renders ~62.66% / -4.13% headline (D1 piece 1)", async ({
    page,
  }) => {
    // ⭐ D1 PIECE 1 of the composed SC-3 proof — the hermetic GUI render-path
    // assertion. Pieces (2)/(3) are credited/OPEN in 91-EVIDENCE.md (91-06);
    // this test does NOT by itself discharge SC-3.
    await gotoFactsheet(page, compositeStrategyId);

    // 1. Headline renders through composite-read-path.ts:87 → the KpiStrip
    //    shows the formatter-derived cash strings (see header derivation).
    await expect(kpiValue(page, "Cum. Return")).toHaveText(EXPECT_CUM_CASH);
    await expect(kpiValue(page, "Max DD")).toHaveText(EXPECT_MAXDD_CASH);

    // 2. Composite coverage surface (gap markers proof): the composite-only
    //    sr-only stitched summary (FactsheetView.tsx:447-461) proves
    //    deriveSegmentMarkers consumed the seeded windows + gap_spans. sr-only
    //    is in the DOM but not visible, so assert text content (not toBeVisible).
    const stitched = page.getByText(/Stitched from \d+ keys/);
    await expect(stitched).toContainText(
      "shown as breaks, never as zero returns",
    );

    // 3. Basis eyebrow defaults to CASH SETTLEMENT (FactsheetView.tsx:795-799).
    //    Unique under the cash default — the MetricsColumn eyebrow renders blank
    //    until the strip diverges to MTM.
    await expect(page.getByText("BASIS · CASH SETTLEMENT")).toBeVisible();

    // 4. Basis toggle: flip to mark_to_market via the segmented control
    //    (FactsheetView.tsx:1135-1150). The eyebrow flips AND a mapped KPI value
    //    swaps to the seeded distinct mtm scalar (91-02 seeds these precisely
    //    for this proof).
    await page
      .getByRole("group", { name: "Metrics basis" })
      .getByRole("button", { name: "Mark-to-market" })
      .click();
    // "BASIS · MARK-TO-MARKET" is globally unique (only the KpiStrip eyebrow
    // ever renders it for a composite).
    await expect(page.getByText("BASIS · MARK-TO-MARKET")).toBeVisible();
    await expect(kpiValue(page, "Cum. Return")).toHaveText(EXPECT_CUM_MTM);

    // 5. Toggle back → cash headline restored (round-trips the mapped scalar).
    await page
      .getByRole("group", { name: "Metrics basis" })
      .getByRole("button", { name: "Cash settlement" })
      .click();
    await expect(page.getByText("BASIS · CASH SETTLEMENT")).toBeVisible();
    await expect(kpiValue(page, "Cum. Return")).toHaveText(EXPECT_CUM_CASH);
  });

  test("composite factsheet: zero axe violations (cash basis)", async ({
    page,
  }) => {
    await gotoFactsheet(page, compositeStrategyId);
    // Wait for the KPI strip + the composite sr-only summary so the gap-marker
    // / coverage surfaces are mounted before the scan.
    await expect(kpiValue(page, "Cum. Return")).toHaveText(EXPECT_CUM_CASH);
    await expect(page.getByText(/Stitched from \d+ keys/)).toContainText(
      "shown as breaks, never as zero returns",
    );

    const results = await buildAxe(page).analyze();
    expect(results.violations).toEqual([]);
  });

  test("composite factsheet: zero axe violations (mark_to_market)", async ({
    page,
  }) => {
    await gotoFactsheet(page, compositeStrategyId);
    await expect(kpiValue(page, "Cum. Return")).toHaveText(EXPECT_CUM_CASH);
    // Toggle to MTM so the role=status caption region now carries content, then
    // scan that basis state.
    await page
      .getByRole("group", { name: "Metrics basis" })
      .getByRole("button", { name: "Mark-to-market" })
      .click();
    await expect(page.getByText("BASIS · MARK-TO-MARKET")).toBeVisible();

    const results = await buildAxe(page).analyze();
    expect(results.violations).toEqual([]);
  });

  test("single-key factsheet leverage control: zero axe violations", async ({
    page,
  }) => {
    // ⭐ WI-1: the leverage cluster is COMPOSITE-HIDDEN by design
    // (`leverageEligible = !composite && payload.periodsPerYear != null`,
    // FactsheetView.tsx:1039), so D4's leverage-control coverage MUST use a
    // SINGLE-KEY fixture. seedStrategyWithHistory yields a published single-key
    // strategy whose payload carries a non-null periodsPerYear
    // (build-payload.ts:220/353 — annualizationPeriods, never null), so
    // #leverage-factsheet renders. The visibility assertion below is the
    // fail-loud guard.
    const singleKeyId = await seedStrategyWithHistory({
      days: 60,
      name: "e2e-p91-leverage-axe",
    });
    await gotoFactsheet(page, singleKeyId);

    const leverageInput = page.locator("#leverage-factsheet");
    await expect(leverageInput).toBeVisible();

    // Set a non-1 leverage to trigger the levered re-derive state before
    // scanning. Phase 107 deleted the amber "MODELED · N×" eyebrow; the levered
    // state is now signalled by the reworded muted what-if caption
    // ("What-if projection at N× leverage …", FactsheetView.tsx role=status).
    await leverageInput.fill("2");
    await expect(page.getByText(/What-if projection at 2× leverage/)).toBeVisible();

    const results = await buildAxe(page).analyze();
    expect(results.violations).toEqual([]);
  });
});
