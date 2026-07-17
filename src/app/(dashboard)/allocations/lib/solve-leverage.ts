/**
 * Phase 113 (WEIGHTS-03/04) — max-drawdown → leverage solver.
 *
 * ⭐ IMPLEMENTED (Plan 113-01 core + Plan 113-02 hardening). A per-solve-memoized,
 * ruin-clamped MONOTONE smallest-L bisect over the byte-frozen engine's sleeve
 * `r→L·r` transform. Every failure path is an HONEST discriminated reason (never
 * a fabricated leverage/drawdown, never a silent clamp — WEIGHTS-04). The Wave-0
 * scaffolding variant is gone; a `grep` gate keeps it from ever returning.
 *
 * ## What the implemented solver will do (founder lock 2026-07-17)
 * Given a per-row max-drawdown TARGET, back-solve the leverage `L` that makes the
 * SLEEVE's OWN standalone levered max-drawdown match the target. The target is
 * the row/sleeve's own max-DD — NOT the portfolio's. For a single weight-1
 * constituent the frozen engine reduces the blend to `portDaily = L·rᵢ`, so
 * `computeScenario({ selected: {[ref]: true}, weights: {[ref]: 1}, startDates,
 * window, leverage: {[ref]: L} }).max_drawdown` IS the sleeve's standalone
 * levered max-DD. A single sleeve's max-DD is MONOTONE non-decreasing in `L`
 * until ruin ⇒ a UNIQUE root ⇒ a clean ruin-clamped monotone bisect. The
 * portfolio-level max-DD the levered sleeve produces is a DISPLAY value (a
 * full-book `computeScenario`), never solved.
 *
 * ## Sign + magnitude convention
 * `targetMaxDD` is a POSITIVE fraction magnitude (0.20 = a 20% drawdown). The
 * engine reports `max_drawdown` as a NEGATIVE fraction (−0.20). The implemented
 * solver compares magnitudes via `Math.abs` — a target of 0.20 solves for the
 * `L` whose `Math.abs(sleeveMaxDD) ≈ 0.20`.
 *
 * ## SC-3 / Don't-Hand-Roll
 * The solver NEVER duplicates engine math. It CALLS `computeScenario` per trial
 * `L` and reads `.max_drawdown`. `src/lib/scenario.ts` stays BYTE-FROZEN — a
 * hand-rolled cumulative-product / peak-trough loop here would drift from the
 * engine's renorm-by-unlevered-mass blend, ruin guard, and `toFixed(5)` rounding
 * (the exact drift SC-3 exists to prevent).
 */

import { computeScenario } from "@/lib/scenario";
import type { StrategyForBuilder, ScenarioState } from "@/lib/scenario";
import { MAX_LEVERAGE } from "@/lib/leverage";

/**
 * Discriminated result of a max-DD → leverage solve.
 *
 * - `{ ok: true }` — the solver found a leverage whose sleeve max-DD reproduces
 *   the target within {@link DD_TOL}. `sleeveMaxDD` is the engine's NEGATIVE
 *   fraction at the solved `leverage`.
 * - `{ ok: false }` — an HONEST failure (WEIGHTS-04). Never a fabricated
 *   leverage/drawdown. `reason` enumerates the honest state; the pinned UI copy
 *   in each entry is the contract Plan 113-03 renders (DESIGN.md Numbers Contract
 *   — the derived-L cell shows an em-dash `—`, never a value-shaped lie):
 *     · `"unreachable"`       — target exceeds the sleeve's max-DD at the domain
 *                               ceiling (ruin / MAX_LEVERAGE). `ceiling` carries
 *                               the ceiling `L` that was evaluated.
 *                               UI copy: "Unreachable at {ceiling}×".
 *     · `"no-drawdown"`       — the series has no drawdown at any `L` (flat) →
 *                               a positive target is not applicable.
 *                               UI copy: "No drawdown in this series".
 *     · `"insufficient-history"` — fewer than the engine's 10-observation floor
 *                               (`max_drawdown` null).
 *                               UI copy: "Insufficient history to model drawdown".
 *     · `"degenerate"`        — the series cannot be modeled (ruin / non-finite at
 *                               L=1 → `max_drawdown` null) OR the target itself is
 *                               non-finite / ≤0 / ≥1 (the T-113-02 input gate —
 *                               an honest refusal, never a clamp).
 *                               UI copy: "Series can't be modeled (data quality)".
 */
