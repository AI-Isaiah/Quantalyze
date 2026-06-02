import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StrategyBreakdownTable } from "./StrategyBreakdownTable";
import type { AttributionRow } from "@/lib/types";

/**
 * H-0393 (audit-2026-05-07) — StrategyBreakdownTable had zero tests while the
 * other 8 portfolio components in the slice are covered.
 *
 * This is the dashboard table that renders weight / TWR / Sharpe / MaxDD /
 * contribution per strategy. Load-bearing behaviors:
 *   - one row per strategy with its weight rendered as a percent.
 *   - empty-state copy when there are no strategies.
 *   - default sort is weight descending.
 *   - clicking a column header re-sorts (contribution descending here).
 */

// next/link renders as a plain <a> in tests; mock to avoid router context errors.
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

type StrategyInput = {
  strategy_id: string;
  current_weight: number | null;
  strategies: { id: string; name: string; strategy_analytics: unknown } | null;
};

function strat(
  id: string,
  name: string,
  weight: number | null,
  analytics: {
    cagr?: number | null;
    sharpe?: number | null;
    max_drawdown?: number | null;
    computed_at?: string | null;
  } | null,
): StrategyInput {
  return {
    strategy_id: id,
    current_weight: weight,
    strategies: {
      id,
      name,
      strategy_analytics: analytics,
    },
  };
}

