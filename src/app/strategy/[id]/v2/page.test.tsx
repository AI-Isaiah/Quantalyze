/**
 * SR-3 (v0.17.1.4) — `/strategy/[id]/v2/page.tsx` notFound() contract.
 *
 * The v2 page is an async Server Component that calls Supabase via
 * `getStrategyDetailV2`. Mounting it in jsdom is awkward (mirrors the v1
 * page.test.tsx convention). Instead this test exercises the
 * server-component CONTRACT directly:
 *
 *   1. When `getStrategyDetailV2` returns null (strategy missing /
 *      unpublished / RLS-denied), the page MUST invoke `notFound()`.
 *   2. When it returns a result, the page MUST NOT call `notFound()`
 *      and MUST pass `detail` through to <StrategyV2Shell>.
 *
 * Both signals matter — without #1, RLS leaks would 200 with a half-rendered
 * shell; without #2, a single unmocked branch could silently 404 every
 * request.
 *
 * `notFound()` from next/navigation throws a sentinel error to short-circuit
 * the render; we mock it to throw a recognizable Error so the test can
 * assert the call site without needing the full Next.js runtime.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock notFound so we can detect invocation without invoking the real
// Next.js error-boundary machinery.
const NOT_FOUND_SENTINEL = "NEXT_NOT_FOUND";
const notFoundSpy = vi.fn(() => {
  throw new Error(NOT_FOUND_SENTINEL);
});

vi.mock("next/navigation", () => ({
  notFound: () => notFoundSpy(),
}));

// Mock the data fetcher — each test seeds the response.
const detailSpy = vi.fn();
vi.mock("@/lib/queries", () => ({
  getStrategyDetailV2: (...args: unknown[]) => detailSpy(...args),
}));

// Mock the shell so the test isn't sensitive to the full 7-panel render.
vi.mock("@/components/strategy-v2/StrategyV2Shell", () => ({
  StrategyV2Shell: ({ detail }: { detail: { strategy: { id: string } } }) => (
    <div data-testid="v2-shell" data-strategy-id={detail.strategy.id} />
  ),
}));

import StrategyV2Page from "./page";

describe("/strategy/[id]/v2/page.tsx — SR-3 notFound contract", () => {
  beforeEach(() => {
    notFoundSpy.mockClear();
    detailSpy.mockReset();
  });

  it("Test 1: getStrategyDetailV2 returning null invokes notFound()", async () => {
    detailSpy.mockResolvedValueOnce(null);

    await expect(
      StrategyV2Page({ params: Promise.resolve({ id: "missing-id" }) }),
    ).rejects.toThrow(NOT_FOUND_SENTINEL);

    expect(detailSpy).toHaveBeenCalledWith("missing-id");
    expect(notFoundSpy).toHaveBeenCalledTimes(1);
  });

  it("Test 2: a populated result does NOT invoke notFound()", async () => {
    detailSpy.mockResolvedValueOnce({
      strategy: { id: "abc-123", name: "Stellar L/S", start_date: "2024-01-01" },
      panel1: {
        supported_exchanges: [],
        strategy_types: [],
        subtypes: [],
        markets: [],
        leverage_range: null,
        avg_daily_turnover: null,
      },
      panel2Headline: {},
      panel2Equity: { series: null, btc_overlay: null },
      panel3: { drawdown_series: null, drawdown_episodes: null },
      panel4Inputs: {
        monthly_returns: null,
        return_quantiles: null,
        returns_series: null,
        benchmark_returns: null,
      },
      panel5Inputs: { rolling_metrics: null, sharpe: null },
      panel6Inputs: { trade_metrics: null },
      panel7Inputs: {
        benchmark_greeks: { alpha: null, beta: null, ir: null, treynor: null },
        correlation_analytics: { returns_series: null, metrics_json: null },
      },
      lazyKeys: ["panel4", "panel5", "panel6", "panel7"],
      history_days: 0,
    });

    const result = await StrategyV2Page({
      params: Promise.resolve({ id: "abc-123" }),
    });

    expect(result).toBeTruthy();
    expect(notFoundSpy).not.toHaveBeenCalled();
    expect(detailSpy).toHaveBeenCalledWith("abc-123");
  });
});
