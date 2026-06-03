/**
 * Phase 12 / METRICS-13: TS-side parity assertion.
 *
 * Reads the committed golden_252d_expected.json and asserts the JSON contract
 * conforms to the typed contract in src/lib/types.ts. This is the schema gate
 * (Reading A); math drift is gated by the Python-side test.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect } from "vitest";

import {
  assertMetricParity,
  assertTradeMixBucketCount,
  EXPECTED_SIBLING_KINDS,
  FROZEN_TRADE_METRICS_KEYS,
} from "../lib/metrics-parity-helper";

const FIXTURE_PATH = join(
  __dirname,
  "..",
  "..",
  "analytics-service",
  "tests",
  "fixtures",
  "golden_252d_expected.json",
);

// H-0022 / H-0757: the committed `golden_252d_input.json` holds the RAW inputs
// (returns, benchmark, fills, positions) that regen_golden.py fed through the
// Python production helpers to produce `golden_252d_expected.json`. The block
// below re-derives a handful of scalars from THOSE raw inputs using formulas
// hand-coded here in TS — deliberately NOT importing any production helper, so
// this is a genuinely orthogonal code path. It breaks the single-source-oracle
// tautology: regen + the Python parity test both run `compute_all_metrics`, so a
// bug there bakes into `expected` and survives both checks; this TS oracle would
// instead diverge and fail.
const INPUT_FIXTURE_PATH = join(
  __dirname,
  "..",
  "..",
  "analytics-service",
  "tests",
  "fixtures",
  "golden_252d_input.json",
);

interface SeriesPoint {
  date: string;
  value: number;
}

interface GoldenInput {
  returns: SeriesPoint[];
  benchmark: SeriesPoint[];
  fills: Array<{ side: string; notional_usd: number }>;
  trade_metrics_from_positions: {
    winners_count: number;
    losers_count: number;
    long_count: number;
    short_count: number;
    total_positions: number;
    // H-0022: raw position-side primitives that feed the DERIVED trade metrics
    // (risk_reward_ratio / sqn) in _compute_derived_trade_metrics, plus the
    // pre-baked avg_duration_days passthrough. These let the TS oracle below
    // re-derive those scalars without importing the Python helper.
    avg_winning_trade: number;
    avg_losing_trade: number;
    avg_duration_days: number;
    realized_pnl_per_trade: Array<{ realized_pnl: number; side: string }>;
  };
}

// _compute_derived_trade_metrics caps the SQN trade-count scaling at
// sqrt(min(N, 100)) (analytics_runner.SQN_TRADE_COUNT_CAP). Mirror that cap in
// the independent oracle so the re-derivation is exact, not approximate.
const SQN_TRADE_COUNT_CAP = 100;

const TRADING_DAYS = 252;

/** Population/sample-free product of (1 + r) − 1 over a return series. */
function cumulativeReturn(rets: number[]): number {
  let acc = 1;
  for (const r of rets) acc *= 1 + r;
  return acc - 1;
}

