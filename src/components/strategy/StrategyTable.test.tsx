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
 * Plan reference: 13-01-PLAN.md Step 3c (Watchlist surface cases). The
 * suite has since grown to cover Save-preferences re-render (view-mode +
 * hide-examples) and the DISCO-04 sparkline color rule branches; each
 * test names its own anchor.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { StrategyTable } from "./StrategyTable";
import type { Strategy, StrategyAnalytics } from "@/lib/types";
import { installFetchMock, restoreFetchMock } from "@/test/helpers/fetch";

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
// Stub global fetch via installFetchMock so any internal call here is a
// no-op resolved promise (audit H-0404 + M-0470: typed surface + automatic
// restore replaces the legacy `@ts-expect-error` globalThis.fetch mutation
// that had no afterEach unstub). None of the watchedSet tests assert
// on the mock — they assert on rendered DOM state — so we don't need to
// hold the reference.
beforeEach(() => {
  installFetchMock();
  // CI flake root cause (HANDOVER-CI-FLAKES-2026-05-20 mode B): the
  // "Flip the view radio/toggle to grid" test at line ~340 persists
  // `discovery_view_preferences:u-1:crypto-sma` = `{view:"grid",...}`
  // to the SHARED jsdom localStorage. The DISCO-04 sparkline tests
  // below re-use `userId="u-1"`, `slug="crypto-sma"` — when the file's
  // tests run in CI shard ordering that puts the grid test BEFORE the
  // sparkline test, the userId-mode sparkline render hydrates into the
  // grid view (no <table>, no sparkline cells), the data-testid lookup
  // returns null, and the stroke assertion fails. Local runs were
  // green because the file finished cleanly and vitest tore down jsdom
  // before any next file could observe the leak. Fix: clear shared
  // localStorage between tests so prefs persistence can't carry across.
  try {
    window.localStorage.clear();
  } catch {
    // jsdom may not implement clear in some configurations; non-fatal.
  }
});
afterEach(() => {
  restoreFetchMock();
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
    // C-0140: assert intent (count badge with the right number), not
    // Tailwind class names. The legacy `.bg-accent.text-white` selector
    // would silently break on a theme refactor — and the inverse (badge
    // gone but classes remain on a dead element) would silently pass.
    render(
      <StrategyTable
        strategies={STRATEGIES}
        categorySlug="crypto-sma"
        userId="u-1"
        initialWatchedSet={new Set()}
      />,
    );

    // Initially the My Watchlist tab carries no badge — WatchlistTabs
    // hides the count span when count === 0.
    expect(screen.queryByTestId("watchlist-count-badge")).toBeNull();

    // Click the first row's star button. The optimistic flip mutates
    // watchedSet.size from 0 → 1 synchronously; the network PUT is
    // a no-op via the installFetchMock helper.
    const firstStar = screen.getAllByRole("button", {
      name: /Add .* to watchlist/,
    })[0];
    fireEvent.click(firstStar);

    // After the click the badge renders inside the My Watchlist tab
    // with textContent === "1". Anchoring on data-testid pins the
    // behavioural contract (badge visible AND scoped to the tab) without
    // coupling to any utility-class names.
    const watchTabAfter = screen.getByRole("tab", { name: /My Watchlist/ });
    const badge = within(watchTabAfter).getByTestId("watchlist-count-badge");
    expect(badge.textContent).toBe("1");
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

  it("Save preferences applies the new hide_examples value to the rendered table immediately", async () => {
    // Default DEFAULTS.hide_examples=true, so an example strategy is hidden
    // on first paint. Opening Customize, flipping the toggle off, and
    // clicking Save must reveal the example row without requiring a reload.
    const STRATEGIES_WITH_EXAMPLE: StrategyWithAnalytics[] = [
      makeStrategy({ id: STRATEGY_ID_A, name: "Alpha Stellar" }),
      makeStrategy({ id: STRATEGY_ID_B, name: "Beta Voyager" }),
      makeStrategy({
        id: STRATEGY_ID_C,
        name: "Example Demo Strategy",
        is_example: true,
      }),
    ];

    render(
      <StrategyTable
        strategies={STRATEGIES_WITH_EXAMPLE}
        categorySlug="crypto-sma"
        userId="u-1"
        initialWatchedSet={new Set()}
      />,
    );

    // After hydration the example strategy is hidden (hide_examples=true).
    await waitFor(() => {
      expect(screen.queryByText("Example Demo Strategy")).toBeNull();
    });
    expect(screen.getByText("Alpha Stellar")).toBeDefined();

    // Open the Customize drawer.
    fireEvent.click(
      screen.getByRole("button", { name: "Customize discovery view" }),
    );

    // Flip the Hide examples toggle OFF and Save.
    const checkboxes = screen.getAllByRole("checkbox");
    const hideExamplesCheckbox = checkboxes.find(
      (el) => (el as HTMLInputElement).checked,
    );
    expect(hideExamplesCheckbox).toBeDefined();
    fireEvent.click(hideExamplesCheckbox!);

    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));

    // The example strategy is now visible without a reload.
    await waitFor(() => {
      expect(screen.getByText("Example Demo Strategy")).toBeDefined();
    });
  });

  it("Save preferences applies view-mode change to the rendered table immediately", async () => {
    // Locks down the second legacy state slot (viewMode) — a regression
    // dropping setViewMode from handleSavePrefs would be invisible to the
    // hide_examples test alone.
    render(
      <StrategyTable
        strategies={STRATEGIES}
        categorySlug="crypto-sma"
        userId="u-1"
        initialWatchedSet={new Set()}
      />,
    );

    // Default view is "table" → table element is in DOM.
    await waitFor(() => {
      expect(document.querySelector("table")).not.toBeNull();
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Customize discovery view" }),
    );

    // Flip the view radio/toggle to grid. CustomizeDrawer renders a "Grid"
    // option; click whichever button reads "Grid".
    const gridButton = screen
      .getAllByRole("button")
      .find((b) => /^Grid$/i.test(b.textContent ?? ""));
    expect(gridButton).toBeDefined();
    fireEvent.click(gridButton!);

    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));

    // After Save the table element is gone (grid replaces it) without a reload.
    await waitFor(() => {
      expect(document.querySelector("table")).toBeNull();
    });
  });
});

