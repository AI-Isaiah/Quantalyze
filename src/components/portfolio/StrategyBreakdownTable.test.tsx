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
    computation_status?: string | null;
    // Phase 163 / HONEST-08 — `getPortfolioStrategies` carries the array, and
    // `seriesEndOf` picks its last point. Fixtures supply it so the badge's
    // second clock is exercised on the real shape this read delivers.
    returns_series?: { date: string; value: number }[] | null;
  } | null,
): StrategyInput {
  return {
    strategy_id: id,
    current_weight: weight,
    strategies: {
      id,
      name,
      // STALE-01: default the row to a TERMINAL SUCCESS. `computation_status`
      // is projected by `getPortfolioStrategies` and is non-null in the schema,
      // so a status-less analytics row was never a shape the DB could return.
      // Now that the table withholds a non-terminal row's figures and freshness
      // badge, the fixture has to say which run wrote them; every case here is
      // about a COMPUTED constituent's rendering. The dedicated non-terminal
      // cases live in StrategyBreakdownTable.stale-analytics.test.tsx.
      strategy_analytics: analytics
        ? { computation_status: "complete", ...analytics }
        : analytics,
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

/** A `returns_series` point date N days back — Phase 163 / HONEST-08. */
function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
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
      // 2h ago → fresh (< 12h) → positive token. Phase 163 / HONEST-08: the
      // row must ALSO carry a live track record to earn the green dot — a job
      // that ran 2h ago over a dead series is not a fresh constituent, and an
      // ABSENT series is capped below fresh (see the cap spec below). The
      // series end is supplied here so this spec keeps testing the fresh/stale
      // split it was written for rather than the unknown-series cap.
      strat("a", "Fresh", 0.6, {
        sharpe: 1.5,
        computed_at: hoursAgoIso(2),
        returns_series: [{ date: isoDaysAgo(1), value: 1.2 }],
      }),
      // 100h ago → stale (≥ 48h) → negative token.
      strat("b", "Stale", 0.4, {
        sharpe: 1.0,
        computed_at: hoursAgoIso(100),
        returns_series: [{ date: isoDaysAgo(1), value: 1.1 }],
      }),
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

  /**
   * Phase 163 / HONEST-08. A portfolio's constituents are OTHER managers'
   * strategies, so this table makes cross-tenant freshness claims — the same
   * shape of claim that `/browse` was measured making falsely on production
   * 2026-08-26 ("Synced 7h ago" over a series that ended 112 days earlier).
   * The rule is applied here for the same reason it is applied there.
   */
  it("HONEST-08: a fresh job over a dead track record reads the TRACK RECORD", () => {
    const strategies: StrategyInput[] = [
      strat("a", "DeadTrack", 1, {
        sharpe: 1.5,
        computed_at: hoursAgoIso(7),
        returns_series: [{ date: isoDaysAgo(112), value: 1.4 }],
      }),
    ];

    const { container } = render(
      <StrategyBreakdownTable strategies={strategies} attribution={null} portfolioId="p-1" />,
    );

    expect(container.querySelectorAll(".bg-positive")).toHaveLength(0);
    expect(container.querySelectorAll(".bg-negative")).toHaveLength(1);
    expect(screen.queryByText(/Synced/i)).toBeNull();
    expect(screen.getByText(/Track record ends/i)).toBeTruthy();
  });

  /**
   * ── The UNDECLARED PRECONDITION behind "where does the track record end" ──
   *
   * `seriesEndOf` answered that question by taking `points[points.length - 1]`
   * — the LAST array element. That is the right answer only if `returns_series`
   * is stored date-ASCENDING, and nothing in this repo asserted it on the read
   * side. A silently-wrong "last point" is a freshness lie, which is the exact
   * class this phase exists to close, so the assumption may not stay unstated.
   *
   * IT IS NOT A HYPOTHETICAL DISAGREEMENT. `public.ledger_refresh_staleness`
   * (supabase/migrations/20260825120000_..._view.sql, decision D-03) asks the
   * SAME question of the SAME column and answers it with
   * `max((e->>'date')::date)` — explicitly rejecting a positional pick. Two
   * derivations of one fact, differing on ordering, is precisely how the list
   * badge and the factsheet chip came to contradict each other in the first
   * place.
   *
   * THE FAILURE IS USER-VISIBLE AND POINTS THE WRONG WAY. With a descending or
   * backfill-appended array the positional pick returns the OLDEST date, so a
   * strategy whose track record ran through YESTERDAY is painted red and
   * captioned "Track record ends 112d ago" — the badge calling a live strategy
   * dead. That is why this spec asserts the RENDERED dot and sentence rather
   * than `seriesEndOf`'s return value: asserting the helper against its own
   * pick would be self-referential and would survive the bug.
   *
   * ⭐ RED DEMONSTRATION (performed 2026-08-26, before the fix). Verbatim:
   *
   *     × the track record END is the LATEST point, not the last array slot
   *       → expected 'h-1.5 w-1.5 rounded-full shrink-0 bg-negative' not to
   *         contain 'bg-negative'
   *
   * The ASCENDING control below stayed green under the unfixed code and must
   * stay green after, which is what proves the change is a repair of the
   * unordered case and not a blanket rewrite of the healthy one.
   */
  it("PRECONDITION: the track record END is the LATEST point, not the last array slot", () => {
    const strategies: StrategyInput[] = [
      strat("a", "Descending", 1, {
        sharpe: 1.5,
        computed_at: hoursAgoIso(2),
        // Newest FIRST — the ordering the read path never asserted. The true
        // end of this track record is yesterday; the last slot holds the
        // oldest point.
        returns_series: [
          { date: isoDaysAgo(1), value: 1.4 },
          { date: isoDaysAgo(56), value: 1.2 },
          { date: isoDaysAgo(112), value: 1.0 },
        ],
      }),
    ];

    const { container } = render(
      <StrategyBreakdownTable strategies={strategies} attribution={null} portfolioId="p-1" />,
    );

    // A strategy trading through yesterday is not dead, and the badge may not
    // say it is.
    expect(container.querySelectorAll(".bg-negative")).toHaveLength(0);
    expect(screen.queryByText(/Track record ends/i)).toBeNull();
    // The job ran 2h ago over a live track record: the honest render is the
    // sync-keyed one, in green.
    expect(screen.getByText(/Synced 2h ago/i)).toBeTruthy();
    expect(container.querySelectorAll(".bg-positive")).toHaveLength(1);
  });

  it("PRECONDITION CONTROL: an ASCENDING series is unchanged — still the last point", () => {
    const strategies: StrategyInput[] = [
      strat("a", "Ascending", 1, {
        sharpe: 1.5,
        computed_at: hoursAgoIso(7),
        // Oldest FIRST — the shape the analytics runner actually writes. Here
        // the last slot IS the latest point, and the verdict must not move.
        returns_series: [
          { date: isoDaysAgo(224), value: 1.0 },
          { date: isoDaysAgo(168), value: 1.2 },
          { date: isoDaysAgo(112), value: 1.4 },
        ],
      }),
    ];

    const { container } = render(
      <StrategyBreakdownTable strategies={strategies} attribution={null} portfolioId="p-1" />,
    );

    // Dead track record, and it stays dead. Without this control a "fix" that
    // simply stopped reading the series at all would pass the case above.
    expect(container.querySelectorAll(".bg-negative")).toHaveLength(1);
    expect(screen.getByText(/Track record ends/i)).toBeTruthy();
    expect(screen.queryByText(/Synced/i)).toBeNull();
  });

  it("HONEST-08: an UNKNOWN track record caps the dot below fresh", () => {
    const strategies: StrategyInput[] = [
      // Terminal success, computed 2h ago, but the read carried no series at
      // all — so this surface cannot evidence a live strategy and must not
      // paint one green.
      strat("a", "NoSeries", 1, {
        sharpe: 1.5,
        computed_at: hoursAgoIso(2),
        returns_series: null,
      }),
    ];

    const { container } = render(
      <StrategyBreakdownTable strategies={strategies} attribution={null} portfolioId="p-1" />,
    );

    expect(container.querySelectorAll(".bg-positive")).toHaveLength(0);
    // Not a staleness claim either — the job really did run 2h ago.
    expect(container.querySelectorAll(".bg-negative")).toHaveLength(0);
    expect(screen.getByText(/Synced 2h ago/i)).toBeTruthy();
  });
});
