import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { MyAllocationDashboardPayload } from "@/lib/queries";
import type { PortfolioAnalytics } from "@/lib/types";
import { KpiStripWidget } from "./KpiStripWidget";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type DashboardStrategy = MyAllocationDashboardPayload["strategies"][number];
type DashboardHolding = MyAllocationDashboardPayload["holdingsSummary"][number];

function buildAnalytics(
  overrides: Partial<PortfolioAnalytics> = {},
): PortfolioAnalytics {
  return {
    id: "an-1",
    portfolio_id: "p-1",
    computed_at: "2026-04-01T00:00:00Z",
    computation_status: "complete",
    computation_error: null,
    total_aum: null,
    total_return_twr: null,
    total_return_mwr: null,
    portfolio_sharpe: null,
    portfolio_volatility: null,
    portfolio_max_drawdown: null,
    avg_pairwise_correlation: null,
    return_24h: null,
    return_mtd: null,
    return_ytd: null,
    narrative_summary: null,
    correlation_matrix: null,
    attribution_breakdown: null,
    risk_decomposition: null,
    benchmark_comparison: null,
    optimizer_suggestions: null,
    portfolio_equity_curve: null,
    rolling_correlation: null,
    ...overrides,
  };
}

function buildStrategy(id: string): DashboardStrategy {
  return {
    strategy_id: id,
    current_weight: null,
    allocated_amount: null,
    alias: null,
    eligible_for_outcome: false,
    existing_outcome: null,
    strategy: {
      id,
      name: id,
      codename: null,
      disclosure_tier: "exploratory",
      strategy_types: [],
      markets: [],
      start_date: null,
      strategy_analytics: null,
    },
  };
}

function buildHolding(value_usd: number): DashboardHolding {
  return {
    symbol: "BTC",
    quantity: 1,
    mark_price_usd: null,
    value_usd,
    venue: "binance",
    holding_type: "spot",
    api_key_id: "ak-1",
    // NEW-C03-10: required-but-nullable fields
    side: null,
    entry_price: null,
    unrealized_pnl_usd: null,
  };
}

function makeData(opts: {
  analytics?: PortfolioAnalytics | null;
  strategies?: DashboardStrategy[];
  holdingsSummary?: DashboardHolding[];
}): unknown {
  return {
    analytics: opts.analytics ?? null,
    strategies: opts.strategies ?? [],
    holdingsSummary: opts.holdingsSummary ?? [],
  };
}

function renderWidget(data: unknown) {
  return render(
    <KpiStripWidget
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data={data as any}
      timeframe="1YTD"
      width={0}
      height={0}
    />,
  );
}

// Map a label string to its enclosing kpi-cell, so per-cell value/sub
// assertions don't collide on shared formatting (e.g. "—" appears in many
// cells in the empty state).
function cell(label: string): HTMLElement {
  const labelNode = screen.getByText(label);
  const wrapper = labelNode.closest(".kpi-cell");
  if (!(wrapper instanceof HTMLElement)) {
    throw new Error(`kpi-cell wrapper missing for ${label}`);
  }
  return wrapper;
}

// ---------------------------------------------------------------------------
// Empty payload
// ---------------------------------------------------------------------------

