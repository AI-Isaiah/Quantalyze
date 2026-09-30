import { describe, it, expect, vi } from "vitest";
import {
  buildAllocatorPortfolioFactsheetPayload,
  equityCurveToDailyReturns,
  resolveDailyReturnSeries,
} from "./allocator-portfolio-payload";
import * as resolveSeries from "./resolve-series";
import { buildFactsheetPayload } from "./build-payload";
import type { DailyReturn } from "./types";

describe("equityCurveToDailyReturns", () => {
  it("returns an empty array when fewer than two valid points are supplied", () => {
    expect(equityCurveToDailyReturns([])).toEqual([]);
    expect(
      equityCurveToDailyReturns([{ date: "2025-01-01", value: 1 }]),
    ).toEqual([]);
  });

  it("derives daily returns from a wealth curve (curr/prev - 1)", () => {
    const got = equityCurveToDailyReturns([
      { date: "2025-01-01", value: 1.0 },
      { date: "2025-01-02", value: 1.05 },
      { date: "2025-01-03", value: 1.0395 },
    ]);
    expect(got).toHaveLength(2);
    expect(got[0].date).toBe("2025-01-02");
    expect(got[0].value).toBeCloseTo(0.05, 6);
    expect(got[1].date).toBe("2025-01-03");
    expect(got[1].value).toBeCloseTo(-0.01, 6);
  });

  it("sorts by date and drops non-finite / non-positive values defensively", () => {
    const got = equityCurveToDailyReturns([
      { date: "2025-01-03", value: 1.05 },
      { date: "2025-01-01", value: 1.0 },
      { date: "2025-01-02", value: 0 },
      { date: "2025-01-04", value: NaN },
      { date: "2025-01-05", value: 1.1 },
    ] as Array<{ date: string; value: number }>);
    // Valid wealth points sorted: [1.0 @ 01-01, 1.05 @ 01-03, 1.1 @ 01-05].
    // Returns derived as ratio successor pairs of the SORTED valid series.
    expect(got).toHaveLength(2);
    expect(got[0].date).toBe("2025-01-03");
    expect(got[1].date).toBe("2025-01-05");
  });
});

