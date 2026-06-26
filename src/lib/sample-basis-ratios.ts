/**
 * Sample/252-basis risk-corrected ratios — a STANDALONE replica of the frozen
 * scenario engine's metric math (Phase 42, PEER-05).
 *
 * ⛔ WHY A STANDALONE FILE (not an extraction from `scenario.ts`):
 * `src/lib/scenario.ts` is the FROZEN projection engine (SCENARIO-05). The v1.2
 * frozen-spine exit guards (`src/__tests__/phase-29..32-frozen-spine-guards.test.ts`)
 * assert it is ZERO-DIFF vs the phase baseline — any edit, even a pure
 * refactor that "extracts" the math, fails CI. So this module REPLICATES the
 * engine's Sharpe / Sortino / max-drawdown math rather than importing a shared
 * helper out of the engine. The replica is pinned to the engine by a
 * PARITY golden test (`scenario-sample-ratios.test.ts`): for the same daily-return
 * series this function's output must EQUAL `computeScenario`'s rounded
 * sharpe/sortino/max_drawdown (parity-by-construction). A drift in either the
 * engine OR this replica fails that test.
 *
 * THE BASIS (verbatim, copied from `scenario.ts:335-378`, the cohort/quantstats
 * convention pinned by `scenario.peer-basis.test.ts`):
 *   - SAMPLE variance: `Σ(r−mean)² / (n−1)` (ddof=1, NOT population /n).
 *   - Sharpe: `(mean·252) / (√sampleVar · √252)`, rf=0. Null when vol == 0.
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

/** Risk-corrected ratios on the cohort's sample/252 basis. Null = insufficient data. */
export interface SampleBasisRatios {
  /** Sample(ddof=1)×√252 Sharpe, rf=0. Null when annualized vol is 0 or n<2. */
  sharpe: number | null;
  /** Downside-RMS/n × √252 Sortino, rf=0. Null when there are no down days or n<2. */
  sortino: number | null;
  /** Peak-to-trough max drawdown on Πᵢ(1+rᵢ) (≤ 0). Null when n<2. */
  max_drawdown: number | null;
}

/**
 * Compute Sharpe / Sortino / max-drawdown for a daily-RETURN series on the
 * SAMPLE / 252 basis — identical math to the frozen `computeScenario` engine
 * (proven by the parity golden test). Pure, deterministic, no Date/PRNG.
 *
 * @param dailyReturns decimal daily returns (e.g. 0.012 = +1.2%).
 */
export function sampleBasisRatios(dailyReturns: number[]): SampleBasisRatios {
  const n = dailyReturns.length;
  // Degenerate guard — need ≥ 2 finite obs for a sample variance; any non-finite
  // return collapses to safe-null (never NaN/Inf reaches a consumer).
  if (n < 2 || dailyReturns.some((r) => !Number.isFinite(r))) {
    return { sharpe: null, sortino: null, max_drawdown: null };
  }

  // Sample mean + SAMPLE variance (÷(n−1)) — the cohort/quantstats basis.
  const meanR = dailyReturns.reduce((s, r) => s + r, 0) / n;
  const variance =
    dailyReturns.reduce((s, r) => s + (r - meanR) * (r - meanR), 0) / (n - 1);
  const volDaily = Math.sqrt(variance);
  const volatility = volDaily * Math.sqrt(252);
  const sharpeRaw = volatility > 0 ? (meanR * 252) / volatility : null;

  // Sortino: downside RMS divides by TOTAL observations (n), not the count of
  // negative days. Null when there are no down days (downsideVol == 0) so the UI
  // renders "—" rather than a Sharpe-relabeled value (audit G8.E.6 / P343).
  const downsideSumSq = dailyReturns.reduce(
    (s, r) => s + (r < 0 ? r * r : 0),
    0,
  );
  const downsideVar = downsideSumSq / n;
  const downsideVol = Math.sqrt(downsideVar) * Math.sqrt(252);
  const sortinoRaw: number | null =
    downsideVol > 0 ? (meanR * 252) / downsideVol : null;

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
