/**
 * Phase 236 plan 08 (FIG-02): the TypeScript half of the cross-engine annualization parity.
 *
 * `analytics-service/tests/fixtures/annualization_parity_vectors.json` is read by this file AND
 * by `analytics-service/tests/test_annualization_parity.py`. Its expected values are CLOSED
 * FORMS, derived from math in each vector's `_comment` and written into the JSON, never produced
 * by an engine.
 *
 * THE ORACLE IMPORTS NO PRODUCTION HELPER. The series generator, the loop recompute (mean,
 * sample sd, product, span) and the closed forms below use only `Date`, `Math` and plain loops,
 * and the constants they need (365, the pair, the periods) are written out here, not read from
 * `figure-conventions` or `calendarYears`. The engines are imported for the act of being
 * measured and for nothing else (precedent: `calendarYearsIndep` in `scenario.test.ts` and the
 * "deliberately NOT importing any production helper" block of `metrics-parity.test.ts`).
 *
 * THE SERIES. The repeating pair `[+0.02, -0.01]` over an even `n`, phase 0:
 *   - mean = 0.005 exactly (each pair sums to 0.01);
 *   - every deviation is +-0.015, so the sum of squares is `n * 0.015^2` and the SAMPLE sd
 *     (ddof 1) is `0.015 * sqrt(n / (n - 1))`;
 *   - Sharpe = `mean / sd * sqrt(P)`, P the frequency clock (crypto 365, traditional 252);
 *   - TWR = `(1.02 * 0.99)^(n / 2) - 1`;
 *   - CAGR = `(1 + TWR)^(365 / span) - 1`, span = whole days from the first to the last observed
 *     date of the SAME suffix (Q1: an emptied stretch stays in the span).
 *
 * THE TOLERANCE. `rtol = 1e-9`, `atol = 0`, derived and never set by running an engine. Every
 * engine evaluates these same closed forms, so a difference between two of them is float
 * summation order and nothing else. The mean of `n` terms carries a relative error of at most
 * `n * eps`; with `n <= 2000` and `eps = 2.2e-16` that is at most 4.4e-13. The sample sd divides
 * one such sum by `n - 1` and square-roots it, which halves the relative error. A Sharpe is a
 * quotient of two quantities that each carry that bound, so at most about 1e-12. The wealth ratio
 * `1 + TWR` is a product of `n` factors and carries at most `n * eps`. CAGR raises it to
 * `365 / span`; on these vectors the exponent is at most 365 / 299 = 1.22, so the relative error
 * is amplified by at most that, plus the `(1 + T) / T` factor of subtracting 1 (`T >= 3.3` here,
 * so at most 1.31). A conservative total is 5.3e-12 for every metric. `1e-9` leaves more than
 * 100x headroom over that bound and is far below any convention move: ddof 0 instead of 1 shifts
 * a Sharpe by `1 / (2 * (n - 1))` (at n = 730, 6.9e-4), and 252 instead of 365 by a factor 1.2.
 * A miss outside 1e-9 is therefore a convention divergence between engines. It is reported, and
 * the tolerance is NEVER widened to absorb it.
 *
 * ENGINES THAT ROUND THEIR OWN OUTPUT. `computeScenario` returns `twr` and `cagr` through
 * `toFixed(5)` and `sharpe` through `toFixed(3)`, and `sampleBasisRatios` returns `sharpe`
 * through `toFixed(3)`: a 1e-9 relative comparison against a rounded number cannot hold, and
 * loosening it to the rounding step would be exactly the widening the rule forbids. These are
 * compared by EXACT equality with the oracle rounded the same way (`Number(oracle.toFixed(k))`),
 * which is stricter than any tolerance on the unrounded value, plus a guard arm that the oracle
 * sits further from a rounding tie than the derived float bound, so a 1e-12 summation-order
 * difference can never flip the rounded digit. The unrounded math under `sampleBasisRatios` is
 * the shared `return-stats` `sharpe`, which has its own arm at the full 1e-9.
 *
 * THE BROKEN CHAIN. The payload builder hands the TS engines the post-break suffix
 * (`headlineCoversFrom`), so `tsEngineInput` below does the same, and an arm pins that its first
 * date is the post-break date and its length the suffix length. A second arm proves that feeding
 * the FULL chain to `compute()` does NOT reproduce the oracle's suffix CAGR, so an input helper
 * that silently feeds the full chain fails.
 *
 * OUT OF SCOPE (F-2 and the plan): composite paths are not compared, and no vector uses an
 * unknown-asset-class leg (Python and TypeScript disagree on the unknown class: 252 vs 365).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { analyzeSignedReturns } from "@/app/(dashboard)/compare/lib/holding-compare-adapter";
import { annualizationPeriods, blendPeriodsPerYear } from "@/lib/closed-sets";
import { compute } from "@/lib/factsheet/compute";
import { computeOgHeadline } from "@/lib/factsheet/og-metrics";
import { sharpe as sharedSharpe } from "@/lib/return-stats";
import { sampleBasisRatios } from "@/lib/sample-basis-ratios";
import {
  buildDateMapCache,
  computeScenario,
  type ScenarioState,
  type StrategyForBuilder,
} from "@/lib/scenario";

const RTOL = 1e-9;
const ATOL = 0;
const DAY_MS = 86_400_000;
// The oracle's own constant, written out: the oracle shares no code with what it checks.
const DAYS_PER_YEAR = 365;

type Expected = {
  mean: number;
  sd: number;
  sharpe: number;
  twr: number;
  cagr: number;
  n: number;
  span_days: number;
  suffix_first_date?: string;
  suffix_len?: number;
  break_date?: string;
};

type Vector = {
  name: string;
  asset_class: "crypto" | "traditional";
  periods_per_year: number;
  start: string;
  calendar: "daily" | "weekdays";
  pattern: [number, number];
  n: number;
  pre_break?: { pattern: [number, number]; n: number };
  gap?: { after_obs: number; days: number };
  expected: Expected;
};

const FIXTURE_PATH = join(
  __dirname,
  "..",
  "..",
  "analytics-service",
  "tests",
  "fixtures",
  "annualization_parity_vectors.json",
);
const VECTORS: Vector[] = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")).vectors;
const byName = (name: string): Vector => {
  const v = VECTORS.find((x) => x.name === name);
  if (!v) throw new Error(`vector ${name} is not in the fixture`);
  return v;
};
const NAMES = VECTORS.map((v) => v.name);

// ---------------------------------------------------------------------------------------
// The oracle: series generator, loop recompute, closed forms. No production import.
// ---------------------------------------------------------------------------------------

type Row = { date: string; value: number | null };

const isoOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Every dated row of the vector in order. `null` is the NaN day of an interior break. */
function buildChain(vec: Vector): Row[] {
  let cur = Date.parse(vec.start);
  const weekdaysOnly = vec.calendar === "weekdays";
  if (weekdaysOnly && [0, 6].includes(new Date(cur).getUTCDay())) {
    throw new Error("a weekday vector must start on a weekday");
  }
  const rows: Row[] = [];
  const emit = (value: number | null): void => {
    rows.push({ date: isoOf(cur), value });
    cur += DAY_MS;
    while (weekdaysOnly && [0, 6].includes(new Date(cur).getUTCDay())) cur += DAY_MS;
  };
  if (vec.pre_break) {
    for (let i = 0; i < vec.pre_break.n; i++) emit(vec.pre_break.pattern[i % 2]);
    emit(null); // the break: a present date carrying no return
  }
  for (let i = 0; i < vec.n; i++) {
    // an emptied stretch: NO row, never a NaN
    if (vec.gap && i === vec.gap.after_obs) cur += vec.gap.days * DAY_MS;
    emit(vec.pattern[i % 2]);
  }
  return rows;
}

