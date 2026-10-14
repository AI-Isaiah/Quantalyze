import { describe, expect, it, vi } from "vitest";
import {
  safeDecimalReturn,
  safeRatio,
  safeUsd,
  type DecimalReturn,
  type Ratio,
  type Usd,
} from "@/lib/units";
import {
  formatDecimalReturn,
  formatRatio,
  formatUsd,
  pct,
  pctSigned,
  ratio,
  signed,
  usdCompact,
  intl,
  ppDelta,
} from "./format";

// Legacy unbranded helpers — keep tested so the refactor that added the
// brand-aware aliases below didn't regress the format shape used by
// existing call sites.
describe("legacy unbranded formatters (NEW-C20-10 backward-compat)", () => {
  it("pctSigned formats with explicit + for non-negative", () => {
    expect(pctSigned(0.15)).toBe("+15.0%");
    expect(pctSigned(-0.05)).toBe("-5.0%");
    expect(pctSigned(null)).toBe("—");
    expect(pctSigned(Number.NaN)).toBe("—");
  });

  it("pct formats unsigned", () => {
    expect(pct(0.1234)).toBe("12.3%");
    expect(pct(null)).toBe("—");
  });

  it("ratio formats 2dp", () => {
    expect(ratio(1.234)).toBe("1.23");
    expect(ratio(null)).toBe("—");
  });

  it("signed formats with sign prefix at 2dp", () => {
    expect(signed(0.5)).toBe("+0.50");
    expect(signed(-1.25)).toBe("-1.25");
  });

  it("intl integer with thousand separators", () => {
    expect(intl(1234567)).toBe("1,234,567");
  });

  it("usdCompact tiers", () => {
    expect(usdCompact(2.5e9)).toBe("$2.5B");
    expect(usdCompact(5e6)).toBe("$5M");
    expect(usdCompact(7000)).toBe("$7K");
    expect(usdCompact(250)).toBe("$250");
    expect(usdCompact(null)).toBe("—");
  });

  it("ppDelta formats percentage-point delta", () => {
    expect(ppDelta(0.12, 0.08)).toBe("+4.0pp");
    expect(ppDelta(0.05, 0.10)).toBe("-5.0pp");
    expect(ppDelta(null, 0.1)).toBe("—");
  });
});

