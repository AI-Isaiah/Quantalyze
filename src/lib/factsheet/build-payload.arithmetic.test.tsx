/**
 * Phase 90 Wave-0 RED scaffold — D3 arithmetic composite curve + payload
 * threading + cash-scalar overlay + segment-marker derivation.
 *
 * This file encodes the EXACT contract that 90-03 must satisfy (per
 * 90-VALIDATION.md row "D3" and 90-RESEARCH.md §Resolved-1). The
 * new-behavior groups MUST fail (RED) today and go green only when 90-03
 * lands the `arithmeticEquity` / `arithmeticUnderwater` helpers on compute.ts,
 * the `deriveSegmentMarkers` export on build-payload.ts, and the optional
 * third `opts` arg to `buildFactsheetPayload`.
 *
 * W1 (Nyquist Wave-0): the three not-yet-existing NAMED imports below each carry
 * an expect-error suppression directive so `tsc --noEmit` stays clean at Wave 0
 * while the imports resolve to `undefined` at vitest runtime (still RED). Once
 * 90-03 adds the real exports, each directive becomes an UNUSED-directive error
 * (TS2578) so 90-03's own tsc gate forces its removal and the real imports wire
 * up. Do NOT stub the exports early to silence RED — that defeats the Wave-0 gate.
 */
import { describe, it, expect } from "vitest";
import type { DailyReturn, FactsheetPayload } from "./types";
import { cumEq, drawdowns, worstDrawdowns } from "./compute";
import { buildFactsheetPayload } from "./build-payload";

// The three exports below do not exist yet — they land in 90-03. Each named
// import is a `tsc` TS2305 ("no exported member") error that the
// `buildFactsheetPayload` signature cast does NOT fix, so each needs its own
// directive on the line directly above it.

import { arithmeticEquity } from "./compute";
import { arithmeticUnderwater } from "./compute";
// @ts-expect-error export lands in 90-03 — deriveSegmentMarkers
import { deriveSegmentMarkers } from "./build-payload";

// ---------------------------------------------------------------------------
// Local typed alias for the not-yet-existing third `opts` arg (90-03). The
// current 2-arg signature won't accept a third argument, so we cast the
// function through a typed alias rather than casting the call site (`as never`
// is forbidden). This keeps the file compiling today while 90-03 makes the
// runtime behavior real.
// ---------------------------------------------------------------------------
type SegmentBoundary = { date: string; seq: number; label: string };
type MissingSegment = { start: string; end: string; kind: "gap"; days: number };
type Phase90Opts = {
  cumulativeMethod?: "geometric" | "arithmetic";
  segmentBoundaries?: SegmentBoundary[];
  missingSegments?: MissingSegment[];
  metricsByBasis?: {
    cash_settlement: Record<string, number>;
    mark_to_market?: Record<string, number>;
  };
  dataQuality?: { composite: boolean };
  mtmGate?: { available: boolean; reason?: string };
};
type BuildWithOpts = (
  s: Parameters<typeof buildFactsheetPayload>[0],
  d: DailyReturn[],
  o?: Phase90Opts,
) => FactsheetPayload | null;
const buildWithOpts = buildFactsheetPayload as unknown as BuildWithOpts;

/** Read Phase-90 optional fields off a payload (present only after 90-03). */
function optFields(p: FactsheetPayload): Record<string, unknown> {
  return p as unknown as Record<string, unknown>;
}

/** Strategy stub — required fields only. */
function makeStrategy() {
  return {
    id: "test-id",
    name: "Test Strategy",
    types: ["quant"],
    markets: ["crypto"],
    computedAt: "2024-05-01T00:00:00Z",
    trustTier: null as null,
  };
}

// Sparse 8-point series with a real 2-day gap between idx 3 (2025-08-04) and
// idx 4 (2025-08-07): the 5th and 6th are NOT rows in the series.
const SPARSE: DailyReturn[] = [
  { date: "2025-08-01", value: 0.01 },
  { date: "2025-08-02", value: 0.02 },
  { date: "2025-08-03", value: -0.03 },
  { date: "2025-08-04", value: 0.04 },
  // gap: 2025-08-05, 2025-08-06 — no rows (never zero-filled)
  { date: "2025-08-07", value: -0.05 },
  { date: "2025-08-08", value: 0.06 },
  { date: "2025-08-09", value: -0.01 },
  { date: "2025-08-10", value: 0.02 },
];
const SPARSE_RETS = SPARSE.map(d => d.value);

