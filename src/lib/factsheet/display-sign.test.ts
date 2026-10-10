import { describe, it, expect } from "vitest";
import { formatSignedPercent, formatUnsignedPercent, formatRatio, percentTone, ratioTone } from "./display-sign";

/**
 * Phase 164.6.6.3.3 FACTSHEETTRUTH plan 06 (B7, B8, D-07, UI-SPEC section 3.2).
 *
 * The sign and the tone of a displayed figure come from the value ROUNDED to the
 * precision it is printed at, not from the raw value: a -0.0004 drawdown prints
 * "0.0%", and printing it as "-0.0%" (or colouring it red) tells a reader there is
 * a loss where the page shows none. Every expectation is a hand-typed string.
 */

describe("formatSignedPercent", () => {
  it.each([
    [0.007192, 1, "+0.7%"],
    [-0.031, 1, "-3.1%"],
    [0.25, 1, "+25.0%"],
    [0.0072, 2, "+0.72%"],
  ])("%s at %sdp prints %s", (v, dp, out) => {
    expect(formatSignedPercent(v, dp)).toBe(out);
  });

  it.each([-0.0004, 0.0004, 0, -0])("a value that rounds to zero (%s) prints 0.0% with no sign", (v) => {
    expect(formatSignedPercent(v, 1)).toBe("0.0%");
  });

  it("the boundary is the ROUNDED value: -0.0005 rounds to -0.1%, -0.00049 to 0.0%", () => {
    expect(formatSignedPercent(-0.001, 1)).toBe("-0.1%");
    expect(formatSignedPercent(-0.00049, 1)).toBe("0.0%");
  });

  it.each([NaN, Infinity, -Infinity, null, undefined])("%s prints a dash", (v) => {
    expect(formatSignedPercent(v as number | null | undefined, 1)).toBe("—");
  });
});

describe("formatUnsignedPercent", () => {
  it.each([
    [-0.0368, 1, "-3.7%"],
    [0.0368, 1, "3.7%"],
    [-0.0004, 1, "0.0%"],
    [0, 1, "0.0%"],
    [-0.0368, 2, "-3.68%"],
  ])("%s at %sdp prints %s", (v, dp, out) => {
    expect(formatUnsignedPercent(v, dp)).toBe(out);
  });

  it.each([NaN, null, undefined])("%s prints a dash", (v) => {
    expect(formatUnsignedPercent(v as number | null | undefined, 1)).toBe("—");
  });
});

describe("formatRatio", () => {
  it.each([
    [0.12, 2, "0.12"],
    [-0.004, 2, "0.00"],
    [-1.234, 2, "-1.23"],
    [2.345, 1, "2.3"],
  ])("%s at %sdp prints %s", (v, dp, out) => {
    expect(formatRatio(v, dp)).toBe(out);
  });

  it.each([NaN, null, undefined])("%s prints a dash", (v) => {
    expect(formatRatio(v as number | null | undefined, 2)).toBe("—");
  });
});

describe("percentTone", () => {
  it("positive above zero, negative below", () => {
    expect(percentTone(0.0072, 1)).toBe("positive");
    expect(percentTone(-0.031, 1)).toBe("negative");
  });

  it.each([0, -0, 0.0004, -0.0004])("a value that rounds to zero (%s) has no tone", (v) => {
    expect(percentTone(v, 1)).toBeUndefined();
  });

  it("the tone follows the printed precision: -0.0004 is zero at 1dp but negative at 2dp", () => {
    expect(percentTone(-0.0004, 1)).toBeUndefined();
    expect(percentTone(-0.0004, 2)).toBe("negative");
  });

  it.each([NaN, Infinity, -Infinity, null, undefined])("a non-finite value (%s) has no tone", (v) => {
    expect(percentTone(v as number | null | undefined, 1)).toBeUndefined();
  });
});

describe("ratioTone (plan 09, the KPI strip's IR cell)", () => {
  it("positive above zero, negative below, at the printed precision", () => {
    expect(ratioTone(0.5)).toBe("positive");
    expect(ratioTone(-0.5)).toBe("negative");
    expect(ratioTone(0.01)).toBe("positive");
  });

  it.each([0, -0, 0.004, -0.004, 0.0049, -0.0049])("a value that prints 0.00 (%s) has no tone", (v) => {
    expect(ratioTone(v)).toBeUndefined();
  });

  it("the tone follows the printed precision: -0.004 is zero at 2dp but negative at 3dp", () => {
    expect(ratioTone(-0.004, 2)).toBeUndefined();
    expect(ratioTone(-0.004, 3)).toBe("negative");
  });

  it("agrees with formatRatio: a printed \"0.00\" never carries a tone, a printed \"-0.01\" is negative", () => {
    expect(formatRatio(-0.004)).toBe("0.00");
    expect(ratioTone(-0.004)).toBeUndefined();
    expect(formatRatio(-0.006)).toBe("-0.01");
    expect(ratioTone(-0.006)).toBe("negative");
  });

  it.each([NaN, Infinity, -Infinity, null, undefined])("a non-finite value (%s) has no tone", (v) => {
    expect(ratioTone(v as number | null | undefined)).toBeUndefined();
  });
});
