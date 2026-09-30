import { describe, it, expect } from "vitest";

import { parseBtcCloses } from "./scenario-benchmark";

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