/** The maximal run of non-null rows ending at the last row (plain loop, no helper). */
function suffixOf(rows: Row[]): { date: string; value: number }[] {
  const out: { date: string; value: number }[] = [];
  for (let i = rows.length - 1; i >= 0; i--) {
    const v = rows[i].value;
    if (v === null) break;
    out.unshift({ date: rows[i].date, value: v });
  }
  return out;
}

const wholeDays = (a: string, b: string): number => Math.floor((Date.parse(b) - Date.parse(a)) / DAY_MS);

type Oracle = { mean: number; sd: number; sharpe: number; twr: number; cagr: number; n: number; span_days: number };

/** mean, sample sd, Sharpe, TWR, CAGR recomputed from a generated series by plain loops. */
function loopOracle(series: { date: string; value: number }[], periods: number): Oracle {
  const n = series.length;
  let sum = 0;
  for (const r of series) sum += r.value;
  const mean = sum / n;
  let ss = 0;
  for (const r of series) ss += (r.value - mean) ** 2;
  const sd = Math.sqrt(ss / (n - 1));
  let wealth = 1;
  for (const r of series) wealth *= 1 + r.value;
  const span = wholeDays(series[0].date, series[n - 1].date);
  const twr = wealth - 1;
  return {
    mean,
    sd,
    sharpe: (mean / sd) * Math.sqrt(periods),
    twr,
    cagr: Math.pow(1 + twr, DAYS_PER_YEAR / span) - 1,
    n,
    span_days: span,
  };
}

