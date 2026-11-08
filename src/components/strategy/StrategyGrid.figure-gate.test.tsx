/**
 * Phase 194 review V-a (D-15, D-69 "one number or neither") - the discovery grid card's
 * CAGR follows the same total-record verdict as StrategyTable's CAGR cell on the same
 * page: a crypto record under 90 days (a non-crypto one under 60 observations) is a dash
 * with its reason, a cleared record under a year shows the figure with the `<1y` marker,
 * and a year or more shows it plain. Verdicts are typed by hand from D-15, not read back
 * from the gate module, so a threshold drift fails here.
 */

import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StrategyGrid } from "./StrategyGrid";
import type { Strategy, StrategyAnalytics } from "@/lib/types";

type Row = Strategy & { analytics: StrategyAnalytics };

const START = "2025-01-01";

/** The last date of a record that COVERS `days` days from START (D-20: both ends counted). */
function endAfter(days: number): string {
  const d = new Date(`${START}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days - 1);
  return d.toISOString().slice(0, 10);
}

function row(opts: {
  assetClass: "crypto" | "traditional";
  days: number;
  observations: number | null;
}): Row {
  return {
    id: "s-1",
    user_id: "u-1",
    category_id: "cat-1",
    api_key_id: null,
    name: "Alpha",
    description: null,
    strategy_types: ["Long-Only"],
    subtypes: [],
    markets: ["Spot"],
    supported_exchanges: ["Binance"],
    leverage_range: null,
    avg_daily_turnover: null,
    aum: 1_000_000,
    max_capacity: 10_000_000,
    start_date: START,
    status: "published",
    is_example: false,
    benchmark: "BTC",
    created_at: "2025-01-01T00:00:00Z",
    asset_class: opts.assetClass,
    analytics: {
      id: "an-1",
      strategy_id: "s-1",
      computed_at: "2026-01-01T00:00:00Z",
      computing_started_at: null,
      computation_status: "complete",
      computation_error: null,
      benchmark: null,
      cumulative_return: 0.42,
      cagr: 0.18,
      volatility: 0.22,
      sharpe: 1.5,
      sortino: 1.9,
      calmar: 1.1,
      max_drawdown: -0.12,
      max_drawdown_duration_days: 30,
      six_month_return: 0.21,
      sparkline_returns: [0, 1, 2],
      sparkline_drawdown: [0, -0.1, 0],
      metrics_json: null,
      returns_series: null,
      drawdown_series: null,
      monthly_returns: null,
      daily_returns: null,
      rolling_metrics: null,
      return_quantiles: null,
      trade_metrics: null,
      volume_metrics: null,
      exposure_metrics: null,
      data_quality_flags: null,
      trades_fetched_at: null,
      series_start: START,
      series_end: endAfter(opts.days),
      headline_since: null,
      record_observations: opts.observations,
    },
  } as unknown as Row;
}

function cagrCell(): HTMLElement {
  return screen.getByText("CAGR", { exact: false }).parentElement as HTMLElement;
}

function renderGrid(r: Row) {
  render(<StrategyGrid strategies={[r]} categorySlug="momentum" />);
}

afterEach(cleanup);

describe("StrategyGrid CAGR follows the table's total-record verdict (194 V-a)", () => {
  it("a crypto 60-day record is a dash with the withheld reason, never the stored 18%", () => {
    renderGrid(row({ assetClass: "crypto", days: 60, observations: 60 }));
    const cell = cagrCell();
    expect(cell.textContent).not.toContain("18.00%");
    expect(cell.textContent).toContain("—");
    expect(cell.textContent).toContain("Withheld until the record reaches 90 days (60 days so far).");
    // Untoned: a withheld figure is neither green nor red.
    expect(cell.innerHTML).not.toMatch(/text-(positive|negative)/);
  });

  it("a non-crypto record of 59 observations is withheld and names 60 trading days", () => {
    renderGrid(row({ assetClass: "traditional", days: 84, observations: 59 }));
    expect(cagrCell().textContent).toContain("—");
    expect(cagrCell().textContent).toContain("Withheld until the record reaches 60 trading days (59 so far).");
  });

  it("a cleared record under a year shows the figure with the <1y marker", () => {
    renderGrid(row({ assetClass: "traditional", days: 84, observations: 60 }));
    expect(cagrCell().textContent).toContain("+18.00%");
    expect(cagrCell().textContent).toContain("<1y");
  });

  it("a record of a year or more shows the figure plain", () => {
    renderGrid(row({ assetClass: "crypto", days: 400, observations: 400 }));
    expect(cagrCell().textContent).toContain("+18.00%");
    expect(cagrCell().textContent).not.toContain("<1y");
  });

  it("Return (cumulative, not annualised) is never gated", () => {
    renderGrid(row({ assetClass: "crypto", days: 60, observations: 60 }));
    expect(screen.getByText("+42.00%")).toBeTruthy();
  });
});
