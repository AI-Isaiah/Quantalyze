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

function casesNamed(prefix: string): OracleCase[] {
  return ORACLE.cases.filter((c) => c.name.startsWith(prefix));
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
