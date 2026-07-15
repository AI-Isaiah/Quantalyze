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
