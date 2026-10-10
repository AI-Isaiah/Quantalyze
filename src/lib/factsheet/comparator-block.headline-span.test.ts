import { describe, it, expect } from "vitest";
import { buildComparatorBlock } from "./comparator-block";
import { compute, cumEq } from "./compute";

/**
 * Phase 164.6.6.3.3 FACTSHEETTRUTH plan 10 (B19, UI-SPEC 1.5). On a Dated row the
 * strategy's headline figures cover the suffix from `{D}` while `summary` (the
 * comparator's figures) covers the whole record, so a rail row would set a 12-day
 * strategy figure beside a whole-record comparator figure. The block therefore
 * carries `summarySince`: the same summary over the covered comparator returns
 * dated on or after `{D}`.
 *
 * The ORACLE here is independent of the builder: the test slices the covered
 * comparator returns itself and calls `compute()` on the slice. A builder that
 * reused `summary`, sliced the wrong side of `{D}`, or sliced the strategy leg
 * instead of the comparator would disagree with it.
 */

const DAY = 86_400_000;
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

const N = 140;
const PPY = 365;
const dates = Array.from({ length: N }, (_, i) => addDays("2025-01-01", i));
/** Wild before day 100, calm after: the whole-record summary and the suffix summary cannot agree. */
const bench: Array<number | null> = dates.map((_, i) =>
  i % 6 === 5 ? null : i < 100 ? ((i % 9) - 4) / 40 : ((i % 4) - 1.5) / 800,
);
const strat = dates.map((_, i) => ((i % 5) - 2) / 400);
const START = dates[100];

const FIELDS = [
  "cum_ret", "cagr", "ann_vol", "sharpe", "sortino", "calmar", "max_dd", "mtd", "ytd", "p3m", "p6m", "p1y",
] as const;
const WINDOWS = ["mtd", "ytd", "p3m", "p6m", "p1y"] as const;

function block(b: ReadonlyArray<number | null>, spanStart?: string | null) {
  return buildComparatorBlock(
    "BTC-USD", "BTC", b, strat, cumEq(strat), dates, 0.2, 30, 60, PPY, PPY, spanStart,
  );
}

/** The independent oracle: compute() over the covered comparator returns dated on or after `from`. */
function oracle(b: ReadonlyArray<number | null>, from: string) {
  const r: number[] = [];
  const d: string[] = [];
  for (let i = 0; i < b.length; i++) {
    const v = b[i];
    if (v != null && dates[i] >= from) {
      r.push(v);
      d.push(dates[i]);
    }
  }
  return compute(r, d, 0, PPY);
}

describe("summarySince: the comparator summary over the span from {D} (B19)", () => {
  it("equals compute() over the covered comparator returns dated on or after the start, field by field", () => {
    const got = block(bench, START).summarySince;
    expect(got).toBeTruthy();
    const want = oracle(bench, START);
    for (const k of FIELDS) {
      const g = got![k];
      const w = want[k];
      if (w == null || Number.isNaN(w)) expect(g == null || Number.isNaN(g), `${k} got ${g}`).toBe(true);
      else expect(g, k).toBe(w);
    }
  });

  it("differs from the whole-record summary on a comparator that moved before the start", () => {
    const b = block(bench, START);
    expect(b.summary).toBeTruthy();
    expect(b.summarySince).toBeTruthy();
    expect(b.summarySince!.cum_ret).not.toBe(b.summary!.cum_ret);
    expect(b.summarySince!.ann_vol).not.toBe(b.summary!.ann_vol);
    expect(b.summarySince!.max_dd).not.toBe(b.summary!.max_dd);
    // ...and the whole-record summary itself is what it was without a span start.
    expect(b.summary).toEqual(block(bench).summary);
  });

  it("a block built without a span start has no summarySince key at all (a clean row is unchanged)", () => {
    expect("summarySince" in block(bench)).toBe(false);
    expect("summarySince" in block(bench, null)).toBe(false);
    expect("summarySince" in block(bench, undefined)).toBe(false);
  });

  it("a start at or before the first date reproduces the whole-record summary", () => {
    const b = block(bench, dates[0]);
    expect(b.summarySince).toEqual(b.summary);
  });

  it("past the comparator's coverage the window fields are null exactly as they are on summary", () => {
    // The last entry is null: the comparator stops before the strategy's last date.
    const stopped = bench.map((v, i) => (i >= N - 3 ? null : v));
    const b = block(stopped, START);
    expect(b.summary).toBeTruthy();
    for (const k of WINDOWS) expect(b.summary![k], `summary.${k}`).toBeNull();
    for (const k of WINDOWS) expect(b.summarySince![k], `summarySince.${k}`).toBeNull();
    // The non-window fields are still the oracle's.
    expect(b.summarySince!.cum_ret).toBe(oracle(stopped, START).cum_ret);
  });

  it("a comparator with no covered return on or after the start has a null summarySince (the key is present)", () => {
    const early = bench.map((v, i) => (i >= 100 ? null : v));
    const b = block(early, START);
    expect("summarySince" in b).toBe(true);
    expect(b.summarySince).toBeNull();
    expect(b.summary).toBeTruthy();
  });

  it("a start past the last date covers nothing", () => {
    const b = block(bench, addDays(dates[N - 1], 5));
    expect(b.summarySince).toBeNull();
  });
});
