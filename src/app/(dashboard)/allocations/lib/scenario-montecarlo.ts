/**
 * Forward-uncertainty Monte-Carlo engine (Plan 27-01, SIM-01).
 *
 * A pure, side-effect-free, DETERMINISTIC-by-seed lib that turns the scenario
 * engine's already-computed `portfolio_daily_returns` into forward confidence
 * bands — with NO Normal-tail assumption, honest to sample size, and gated on
 * the Phase-22 minimum-sample floor (the single source of truth, never a second
 * `60`). No `fetch`, no DOM, no time reads, and NO `Math.random` (un-seedable);
 * randomness flows through a seeded `mulberry32` so identical inputs+seed give
 * byte-identical bands and a method change fails CI loudly.
 *
 * ── Why bootstrap the PORTFOLIO series (SIM-01.1 "jointly across strategies") ──
 * `computeScenario` already produces `portfolio_daily_returns`: one weighted,
 * renormalized, LEVERAGE-baked return PER common date. Each day is the *joint*
 * realization of every active strategy that day, so resampling whole portfolio
 * days in contiguous blocks preserves BOTH:
 *   - contemporaneous cross-strategy correlation — it is intrinsic to each day's
 *     portfolio number (we never split a calendar day apart), and
 *   - autocorrelation — contiguous blocks keep the short-horizon serial structure.
 * This reuses the engine's already-correct joint series rather than re-deriving
 * per-strategy weighting/leverage in a worker (a second, drift-prone path). It is
 * also leverage-aware for free: leverage is baked into `portfolio_daily_returns`
 * via `w·L·r`, so 2× uniform leverage widens the bands with no special handling.
 *
 * ── Method: moving/circular block bootstrap + parameter-uncertainty drift ──
 * For each of `paths` paths we build a `horizonDays`-long forward return sequence
 * by drawing contiguous blocks of length `L` from the historical series with a
 * circular wrap (every start index equally likely; no end-of-series under-
 * sampling), compound to a cumulative-RETURN path, and read empirical quantiles
 * across paths at each forward step.
 *
 * ── Why a per-path drift term (SIM-01.2 "honest to sample size") ──
 * A PLAIN block bootstrap's band width tracks the realized volatility (≈ √H·σ̂),
 * which is essentially INDEPENDENT of n — so a short history would NOT produce a
 * visibly wider band, violating SIM-01.2. The honest, non-parametric fix is to
 * propagate the estimation uncertainty of the mean: for each path we bootstrap
 * the sample mean (n draws with replacement → `μ*`), giving a per-path mean error
 * `δ = μ* − μ̂` whose spread across paths is ≈ σ̂/√n.
 *
 * CRITICAL — we propagate δ as a LINEAR-in-horizon shift of the CUMULATIVE return
 * (at forward step `s` the drift contributes `s·δ`), NOT by adding δ to every
 * daily return and compounding it. Compounding a per-day constant gives a
 * terminal effect of `exp(s·δ)`, which inflates the band SUPER-LINEARLY (it
 * explodes at long horizons) and injects a Jensen upward skew — a dishonestly
 * wide band, the very false-precision the floor gate exists to prevent. The
 * additive `s·δ` term is exactly the standard error of the `s`-day cumulative
 * mean (`s·σ̂/√n`): it grows LINEARLY with horizon, is BOUNDED, is mean-zero (the
 * median band stays the realized-mean path — no Jensen skew, the shift is
 * additive not compounded), and leaves the bootstrap path's daily returns — hence
 * its autocorrelation — untouched. Shorter history ⇒ larger `δ` spread ⇒ visibly
 * wider bands (SIM-01.2); a long history shrinks it toward zero (bands converge
 * to the realized-dispersion band). The cumulative return is clamped at −1: a
 * loss worse than −100% is impossible for the long book, so the drift can never
 * fabricate a sub-(−100%) band edge. Toggleable via `parameterUncertainty`
 * (default on) so the determinism/horizon tests can isolate the block bootstrap.
 *
 * ── Honest absence (never a fabricated band) ──
 * Below the floor, or on an empty / non-finite series, we return an `ok:false`
 * envelope with `bands:null` + `terminal:null` and a `reason` the section routes
 * on — never zeros, never a fabricated band (mirrors `scenario-stress.ts`).
 */

import { evaluateSampleFloor, SAMPLE_FLOOR_OVERLAPPING_DAYS } from "@/lib/sample-floor";
import type { DailyPoint } from "@/lib/portfolio-math-utils";

