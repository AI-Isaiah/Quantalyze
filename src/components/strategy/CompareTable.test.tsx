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

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CompareTable } from "./CompareTable";
import type { Strategy, StrategyAnalytics } from "@/lib/types";

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

function makeItem(id: string, name: string) {
  return {
    kind: "strategy" as const,
    strategy: makeStrategy({ id, name }),
    analytics: makeAnalytics({ strategy_id: id }),
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
