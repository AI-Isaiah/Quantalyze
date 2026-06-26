/**
 * Constituent diversification math (Phase 41) — pure TS, zero dependency.
 *
 * Consumes the FROZEN scenario engine's already-emitted `correlation_matrix`
 * (read-only) plus the de-aliased per-constituent return series + normalized
 * weights, and derives the diversification view's numbers: per-constituent
 * re-alignment (mirroring the engine), a SAMPLE covariance matrix, per-
 * constituent σ, the Choueifaty Diversification Ratio, per-constituent
 * percent-contribution-to-risk (PCR), the risk-based Effective Number of Bets
 * (ENB), an average-linkage hierarchical cluster order, and the ρ≥0.85
 * "too similar" pairs.
 *
 * ── SAMPLE-CONVENTION LOCK (CRITICAL) ───────────────────────────────────────
 * The engine's `correlation_matrix` and `volatility` use SAMPLE covariance/std
 * (÷(n−1)) — see scenario.ts:337-340 (portfolio sample variance), :390-393
 * (per-constituent sample var), :420-422 (pairwise sample cov →
 * `corr = cov/(stdA·stdB)`). This lib MUST use SAMPLE end-to-end so its DR/PCR
 * stay internally consistent with the displayed matrix. It must NOT copy the
 * factsheet body's POPULATION convention (`compute.ts` pstdev, ÷n) — that is a
 * deliberately-coexisting, different surface (REQUIREMENTS.md:73 "Out of Scope"
 * to unify). A population-std bleed would silently desync DR from the matrix it
 * sits beside; the consistency golden test (diversification.test.ts) catches it
 * by rebuilding ρ from this lib's own cov+σ and asserting equality with the
 * engine `correlation_matrix` to 3 decimals.
 *
 * This lib NEVER recomputes ρ for display — the matrix comes from the engine,
 * read-only. `correlation-math.ts::pearson` is used only as a defensive cross-
 * check inside the test, never in production output.
 *
 * Pattern precedent: src/lib/scenario-blend-panels.ts (pure-TS engine-output
 * adapter, reuses mean/stdDev, MIN_USABLE floor, degenerate→empty, golden-
 * tested). This file is the same shape. The engine (scenario.ts) is FROZEN and
 * is imported type-only — never called from this lib.
 */
import { mean, stdDev } from "@/lib/portfolio-math-utils";
import type {
  DailyPoint,
  ScenarioState,
  StrategyForBuilder,
} from "@/lib/scenario";

/** Mirror the engine's n<10 null gate (scenario.ts:210). */
export const MIN_USABLE = 10;

/** The "too similar" correlation threshold (CORR-02, locked). */
export const TOO_SIMILAR_THRESHOLD = 0.85;

/** Default include-from when a strategy has neither an override nor a start_date. */
const DEFAULT_INCLUDE_FROM = "2022-01-01";

export interface AlignedConstituents {
  /** Active constituent ids, in the order the active strategies appear. */
  ids: string[];
  /** The union-of-dates axis (sorted ascending) — the engine's `commonDates`. */
  commonDates: string[];
  /** Per-id RAW (un-levered) returns aligned on `commonDates`, zero-filled
   *  before each strategy's include-from. All arrays length === commonDates.length. */
  returnsById: Record<string, number[]>;
}

export interface DiversificationInput {
  /** De-aliased constituent ids, ACTIVE only. */
  ids: string[];
  /** ALIGNED on the engine's commonDates axis (built upstream via
   *  `alignConstituentReturns`). All arrays equal length. */
  returnsById: Record<string, number[]>;
  /** Normalized (sum→1) over the active set. */
  weights: Record<string, number>;
  /** Engine `portfolio_daily_returns` values (LEVERED). */
  portfolioDailyReturns: number[];
  /** Engine ρ (read-only). */
  correlationMatrix: Record<string, Record<string, number>> | null;
  /** Engine overlapping-day count. */
  n: number;
}

export interface DiversificationResult {
  diversificationRatio: number | null;
  effectiveNumberOfBets: number | null;
  /** Per-id percent-contribution-to-risk; sums to 1 over active ids (signed). */
  pcr: Record<string, number> | null;
  /** Reordered id list (identity when ≤2 ids). */
  clusterOrderIds: string[];
  /** ρ≥0.85 off-diagonal pairs. */
  tooSimilarPairs: Array<[string, string, number]>;
  /** Per-id SAMPLE σ (daily, un-annualized). */
  vols: Record<string, number> | null;
}

