/**
 * Constituent diversification math (Phase 41) — pure TS, zero dependency.
 *
 * Consumes the FROZEN scenario engine's already-emitted `correlation_matrix`
 * (read-only) plus the per-constituent return series + normalized
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
 * Pattern precedent: src/lib/scenario-blend-adapter.ts (pure-TS engine-output
 * adapter, MIN_USABLE floor, degenerate→empty, golden-tested). This file is the
 * same shape. The engine (scenario.ts) is FROZEN and is imported type-only —
 * never called from this lib.
 */
import { mean, stdDev } from "@/lib/portfolio-math-utils";
import {
  type DailyPoint,
  type ScenarioState,
  type StrategyForBuilder,
} from "@/lib/scenario";
import { covers, coverageSpanOf } from "@/lib/scenario-window";

/**
 * The engine's fallback include-from literal, mirrored here as a local const.
 * scenario.ts is FROZEN (SCENARIO-05) and the frozen-spine guards forbid adding
 * an export to it, so we cannot import this from the engine — this value MUST
 * match scenario.ts's inline "2022-01-01" fallback. The WR-04 staggered
 * consistency pin (rebuilt ρ ≡ engine correlation_matrix to 3dp) catches any
 * drift between this mirror and the engine's window.
 */
const DEFAULT_INCLUDE_FROM = "2022-01-01";

/** Mirror the engine's n<10 null gate (scenario.ts:210). */
export const MIN_USABLE = 10;

/** The "too similar" correlation threshold (CORR-02, locked). */
export const TOO_SIMILAR_THRESHOLD = 0.85;

/**
 * Per-constituent leverage Lᵢ (default 1.0; a non-finite or negative value →
 * 1.0, mirroring the engine's defensive `lev()` at scenario.ts:188-191). This
 * is the exact clamp the engine applies, so the lib's levered basis matches the
 * `portfolio_daily_returns` σ_p it is divided against.
 */
function levOf(leverage: Record<string, number> | undefined, id: string): number {
  const L = leverage?.[id];
  return Number.isFinite(L) && (L as number) >= 0 ? (L as number) : 1;
}

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
   *  `alignConstituentReturns`). RAW (un-levered) — leverage is applied inside
   *  the orchestrator for DR/PCR. All arrays equal length. */
  returnsById: Record<string, number[]>;
  /** Normalized (sum→1) over the active set. UN-levered weights ŵᵢ. */
  weights: Record<string, number>;
  /** Per-constituent leverage Lᵢ (default 1 when absent). Threaded from the
   *  composer's `engineSet.state.leverage` so DR/PCR are computed on the SAME
   *  levered basis as `portfolioDailyReturns` (CR-01/WR-01). An all-1 map is
   *  byte-identical to a correct un-levered computation. */
  leverage?: Record<string, number>;
  /** Engine `portfolio_daily_returns` values (LEVERED). NOTE: the DR denominator
   *  σ_p is NO LONGER derived from this (QA-DR01) — it is the quadratic form of
   *  the shared levered covariance (`portfolioVarianceFromCov`) so the Choueifaty
   *  bound holds on staggered-inception blends. Retained for reference/telemetry. */
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
 * Re-align each constituent's returns on the engine's date axis, mirroring
 * `computeScenario` (scenario.ts) EXACTLY so the rebuilt ρ / DR / ENB / PCR sit
 * on the SAME member set + axis the engine's `correlation_matrix` / `n` do. The
 * engine has two paths and this function follows whichever `state.window`
 * selects:
 *
 *   ── ABSENT window (legacy union path, scenario.ts:331-363) ──
 *   - member set = every ACTIVE strategy (`state.selected[id]`)
 *   - include-from = `state.startDates[id] ?? s.start_date ?? "2022-01-01"`
 *   - axis = UNION of every member's dates ≥ its own include-from — NOT an
 *     intersection.
 *
 *   ── PRESENT window (v1.5 coverage-window path, scenario.ts:263-364) ──
 *   - member set = the ACTIVE strategies whose coverage span ⊇ the window
 *     (`coverageSpanOf(returns) !== null && covers(span, window)`). A window-
 *     excluded (ended/ragged) strategy is DROPPED here exactly as the engine
 *     drops it from the divisor — so it no longer dilutes DR/ENB/PCR or appears
 *     in the cluster order, matching the rest of the windowed tab.
 *   - include-from = `window.start` for every member (the closed lower bound)
 *   - axis = UNION of members' dates within `[window.start, window.end]`.
 *
 * In both paths per-id values are `d >= from ? (map.get(d) ?? 0) : 0` — RAW
 * (un-levered); leverage is applied ONLY to portfolio_daily_returns by the
 * engine, never to the per-constituent series the correlation matrix is built
 * from. The engine emits the resulting aligned series only as a transient local
 * (`strategyReturns`) and discards it, so this is the single frozen-safe way to
 * reconstruct the exact window the displayed ρ was computed on. The consistency
 * pin (rebuilt ρ ≡ engine correlation_matrix to 3dp, union AND windowed) catches
 * any drift from the engine's member/axis logic.
 */
