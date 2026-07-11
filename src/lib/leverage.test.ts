import { beforeEach, describe, expect, it, vi } from "vitest";

import { compute } from "@/lib/factsheet/compute";

// SFH-2 — a real coercion emits a Sentry warning; mock the helper so the unit
// tests can assert the signal fires (and don't trigger a real @sentry import).
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
import { captureToSentry } from "@/lib/sentry-capture";

import { MAX_LEVERAGE, sanitizeLeverage, sanitizeLeverageMap } from "./leverage";

/**
 * Relative-closeness helper for the invariance-math pins. `toBeCloseTo` works on
 * an absolute (decimal-places) scale — leverage-scaled vol can be O(1) or O(0.01)
 * depending on the fixture, so a RELATIVE tolerance is the correct gauge for the
 * "vol scales ×L exactly / Sharpe invariant" claims.
 */
function relDiff(a: number, b: number): number {
  const denom = Math.max(Math.abs(a), Math.abs(b), Number.MIN_VALUE);
  return Math.abs(a - b) / denom;
}

const REL_TOL = 1e-9;

describe("sanitizeLeverage — read-side clamp (mirrors engine lev(), adds MAX clamp)", () => {
  it("non-finite → 1 (engine defensive default, scenario.ts:325-328)", () => {
    expect(sanitizeLeverage(NaN)).toBe(1);
    expect(sanitizeLeverage(Infinity)).toBe(1);
    expect(sanitizeLeverage(-Infinity)).toBe(1);
  });

  it("negative → 1 (the ENGINE rule, NOT the composer's interactive 0-clamp)", () => {
    expect(sanitizeLeverage(-1)).toBe(1);
  });

  it("identity across the valid [0, MAX] band (0 allowed)", () => {
    expect(sanitizeLeverage(0)).toBe(0);
    expect(sanitizeLeverage(0.5)).toBe(0.5);
    expect(sanitizeLeverage(1)).toBe(1);
    expect(sanitizeLeverage(10)).toBe(10);
  });

  it("above MAX → MAX (read-side ceiling the engine lev() does not have)", () => {
    expect(sanitizeLeverage(11)).toBe(10);
  });

  it("MAX_LEVERAGE is 10", () => {
    expect(MAX_LEVERAGE).toBe(10);
  });
});

describe("sanitizeLeverageMap — LEV-02 rehydrate helper (per-entry sanitize on read)", () => {
  it("undefined → {}", () => {
    expect(sanitizeLeverageMap(undefined)).toEqual({});
  });

  it("sanitizes every entry independently (NaN/-3 → 1, 999 → 10, 2 identity)", () => {
    expect(sanitizeLeverageMap({ a: 2, b: NaN, c: -3, d: 999 })).toEqual({
      a: 2,
      b: 1,
      c: 1,
      d: 10,
    });
  });
});

describe("SFH-2 — a REAL coercion is Sentry-visible; the identity path is silent", () => {
  beforeEach(() => {
    vi.mocked(captureToSentry).mockClear();
  });

  it("does NOT log on the identity path (0/2/10 → itself)", () => {
    sanitizeLeverage(0);
    sanitizeLeverage(2);
    sanitizeLeverage(MAX_LEVERAGE);
    expect(captureToSentry).not.toHaveBeenCalled();
  });

  it("logs a warning with an errorId + input/output when a finite value is clamped down (999 → 10)", () => {
    sanitizeLeverage(999);
    expect(captureToSentry).toHaveBeenCalledTimes(1);
    const [, options] = vi.mocked(captureToSentry).mock.calls[0];
    expect(options.tags.errorId).toBe("LEV_SANITIZE_COERCION");
    expect(options.level).toBe("warning");
    expect(options.extra).toMatchObject({ input: 999, output: 10 });
  });

  it("logs when a negative value is coerced to 1 (−5 → 1)", () => {
    sanitizeLeverage(-5);
    expect(captureToSentry).toHaveBeenCalledTimes(1);
    expect(vi.mocked(captureToSentry).mock.calls[0][1].extra).toMatchObject({
      input: -5,
      output: 1,
    });
  });

  it("does NOT log on unpersistable non-finite input (NaN/Infinity — JSON can't carry them)", () => {
    sanitizeLeverage(NaN);
    sanitizeLeverage(Infinity);
    expect(captureToSentry).not.toHaveBeenCalled();
  });

  it("threads the offending KEY through the map path (corrupt persisted value is diagnosable by ref)", () => {
    sanitizeLeverageMap({ good: 2, bad: 999 });
    // Only the coerced entry logs; the identity entry stays silent.
    expect(captureToSentry).toHaveBeenCalledTimes(1);
    const [, options] = vi.mocked(captureToSentry).mock.calls[0];
    expect(options.tags.source).toBe("sanitizeLeverageMap");
    expect(options.extra).toMatchObject({ key: "bad", input: 999, output: 10 });
  });
});

