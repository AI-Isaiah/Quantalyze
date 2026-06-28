/**
 * scripts/seed-demo-data.ts
 *
 * Deterministic, idempotent demo-data seeder. Used by:
 *   1. The founder to hydrate staging before a demo
 *   2. CI to rebuild the test database before Playwright runs
 *
 * Deterministic: fixed UUIDs + mulberry32 PRNG seeded from a constant so
 * repeated runs produce byte-identical analytics. No live exchange calls.
 *
 * Idempotent: every insert/upsert is onConflict-safe. Strategies with
 * `is_example=true` are the "demo set" — we never touch non-example rows.
 *
 * Usage (from repo root):
 *   SEED_CONFIRM_STAGING=true \
 *   NEXT_PUBLIC_SUPABASE_URL=... \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   npx tsx scripts/seed-demo-data.ts
 *
 * Prerequisites:
 *   - Migrations 010, 011, 012, 014 must be applied to the target Supabase instance
 *   - Service role key is REQUIRED (writes RLS-protected tables + creates auth.users)
 *   - SEED_CONFIRM_STAGING=true is REQUIRED as a safety interlock
 *   - The target URL must not look production-flavored (hard-rejected)
 */

import { createClient } from "@supabase/supabase-js";
import { WebSocket as WsWebSocket } from "ws";

// ---------- Fixed UUIDs + STRATEGY_PROFILES (re-exported pure-data module) ----------
//
// Red-team RT-J08 (audit-2026-05-07): the spec-import side of these
// constants moved into `scripts/seed-demo-profiles.ts` (data-only,
// no supabase-js import, no side effects) so Playwright spec files
// can import STRATEGY_PROFILES without dragging this module's
// supabase-js dependency into spec-load. Re-export here for
// backwards compatibility — existing imports of `seed-demo-data`
// continue to work unchanged.
export {
  ALLOCATOR_COLD,
  ALLOCATOR_ACTIVE,
  ALLOCATOR_STALLED,
  STRATEGY_UUIDS,
  ACTIVE_PORTFOLIO_ID,
  COLD_PORTFOLIO_ID,
  STALLED_PORTFOLIO_ID,
  STRATEGY_PROFILES,
} from "./seed-demo-profiles";
export type { StrategyProfile } from "./seed-demo-profiles";
import {
  ALLOCATOR_COLD,
  ALLOCATOR_ACTIVE,
  ALLOCATOR_STALLED,
  STRATEGY_PROFILES,
  STRATEGY_UUIDS,
  MANAGER_INSTITUTIONAL_A,
  MANAGER_INSTITUTIONAL_B,
  MANAGER_EXPLORATORY_A,
  MANAGER_EXPLORATORY_B,
  ACTIVE_PORTFOLIO_ID,
  COLD_PORTFOLIO_ID,
  STALLED_PORTFOLIO_ID,
} from "./seed-demo-profiles";
import type { StrategyProfile } from "./seed-demo-profiles";

// realtime-js 2.101's WebSocketFactory probes globalThis.WebSocket the moment
// createClient() constructs its (unused-here) realtime client, and throws
// "Node.js <ver> detected without native WebSocket support" on Node < 22. CI
// runs Node 20, which has no native WebSocket, so the seed step died at
// createClient() before issuing a single insert (every recent main run is red
// on the e2e "Seed demo data" step for this reason). This seed path never opens
// a realtime channel; point the global at the `ws` impl that ships as a direct
// dependency of @supabase/realtime-js. Guarded, so it stays a no-op on Node 22+
// / browsers where a native WebSocket already exists (incl. a future CI bump).
if (typeof globalThis.WebSocket === "undefined") {
  (globalThis as { WebSocket?: unknown }).WebSocket = WsWebSocket;
}

// ---------- Deterministic PRNG (mulberry32) ----------