export function alignConstituentReturns(
  strategies: StrategyForBuilder[],
  state: ScenarioState,
): AlignedConstituents {
  const window = state.window ?? null;
  const active = strategies.filter((s) => state.selected[s.id]);
  // Present window: keep only covering members (engine parity). Absent: all active.
  const members = window
    ? active.filter((s) => {
        const span = coverageSpanOf(s.daily_returns);
        return span !== null && covers(span, window);
      })
    : active;

  const includeFrom = new Map<string, string>();
  for (const s of members) {
    includeFrom.set(
      s.id,
      window
        ? window.start
        : (state.startDates[s.id] ?? s.start_date ?? DEFAULT_INCLUDE_FROM),
    );
  }

  const allDateSet = new Set<string>();
  for (const s of members) {
    const from = includeFrom.get(s.id)!;
    for (const d of s.daily_returns) {
      if (window) {
        if (d.date >= window.start && d.date <= window.end) allDateSet.add(d.date);
      } else if (d.date >= from) {
        allDateSet.add(d.date);
      }
    }
  }
  const commonDates = Array.from(allDateSet).sort();

  const returnsById: Record<string, number[]> = {};
  for (const s of members) {
    const map = new Map<string, number>(
      s.daily_returns.map((d: DailyPoint) => [d.date, d.value]),
    );
    const from = includeFrom.get(s.id)!;
    returnsById[s.id] = commonDates.map((d) =>
      d >= from ? (map.get(d) ?? 0) : 0,
    );
  }

  return { ids: members.map((s) => s.id), commonDates, returnsById };
}

/**
 * Scale each aligned constituent series by its leverage Lᵢ → the LEVERED asset
 * series `xᵢ = Lᵢ·rᵢ` (CR-01/WR-01). σ and covariance built from `xᵢ` are the
 * levered-basis statistics DR and PCR need to be consistent with the engine's
 * levered `portfolio_daily_returns` (`Σ ŵᵢ·Lᵢ·rᵢ`, scenario.ts:251).
 *
 * Leverage is a pure SCALE transform, so:
 *   • corr(Lᵢrᵢ, Lⱼrⱼ) = corr(rᵢ, rⱼ) — the correlation matrix is UNCHANGED
 *     (the ρ consistency pin still rebuilds from the UN-levered series and the
 *     engine's ρ is leverage-invariant). NEVER feed levered series to the ρ path.
 *   • under UNIFORM L, every σ and σ_p scales by L, so DR's ratio is invariant.
 *
 * A non-finite/negative Lᵢ → 1 (engine-identical clamp). Returns a NEW map; the
 * input is not mutated. An all-default (or absent) leverage map returns a
 * value-identical copy.
 */
