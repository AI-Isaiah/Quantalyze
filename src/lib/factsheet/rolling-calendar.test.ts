/**
 * 194 plan 23 (D-14, TRUST-05): the TS half of the 365-calendar-day rolling window.
 * The expected values in `rolling_1y_vectors.json` are closed forms in each window's
 * counts, written beside their derivation in the fixture; neither implementation
 * produced them. `analytics-service/tests/test_rolling_1y.py` reads the SAME file, so
 * a drift between `_rolling_calendar_stats` and `rollingCalendarStats` fails one of the
 * two suites.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ROLL_WINDOW_1Y_DAYS, rollingCalendarStats } from "./rolling";

interface Vector {
  name: string;
  periods_per_year: number;
  derivation: string;
  dates: string[];
  returns: number[];
  expected: {
    vol: Array<number | null>;
    sharpe: Array<number | null>;
    sortino: Array<number | null>;
  };
}

const FIXTURE = resolve(process.cwd(), "analytics-service/tests/fixtures/rolling_1y_vectors.json");
const vectors = (JSON.parse(readFileSync(FIXTURE, "utf8")) as { vectors: Vector[] }).vectors;

describe("rollingCalendarStats against the shared fixture (D-14)", () => {
  it("has the seven closed-form vectors", () => {
    expect(vectors.map((v) => v.name)).toEqual([
      "daily-alternating-400",
      "daily-constant-400",
      "daily-300",
      "daily-365",
      "daily-364",
      "daily-gap",
      "weekday-alternating",
    ]);
    for (const v of vectors) expect(v.derivation.length).toBeGreaterThan(0);
  });

  for (const v of vectors) {
    it(`equals the closed form within 1e-12 and is null exactly where there is no point: ${v.name}`, () => {
      const got = rollingCalendarStats(v.returns, v.dates, ROLL_WINDOW_1Y_DAYS, v.periods_per_year);
      for (const key of ["vol", "sharpe", "sortino"] as const) {
        expect(got[key]).toHaveLength(v.returns.length);
        v.expected[key].forEach((want, i) => {
          const have = got[key][i];
          if (want === null) {
            expect(have, `${v.name} ${key}[${i}]`).toBeNull();
          } else {
            expect(have, `${v.name} ${key}[${i}]`).not.toBeNull();
            expect(have as number).toBeCloseTo(want, 12);
          }
        });
      }
    });
  }
});

describe("the D-21 boundary: 365 daily returns fill the 365-day window", () => {
  const nonNull = (xs: Array<number | null>) => xs.flatMap((x, i) => (x === null ? [] : [i]));
  for (const [name, points] of [["daily-365", [364]], ["daily-364", []]] as const) {
    it(`${name} draws exactly the points ${JSON.stringify(points)}`, () => {
      const v = vectors.find((x) => x.name === name)!;
      const got = rollingCalendarStats(v.returns, v.dates, ROLL_WINDOW_1Y_DAYS, v.periods_per_year);
      expect(nonNull(got.vol)).toEqual(points);
      expect(nonNull(got.sharpe)).toEqual(points);
      expect(nonNull(got.sortino)).toEqual(points);
    });
  }
});

describe("the 365-day window constant pair", () => {
  it("is one year of calendar days in TS and in the producer, once", () => {
    expect(ROLL_WINDOW_1Y_DAYS).toBe(365);
    const py = readFileSync(
      resolve(process.cwd(), "analytics-service/services/metrics.py"),
      "utf8",
    );
    const hits = py.match(/^ROLLING_1Y_WINDOW_DAYS = ONE_YEAR_DAYS$/gm) ?? [];
    expect(hits).toHaveLength(1);
  });
});
