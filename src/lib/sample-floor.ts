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

/**
 * Discriminated on `reason` so illegal states are UNREPRESENTABLE (review
 * type-design F1): `ok` is a per-variant literal tied to `reason` (can't drift —
 * `{ ok: true, reason: "below-floor" }` matches no member), and `n` is a finite
 * `number` in the `"ok"`/`"below-floor"` arms and `null` ONLY in `"no-usable-n"`.
 * Callers may read `verdict.ok` or test `verdict.reason === "ok"`.
 */
export type SampleFloorVerdict =
  | { ok: true; reason: "ok"; n: number; floor: number }
  | { ok: false; reason: "below-floor"; n: number; floor: number }
  | { ok: false; reason: "no-usable-n"; n: null; floor: number };

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
 * bar per call. A non-finite or non-positive `floor` is a CALLER bug, not a
 * "no minimum" — review finding (silent-failure F2 / type-design F2): an
 * unvalidated `NaN`/`Infinity`/`<=0` floor would make `n < floor` always-false
 * and silently pass every `n`, rendering a false-precision estimate (the exact
 * harm this primitive prevents). We clamp such a floor back to the conservative
 * default rather than throw (the "never throws" contract is preserved). Never throws.
 */
export function evaluateSampleFloor(
  n: number | null | undefined,
  floor: number = SAMPLE_FLOOR_OVERLAPPING_DAYS,
): SampleFloorVerdict {
  // Guard the floor on the same fail-safe axis as `n`: a bad override can never
  // weaken the gate into passing an inadequate sample.
  // `floor >= 1`, not `> 0`: overlapping-day counts are integers >= 1, so a
  // fractional floor (e.g. 0.5) would pass every realistic n and silently
  // bypass the gate — clamp it to the default too (review red-team finding 2).
  const safeFloor =
    Number.isFinite(floor) && floor >= 1 ? floor : SAMPLE_FLOOR_OVERLAPPING_DAYS;
  if (n == null || !Number.isFinite(n) || n < 0) {
    return { ok: false, n: null, floor: safeFloor, reason: "no-usable-n" };
  }
  if (n < safeFloor) {
    return { ok: false, n, floor: safeFloor, reason: "below-floor" };
  }
  return { ok: true, n, floor: safeFloor, reason: "ok" };
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

/**
 * Route a below-floor verdict to its body copy — the single owner of the
 * reason precedence (matches the gate's "never fabricate a number" contract):
 *   1. 0/1-strategy (caller count < 2)  → few-strategies body (no overlap N to name)
 *   2. no-usable-n (null/NaN/non-finite) → no-number body
 *   3. below-floor (finite n < floor)    → names the actual N + the floor
 *
 * Takes a non-passing verdict; an `"ok"` verdict is a CALLER bug (the gate said
 * the sample is adequate, so there is no honest body to render). We fall back
 * to the no-number body rather than fabricate a "{n} — fewer than {floor}" lie;
 * the render layer (`SampleFloorEmptyState`) drops the card entirely on `ok`.
 */
export function sampleFloorBody(
  verdict: SampleFloorVerdict,
  {
    feature = "distributional",
    strategyCount,
  }: { feature?: string; strategyCount?: number } = {},
): string {
  const { n, floor, reason } = verdict;
  if (strategyCount !== undefined && strategyCount < 2) {
    return fewStrategiesBody(floor);
  }
  if (reason === "below-floor") {
    return belowFloorBody(n, floor, feature);
  }
  return noUsableSampleBody();
}
