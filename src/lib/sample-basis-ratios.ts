/**
 * Sample-basis risk-corrected ratios (default 252; #597 parameterizes
 * periodsPerYear) for the OWN-BOOK series beside the scenario composer
 * (Phase 42, PEER-05).
 *
 * WHY A STANDALONE FILE, AND WHY IT NO LONGER HOLDS A SHARPE OF ITS OWN.
 * This file began as a REPLICA of the scenario engine's metric math, because
 * `src/lib/scenario.ts` was then frozen (SCENARIO-05) and could not export a
 * shared helper. That freeze is RETIRED (v1.5 ADR-001; the phase-29 to phase-32
 * frozen-spine guards say so). Since Phase 166.1 D-17 (carried into Phase 166.2)
 * the Sharpe here and the Sharpe in `computeScenario` are ONE function,
 * `sharpe` in `src/lib/return-stats.ts`, so the replica's copy of the formula is
 * gone and so is its residue defect (a compounding constant yield reported a
 * Sharpe of 1e12 to 1e14 behind a `volatility > 0` guard). The PARITY golden
 * (`scenario-sample-ratios.test.ts`) now proves the two callers pass the same
 * basis (sample, the same periodsPerYear) rather than that two copies agree.
 * The Sortino and max drawdown are not dispersion ratios and stay local.
 *
 * THE BASIS (verbatim, copied from `scenario.ts:335-378`, the cohort/quantstats
 * convention pinned by `scenario.peer-basis.test.ts`; the `252` below is the
 * DEFAULT periodsPerYear — #597 makes it a per-call argument, e.g. 365 crypto):
 *   - SAMPLE variance: `Σ(r−mean)² / (n−1)` (ddof=1, NOT population /n).
 *   - Sharpe: `(mean·252) / (√sampleVar · √252)`, rf=0, computed by
 *     `return-stats` `sharpe`. Null when the sample sd is 0 or float residue.
 *   - Sortino: downside RMS over TOTAL n × √252, rf=0 — `(mean·252) /
 *     (√(Σ(r<0 ? r² : 0)/n) · √252)`. Null when there are no down days
 *     (downsideVol == 0) — the engine returns null (not `sharpe ?? 0`) so the
 *     UI renders "—" rather than a Sharpe-relabeled value (audit G8.E.6 / P343).
 *   - max_drawdown: peak-to-trough on the cumulative-product wealth curve
 *     `Πᵢ(1+rᵢ)` — basis-invariant (no stdev), always ≤ 0.
 *
 * ROUNDING: matches the engine's payload contract (`scenario.ts:454-456`) so the
 * parity test holds at the rounded precision — sharpe/sortino `toFixed(3)`,
 * max_drawdown `toFixed(5)`. Callers comparing two ratio sets (the own-book
 * delta) subtract the ALREADY-rounded values, exactly as the blend's
 * `scenarioMetrics` are already rounded.
 *
 * DEGENERATE GUARD: a series with fewer than 2 finite returns, or any non-finite
 * return, yields `{ sharpe: null, sortino: null, max_drawdown: null }` — never
 * NaN/Inf. The blend engine pre-collapses below n<10; this replica is fed the
 * OWN-BOOK daily returns (derived from the live equity levels) which can be
 * short, so it guards independently.
 */
import { sharpe } from "@/lib/return-stats";

/** Risk-corrected ratios on the cohort's sample basis (default 252; #597 parameterizes periodsPerYear). Null = insufficient data. */
export interface SampleBasisRatios {
  /** Sample(ddof=1)×√N Sharpe (periodsPerYear, default 252), rf=0. Null when the sample sd is 0 or float residue, or n<2. */
  sharpe: number | null;
  /** Downside-RMS/n × √N Sortino (periodsPerYear, default 252), rf=0. Null when there are no down days or n<2. */
  sortino: number | null;
  /** Peak-to-trough max drawdown on Πᵢ(1+rᵢ) (≤ 0). Null when n<2. */
  max_drawdown: number | null;
}

/**
 * Compute Sharpe / Sortino / max-drawdown for a daily-RETURN series on the
 * SAMPLE / N basis — the same `return-stats` Sharpe as `computeScenario`
 * (proven by the parity golden test). Pure, deterministic, no Date/PRNG.
 *
 * @param dailyReturns decimal daily returns (e.g. 0.012 = +1.2%).
 * @param periodsPerYear annualization basis (#597): 252 (traditional, the
 *   default — keeps every existing caller byte-identical) or 365 (crypto).
 *   Derive it from a strategy's asset class via `annualizationPeriods()`. Used
 *   for BOTH the √N vol/downside annualization AND the mean·N numerator, so the
 *   replica stays in parity with `computeScenario` at ANY basis.
 */
export function sampleBasisRatios(
  dailyReturns: number[],
  periodsPerYear = 252,
): SampleBasisRatios {
  const n = dailyReturns.length;
  // Degenerate guard — need ≥ 2 finite obs for a sample variance; any non-finite
  // return collapses to safe-null (never NaN/Inf reaches a consumer).
  if (n < 2 || dailyReturns.some((r) => !Number.isFinite(r))) {
    return { sharpe: null, sortino: null, max_drawdown: null };
  }

  // SAMPLE (ddof=1) Sharpe, the cohort/quantstats basis: the ONE TS Sharpe,
  // shared with computeScenario (Phase 166.1 D-17).
  const sharpeRaw = sharpe(dailyReturns, { periodsPerYear, ddof: 1 });
  const meanR = dailyReturns.reduce((s, r) => s + r, 0) / n;

  // Sortino: downside RMS divides by TOTAL observations (n), not the count of
  // negative days. Null when there are no down days (downsideVol == 0) so the UI
  // renders "—" rather than a Sharpe-relabeled value (audit G8.E.6 / P343).
  const downsideSumSq = dailyReturns.reduce(
    (s, r) => s + (r < 0 ? r * r : 0),
    0,
  );
  const downsideVar = downsideSumSq / n;
  const downsideVol = Math.sqrt(downsideVar) * Math.sqrt(periodsPerYear);
  const sortinoRaw: number | null =
    downsideVol > 0 ? (meanR * periodsPerYear) / downsideVol : null;

  // Max drawdown on the cumulative-product wealth curve Πᵢ(1+rᵢ). Basis-invariant
  // (no stdev) → identical under either convention; peak-to-trough, always ≤ 0.
  let c = 1;
  let peak = -Infinity;
  let maxDD = 0;
  for (let i = 0; i < n; i++) {
    c *= 1 + dailyReturns[i];
    if (c > peak) peak = c;
    const dd = c / peak - 1;
    if (dd < maxDD) maxDD = dd;
  }

  // Round to the engine's payload contract (scenario.ts:454-456) so parity holds
  // at the rounded precision and own-book deltas subtract like-for-like values.
  return {
    sharpe: sharpeRaw !== null ? Number(sharpeRaw.toFixed(3)) : null,
    sortino: sortinoRaw !== null ? Number(sortinoRaw.toFixed(3)) : null,
    max_drawdown: Number(maxDD.toFixed(5)),
  };
}