// --- DISCO-04 sparkline color rule -----------------------------------------
//
// Synthetic-fixture component tests covering the three branches of the
// final-value-sign rule (final>0, final<0, final==0). The seed data on
// /discovery/crypto-sma trends positive across all 8 strategies, so these
// fixtures exist specifically to exercise the negative + zero render paths
// in component-level DOM assertions. The Playwright spec at
// e2e/discovery-sparkline-regression.spec.ts covers the live-DOM split-color
// invariant on top of these.
//
// C-0141 + M-0474: the legacy hardcoded `RETURNS_SPARK_TD_INDEX = 8` /
// `DRAWDOWN_SPARK_TD_INDEX = 9` magic numbers reached into the rendered
// table column ordering. A future column reorder, add, or remove in
// StrategyTable.tsx would silently shift the indices — the test would
// read stroke from a non-sparkline cell (path[stroke] returns null) and
// the diagnostic would blame the sparkline color rule instead of column
// drift. We now anchor on data-testid="sparkline-cell-returns" and
// data-testid="sparkline-cell-drawdown" emitted by StrategyTable.tsx so
// the test pins INTENT (the returns sparkline cell), not LAYOUT (column
// index #8). Adding a leading-star column for userId-mode users no
// longer breaks the test either.

function getStrokeOnSparkline(
  testId: "sparkline-cell-returns" | "sparkline-cell-drawdown",
): string | null {
  const cell = screen.queryByTestId(testId);
  if (!cell) return null;
  // Sparkline renders a stroked <path> for the trace. Locate the first
  // path[stroke] under this cell.
  const path = cell.querySelector("path[stroke]");
  return path?.getAttribute("stroke") ?? null;
}

