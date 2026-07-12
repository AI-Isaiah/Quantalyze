import { describe, it, expect } from "vitest";
import { buildFactsheetPayload } from "./build-payload";
import type { BuildFactsheetOpts } from "./build-payload";
import type { DailyReturn } from "./types";

/**
 * Phase 103 (MTM-04) — deriveSeriesBundle factoring + seriesByBasis emission.
 *
 * SC-4 keystone (T-103-SC): the per-basis derivation is factored into ONE
 * internal `deriveSeriesBundle` the cash path and the MTM path both call. That
 * factoring MUST be BYTE-NEUTRAL for cash. These whole-payload `JSON.stringify`
 * snapshots — captured from the PRE-refactor code — self-fail on any field
 * reorder or cash-value shift, over the EXPANDED panel set (quantiles / streaks /
 * calmarByYear / bootstrapCI / styleDrift / stressWindows / correlations /
 * correlationMatrix). Three arms (single-key geometric, composite arithmetic with
 * metricsByBasis/markers, AND an ingestSource:"api" arm) prove the api-append path
 * is provably untouched too.
 */

/** Deterministic pseudo-random daily-return series (calendar-daily; crypto). */
function genSeries(start: string, n: number, seed: number): DailyReturn[] {
  const out: DailyReturn[] = [];
  let t = Date.parse(`${start}T00:00:00Z`);
  let x = seed >>> 0;
  for (let i = 0; i < n; i++) {
    x = (Math.imul(x, 1103515245) + 12345) & 0x7fffffff;
    const r = (x / 0x7fffffff - 0.5) * 0.1; // ~[-0.05, 0.05]
    out.push({ date: new Date(t).toISOString().slice(0, 10), value: Math.round(r * 1e6) / 1e6 });
    t += 86_400_000;
  }
  return out;
}

// A ~62-day series from 2025-03-15 covers the "Apr 2025 tariffs" stress window
// (2025-04-02..2025-04-09, crypto class) with real BTC benchmark data (BTC JSON
// starts 2023-04-26) so stressWindows populates deterministically.
const CASH_SERIES = genSeries("2025-03-15", 62, 12345);

const BASE_STRATEGY = {
  id: "s-103-03",
  name: "Bundle Fixture",
  types: ["quant"],
  markets: ["crypto"],
  computedAt: "2025-05-16T00:00:00Z",
  trustTier: null,
  assetClass: "crypto",
  description: "fixture",
  subtypes: ["basis_trade"],
  supportedExchanges: ["deribit"],
  leverageRange: "0-3x",
  aum: 1_000_000,
  maxCapacity: 5_000_000,
  avgDailyTurnover: 250_000,
  startDate: "2025-03-15",
  benchmark: "BTC",
};

const SK_STRATEGY = { ...BASE_STRATEGY, ingestSource: "csv" as const };
const API_STRATEGY = { ...BASE_STRATEGY, id: "s-103-03-api", ingestSource: "api" as const };

// Composite arithmetic variant — cash_settlement overlay is load-bearing: its
// volatility (0.42) differs from the series' computed ann_vol, so it rewrites
// strategyMetrics.ann_vol which feeds the comparator volMatched. A refactor that
// used the series-computed ann_vol for the comparator would shift the snapshot.
const CASH_SETTLEMENT = {
  cumulative_return: 0.33,
  volatility: 0.42,
  max_drawdown: -0.11,
  cagr: 0.25,
  sharpe: 1.1,
  sortino: 1.5,
  calmar: 2.0,
};
const COMPOSITE_OPTS: BuildFactsheetOpts = {
  cumulativeMethod: "arithmetic",
  metricsByBasis: { cash_settlement: CASH_SETTLEMENT },
  segmentBoundaries: [{ date: "2025-04-10", seq: 2, label: "2" }],
  missingSegments: [{ start: "2025-04-20", end: "2025-04-22", kind: "gap", days: 3 }],
};

