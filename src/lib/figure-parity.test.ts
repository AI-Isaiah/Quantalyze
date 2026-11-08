/**
 * 194 plan 02 (D-02 / D-03, TRUST-04): the TS half of the cross-language figure
 * parity. The expected values in `figure_parity_vectors.json` are hand-derived by
 * independent invariant (known worst values, closed-form windows); neither
 * implementation produced them. `analytics-service/tests/test_figure_parity.py`
 * reads the SAME file, so a drift between `_historical_var_cvar` and
 * `historicalVarCvar` fails one of the two suites.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { compute, SIX_MONTH_WINDOW_DAYS, THREE_MONTH_WINDOW_DAYS } from "@/lib/factsheet/compute";
import { historicalVarCvar } from "@/lib/return-stats";

interface VarVector {
  name: string;
  returns: number[];
  expected_var: number;
  expected_cvar: number;
}
interface WindowVector {
  name: string;
  dates: string[];
  returns: number[];
  weekday: boolean;
  method: "geometric" | "simple";
  expected_6m: number | null;
  expected_3m: number | null;
}
interface Vectors {
  var_cvar: VarVector[];
  windows: WindowVector[];
}

const FIXTURE = resolve(process.cwd(), "analytics-service/tests/fixtures/figure_parity_vectors.json");
const vectors = JSON.parse(readFileSync(FIXTURE, "utf8")) as Vectors;

describe("historicalVarCvar against the shared fixture (D-02)", () => {
  it("has the four hand-derived vectors", () => {
    expect(vectors.var_cvar.map((v) => v.name)).toEqual([
      "n200_k10_ten_worst",
      "n37_k1",
      "n12_k0",
      "n40_k2_tied_minima",
    ]);
  });

  for (const v of vectors.var_cvar) {
    it(`matches the hand-derived pair: ${v.name}`, () => {
      const r = historicalVarCvar(v.returns);
      expect(r.var).toBeCloseTo(v.expected_var, 12);
      expect(r.cvar).toBeCloseTo(v.expected_cvar, 12);
    });
  }

  it("gives nulls for no finite return", () => {
    expect(historicalVarCvar([])).toEqual({ var: null, cvar: null });
    expect(historicalVarCvar([Number.NaN])).toEqual({ var: null, cvar: null });
  });
});

describe("3M / 6M windows against the shared fixture (D-03)", () => {
  for (const v of vectors.windows) {
    it(`matches the hand-derived windows: ${v.name}`, () => {
      const r = compute(v.returns, v.dates, 0, v.weekday ? 252 : 365, {
        cumulativeMethod: v.method === "simple" ? "arithmetic" : "geometric",
      });
      for (const [got, want] of [
        [r.p6m, v.expected_6m],
        [r.p3m, v.expected_3m],
      ] as const) {
        if (want === null) expect(got).toBeNull();
        else expect(got).toBeCloseTo(want, 12);
      }
    });
  }
});

describe("window constants are the Python constants (read as text)", () => {
  const py = readFileSync(resolve(process.cwd(), "analytics-service/services/metrics.py"), "utf8");
  const once = (re: RegExp) => {
    const m = py.match(re);
    expect(m).not.toBeNull();
    return Number((m as RegExpMatchArray)[1]);
  };

  it("SIX_MONTH_WINDOW_DAYS appears once and equals the engine constant", () => {
    expect(py.match(/^SIX_MONTH_WINDOW_DAYS = \d+$/gm)).toHaveLength(1);
    expect(once(/^SIX_MONTH_WINDOW_DAYS = (\d+)$/m)).toBe(SIX_MONTH_WINDOW_DAYS);
    expect(SIX_MONTH_WINDOW_DAYS).toBe(182);
  });

  it("THREE_MONTH_WINDOW_DAYS appears once and equals the engine constant", () => {
    expect(py.match(/^THREE_MONTH_WINDOW_DAYS = \d+$/gm)).toHaveLength(1);
    expect(once(/^THREE_MONTH_WINDOW_DAYS = (\d+)$/m)).toBe(THREE_MONTH_WINDOW_DAYS);
    expect(THREE_MONTH_WINDOW_DAYS).toBe(91);
  });
});
