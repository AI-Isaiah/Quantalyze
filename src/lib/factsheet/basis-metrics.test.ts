import { describe, it, expect } from "vitest";
import {
  hasAllBasisScalars,
  overlayMtmScalars,
  overlayBasisScalars,
} from "./basis-metrics";

/**
 * Phase 90 review-fix (F1 + F2) — the ONE availability criterion + the STRICT
 * MTM display overlay that together close the "partial persist shows cash under
 * an MTM label / composite renders client-geometric headline" no-invented-data
 * gaps.
 *
 * These are the decision predicates the two server gates in page.tsx call:
 *   - F1: a composite whose persisted `cash_settlement` fails
 *     `hasAllBasisScalars` ⇒ page returns null (still-computing placeholder),
 *     never a client-geometric headline.
 *   - F2: `mark_to_market` must pass `hasAllBasisScalars` for the toggle to
 *     enable; the display overlay renders "—" (NaN) for any missing scalar.
 */

const FULL = {
  cumulative_return: 0.6266,
  volatility: 0.12,
  max_drawdown: -0.041,
  cagr: 0.31,
  sharpe: 1.4,
  sortino: 2.1,
  calmar: 3.0,
};

describe("F1/F2 hasAllBasisScalars — the single availability criterion", () => {
  it("true only when all seven mapped scalars are finite numbers", () => {
    expect(hasAllBasisScalars(FULL)).toBe(true);
  });

  it("false for null / undefined / non-object (metrics_json_by_basis NULL)", () => {
    expect(hasAllBasisScalars(null)).toBe(false);
    expect(hasAllBasisScalars(undefined)).toBe(false);
    expect(hasAllBasisScalars("cash")).toBe(false);
    expect(hasAllBasisScalars(42)).toBe(false);
  });

  it("false for the empty object (present-but-empty MTM basis)", () => {
    expect(hasAllBasisScalars({})).toBe(false);
  });

  it("false when ANY one of the seven is missing (partial persist)", () => {
    for (const drop of Object.keys(FULL)) {
      const partial = { ...FULL } as Record<string, number>;
      delete partial[drop];
      expect(hasAllBasisScalars(partial), `missing ${drop}`).toBe(false);
    }
  });

  it("false when a scalar is present but non-finite (NaN / Infinity / null)", () => {
    expect(hasAllBasisScalars({ ...FULL, sharpe: NaN })).toBe(false);
    expect(hasAllBasisScalars({ ...FULL, sharpe: Infinity })).toBe(false);
    expect(hasAllBasisScalars({ ...FULL, sharpe: null })).toBe(false);
  });
});

describe("F2 overlayMtmScalars — STRICT: missing MTM scalar → NaN, never cash", () => {
  // Base = the cash strategyMetrics the KpiStrip shows on the cash basis.
  const cashBase = {
    cum_ret: 0.6266,
    ann_vol: 0.12,
    max_dd: -0.041,
    cagr: 0.31,
    sharpe: 1.4,
    sortino: 2.1,
    calmar: 3.0,
    n: 300,
    skew: -0.2,
  };

  it("a partial MTM object renders NaN (→ '—') for every ABSENT scalar, never the cash value", () => {
    // Only cumulative_return present in MTM; the other six are absent.
    const out = overlayMtmScalars(cashBase, { cumulative_return: 0.5 });
    expect(out.cum_ret).toBe(0.5); // present MTM value used
    // The six absent scalars must NOT inherit the cash value — they become NaN.
    expect(Number.isNaN(out.ann_vol)).toBe(true);
    expect(Number.isNaN(out.max_dd)).toBe(true);
    expect(Number.isNaN(out.cagr)).toBe(true);
    expect(Number.isNaN(out.sharpe)).toBe(true);
    expect(Number.isNaN(out.sortino)).toBe(true);
    expect(Number.isNaN(out.calmar)).toBe(true);
    // Regression assertion: the pre-fix `?? {}` + finite-skip left the cash
    // values here (e.g. out.sharpe === 1.4) — a cash number under an MTM label.
    expect(out.sharpe).not.toBe(1.4);
  });

  it("null / undefined MTM object → all seven mapped scalars NaN", () => {
    for (const mtm of [undefined, null]) {
      const out = overlayMtmScalars(cashBase, mtm);
      expect(Number.isNaN(out.cum_ret)).toBe(true);
      expect(Number.isNaN(out.sharpe)).toBe(true);
    }
  });

  it("preserves every NON-mapped key (n, distributional stats) from the cash base", () => {
    const out = overlayMtmScalars(cashBase, { cumulative_return: 0.5 });
    expect(out.n).toBe(300);
    expect(out.skew).toBe(-0.2);
  });

  it("a full MTM object overlays all seven mapped values verbatim", () => {
    const MTM = {
      cumulative_return: 0.5,
      volatility: 0.11,
      max_drawdown: -0.038,
      cagr: 0.26,
      sharpe: 1.2,
      sortino: 1.9,
      calmar: 2.7,
    };
    const out = overlayMtmScalars(cashBase, MTM);
    expect(out.cum_ret).toBe(0.5);
    expect(out.ann_vol).toBe(0.11);
    expect(out.max_dd).toBe(-0.038);
    expect(out.cagr).toBe(0.26);
    expect(out.sharpe).toBe(1.2);
    expect(out.sortino).toBe(1.9);
    expect(out.calmar).toBe(2.7);
  });

  it("CONTRAST: overlayBasisScalars (cash overlay) still KEEPS the base value for an absent scalar", () => {
    // The cash overlay must NOT change behavior (byte-identical for the D3 path):
    // an absent scalar leaves the coherent cash base value untouched.
    const out = overlayBasisScalars(cashBase, { cumulative_return: 0.5 });
    expect(out.cum_ret).toBe(0.5);
    expect(out.sharpe).toBe(1.4); // unchanged, NOT NaN
  });
});
