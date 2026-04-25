import { describe, it, expect } from "vitest";
import type { AllocatorPreferences } from "@/lib/preferences";
import type { PortfolioAnalytics } from "@/lib/types";
import type { MyAllocationDashboardPayload } from "@/lib/queries";
import {
  LIQUIDITY_TO_MIN_AUM,
  countPassingGates,
  deriveMandateGates,
  type GateRow,
} from "./mandate-gates";

// ---------------------------------------------------------------------------
// Fixtures
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
  overrides: Partial<DashboardStrategy> & {
    strategyOverrides?: Partial<DashboardStrategy["strategy"]>;
  } = {},
): DashboardStrategy {
  const { strategyOverrides, ...rest } = overrides;
  return {
    strategy_id: "s-1",
    current_weight: null,
    allocated_amount: null,
    alias: null,
    eligible_for_outcome: false,
    existing_outcome: null,
    strategy: {
      id: "s-1",
      name: "Helios Perp Basis",
      codename: null,
      disclosure_tier: "exploratory",
      strategy_types: ["market_neutral"],
      markets: [],
      start_date: null,
      strategy_analytics: null,
      ...strategyOverrides,
    },
    ...rest,
  };
}

function buildHolding(
  overrides: Partial<DashboardHolding> = {},
): DashboardHolding {
  return {
    symbol: "BTC",
    quantity: 1,
    mark_price_usd: null,
    value_usd: 0,
    venue: "binance",
    holding_type: "spot",
    api_key_id: "ak-1",
    ...overrides,
  };
}

function gate(rows: GateRow[], key: GateRow["key"]): GateRow {
  const row = rows.find((r) => r.key === key);
  if (!row) throw new Error(`gate ${key} missing`);
  return row;
}

// ---------------------------------------------------------------------------
// Shape invariants
// ---------------------------------------------------------------------------

