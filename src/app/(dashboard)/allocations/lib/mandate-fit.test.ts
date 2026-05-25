import { describe, it, expect } from "vitest";

/**
 * Phase 10 Plan 05 Task 1 — mandate-fit.ts pure module tests.
 *
 * Per RESEARCH Pitfall 7: `mandate_fit_score` is NOT a column on the
 * `strategies` table; it lives in `match_candidates.score_breakdown` JSONB
 * and is allocator-relative (computed engine-side at score time). The browse
 * drawer needs a CLIENT-SIDE approximation from allocator mandate prefs +
 * strategy attributes — this is what `computeMandateFitApprox` provides.
 *
 * Threshold rubric pinned to D-08 (per L2 cross-review fix — earlier draft
 * used 0.8; the locked thresholds are 0.7 / 0.4):
 *   - HARD-RED  → any strategy_type matches mandate.excluded_strategy_types
 *   - GREEN     → market overlap fraction >= 0.7
 *   - YELLOW    → 0.4 <= fraction < 0.7   OR mandate missing/empty
 *   - RED       → fraction < 0.4 (including zero overlap when prefs exist)
 *
 * D-08: pill is INFORMATIONAL only — allocator is never blocked from adding.
 */

import {
  computeMandateFitApprox,
  type MandateFitTier,
  type BrowseStrategyForFit,
  type AllocatorMandateForFit,
} from "./mandate-fit";

const STRAT = (
  overrides: Partial<BrowseStrategyForFit> = {},
): BrowseStrategyForFit => ({
  id: "s1",
  markets: ["binance", "okx"],
  strategy_types: ["momentum"],
  ...overrides,
});

const MANDATE = (
  overrides: Partial<AllocatorMandateForFit> = {},
): AllocatorMandateForFit => ({
  preferred_markets: ["binance", "okx"],
  excluded_strategy_types: [],
  max_weight: null,
  min_aum_tier: null,
  ...overrides,
});