// NEW-C20-10 (B1, audit-2026-05-07) — brand-aware aliases that close the
// USD-as-percent / percent-as-USD unit-mix risk. The tests pin BOTH:
//  (a) brand-aware aliases produce IDENTICAL output to the legacy helpers
//      for in-range values (drop-in safe).
//  (b) the smart constructors gate implausibly out-of-range values to
//      null + boundary warn so the formatter renders "—" instead of
//      misleading numbers on the public factsheet surface.
describe("NEW-C20-10 — brand-aware formatters", () => {
  it("formatUsd matches usdCompact for in-range values", () => {
    const v = safeUsd(2.5e9);
    expect(v).not.toBeNull();
    expect(formatUsd(v)).toBe("$2.5B");
    expect(formatUsd(safeUsd(5e6))).toBe("$5M");
    expect(formatUsd(safeUsd(7000))).toBe("$7K");
    expect(formatUsd(safeUsd(250))).toBe("$250");
    expect(formatUsd(null)).toBe("—");
  });

  it("formatDecimalReturn defaults to signed, matches pctSigned for in-range values", () => {
    expect(formatDecimalReturn(safeDecimalReturn(0.15))).toBe("+15.0%");
    expect(formatDecimalReturn(safeDecimalReturn(-0.05))).toBe("-5.0%");
    // Opt-out of sign for surfaces like Max DD that conventionally omit it.
    expect(formatDecimalReturn(safeDecimalReturn(-0.12), { signed: false })).toBe(
      "-12.0%",
    );
    expect(formatDecimalReturn(null)).toBe("—");
  });

  it("formatRatio matches ratio for in-range values", () => {
    expect(formatRatio(safeRatio(1.234))).toBe("1.23");
    expect(formatRatio(safeRatio(-2.5))).toBe("-2.50");
    expect(formatRatio(null)).toBe("—");
  });

  it("safeUsd accepts implausibly LARGE positive (no upper-bound check)", () => {
    // USD has no realistic upper bound — total crypto market cap is
    // ~$2T; an aggregator could legitimately ship a >$1T number.
    expect(safeUsd(2e12)).not.toBeNull();
  });

  it("safeUsd rejects implausibly NEGATIVE values (unit-mix gate)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      // -1e16 — way below the gate. Almost certainly a unit-mix bug.
      expect(safeUsd(-1e16)).toBeNull();
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("safeDecimalReturn rejects |v|>10 (1000% — percent-vs-fraction confusion)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(safeDecimalReturn(50)).toBeNull();
      expect(safeDecimalReturn(-15)).toBeNull();
      expect(warnSpy).toHaveBeenCalledTimes(2);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("safeRatio rejects |v|>100 (zero-variance / unit-mix gate)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      // Sharpe of 500 means the producer divided by a near-zero stdev
      // or shipped a USD value by mistake.
      expect(safeRatio(500)).toBeNull();
      expect(safeRatio(-200)).toBeNull();
      expect(warnSpy).toHaveBeenCalledTimes(2);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("brand-aware aliases collapse to '—' when smart constructors reject", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      // Instead of rendering "+5000%" on the public surface (legacy
      // behavior), the unit-mix bug renders "—" — a distinct UX cue
      // that something upstream is wrong.
      expect(formatDecimalReturn(safeDecimalReturn(50))).toBe("—");
      expect(formatRatio(safeRatio(500))).toBe("—");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("type system: brand-aware aliases compile only with the matching brand", () => {
    const usd = safeUsd(1000) as Usd;
    const ret = safeDecimalReturn(0.05) as DecimalReturn;
    const r = safeRatio(1.5) as Ratio;

    expect(formatUsd(usd)).toBe("$1K");
    expect(formatDecimalReturn(ret)).toBe("+5.0%");
    expect(formatRatio(r)).toBe("1.50");
  });
});

// Phase 170.6 DISPLAYPOLISH plan 01 (D-02, D-05): a value that rounds to zero at its
// display precision prints unsigned. `-0.00`, `-0.0%` and `+0.0%` never appear. The
// helpers delegate to display-sign, so these pin the printed strings (hand-typed).
describe("170.6 D-02 — a rounded zero prints unsigned", () => {
  it("pctSigned: an exact zero and a sub-precision negative both print 0.0%", () => {
    expect(pctSigned(0, 1)).toBe("0.0%");
    expect(pctSigned(-0.0004)).toBe("0.0%");
    expect(pctSigned(0.25)).toBe("+25.0%");
  });

  it("pct: a sub-precision negative prints 0.0%", () => {
    expect(pct(-0.0004)).toBe("0.0%");
    expect(pct(-0.0368)).toBe("-3.7%");
  });

  it("ratio and signed: -0.004 prints 0.00, never -0.00", () => {
    expect(ratio(-0.004)).toBe("0.00");
    expect(signed(-0.004)).toBe("0.00");
    expect(signed(0.5)).toBe("+0.50");
    expect(signed(0)).toBe("0.00");
  });

  it("ppDelta: a delta that rounds to zero prints 0.0pp", () => {
    expect(ppDelta(0.1, 0.1004)).toBe("0.0pp");
    expect(ppDelta(0.12, 0.1)).toBe("+2.0pp");
  });

  it("the brand-aware aliases follow the same rule", () => {
    expect(formatDecimalReturn(safeDecimalReturn(0))).toBe("0.0%");
    expect(formatDecimalReturn(safeDecimalReturn(-0.0004))).toBe("0.0%");
    expect(formatDecimalReturn(safeDecimalReturn(-0.0004), { signed: false })).toBe("0.0%");
    expect(formatRatio(safeRatio(-0.004))).toBe("0.00");
  });

  it("W3: no digit regression, 1.005 at 2dp keeps the digits toFixed prints", () => {
    expect(ratio(1.005)).toBe("1.00");
    expect(ratio(-1.005)).toBe("-1.00");
  });
});
