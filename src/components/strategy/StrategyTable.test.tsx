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
import userEvent from "@testing-library/user-event";
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

  // 50-05 port note: WatchlistTabs now routes through the Radix-backed Tabs
  // primitive, whose Trigger activates on the real pointer sequence
  // `@testing-library/user-event` dispatches (bare `fireEvent.click` does not flip
  // the controlled scope). The scope-switch clicks below therefore use
  // `await user.click(...)`; the test INTENT (switching to My Watchlist filters
  // the table) is unchanged.
  it("Case 5: scope='watchlist' with empty initialWatchedSet renders <EmptyWatchlist> and no table", async () => {
    const user = userEvent.setup();
    render(
      <StrategyTable
        strategies={STRATEGIES}
        categorySlug="crypto-sma"
        userId="u-1"
        initialWatchedSet={new Set()}
      />,
    );
    // Switch to My Watchlist scope.
    await user.click(screen.getByRole("tab", { name: /My Watchlist/ }));

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

  it("Case 6: scope='watchlist' with initialWatchedSet of 2 strategies renders only those 2", async () => {
    const user = userEvent.setup();
    render(
      <StrategyTable
        strategies={STRATEGIES}
        categorySlug="crypto-sma"
        userId="u-1"
        initialWatchedSet={new Set([STRATEGY_ID_A, STRATEGY_ID_B])}
      />,
    );
    await user.click(screen.getByRole("tab", { name: /My Watchlist/ }));

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

// --- F9 M-0475/M-0476: prefs mirror is per-scope -----------------------------
//
// The mirror-into-legacy-state effect (StrategyTable.tsx) is gated on
// `prefsHydrated` only, which never re-toggles when useDiscoveryPrefs's key
// flips on a client-side category change — so a REUSED instance keeps the
// previous category's view/sort. The call sites (/discovery/[slug],
// /browse/[slug]) pass `key={(user,)slug}` to force a remount. These tests pin
// the per-mount contract AND the bug-without-remount.
//
// Uses a self-contained in-memory localStorage: the file's shared jsdom storage
// lacks a working setItem in this env (see the try/catch around clear() above).
describe("StrategyTable — prefs mirror per scope (F9 M-0475/M-0476)", () => {
  function makeLocalStorage(): Storage {
    const store = new Map<string, string>();
    return {
      get length() {
        return store.size;
      },
      clear: () => store.clear(),
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      removeItem: (k: string) => {
        store.delete(k);
      },
      setItem: (k: string, v: string) => {
        store.set(k, String(v));
      },
    } as unknown as Storage;
  }

  const PREFS_KEY = "discovery_view_preferences:u-1:equity-sma";
  // Unversioned blob → adopted as v1 by the discovery codec's per-field merge.
  const GRID_PREFS = JSON.stringify({
    view: "grid",
    sort: { key: "sharpe", dir: "desc" },
    hide_examples: true,
  });

  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      value: makeLocalStorage(),
      configurable: true,
    });
  });

  it("a fresh mount mirrors ITS scope's persisted prefs (grid)", async () => {
    window.localStorage.setItem(PREFS_KEY, GRID_PREFS);
    render(
      <StrategyTable
        key="u-1:equity-sma"
        strategies={STRATEGIES}
        categorySlug="equity-sma"
        userId="u-1"
        initialWatchedSet={new Set()}
      />,
    );
    // After hydration the grid view applies for this scope → no <table>.
    await waitFor(() => {
      expect(document.querySelector("table")).toBeNull();
    });
  });

  it("stale on same-instance slug change; a keyed remount adopts the new scope", async () => {
    window.localStorage.setItem(PREFS_KEY, GRID_PREFS);

    const { rerender } = render(
      <StrategyTable
        key="u-1:crypto-sma"
        strategies={STRATEGIES}
        categorySlug="crypto-sma"
        userId="u-1"
        initialWatchedSet={new Set()}
      />,
    );
    await waitFor(() => {
      expect(document.querySelector("table")).not.toBeNull();
    });

    // Navigate to equity-sma WITHOUT remounting (same key) — the bug scenario.
    // useDiscoveryPrefs re-hydrates to grid, but the prefs-mirror effect does
    // NOT re-run, so the legacy view stays table (stale).
    rerender(
      <StrategyTable
        key="u-1:crypto-sma"
        strategies={STRATEGIES}
        categorySlug="equity-sma"
        userId="u-1"
        initialWatchedSet={new Set()}
      />,
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(document.querySelector("table")).not.toBeNull();

    // Remount via the slug-keyed key (the fix) — the mirror re-runs for the new
    // scope and adopts its grid prefs.
    rerender(
      <StrategyTable
        key="u-1:equity-sma"
        strategies={STRATEGIES}
        categorySlug="equity-sma"
        userId="u-1"
        initialWatchedSet={new Set()}
      />,
    );
    await waitFor(() => {
      expect(document.querySelector("table")).toBeNull();
    });
  });
});

// --- 50-06 STATE-03/04 dense reshape ----------------------------------------
//
// Pins the four reshape behaviors added in Plan 50-06: (a) the sticky header +
// sticky first column class contract; (b) HONEST priority-collapse — the per-row
// <details> relocates the SAME real value (and a genuinely-null source stays the
// honest-null em-dash, never a fabricated 0); (c) the table-scoped density
// control flips data-density on the TABLE ROOT (not <body>), wrapped in the
// reduced-motion-safe View-Transition helper; (d) the WatchlistTabs role=tabpanel
// / aria-labelledby wiring (Plan 50-05 contract) still resolves through the
// reshape. These are structural DOM/ARIA assertions, mirroring the file's style.

describe("StrategyTable — 50-06 dense reshape (STATE-03/04)", () => {
  it("sticky header cells carry `sticky top-0` + an explicit z-index + opaque bg-surface", () => {
    render(<StrategyTable strategies={STRATEGIES} categorySlug="crypto-sma" />);
    const headerCells = screen.getAllByRole("columnheader");
    // Every <th> in the sticky thead pins to the top with an opaque backing.
    for (const th of headerCells) {
      expect(th.className).toContain("sticky");
      expect(th.className).toContain("top-0");
      expect(th.className).toContain("bg-surface");
      expect(th.className).toMatch(/\bz-\d+\b/);
    }
    // The leading rank ("#") column is now the sticky-left corner — the
    // highest-ranked cell (z-30) that pins left-0.
    const rankHeader = screen.getByRole("columnheader", { name: /Rank/ });
    expect(rankHeader.className).toContain("left-0");
    expect(rankHeader.className).toContain("z-30");
    // The Strategy identity column stays sticky as the SECOND pinned column
    // (to the right of the rank column, which is w-14/left-0), one z-tier below
    // the corner — so it pins at left-14 when there is no star column.
    const strategyHeader = screen.getByRole("columnheader", { name: /Strategy/ });
    expect(strategyHeader.className).toContain("left-14");
    expect(strategyHeader.className).toContain("z-20");
  });

  it("50-REVIEW — sortable headers are keyboard-operable <button>s with aria-sort (WCAG 2.1.1 / 4.1.2)", () => {
    render(<StrategyTable strategies={STRATEGIES} categorySlug="crypto-sma" />);
    const strategyHeader = screen.getByRole("columnheader", { name: /Strategy/ });
    // Pre-fix this <th> was click-only (no inner control, no aria-sort): not
    // keyboard-operable and the sort state was conveyed only by a visual ↑/↓
    // glyph. The sort control must now be a real <button> (keyboard-operable)
    // and the <th> must expose aria-sort.
    expect(strategyHeader).toHaveAttribute("aria-sort");
    const sortButton = within(strategyHeader).getByRole("button", { name: /Strategy/ });
    // Activating the control (a native button — Enter/Space operable) changes
    // the column's sort state, and aria-sort reflects it for assistive tech.
    fireEvent.click(sortButton);
    expect(strategyHeader.getAttribute("aria-sort")).toMatch(/ascending|descending/);
  });

  it("the sticky first DATA column stays solid bg-surface and does NOT take the translucent row hover (Pitfall 5)", () => {
    render(<StrategyTable strategies={STRATEGIES} categorySlug="crypto-sma" />);
    const nameLink = screen.getByText("Alpha Stellar");
    const firstCell = nameLink.closest("td");
    expect(firstCell).not.toBeNull();
    expect(firstCell!.className).toContain("sticky");
    // The identity column is the second sticky column (pinned at left-14, to the
    // right of the leading w-14 rank cell which owns left-0).
    expect(firstCell!.className).toContain("left-14");
    expect(firstCell!.className).toContain("bg-surface");
    // The translucent hover lives on the OTHER cells (group-hover:bg-page/50);
    // the sticky first column must not carry it or scrolled cells bleed through.
    expect(firstCell!.className).not.toContain("group-hover:bg-page/50");
    // The leading rank cell is itself sticky at left-0 with the same opaque
    // backing, so it doesn't bleed under horizontal scroll either.
    const rankCell = within(firstCell!.closest("tr")!).getByText(/^#\d+$/).closest("td");
    expect(rankCell!.className).toContain("sticky");
    expect(rankCell!.className).toContain("left-0");
    expect(rankCell!.className).toContain("bg-surface");
    expect(rankCell!.className).not.toContain("group-hover:bg-page/50");
  });

  it("a collapsed-column <details> relocates the SAME real value the visible cell shows", () => {
    const fixture = makeStrategy({ id: STRATEGY_ID_A, name: "Alpha Stellar" });
    // Distinctive volatility so we can prove the details value === the cell value.
    fixture.analytics.volatility = 0.3377;
    render(<StrategyTable strategies={[fixture]} categorySlug="crypto-sma" />);

    const expected = "+33.77%"; // formatPercent(0.3377)
    // The value appears in BOTH the (CSS-collapsed) visible cell and the details
    // disclosure — getAllByText proves the relocated value is the real one.
    const matches = screen.getAllByText(expected);
    expect(matches.length).toBeGreaterThanOrEqual(2);

    // And it lives inside a <details> "More" disclosure (the reachable detail).
    const summary = screen.getByText("More");
    const details = summary.closest("details");
    expect(details).not.toBeNull();
    expect(within(details as HTMLElement).getByText(expected)).toBeDefined();
  });

  it("a NULL collapsed source renders the honest-null em-dash in the details — NEVER a fabricated 0 (no-invented-data / T-50-09)", () => {
    const fixture = makeStrategy({ id: STRATEGY_ID_A, name: "Alpha Stellar" });
    // Genuinely-absent volatility AND aum: the honest path must surface "—".
    fixture.analytics.volatility = null as unknown as number;
    fixture.aum = null as unknown as number;
    render(<StrategyTable strategies={[fixture]} categorySlug="crypto-sma" />);

    const summary = screen.getByText("More");
    const details = summary.closest("details") as HTMLElement;
    // The Volatility row in the details shows the honest-null em-dash…
    const volDt = within(details).getByText("Volatility");
    const volDd = volDt.nextElementSibling as HTMLElement;
    expect(volDd.textContent).toBe("—");
    // …and crucially NOT a fabricated zero / demo value.
    expect(volDd.textContent).not.toBe("0");
    expect(volDd.textContent).not.toBe("0.00%");
    expect(volDd.textContent).not.toMatch(/\$?0/);

    const aumDt = within(details).getByText("AUM");
    const aumDd = aumDt.nextElementSibling as HTMLElement;
    expect(aumDd.textContent).toBe("—");
    expect(aumDd.textContent).not.toMatch(/\$0/);
  });

  it("the density control has accessible name 'Table density' and toggling sets data-density on the TABLE ROOT (not <body>)", async () => {
    const user = userEvent.setup();
    render(<StrategyTable strategies={STRATEGIES} categorySlug="crypto-sma" />);

    const group = screen.getByRole("group", { name: "Table density" });
    expect(group).toBeDefined();

    // The data-density carrier is the [data-strategy-table] root, NOT <body>.
    const tableRoot = document.querySelector("[data-strategy-table]") as HTMLElement;
    expect(tableRoot).not.toBeNull();
    // Comfortable (default) leaves data-density unset — inherits :root 44px.
    expect(tableRoot.getAttribute("data-density")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Compact" }));
    expect(tableRoot.getAttribute("data-density")).toBe("tight");
    // The global <body> density (allocator dashboard knob) is untouched.
    expect(document.body.getAttribute("data-density")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Comfortable" }));
    expect(tableRoot.getAttribute("data-density")).toBeNull();
  });

  it("the WatchlistTabs role=tabpanel / aria-labelledby wiring still resolves through the reshape (Plan 50-05 contract)", () => {
    render(
      <StrategyTable
        strategies={STRATEGIES}
        categorySlug="crypto-sma"
        userId="u-1"
        initialWatchedSet={new Set()}
      />,
    );
    const panel = screen.getByRole("tabpanel");
    const labelledBy = panel.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    // The id the panel points at must resolve to a real tab element (the "All"
    // scope tab by default) — proves the trigger↔panel link is intact.
    const labelEl = document.getElementById(labelledBy!);
    expect(labelEl).not.toBeNull();
    expect(labelEl!.getAttribute("role")).toBe("tab");
  });
});

// --- v1.11 rank + percentile encoding ---------------------------------------
//
// The ranking table now carries an explicit encoding: a leading `#n` rank column
// tied to the ACTIVE sort order, and a quiet `Pnn` percentile suffix on the
// sorted column (fed by getPercentiles() via the `percentiles` prop). These
// tests pin the rank re-numbering and the honest-absence rules for the suffix.

/** Full PercentileMap entry (all metric keys required) with per-metric overrides. */
function makePercentiles(
  id: string,
  overrides: Partial<Record<string, number>>,
): Record<string, Record<string, number>> {
  return {
    [id]: {
      cagr: 50,
      sharpe: 50,
      sortino: 50,
      calmar: 50,
      max_drawdown: 50,
      volatility: 50,
      cumulative_return: 50,
      ...overrides,
    },
  };
}

describe("StrategyTable — v1.11 rank + percentile encoding", () => {
  it("renders a #n rank column tied to the active sort order and re-numbers when it changes", async () => {
    const user = userEvent.setup();
    const a = makeStrategy({ id: STRATEGY_ID_A, name: "Alpha Stellar" });
    const b = makeStrategy({ id: STRATEGY_ID_B, name: "Beta Voyager" });
    const c = makeStrategy({ id: STRATEGY_ID_C, name: "Gamma Pioneer" });
    a.analytics.cagr = 0.1;
    b.analytics.cagr = 0.3;
    c.analytics.cagr = 0.2;
    render(<StrategyTable strategies={[a, b, c]} categorySlug="crypto-sma" />);

    // Sort by CAGR (a fresh column → descending): Beta(30%) #1, Gamma(20%) #2,
    // Alpha(10%) #3 — rank 1 is the top of the current sort.
    const cagrHeader = screen.getByRole("columnheader", { name: /CAGR/ });
    await user.click(within(cagrHeader).getByRole("button"));
    let rows = Array.from(document.querySelectorAll("tbody tr"));
    expect(rows[0].textContent).toContain("#1");
    expect(rows[0].textContent).toContain("Beta Voyager");
    expect(rows[2].textContent).toContain("#3");
    expect(rows[2].textContent).toContain("Alpha Stellar");

    // Toggle CAGR ascending → the order (and thus the ranks) invert: #1 = Alpha.
    await user.click(within(cagrHeader).getByRole("button"));
    rows = Array.from(document.querySelectorAll("tbody tr"));
    expect(rows[0].textContent).toContain("#1");
    expect(rows[0].textContent).toContain("Alpha Stellar");
  });

  it("appends the category-scoped percentile suffix on the ACTIVE sort column when percentiles are provided", async () => {
    const user = userEvent.setup();
    const percentiles = makePercentiles(STRATEGY_ID_A, { cagr: 82 });
    render(
      <StrategyTable
        strategies={[makeStrategy({ id: STRATEGY_ID_A, name: "Alpha Stellar" })]}
        categorySlug="crypto-sma"
        percentiles={percentiles}
      />,
    );
    // Make CAGR the sorted column; its cell gains the quiet P82 suffix.
    const cagrHeader = screen.getByRole("columnheader", { name: /CAGR/ });
    await user.click(within(cagrHeader).getByRole("button"));

    const suffix = screen.getByText("P82");
    expect(suffix).toBeDefined();
    // The suffix rides the CAGR value cell (+18.00% from the fixture), proving it
    // is scoped to the ACTIVE sort column, not sprayed across every metric.
    expect(suffix.closest("td")?.textContent).toContain("+18.00%");
  });

  it("renders NO percentile suffix when percentiles are unavailable (honest absence, no fabricated rank)", () => {
    render(
      <StrategyTable
        strategies={[makeStrategy({ id: STRATEGY_ID_A, name: "Alpha Stellar" })]}
        categorySlug="crypto-sma"
      />,
    );
    expect(screen.queryByText(/^P\d+$/)).toBeNull();
  });

  it("renders NO percentile suffix when the sorted column has no percentile metric (e.g. Strategy name)", async () => {
    const user = userEvent.setup();
    const percentiles = makePercentiles(STRATEGY_ID_A, { cagr: 82 });
    render(
      <StrategyTable
        strategies={[makeStrategy({ id: STRATEGY_ID_A, name: "Alpha Stellar" })]}
        categorySlug="crypto-sma"
        percentiles={percentiles}
      />,
    );
    // Sort by the Strategy-name column — it has no percentile mapping, so NO
    // suffix renders anywhere (and none leaks from another column).
    const nameHeader = screen.getByRole("columnheader", { name: /Strategy/ });
    await user.click(within(nameHeader).getByRole("button"));
    expect(screen.queryByText(/^P\d+$/)).toBeNull();
  });
});

// --- v1.11 sign-restricted cell color policy --------------------------------
//
// Founder decision (audit finding 2): color is restricted to sign-carrying
// cells. Return/PnL keep the positive/negative tint (finite values only);
// magnitude columns (CAGR, Sharpe) render neutral ink; Max DD is red ONLY when
// finitely negative — never a blanket red column; and a non-finite "—" cell is
// never tinted.

describe("StrategyTable — v1.11 sign-restricted color policy", () => {
  it("sign-tints the return cell but renders CAGR + Sharpe in neutral ink", () => {
    const fixture = makeStrategy({ id: STRATEGY_ID_A, name: "Alpha Stellar" });
    fixture.analytics.cumulative_return = 0.42; // +42.00%
    fixture.analytics.cagr = 0.18; // +18.00%
    fixture.analytics.sharpe = 1.5; // 1.50
    render(<StrategyTable strategies={[fixture]} categorySlug="crypto-sma" />);
    const td = (t: string) => screen.getByText(t).closest("td")!;
    // Return carries a sign → positive token.
    expect(td("+42.00%").className).toContain("text-positive");
    // CAGR + Sharpe are magnitudes → neutral ink, never sign-tinted.
    expect(td("+18.00%").className).toContain("text-text-primary");
    expect(td("+18.00%").className).not.toMatch(/text-(positive|negative)/);
    expect(td("1.50").className).toContain("text-text-primary");
    expect(td("1.50").className).not.toMatch(/text-(positive|negative)/);
  });

  it("Max DD is red only for a finite negative value; a 0 value renders neutral (no blanket red column)", () => {
    const neg = makeStrategy({ id: STRATEGY_ID_A, name: "Alpha Stellar" });
    neg.analytics.max_drawdown = -0.12;
    const { unmount } = render(
      <StrategyTable strategies={[neg]} categorySlug="crypto-sma" />,
    );
    expect(screen.getByText("-12.00%").closest("td")!.className).toContain(
      "text-negative",
    );
    unmount();

    const zero = makeStrategy({ id: STRATEGY_ID_A, name: "Alpha Stellar" });
    zero.analytics.max_drawdown = 0;
    render(<StrategyTable strategies={[zero]} categorySlug="crypto-sma" />);
    const cell = screen.getByText("+0.00%").closest("td")!;
    expect(cell.className).toContain("text-text-primary");
    expect(cell.className).not.toContain("text-negative");
  });

  it("never sign-tints a non-finite '—' cell", () => {
    const fixture = makeStrategy({ id: STRATEGY_ID_A, name: "Alpha Stellar" });
    fixture.analytics.cumulative_return = null as unknown as number;
    render(<StrategyTable strategies={[fixture]} categorySlug="crypto-sma" />);
    const cell = screen.getByText("—").closest("td")!;
    expect(cell.className).not.toContain("text-positive");
    expect(cell.className).not.toContain("text-negative");
  });
});
