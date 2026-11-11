/**
 * Phase 197 / CLAR-02 (D-03) - a strategy whose DATA ended weeks ago must not rank as if it were
 * current.
 *
 * THE DEFECT. The discovery table sorts and numbers rows by figures, and nothing on a row reads how
 * old those figures are. `strategy_analytics.computed_at` is stamped by our own recompute, so a
 * strategy whose return series ended months ago can carry `computed_at = today` and the best Sharpe
 * in the list, and render as `#1`. The newest stored return day (`series_end`, the last
 * `returns_series` date) is the only honest age of a track record.
 *
 * WHY IT MATTERS TO AN LP. `#1` is the loudest claim in a row ("best here"). An allocator reading it
 * on a strategy that stopped reporting in the autumn is being told something false, with a fresh
 * "Synced" date beside it that makes the claim look checked.
 *
 * WHAT THIS FILE PINS. A stale row (newest return day older than the threshold) keeps its figures but
 * sorts after every current row under every sort key and both directions, loses its `#n` and its
 * `Pnn`, and shows an amber "Data from {date}" chip. A row whose newest day cannot be read is treated
 * the same way (the cautious direction) and says so. The stale verdict is a published-only rule: the
 * owner mount keeps its ordinals.
 *
 * ANTI-VACUITY. The stale fixture carries a FRESH `computed_at` and `trades_fetched_at` and the best
 * Sharpe, cagr and return in the list, so it can only land below the current rows by reading
 * `series_end`. Current control rows sit beside every stale row in every group, so no assertion can
 * pass by blanking the whole table. The clock is frozen, and the boundary cases sit exactly on the
 * threshold and one day past it.
 *
 * RED EVIDENCE. This file was written and run against the pre-change source first; the failing
 * assertions are quoted in 197-03-SUMMARY.md.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { StrategyTable } from "./StrategyTable";
import type { Strategy, StrategyAnalytics } from "@/lib/types";
import { installFetchMock, restoreFetchMock } from "@/test/helpers/fetch";

type StrategyWithAnalytics = Strategy & { analytics: StrategyAnalytics };

vi.mock("@/components/discovery/SimulateImpactButton", () => ({
  SimulateImpactButton: () => null,
}));

// --- Frozen clock --------------------------------------------------------

// The chip prints the series end through the one date helper (Phase 201 D-11, U-14): `Oct 9, 2026`.
// The expected strings below are typed by hand from this frozen day, 30 days ago = Oct 9 and 11 days
// ago = Oct 28, so a broken helper cannot agree with its own oracle.
const NOW_ISO = "2026-11-08T12:00:00.000Z";
const DAY_MS = 24 * 60 * 60 * 1000;

/** The UTC day `n` whole days before the frozen "now". */
function daysAgo(n: number): string {
  return new Date(Date.parse(NOW_ISO) - n * DAY_MS).toISOString().slice(0, 10);
}

beforeEach(() => {
  installFetchMock();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW_ISO));
  try {
    window.localStorage.clear();
  } catch {
    // jsdom without storage
  }
});

afterEach(() => {
  vi.useRealTimers();
  restoreFetchMock();
});

// --- Fixtures ------------------------------------------------------------

const ID_DORMANT = "52a10001-0000-4000-8000-000000000001";
const ID_CURRENT_A = "52a10001-0000-4000-8000-000000000002";
const ID_CURRENT_B = "52a10001-0000-4000-8000-000000000003";
const ID_UNKNOWN = "52a10001-0000-4000-8000-000000000004";

const NAME_DORMANT = "Dormant Quartz";
const NAME_CURRENT_A = "Meridian Current";
const NAME_CURRENT_B = "Bastion Current";
const NAME_UNKNOWN = "Unreadable Vesper";

/** A record long enough to clear the 194 one-year gate, so Sharpe is a real, sortable figure. */
const SERIES_START = "2024-06-01";

function analyticsFor(
  strategyId: string,
  over: Partial<StrategyAnalytics>,
): StrategyAnalytics {
  return {
    id: `an-${strategyId}`,
    strategy_id: strategyId,
    // A FRESH computed_at and trades_fetched_at on every row, the stale one included: the verdict
    // must come from series_end alone.
    computed_at: NOW_ISO,
    computing_started_at: null,
    computation_status: "complete",
    computation_error: null,
    benchmark: null,
    cumulative_return: 0.2,
    cagr: 0.1,
    volatility: 0.2,
    sharpe: 0.8,
    sortino: 1.1,
    calmar: 0.9,
    max_drawdown: -0.1,
    max_drawdown_duration_days: 20,
    six_month_return: 0.05,
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
    trades_fetched_at: NOW_ISO,
    series_start: SERIES_START,
    ...over,
  };
}

