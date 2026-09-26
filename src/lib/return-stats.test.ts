/**
 * Contract tests for `src/lib/return-stats.ts`, the ONE TypeScript home of the
 * dispersion-based ratios (Phase 166.1 D-17, carried into Phase 166.2).
 *
 * Why these matter: every Tier-2 TS site that shows a Sharpe, correlation or
 * beta computes it through this module. If the floor drifts from the Python
 * floor, the browser and the analytics service disagree on whether a
 * compounding constant yield has a Sharpe; if the floor widens, real (if tiny)
 * dispersion such as a cent-rounded NAV loses its Sharpe; if it narrows or
 * vanishes, a constant yield shows a Sharpe of 1e12 to 1e14 again.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { mean, stdDev } from "@/lib/portfolio-math-utils";
import {
  DISPERSION_RESIDUE_REL,
  beta,
  dispersion,
  dispersionIsReal,
  dispersionIsResidue,
  pearson,
  residueFloor,
  sharpe,
} from "@/lib/return-stats";
import {
  CONSTANT_YIELDS,
  apyToDaily,
  navConstantYield,
} from "@/__tests__/fixtures/dispersion-nav";

const YIELD_IDS = Object.keys(CONSTANT_YIELDS);
const ZEROS = new Array(366).fill(0);
const CENT_CONTROL = navConstantYield(apyToDaily(0.01), 366, 10_000, true);

/** A deterministic noisy daily-return series (no PRNG, reload-stable). */
function noisy(n: number, phase: number, drift = 0.001): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(drift + 0.02 * Math.sin(i * 1.7 + phase) + 0.005 * Math.cos(i * 0.31 + 2 * phase));
  }
  return out;
}
const NOISY_A = noisy(366, 0.3);
const NOISY_B = noisy(366, 1.1, -0.0005);

describe("the residue floor (the Python rule, verbatim)", () => {
  it("is DISPERSION_RESIDUE_REL for |mean| <= 1 and scales with |mean| above it", () => {
    expect(residueFloor(1e-4)).toBe(1e-12);
    expect(residueFloor(0)).toBe(1e-12);
    expect(Math.abs(residueFloor(-3) - 3e-12) / 3e-12).toBeLessThanOrEqual(1e-12);
    expect(Number.isNaN(residueFloor(NaN))).toBe(true);
  });

  it("classifies 0 as residue and a real sd as real", () => {
    expect(dispersionIsResidue(0, 1e-4)).toBe(true);
    expect(dispersionIsResidue(1.3e-16, 1e-4)).toBe(true);
    expect(dispersionIsReal(0, 1e-4)).toBe(false);
    expect(dispersionIsReal(4.8e-7, 1e-4)).toBe(true);
    expect(dispersionIsResidue(4.8e-7, 1e-4)).toBe(false);
  });

  it("answers false to BOTH predicates on a NaN sd or a NaN mean", () => {
    expect(dispersionIsResidue(NaN, 1e-4)).toBe(false);
    expect(dispersionIsReal(NaN, 1e-4)).toBe(false);
    expect(dispersionIsResidue(1e-16, NaN)).toBe(false);
    expect(dispersionIsReal(1e-16, NaN)).toBe(false);
  });
});