export function applyLeverage(
  returnsById: Record<string, number[]>,
  ids: string[],
  leverage: Record<string, number> | undefined,
): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const id of ids) {
    const L = levOf(leverage, id);
    const series = returnsById[id] ?? [];
    out[id] = L === 1 ? series.slice() : series.map((v) => L * v);
  }
  return out;
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

/**
 * Levered portfolio variance ŵᵀΣ_levŵ from the levered covariance — the SAME
 * quadratic form `percentContributionToRisk` computes for its denominator. The
 * DR denominator σ_p is derived from THIS (σ_p = √(ŵᵀΣŵ)), NOT from a separately
 * estimated realized std, so the DR numerator (σ_levᵢ = √Σᵢᵢ) and denominator
 * share ONE covariance. That shared-Σ basis is what makes the Choueifaty bound
 * DR ≥ 1 hold for ANY long-only blend at ANY window — including a STAGGERED-
 * inception blend where the engine's renormalized realized σ_p would sit on a
 * DIFFERENT basis than the zero-filled per-constituent σᵢ (QA-DR01: that basis
 * split rendered DR = 0.96 live). Returns 0 for a degenerate (≤0) variance so the
 * caller renders "—" rather than dividing by 0.
 */
export function portfolioVarianceFromCov(
  ids: string[],
  weights: Record<string, number>,
  cov: number[][],
): number {
  const w = ids.map((id) => weights[id] ?? 0);
  let v = 0;
  for (let i = 0; i < ids.length; i++) {
    let row = 0;
    for (let j = 0; j < ids.length; j++) row += cov[i][j] * w[j];
    v += w[i] * row;
  }
  return v > 0 ? v : 0;
}

/**
 * Choueifaty Diversification Ratio: DR = (Σᵢ ŵᵢ·σ_levᵢ) / σ_p.
 *
 * ── LEVERED-CONSISTENT BASIS (CR-01 fix) ────────────────────────────────────
 * Both the numerator and the denominator are derived from ONE shared levered
 * covariance Σ_lev. The denominator σ_p = √(ŵᵀΣ_levŵ) (`portfolioVarianceFromCov`)
 * — the quadratic form of the same Σ_lev whose diagonal gives the numerator's
 * σ_levᵢ = √Σᵢᵢ. Sharing one Σ is what makes the Choueifaty bound (Cauchy-
 * Schwarz) hold at ANY window. (QA-DR01: a prior basis used the engine's realized
 * `stdDev(portfolioDailyReturns)` as σ_p; for a fully-overlapping window that
 * EQUALS √(ŵᵀΣŵ), but for a STAGGERED-inception blend the realized σ_p is
 * renormalized over the started subset while the per-constituent σᵢ are zero-
 * filled/deflated — the two bases diverged and DR fell to 0.96 live. Deriving σ_p
 * from the shared zero-filled Σ removes the split.) The numerator levers each
 * constituent's σ too: treat each leg's asset as its
 * levered series `xᵢ = Lᵢ·rᵢ`, so `σ_levᵢ = std(xᵢ) = Lᵢ·σᵢ`. `vols` here are
 * the per-constituent LEVERED σ (computed by the orchestrator from the levered
 * aligned series), and `weights` are the NORMALIZED UN-levered weights ŵᵢ
 * (= wᵢ/Σwⱼ), matching the engine's per-day renormalization by the un-levered
 * weight mass.
 *
 * Consequences (the three artifacts CR-01 demanded):
 *   • Under UNIFORM leverage L the ratio is INVARIANT — the numerator becomes
 *     L·Σŵᵢσᵢ and σ_p becomes L·σ_p(unlev), so L cancels (correlation, the only
 *     genuine diversification driver, is itself leverage-invariant).
 *   • DR ≥ 1 for long-only, non-perfect ρ (the Choueifaty bound) holds at ANY
 *     leverage — the basis is now consistent.
 *   • Under NON-uniform leverage the ratio correctly reflects the levered
 *     exposures rather than a spurious scale factor.
 *
 * σ_levᵢ and σ_p are both daily (un-annualized) — the √252 cancels in the ratio.
 * Returns null when σ_p ≤ 0 (all-flat blend) so the UI renders "—" instead of
 * dividing by zero.
 */
