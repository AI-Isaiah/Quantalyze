/**
 * Phase 169.1 (D-31, plan 169.1-05): the Monthly Returns heatmap and Calmar by
 * Year follow the strategy's compounding method.
 *
 * Why this matters: under the engine's `simple` method (`compute_all_metrics`
 * in analytics-service/services/metrics.py) a month's return is the SUM of its
 * daily returns, and so is a year's. The heatmap and Calmar by Year compounded
 * them, so on one arithmetic composite page the twelve month cells did not add
 * up to the year's own figure, and the heatmap's YTD column, Calmar by Year and
 * the EOY panel (`strategyMetrics.yearly`) showed three different numbers for
 * the same year.
 *
 * What does NOT change: without the method both functions compound exactly as
 * before (the geometric cases below and the existing period-buckets tests, which
 * are not edited), and the null-month, non-finite-skip and zero-drawdown
 * conventions hold under both methods.
 */
import { describe, it, expect } from "vitest";
import { monthlyReturnsMatrix } from "./period-buckets";
import { calmarByYear } from "./calmar-by-year";
import { arithmeticUnderwater } from "./compute";
import { buildFactsheetPayload } from "./build-payload";

const DAY = 86_400_000;

/** `n` consecutive calendar days from `startIso`, with a deterministic return path. */
function series(startIso: string, n: number): { dates: string[]; rets: number[] } {
  const start = Date.parse(`${startIso}T00:00:00Z`);
  const dates = Array.from({ length: n }, (_, i) => new Date(start + i * DAY).toISOString().slice(0, 10));
  const rets = dates.map((_, i) => Math.sin(i / 6) * 0.015 + 0.002);
  return { dates, rets };
}

const sum = (xs: number[]) => xs.reduce((a, x) => a + x, 0);
const prod = (xs: number[]) => xs.reduce((a, x) => a * (1 + x), 1) - 1;

/** The returns of each `YYYY` or `YYYY-MM` key, in date order. */
function groupBy(dates: string[], rets: number[], len: 4 | 7): Map<string, number[]> {
  const out = new Map<string, number[]>();
  dates.forEach((d, i) => {
    const k = d.slice(0, len);
    out.set(k, [...(out.get(k) ?? []), rets[i]]);
  });
  return out;
}

// Two full calendar years plus part of a third (Jan 2024 .. Mar 2026).
const { dates: DATES, rets: RETS } = series("2024-01-01", 821);

describe("monthlyReturnsMatrix follows the compounding method (D-31)", () => {
  it("arithmetic: each cell is its month's sum and each row's ytd its year's sum", () => {
    const rows = monthlyReturnsMatrix(RETS, DATES, "arithmetic");
    const months = groupBy(DATES, RETS, 7);
    const years = groupBy(DATES, RETS, 4);
    expect(rows.map((r) => r.year)).toEqual([...years.keys()]);
    for (const row of rows) {
      row.byMonth.forEach((cell, m) => {
        const xs = months.get(`${row.year}-${String(m + 1).padStart(2, "0")}`);
        if (!xs) expect(cell, `${row.year}-${m + 1}`).toBeNull();
        else {
          expect(cell, `${row.year}-${m + 1}`).toBeCloseTo(sum(xs), 14);
          // The fixture discriminates: a compounded cell would be another number.
          expect(Math.abs(sum(xs) - prod(xs))).toBeGreaterThan(1e-6);
        }
      });
      expect(row.ytd, row.year).toBeCloseTo(sum(years.get(row.year)!), 14);
    }
  });

  it("arithmetic: the twelve cells of a full year add up to its ytd", () => {
    for (const row of monthlyReturnsMatrix(RETS, DATES, "arithmetic").filter((r) => r.year !== "2026")) {
      expect(row.byMonth.every((c) => c != null), row.year).toBe(true);
      expect(sum(row.byMonth as number[]), row.year).toBeCloseTo(row.ytd, 12);
    }
  });

  it("arithmetic keeps the conventions: a month with no observation is null and a non-finite return is skipped", () => {
    const dates = ["2025-01-02", "2025-01-03", "2025-03-04", "2025-03-05"];
    const rets = [0.01, Number.NaN, 0.02, -0.005];
    const [row] = monthlyReturnsMatrix(rets, dates, "arithmetic");
    expect(row.byMonth[0]).toBe(0.01);
    expect(row.byMonth[1]).toBeNull();
    expect(row.byMonth[2]).toBeCloseTo(0.015, 15);
    expect(row.ytd).toBeCloseTo(0.025, 15);
  });

  it("geometric (no third argument): each cell and ytd stay compounded", () => {
    const rows = monthlyReturnsMatrix(RETS, DATES);
    const months = groupBy(DATES, RETS, 7);
    for (const row of rows) {
      row.byMonth.forEach((cell, m) => {
        const xs = months.get(`${row.year}-${String(m + 1).padStart(2, "0")}`);
        if (xs) expect(cell).toBeCloseTo(prod(xs), 14);
      });
      expect(row.ytd).toBeCloseTo(prod(groupBy(DATES, RETS, 4).get(row.year)!), 14);
    }
    expect(monthlyReturnsMatrix(RETS, DATES, "geometric")).toEqual(rows);
  });
});

