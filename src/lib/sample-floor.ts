/**
 * Pure TypeScript — no fetch, no side effects, no DOM/time reads.
 *
 * HONEST-02 single source of truth for the distributional/tail minimum-sample
 * floor. Phases 26 (Stress/VaR) and 27 (Monte-Carlo) import THIS — they must
 * never re-declare `60`. The floor exists because a tail/distributional
 * estimate built on a handful of overlapping days is false precision: it
 * projects an "this number is robust" aesthetic over a statistically
 * meaningless sample (the same trust regression `min-history.ts` guards for
 * charts). Below the floor we render an honest empty state instead.
 *
 * This module is a FLOOR CHECK on a finite overlapping-day count — NOT a full
 * degenerate-input classifier (RESEARCH Pitfall 2). The 0/1-strategy case and
 * the "large n but the engine nulled the metrics" case route at the CALL SITE,
 * because only the caller knows the strategy count and whether the engine
 * returned usable metrics. The gate here defends the ONE thing it can see: a
 * null / NaN / non-finite / negative / below-floor day count never passes.
 *
 * Convention model: `scenario-history.ts` (pure-lib header + degenerate-safe
 * single-purpose export, never throws) and `min-history.ts` (self-documenting
 * named constant + a "name actual + required" message builder).
 */

/**
 * Conservative distributional/tail bar (default override-able floor).
 *
 * DISTINCT from — and deliberately NOT named `MIN_*` to avoid a grep collision
 * with (Pitfall 3):
 *   - the correlation engine's `< 10` overlapping-day bar (`scenario.ts`), and
 *   - `min-history.ts`'s 250/365 chart bars (`CORRELATION_90D_MIN_DAYS` etc).
 *
 * 60 overlapping days ≈ a quarter of trading sessions — the smallest window
 * where a return distribution's tail/dispersion is worth estimating at all. Do
 * NOT unify this with the 10-day correlation bar; they are different
 * statistic-specific thresholds that merely share a visual empty-state shell.
 */
export const SAMPLE_FLOOR_OVERLAPPING_DAYS = 60;

export type SampleFloorReason = "ok" | "below-floor" | "no-usable-n";

export interface SampleFloorVerdict {
  ok: boolean;
  /** The validated finite day count, or `null` when the input was unusable. */
  n: number | null;
  /** The floor actually applied (the per-call override, or the default). */
  floor: number;
  reason: SampleFloorReason;
}

/**
 * Floor check on a finite overlapping-day count `n`.
 *
 * Branch order (the guard FIRST — Pitfall 2; a non-finite/negative/null `n`
 * must NEVER pass, even an `Infinity > floor`):
 *   1. `n == null || !Number.isFinite(n) || n < 0` → `"no-usable-n"` (ok: false).
 *   2. `n < floor`                                  → `"below-floor"` (ok: false).
 *   3. else                                         → `"ok"`.
 *
 * `floor` defaults to `SAMPLE_FLOOR_OVERLAPPING_DAYS`; Stress/MC pass their own
 * bar per call. Never throws.
 */
export function evaluateSampleFloor(
  n: number | null | undefined,
  floor: number = SAMPLE_FLOOR_OVERLAPPING_DAYS,
): SampleFloorVerdict {
  if (n == null || !Number.isFinite(n) || n < 0) {
    return { ok: false, n: null, floor, reason: "no-usable-n" };
  }
  if (n < floor) {
    return { ok: false, n, floor, reason: "below-floor" };
  }
  return { ok: true, n, floor, reason: "ok" };
}

/**
 * Empty-state reason heading (UI-SPEC Copywriting Contract). Shared across the
 * below-floor reasons; the body names the SPECIFIC reason so the allocator
 * knows what to fix. DISTINCT from the correlation surface's "Not enough
 * overlap to correlate" — exported so Phases 26/27 reuse it, never re-author.
 */
export const SAMPLE_FLOOR_HEADING = "Not enough history for this estimate";

/**
 * Below-floor body: names BOTH the actual N and the floor + the consuming
 * feature noun (e.g. "stress", "Monte-Carlo"). Mirrors `min-history.ts`'s
 * `insufficientHistoryMessage` "name actual + required" builder shape.
 */
export function belowFloorBody(
  n: number,
  floor: number,
  feature: string,
): string {
  return (
    `These strategies share ${n} overlapping days — fewer than the ${floor} ` +
    `needed for an honest ${feature} estimate. Pick strategies with longer common history.`
  );
}

/**
 * No-usable-n body (null / NaN / non-finite / negative count): names NO number
 * — there is no honest N to report, so we never fabricate one.
 */
export function noUsableSampleBody(): string {
  return (
    "Not enough usable return history to estimate this yet. " +
    "Pick strategies with longer, cleaner common history."
  );
}

/**
 * 0/1-strategy body (call-site supplied case — the gate cannot see strategy
 * count): names the floor and the 2-strategy minimum, but no fabricated overlap
 * N (there is no meaningful overlap with fewer than 2 strategies).
 */
export function fewStrategiesBody(floor: number): string {
  return `Add at least 2 active strategies with ${floor}+ overlapping days for an honest estimate.`;
}
