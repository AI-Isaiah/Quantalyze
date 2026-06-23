/**
 * Phase 33 Plan 01 / JOURNEY-01 — Bridge → composer seam regression test.
 *
 * PURPOSE (CLAUDE.md Rule 9 — test encodes WHY, not just WHAT):
 * The Bridge → composer continuity seam already ships and is structurally wired
 *   BridgeDrawer.onAddToScenario (composer-owned mount only)
 *     → scenario-state.addStrategyBridge (pure mutator)
 *       → computeMetricsForDraft (the SAME frozen-engine projection the composer
 *         renders in its `scenarioMetrics` useMemo)
 * What was MISSING (per the 33-PATTERNS.md gap analysis): no test drives the
 * *integrated* path CTA → mutator → PROJECTION MOVES. The existing T_USE6 hook
 * test (useScenarioState.test.tsx:217-236) asserts membership only
 * (`addedStrategies` contains the id), which is VACUOUS w.r.t. the projection:
 * a candidate could land in `addedStrategies` yet contribute nothing to the
 * curve, and that test would still pass. This file closes that gap.
 *
 * NON-VACUITY (the load-bearing gate — assertion (d) below):
 * The candidate carried in via `addStrategyBridge` must change a
 * projection-bearing value out of `computeMetricsForDraft`, not merely flip a
 * membership flag. We give the bridge candidate a DISTINCT return profile from
 * the live holdings, so blending it into the draft at its bridged weight
 * provably moves the blended-curve metrics.
 *
 * FALSIFIABILITY (proven once during execution — see the SUMMARY's red-run):
 * Neuter `addStrategyBridge` to a pass-through (`return draft`) and assertions
 * (a) membership, (b) exact bridged weight, and (d) projection delta all FAIL —
 * the no-op never adds the candidate, never writes its weightOverride, and the
 * recomputed projection is byte-identical to the baseline. A membership-only
 * assertion would NOT catch a seam that adds the row but drops it from the
 * curve; (d) is what makes this test fail when the seam is neutered.
 *
 * REACHABILITY HINGE (FLOW-01 shipped-but-dead lesson):
 * Only the composer-owned BridgeDrawer carries `onAddToScenario` — the
 * BridgeWidget drawers are structurally inert (they can Send-intro but cannot
 * seed the draft). We pin that hinge by reading the two source files from disk
 * and asserting the prop-occurrence counts (1 vs 0). If a future edit wires
 * `onAddToScenario` into a BridgeWidget BridgeDrawer mount OR drops it from the
 * composer, the count assertion fails loudly.
 *
 * ZERO production-code change: this file edits/creates a TEST only. The frozen
 * engine `src/lib/scenario.ts` stays zero-diff (SCENARIO-05 CI guard); the
 * mutator under test (`addStrategyBridge`) lives in `scenario-state.ts` (the
 * DRAFT module, NOT the frozen engine) and is not touched here.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DailyPoint } from "@/lib/scenario";
import {
  defaultDraftFromHoldings,
  addStrategyBridge,
  type ScenarioDraft,
  type AddedStrategy,
  type HoldingForDefault,
} from "@/app/(dashboard)/allocations/lib/scenario-state";
import {
  computeMetricsForDraft,
  type ScenarioCompareInputs,
} from "@/app/(dashboard)/allocations/lib/scenario-compare";

// ---------------------------------------------------------------------------
// Fixtures — mirror scenario-state.test.ts (HOLDINGS_2 / STRAT_B) and
// scenario-compare.test.ts (business-day windows + alternating-return series +
// the ScenarioCompareInputs shape the composer assembles).
// ---------------------------------------------------------------------------

const CWD = process.cwd();
const REF_BTC = "holding:binance:BTC:spot";
const REF_ETH = "holding:binance:ETH:spot";

/** Two-holding live book — identical to scenario-state.test.ts:47-50
 *  (BTC 0.6 / ETH 0.4 by value), so the T1.5 exact-weight assertions transfer. */
const HOLDINGS_2: HoldingForDefault[] = [
  { symbol: "BTC", venue: "binance", holding_type: "spot", value_usd: 60000 },
  { symbol: "ETH", venue: "binance", holding_type: "spot", value_usd: 40000 },
];

