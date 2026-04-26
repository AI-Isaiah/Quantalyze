import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { InsightStrip } from "./InsightStrip";
import type { PortfolioAnalytics } from "@/lib/types";

// next/link renders as a plain <a> in tests; mock to avoid router context errors
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

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
  it("PR3 (dashboard parity) — renders nothing when no insights fire and no flaggedCount", () => {
    // PR3 silenced the empty-state strip to match the truth screenshot —
    // when there's nothing to say, the strip stays out of the layout.
    const { container } = render(<InsightStrip analytics={buildAnalytics()} />);
    expect(container.firstChild).toBeNull();
  });

  it("PR3 — still renders the section header when insights or flaggedCount are present", () => {
    render(
      <InsightStrip
        analytics={buildAnalytics()}
        portfolioId="p-1"
        flaggedCount={1}
      />,
    );
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

  it("respects the max prop AND keeps the highest-severity insight", () => {
    // Regression test for PR 6 I4: max={1} must drop the lower-severity
    // underperformance insight and keep the high-severity drawdown.
    render(
      <InsightStrip
        analytics={buildAnalytics({
          // high severity — drawdown rule fires
          portfolio_max_drawdown: -0.25,
          // medium severity — underperformance rule fires
          attribution_breakdown: [
            { strategy_id: "a", strategy_name: "Alpha", contribution: 0.05, allocation_effect: 0 },
            { strategy_id: "b", strategy_name: "Beta", contribution: -0.04, allocation_effect: 0 },
            { strategy_id: "c", strategy_name: "Gamma", contribution: 0.03, allocation_effect: 0 },
          ],
        })}
        max={1}
      />,
    );
    const list = screen.getByRole("list");
    const items = list.querySelectorAll("li");
    expect(items).toHaveLength(1);
    // The retained item should be the high-severity drawdown sentence,
    // not the medium-severity underperformance one.
    expect(items[0].textContent).toMatch(/below peak/);
    expect(screen.getByText("High severity:")).toBeInTheDocument();
  });

  it("PR3 — renders nothing for null analytics with no flaggedCount (was: 'No unusual activity' fallback)", () => {
    const { container } = render(<InsightStrip analytics={null} />);
    expect(container.firstChild).toBeNull();
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

// ---------------------------------------------------------------------------
// Phase 09 — flaggedCount line (LIVE-02, D-07)
// ---------------------------------------------------------------------------

// Minimal analytics with no firing rules → empty insight list
const MOCK_ANALYTICS = buildAnalytics();

// Analytics with one firing rule (drawdown) → non-empty insight list
const MOCK_ANALYTICS_WITH_INSIGHTS = buildAnalytics({
  portfolio_max_drawdown: -0.25,
  attribution_breakdown: [
    { strategy_id: "a", strategy_name: "Alpha", contribution: 0.05, allocation_effect: 0 },
    { strategy_id: "b", strategy_name: "Beta", contribution: 0.03, allocation_effect: 0 },
  ],
});

describe("InsightStrip — Phase 09 flaggedCount line (LIVE-02, D-07)", () => {
  it("renders 'Bridge flagged N holding(s) — Review in Scenario →' when flaggedCount > 0", () => {
    render(<InsightStrip analytics={MOCK_ANALYTICS} portfolioId="p-1" flaggedCount={3} />);
    expect(screen.getByText(/Bridge flagged 3 holding\(s\) — Review in Scenario →/)).toBeInTheDocument();
  });

  it("links to /allocations?tab=scenario", () => {
    render(<InsightStrip analytics={MOCK_ANALYTICS} portfolioId="p-1" flaggedCount={2} />);
    const link = screen.getByRole("link", { name: /Bridge flagged/ });
    expect(link).toHaveAttribute("href", "/allocations?tab=scenario");
  });

  it("hides line when flaggedCount === 0", () => {
    render(<InsightStrip analytics={MOCK_ANALYTICS} portfolioId="p-1" flaggedCount={0} />);
    expect(screen.queryByText(/Bridge flagged/)).not.toBeInTheDocument();
  });

  it("hides line when flaggedCount undefined (backward-compatible)", () => {
    render(<InsightStrip analytics={MOCK_ANALYTICS} portfolioId="p-1" />);
    expect(screen.queryByText(/Bridge flagged/)).not.toBeInTheDocument();
  });

  it("line appears ABOVE regular insights (prepended)", () => {
    render(<InsightStrip analytics={MOCK_ANALYTICS_WITH_INSIGHTS} portfolioId="p-1" flaggedCount={1} />);
    const flagged = screen.getByText(/Bridge flagged 1 holding\(s\)/);
    const firstInsight = screen.getByText(/below peak/);
    // compareDocumentPosition: DOCUMENT_POSITION_FOLLOWING = 4 means firstInsight comes after flagged
    expect(flagged.compareDocumentPosition(firstInsight) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
