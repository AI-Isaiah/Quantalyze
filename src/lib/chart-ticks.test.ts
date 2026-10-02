import { describe, it, expect, vi, afterEach } from "vitest";
import {
  TICK_SNAP_RATIO,
  decimalExponent,
  niceStepValues,
  pow10,
  tickTolerance,
} from "./chart-ticks";

/**
 * Phase 169.1.1 HYDRATIONTICKS. The tick helper must produce the same values on
 * the server (Node 22) and in the browser (Chromium 153), whose native power of
 * ten and base-10 logarithm differ by an ulp on some inputs. vitest runs in
 * Node only, so each engine's behaviour is reproduced with a stub regime:
 *   - native: whatever the host engine does;
 *   - Chromium-exact: base 10 with an integer exponent is correctly rounded;
 *   - Node-inexact: exponents -4 and -5 return Node 22's one-ulp-low values;
 *   - log10 shifted one ulp up, and one ulp down.
 * The control arm below runs the PRE-FIX algorithm under the same regimes and
 * proves they reproduce the real divergence. Without it, every regime test
 * could pass vacuously on a host whose power of ten happens to be exact.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

/** The padded y-domain of the seeded daily-returns chart that raised React #418. */
const MEASURED_LO = -0.0007464848689590031;
const MEASURED_HI = 0.0007465259385667178;

/** Node 22's one-ulp-low powers of ten. */
const NODE_INEXACT: Record<number, number> = {
  [-4]: 9.999999999999999e-5,
  [-5]: 9.999999999999999e-6,
};

type Regime = "native" | "chromium-exact" | "node-inexact" | "log10-up" | "log10-down";
const REGIMES: Regime[] = ["native", "chromium-exact", "node-inexact", "log10-up", "log10-down"];

/** Run `fn` with the power and log10 functions behaving as `regime` describes. */
function underRegime<T>(regime: Regime, fn: () => T): T {
  const realPow = Math.pow;
  const realLog10 = Math.log10;
  if (regime === "chromium-exact" || regime === "node-inexact") {
    vi.spyOn(Math, "pow").mockImplementation((base: number, exp: number) => {
      if (base === 10 && Number.isInteger(exp)) {
        if (regime === "chromium-exact") return Number(`1e${exp}`);
        if (exp in NODE_INEXACT) return NODE_INEXACT[exp];
      }
      return realPow(base, exp);
    });
  } else if (regime === "log10-up") {
    vi.spyOn(Math, "log10").mockImplementation((x: number) => realLog10(x) * (1 + Number.EPSILON));
  } else if (regime === "log10-down") {
    vi.spyOn(Math, "log10").mockImplementation((x: number) => realLog10(x) * (1 - Number.EPSILON / 2));
  }
  try {
    return fn();
  } finally {
    vi.restoreAllMocks();
  }
}

/** Equal length and `Object.is` per index (so -0 and +0 are different). */
function expectSameValues(actual: readonly number[], expected: readonly number[], what: string) {
  expect(actual.length, `${what}: length`).toBe(expected.length);
  actual.forEach((v, i) => {
    expect(Object.is(v, expected[i]), `${what}: index ${i} ${v} vs ${expected[i]}`).toBe(true);
  });
}

/** Verbatim copy of the tick body TimeSeriesChart used before this phase. */
function legacyNiceValues(lo: number, hi: number): number[] {
  const span = hi - lo;
  const rough = span / 5;
  const magnitude = Math.pow(10, Math.floor(Math.log10(Math.abs(rough)) || 0));
  const normalized = rough / magnitude;
  let nice: number;
  if (normalized < 1.5) nice = 1;
  else if (normalized < 3) nice = 2;
  else if (normalized < 7) nice = 5;
  else nice = 10;
  const step = nice * magnitude;
  const start = Math.ceil(lo / step) * step;
  const out: number[] = [];
  for (let v = start; v <= hi + step * 0.001 && out.length < 12; v += step) {
    out.push(v);
  }
  return out;
}