function closedForm(n: number, periods: number, span: number): Oracle {
  const sd = 0.015 * Math.sqrt(n / (n - 1));
  const twr = Math.pow(1.02 * 0.99, n / 2) - 1;
  return {
    mean: 0.005,
    sd,
    sharpe: (0.005 / sd) * Math.sqrt(periods),
    twr,
    cagr: Math.pow(1 + twr, DAYS_PER_YEAR / span) - 1,
    n,
    span_days: span,
  };
}

function isClose(got: number | null | undefined, want: number): boolean {
  return typeof got === "number" && Number.isFinite(got) && Math.abs(got - want) <= RTOL * Math.abs(want) + ATOL;
}

function expectClose(engine: string, metric: string, vec: string, got: number | null | undefined, want: number): void {
  expect(
    isClose(got, want),
    `CONVENTION DIVERGENCE: engine=${engine} metric=${metric} vector=${vec}: got ${String(got)}, ` +
      `the closed-form oracle says ${want} (rtol=${RTOL}, atol=${ATOL}; the tolerance is never widened)`,
  ).toBe(true);
}

/** The engine publishes `oracle.toFixed(digits)`; compare for EXACT equality, never a tolerance. */
function expectRounded(
  engine: string,
  metric: string,
  vec: string,
  got: number | null | undefined,
  oracle: number,
  digits: number,
): void {
  expect(
    got === Number(oracle.toFixed(digits)),
    `CONVENTION DIVERGENCE: engine=${engine} metric=${metric} vector=${vec}: got ${String(got)}, ` +
      `the closed-form oracle published at ${digits} decimals is ${Number(oracle.toFixed(digits))} ` +
      `(exact equality; the engine rounds its own output)`,
  ).toBe(true);
}

// ---------------------------------------------------------------------------------------
// The input shapers the engines are fed.
// ---------------------------------------------------------------------------------------

/**
 * What the TS engines are fed: the post-break suffix, as the payload builder feeds them with
 * `headlineCoversFrom`. On a clean vector that is the whole chain.
 */
function tsEngineInput(vec: Vector): { dates: string[]; rets: number[] } {
  const suffix = suffixOf(buildChain(vec));
  return { dates: suffix.map((r) => r.date), rets: suffix.map((r) => r.value) };
}

/** The FULL chain with the break day dropped: what an input helper that ignored the break feeds. */
function fullChainInput(vec: Vector): { dates: string[]; rets: number[] } {
  const rows = buildChain(vec).filter((r) => r.value !== null) as { date: string; value: number }[];
  return { dates: rows.map((r) => r.date), rets: rows.map((r) => r.value) };
}

/** The clock the engine is handed, through the production mapping by class. */
const periodsFor = (vec: Vector): number => annualizationPeriods(vec.asset_class);

function scenarioInput(vec: Vector): { strategies: StrategyForBuilder[]; state: ScenarioState } {
  const { dates, rets } = tsEngineInput(vec);
  const strategy: StrategyForBuilder = {
    id: "leg",
    name: "leg",
    codename: null,
    disclosure_tier: "institutional",
    strategy_types: [],
    markets: [],
    start_date: dates[0],
    daily_returns: dates.map((date, i) => ({ date, value: rets[i] })),
    cagr: null,
    sharpe: null,
    volatility: null,
    max_drawdown: null,
    asset_class: vec.asset_class,
  };
  return {
    strategies: [strategy],
    state: { selected: { leg: true }, weights: { leg: 1 }, startDates: { leg: dates[0] } },
  };
}