/**
 * Invariance math pinned against the REAL compute(). Deterministic 12-element
 * mixed-sign daily-returns fixture with an embedded drawdown so the geometric
 * path-dependence assertions have teeth.
 */
const RETS = [
  0.01, -0.02, 0.03, -0.015, 0.005, -0.008, 0.012, -0.025, 0.018, -0.004, 0.02, -0.01,
];
const DATES = [
  "2026-01-01",
  "2026-01-02",
  "2026-01-03",
  "2026-01-04",
  "2026-01-05",
  "2026-01-06",
  "2026-01-07",
  "2026-01-08",
  "2026-01-09",
  "2026-01-10",
  "2026-01-11",
  "2026-01-12",
];

describe("leverage invariance math (r → L·r) against real compute()", () => {
  it("ann_vol scales exactly ×L (rel tol 1e-9)", () => {
    const base = compute(RETS, DATES, 0, 365);
    const lev2 = compute(
      RETS.map(r => 2 * r),
      DATES,
      0,
      365,
    );
    expect(relDiff(lev2.ann_vol, 2 * base.ann_vol)).toBeLessThan(REL_TOL);
  });

  it("Sharpe and Sortino are leverage-INVARIANT (rf=0, rel tol 1e-9)", () => {
    const base = compute(RETS, DATES, 0, 365);
    const lev2 = compute(
      RETS.map(r => 2 * r),
      DATES,
      0,
      365,
    );
    expect(relDiff(lev2.sharpe, base.sharpe)).toBeLessThan(REL_TOL);
    expect(relDiff(lev2.sortino, base.sortino)).toBeLessThan(REL_TOL);
  });

  it("cumulative return recomputes geometrically — equals ∏(1+2r)−1, NOT 2× the base", () => {
    const base = compute(RETS, DATES, 0, 365);
    const lev2 = compute(
      RETS.map(r => 2 * r),
      DATES,
      0,
      365,
    );
    const truth = RETS.reduce((acc, r) => acc * (1 + 2 * r), 1) - 1;
    expect(relDiff(lev2.cum_ret, truth)).toBeLessThan(REL_TOL);
    // Analytic ×L rescale is UNSOUND — geometric compounding is path-dependent.
    expect(relDiff(lev2.cum_ret, 2 * base.cum_ret)).toBeGreaterThan(REL_TOL);
  });

  it("max drawdown recomputes path-dependently — NOT 2× the base maxDD", () => {
    const base = compute(RETS, DATES, 0, 365);
    const lev2 = compute(
      RETS.map(r => 2 * r),
      DATES,
      0,
      365,
    );
    expect(relDiff(lev2.max_dd, 2 * base.max_dd)).toBeGreaterThan(REL_TOL);
  });

  it("the ×2 ann_vol scaling ratio is identical for periodsPerYear 365 vs 252 (annualization untouched by L)", () => {
    const scaled = RETS.map(r => 2 * r);
    const ratio365 = compute(scaled, DATES, 0, 365).ann_vol / compute(RETS, DATES, 0, 365).ann_vol;
    const ratio252 = compute(scaled, DATES, 0, 252).ann_vol / compute(RETS, DATES, 0, 252).ann_vol;
    expect(relDiff(ratio365, ratio252)).toBeLessThan(REL_TOL);
  });
});