export type SolveLeverageResult =
  | { ok: true; leverage: number; sleeveMaxDD: number }
  | {
      ok: false;
      reason:
        | "unreachable"
        | "no-drawdown"
        | "insufficient-history"
        | "degenerate";
      ceiling?: number;
    };

/**
 * Round-trip drawdown tolerance (research A2). The engine rounds `max_drawdown`
 * to 5 decimals (`toFixed(5)`), so `1e-3` sits safely above the rounding floor.
 * Exported so the tests and the (future) implementation share ONE source.
 */
export const DD_TOL = 1e-3;

/**
 * Leverage convergence tolerance (research A2). A bisect to ~`1e-3` in dd yields
 * `L` to ~`1e-2` on a curve with slope O(0.1/×). Exported for the same reason as
 * {@link DD_TOL}.
 */
export const L_TOL = 1e-2;

/**
 * Back-solve the leverage that makes the SLEEVE's standalone max-drawdown match
 * `targetMaxDD` (a positive magnitude). See the module TSDoc for the founder
 * lock and the sign convention.
 *
 * Implemented as a ruin-clamped monotone smallest-L bisect over `computeScenario`
 * (Plan 113-01 core + Plan 113-02 hardening). Returns an honest discriminated
 * reason on every infeasible/degenerate path — never a fabricated leverage.
 *
 * @param args.strategies    the engine strategy set (frozen-engine input)
 * @param args.engineState   the live scenario state; the solver derives the
 *                           single-constituent sleeve state from its
 *                           `startDates` / `window` and swaps only `leverage[ref]`
 * @param args.dateMapCache  the memoized `buildDateMapCache` result (reused per trial)
 * @param args.periodsPerYear the engine annualization (max_drawdown is invariant to it)
 * @param args.ref           the constituent id whose sleeve max-DD is solved
 * @param args.targetMaxDD   POSITIVE fraction magnitude (0.20 = 20% drawdown)
 * @param args.maxLeverage   optional domain ceiling override (defaults to MAX_LEVERAGE)
 */