// ---------------------------------------------------------------------------------------
// Arms. Input shaping first, then one `it` per engine x metric x vector (crypto first).
// ---------------------------------------------------------------------------------------

describe("TS input shaping (the broken chain)", () => {
  const vec = byName("broken_chain_suffix");

  it("[suffix-input] the TS input starts the day after the break and is exactly the suffix long", () => {
    const { dates, rets } = tsEngineInput(vec);
    const breakDate = vec.expected.break_date as string;
    const dayAfterBreak = isoOf(Date.parse(breakDate) + DAY_MS);
    expect(dates[0], "first date of the TS input is the post-break date").toBe(dayAfterBreak);
    expect(dates[0]).toBe(vec.expected.suffix_first_date);
    expect(rets.length, "length of the TS input is the suffix length").toBe(vec.expected.suffix_len);
    expect(dates.length).toBe(rets.length);
  });

  it("[full-chain-is-not-the-suffix] compute() on the FULL chain does not reproduce the suffix CAGR", () => {
    const full = fullChainInput(vec);
    const cagr = compute(full.rets, full.dates, 0, periodsFor(vec)).cagr;
    expect(
      isClose(cagr, vec.expected.cagr),
      `a full-chain feed must not match the suffix oracle: got ${cagr}, suffix oracle ${vec.expected.cagr}`,
    ).toBe(false);
  });

  it("[full-chain-is-a-real-prefix-plus-suffix] the full chain is longer than the suffix and starts earlier", () => {
    const full = fullChainInput(vec);
    expect(full.rets.length).toBe((vec.pre_break?.n ?? 0) + vec.n);
    expect(full.dates[0]).toBe(vec.start);
  });
});

describe("fixture and oracle self-consistency", () => {
  it.each(NAMES)("[%s] the JSON equals the closed forms AND a loop recompute from the generated series", (name) => {
    const vec = byName(name);
    const exp = vec.expected;
    const suffix = suffixOf(buildChain(vec));
    expect(suffix.length, `${name}: suffix length`).toBe(vec.n);
    if (exp.suffix_first_date !== undefined) expect(suffix[0].date).toBe(exp.suffix_first_date);
    expect(wholeDays(suffix[0].date, suffix[suffix.length - 1].date), `${name}: span`).toBe(exp.span_days);
    const closed = closedForm(vec.n, vec.periods_per_year, exp.span_days);
    const loop = loopOracle(suffix, vec.periods_per_year);
    for (const metric of ["mean", "sd", "sharpe", "twr", "cagr"] as const) {
      expectClose("fixture-vs-closed-form", metric, name, exp[metric], closed[metric]);
      expectClose("fixture-vs-loop-recompute", metric, name, exp[metric], loop[metric]);
    }
  });

  it.each(NAMES)("[%s] the clock mapping matches the vector (crypto 365, traditional 252)", (name) => {
    const vec = byName(name);
    expect(["crypto", "traditional"]).toContain(vec.asset_class);
    expect(periodsFor(vec)).toBe(vec.periods_per_year);
    // The blend rule on a one-leg blend is the same clock: 365 if any leg is crypto, else 252.
    expect(blendPeriodsPerYear([{ asset_class: vec.asset_class }])).toBe(vec.periods_per_year);
  });

  it.each(NAMES)("[%s] the rounded engines' oracle is further from a rounding tie than the float bound", (name) => {
    const exp = byName(name).expected;
    const cases: Array<[string, number, number]> = [
      ["sharpe@3", exp.sharpe, 3],
      ["twr@5", exp.twr, 5],
      ["cagr@5", exp.cagr, 5],
    ];
    for (const [label, value, digits] of cases) {
      const scaled = value * 10 ** digits;
      const distanceToTie = Math.abs(scaled - Math.floor(scaled) - 0.5) / 10 ** digits;
      expect(
        distanceToTie,
        `${name} ${label}: ${distanceToTie} from a rounding tie, float bound ${RTOL * Math.abs(value)}`,
      ).toBeGreaterThan(RTOL * Math.abs(value));
    }
  });
});