describe("SC-4 — cash byte-identity across the deriveSeriesBundle refactor", () => {
  it("single-key geometric payload is byte-identical (whole-payload pin)", () => {
    const payload = buildFactsheetPayload(SK_STRATEGY, CASH_SERIES)!;
    expect(payload).not.toBeNull();
    expect(payload.seriesByBasis).toBeUndefined(); // no mtmSeries -> no bundle
    expect(JSON.stringify(payload)).toMatchSnapshot();
  });

  it("composite arithmetic payload (metricsByBasis + markers) is byte-identical", () => {
    const payload = buildFactsheetPayload(SK_STRATEGY, CASH_SERIES, COMPOSITE_OPTS)!;
    expect(payload.seriesByBasis).toBeUndefined();
    expect(JSON.stringify(payload)).toMatchSnapshot();
  });

  it("ingestSource:'api' payload (synthesized panels) is byte-identical", () => {
    const payload = buildFactsheetPayload(API_STRATEGY, CASH_SERIES)!;
    expect(payload.ingestSource).toBe("api");
    expect(payload.seriesByBasis).toBeUndefined();
    expect(JSON.stringify(payload)).toMatchSnapshot();
  });
});

describe("MTM-04 — seriesByBasis.mark_to_market bundle emission", () => {
  // Sparse MTM series: the cash dates MINUS 2025-04-03..2025-04-05, with the
  // Python-derived gapSpans for that hole. Own axis (≠ cash) + own mask.
  const GAP = new Set(["2025-04-03", "2025-04-04", "2025-04-05"]);
  const MTM_SPARSE = CASH_SERIES.filter((d) => !GAP.has(d.date));
  const MTM_OPTS: BuildFactsheetOpts = {
    mtmSeries: {
      dailyReturns: MTM_SPARSE,
      gapSpans: [{ start: "2025-04-03", end: "2025-04-05" }],
    },
  };

  it("emits the full bundle: own dates axis + own mask + every dailies-derivable panel", () => {
    const payload = buildFactsheetPayload(SK_STRATEGY, CASH_SERIES, MTM_OPTS)!;
    const bundle = payload.seriesByBasis?.mark_to_market;
    expect(bundle).toBeDefined();

    // Own MTM axis ≠ cash axis (the gap days are absent).
    expect(bundle!.dates.length).toBe(MTM_SPARSE.length);
    expect(bundle!.dates.length).not.toBe(payload.dates.length);
    expect(bundle!.dates).not.toContain("2025-04-04");

    // Chart tracks + rolling + worst-10 + comparators.
    expect(bundle!.strategyReturns.length).toBe(MTM_SPARSE.length);
    expect(bundle!.strategyEquity.length).toBe(MTM_SPARSE.length);
    expect(bundle!.strategyDrawdowns.length).toBe(MTM_SPARSE.length);
    for (const f of ["strategyRollingVol", "strategyRollingSharpe", "strategyRollingSortino"] as const) {
      expect(Array.isArray(bundle![f])).toBe(true);
    }
    expect(bundle!.rollingWindow).toBeDefined();
    expect(bundle!.rollingBetaWindow).toBeDefined();
    expect(Array.isArray(bundle!.strategyWorst10)).toBe(true);
    expect(bundle!.comparators.btc).toBeDefined();
    expect(bundle!.comparators.spx).toBeDefined();
    expect(bundle!.comparators.none).toBeDefined();
    // Comparator arrays ride the MTM axis (Pitfall-1: one coherent date axis).
    expect(bundle!.comparators.btc.cumulative?.length).toBe(MTM_SPARSE.length);

    // Heatmaps.
    expect(Array.isArray(bundle!.monthlyReturns)).toBe(true);
    expect(Array.isArray(bundle!.dailyHeatmap)).toBe(true);

    // Persisted-mask missingSegments (Python-derived gapSpans, deriveSegmentMarkers shape).
    expect(bundle!.missingSegments).toEqual([
      { start: "2025-04-03", end: "2025-04-05", kind: "gap", days: 3 },
    ]);

    // The dailies-derivable statistics panels are recomputed into the bundle.
    expect(bundle!.quantiles).toBeDefined();
    expect(bundle!.streaks).toBeDefined();
    expect(Array.isArray(bundle!.calmarByYear)).toBe(true);
    expect(bundle!.bootstrapCI).toBeDefined();
    expect(bundle!.styleDrift).toBeDefined();
    expect(bundle!.stressWindows).toBeDefined();

    // EXTERNAL-DATA panels are NOT in the bundle (stay cash top-level).
    expect("correlations" in bundle!).toBe(false);
    expect("correlationMatrix" in bundle!).toBe(false);
    // …and they DO still exist on the cash top-level.
    expect(payload.correlations.length).toBeGreaterThan(0);
    expect(payload.correlationMatrix.labels.length).toBeGreaterThan(0);
  });

  it("degenerate mtmSeries (<2 rows) → NO bundle; cash unaffected", () => {
    const degenerate: BuildFactsheetOpts = {
      mtmSeries: { dailyReturns: [{ date: "2025-03-15", value: 0.01 }], gapSpans: [] },
    };
    const payload = buildFactsheetPayload(SK_STRATEGY, CASH_SERIES, degenerate)!;
    expect(payload.seriesByBasis).toBeUndefined();
    // Cash byte-identical to the plain single-key build.
    const plain = buildFactsheetPayload(SK_STRATEGY, CASH_SERIES)!;
    expect(JSON.stringify(payload)).toBe(JSON.stringify(plain));
  });

  it("cash top-level fields are byte-identical whether the bundle is present or absent (additive-only)", () => {
    const withBundle = buildFactsheetPayload(SK_STRATEGY, CASH_SERIES, MTM_OPTS)!;
    const withoutBundle = buildFactsheetPayload(SK_STRATEGY, CASH_SERIES)!;
    // Strip the additive bundle, compare the rest byte-for-byte.
    const { seriesByBasis: _drop, ...cashOnly } = withBundle;
    expect(JSON.stringify(cashOnly)).toBe(JSON.stringify(withoutBundle));
  });
});

