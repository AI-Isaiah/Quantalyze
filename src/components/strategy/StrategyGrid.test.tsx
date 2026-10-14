/**
 * Phase 13 / Plan 13-04 / DISCO-04 — StrategyGrid sparkline color rule.
 *
 * Card-view counterpart to the StrategyTable.test.tsx DISCO-04 block.
 * Asserts the sparkline_returns Sparkline at StrategyGrid.tsx:109-114 picks
 * its color via the sparklineColor helper (final-value-sign rule). The
 * card view has no drawdown sparkline, so this file only covers the three
 * branches (final > 0, final < 0, final === 0).
 */

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { StrategyGrid } from "./StrategyGrid";
import type { Strategy, StrategyAnalytics } from "@/lib/types";

type StrategyWithAnalytics = Strategy & { analytics: StrategyAnalytics };

const STRATEGY_ID = "22222222-0000-4000-8000-000000000001";

function makeAnalytics(
  overrides?: Partial<StrategyAnalytics>,
): StrategyAnalytics {
  return {
    id: "an-1",
    strategy_id: "s-1",
    computed_at: "2026-01-01T00:00:00Z",
    computing_started_at: null,
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
    trades_fetched_at: null,
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

function getCardSparklineStroke(): string | null {
  // The card's sparkline is the only stroked <path> in the card body.
  const path = document.querySelector("path[stroke]");
  return path?.getAttribute("stroke") ?? null;
}

describe("StrategyGrid — DISCO-04 sparkline color rule on grid card", () => {
  it("renders the card sparkline with var(--color-accent) when final > 0", () => {
    const fixture = makeStrategy({ id: STRATEGY_ID, name: "Alpha Card" });
    fixture.analytics.sparkline_returns = [0, 0.05, 0.1];
    render(<StrategyGrid strategies={[fixture]} categorySlug="crypto-sma" />);
    expect(getCardSparklineStroke()).toBe("var(--color-accent)");
  });

  it("renders the card sparkline with var(--color-negative) when final < 0", () => {
    const fixture = makeStrategy({ id: STRATEGY_ID, name: "Alpha Card" });
    fixture.analytics.sparkline_returns = [0, -0.02, -0.05];
    render(<StrategyGrid strategies={[fixture]} categorySlug="crypto-sma" />);
    expect(getCardSparklineStroke()).toBe("var(--color-negative)");
  });

  it("renders the card sparkline with var(--color-chart-benchmark) when final === 0", () => {
    const fixture = makeStrategy({ id: STRATEGY_ID, name: "Alpha Card" });
    fixture.analytics.sparkline_returns = [0.01, -0.01, 0];
    render(<StrategyGrid strategies={[fixture]} categorySlug="crypto-sma" />);
    expect(getCardSparklineStroke()).toBe("var(--color-chart-benchmark)");
  });
});

describe("StrategyGrid — TYPE-02 tile-name truncation recovery", () => {
  it("recovers the full strategy name via title= on the truncated tile heading (real name, never a fabricated placeholder)", () => {
    const longName = "A Very Long Strategy Name That Truncates On The Tile";
    const fixture = makeStrategy({ id: STRATEGY_ID, name: longName });
    render(<StrategyGrid strategies={[fixture]} categorySlug="crypto-sma" />);
    // The tile heading stays single-line (`truncate min-w-0`); title= recovers
    // the full real name on hover / for assistive tech — never a fabricated
    // stand-in (no-invented-data / STATE-02). Mirrors CompareTable.test.tsx
    // Test 3 for the sibling table surface.
    const h3 = document.querySelector("h3");
    expect(h3).not.toBeNull();
    expect(h3!.getAttribute("title")).toBe(longName);
    expect(h3!.className).toContain("truncate");
    expect(h3!.textContent).toContain(longName);
  });
});

describe("StrategyGrid - Verified badge follows the public trust signal (Phase 170.6.1.1, census G)", () => {
  /**
   * `getStrategiesByCategory` stops returning `api_key_id` once anon cannot
   * read it, so a public row has the key ABSENT (not null). The badge must
   * come from `trust_tier`, which `get_published_trust_signals` supplies.
   */
  function publicRow(trustTier: Strategy["trust_tier"]): StrategyWithAnalytics {
    const row = makeStrategy({
      id: STRATEGY_ID,
      name: "Alpha Card",
      trust_tier: trustTier,
    }) as Partial<StrategyWithAnalytics>;
    delete row.api_key_id;
    return row as StrategyWithAnalytics;
  }

  it("renders VerifiedBadge for trust_tier api_verified with api_key_id absent", () => {
    const row = publicRow("api_verified");
    expect("api_key_id" in row).toBe(false);
    const { container } = render(
      <StrategyGrid strategies={[row]} categorySlug="crypto-sma" />,
    );
    expect(container.textContent).toContain("Verified");
  });

  it("renders no VerifiedBadge for a row with api_key_id set and no trust tier (the key is not a trust claim)", () => {
    const row = makeStrategy({
      id: STRATEGY_ID,
      name: "Alpha Card",
      api_key_id: "key-1",
    });
    const { container } = render(
      <StrategyGrid strategies={[row]} categorySlug="crypto-sma" />,
    );
    expect(container.textContent).not.toContain("Verified");
  });
});

describe("StrategyGrid - the card names the key's venue (Phase 170.6.1 DISCOVERYPHONE, SC-2, D-05, O-2)", () => {
  /**
   * The grid is the Discovery table's other view mode (D-06), fed by the same
   * `getStrategiesByCategory` rows, so the same defect lives here: a card read
   * "Bybit" from `supported_exchanges` while its connected key sits on OKX.
   * A recent `trades_fetched_at` lets the badge render its `current` state.
   */
  function venueCard(
    exchanges: string[],
    tradeVenues?: readonly string[],
    tradeVenuesUnavailable?: boolean,
  ): StrategyWithAnalytics & {
    tradeVenues?: readonly string[];
    tradeVenuesUnavailable?: boolean;
  } {
    const row = makeStrategy({
      id: STRATEGY_ID,
      name: "Venue Card",
      supported_exchanges: exchanges,
    });
    row.analytics.trades_fetched_at = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    return { ...row, tradeVenues, tradeVenuesUnavailable };
  }

  function badgeOf(container: HTMLElement): HTMLElement {
    const badge = container.querySelector<HTMLElement>("span[title*='rades']");
    if (!badge) throw new Error("no SyncBadge on the card");
    return badge;
  }

  it("a card listed as Bybit whose key is on OKX reads OKX and says it is listed as Bybit", () => {
    const { container } = render(
      <StrategyGrid strategies={[venueCard(["bybit"], ["okx"])]} categorySlug="crypto-sma" />,
    );
    const badge = badgeOf(container);
    expect(badge.querySelector("span.font-medium")?.textContent).toBe("OKX");
    expect(badge.getAttribute("title")).toContain("Listed as Bybit; trades come from OKX");
  });

  it("a card with no venues keeps its listed exchange and makes no mismatch claim", () => {
    const { container } = render(
      <StrategyGrid strategies={[venueCard(["bybit"])]} categorySlug="crypto-sma" />,
    );
    const badge = badgeOf(container);
    expect(badge.querySelector("span.font-medium")?.textContent).toBe("Bybit");
    expect(badge.getAttribute("title")).not.toContain("Listed as");
  });

  it("a card marked tradeVenuesUnavailable shows NO venue label, not its listed Bybit, and no venue claim (review WR-01)", () => {
    const { container } = render(
      <StrategyGrid
        strategies={[venueCard(["bybit"], undefined, true)]}
        categorySlug="crypto-sma"
      />,
    );
    const badge = badgeOf(container);
    expect(badge.querySelector("span.font-medium")).toBeNull();
    expect(badge.textContent).not.toContain("Bybit");
    const title = badge.getAttribute("title") ?? "";
    expect(title).toContain("Trades last fetched");
    expect(title).not.toContain("from the exchange");
    expect(title).not.toContain("Bybit");
    expect(title).not.toContain("Listed as");
  });

  it("a listed deribit, with no venues, renders Deribit (O-2: display names, not the raw code)", () => {
    const { container } = render(
      <StrategyGrid strategies={[venueCard(["deribit"])]} categorySlug="crypto-sma" />,
    );
    expect(badgeOf(container).querySelector("span.font-medium")?.textContent).toBe("Deribit");
  });
});
