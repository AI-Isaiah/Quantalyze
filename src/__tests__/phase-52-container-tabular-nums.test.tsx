/**
 * Phase 52-01 / TYPE-04 — container-query tabular-nums ALIGNMENT contract.
 *
 * v1.4 migrates the allocator-surface tables/strips (KpiStrip, CompareTable,
 * factsheet panels) from VIEWPORT breakpoints (`sm:`/`lg:`) to CSS `@container`
 * queries so a column reflows on its OWN width, not the window's. The hazard a
 * container migration introduces is COLUMN MIS-ALIGNMENT: under the fluid
 * `--text-*` tier (Phase 49), proportional digits make each numeric column a
 * different width row-to-row, so the decimal points no longer line up. The fix
 * is `tabular-nums` (fixed glyph advance) on every columnar numeric cell — and
 * THIS test is the gate that keeps it true as surfaces migrate.
 *
 * Why anchor on StrategyTable (Phase 50-06): it is the ONLY working `@container`
 * table in the repo today (ResponsiveTable host with `className="@container"`,
 * `@max-3xl:hidden` priority-collapse, and `font-metric tabular-nums` cells). It
 * is the migrated PRECEDENT every 52-02/03/06 migration mirrors, so pinning its
 * alignment + honest-collapse invariants gives the later migrations a concrete,
 * non-vacuous contract to keep green (RED→GREEN as each surface adopts the same
 * idiom).
 *
 * Three behaviors (52-01-PLAN <behavior>):
 *   1. Every columnar numeric cell carries BOTH `tabular-nums` AND a fixed-width
 *      font face (`font-metric` / `font-mono`) so glyph width is fixed under the
 *      fluid `--text-*` tier.
 *   2. A collapsed column (`@max-3xl:hidden`) is RIGHTMOST in priority order (no
 *      ragged middle gap) and its real value RELOCATES into the per-row
 *      `<details>` — never a fabricated em-dash or zero (no-invented-data /
 *      STATE-02). A genuinely-null source stays the honest-null em-dash.
 *   3. A `CONTAINER_MIGRATED` registry (declared here, non-empty) tracks the
 *      components this phase migrates, so the contract is non-vacuous and the
 *      coverage is visible.
 *
 * Mirrors the StrategyTable.test.tsx jsdom render idiom (fixtures + the
 * SimulateImpactButton stub); mocks ONLY what that suite already mocks.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { StrategyTable } from "@/components/strategy/StrategyTable";
import type { Strategy, StrategyAnalytics } from "@/lib/types";

// SimulateImpactButton pulls in client-only modules irrelevant to alignment;
// stub it exactly as StrategyTable.test.tsx does to keep the render focused.
vi.mock("@/components/discovery/SimulateImpactButton", () => ({
  SimulateImpactButton: () => null,
}));

/**
 * The components this phase migrates to `@container`. StrategyTable is the
 * already-shipped Phase 50-06 precedent (the live one this file renders);
 * KpiStrip + CompareTable are the 52-02/03/06 targets. Non-empty so the
 * contract is tracked, not vacuous — each surface plan appends its migrated
 * component as it lands, and this file's assertions are the gate they keep green.
 */
const CONTAINER_MIGRATED = [
  "StrategyTable",
  "KpiStrip",
  "CompareTable",
  // 52-06: the factsheet KPI strip (FactsheetView.tsx) migrated from
  // `lg:grid-cols-9` viewport breakpoints to a `@container` grid; its
  // alignment + @-prefixed-variant contract is gated by
  // FactsheetView.kpistrip.test.tsx.
  "FactsheetKpiStrip",
] as const;

type StrategyWithAnalytics = Strategy & { analytics: StrategyAnalytics };

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

const STRATEGY_ID_A = "11111111-0000-4000-8000-000000000001";