export function diversificationRatio(
  weights: Record<string, number>,
  vols: Record<string, number>,
  sigmaP: number,
): number | null {
  if (!(sigmaP > 0)) return null; // σ_p=0 → "—" (never divide by 0)
  let weightedSigma = 0;
  for (const id of Object.keys(weights)) {
    weightedSigma += weights[id] * (vols[id] ?? 0); // ŵᵢ·σ_levᵢ
  }
  return weightedSigma / sigmaP; // Choueifaty DR (≥1 for long-only, non-perfect ρ)
}

/**
 * Per-constituent percent-contribution-to-risk (Euler decomposition of variance):
 *   PCRᵢ = ŵᵢ·(Σ_lev·ŵ)ᵢ / (ŵᵀΣ_levŵ),  where (Σ_lev·ŵ)ᵢ = Σⱼ Σ_lev[i][j]·ŵⱼ.
 * The array sums to 1 over the active ids.
 *
 * ── LEVERED-CONSISTENT BASIS (WR-01 fix) ────────────────────────────────────
 * `cov` here is the LEVERED covariance Σ_lev = cov(Lᵢrᵢ, Lⱼrⱼ) and `weights`
 * are the NORMALIZED UN-levered weights ŵ. Because Σ_lev[i][j] = Lᵢ·Lⱼ·cov(rᵢ,rⱼ),
 * the term ŵᵢ·(Σ_lev·ŵ)ᵢ = (ŵᵢLᵢ)·Σⱼ cov(rᵢ,rⱼ)(ŵⱼLⱼ) — i.e. the Euler
 * decomposition of the LEVERED portfolio variance over the levered exposure
 * vector eᵢ = ŵᵢ·Lᵢ. This is exactly the portfolio whose σ_p feeds the DR
 * denominator and whose curve the allocator sees. Under UNIFORM leverage the L
 * factors cancel in the self-normalized ratio (equal-L books are unchanged);
 * under NON-uniform leverage the heavy-levered leg correctly carries a larger
 * risk share and the descending list re-sorts to name the true dominant driver.
 *
 * ── SIGNED HEDGES (A3) ──────────────────────────────────────────────────────
 * A strongly-negatively-correlated leg can have a NEGATIVE PCR — it REDUCES
 * portfolio risk. Keep the signed value: it is honest (a hedge has negative risk
 * contribution), the ENB formula squares it so the sign doesn't break ENB, and
 * clamping negatives to 0 would break the sum-to-1 invariant. The panel can
 * render negative % with a "risk-reducing" note.
 *
 * ── DEGENERATE PORTFOLIO VARIANCE (Pitfall 3) ───────────────────────────────
 * wᵀΣw is exactly the portfolio variance. If it is ≤ 0 (all-flat or perfectly-
 * offsetting blend, or a tiny negative from float error) the contributions are
 * UNDEFINED — return null (UI "—"), NOT 0/0 = NaN. Guarded with an epsilon.
 */
export function percentContributionToRisk(
  ids: string[],
  weights: Record<string, number>,
  cov: number[][],
): Record<string, number> | null {
  const w = ids.map((id) => weights[id] ?? 0);
  const sigmaW = ids.map((_, i) =>
    w.reduce((acc, wj, j) => acc + cov[i][j] * wj, 0),
  );
  const portVar = w.reduce((acc, wi, i) => acc + wi * sigmaW[i], 0); // wᵀΣw
  if (!(portVar > 1e-15)) return null; // degenerate variance → "—" (no NaN/Inf)
  const out: Record<string, number> = {};
  ids.forEach((id, i) => {
    out[id] = (w[i] * sigmaW[i]) / portVar; // signed; Σ = 1
  });
  return out;
}