export const MC_PATHS_DEFAULT = 1000;
export const MC_HORIZON_DEFAULT = 252;
/** A fixed default seed so the live bands are reproducible per identical draft
 *  (bands are an honesty surface, not a slot machine). */
export const MC_SEED_DEFAULT = 0x5ce7a210;
/** The default quantile band edges (5/25/50/75/95). Keyed "p5".."p95" in output. */
export const MC_QUANTILES_DEFAULT = [0.05, 0.25, 0.5, 0.75, 0.95] as const;

export interface MonteCarloRequest {
  /** The engine's already-leveraged joint daily portfolio returns (`.value` is a
   *  per-DAY return, not cumulative). `[]` when the engine suppressed a degenerate
   *  scenario. This is the ONLY required field. */
  portfolioDaily: DailyPoint[];
  /** Forward horizon in trading days. Default 252 (≈ 1 year, product convention). */
  horizonDays?: number;
  /** Number of bootstrap paths. Default 1000 (stable 5/95 quantiles). */
  paths?: number;
  /** Block length. Default auto: clamp(round(n^(1/3)), 2, n). < 2 degrades to IID
   *  (kills autocorrelation) so the floor is 2 unless n itself forces it. */
  blockLength?: number;
  /** PRNG seed (mulberry32). Default `MC_SEED_DEFAULT`. */
  seed?: number;
  /** Quantile edges in [0,1]. Default 5/25/50/75/95. */
  quantiles?: number[];
  /** Minimum-sample floor (overlapping days). Default the Phase-22 SoT. */
  floor?: number;
  /** Propagate mean-estimation uncertainty (honest-to-N widening). Default true. */
  parameterUncertainty?: boolean;
}

/** One forward step's empirical quantiles, in cumulative-RETURN form (step 0 = 0). */
export interface MonteCarloBandPoint {
  /** Forward trading-day index (1..horizonDays). */
  step: number;
  /** Quantile → cumulative return, keyed `p{pct}` (e.g. "p5","p50","p95"). */
  q: Record<string, number>;
}

export interface MonteCarloResult {
  /** false ⇒ the section renders an honest empty state (route on `reason`). */
  ok: boolean;
  reason: "ok" | "below-floor" | "no-usable-n";
  /** Historical overlap N actually used (null on no-usable-n). */
  n: number | null;
  paths: number;
  blockLength: number;
  horizonDays: number;
  /** The median-quantile key actually emitted (e.g. "p50") so the consumer never
   *  guesses; null when not ok. */
  medianKey: string | null;
  /** Per-forward-step quantile bands (length === horizonDays). null when not ok. */
  bands: MonteCarloBandPoint[] | null;
  /** Terminal-step summary: median + the outer (lowest/highest requested) interval.
   *  null when not ok. */
  terminal: { median: number; lo: number; hi: number } | null;
}

/** mulberry32 — a tiny, fast, seedable PRNG (deterministic, no global state). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Quantile of a SORTED-ASCENDING array via nearest-rank (deterministic, no
 *  interpolation — matches the house "simple index" convention of
 *  `computeVaR`). `q` clamped to [0,1]; index clamped to [0, m-1]. */
function quantileSorted(sortedAsc: number[], q: number): number {
  const m = sortedAsc.length;
  const qc = q < 0 ? 0 : q > 1 ? 1 : q;
  const idx = Math.min(m - 1, Math.max(0, Math.round(qc * (m - 1))));
  return sortedAsc[idx];
}

/** Stable `p{pct}` key for a quantile (0.05 → "p5", 0.5 → "p50", 0.975 → "p98"). */
function quantileKey(q: number): string {
  return `p${Math.round(q * 100)}`;
}

const NOT_OK = (
  reason: "below-floor" | "no-usable-n",
  n: number | null,
  paths: number,
  blockLength: number,
  horizonDays: number,
): MonteCarloResult => ({
  ok: false,
  reason,
  n,
  paths,
  blockLength,
  horizonDays,
  medianKey: null,
  bands: null,
  terminal: null,
});

/**
 * Run the forward Monte-Carlo. Pure + never throws; a degenerate / below-floor /
 * non-finite input returns an `ok:false` envelope (the section routes on `reason`
 * and renders the honest empty state) — NEVER a fabricated band or a 0.
 */
