import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import type { StrategyV2Detail } from "@/lib/queries";
import { StrategyV2Shell } from "@/components/strategy-v2/StrategyV2Shell";

/**
 * Phase 14a / KPI-22 — Hard panel-count assertion.
 *
 * Renders <StrategyV2Shell> with a synthetic StrategyV2Detail fixture and
 * asserts:
 *   1. Exactly 7 <section data-panel> elements in the rendered DOM
 *   2. Exactly 4 of those carry data-panel-status="placeholder"
 *      (Panels 4–7 are placeholders even with full data — KPI-22 contract)
 *   3. Every panel has an aria-label (accessibility baseline)
 *
 * `history_days = 365` so the eager panels render full bodies (not partial-
 * data banners) — this lets the chart paths execute under JSDOM and exercises
 * the lightweight-charts / Recharts mocks below.
 */

// Recharts ResponsiveContainer collapses to zero size in JSDOM. Mock it.
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 400, height: 240 }}>{children}</div>
    ),
  };
});

// lightweight-charts uses canvas APIs unavailable in JSDOM. EquityCurve
// imports `createChart` AND the `LineSeries` value symbol (used as the
// first arg to chart.addSeries(LineSeries, ...)). Stub both. Type imports
// (IChartApi / ISeriesApi / SeriesType) are erased at runtime so they do
// not need replacements in the mock.
vi.mock("lightweight-charts", () => ({
  LineSeries: "LineSeries",
  createChart: () => ({
    addSeries: () => ({
      setData: () => {},
      applyOptions: () => {},
    }),
    addAreaSeries: () => ({ setData: () => {}, applyOptions: () => {} }),
    addLineSeries: () => ({ setData: () => {}, applyOptions: () => {} }),
    removeSeries: () => {},
    timeScale: () => ({ fitContent: () => {}, applyOptions: () => {} }),
    applyOptions: () => {},
    resize: () => {},
    remove: () => {},
    subscribeCrosshairMove: () => {},
    unsubscribeCrosshairMove: () => {},
  }),
}));

const FIXTURE: StrategyV2Detail = {
  strategy: {
    id: "test-uuid",
    user_id: "user-1",
    category_id: null,
    api_key_id: null,
    name: "Test Strategy",
    description: null,
    strategy_types: ["systematic"],
    subtypes: ["trend"],
    markets: ["crypto"],
    supported_exchanges: ["Binance"],
    leverage_range: "1-3x",
    avg_daily_turnover: 250000,
    aum: null,
    max_capacity: null,
    start_date: "2025-01-01",
    status: "published",
    is_example: false,
    benchmark: "BTC",
    created_at: "2025-01-01T00:00:00Z",
  },
  panel1: {
    supported_exchanges: ["Binance"],
    strategy_types: ["systematic"],
    subtypes: ["trend"],
    markets: ["crypto"],
    leverage_range: "1-3x",
    avg_daily_turnover: 250000,
  },
  panel2Headline: {
    cumulative_return: 0.42,
    cagr: 0.18,
    sharpe: 1.5,
    sortino: 2.1,
    max_drawdown: -0.12,
    volatility: 0.16,
  },
  panel2Equity: {
    series: [
      { date: "2025-01-01", value: 1.0 },
      { date: "2025-12-31", value: 1.42 },
    ],
    btc_overlay: [
      { date: "2025-01-01", value: 1.0 },
      { date: "2025-12-31", value: 1.3 },
    ],
  },
  panel3: {
    drawdown_series: [
      { date: "2025-01-01", value: 0 },
      { date: "2025-06-15", value: -0.12 },
    ],
    drawdown_episodes: [],
  },
  // Phase 14b — Wave-3 wiring requires panel4..7 inputs on the fixture.
  // Use sensible empty-but-non-throwing values so the panel bodies render
  // their partial-data sub-banners (the panel-count assertion does not care
  // about chart contents — only the 7 outermost <section data-panel> nodes).
  panel4Inputs: {
    monthly_returns: null,
    return_quantiles: null,
    returns_series: null,
    benchmark_returns: null,
  },
  panel5Inputs: {
    rolling_metrics: null,
    sharpe: null,
  },
  panel6Inputs: {
    trade_metrics: null,
  },
  panel7Inputs: {
    benchmark_greeks: { alpha: null, beta: null, ir: null, treynor: null },
    correlation_analytics: { returns_series: null, metrics_json: null },
  },
  lazyKeys: ["panel4", "panel5", "panel6", "panel7"],
  history_days: 365,
};

describe("StrategyV2Shell — panel count (KPI-22)", () => {
  it("renders exactly 7 <section data-panel> elements", () => {
    render(<StrategyV2Shell detail={FIXTURE} />);
    const sections = document.querySelectorAll("section[data-panel]");
    expect(sections.length).toBe(7);
  });

  it("panels 4–7 carry data-panel-status=\"placeholder\"", () => {
    render(<StrategyV2Shell detail={FIXTURE} />);
    const placeholders = document.querySelectorAll(
      'section[data-panel-status="placeholder"]',
    );
    expect(placeholders.length).toBe(4);
  });

  it("each panel has an aria-label", () => {
    render(<StrategyV2Shell detail={FIXTURE} />);
    const sections = document.querySelectorAll("section[data-panel]");
    for (const section of Array.from(sections)) {
      expect(section.getAttribute("aria-label")).toBeTruthy();
    }
  });
});
