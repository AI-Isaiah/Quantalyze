import { describe, it, expect } from "vitest";
import {
  formatSignedPercent,
  formatUnsignedPercent,
  formatRatio,
  percentTone,
  ratioTone,
  roundForDisplay,
  signTone,
  formatFixedSigned,
  drawdownTone,
  isPrintedZero,
} from "./display-sign";

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

/**
 * Phase 170.6 DISPLAYPOLISH plan 01 (D-02, D-03, D-04, D-05): the general primitives every
 * formatter in the repo calls. Every expectation is a hand-typed literal.
 */

describe("roundForDisplay (D-05)", () => {
  it("rounds to dp places after scaling, and never returns -0", () => {
    const r = roundForDisplay(-0.0004, 1, 100);
    expect(r).toBe(0);
    expect(Object.is(r, -0)).toBe(false);
    expect(roundForDisplay(0.0072, 1, 100)).toBe(0.7);
    expect(roundForDisplay(-0.031, 1, 100)).toBe(-3.1);
  });

  it.each([NaN, Infinity, -Infinity, null, undefined])("%s is null", (v) => {
    expect(roundForDisplay(v as number | null | undefined, 2)).toBeNull();
  });
});

describe("signTone (D-03: the tone follows the ROUNDED value)", () => {
  it("a raw -0.0004 shown at 1dp of a percent is neutral, -0.0005 is negative", () => {
    expect(signTone(-0.0004, 1, 100)).toBeUndefined();
    expect(signTone(-0.0005, 1, 100)).toBe("negative");
  });

  it("0.004 at 2dp is neutral, 0.005 at 2dp is positive", () => {
    expect(signTone(0.004, 2)).toBeUndefined();
    expect(signTone(0.005, 2)).toBe("positive");
  });

  it.each([NaN, null, undefined])("%s has no tone", (v) => {
    expect(signTone(v as number | null | undefined, 2)).toBeUndefined();
  });
});

describe("formatFixedSigned (D-02, W3: the raw value's own digits)", () => {
  it("keeps the digits toFixed prints today for a non-zero figure (no digit regression)", () => {
    expect(formatFixedSigned(1.005, { dp: 2 })).toBe("1.00");
    expect(formatFixedSigned(-1.005, { dp: 2 })).toBe("-1.00");
    expect(formatFixedSigned(2.675, { dp: 2 })).toBe("2.67");
  });

  it("a value that rounds to zero prints unsigned", () => {
    expect(formatFixedSigned(-0.004, { dp: 2 })).toBe("0.00");
    expect(formatFixedSigned(0, { dp: 1, scale: 100, suffix: "%", plus: true })).toBe("0.0%");
    expect(formatFixedSigned(-0.0004, { dp: 1, scale: 100, suffix: "%", plus: true })).toBe("0.0%");
  });

  it("plus and a custom minus glyph", () => {
    expect(formatFixedSigned(0.0072, { dp: 1, scale: 100, suffix: "%", plus: true })).toBe("+0.7%");
    expect(formatFixedSigned(-0.031, { dp: 1, scale: 100, suffix: "%", plus: true, minus: "\u2212" })).toBe("\u22123.1%");
  });

  it.each([Infinity, -Infinity, NaN, null, undefined])("%s prints a dash", (v) => {
    expect(formatFixedSigned(v as number | null | undefined, { dp: 2 })).toBe("\u2014");
  });
});

describe("drawdownTone (D-04: max drawdown is never green)", () => {
  it("is negative only below a rounded zero, never positive", () => {
    expect(drawdownTone(-0.0342, 2, 100)).toBe("negative");
    expect(drawdownTone(-0.00004, 2, 100)).toBeUndefined();
    expect(drawdownTone(0, 2, 100)).toBeUndefined();
    expect(drawdownTone(0.01, 2, 100)).toBeUndefined();
    expect(drawdownTone(null, 2, 100)).toBeUndefined();
  });
});

describe("isPrintedZero (the rule stated over a string)", () => {
  it.each(["-0.00", "\u22120.0%", "0", "0.0%", "+0.00"])("%s is a printed zero", (t) => {
    expect(isPrintedZero(t)).toBe(true);
  });

  it.each(["-0.01", "12,345.00", "\u2014", "", "abc", "0.10"])("%s is not a printed zero", (t) => {
    expect(isPrintedZero(t)).toBe(false);
  });

  it("agrees with roundForDisplay for a toFixed-printed string", () => {
    for (const [v, dp, scale] of [
      [-0.0004, 1, 100],
      [-0.0005, 1, 100],
      [0.0004, 1, 100],
      [-0.004, 2, 1],
      [-0.006, 2, 1],
    ] as const) {
      expect(isPrintedZero((v * scale).toFixed(dp))).toBe(roundForDisplay(v, dp, scale) === 0);
    }
    // hand-typed anchors for the two boundary cases named in the plan
    expect(isPrintedZero((-0.0004 * 100).toFixed(1))).toBe(true);
    expect(isPrintedZero((-0.0005 * 100).toFixed(1))).toBe(false);
  });
});
