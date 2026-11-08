/**
 * Phase 194 plan 03 (TRUST-05, D-09): the one missing-figure contract for sortable and
 * filterable metric lists.
 *
 * A figure is MISSING when it is null, undefined, a non-finite number, or withheld (a
 * withheld figure reaches here as null, via `gatedValue` in `figure-gate.ts`). A missing
 * figure sorts after every finite value in BOTH directions and never matches an active
 * range filter, a range containing 0 included. This module never substitutes a number
 * for a missing value (SC-5) and never inspects a value's magnitude (D-05).
 */

/** True for null, undefined, or a non-finite number (NaN, +/-Infinity). */
export function isMissingFigure(v: unknown): boolean {
  return v == null || (typeof v === "number" && !Number.isFinite(v));
}

/**
 * Sort comparator: missing values go last whatever `dir` is; two missing values compare 0
 * so the caller's stable order (its existing secondary order) holds. Strings compare as
 * strings (ISO timestamps order chronologically).
 */
export function compareWithMissingLast(
  a: number | string | null | undefined,
  b: number | string | null | undefined,
  dir: "asc" | "desc",
): number {
  const aMissing = isMissingFigure(a);
  const bMissing = isMissingFigure(b);
  if (aMissing || bMissing) {
    if (aMissing && bMissing) return 0;
    return aMissing ? 1 : -1;
  }
  const base = (a as number | string) < (b as number | string) ? -1 : (a as number | string) > (b as number | string) ? 1 : 0;
  return dir === "asc" ? base : -base;
}

/**
 * Range-filter predicate. Both bounds empty means the filter is inactive and everything
 * matches, a missing value included. Under any active bound a missing value never matches.
 * `scale` converts the stored value to the unit the bound text is typed in (for example 100
 * for a fraction shown as a percentage). Unparsable bound text imposes no limit on a finite
 * value, as before, and never lets a missing value through.
 */
export function rangeMatches(
  value: number | null | undefined,
  range: { from: string; to: string },
  scale = 1,
): boolean {
  if (range.from === "" && range.to === "") return true;
  if (value == null || !Number.isFinite(value)) return false;
  const scaled = value * scale;
  if (range.from !== "" && scaled < parseFloat(range.from)) return false;
  if (range.to !== "" && scaled > parseFloat(range.to)) return false;
  return true;
}