describe("deriveMandateGates — shape", () => {
  it("returns 5 rows in fixed order matching prototype app.jsx:482-488", () => {
    const rows = deriveMandateGates(null, null, [], []);
    expect(rows.map((r) => r.key)).toEqual([
      "max_single_allocation",
      "min_sharpe",
      "max_dd_floor",
      "min_aum",
      "style_concentration",
    ]);
    expect(rows.map((r) => r.label)).toEqual([
      "Max single allocation",
      "Min Sharpe (90d)",
      "Max DD floor",
      "Min AUM",
      "Style concentration",
    ]);
  });

  it("with no mandate and no data, every gate has em-dash threshold + em-dash current + ok=null", () => {
    const rows = deriveMandateGates(null, null, [], []);
    for (const row of rows) {
      expect(row.gate).toBe("—");
      expect(row.current).toBe("—");
      expect(row.ok).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Max single allocation
// ---------------------------------------------------------------------------

describe("max_single_allocation gate", () => {
  it("formats gate as unsigned percent with no decimals (22%)", () => {
    const rows = deriveMandateGates(
      buildMandate({ max_weight: 0.22 }),
      null,
      [],
      [],
    );
    expect(gate(rows, "max_single_allocation").gate).toBe("22%");
  });

  it("current = max(strategies[*].current_weight) formatted to 1 decimal", () => {
    const rows = deriveMandateGates(
      buildMandate({ max_weight: 0.22 }),
      null,
      [],
      [
        buildStrategy({ strategy_id: "a", current_weight: 0.193 }),
        buildStrategy({ strategy_id: "b", current_weight: 0.167 }),
        buildStrategy({ strategy_id: "c", current_weight: 0.13 }),
      ],
    );
    expect(gate(rows, "max_single_allocation").current).toBe("19.3%");
  });

  it("ok=true when max weight <= cap", () => {
    const rows = deriveMandateGates(
      buildMandate({ max_weight: 0.22 }),
      null,
      [],
      [buildStrategy({ current_weight: 0.185 })],
    );
    expect(gate(rows, "max_single_allocation").ok).toBe(true);
  });

  it("ok=false when max weight exceeds cap", () => {
    const rows = deriveMandateGates(
      buildMandate({ max_weight: 0.20 }),
      null,
      [],
      [buildStrategy({ current_weight: 0.25 })],
    );
    expect(gate(rows, "max_single_allocation").ok).toBe(false);
  });

  it("ok=null when no strategies have current_weight", () => {
    const rows = deriveMandateGates(
      buildMandate({ max_weight: 0.22 }),
      null,
      [],
      [buildStrategy({ current_weight: null })],
    );
    expect(gate(rows, "max_single_allocation").ok).toBeNull();
    expect(gate(rows, "max_single_allocation").current).toBe("—");
  });
});

// ---------------------------------------------------------------------------
// Min Sharpe (90d)
// ---------------------------------------------------------------------------

describe("min_sharpe gate", () => {
  it("formats gate + current to 2 decimals, signed=false", () => {
    const rows = deriveMandateGates(
      buildMandate({ min_sharpe: 0.75 }),
      buildAnalytics({ portfolio_sharpe: 1.84 }),
      [],
      [],
    );
    const g = gate(rows, "min_sharpe");
    expect(g.gate).toBe("0.75");
    expect(g.current).toBe("1.84");
  });

  it("ok=true when current >= floor", () => {
    const rows = deriveMandateGates(
      buildMandate({ min_sharpe: 0.75 }),
      buildAnalytics({ portfolio_sharpe: 1.84 }),
      [],
      [],
    );
    expect(gate(rows, "min_sharpe").ok).toBe(true);
  });

  it("ok=false when current < floor", () => {
    const rows = deriveMandateGates(
      buildMandate({ min_sharpe: 1.5 }),
      buildAnalytics({ portfolio_sharpe: 0.4 }),
      [],
      [],
    );
    expect(gate(rows, "min_sharpe").ok).toBe(false);
  });

  it("ok=null when analytics row is missing", () => {
    const rows = deriveMandateGates(
      buildMandate({ min_sharpe: 0.75 }),
      null,
      [],
      [],
    );
    expect(gate(rows, "min_sharpe").ok).toBeNull();
    expect(gate(rows, "min_sharpe").current).toBe("—");
  });
});

// ---------------------------------------------------------------------------
// Max DD floor
// ---------------------------------------------------------------------------

describe("max_dd_floor gate", () => {
  it("displays gate negative-signed even though stored magnitude is positive", () => {
    const rows = deriveMandateGates(
      buildMandate({ max_drawdown_tolerance: 0.075 }),
      null,
      [],
      [],
    );
    expect(gate(rows, "max_dd_floor").gate).toBe("-7.5%");
  });

  it("ok=true when |current| <= |tolerance|", () => {
    const rows = deriveMandateGates(
      buildMandate({ max_drawdown_tolerance: 0.10 }),
      buildAnalytics({ portfolio_max_drawdown: -0.06 }),
      [],
      [],
    );
    expect(gate(rows, "max_dd_floor").ok).toBe(true);
  });

  it("ok=false when |current| > |tolerance| (prototype shows -9.1% breaching -7.5%)", () => {
    const rows = deriveMandateGates(
      buildMandate({ max_drawdown_tolerance: 0.075 }),
      buildAnalytics({ portfolio_max_drawdown: -0.091 }),
      [],
      [],
    );
    expect(gate(rows, "max_dd_floor").ok).toBe(false);
    expect(gate(rows, "max_dd_floor").current).toBe("-9.1%");
  });

  it("treats positively-stored drawdown the same as negatively-stored", () => {
    const rows = deriveMandateGates(
      buildMandate({ max_drawdown_tolerance: 0.075 }),
      buildAnalytics({ portfolio_max_drawdown: 0.091 }),
      [],
      [],
    );
    expect(gate(rows, "max_dd_floor").ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Min AUM (backed by liquidity_preference enum)
// ---------------------------------------------------------------------------

describe("min_aum gate", () => {
  it("LIQUIDITY_TO_MIN_AUM mapping is high=$10M / medium=$1M / low=$100K", () => {
    expect(LIQUIDITY_TO_MIN_AUM.high).toBe(10_000_000);
    expect(LIQUIDITY_TO_MIN_AUM.medium).toBe(1_000_000);
    expect(LIQUIDITY_TO_MIN_AUM.low).toBe(100_000);
  });

  it("threshold for liquidity_preference='high' renders as $10M", () => {
    const rows = deriveMandateGates(
      buildMandate({ liquidity_preference: "high" }),
      null,
      [buildHolding({ value_usd: 48_730_000 })],
      [],
    );
    const g = gate(rows, "min_aum");
    expect(g.gate).toBe("$10.0M");
    expect(g.current).toBe("$48.7M");
    expect(g.ok).toBe(true);
  });

  it("ok=false when AUM under tier threshold", () => {
    const rows = deriveMandateGates(
      buildMandate({ liquidity_preference: "high" }),
      null,
      [buildHolding({ value_usd: 5_000_000 })],
      [],
    );
    expect(gate(rows, "min_aum").ok).toBe(false);
  });

  it("ok=true for medium tier with $2M AUM", () => {
    const rows = deriveMandateGates(
      buildMandate({ liquidity_preference: "medium" }),
      null,
      [buildHolding({ value_usd: 2_000_000 })],
      [],
    );
    const g = gate(rows, "min_aum");
    expect(g.gate).toBe("$1.0M");
    expect(g.ok).toBe(true);
  });

  it("ok=null + current='—' when holdingsSummary is empty (vs $0)", () => {
    const rows = deriveMandateGates(
      buildMandate({ liquidity_preference: "high" }),
      null,
      [],
      [],
    );
    const g = gate(rows, "min_aum");
    expect(g.current).toBe("—");
    expect(g.ok).toBeNull();
  });

  it("ok=null when liquidity_preference is null", () => {
    const rows = deriveMandateGates(
      buildMandate({ liquidity_preference: null }),
      null,
      [buildHolding({ value_usd: 50_000_000 })],
      [],
    );
    expect(gate(rows, "min_aum").gate).toBe("—");
    expect(gate(rows, "min_aum").ok).toBeNull();
  });

  it("sums multiple holdings", () => {
    const rows = deriveMandateGates(
      buildMandate({ liquidity_preference: "low" }),
      null,
      [
        buildHolding({ value_usd: 50_000 }),
        buildHolding({ value_usd: 60_000 }),
      ],
      [],
    );
    expect(gate(rows, "min_aum").current).toBe("$110K");
  });
});

// ---------------------------------------------------------------------------
// Style concentration
// ---------------------------------------------------------------------------

describe("style_concentration gate", () => {
  it("groups by strategy.strategy_types[0] and returns max group total", () => {
    const rows = deriveMandateGates(
      buildMandate({ max_aum_concentration: 0.35 }),
      null,
      [],
      [
        buildStrategy({
          strategy_id: "a",
          current_weight: 0.193,
          strategyOverrides: { strategy_types: ["market_neutral"] },
        }),
        buildStrategy({
          strategy_id: "b",
          current_weight: 0.10,
          strategyOverrides: { strategy_types: ["market_neutral"] },
        }),
        buildStrategy({
          strategy_id: "c",
          current_weight: 0.167,
          strategyOverrides: { strategy_types: ["trend"] },
        }),
      ],
    );
    const g = gate(rows, "style_concentration");
    expect(g.gate).toBe("35% cap");
    expect(g.current).toBe("29.3%"); // 0.193 + 0.10 = 0.293
    expect(g.ok).toBe(true);
  });

  it("ok=false when group exceeds cap", () => {
    const rows = deriveMandateGates(
      buildMandate({ max_aum_concentration: 0.10 }),
      null,
      [],
      [
        buildStrategy({
          current_weight: 0.30,
          strategyOverrides: { strategy_types: ["trend"] },
        }),
      ],
    );
    expect(gate(rows, "style_concentration").ok).toBe(false);
  });

  it("buckets strategies with no strategy_types[0] under 'unknown'", () => {
    const rows = deriveMandateGates(
      buildMandate({ max_aum_concentration: 0.50 }),
      null,
      [],
      [
        buildStrategy({
          strategy_id: "a",
          current_weight: 0.20,
          strategyOverrides: { strategy_types: [] },
        }),
        buildStrategy({
          strategy_id: "b",
          current_weight: 0.10,
          strategyOverrides: { strategy_types: [] },
        }),
      ],
    );
    expect(gate(rows, "style_concentration").current).toBe("30.0%");
  });
});

// ---------------------------------------------------------------------------
// countPassingGates
// ---------------------------------------------------------------------------

describe("countPassingGates", () => {
  it("returns 0/0 when every gate is indeterminate", () => {
    const rows = deriveMandateGates(null, null, [], []);
    expect(countPassingGates(rows)).toEqual({ passing: 0, total: 0 });
  });

  it("counts only decided (non-null) gates — prototype's '4/5 gates pass' shape", () => {
    // 4 gates pass, 1 fails (max DD floor over)
    const rows = deriveMandateGates(
      buildMandate({
        max_weight: 0.22,
        min_sharpe: 0.75,
        max_drawdown_tolerance: 0.075,
        liquidity_preference: "high",
        max_aum_concentration: 0.35,
      }),
      buildAnalytics({
        portfolio_sharpe: 1.84,
        portfolio_max_drawdown: -0.091, // FAIL: 9.1% > 7.5% tolerance
      }),
      [buildHolding({ value_usd: 48_700_000 })],
      [
        buildStrategy({
          current_weight: 0.185,
          strategyOverrides: { strategy_types: ["market_neutral"] },
        }),
      ],
    );
    expect(countPassingGates(rows)).toEqual({ passing: 4, total: 5 });
  });

  it("decided count omits gates with no threshold set", () => {
    const rows = deriveMandateGates(
      // Only max_weight set; the other 4 thresholds are null → indeterminate.
      buildMandate({ max_weight: 0.22 }),
      null,
      [],
      [buildStrategy({ current_weight: 0.10 })],
    );
    expect(countPassingGates(rows)).toEqual({ passing: 1, total: 1 });
  });
});