/** The tick nearest zero (the one the snap is about). */
function nearestZero(values: readonly number[]): number {
  return values.reduce((best, v) => (Math.abs(v) < Math.abs(best) ? v : best));
}

describe("control: pre-fix algorithm diverges between Node and Chromium regimes", () => {
  it("the legacy zero tick is exact 0 under Node-inexact and -5.42e-20 under Chromium-exact", () => {
    const server = underRegime("node-inexact", () => legacyNiceValues(MEASURED_LO, MEASURED_HI));
    const browser = underRegime("chromium-exact", () => legacyNiceValues(MEASURED_LO, MEASURED_HI));
    expect(Object.is(nearestZero(server), 0)).toBe(true);
    expect(nearestZero(browser)).toBe(-5.421010862427522e-20);
    const identical =
      server.length === browser.length && server.every((v, i) => Object.is(v, browser[i]));
    expect(identical, "the regimes must reproduce the measured divergence").toBe(false);
  });
});

describe("niceStepValues is engine-independent", () => {
  it("returns Object.is-identical arrays for the measured span under every regime", () => {
    const reference = underRegime("native", () => niceStepValues(MEASURED_LO, MEASURED_HI, 5, 12, 0));
    expect(reference.length).toBeGreaterThanOrEqual(3);
    for (const regime of REGIMES) {
      const got = underRegime(regime, () => niceStepValues(MEASURED_LO, MEASURED_HI, 5, 12, 0));
      expectSameValues(got, reference, regime);
    }
  });

  it("emits the measured span's zero crossing as positive zero", () => {
    const values = niceStepValues(MEASURED_LO, MEASURED_HI, 5, 12, 0);
    const zeroIdx = values.findIndex((v) => Math.abs(v) < 1e-12);
    expect(zeroIdx).toBeGreaterThan(0);
    expect(Object.is(values[zeroIdx], 0)).toBe(true);
  });

  it("keeps every non-zero tick equal to the pre-fix Chromium output (no visible label change)", () => {
    const browserToday = underRegime("chromium-exact", () => legacyNiceValues(MEASURED_LO, MEASURED_HI));
    const fixed = niceStepValues(MEASURED_LO, MEASURED_HI, 5, 12, 0);
    expect(fixed.length).toBe(browserToday.length);
    fixed.forEach((v, i) => {
      if (v !== 0) expect(Object.is(v, browserToday[i]), `index ${i}`).toBe(true);
    });
  });

  it("still returns when the native power and log10 functions throw", () => {
    vi.spyOn(Math, "pow").mockImplementation(() => {
      throw new Error("Math.pow must not be called");
    });
    vi.spyOn(Math, "log10").mockImplementation(() => {
      throw new Error("Math.log10 must not be called");
    });
    expect(niceStepValues(MEASURED_LO, MEASURED_HI, 5, 12, 0).length).toBeGreaterThan(0);
    expect(pow10(-4)).toBe(0.0001);
    expect(decimalExponent(2.986e-4)).toBe(-4);
  });
});

describe("pow10 and decimalExponent", () => {
  it("pow10 parses the decimal literal for every exponent in -30..30", () => {
    for (let n = -30; n <= 30; n++) {
      expect(pow10(n), `n=${n}`).toBe(Number(`1e${n}`));
    }
    expect(pow10(-4)).toBe(0.0001);
    expect(pow10(-5)).toBe(0.00001);
  });

  it("decimalExponent reads the exponent of |x|, and 0 for zero and non-finite input", () => {
    expect(decimalExponent(2.986e-4)).toBe(-4);
    expect(decimalExponent(-2.986e-4)).toBe(-4);
    expect(decimalExponent(12345)).toBe(4);
    expect(decimalExponent(0)).toBe(0);
    expect(decimalExponent(Infinity)).toBe(0);
    expect(decimalExponent(-Infinity)).toBe(0);
    expect(decimalExponent(NaN)).toBe(0);
  });
});