// Dense twin — identical values with explicit 0.0 rows on the two gap dates.
// A 0.0 return advances neither the running sum nor the running peak, so every
// arithmetic quantity is invariant to the injected zeros (D3 gap-day invariance).
const DENSE: DailyReturn[] = [
  { date: "2025-08-01", value: 0.01 },
  { date: "2025-08-02", value: 0.02 },
  { date: "2025-08-03", value: -0.03 },
  { date: "2025-08-04", value: 0.04 },
  { date: "2025-08-05", value: 0.0 },
  { date: "2025-08-06", value: 0.0 },
  { date: "2025-08-07", value: -0.05 },
  { date: "2025-08-08", value: 0.06 },
  { date: "2025-08-09", value: -0.01 },
  { date: "2025-08-10", value: 0.02 },
];
const DENSE_RETS = DENSE.map(d => d.value);

// A fixture where the inception-seeded SUBTRACTIVE underwater DIVERGES from the
// geometric ratio drawdowns(): a negative-first series is underwater from day 1
// under the subtractive rule (peak seeded at 0.0), while geometric drawdowns()
// (peak = running eq max) reports 0 on a monotone-up-from-trough segment.
const DIVERGE_RETS = [-0.2, 0.1, -0.05];

// ---------------------------------------------------------------------------
// Group 1 — arithmeticEquity: out[i] === 1 + running Σr; gap-day invariant.
// ---------------------------------------------------------------------------
describe("D3 arithmeticEquity: 1 + cumsum, gap-day invariant", () => {
  it("out[i] === 1 + running Σr on the sparse fixture (exact)", () => {
    const eq = arithmeticEquity(SPARSE_RETS);
    let s = 0;
    for (let i = 0; i < SPARSE_RETS.length; i++) {
      s += SPARSE_RETS[i];
      expect(eq[i]).toBeCloseTo(1 + s, 12);
    }
  });

  it("endpoint of the sparse series === endpoint of the dense-0.0 twin", () => {
    const sparseEq = arithmeticEquity(SPARSE_RETS);
    const denseEq = arithmeticEquity(DENSE_RETS);
    expect(sparseEq[sparseEq.length - 1]).toBeCloseTo(denseEq[denseEq.length - 1], 12);
  });

  it("every shared present-day value is identical between sparse and dense twins", () => {
    const sparseEq = arithmeticEquity(SPARSE_RETS);
    const denseEq = arithmeticEquity(DENSE_RETS);
    const denseByDate = new Map(DENSE.map((d, i) => [d.date, denseEq[i]]));
    for (let i = 0; i < SPARSE.length; i++) {
      expect(sparseEq[i]).toBeCloseTo(denseByDate.get(SPARSE[i].date)!, 12);
    }
  });
});

// ---------------------------------------------------------------------------
// Group 2 — arithmeticUnderwater: inception-seeded subtractive; ≤ 0; NOT the
// geometric ratio drawdowns(); min() gap-invariant.
// ---------------------------------------------------------------------------
describe("D3 arithmeticUnderwater: inception-seeded subtractive underwater", () => {
  it("inception-seeded — a negative-first series is underwater from day 1", () => {
    const uw = arithmeticUnderwater(DIVERGE_RETS);
    // peak seeded at 0.0 → cum after day 1 = -0.2, peak stays 0.0 → uw = -0.2.
    expect(uw[0]).toBeCloseTo(-0.2, 12);
    for (const v of uw) expect(v).toBeLessThanOrEqual(0);
  });

  it("out[i] = cum − peak (exact) on the sparse fixture", () => {
    const uw = arithmeticUnderwater(SPARSE_RETS);
    // cum: 0.01, 0.03, 0.00, 0.04, -0.01, 0.05, 0.04, 0.06
    // peak(seed 0): 0.01, 0.03, 0.03, 0.04, 0.04, 0.05, 0.05, 0.06
    // uw:           0,    0,   -0.03, 0,  -0.05, 0,  -0.01, 0
    const expected = [0, 0, -0.03, 0, -0.05, 0, -0.01, 0];
    for (let i = 0; i < expected.length; i++) {
      expect(uw[i]).toBeCloseTo(expected[i], 12);
    }
  });

  it("DIFFERS from the geometric drawdowns(cumEq(rets)) where they diverge", () => {
    const uw = arithmeticUnderwater(DIVERGE_RETS);
    const geo = drawdowns(cumEq(DIVERGE_RETS));
    // Subtractive underwater is negative from day 1; geometric dd stays 0 on the
    // up-from-inception days — so at least one index must differ materially.
    let diverged = false;
    for (let i = 0; i < DIVERGE_RETS.length; i++) {
      if (Math.abs(uw[i] - geo[i]) > 1e-9) diverged = true;
    }
    expect(diverged).toBe(true);
  });

  it("min() is gap-invariant: sparse underwater trough === dense-0.0 twin trough", () => {
    const sparseMin = Math.min(...arithmeticUnderwater(SPARSE_RETS));
    const denseMin = Math.min(...arithmeticUnderwater(DENSE_RETS));
    expect(sparseMin).toBeCloseTo(denseMin, 12);
  });
});

