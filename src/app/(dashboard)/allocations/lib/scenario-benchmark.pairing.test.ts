import { describe, it, expect } from "vitest";

import type { DailyPrice } from "@/lib/factsheet/types";

import {
  btcLevelsFromCloses,
  pairScenarioWithBtc,
  parseBtcCloses,
} from "./scenario-benchmark";

/**
 * Phase 169.4 ALLOCTRUTH / plan 169.4-03 (D-66, D-67, D-68): the Scenario's
 * BTC closes body guard, its one pairing function and its close-level overlay.
 *
 * The end-to-end case (the route's JSON, parsed, then paired) lives in
 * `src/app/api/benchmark/btc/prices/route.test.ts`, beside the mocked client it
 * needs; this file pins the pure functions.
 */

describe("parseBtcCloses (D-67): only { prices, dropped, through } parses; anything else is unavailable", () => {
  const good = {
    prices: [
      { date: "2026-06-01", close: 100 },
      { date: "2026-06-02", close: 101.5 },
    ],
    dropped: ["2026-06-03"],
    through: "2026-06-02",
  };

  it("parses the route's body to the closes", () => {
    expect(parseBtcCloses(good)).toEqual(good);
    expect(parseBtcCloses({ prices: [], dropped: [], through: null })).toEqual({
      prices: [],
      dropped: [],
      through: null,
    });
  });

  it("refuses the OLD returns body (an array of { date, value }), so a stale cached body reads as unavailable", () => {
    expect(
      parseBtcCloses([
        { date: "2026-06-02", value: 0.015 },
        { date: "2026-06-03", value: -0.01 },
      ]),
    ).toBeNull();
  });

  it("refuses a body with a missing field", () => {
    expect(parseBtcCloses({ prices: good.prices, through: good.through })).toBeNull();
    expect(parseBtcCloses({ dropped: good.dropped, through: good.through })).toBeNull();
    expect(parseBtcCloses({ prices: good.prices, dropped: good.dropped })).toBeNull();
    expect(parseBtcCloses(null)).toBeNull();
    expect(parseBtcCloses("x")).toBeNull();
  });

  it("refuses a non-finite, non-numeric or non-positive close", () => {
    for (const close of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, "100", null]) {
      expect(
        parseBtcCloses({ ...good, prices: [{ date: "2026-06-01", close }] }),
        String(close),
      ).toBeNull();
    }
  });

  it("refuses unsorted or duplicated dates, in prices and in dropped", () => {
    expect(
      parseBtcCloses({
        ...good,
        prices: [
          { date: "2026-06-02", close: 101 },
          { date: "2026-06-01", close: 100 },
        ],
      }),
    ).toBeNull();
    expect(
      parseBtcCloses({
        ...good,
        prices: [
          { date: "2026-06-01", close: 100 },
          { date: "2026-06-01", close: 101 },
        ],
      }),
    ).toBeNull();
    expect(
      parseBtcCloses({ ...good, dropped: ["2026-06-05", "2026-06-03"] }),
    ).toBeNull();
    expect(parseBtcCloses({ ...good, dropped: [20260603] })).toBeNull();
  });
});

/**
 * Closes as the route would serve them, from a date -> close record. A date
 * absent from the record is a missing stored day.
 */
function closes(record: Record<string, number>): DailyPrice[] {
  return Object.entries(record)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, close]) => ({ date, close }));
}

/**
 * SC12 / D-68: the Scenario pairs with BTC by the engine's rule. The engine's
 * own tests (`analytics-service/tests/test_benchalign.py`) build their series
 * from seeded random draws, so each case below ports the engine case's
 * STRUCTURE (calendar, start weekday, which BTC date is missing) with
 * hand-written closes, and writes the expected BTC value from the price-ratio
 * definition the engine's oracle uses, never from the function under test.
 */
