import { describe, it, expect } from "vitest";
import { buildComparatorBlock } from "./comparator-block";
import { deriveSeriesBundle } from "./build-payload";
import { cumEq } from "./compute";
import type { DailyReturn } from "./types";

/**
 * 169.1 review-fix D — the Volatility Matched legend never reads "SPX × NaN".
 *
 * Since MD-03, an active-day-basis series with fewer than two non-zero days has a
 * NaN annualized vol (the engine's rule: std() of 0 or 1 points is NaN). The
 * vol-matched comparator scales the benchmark to the strategy's vol, so with no
 * strategy vol there is nothing to match. The block must then carry no series and
 * no label, as the unavailable block does, rather than a legend reading
 * "SPX × NaN" over an invented curve. This reaches a user only through the MTM or
 * smoothed bundle (built without `comparatorAnnVol`), so the second case drives
 * the real bundle path.
 */

const DAY = 86_400_000;
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

describe("vol-matched comparator with no finite strategy vol (169.1 review-fix D)", () => {
  const dates = Array.from({ length: 40 }, (_, i) => addDays("2024-01-01", i));
  const strat = dates.map((_, i) => (i === 20 ? 0.01 : 0));
  const bench = dates.map((_, i) => ((i % 5) - 2) / 300);

  for (const vol of [NaN, Infinity]) {
    it(`a strategy vol of ${vol} gives a null volMatched series and a null label`, () => {
      const b = buildComparatorBlock("S&P 500", "SPX", bench, strat, cumEq(strat), dates, vol, 30, 60, 365, 252);
      expect(b.volMatchedLabel).toBeNull();
      expect(b.volMatched).toBeNull();
      // Everything else about the comparator is still drawn.
      expect(b.cumulative).not.toBeNull();
      expect(b.summary).not.toBeNull();
    });
  }

  it("a finite strategy vol keeps the label and the series", () => {
    const b = buildComparatorBlock("S&P 500", "SPX", bench, strat, cumEq(strat), dates, 0.2, 30, 60, 365, 252);
    expect(b.volMatchedLabel).toMatch(/^SPX × \d+\.\d{2}$/);
    expect(b.volMatched).toHaveLength(dates.length);
  });

  it("an active-basis bundle with one non-zero day and no comparatorAnnVol has no '× NaN' label", () => {
    const rows: DailyReturn[] = dates.map((date, i) => ({ date, value: strat[i] }));
    const bundle = deriveSeriesBundle(rows, {
      periodsPerYear: 365,
      isArithmetic: false,
      dayBasis: "active",
      markets: ["crypto"],
      strategyName: "Idle Strategy",
      benchmarkPrices: { unavailable: true },
    });
    expect(Number.isNaN(bundle.strategyMetrics.ann_vol)).toBe(true);
    for (const key of ["spx", "btc"] as const) {
      const c = bundle.comparators[key];
      expect(c.volMatchedLabel ?? "", key).not.toMatch(/NaN/);
      expect(c.volMatchedLabel, key).toBeNull();
      expect(c.volMatched, key).toBeNull();
    }
  });
});
