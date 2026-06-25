import { describe, it, expect } from "vitest";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import { deriveSnapshotDrawdowns } from "@/app/(dashboard)/allocations/lib/drawdown";
import {
  buildScenarioFactsheetPayload,
  SCENARIO_EQUITY_CONFIG,
  SCENARIO_DRAWDOWN_CONFIG,
} from "./scenario-factsheet-payload";

// ── Deterministic fixtures (no Math.random) ──────────────────────────
// A scenario WEALTH series (toWealth-normalized: starts ~1.0, cumulative).
// `value` is a cumulative wealth multiplier, NOT a daily return.
const ymd = (i: number) => new Date(2025, 0, 2 + i).toISOString().slice(0, 10);

const SCENARIO: DailyPoint[] = Array.from({ length: 30 }, (_, i) => ({
  date: ymd(i),
  // Monotone-ish wealth with one dip so a drawdown is observable.
  value: 1 + i * 0.01 - (i >= 10 && i < 15 ? 0.05 : 0),
}));

// A benchmark whose dates are a SUBSET of the scenario axis (skips even days
// past index 4, and ends two days short) so the missing-day → null path is
// exercised on both interior gaps and a trailing gap.
const BENCH: DailyPoint[] = SCENARIO.filter(
  (_, i) => i < 28 && (i < 5 || i % 2 === 0),
).map((p) => ({ date: p.date, value: p.value * 0.9 }));

