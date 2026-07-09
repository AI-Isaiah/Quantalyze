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
    // 10-pt window (the LOCKED MIN_USABLE floor), 3 down days. Hand-computed
    // against ÷n=10 (NOT ÷downDays=3) so length === window ⇒ exactly one point.
    const r = [
      0.02, -0.01, 0.03, -0.02, 0.01, 0.015, -0.005, 0.008, 0.012, 0.004,
    ];
    const tiny: DailyPoint[] = r.map((value, i) => ({
      date: new Date(2025, 0, 2 + i).toISOString().slice(0, 10),
      value,
    }));
    const window = 10;
    const downDayCount = r.filter((x) => x < 0).length; // 3

    const m = r.reduce((s, v) => s + v, 0) / r.length;
    let downSq = 0;
    for (const x of r) if (x < 0) downSq += x * x;
    const ddByN = Math.sqrt(downSq / window) * Math.sqrt(252); // ÷10 (total n)
    const expected = ddByN > 0 ? (m * 252) / ddByN : 0;

    // The WRONG convention (÷ down-day count) would give a different value —
    // assert we are NOT that, proving the pin.
    const ddByDownDays = Math.sqrt(downSq / downDayCount) * Math.sqrt(252);
    const wrong = (m * 252) / ddByDownDays;

    const panels = buildBlendPanels(tiny, window);
    expect(panels.rollingSortino.length).toBe(1);
    expect(panels.rollingSortino[0].value).toBeCloseTo(expected, 10);
    expect(panels.rollingSortino[0].value).not.toBeCloseTo(wrong, 6);
  });

  // ── 4. default √252 basis; annualization flows ONLY through the param ──
  // #597 made the basis a `periodsPerYear` argument (252 default / 365 crypto),
  // so the module is no longer "252-only" — but it must still NOT HARDCODE any
  // alternate basis: the only annualization knob is the parameter.
  // (a) numeric anchor: constant-return → vol matches stdDev(slice,true) × √252
  //     at the DEFAULT. For a constant slice, sample std = 0 → vol = 0 exactly.
  // (b) source-read assertion: the live adapter module body contains no
  //     HARDCODED √365 / *365 / √250 literal (read the .ts via fs — the basis
  //     is threaded via the periodsPerYear variable, never a magic number).
  it("default √252 basis: constant-return vol is 0 and source hardcodes no alternate annualization", () => {
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

  // ── 4b. #597 crypto √365 basis ──────────────────────────────────────
  it("default periodsPerYear is byte-identical to explicit 252 across every series", () => {
    expect(buildBlendPanels(DAILY, WINDOW)).toEqual(
      buildBlendPanels(DAILY, WINDOW, 252),
    );
  });

  it("crypto √365 scales rollingVol/Sharpe by √(365/252) vs √252, point-for-point", () => {
    const p252 = buildBlendPanels(DAILY, WINDOW, 252);
    const p365 = buildBlendPanels(DAILY, WINDOW, 365);
    const scale = Math.sqrt(365 / 252);

    expect(p365.rollingVol.length).toBe(p252.rollingVol.length);
    expect(p365.rollingVol.length).toBeGreaterThan(0); // non-vacuity
    for (let i = 0; i < p252.rollingVol.length; i++) {
      expect(p365.rollingVol[i].value).toBeCloseTo(
        p252.rollingVol[i].value * scale,
        10,
      );
    }

    const s252 = p252.rollingSharpe["sharpe_365d"];
    const s365 = p365.rollingSharpe["sharpe_365d"];
    for (let i = 0; i < s252.length; i++) {
      expect(s365[i].value).toBeCloseTo(s252[i].value * scale, 10);
    }
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

  // ── 8. usableN is the gate signal — must stay consistent with the body ──
  // The composer disables a SegmentedControl window and gates the panel body on
  // `usableN < window`. So usableN MUST mean "points actually usable to chart":
  //   (a) a non-finite-poisoned series collapses EVERY series → 0 usable, so
  //       usableN is 0 (NOT the 251 finite points) — otherwise the 3M/6M window
  //       would enable and render empty charts instead of the awaiting banner.
  //   (b) a merely-too-short but ALL-finite series keeps its real count, so a
  //       re-run at a window it CAN serve is correctly enabled.
  it("usableN: poisoned series → 0 (not finite count); too-short finite series → real count", () => {
    // (a) 251 finite + 1 NaN, window 63: collapses, and usableN is 0 — so
    // `usableN < 63` is true and every window stays disabled / banner shown.
    const poisoned: DailyPoint[] = DAILY.map((p, i) =>
      i === 100 ? { ...p, value: NaN } : p,
    );
    const poisonedPanels = buildBlendPanels(poisoned, WINDOW);
    expect(poisonedPanels.usableN).toBe(0);
    expect(poisonedPanels.usableN).toBeLessThan(WINDOW); // gate → banner, not empty charts

    // (b) 70 all-finite points, window 252 (too short for 252): collapses for
    // THIS window, but usableN is the real 70 — so a re-run at window 63 (which
    // 70 points CAN serve) is correctly enabled, not falsely gated to 0.
    const tooShort = DAILY.slice(0, 70);
    const tooShortPanels = buildBlendPanels(tooShort, 252);
    expect(tooShortPanels.usableN).toBe(70);
    expect(buildBlendPanels(tooShort, WINDOW).rollingVol.length).toBeGreaterThan(0);
  });
});