describe("KpiStripWidget — empty payload", () => {
  it("renders 5 prototype labels in fixed order (AUM / YTD TWR / Sharpe / Max DD 12m / Avg ρ)", () => {
    renderWidget(makeData({}));

    // Use the kpi-cell DOM ordering to confirm fixed sequence.
    const cells = document.querySelectorAll(".kpi-cell");
    expect(cells.length).toBe(5);
    expect(cells[0].textContent).toContain("AUM");
    expect(cells[1].textContent).toContain("YTD TWR");
    expect(cells[2].textContent).toContain("Sharpe");
    expect(cells[3].textContent).toContain("Max DD 12m");
    expect(cells[4].textContent).toContain("Avg ρ");
  });

  it("every cell shows em-dash for value when analytics is null", () => {
    renderWidget(makeData({}));
    expect(within(cell("AUM")).getByText("—")).toBeInTheDocument();
    expect(within(cell("YTD TWR")).getByText("—")).toBeInTheDocument();
    expect(within(cell("Sharpe")).getByText("—")).toBeInTheDocument();
    expect(within(cell("Max DD 12m")).getByText("—")).toBeInTheDocument();
    expect(within(cell("Avg ρ")).getByText("—")).toBeInTheDocument();
  });

  it("AUM sub renders pluralized strategy count (0 strategies)", () => {
    renderWidget(makeData({ strategies: [] }));
    expect(within(cell("AUM")).getByText("0 strategies")).toBeInTheDocument();
  });

  it("Avg ρ sub-copy is hardcoded 'tgt < 0.30' even when value is missing", () => {
    renderWidget(makeData({}));
    expect(within(cell("Avg ρ")).getByText("tgt < 0.30")).toBeInTheDocument();
  });

  it("renders cleanly when data prop is undefined (defensive)", () => {
    renderWidget(undefined);
    expect(screen.getByText("AUM")).toBeInTheDocument();
    expect(screen.getByText("Avg ρ")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Populated payload (prototype's hardcoded scenario, computed live)
// ---------------------------------------------------------------------------

describe("KpiStripWidget — populated payload", () => {
  // The prototype's KPIPanel hardcodes:
  //   AUM        = $48.73M / "8 strategies"
  //   YTD TWR    = +14.32%  / MTD +2.17%
  //   Sharpe     = 1.84     / α +4.70%
  //   Max DD 12m = -6.83%   / vol 9.40%
  //   Avg ρ      = 0.22     / tgt < 0.30
  // The wrapper computes everything from real PortfolioAnalytics fields. α
  // has no production source field, so its sub renders "α —".
  const PROTOTYPE_SCENARIO = makeData({
    analytics: buildAnalytics({
      total_aum: 48_730_000,
      return_ytd: 0.1432,
      return_mtd: 0.0217,
      portfolio_sharpe: 1.84,
      portfolio_max_drawdown: -0.0683,
      portfolio_volatility: 0.0940,
      avg_pairwise_correlation: 0.22,
    }),
    strategies: Array.from({ length: 8 }, (_, i) => buildStrategy(`s-${i}`)),
  });

  it("AUM cell: $48.73M with '8 strategies' sub", () => {
    renderWidget(PROTOTYPE_SCENARIO);
    const aum = cell("AUM");
    expect(within(aum).getByText("$48.73M")).toBeInTheDocument();
    expect(within(aum).getByText("8 strategies")).toBeInTheDocument();
  });

  it("YTD TWR cell: +14.32% with 'MTD +2.17%' sub, positive-tinted", () => {
    renderWidget(PROTOTYPE_SCENARIO);
    const ytd = cell("YTD TWR");
    expect(within(ytd).getByText("+14.32%")).toBeInTheDocument();
    expect(within(ytd).getByText("MTD +2.17%")).toBeInTheDocument();
    expect(within(ytd).getByText("+14.32%")).toHaveStyle({
      color: "var(--color-positive)",
    });
  });

  it("Sharpe cell: 1.84 (2-decimal, unsigned)", () => {
    renderWidget(PROTOTYPE_SCENARIO);
    const sharpe = cell("Sharpe");
    expect(within(sharpe).getByText("1.84")).toBeInTheDocument();
    // α has no production source — sub falls back to em-dash but the
    // "α " prefix is preserved for layout fidelity.
    expect(within(sharpe).getByText("α —")).toBeInTheDocument();
  });

  it("Max DD 12m cell: -6.83% with 'vol 9.40%' sub, negative-tinted", () => {
    renderWidget(PROTOTYPE_SCENARIO);
    const dd = cell("Max DD 12m");
    expect(within(dd).getByText("-6.83%")).toBeInTheDocument();
    expect(within(dd).getByText("vol 9.40%")).toBeInTheDocument();
    expect(within(dd).getByText("-6.83%")).toHaveStyle({
      color: "var(--color-negative)",
    });
  });

  it("Avg ρ cell: 0.22 with hardcoded tgt < 0.30 sub", () => {
    renderWidget(PROTOTYPE_SCENARIO);
    const rho = cell("Avg ρ");
    expect(within(rho).getByText("0.22")).toBeInTheDocument();
    expect(within(rho).getByText("tgt < 0.30")).toBeInTheDocument();
  });

  it("AUM falls back to sum(holdingsSummary) when analytics.total_aum is null", () => {
    renderWidget(
      makeData({
        analytics: buildAnalytics({ total_aum: null }),
        holdingsSummary: [
          buildHolding(20_000_000),
          buildHolding(28_730_000),
        ],
      }),
    );
    expect(within(cell("AUM")).getByText("$48.73M")).toBeInTheDocument();
  });

  it("AUM sub uses 'strategy' (singular) when count is 1", () => {
    renderWidget(makeData({ strategies: [buildStrategy("s-1")] }));
    expect(within(cell("AUM")).getByText("1 strategy")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Stale path — analytics row is missing, holdings empty
// ---------------------------------------------------------------------------

describe("KpiStripWidget — stale (no analytics, no holdings)", () => {
  it("every value collapses to em-dash; layout shape preserved (5 cells)", () => {
    renderWidget(makeData({ analytics: null }));
    expect(document.querySelectorAll(".kpi-cell").length).toBe(5);
    // 5 main values + Sharpe sub "α —" + YTD sub "MTD —" + Max DD sub "vol —"
    // + AUM sub "0 strategies" not em-dash + Avg ρ sub "tgt < 0.30" not em-dash.
    // Em-dash count = 5 mains + 3 sub fragments = 8 instances.
    const emDashes = screen.getAllByText("—");
    expect(emDashes.length).toBeGreaterThanOrEqual(5);
  });

  it("sub-copy structural fragments survive null analytics ('MTD —', 'α —', 'vol —')", () => {
    renderWidget(makeData({ analytics: null }));
    expect(within(cell("YTD TWR")).getByText("MTD —")).toBeInTheDocument();
    expect(within(cell("Sharpe")).getByText("α —")).toBeInTheDocument();
    expect(within(cell("Max DD 12m")).getByText("vol —")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// M-1120 — cell separators must resolve through the `--color-border` token,
// not the undefined `--border` token (which renders no divider under
// Tailwind v4 @theme inline). PR4 #2 fixed this; this guards the fix.
// ---------------------------------------------------------------------------

describe("KpiStripWidget — M-1120 separators resolve through --color-border token", () => {
  // Re-use the populated prototype scenario so the strip renders fully.
  const SCENARIO = makeData({
    analytics: buildAnalytics({
      total_aum: 48_730_000,
      return_ytd: 0.1432,
      return_mtd: 0.0217,
      portfolio_sharpe: 1.84,
      portfolio_max_drawdown: -0.0683,
      portfolio_volatility: 0.094,
      avg_pairwise_correlation: 0.22,
    }),
    strategies: Array.from({ length: 8 }, (_, i) => buildStrategy(`s-${i}`)),
  });

  it("first cell has no left border; cells 1..4 use '1px solid var(--color-border)'", () => {
    renderWidget(SCENARIO);
    const cells = document.querySelectorAll<HTMLElement>(".kpi-cell");
    expect(cells.length).toBe(5);

    // Leftmost cell: no divider (it's the start of the strip). jsdom
    // normalizes `borderLeft: "none"` so the shorthand re-serializes to
    // "medium" (default width); the longhand border-left-style is the
    // reliable "no line" signal.
    expect(cells[0].style.borderLeftStyle).toBe("none");
    expect(cells[0].style.borderLeft).not.toContain("var(");

    // Every subsequent cell carries the divider through the CORRECT token.
    // jsdom can't parse the var() so it stores the shorthand verbatim — we
    // assert on that raw string.
    for (let i = 1; i < cells.length; i++) {
      expect(cells[i].style.borderLeft).toContain("var(--color-border)");
      // Guard against a revert to the undefined `var(--border)` token —
      // the substring 'var(--border)' must NOT appear in the divider.
      expect(cells[i].style.borderLeft).not.toMatch(/var\(--border\)/);
    }
  });

  it("inline <style> responsive overrides use --color-border, never the undefined --border", () => {
    const { container } = renderWidget(SCENARIO);
    const styleEl = container.querySelector("style");
    expect(styleEl).not.toBeNull();
    const css = styleEl?.textContent ?? "";

    // The undefined token must be entirely absent from the responsive CSS.
    expect(css).not.toMatch(/var\(--border\)/);

    // The fixed token appears in the 4 responsive divider overrides
    // (data-i 3 + 4 top-borders at 1100px; the all-cell top-border + the
    // data-i 2/4 left-border re-adds at 720px). Assert >= 4 occurrences so a
    // partial revert that flips even one override back to --border fails.
    const matches = css.match(/var\(--color-border\)/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(4);
  });
});
