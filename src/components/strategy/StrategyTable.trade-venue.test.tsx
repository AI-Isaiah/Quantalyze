/**
 * Phase 170.6.1 / DISCOVERYPHONE (SC-2, D-05, D-07, O-2) — the Discovery TABLE
 * names the venue a strategy's trades come from.
 *
 * THE DEFECT (measured 2026-10-13, TRADESYNC plan 21): a row read "Bybit" from
 * `strategies.supported_exchanges` while its connected key sits on OKX. The
 * label is the badge's visible exchange; the tooltip says "from the exchange".
 *
 * These cases mount the real StrategyTable with the row shape
 * `getStrategiesByCategory` now returns (`tradeVenues`), so they fail if the
 * mount stops forwarding the venues or the listed set to the badge. The badge
 * contract itself (sorting, mismatch rule, every state) lives in
 * SyncBadge.venue.test.tsx; this file pins the MOUNT.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import type { Strategy, StrategyAnalytics } from "@/lib/types";
import { installFetchMock, restoreFetchMock } from "@/test/helpers/fetch";

vi.mock("@/components/discovery/SimulateImpactButton", () => ({
  SimulateImpactButton: () => null,
}));

import { StrategyTable } from "./StrategyTable";

type Row = Strategy & {
  analytics: StrategyAnalytics;
  analyticsPresent?: boolean;
  tradeVenues?: readonly string[];
  tradeVenuesUnavailable?: boolean;
};

const HOUR = 60 * 60 * 1000;

function makeRow(
  id: string,
  name: string,
  overrides: {
    supported_exchanges: string[];
    tradeVenues?: readonly string[];
    tradeVenuesUnavailable?: boolean;
  },
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
    analytics: {
      id: "an-1",
      strategy_id: id,
      computed_at: new Date(Date.now() - HOUR).toISOString(),
      // A recent fetch so the badge renders its `current` state.
      trades_fetched_at: new Date(Date.now() - 2 * HOUR).toISOString(),
      computing_started_at: null,
      computation_status: "complete",
      computation_error: null,
      benchmark: null,
      cumulative_return: 0.12,
      cagr: 0.05,
      volatility: 0.33,
      sharpe: 0.6,
      sortino: 1.2,
      calmar: 2.4,
      max_drawdown: -0.4,
      max_drawdown_duration_days: 30,
      six_month_return: 0.07,
      sparkline_returns: [1, 2, 3, 4, 5],
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
    } as unknown as StrategyAnalytics,
    analyticsPresent: true,
  } as unknown as Row;
}

/** The badge wrapper of the row named `name`: the element carrying the tooltip. */
function badgeOf(name: string): HTMLElement {
  const row = Array.from(document.querySelectorAll("tbody tr")).find((tr) =>
    (tr.textContent ?? "").includes(name),
  );
  if (!row) throw new Error(`no rendered row for "${name}"`);
  const badge = row.querySelector<HTMLElement>("span[title*='rades']");
  if (!badge) throw new Error(`no SyncBadge in the row for "${name}"`);
  return badge;
}

/** The visible venue label: the badge's `font-medium` span. */
function labelOf(badge: HTMLElement): string | null {
  return badge.querySelector("span.font-medium")?.textContent ?? null;
}

beforeEach(() => {
  installFetchMock();
  try {
    window.localStorage.clear();
  } catch {
    // jsdom may not implement clear in some configurations; non-fatal.
  }
});

afterEach(() => {
  restoreFetchMock();
});

describe("StrategyTable - the badge names the key's venue (SC-2, D-05)", () => {
  it("a row listed as Bybit whose key is on OKX reads OKX and says it is listed as Bybit", () => {
    render(
      <StrategyTable
        strategies={[
          makeRow("70610002-0000-4000-8000-000000000001", "Mismatch Row", {
            supported_exchanges: ["bybit"],
            tradeVenues: ["okx"],
          }),
        ]}
        categorySlug="crypto-sma"
      />,
    );

    const badge = badgeOf("Mismatch Row");
    expect(labelOf(badge)).toBe("OKX");
    const title = badge.getAttribute("title") ?? "";
    expect(title).toContain("Listed as Bybit; trades come from OKX");
    expect(title).toContain("from OKX");
    expect(title).not.toContain("from the exchange");
  });

  it("a row with no key keeps its listed exchange and makes no mismatch claim", () => {
    render(
      <StrategyTable
        strategies={[
          makeRow("70610002-0000-4000-8000-000000000002", "Csv Row", {
            supported_exchanges: ["bybit"],
          }),
        ]}
        categorySlug="crypto-sma"
      />,
    );

    const badge = badgeOf("Csv Row");
    expect(labelOf(badge)).toBe("Bybit");
    const title = badge.getAttribute("title") ?? "";
    expect(title).toContain("from the exchange");
    expect(title).not.toContain("Listed as");
  });

  it("a listed deribit, with no venues, renders Deribit (O-2: display names, not the raw code)", () => {
    render(
      <StrategyTable
        strategies={[
          makeRow("70610002-0000-4000-8000-000000000003", "Deribit Row", {
            supported_exchanges: ["deribit"],
          }),
        ]}
        categorySlug="crypto-sma"
      />,
    );
    expect(labelOf(badgeOf("Deribit Row"))).toBe("Deribit");
  });
});

describe("StrategyTable - a failed venue read shows a muted 'Venue unavailable', never the listed exchange (D-10, review WR-01, SFH-2)", () => {
  it("a row marked tradeVenuesUnavailable reads 'Venue unavailable' in the label slot, never its listed Bybit, and names no venue in the tooltip (D-10)", () => {
    render(
      <StrategyTable
        strategies={[
          makeRow("70610002-0000-4000-8000-000000000011", "Outage Row", {
            supported_exchanges: ["bybit"],
            tradeVenuesUnavailable: true,
          }),
        ]}
        categorySlug="crypto-sma"
      />,
    );

    const badge = badgeOf("Outage Row");
    // D-10: the label slot holds the muted placeholder, not a blank and not the
    // listed exchange.
    const placeholder = badge.querySelector("[data-venue-unavailable]");
    expect(placeholder).not.toBeNull();
    expect(placeholder?.firstChild?.textContent).toBe("Venue unavailable");
    expect(badge.textContent?.split("Venue unavailable").length).toBe(2);
    // The placeholder must not reuse the real label's font-medium span.
    expect(labelOf(badge)).toBeNull();
    expect(badge.textContent).not.toContain("Bybit");
    const title = badge.getAttribute("title") ?? "";
    expect(title).toContain("Trades last fetched");
    expect(title).not.toContain("from the exchange");
    expect(title).not.toContain("Bybit");
    expect(title).not.toContain("Listed as");
    // The state is unchanged (D-07): the fresh sentence still renders.
    expect(badge.textContent).toContain("Trades fetched");
  });

  it("a no-key row (venues read, none found) still shows its listed exchange (D-05)", () => {
    render(
      <StrategyTable
        strategies={[
          makeRow("70610002-0000-4000-8000-000000000012", "No Key Row", {
            supported_exchanges: ["bybit"],
          }),
        ]}
        categorySlug="crypto-sma"
      />,
    );
    const badge = badgeOf("No Key Row");
    expect(labelOf(badge)).toBe("Bybit");
    expect(badge.querySelector("[data-venue-unavailable]")).toBeNull();
  });
});