describe("buildAllocatorPortfolioFactsheetPayload", () => {
  it("returns null when the input series is too short", () => {
    expect(
      buildAllocatorPortfolioFactsheetPayload(
        [{ date: "2025-01-01", value: 1 }],
        { allocatorId: "alloc-1" },
      ),
    ).toBeNull();
  });

  it("synthesises a per-allocator strategyId so persistence keys don't collide on shared devices", () => {
    // Use enough points to clear the builder's length threshold (2+).
    const wealth = Array.from({ length: 10 }).map((_, i) => ({
      date: `2025-02-${String(i + 1).padStart(2, "0")}`,
      value: 1 + i * 0.01,
    }));
    const payload = buildAllocatorPortfolioFactsheetPayload(wealth, {
      allocatorId: "alloc-7",
      portfolioName: "Multi-Asset",
    });
    // The benchmark fixture covers 2023-04-26 onwards, so the 2025-02
    // window clips cleanly through and yields a payload.
    expect(payload).not.toBeNull();
    expect(payload!.strategyId).toBe("portfolio:alloc-7");
    expect(payload!.strategyName).toBe("Multi-Asset");
    // Allocator-portfolio derived series should NOT carry a trust tier
    // (it's not a published strategy) and no benchmark ticker.
    expect(payload!.trustTier).toBeNull();
    expect(payload!.benchmark).toBeNull();
  });

  it("falls back to 'My Portfolio' when no name is supplied", () => {
    const wealth = Array.from({ length: 10 }).map((_, i) => ({
      date: `2025-02-${String(i + 1).padStart(2, "0")}`,
      value: 1 + i * 0.01,
    }));
    const payload = buildAllocatorPortfolioFactsheetPayload(wealth, {
      allocatorId: "alloc-default-name",
    });
    expect(payload?.strategyName).toBe("My Portfolio");
  });

  it("BLEND-02: risk metrics ride the √365 crypto basis; CAGR byte-identical (calendar clock)", () => {
    // A varied wealth curve: sinusoidal + drift so the derived daily returns have
    // a non-zero std AND negatives (so sharpe / ann_vol / sortino are non-trivial).
    const base = Date.UTC(2025, 0, 1);
    const wealth = Array.from({ length: 60 }).map((_, i) => ({
      date: new Date(base + i * 86_400_000).toISOString().slice(0, 10),
      value: 1 + 0.02 * Math.sin(i / 5) + i * 0.002,
    }));
    const dailyReturns: DailyReturn[] = equityCurveToDailyReturns(wealth);

    // Reference payloads built from the SAME derived series — the only knob that
    // differs is the annualization basis. strategyMetrics (sharpe/ann_vol/cagr)
    // depend ONLY on the return series + periodsPerYear, so these are exact
    // hand-computed references at 252 vs 365.
    const ref = (assetClass?: string) =>
      buildFactsheetPayload(
        {
          id: "ref",
          name: "ref",
          types: [],
          markets: [],
          computedAt: "2025-01-01T00:00:00Z",
          trustTier: null,
          ...(assetClass ? { assetClass } : {}),
        },
        dailyReturns,
      );
    const p252 = ref(); // default 252 basis
    const p365 = ref("crypto"); // 365 basis
    expect(p252).not.toBeNull();
    expect(p365).not.toBeNull();

    const alloc = buildAllocatorPortfolioFactsheetPayload(wealth, {
      allocatorId: "alloc-basis",
    });
    expect(alloc).not.toBeNull();

    // Risk metrics MOVED to the 365 basis (exact-engine identity to the 365 ref).
    expect(alloc!.strategyMetrics.sharpe).toBe(p365!.strategyMetrics.sharpe);
    expect(alloc!.strategyMetrics.ann_vol).toBe(p365!.strategyMetrics.ann_vol);
    expect(alloc!.strategyMetrics.sortino).toBe(p365!.strategyMetrics.sortino);
    // …and they scale by √(365/252) vs the 252 basis (annVol = s×√N).
    expect(
      alloc!.strategyMetrics.ann_vol / p252!.strategyMetrics.ann_vol,
    ).toBeCloseTo(Math.sqrt(365 / 252), 6);
    expect(
      alloc!.strategyMetrics.sharpe / p252!.strategyMetrics.sharpe,
    ).toBeCloseTo(Math.sqrt(365 / 252), 6);
    // Falsifiable: the two bases genuinely differ (so an allocator payload still
    // on the 252 default would fail the `=== p365` pins above).
    expect(p365!.strategyMetrics.sharpe).not.toBe(p252!.strategyMetrics.sharpe);

    // CAGR is the CALENDAR clock (days/365.25) — asset-class-INVARIANT.
    expect(alloc!.strategyMetrics.cagr).toBe(p252!.strategyMetrics.cagr);
    expect(p365!.strategyMetrics.cagr).toBe(p252!.strategyMetrics.cagr);
  });

  it("D-06: a supplied dailyReturns series is the Sharpe input and the $-curve is not converted", () => {
    // The curve doubles on day 2 (a deposit, if read as a level ratio). The
    // persisted returns are a small oscillation. Those two Sharpes differ, so
    // a builder that ignored dailyReturns would fail this.
    const base = Date.UTC(2025, 0, 1);
    const day = (i: number) =>
      new Date(base + i * 86_400_000).toISOString().slice(0, 10);
    const curve = Array.from({ length: 40 }, (_, i) => ({
      date: day(i),
      value: i === 0 ? 100 : 200,
    }));
    const dailyReturns: DailyReturn[] = Array.from({ length: 39 }, (_, i) => ({
      date: day(i + 1),
      value: i % 2 === 0 ? 0.01 : -0.004,
    }));
    const spy = vi.spyOn(resolveSeries, "equityCurveToDailyReturns");
    const fromReturns = buildAllocatorPortfolioFactsheetPayload(curve, {
      allocatorId: "alloc-returns",
      computedAt: "2025-02-10T00:00:00Z",
      dailyReturns,
    });
    expect(spy).not.toHaveBeenCalled();
    const ref = buildFactsheetPayload(
      {
        id: "portfolio:alloc-returns",
        name: "My Portfolio",
        types: ["allocator_portfolio"],
        markets: [],
        computedAt: "2025-02-10T00:00:00Z",
        trustTier: null,
        ingestSource: "api",
        assetClass: "crypto",
      },
      dailyReturns,
    );
    expect(fromReturns).not.toBeNull();
    expect(ref).not.toBeNull();
    expect(fromReturns!.strategyMetrics.sharpe).toBe(ref!.strategyMetrics.sharpe);
    const fromCurve = buildAllocatorPortfolioFactsheetPayload(curve, {
      allocatorId: "alloc-returns",
    });
    expect(spy).toHaveBeenCalled();
    expect(fromCurve!.strategyMetrics.sharpe).not.toBe(
      fromReturns!.strategyMetrics.sharpe,
    );
    spy.mockRestore();
  });
});

