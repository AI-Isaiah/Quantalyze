/**
 * Phase 252 plan 04 - the Discovery table and grid render an options book's row with no rank and a
 * named reason.
 *
 * WHY. A strategy whose stored figures are measured on the cash wallet leaves `shapeRowAnalytics`
 * blank and marked (`headline_withheld_cause`). The row is still a strategy the owner or an
 * allocator should see, so it stays displayed with its sync line and actions, but it must not claim
 * a place in a ranking: an ordinal ("#2") is the loudest ranking claim a row makes, and here it
 * would be sourced from numbers the page refuses to print. Its cells name the reason on hover and to
 * a screen reader, in the one sentence the figure gate owns.
 *
 * The sentence is typed by hand below: copying it from the source would make the pin agree with
 * whatever the source says.
 *
 * ANTI-VACUITY. The ranked control rows sit beside the flagged row in every case, so nothing can pass
 * by blanking the whole table, and the control case renders the SAME row without the marker and with
 * its figures and gets today's rendering.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within, cleanup } from "@testing-library/react";
import { StrategyTable } from "./StrategyTable";
import { StrategyGrid } from "./StrategyGrid";
import type { Strategy, StrategyAnalytics } from "@/lib/types";
import { installFetchMock, restoreFetchMock } from "@/test/helpers/fetch";

type Row = Strategy & { analytics: StrategyAnalytics };

vi.mock("@/components/discovery/SimulateImpactButton", () => ({
  SimulateImpactButton: () => null,
}));

const SENTENCE = "Withheld: measured on the cash wallet, which leaves out open option positions.";
const EM_DASH = "—";

const NOW_ISO = "2026-11-25T12:00:00.000Z";
const DAY_MS = 24 * 60 * 60 * 1000;
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
  cleanup();
  vi.useRealTimers();
  restoreFetchMock();
});

const ID_FLAGGED = "52b40001-0000-4000-8000-000000000001";
const ID_A = "52b40001-0000-4000-8000-000000000002";
const ID_B = "52b40001-0000-4000-8000-000000000003";
const ID_C = "52b40001-0000-4000-8000-000000000004";

const NAME_FLAGGED = "Options Helios";
const NAME_A = "Meridian Alpha";
const NAME_B = "Bastion Beta";
const NAME_C = "Corvus Gamma";

/** What `shapeRowAnalytics` hands the table for a flagged row: blank, real status, the named marker. */
const BLANK_MARKED: Partial<StrategyAnalytics> = {
  computed_at: "",
  computation_status: "complete",
  cumulative_return: null,
  cagr: null,
  volatility: null,
  sharpe: null,
  sortino: null,
  calmar: null,
  max_drawdown: null,
  six_month_return: null,
  sparkline_returns: null,
  sparkline_drawdown: null,
  series_start: undefined,
  series_end: null,
  headline_since: undefined,
  record_observations: undefined,
  headline_withheld_cause: "options_cash_wallet",
};

function analyticsFor(strategyId: string, over: Partial<StrategyAnalytics>): StrategyAnalytics {
  return {
    id: `an-${strategyId}`,
    strategy_id: strategyId,
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
    series_start: "2024-06-01",
    series_end: daysAgo(1),
    ...over,
  };
}

