/**
 * Phase 52 / Plan 52-03 / Task 1 — CompareTable @container migration contract.
 *
 * TDD RED phase: these three behavior assertions are written BEFORE the
 * @container migration so the suite fails until CompareTable.tsx is migrated.
 *
 * The CompareTable is the /compare side-by-side comparison-table component:
 * one column per selected strategy, a fixed metric-label column on the left.
 * This phase migrates its containment region to a CSS `@container` context
 * (TYPE-04) and recovers the strategy-name header cells via `title=` (TYPE-02
 * tabular treatment), while preserving `tabular-nums` on every numeric value.
 *
 * Modeled on StrategyTable.test.tsx's structural render + className-query idiom
 * (assert the right element is in the DOM with the right contract). These are
 * deliberately structural — they pin the migration invariants, not the metric
 * math (covered by the page's own RTL suite + the formatters' unit tests).
 *
 * Distinct from the phase-52-container-tabular-nums.test.tsx registry (52-01
 * owns that, gating the live StrategyTable render); this file is owned solely
 * by 52-03 and sits beside CompareTable.tsx.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CompareTable } from "./CompareTable";
import type { Strategy, StrategyAnalytics } from "@/lib/types";
import type { FigureRecord } from "@/lib/figure-gate";
import type { HoldingCompareItem } from "@/app/(dashboard)/compare/lib/holding-compare-adapter";

// The holding panel is not under test here; a stub that records the item it is handed
// proves a holding column passes through the table untouched.
const holdingPanelItems: unknown[] = [];
vi.mock("./HoldingFactsheet", () => ({
  HoldingFactsheet: ({ item }: { item: unknown }) => {
    holdingPanelItems.push(item);
    return <div data-testid="holding-panel" />;
  },
}));

afterEach(cleanup);

// --- Fixtures ------------------------------------------------------------

const STRATEGY_ID_A = "aaaaaaaa-0000-4000-8000-000000000001";
const STRATEGY_ID_B = "bbbbbbbb-0000-4000-8000-000000000002";

const STRATEGY_A_NAME =
  "Alpha Momentum Long/Short Equity Composite Strategy (very long name)";
const STRATEGY_B_NAME =
  "Beta Cross-Asset Carry & Trend Diversified Programme (very long name)";

function makeAnalytics(overrides?: Partial<StrategyAnalytics>): StrategyAnalytics {
  return {
    id: "an-1",
    strategy_id: "s-1",
    computed_at: "2026-01-01T00:00:00Z",
    computing_started_at: null,
    computation_status: "complete",
    computation_error: null,
    benchmark: null,
    cumulative_return: 0.4231,
    cagr: 0.1812,
    volatility: 0.2233,
    sharpe: 1.54,
    sortino: 1.91,
    calmar: 1.12,
    max_drawdown: -0.1234,
    max_drawdown_duration_days: 31,
    six_month_return: 0.2117,
    sparkline_returns: null,
    sparkline_drawdown: null,
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
    trades_fetched_at: null,
    ...overrides,
  };
}

function makeStrategy(
  overrides: Partial<Strategy> & { id: string; name: string },
): Strategy {
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
  } as Strategy;
}

// 194 D-15: a record that clears the gate with room to spare (over two years, 500
// non-crypto observations), so the pre-existing structural tests see plain figures.
const FULL_RECORD: FigureRecord = { spanDays: 800, observations: 500, crypto: false };

function makeItem(
  id: string,
  name: string,
  figureRecord: FigureRecord = FULL_RECORD,
  analytics?: Partial<StrategyAnalytics>,
) {
  return {
    kind: "strategy" as const,
    strategy: makeStrategy({ id, name }),
    analytics: makeAnalytics({ strategy_id: id, ...analytics }),
    figureRecord,
  };
}

const TWO_STRATEGIES = [
  makeItem(STRATEGY_ID_A, STRATEGY_A_NAME),
  makeItem(STRATEGY_ID_B, STRATEGY_B_NAME),
];

// --- Tests ---------------------------------------------------------------

describe("CompareTable — @container migration contract (52-03 / TYPE-04 / TYPE-02)", () => {
  it("Test 1: every numeric value cell carries `tabular-nums` + a fixed-width font (alignment preserved across the migration)", () => {
    render(<CompareTable items={TWO_STRATEGIES} />);

    // The metric value cells are the right-aligned per-strategy data cells.
    // Each renders a numeric span carrying font-metric (Geist Mono) +
    // tabular-nums so columns stay aligned under the fluid type spine.
    // Locate every <td> with a right alignment that contains a numeric span.
    const valueSpans = Array.from(
      document.querySelectorAll("td span.font-metric"),
    ) as HTMLElement[];

    // 9 metric rows × 2 strategies = 18 numeric value spans.
    expect(valueSpans.length).toBe(18);
    for (const span of valueSpans) {
      expect(span.className).toContain("tabular-nums");
      // Geist Mono fixed-width font — the column-alignment anchor.
      expect(span.className).toContain("font-metric");
    }
  });

  it("Test 2: the table containment region carries `@container` and NO viewport `lg:` drives the column behavior", () => {
    const { container } = render(<CompareTable items={TWO_STRATEGIES} />);

    // The containment host is the scroll/overflow wrapper around the table.
    // Exactly one @container context exists for the comparison table.
    const containerHosts = container.querySelectorAll(".\\@container");
    expect(containerHosts.length).toBeGreaterThanOrEqual(1);

    // Plain `@container` (NOT `@container-size`) — Pitfall 1: container-size
    // requires the host be a leaf and breaks the table layout.
    const html = container.innerHTML;
    expect(html).not.toMatch(/@container-size/);

    // The comparison-column responsiveness must use container-query variants
    // (`@min-*:` / `@max-*:`), never a viewport `lg:` that would key off the
    // window width rather than the table's own measure.
    expect(html).not.toMatch(/\blg:/);
  });

  it("Test 3: each strategy-name header cell recovers the full name via `title=` and renders the real name (never a fabricated placeholder)", () => {
    render(<CompareTable items={TWO_STRATEGIES} />);

    // The strategy-name header cells are the per-column <th> headers. Each
    // must carry title={strategy.name} so the full (long) name recovers on
    // hover in the tabular-aligned single-line context (TYPE-02 treatment).
    const headerA = screen.getByText(STRATEGY_A_NAME);
    const headerB = screen.getByText(STRATEGY_B_NAME);

    const thA = headerA.closest("th");
    const thB = headerB.closest("th");
    expect(thA).not.toBeNull();
    expect(thB).not.toBeNull();

    // The real name renders (no fabricated placeholder / em-dash / "Strategy N").
    expect(thA!.getAttribute("title")).toBe(STRATEGY_A_NAME);
    expect(thB!.getAttribute("title")).toBe(STRATEGY_B_NAME);

    // And the visible text IS the real name, never a fabricated stand-in.
    expect(thA!.textContent).toContain(STRATEGY_A_NAME);
    expect(thB!.textContent).toContain(STRATEGY_B_NAME);
  });
});

// --- 194 plan 10: the annualised rows through the total-record gate (D-04 / D-15) --

const FIVE_ROWS = ["CAGR", "Sharpe", "Sortino", "Calmar", "Volatility"] as const;

function tableRow(label: string): HTMLTableRowElement {
  const found = Array.from(document.querySelectorAll("tbody tr")).find(
    (r) => r.querySelector("td")?.textContent === label,
  );
  if (!found) throw new Error(`no row labelled ${label}`);
  return found as HTMLTableRowElement;
}

/** The value cell of strategy column `col` (0-based) in the row labelled `label`. */
function cell(label: string, col: number): HTMLElement {
  return tableRow(label).querySelectorAll("td")[col + 1] as HTMLElement;
}