export function solveLeverageForMaxDD(args: {
  strategies: StrategyForBuilder[];
  engineState: ScenarioState;
  dateMapCache: Map<string, Map<string, number>>;
  periodsPerYear: number;
  ref: string;
  targetMaxDD: number;
  maxLeverage?: number;
}): SolveLeverageResult {
  const {
    strategies,
    engineState,
    dateMapCache,
    periodsPerYear,
    ref,
    targetMaxDD,
    maxLeverage,
  } = args;

  // The SLEEVE state at leverage L: exactly ONE selected constituent at weight 1,
  // so the frozen engine reduces the blend to `portDaily = L·rᵢ` (founder lock
  // 2026-07-17) — its `max_drawdown` IS this sleeve's standalone levered max-DD.
  // We restrict `selected`/`weights` to `ref` (do NOT spread engineState.selected)
  // and carry `startDates` + `window` verbatim so a non-spanning row degrades
  // honestly through the engine's own null path rather than via local heuristics.
  const sleeveStateAt = (L: number): ScenarioState => ({
    selected: { [ref]: true },
    weights: { [ref]: 1 },
    startDates: engineState.startDates,
    window: engineState.window,
    leverage: { [ref]: L },
  });

  // Per-solve memoized engine eval. `max_drawdown` is annualization-invariant, so
  // `periodsPerYear` only rides along for signature fidelity. Key by L.toFixed(4)
  // so the bisect's repeated trials collapse to one computeScenario call each
  // (research §budget: ~30-35 calls/solve). The ONLY drawdown source is the frozen
  // engine — no local cumulative/peak loop here (SC-3 / Don't-Hand-Roll).
  const ddCache = new Map<string, number | null>();
  const ddAt = (L: number): number | null => {
    const key = L.toFixed(4);
    const hit = ddCache.get(key);
    if (hit !== undefined) return hit;
    const dd = computeScenario(
      strategies,
      sleeveStateAt(L),
      dateMapCache,
      periodsPerYear,
    ).max_drawdown;
    ddCache.set(key, dd);
    return dd;
  };

  // Fail-loud backstop (T-113-02). The UI validates the target before calling;
  // this NEVER clamps — an out-of-range target is an honest degenerate refusal.
  if (
    !Number.isFinite(targetMaxDD) ||
    targetMaxDD <= 0 ||
    targetMaxDD >= 1
  ) {
    return { ok: false, reason: "degenerate" };
  }

  // Degenerate short-circuits, in order. At L=0 every scaled return is 0, so the
  // series can only draw down 0 — the SOLE way `ddAt(0)` is null is the engine's
  // n<10 floor. That makes it the clean discriminator for insufficient history.
  if (ddAt(0) === null) {
    return { ok: false, reason: "insufficient-history" };
  }
  // With ddAt(0) non-null (n≥10), a null at 1× means ruin at ≤1× (a catastrophic
  // |r|≥1 day flips cumulative wealth ≤0). Founder table: a data-quality refusal —
  // do NOT solve below the 1× ruin point.
  if (ddAt(1) === null) {
    return { ok: false, reason: "degenerate" };
  }

  // Ruin-clamped domain ceiling. `ruinedAt(L)` is `ddAt(L) === null` — valid ONLY
  // now that the short-circuits above proved n≥10 AND non-ruin at 1×, so an
  // in-domain null can mean nothing but ruin. Ruin is a MONOTONE up-set in L (the
  // binding down-day term `1 + L·r` with r<0 is strictly decreasing, so once
  // ruined every larger L is ruined — research §"Ruin boundary IS monotone"), so
  // the smallest ruinous L is a clean monotone bisect. `L_max` = the LAST PROVEN
  // non-ruined trial (`lo`); using it as the ceiling is the ε-margin — we never
  // sample above it, so the reachability check + solve stay inside the non-null
  // domain (Pitfall 2: no scan into the ruin/null region).
  const ruinedAt = (L: number): boolean => ddAt(L) === null;
  const ceil = maxLeverage ?? MAX_LEVERAGE;
  let L_max = ceil;
  if (ruinedAt(ceil)) {
    let lo = 1; // proven non-ruined (ddAt(1) non-null short-circuit above)
    let hi = ceil; // proven ruined
    while (hi - lo > 1e-2) {
      const mid = (lo + hi) / 2;
      if (ruinedAt(mid)) hi = mid;
      else lo = mid;
    }
    L_max = lo;
  }

  // Reachability pre-check at the ceiling. |dd| is monotone non-decreasing in L on
  // the sleeve (a single series, `portDaily = L·r`, until ruin) → a UNIQUE root,
  // so the ROADMAP's grid-scan-then-bisect degenerates to a plain monotone bisect
  // (founder lock: no non-monotone-portfolio machinery here). A null at the ceiling
  // is defended as degenerate rather than NaN-propagating through Math.abs(null)
  // (Pitfall 2 / fail-loud); Task 2's clamp keeps L_max inside the non-null domain.
  const ddCeil = ddAt(L_max);
  if (ddCeil === null) {
    return { ok: false, reason: "degenerate" };
  }
  if (Math.abs(ddCeil) < targetMaxDD) {
    // Shallower than the target even at the ceiling: honest, never clamp-and-lie.
    return ddCeil === 0
      ? { ok: false, reason: "no-drawdown" }
      : { ok: false, reason: "unreachable", ceiling: L_max };
  }

  // Monotone bisect for the SMALLEST L with |ddAt(L)| ≥ target. Invariant:
  // `lo` has |dd| < target, `hi` has |dd| ≥ target. lo=0 is always valid
  // (|ddAt(0)| = 0 < target since target > 0); hi=L_max is valid by the
  // reachability pre-check above. On any flat interval (5dp engine rounding
  // plateaus) `hi` converges to the lower end — exactly the founder's smallest-L
  // semantics. Iterate to width ≤ 1e-4 (≤ ~17 evals over a width-10 domain).
  let lo = 0;
  let hi = L_max;
  while (hi - lo > 1e-4) {
    const mid = (lo + hi) / 2;
    const ddMid = ddAt(mid);
    if (ddMid === null) {
      // Defensive: never loop on Math.abs(null). Every in-domain eval is
      // pre-checked non-null, so a null here is a genuine degeneracy (Pitfall 2).
      return { ok: false, reason: "degenerate" };
    }
    if (Math.abs(ddMid) >= targetMaxDD) hi = mid;
    else lo = mid;
  }

  const sleeveMaxDD = ddAt(hi);
  if (sleeveMaxDD === null) {
    return { ok: false, reason: "degenerate" };
  }
  return { ok: true, leverage: hi, sleeveMaxDD };
}