function makeRow(
  id: string,
  name: string,
  analytics: Partial<StrategyAnalytics>,
  strategy: Partial<Strategy> = {},
): Row {
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

/** The flagged row: it would be the best Sharpe in the list if its figures were handed through. */
const flagged = () => makeRow(ID_FLAGGED, NAME_FLAGGED, BLANK_MARKED);
/** The SAME row with no marker and the figures restored (the control). */
const unflagged = () =>
  makeRow(ID_FLAGGED, NAME_FLAGGED, { sharpe: 3.77, cagr: 0.6612, cumulative_return: 0.9134 });
const rankedRows = () => [
  makeRow(ID_A, NAME_A, { sharpe: 1.5 }),
  makeRow(ID_B, NAME_B, { sharpe: 1.1 }),
  makeRow(ID_C, NAME_C, { sharpe: 0.6 }),
];

function mount(strategies: Row[], props: Record<string, unknown> = {}) {
  return render(
    <StrategyTable key="options-withhold" strategies={strategies} categorySlug="options-withhold" {...props} />,
  );
}

function rowNames(): string[] {
  const table = screen.getByRole("table");
  return within(table)
    .getAllByRole("row")
    .slice(1)
    .map((tr) => tr.querySelector("a")?.textContent?.trim() ?? "");
}

function rowOf(name: string): HTMLElement {
  const link = screen.getAllByRole("link").find((a) => a.textContent?.trim() === name);
  const tr = link?.closest("tr");
  if (!tr) throw new Error(`no row for ${name}`);
  return tr as HTMLElement;
}

function rankCell(name: string): HTMLElement {
  return rowOf(name).querySelector("td") as HTMLElement;
}

/** The body cell under the header whose text matches, the n-th such header (0-based). */
function cellUnder(name: string, header: RegExp, nth = 0): HTMLElement {
  const ths = Array.from(screen.getByRole("table").querySelectorAll("thead th"));
  const idx = ths
    .map((th, i) => ({ text: th.textContent?.trim() ?? "", i }))
    .filter((h) => header.test(h.text))
    .map((h) => h.i)[nth];
  if (idx === undefined) throw new Error(`no header matching ${header}`);
  return rowOf(name).querySelectorAll("td")[idx] as HTMLElement;
}

describe("252 table: a flagged row takes no rank and names why", () => {
  for (const visibility of ["owner-all-statuses", "published-only"] as const) {
    describe(`on the ${visibility} mount`, () => {
      it("has no #n, shows a dash in the rank cell with the hand-typed sentence as title and screen-reader text, and the ranked rows number #1 to #3", () => {
        mount([flagged(), ...rankedRows()], { visibility });
        const cell = rankCell(NAME_FLAGGED);
        expect(cell.textContent).not.toContain("#");
        expect(cell.textContent?.startsWith(EM_DASH)).toBe(true);
        expect(cell.getAttribute("title")).toBe(SENTENCE);
        expect(within(cell).getByText(SENTENCE).className).toContain("sr-only");
        // Anti-vacuity: the rows beside it were ranked, contiguously, without the flagged row.
        expect(rankCell(NAME_A).textContent).toBe("#1");
        expect(rankCell(NAME_B).textContent).toBe("#2");
        expect(rankCell(NAME_C).textContent).toBe("#3");
      });

      it("sorts after every ranked row under Sharpe descending and under Sharpe ascending", () => {
        mount([flagged(), ...rankedRows()], { visibility });
        expect(rowNames()).toEqual([NAME_A, NAME_B, NAME_C, NAME_FLAGGED]);
        fireEvent.click(screen.getByRole("button", { name: /^Sharpe/ }));
        expect(rowNames()).toEqual([NAME_C, NAME_B, NAME_A, NAME_FLAGGED]);
      });

      it("dashes CAGR, Sharpe and Volatility with the same sentence, and shows a plain dash for Return and Max DD", () => {
        mount([flagged(), ...rankedRows()], { visibility });
        for (const header of [/^CAGR/, /^Sharpe/, /^Volatility/]) {
          const cell = cellUnder(NAME_FLAGGED, header);
          expect(cell.textContent, String(header)).toContain(EM_DASH);
          expect(cell.querySelector(`span[title="${SENTENCE}"]`), String(header)).not.toBeNull();
          expect(within(cell).getByText(SENTENCE).className).toContain("sr-only");
        }
        expect(cellUnder(NAME_FLAGGED, /^Return/, 0).textContent?.trim()).toBe(EM_DASH);
        expect(cellUnder(NAME_FLAGGED, /^Max DD/).textContent?.trim()).toBe(EM_DASH);
      });

      it("carries no 'No data' chip, no 'Data date unknown' chip and no 'could not be read' reason", () => {
        mount([flagged(), ...rankedRows()], { visibility });
        const row = rowOf(NAME_FLAGGED);
        expect(within(row).queryByText("No data")).toBeNull();
        expect(within(row).queryByText("Data date unknown")).toBeNull();
        expect(row.textContent).not.toContain("could not be read");
        // The row is still displayed: its owner actions and name link are there.
        expect(within(row).getByRole("link", { name: NAME_FLAGGED })).toBeTruthy();
      });
    });
  }

  it("under the Created sort (the manager mount), where unranked rows interleave, the flagged row is still unnumbered and the ranked rows number #1 to #3 with no hole", () => {
    // The Created sort skips the ranked partition, so the flagged row (the newest) sits FIRST in table
    // order. Only the ranked predicate keeps it from taking #1 and shifting everyone down.
    const newest = makeRow(ID_FLAGGED, NAME_FLAGGED, BLANK_MARKED, { created_at: "2026-11-24T00:00:00Z" });
    const rows = rankedRows().map((r, i) => ({ ...r, created_at: `2026-11-0${i + 1}T00:00:00Z` }));
    mount([...rows, newest], {
      visibility: "owner-all-statuses",
      initialSort: { key: "created_at", dir: "desc" },
    });
    expect(rowNames()[0]).toBe(NAME_FLAGGED);
    expect(rankCell(NAME_FLAGGED).textContent).not.toContain("#");
    expect(rankCell(NAME_FLAGGED).getAttribute("title")).toBe(SENTENCE);
    // Table order is newest first: C (Nov 3), B (Nov 2), A (Nov 1) after the flagged row.
    expect(rankCell(NAME_C).textContent).toBe("#1");
    expect(rankCell(NAME_B).textContent).toBe("#2");
    expect(rankCell(NAME_A).textContent).toBe("#3");
  });

  it("control: the same row without the marker and with its figures is ranked #1 with today's cells and no sentence", () => {
    mount([unflagged(), ...rankedRows()], { visibility: "owner-all-statuses" });
    expect(rowNames()[0]).toBe(NAME_FLAGGED);
    expect(rankCell(NAME_FLAGGED).textContent).toBe("#1");
    expect(rankCell(NAME_FLAGGED).getAttribute("title")).toBeNull();
    expect(rowOf(NAME_FLAGGED).textContent).toContain("3.77");
    expect(rowOf(NAME_FLAGGED).textContent).toContain("91.34%");
    expect(rowOf(NAME_FLAGGED).textContent).not.toContain(SENTENCE);
  });

  it("a stale-series reason still wins the rank cell's title on a row that has one (the marker is the fallback, not an override)", () => {
    // A row with the marker never carries a verdict (its series_end is blank because of the
    // withhold), so on the published-only mount the sentence is what shows. This pins that no
    // stale chip text leaks onto it, and that an ordinary stale row beside it keeps its own reason.
    const stale = makeRow("52b40001-0000-4000-8000-000000000009", "Dormant Quartz", {
      sharpe: 2.5,
      series_end: daysAgo(30),
    });
    mount([flagged(), stale, ...rankedRows()], { visibility: "published-only" });
    expect(rankCell("Dormant Quartz").getAttribute("title")).toBe(
      "Not ranked: the data is more than 7 days old.",
    );
    expect(rankCell(NAME_FLAGGED).getAttribute("title")).toBe(SENTENCE);
  });
});

describe("252 grid: a flagged card dashes its CAGR with the sentence", () => {
  it("shows a dash, not 0.00%, and the sentence", () => {
    render(<StrategyGrid strategies={[flagged()]} />);
    const cell = screen.getByText("CAGR", { exact: false }).parentElement as HTMLElement;
    expect(cell.textContent).toContain(EM_DASH);
    expect(cell.textContent).toContain(SENTENCE);
    expect(cell.textContent).not.toContain("%");
  });

  it("control: the unflagged card shows its CAGR", () => {
    render(<StrategyGrid strategies={[unflagged()]} />);
    const cell = screen.getByText("CAGR", { exact: false }).parentElement as HTMLElement;
    expect(cell.textContent).toContain("+66.12%");
    expect(cell.textContent).not.toContain(SENTENCE);
  });
});
