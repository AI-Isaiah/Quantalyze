/**
 * Phase 169.1 (D-31, plan 169.1-05): compute()'s calendar windows and buckets
 * follow the conventions argument's `cumulativeMethod`.
 *
 * Why this matters: the engine (`compute_all_metrics`, `simple` arm) SUMS every
 * one of these: `_bucket_return` is `s.sum()` for MTD, YTD, 3M and 6M, and its
 * monthly grid, from which the best and worst month come, is summed per month.
 * compute() compounded them, so an arithmetic composite's rail rows, Best /
 * Worst Period table and EOY figures disagreed with the engine and with the
 * page's own summed headline.
 *
 * What does NOT change:
 *   - D-11's cutoffs and coverage rule: the SAME windows are null under both
 *     methods, for a record shorter than 3 months, one of about 2 years and one
 *     longer than 5 years;
 *   - with no conventions every field is the compounded figure (the frozen
 *     default-output snapshots in compute.conventions.test.ts pin it too).
 *
 * Every expected value is computed here from the returns, independently of
 * compute(): a sum or a product of the returns dated after each D-11 cutoff,
 * and per-bucket sums or products grouped by calendar week (Monday start),
 * month, quarter and year.
 */
import { describe, it, expect } from "vitest";
import { compute } from "./compute";

const DAY = 86_400_000;
const P = 365;
const END = "2026-06-15";

/** `n` consecutive calendar days ending on END, with a deterministic return path. */
function series(n: number): { dates: string[]; rets: number[] } {
  const end = Date.parse(`${END}T00:00:00Z`);
  const dates = Array.from({ length: n }, (_, i) => new Date(end - (n - 1 - i) * DAY).toISOString().slice(0, 10));
  return { dates, rets: dates.map((_, i) => Math.sin(i / 9) * 0.012 + Math.cos(i / 31) * 0.004 + 0.001) };
}

const sum = (xs: number[]) => xs.reduce((a, x) => a + x, 0);
const prod = (xs: number[]) => xs.reduce((a, x) => a * (1 + x), 1) - 1;

const WINDOWS = ["mtd", "ytd", "p3m", "p6m", "p1y", "p3y", "p5y"] as const;
type WindowKey = (typeof WINDOWS)[number];

/** D-11's cutoff for each window of a record ending END. */
function cutoff(k: WindowKey): Date {
  const last = new Date(`${END}T00:00:00Z`);
  const back = (days: number) => new Date(last.getTime() - days * DAY);
  switch (k) {
    case "mtd": return new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), 0));
    case "ytd": return new Date(Date.UTC(last.getUTCFullYear() - 1, 11, 31));
    case "p3m": return back(90);
    case "p6m": return back(182);
    case "p1y": return back(365);
    case "p3y": return back(3 * 365);
    case "p5y": return back(5 * 365);
  }
}

/** The window's expected value: null when the record does not cover it (D-11, 7-day venue). */
function expectedWindow(dates: string[], rets: number[], k: WindowKey, agg: (xs: number[]) => number): number | null {
  const c = cutoff(k);
  if (new Date(dates[0]).getTime() > c.getTime() + DAY) return null;
  return agg(rets.filter((_, i) => new Date(dates[i]) > c));
}

/** The Monday of `iso`'s week: the same grouping as an ISO 8601 week key. */
function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

const BUCKETS = {
  week: mondayOf,
  month: (d: string) => d.slice(0, 7),
  quarter: (d: string) => `${d.slice(0, 4)}-Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`,
  year: (d: string) => d.slice(0, 4),
} as const;

function bucketValues(dates: string[], rets: number[], key: (d: string) => string, agg: (xs: number[]) => number): Map<string, number> {
  const by = new Map<string, number[]>();
  dates.forEach((d, i) => by.set(key(d), [...(by.get(key(d)) ?? []), rets[i]]));
  return new Map([...by].map(([k, xs]) => [k, agg(xs)]));
}

const LENGTHS = { "shorter than 3 months": 60, "about 2 years": 730, "longer than 5 years": 2000 } as const;

