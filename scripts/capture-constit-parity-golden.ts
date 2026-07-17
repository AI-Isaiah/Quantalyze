/**
 * CONSTIT-05 parity gate — deterministic fixture generator + frozen-engine
 * golden capture (Phase 111, Wave 1). This is the ONLY artifact permitted to
 * import `src/lib/scenario.ts`; it READS the engine (never mutates it — the
 * SC-3 keep-gate + `scenario.test.ts` byte-freeze pins stay green).
 *
 * It does three things in ONE deterministic run (no RNG, no Date.now, no live
 * DB — live-DB tests are skipif-gated and never run in CI, RESEARCH A4):
 *
 *   1. GENERATE a synthetic multi-key fixture from closed-form sin/cos formulas
 *      (the seedCompositeStrategy pattern, e2e/helpers/seed-test-project.ts).
 *      Three per-key daily-return series over 120 consecutive calendar days
 *      with (a) RAGGED STARTS — key_b begins 20 days after key_a/key_c,
 *      exercising the engine's pre-start member drop (scenario.ts:422-430);
 *      (b) deliberate WEIGHT DRIFT — key_a is front-loaded, key_b is
 *      back-loaded, so the fixed-weight blend (A) and the time-varying-weight
 *      blend (B) measurably diverge (a symmetric fixture would be tautological,
 *      Pitfall 1); (c) per-key equity paths (unitless CAPITAL units — never USD
 *      magnitudes, T-111-01) plus a CASHFLOW VARIANT where key_b receives a
 *      synthetic deposit mid-window that steps its equity path but does NOT
 *      touch its TWR daily-return series (divergence-watch #7).
 *
 *   2. CAPTURE the frozen-engine truth: one StrategyForBuilder per key
 *      (weight = final-day equity — the "current equity snapshot" semantics of
 *      queries.ts:2190; leverage 1; asset_class "crypto"; exploratory tier; all
 *      selected), call computeScenario with NO window (union date-axis path,
 *      periodsPerYear=365 for the all-crypto blend), and record the full-res
 *      UNROUNDED portfolio daily-return series, the engine's downsampled equity
 *      curve, and every KPI (twr, cagr, volatility, sharpe, sortino,
 *      max_drawdown, max_dd_days).
 *
 *   3. WRITE both JSONs to analytics-service/tests/fixtures/ with sorted keys so
 *      re-runs are byte-identical (determinism proven by the verify below).
 *
 * The engine WEIGHT is the raw final-day equity (engine renormalizes); the
 * fixture stores equities as unitless capital multipliers so no USD NAV
 * magnitude is ever committed or printed (T-111-01 / golden_parity.py
 * discipline).
 *
 * Run (single committed re-runnable command):
 *   npx tsx scripts/capture-constit-parity-golden.ts
 *
 * Verify determinism (must be a no-op diff):
 *   npx tsx scripts/capture-constit-parity-golden.ts \
 *     && git diff --exit-code analytics-service/tests/fixtures/constit_parity_fixture.json \
 *                            analytics-service/tests/fixtures/constit_parity_golden.json
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildDateMapCache,
  computeScenario,
  type StrategyForBuilder,
  type ScenarioState,
} from "@/lib/scenario";

// ── Fixture parameters (all closed-form; no RNG) ─────────────────────────────
const N_DAYS = 120;
const KEY_B_START_INDEX = 20; // ragged start → pre-start member drop
const CASHFLOW_DEPOSIT_DAY = 70; // synthetic deposit steps key_b equity here
const CASHFLOW_DEPOSIT_CAPITAL = 0.3; // unitless capital units (NOT USD)
const PERIODS_PER_YEAR = 365; // all-crypto blend basis (#597)

// Base capital shares — unitless (relative weights only; scale cancels in the
// weighted blend). Deliberately UNEQUAL so time-varying shares are non-trivial.
const BASE_CAPITAL = { key_a: 1.0, key_b: 0.8, key_c: 1.2 } as const;

// Deterministic date axis: consecutive UTC calendar days from a fixed anchor.
const ANCHOR_MS = Date.UTC(2024, 0, 1); // 2024-01-01
const DAY_MS = 86_400_000;
function dateAt(i: number): string {
  return new Date(ANCHOR_MS + i * DAY_MS).toISOString().slice(0, 10);
}

// Closed-form per-key daily returns. key_a front-loaded, key_b back-loaded,
// key_c a neutral oscillator — so fixed-weight ≠ time-varying-weight.
function retA(i: number): number {
  return 0.008 * Math.sin(i / 6) + 0.004 * (1 - i / (N_DAYS - 1));
}
function retC(i: number): number {
  return 0.006 * Math.sin(i / 8 + 1.0) - 0.001 * Math.cos(i / 15);
}
function retB(i: number): number {
  return 0.009 * Math.sin(i / 5 + 2.0) + 0.004 * (i / (N_DAYS - 1));
}

// ── Build per-key series + equity paths ──────────────────────────────────────
interface KeyFixture {
  start_date: string;
  base_capital: number;
  daily_returns: Array<{ date: string; value: number }>;
  equity_path: Array<{ date: string; equity: number }>;
  engine_weight: number;
}

function buildKey(
  ret: (i: number) => number,
  startIndex: number,
  baseCapital: number,
): KeyFixture {
  const daily_returns: Array<{ date: string; value: number }> = [];
  const equity_path: Array<{ date: string; equity: number }> = [];
  let equity = baseCapital; // unitless capital units
  for (let i = startIndex; i < N_DAYS; i++) {
    const r = ret(i);
    equity *= 1 + r;
    daily_returns.push({ date: dateAt(i), value: r });
    equity_path.push({ date: dateAt(i), equity });
  }
  return {
    start_date: dateAt(startIndex),
    base_capital: baseCapital,
    daily_returns,
    equity_path,
    engine_weight: equity, // final-day equity = current-equity snapshot
  };
}

const key_a = buildKey(retA, 0, BASE_CAPITAL.key_a);
const key_b = buildKey(retB, KEY_B_START_INDEX, BASE_CAPITAL.key_b);
const key_c = buildKey(retC, 0, BASE_CAPITAL.key_c);

// Cashflow variant: key_b receives a deposit at CASHFLOW_DEPOSIT_DAY that STEPS
// the equity path (+CASHFLOW_DEPOSIT_CAPITAL from that day on) WITHOUT altering
// the TWR daily-return series. Pre-empts the TWR-vs-$-equity trap (Pitfall 2 /
// divergence-watch #7): the composer's blend is TWR-based and cashflow-neutral,
// so a deposit must NOT move blend A — only a (wrong) $-equity-weighted book
// return would react to it.
const key_b_equity_with_deposit = key_b.equity_path.map((p, idx) => {
  const globalIndex = KEY_B_START_INDEX + idx;
  const deposit =
    globalIndex >= CASHFLOW_DEPOSIT_DAY ? CASHFLOW_DEPOSIT_CAPITAL : 0;
  return { date: p.date, equity: p.equity + deposit };
});

// ── Anti-tautology check (independent of scenario.ts) ────────────────────────
// Prove the fixture is NON-TRIVIAL: the fixed-weight terminal wealth and the
// time-varying-weight terminal wealth must differ, else the gate answers
// nothing (Pitfall 1). Computed here from raw inputs only — NOT via the engine.
function terminalWealthFixedWeight(): number {
  const w = {
    key_a: key_a.engine_weight,
    key_b: key_b.engine_weight,
    key_c: key_c.engine_weight,
  };
  const retMap = {
    key_a: new Map(key_a.daily_returns.map((d) => [d.date, d.value])),
    key_b: new Map(key_b.daily_returns.map((d) => [d.date, d.value])),
    key_c: new Map(key_c.daily_returns.map((d) => [d.date, d.value])),
  };
  const startIdx = { key_a: 0, key_b: KEY_B_START_INDEX, key_c: 0 };
  let c = 1;
  for (let i = 0; i < N_DAYS; i++) {
    const date = dateAt(i);
    let num = 0;
    let den = 0;
    for (const k of ["key_a", "key_b", "key_c"] as const) {
      if (i < startIdx[k]) continue;
      const r = retMap[k].get(date) ?? 0;
      num += w[k] * r;
      den += w[k];
    }
    c *= 1 + (den > 0 ? num / den : 0);
  }
  return c;
}

function terminalWealthTimeVarying(): number {
  const equityMap = {
    key_a: new Map(key_a.equity_path.map((d) => [d.date, d.equity])),
    key_b: new Map(key_b.equity_path.map((d) => [d.date, d.equity])),
    key_c: new Map(key_c.equity_path.map((d) => [d.date, d.equity])),
  };
  const baseCap = {
    key_a: key_a.base_capital,
    key_b: key_b.base_capital,
    key_c: key_c.base_capital,
  };
  const retMap = {
    key_a: new Map(key_a.daily_returns.map((d) => [d.date, d.value])),
    key_b: new Map(key_b.daily_returns.map((d) => [d.date, d.value])),
    key_c: new Map(key_c.daily_returns.map((d) => [d.date, d.value])),
  };
  const startIdx = { key_a: 0, key_b: KEY_B_START_INDEX, key_c: 0 };
  let c = 1;
  for (let i = 0; i < N_DAYS; i++) {
    const date = dateAt(i);
    let num = 0;
    let den = 0;
    for (const k of ["key_a", "key_b", "key_c"] as const) {
      if (i < startIdx[k]) continue;
      // Time-varying weight = prior-day equity (or base at inception).
      const prevDate = dateAt(i - 1);
      const wDay =
        i === startIdx[k]
          ? baseCap[k]
          : equityMap[k].get(prevDate) ?? baseCap[k];
      const r = retMap[k].get(date) ?? 0;
      num += wDay * r;
      den += wDay;
    }
    c *= 1 + (den > 0 ? num / den : 0);
  }
  return c;
}

const twFixed = terminalWealthFixedWeight();
const twVarying = terminalWealthTimeVarying();
const antiTautologyDelta = Math.abs(twFixed - twVarying);
if (antiTautologyDelta <= 1e-4) {
  throw new Error(
    `FIXTURE IS TAUTOLOGICAL: fixed-weight terminal wealth (${twFixed}) ≈ ` +
      `time-varying terminal wealth (${twVarying}); |Δ|=${antiTautologyDelta} ` +
      `≤ 1e-4. The gate would answer nothing — increase weight drift.`,
  );
}

// ── Capture the frozen-engine golden ─────────────────────────────────────────
function toStrategy(id: string, k: KeyFixture): StrategyForBuilder {
  return {
    id,
    name: id,
    codename: null,
    disclosure_tier: "exploratory",
    strategy_types: [],
    markets: [],
    start_date: k.start_date, // engine include-from → ragged-start drop
    daily_returns: k.daily_returns,
    cagr: null,
    sharpe: null,
    volatility: null,
    max_drawdown: null,
    asset_class: "crypto",
  };
}

const strategies: StrategyForBuilder[] = [
  toStrategy("key_a", key_a),
  toStrategy("key_b", key_b),
  toStrategy("key_c", key_c),
];

const state: ScenarioState = {
  selected: { key_a: true, key_b: true, key_c: true },
  weights: {
    key_a: key_a.engine_weight,
    key_b: key_b.engine_weight,
    key_c: key_c.engine_weight,
  },
  startDates: {}, // absent → engine uses each strategy's start_date (union path)
  // no leverage, no window → the live-composer union date-axis path
};

const cache = buildDateMapCache(strategies);
const engine = computeScenario(strategies, state, cache, PERIODS_PER_YEAR);

// ── Serialize (sorted keys → byte-identical re-runs) ─────────────────────────
function sortedReplacer(_key: string, value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = (value as Record<string, unknown>)[k];
        return acc;
      }, {});
  }
  return value;
}

const fixture = {
  _readme:
    "CONSTIT-05 parity gate fixture (Phase 111). Synthetic sin/cos series — " +
    "NO real allocator data, NO USD magnitudes (equities are unitless capital " +
    "units, T-111-01). 3 keys, 120 consecutive days, key_b ragged-starts at " +
    "index 20, deliberate front/back weight drift, and a cashflow variant " +
    "(key_b deposit at day 70). Negative-equity clamp: NOT exercised (no " +
    "contrived negative case); the engine clamps per-key equity ≥ 0 at " +
    "queries.ts:2190 and the oracle would mirror it, but this fixture keeps " +
    "all equities strictly positive. Regenerate with " +
    "`npx tsx scripts/capture-constit-parity-golden.ts`.",
  meta: {
    n_days: N_DAYS,
    dates_first: dateAt(0),
    dates_last: dateAt(N_DAYS - 1),
    key_b_start_index: KEY_B_START_INDEX,
    periods_per_year: PERIODS_PER_YEAR,
    engine_weights_are: "final-day equity (current-equity snapshot)",
    anti_tautology: {
      terminal_wealth_fixed_weight: twFixed,
      terminal_wealth_time_varying: twVarying,
      abs_delta: antiTautologyDelta,
      threshold: 1e-4,
    },
  },
  cashflow_variant: {
    key: "key_b",
    deposit_day_index: CASHFLOW_DEPOSIT_DAY,
    deposit_capital: CASHFLOW_DEPOSIT_CAPITAL,
    equity_path_with_deposit: key_b_equity_with_deposit,
  },
  keys: {
    key_a,
    key_b,
    key_c,
  },
};

const golden = {
  _readme:
    "computeScenario() output for constit_parity_fixture.json (NO window, " +
    "periodsPerYear=365). portfolio_daily_returns is FULL-RES and UNROUNDED " +
    "(compare curve A here at atol/rtol 1e-9). KPIs are ENGINE-ROUNDED per " +
    "`rounding` below — the pytest tolerance must be ≥ the rounding " +
    "granularity. Frozen-engine capture only; scenario.ts is byte-untouched.",
  rounding: {
    twr: 5,
    cagr: 5,
    volatility: 5,
    max_drawdown: 5,
    sharpe: 3,
    sortino: 3,
    portfolio_daily_returns: "unrounded (full precision)",
  },
  n: engine.n,
  effective_start: engine.effective_start,
  effective_end: engine.effective_end,
  member_count: engine.member_count,
  member_ids: engine.member_ids,
  kpis: {
    twr: engine.twr,
    cagr: engine.cagr,
    volatility: engine.volatility,
    sharpe: engine.sharpe,
    sortino: engine.sortino,
    max_drawdown: engine.max_drawdown,
    max_dd_days: engine.max_dd_days,
  },
  portfolio_daily_returns: engine.portfolio_daily_returns,
  equity_curve: engine.equity_curve,
};

const FIXTURE_DIR = join(
  process.cwd(),
  "analytics-service",
  "tests",
  "fixtures",
);
writeFileSync(
  join(FIXTURE_DIR, "constit_parity_fixture.json"),
  JSON.stringify(fixture, sortedReplacer, 2) + "\n",
);
writeFileSync(
  join(FIXTURE_DIR, "constit_parity_golden.json"),
  JSON.stringify(golden, sortedReplacer, 2) + "\n",
);

// eslint-disable-next-line no-console
console.log(
  `[capture-constit-parity-golden] wrote fixture + golden.\n` +
    `  n=${engine.n} members=${engine.member_count} ` +
    `twr=${engine.twr} sharpe=${engine.sharpe} maxDD=${engine.max_drawdown}\n` +
    `  anti-tautology |Δ terminal wealth (A vs B)| = ${antiTautologyDelta.toFixed(6)} (> 1e-4 ✓)`,
);
