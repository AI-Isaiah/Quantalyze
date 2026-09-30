/** @vitest-environment jsdom */
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import type { BenchmarkPricesOpt, DailyPrice, DailyReturn, FactsheetPayload } from "@/lib/factsheet/types";
import { buildFactsheetPayload, fixtureBenchmarkPrices } from "@/lib/factsheet/build-payload";
import { unavailableComparatorBlock } from "@/lib/factsheet/comparator-block";
import { BTC_DAILY } from "@/lib/factsheet/benchmarks";
import { BasisProvider, useBasis, useBasisSeriesView } from "./basis-context";
import { LeverageProvider, useLeverage } from "./leverage-context";

/**
 * Phase 169.5 BENCHCOMPARE plan 02 (SC3, D-09, D-21, D-54): the payload carries the
 * bounded BTC `{ prices, through, dropped }` its comparators were computed from, and
 * the browser re-derive (`useBasisSeriesView` at a leverage other than 1) aligns BTC
 * from THOSE closes and THAT `dropped` list, so the server's and the client's BTC
 * blocks are the same object. Before this plan the re-derive read the bundled
 * fixture, so a database-fed BTC series (or one with a dropped close) gave the
 * client a different BTC block from the server's.
 *
 * The server reference is a build of the LEVERED dailies (`2 * r`); the client is
 * the hook at L = 2 over a build of the un-levered dailies. Both are handed the same
 * `benchmarkPrices` opt, whose closes deliberately differ from the fixture's so a
 * fixture fallback cannot pass.
 */

const DAY = 86_400_000;
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
function days(a: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => addDays(a, i));
}
const series = (dates: string[], seed: number): DailyReturn[] =>
  dates.map((date, i) => ({ date, value: Math.sin((i + seed) * 1.3) * 0.02 + Math.cos((i + seed) * 0.7) * 0.01 }));
const lever = (rows: DailyReturn[], L: number): DailyReturn[] => rows.map((r) => ({ date: r.date, value: L * r.value }));

const STRATEGY = {
  id: "s-169-5-02",
  name: "Bench Prices Fixture",
  types: ["quant"],
  markets: ["crypto"],
  computedAt: "2024-03-01T00:00:00Z",
  trustTier: null,
  assetClass: "crypto",
};

const CASH_DATES = days("2024-01-04", 50);
const MTM_DATES = days("2024-01-02", 52); // starts two days before cash
const CASH = series(CASH_DATES, 0);
const MTM = series(MTM_DATES, 3);

/** Closes over [2024-01-01, last MTM date], scaled so they differ from the fixture's. */
function dbPrices(): DailyPrice[] {
  return BTC_DAILY.filter((p) => p.date >= "2024-01-01" && p.date <= MTM_DATES[MTM_DATES.length - 1]).map(
    (p, i) => ({ date: p.date, close: p.close * (1 + 0.01 * Math.sin(i)) }),
  );
}

function opt(withDropped: boolean): BenchmarkPricesOpt {
  const all = dbPrices();
  const prices = withDropped ? all.filter((p) => p.date !== "2024-01-20") : all;
  return { prices, through: prices[prices.length - 1].date, dropped: withDropped ? ["2024-01-20"] : [] };
}

function build(cash: DailyReturn[], mtm: DailyReturn[] | null, benchmarkPrices: BenchmarkPricesOpt | undefined) {
  return buildFactsheetPayload(STRATEGY, cash, {
    ...(mtm
      ? {
          mtmSeries: { dailyReturns: mtm, gapSpans: [] },
          mtmGate: { available: true },
          metricsByBasis: {
            mark_to_market: {
              cumulative_return: 0.1,
              volatility: 0.2,
              max_drawdown: -0.05,
              cagr: 0.1,
              sharpe: 1,
              sortino: 1.5,
              calmar: 2,
            },
          },
        }
      : {}),
    ...(benchmarkPrices ? { benchmarkPrices } : {}),
  } as Parameters<typeof buildFactsheetPayload>[2])!;
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <BasisProvider>
      <LeverageProvider>{children}</LeverageProvider>
    </BasisProvider>
  );
}

function clientView(payload: FactsheetPayload, basis: "cash_settlement" | "mark_to_market", L: number) {
  const { result } = renderHook(
    () => ({ basis: useBasis(), lev: useLeverage(), view: useBasisSeriesView(payload) }),
    { wrapper },
  );
  act(() => result.current.basis.setBasis(basis));
  act(() => result.current.lev.setLeverage(L));
  expect(result.current.view).not.toBe(payload); // the re-derive actually ran
  return result.current.view;
}

describe("169.5-02 SC3 / D-09: the browser re-derive aligns BTC from the payload's own series", () => {
  for (const withDropped of [true, false]) {
    const label = withDropped ? "with a dropped close inside the range" : "with no dropped close";
    it(`cash, L = 2, ${label}: the client BTC block deep-equals the server's`, () => {
      const bp = opt(withDropped);
      const server = build(lever(CASH, 2), null, bp).comparators.btc;
      const client = clientView(build(CASH, null, bp), "cash_settlement", 2).comparators.btc;
      expect(client).toEqual(server);
      // Non-vacuous: the fixture's closes give a different BTC block.
      const fromFixture = build(lever(CASH, 2), null, undefined).comparators.btc;
      expect(fromFixture.dailyReturns).not.toEqual(server.dailyReturns);
    });
  }

  it("mark_to_market, L = 2, with a dropped close and an MTM axis starting before cash: deep-equal", () => {
    const bp = opt(true);
    const server = build(CASH, lever(MTM, 2), bp).seriesByBasis!.mark_to_market!.comparators.btc;
    const client = clientView(build(CASH, MTM, bp), "mark_to_market", 2).comparators.btc;
    expect(client).toEqual(server);
    // Day one of the MTM axis comes from the carried close dated the day before it.
    expect(server.dailyReturns![0]).not.toBe(0);
  });

  it("the payload carries the opt verbatim; with no opt it carries the fixture bounded over every axis", () => {
    const bp = opt(true);
    expect(build(CASH, MTM, bp).benchmarkPrices).toEqual(bp);

    const carried = build(CASH, MTM, undefined).benchmarkPrices;
    if (!carried || "unavailable" in carried) throw new Error("expected fixture prices");
    expect(carried.prices[0].date).toBe("2024-01-01"); // earliest (MTM) date minus one day
    expect(carried.prices[carried.prices.length - 1].date).toBe(MTM_DATES[MTM_DATES.length - 1]);
    expect(carried.through).toBe(MTM_DATES[MTM_DATES.length - 1]);
    expect(carried.dropped).toEqual([]);
    expect(carried).toEqual(fixtureBenchmarkPrices([CASH, MTM]));
  });

  it("D-21: a payload WITHOUT the field re-derives BTC as the unavailable form, never the fixture", () => {
    const payload = build(CASH, null, undefined);
    delete (payload as { benchmarkPrices?: unknown }).benchmarkPrices;
    const btc = clientView(payload, "cash_settlement", 2).comparators.btc;
    expect(btc).toEqual(unavailableComparatorBlock("BTC-USD", "BTC"));
    expect(btc.summary).toBeNull();
    expect(btc.through).toBeNull();
  });
});
