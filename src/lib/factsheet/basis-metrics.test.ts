import { describe, it, expect } from "vitest";
import { hasBasisHeadline, overlayBasisScalars } from "./basis-metrics";

/**
 * Round-2 H-1/M-1 — the availability criterion + the STRICT by-basis overlay.
 *
 * The intent CHANGED from Round 1 (`hasAllBasisScalars` = all-seven-finite): a
 * degenerate-but-valid composite persists JSON `null` for `calmar`/`sortino`/
 * `sharpe` (Python `_safe_float` on max_dd==0 / no-loss / zero-variance). Those
 * must RENDER (with the null scalar shown as "—"), not blank the whole page.
 * The new gate keys on the invariance-critical `cumulative_return` being finite
 * plus structural key-presence; the overlay renders every null/non-finite mapped
 * scalar as "—" (NaN), never the client-computed fallback.
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

describe("H-1/M-1 hasBasisHeadline — object + all-keys-present + finite headline", () => {
  it("true for a full finite object", () => {
    expect(hasBasisHeadline(FULL)).toBe(true);
  });

  it("true for a DEGENERATE object: all 7 keys present, cumulative_return finite, other scalars null", () => {
    // The regression this encodes: a young all-positive composite persists
    // calmar:null (max_dd==0) and sortino:null (no losing day). It MUST render.
    expect(hasBasisHeadline({ ...FULL, calmar: null, sortino: null })).toBe(true);
    expect(hasBasisHeadline({ ...FULL, sharpe: null })).toBe(true);
  });

  it("false for null / undefined / non-object (metrics_json_by_basis NULL)", () => {
    expect(hasBasisHeadline(null)).toBe(false);
    expect(hasBasisHeadline(undefined)).toBe(false);
    expect(hasBasisHeadline("cash")).toBe(false);
    expect(hasBasisHeadline(42)).toBe(false);
  });

  it("false for the empty object (no headline)", () => {
    expect(hasBasisHeadline({})).toBe(false);
  });

  it("false when the invariance-critical cumulative_return is missing or non-finite", () => {
    const { cumulative_return: _drop, ...noCr } = FULL;
    expect(hasBasisHeadline(noCr)).toBe(false); // key structurally absent
    expect(hasBasisHeadline({ ...FULL, cumulative_return: null })).toBe(false);
    expect(hasBasisHeadline({ ...FULL, cumulative_return: NaN })).toBe(false);
    expect(hasBasisHeadline({ ...FULL, cumulative_return: Infinity })).toBe(false);
  });

  it("false when a NON-headline mapped key is structurally MISSING (not merely null)", () => {
    const { calmar: _drop, ...noCalmar } = FULL;
    expect(hasBasisHeadline(noCalmar)).toBe(false);
  });
});

describe("H-1 overlayBasisScalars — STRICT: null/non-finite scalar → NaN, never client value", () => {
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

  it("ABSENT serverScalars → base UNCHANGED (single-key / non-composite byte-identity)", () => {
    expect(overlayBasisScalars(cashBase, undefined)).toBe(cashBase);
    expect(overlayBasisScalars(cashBase, null)).toBe(cashBase);
  });

  it("a degenerate persisted scalar (calmar:null) renders NaN (→ '—'), NOT the client value", () => {
    const out = overlayBasisScalars(cashBase, { ...FULL, calmar: null });
    expect(out.cum_ret).toBe(0.6266);
    expect(Number.isNaN(out.calmar)).toBe(true);
    // Anti-regression: a lenient overlay would have kept the client calmar 3.0.
    expect(out.calmar).not.toBe(3.0);
  });

  it("a partial object renders NaN for every ABSENT mapped scalar", () => {
    const out = overlayBasisScalars(cashBase, { cumulative_return: 0.5 });
    expect(out.cum_ret).toBe(0.5);
    expect(Number.isNaN(out.ann_vol)).toBe(true);
    expect(Number.isNaN(out.sharpe)).toBe(true);
    expect(Number.isNaN(out.calmar)).toBe(true);
    expect(out.sharpe).not.toBe(1.4);
  });

  it("preserves every NON-mapped key (n, distributional stats)", () => {
    const out = overlayBasisScalars(cashBase, FULL);
    expect(out.n).toBe(300);
    expect(out.skew).toBe(-0.2);
  });

  it("a full object overlays all seven mapped values verbatim", () => {
    const out = overlayBasisScalars(cashBase, FULL);
    expect(out.cum_ret).toBe(0.6266);
    expect(out.ann_vol).toBe(0.12);
    expect(out.max_dd).toBe(-0.041);
    expect(out.cagr).toBe(0.31);
    expect(out.sharpe).toBe(1.4);
    expect(out.sortino).toBe(2.1);
    expect(out.calmar).toBe(3.0);
  });
});
