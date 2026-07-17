/**
 * Phase 113 (WEIGHTS-03/04) — max-drawdown → leverage solver CONTRACT.
 *
 * ⭐ WAVE-0 SKELETON (Plan 113-00). This module is the interface-first contract
 * that Plans 113-01 / 113-02 implement against. The body is a deliberate stub —
 * it returns `{ ok: false, reason: "unimplemented" }` unconditionally — so every
 * Phase-113 RED test fails by ASSERTION (never a crash / import error) on the
 * current tree. Do NOT add solver logic here in Plan 00.
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

import type { StrategyForBuilder, ScenarioState } from "@/lib/scenario";

/**
 * Discriminated result of a max-DD → leverage solve.
 *
 * - `{ ok: true }` — the solver found a leverage whose sleeve max-DD reproduces
 *   the target within {@link DD_TOL}. `sleeveMaxDD` is the engine's NEGATIVE
 *   fraction at the solved `leverage`.
 * - `{ ok: false }` — an HONEST failure (WEIGHTS-04). Never a fabricated
 *   leverage. `reason` enumerates the honest state:
 *     · `"unreachable"`       — target exceeds the sleeve's max-DD at the domain
 *                               ceiling (ruin / MAX_LEVERAGE). `ceiling` carries
 *                               the ceiling `L` that was evaluated.
 *     · `"no-drawdown"`       — the series has no drawdown at any `L` (flat) →
 *                               a positive target is not applicable.
 *     · `"insufficient-history"` — fewer than the engine's 10-observation floor
 *                               (`max_drawdown` null).
 *     · `"degenerate"`        — the series cannot be modeled even at 1×
 *                               (ruin / non-finite at L=1 → `max_drawdown` null).
 *     · `"unimplemented"`     — ⚠️ WAVE-0-ONLY scaffolding. Plan 113-02 DELETES
 *                               this variant (a grep gate keeps it from shipping).
 */
export type SolveLeverageResult =
  | { ok: true; leverage: number; sleeveMaxDD: number }
  | {
      ok: false;
      reason:
        | "unreachable"
        | "no-drawdown"
        | "insufficient-history"
        | "degenerate"
        | "unimplemented";
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
 * WAVE-0 STUB — returns `{ ok: false, reason: "unimplemented" }` unconditionally.
 * Plans 113-01 / 113-02 implement the ruin-clamped monotone bisect over
 * `computeScenario`.
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
  // Reference the args so the contract signature is exercised without engine
  // math (SC-3 — no cumulative-product / peak-trough loop in this module).
  void args;
  return { ok: false, reason: "unimplemented" };
}