function makeRow(
  id: string,
  name: string,
  analytics: Partial<StrategyAnalytics>,
  strategy: Partial<Strategy> = {},
): StrategyWithAnalytics {
  return {
    id,
    name,
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
    asset_class: "crypto",
    ...strategy,
    analytics: analyticsFor(id, analytics),
  };
}

/** The best Sharpe, cagr and return in the list: if the verdict regresses this row is #1. */
const BEST = { sharpe: 3.77, cagr: 0.6612, cumulative_return: 0.9134 } as const;

function dormant(daysOld = 30) {
  return makeRow(ID_DORMANT, NAME_DORMANT, { ...BEST, series_end: daysAgo(daysOld) });
}
function currentA() {
  return makeRow(ID_CURRENT_A, NAME_CURRENT_A, { sharpe: 1.2, series_end: daysAgo(1) });
}
function currentB() {
  return makeRow(ID_CURRENT_B, NAME_CURRENT_B, { sharpe: 0.4, series_end: daysAgo(1) });
}
function unknown() {
  return makeRow(ID_UNKNOWN, NAME_UNKNOWN, { sharpe: 2.5, series_end: null });
}

// --- Helpers -------------------------------------------------------------

/** A full percentile record (every metric) whose Sharpe percentile is `sharpe`. */
function pct(sharpe: number) {
  return {
    cagr: 50,
    calmar: 50,
    cumulative_return: 50,
    max_drawdown: 50,
    sharpe,
    sortino: 50,
    volatility: 50,
  };
}

function mount(strategies: StrategyWithAnalytics[], props: Record<string, unknown> = {}) {
  return render(
    <StrategyTable
      key="stale-series"
      strategies={strategies}
      categorySlug="crypto-sma"
      {...props}
    />,
  );
}

/** Body rows in rendered order, each reduced to its name link text. */
function rowNames(): string[] {
  const table = screen.getByRole("table");
  return within(table)
    .getAllByRole("row")
    .slice(1)
    .map((tr) => tr.querySelector("a")?.textContent?.trim() ?? "");
}

function rowOf(name: string): HTMLElement {
  // NowrapWords splits a name across spans, so match the link by its whole text content.
  const link = screen
    .getAllByRole("link")
    .find((a) => a.textContent?.trim() === name);
  const tr = link?.closest("tr");
  if (!tr) throw new Error(`no row for ${name}`);
  return tr as HTMLElement;
}

function rankCellText(name: string): string {
  return (rowOf(name).querySelector("td")?.textContent ?? "").trim();
}

function clickSort(label: RegExp) {
  fireEvent.click(screen.getByRole("button", { name: label }));
}

// --- SC-3: the stale ranking ---------------------------------------------

describe("CLAR-02 stale ranking (SC-3): a stale best-Sharpe row does not rank as current", () => {
  it("renders the stale row below every current row, without #1, under Sharpe descending", () => {
    mount([dormant(), currentA(), currentB()]);
    expect(rowNames()).toEqual([NAME_CURRENT_A, NAME_CURRENT_B, NAME_DORMANT]);
    expect(rankCellText(NAME_DORMANT)).not.toContain("#");
    expect(rankCellText(NAME_CURRENT_A)).toBe("#1");
    expect(rankCellText(NAME_CURRENT_B)).toBe("#2");
  });

  it("keeps the stale row below every current row under Sharpe ascending (direction-independent)", () => {
    mount([dormant(), currentA(), currentB()]);
    clickSort(/^Sharpe/);
    expect(rowNames()).toEqual([NAME_CURRENT_B, NAME_CURRENT_A, NAME_DORMANT]);
    expect(rankCellText(NAME_DORMANT)).not.toContain("#");
  });

  it("keeps the stale row's own figures (real figures of an old record)", () => {
    mount([dormant(), currentA(), currentB()]);
    expect(rowOf(NAME_DORMANT).textContent).toContain("3.77");
    expect(rowOf(NAME_DORMANT).textContent).toContain("91.34%");
  });

  it("shows the amber 'Data from {series_end}' chip on the stale row and on no current row", () => {
    mount([dormant(), currentA(), currentB()]);
    const stale = rowOf(NAME_DORMANT);
    const chip = within(stale).getByText("Data from Oct 9, 2026");
    expect(chip.className).toContain("text-warning");
    expect(chip.className).toContain("bg-warning-bg");
    expect(chip.className).toContain("border-warning-border");
    expect(chip.getAttribute("title")).toBe(
      "The newest return day is 30 days old. Strategies with data older than 7 days are listed after current ones.",
    );
    expect(within(rowOf(NAME_CURRENT_A)).queryByText(/^Data from/)).toBeNull();
    expect(within(rowOf(NAME_CURRENT_B)).queryByText(/^Data from/)).toBeNull();
  });

  it("does not let a fresh computed_at or trades_fetched_at rescue the stale row", () => {
    // Every fixture row carries computed_at === trades_fetched_at === now; only series_end differs.
    const rows = [dormant(), currentA(), currentB()];
    for (const r of rows) {
      expect(r.analytics.computed_at).toBe(NOW_ISO);
      expect(r.analytics.trades_fetched_at).toBe(NOW_ISO);
    }
    mount(rows);
    expect(rowNames()[0]).not.toBe(NAME_DORMANT);
  });
});