describe("niceStepValues shape (TK-5 / TK-6)", () => {
  // One domain per nice-step branch (1, 2, 5, 10), plus the measured span.
  const DOMAINS: [number, number][] = [
    [0, 5], // rough 1 -> nice 1
    [MEASURED_LO, MEASURED_HI], // rough 2.99e-4 -> nice 2
    [-3, 17], // rough 4 -> nice 5
    [-10, 30], // rough 8 -> nice 10
    [0.9993, 1.0007],
    [-123.4, 5678.9],
  ];

  for (const cap of [12, 8]) {
    for (const [lo, hi] of DOMAINS) {
      it(`[${lo}, ${hi}] cap ${cap}: ascending, unique, inside the domain, at most cap`, () => {
        const values = niceStepValues(lo, hi, 5, cap, 0);
        expect(values.length).toBeGreaterThan(1);
        expect(values.length).toBeLessThanOrEqual(cap);
        const step = values[1] - values[0];
        for (let i = 1; i < values.length; i++) {
          expect(values[i], `strictly ascending at ${i}`).toBeGreaterThan(values[i - 1]);
        }
        expect(new Set(values).size).toBe(values.length);
        expect(values[0]).toBeGreaterThanOrEqual(lo);
        expect(values[values.length - 1]).toBeLessThanOrEqual(hi + step * 0.001);
        for (const v of values) expect(Object.is(v, -0), "never -0").toBe(false);
      });
    }
  }

  it("returns [] for an empty or inverted domain and for non-finite bounds", () => {
    expect(niceStepValues(1, 1, 5, 12)).toEqual([]);
    expect(niceStepValues(2, 1, 5, 12)).toEqual([]);
    expect(niceStepValues(-Infinity, 1, 5, 12)).toEqual([]);
    expect(niceStepValues(0, Infinity, 5, 12)).toEqual([]);
    expect(niceStepValues(NaN, 1, 5, 12)).toEqual([]);
  });

  it("emits positive zero when the start lands on -0", () => {
    // lo / step is in (-1, 0), so the first multiple of the step is -0.
    expect(Object.is(Math.ceil(-0.1 / 1) * 1, -0), "the start really is -0").toBe(true);
    const values = niceStepValues(-0.1, 5, 5, 12, 0);
    expect(Object.is(values[0], 0)).toBe(true);
  });
});

describe("niceStepValues anchor 1 (growth charts)", () => {
  it("snaps the tick at par to exactly 1 and moves no other tick", () => {
    // A growth-style domain whose accumulated tick at par lands one ulp below 1
    // with anchor 0 (measured), so the snap has something to do.
    const lo = 0.9989991;
    const hi = 1.0003027;
    const atZeroAnchor = niceStepValues(lo, hi, 5, 12, 0);
    const atParAnchor = niceStepValues(lo, hi, 5, 12, 1);
    expect(atParAnchor.length).toBe(atZeroAnchor.length);
    const parIdx = atParAnchor.findIndex((v) => Math.abs(v - 1) < 1e-12);
    expect(parIdx).toBeGreaterThanOrEqual(0);
    expect(atZeroAnchor[parIdx], "anchor 0 leaves the par tick off 1").not.toBe(1);
    expect(atParAnchor[parIdx]).toBe(1);
    atParAnchor.forEach((v, i) => {
      if (i !== parIdx) expect(Object.is(v, atZeroAnchor[i]), `index ${i}`).toBe(true);
    });
  });
});

describe("tickTolerance", () => {
  it("is 0 for fewer than two values", () => {
    expect(tickTolerance([])).toBe(0);
    expect(tickTolerance([5])).toBe(0);
  });

  it("is the smallest positive gap times the snap ratio", () => {
    const tol = tickTolerance([-0.0004, -0.0002, 0, 0.0002, 0.0004]);
    expect(tol).toBeCloseTo(2e-10, 20);
    expect(TICK_SNAP_RATIO).toBe(1e-6);
  });

  it("ignores repeated values when finding the smallest gap", () => {
    expect(tickTolerance([1, 1, 3])).toBe(2 * TICK_SNAP_RATIO);
  });
});
