import { describe, it, expect } from "vitest";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import { compute, cumEq, drawdowns } from "@/lib/factsheet/compute";
import { bootstrapCI } from "@/lib/factsheet/bootstrap";
import { quantileSummary } from "@/lib/factsheet/quantiles";
import {
  computeScenario,
  buildDateMapCache,
  type StrategyForBuilder,
} from "@/lib/scenario";
import { coverageSpanOf, defaultWindowFor } from "@/lib/scenario-window";
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

// ── Phase 56: coverage-window parity (PARITY-01) ──────────────────────
// The v1.5 engine emits a SHORTER, member-windowed `portfolio_daily_returns`
// when `state.window` is present (Phase 55). This block proves the factsheet
// renders THAT identical shorter series — never a stale union series nor a
// re-derived blend — by running the REAL engine (`computeScenario`) with an
// explicit `window`, feeding its emitted series to the payload builder, and
// asserting the payload body === `compute()`/`cumEq()`/`drawdowns()` on the SAME
// series. This is the Phase 39 union parity contract, extended to the windowed
// path — the single anchor Phase 60's golden re-bake depends on being green.
//
// NOTE (parity_contract_clarification, 56-01-PLAN): we do NOT assert the payload
// metrics equal `m.volatility`/`m.sharpe`/`m.cagr`. `computeScenario` uses SAMPLE
// stdev + a 252-trading-day CAGR year; `compute.ts` uses POPULATION stdev + a
// 365.25-calendar-day year. They differ field-for-field BY DESIGN. The LOCKED
// invariant is single-source-of-truth of the SERIES: same series → same
// `compute()` → parity by construction.

// Deterministic consecutive-day UTC fixtures (no Math.random). Anchored in 2024
// so the axis is reproducible; consecutive calendar days so window bounds are
// simple date strings.
const cwYmd = (i: number) =>
  new Date(Date.UTC(2024, 0, i + 1)).toISOString().slice(0, 10);

/** A minimal StrategyForBuilder: only `id` + `daily_returns` drive the blend;
 *  the scalar/metadata fields are honest null/[] placeholders. */
function cwStrategy(id: string, returns: DailyPoint[]): StrategyForBuilder {
  return {
    id,
    name: id,
    codename: null,
    disclosure_tier: "public",
    strategy_types: [],
    markets: [],
    start_date: null,
    daily_returns: returns,
    cagr: null,
    sharpe: null,
    volatility: null,
    max_drawdown: null,
  };
}

// A: 90 days (2024-01-01 … 2024-03-30), full range.  net-positive alternating.
const CW_A: DailyPoint[] = Array.from({ length: 90 }, (_, i) => ({
  date: cwYmd(i),
  value: i % 2 === 0 ? 0.004 : -0.001,
}));
// B: 90 days, full range, a different but deterministic pattern.
const CW_B: DailyPoint[] = Array.from({ length: 90 }, (_, i) => ({
  date: cwYmd(i),
  value: i % 3 === 0 ? -0.002 : 0.003,
}));
// C: 30 days ONLY (2024-01-01 … 2024-01-30) — ENDS ~1/3 of the way through, so
// the intersection window ends where C ends. C is the ended member.
const CW_C: DailyPoint[] = Array.from({ length: 30 }, (_, i) => ({
  date: cwYmd(i),
  value: i % 2 === 0 ? 0.002 : 0.001,
}));

const CW_STRATS = [cwStrategy("A", CW_A), cwStrategy("B", CW_B), cwStrategy("C", CW_C)];
const CW_SELECTED = { A: true, B: true, C: true };
const CW_WEIGHTS = { A: 1, B: 1, C: 1 };
const CW_CACHE = buildDateMapCache(CW_STRATS);