// ---------------------------------------------------------------------------
// Group 3 — buildFactsheetPayload arithmetic swap (3 fields) + geometric parity.
// ---------------------------------------------------------------------------
describe("D3 buildFactsheetPayload arithmetic swap (three curve fields together)", () => {
  it("cumulativeMethod:'arithmetic' → strategyEquity deep-equals arithmeticEquity(returns)", () => {
    const p = buildWithOpts(makeStrategy(), SPARSE, { cumulativeMethod: "arithmetic" })!;
    expect(p.strategyEquity).toEqual(arithmeticEquity(SPARSE_RETS));
  });

  it("cumulativeMethod:'arithmetic' → strategyDrawdowns deep-equals arithmeticUnderwater(returns)", () => {
    const p = buildWithOpts(makeStrategy(), SPARSE, { cumulativeMethod: "arithmetic" })!;
    expect(p.strategyDrawdowns).toEqual(arithmeticUnderwater(SPARSE_RETS));
  });

  it("cumulativeMethod:'arithmetic' → strategyWorst10 derived over the subtractive dd", () => {
    const p = buildWithOpts(makeStrategy(), SPARSE, { cumulativeMethod: "arithmetic" })!;
    expect(p.strategyWorst10).toEqual(worstDrawdowns(arithmeticUnderwater(SPARSE_RETS), 10));
  });

  it("opts absent → payload deep-equals a no-opts call (single-key byte-identity, GUARD-02)", () => {
    const withUndefined = buildWithOpts(makeStrategy(), SPARSE, undefined);
    const noOpts = buildFactsheetPayload(makeStrategy(), SPARSE);
    expect(withUndefined).toEqual(noOpts);
  });

  it("cumulativeMethod:'geometric' → payload deep-equals a no-opts call (byte-identity)", () => {
    const geo = buildWithOpts(makeStrategy(), SPARSE, { cumulativeMethod: "geometric" });
    const noOpts = buildFactsheetPayload(makeStrategy(), SPARSE);
    expect(geo).toEqual(noOpts);
  });
});

// ---------------------------------------------------------------------------
// Group 4 — endpoint == persisted headline (the invariance pin). The chart and
// the headline agree by construction: strategyEquity[last] − 1 === Σr === the
// persisted cash cumulative_return.
// ---------------------------------------------------------------------------
describe("D3 endpoint == persisted cash cumulative_return (within 1e-12)", () => {
  it("strategyEquity[last] − 1 ≈ metricsByBasis.cash_settlement.cumulative_return", () => {
    const sigmaR = SPARSE_RETS.reduce((a, b) => a + b, 0);
    const p = buildWithOpts(makeStrategy(), SPARSE, {
      cumulativeMethod: "arithmetic",
      metricsByBasis: { cash_settlement: { cumulative_return: sigmaR } },
    })!;
    const last = p.strategyEquity[p.strategyEquity.length - 1];
    expect(Math.abs(last - 1 - sigmaR)).toBeLessThan(1e-12);
  });
});