/**
 * Risk-based Effective Number of Bets (Meucci): ENB = 1 / Σᵢ PCRᵢ².
 *
 * Correlation-aware — counts INDEPENDENT bets, NOT the naive weight-HHI 1/Σwᵢ².
 * A 2-leg book of perfectly-correlated strategies has ENB≈1 (honest); the naive
 * HHI would lie ENB=2. Range 1 ≤ ENB ≤ k for long-only; with negative PCR
 * (hedges) Σpcr² can exceed 1, pushing ENB < 1 — honest, do NOT clamp. DISCLOSED
 * on the panel. Returns null on null/empty pcr or a non-positive denominator.
 */
export function effectiveNumberOfBets(
  pcr: Record<string, number> | null,
): number | null {
  if (!pcr) return null;
  const denom = Object.values(pcr).reduce((a, p) => a + p * p, 0);
  return denom > 0 ? 1 / denom : null; // 1/Σpcrᵢ² (risk-based, Meucci)
}

/**
 * Average-linkage agglomerative cluster order on distance d(i,j)=½(1−ρᵢⱼ).
 *
 * Groups correlated legs adjacently (CORR-06). Algorithm (41-RESEARCH Pattern 3):
 *   1. D[i][j] = ½(1−ρ); a missing/null/non-finite ρ → distance 1 (max), so a
 *      flat-window pair never collapses the tree or injects NaN. Self-distance 0.
 *   2. Start with n singleton clusters (leaf list = [id]).
 *   3. Repeat: merge the two clusters with the smallest AVERAGE inter-cluster
 *      distance (mean of D over all member pairs); concatenate leaf lists on
 *      merge so correlated members stay adjacent.
 *   4. Output the final cluster's leaf id order.
 * Edge n≤2: identity `[...ids]` (clustering is a no-op; 2 ids are trivially
 * adjacent). O(n²·log n) — fine for the small-n constituent sets (<30).
 */
export function clusterOrder(
  corr: Record<string, Record<string, number>> | null,
  ids: string[],
): string[] {
  if (!corr || ids.length <= 2) return [...ids]; // identity for n≤2

  const D = ids.map((a) =>
    ids.map((b) => {
      if (a === b) return 0;
      const r = corr[a]?.[b];
      return r == null || !Number.isFinite(r) ? 1 : 0.5 * (1 - r);
    }),
  );

  let clusters = ids.map((id, i) => ({ leaves: [id], members: [i] }));
  while (clusters.length > 1) {
    let best = Infinity;
    let bi = 0;
    let bj = 1;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        let sum = 0;
        let cnt = 0;
        for (const a of clusters[i].members) {
          for (const b of clusters[j].members) {
            sum += D[a][b];
            cnt++;
          }
        }
        const avg = sum / cnt; // AVERAGE linkage
        if (avg < best) {
          best = avg;
          bi = i;
          bj = j;
        }
      }
    }
    const merged = {
      leaves: [...clusters[bi].leaves, ...clusters[bj].leaves],
      members: [...clusters[bi].members, ...clusters[bj].members],
    };
    clusters = clusters.filter((_, k) => k !== bi && k !== bj);
    clusters.push(merged);
  }
  return clusters[0].leaves;
}

/**
 * Off-diagonal (j>i) pairs with ρ ≥ threshold (default 0.85, CORR-02). Returns
 * [] on a null matrix.
 */
export function tooSimilarPairs(
  corr: Record<string, Record<string, number>> | null,
  ids: string[],
  threshold: number = TOO_SIMILAR_THRESHOLD,
): Array<[string, string, number]> {
  if (!corr) return [];
  const out: Array<[string, string, number]> = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const r = corr[ids[i]]?.[ids[j]];
      if (r != null && Number.isFinite(r) && r >= threshold) {
        out.push([ids[i], ids[j], r]);
      }
    }
  }
  return out;
}

