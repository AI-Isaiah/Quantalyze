import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { DailyPoint } from "./portfolio-math-utils";
import { computeRollingMetric } from "./portfolio-stats";
import { buildBlendPanels } from "./scenario-blend-panels";

// ── Deterministic fixtures (no Math.random — mirror portfolio-stats.test.ts:23-26) ──
// A 252-pt sinusoidal daily-return series. `value` is a DAILY RETURN (~±0.02),
// NOT a cumulative wealth value.
const DAILY: DailyPoint[] = Array.from({ length: 252 }, (_, i) => ({
  date: new Date(2025, 0, 2 + i).toISOString().slice(0, 10),
  value: (Math.sin(i / 20) * 0.02 + 0.0003) * (1 + Math.cos(i / 50) * 0.5),
}));

/** Constant daily return — closed-form vol anchor for the 252-only test. */
const CONSTANT: DailyPoint[] = Array.from({ length: 100 }, (_, i) => ({
  date: new Date(2025, 0, 2 + i).toISOString().slice(0, 10),
  value: 0.001,
}));

const WINDOW = 63;

describe("buildBlendPanels — convention pins", () => {
  // ── 1. sample-std parity (vol) ──────────────────────────────────────
  // PROVES "mirror portfolio-stats.ts (sample-std n-1), NOT factsheet/rolling.ts
  // (population std ÷n)". This assert FAILS if the adapter uses population std.
  it("sample-std parity: rollingVol equals computeRollingMetric volatility point-for-point", () => {
    const panels = buildBlendPanels(DAILY, WINDOW);
    const ref = computeRollingMetric(DAILY, WINDOW, "volatility");

    expect(panels.rollingVol.length).toBe(ref.length);
    expect(panels.rollingVol.length).toBeGreaterThan(0); // non-vacuity
    for (let i = 0; i < ref.length; i++) {
      expect(panels.rollingVol[i].date).toBe(ref[i].date);
      expect(panels.rollingVol[i].value).toBeCloseTo(ref[i].value, 8);
    }
  });

  // ── 2. sharpe convention ────────────────────────────────────────────
  // rolling Sharpe = mean × √252 ÷ sample-std — parity vs computeRollingMetric.
  // Keyed `sharpe_365d` so RollingMetrics resolves CHART_ACCENT.
  it("sharpe convention: rollingSharpe[sharpe_365d] equals computeRollingMetric sharpe", () => {
    const panels = buildBlendPanels(DAILY, WINDOW);
    const ref = computeRollingMetric(DAILY, WINDOW, "sharpe");
    const series = panels.rollingSharpe["sharpe_365d"];

    expect(series).toBeDefined();
    expect(series.length).toBe(ref.length);
    expect(series.length).toBeGreaterThan(0); // non-vacuity
    for (let i = 0; i < ref.length; i++) {
      expect(series[i].date).toBe(ref[i].date);
      expect(series[i].value).toBeCloseTo(ref[i].value, 8);
    }
  });

  // ── 3. sortino ÷ TOTAL window n ─────────────────────────────────────
  // On a tiny hand-checkable window, assert downside RMS divides by the FULL
  // window length (n), NOT the count of down days; numerator = mean × 252.
  // This assert FAILS if the adapter divides by down-day count.
  it("sortino divides downside RMS by the TOTAL window n (not down-day count)", () => {
    // 5-pt window, 2 down days. Hand-computed against ÷n=5 (NOT ÷downDays=2).
    const r = [0.02, -0.01, 0.03, -0.02, 0.01];
    const tiny: DailyPoint[] = r.map((value, i) => ({
      date: new Date(2025, 0, 2 + i).toISOString().slice(0, 10),
      value,
    }));
    const window = 5;

    const m = r.reduce((s, v) => s + v, 0) / r.length; // 0.006
    let downSq = 0;
    for (const x of r) if (x < 0) downSq += x * x; // 0.0001 + 0.0004 = 0.0005
    const ddByN = Math.sqrt(downSq / window) * Math.sqrt(252); // ÷5
    const expected = ddByN > 0 ? (m * 252) / ddByN : 0;

    // The WRONG convention (÷ down-day count) would give a different value —
    // assert we are NOT that, proving the pin.
    const ddByDownDays = Math.sqrt(downSq / 2) * Math.sqrt(252);
    const wrong = (m * 252) / ddByDownDays;

    const panels = buildBlendPanels(tiny, window);
    expect(panels.rollingSortino.length).toBe(1);
    expect(panels.rollingSortino[0].value).toBeCloseTo(expected, 10);
    expect(panels.rollingSortino[0].value).not.toBeCloseTo(wrong, 6);
  });

  // ── 4. 252-only annualization ───────────────────────────────────────
  // (a) numeric anchor: constant-return → vol matches stdDev(slice,true) × √252.
  //     For a constant slice, sample std = 0 → vol = 0 exactly.
  // (b) source-read assertion: the live adapter module body contains no √365 /
  //     *365 / √250 pattern (read the .ts via fs — non-vacuous, not a constant).
  it("252-only: constant-return vol uses √252 and source has no 365/250 annualization", () => {
    const panels = buildBlendPanels(CONSTANT, 30);
    // Constant returns ⇒ sample std 0 ⇒ vol 0 (× √252 of zero is still zero).
    for (const pt of panels.rollingVol) {
      expect(pt.value).toBeCloseTo(0, 12);
    }

    // Non-vacuous source assertion: read the ADAPTER module text, not a re-export.
    const src = readFileSync(
      path.join(__dirname, "scenario-blend-panels.ts"),
      "utf8",
    );
    expect(src).not.toMatch(
      /√365|√250|\*\s*365|\*\s*250|Math\.sqrt\(\s*365\s*\)|Math\.sqrt\(\s*250\s*\)/,
    );
  });

  // ── 5. histogram cumulative-wealth ──────────────────────────────────
  // PROVES Pitfall 1 fixed: histogramSeries is cumprod(1+r) wealth (~1.0), so
  // piping it through the leaf's `v/cumulative[i]-1` recovers the ORIGINAL daily
  // returns. This assert FAILS if raw daily returns are passed (wealth-ratio
  // garbage would NOT round-trip to the original distribution).
  it("histogramSeries is cumulative wealth that round-trips to the original daily returns", () => {
    const panels = buildBlendPanels(DAILY, WINDOW);
    const series = panels.histogramSeries;

    expect(series.length).toBe(DAILY.length);
    // Starts near 1.0 (wealth form), not near 0 (raw daily form).
    expect(series[0].value).toBeCloseTo(1 + DAILY[0].value, 12);

    // Re-derive daily returns exactly as ReturnHistogram.tsx:37-38 does.
    const cumulative = series.map((p) => p.value);
    const recovered = cumulative
      .slice(1)
      .map((v, i) => (cumulative[i] !== 0 ? v / cumulative[i] - 1 : 0));

    // Recovered daily returns must equal DAILY[1..] — the original distribution.
    expect(recovered.length).toBe(DAILY.length - 1);
    for (let i = 0; i < recovered.length; i++) {
      expect(recovered[i]).toBeCloseTo(DAILY[i + 1].value, 10);
    }
  });

  // ── 6. quantiles monotonic ──────────────────────────────────────────
  // Each record value is non-decreasing [q0 ≤ q25 ≤ q50 ≤ q75 ≤ q100].
  it("quantiles record values are non-decreasing 5-number summaries", () => {
    const panels = buildBlendPanels(DAILY, WINDOW);
    const keys = Object.keys(panels.quantiles);
    expect(keys.length).toBeGreaterThan(0); // non-vacuity
    for (const key of keys) {
      const q = panels.quantiles[key];
      expect(q.length).toBe(5);
      for (let i = 1; i < q.length; i++) {
        expect(q[i]).toBeGreaterThanOrEqual(q[i - 1]);
      }
    }
  });

  // ── 7. degenerate → []/{} (positive + negative control) ─────────────
  // length<window, <10 points, and a non-finite-injected series EACH return
  // empty for every series; a healthy 252-pt series returns NON-empty (proves
  // non-vacuity — the degenerate branch is not collapsing the healthy path too).
  it("degenerate inputs return []/{} for every series; healthy input is non-empty", () => {
    // Positive control: healthy series is non-empty.
    const healthy = buildBlendPanels(DAILY, WINDOW);
    expect(healthy.rollingVol.length).toBeGreaterThan(0);
    expect(healthy.rollingSortino.length).toBeGreaterThan(0);
    expect(Object.keys(healthy.rollingSharpe).length).toBeGreaterThan(0);
    expect(healthy.histogramSeries.length).toBeGreaterThan(0);
    expect(Object.keys(healthy.quantiles).length).toBeGreaterThan(0);

    const expectEmpty = (panels: ReturnType<typeof buildBlendPanels>) => {
      expect(panels.rollingVol).toEqual([]);
      expect(panels.rollingSortino).toEqual([]);
      expect(panels.rollingSharpe).toEqual({});
      expect(panels.histogramSeries).toEqual([]);
      expect(panels.quantiles).toEqual({});
    };

    // (a) length < window
    expectEmpty(buildBlendPanels(DAILY.slice(0, WINDOW - 1), WINDOW));

    // (b) < 10 usable points (MIN_USABLE floor)
    expectEmpty(buildBlendPanels(DAILY.slice(0, 9), 5));

    // (c) non-finite value present (NaN / Infinity) — whole series collapses.
    const withNaN: DailyPoint[] = DAILY.map((p, i) =>
      i === 100 ? { ...p, value: NaN } : p,
    );
    expectEmpty(buildBlendPanels(withNaN, WINDOW));

    const withInf: DailyPoint[] = DAILY.map((p, i) =>
      i === 50 ? { ...p, value: Infinity } : p,
    );
    expectEmpty(buildBlendPanels(withInf, WINDOW));
  });
});
