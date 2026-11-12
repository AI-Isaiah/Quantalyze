import { describe, it, expect } from "vitest";
import {
  parseReturnsUnit,
  withUnit,
  nativeUnitReason,
  nativeAmount,
  unitTag,
  formatCloseDay,
  formatUnpricedDays,
  benchmarkWithheldReason,
} from "./returns-unit";

/**
 * Phase 164.6.6.2 plan 05 (D-08, D-09) — the ONE validator every surface that
 * names a native unit imports. The unit is data out of a jsonb blob
 * (`strategy_analytics.data_quality_flags.native_unit`), so it is parsed at the
 * boundary with the same pattern the database CHECK uses, and never trusted raw.
 */
describe("parseReturnsUnit", () => {
  it("accepts a well-formed upper-case code", () => {
    expect(parseReturnsUnit("BTC")).toBe("BTC");
    expect(parseReturnsUnit("ETH")).toBe("ETH");
    expect(parseReturnsUnit("EURR")).toBe("EURR");
  });

  it.each([
    ["lower case", "btc"],
    ["empty string", ""],
    ["one letter", "B"],
    ["eleven letters", "ABCDEFGHIJK"],
    ["a number", 5],
    ["null", null],
    ["undefined", undefined],
    ["an object", { unit: "BTC" }],
    ["markup", "BTC<script>"],
    ["trailing newline", "BTC\n"],
    ["a digit inside", "BT1"],
    ["a space", "B TC"],
  ])("rejects %s", (_label, raw) => {
    expect(parseReturnsUnit(raw)).toBeNull();
  });
});

describe("withUnit", () => {
  it("returns the SAME string reference when there is no unit (the USD early return)", () => {
    const label = "CAGR";
    expect(withUnit(label, null)).toBe(label);
    expect(withUnit(label, undefined)).toBe(label);
  });

  it("appends the unit it is given, never a hard-coded one", () => {
    expect(withUnit("CAGR", "BTC")).toBe("CAGR in BTC");
    expect(withUnit("CAGR", "ETH")).toBe("CAGR in ETH");
  });
});

describe("nativeUnitReason", () => {
  it("composes the one reason string from the unit", () => {
    expect(nativeUnitReason("BTC")).toBe("returns are in BTC");
    expect(nativeUnitReason("ETH")).toBe("returns are in ETH");
  });
});

/**
 * Phase 164.6.6.2.1 plan 05 (D-07) — a native amount is a count of units, never
 * dollars. Expected strings are written by hand from the 164.6.6.2 contract.
 */
describe("nativeAmount", () => {
  it.each([
    [1234.5678, "BTC", "1,234.57 BTC"],
    [0.05231, "BTC", "0.05231 BTC"],
    [0.4213, "BTC", "0.4213 BTC"],
    [0, "BTC", "0.00 BTC"],
    [-0.4213, "BTC", "-0.4213 BTC"],
    [1000000, "BTC", "1,000,000.00 BTC"],
    [null, "BTC", "—"],
    [undefined, "BTC", "—"],
    [NaN, "BTC", "—"],
    [Infinity, "BTC", "—"],
    [-Infinity, "BTC", "—"],
  ] as const)("formats %s as %s", (v, unit, expected) => {
    expect(nativeAmount(v as number | null | undefined, unit)).toBe(expected);
  });

  it("never carries a dollar sign and takes the unit as a parameter", () => {
    for (const v of [1234.5678, 0.052310, 0.4213, 0, -3, null, NaN]) {
      expect(nativeAmount(v, "BTC")).not.toContain("$");
    }
    expect(nativeAmount(2.5, "ETH")).toBe("2.50 ETH");
    expect(nativeAmount(2.5, "ETH")).not.toContain("BTC");
  });
});

describe("nativeAmount rounding edge", () => {
  it("does not print a bare `1` for a fraction that rounds up to one", () => {
    expect(nativeAmount(0.99996, "BTC")).toBe("1.00 BTC");
  });
});

describe("unitTag", () => {
  it("composes the one `in <unit>` tag", () => {
    expect(unitTag("BTC")).toBe("in BTC");
    expect(unitTag("ETH")).toBe("in ETH");
  });
});

describe("formatCloseDay", () => {
  // Phase 201 U-14, D-11 (plan 201-23): no factsheet date is yearless, so the helper takes the day
  // and nothing else. The `{ year: false }` option it once ignored is gone with its last caller.
  it("formats a UTC ISO day with the year, and takes one argument", () => {
    expect(formatCloseDay("2026-10-08")).toBe("Oct\u00a08,\u00a02026");
    expect(formatCloseDay.length).toBe(1);
  });

  it("returns an em dash for a malformed day", () => {
    expect(formatCloseDay("not-a-day")).toBe("—");
    expect(formatCloseDay("2026-13-40")).toBe("—");
    expect(formatCloseDay("")).toBe("—");
  });
});

describe("formatUnpricedDays", () => {
  it("reads one day as a single date", () => {
    expect(formatUnpricedDays(["2026-10-03"])).toBe("Oct\u00a03,\u00a02026");
  });

  it("collapses consecutive days into a spaced-en-dash run and joins runs with `; `", () => {
    expect(
      formatUnpricedDays(["2026-10-03", "2026-10-04", "2026-10-05", "2026-10-09"]),
    ).toBe("Oct\u00a03,\u00a02026 \u2013 Oct\u00a05,\u00a02026; Oct\u00a09,\u00a02026");
  });

  it("lists every run, none truncated", () => {
    const days = ["2026-01-01", "2026-01-03", "2026-01-05", "2026-01-07", "2026-01-09", "2026-01-11"];
    expect(formatUnpricedDays(days)).toBe(
      "Jan\u00a01,\u00a02026; Jan\u00a03,\u00a02026; Jan\u00a05,\u00a02026; Jan\u00a07,\u00a02026; Jan\u00a09,\u00a02026; Jan\u00a011,\u00a02026",
    );
  });

  it("sorts unsorted input first and collapses across a month and year boundary", () => {
    expect(formatUnpricedDays(["2027-01-01", "2026-12-31", "2026-12-30"])).toBe(
      "Dec\u00a030,\u00a02026 \u2013 Jan\u00a01,\u00a02027",
    );
  });

  it("treats two-day runs as a run", () => {
    expect(formatUnpricedDays(["2026-10-04", "2026-10-03"])).toBe("Oct\u00a03,\u00a02026 \u2013 Oct\u00a04,\u00a02026");
  });
});

describe("benchmarkWithheldReason", () => {
  it("reads the native-view reason when nothing was converted", () => {
    expect(benchmarkWithheldReason("BTC", null)).toBe("returns are in BTC");
    expect(benchmarkWithheldReason("BTC")).toBe("returns are in BTC");
  });

  it("reads the USD-view reason when the returns were converted", () => {
    expect(benchmarkWithheldReason("USD", "BTC")).toBe("returns are converted from BTC");
  });
});