/** The Bridge candidate — same id/shape as scenario-state.test.ts:61-66
 *  (`uuid-2`). The cast acknowledges H5-brand minting at the test boundary. */
const STRAT_B: AddedStrategy = {
  id: "uuid-2" as AddedStrategy["id"],
  name: "Strat B",
  markets: ["binance"],
  strategy_types: ["mean_reversion"],
};

/** N sequential business-day ISO dates (skips weekends) — from
 *  scenario-compare.test.ts:39-51. */
function buildDates(startDate: string, n: number): string[] {
  const out: string[] = [];
  const d = new Date(startDate + "T00:00:00Z");
  let i = 0;
  while (out.length < n) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
    i++;
    if (i > n * 3) break;
  }
  return out;
}

/** Alternating up/down daily-return window so vol/Sharpe/Sortino are non-zero
 *  — from scenario-compare.test.ts:59-61. */
function altReturns(dates: string[], up: number, down: number): DailyPoint[] {
  return dates.map((date, i) => ({ date, value: i % 2 === 0 ? up : down }));
}

function sumEnabled(draft: ScenarioDraft): number {
  let s = 0;
  for (const [ref, on] of Object.entries(draft.toggleByScopeRef)) {
    if (on) s += draft.weightOverrides[ref] ?? 0;
  }
  return s;
}

/**
 * Assemble the live payload the composer holds, including a returns series for
 * the Bridge candidate (`uuid-2`). The candidate's series MUST clear the
 * adapter warm-up gate (>= 30 days) and carry a DISTINCT profile from the
 * holdings, so once `addStrategyBridge` gives it a non-zero bridged weight the
 * blended-curve projection provably differs from the holdings-only baseline.
 */
function buildLiveInputs(dates: string[]): ScenarioCompareInputs {
  const symbolByHoldingId = new Map<string, string>([
    [REF_BTC, "BTC"],
    [REF_ETH, "ETH"],
  ]);
  return {
    holdingsSummary: HOLDINGS_2.map((h) => ({
      symbol: h.symbol,
      venue: h.venue,
      holding_type: h.holding_type as "spot" | "derivative",
      value_usd: h.value_usd,
    })),
    holdingReturnsByScopeRef: {
      [REF_BTC]: altReturns(dates, 0.01, -0.008),
      [REF_ETH]: altReturns(dates, 0.012, -0.009),
    },
    // The Bridge candidate's series — distinct profile (larger swings, opposite
    // phase) so its contribution to the blend is unmistakable in the metrics.
    addedStrategyReturnsLookup: {
      [STRAT_B.id]: altReturns(dates, -0.015, 0.02),
    },
    addedStrategyMetadataLookup: {
      [STRAT_B.id]: { disclosure_tier: "public", cagr: null, sharpe: null },
    },
    symbolByHoldingId,
  };
}

