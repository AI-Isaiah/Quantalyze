import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { VolumeExposureTab } from "./VolumeExposureTab";
import type { StrategyAnalytics } from "@/lib/types";

/**
 * Lock the chip-precedence chain on the v1 strategy detail page.
 *
 * VolumeExposureTab.tsx renders its Turnover sub-card with a chip ladder
 * that branches on `data_quality_flags`:
 *   1. account_balance_unavailable → text-warning "Approximate denominator"
 *   2. no_linked_api_key            → text-text-secondary "Demo strategy"
 *   3. neither                      → no chip
 *
 * Same precedence as v2 TradeAndPositionPanel (Tests 15+16). Since the v1
 * page is still in production, a regression here would mis-label demo
 * strategies as "Approximate" or fail to surface real degradation. The v2
 * panel is locked by TradeAndPositionPanel.test.tsx; this file mirrors
 * that contract for the v1 surface.
 */

function makeAnalytics(
  flags: Partial<StrategyAnalytics["data_quality_flags"]>,
): StrategyAnalytics {
  return {
    strategy_id: "test-strategy",
    computation_status: "complete",
    computation_error: null,
    sharpe: 1.5,
    sortino: 2.0,
    max_drawdown: -0.1,
    volatility: 0.2,
    cumulative_return: 0.3,
    cagr: 0.25,
    daily_returns: null,
    rolling_metrics: null,
    return_quantiles: null,
    trade_metrics: { total_positions: 100, win_rate: 0.6 } as Record<
      string,
      number
    >,
    volume_metrics: {
      buy_volume_pct: 0.5,
      sell_volume_pct: 0.5,
      long_volume_pct: 0.5,
      short_volume_pct: 0.5,
      total_fills: 100,
      total_volume_usd: 100_000,
    },
    exposure_metrics: {
      mean_gross_exposure: 1.0,
      std_gross_exposure: 0.1,
      max_gross_exposure: 1.5,
      mean_net_exposure: 0.5,
      std_net_exposure: 0.1,
      max_net_exposure: 0.8,
    },
    data_quality_flags: flags,
  } as unknown as StrategyAnalytics;
}

describe("VolumeExposureTab — Turnover chip precedence", () => {
  it("account_balance_unavailable=true renders the Approximate chip", () => {
    render(
      <VolumeExposureTab
        analytics={makeAnalytics({ account_balance_unavailable: true })}
      />,
    );
    expect(screen.getByText("Approximate denominator")).not.toBeNull();
    // The explanatory paragraph distinguishes this from the demo state.
    expect(
      screen.getByText(/Account balance was unavailable when this strategy was synced/),
    ).not.toBeNull();
    expect(screen.queryByText("Demo strategy")).toBeNull();
  });

  it("no_linked_api_key=true renders the Demo chip — distinct from Approximate", () => {
    render(
      <VolumeExposureTab
        analytics={makeAnalytics({ no_linked_api_key: true })}
      />,
    );
    expect(screen.getByText("Demo strategy")).not.toBeNull();
    expect(
      screen.getByText(/no linked exchange API key/),
    ).not.toBeNull();
    // The Approximate chip is reserved for genuine degradation; a demo
    // strategy should NOT trip it.
    expect(screen.queryByText("Approximate denominator")).toBeNull();
  });

  it("both flags simultaneously → Approximate wins (real failure ranks above demo)", () => {
    render(
      <VolumeExposureTab
        analytics={makeAnalytics({
          account_balance_unavailable: true,
          no_linked_api_key: true,
        })}
      />,
    );
    expect(screen.getByText("Approximate denominator")).not.toBeNull();
    expect(screen.queryByText("Demo strategy")).toBeNull();
  });

  it("neither flag set → no chip, default 'Turnover analysis coming soon.' copy", () => {
    render(<VolumeExposureTab analytics={makeAnalytics({})} />);
    expect(screen.queryByText("Approximate denominator")).toBeNull();
    expect(screen.queryByText("Demo strategy")).toBeNull();
    expect(screen.getByText(/Turnover analysis coming soon/)).not.toBeNull();
  });
});