describe("compute()'s windows follow the compounding method (D-31)", () => {
  for (const [label, n] of Object.entries(LENGTHS)) {
    const { dates, rets } = series(n);

    it(`${label}: under arithmetic each window is the SUM after its cutoff, null exactly where D-11 says`, () => {
      const r = compute(rets, dates, 0, P, { cumulativeMethod: "arithmetic" });
      for (const k of WINDOWS) {
        const want = expectedWindow(dates, rets, k, sum);
        if (want == null) expect(r[k], k).toBeNull();
        else {
          expect(r[k], k).toBeCloseTo(want, 12);
          // The fixture discriminates: the compounded window is another number.
          expect(Math.abs(want - expectedWindow(dates, rets, k, prod)!), k).toBeGreaterThan(1e-7);
        }
      }
    });

    it(`${label}: the null pattern is identical under both methods`, () => {
      const geo = compute(rets, dates, 0, P);
      const ari = compute(rets, dates, 0, P, { cumulativeMethod: "arithmetic" });
      expect(WINDOWS.map((k) => ari[k] === null)).toEqual(WINDOWS.map((k) => geo[k] === null));
    });

    it(`${label}: with no conventions each window stays compounded`, () => {
      const r = compute(rets, dates, 0, P);
      for (const k of WINDOWS) {
        const want = expectedWindow(dates, rets, k, prod);
        if (want == null) expect(r[k], k).toBeNull();
        else expect(r[k], k).toBeCloseTo(want, 12);
      }
    });
  }

  it("the three lengths exercise both arms of D-11: some windows null, some shown", () => {
    const nulls = Object.values(LENGTHS).map((n) => {
      const { dates, rets } = series(n);
      const r = compute(rets, dates, 0, P, { cumulativeMethod: "arithmetic" });
      return WINDOWS.filter((k) => r[k] === null);
    });
    expect(nulls).toEqual([["ytd", "p3m", "p6m", "p1y", "p3y", "p5y"], ["p3y", "p5y"], []]);
  });
});

describe("compute()'s buckets follow the compounding method (D-31)", () => {
  const { dates, rets } = series(2000);

  it("under arithmetic best / worst week, month, quarter and year are the extremes of the per-bucket SUMS", () => {
    const r = compute(rets, dates, 0, P, { cumulativeMethod: "arithmetic" });
    for (const [scale, key] of Object.entries(BUCKETS)) {
      const sums = [...bucketValues(dates, rets, key, sum).values()];
      const prods = [...bucketValues(dates, rets, key, prod).values()];
      const best = r[`best_${scale}` as "best_week"];
      const worst = r[`worst_${scale}` as "worst_week"];
      expect(best, `best_${scale}`).toBeCloseTo(Math.max(...sums), 12);
      expect(worst, `worst_${scale}`).toBeCloseTo(Math.min(...sums), 12);
      expect(Math.abs(Math.max(...sums) - Math.max(...prods)), scale).toBeGreaterThan(1e-7);
    }
  });

  it("under arithmetic `yearly` maps each year to its SUM", () => {
    const r = compute(rets, dates, 0, P, { cumulativeMethod: "arithmetic" });
    const want = bucketValues(dates, rets, BUCKETS.year, sum);
    expect(Object.keys(r.yearly)).toEqual([...want.keys()]);
    for (const [y, v] of want) expect(r.yearly[y], y).toBeCloseTo(v, 12);
  });

  it("with no conventions every bucket and `yearly` stay compounded", () => {
    const r = compute(rets, dates, 0, P);
    for (const [scale, key] of Object.entries(BUCKETS)) {
      const prods = [...bucketValues(dates, rets, key, prod).values()];
      expect(r[`best_${scale}` as "best_week"], `best_${scale}`).toBeCloseTo(Math.max(...prods), 12);
      expect(r[`worst_${scale}` as "worst_week"], `worst_${scale}`).toBeCloseTo(Math.min(...prods), 12);
    }
    for (const [y, v] of bucketValues(dates, rets, BUCKETS.year, prod)) expect(r.yearly[y], y).toBeCloseTo(v, 12);
  });

  it("with no conventions the window and bucket fields deep-equal an explicit geometric call", () => {
    const pick = (x: ReturnType<typeof compute>) => ({
      ...Object.fromEntries(WINDOWS.map((k) => [k, x[k]])),
      best_week: x.best_week, worst_week: x.worst_week, best_month: x.best_month, worst_month: x.worst_month,
      best_quarter: x.best_quarter, worst_quarter: x.worst_quarter, best_year: x.best_year, worst_year: x.worst_year,
      yearly: x.yearly,
    });
    expect(pick(compute(rets, dates, 0, P))).toEqual(pick(compute(rets, dates, 0, P, { cumulativeMethod: "geometric" })));
  });
});