/**
 * Orchestrator. Applies the GLOBAL gate (ids<2 OR n<MIN_USABLE OR null matrix →
 * all-null result with `clusterOrderIds = [...ids]`), else computes
 * cov → vols → σ_p → DR → PCR → ENB → clusterOrder → tooSimilarPairs.
 *
 * `returnsById` is already ALIGNED upstream (`alignConstituentReturns`) and RAW
 * (un-levered). DR and PCR are computed on the LEVERED basis: the orchestrator
 * scales each series by Lᵢ (`applyLeverage`) BEFORE cov/σ, so they are
 * consistent with the engine's levered `portfolio_daily_returns` (CR-01/WR-01).
 * The ρ path is untouched (leverage-invariant — it comes from the engine, and
 * the consistency pin rebuilds it from the UN-levered series). Every division is
 * guarded; no NaN/Inf escapes. σ_p is √(ŵᵀΣ_levŵ) — the quadratic form of the
 * SAME levered Σ as the numerator/PCR (QA-DR01), NOT the realized
 * `portfolioDailyReturns` std, so the Choueifaty bound DR ≥ 1 holds at any window.
 */
export function computeDiversification(
  input: DiversificationInput,
): DiversificationResult {
  const empty: DiversificationResult = {
    diversificationRatio: null,
    effectiveNumberOfBets: null,
    pcr: null,
    clusterOrderIds: [...input.ids],
    tooSimilarPairs: [],
    vols: null,
  };

  if (
    input.ids.length < 2 ||
    input.n < MIN_USABLE ||
    !input.correlationMatrix
  ) {
    return empty;
  }

  // LEVERED basis for DR/PCR (CR-01/WR-01): xᵢ = Lᵢ·rᵢ. cov/σ are built from
  // the levered series so they match the engine's levered portfolio σ_p. The ρ
  // matrix (consumed read-only below) is leverage-invariant and stays un-levered.
  const leveredReturns = applyLeverage(
    input.returnsById,
    input.ids,
    input.leverage,
  );
  const cov = covarianceMatrix(leveredReturns, input.ids);
  const leveredVols = constituentVols(leveredReturns, input.ids);
  // UN-levered per-constituent σ for display (the lib's `vols` contract is the
  // standalone daily σ, leverage-independent — matches the displayed matrix).
  const vols = constituentVols(input.returnsById, input.ids);
  if (!cov || !leveredVols || !vols) return empty;

  // σ_p for the Choueifaty DR is the quadratic form √(ŵᵀΣ_levŵ) of the SAME
  // levered covariance the numerator vols and PCR use — NOT the engine's
  // separately-estimated realized std. Sharing one Σ guarantees DR ≥ 1 for any
  // long-only blend at any window (QA-DR01: the realized-std basis rendered DR =
  // 0.96 on a staggered-inception blend). Under uniform leverage cov scales by L²
  // so σ_p scales by L, matching the L·σ_levᵢ numerator → the ratio stays
  // leverage-invariant (CR-01).
  const sigmaP = Math.sqrt(
    portfolioVarianceFromCov(input.ids, input.weights, cov),
  );
  const diversificationRatioValue = diversificationRatio(
    input.weights,
    leveredVols,
    sigmaP,
  );
  const pcr = percentContributionToRisk(input.ids, input.weights, cov);
  const enb = effectiveNumberOfBets(pcr);
  const clusterOrderIds = clusterOrder(input.correlationMatrix, input.ids);
  const tooSimilar = tooSimilarPairs(input.correlationMatrix, input.ids);

  return {
    diversificationRatio: diversificationRatioValue,
    effectiveNumberOfBets: enb,
    pcr,
    clusterOrderIds,
    tooSimilarPairs: tooSimilar,
    vols,
  };
}