describe("cross-language pin: DISPERSION_RESIDUE_REL equals the Python constant", () => {
  // A NUMERIC-LITERAL definition at column 0 (an optional type annotation
  // allowed). A re-binding whose right-hand side is a name cannot match,
  // because the right-hand side must start with a digit (166.1 D-21 Info 4).
  const DEFINITION = /^_?DISPERSION_RESIDUE_REL\s*(?::[^=]*)?=\s*([0-9][0-9_.eE+-]*)/;
  const PY_FILES = [
    join(process.cwd(), "analytics-service", "services", "dispersion.py"),
    join(process.cwd(), "analytics-service", "services", "metrics.py"),
  ];

  it("the matcher takes a literal definition and refuses a re-binding or an import alias", () => {
    expect(DEFINITION.test("_DISPERSION_RESIDUE_REL = 1e-12")).toBe(true);
    expect(DEFINITION.test("DISPERSION_RESIDUE_REL: float = 1e-12")).toBe(true);
    expect(DEFINITION.test("_DISPERSION_RESIDUE_REL = DISPERSION_RESIDUE_REL")).toBe(false);
    expect(
      DEFINITION.test("from services.dispersion import DISPERSION_RESIDUE_REL as _DISPERSION_RESIDUE_REL"),
    ).toBe(false);
    expect(DEFINITION.test("    _DISPERSION_RESIDUE_REL = 1e-12")).toBe(false);
  });

  it("exactly one numeric-literal definition exists across dispersion.py and metrics.py, equal to the TS constant", () => {
    const hits: string[] = [];
    for (const file of PY_FILES) {
      if (!existsSync(file)) continue;
      for (const line of readFileSync(file, "utf8").split("\n")) {
        if (DEFINITION.test(line)) hits.push(line);
      }
    }
    // 0 means neither file defines it; 2+ means two definitions can drift apart.
    expect(hits, hits.join("\n")).toHaveLength(1);
    const literal = DEFINITION.exec(hits[0])![1].replace(/_/g, "");
    expect(Number(literal)).toBe(DISPERSION_RESIDUE_REL);
  });
});

describe("fixture sanity: the constant yields really are residue, the cent control is not", () => {
  it.each(YIELD_IDS)("%s: 0 < sample sd <= residueFloor(mean)", (id) => {
    const r = navConstantYield(CONSTANT_YIELDS[id]);
    const sd = stdDev(r, true);
    expect(sd).toBeGreaterThan(0);
    expect(sd).toBeLessThanOrEqual(residueFloor(mean(r)));
  });

  it("the cent-rounded 1% APY NAV has an sd above the floor", () => {
    expect(stdDev(CENT_CONTROL, true)).toBeGreaterThan(residueFloor(mean(CENT_CONTROL)));
  });
});

describe("dispersion", () => {
  it.each(YIELD_IDS)("%s: sd is exactly 0 at both ddof, the value an all-zero series gives", (id) => {
    const r = navConstantYield(CONSTANT_YIELDS[id]);
    for (const ddof of [0, 1] as const) {
      const d = dispersion(r, ddof);
      expect(d.sd).toBe(0);
      expect(Object.is(d.sd, dispersion(ZEROS, ddof).sd)).toBe(true);
      expect(d.n).toBe(r.length);
    }
  });

  it("on a noisy series is bitwise mean() and stdDev()", () => {
    for (const ddof of [0, 1] as const) {
      const d = dispersion(NOISY_A, ddof);
      expect(Object.is(d.sd, stdDev(NOISY_A, ddof === 1))).toBe(true);
      expect(Object.is(d.mean, mean(NOISY_A))).toBe(true);
    }
  });

  it("keeps the cent-rounded control's sd, and a NaN sd stays NaN", () => {
    expect(dispersion(CENT_CONTROL, 1).sd).toBeGreaterThan(0);
    expect(Number.isNaN(dispersion([0.01, NaN, 0.02], 1).sd)).toBe(true);
  });
});

describe("sharpe", () => {
  it.each(YIELD_IDS)("%s: null at both ddof, as for the all-zero series", (id) => {
    const r = navConstantYield(CONSTANT_YIELDS[id]);
    for (const ddof of [0, 1] as const) {
      expect(sharpe(r, { periodsPerYear: 365, ddof })).toBeNull();
      expect(sharpe(ZEROS, { periodsPerYear: 365, ddof })).toBeNull();
    }
  });

  it("is null for fewer than 2 points and for a series holding a NaN or an Infinity", () => {
    expect(sharpe([0.01], { periodsPerYear: 252, ddof: 1 })).toBeNull();
    expect(sharpe([], { periodsPerYear: 252, ddof: 0 })).toBeNull();
    expect(sharpe([0.01, NaN, 0.02], { periodsPerYear: 252, ddof: 1 })).toBeNull();
    expect(sharpe([0.01, Infinity, 0.02], { periodsPerYear: 252, ddof: 0 })).toBeNull();
  });

  it("is finite on the cent-rounded control (widening the floor goes red)", () => {
    const s = sharpe(CENT_CONTROL, { periodsPerYear: 365, ddof: 1 });
    expect(s).not.toBeNull();
    expect(Number.isFinite(s!)).toBe(true);
  });

  it("on a noisy series equals the factsheet compute.ts expression, bitwise", () => {
    for (const ddof of [0, 1] as const) {
      for (const [N, rf] of [[365, 0], [252, 0.04]] as const) {
        const m = mean(NOISY_A);
        const s = stdDev(NOISY_A, ddof === 1);
        const expected = ((m - rf / N) * N) / (s * Math.sqrt(N));
        expect(Object.is(sharpe(NOISY_A, { periodsPerYear: N, ddof, rf }), expected)).toBe(true);
      }
    }
  });
});