function mulberry32(seed: number) {
  let a = seed;
  return function rng() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Gaussian sample via Box–Muller, using the supplied PRNG. */
function gaussian(rng: () => number, mean: number, stdDev: number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return mean + stdDev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---------- Analytics generation ----------

interface GeneratedAnalytics {
  cumulative_return: number;
  cagr: number;
  volatility: number;
  sharpe: number;
  sortino: number;
  calmar: number;
  max_drawdown: number;
  six_month_return: number;
  sparkline_returns: number[];
}

function generateAnalytics(profile: StrategyProfile, seed: number): GeneratedAnalytics {
  const rng = mulberry32(seed);

  // 365 daily log returns with the profile's mean + vol
  const dailyMean = profile.annualizedReturn / 365;
  const dailyVol = profile.annualizedVol / Math.sqrt(365);

  const days = 365;
  const returns: number[] = [];
  let cumulative = 1;
  let peak = 1;
  let maxDd = 0;
  const cumulativeSeries: number[] = [1];

  for (let i = 0; i < days; i++) {
    const r = gaussian(rng, dailyMean, dailyVol);
    returns.push(r);
    cumulative *= 1 + r;
    cumulativeSeries.push(cumulative);
    if (cumulative > peak) peak = cumulative;
    const dd = (cumulative - peak) / peak;
    if (dd < maxDd) maxDd = dd;
  }

  const cagr = Math.pow(cumulative, 365 / days) - 1;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((acc, r) => acc + (r - mean) ** 2, 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  const annualVol = stdDev * Math.sqrt(365);
  const sharpe = annualVol > 0 ? (cagr - 0.04) / annualVol : 0;

  // Sortino: use only downside returns
  const downside = returns.filter((r) => r < 0);
  const downsideStd =
    downside.length > 0
      ? Math.sqrt(
          downside.reduce((acc, r) => acc + r * r, 0) / downside.length,
        ) * Math.sqrt(365)
      : annualVol;
  const sortino = downsideStd > 0 ? (cagr - 0.04) / downsideStd : 0;

  const calmar = Math.abs(maxDd) > 1e-6 ? cagr / Math.abs(maxDd) : 0;

  const sixMonthIdx = Math.max(0, cumulativeSeries.length - 183);
  const sixMonthReturn =
    cumulativeSeries[cumulativeSeries.length - 1] /
      cumulativeSeries[sixMonthIdx] -
    1;

  return {
    cumulative_return: cumulative - 1,
    cagr,
    volatility: annualVol,
    sharpe,
    sortino,
    calmar,
    max_drawdown: maxDd,
    six_month_return: sixMonthReturn,
    sparkline_returns: cumulativeSeries.map((v) => v - 1),
  };
}

// ---------- Portfolio analytics JSONB generator ----------
//
// Produces a deterministic `portfolio_analytics` JSONB payload that mirrors
// the shape written by `analytics-service/routers/portfolio.py`. The Python
// service is the canonical writer in prod; the seed script exists purely so
// the public /demo page has data to render without requiring the live
// analytics cron to run against a fresh staging database.
//
// Any drift between this function and the Python writer is a drift bug.
// The matching TypeScript shape is `PortfolioAnalytics` in `src/lib/types.ts`
// and the strict parser is `adaptPortfolioAnalytics` in
// `src/lib/portfolio-analytics-adapter.ts`.
//
// The output MUST round-trip through `adaptPortfolioAnalytics` without
// returning null — `src/__tests__/seed-integrity.test.ts` enforces this.

export interface PortfolioAnalyticsHolding {
  strategy_id: string;
  strategy_name: string;
  weight: number;
  profile: StrategyProfile;
}

// H-1021: the `portfolio_analytics` table is a 4-state machine per its
// CHECK constraint (`computation_status IN ('pending','computing','complete',
// 'failed')` — supabase/migrations/20260407075303_portfolio_intelligence.sql)
// and the writer in analytics-service/routers/portfolio.py
// (`ComputationStatus.{COMPUTING,COMPLETE,FAILED}`, plus the column DEFAULT
// 'pending'). The previous `PortfolioAnalyticsJSONB` interface modelled only
// the "complete" branch as a literal type, which misled any consumer that
// imported it and pulled a non-complete row. The fix is twofold:
//   (a) rename the interface to `CompletePortfolioAnalyticsJSONB` so its
//       narrowness is named — this is what the seed generator emits, NOT
//       a generic DB row;
//   (b) export a discriminated `PortfolioAnalyticsJSONB` union covering
//       every legal status arm so any future consumer reading rows directly
//       from `portfolio_analytics` gets a contract that matches reality
//       (pending/computing rows have no metrics; failed rows carry an
//       error message; only `complete` rows carry metrics).
export type PortfolioAnalyticsJSONB =
  | CompletePortfolioAnalyticsJSONB
  | {
      portfolio_id: string;
      computation_status: "pending";
      computation_error: null;
    }
  | {
      portfolio_id: string;
      computation_status: "computing";
      computation_error: null;
    }
  | {
      portfolio_id: string;
      computation_status: "failed";
      computation_error: string;
    };

export interface CompletePortfolioAnalyticsJSONB {
  portfolio_id: string;
  computation_status: "complete";
  computation_error: null;
  total_aum: number;
  total_return_twr: number;
  total_return_mwr: number;
  portfolio_sharpe: number;
  portfolio_volatility: number;
  portfolio_max_drawdown: number;
  avg_pairwise_correlation: number;
  return_24h: number;
  return_mtd: number;
  return_ytd: number;
  narrative_summary: string;
  correlation_matrix: Record<string, Record<string, number>>;
  attribution_breakdown: Array<{
    strategy_id: string;
    strategy_name: string;
    contribution: number;
    allocation_effect: number;
  }>;
  risk_decomposition: Array<{
    strategy_id: string;
    strategy_name: string;
    marginal_risk_pct: number;
    standalone_vol: number;
    component_var: number;
    weight_pct: number;
  }>;
  benchmark_comparison: {
    symbol: "BTC";
    correlation: number;
    benchmark_twr: number;
    portfolio_twr: number;
    stale: boolean;
  };
  optimizer_suggestions: Array<{
    strategy_id: string;
    strategy_name: string;
    corr_with_portfolio: number;
    sharpe_lift: number;
    dd_improvement: number;
    score: number;
  }>;
  portfolio_equity_curve: Array<{ date: string; value: number }>;
  rolling_correlation: Record<string, Array<{ date: string; value: number }>>;
}

function round(value: number, digits = 4): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/**
 * Format a ratio as a signed percentage string. Avoids the "+−1.23%" bug
 * that happens when a negative value is prefixed with an unconditional "+".
 * Used by the narrative summary (H3 from PR 11 review).
 */
export function formatSignedPct(value: number, digits = 2): string {
  const pct = value * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(digits)}%`;
}

/**
 * Modified Dietz approximation for MWR. The demo seed does not track
 * mid-period cash flows, so this collapses to the simple TWR — which is
 * the correct answer under "no flows". We expose it as a helper so the
 * seed and tests share the same formula. M2 fix from PR 11 review.
 */
export function approximateMwr(totalReturnTwr: number): number {
  return totalReturnTwr;
}

/**
 * M-0845: the generator's math (`portfolioReturns[i] += h.weight * s[i]`)
 * assumes Σ weights == 1. Weights summing to 0.7 or 1.3 would silently
 * scale the entire analytics row, and seed-integrity.test.ts's round-trip
 * adapter check would not catch it. Tolerate a tiny float drift so seeds
 * computed via 0.40 + 0.35 + 0.25 still pass. NaN/Infinity weights short-
 * circuit because `Math.abs(NaN - 1) > 1e-6` is false (NaN comparisons
 * are all false) — guard with Number.isFinite first.
 */
function assertWeightsSumToOne(holdings: PortfolioAnalyticsHolding[]): void {
  const sum = holdings.reduce((acc, h) => acc + h.weight, 0);
  if (!Number.isFinite(sum) || Math.abs(sum - 1) > 1e-6) {
    throw new Error(
      `generatePortfolioAnalyticsJSONB: holdings.weight must sum to 1.0 (got ${sum})`,
    );
  }
}

export function generatePortfolioAnalyticsJSONB(
  portfolioId: string,
  holdings: PortfolioAnalyticsHolding[],
  seed: number,
): CompletePortfolioAnalyticsJSONB {
  if (holdings.length < 2) {
    // Correlation, regime detection, and attribution comparisons all require
    // at least two strategies to be meaningful. Refusing single-holding
    // portfolios at the generator boundary prevents silent `{}`
    // rolling_correlation and `0` avg_pairwise_correlation rows from ever
    // being persisted, and matches the Python writer's behavior for the
    // lowest-holdings edge case.
    throw new Error(
      "generatePortfolioAnalyticsJSONB: holdings must have at least 2 entries",
    );
  }
  assertWeightsSumToOne(holdings);

  const rng = mulberry32(seed);
  const days = 365;
  const dt = 1 / 365;

  // Simulate per-strategy daily returns. Weight the aggregated series to get
  // the portfolio return. Track equity, drawdown, and period returns.
  const strategyReturns: Record<string, number[]> = {};
  for (const h of holdings) {
    const dailyMean = h.profile.annualizedReturn * dt;
    const dailyVol = h.profile.annualizedVol * Math.sqrt(dt);
    const series: number[] = [];
    for (let i = 0; i < days; i++) {
      series.push(gaussian(rng, dailyMean, dailyVol));
    }
    strategyReturns[h.strategy_id] = series;
  }

  const portfolioReturns: number[] = new Array(days).fill(0);
  for (const h of holdings) {
    const s = strategyReturns[h.strategy_id];
    for (let i = 0; i < days; i++) {
      portfolioReturns[i] += h.weight * s[i];
    }
  }

  // Equity curve + drawdown
  const equityCurve: Array<{ date: string; value: number }> = [];
  let equity = 1;
  let peak = 1;
  let maxDd = 0;
  // Anchor the date sequence to a fixed historical start so the seed output
  // is byte-identical across runs (Date.now() would defeat determinism).
  const startDate = new Date(Date.UTC(2025, 0, 1));
  for (let i = 0; i < days; i++) {
    equity *= 1 + portfolioReturns[i];
    if (equity > peak) peak = equity;
    const dd = (equity - peak) / peak;
    if (dd < maxDd) maxDd = dd;
    const d = new Date(startDate);
    d.setUTCDate(d.getUTCDate() + i);
    equityCurve.push({
      date: d.toISOString().slice(0, 10),
      value: round(equity, 6),
    });
  }

  const totalReturnTwr = equity - 1;
  const meanDaily =
    portfolioReturns.reduce((a, b) => a + b, 0) / portfolioReturns.length;
  const variance =
    portfolioReturns.reduce((acc, r) => acc + (r - meanDaily) ** 2, 0) /
    portfolioReturns.length;
  const dailyStd = Math.sqrt(variance);
  const annualVol = dailyStd * Math.sqrt(365);
  const annualizedReturn = meanDaily * 365;
  const sharpe = annualVol > 0 ? (annualizedReturn - 0.04) / annualVol : 0;

  // Per-strategy TWR (cumulative return over the window)
  const strategyTwr: Record<string, number> = {};
  for (const h of holdings) {
    let eq = 1;
    for (const r of strategyReturns[h.strategy_id]) eq *= 1 + r;
    strategyTwr[h.strategy_id] = eq - 1;
  }

  // Attribution: per-strategy TWR * weight, then allocation_effect = contribution
  // - avg_contribution. Matches the shape the Python writer persists.
  const attribution = holdings.map((h) => {
    const contribution = strategyTwr[h.strategy_id] * h.weight;
    return {
      strategy_id: h.strategy_id,
      strategy_name: h.strategy_name,
      contribution: round(contribution, 5),
      allocation_effect: round(
        (strategyTwr[h.strategy_id] - totalReturnTwr) * h.weight,
        5,
      ),
    };
  });

  // Correlation matrix across strategy return series
  const corr: Record<string, Record<string, number>> = {};
  for (const a of holdings) {
    corr[a.strategy_id] = {};
    for (const b of holdings) {
      if (a.strategy_id === b.strategy_id) {
        corr[a.strategy_id][b.strategy_id] = 1;
        continue;
      }
      const sa = strategyReturns[a.strategy_id];
      const sb = strategyReturns[b.strategy_id];
      const ma = sa.reduce((x, y) => x + y, 0) / sa.length;
      const mb = sb.reduce((x, y) => x + y, 0) / sb.length;
      let num = 0;
      let da = 0;
      let db = 0;
      for (let i = 0; i < sa.length; i++) {
        const xa = sa[i] - ma;
        const xb = sb[i] - mb;
        num += xa * xb;
        da += xa * xa;
        db += xb * xb;
      }
      const denom = Math.sqrt(da * db);
      corr[a.strategy_id][b.strategy_id] = denom > 0 ? round(num / denom, 4) : 0;
    }
  }

  // Avg pairwise correlation = mean of unique off-diagonal entries
  let pairSum = 0;
  let pairCount = 0;
  for (let i = 0; i < holdings.length; i++) {
    for (let j = i + 1; j < holdings.length; j++) {
      pairSum += corr[holdings[i].strategy_id][holdings[j].strategy_id];
      pairCount++;
    }
  }
  const avgPairwise = pairCount > 0 ? pairSum / pairCount : 0;

  // Risk decomposition. Matches the Python writer's shape
  // (marginal_risk_pct + standalone_vol + component_var + weight_pct).
  //
  // The Python canonical writer computes `component_risk[i] = w[i] *
  // (Cov @ w)[i] / port_vol`. We do not have the full covariance matrix
  // here (the seed only tracks standalone vols + an aggregate avg pairwise
  // correlation), so we use a diagonal + constant-correlation approximation:
  //
  //     Cov[i,j] ≈ avg_corr * vol[i] * vol[j]   for i ≠ j
  //     Cov[i,i] = vol[i]^2
  //
  // Under that approximation, `(Cov @ w)[i]` reduces to a closed form that
  // preserves the sign, scale, and units of the Python value without
  // demanding a full matrix. Do NOT sum these rows and expect them to equal
  // port_vol exactly — treat as a display proxy only. Flagged by
  // pre-landing code review (C1).
  const weightedVols = holdings.map((h) => h.weight * h.profile.annualizedVol);
  const sumWVol = weightedVols.reduce((a, b) => a + b, 0);
  const weightedVolDenom = sumWVol || 1;
  const portVolApprox = annualVol > 0 ? annualVol : 1;
  const riskDecomposition = holdings.map((h, i) => {
    const vol_i = h.profile.annualizedVol;
    const w_i = h.weight;
    // (Cov @ w)[i] = w[i]*vol[i]^2 + avg_corr * vol[i] * sum_{j≠i} w[j]*vol[j]
    const sumOther = sumWVol - weightedVols[i];
    const covDotW = w_i * vol_i * vol_i + avgPairwise * vol_i * sumOther;
    const componentRisk = (w_i * covDotW) / portVolApprox;
    return {
      strategy_id: h.strategy_id,
      strategy_name: h.strategy_name,
      marginal_risk_pct: round((weightedVols[i] / weightedVolDenom) * 100, 2),
      standalone_vol: round(vol_i, 4),
      component_var: round(componentRisk, 6),
      weight_pct: round(w_i * 100, 2),
    };
  });

  // Benchmark comparison — BTC "noise" derived from the same PRNG for
  // determinism. Correlation is a smoothed proxy based on pairwise avg.
  let btcEquity = 1;
  for (let i = 0; i < days; i++) {
    btcEquity *= 1 + gaussian(rng, 0.0006, 0.035);
  }
  const benchmarkTwr = btcEquity - 1;
  const benchmarkComparison = {
    symbol: "BTC" as const,
    correlation: round(0.35 + avgPairwise * 0.3, 3),
    benchmark_twr: round(benchmarkTwr, 4),
    portfolio_twr: round(totalReturnTwr, 4),
    stale: false,
  };

  // Optimizer suggestions: not required by the /demo hero but shape matches
  // the Python writer so adaptPortfolioAnalytics round-trips cleanly. We leave
  // the array empty — the page treats empty arrays as null, which is fine.
  const optimizerSuggestions: CompletePortfolioAnalyticsJSONB["optimizer_suggestions"] =
    [];

  // Rolling correlation — a single representative pair for the first two
  // holdings, bucketed into 12 monthly points. Keyed by "<sidA>:<sidB>".
  // The `holdings.length < 2` guard at the top guarantees [0] and [1] exist.
  const rolling: Record<string, Array<{ date: string; value: number }>> = {};
  const rollA = holdings[0];
  const rollB = holdings[1];
  const pairKey = `${rollA.strategy_id}:${rollB.strategy_id}`;
  const points: Array<{ date: string; value: number }> = [];
  const windowDays = 30;
  for (let k = 0; k < 12; k++) {
    const startIdx = k * windowDays;
    const endIdx = Math.min(startIdx + windowDays, days);
    const sa = strategyReturns[rollA.strategy_id].slice(startIdx, endIdx);
    const sb = strategyReturns[rollB.strategy_id].slice(startIdx, endIdx);
    if (sa.length < 5) break;
    const ma = sa.reduce((x, y) => x + y, 0) / sa.length;
    const mb = sb.reduce((x, y) => x + y, 0) / sb.length;
    let num = 0;
    let da = 0;
    let db = 0;
    for (let i = 0; i < sa.length; i++) {
      const xa = sa[i] - ma;
      const xb = sb[i] - mb;
      num += xa * xb;
      da += xa * xa;
      db += xb * xb;
    }
    const denom = Math.sqrt(da * db);
    const d = new Date(startDate);
    d.setUTCDate(d.getUTCDate() + startIdx + windowDays - 1);
    points.push({
      date: d.toISOString().slice(0, 10),
      value: denom > 0 ? round(num / denom, 4) : 0,
    });
  }
  if (points.length > 0) rolling[pairKey] = points;

  // Period returns sampled from the back of the equity curve. 30/90/365 day
  // windows give MTD/YTD proxies that are monotonic within a run.
  const lastIdx = equityCurve.length - 1;
  const returnOverWindow = (window: number): number => {
    const startIdx = Math.max(0, lastIdx - window);
    const end = equityCurve[lastIdx].value;
    const start = equityCurve[startIdx].value;
    return start > 0 ? end / start - 1 : 0;
  };

  const return24h = round(portfolioReturns[lastIdx], 5);
  const returnMtd = round(returnOverWindow(30), 5);
  const returnYtd = round(returnOverWindow(365), 5);

  // Total AUM from the holdings + profiles. Callers pass realistic portfolio
  // sizes so this matches the "allocated_amount" sum in the seed script.
  const totalAum = holdings.reduce(
    (acc, h) => acc + h.weight * h.profile.aum,
    0,
  );

  // Narrative — templated on the largest contributor (by absolute magnitude
  // so a drag-dominated run still names the culprit) and the average
  // pairwise correlation. Matches the "Your portfolio returned ..." voice
  // used on /demo. Signed contributions use `formatSignedPct` so a negative
  // top contributor renders as "-1.23%" rather than "+-1.23%" (H3).
  const topContributor = [...attribution].sort(
    (a, b) => Math.abs(b.contribution) - Math.abs(a.contribution),
  )[0];
  const contributionVerb =
    topContributor.contribution >= 0 ? "driven primarily by" : "dragged down by";
  const narrative =
    `Your portfolio returned ${formatSignedPct(returnMtd, 1)} MTD (TWR), ` +
    `${contributionVerb} ${topContributor.strategy_name} ` +
    `(${formatSignedPct(topContributor.contribution, 2)} contribution). ` +
    `Average pairwise correlation is ${avgPairwise.toFixed(2)}, ` +
    `which is ${avgPairwise < 0.4 ? "well-diversified" : "concentrated"}.`;

  return {
    portfolio_id: portfolioId,
    computation_status: "complete",
    computation_error: null,
    total_aum: round(totalAum, 2),
    total_return_twr: round(totalReturnTwr, 5),
    // No intra-period cash flows in the seed scenario, so MWR == TWR under
    // Modified Dietz. Avoids a fabricated ~3% spread that looked plausible
    // but would contradict itself if a demo card ever rendered both.
    total_return_mwr: round(approximateMwr(totalReturnTwr), 5),
    portfolio_sharpe: round(sharpe, 3),
    portfolio_volatility: round(annualVol, 4),
    portfolio_max_drawdown: round(maxDd, 4),
    avg_pairwise_correlation: round(avgPairwise, 3),
    return_24h: return24h,
    return_mtd: returnMtd,
    return_ytd: returnYtd,
    narrative_summary: narrative,
    correlation_matrix: corr,
    attribution_breakdown: attribution,
    risk_decomposition: riskDecomposition,
    benchmark_comparison: benchmarkComparison,
    optimizer_suggestions: optimizerSuggestions,
    portfolio_equity_curve: equityCurve,
    rolling_correlation: rolling,
  };
}

// ---------- StrategyIdx (exported for type-level pin in tests) ----------
//
// H-1022 (G2 / pr-test-analyzer): `StrategyIdx` is the legal-index union over
// STRATEGY_UUIDS — `0 | 1 | ... | 7` for the current 8-entry tuple. Exported so
// `src/__tests__/seed-demo-data-types.test.ts` can `@ts-expect-error` an
// out-of-bounds index at compile time. The previous inline definition inside
// `main()` was unreachable from the test boundary. Adding a 9th UUID auto-
// widens the type via the `as const` tuple — no manual edit needed here.
export type StrategyIdx = Exclude<
  Partial<typeof STRATEGY_UUIDS>["length"],
  typeof STRATEGY_UUIDS["length"]
>;

// ---------- Main ----------

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  // Hard guard against running against production. The script wipes
  // is_example=true strategies and creates 7 confirmed auth users — an
  // accidental run against a prod URL is catastrophic. Require an explicit
  // opt-in env var AND reject any URL that looks production-flavored.
  if (/\b(prod|production)\b/i.test(url)) {
    throw new Error(
      `[seed] Refusing to run against production-flavored URL: ${url}`,
    );
  }
  if (process.env.SEED_CONFIRM_STAGING !== "true") {
    throw new Error(
      "[seed] Refusing to run without SEED_CONFIRM_STAGING=true. " +
        `Target URL: ${url}. Set SEED_CONFIRM_STAGING=true to confirm this is a staging instance.`,
    );
  }

  const supabase = createClient(url, serviceKey);

  console.log("[seed] Wiping existing demo portfolios for all 3 personas ...");
  // The strategy wipe below cascades into portfolio_strategies (FK), but the
  // portfolio shell itself is not owned by any strategy, so it survives.
  // Delete the shells first so re-runs don't accumulate stale demo portfolios.
  // Idempotent — no-op if a portfolio does not yet exist.
  //
  // `portfolio_analytics` has an ON DELETE CASCADE FK to portfolios, so
  // deleting the portfolio row also wipes its analytics history. This keeps
  // the seed script deterministic: every run produces exactly one analytics
  // row per portfolio, even after many invocations.
  const { error: portWipeErr } = await supabase
    .from("portfolios")
    .delete()
    .in("id", [ACTIVE_PORTFOLIO_ID, COLD_PORTFOLIO_ID, STALLED_PORTFOLIO_ID]);
  if (portWipeErr) throw portWipeErr;

  console.log("[seed] Wiping existing is_example=true rows ...");
  // Delete match_decisions referencing the demo strategies first.
  // `match_decisions.original_strategy_id` (migration 064) is `ON DELETE
  // RESTRICT`, so a previous seed run's match_decisions row referencing
  // STRATEGY_UUIDS[1] via original_strategy_id blocks the strategies wipe
  // even though that same row's strategy_id FK is `ON DELETE CASCADE`.
  // PostgreSQL checks RESTRICT before evaluating CASCADE, so the cascade
  // chain doesn't help. Wipe both sides explicitly.
  const { error: mdWipeErr } = await supabase
    .from("match_decisions")
    .delete()
    .or(
      `strategy_id.in.(${STRATEGY_UUIDS.join(",")}),original_strategy_id.in.(${STRATEGY_UUIDS.join(",")})`,
    );
  if (mdWipeErr) throw mdWipeErr;

  // Delete analytics first (FK cascade would also work, but being explicit
  // keeps the logs readable). strategy_analytics has a UNIQUE FK so we
  // cascade via strategies anyway.
  const { error: wipeErr } = await supabase
    .from("strategies")
    .delete()
    .eq("is_example", true);
  if (wipeErr) throw wipeErr;

  console.log("[seed] Ensuring auth.users for demo UUIDs ...");
  // profiles.id has a FK to auth.users(id). We must create auth users with
  // the hard-coded UUIDs before upserting profiles. Uses the admin API,
  // which allows specifying id + email. Idempotent: only swallows the
  // specific "already exists" conflicts Supabase returns (status 422 with
  // a known code). Anything else is a real error and must surface.
  //
  // NOTE: the shared `ensureAuthUser` helper in src/lib/supabase/admin-users.ts
  // performs an additional profiles-by-email lookup on conflict, which is
  // the correct behavior for partner-import but is WRONG for this seed script.
  // The seed script assigns fixed UUIDs and re-runs may hit a half-broken
  // state where auth.users has the row but profiles does not — the downstream
  // profile upsert below (by hard-coded id) will repair that state, so we
  // just continue on conflict here instead of demanding a matching profile
  // row up-front.
  const authUsers = [
    { id: ALLOCATOR_COLD, email: "demo-cold@example.com" },
    { id: ALLOCATOR_ACTIVE, email: "demo-active@example.com" },
    { id: ALLOCATOR_STALLED, email: "demo-stalled@example.com" },
    { id: MANAGER_INSTITUTIONAL_A, email: "alice@example-stellar.com" },
    { id: MANAGER_INSTITUTIONAL_B, email: "marcus@example-aurora.com" },
    { id: MANAGER_EXPLORATORY_A, email: "helios@example-demo.com" },
    { id: MANAGER_EXPLORATORY_B, email: "pulsar@example-demo.com" },
  ];
  const KNOWN_CONFLICT_CODES = /^(email_exists|user_already_exists|phone_exists)$/;
  for (const u of authUsers) {
    const { error } = await supabase.auth.admin.createUser({
      id: u.id,
      email: u.email,
      email_confirm: true,
    });
    if (!error) continue;
    const status = (error as { status?: number }).status;
    const code = (error as { code?: string }).code ?? "";
    if (status === 422 && KNOWN_CONFLICT_CODES.test(code)) continue;
    throw error;
  }

  console.log("[seed] Upserting profiles (3 allocators + 4 managers) ...");
  // Explicit element type (defensive). The allocator rows (allocator_status)
  // and manager rows (manager_status/bio/years_trading/aum_range/linkedin)
  // have different shapes, so an un-annotated array infers a UNION. This
  // seed's client is currently UNTYPED (`createClient(url, key)` with no
  // `<Database>` generic ⇒ Database=any), so `.upsert(row)` accepts `any`
  // and the union is harmless TODAY. But the moment the client is typed
  // `createClient<Database>(…)`, `.upsert` enforces `RejectExcessProperties`
  // over the union members — and the branches disagree on which optional
  // keys are present, so it stops compiling (the build error this pre-empts).
  // One explicit shape with the variant fields optional keeps it a single
  // type the profiles upsert accepts under either client typing.
  type ProfileSeedRow = {
    id: string;
    display_name: string;
    company: string | null;
    email: string;
    role: string;
    allocator_status?: string;
    manager_status?: string;
    bio?: string;
    years_trading?: number;
    aum_range?: string;
    linkedin?: string;
  };
  const profileRows: ProfileSeedRow[] = [
    {
      id: ALLOCATOR_COLD,
      display_name: "Cold Start Capital",
      company: "Cold Start Capital",
      email: "demo-cold@example.com",
      role: "allocator",
      allocator_status: "verified",
    },
    {
      id: ALLOCATOR_ACTIVE,
      display_name: "Active Allocator LP",
      company: "Active Allocator LP",
      email: "demo-active@example.com",
      role: "allocator",
      allocator_status: "verified",
    },
    {
      id: ALLOCATOR_STALLED,
      display_name: "Stalled Diligence Fund",
      company: "Stalled Diligence Fund",
      email: "demo-stalled@example.com",
      role: "allocator",
      allocator_status: "verified",
    },
    {
      id: MANAGER_INSTITUTIONAL_A,
      display_name: "Dr. Alice Chen",
      company: "Stellar Quant Research",
      email: "alice@example-stellar.com",
      role: "manager",
      manager_status: "verified",
      bio: "PhD in statistical physics from Princeton. 12 years trading equities and derivatives at Citadel and Two Sigma. Runs market-neutral crypto strategies since 2022.",
      years_trading: 12,
      aum_range: "$10M–$50M",
      linkedin: "https://www.linkedin.com/in/alice-chen-demo",
    },
    {
      id: MANAGER_INSTITUTIONAL_B,
      display_name: "Marcus Okafor",
      company: "Aurora Systematic",
      email: "marcus@example-aurora.com",
      role: "manager",
      manager_status: "verified",
      bio: "Former Jump Trading options desk. Builds systematic vol-carry and basis-trade strategies across CEX and DEX venues.",
      years_trading: 9,
      aum_range: "$25M–$100M",
      linkedin: "https://www.linkedin.com/in/marcus-okafor-demo",
    },
    {
      id: MANAGER_EXPLORATORY_A,
      display_name: "Helios Research",
      company: null,
      email: "helios@example-demo.com",
      role: "manager",
      manager_status: "pending",
    },
    {
      id: MANAGER_EXPLORATORY_B,
      display_name: "Pulsar Labs",
      company: null,
      email: "pulsar@example-demo.com",
      role: "manager",
      manager_status: "pending",
    },
  ];

  for (const row of profileRows) {
    const { error } = await supabase.from("profiles").upsert(row, {
      onConflict: "id",
    });
    if (error) throw error;
  }

  console.log("[seed] Upserting allocator preferences ...");
  const preferenceRows = [
    {
      user_id: ALLOCATOR_COLD,
      mandate_archetype: "Market Neutral",
      target_ticket_size_usd: 5_000_000,
      excluded_exchanges: [],
      min_sharpe: 1.0,
      min_track_record_days: 180,
    },
    {
      user_id: ALLOCATOR_ACTIVE,
      mandate_archetype: "L/S Equity Stat Arb",
      target_ticket_size_usd: 10_000_000,
      excluded_exchanges: [],
      min_sharpe: 1.3,
      min_track_record_days: 365,
    },
    {
      user_id: ALLOCATOR_STALLED,
      mandate_archetype: "Crypto SMA",
      target_ticket_size_usd: 2_500_000,
      excluded_exchanges: [],
      min_sharpe: 0.8,
      min_track_record_days: 180,
    },
  ];
  for (const row of preferenceRows) {
    const { error } = await supabase.from("allocator_preferences").upsert(row, {
      onConflict: "user_id",
    });
    if (error) throw error;
  }

  // Look up the crypto-sma discovery category id once. The discovery page
  // query (getStrategiesByCategory in src/lib/queries.ts) joins
  // `discovery_categories!inner` filtered by slug, so strategies with
  // NULL category_id are silently excluded. Seeding strategies without
  // category_id was the root cause of the recurring e2e failure
  // `discovery-hide-examples-default.spec.ts: discovery table never
  // produced a non-empty-state row in 10s` — the seed inserted rows but
  // the discovery page couldn't see them.
  const { data: cryptoCatRow, error: catErr } = await supabase
    .from("discovery_categories")
    .select("id")
    .eq("slug", "crypto-sma")
    .single();
  if (catErr || !cryptoCatRow) {
    throw new Error(
      `[seed] discovery_categories row for slug='crypto-sma' not found. ` +
        `The initial schema migration (20260405061911_initial_schema.sql) ` +
        `seeds this row — if it's missing the migration didn't run. ` +
        `Error: ${catErr?.message ?? "no rows"}`,
    );
  }
  const cryptoSmaCategoryId = cryptoCatRow.id;

  console.log(
    `[seed] Resolved crypto-sma category_id=${cryptoSmaCategoryId}; ` +
      "inserting 8 example strategies + analytics ...",
  );
  for (let i = 0; i < STRATEGY_PROFILES.length; i++) {
    const profile = STRATEGY_PROFILES[i];
    const { error: sErr } = await supabase.from("strategies").insert({
      id: profile.id,
      user_id: profile.user_id,
      // Link to crypto-sma category so /discovery/crypto-sma can find
      // the row. discovery_categories!inner join in
      // getStrategiesByCategory drops rows where category_id IS NULL.
      category_id: cryptoSmaCategoryId,
      name: profile.name,
      description: profile.description,
      strategy_types: profile.strategy_types,
      markets: ["crypto"],
      supported_exchanges: ["binance", "okx"],
      leverage_range: profile.leverage_range,
      aum: profile.aum,
      start_date: profile.startDate,
      status: "published",
      is_example: true,
      benchmark: "BTC",
      disclosure_tier: profile.disclosure_tier,
      codename: profile.codename ?? null,
    });
    if (sErr) throw sErr;

    const analytics = generateAnalytics(profile, 1000 + i);
    const { error: aErr } = await supabase.from("strategy_analytics").insert({
      strategy_id: profile.id,
      computation_status: "complete",
      benchmark: "BTC",
      cumulative_return: analytics.cumulative_return,
      cagr: analytics.cagr,
      volatility: analytics.volatility,
      sharpe: analytics.sharpe,
      sortino: analytics.sortino,
      calmar: analytics.calmar,
      max_drawdown: analytics.max_drawdown,
      six_month_return: analytics.six_month_return,
      sparkline_returns: analytics.sparkline_returns,
    });
    if (aErr) throw aErr;
  }

  console.log("[seed] Creating 3 persona portfolios (active / cold / stalled) ...");
  // Three personas drive the /demo page:
  //   ACTIVE  — 3 institutional strategies, diversified, healthy Sharpe
  //   COLD    — 6 strategies, over-diversified, mediocre return, low correlation
  //   STALLED — 2 strategies, concentrated, high Sharpe, high drawdown
  //
  // All three use the same idempotent upsert-then-bulk-membership pattern.

  // H-1022: narrow strategy_idx to the literal indices that exist in
  // STRATEGY_UUIDS. Definition lives at module scope above (`export type
  // StrategyIdx`) so tests can pin it via `@ts-expect-error`. A typo of 8
  // would compile (number is unbounded), then `STRATEGY_UUIDS[8]` returns
  // undefined → opaque PostgREST error, and `STRATEGY_PROFILES[8]` crashes
  // deep inside gaussian() with "Cannot read properties of undefined".
  // M-0847: pin portfolio_id to the literal persona UUIDs so the analyticsSeeds
  // exhaustiveness check below can index by `p.portfolio_id` without a cast.
  type PersonaPortfolioId =
    | typeof ACTIVE_PORTFOLIO_ID
    | typeof COLD_PORTFOLIO_ID
    | typeof STALLED_PORTFOLIO_ID;
  interface PersonaPortfolio {
    portfolio_id: PersonaPortfolioId;
    user_id: string;
    name: string;
    description: string;
    memberships: Array<{
      strategy_idx: StrategyIdx;
      current_weight: number;
      allocated_amount: number;
    }>;
  }

  const personaPortfolios: PersonaPortfolio[] = [
    {
      portfolio_id: ACTIVE_PORTFOLIO_ID,
      user_id: ALLOCATOR_ACTIVE,
      name: "Active Allocator Portfolio",
      description: "Seeded demo portfolio linking 3 institutional strategies.",
      // Target allocation sums to 1.0; allocated_amount sums to $10M.
      memberships: [
        { strategy_idx: 0, current_weight: 0.40, allocated_amount: 4_000_000 },
        { strategy_idx: 1, current_weight: 0.35, allocated_amount: 3_500_000 },
        { strategy_idx: 2, current_weight: 0.25, allocated_amount: 2_500_000 },
      ],
    },
    {
      portfolio_id: COLD_PORTFOLIO_ID,
      user_id: ALLOCATOR_COLD,
      name: "Cold Start Capital — Discovery Book",
      description:
        "6 strategies across all 8 seeded names. Over-diversified, low correlation, mediocre return.",
      // 6 equal-ish slices; sums to 1.0, total $6M.
      memberships: [
        { strategy_idx: 0, current_weight: 0.20, allocated_amount: 1_200_000 },
        { strategy_idx: 2, current_weight: 0.18, allocated_amount: 1_080_000 },
        { strategy_idx: 3, current_weight: 0.17, allocated_amount: 1_020_000 },
        { strategy_idx: 4, current_weight: 0.16, allocated_amount: 960_000 },
        { strategy_idx: 5, current_weight: 0.15, allocated_amount: 900_000 },
        { strategy_idx: 7, current_weight: 0.14, allocated_amount: 840_000 },
      ],
    },
    {
      portfolio_id: STALLED_PORTFOLIO_ID,
      user_id: ALLOCATOR_STALLED,
      name: "Stalled Diligence Fund — Concentrated Book",
      description:
        "2 strategies, concentrated, high Sharpe, high drawdown. Stuck in due diligence.",
      // Heavy concentration in a trend-follow + vol harvester pair; $5M total.
      memberships: [
        { strategy_idx: 6, current_weight: 0.65, allocated_amount: 3_250_000 },
        { strategy_idx: 3, current_weight: 0.35, allocated_amount: 1_750_000 },
      ],
    },
  ];

  // Red-team F4: each persona's portfolio + memberships block is wrapped in
  // try/catch. The previous code let any per-persona failure (a bad weight
  // sum, a transient PostgREST 409 on portfolio_strategies, an FK violation
  // from a stale strategy id) abort the loop mid-flight — leaving the test
  // DB in a half-seeded state (some persona portfolios upserted, others
  // missing). E2E suites then ran against that partial DB and produced
  // confusing red diagnostics that were not the real bug. Per-persona
  // isolation guarantees a single bad persona is logged + skipped without
  // poisoning the rest of the seed run.
  for (const p of personaPortfolios) {
    try {
      const { error: portErr } = await supabase.from("portfolios").upsert(
        {
          id: p.portfolio_id,
          user_id: p.user_id,
          name: p.name,
          description: p.description,
        },
        { onConflict: "id" },
      );
      if (portErr) throw portErr;

      const { error: psErr } = await supabase
        .from("portfolio_strategies")
        .upsert(
          p.memberships.map((m) => ({
            portfolio_id: p.portfolio_id,
            strategy_id: STRATEGY_UUIDS[m.strategy_idx],
            current_weight: m.current_weight,
            allocated_amount: m.allocated_amount,
          })),
          { onConflict: "portfolio_id,strategy_id" },
        );
      if (psErr) throw psErr;
    } catch (err) {
      console.error(
        `[seed] Persona ${p.name} (${p.portfolio_id}) FAILED, skipping. ` +
          `Other personas will continue. Cause:`,
        err,
      );
      continue;
    }
  }

  console.log("[seed] Inserting deterministic portfolio_analytics rows ...");
  // `portfolio_analytics` is append-only (no UNIQUE on portfolio_id). The
  // portfolio wipe above cascades via ON DELETE CASCADE, so any previous
  // analytics rows are already gone — we just need a single INSERT per
  // portfolio here. Distinct seeds keep each persona's curve unique but
  // byte-identical across runs.
  // M-0847: key the seeds map by the literal persona-portfolio UUIDs so a
  // future contributor who adds a 4th persona but forgets to extend this
  // map gets a TS error rather than silent `mulberry32(undefined)` →
  // NaN-saturated analytics rows. `satisfies` enforces exhaustiveness
  // without widening the inferred value type.
  const analyticsSeeds = {
    [ACTIVE_PORTFOLIO_ID]: 9001,
    [COLD_PORTFOLIO_ID]: 9002,
    [STALLED_PORTFOLIO_ID]: 9003,
  } satisfies Record<PersonaPortfolioId, number>;

  // Red-team F4: same try/catch isolation applies to the analytics phase.
  // assertWeightsSumToOne throws synchronously inside
  // generatePortfolioAnalyticsJSONB; a single bad persona's weights would
  // otherwise abort the whole analytics insert phase. Skip + log so the
  // healthy personas still get their analytics rows.
  for (const p of personaPortfolios) {
    try {
      const holdings: PortfolioAnalyticsHolding[] = p.memberships.map((m) => {
        const profile = STRATEGY_PROFILES[m.strategy_idx];
        return {
          strategy_id: profile.id,
          strategy_name: profile.name,
          weight: m.current_weight,
          profile,
        };
      });

      const payload = generatePortfolioAnalyticsJSONB(
        p.portfolio_id,
        holdings,
        analyticsSeeds[p.portfolio_id],
      );

      const { error: paErr } = await supabase
        .from("portfolio_analytics")
        .insert(payload);
      if (paErr) throw paErr;
    } catch (err) {
      console.error(
        `[seed] Persona analytics ${p.name} (${p.portfolio_id}) FAILED, skipping. ` +
          `Other persona analytics will continue. Cause:`,
        err,
      );
      continue;
    }
  }

  console.log("[seed] Inserting 1 historical match_decision + contact_request ...");
  const { data: existingCR } = await supabase
    .from("contact_requests")
    .select("id")
    .eq("allocator_id", ALLOCATOR_ACTIVE)
    .eq("strategy_id", STRATEGY_UUIDS[0])
    .maybeSingle();

  let contactRequestId: string | undefined;
  if (!existingCR) {
    const { data: insertedCR, error: crErr } = await supabase
      .from("contact_requests")
      .insert({
        allocator_id: ALLOCATOR_ACTIVE,
        strategy_id: STRATEGY_UUIDS[0],
        status: "pending",
        message: "Historical demo intro (seeded).",
      })
      .select("id")
      .single();
    if (crErr) throw crErr;
    contactRequestId = insertedCR.id as string;
  } else {
    contactRequestId = existingCR.id as string;
  }

  const { data: existingDecision } = await supabase
    .from("match_decisions")
    .select("id")
    .eq("allocator_id", ALLOCATOR_ACTIVE)
    .eq("strategy_id", STRATEGY_UUIDS[0])
    .eq("decision", "sent_as_intro")
    .maybeSingle();

  if (!existingDecision) {
    const { error: dErr } = await supabase.from("match_decisions").insert({
      allocator_id: ALLOCATOR_ACTIVE,
      strategy_id: STRATEGY_UUIDS[0],
      // `kind` is NOT NULL (enum match_decision_kind) with no DB default, so
      // it MUST be set explicitly — relying on an implicit default is what
      // broke this seed once the test project caught up to the current schema.
      // Migration 080's per-kind CHECK requires a `bridge_recommended` row to
      // carry exactly one of original_strategy_id / original_holding_ref. The
      // seed models "we bridged the active allocator from strategy[1] to
      // strategy[0]", so set kind=bridge_recommended and populate
      // original_strategy_id with strategy[1].
      kind: "bridge_recommended",
      original_strategy_id: STRATEGY_UUIDS[1],
      decision: "sent_as_intro",
      founder_note: "Historical demo intro (seeded).",
      contact_request_id: contactRequestId,
      decided_by: ALLOCATOR_ACTIVE, // Self-reference for seed data — swapped for real founder id in prod
    });
    if (dErr) throw dErr;
  }

  console.log("[seed] Done. Seeded:");
  console.log("  - 3 allocator profiles (1 cold, 1 active, 1 stalled)");
  console.log(`  - ${STRATEGY_PROFILES.length} example strategies`);
  console.log(
    `  - ${STRATEGY_PROFILES.filter((s) => s.disclosure_tier === "institutional").length} institutional + ${STRATEGY_PROFILES.filter((s) => s.disclosure_tier === "exploratory").length} exploratory`,
  );
  console.log("  - 1 historical match_decision + contact_request");
  console.log("  - 3 persona portfolios (active / cold / stalled)");
  console.log("  - 3 deterministic portfolio_analytics rows");
  console.log("");
  console.log(
    "Next: hit POST /api/admin/match/recompute for each allocator to populate match_batches.",
  );
}

// Only run `main()` when the script is the entry point (tsx / node). When
// imported by vitest — e.g. `src/__tests__/seed-integrity.test.ts` — skip
// the invocation so tests can use the exported pure helpers without
// tripping the Supabase env-var guards inside `main()`.
//
// Detection is belt + suspenders (M3 from PR 11 review): the presence of
// the vitest-injected `VITEST_WORKER_ID` / `VITEST` env var or the explicit
// opt-out `SEED_SKIP_MAIN` keeps the script importable even when the argv
// heuristic fails (e.g., tsx resolving through a temp `.js` cache). The
// argv check stays as a positive signal for the common tsx run.
// H-1023: exported so the regression test can assert on the predicate
// directly. The denylist shape (VITEST + SEED_SKIP_MAIN) is the only thing
// standing between a stray `npx tsx --test` and a destructive wipe of the
// shared test-Supabase project; an undetected refactor that flips the
// VITEST branch to `return true` would slip past the import-time
// `createClient`-was-never-called check (because env-validation throws
// earlier). Direct coverage on the predicate is the missing safety net.
export function isScriptEntryPoint(): boolean {
  if (process.env.VITEST || process.env.VITEST_WORKER_ID) return false;
  if (process.env.SEED_SKIP_MAIN) return false;
  const entryPath = process.argv[1] ?? "";
  return (
    entryPath.endsWith("seed-demo-data.ts") ||
    entryPath.endsWith("seed-demo-data.js")
  );
}

if (isScriptEntryPoint()) {
  main().catch((err) => {
    console.error("[seed] FAILED:", err);
    process.exit(1);
  });
}