describe("MTM-04 — falsifiable: dailies-derivable panels FOLLOW the MTM basis", () => {
  // An MTM series that DIFFERS from cash (different seed → different values, same
  // dates so stressWindows still populates). If the bundle copied cash instead of
  // recomputing from the MTM series, these would be equal → RED.
  const MTM_DIFFERENT = genSeries("2025-03-15", 62, 99999);
  const OPTS: BuildFactsheetOpts = {
    mtmSeries: { dailyReturns: MTM_DIFFERENT, gapSpans: [] },
  };

  it("bundle quantiles / calmarByYear / streaks / styleDrift / stressWindows differ from cash top-level", () => {
    const payload = buildFactsheetPayload(SK_STRATEGY, CASH_SERIES, OPTS)!;
    const bundle = payload.seriesByBasis!.mark_to_market!;

    expect(JSON.stringify(bundle.quantiles)).not.toBe(JSON.stringify(payload.quantiles));
    expect(JSON.stringify(bundle.calmarByYear)).not.toBe(JSON.stringify(payload.calmarByYear));
    expect(JSON.stringify(bundle.streaks)).not.toBe(JSON.stringify(payload.streaks));
    expect(JSON.stringify(bundle.styleDrift)).not.toBe(JSON.stringify(payload.styleDrift));

    // stressWindows: BOTH populate (same date span), but the strategy column
    // (stratReturn) is recomputed from the MTM returns → differs.
    expect(bundle.stressWindows.windows.length).toBeGreaterThan(0);
    expect(payload.stressWindows.windows.length).toBe(bundle.stressWindows.windows.length);
    const cashStrat = payload.stressWindows.windows.map((w) => w.stratReturn);
    const mtmStrat = bundle.stressWindows.windows.map((w) => w.stratReturn);
    expect(JSON.stringify(mtmStrat)).not.toBe(JSON.stringify(cashStrat));
  });

  it("same-derivation invariant: feeding the SAME series as cash AND mtm → bundle tracks deep-equal the cash top-level", () => {
    const OPTS_SAME: BuildFactsheetOpts = {
      mtmSeries: { dailyReturns: CASH_SERIES, gapSpans: [] },
    };
    const payload = buildFactsheetPayload(SK_STRATEGY, CASH_SERIES, OPTS_SAME)!;
    const bundle = payload.seriesByBasis!.mark_to_market!;
    // ONE derivation, not a parallel implementation.
    expect(bundle.dates).toEqual(payload.dates);
    expect(bundle.strategyReturns).toEqual(payload.strategyReturns);
    expect(bundle.strategyEquity).toEqual(payload.strategyEquity);
    expect(bundle.strategyDrawdowns).toEqual(payload.strategyDrawdowns);
  });
});