// --- U-08: age unknown ---------------------------------------------------

describe("CLAR-02 age unknown (U-08): an unreadable newest day ranks with the stale rows", () => {
  it("sorts a null-series_end row after the current rows, with 'Data date unknown' and no ordinal", () => {
    mount([unknown(), currentA(), currentB()]);
    expect(rowNames()).toEqual([NAME_CURRENT_A, NAME_CURRENT_B, NAME_UNKNOWN]);
    expect(rankCellText(NAME_UNKNOWN)).not.toContain("#");
    const chip = within(rowOf(NAME_UNKNOWN)).getByText("Data date unknown");
    expect(chip.className).toContain("text-warning");
    expect(chip.getAttribute("title")).toBe(
      "The newest return day could not be read, so this strategy is listed after current ones.",
    );
  });
});

// --- Thresholds, at the table -------------------------------------------

describe("CLAR-02 thresholds at the table: exactly at the line is current, one day past is stale", () => {
  function rankedFirst(rows: StrategyWithAnalytics[]): string[] {
    mount(rows);
    return rowNames();
  }

  it("crypto: 7 whole days old keeps its place and #n, 8 days old does not", () => {
    const edge = makeRow(ID_DORMANT, NAME_DORMANT, { ...BEST, series_end: daysAgo(7) });
    expect(rankedFirst([edge, currentA()])[0]).toBe(NAME_DORMANT);
    expect(rankCellText(NAME_DORMANT)).toBe("#1");
  });

  it("crypto: 8 whole days old is stale", () => {
    const over = makeRow(ID_DORMANT, NAME_DORMANT, { ...BEST, series_end: daysAgo(8) });
    expect(rankedFirst([over, currentA()])[0]).toBe(NAME_CURRENT_A);
    expect(rankCellText(NAME_DORMANT)).not.toContain("#");
  });

  it("traditional: 10 days is current and 11 is stale, so a weekend and a holiday do not flag it", () => {
    const edge = makeRow(ID_DORMANT, NAME_DORMANT, { ...BEST, series_end: daysAgo(10) }, { asset_class: "traditional" });
    expect(rankedFirst([edge, currentA()])[0]).toBe(NAME_DORMANT);
  });

  it("traditional: 11 days is stale, with the 10-day threshold named in the chip title", () => {
    const over = makeRow(ID_DORMANT, NAME_DORMANT, { ...BEST, series_end: daysAgo(11) }, { asset_class: "traditional" });
    expect(rankedFirst([over, currentA()])[0]).toBe(NAME_CURRENT_A);
    const chip = within(rowOf(NAME_DORMANT)).getByText("Data from Oct 28, 2026");
    expect(chip.getAttribute("title")).toContain("older than 10 days");
    expect(chip.getAttribute("title")).toContain("is 11 days old");
  });

  it("a null asset_class takes the traditional threshold: 9 days old is current", () => {
    const row = makeRow(ID_DORMANT, NAME_DORMANT, { ...BEST, series_end: daysAgo(9) }, { asset_class: null });
    expect(rankedFirst([row, currentA()])[0]).toBe(NAME_DORMANT);
  });

  it("a series_end one day ahead of now (a same-day bar west of UTC) is current", () => {
    const tomorrow = makeRow(ID_DORMANT, NAME_DORMANT, { ...BEST, series_end: daysAgo(-1) });
    expect(rankedFirst([tomorrow, currentA()])[0]).toBe(NAME_DORMANT);
    expect(rankCellText(NAME_DORMANT)).toBe("#1");
  });

  it("a far-future series_end (a corrupt write) does not rank as current: no #n, 'Data date unknown', after the current rows", () => {
    // Before the fix a negative age was always "current", so this best-Sharpe row with a dead
    // record and series_end 2099-01-01 ranked #1 and carried no chip.
    const corrupt = makeRow(ID_DORMANT, NAME_DORMANT, { ...BEST, series_end: "2099-01-01" });
    mount([corrupt, currentA(), currentB()]);
    expect(rowNames()).toEqual([NAME_CURRENT_A, NAME_CURRENT_B, NAME_DORMANT]);
    expect(rankCellText(NAME_DORMANT)).not.toContain("#");
    expect(within(rowOf(NAME_DORMANT)).getByText("Data date unknown")).toBeTruthy();
  });
});

