import { describe, it, expect } from "vitest";
import { fmtNum2, fmtSignedPct2 } from "./format";

/**
 * Phase 170.5 plan 07 Task 1 (D-07, D-06) - the v2 greek formatters.
 *
 * Digits are the factsheet's (`pct(v, true)` = x100 to 2 dp, `num(v)` = 2 dp),
 * so a non-zero figure prints the same string on both pages. On top of that the
 * DESIGN Numbers Contract applies: the sign and the tone come from the ROUNDED
 * value, so a value that rounds to zero prints unsigned and neutral. The tone
 * flag is computed from the same rounded number the cell prints, so the text
 * and the colour cannot disagree (T-170.5-22).
 */
describe("fmtSignedPct2", () => {
  it("prints the factsheet's digits with an explicit plus", () => {
    expect(fmtSignedPct2(0.123456)).toEqual({ text: "+12.35%", negative: false });
  });

  it("prints a negative percent with a minus and flags it", () => {
    expect(fmtSignedPct2(-0.031)).toEqual({ text: "-3.10%", negative: true });
  });

  it("a value that rounds to zero prints 0.00% with no sign and is not negative", () => {
    expect(fmtSignedPct2(-0.00004)).toEqual({ text: "0.00%", negative: false });
    expect(fmtSignedPct2(0.00004)).toEqual({ text: "0.00%", negative: false });
    expect(fmtSignedPct2(0)).toEqual({ text: "0.00%", negative: false });
  });

  it("the first value that rounds to -0.01% is negative", () => {
    expect(fmtSignedPct2(-0.00005)?.negative).toBe(true);
    expect(fmtSignedPct2(-0.00005)?.text).toBe("-0.01%");
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, null, undefined])(
    "%s is null, never 0",
    (v) => {
      expect(fmtSignedPct2(v as number | null | undefined)).toBeNull();
    },
  );
});

describe("fmtNum2", () => {
  it("prints 2 dp", () => {
    expect(fmtNum2(0.38412)).toEqual({ text: "0.38", negative: false });
    expect(fmtNum2(1.2)).toEqual({ text: "1.20", negative: false });
  });

  it("-0.004 prints 0.00, neutral (the sign comes from the rounded value)", () => {
    expect(fmtNum2(-0.004)).toEqual({ text: "0.00", negative: false });
  });

  it("-0.005 prints -0.01 and is negative", () => {
    expect(fmtNum2(-0.005)).toEqual({ text: "-0.01", negative: true });
  });

  it("a positive value gets no plus sign", () => {
    expect(fmtNum2(0.4)?.text).toBe("0.40");
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, null, undefined])(
    "%s is null, never 0",
    (v) => {
      expect(fmtNum2(v as number | null | undefined)).toBeNull();
    },
  );

  it("never prints a negative zero", () => {
    expect(fmtNum2(-0)?.text).toBe("0.00");
    expect(fmtNum2(-0.0001)?.text).toBe("0.00");
  });
});