describe("pearson", () => {
  it.each(YIELD_IDS)("%s: null when either leg is the constant yield, as for an all-zero leg", (id) => {
    const r = navConstantYield(CONSTANT_YIELDS[id]);
    expect(pearson(r, NOISY_A)).toBeNull();
    expect(pearson(NOISY_A, r)).toBeNull();
    expect(pearson(ZEROS, NOISY_A)).toBeNull();
    expect(pearson(NOISY_A, ZEROS)).toBeNull();
  });

  it("is null for fewer than 2 points and for a NaN leg", () => {
    expect(pearson([0.01], [0.02])).toBeNull();
    expect(pearson([], [])).toBeNull();
    expect(pearson([0.01, NaN, 0.03], [0.02, 0.01, 0.05])).toBeNull();
  });

  it("on two noisy legs is in [-1, 1] and equals the textbook Pearson within 1e-12", () => {
    const rho = pearson(NOISY_A, NOISY_B)!;
    const ma = mean(NOISY_A);
    const mb = mean(NOISY_B);
    let cov = 0;
    for (let i = 0; i < NOISY_A.length; i++) cov += (NOISY_A[i] - ma) * (NOISY_B[i] - mb);
    cov /= NOISY_A.length;
    const textbook = cov / (stdDev(NOISY_A, false) * stdDev(NOISY_B, false));
    expect(rho).toBeGreaterThanOrEqual(-1);
    expect(rho).toBeLessThanOrEqual(1);
    expect(Math.abs(rho - textbook)).toBeLessThan(1e-12);
    expect(pearson(NOISY_A, NOISY_A)).toBeCloseTo(1, 12);
  });

  it("uses the first min(a, b) points", () => {
    expect(pearson(NOISY_A, NOISY_B.slice(0, 100))).toBe(
      pearson(NOISY_A.slice(0, 100), NOISY_B.slice(0, 100)),
    );
  });

  it("is finite for the cent-rounded control against noise", () => {
    const rho = pearson(CENT_CONTROL, NOISY_A);
    expect(rho).not.toBeNull();
    expect(Number.isFinite(rho!)).toBe(true);
  });
});

describe("beta", () => {
  it.each(YIELD_IDS)("%s: null when x is the constant yield, as for an all-zero x", (id) => {
    const r = navConstantYield(CONSTANT_YIELDS[id]);
    expect(beta(NOISY_A, r)).toBeNull();
    expect(beta(NOISY_A, ZEROS)).toBeNull();
  });

  it("on noisy legs equals cov / var with both sums divided by n, bitwise", () => {
    const n = NOISY_A.length;
    const my = mean(NOISY_A);
    const mx = mean(NOISY_B);
    let cov = 0;
    let varX = 0;
    for (let i = 0; i < n; i++) {
      cov += (NOISY_A[i] - my) * (NOISY_B[i] - mx);
      varX += (NOISY_B[i] - mx) * (NOISY_B[i] - mx);
    }
    expect(Object.is(beta(NOISY_A, NOISY_B), cov / n / (varX / n))).toBe(true);
  });

  it("is null for fewer than 2 points, and refuses unequal lengths loudly", () => {
    expect(beta([0.01], [0.02])).toBeNull();
    expect(() => beta([0.01, 0.02], [0.01])).toThrow(RangeError);
  });
});