/** Sample (ddof=1) standard deviation — matches numpy/pandas .std() default. */
function sampleStd(xs: number[]): number {
  const n = xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const sumSq = xs.reduce((a, b) => a + (b - mean) * (b - mean), 0);
  return Math.sqrt(sumSq / (n - 1));
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Max drawdown as a (negative) fraction off the running equity peak. */
function maxDrawdown(rets: number[]): number {
  let eq = 1;
  let peak = 1;
  let mdd = 0;
  for (const r of rets) {
    eq *= 1 + r;
    if (eq > peak) peak = eq;
    const dd = eq / peak - 1;
    if (dd < mdd) mdd = dd;
  }
  return mdd;
}

describe("METRICS-13 cross-runtime parity (TS schema gate)", () => {
  const expected = JSON.parse(readFileSync(FIXTURE_PATH, "utf-8")) as {
    metrics_json: Record<string, unknown>;
    sibling: Record<string, unknown>;
    // audit-2026-05-07 P2005: pinned bucket-shape mode (cross-process contract).
    _fixture_has_maker_taker?: boolean;
  };

  it("expected JSON has metrics_json and sibling top-level keys", () => {
    expect(expected).toHaveProperty("metrics_json");
    expect(expected).toHaveProperty("sibling");
  });

  it("every sibling kind is a known StrategyAnalyticsSeriesKind", () => {
    expect(() => assertMetricParity(expected)).not.toThrow();
  });

  it("trade_metrics has only frozen D-16 keys", () => {
    const tm = expected.metrics_json["trade_metrics"] as Record<string, unknown>;
    expect(tm).toBeTruthy();
    for (const key of Object.keys(tm)) {
      expect(FROZEN_TRADE_METRICS_KEYS).toContain(key);
    }
  });

  it("trade_mix bucket count matches D-15 audit outcome", () => {
    expect(() => assertTradeMixBucketCount(expected)).not.toThrow();
  });

  it("expected sibling kinds EXACTLY equal the 12 H-A1 kinds (matches Python invariant)", () => {
    // H-A1 (REVIEWS.md): regen_golden.py simulates positions/prices/NAV →
    // exposure_series + turnover_series MUST be populated. Plan-checker Issue 6:
    // TS bar must match Python's tightened assertion to avoid false-green when
    // H-A1 wiring regresses.
    //
    // H-0461: assert SYMMETRIC set-equality, not the pre-fix
    // `length === size` + per-kind `toContain`. The old form caught a
    // REMOVED kind but a kind ADDED to both the fixture AND
    // EXPECTED_SIBLING_KINDS slipped through (length still matched,
    // toContain only proves presence). `toEqual` on Sets catches drift in
    // BOTH directions. The protection is split across two layers: the
    // set <-> union leg is COMPILE-TIME locked in metrics-parity-helper.ts
    // (the `satisfies` + exhaustiveness check), and THIS runtime assertion
    // closes the remaining fixture <-> set leg (the committed Python-regen
    // JSON can only be checked at runtime).
    const keys = Object.keys(expected.sibling);
    expect(new Set(keys)).toEqual(EXPECTED_SIBLING_KINDS);
    // H-D: equity_series_1y MUST NOT be a sibling kind (lives in metrics_json).
    // Redundant with the set-equality above (it's absent from the set), but
    // kept as an explicit, greppable guard of the load-bearing invariant.
    expect(keys).not.toContain("equity_series_1y");
  });

  it("H-0754: each sibling kind's per-point shape matches its declared contract", () => {
    // H-0754: the expected JSON is otherwise read as an untyped dict, so a
    // producer-side rename or unit flip in a series row (e.g. turnover_series
    // emitting {date, value} instead of {date, turnover}, or exposure_series
    // dropping `net`) is invisible to the key-name-only gate above. Declare the
    // per-kind point contract here and validate every row against it. This is
    // the schema/TypedDict the finding asks for, expressed in the TS runtime.
    //
    // Three documented row shapes (verified against the committed golden):
    //   {date, value}   — all rolling/returns kinds + daily_returns_grid + log_returns
    //   {date, gross, net} — exposure_series (H-A1)
    //   {date, turnover}   — turnover_series (H-A1)
    const VALUE_KINDS = [
      "daily_returns_grid",
      "log_returns_series",
      "rolling_alpha",
      "rolling_beta",
      "rolling_sortino_3m",
      "rolling_sortino_6m",
      "rolling_sortino_12m",
      "rolling_volatility_3m",
      "rolling_volatility_6m",
      "rolling_volatility_12m",
    ];
    const sibling = expected.sibling as Record<string, unknown>;

    const assertRowKeys = (kind: string, rowKeys: string[]) => {
      const series = sibling[kind];
      expect(Array.isArray(series), `${kind} must be an array`).toBe(true);
      const rows = series as Array<Record<string, unknown>>;
      expect(rows.length, `${kind} must be non-empty`).toBeGreaterThan(0);
      for (const row of rows) {
        // Exact key-set match: catches BOTH a renamed/dropped key and an
        // extra/aliased key sneaking into the row contract.
        expect(Object.keys(row).sort()).toEqual([...rowKeys].sort());
        expect(typeof row.date).toBe("string");
        for (const k of rowKeys) {
          if (k === "date") continue;
          expect(
            typeof row[k],
            `${kind} row field ${k} must be numeric`,
          ).toBe("number");
        }
      }
    };

    for (const kind of VALUE_KINDS) {
      assertRowKeys(kind, ["date", "value"]);
    }
    assertRowKeys("exposure_series", ["date", "gross", "net"]);
    assertRowKeys("turnover_series", ["date", "turnover"]);
  });
});

describe("METRICS-13 cross-runtime parity (TS independent math oracle)", () => {
  // H-0022 / H-0757: these assertions re-derive scalars from the RAW input
  // fixture via formulas implemented here (no production import). They are the
  // independent oracle the schema gate above lacks: a math bug in
  // compute_all_metrics / _compute_volume_aggregator bakes identically into
  // both `expected` (regen) and the Python parity rerun, but it would NOT match
  // these hand-coded references — so the bug-symmetric pass is broken.
  const input = JSON.parse(
    readFileSync(INPUT_FIXTURE_PATH, "utf-8"),
  ) as GoldenInput;
  const expected = JSON.parse(readFileSync(FIXTURE_PATH, "utf-8")) as {
    metrics_json: Record<string, number | Record<string, unknown>>;
  };
  const metrics = expected.metrics_json as Record<string, number> &
    Record<string, Record<string, number>>;
  const rets = input.returns.map((p) => p.value);

  // Float tolerance: the golden is the full-precision Python output; our TS
  // re-derivation uses identical IEEE-754 ops so the gap is at most a few ULP.
  // A real formula divergence (wrong annualization, flipped sign, off-by divisor)
  // moves the value far outside this band.
  const TOL = 1e-9;

  it("returns series has the expected 252-day length", () => {
    // Guards the oracle itself: if the input fixture were truncated, every
    // derivation below would silently shift. Pin the contract.
    expect(rets.length).toBe(TRADING_DAYS);
    expect(input.benchmark.length).toBe(TRADING_DAYS);
  });

  it("cumulative_return matches an independent prod(1+r)-1", () => {
    // Regression caught: a numerator/denominator or geometric-vs-arithmetic
    // bug in compute_all_metrics' cumulative-return path.
    expect(metrics.cumulative_return).toBeCloseTo(cumulativeReturn(rets), 9);
  });

  it("cagr equals cumulative_return for this sub-1y fixture", () => {
    // For a 252-day (1y) series the annualization factor is ~1; regen freezes
    // cagr == cumulative_return. A bug that double-annualized (×252/252 wrong,
    // or applied √252) would diverge here.
    expect(metrics.cagr).toBeCloseTo(metrics.cumulative_return, 9);
  });

  it("volatility matches sample-std × √252", () => {
    // Regression caught: wrong ddof (population vs sample), wrong annualization
    // factor (√252 vs ×252), or a missing √. Sample std differs from population
    // std in the 4th sig fig here, so the wrong ddof fails this assertion.
    const derived = sampleStd(rets) * Math.sqrt(TRADING_DAYS);
    expect(Math.abs(metrics.volatility - derived)).toBeLessThan(TOL);
  });

  it("sharpe matches mean/sample-std × √252 (zero risk-free)", () => {
    // Regression caught: a sharpe that swaps numerator/denominator, drops the
    // annualization, or applies a non-zero risk-free where the fixture uses 0.
    const derived =
      (mean(rets) / sampleStd(rets)) * Math.sqrt(TRADING_DAYS);
    expect(Math.abs(metrics.sharpe - derived)).toBeLessThan(TOL);
  });

  it("max_drawdown matches an independent peak-to-trough scan (and is negative)", () => {
    // Regression caught: a flipped-sign max DD (stored as +0.24 instead of
    // -0.24), or a percentage-vs-fraction unit error.
    expect(metrics.max_drawdown).toBeLessThan(0);
    expect(Math.abs(metrics.max_drawdown - maxDrawdown(rets))).toBeLessThan(
      TOL,
    );
  });

  it("six_month_return matches the cumulative over the last 126 trading days", () => {
    // Regression caught: an off-by-window six-month slice (e.g. first vs last
    // 126 days) or an arithmetic-sum-vs-compound bug.
    const derived = cumulativeReturn(rets.slice(-126));
    expect(Math.abs(metrics.six_month_return - derived)).toBeLessThan(TOL);
  });

  it("trade_metrics.gross_volume_usd matches Σ fill.notional_usd", () => {
    // H-0760 partial: gross_volume_usd is the one volume scalar that is NOT
    // zeroed by the missing-`cost` synthetic fills, so it provides a real
    // cross-runtime gate on the _compute_volume_aggregator volume sum. A divisor
    // or double-count bug there would diverge from this hand-sum.
    const tm = metrics.trade_metrics as Record<string, number>;
    const grossDerived = input.fills.reduce(
      (a, f) => a + f.notional_usd,
      0,
    );
    expect(Math.abs(tm.gross_volume_usd - grossDerived)).toBeLessThan(1e-6);
    expect(tm.total_fills).toBe(input.fills.length);
  });

  it("trade_metrics.win_rate matches winners/(winners+losers)", () => {
    // Regression caught: a win_rate denominator that uses total_positions
    // (incl. breakevens/open) instead of decided trades. With 34 winners + 16
    // losers + 50 positions, the two denominators give 0.68 vs 0.68 here BUT
    // diverge the moment breakevens exist — so we assert the decided-trade rule.
    const tm = metrics.trade_metrics as Record<string, number>;
    const tmp = input.trade_metrics_from_positions;
    const decided = tmp.winners_count + tmp.losers_count;
    const derived = decided > 0 ? tmp.winners_count / decided : 0;
    expect(tm.win_rate).toBeCloseTo(derived, 4);
    expect(tm.long_count).toBe(tmp.long_count);
    expect(tm.short_count).toBe(tmp.short_count);
  });

  it("trade_metrics.risk_reward_ratio matches avg_win / |avg_loss| (independent)", () => {
    // H-0022: risk_reward_ratio comes from _compute_derived_trade_metrics
    // (analytics_runner.py:750 `out['risk_reward_ratio'] = avg_win / abs(avg_loss)`)
    // — a DERIVED scalar the prior parity oracle left uncovered (the headline
    // compute_all_metrics scalars were covered, these trade-metric derivations
    // were not). regen runs the SAME helper to produce `expected`, so a
    // numerator/denominator SWAP there (|avg_loss|/avg_win) would bake into the
    // golden and survive the Python parity rerun. Re-derive it here from the raw
    // avg_winning_trade / avg_losing_trade in the input fixture — no prod import.
    const tm = metrics.trade_metrics as Record<string, number>;
    const tmp = input.trade_metrics_from_positions;
    const derived = tmp.avg_winning_trade / Math.abs(tmp.avg_losing_trade);
    expect(Math.abs(tm.risk_reward_ratio - derived)).toBeLessThan(TOL);
    // Sanity that the oracle is non-degenerate: a swapped formula would give a
    // materially different number, so the band above is a real gate.
    const swapped = Math.abs(tmp.avg_losing_trade) / tmp.avg_winning_trade;
    expect(Math.abs(derived - swapped)).toBeGreaterThan(0.1);
  });

  it("trade_metrics.sqn matches Van Tharp (mean_R/std_R)·√min(N,100) (independent)", () => {
    // H-0022: sqn comes from _compute_derived_trade_metrics
    // (analytics_runner.py:794-806) over per-trade R-multiples,
    // R_i = realized_pnl_i / |avg_loss|, sample std (ddof=1), scaled by
    // √min(N, SQN_TRADE_COUNT_CAP). Production itself documents (line 788) that
    // "quantstats does NOT implement SQN, so there is no external parity oracle
    // and the golden-fixture value is self-anchored" — i.e. the parity test had
    // ZERO independent check on this number. This re-derives it from the raw
    // realized_pnl_per_trade list with formulas hand-coded here. A wrong divisor
    // (population vs sample std), a dropped √N scaling, or a wrong risk_unit
    // would diverge from this band even though regen + the Python parity test
    // agree with each other.
    const tm = metrics.trade_metrics as Record<string, number>;
    const tmp = input.trade_metrics_from_positions;
    const riskUnit = Math.abs(tmp.avg_losing_trade);
    const rMultiples = tmp.realized_pnl_per_trade
      .map((t) => Number(t.realized_pnl))
      .filter((p) => Number.isFinite(p))
      .map((p) => p / riskUnit);
    const n = rMultiples.length;
    const meanR = mean(rMultiples);
    const varR =
      rMultiples.reduce((a, r) => a + (r - meanR) * (r - meanR), 0) / (n - 1);
    const stdR = Math.sqrt(varR);
    const derived = (meanR / stdR) * Math.sqrt(Math.min(n, SQN_TRADE_COUNT_CAP));
    expect(Math.abs(tm.sqn - derived)).toBeLessThan(TOL);
    // Guard the oracle's premise: the fixture has >=2 trades (SQN is undefined
    // below 2) and the population-std variant is materially different, so the
    // ddof=1 choice the assertion pins is load-bearing.
    expect(n).toBeGreaterThanOrEqual(2);
    const varPop =
      rMultiples.reduce((a, r) => a + (r - meanR) * (r - meanR), 0) / n;
    const sqnPop = (meanR / Math.sqrt(varPop)) * Math.sqrt(Math.min(n, SQN_TRADE_COUNT_CAP));
    expect(Math.abs(derived - sqnPop)).toBeGreaterThan(TOL);
  });

  it("trade_metrics.avg_duration_days is the input passthrough (independent)", () => {
    // H-0022: avg_duration_days is a pre-baked input passthrough — the audit
    // flagged a potential off-by-86400 (seconds-vs-days) unit drift on the
    // producer side. The parity test never re-derived it. Pin the published
    // value to the raw input so a unit-flip on the producer (×86400 or /86400)
    // diverges here instead of silently re-baselining.
    const tm = metrics.trade_metrics as Record<string, number>;
    const tmp = input.trade_metrics_from_positions;
    expect(tm.avg_duration_days).toBeCloseTo(tmp.avg_duration_days, 9);
    // A days-vs-seconds unit drift would move this by ~5 orders of magnitude,
    // so the band is a genuine gate, not a tautology on a tiny number.
    expect(tm.avg_duration_days).toBeGreaterThan(0);
    expect(tm.avg_duration_days).toBeLessThan(365);
  });

  it("DOCUMENTS the H-0759/H-0760 degenerate-fixture zeros (loud, not silent)", () => {
    // H-0759 + H-0760: regen_golden.py feeds `cost`-less fills to
    // _compute_volume_metrics and an EMPTY positions list to
    // _compute_position_side_volume_pcts, so these four percentages are baked
    // to 0.0 in the golden. The REAL helper code paths (cost-bearing fills,
    // timestamp-window attribution) are exercised in
    // analytics-service/tests/test_analytics_runner.py
    // (test_position_side_volume_pcts_attributes_via_timestamp_window,
    //  the _compute_volume_metrics edge-case block) — NOT here. We pin the
    // zeros so that if a future regen threads positions/`cost` through (the
    // finding's option (a) fix), this assertion fails and forces whoever
    // regenerates to consciously update the parity expectation instead of the
    // degenerate value silently flipping to a real number.
    const tm = metrics.trade_metrics as Record<string, number>;
    expect(tm.buy_volume_pct).toBe(0);
    expect(tm.sell_volume_pct).toBe(0);
    expect(tm.long_volume_pct).toBe(0);
    expect(tm.short_volume_pct).toBe(0);
    expect(tm.total_volume_usd).toBe(0);
  });
});
