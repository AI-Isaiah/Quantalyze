import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import type { DailyPoint } from "@/lib/portfolio-math-utils";

import { convertNativeReturnsToUsd } from "./native-to-usd";

/**
 * Phase 164.6.6.2 (D-18, D-22, D-23): the BTC-native -> USD return conversion.
 *
 * WHY these tests exist: a BTC-denominated account blended with USD strategies
 * must enter the blend as USD returns, `(1 + r) * (1 + btc) - 1`. Blending the
 * raw BTC return (the defect this function removes) understates a 10% BTC
 * move on a 10% BTC account as 10% instead of 21%, and no other number on the
 * screen would say so. The cases live in ONE fixture, read here and by the
 * Python twin (plan 13), and every expected value in it is a hand-computed
 * literal, so neither runtime can pass by agreeing with its own arithmetic.
 */

interface OracleCase {
  name: string;
  unit: string | null;
  closes: Record<string, number> | null;
  dropped: string[];
  series: Array<{ date: string; value: number | null }>;
  expected: Array<{ date: string; value: number }>;
  arithmetic: string;
}

interface Oracle {
  closes_source: string;
  tolerance: number;
  cases: OracleCase[];
}

// Same precedent as the venue-transient contract fixture: the file lives under
// analytics-service/tests/fixtures so both runtimes read the one copy.
const ORACLE: Oracle = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "analytics-service/tests/fixtures/native_to_usd_oracle.json"),
    "utf8",
  ),
);

function toSeries(raw: OracleCase["series"]): DailyPoint[] {
  // JSON has no NaN: a null value in the fixture stands for a non-finite number.
  return raw.map((p) => ({ date: p.date, value: p.value === null ? Number.NaN : p.value }));
}

function toBtc(c: OracleCase) {
  if (c.closes === null) return null;
  const prices = Object.entries(c.closes)
    .map(([date, close]) => ({ date, close }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return { prices, dropped: c.dropped };
}

describe("convertNativeReturnsToUsd: the hand-computed oracle (D-18)", () => {
  it("the fixture is a real oracle: tolerance is tight and every case states its arithmetic", () => {
    expect(ORACLE.tolerance).toBeLessThanOrEqual(1e-12);
    expect(ORACLE.cases.length).toBeGreaterThan(0);
    for (const c of ORACLE.cases) expect(c.arithmetic.length).toBeGreaterThan(10);
  });

  it.each(ORACLE.cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const out = convertNativeReturnsToUsd(toSeries(c.series), c.unit, toBtc(c));
    expect(out.map((p) => p.date)).toEqual(c.expected.map((p) => p.date));
    c.expected.forEach((e, i) => {
      expect(Math.abs(out[i].value - e.value)).toBeLessThanOrEqual(ORACLE.tolerance);
    });
  });

  it("the founder's headline: a 10% BTC account on a 10% BTC day is +21% in USD, not +10%", () => {
    // 0.21 is a literal on purpose: 1.1 x 66000 / (1.0 x 60000) - 1.
    const out = convertNativeReturnsToUsd(
      [
        { date: "2026-02-02", value: 0.05 },
        { date: "2026-02-03", value: 0.1 },
      ],
      "BTC",
      {
        prices: [
          { date: "2026-02-02", close: 60000 },
          { date: "2026-02-03", close: 66000 },
        ],
        dropped: [],
      },
    );
    expect(out).toHaveLength(1);
    expect(out[0].value).toBeCloseTo(0.21, 12);
    // The raw BTC return is a different number; a variant that blends it must not pass.
    expect(Math.abs(out[0].value - 0.1)).toBeGreaterThan(0.05);
  });
});

describe("convertNativeReturnsToUsd: honesty, an unpriced day is absent and never invented", () => {
  it("the fixture carries the honesty cases this suite relies on", () => {
    const names = ORACLE.cases.map((c) => c.name);
    for (const required of [
      "missing_close_gap_drops_both_adjacent_days",
      "dropped_close_is_never_bridged",
      "days_after_last_close_are_absent",
      "null_unit_returns_series_unchanged",
      "unit_without_closes_returns_empty",
      "empty_series_returns_empty",
      "one_point_series_returns_empty",
      "non_finite_input_day_is_absent",
      "weekend_gap_with_missing_sunday_close_is_absent",
    ]) {
      expect(names, `fixture lacks ${required}`).toContain(required);
    }
  });

  it("no output value is 0 unless the arithmetic gives 0 (a gap is never filled with 0)", () => {
    for (const c of ORACLE.cases) {
      const out = convertNativeReturnsToUsd(toSeries(c.series), c.unit, toBtc(c));
      const expectedZero = new Set(c.expected.filter((e) => e.value === 0).map((e) => e.date));
      for (const p of out) {
        if (p.value === 0) expect(expectedZero.has(p.date), `${c.name}: ${p.date} is a fabricated 0`).toBe(true);
      }
    }
  });

  it("an Infinity input day is absent, like NaN", () => {
    const out = convertNativeReturnsToUsd(
      [
        { date: "2026-02-02", value: 0 },
        { date: "2026-02-03", value: Number.POSITIVE_INFINITY },
        { date: "2026-02-04", value: 0.1 },
      ],
      "BTC",
      {
        prices: [
          { date: "2026-02-02", close: 100 },
          { date: "2026-02-03", close: 110 },
          { date: "2026-02-04", close: 121 },
        ],
        dropped: [],
      },
    );
    expect(out.map((p) => p.date)).toEqual(["2026-02-04"]);
  });
});

describe("convertNativeReturnsToUsd: a USD row is untouched, no source means nothing", () => {
  const series: DailyPoint[] = [
    { date: "2026-02-02", value: 0.01 },
    { date: "2026-02-03", value: -0.02 },
  ];
  const btc = {
    prices: [
      { date: "2026-02-02", close: 100 },
      { date: "2026-02-03", close: 120 },
    ],
    dropped: [],
  };

  it("unit = null returns the SAME array reference, whatever btc holds", () => {
    expect(convertNativeReturnsToUsd(series, null, btc)).toBe(series);
    expect(convertNativeReturnsToUsd(series, null, null)).toBe(series);
  });

  it("a native unit with no price source returns [] (no price is invented)", () => {
    expect(convertNativeReturnsToUsd(series, "BTC", null)).toEqual([]);
  });

  it("does not mutate its input", () => {
    const frozen = Object.freeze(series.map((p) => Object.freeze({ ...p })));
    expect(() => convertNativeReturnsToUsd(frozen, "BTC", btc)).not.toThrow();
  });
});
