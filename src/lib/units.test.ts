import { describe, expect, it, vi } from "vitest";
import {
  asImprovement,
  DELTA_UNITS,
  safeDecimalReturn,
  safeFraction,
  safeRatio,
  safeUsd,
  signedExposureUsd,
  type DecimalReturn,
  type Fraction,
  type Improvement,
  type Ratio,
  type Usd,
} from "./units";

// B1 (audit-2026-05-07) — verify the canonical re-export module surfaces
// every brand and smart constructor the audit landed across PR-1/-2/-3+4.
// The brands themselves are validated by their producer-side specs; this
// file pins (a) the new `safe*` constructor semantics (NEW-C20-10) and
// (b) that every re-export resolves to a value, not undefined (a typo or
// a renamed producer export would otherwise survive `tsc` because the
// consumer-side import would silently widen).

// NEW-C20-10 (B1, audit-2026-05-07) — Usd / DecimalReturn / Ratio /
// Fraction validating constructors. The aim is to gate the
// implausibly-out-of-range cases (the producer-side unit-mix bugs the
// audit found landing on the public factsheet) at the boundary so the
// formatter renders "—" instead of the misleading raw number.

describe("safeUsd — NEW-C20-10", () => {
  it("brands valid USD values (including very large)", () => {
    expect(safeUsd(0)).toBe(0 as Usd);
    expect(safeUsd(1234.56)).toBeCloseTo(1234.56);
    expect(safeUsd(2e12)).toBeCloseTo(2e12);
  });

  it("accepts legitimate negative USD (debit/loss)", () => {
    // A −$50k unrealised loss is a legitimate USD value; the gate
    // exists only for implausibly large magnitudes, not for sign.
    expect(safeUsd(-50_000)).toBeCloseTo(-50_000);
  });

  it("rejects null, undefined, NaN, Infinity", () => {
    expect(safeUsd(null)).toBeNull();
    expect(safeUsd(undefined)).toBeNull();
    expect(safeUsd(Number.NaN)).toBeNull();
    expect(safeUsd(Number.POSITIVE_INFINITY)).toBeNull();
    expect(safeUsd(Number.NEGATIVE_INFINITY)).toBeNull();
  });

  it("rejects implausibly large negative magnitudes (unit-mix gate)", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      // < -1e15 — well past "no real portfolio loses this much in USD."
      expect(safeUsd(-1e16)).toBeNull();
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("safeDecimalReturn — NEW-C20-10", () => {
  it("brands in-range returns (-100% to +100% and beyond)", () => {
    expect(safeDecimalReturn(0)).toBe(0 as DecimalReturn);
    expect(safeDecimalReturn(0.18)).toBeCloseTo(0.18);
    expect(safeDecimalReturn(-0.45)).toBeCloseTo(-0.45);
    // A 9x return (~+900%) is unusual but possible for tail bets.
    expect(safeDecimalReturn(9)).toBeCloseTo(9);
  });

  it("rejects null, undefined, NaN, Infinity", () => {
    expect(safeDecimalReturn(null)).toBeNull();
    expect(safeDecimalReturn(undefined)).toBeNull();
    expect(safeDecimalReturn(Number.NaN)).toBeNull();
    expect(safeDecimalReturn(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("rejects |v|>10 (percent-vs-fraction bug — 50 instead of 0.5)", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(safeDecimalReturn(50)).toBeNull();
      expect(safeDecimalReturn(-25)).toBeNull();
      expect(safeDecimalReturn(100_000)).toBeNull();
      expect(spy).toHaveBeenCalledTimes(3);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("safeRatio — NEW-C20-10", () => {
  it("brands realistic ratio values", () => {
    expect(safeRatio(0)).toBe(0 as Ratio);
    expect(safeRatio(1.5)).toBeCloseTo(1.5);
    expect(safeRatio(-2.3)).toBeCloseTo(-2.3);
    // Sharpe of 8 is exceptional but not implausible for a market-making
    // strategy over a benign window.
    expect(safeRatio(8)).toBeCloseTo(8);
  });

  it("rejects null, undefined, NaN, Infinity", () => {
    expect(safeRatio(null)).toBeNull();
    expect(safeRatio(undefined)).toBeNull();
    expect(safeRatio(Number.NaN)).toBeNull();
    expect(safeRatio(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("rejects |v|>100 (zero-variance divide / unit-mix gate)", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      // Sharpe of 500 — divide-by-near-zero stdev upstream.
      expect(safeRatio(500)).toBeNull();
      expect(safeRatio(-300)).toBeNull();
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("safeFraction — NEW-C09-08", () => {
  it("brands a valid in-range value", () => {
    const f = safeFraction(0.25);
    expect(f).not.toBeNull();
    expect(f).toBeCloseTo(0.25);
  });

  it("accepts 0 and 1 as boundary values", () => {
    expect(safeFraction(0)).toBe(0 as Fraction);
    expect(safeFraction(1)).toBe(1 as Fraction);
  });

  it("rejects null and undefined as null (no value to render)", () => {
    expect(safeFraction(null)).toBeNull();
    expect(safeFraction(undefined)).toBeNull();
  });

  it("rejects NaN, +Inf, -Inf silently", () => {
    expect(safeFraction(Number.NaN)).toBeNull();
    expect(safeFraction(Number.POSITIVE_INFINITY)).toBeNull();
    expect(safeFraction(Number.NEGATIVE_INFINITY)).toBeNull();
  });

  it("rejects out-of-range AND warns to surface producer drift", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(safeFraction(-0.01)).toBeNull();
      expect(safeFraction(1.01)).toBeNull();
      // Producer-side percent-vs-fraction drift (50 instead of 0.5).
      expect(safeFraction(50)).toBeNull();
      expect(spy).toHaveBeenCalledTimes(3);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("units.ts re-export surface", () => {
  // Each re-export must resolve to a value/type at runtime. A producer
  // rename without updating the re-export would otherwise compile (the
  // import resolves to `undefined`) and only fail at call site.

  it("re-exports asImprovement (types.ts)", () => {
    expect(typeof asImprovement).toBe("function");
    const imp: Improvement = asImprovement(0.15, "higher-better");
    expect(imp).toBeCloseTo(0.15);
    const inverted: Improvement = asImprovement(0.05, "lower-better");
    expect(inverted).toBeCloseTo(-0.05);
  });

  it("re-exports signedExposureUsd (types.ts)", () => {
    expect(typeof signedExposureUsd).toBe("function");
    expect(
      signedExposureUsd({
        id: "x",
        strategy_id: "s",
        snapshot_date: "2026-01-01",
        symbol: "BTC-USDT",
        side: "short",
        size_base: 1,
        size_usd: 1000,
        entry_price: null,
        mark_price: null,
        unrealized_pnl: null,
        exchange: null,
        computed_at: "2026-01-01",
        created_at: "2026-01-01",
      }),
    ).toBe(-1000);
  });

  it("re-exports DELTA_UNITS map (simulatorSchema.ts)", () => {
    expect(DELTA_UNITS).toBeDefined();
    expect(DELTA_UNITS.sharpe_delta).toBe("ratio");
    expect(DELTA_UNITS.dd_delta).toBe("percent");
  });
});
