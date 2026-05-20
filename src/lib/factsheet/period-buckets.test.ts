import { describe, it, expect } from "vitest";
import { monthlyReturnsMatrix, dailyReturnsByYear } from "./period-buckets";

describe("monthlyReturnsMatrix", () => {
  it("returns one row per calendar year present, sorted ascending", () => {
    const out = monthlyReturnsMatrix(
      [0.01, 0.02, 0.03],
      ["2023-01-15", "2024-06-20", "2024-12-31"],
    );
    expect(out.map(r => r.year)).toEqual(["2023", "2024"]);
  });

  it("compounds returns within each month bucket", () => {
    const out = monthlyReturnsMatrix(
      [0.1, 0.2],
      ["2024-03-01", "2024-03-31"],
    );
    // (1+0.1)(1+0.2) - 1 = 0.32
    expect(out[0].byMonth[2]).toBeCloseTo(0.32, 10);
  });

  it("leaves months with no observations as null", () => {
    const out = monthlyReturnsMatrix([0.05], ["2024-07-04"]);
    expect(out[0].byMonth[6]).toBeCloseTo(0.05, 10);
    expect(out[0].byMonth[0]).toBeNull();
    expect(out[0].byMonth[11]).toBeNull();
  });

  it("ytd compounds every observation in the year", () => {
    const out = monthlyReturnsMatrix(
      [0.1, -0.05, 0.02],
      ["2024-01-15", "2024-06-15", "2024-09-15"],
    );
    // (1.1)(0.95)(1.02) - 1
    const expected = 1.1 * 0.95 * 1.02 - 1;
    expect(out[0].ytd).toBeCloseTo(expected, 10);
  });

  it("handles empty input", () => {
    expect(monthlyReturnsMatrix([], [])).toEqual([]);
  });
});

describe("dailyReturnsByYear", () => {
  it("returns one entry per year, sorted ascending", () => {
    const out = dailyReturnsByYear(
      [0.01, 0.02],
      ["2023-01-02", "2024-01-02"],
    );
    expect(out.map(y => y.year)).toEqual(["2023", "2024"]);
  });

  it("places each return in the cell matching its week-of-year and weekday", () => {
    // 2024-01-01 is a Monday (weekday=0), firstWeekOffset=0
    // 2024-01-01 → doy=1, weekIdx = floor((1 - 1 + 0) / 7) = 0, weekday=0
    const out = dailyReturnsByYear([0.05], ["2024-01-01"]);
    expect(out[0].firstWeekOffset).toBe(0);
    expect(out[0].cells[0][0]).toBeCloseTo(0.05, 10);
  });

  it("aligns Jan 1 on a Sunday into the correct cell", () => {
    // 2023-01-01 is a Sunday (weekday=6), firstWeekOffset=6
    // 2023-01-01 → doy=1, weekIdx = floor((1 - 1 + 6) / 7) = 0, weekday=6
    const out = dailyReturnsByYear([0.05], ["2023-01-01"]);
    expect(out[0].firstWeekOffset).toBe(6);
    expect(out[0].cells[0][6]).toBeCloseTo(0.05, 10);
  });

  it("ignores non-finite returns", () => {
    const out = dailyReturnsByYear([NaN, 0.01], ["2024-01-01", "2024-01-02"]);
    const flat = out[0].cells.flat().filter((v): v is number => v != null);
    expect(flat.length).toBe(1);
    expect(flat[0]).toBeCloseTo(0.01, 10);
  });

  it("handles empty input", () => {
    expect(dailyReturnsByYear([], [])).toEqual([]);
  });

  it("does not drop Dec 31 in leap years that start on Sunday", () => {
    // 2012-01-01 was a Sunday and 2012 was a leap year (366 days). With
    // firstWeekOffset=6 + doy=366 the weekIdx hits 53 — a 53-col grid would
    // silently drop Dec 31. We must capture it (col 53 in a 54-col grid).
    const out = dailyReturnsByYear([0.12], ["2012-12-31"]);
    expect(out[0].year).toBe("2012");
    const found = out[0].cells.flat().filter((v): v is number => v != null);
    expect(found).toHaveLength(1);
    expect(found[0]).toBeCloseTo(0.12, 10);
  });
});