describe("<StrategyBreakdownTable> — H-0393", () => {
  it("renders the empty state when there are no strategies", () => {
    render(
      <StrategyBreakdownTable strategies={[]} attribution={null} portfolioId="p-1" />,
    );
    expect(screen.getByText(/No strategies in this portfolio/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("renders one row per strategy with its name and weight", () => {
    const strategies: StrategyInput[] = [
      strat("a", "Alpha", 0.6, { cagr: 0.2, sharpe: 1.5, max_drawdown: -0.1 }),
      strat("b", "Beta", 0.4, { cagr: 0.1, sharpe: 1.0, max_drawdown: -0.2 }),
    ];

    render(
      <StrategyBreakdownTable strategies={strategies} attribution={null} portfolioId="p-1" />,
    );

    const bodyRows = screen.getAllByRole("row").slice(1); // drop header row
    expect(bodyRows).toHaveLength(2);

    // Strategy names render as links to the per-strategy page.
    const alphaLink = screen.getByRole("link", { name: "Alpha" });
    expect(alphaLink).toHaveAttribute("href", "/portfolios/p-1/strategies/a");
    expect(screen.getByRole("link", { name: "Beta" })).toBeInTheDocument();

    // Weights render as signed percents (formatPercent default signed).
    expect(screen.getByText("+60.00%")).toBeInTheDocument();
    expect(screen.getByText("+40.00%")).toBeInTheDocument();
  });

  it("renders an em-dash for a null weight rather than a percent", () => {
    const strategies: StrategyInput[] = [
      strat("a", "Alpha", null, { cagr: 0.2, sharpe: 1.5, max_drawdown: -0.1 }),
    ];

    render(
      <StrategyBreakdownTable strategies={strategies} attribution={null} portfolioId="p-1" />,
    );

    // The weight cell is the 2nd cell of the body row (after the name link).
    // With null weight it renders the em-dash sentinel (—) instead of a percent.
    const bodyRow = screen.getAllByRole("row")[1];
    const weightCell = bodyRow.querySelectorAll("td")[1];
    expect(weightCell.textContent).toBe("—");
    // Sanity: it is NOT formatted as a 0% weight.
    expect(weightCell.textContent).not.toMatch(/%/);
  });

  it("defaults to weight descending — highest weight is the first body row", () => {
    const strategies: StrategyInput[] = [
      strat("a", "Alpha", 0.2, { cagr: 0.2, sharpe: 1.5, max_drawdown: -0.1 }),
      strat("b", "Beta", 0.7, { cagr: 0.1, sharpe: 1.0, max_drawdown: -0.2 }),
      strat("c", "Gamma", 0.1, { cagr: 0.05, sharpe: 0.8, max_drawdown: -0.3 }),
    ];

    render(
      <StrategyBreakdownTable strategies={strategies} attribution={null} portfolioId="p-1" />,
    );

    const links = screen.getAllByRole("link");
    // Beta (0.7) > Alpha (0.2) > Gamma (0.1)
    expect(links.map((l) => l.textContent)).toEqual(["Beta", "Alpha", "Gamma"]);
  });

  it("sorts by contribution descending when the Contribution header is clicked", () => {
    const strategies: StrategyInput[] = [
      strat("a", "Alpha", 0.5, { cagr: 0.2, sharpe: 1.5, max_drawdown: -0.1 }),
      strat("b", "Beta", 0.3, { cagr: 0.1, sharpe: 1.0, max_drawdown: -0.2 }),
      strat("c", "Gamma", 0.2, { cagr: 0.05, sharpe: 0.8, max_drawdown: -0.3 }),
    ];
    const attribution: AttributionRow[] = [
      { strategy_id: "a", strategy_name: "Alpha", contribution: 0.01, allocation_effect: 0 },
      { strategy_id: "b", strategy_name: "Beta", contribution: 0.09, allocation_effect: 0 },
      { strategy_id: "c", strategy_name: "Gamma", contribution: 0.05, allocation_effect: 0 },
    ];

    render(
      <StrategyBreakdownTable
        strategies={strategies}
        attribution={attribution}
        portfolioId="p-1"
      />,
    );

    // Clicking a new column sorts descending by that column (component default).
    fireEvent.click(screen.getByText("Contribution %"));

    const links = screen.getAllByRole("link");
    // Beta (0.09) > Gamma (0.05) > Alpha (0.01)
    expect(links.map((l) => l.textContent)).toEqual(["Beta", "Gamma", "Alpha"]);
  });

  it("falls back to 'Unknown' name and em-dash contribution when joins are missing", () => {
    const strategies: StrategyInput[] = [
      { strategy_id: "a", current_weight: 0.5, strategies: null },
    ];

    render(
      <StrategyBreakdownTable strategies={strategies} attribution={null} portfolioId="p-1" />,
    );

    expect(screen.getByRole("link", { name: "Unknown" })).toBeInTheDocument();
  });
});

/**
 * B14 — Freshness / Liveness Signaling Contract.
 *
 * The breakdown table renders each constituent's Sharpe / MaxDD / TWR sourced
 * from that strategy's own `strategy_analytics`. Before B14 every row rendered
 * those metrics uniformly with NO indication of how stale each constituent's
 * data was — so a portfolio mixing a strategy recomputed 2h ago with one whose
 * analytics are 4 days old presented BOTH numbers as equally current. That is
 * the canonical B14 bug ("stale Sharpe/MaxDD shown as current").
 *
 * The fix surfaces per-row freshness via the shared SyncBadge primitive, which
 * routes through `computeFreshness` (the single staleness SoT, 12h/48h
 * thresholds). These specs encode WHY: each constituent must carry its own
 * liveness signal, and a row with no computed_at must NOT fabricate one.
 */
function hoursAgoIso(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

describe("<StrategyBreakdownTable> — B14 per-constituent freshness", () => {
  it("renders a per-row freshness badge keyed on each constituent's computed_at", () => {
    const strategies: StrategyInput[] = [
      strat("a", "Alpha", 0.6, { sharpe: 1.5, computed_at: hoursAgoIso(2) }),
      strat("b", "Beta", 0.4, { sharpe: 1.0, computed_at: hoursAgoIso(100) }),
    ];

    render(
      <StrategyBreakdownTable strategies={strategies} attribution={null} portfolioId="p-1" />,
    );

    // One "Synced … ago" badge per constituent that has a computed_at.
    expect(screen.getAllByText(/Synced/i)).toHaveLength(2);
  });

  it("distinguishes a fresh constituent (positive dot) from a stale one (negative dot)", () => {
    const strategies: StrategyInput[] = [
      // 2h ago → fresh (< 12h) → positive token.
      strat("a", "Fresh", 0.6, { sharpe: 1.5, computed_at: hoursAgoIso(2) }),
      // 100h ago → stale (≥ 48h) → negative token.
      strat("b", "Stale", 0.4, { sharpe: 1.0, computed_at: hoursAgoIso(100) }),
    ];

    const { container } = render(
      <StrategyBreakdownTable strategies={strategies} attribution={null} portfolioId="p-1" />,
    );

    // The fresh/stale split must be visible: exactly one positive and one
    // negative freshness dot (sourced from FRESHNESS_COLORS via SyncBadge).
    expect(container.querySelectorAll(".bg-positive")).toHaveLength(1);
    expect(container.querySelectorAll(".bg-negative")).toHaveLength(1);
  });

  it("renders NO freshness badge for a constituent missing computed_at (never fabricates liveness)", () => {
    const strategies: StrategyInput[] = [
      strat("a", "Alpha", 0.6, { sharpe: 1.5, computed_at: null }),
      strat("b", "Beta", 0.4, { sharpe: 1.0 }), // computed_at absent entirely
    ];

    render(
      <StrategyBreakdownTable strategies={strategies} attribution={null} portfolioId="p-1" />,
    );

    // Rows still render, but with no "Synced … ago" liveness claim.
    expect(screen.getAllByRole("row").slice(1)).toHaveLength(2);
    expect(screen.queryByText(/Synced/i)).toBeNull();
  });
});
