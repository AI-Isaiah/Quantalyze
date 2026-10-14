/**
 * Phase 170.6 DISPLAYPOLISH plan 10 (D-02, D-03, D-04, O-8) — StrategyTable's
 * `signColor` and `drawdownColor` follow the sign of the figure ROUNDED to the
 * 2 dp the cell prints (`formatPercent`), never the raw sign.
 *
 * Kept in a file of its own so StrategyTable.test.tsx stays plan 02's. The
 * expectations are typed by hand. The cells are found by their printed text
 * with a regex that accepts a signed or unsigned zero, so this file does not
 * depend on whether `formatPercent` (plan 02's) prints "+0.00%" or "0.00%".
 *
 * WHY EACH CASE EXISTS (the value is the rounded zero, not a real move):
 *   - Cumulative / 6M of -0.00004 print "0.00%": a reader sees no loss, so the
 *     cell is not red. Today the raw sign paints it text-negative.
 *   - A 0 return prints "0.00%": no gain, so it is not green. Today `>= 0` paints
 *     it text-positive.
 *   - Max DD of -0.00004 prints "0.00%": no drawdown, so it is not red. Today the
 *     raw `< 0` paints it text-negative (O-8).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { StrategyTable } from "./StrategyTable";
import type { Strategy, StrategyAnalytics } from "@/lib/types";
import { installFetchMock, restoreFetchMock } from "@/test/helpers/fetch";

type StrategyWithAnalytics = Strategy & { analytics: StrategyAnalytics };

vi.mock("@/components/discovery/SimulateImpactButton", () => ({
  SimulateImpactButton: () => null,
}));

beforeEach(() => {
  installFetchMock();
  try {
    window.localStorage.clear();
  } catch {
    // jsdom may not implement clear; non-fatal.
  }
});
afterEach(() => {
  restoreFetchMock();
});

const ID = "11111111-0000-4000-8000-000000000001";

function makeAnalytics(overrides: Partial<StrategyAnalytics>): StrategyAnalytics {
  return {
    id: "an-1",
    strategy_id: ID,
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
    sparkline_returns: [0, 1, 2, 3, 4],
    sparkline_drawdown: [0, -0.1, -0.2, -0.05, 0],
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
    ...overrides,
  };
}

function makeStrategy(analytics: Partial<StrategyAnalytics>): StrategyWithAnalytics {
  return {
    id: ID,
    name: "Alpha Stellar",
    user_id: "u-1",
    category_id: "cat-1",
    api_key_id: null,
    description: null,
    strategy_types: ["Long-Only"],
    subtypes: ["Trend Following"],
    markets: ["Spot"],
    supported_exchanges: ["Binance"],
    leverage_range: null,
    avg_daily_turnover: null,
    aum: 1_000_000,
    max_capacity: 10_000_000,
    start_date: "2024-01-01",
    status: "published",
    is_example: false,
    benchmark: "BTC",
    created_at: "2024-01-01T00:00:00Z",
    analytics: makeAnalytics(analytics),
  } as StrategyWithAnalytics;
}

const ZERO_PCT = /^[+\-−]?0\.00%$/;
const TINTS = /text-(positive|negative)/;

/** Every element that prints the rounded-zero percent, with its tone class holder. */
function zeroCells(): HTMLElement[] {
  return screen.getAllByText(ZERO_PCT).map((el) => el.closest("td, dd") as HTMLElement);
}

function renderOne(analytics: Partial<StrategyAnalytics>) {
  return render(
    <StrategyTable strategies={[makeStrategy(analytics)]} categorySlug="crypto-sma" />,
  );
}

describe("StrategyTable signColor (Cumulative, 6M Return) on the rounded sign", () => {
  it("a cumulative return of -0.00004 (prints 0.00%) is neither red nor green", () => {
    renderOne({ cumulative_return: -0.00004 });
    const cells = zeroCells();
    expect(cells).toHaveLength(1);
    expect(cells[0].className).toContain("text-text-primary");
    expect(cells[0].className).not.toMatch(TINTS);
  });

  it("a cumulative return of exactly 0 is text-text-primary, not text-positive", () => {
    renderOne({ cumulative_return: 0 });
    const cells = zeroCells();
    expect(cells).toHaveLength(1);
    expect(cells[0].className).toContain("text-text-primary");
    expect(cells[0].className).not.toMatch(TINTS);
  });

  it("a 6M return of -0.00004 is neutral in the row cell and in the mobile card", () => {
    renderOne({ six_month_return: -0.00004 });
    const cells = zeroCells();
    // the table cell and the mobile-card <dd> both print it
    expect(cells.length).toBeGreaterThanOrEqual(1);
    for (const c of cells) {
      expect(c.className).toContain("text-text-primary");
      expect(c.className).not.toMatch(TINTS);
    }
  });

  it("a real gain stays text-positive and a real loss stays text-negative", () => {
    renderOne({ cumulative_return: 0.12, six_month_return: -0.05 });
    expect(screen.getByText("+12.00%").closest("td")!.className).toContain("text-positive");
    for (const el of screen.getAllByText("-5.00%")) {
      expect(el.closest("td, dd")!.className).toContain("text-negative");
    }
  });

  it("a null return keeps text-text-muted", () => {
    renderOne({ cumulative_return: null as unknown as number });
    const dash = screen.getAllByText("—").map((el) => el.closest("td, dd") as HTMLElement);
    expect(dash.some((c) => c.className.includes("text-text-muted"))).toBe(true);
    for (const c of dash) expect(c.className).not.toMatch(TINTS);
  });
});

describe("StrategyTable drawdownColor (Max DD, O-8) on the rounded sign", () => {
  it("a drawdown of -0.00004 (prints 0.00%) is text-text-primary and NOT text-negative", () => {
    renderOne({ max_drawdown: -0.00004 });
    const cells = zeroCells();
    expect(cells).toHaveLength(1);
    expect(cells[0].className).toContain("text-text-primary");
    expect(cells[0].className).not.toContain("text-negative");
  });

  it("a drawdown of -0.12 is text-negative", () => {
    renderOne({ max_drawdown: -0.12 });
    expect(screen.getByText("-12.00%").closest("td")!.className).toContain("text-negative");
  });

  it("a drawdown of 0 is text-text-primary", () => {
    renderOne({ max_drawdown: 0 });
    const cells = zeroCells();
    expect(cells).toHaveLength(1);
    expect(cells[0].className).toContain("text-text-primary");
    expect(cells[0].className).not.toMatch(TINTS);
  });

  it("a drawdown is never green: a positive value is text-text-primary, not text-positive", () => {
    renderOne({ max_drawdown: 0.05 });
    const cell = screen.getByText("+5.00%").closest("td")!;
    expect(cell.className).toContain("text-text-primary");
    expect(cell.className).not.toContain("text-positive");
  });

  it("a null drawdown stays text-text-muted", () => {
    renderOne({ max_drawdown: null as unknown as number });
    const dash = screen.getAllByText("—").map((el) => el.closest("td, dd") as HTMLElement);
    expect(dash.some((c) => c.className.includes("text-text-muted"))).toBe(true);
    for (const c of dash) expect(c.className).not.toContain("text-negative");
  });
});