describe("compute() (the factsheet engine)", () => {
  const run = (name: string) => {
    const vec = byName(name);
    const { dates, rets } = tsEngineInput(vec);
    return { vec, res: compute(rets, dates, 0, periodsFor(vec)) };
  };
  it.each(NAMES)("sharpe [%s]", (name) => {
    const { vec, res } = run(name);
    expectClose("compute()", "sharpe", name, res.sharpe, vec.expected.sharpe);
  });
  it.each(NAMES)("cagr [%s]", (name) => {
    const { vec, res } = run(name);
    expectClose("compute()", "cagr", name, res.cagr, vec.expected.cagr);
  });
  it.each(NAMES)("twr(cum_ret) [%s]", (name) => {
    const { vec, res } = run(name);
    expectClose("compute()", "twr(cum_ret)", name, res.cum_ret, vec.expected.twr);
  });
});

describe("computeScenario (single leg at weight 1; publishes 3 and 5 decimals)", () => {
  const run = (name: string) => {
    const vec = byName(name);
    const { strategies, state } = scenarioInput(vec);
    return { vec, res: computeScenario(strategies, state, buildDateMapCache(strategies), periodsFor(vec)) };
  };
  it.each(NAMES)("sharpe [%s]", (name) => {
    const { vec, res } = run(name);
    expectRounded("computeScenario", "sharpe", name, res.sharpe, vec.expected.sharpe, 3);
  });
  it.each(NAMES)("cagr [%s]", (name) => {
    const { vec, res } = run(name);
    expectRounded("computeScenario", "cagr", name, res.cagr, vec.expected.cagr, 5);
  });
  it.each(NAMES)("twr [%s]", (name) => {
    const { vec, res } = run(name);
    expectRounded("computeScenario", "twr", name, res.twr, vec.expected.twr, 5);
  });
});

describe("og-metrics computeOgHeadline (the OG card; computed path, no stored row)", () => {
  const run = (name: string) => {
    const vec = byName(name);
    const { dates, rets } = tsEngineInput(vec);
    const rows = dates.map((date, i) => ({ date, value: rets[i] }));
    return { vec, res: computeOgHeadline(rows, vec.asset_class) };
  };
  it.each(NAMES)("sharpe [%s]", (name) => {
    const { vec, res } = run(name);
    expectClose("og-metrics computeOgHeadline", "sharpe", name, res.sharpe, vec.expected.sharpe);
  });
  it.each(NAMES)("cagr [%s]", (name) => {
    const { vec, res } = run(name);
    expectClose("og-metrics computeOgHeadline", "cagr", name, res.cagr, vec.expected.cagr);
  });
});

describe("sample-basis-ratios Sharpe", () => {
  it.each(NAMES)("the shared return-stats sharpe it calls, unrounded [%s]", (name) => {
    const vec = byName(name);
    const { rets } = tsEngineInput(vec);
    // ddof 1 is the F-5 convention written out; `sampleBasisRatios` passes its own constant.
    expectClose(
      "return-stats sharpe (under sample-basis-ratios)",
      "sharpe",
      name,
      sharedSharpe(rets, { periodsPerYear: periodsFor(vec), ddof: 1 }),
      vec.expected.sharpe,
    );
  });
  it.each(NAMES)("sampleBasisRatios sharpe, as published at 3 decimals [%s]", (name) => {
    const vec = byName(name);
    const { rets } = tsEngineInput(vec);
    expectRounded(
      "sample-basis-ratios sampleBasisRatios",
      "sharpe",
      name,
      sampleBasisRatios(rets, periodsFor(vec)).sharpe,
      vec.expected.sharpe,
      3,
    );
  });
});

describe("holding-compare-adapter analyzeSignedReturns", () => {
  const run = (name: string) => {
    const vec = byName(name);
    const { rets } = tsEngineInput(vec);
    return { vec, res: analyzeSignedReturns(rets, periodsFor(vec)) };
  };
  it.each(NAMES)("sharpe [%s]", (name) => {
    const { vec, res } = run(name);
    expectClose("holding-compare-adapter analyzeSignedReturns", "sharpe", name, res.sharpe, vec.expected.sharpe);
  });
  it.each(NAMES)("twr(cumulative_return) [%s]", (name) => {
    const { vec, res } = run(name);
    expectClose(
      "holding-compare-adapter analyzeSignedReturns",
      "twr(cumulative_return)",
      name,
      res.cumulative_return,
      vec.expected.twr,
    );
  });
});
