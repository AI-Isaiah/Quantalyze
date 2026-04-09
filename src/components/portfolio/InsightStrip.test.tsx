import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InsightStrip } from "./InsightStrip";
import type { PortfolioAnalytics } from "@/lib/types";

function buildAnalytics(
  partial: Partial<PortfolioAnalytics> = {},
): PortfolioAnalytics {
  return {
    id: "1",
    portfolio_id: "1",
    computed_at: "2026-04-09T00:00:00Z",
    computation_status: "complete",
    computation_error: null,
    total_aum: null,
    total_return_twr: null,
    total_return_mwr: null,
    portfolio_sharpe: null,
    portfolio_volatility: null,
    portfolio_max_drawdown: null,
    avg_pairwise_correlation: null,
    return_24h: null,
    return_mtd: null,
    return_ytd: null,
    narrative_summary: null,
    correlation_matrix: null,
    attribution_breakdown: null,
    risk_decomposition: null,
    benchmark_comparison: null,
    optimizer_suggestions: null,
    portfolio_equity_curve: null,
    rolling_correlation: null,
    ...partial,
  };
}

describe("<InsightStrip>", () => {
  it("renders fallback copy when no insights fire", () => {
    render(<InsightStrip analytics={buildAnalytics()} />);
    expect(
      screen.getByText("No unusual activity in the trailing window."),
    ).toBeInTheDocument();
  });

  it("renders the section header even with no insights", () => {
    render(<InsightStrip analytics={buildAnalytics()} />);
    expect(screen.getByText("What we noticed")).toBeInTheDocument();
  });

  it("renders fired insights as a list", () => {
    render(
      <InsightStrip
        analytics={buildAnalytics({
          portfolio_max_drawdown: -0.2,
          avg_pairwise_correlation: 0.6,
          // Multi-strategy attribution so the drawdown rule is eligible.
          attribution_breakdown: [
            { strategy_id: "a", strategy_name: "Alpha", contribution: 0.04, allocation_effect: 0 },
            { strategy_id: "b", strategy_name: "Beta", contribution: 0.02, allocation_effect: 0 },
          ],
        })}
      />,
    );
    expect(
      screen.getByRole("region", { name: "Portfolio insights" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/below peak/),
    ).toBeInTheDocument();
  });

  it("respects the max prop", () => {
    render(
      <InsightStrip
        analytics={buildAnalytics({
          portfolio_max_drawdown: -0.2,
          attribution_breakdown: [
            { strategy_id: "a", strategy_name: "Alpha", contribution: 0.05, allocation_effect: 0 },
            { strategy_id: "b", strategy_name: "Beta", contribution: -0.04, allocation_effect: 0 },
          ],
        })}
        max={1}
      />,
    );
    const list = screen.getByRole("list");
    expect(list.querySelectorAll("li")).toHaveLength(1);
  });

  it("renders null analytics gracefully", () => {
    render(<InsightStrip analytics={null} />);
    expect(
      screen.getByText("No unusual activity in the trailing window."),
    ).toBeInTheDocument();
  });

  it("exposes severity to screen readers via an sr-only label", () => {
    // Regression test for PR 6 review finding I1: the colored dot carries
    // severity visually but is aria-hidden, so a VoiceOver user would
    // previously hear only the sentence with no severity context.
    render(
      <InsightStrip
        analytics={buildAnalytics({
          portfolio_max_drawdown: -0.25,
          attribution_breakdown: [
            { strategy_id: "a", strategy_name: "Alpha", contribution: 0.05, allocation_effect: 0 },
            { strategy_id: "b", strategy_name: "Beta", contribution: 0.03, allocation_effect: 0 },
          ],
        })}
      />,
    );
    // High severity drawdown insight should carry the sr-only label.
    expect(screen.getByText("High severity:")).toBeInTheDocument();
  });
});