describe("StrategyTable — DISCO-04 sparkline color rule (returns column only)", () => {
  it("renders the returns sparkline with var(--color-accent) when final > 0", () => {
    const fixture = makeStrategy({ id: STRATEGY_ID_A, name: "Alpha Stellar" });
    fixture.analytics.sparkline_returns = [0, 0.05, 0.1];
    render(<StrategyTable strategies={[fixture]} categorySlug="crypto-sma" />);
    expect(getStrokeOnSparkline("sparkline-cell-returns")).toBe(
      "var(--color-accent)",
    );
  });

  it("renders the returns sparkline with var(--color-negative) when final < 0", () => {
    const fixture = makeStrategy({ id: STRATEGY_ID_A, name: "Alpha Stellar" });
    fixture.analytics.sparkline_returns = [0, -0.02, -0.05];
    render(<StrategyTable strategies={[fixture]} categorySlug="crypto-sma" />);
    expect(getStrokeOnSparkline("sparkline-cell-returns")).toBe(
      "var(--color-negative)",
    );
  });

  it("renders the returns sparkline with var(--color-chart-benchmark) when final === 0", () => {
    const fixture = makeStrategy({ id: STRATEGY_ID_A, name: "Alpha Stellar" });
    fixture.analytics.sparkline_returns = [0.01, -0.01, 0];
    render(<StrategyTable strategies={[fixture]} categorySlug="crypto-sma" />);
    expect(getStrokeOnSparkline("sparkline-cell-returns")).toBe(
      "var(--color-chart-benchmark)",
    );
  });

  it("does NOT change the drawdown sparkline color (always var(--color-negative)) — Pitfall 7 invariant", () => {
    // Even when sparkline_returns ends positive (which would tint the
    // returns sparkline accent-green), the drawdown sparkline cell
    // (data-testid="sparkline-cell-drawdown") must still render with
    // the static var(--color-negative) prop. This proves the new
    // sign-driven rule does NOT bleed into the drawdown call site.
    const fixture = makeStrategy({ id: STRATEGY_ID_A, name: "Alpha Stellar" });
    fixture.analytics.sparkline_returns = [0, 0.05, 0.1]; // ends positive → accent
    fixture.analytics.sparkline_drawdown = [0, -0.1, -0.2, -0.05, 0];
    render(<StrategyTable strategies={[fixture]} categorySlug="crypto-sma" />);
    // Returns sparkline → accent (sign-driven)
    expect(getStrokeOnSparkline("sparkline-cell-returns")).toBe(
      "var(--color-accent)",
    );
    // Drawdown sparkline → static var(--color-negative)
    expect(getStrokeOnSparkline("sparkline-cell-drawdown")).toBe(
      "var(--color-negative)",
    );
  });

  it("sparkline cells stay locatable when the leading-star column is rendered (userId mode)", () => {
    // C-0141 regression guard: adding the leading-star column (userId
    // mode) shifts every subsequent <td> by +1. The legacy hardcoded
    // RETURNS_SPARK_TD_INDEX=8 would read the wrong cell here. The
    // data-testid lookup must continue to find the right sparkline.
    const fixture = makeStrategy({ id: STRATEGY_ID_A, name: "Alpha Stellar" });
    fixture.analytics.sparkline_returns = [0, 0.05, 0.1];
    render(
      <StrategyTable
        strategies={[fixture]}
        categorySlug="crypto-sma"
        userId="u-1"
        initialWatchedSet={new Set()}
      />,
    );
    expect(getStrokeOnSparkline("sparkline-cell-returns")).toBe(
      "var(--color-accent)",
    );
  });
});
