/**
 * Phase 239 (CACHE-04) — Discovery ranks a BTC-unit strategy beside USD strategies by its raw
 * figures, and the row keeps its "in BTC" chip.
 *
 * Founder ruling, 2026-11-24 (239-CONTEXT.md):
 *   Q1: "That is correct, As BTC Strategies usually just have a different collateral."
 *   Q2: "This is correct. Inportantly, When comparinh BTC to USaf Strategies. Dont include
 *        BTC Price conversion. Just compare pure Performance"
 *
 * This file pins ORDER, the #n ordinals and the chip's PRESENCE. It does not pin copy or
 * classes (StrategyTable.test.tsx's native-unit chip describe owns those). The fixtures are
 * copied from StrategyTable.test.tsx (they are file-local there).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrategyTable } from "./StrategyTable";
import type { Strategy, StrategyAnalytics } from "@/lib/types";
import { installFetchMock, restoreFetchMock } from "@/test/helpers/fetch";

type StrategyWithAnalytics = Strategy & { analytics: StrategyAnalytics };

function makeAnalytics(
  overrides?: Partial<StrategyAnalytics>,
): StrategyAnalytics {
  return {
    id: "an-1",
    strategy_id: "s-1",
    // Phase 239: yesterday, like series_end below, so a Phase 238 change to the computed_at
    // sort key or the current/stale partition cannot reorder these rows.
    computed_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
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
    // Phase 197 plan 03 (CLAR-02, D-03): a CURRENT newest return day by default (yesterday, against
    // the real clock, far inside the 7-day line). The published-only table now judges a row by
    // `series_end`, and a fixture without one is "age unknown": it would lose its `#n` and sort
    // after dated rows, which this file's ordinal and order cases are not about. A test that needs
    // a stale or undated row passes `series_end` explicitly (stale-series.test.tsx owns those).
    series_end: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
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


vi.mock("@/components/discovery/SimulateImpactButton", () => ({
  SimulateImpactButton: () => null,
}));

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

const ID_BTC = "22222222-0000-4000-8000-000000000001";
const ID_USD_A = "22222222-0000-4000-8000-000000000002";
const ID_USD_B = "22222222-0000-4000-8000-000000000003";

/** A row identical to every other except id, name, cagr and native_unit. */
function row(id: string, name: string, cagr: number, nativeUnit: string | null = null): StrategyWithAnalytics {
  const s = makeStrategy({ id, name });
  s.analytics = makeAnalytics({ strategy_id: id, cagr, native_unit: nativeUnit });
  return s;
}

const bodyRows = () => Array.from(document.querySelectorAll("tbody tr"));

async function sortByCagr(user: ReturnType<typeof userEvent.setup>) {
  const cagrHeader = screen.getByRole("columnheader", { name: /CAGR/ });
  await user.click(within(cagrHeader).getByRole("button"));
}

describe("StrategyTable — a BTC-unit row ranks beside USD rows by raw CAGR (CACHE-04)", () => {
  it("one BTC row and one USD row rank together by raw CAGR", async () => {
    const user = userEvent.setup();
    render(
      <StrategyTable
        strategies={[row(ID_USD_A, "Usd Anchor", 0.1), row(ID_BTC, "Btc Collateral", 0.3, "BTC")]}
        categorySlug="crypto-sma"
      />,
    );
    // A fresh column sorts descending: the BTC row's raw 30% beats the USD row's 10%.
    await sortByCagr(user);
    let rows = bodyRows();
    expect(rows[0].textContent).toContain("#1");
    expect(rows[0].textContent).toContain("Btc Collateral");
    expect(rows[1].textContent).toContain("#2");
    expect(rows[1].textContent).toContain("Usd Anchor");
    // Ascending: the USD row is #1.
    await sortByCagr(user);
    rows = bodyRows();
    expect(rows[0].textContent).toContain("#1");
    expect(rows[0].textContent).toContain("Usd Anchor");
  });

  it("a BTC row between two USD rows is #2", async () => {
    const user = userEvent.setup();
    render(
      <StrategyTable
        strategies={[
          row(ID_USD_B, "Usd Bottom", 0.1),
          row(ID_BTC, "Btc Collateral", 0.2, "BTC"),
          row(ID_USD_A, "Usd Top", 0.3),
        ]}
        categorySlug="crypto-sma"
      />,
    );
    await sortByCagr(user);
    const rows = bodyRows();
    expect(rows[0].textContent).toContain("Usd Top");
    expect(rows[1].textContent).toContain("#2");
    expect(rows[1].textContent).toContain("Btc Collateral");
    expect(rows[2].textContent).toContain("Usd Bottom");
  });

  it("the BTC row keeps its in BTC chip", async () => {
    const user = userEvent.setup();
    render(
      <StrategyTable
        strategies={[row(ID_USD_A, "Usd Anchor", 0.1), row(ID_BTC, "Btc Collateral", 0.3, "BTC")]}
        categorySlug="crypto-sma"
      />,
    );
    await sortByCagr(user);
    const btcCell = screen.getByRole("link", { name: "Btc Collateral" }).closest("td")!;
    const usdCell = screen.getByRole("link", { name: "Usd Anchor" }).closest("td")!;
    const chips = btcCell.querySelectorAll("[data-returns-unit]");
    expect(chips).toHaveLength(1);
    expect(chips[0].getAttribute("data-returns-unit")).toBe("BTC");
    expect(usdCell.querySelectorAll("[data-returns-unit]")).toHaveLength(0);
  });
});