// --- U-09 / U-08: no percentile, a reason on the dash ---------------------

describe("CLAR-02 a stale row carries no Pnn and says why it is not ranked", () => {
  const percentiles = {
    [ID_DORMANT]: pct(99),
    [ID_CURRENT_A]: pct(61),
    [ID_CURRENT_B]: pct(22),
    [ID_UNKNOWN]: pct(88),
  };

  it("shows P-suffixes on current rows and none on the stale or age-unknown rows", () => {
    mount([dormant(), unknown(), currentA(), currentB()], { percentiles });
    expect(rowOf(NAME_CURRENT_A).textContent).toContain("P61");
    expect(rowOf(NAME_CURRENT_B).textContent).toContain("P22");
    expect(rowOf(NAME_DORMANT).textContent).not.toMatch(/P\d\d/);
    expect(rowOf(NAME_UNKNOWN).textContent).not.toMatch(/P\d\d/);
  });

  it("gives a stale row's dash a title and an sr-only reason naming the threshold", () => {
    mount([dormant(), currentA()]);
    const cell = rowOf(NAME_DORMANT).querySelector("td") as HTMLElement;
    expect(cell.getAttribute("title")).toBe("Not ranked: the data is more than 7 days old.");
    const sr = cell.querySelector(".sr-only");
    expect(sr?.textContent).toBe("Not ranked: the data is more than 7 days old.");
    expect(cell.textContent).toContain("—");
  });

  it("names the 10-day threshold for a traditional strategy", () => {
    const row = makeRow(ID_DORMANT, NAME_DORMANT, { ...BEST, series_end: daysAgo(30) }, { asset_class: "traditional" });
    mount([row, currentA()]);
    const cell = rowOf(NAME_DORMANT).querySelector("td") as HTMLElement;
    expect(cell.getAttribute("title")).toBe("Not ranked: the data is more than 10 days old.");
  });

  it("gives an age-unknown row's dash the unreadable-date reason", () => {
    mount([unknown(), currentA()]);
    const cell = rowOf(NAME_UNKNOWN).querySelector("td") as HTMLElement;
    expect(cell.getAttribute("title")).toBe("Not ranked: the data date could not be read.");
    expect(cell.querySelector(".sr-only")?.textContent).toBe("Not ranked: the data date could not be read.");
  });

  it("leaves a current row's rank cell untitled", () => {
    mount([dormant(), currentA()]);
    const cell = rowOf(NAME_CURRENT_A).querySelector("td") as HTMLElement;
    expect(cell.getAttribute("title")).toBeNull();
    expect(cell.querySelector(".sr-only")).toBeNull();
  });
});

// --- Ordering under every sort, in both directions ------------------------

