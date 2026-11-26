/**
 * The factsheet payload's stand-in for a NULL `strategy_analytics.computed_at`.
 *
 * Phase 238 FACT-03: a never-computed row has no compute date, so the column is NULL. The
 * payload keeps `computedAt: string` (its builders, census fixtures and the
 * `factsheet-v2-payload` cache key stay as they are), so the server builder writes this epoch
 * literal for a NULL and every renderer recognises it through `isNeverComputedStamp` and prints
 * the null dash instead of a date. This is the only file that holds the literal.
 *
 * Pure and import-free: the `"use client"` FactsheetView and the server builder both import it.
 */
export const NEVER_COMPUTED_STAMP = "1970-01-01T00:00:00Z";

/**
 * True for a missing compute date: null, undefined, the empty string, or any value at instant 0.
 * The instant compare (not a string compare) also matches the `+00:00` spelling PostgREST
 * returns for the rollback's `TIMESTAMPTZ 'epoch'`.
 */
export function isNeverComputedStamp(value: string | null | undefined): boolean {
  return !value || value === NEVER_COMPUTED_STAMP || Date.parse(value) === 0;
}
