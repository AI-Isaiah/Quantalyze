import { describe, it, expect } from "vitest";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import { compute, cumEq, drawdowns } from "@/lib/factsheet/compute";
import { bootstrapCI } from "@/lib/factsheet/bootstrap";
import { quantileSummary } from "@/lib/factsheet/quantiles";
import { buildScenarioFactsheetPayload } from "./scenario-factsheet-payload";

// ── Deterministic fixtures (no Math.random) ──────────────────────────
// The payload is SINGLE-AXIS off the engine's `portfolio_daily_returns` (daily
// RETURN form, decimal) — WR-01. `value` here is a daily return, NOT cumulative
// wealth. UTC ISO dates so compute()'s 365.25-CAGR axis is reproducible.
const ymd = (i: number) =>
  new Date(Date.UTC(2025, 0, i + 1)).toISOString().slice(0, 10);

// A 30-day returns blend with a run of negative days (10..14) so the equity
// curve dips and a drawdown is observable.
const RETS: DailyPoint[] = Array.from({ length: 30 }, (_, i) => ({
  date: ymd(i),
  value: i >= 10 && i < 15 ? -0.01 : 0.005,
}));

// A benchmark whose dates are a SUBSET of the returns axis (skips even days
// past index 4, and ends two days short) so the missing-day → null path is
// exercised on both interior gaps and a trailing gap.
const BENCH: DailyPoint[] = RETS.filter(
  (_, i) => i < 28 && (i < 5 || i % 2 === 0),
).map((p) => ({ date: p.date, value: 0.9 }));