describe("CLAR-02 the stale partition holds under every sort key and both directions", () => {
  // Distinct record lengths so the Track sort has a real order, with the stale row the LONGEST
  // record: ungated, it would lead a descending Track sort.
  function rows() {
    return [
      makeRow(ID_DORMANT, NAME_DORMANT, { ...BEST, series_end: daysAgo(30), series_start: "2023-01-01" }),
      makeRow(ID_CURRENT_A, NAME_CURRENT_A, { sharpe: 1.2, series_end: daysAgo(1), series_start: "2025-01-01" }),
      makeRow(ID_CURRENT_B, NAME_CURRENT_B, { sharpe: 0.4, series_end: daysAgo(1), series_start: "2025-06-01" }),
    ];
  }

  it("name ascending and descending: the stale row is last both times (name is not exempt)", () => {
    mount(rows());
    clickSort(/^Strategy$/);
    const first = rowNames();
    // "Dormant Quartz" sorts BETWEEN "Bastion Current" and "Meridian Current" by name, so an
    // ungated name sort would put it in the middle in both directions.
    expect(first[2]).toBe(NAME_DORMANT);
    clickSort(/^Strategy$/);
    const second = rowNames();
    expect(second[2]).toBe(NAME_DORMANT);
    // The current rows really did reorder between the two clicks: the sort ran.
    expect(second.slice(0, 2)).toEqual([...first.slice(0, 2)].reverse());
    expect(new Set(first.slice(0, 2))).toEqual(new Set([NAME_CURRENT_A, NAME_CURRENT_B]));
  });

  it("track descending and ascending: the longest record is last both times (track is not exempt)", () => {
    mount(rows());
    clickSort(/^Track, months of record$/);
    const first = rowNames();
    expect(first[2]).toBe(NAME_DORMANT);
    clickSort(/^Track, months of record$/);
    const second = rowNames();
    expect(second[2]).toBe(NAME_DORMANT);
    // The Track sort ran: the two current rows swapped between the clicks.
    expect(second.slice(0, 2)).toEqual([...first.slice(0, 2)].reverse());
  });

  it("an age-unknown row sorts with the stale rows: after the current rows, before nothing current", () => {
    mount([...rows(), unknown()]);
    const names = rowNames();
    expect(names.slice(0, 2)).toEqual([NAME_CURRENT_A, NAME_CURRENT_B]);
    expect(new Set(names.slice(2))).toEqual(new Set([NAME_DORMANT, NAME_UNKNOWN]));
    // Between themselves the active sort (Sharpe desc) still orders them: Dormant 3.77 > Unknown 2.5.
    expect(names.slice(2)).toEqual([NAME_DORMANT, NAME_UNKNOWN]);
  });
});

// --- Never removed; ordinals continue across pages ------------------------

describe("CLAR-02 a stale row is flagged and ordered, never removed", () => {
  it("keeps the stale row visible when the search names it, with its chip", () => {
    mount([dormant(), currentA(), currentB()]);
    fireEvent.change(screen.getByPlaceholderText("Search strategies..."), { target: { value: "Dormant" } });
    expect(rowNames()).toEqual([NAME_DORMANT]);
    expect(within(rowOf(NAME_DORMANT)).getByText(/^Data from/)).toBeTruthy();
  });

  it("counts #n over current rows only and continues across pages", () => {
    // 21 current rows fill page one (20) and spill one onto page two; the stale best-Sharpe row
    // follows them all.
    const current = Array.from({ length: 21 }, (_, i) =>
      makeRow(
        `52a10002-0000-4000-8000-${String(i).padStart(12, "0")}`,
        `Filler ${String(i).padStart(2, "0")}`,
        { sharpe: 1 + i / 100, series_end: daysAgo(1) },
      ),
    );
    mount([dormant(), ...current]);
    expect(rowNames()).toHaveLength(20);
    expect(rankCellText("Filler 20")).toBe("#1");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(rowNames()).toEqual(["Filler 00", NAME_DORMANT]);
    expect(rankCellText("Filler 00")).toBe("#21");
    expect(rankCellText(NAME_DORMANT)).not.toContain("#");
  });
});

// --- Grid view -------------------------------------------------------------

describe("CLAR-02 the grid shows the same chip in the same order", () => {
  const PREFS_KEY = "discovery_view_preferences:u-1:crypto-sma";

  it("renders the amber chip under the badge row of the stale card and orders it after the current cards", async () => {
    window.localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ view: "grid", sort: { key: "sharpe", dir: "desc" }, hide_examples: true }),
    );
    const { waitFor } = await import("@testing-library/react");
    render(
      <StrategyTable
        key="u-1:crypto-sma"
        strategies={[dormant(), unknown(), currentA(), currentB()]}
        categorySlug="crypto-sma"
        userId="u-1"
        initialWatchedSet={new Set()}
      />,
    );
    await waitFor(() => expect(document.querySelector("table")).toBeNull());
    const titles = Array.from(document.querySelectorAll("h3")).map((h) => h.textContent);
    expect(titles).toEqual([NAME_CURRENT_A, NAME_CURRENT_B, NAME_DORMANT, NAME_UNKNOWN]);
    const cardOf = (name: string) =>
      Array.from(document.querySelectorAll("h3")).find((h) => h.textContent === name)!.closest("a") as HTMLElement;
    expect(within(cardOf(NAME_DORMANT)).getByText("Data from Oct 9, 2026").className).toContain("text-warning");
    expect(within(cardOf(NAME_UNKNOWN)).getByText("Data date unknown")).toBeTruthy();
    expect(within(cardOf(NAME_CURRENT_A)).queryByText(/^Data (from|date)/)).toBeNull();
  });
});

