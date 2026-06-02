import { describe, it, expect, vi } from "vitest";
import { computeOutcomeKPIs } from "./outcomes-kpi";
import type { BridgeOutcome } from "./bridge-outcome-schema";
import fixture from "../../tests/fixtures/outcomes-kpi-parity.json";

// Fixed-clock-equivalent: computeOutcomeKPIs does not consume "today"; it
// derives KPIs from row data alone. Phase 4 _success_value parity is the
// authoritative rule set (D-11 / D-12 revised / D-21 revised).

function makeOutcome(overrides: Partial<BridgeOutcome>): BridgeOutcome {
  return {
    id: "o",
    kind: "allocated",
    percent_allocated: 10,
    allocated_at: "2026-01-01",
    rejection_reason: null,
    note: null,
    delta_30d: null,
    delta_90d: null,
    delta_180d: null,
    estimated_delta_bps: null,
    estimated_days: null,
    needs_recompute: false,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  } as BridgeOutcome;
}

describe("computeOutcomeKPIs", () => {
  it("case 1 — empty outcomes -> { totalOutcomes: 0, winRate: null, avgRealizedDelta: null, pendingCount: 0, winRateDenominator: 0 }", () => {
    const result = computeOutcomeKPIs([]);
    expect(result).toEqual({
      totalOutcomes: 0,
      winRate: null,
      avgRealizedDelta: null,
      pendingCount: 0,
      winRateDenominator: 0,
    });
  });

  it("case 2 — single allocated win (delta_30d=0.04, percent=12) -> totalOutcomes=1, winRate=1.0, avgRealizedDelta=0.04, pendingCount=0, winRateDenominator=1", () => {
    const result = computeOutcomeKPIs([
      makeOutcome({ id: "o1", percent_allocated: 12, delta_30d: 0.04 }),
    ]);
    expect(result).toEqual({
      totalOutcomes: 1,
      winRate: 1.0,
      avgRealizedDelta: 0.04,
      pendingCount: 0,
      winRateDenominator: 1,
    });
  });

  it("case 3 — single allocated loss (delta_30d=-0.03) -> winRate=0.0, avgRealizedDelta=-0.03, winRateDenominator=1", () => {
    const result = computeOutcomeKPIs([
      makeOutcome({ id: "o1", percent_allocated: 12, delta_30d: -0.03 }),
    ]);
    expect(result).toEqual({
      totalOutcomes: 1,
      winRate: 0.0,
      avgRealizedDelta: -0.03,
      pendingCount: 0,
      winRateDenominator: 1,
    });
  });

  it("case 4 — mixed 3-win/1-loss/0-pending -> winRate=0.75, avgRealizedDelta=mean", () => {
    const result = computeOutcomeKPIs([
      makeOutcome({ id: "o1", percent_allocated: 10, delta_30d: 0.02 }),
      makeOutcome({ id: "o2", percent_allocated: 10, delta_30d: 0.04 }),
      makeOutcome({ id: "o3", percent_allocated: 10, delta_30d: 0.06 }),
      makeOutcome({ id: "o4", percent_allocated: 10, delta_30d: -0.08 }),
    ]);
    expect(result.totalOutcomes).toBe(4);
    expect(result.winRate).toBe(0.75);
    expect(result.avgRealizedDelta).toBeCloseTo(0.01, 10); // (0.02+0.04+0.06-0.08)/4
    expect(result.pendingCount).toBe(0);
    expect(result.winRateDenominator).toBe(4);
  });

  it("case 5 — allocated pending (all deltas null) -> excluded from denominator; pendingCount=1, totalOutcomes counted", () => {
    const result = computeOutcomeKPIs([
      makeOutcome({
        id: "o1",
        percent_allocated: 12,
        delta_30d: null,
        delta_90d: null,
        delta_180d: null,
      }),
    ]);
    expect(result).toEqual({
      totalOutcomes: 1,
      winRate: null,
      avgRealizedDelta: null,
      pendingCount: 1,
      winRateDenominator: 0,
    });
  });

  it("case 6 — allocated <1% percent_allocated -> excluded from denominator (D-08 step 2)", () => {
    const result = computeOutcomeKPIs([
      makeOutcome({ id: "o1", percent_allocated: 0.5, delta_30d: 0.04 }),
    ]);
    expect(result).toEqual({
      totalOutcomes: 1,
      winRate: null,
      avgRealizedDelta: null,
      pendingCount: 0,
      winRateDenominator: 0,
    });
  });

  it("case 7 — rejected rows -> excluded from win-rate denominator AND numerator; counted in totalOutcomes (D-13)", () => {
    const result = computeOutcomeKPIs([
      makeOutcome({
        id: "o1",
        kind: "rejected",
        percent_allocated: null,
        allocated_at: null,
        rejection_reason: "mandate_conflict",
      }),
      makeOutcome({ id: "o2", percent_allocated: 10, delta_30d: 0.04 }),
    ]);
    expect(result).toEqual({
      totalOutcomes: 2,
      winRate: 1.0,
      avgRealizedDelta: 0.04,
      pendingCount: 0,
      winRateDenominator: 1,
    });
  });

  it("case 8 — parity fixture", () => {
    const outcomes = fixture.outcomes as unknown as BridgeOutcome[];
    const result = computeOutcomeKPIs(outcomes);
    expect(result).toEqual(fixture.expected);
  });

  // NEW-C27-01 regression: a row with ONLY delta_30d (no delta_90d/delta_180d)
  // IS included in the win-rate denominator (mostMatureDelta falls back to 30d).
  // Before the label fix, the KPI was still "(90d)" but this row was counted —
  // this test pins that a 30d-only row contributes to the hit rate, confirming
  // the "latest" label semantics.
  it("NEW-C27-01 regression: row with only delta_30d IS counted in winRateDenominator (most-mature fallback)", () => {
    const result = computeOutcomeKPIs([
      makeOutcome({ id: "o1", percent_allocated: 10, delta_30d: 0.05, delta_90d: null, delta_180d: null }),
    ]);
    // delta_30d-only row contributes to the rate via mostMatureDelta.
    expect(result.winRateDenominator).toBe(1);
    expect(result.winRate).toBe(1.0);
  });

  // NEW-C27-02 regression: winRateDenominator must equal the count of rows
  // actually feeding the win-rate numerator, not the count with delta_90d != null.
  it("NEW-C27-02 regression: winRateDenominator == mature-allocated count, not delta_90d count", () => {
    const outcomes = [
      // Allocated, percent=2, only delta_30d — mature (30d fallback).
      makeOutcome({ id: "o1", percent_allocated: 2, delta_30d: 0.05, delta_90d: null }),
      // Allocated, percent=5, delta_90d present — mature.
      makeOutcome({ id: "o2", percent_allocated: 5, delta_90d: 0.08, delta_30d: null }),
    ];
    const result = computeOutcomeKPIs(outcomes);
    // Both rows are mature; winRateDenominator=2.
    // But counts.settled (old code) = 1 (only o2 has delta_90d != null).
    expect(result.winRateDenominator).toBe(2);
    expect(result.winRate).toBe(1.0);
  });

  // F-10 regression: the guard `if (deltas.length === 0)` returns null for
  // winRate and avgRealizedDelta instead of NaN. Today this path is
  // unreachable via normal input (the mature filter guarantees at least one
  // non-null delta, and mostMatureDelta preserves it). The guard is defensive:
  // if the filter logic ever changes such that `mature.length > 0` but all
  // `mostMatureDelta` calls return null, the function must return null NOT NaN.
  //
  // We test the invariant across the currently-reachable near-edges: any path
  // that could plausibly produce a 0-denominator must return null, not NaN.
  it("F-10: zero-denominator paths return null (not NaN) for winRate and avgRealizedDelta", () => {
    // Pending row (mature.length=0 → early return) — confirms the early guard.
    const pending = computeOutcomeKPIs([
      makeOutcome({ id: "p1", percent_allocated: 10, delta_30d: null, delta_90d: null, delta_180d: null }),
    ]);
    expect(pending.winRate).toBeNull();
    expect(pending.avgRealizedDelta).toBeNull();
    // Explicit check: null, not NaN.
    expect(pending.winRate !== null ? isNaN(pending.winRate) : false).toBe(false);

    // Below-1pct row (allocatedSized.length=0 → mature.length=0 → early return).
    const tiny = computeOutcomeKPIs([
      makeOutcome({ id: "t1", percent_allocated: 0.5, delta_30d: 0.04 }),
    ]);
    expect(tiny.winRate).toBeNull();
    expect(tiny.avgRealizedDelta).toBeNull();

    // Empty input — all counts zero.
    const empty = computeOutcomeKPIs([]);
    expect(empty.winRate).toBeNull();
    expect(empty.avgRealizedDelta).toBeNull();
    expect(empty.winRateDenominator).toBe(0);
  });

  // F2 H-0464 / M-0532 — NaN/Infinity from a corrupt analytics-worker write must
  // not corrupt the win rate or the average. Postgres double precision accepts
  // 'NaN'::float8; a divide-by-zero in the returns calc yields ±Infinity.
  describe("non-finite delta safety (H-0464 / M-0532)", () => {
    it("uses the valid lower delta when the most-mature delta is NaN (no short-circuit)", () => {
      // delta_180d=NaN must NOT short-circuit ahead of the valid delta_90d.
      const r = computeOutcomeKPIs([
        makeOutcome({ delta_180d: NaN, delta_90d: 0.05, delta_30d: 0.01 }),
      ]);
      expect(r.winRateDenominator).toBe(1);
      expect(r.winRate).toBe(1); // 0.05 > 0 → win
      expect(r.avgRealizedDelta).toBeCloseTo(0.05, 9);
      expect(Number.isFinite(r.avgRealizedDelta!)).toBe(true);
    });

    it("counts an all-non-finite row as pending, not a loss; keeps the average finite", () => {
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const r = computeOutcomeKPIs([
        makeOutcome({ delta_180d: NaN, delta_90d: null, delta_30d: null }),
        makeOutcome({ delta_180d: 0.04, delta_90d: null, delta_30d: null }), // a real win
      ]);
      // The NaN-only row is excluded from the win-rate denominator (NOT counted
      // as a loss) and surfaced as pending; only the real row contributes.
      expect(r.winRateDenominator).toBe(1);
      expect(r.winRate).toBe(1);
      expect(r.pendingCount).toBe(1);
      expect(Number.isFinite(r.avgRealizedDelta!)).toBe(true);
      expect(errSpy).toHaveBeenCalledTimes(1); // fail-loud on the corrupt row
      errSpy.mockRestore();
    });

    it("does NOT count an Infinity delta as a spurious win", () => {
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const r = computeOutcomeKPIs([
        makeOutcome({ delta_180d: Infinity, delta_90d: null, delta_30d: null }),
        makeOutcome({ delta_180d: -0.02, delta_90d: null, delta_30d: null }), // a real loss
      ]);
      // Infinity would have been `> 0` → a fake win. It's excluded instead; only
      // the genuine loss counts.
      expect(r.winRateDenominator).toBe(1);
      expect(r.winRate).toBe(0);
      expect(r.pendingCount).toBe(1);
      expect(Number.isFinite(r.avgRealizedDelta!)).toBe(true);
      errSpy.mockRestore();
    });
  });
});