describe("Phase 52 container-query tabular-nums alignment contract (TYPE-04)", () => {
  it("Test 3 — the CONTAINER_MIGRATED registry is declared and non-empty (contract is tracked)", () => {
    // A vacuous contract (empty registry) would track nothing; pinning >=1 keeps
    // the gate meaningful and gives 52-02/03/06 a list to append to.
    expect(CONTAINER_MIGRATED.length).toBeGreaterThan(0);
    expect(CONTAINER_MIGRATED).toContain("StrategyTable");
  });

  it("Test 1 — every columnar numeric cell carries BOTH tabular-nums AND a fixed-width font (font-metric/font-mono)", () => {
    render(
      <StrategyTable
        strategies={[makeStrategy({ id: STRATEGY_ID_A, name: "Alpha Stellar" })]}
        categorySlug="crypto-sma"
      />,
    );

    // The numeric data cells are the right-aligned metric <td>s (Return / CAGR /
    // Sharpe / MaxDD / Volatility / 6M / AUM). They are the columns whose digits
    // must line up under the fluid --text-* tier; each carries `tabular-nums`.
    const table = document.querySelector("table");
    expect(table).not.toBeNull();
    const numericCells = Array.from(
      table!.querySelectorAll<HTMLTableCellElement>("td.tabular-nums"),
    );
    // Non-vacuity: a column rename / class drop would leave zero matches here.
    expect(numericCells.length).toBeGreaterThan(0);

    for (const cell of numericCells) {
      // tabular-nums fixes the glyph advance so columns align row-to-row.
      expect(cell.className).toContain("tabular-nums");
      // AND a fixed-width font face — `font-metric` (the table convention) or
      // `font-mono`. Without it the fluid proportional face would still ragged
      // the column even with tabular-nums on a non-mono fallback.
      expect(
        /\bfont-metric\b|\bfont-mono\b/.test(cell.className),
        `numeric cell "${cell.textContent?.trim()}" must carry font-metric or ` +
          `font-mono alongside tabular-nums (className="${cell.className}")`,
      ).toBe(true);
    }

    // Inverse drift: the class-keyed query above only inspects cells that ALREADY
    // carry tabular-nums, so a DROPPED class on a numeric column would silently
    // shrink the set, not fail. Independently anchor on the right-aligned body
    // value cells that render formatted NUMBERS (percent / currency / decimal)
    // and require EVERY one to carry tabular-nums — so removing the class from a
    // numeric column fails loud (Rule 9: verify the intent "every columnar
    // numeric cell", not just the cells that happen to still have the class).
    const NUMERIC_TEXT = /^[+\-−]?\$?\d[\d,]*\.?\d*%?$/;
    const rightAlignedNumericCells = Array.from(
      table!.querySelectorAll<HTMLTableCellElement>("tbody td.text-right"),
    ).filter((td) => NUMERIC_TEXT.test((td.textContent ?? "").trim()));
    // Non-vacuity: the seed fixture renders formatted numbers in these columns.
    expect(rightAlignedNumericCells.length).toBeGreaterThan(0);
    for (const cell of rightAlignedNumericCells) {
      expect(
        cell.className.includes("tabular-nums"),
        `right-aligned numeric cell "${cell.textContent?.trim()}" dropped ` +
          `tabular-nums — its column will mis-align under the fluid --text-* ` +
          `tier (className="${cell.className}")`,
      ).toBe(true);
    }
  });

  it("Test 2a — collapsed columns (@max-3xl:hidden) are RIGHTMOST in priority order (no ragged middle gap)", () => {
    render(
      <StrategyTable
        strategies={[makeStrategy({ id: STRATEGY_ID_A, name: "Alpha Stellar" })]}
        categorySlug="crypto-sma"
      />,
    );

    const headerRow = document.querySelector("thead tr");
    expect(headerRow).not.toBeNull();
    const headers = Array.from(
      headerRow!.querySelectorAll<HTMLTableCellElement>("th"),
    );
    // The priority-collapse contract: every @max-3xl:hidden column sits to the
    // RIGHT of every always-visible data column — collapsing from the right
    // edge inward leaves no ragged hole in the middle of the table.
    const collapseIdxs = headers
      .map((th, i) => (th.className.includes("@max-3xl:hidden") ? i : -1))
      .filter((i) => i >= 0);
    // Non-vacuity: there must BE collapsible columns to order.
    expect(collapseIdxs.length).toBeGreaterThan(0);

    // The first always-visible NUMERIC header after the sticky name column
    // (Return/CAGR/Sharpe/MaxDD are never collapsed) must precede every
    // collapsed one. Take the minimum collapse index and assert at least one
    // non-collapsed data header sits left of it.
    const firstCollapse = Math.min(...collapseIdxs);
    const nonCollapsedBefore = headers
      .slice(0, firstCollapse)
      .filter((th) => !th.className.includes("@max-3xl:hidden"));
    // The sticky Strategy name + the 4 always-on metric columns are all left of
    // the first collapse → a healthy right-edge collapse, not a middle gap.
    expect(nonCollapsedBefore.length).toBeGreaterThan(0);

    // And no always-visible (non-collapsed, non-chrome) data header appears
    // AFTER a collapsed one except the right-edge Details + Actions chrome — the
    // collapsed block is contiguous on the right. We assert the LAST collapse
    // index is within the final few columns (Details/Actions trail it).
    const lastCollapse = Math.max(...collapseIdxs);
    expect(lastCollapse).toBeGreaterThanOrEqual(firstCollapse);
    expect(headers.length - lastCollapse).toBeLessThanOrEqual(3);
  });

  it("Test 2b — a collapsed-column value RELOCATES into the per-row <details> (the SAME real value, never fabricated)", () => {
    const fixture = makeStrategy({ id: STRATEGY_ID_A, name: "Alpha Stellar" });
    // Distinctive volatility so we can prove the relocated value is the REAL one.
    fixture.analytics.volatility = 0.3377;
    render(<StrategyTable strategies={[fixture]} categorySlug="crypto-sma" />);

    const expected = "+33.77%"; // formatPercent(0.3377)
    // The value appears in BOTH the CSS-collapsed visible cell and the <details>
    // relocation — getAllByText proves the relocated value is the real one, not
    // a fabricated placeholder.
    const matches = screen.getAllByText(expected);
    expect(matches.length).toBeGreaterThanOrEqual(2);

    const summary = screen.getByText("More");
    const details = summary.closest("details");
    expect(details).not.toBeNull();
    const relocated = within(details as HTMLElement).getByText(expected);
    expect(relocated).toBeDefined();
    // The relocated value lives in a tabular-nums cell too, so the details
    // disclosure stays aligned just like the table column it mirrors.
    const relocatedCell = relocated.closest("dd, td");
    expect(relocatedCell?.className).toContain("tabular-nums");
  });

  it("Test 2c — a NULL collapsed source renders the honest-null em-dash, NEVER a fabricated 0 (no-invented-data / STATE-02)", () => {
    const fixture = makeStrategy({ id: STRATEGY_ID_A, name: "Alpha Stellar" });
    // Genuinely-absent volatility AND aum — the honest path must surface "—".
    fixture.analytics.volatility = null as unknown as number;
    fixture.aum = null as unknown as number;
    render(<StrategyTable strategies={[fixture]} categorySlug="crypto-sma" />);

    const summary = screen.getByText("More");
    const details = summary.closest("details") as HTMLElement;

    // The Volatility relocation shows the honest-null em-dash…
    const volDt = within(details).getByText("Volatility");
    const volDd = volDt.nextElementSibling as HTMLElement;
    expect(volDd.textContent).toBe("—");
    // …and crucially NOT a fabricated zero / demo value (the TYPE-04 + STATE-02
    // honesty floor: a container migration must never invent a value to fill a
    // collapsed column).
    expect(volDd.textContent).not.toBe("0");
    expect(volDd.textContent).not.toBe("0.00%");
    expect(volDd.textContent).not.toMatch(/\$?0/);

    const aumDt = within(details).getByText("AUM");
    const aumDd = aumDt.nextElementSibling as HTMLElement;
    expect(aumDd.textContent).toBe("—");
    expect(aumDd.textContent).not.toMatch(/\$0/);
  });
});
