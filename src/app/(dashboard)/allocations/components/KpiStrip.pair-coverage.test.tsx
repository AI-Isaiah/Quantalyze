/**
 * Phase 166.2 round 2, SFH-R2-M3: the KPI strip's "Avg |ρ|" says how many pairs
 * it averages when that is fewer than all of them.
 *
 * Why this matters: under founder decision D7 the scenario engine leaves a pair
 * with no correlation (a leg with no dispersion, e.g. a flat strategy) out of
 * both the matrix and `avg_pairwise_correlation`. The heatmap caption already
 * says "· k of n pairs measured". Without the same qualifier the KPI reads as an
 * average over every pair, and its delta against the live book compares averages
 * over different pair sets with no cue. The scenario metrics here come from the
 * real `computeScenario`, so a change to how the engine records a missing pair
 * shows up in this test.
 */
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import {
  buildDateMapCache,
  computeScenario,
  type ComputedMetrics,
  type ScenarioState,
  type StrategyForBuilder,
} from "@/lib/scenario";
import { KpiStrip } from "./KpiStrip";

function businessDays(n: number): string[] {
  const out: string[] = [];
  const d = new Date(Date.UTC(2024, 0, 2));
  while (out.length < n) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function strategy(id: string, dates: string[], ret: (i: number) => number): StrategyForBuilder {
  return {
    id,
    name: `Strategy ${id}`,
    codename: null,
    disclosure_tier: "institutional",
    strategy_types: ["arbitrage"],
    markets: ["BTC"],
    start_date: dates[0],
    daily_returns: dates.map((date, i) => ({ date, value: ret(i) })),
    cagr: null,
    sharpe: null,
    volatility: null,
    max_drawdown: null,
  };
}

function scenarioOf(strategies: StrategyForBuilder[]): ComputedMetrics {
  const state: ScenarioState = { selected: {}, weights: {}, startDates: {} };
  for (const s of strategies) {
    state.selected[s.id] = true;
    state.weights[s.id] = 1;
    state.startDates[s.id] = s.start_date ?? "2024-01-02";
  }
  return computeScenario(strategies, state, buildDateMapCache(strategies));
}

const dates = businessDays(60);
const a = strategy("a", dates, i => Math.sin(i / 3) * 0.01);
const b = strategy("b", dates, i => Math.cos(i / 5) * 0.01);
const flat = strategy("flat", dates, () => 0.0005);

function avgRhoCell(scenario: ComputedMetrics, live: ComputedMetrics): HTMLElement {
  const { getByText } = render(
    <KpiStrip mode="scenario" scenarioMetrics={scenario} liveMetrics={live} metrics={live} analytics={{}} />,
  );
  // The KpiPanel cell holding the "Avg |ρ|" label.
  return getByText("Avg |ρ|").parentElement as HTMLElement;
}

describe("KpiStrip Avg |ρ| states its pair coverage (SFH-R2-M3)", () => {
  it("a flat leg leaves 2 of 3 pairs unmeasured, and the KPI says '1 of 3 pairs measured'", () => {
    const withFlat = scenarioOf([a, b, flat]);
    // Precondition from the real engine: one measured pair, a finite average.
    expect(withFlat.avg_pairwise_correlation).not.toBeNull();
    expect(withFlat.correlation_matrix?.a?.flat).toBeUndefined();

    const live = scenarioOf([a, b]);
    const cell = avgRhoCell(withFlat, live);
    expect(cell.textContent).toContain("1 of 3 pairs measured");
  });

  it("control: every pair measured shows no qualifier", () => {
    const full = scenarioOf([a, b]);
    const cell = avgRhoCell(full, full);
    expect(cell.textContent).toContain("average pairwise correlation across holdings");
    expect(cell.textContent).not.toMatch(/pairs measured/);
  });
});
