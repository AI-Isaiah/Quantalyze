import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { MyAllocationDashboardPayload } from "@/lib/queries";
import type { AllocatorPreferences } from "@/lib/preferences";
import type { PortfolioAnalytics } from "@/lib/types";
import { MandateSnapshotWidget } from "./MandateSnapshotWidget";

// ---------------------------------------------------------------------------
// Fixtures (kept small + targeted; full payload type-coverage isn't needed
// because the widget only reads `mandate`, `analytics`, `holdingsSummary`,
// `strategies` from the data prop)
// ---------------------------------------------------------------------------

type DashboardStrategy = MyAllocationDashboardPayload["strategies"][number];
type DashboardHolding = MyAllocationDashboardPayload["holdingsSummary"][number];

function buildMandate(
  overrides: Partial<AllocatorPreferences> = {},
): AllocatorPreferences {
  return {
    user_id: "user-1",
    mandate_archetype: null,
    target_ticket_size_usd: null,
    excluded_exchanges: null,
    max_drawdown_tolerance: null,
    min_track_record_days: null,
    min_sharpe: null,
    max_aum_concentration: null,
    preferred_strategy_types: null,
    preferred_markets: null,
    founder_notes: null,
    edited_by_user_id: null,
    updated_at: "2026-04-01T00:00:00Z",
    max_weight: null,
    correlation_ceiling: null,
    liquidity_preference: null,
    style_exclusions: null,
    mandate_edited_at: null,
    scoring_weight_overrides: null,
    ...overrides,
  };
}

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