describe("buildScenarioFactsheetPayload — convention pins", () => {
  // ── 1. canonical dates axis + index-aligned strategyEquity ──────────
  it("dates is the scenario axis and strategyEquity[i] === scenario wealth at dates[i]", () => {
    const p = buildScenarioFactsheetPayload({ scenario: SCENARIO });
    expect(p.dates).toEqual(SCENARIO.map((d) => d.date));
    expect(p.strategyEquity.length).toBe(SCENARIO.length);
    for (let i = 0; i < SCENARIO.length; i++) {
      expect(p.strategyEquity[i]).toBe(SCENARIO[i].value);
    }
  });

  // ── 2. benchmark index-aligned into comparators.btc.cumulative, missing → null ──
  it("benchmark aligns to dates with missing days as null (interior + trailing gaps)", () => {
    const p = buildScenarioFactsheetPayload({ scenario: SCENARIO, benchmark: BENCH });
    const cum = p.comparators.btc.cumulative;
    expect(cum).not.toBeNull();
    expect(cum!.length).toBe(SCENARIO.length);

    const benchByDate = new Map(BENCH.map((b) => [b.date, b.value]));
    for (let i = 0; i < SCENARIO.length; i++) {
      const expected = benchByDate.has(SCENARIO[i].date)
        ? benchByDate.get(SCENARIO[i].date)!
        : null;
      expect(cum![i]).toBe(expected);
    }
    // Non-vacuity: at least one real value AND at least one null gap.
    expect(cum!.some((v) => v != null)).toBe(true);
    expect(cum!.some((v) => v == null)).toBe(true);
  });

  // ── 3. activeComparator switching by benchmark presence ─────────────
  it('activeComparator is "btc" with a benchmark, "none" without (cumulative null)', () => {
    const withBench = buildScenarioFactsheetPayload({ scenario: SCENARIO, benchmark: BENCH });
    expect(withBench.activeComparator).toBe("btc");

    const noBench = buildScenarioFactsheetPayload({ scenario: SCENARIO });
    expect(noBench.activeComparator).toBe("none");
    expect(noBench.comparators.btc.cumulative).toBeNull();

    const emptyBench = buildScenarioFactsheetPayload({ scenario: SCENARIO, benchmark: [] });
    expect(emptyBench.activeComparator).toBe("none");
    expect(emptyBench.comparators.btc.cumulative).toBeNull();
  });

  // ── 4. drawdowns derive from the shared helper (not a hand-rolled loop) ──
  it("strategyDrawdowns equals deriveSnapshotDrawdowns(scenario) point-for-point", () => {
    const p = buildScenarioFactsheetPayload({ scenario: SCENARIO });
    const ref = deriveSnapshotDrawdowns(SCENARIO).map((d) => d.value);
    expect(p.strategyDrawdowns).toEqual(ref);
    expect(p.strategyDrawdowns.length).toBe(SCENARIO.length);
    // Non-vacuity: the dip produced an actual negative drawdown.
    expect(p.strategyDrawdowns.some((v) => v < 0)).toBe(true);
  });

  // ── 5. blank-slate (no baseline, scenario present) renders (PARITY-03 precondition) ──
  it("blank-slate: scenario present with no baseline yields non-empty equity + dates", () => {
    const p = buildScenarioFactsheetPayload({ scenario: SCENARIO, baseline: null });
    expect(p.strategyEquity.length).toBeGreaterThan(0);
    expect(p.dates.length).toBeGreaterThan(0);
  });

  // ── 6. degenerate input collapses safely (never throws) ─────────────
  it("empty scenario collapses to a safe empty payload", () => {
    const p = buildScenarioFactsheetPayload({ scenario: [] });
    expect(p.dates).toEqual([]);
    expect(p.strategyEquity).toEqual([]);
    expect(p.strategyDrawdowns).toEqual([]);
    expect(p.comparators.btc.cumulative).toBeNull();
    expect(p.activeComparator).toBe("none");
  });

  it("a non-finite scenario value collapses to a safe empty payload (no NaN propagation)", () => {
    const poisoned: DailyPoint[] = [
      { date: ymd(0), value: 1.0 },
      { date: ymd(1), value: Number.NaN },
      { date: ymd(2), value: 1.02 },
    ];
    expect(() => buildScenarioFactsheetPayload({ scenario: poisoned })).not.toThrow();
    const p = buildScenarioFactsheetPayload({ scenario: poisoned });
    expect(p.dates).toEqual([]);
    expect(p.strategyEquity).toEqual([]);
  });

  it("an Infinity scenario value collapses to a safe empty payload", () => {
    const poisoned: DailyPoint[] = [
      { date: ymd(0), value: 1.0 },
      { date: ymd(1), value: Number.POSITIVE_INFINITY },
    ];
    const p = buildScenarioFactsheetPayload({ scenario: poisoned });
    expect(p.dates).toEqual([]);
    expect(p.strategyEquity).toEqual([]);
  });

  // ── 7. safe defaults for the unused FactsheetCommon fields ──────────
  it("safe-defaults the unused fields and uses the csv arm", () => {
    const p = buildScenarioFactsheetPayload({ scenario: SCENARIO });
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
    const p = buildScenarioFactsheetPayload({ scenario: SCENARIO, strategyId: "scenario:abc" });
    expect(p.strategyId).toBe("scenario:abc");
  });

  // ── 8. exported ChartConfig constants match the factsheet field contract ──
  it("SCENARIO_EQUITY_CONFIG maps the strategy line to scenario and the comparator to the benchmark", () => {
    expect(SCENARIO_EQUITY_CONFIG.stratField).toBe("strategyEquity");
    expect(SCENARIO_EQUITY_CONFIG.comparatorField).toBe("cumulative");
    expect(SCENARIO_EQUITY_CONFIG.valueFormat).toBe("growth");
    expect(SCENARIO_EQUITY_CONFIG.baseline).toBe(1);
    expect(SCENARIO_EQUITY_CONFIG.rebaseOnZoom).toBe(true);
  });

  it("SCENARIO_DRAWDOWN_CONFIG renders the underwater fill off strategyDrawdowns with no comparator", () => {
    expect(SCENARIO_DRAWDOWN_CONFIG.stratField).toBe("strategyDrawdowns");
    expect(SCENARIO_DRAWDOWN_CONFIG.comparatorField).toBeNull();
    expect(SCENARIO_DRAWDOWN_CONFIG.fill).toBe(true);
    expect(SCENARIO_DRAWDOWN_CONFIG.valueFormat).toBe("percent");
    expect(SCENARIO_DRAWDOWN_CONFIG.baseline).toBe(0);
  });
});