describe("pairScenarioWithBtc (SC12, D-68): the engine's three pairing rules", () => {
  it("day one pairs with BTC's own same-day return (166.4 D-05)", () => {
    // Ported from test_benchalign.py::test_benchalign_d05_index_zero_pairs_with_the_t0_return:
    // the strategy's first date t0 is a benchmark close, so index 0 pairs with
    // the benchmark return dated t0, and every strategy date is paired.
    const btc = closes({
      "2025-03-03": 100,
      "2025-03-04": 104,
      "2025-03-05": 101.4,
      "2025-03-06": 103,
    });
    const portfolio = [
      { date: "2025-03-05", value: 0.002 },
      { date: "2025-03-06", value: -0.001 },
    ];
    const out = pairScenarioWithBtc(portfolio, { prices: btc, dropped: [] });
    expect(out.dates).toEqual(["2025-03-05", "2025-03-06"]);
    expect(out.p).toEqual([0.002, -0.001]);
    expect(out.b[0]).toBe(101.4 / 104 - 1);
    expect(out.b[1]).toBe(103 / 101.4 - 1);
  });

  it("a Friday-to-Monday portfolio interval pairs with BTC's compounded Friday-to-Monday move (166.4 D-A)", () => {
    // Ported from test_benchalign.py::test_benchalign_weekday_beta_is_the_friday_to_monday_regression:
    // a weekday-only strategy starting mid-week (Wednesday) against a 7-day
    // benchmark with every close present. The Monday's benchmark value is the
    // price ratio close(Mon) / close(Fri) - 1, not the one-day Sunday-to-Monday
    // move the old date-intersection join paired it with.
    const btc = closes({
      "2025-03-04": 100,
      "2025-03-05": 102,
      "2025-03-06": 101,
      "2025-03-07": 104, // Friday
      "2025-03-08": 106,
      "2025-03-09": 100, // Sunday
      "2025-03-10": 107, // Monday
      "2025-03-11": 105,
    });
    const portfolio = ["2025-03-05", "2025-03-06", "2025-03-07", "2025-03-10", "2025-03-11"].map(
      (date, i) => ({ date, value: 0.001 * (i + 1) }),
    );
    const out = pairScenarioWithBtc(portfolio, { prices: btc, dropped: [] });
    expect(out.dates).toEqual(portfolio.map((d) => d.date));
    const monday = out.dates.indexOf("2025-03-10");
    expect(out.b[monday]).toBeCloseTo(107 / 104 - 1, 12);
    expect(Math.abs(out.b[monday] - (107 / 100 - 1))).toBeGreaterThan(0.03);
    expect(out.b[out.dates.indexOf("2025-03-11")]).toBe(105 / 107 - 1);
  });

  it("an interval with a BTC date missing inside it is unpaired (166.4 review WR-01, 169.5 D-64(2))", () => {
    // Ported from test_benchalign.py::test_benchalign_gap_missing_row_inside_a_weekday_interval_unpairs_it:
    // the engine's strategy is bdate_range("2025-03-05", 60); its dropped
    // benchmark date is the Saturday after the strategy's fourth Friday,
    // 2025-03-29, and the Monday it unpairs is 2025-03-31. Friday and Monday
    // are both still closes, so the both-endpoints rule alone would pair the
    // Monday; the missing Saturday unpairs it. Every other interval stays
    // paired with the price ratio over its own interval.
    const record: Record<string, number> = {
      "2025-03-25": 100,
      "2025-03-26": 101, // Wednesday: the portfolio starts mid-week
      "2025-03-27": 99,
      "2025-03-28": 102, // Friday
      // "2025-03-29" Saturday: missing
      "2025-03-30": 104,
      "2025-03-31": 106, // Monday
      "2025-04-01": 103,
      "2025-04-02": 108,
    };
    const portfolio = [
      "2025-03-26",
      "2025-03-27",
      "2025-03-28",
      "2025-03-31",
      "2025-04-01",
      "2025-04-02",
    ].map((date, i) => ({ date, value: 0.001 * (i + 1) }));
    const out = pairScenarioWithBtc(portfolio, { prices: closes(record), dropped: [] });
    expect(out.dates).toEqual(["2025-03-26", "2025-03-27", "2025-03-28", "2025-04-01", "2025-04-02"]);
    const prev: Record<string, string> = {
      "2025-03-26": "2025-03-25",
      "2025-03-27": "2025-03-26",
      "2025-03-28": "2025-03-27",
      "2025-04-01": "2025-03-31",
      "2025-04-02": "2025-04-01",
    };
    out.dates.forEach((d, i) => {
      expect(out.b[i]).toBe(record[d] / record[prev[d]] - 1);
    });
  });
});

describe("btcLevelsFromCloses (D-66): the overlay is the close level, not compounded returns", () => {
  it("has no point on a missing day or a dropped date, and every level is close / first close, after the dropped date too", () => {
    // 2026-06-03 is missing; 2026-06-05 was a corrupt stored close, so the
    // route reports it in `dropped` and leaves it out of `prices`. Compounding
    // the returns rule's points would lose the 06-04 -> 06-06 move for good
    // (the rule refuses to bridge a dropped close), so every later level would
    // be wrong. The close level keeps BTC's real level.
    const prices = closes({
      "2026-06-01": 100,
      "2026-06-02": 110,
      "2026-06-04": 121,
      "2026-06-06": 99,
      "2026-06-07": 132,
    });
    const levels = btcLevelsFromCloses(prices);
    expect(levels.map((l) => l.date)).toEqual([
      "2026-06-01",
      "2026-06-02",
      "2026-06-04",
      "2026-06-06",
      "2026-06-07",
    ]);
    for (const l of levels) {
      const close = prices.find((p) => p.date === l.date)!.close;
      expect(l.value).toBe(close / 100);
    }
    expect(levels.find((l) => l.date === "2026-06-07")!.value).toBe(1.32);
    expect(btcLevelsFromCloses([])).toEqual([]);
  });
});

describe("btcLevelsFromCloses (169.4 review WR-01): the overlay is based at the scenario's first date", () => {
  // The served series starts years before a scenario (the closes route puts
  // the bundled fixture's 2023-04-26 close first). A base at the series' first
  // close drew BTC at close(first scenario day) / 28000, about 3x, beside a
  // portfolio line at 1.0. The base is the last close on or before the
  // scenario's first date, and the curve starts there.
  const served = closes({
    "2023-04-26": 28_000,
    "2025-12-30": 88_000,
    "2026-01-05": 90_000,
    "2026-01-06": 99_000,
  });

  it("reads 1.0 on the scenario's first date and has no point before it", () => {
    const levels = btcLevelsFromCloses(served, "2026-01-05");
    expect(levels[0]).toEqual({ date: "2026-01-05", value: 1 });
    expect(levels.map((l) => l.date)).toEqual(["2026-01-05", "2026-01-06"]);
    expect(levels[1].value).toBeCloseTo(1.1, 12);
  });

  it("bases on the last close BEFORE the first date when that date has no close", () => {
    const levels = btcLevelsFromCloses(served, "2026-01-02");
    expect(levels[0]).toEqual({ date: "2025-12-30", value: 1 });
    expect(levels.find((l) => l.date === "2026-01-05")!.value).toBeCloseTo(90 / 88, 12);
  });

  it("falls back to the first close on or after the first date when no close precedes it", () => {
    const levels = btcLevelsFromCloses(served, "2020-01-01");
    expect(levels[0]).toEqual({ date: "2023-04-26", value: 1 });
    expect(levels).toHaveLength(4);
  });
});