// --- Owner mounts are untouched -------------------------------------------

describe("CLAR-02 the stale verdict is a published-only rule (U-04)", () => {
  it("visibility='owner-all-statuses': the same stale row keeps its #n and shows no chip", () => {
    mount([dormant(), currentA(), currentB()], { visibility: "owner-all-statuses" });
    // Ordered by Sharpe alone, exactly as before this phase.
    expect(rowNames()).toEqual([NAME_DORMANT, NAME_CURRENT_A, NAME_CURRENT_B]);
    expect(rankCellText(NAME_DORMANT)).toBe("#1");
    expect(rankCellText(NAME_CURRENT_B)).toBe("#3");
    expect(screen.queryByText(/^Data (from|date)/)).toBeNull();
  });
});

// --- The judged instant ----------------------------------------------------

describe("CLAR-02 nowMs is the instant the verdict is judged against", () => {
  it("a row stale at the system clock but current at the passed nowMs renders current", () => {
    const row = makeRow(ID_DORMANT, NAME_DORMANT, { ...BEST, series_end: daysAgo(12) });
    // System clock: 12 days old, stale. nowMs, 10 days earlier: 2 days old, current.
    mount([row, currentA()], { nowMs: Date.parse(NOW_ISO) - 10 * DAY_MS });
    expect(rowNames()[0]).toBe(NAME_DORMANT);
    expect(rankCellText(NAME_DORMANT)).toBe("#1");
  });

  it("a row current at the system clock but stale at the passed nowMs renders stale", () => {
    mount([currentA(), currentB()], { nowMs: Date.parse(NOW_ISO) + 30 * DAY_MS });
    expect(rankCellText(NAME_CURRENT_A)).not.toContain("#");
    expect(within(rowOf(NAME_CURRENT_A)).getByText(/^Data from/)).toBeTruthy();
  });
});

// --- /browse/[slug]: no nowMs, no visibility -------------------------------

describe("CLAR-02 /browse keeps the stale ordering on the table's own once-per-mount instant (U-04, T-197-18)", () => {
  // The /browse/[slug] page file is shared with Phase 196 and is not edited by this phase, so it
  // passes no `nowMs` and no `visibility`. This mounts the table with exactly the prop set that page
  // passes (key, strategies, categorySlug, basePath, percentiles) and proves the verdict still runs.
  const percentiles = {
    [ID_DORMANT]: pct(99),
    [ID_CURRENT_A]: pct(61),
    [ID_CURRENT_B]: pct(22),
  };

  function mountBrowse(strategies: StrategyWithAnalytics[]) {
    return render(
      <StrategyTable
        key="browse:crypto-sma"
        strategies={strategies}
        categorySlug="crypto-sma"
        basePath="/browse"
        percentiles={percentiles}
      />,
    );
  }

  it("orders a 30-day-old best-Sharpe row after every current row under Sharpe descending and ascending", () => {
    mountBrowse([dormant(), currentA(), currentB()]);
    expect(rowNames()).toEqual([NAME_CURRENT_A, NAME_CURRENT_B, NAME_DORMANT]);
    clickSort(/^Sharpe/);
    expect(rowNames()).toEqual([NAME_CURRENT_B, NAME_CURRENT_A, NAME_DORMANT]);
  });

  it("gives it no ordinal and no percentile, the chip, and leaves the current rows #1 and #2", () => {
    mountBrowse([dormant(), currentA(), currentB()]);
    expect(rankCellText(NAME_DORMANT)).not.toContain("#");
    expect(rowOf(NAME_DORMANT).textContent).not.toMatch(/P\d\d/);
    expect(within(rowOf(NAME_DORMANT)).getByText("Data from Oct 9, 2026")).toBeTruthy();
    expect(rankCellText(NAME_CURRENT_A)).toBe("#1");
    expect(rankCellText(NAME_CURRENT_B)).toBe("#2");
  });
});