describe("buildScenarioFactsheetPayload — convention pins", () => {
  // ── 1. canonical dates axis = the FULL-RES returns axis; equity = cumEq(rets) (WR-01) ──
  it("dates is the returns axis and strategyEquity === cumEq(rets) full-res", () => {
    const p = buildScenarioFactsheetPayload({ portfolioDaily: RETS });
    const rets = RETS.map((d) => d.value);
    expect(p.dates).toEqual(RETS.map((d) => d.date));
    expect(p.strategyEquity.length).toBe(RETS.length);
    const eq = cumEq(rets);
    for (let i = 0; i < RETS.length; i++) {
      expect(p.strategyEquity[i]).toBeCloseTo(eq[i], 12);
    }
  });

  // ── 2. benchmark index-aligned into comparators.btc.cumulative, missing → null ──
  it("benchmark aligns to dates with missing days as null (interior + trailing gaps)", () => {
    const p = buildScenarioFactsheetPayload({ portfolioDaily: RETS, benchmark: BENCH });
    const cum = p.comparators.btc.cumulative;
    expect(cum).not.toBeNull();
    expect(cum!.length).toBe(RETS.length);

    const benchByDate = new Map(BENCH.map((b) => [b.date, b.value]));
    for (let i = 0; i < RETS.length; i++) {
      const expected = benchByDate.has(RETS[i].date)
        ? benchByDate.get(RETS[i].date)!
        : null;
      expect(cum![i]).toBe(expected);
    }
    // Non-vacuity: at least one real value AND at least one null gap.
    expect(cum!.some((v) => v != null)).toBe(true);
    expect(cum!.some((v) => v == null)).toBe(true);
  });

  // ── 3. activeComparator switching by benchmark presence ─────────────
  it('activeComparator is "btc" with a benchmark, "none" without (cumulative null)', () => {
    const withBench = buildScenarioFactsheetPayload({ portfolioDaily: RETS, benchmark: BENCH });
    expect(withBench.activeComparator).toBe("btc");

    const noBench = buildScenarioFactsheetPayload({ portfolioDaily: RETS });
    expect(noBench.activeComparator).toBe("none");
    expect(noBench.comparators.btc.cumulative).toBeNull();

    const emptyBench = buildScenarioFactsheetPayload({ portfolioDaily: RETS, benchmark: [] });
    expect(emptyBench.activeComparator).toBe("none");
    expect(emptyBench.comparators.btc.cumulative).toBeNull();
  });

  // ── 4. drawdowns derive from the shared full-res helper (WR-01) ──
  it("strategyDrawdowns equals drawdowns(cumEq(rets)) point-for-point", () => {
    const p = buildScenarioFactsheetPayload({ portfolioDaily: RETS });
    const rets = RETS.map((d) => d.value);
    const ref = drawdowns(cumEq(rets));
    expect(p.strategyDrawdowns.length).toBe(RETS.length);
    for (let i = 0; i < ref.length; i++) {
      expect(p.strategyDrawdowns[i]).toBeCloseTo(ref[i], 12);
    }
    // Non-vacuity: the negative run produced an actual negative drawdown.
    expect(p.strategyDrawdowns.some((v) => v < 0)).toBe(true);
  });

  // ── 5. blank-slate (scenario present via portfolioDaily) renders (PARITY-03 precondition) ──
  it("blank-slate: a present returns series yields non-empty equity + dates", () => {
    const p = buildScenarioFactsheetPayload({ portfolioDaily: RETS });
    expect(p.strategyEquity.length).toBeGreaterThan(0);
    expect(p.dates.length).toBeGreaterThan(0);
  });

  // ── 6. degenerate input collapses safely (never throws) ─────────────
  it("absent/empty portfolioDaily collapses to a safe empty payload", () => {
    const p = buildScenarioFactsheetPayload({});
    expect(p.dates).toEqual([]);
    expect(p.strategyEquity).toEqual([]);
    expect(p.strategyDrawdowns).toEqual([]);
    expect(p.comparators.btc.cumulative).toBeNull();
    expect(p.activeComparator).toBe("none");

    const pEmpty = buildScenarioFactsheetPayload({ portfolioDaily: [] });
    expect(pEmpty.dates).toEqual([]);
    expect(pEmpty.strategyEquity).toEqual([]);
  });

  it("a non-finite return collapses to a safe empty payload (no NaN propagation)", () => {
    const poisoned: DailyPoint[] = [
      { date: ymd(0), value: 0.01 },
      { date: ymd(1), value: Number.NaN },
      { date: ymd(2), value: 0.02 },
    ];
    expect(() => buildScenarioFactsheetPayload({ portfolioDaily: poisoned })).not.toThrow();
    const p = buildScenarioFactsheetPayload({ portfolioDaily: poisoned });
    expect(p.dates).toEqual([]);
    expect(p.strategyEquity).toEqual([]);
  });

  it("an Infinity return collapses to a safe empty payload", () => {
    const poisoned: DailyPoint[] = [
      { date: ymd(0), value: 0.01 },
      { date: ymd(1), value: Number.POSITIVE_INFINITY },
    ];
    const p = buildScenarioFactsheetPayload({ portfolioDaily: poisoned });
    expect(p.dates).toEqual([]);
    expect(p.strategyEquity).toEqual([]);
  });

  // ── 7. safe defaults for the unused FactsheetCommon fields ──────────
  it("safe-defaults the unused fields and uses the csv arm (degenerate body)", () => {
    const p = buildScenarioFactsheetPayload({});
    expect(p.ingestSource).toBe("csv");
    expect(p.strategyName).toBe("Scenario");
    expect(p.strategyId).toBe("scenario");
    expect(p.rollingWindow.enough).toBe(false);
    expect(p.rollingBetaWindow.enough).toBe(false);
    expect(p.strategyWorst10).toEqual([]);
    expect(p.strategyReturns).toEqual([]);
    // Zeroed ComputeSummary (no KpiStrip in the composer).
    expect(p.strategyMetrics.cum_ret).toBe(0);
    expect(p.strategyMetrics.sharpe).toBe(0);
    expect(p.strategyMetrics.yearly).toEqual({});
    // The three comparator blocks all exist (none is the inert slot).
    expect(p.comparators.spx.cumulative).toBeNull();
    expect(p.comparators.none.cumulative).toBeNull();
  });

  it("a custom strategyId flows through to the payload (storage-key scoping)", () => {
    const p = buildScenarioFactsheetPayload({ portfolioDaily: RETS, strategyId: "scenario:abc" });
    expect(p.strategyId).toBe("scenario:abc");
  });

});

