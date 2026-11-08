/**
 * Phase 194 plan 03 (D-09): a missing figure is never a zero. These cases fail if a
 * missing value is turned into 0 anywhere: the range containing 0 and the descending
 * sort are exactly where a `?? 0` substitution hides.
 */
import { describe, expect, it } from "vitest";
import { compareWithMissingLast, isMissingFigure, rangeMatches } from "./list-figures";

type Row = { id: string; v: number | null };
const sortRows = (rows: Row[], dir: "asc" | "desc") =>
  // Array.prototype.sort is stable, so ties keep input order: that is the "existing secondary order".
  [...rows].sort((x, y) => compareWithMissingLast(x.v, y.v, dir)).map((r) => r.id);

const rows: Row[] = [
  { id: "a", v: 3 },
  { id: "b", v: null },
  { id: "c", v: 1 },
  { id: "d", v: NaN },
  { id: "e", v: 2 },
];

describe("isMissingFigure", () => {
  it("is true for null, undefined, NaN and the infinities, false for 0 and finite numbers", () => {
    for (const m of [null, undefined, NaN, Infinity, -Infinity]) expect(isMissingFigure(m)).toBe(true);
    for (const f of [0, -0.5, 1.2e13]) expect(isMissingFigure(f)).toBe(false);
  });

  it("D-05: a 13-digit finite value is not missing", () => {
    expect(isMissingFigure(1.2e13)).toBe(false);
  });
});

describe("compareWithMissingLast", () => {
  it("ascending: finite ascending, then the two missing rows in input order", () => {
    expect(sortRows(rows, "asc")).toEqual(["c", "e", "a", "b", "d"]);
  });

  it("descending: finite descending, then the two missing rows in input order (missing is NOT first)", () => {
    expect(sortRows(rows, "desc")).toEqual(["a", "e", "c", "b", "d"]);
  });

  it("a missing value does not sort as zero: a negative finite value still comes before it", () => {
    const neg: Row[] = [{ id: "m", v: null }, { id: "n", v: -5 }, { id: "p", v: 5 }];
    expect(sortRows(neg, "asc")).toEqual(["n", "p", "m"]);
    expect(sortRows(neg, "desc")).toEqual(["p", "n", "m"]);
  });

  it("compares strings as strings and sends a missing string last", () => {
    expect(compareWithMissingLast("2025-01-01", "2026-01-01", "asc")).toBeLessThan(0);
    expect(compareWithMissingLast("2025-01-01", "2026-01-01", "desc")).toBeGreaterThan(0);
    expect(compareWithMissingLast(null, "2026-01-01", "desc")).toBeGreaterThan(0);
  });

  it("D-05: a 13-digit value sorts like any other finite value", () => {
    expect(compareWithMissingLast(1.2e13, 5, "asc")).toBeGreaterThan(0);
    expect(compareWithMissingLast(1.2e13, null, "asc")).toBeLessThan(0);
  });
});

describe("rangeMatches", () => {
  it("a missing value never matches an active bound, including a range that contains 0", () => {
    expect(rangeMatches(null, { from: "-5", to: "5" }, 100)).toBe(false);
    expect(rangeMatches(undefined, { from: "-5", to: "" })).toBe(false);
    expect(rangeMatches(NaN, { from: "", to: "5" })).toBe(false);
  });

  it("0 is a real value and matches a range that contains it", () => {
    expect(rangeMatches(0, { from: "-5", to: "5" }, 100)).toBe(true);
  });

  it("an inactive filter matches every row, missing or not", () => {
    expect(rangeMatches(null, { from: "", to: "" })).toBe(true);
    expect(rangeMatches(0.4, { from: "", to: "" })).toBe(true);
  });

  it("applies the scale and both bounds to a finite value", () => {
    expect(rangeMatches(0.04, { from: "3", to: "5" }, 100)).toBe(true);
    expect(rangeMatches(0.06, { from: "3", to: "5" }, 100)).toBe(false);
    expect(rangeMatches(0.02, { from: "3", to: "" }, 100)).toBe(false);
  });

  it("non-numeric bound text never makes a missing value match", () => {
    expect(rangeMatches(null, { from: "abc", to: "" })).toBe(false);
    expect(rangeMatches(null, { from: "", to: "x" })).toBe(false);
  });

  it("D-05: a 13-digit finite value is judged by the bounds like any other", () => {
    expect(rangeMatches(1.2e13, { from: "0", to: "" })).toBe(true);
    expect(rangeMatches(1.2e13, { from: "", to: "100" })).toBe(false);
  });
});
