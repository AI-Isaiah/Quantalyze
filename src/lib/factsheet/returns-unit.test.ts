import { describe, it, expect } from "vitest";
import { parseReturnsUnit, withUnit, nativeUnitReason } from "./returns-unit";

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