export function runMonteCarlo(req: MonteCarloRequest): MonteCarloResult {
  const horizonDays = Math.max(1, Math.trunc(req.horizonDays ?? MC_HORIZON_DEFAULT));
  const paths = Math.max(1, Math.trunc(req.paths ?? MC_PATHS_DEFAULT));
  const floor = req.floor ?? SAMPLE_FLOOR_OVERLAPPING_DAYS;
  const quantiles = (req.quantiles ?? [...MC_QUANTILES_DEFAULT]).slice().sort((a, b) => a - b);
  const seed = req.seed ?? MC_SEED_DEFAULT;
  const useDrift = req.parameterUncertainty ?? true;

  const r = req.portfolioDaily.map((d) => d.value);
  const n = r.length;

  // ── Floor gate (the Phase-22 SoT; guard order: no-usable-n FIRST) ──
  // A non-finite value anywhere makes the whole series untrustworthy (mirrors
  // the engine + scenario-stress) → no-usable-n, never a fabricated band.
  if (n === 0 || !r.every(Number.isFinite)) {
    return NOT_OK("no-usable-n", null, paths, 0, horizonDays);
  }
  const verdict = evaluateSampleFloor(n, floor);
  if (!verdict.ok) {
    return NOT_OK(verdict.reason, verdict.n, paths, 0, horizonDays);
  }

  // Block length: auto = clamp(round(n^(1/3)), 2, n). < 2 would degrade to IID
  // and destroy autocorrelation; never allow it unless n itself is < 2 (cannot
  // happen here — n >= floor >= 1, and the floor default is 60).
  const autoBlock = Math.round(Math.cbrt(n));
  const blockLength = Math.min(n, Math.max(2, req.blockLength ?? autoBlock));

  const rand = mulberry32(seed);
  const muHat = r.reduce((s, x) => s + x, 0) / n;

  // pathCum[p][step] = cumulative RETURN of path p after (step+1) forward days.
  // We only need the per-step distribution, so accumulate column-major into
  // `stepValues[step]` to avoid holding every full path when paths is large.
  const stepValues: number[][] = Array.from({ length: horizonDays }, () => new Array<number>(paths));

  for (let p = 0; p < paths; p++) {
    // Parameter-uncertainty drift: bootstrap the sample mean (n draws w/
    // replacement) → μ*, giving a per-path mean error δ = μ* − μ̂ (spread ≈ σ̂/√n).
    // Applied as a LINEAR additive shift of the cumulative return below (s·δ at
    // step s) — NOT added to each daily return and compounded (that gives the
    // exp(s·δ) explosion + Jensen skew this construction deliberately avoids).
    let drift = 0;
    if (useDrift) {
      let sumBoot = 0;
      for (let k = 0; k < n; k++) sumBoot += r[(rand() * n) | 0];
      drift = sumBoot / n - muHat;
    }

    // Circular moving-block bootstrap of the forward path (drift NOT compounded).
    let cum = 1;
    let filled = 0;
    while (filled < horizonDays) {
      const start = (rand() * n) | 0;
      for (let k = 0; k < blockLength && filled < horizonDays; k++) {
        cum *= 1 + r[(start + k) % n];
        // cumulative-RETURN form (0 = today) + the linear parameter-uncertainty
        // shift s·δ (s = step, 1-indexed). Clamp at −1: a cumulative loss worse
        // than −100% is impossible, so the drift never fabricates one.
        const step = filled + 1;
        const cumReturn = cum - 1 + step * drift;
        stepValues[filled][p] = cumReturn < -1 ? -1 : cumReturn;
        filled++;
      }
    }
  }

  // Empirical quantile bands per forward step.
  const medianKey = quantileKey(0.5);
  const bands: MonteCarloBandPoint[] = new Array(horizonDays);
  for (let step = 0; step < horizonDays; step++) {
    const col = stepValues[step];
    col.sort((a, b) => a - b);
    const q: Record<string, number> = {};
    for (const ql of quantiles) q[quantileKey(ql)] = quantileSorted(col, ql);
    bands[step] = { step: step + 1, q };
  }

  // Terminal summary: median + the outer (lowest/highest requested) interval.
  const last = bands[horizonDays - 1].q;
  const loKey = quantileKey(quantiles[0]);
  const hiKey = quantileKey(quantiles[quantiles.length - 1]);
  const median = last[medianKey] ?? last[quantileKey(quantiles[Math.floor(quantiles.length / 2)])];

  return {
    ok: true,
    reason: "ok",
    n,
    paths,
    blockLength,
    horizonDays,
    medianKey,
    bands,
    terminal: { median, lo: last[loKey], hi: last[hiKey] },
  };
}

/** Worker entry — identical to `runMonteCarlo`. Named separately so the worker
 *  glue and its contract test reference an intent-named symbol. */
export const handleMonteCarloMessage = runMonteCarlo;