describe("Bridge → composer seam (JOURNEY-01)", () => {
  it("carries the candidate into the draft AND MOVES the projection (non-vacuous)", () => {
    const dates = buildDates("2024-01-02", 80);
    const liveInputs = buildLiveInputs(dates);

    // Baseline: the live two-holding book (BTC 0.6 / ETH 0.4), no bridge add.
    const draft = defaultDraftFromHoldings(HOLDINGS_2);
    const btcWeightBefore = draft.weightOverrides[REF_BTC];
    expect(btcWeightBefore).toBeCloseTo(0.6, 9);
    const baseline = computeMetricsForDraft(draft, liveInputs);
    // Sanity: the baseline is a real (non-degenerate) projection — otherwise a
    // null→null comparison below would be a false "no movement".
    expect(baseline.n).toBe(80);
    expect(baseline.twr).not.toBeNull();
    expect(baseline.volatility).not.toBeNull();

    // The seam under test: carry the Bridge candidate into the composer draft.
    const next = addStrategyBridge(draft, REF_BTC, STRAT_B);
    const after = computeMetricsForDraft(next, liveInputs);

    // (a) MEMBERSHIP — the candidate lands in the draft. FAILS when the seam is
    // neutered to `return draft` (the candidate is never pushed).
    expect(next.addedStrategies.map((s) => s.id)).toContain(STRAT_B.id);
    expect(next.toggleByScopeRef[STRAT_B.id]).toBe(true);

    // (b) EXACT BRIDGED WEIGHT — mirrors scenario-state.test.ts:250-253 (T1.5).
    // BTC weight 0.6 → candidate takes 0.6 → total-before-renorm 1.6 → each /1.6.
    // FAILS when neutered (no weightOverride entry is ever written for uuid-2).
    expect(next.weightOverrides[STRAT_B.id]).toBeCloseTo(0.6 / 1.6, 9);
    expect(next.weightOverrides[REF_ETH]).toBeCloseTo(0.4 / 1.6, 9);
    expect(sumEnabled(next)).toBeCloseTo(1.0, 9);

    // (c) HOLDING DILUTED — the flagged holding stays enabled but its weight is
    // strictly diluted by the renormalization (0.6 → 0.6/1.6 = 0.375).
    expect(next.toggleByScopeRef[REF_BTC]).toBe(true);
    expect(next.weightOverrides[REF_BTC]).toBeLessThan(btcWeightBefore);
    expect(next.weightOverrides[REF_BTC]).toBeCloseTo(0.6 / 1.6, 9);

    // (d) PROJECTION DELTA — the LOAD-BEARING non-vacuous gate. Adding the
    // candidate (distinct return profile, ~37.5% of the blend) must MOVE at
    // least one projection-bearing metric. A membership-only assertion is
    // vacuous and does NOT satisfy JOURNEY-01.
    //
    // FALSIFIABILITY: with `addStrategyBridge` neutered to `return draft`,
    // `next === draft`, so `after` === `baseline` field-for-field and EVERY
    // expectation below flips to "expected X to not (be close to) X" → red.
    // Recorded once in 33-01-SUMMARY.md.
    expect(after.twr).not.toBeNull();
    expect(after.volatility).not.toBeNull();
    // The candidate enters the active set — overlap n is unchanged (same window)
    // but the BLENDED metrics shift because a ~0.375-weight leg with a different
    // curve now contributes. Assert a genuine numeric move on multiple axes.
    expect(after.twr).not.toBeCloseTo(baseline.twr as number, 6);
    expect(after.volatility).not.toBeCloseTo(baseline.volatility as number, 6);
  });

  it("REACHABILITY HINGE — only the composer-owned drawer can seed the draft (FLOW-01)", () => {
    // Read the live source from disk (the src/__tests__ frozen-spine guard
    // idiom — readFileSync + grep-style count). This pins the shipped-but-dead
    // lesson: the composer-owned BridgeDrawer is the ONLY mount carrying
    // `onAddToScenario`; the BridgeWidget drawers are structurally inert.
    const componentsDir = join(
      CWD,
      "src/app/(dashboard)/allocations/components",
    );
    const composerSrc = readFileSync(
      join(componentsDir, "ScenarioComposer.tsx"),
      "utf8",
    );
    const widgetSrc = readFileSync(
      join(componentsDir, "BridgeWidget.tsx"),
      "utf8",
    );

    // Count the JSX prop-assignment form `onAddToScenario={` (NOT a bare
    // `onAddToScenario` substring — the composer's file-header comment mentions
    // the prop name in prose, and only the prop-assignment form is the live
    // wiring). The prop form is unambiguous and comment-free.
    const countPropForm = (src: string): number =>
      (src.match(/onAddToScenario=\{/g) ?? []).length;

    // Composer: exactly ONE onAddToScenario-bearing drawer mount.
    // FAILS (1 → 0) if a future edit drops the callback from the composer.
    expect(countPropForm(composerSrc)).toBe(1);

    // BridgeWidget: ZERO — its drawers cannot seed the draft.
    // FAILS (0 → 1+) if a future edit wires onAddToScenario into a BridgeWidget
    // BridgeDrawer mount, silently creating a second (untested) seeding path.
    expect(countPropForm(widgetSrc)).toBe(0);

    // Self-pin (mirrors the phase-3x guards' "regex still matches a positive
    // sample" check): prove the matcher is not inert — a synthetic positive
    // sample must count as 1, so a future loosening that makes the regex never
    // match is itself caught.
    expect(countPropForm('  <BridgeDrawer onAddToScenario={handler} />')).toBe(1);
  });
});