describe("resolveDailyReturnSeries — analytics column-drift fallback", () => {
  // Regression: analytics-service writes the cumprod equity curve to
  // `returns_series`; the `daily_returns` column is only populated by
  // CSV ingest. Strategies computed only by analytics-service (e.g.
  // Phoenix Protocol on 2026-05-20) leave `daily_returns=null`, so the
  // factsheet route used to render the "still computing" placeholder
  // even though the real wealth curve already existed in `returns_series`.
  // Pin the resolver so the route's fallback chain can't silently regress.
  // Found by /qa on 2026-05-20.
  it("returns the daily_returns array verbatim when populated", () => {
    const got = resolveDailyReturnSeries(
      [
        { date: "2025-01-01", value: 0.01 },
        { date: "2025-01-02", value: -0.005 },
      ],
      null,
    );
    expect(got).toHaveLength(2);
    expect(got[0]).toEqual({ date: "2025-01-01", value: 0.01 });
  });

  it("derives daily returns from the cumprod equity curve when daily_returns is null", () => {
    const wealthSeries = Array.from({ length: 80 }).map((_, i) => {
      const day = String((i % 28) + 1).padStart(2, "0");
      const month = String(((i / 28) | 0) + 1).padStart(2, "0");
      return {
        date: `2024-${month}-${day}`,
        value: 1 + Math.sin(i / 7) * 0.01,
      };
    });
    const got = resolveDailyReturnSeries(null, wealthSeries);
    expect(got.length).toBeGreaterThanOrEqual(2);
    expect(Math.abs(got[0].value)).toBeLessThan(0.05);
  });

  it("yields a non-null FactsheetPayload end-to-end for a Phoenix-shaped strategy", () => {
    const wealthSeries = Array.from({ length: 80 }).map((_, i) => {
      const day = String((i % 28) + 1).padStart(2, "0");
      const month = String(((i / 28) | 0) + 1).padStart(2, "0");
      return {
        date: `2024-${month}-${day}`,
        value: 1 + Math.sin(i / 7) * 0.01,
      };
    });
    const dailyReturns = resolveDailyReturnSeries(null, wealthSeries);
    const payload = buildFactsheetPayload(
      {
        id: "phoenix-protocol-fake",
        name: "Phoenix Protocol",
        types: ["long_short"],
        markets: ["crypto"],
        computedAt: "2026-05-20T04:01:05.469Z",
        trustTier: null,
      },
      dailyReturns,
    );
    expect(payload).not.toBeNull();
    expect(payload!.strategyName).toBe("Phoenix Protocol");
    expect(payload!.dates.length).toBeGreaterThanOrEqual(2);
  });

  it("returns an empty array when neither column has data", () => {
    expect(resolveDailyReturnSeries(null, null)).toEqual([]);
    expect(resolveDailyReturnSeries(undefined, undefined)).toEqual([]);
  });
});

/**
 * Phase 169.4 plan 02 (SC3, D-09, D-69). The /allocations Overview used to
 * reach `buildFactsheetPayload` with no BTC opt, so its BTC comparator was the
 * bundled fixture (last date 2026-05-12) while every factsheet read the fed
 * table. These cases pin that the dashboard's database closes reach the build,
 * and that a read error renders the unavailable comparator, never the fixture.
 * The book is dated after the fixture's last date so a fixture close can never
 * stand in for a database close.
 */
describe("buildAllocatorPortfolioFactsheetPayload — the dashboard's BTC closes (169.4-02)", () => {
  const DAY_MS = 86_400_000;
  const isoDay = (startIso: string, i: number) =>
    new Date(Date.parse(`${startIso}T00:00:00Z`) + i * DAY_MS).toISOString().slice(0, 10);
  // 60 book returns, 2026-08-01 .. 2026-09-29 ("yesterday" for these cases).
  const BOOK: DailyReturn[] = Array.from({ length: 60 }, (_, i) => ({
    date: isoDay("2026-08-01", i),
    value: 0.002 * Math.sin(i / 3) + 0.0005,
  }));
  // BTC closes from the day before the book's first date through its last.
  const CLOSES = Array.from({ length: 61 }, (_, i) => ({
    date: isoDay("2026-07-31", i),
    close: 60_000 * (1 + 0.01 * Math.cos(i / 4)),
  }));
  const meta = { allocatorId: "a-1", dailyReturns: BOOK };

  it("closes through yesterday: the BTC comparator is dated yesterday (not the fixture's 2026-05-12) with numeric windows", () => {
    const payload = buildAllocatorPortfolioFactsheetPayload([], {
      ...meta,
      btcBenchmarkPrices: { prices: CLOSES, through: "2026-09-29", dropped: [] },
    });
    const btc = payload!.comparators.btc;
    expect(btc.through).toBe("2026-09-29");
    expect(btc.summary).not.toBeNull();
    expect(Number.isFinite(btc.summary!.cum_ret)).toBe(true);
    expect(Number.isFinite(btc.summary!.ann_vol)).toBe(true);
    expect(btc.joint).not.toBeNull();
    expect(Number.isFinite(btc.joint!.beta)).toBe(true);
  });

  it("the unavailable marker: the BTC comparator is the unavailable form, never fixture closes", () => {
    // A book dated INSIDE the bundled fixture's range, so a build that ignored
    // the marker would fall back to fixture closes and show a BTC summary.
    const bookInFixture: DailyReturn[] = BOOK.map((r, i) => ({ ...r, date: isoDay("2026-03-01", i) }));
    const withoutOpt = buildAllocatorPortfolioFactsheetPayload([], { allocatorId: "a-1", dailyReturns: bookInFixture });
    expect(withoutOpt!.comparators.btc.summary).not.toBeNull(); // the fixture path this case guards against
    const payload = buildAllocatorPortfolioFactsheetPayload([], {
      allocatorId: "a-1",
      dailyReturns: bookInFixture,
      btcBenchmarkPrices: { unavailable: true },
    });
    const btc = payload!.comparators.btc;
    expect(btc.summary).toBeNull();
    expect(btc.through ?? null).toBeNull();
  });
});