function valueSpan(td: HTMLElement): HTMLElement {
  return td.querySelector("span.font-metric") as HTMLElement;
}

/** Hand-typed crypto and non-crypto records: span in calendar days, stored count. */
const crypto = (spanDays: number): FigureRecord => ({ spanDays, observations: spanDays, crypto: true });
const traditional = (spanDays: number, observations: number | null): FigureRecord => ({
  spanDays,
  observations,
  crypto: false,
});

describe("CompareTable: annualised rows follow the total record (D-04 as superseded by D-15)", () => {
  it("a crypto 60-day column prints a toneless dash with the reason in title and sr-only text, and never wins", () => {
    // Column A holds the BEST raw value on every annualised row (highest CAGR, Sharpe,
    // Sortino, Calmar; lowest volatility) but its record is under 90 days.
    const a = makeItem(STRATEGY_ID_A, "A", crypto(60), {
      cagr: 0.9, sharpe: 9, sortino: 9, calmar: 9, volatility: 0.01,
    });
    const b = makeItem(STRATEGY_ID_B, "B", FULL_RECORD, {
      cagr: 0.18, sharpe: 1, sortino: 1.5, calmar: 1.1, volatility: 0.5,
    });
    render(<CompareTable items={[a, b]} />);
    const reason = "Withheld until the record reaches 90 days (60 days so far).";
    for (const label of FIVE_ROWS) {
      const td = cell(label, 0);
      const span = valueSpan(td);
      expect(span.getAttribute("title")).toBe(reason);
      expect(span.textContent).toBe(`—${reason}`);
      expect(td.querySelector(".sr-only")?.textContent).toBe(reason);
      expect(span.className).not.toContain("text-accent");
      expect(td.textContent).not.toContain("✓");
      // The stored value of the long column wins the row instead.
      expect(cell(label, 1).textContent).toContain("✓");
    }
    // Rows the gate does not own keep their stored values in the withheld column.
    // (A tied or won row also carries the winner tick, so match the printed figure.)
    expect(valueSpan(cell("Max Drawdown", 0)).textContent).toContain("-12.34%");
    expect(valueSpan(cell("Cumulative Return", 0)).textContent).toContain("+42.31%");
  });

  it("a withheld column carries no qualitative chip (the chip would restate a hidden figure)", () => {
    render(
      <CompareTable
        items={[makeItem(STRATEGY_ID_A, "A", crypto(60)), makeItem(STRATEGY_ID_B, "B")]}
      />,
    );
    // Sharpe 1.54 earns a chip in the long column; the withheld column's cell has none.
    expect(cell("Sharpe", 1).querySelector("span.text-micro")).not.toBeNull();
    expect(cell("Sharpe", 0).querySelector("span.text-micro")).toBeNull();
  });

  it("a non-crypto column with 59 stored observations is withheld and names 60 trading days", () => {
    render(<CompareTable items={[makeItem(STRATEGY_ID_A, "A", traditional(84, 59))]} />);
    for (const label of FIVE_ROWS) {
      expect(valueSpan(cell(label, 0)).getAttribute("title")).toBe(
        "Withheld until the record reaches 60 trading days (59 so far).",
      );
    }
  });

  it("a non-crypto column with 60 observations over 84 days shows the figures with the <1y marker", () => {
    render(<CompareTable items={[makeItem(STRATEGY_ID_A, "A", traditional(84, 60))]} />);
    const td = cell("CAGR", 0);
    expect(valueSpan(td).textContent).toContain("+18.12%");
    const marker = Array.from(td.querySelectorAll("span[title]")).find(
      (s) => s.getAttribute("title") === "Annualized from 84 days of record, under one year.",
    );
    expect(marker).toBeDefined();
    expect(marker!.textContent).toContain("<1y");
    expect(marker!.querySelector(".sr-only")?.textContent).toBe(
      " Annualized from 84 days of record, under one year.",
    );
  });

  it("with no stored count, a non-crypto column falls back to 90 days: 89 withheld, 90 shown", () => {
    render(<CompareTable items={[makeItem(STRATEGY_ID_A, "A", traditional(89, null))]} />);
    expect(valueSpan(cell("Sharpe", 0)).getAttribute("title")).toBe(
      "Withheld until the record reaches 90 days (89 days so far).",
    );
    cleanup();
    render(<CompareTable items={[makeItem(STRATEGY_ID_A, "A", traditional(90, null))]} />);
    expect(valueSpan(cell("Sharpe", 0)).textContent).toContain("1.54");
  });

  it("a 200-day column shows the figures with the <1y marker on every annualised row", () => {
    render(<CompareTable items={[makeItem(STRATEGY_ID_A, "A", crypto(200))]} />);
    for (const label of FIVE_ROWS) {
      expect(cell(label, 0).textContent).toContain("<1y");
    }
    // A row the gate does not own never carries the marker.
    expect(cell("Max Drawdown", 0).textContent).not.toContain("<1y");
  });

  it("a 400-day column is plain: the figure and no marker or title", () => {
    render(<CompareTable items={[makeItem(STRATEGY_ID_A, "A", crypto(400))]} />);
    for (const label of FIVE_ROWS) {
      const td = cell(label, 0);
      expect(td.textContent).not.toContain("<1y");
      expect(valueSpan(td).getAttribute("title")).toBeNull();
    }
    expect(valueSpan(cell("CAGR", 0)).textContent).toBe("+18.12%");
  });

  it("each column is judged on its own record", () => {
    render(
      <CompareTable
        items={[makeItem(STRATEGY_ID_A, "A", crypto(60)), makeItem(STRATEGY_ID_B, "B", crypto(400))]}
      />,
    );
    expect(valueSpan(cell("CAGR", 0)).textContent).toContain("—");
    expect(valueSpan(cell("CAGR", 1)).textContent).toContain("+18.12%");
  });

  it("a holding column passes through unchanged beside the gated strategy columns", () => {
    holdingPanelItems.length = 0;
    const holding = {
      kind: "holding",
      holding_ref: "holding:binance:BTC:spot",
      venue: "binance",
      symbol: "BTC",
      holding_type: "spot",
      historyState: "withheld",
      analytics: null,
      withheld_reason: "no_history",
    } as unknown as HoldingCompareItem;
    render(<CompareTable items={[holding, makeItem(STRATEGY_ID_A, "A", crypto(60))]} />);
    expect(screen.getByTestId("holding-panel")).toBeDefined();
    expect(holdingPanelItems).toHaveLength(1);
    expect(holdingPanelItems[0]).toBe(holding);
    expect(valueSpan(cell("CAGR", 0)).textContent).toContain("—");
  });
});
