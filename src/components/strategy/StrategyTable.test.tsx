/**
 * Phase 13 / Plan 13-01 / DISCO-01 — StrategyTable Watchlist extension.
 *
 * These tests pin the new Watchlist surface added in Task 3 (the leading
 * star column, the WatchlistTabs scope switch, the EmptyWatchlist gate,
 * and the back-compat behaviour for non-Discovery callers like /browse).
 *
 * The tests are deliberately structural — they assert the right element
 * is in the DOM with the right ARIA contract — rather than re-running
 * the optimistic-fetch flow already covered by StarToggle.test.tsx. The
 * StarToggle child fires fetch on click; we mock it here so the toggle
 * state under test is just StrategyTable's own watchedSet mutation.
 *
 * Plan reference: 13-01-PLAN.md Step 3c lists the seven cases below.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { StrategyTable } from "./StrategyTable";
import type { Strategy, StrategyAnalytics } from "@/lib/types";

type StrategyWithAnalytics = Strategy & { analytics: StrategyAnalytics };

// --- Fixtures ------------------------------------------------------------

const STRATEGY_ID_A = "11111111-0000-4000-8000-000000000001";
const STRATEGY_ID_B = "11111111-0000-4000-8000-000000000002";
const STRATEGY_ID_C = "11111111-0000-4000-8000-000000000003";

function makeAnalytics(
  overrides?: Partial<StrategyAnalytics>,
): StrategyAnalytics {
  return {
    id: "an-1",
    strategy_id: "s-1",
    computed_at: "2026-01-01T00:00:00Z",
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
    ...overrides,
  };
}

function makeStrategy(
  overrides: Partial<Strategy> & { id: string; name: string },
): StrategyWithAnalytics {
  return {
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
    ...overrides,
    analytics: makeAnalytics({ strategy_id: overrides.id }),
  };
}

const STRATEGIES: StrategyWithAnalytics[] = [
  makeStrategy({ id: STRATEGY_ID_A, name: "Alpha Stellar" }),
  makeStrategy({ id: STRATEGY_ID_B, name: "Beta Voyager" }),
  makeStrategy({ id: STRATEGY_ID_C, name: "Gamma Pioneer" }),
];

// --- Module mocks --------------------------------------------------------

// SimulateImpactButton is a leaf with no relevant behaviour for these
// tests but pulls in client-only modules; stub it to keep this suite
// fast and focused on Watchlist surfaces.
vi.mock("@/components/discovery/SimulateImpactButton", () => ({
  SimulateImpactButton: () => null,
}));

// StarToggle's fetch path is exercised exhaustively in StarToggle.test.tsx.
// Stub global fetch so any internal call here is a no-op resolved promise
// — the tests assert on watchedSet wiring, not on network behaviour.
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({ ok: true });
  // @ts-expect-error — node test env exposes a mutable global.fetch
  globalThis.fetch = fetchMock;
});

// --- Tests ---------------------------------------------------------------

describe("StrategyTable — Watchlist extension (DISCO-01)", () => {
  it("Case 1: renders WatchlistTabs when userId is provided", () => {
    render(
      <StrategyTable
        strategies={STRATEGIES}
        categorySlug="crypto-sma"
        userId="u-1"
        initialWatchedSet={new Set()}
      />,
    );
    const tablist = screen.getByRole("tablist", {
      name: "Strategy list scope",
    });
    expect(tablist).toBeDefined();
    expect(
      within(tablist).getByRole("tab", { name: /^All$/ }),
    ).toBeDefined();
    expect(
      within(tablist).getByRole("tab", { name: /My Watchlist/ }),
    ).toBeDefined();
  });

  it("Case 2: does NOT render WatchlistTabs when userId is undefined (back-compat)", () => {
    render(
      <StrategyTable strategies={STRATEGIES} categorySlug="crypto-sma" />,
    );
    expect(screen.queryByRole("tablist", { name: "Strategy list scope" })).toBeNull();
  });

  it("Case 3: renders the leading star column when userId is provided", () => {
    render(
      <StrategyTable
        strategies={STRATEGIES}
        categorySlug="crypto-sma"
        userId="u-1"
        initialWatchedSet={new Set()}
      />,
    );
    // Three rows × one star button per row.
    const stars = screen.getAllByRole("button", {
      name: /to watchlist|from watchlist/,
    });
    expect(stars).toHaveLength(STRATEGIES.length);
  });

  it("Case 4: does NOT render the leading star column when userId is undefined", () => {
    render(
      <StrategyTable strategies={STRATEGIES} categorySlug="crypto-sma" />,
    );
    expect(
      screen.queryAllByRole("button", { name: /to watchlist|from watchlist/ }),
    ).toHaveLength(0);
  });

  it("Case 5: scope='watchlist' with empty initialWatchedSet renders <EmptyWatchlist> and no table", () => {
    render(
      <StrategyTable
        strategies={STRATEGIES}
        categorySlug="crypto-sma"
        userId="u-1"
        initialWatchedSet={new Set()}
      />,
    );
    // Switch to My Watchlist scope.
    fireEvent.click(screen.getByRole("tab", { name: /My Watchlist/ }));

    // EmptyWatchlist heading + body are now visible and the table itself
    // is not rendered.
    expect(screen.getByText("Your watchlist is empty")).toBeDefined();
    expect(
      screen.getByText(/Star strategies from the All tab to track them here/),
    ).toBeDefined();
    // The table contains the strategy name link cells; once empty-watchlist
    // takes over, those links are gone.
    expect(screen.queryByText("Alpha Stellar")).toBeNull();
    expect(screen.queryByText("Beta Voyager")).toBeNull();
    expect(screen.queryByText("Gamma Pioneer")).toBeNull();
  });

  it("Case 6: scope='watchlist' with initialWatchedSet of 2 strategies renders only those 2", () => {
    render(
      <StrategyTable
        strategies={STRATEGIES}
        categorySlug="crypto-sma"
        userId="u-1"
        initialWatchedSet={new Set([STRATEGY_ID_A, STRATEGY_ID_B])}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: /My Watchlist/ }));

    // Table is still rendered (watchedSet is non-empty); only the two
    // starred strategies appear.
    expect(screen.getByText("Alpha Stellar")).toBeDefined();
    expect(screen.getByText("Beta Voyager")).toBeDefined();
    expect(screen.queryByText("Gamma Pioneer")).toBeNull();
    // EmptyWatchlist is NOT rendered when the set is non-empty.
    expect(screen.queryByText("Your watchlist is empty")).toBeNull();
  });

  it("Case 7: clicking a star updates watchedSet and increments the count badge", () => {
    render(
      <StrategyTable
        strategies={STRATEGIES}
        categorySlug="crypto-sma"
        userId="u-1"
        initialWatchedSet={new Set()}
      />,
    );

    // Initially the My Watchlist tab carries no badge digit. The badge
    // is hidden when count === 0 (see WatchlistTabs.tsx); only "My
    // Watchlist" text is present.
    const watchTabBefore = screen.getByRole("tab", { name: /My Watchlist/ });
    expect(
      watchTabBefore.querySelector(".bg-accent.text-white"),
    ).toBeNull();

    // Click the first row's star button. The optimistic flip mutates
    // watchedSet.size from 0 → 1 synchronously; the network PUT (mocked
    // fetch above) is fire-and-forget for this assertion.
    const firstStar = screen.getAllByRole("button", {
      name: /Add .* to watchlist/,
    })[0];
    fireEvent.click(firstStar);

    // After the click the My Watchlist tab now renders the count badge
    // — a span with bg-accent text-white classes whose text reads "1".
    const watchTabAfter = screen.getByRole("tab", { name: /My Watchlist/ });
    const badge = watchTabAfter.querySelector(".bg-accent.text-white");
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toBe("1");
  });

  it("Case 8 (back-compat sanity): renders all 3 strategies when userId is undefined", () => {
    // This is the /browse path — no auth, no Watchlist surfaces, and the
    // table should look identical to Sprint 6's contract.
    render(
      <StrategyTable strategies={STRATEGIES} categorySlug="crypto-sma" />,
    );
    expect(screen.getByText("Alpha Stellar")).toBeDefined();
    expect(screen.getByText("Beta Voyager")).toBeDefined();
    expect(screen.getByText("Gamma Pioneer")).toBeDefined();
  });
});