describe("computeMandateFitApprox — Phase 10 Plan 05 / D-08 / Pitfall 7", () => {
  it("T1 — full market overlap, no excluded type → green", () => {
    const tier = computeMandateFitApprox(
      STRAT({ markets: ["binance", "okx"], strategy_types: ["momentum"] }),
      MANDATE({
        preferred_markets: ["binance", "okx"],
        excluded_strategy_types: ["arbitrage"],
      }),
    );
    expect(tier).toBe<MandateFitTier>("green");
  });

  it("T2 — zero market overlap → red", () => {
    const tier = computeMandateFitApprox(
      STRAT({ markets: ["coinbase"], strategy_types: ["momentum"] }),
      MANDATE({
        preferred_markets: ["binance", "okx"],
        excluded_strategy_types: [],
      }),
    );
    expect(tier).toBe<MandateFitTier>("red");
  });

  it("T3 — half market overlap (1 of 2) → yellow", () => {
    const tier = computeMandateFitApprox(
      STRAT({ markets: ["binance", "coinbase"], strategy_types: ["momentum"] }),
      MANDATE({
        preferred_markets: ["binance", "okx"],
        excluded_strategy_types: [],
      }),
    );
    expect(tier).toBe<MandateFitTier>("yellow");
  });

  describe("T3b — boundary thresholds (L2 — D-08 0.7/0.4 pinned VERBATIM)", () => {
    it("7/10 markets matching → green (0.7 inclusive)", () => {
      const markets = [
        "m0",
        "m1",
        "m2",
        "m3",
        "m4",
        "m5",
        "m6",
        "miss1",
        "miss2",
        "miss3",
      ];
      const prefs = ["m0", "m1", "m2", "m3", "m4", "m5", "m6"];
      const tier = computeMandateFitApprox(
        STRAT({ markets, strategy_types: ["momentum"] }),
        MANDATE({ preferred_markets: prefs, excluded_strategy_types: [] }),
      );
      expect(tier).toBe<MandateFitTier>("green");
    });

    it("4/10 markets matching → yellow (0.4 inclusive)", () => {
      const markets = [
        "m0",
        "m1",
        "m2",
        "m3",
        "miss1",
        "miss2",
        "miss3",
        "miss4",
        "miss5",
        "miss6",
      ];
      const prefs = ["m0", "m1", "m2", "m3"];
      const tier = computeMandateFitApprox(
        STRAT({ markets, strategy_types: ["momentum"] }),
        MANDATE({ preferred_markets: prefs, excluded_strategy_types: [] }),
      );
      expect(tier).toBe<MandateFitTier>("yellow");
    });

    it("3/10 markets matching → red (0.3 < 0.4)", () => {
      const markets = [
        "m0",
        "m1",
        "m2",
        "miss1",
        "miss2",
        "miss3",
        "miss4",
        "miss5",
        "miss6",
        "miss7",
      ];
      const prefs = ["m0", "m1", "m2"];
      const tier = computeMandateFitApprox(
        STRAT({ markets, strategy_types: ["momentum"] }),
        MANDATE({ preferred_markets: prefs, excluded_strategy_types: [] }),
      );
      expect(tier).toBe<MandateFitTier>("red");
    });
  });

  it("T4 — excluded strategy type → hard red regardless of market match", () => {
    const tier = computeMandateFitApprox(
      STRAT({
        markets: ["binance", "okx"],
        strategy_types: ["arbitrage"],
      }),
      MANDATE({
        preferred_markets: ["binance", "okx"],
        excluded_strategy_types: ["arbitrage"],
      }),
    );
    expect(tier).toBe<MandateFitTier>("red");
  });

  // M-0148 (pr-test-analyzer) — T4 only proves the excluded-type for-loop
  // returns red on a MATCH. The fall-through (excluded list non-empty, but no
  // strategy_type in it) is the branch that lets a strategy proceed to the
  // market-overlap computation — never directly pinned. A regression that
  // (e.g.) returned red on a non-empty excluded list regardless of membership
  // would pass every existing test but wrongly hard-red strategies.
  it("M-0148: excluded_strategy_types non-empty but no match → for-loop falls through to market fit (green)", () => {
    const tier = computeMandateFitApprox(
      STRAT({ markets: ["binance", "okx"], strategy_types: ["momentum"] }),
      MANDATE({
        preferred_markets: ["binance", "okx"],
        // Non-empty exclusion list, but "momentum" is not in it → must NOT
        // hard-red; full market overlap → green.
        excluded_strategy_types: ["arbitrage", "market-making"],
      }),
    );
    expect(tier).toBe<MandateFitTier>("green");
  });

  it("M-0148: multiple strategy_types, only the LAST matches an exclusion → red (loop scans all)", () => {
    const tier = computeMandateFitApprox(
      STRAT({
        markets: ["binance", "okx"],
        strategy_types: ["momentum", "trend", "arbitrage"],
      }),
      MANDATE({
        preferred_markets: ["binance", "okx"],
        excluded_strategy_types: ["arbitrage"],
      }),
    );
    // A regression that only checked strategy_types[0] would return green.
    expect(tier).toBe<MandateFitTier>("red");
  });

  // M-0148 (c) — the existing boundary tests use round 0.7/0.4/0.3 fractions.
  // Pin the IMMEDIATELY-below-threshold non-round fractions so an off-by-one
  // comparator flip (>= → >) is caught.
  it("M-0148: fraction immediately below 0.7 (8/12 ≈ 0.6667) → yellow, not green", () => {
    const markets = [
      "m0", "m1", "m2", "m3", "m4", "m5", "m6", "m7",
      "miss1", "miss2", "miss3", "miss4",
    ];
    const prefs = ["m0", "m1", "m2", "m3", "m4", "m5", "m6", "m7"]; // 8/12 = 0.6667
    const tier = computeMandateFitApprox(
      STRAT({ markets, strategy_types: ["momentum"] }),
      MANDATE({ preferred_markets: prefs, excluded_strategy_types: [] }),
    );
    expect(tier).toBe<MandateFitTier>("yellow");
  });

  it("M-0148: fraction immediately below 0.4 (3/8 = 0.375) → red, not yellow", () => {
    const markets = ["m0", "m1", "m2", "miss1", "miss2", "miss3", "miss4", "miss5"];
    const prefs = ["m0", "m1", "m2"]; // 3/8 = 0.375
    const tier = computeMandateFitApprox(
      STRAT({ markets, strategy_types: ["momentum"] }),
      MANDATE({ preferred_markets: prefs, excluded_strategy_types: [] }),
    );
    expect(tier).toBe<MandateFitTier>("red");
  });

  it("T5a — mandate is null → yellow (informational fallback)", () => {
    const tier = computeMandateFitApprox(STRAT(), null);
    expect(tier).toBe<MandateFitTier>("yellow");
  });

  it("T5b — mandate is undefined → yellow (informational fallback)", () => {
    const tier = computeMandateFitApprox(STRAT(), undefined);
    expect(tier).toBe<MandateFitTier>("yellow");
  });

  it("T5c — mandate present but preferred_markets empty → yellow (no signal)", () => {
    const tier = computeMandateFitApprox(
      STRAT(),
      MANDATE({ preferred_markets: [], excluded_strategy_types: [] }),
    );
    expect(tier).toBe<MandateFitTier>("yellow");
  });

  it("T6 — strategy has no markets, mandate has preferred markets → red (no overlap possible)", () => {
    const tier = computeMandateFitApprox(
      STRAT({ markets: [], strategy_types: ["momentum"] }),
      MANDATE({
        preferred_markets: ["binance"],
        excluded_strategy_types: [],
      }),
    );
    expect(tier).toBe<MandateFitTier>("red");
  });

  it("T7 — purity: same inputs always produce same tier", () => {
    const s = STRAT({ markets: ["binance", "okx"], strategy_types: ["momentum"] });
    const m = MANDATE({
      preferred_markets: ["binance"],
      excluded_strategy_types: [],
    });
    const t1 = computeMandateFitApprox(s, m);
    const t2 = computeMandateFitApprox(s, m);
    const t3 = computeMandateFitApprox(s, m);
    expect(t1).toBe(t2);
    expect(t2).toBe(t3);
  });

  it("T8 — exported MandateFitTier type compiles to the three string literals", () => {
    // Compile-time assertion: a MandateFitTier value is only ever one of these
    // three. Runtime-side, the function never returns anything else.
    const cases: MandateFitTier[] = ["green", "yellow", "red"];
    for (const c of cases) {
      // Trivially valid; the assertion is purely structural.
      expect(typeof c).toBe("string");
    }
  });
});