function buildStrategy(
  current_weight: number | null,
  type: string = "market_neutral",
  id: string = "s-1",
): DashboardStrategy {
  return {
    strategy_id: id,
    current_weight,
    allocated_amount: null,
    alias: null,
    eligible_for_outcome: false,
    existing_outcome: null,
    strategy: {
      id,
      name: id,
      codename: null,
      disclosure_tier: "exploratory",
      strategy_types: [type],
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
  };
}

// Minimal payload shape for the WidgetProps `data` prop. The widget reads
// only the four fields below; the cast satisfies the typed payload contract
// without needing the full ~20-field shape.
function makeData(opts: {
  mandate?: AllocatorPreferences | null;
  analytics?: PortfolioAnalytics | null;
  holdingsSummary?: DashboardHolding[];
  strategies?: DashboardStrategy[];
}): unknown {
  return {
    mandate: opts.mandate ?? null,
    analytics: opts.analytics ?? null,
    holdingsSummary: opts.holdingsSummary ?? [],
    strategies: opts.strategies ?? [],
  };
}

function renderWidget(data: unknown) {
  return render(
    <MandateSnapshotWidget
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data={data as any}
      timeframe="YTD"
      width={0}
      height={0}
    />,
  );
}

// ---------------------------------------------------------------------------
// Empty-payload path — prototype shape preserved, content all em-dashed
// ---------------------------------------------------------------------------

describe("MandateSnapshotWidget — empty payload", () => {
  it("renders 'No mandate set yet' header + 5 em-dashed rows when mandate is null", () => {
    renderWidget(makeData({ mandate: null }));

    expect(
      screen.getByRole("heading", { name: "Mandate", level: 3 }),
    ).toBeInTheDocument();
    expect(screen.getByText("No mandate set yet")).toBeInTheDocument();

    // All 5 prototype labels render even in the empty state — pixel parity.
    expect(screen.getByText("Max single allocation")).toBeInTheDocument();
    expect(screen.getByText("Min Sharpe (90d)")).toBeInTheDocument();
    expect(screen.getByText("Max DD floor")).toBeInTheDocument();
    expect(screen.getByText("Min AUM")).toBeInTheDocument();
    expect(screen.getByText("Style concentration")).toBeInTheDocument();

    // Empty state: every gate cell is an em-dash. Two cells per row × 5 rows
    // = 10 em-dashes.
    const emDashes = screen.getAllByText("—");
    expect(emDashes.length).toBe(10);
  });

  it("Edit → link points at /profile?tab=mandate even with empty mandate", () => {
    renderWidget(makeData({ mandate: null }));
    const link = screen.getByRole("link", { name: /Edit/ });
    expect(link).toHaveAttribute("href", "/profile?tab=mandate");
  });

  it("renders the same 5 rows when data prop is undefined (defensive)", () => {
    renderWidget(undefined);
    expect(screen.getByText("Max single allocation")).toBeInTheDocument();
    expect(screen.getByText("No mandate set yet")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Populated payload — prototype's hardcoded numbers, computed live
// ---------------------------------------------------------------------------

describe("MandateSnapshotWidget — populated payload", () => {
  // Inspired by the prototype's hardcoded scenario, with strategy weights
  // tweaked so every gate's current value is unique (avoids `getByText`
  // ambiguity in DOM assertions):
  //   max_weight cap=22%, max=18.5%        → PASS
  //   min_sharpe floor=0.75, current=1.84  → PASS
  //   max_dd_tolerance=7.5%, current=-9.1% → FAIL
  //   liquidity=high (= $10M), AUM=$48.7M  → PASS
  //   max_aum_concentration=35%, max group sum=29.3% (market_neutral total)
  //                                         → PASS
  // Result: 4/5 gates pass — matches the prototype's "Auto-saved · 4/5 gates
  // pass" copy.
  const PROTOTYPE_SCENARIO = makeData({
    mandate: buildMandate({
      max_weight: 0.22,
      min_sharpe: 0.75,
      max_drawdown_tolerance: 0.075,
      liquidity_preference: "high",
      max_aum_concentration: 0.35,
    }),
    analytics: buildAnalytics({
      portfolio_sharpe: 1.84,
      portfolio_max_drawdown: -0.091,
    }),
    holdingsSummary: [buildHolding(48_700_000)],
    strategies: [
      buildStrategy(0.185, "market_neutral", "a"),
      buildStrategy(0.108, "market_neutral", "b"),
      buildStrategy(0.08, "trend", "c"),
    ],
  });

  it("header shows 'Auto-saved · 4/5 gates pass' for the prototype scenario", () => {
    renderWidget(PROTOTYPE_SCENARIO);
    expect(
      screen.getByText("Auto-saved · 4/5 gates pass"),
    ).toBeInTheDocument();
  });

  it("renders the prototype's threshold + current pairs verbatim", () => {
    renderWidget(PROTOTYPE_SCENARIO);
    // Threshold cells (middle column).
    expect(screen.getByText("22%")).toBeInTheDocument();
    expect(screen.getByText("0.75")).toBeInTheDocument();
    expect(screen.getByText("-7.5%")).toBeInTheDocument();
    expect(screen.getByText("$10.0M")).toBeInTheDocument();
    expect(screen.getByText("35% cap")).toBeInTheDocument();
    // Current cells (right column).
    expect(screen.getByText("18.5%")).toBeInTheDocument();
    expect(screen.getByText("1.84")).toBeInTheDocument();
    expect(screen.getByText("-9.1%")).toBeInTheDocument();
    expect(screen.getByText("$48.7M")).toBeInTheDocument();
    expect(screen.getByText("29.3%")).toBeInTheDocument();
  });

  it("Max DD failure row paints current value in negative color (RGB 220, 38, 38)", () => {
    const { container } = renderWidget(PROTOTYPE_SCENARIO);
    const failingCurrent = within(container).getByText("-9.1%");
    // CSS variables resolve at runtime in JSDOM only when the rule is
    // declared on the element — this widget uses inline styles so the
    // computed style holds the literal `var(--color-negative)` reference.
    expect(failingCurrent).toHaveStyle({ color: "var(--color-negative)" });
  });

  it("Passing rows paint current value in primary color (var(--color-text-primary))", () => {
    const { container } = renderWidget(PROTOTYPE_SCENARIO);
    const passingCurrent = within(container).getByText("18.5%");
    expect(passingCurrent).toHaveStyle({ color: "var(--color-text-primary)" });
  });
});

// ---------------------------------------------------------------------------
// Stale path — mandate set but analytics has not yet synced
// ---------------------------------------------------------------------------

describe("MandateSnapshotWidget — stale path (mandate set, analytics empty)", () => {
  const STALE_SCENARIO = makeData({
    mandate: buildMandate({
      max_weight: 0.22,
      min_sharpe: 0.75,
      max_drawdown_tolerance: 0.075,
      liquidity_preference: "medium",
      max_aum_concentration: 0.35,
    }),
    analytics: null, // No portfolio_sharpe / portfolio_max_drawdown.
    holdingsSummary: [], // No AUM rollup yet.
    strategies: [], // No portfolio_strategies row yet.
  });

  it("threshold cells still render (mandate is the source for those)", () => {
    renderWidget(STALE_SCENARIO);
    expect(screen.getByText("22%")).toBeInTheDocument();
    expect(screen.getByText("0.75")).toBeInTheDocument();
    expect(screen.getByText("-7.5%")).toBeInTheDocument();
    expect(screen.getByText("$1.0M")).toBeInTheDocument();
    expect(screen.getByText("35% cap")).toBeInTheDocument();
  });

  it("current cells all render em-dash (no analytics, holdings, or strategies)", () => {
    renderWidget(STALE_SCENARIO);
    // 5 thresholds rendered above + 5 currents = 10 cells; thresholds aren't
    // em-dash, so all 5 em-dashes belong to the current column.
    const emDashes = screen.getAllByText("—");
    expect(emDashes.length).toBe(5);
  });

  it("header reports 0/0 gates pass since every gate is indeterminate", () => {
    renderWidget(STALE_SCENARIO);
    expect(
      screen.getByText("Auto-saved · 0/0 gates pass"),
    ).toBeInTheDocument();
  });
});
