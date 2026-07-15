/**
 * Tests for the backbone-routed blend-panel adapter (`deriveBlendPanels`).
 *
 * SC-1: the scenario-planner blend panels derive from the ONE canonical
 * backbone (`factsheet/rolling.ts` POPULATION-std primitives + `quantileSummary`),
 * NOT the retired second-Sharpe sample-std stack.
 *
 * Two blocks:
 *   1. Behaviour pins — public-shape parity with the legacy `buildBlendPanels`,
 *      the re-homed `usableN` degenerate gate, and the output-shape (warmup-drop) seam.
 *   2. SC-4 parity pins — population-std closed-form values at 63/126/252 and the
 *      min/max whisker contract, mutation-falsifiable against a sample-std bleed.
 */
import { describe, it, expect } from "vitest";
import { deriveBlendPanels } from "@/lib/scenario-blend-adapter";
import type { BlendPanelSeries } from "@/lib/scenario-blend-adapter";

/** Distinct, ordered date string for index i (content is opaque to the adapter). */
function dateAt(i: number): string {
  const d = new Date(Date.UTC(2024, 0, 1) + i * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** Alternating ±a fixture of `n` finite daily returns. */
function alternating(n: number, a: number): { date: string; value: number }[] {
  return Array.from({ length: n }, (_, i) => ({
    date: dateAt(i),
    value: i % 2 === 0 ? a : -a,
  }));
}

const A = 0.0075;
const ALT_320 = alternating(320, A); // ≥ 300, clears every window (63/126/252)
const ALT_300 = alternating(300, A);

describe("deriveBlendPanels — public-shape + backbone-routing behaviour", () => {
  it("normal path (300 finite points, window 126, basis 252): all five series populated, shapes correct", () => {
    const window = 126;
    const panels: BlendPanelSeries = deriveBlendPanels(ALT_300, window, 252);
    const n = ALT_300.length;

    // rollingVol / rollingSortino are {date,value}[] of length n − window + 1
    expect(panels.rollingVol).toHaveLength(n - window + 1);
    expect(panels.rollingSortino).toHaveLength(n - window + 1);

    // First point dated at the window's last day (leading warmup dropped)
    expect(panels.rollingVol[0].date).toBe(ALT_300[window - 1].date);
    expect(panels.rollingSortino[0].date).toBe(ALT_300[window - 1].date);

    // rollingSharpe keyed EXACTLY "sharpe_365d" (frozen chart-accent contract)
    expect(Object.keys(panels.rollingSharpe)).toEqual(["sharpe_365d"]);
    expect(panels.rollingSharpe.sharpe_365d).toHaveLength(n - window + 1);
    expect(panels.rollingSharpe.sharpe_365d[0].date).toBe(ALT_300[window - 1].date);

    // Every derived series populated + quantiles present
    expect(panels.histogramSeries.length).toBeGreaterThan(0);
    expect(Object.keys(panels.quantiles)).toEqual(["All"]);
    expect(panels.usableN).toBe(n);
  });

  it("quantiles = { All: [min, p25, p50, p75, max] } with absolute-min/max tails", () => {
    const window = 126;
    const panels = deriveBlendPanels(ALT_300, window, 252);
    const vals = ALT_300.map((p) => p.value);
    const q = panels.quantiles.All;
    expect(q).toHaveLength(5);
    expect(q[0]).toBe(Math.min(...vals)); // absolute min tail
    expect(q[4]).toBe(Math.max(...vals)); // absolute max tail
    // median of a balanced alternating ±a series ≈ 0
    expect(q[2]).toBeCloseTo(0, 10);
  });

  it("histogramSeries is the cumprod(1+r) wealth series, same length/dates as input", () => {
    const window = 126;
    const panels = deriveBlendPanels(ALT_300, window, 252);
    expect(panels.histogramSeries).toHaveLength(ALT_300.length);
    // Reconstruct the expected cumulative wealth independently.
    let c = 1;
    const expected = ALT_300.map((p) => {
      c *= 1 + p.value;
      return { date: p.date, value: c };
    });
    expect(panels.histogramSeries[0].value).toBeCloseTo(expected[0].value, 12);
    expect(panels.histogramSeries[0].date).toBe(expected[0].date);
    const last = panels.histogramSeries.length - 1;
    expect(panels.histogramSeries[last].value).toBeCloseTo(expected[last].value, 12);
    expect(panels.histogramSeries[last].date).toBe(expected[last].date);
  });

  it("emitted rolling series carry no null-valued points (leading-warmup drop is exact)", () => {
    const window = 63;
    const panels = deriveBlendPanels(ALT_320, window, 252);
    for (const pt of panels.rollingVol) expect(pt.value).not.toBeNull();
    for (const pt of panels.rollingSharpe.sharpe_365d) expect(pt.value).not.toBeNull();
    for (const pt of panels.rollingSortino) expect(pt.value).not.toBeNull();
    expect(panels.rollingVol).toHaveLength(ALT_320.length - window + 1);
    expect(panels.rollingVol[0].date).toBe(ALT_320[window - 1].date);
  });

  // ── Re-homed usableN degenerate gate (WR-02 contract) ──────────────────
  it("non-finite value anywhere → usableN === 0 and every series collapses", () => {
    const poisoned = [
      ...alternating(20, A),
      { date: dateAt(20), value: Number.NaN },
    ];
    const panels = deriveBlendPanels(poisoned, 63, 252);
    expect(panels.usableN).toBe(0);
    expect(panels.histogramSeries).toEqual([]);
    expect(panels.quantiles).toEqual({});
    expect(panels.rollingSharpe).toEqual({});
    expect(panels.rollingVol).toEqual([]);
    expect(panels.rollingSortino).toEqual([]);
  });

  it("length 9 (< MIN_USABLE 10) → collapse, usableN === 9 (real count preserved)", () => {
    const short = alternating(9, A);
    const panels = deriveBlendPanels(short, 5, 252);
    expect(panels.usableN).toBe(9);
    expect(panels.histogramSeries).toEqual([]);
    expect(panels.rollingVol).toEqual([]);
  });

  it("length 50 with window 126 (≥10 but < window) → collapse, usableN === 50", () => {
    const fifty = alternating(50, A);
    const panels = deriveBlendPanels(fifty, 126, 252);
    expect(panels.usableN).toBe(50);
    expect(panels.histogramSeries).toEqual([]);
    expect(panels.rollingVol).toEqual([]);
  });
});

// ── SC-4 parity pins — POPULATION-std at each window (mutation-falsifiable) ──
//
// WHY THIS MATTERS (CLAUDE.md Rule 9; 108-CONTEXT §Parity std): the retired
// legacy module used SAMPLE std (÷ n−1); the canonical backbone
// (`factsheet/rolling.ts::pstdev`) uses POPULATION std (÷ n). USER DECISION:
// the backbone (population-std) value is canonical — one rolling-std path — so
// these pins encode the POPULATION value, an INTENTIONAL convention unification,
// NOT a regression.
//
// Closed-form derivation (never call the primitive under test — no circular
// oracle): an EVEN-length window of alternating ±A has mean 0 and population
// σ = A EXACTLY (Σ(x−0)² = w·A², ÷ w = A²). An ODD window w has mean ±A/w and
// population σ = A·√(1 − 1/w²) (Σx² = w·A², minus w·mean² = A²/w, ÷ w). A
// SAMPLE-std source multiplies σ by √(w/(w−1)); for w=126 that moves the
// annualized value from 0.0075·√252 ≈ 0.119059 to ≈ 0.119534 — a shift at the
// 4th decimal that FAILS the 6-decimal assertion. Mutating the adapter's vol
// path by √(w/(w−1)) turns these RED (falsifiability spot-check performed once
// locally, then reverted).
describe("deriveBlendPanels — SC-4 population-std parity pins (63/126/252)", () => {
  const sqrt252 = Math.sqrt(252);
  // Expected POPULATION-std annualized rolling vol per window.
  const expectedVol = (w: number): number =>
    w % 2 === 0
      ? A * sqrt252 // even window: σ = A exactly
      : A * Math.sqrt(1 - 1 / (w * w)) * sqrt252; // odd window: σ = A·√(1−1/w²)

  for (const w of [63, 126, 252]) {
    it(`rollingVol at window ${w} equals the POPULATION closed-form (sample-std bleed fails @6dp)`, () => {
      const panels = deriveBlendPanels(ALT_320, w, 252);
      const want = expectedVol(w);
      // Fixture is perfectly alternating → EVERY window carries the same value.
      expect(panels.rollingVol[0].value).toBeCloseTo(want, 6);
      const mid = panels.rollingVol[Math.floor(panels.rollingVol.length / 2)];
      expect(mid.value).toBeCloseTo(want, 6);
      // Mutation guard: the SAMPLE-std value (× √(w/(w−1))) must NOT match @6dp.
      const sampleBleed = want * Math.sqrt(w / (w - 1));
      expect(panels.rollingVol[0].value).not.toBeCloseTo(sampleBleed, 6);
    });
  }

  it("even-window Sharpe & Sortino are exactly 0 (mean 0) — closed-form spot pin", () => {
    // Cheap closed-form pin (rolling.ts:99-137): for an even alternating ±A
    // window mean = 0, so the numerator (m·N) is 0 → Sharpe = Sortino = 0.
    for (const w of [126, 252]) {
      const panels = deriveBlendPanels(ALT_320, w, 252);
      expect(panels.rollingSharpe.sharpe_365d[0].value).toBeCloseTo(0, 12);
      expect(panels.rollingSortino[0].value).toBeCloseTo(0, 12);
    }
  });

  it("window-toggle contract: explicit window drives the compute (lengths n−w+1)", () => {
    const n = ALT_320.length;
    expect(deriveBlendPanels(ALT_320, 63, 252).rollingVol).toHaveLength(n - 63 + 1);
    expect(deriveBlendPanels(ALT_320, 126, 252).rollingVol).toHaveLength(n - 126 + 1);
    expect(deriveBlendPanels(ALT_320, 252, 252).rollingVol).toHaveLength(n - 252 + 1);
  });

  it("min/max whisker pin: top whisker is the absolute max (a p05/p95 bleed fails)", () => {
    // USER DECISION §Quantile whiskers: tails are absolute min/max, NOT p05/p95.
    // One +0.05 max outlier and one −0.04 min outlier among ~small returns — a
    // p95 substitution produces a strictly SMALLER top whisker (~0.002) → fails.
    const smalls = Array.from({ length: 98 }, (_, i) => ({
      date: dateAt(i),
      value: i % 2 === 0 ? 0.002 : -0.002,
    }));
    const outlierFix = [
      { date: dateAt(98), value: 0.05 }, // absolute max
      { date: dateAt(99), value: -0.04 }, // absolute min
      ...smalls,
    ];
    const panels = deriveBlendPanels(outlierFix, 63, 252);
    const vals = outlierFix.map((p) => p.value);
    expect(panels.quantiles.All[4]).toBe(0.05); // absolute max, p95 cannot reach
    expect(panels.quantiles.All[4]).toBe(Math.max(...vals));
    expect(panels.quantiles.All[0]).toBe(-0.04); // absolute min, p05 cannot reach
    expect(panels.quantiles.All[0]).toBe(Math.min(...vals));
  });
});