// ── Phase 39: complete-payload parity (PAYLOAD-01..05) ────────────────
// Deterministic returns-form blends (daily RETURN, decimal). UTC ISO dates,
// consecutive calendar days, so compute()'s 365.25-CAGR axis is reproducible.
// NO Math.random — bootstrapCI is internally seeded (seed=42).
const ymdUTC = (i: number) =>
  new Date(Date.UTC(2024, 0, i + 1)).toISOString().slice(0, 10);

// 30-day blend → n=30 → the n<252 caveat is ON. Alternating ±, net-positive
// (mirrors compute.metrics.test.ts): mean = 0.0025, population σ = 0.0075 exactly.
const BLEND_30: DailyPoint[] = Array.from({ length: 30 }, (_, i) => ({
  date: ymdUTC(i),
  value: i % 2 === 0 ? 0.01 : -0.005,
}));

// 252-day blend → n=252 → the n<252 caveat is OFF at exactly 252 (m.n < 252 false).
const BLEND_252: DailyPoint[] = Array.from({ length: 252 }, (_, i) => ({
  date: ymdUTC(i),
  value: i % 2 === 0 ? 0.002 : 0,
}));

describe("buildScenarioFactsheetPayload — complete-payload parity (Phase 39)", () => {
  // ── PAYLOAD-01 / PAYLOAD-03: field-by-field parity vs compute(rets,dates) ──
  it("strategyMetrics equals compute(rets,dates) field-by-field at 1e-6 (no zeroed summary)", () => {
    const rets = BLEND_30.map((p) => p.value);
    const dates = BLEND_30.map((p) => p.date);
    const ref = compute(rets, dates);
    const p = buildScenarioFactsheetPayload({
      portfolioDaily: BLEND_30,
    });
    // Every numeric scalar of compute() (excluding the heavy eq/dd arrays and
    // the yearly map asserted separately) must round-trip to 6 decimals.
    for (const k of Object.keys(ref) as (keyof typeof ref)[]) {
      if (k === "eq" || k === "dd" || k === "yearly") continue;
      const refVal = ref[k];
      if (typeof refVal === "number") {
        expect(
          p.strategyMetrics[k as keyof typeof p.strategyMetrics] as number,
          `strategyMetrics.${String(k)} must equal compute().${String(k)}`,
        ).toBeCloseTo(refVal, 6);
      }
    }
    // Not the zeroed summary: a real strategy carries non-zero scalars.
    expect(p.strategyMetrics.cum_ret).not.toBe(0);
    expect(p.strategyMetrics.ann_vol).toBeGreaterThan(0);
    expect(p.strategyMetrics.yearly).toEqual(ref.yearly);
  });

  // ── PAYLOAD-03 convention-drift pin (mutation-falsifiable) ──────────────
  // WHY THIS MATTERS (CLAUDE.md Rule 9): compute.ts uses POPULATION stdev
  // (÷ n). scenario-blend-panels.ts uses SAMPLE stdev (÷ n−1). For the 30-day
  // fixture the population σ is exactly 0.0075, so ann_vol = 0.0075·√252. A
  // sample-std bleed yields σ = √(SS/29) → ann_vol ≈ 0.12110, which differs at
  // the 3rd decimal and FAILS this 6-decimal assertion loudly. Mutating the
  // adapter to feed a sample-std rolling/metric source turns this test RED —
  // that is the whole point of pinning the population value here.
  it("ann_vol is the POPULATION-std value 0.0075·√252 — a sample-std bleed fails", () => {
    const p = buildScenarioFactsheetPayload({
      portfolioDaily: BLEND_30,
    });
    expect(p.strategyMetrics.ann_vol).toBeCloseTo(0.0075 * Math.sqrt(252), 6);
  });

  // ── PAYLOAD-04: n = true overlap count (= portfolioDaily.length) ──
  it("strategyMetrics.n === portfolioDaily.length: caveat ON at 30, OFF at exactly 252", () => {
    const p30 = buildScenarioFactsheetPayload({
      portfolioDaily: BLEND_30,
    });
    expect(p30.strategyMetrics.n).toBe(30);
    expect(p30.strategyMetrics.n < 252).toBe(true); // low-sample caveat fires

    const p252 = buildScenarioFactsheetPayload({
      portfolioDaily: BLEND_252,
    });
    expect(p252.strategyMetrics.n).toBe(252);
    expect(p252.strategyMetrics.n < 252).toBe(false); // caveat OFF at exactly 252
  });

  // ── PAYLOAD-02: panel arrays populated from the pure helpers, not [] ──────
  it("panel arrays are populated from compute()/helpers (not empty), bootstrapCI deterministic", () => {
    const rets = BLEND_252.map((p) => p.value);
    const p = buildScenarioFactsheetPayload({
      portfolioDaily: BLEND_252,
    });
    expect(p.calmarByYear.length).toBeGreaterThan(0);
    expect(p.monthlyReturns.length).toBeGreaterThan(0);
    expect(p.dailyHeatmap.length).toBeGreaterThan(0);
    expect(p.strategyReturns).toEqual(rets);
    expect(p.streaks.totalWins + p.streaks.totalLosses).toBeGreaterThan(0);
    // strategyWorst10 is exercised on BLEND_30, which has down days (a
    // monotone-non-decreasing series like BLEND_252 genuinely has NO drawdown).
    const pDip = buildScenarioFactsheetPayload({
      portfolioDaily: BLEND_30,
    });
    expect(pDip.strategyWorst10.length).toBeGreaterThan(0);
    expect(pDip.strategyWorst10[0].depth).toBeLessThan(0);
    // Rolling series populated for a 252-day blend (post-warmup values exist).
    expect(p.strategyRollingVol.some((v) => v != null)).toBe(true);
    expect(p.strategyRollingSharpe.some((v) => v != null)).toBe(true);
    expect(p.strategyRollingSortino.some((v) => v != null)).toBe(true);
    // quantiles match the shared parity source.
    expect(p.quantiles).toEqual(quantileSummary(rets));
    // bootstrapCI is internally seeded → deterministic vs a fresh call.
    expect(p.bootstrapCI.sharpe.point).toBeCloseTo(bootstrapCI(rets).sharpe.point, 6);
    // stressWindows populated with an honest empty benchName (D-4).
    expect(p.stressWindows.benchName).toBe("");
  });

  // ── Honesty invariants (D-5/D-6/D-7) ─────────────────────────────────────
  it("styleDrift null, correlations honest-empty, ingestSource csv, 4 synth panels absent", () => {
    const p = buildScenarioFactsheetPayload({
      portfolioDaily: BLEND_30,
    });
    expect(p.styleDrift).toBeNull();
    expect(p.correlations).toEqual([]);
    expect(p.correlationMatrix).toEqual({ labels: [], matrix: [] });
    expect(p.ingestSource).toBe("csv");
    // Mirrors audit-c20.test.ts: the synthesized api-only panels are structurally
    // ABSENT (not null) on the csv arm — `in payload === false`. A flip to the
    // "api" arm would make these present and fail loudly.
    for (const f of [
      "peerPercentile",
      "allocatorPortfolios",
      "eventSignatures",
      "benchEventSignatures",
    ]) {
      expect(f in p, `${f} must be absent on the csv scenario payload`).toBe(false);
    }
  });

  // ── PAYLOAD-05: degenerate returns collapse to safe-empty BEFORE compute() ─
  it("empty portfolioDaily → safe-empty metrics/panels, never throws (compute not called)", () => {
    expect(() =>
      buildScenarioFactsheetPayload({
        portfolioDaily: [],
      }),
    ).not.toThrow();
    const p = buildScenarioFactsheetPayload({
      portfolioDaily: [],
    });
    expect(p.strategyMetrics.cum_ret).toBe(0);
    expect(p.strategyMetrics.sharpe).toBe(0);
    expect(p.strategyMetrics.n).toBe(0);
    expect(p.strategyMetrics.yearly).toEqual({});
    expect(p.calmarByYear).toEqual([]);
    expect(p.monthlyReturns).toEqual([]);
    expect(p.strategyReturns).toEqual([]);
    expect(p.strategyWorst10).toEqual([]);
  });

  it("a non-finite return → safe-empty body, no NaN/Inf into any panel", () => {
    const poisoned: DailyPoint[] = [
      { date: ymdUTC(0), value: 0.01 },
      { date: ymdUTC(1), value: Number.NaN },
      { date: ymdUTC(2), value: 0.02 },
    ];
    const p = buildScenarioFactsheetPayload({
      portfolioDaily: poisoned,
    });
    expect(p.strategyMetrics.n).toBe(0);
    expect(p.strategyMetrics.ann_vol).toBe(0);
    expect(Number.isFinite(p.strategyMetrics.ann_vol)).toBe(true);
    expect(p.calmarByYear).toEqual([]);
    expect(p.quantiles).toEqual({
      p05: 0,
      p25: 0,
      p50: 0,
      p75: 0,
      p95: 0,
      min: 0,
      max: 0,
      mean: 0,
    });
  });

  it("a single dated return (<2 points) → safe-empty body (compute's period math needs ≥2)", () => {
    const single: DailyPoint[] = [{ date: ymdUTC(0), value: 0.01 }];
    const p = buildScenarioFactsheetPayload({
      portfolioDaily: single,
    });
    expect(p.strategyMetrics.n).toBe(0);
    expect(p.strategyReturns).toEqual([]);
  });

  // WR-01 fix: the equity/drawdown LINE is now the FULL-RES returns axis —
  // `strategyEquity === cumEq(rets)` and `strategyDrawdowns === drawdowns(cumEq
  // (rets))` exactly. (Inverts the old Phase-38 two-axis pin, which tracked the
  // downsampled wealth series.)
  it("strategyEquity/strategyDrawdowns track cumEq(rets)/drawdowns(cumEq(rets)) (WR-01 single-axis)", () => {
    const rets = BLEND_30.map((p) => p.value);
    const p = buildScenarioFactsheetPayload({
      portfolioDaily: BLEND_30,
    });
    const eqRef = cumEq(rets);
    const ddRef = drawdowns(eqRef);
    expect(p.strategyEquity.length).toBe(rets.length);
    expect(p.strategyDrawdowns.length).toBe(rets.length);
    for (let i = 0; i < rets.length; i++) {
      expect(p.strategyEquity[i]).toBeCloseTo(eqRef[i], 12);
      expect(p.strategyDrawdowns[i]).toBeCloseTo(ddRef[i], 12);
    }
  });

  // ── WR-01 PERMANENT REGRESSION: single-axis length invariant ──────────────
  // WHY THIS MATTERS (CLAUDE.md Rule 9): a valid FactsheetPayload has ONE date
  // axis — `dates[i] ↔ strategyReturns[i] ↔ strategyEquity[i] ↔
  // strategyDrawdowns[i]`. The pre-fix two-axis adapter sourced `dates`/equity
  // from the DOWNSAMPLED wealth series (length ≈ n/5) while the returns panels
  // were full-resolution (length n), so this assertion would FAIL on it — that
  // is its purpose. The factsheet's TimeSeriesChart indexes every returns/rolling
  // panel against `payload.dates[i]`; a length desync silently misaligns
  // tooltips, CSV rows, and warmup overlays (the Phase-40 footgun WR-01 names).
  it("dates/returns/equity/drawdowns share ONE length for a healthy blend (WR-01)", () => {
    const p = buildScenarioFactsheetPayload({ portfolioDaily: BLEND_252 });
    const n = BLEND_252.length;
    expect(p.dates.length).toBe(n);
    expect(p.strategyReturns.length).toBe(n);
    expect(p.strategyEquity.length).toBe(n);
    expect(p.strategyDrawdowns.length).toBe(n);
    // All-equal in one shot (the load-bearing invariant).
    expect(
      p.dates.length === p.strategyReturns.length &&
        p.dates.length === p.strategyEquity.length &&
        p.dates.length === p.strategyDrawdowns.length,
    ).toBe(true);
    // And the rolling panels index the same axis (full-res too).
    expect(p.strategyRollingVol.length).toBe(n);
    expect(p.strategyRollingSharpe.length).toBe(n);
    expect(p.strategyRollingSortino.length).toBe(n);
  });
});
