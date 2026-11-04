import { describe, it, expect, vi, afterEach } from "vitest";
import { readTinyBaseDays } from "./tiny-base-flag";

/**
 * Phase 188 (TINYBASE) plan 06, D-02, D-06 and SC-5: the one strict reader of the stored
 * tiny-base day list.
 *
 * The factsheet note (plan 07) and the dashboard note (plan 08) NAME the days the rule left out
 * and count them with the length of this list. The note is a disclosure, so a list with one
 * malformed element gives NO days rather than its good elements: a missing disclosure is
 * recoverable (the reader sees no note and the gap is still flagged elsewhere), a false one is
 * not (a named day that is not real, or a count that is wrong, tells the reader something untrue).
 * The reader never reads or returns an amount.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

describe("readTinyBaseDays - anything but an array names no days", () => {
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a string", "2026-10-27"],
    ["a number", 20261027],
    ["an object", { "0": "2026-10-27", length: 1 }],
    ["a boolean", true],
  ])("%s gives []", (_label, value) => {
    expect(readTinyBaseDays(value)).toEqual([]);
  });

  it("an empty list gives []", () => {
    expect(readTinyBaseDays([])).toEqual([]);
  });
});

describe("readTinyBaseDays - real calendar days, distinct and ascending", () => {
  it("returns an already ordered list as it is", () => {
    expect(readTinyBaseDays(["2026-10-27", "2026-10-28"])).toEqual(["2026-10-27", "2026-10-28"]);
  });

  it("orders ascending and drops a repeated day", () => {
    expect(readTinyBaseDays(["2026-10-28", "2026-10-27", "2026-10-27"])).toEqual([
      "2026-10-27",
      "2026-10-28",
    ]);
  });

  it("orders across a month and a year boundary chronologically", () => {
    expect(readTinyBaseDays(["2027-01-02", "2026-12-31", "2026-02-28", "2026-03-01"])).toEqual([
      "2026-02-28",
      "2026-03-01",
      "2026-12-31",
      "2027-01-02",
    ]);
  });

  it("accepts a real leap day", () => {
    expect(readTinyBaseDays(["2028-02-29"])).toEqual(["2028-02-29"]);
  });

  it("returns a new array: mutating the result leaves the input unchanged", () => {
    const input = ["2026-10-27", "2026-10-28"];
    const out = readTinyBaseDays(input);
    expect(out).not.toBe(input);
    out.push("2099-01-01");
    out[0] = "2000-01-01";
    expect(input).toEqual(["2026-10-27", "2026-10-28"]);
  });

  it("does not reorder or alter its input", () => {
    const input = ["2026-10-28", "2026-10-27", "2026-10-27"];
    readTinyBaseDays(input);
    expect(input).toEqual(["2026-10-28", "2026-10-27", "2026-10-27"]);
  });
});

describe("readTinyBaseDays - a malformed element voids the whole list (the disclosure fails closed)", () => {
  it("a day that is not on the calendar gives []", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(readTinyBaseDays(["2026-02-30"])).toEqual([]);
  });

  it("one bad element beside a good one gives [], not the good one", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(readTinyBaseDays(["2026-10-27", "2026-02-30"])).toEqual([]);
    expect(readTinyBaseDays(["2026-02-30", "2026-10-27"])).toEqual([]);
  });

  it.each([
    ["a number", [1]],
    ["a compact date", ["20261027"]],
    ["a timestamp", ["2026-10-27T00:00:00Z"]],
    ["a non-date string", ["not-a-day"]],
    ["an empty string", [""]],
    ["null", [null]],
    ["undefined", [undefined]],
    ["a nested array", [["2026-10-27"]]],
    ["an object", [{ day: "2026-10-27" }]],
  ])("an element that is %s gives []", (_label, value) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(readTinyBaseDays(value)).toEqual([]);
  });

  it("never echoes the value read into a warning (reason only)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    readTinyBaseDays(["2026-10-27", "secret-looking-value"]);
    for (const call of warn.mock.calls) {
      expect(String(call[0])).not.toContain("secret-looking-value");
    }
  });
});