describe("calmarByYear follows the compounding method (D-31)", () => {
  it("arithmetic: ret is the year's sum, max_dd the minimum of the year's arithmetic underwater, calmar their ratio", () => {
    const years = groupBy(DATES, RETS, 4);
    const rows = calmarByYear(RETS, DATES, "arithmetic");
    expect(rows.map((r) => r.year)).toEqual([...years.keys()]);
    for (const row of rows) {
      const xs = years.get(row.year)!;
      const dd = Math.min(...arithmeticUnderwater(xs));
      expect(row.ret, row.year).toBeCloseTo(sum(xs), 14);
      expect(row.max_dd, row.year).toBe(dd);
      expect(row.calmar, row.year).toBeCloseTo(sum(xs) / Math.abs(dd), 12);
      expect(row.days, row.year).toBe(xs.length);
      expect(Math.abs(sum(xs) - prod(xs)), row.year).toBeGreaterThan(1e-6);
    }
  });

  it("arithmetic keeps the zero-drawdown convention: a year that never dips has no Calmar (NaN)", () => {
    const [row] = calmarByYear([0.01, 0.02, 0], ["2025-01-02", "2025-01-03", "2025-01-04"], "arithmetic");
    expect(row.max_dd).toBe(0);
    expect(row.calmar).toBeNaN();
    expect(row.ret).toBeCloseTo(0.03, 15);
  });

  it("geometric (no third argument): ret stays compounded", () => {
    const years = groupBy(DATES, RETS, 4);
    const rows = calmarByYear(RETS, DATES);
    for (const row of rows) expect(row.ret).toBeCloseTo(prod(years.get(row.year)!), 14);
    expect(calmarByYear(RETS, DATES, "geometric")).toEqual(rows);
  });
});

describe("on one arithmetic payload the heatmap, Calmar by Year and the EOY figure agree (D-31)", () => {
  const dailies = DATES.map((date, i) => ({ date, value: RETS[i] }));
  const strategy = {
    id: "period-buckets-arithmetic",
    name: "Period Buckets Arithmetic",
    types: ["test"],
    markets: ["crypto"],
    computedAt: "2026-09-29T00:00:00Z",
    trustTier: null,
    ingestSource: "csv" as const,
  };

  it("arithmetic: for every year, heatmap ytd === Calmar-by-year ret === strategyMetrics.yearly[year], each the year's sum", () => {
    const p = buildFactsheetPayload(strategy, dailies, { cumulativeMethod: "arithmetic" })!;
    const years = groupBy(DATES, RETS, 4);
    expect(p.monthlyReturns.map((r) => r.year)).toEqual([...years.keys()]);
    for (const row of p.monthlyReturns) {
      const cal = p.calmarByYear.find((c) => c.year === row.year)!;
      expect(cal.ret, row.year).toBe(row.ytd);
      expect(p.strategyMetrics.yearly[row.year], row.year).toBe(row.ytd);
      expect(row.ytd, row.year).toBeCloseTo(sum(years.get(row.year)!), 14);
    }
  });

  it("geometric (no method): the same three agree on the compounded year", () => {
    const p = buildFactsheetPayload(strategy, dailies)!;
    for (const row of p.monthlyReturns) {
      const cal = p.calmarByYear.find((c) => c.year === row.year)!;
      expect(cal.ret, row.year).toBeCloseTo(row.ytd, 14);
      expect(p.strategyMetrics.yearly[row.year], row.year).toBeCloseTo(row.ytd, 14);
      expect(row.ytd, row.year).toBeCloseTo(prod(groupBy(DATES, RETS, 4).get(row.year)!), 14);
    }
  });
});