// ---------------------------------------------------------------------------
// Group 5 — opts threading: the five extra fields land on the payload exactly
// as passed; when opts omitted, all five are undefined.
// ---------------------------------------------------------------------------
describe("D3 opts threading onto the payload", () => {
  const segmentBoundaries: SegmentBoundary[] = [
    { date: "2025-10-01", seq: 2, label: "2" },
    { date: "2026-01-05", seq: 3, label: "3" },
  ];
  const missingSegments: MissingSegment[] = [
    { start: "2025-09-20", end: "2025-09-30", kind: "gap", days: 11 },
  ];
  const metricsByBasis = { cash_settlement: { cumulative_return: 0.06 } };
  const dataQuality = { composite: true };
  const mtmGate = { available: false, reason: "unsmoothed_options_book" };

  it("segmentBoundaries/missingSegments/metricsByBasis/dataQuality/mtmGate land verbatim", () => {
    const p = buildWithOpts(makeStrategy(), SPARSE, {
      cumulativeMethod: "arithmetic",
      segmentBoundaries,
      missingSegments,
      metricsByBasis,
      dataQuality,
      mtmGate,
    })!;
    const f = optFields(p);
    expect(f.segmentBoundaries).toEqual(segmentBoundaries);
    expect(f.missingSegments).toEqual(missingSegments);
    expect(f.metricsByBasis).toEqual(metricsByBasis);
    expect(f.dataQuality).toEqual(dataQuality);
    expect(f.mtmGate).toEqual(mtmGate);
  });

  it("opts omitted → all five extra fields are undefined", () => {
    const p = buildFactsheetPayload(makeStrategy(), SPARSE)!;
    const f = optFields(p);
    expect(f.segmentBoundaries).toBeUndefined();
    expect(f.missingSegments).toBeUndefined();
    expect(f.metricsByBasis).toBeUndefined();
    expect(f.dataQuality).toBeUndefined();
    expect(f.mtmGate).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Group 6 — D3 cash overlay: the 7 mapped headline scalars read persisted cash
// (never client-geometric); non-mapped strategyMetrics keys stay client cash.
// ---------------------------------------------------------------------------
describe("D3 cash overlay: 7 headline scalars read persisted cash", () => {
  const CASH = {
    cumulative_return: 0.111,
    volatility: 0.222,
    max_drawdown: -0.333,
    cagr: 0.444,
    sharpe: 0.555,
    sortino: 0.666,
    calmar: 0.777,
  };

  it("cum_ret/ann_vol/max_dd/cagr/sharpe/sortino/calmar equal the persisted sentinels", () => {
    const p = buildWithOpts(makeStrategy(), SPARSE, {
      cumulativeMethod: "arithmetic",
      metricsByBasis: { cash_settlement: CASH },
    })!;
    expect(p.strategyMetrics.cum_ret).toBe(CASH.cumulative_return);
    expect(p.strategyMetrics.ann_vol).toBe(CASH.volatility);
    expect(p.strategyMetrics.max_dd).toBe(CASH.max_drawdown);
    expect(p.strategyMetrics.cagr).toBe(CASH.cagr);
    expect(p.strategyMetrics.sharpe).toBe(CASH.sharpe);
    expect(p.strategyMetrics.sortino).toBe(CASH.sortino);
    expect(p.strategyMetrics.calmar).toBe(CASH.calmar);
  });

  it("non-mapped keys (skew, win_rate) remain the client-computed cash values", () => {
    const overlaid = buildWithOpts(makeStrategy(), SPARSE, {
      cumulativeMethod: "arithmetic",
      metricsByBasis: { cash_settlement: CASH },
    })!;
    const client = buildFactsheetPayload(makeStrategy(), SPARSE)!;
    expect(overlaid.strategyMetrics.skew).toBe(client.strategyMetrics.skew);
    expect(overlaid.strategyMetrics.win_rate).toBe(client.strategyMetrics.win_rate);
  });
});

// ---------------------------------------------------------------------------
// Group 7 — deriveSegmentMarkers: boundaries for seq>1 only (seq 1 = inception,
// NOT a seam, per UI-SPEC §2); missingSegments with inclusive-both-ends days.
// ---------------------------------------------------------------------------
describe("D3 deriveSegmentMarkers: seq>1 boundaries + inclusive gap days", () => {
  const dqf = {
    composite: true,
    per_key: [
      { seq: 1, first_day: "2025-08-01" },
      { seq: 2, first_day: "2025-10-01" },
      { seq: 3, first_day: "2026-01-05" },
    ],
    gap_spans: [{ start: "2025-09-20", end: "2025-09-30" }],
  };

  it("exactly 2 boundaries — seq 2 and 3 only (seq 1 inception excluded)", () => {
    const { segmentBoundaries } = deriveSegmentMarkers(dqf);
    expect(segmentBoundaries).toEqual([
      { date: "2025-10-01", seq: 2, label: "2" },
      { date: "2026-01-05", seq: 3, label: "3" },
    ]);
  });

  it("exactly 1 missingSegment with inclusive-both-ends days === 11 (20th..30th)", () => {
    const { missingSegments } = deriveSegmentMarkers(dqf);
    expect(missingSegments).toEqual([
      { start: "2025-09-20", end: "2025-09-30", kind: "gap", days: 11 },
    ]);
  });
});