/**
 * Re-align each active constituent's returns on the engine's union-of-dates
 * axis, mirroring scenario.ts:199-236 EXACTLY:
 *   - active set = `state.selected[id]` (scenario.ts:154-156)
 *   - include-from = `state.startDates[id] ?? s.start_date ?? "2022-01-01"`
 *     (scenario.ts:195)
 *   - axis = UNION of every active strategy's dates ≥ its own include-from,
 *     sorted ascending (scenario.ts:199-208) — NOT an intersection
 *   - per-id values = `d >= from ? (map.get(d) ?? 0) : 0` (scenario.ts:233-235),
 *     RAW (un-levered) — leverage is applied ONLY to portfolio_daily_returns
 *     by the engine (scenario.ts:251), never to the per-constituent series the
 *     correlation matrix is built from.
 *
 * The engine emits the resulting aligned series ONLY as a transient local
 * (`strategyReturns`) and discards it, so this is the single frozen-safe way to
 * reconstruct the exact window the displayed ρ was computed on.
 */
export function alignConstituentReturns(
  strategies: StrategyForBuilder[],
  state: ScenarioState,
): AlignedConstituents {
  const active = strategies.filter((s) => state.selected[s.id]);

  const includeFrom = new Map<string, string>();
  for (const s of active) {
    includeFrom.set(
      s.id,
      state.startDates[s.id] ?? s.start_date ?? DEFAULT_INCLUDE_FROM,
    );
  }

  const allDateSet = new Set<string>();
  for (const s of active) {
    const from = includeFrom.get(s.id)!;
    for (const d of s.daily_returns) {
      if (d.date >= from) allDateSet.add(d.date);
    }
  }
  const commonDates = Array.from(allDateSet).sort();

  const returnsById: Record<string, number[]> = {};
  for (const s of active) {
    const map = new Map<string, number>(
      s.daily_returns.map((d: DailyPoint) => [d.date, d.value]),
    );
    const from = includeFrom.get(s.id)!;
    returnsById[s.id] = commonDates.map((d) =>
      d >= from ? (map.get(d) ?? 0) : 0,
    );
  }

  return { ids: active.map((s) => s.id), commonDates, returnsById };
}

/**
 * SAMPLE covariance matrix Σ[i][j] = Σₖ(rᵢₖ−r̄ᵢ)(rⱼₖ−r̄ⱼ)/(T−1).
 *
 * Two-pass demeaned (compute means first, then demeaned products) — mirroring
 * the engine (scenario.ts:388-419), NOT the one-pass E[XY]−E[X]E[Y] which loses
 * precision on small daily returns near 0. Consumes ALREADY-ALIGNED series
 * (`alignConstituentReturns`), so all arrays share length T.
 *
 * Returns null when T<2 (covariance undefined) — the global n<10 gate makes this
 * unreachable in production, but it is a defensive floor so the panel degrades
 * honestly rather than emitting a 0-matrix.
 */
export function covarianceMatrix(
  returnsById: Record<string, number[]>,
  ids: string[],
): number[][] | null {
  if (ids.length === 0) return null;
  const series = ids.map((id) => returnsById[id] ?? []);
  const T = series[0].length;
  if (T < 2) return null;
  // Alignment guarantees equal lengths; assert defensively.
  for (const s of series) {
    if (s.length !== T) return null;
  }

  const means = series.map((s) => mean(s));
  const demeaned = series.map((s, i) => s.map((v) => v - means[i]));

  const cov: number[][] = ids.map(() => new Array(ids.length).fill(0));
  for (let i = 0; i < ids.length; i++) {
    for (let j = i; j < ids.length; j++) {
      let sum = 0;
      for (let k = 0; k < T; k++) sum += demeaned[i][k] * demeaned[j][k];
      const c = sum / (T - 1); // SAMPLE (÷(T−1))
      cov[i][j] = c;
      cov[j][i] = c;
    }
  }
  return cov;
}

/**
 * Per-constituent SAMPLE σ: σᵢ = stdDev(returnsById[id], sample=true) (÷(T−1)).
 *
 * SAMPLE is LOCKED (41-RESEARCH §2): the displayed ρ is sample-cov, so for DR/PCR
 * to be internally consistent with the matrix, σᵢ must be the SAME sample σ.
 * NEVER pass `false`/population — a population bleed silently desyncs DR from the
 * displayed matrix (the consistency pin catches it). Daily (un-annualized) — DR
 * is a ratio so the √252 cancels.
 *
 * Returns null on empty input.
 */
export function constituentVols(
  returnsById: Record<string, number[]>,
  ids: string[],
): Record<string, number> | null {
  if (ids.length === 0) return null;
  const out: Record<string, number> = {};
  for (const id of ids) {
    out[id] = stdDev(returnsById[id] ?? [], true); // SAMPLE (÷(T−1)) — LOCKED
  }
  return out;
}