// The default (intersection) window = [max(firsts), min(lasts)] = [2024-01-01,
// 2024-01-30] (C's early end is the earliest last). All three strategies COVER
// this window (each last >= 2024-01-30), so member_count === 3 here — but the
// AXIS is truncated to C's span, which is strictly shorter than the union.
const CW_SPANS = CW_STRATS
  .map((s) => coverageSpanOf(s.daily_returns))
  .filter((span): span is NonNullable<typeof span> => span !== null);
const CW_WINDOW = defaultWindowFor(CW_SPANS)!;

describe("buildScenarioFactsheetPayload — coverage-window parity (Phase 56, PARITY-01)", () => {
  // Windowed run (explicit intersection window) — the v1.5 present-window path.
  const mWin = computeScenario(
    CW_STRATS,
    { selected: CW_SELECTED, weights: CW_WEIGHTS, startDates: {}, window: CW_WINDOW },
    CW_CACHE,
  );
  // Union run (no window) — the legacy path, for the non-vacuity comparison.
  const mUnion = computeScenario(
    CW_STRATS,
    { selected: CW_SELECTED, weights: CW_WEIGHTS, startDates: {} },
    CW_CACHE,
  );

  const winSeries = mWin.portfolio_daily_returns ?? [];
  const winRets = winSeries.map((p) => p.value);
  const winDates = winSeries.map((p) => p.date);
  const p = buildScenarioFactsheetPayload({ portfolioDaily: mWin.portfolio_daily_returns });

  // ── Test A: series identity + window truncation (non-vacuity) ──────────────
  // WHY THIS MATTERS (Rule 9): the factsheet must render the SAME dates/returns
  // the engine emits on the windowed path. If a future edit fed the chart the
  // stale UNION series (or a downsampled equity_curve), payload.dates would no
  // longer equal the engine's windowed dates — and would NOT be strictly shorter
  // than the union — and this test fails LOUD.
  it("payload.dates/returns === the engine's emitted WINDOWED series, bounded by the window", () => {
    // The window is the intersection, ending where the short strategy C ends.
    expect(CW_WINDOW).toEqual({ start: "2024-01-01", end: "2024-01-30" });
    // Precondition: the engine actually emitted a real (non-degenerate) series.
    expect(winSeries.length).toBeGreaterThanOrEqual(10);

    // Series identity: the factsheet consumes the emitted series verbatim.
    expect(p.dates).toEqual(winDates);
    expect(p.strategyReturns).toEqual(winRets);

    // Bounded by the closed window on both ends.
    expect(p.dates[0] >= CW_WINDOW.start).toBe(true);
    expect(p.dates.at(-1)! <= CW_WINDOW.end).toBe(true);

    // Non-vacuity: the windowed series is STRICTLY SHORTER than the union series
    // (the window truncated the tail past C's end). A stale-union render fails.
    const unionLen = (mUnion.portfolio_daily_returns ?? []).length;
    expect(winSeries.length).toBeLessThan(unionLen);
    expect(unionLen).toBe(90); // union spans A/B's full 90-day range
    expect(winSeries.length).toBe(30); // window is C's 30-day span
  });

  // ── Test B: metrics parity BY CONSTRUCTION on the windowed series ──────────
  // WHY THIS MATTERS (Rule 9): parity-by-construction means the factsheet body
  // equals the SAME compute()/cumEq()/drawdowns() the real strategy factsheet
  // runs — applied to the engine-emitted windowed series. A factsheet that
  // re-derived the blend (its own metrics) would diverge from compute() on this
  // identical series and fail these field-by-field pins.
  it("payload body === compute()/cumEq()/drawdowns() on the engine's windowed series", () => {
    const ref = compute(winRets, winDates);
    // Every numeric scalar of compute() (excl. eq/dd arrays + the yearly map)
    // round-trips to 6 decimals — the SAME loop shape as the Phase 39 union pin,
    // on the windowed path.
    for (const k of Object.keys(ref) as (keyof typeof ref)[]) {
      if (k === "eq" || k === "dd" || k === "yearly") continue;
      const refVal = ref[k];
      if (typeof refVal === "number") {
        expect(
          p.strategyMetrics[k as keyof typeof p.strategyMetrics] as number,
          `strategyMetrics.${String(k)} must equal compute().${String(k)} on the windowed series`,
        ).toBeCloseTo(refVal, 6);
      }
    }
    expect(p.strategyMetrics.yearly).toEqual(ref.yearly);

    // WR-01 single-axis: equity/drawdown are cumEq(rets)/drawdowns(cumEq(rets))
    // on the SAME windowed series, to fp precision.
    const eqRef = cumEq(winRets);
    const ddRef = drawdowns(eqRef);
    expect(p.strategyEquity.length).toBe(winRets.length);
    expect(p.strategyDrawdowns.length).toBe(winRets.length);
    for (let i = 0; i < winRets.length; i++) {
      expect(p.strategyEquity[i]).toBeCloseTo(eqRef[i], 12);
      expect(p.strategyDrawdowns[i]).toBeCloseTo(ddRef[i], 12);
    }
    // Non-vacuity: a real (non-zeroed) metric body was rendered.
    expect(p.strategyMetrics.n).toBe(30);
    expect(p.strategyMetrics.ann_vol).toBeGreaterThan(0);
  });

  // ── Test C: divisor honesty + no-invented-data ──────────────────────────────
  // WHY THIS MATTERS (Rule 9): the whole point of v1.5 is that an ENDED strategy
  // stops being a blend member (no tail-dilution), and that a window covering NO
  // strategy yields an honest EMPTY state rather than fabricated zeros. If the
  // engine kept the ended strategy in the divisor, or a zero-member window emitted
  // a plausible flat-0% curve, these assertions fail loud.
  it("member_count excludes an ended strategy; a zero-member window collapses to safe-empty", () => {
    // A window that extends PAST C's end (the full A/B span) — A and B cover it,
    // C does NOT (its last 2024-01-30 < 2024-03-30). Divisor drops C.
    const pastCWindow = { start: "2024-01-01", end: "2024-03-30" };
    const mNoC = computeScenario(
      CW_STRATS,
      { selected: CW_SELECTED, weights: CW_WEIGHTS, startDates: {}, window: pastCWindow },
      CW_CACHE,
    );
    expect(mNoC.member_count).toBe(2); // A + B; the ended C is excluded
    expect(mNoC.member_ids).toEqual(["A", "B"]);
    // And the factsheet on that windowed series stays parity-by-construction.
    const pNoC = buildScenarioFactsheetPayload({
      portfolioDaily: mNoC.portfolio_daily_returns,
    });
    expect(pNoC.dates).toEqual((mNoC.portfolio_daily_returns ?? []).map((d) => d.date));

    // The default intersection window DOES include C (all three cover it), so the
    // divisor there is 3 — the ended strategy dilutes ONLY while it is co-live.
    expect(mWin.member_count).toBe(3);

    // Zero-member window: widened PAST everyone (June 2024, after A/B's 2024-03-30
    // end). No strategy covers it → member_count 0, engine emits [] (no fabricated
    // zeros), and the payload collapses to safe-empty without throwing.
    const emptyWindow = { start: "2024-06-01", end: "2024-06-30" };
    const mEmpty = computeScenario(
      CW_STRATS,
      { selected: CW_SELECTED, weights: CW_WEIGHTS, startDates: {}, window: emptyWindow },
      CW_CACHE,
    );
    expect(mEmpty.member_count).toBe(0);
    expect(mEmpty.portfolio_daily_returns).toEqual([]);
    expect(() =>
      buildScenarioFactsheetPayload({ portfolioDaily: mEmpty.portfolio_daily_returns ?? [] }),
    ).not.toThrow();
    const pEmpty = buildScenarioFactsheetPayload({
      portfolioDaily: mEmpty.portfolio_daily_returns ?? [],
    });
    expect(pEmpty.dates).toEqual([]);
    expect(pEmpty.strategyEquity).toEqual([]);
  });
});
