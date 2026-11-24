/**
 * Phase 239 (CACHE-02) — the factsheet range held as DATES, resolved to axis indices on
 * every render.
 *
 * `FactsheetProvider` used to hold the user's range as axis indices. When the series grew
 * at the FRONT (the composer's lazy returns landing with earlier days), every index then
 * pointed at a different day, so the range the user picked silently moved. Holding the
 * two DATES and resolving them against the active axis each render keeps the exact days
 * the user picked, whichever end the series grows at.
 *
 * A preset (the composer's 3M/6M/12M) is held as its month count instead, and resolves to
 * the last N calendar months ending on the latest axis day, so it rolls when a newer day
 * arrives (founder Q4 "Presets roll, manual stays", Q5 "12 calendar months").
 *
 * Pure module: no React, no client directive. Dates are ISO "YYYY-MM-DD" strings, whose
 * lexicographic order equals their chronological order (the `src/lib/dateday.ts` header
 * states this), so the lookups below compare the raw strings.
 */
import { subtractMonths } from "@/lib/dateday";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import type { Basis } from "./basis-context";

/**
 * The range the user set. A manual range is held as dates (ISO days on the axis it was set
 * on); a preset is held as a month count and rolls with the latest day.
 */
export type StoredRange =
  | { kind: "manual"; start: string; end: string }
  | { kind: "preset"; months: number };

/** First index whose date is on or after `day`; `axis.length` when there is none. */
export function lowerBound(axis: readonly string[], day: string): number {
  let lo = 0;
  let hi = axis.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (axis[mid] < day) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First index whose date is strictly after `day`; `axis.length` when there is none. */
export function upperBound(axis: readonly string[], day: string): number {
  let lo = 0;
  let hi = axis.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (axis[mid] <= day) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Resolve a stored range to `[startIdx, endIdx]` on `axis`.
 *
 * - No stored range, or an empty axis: `fullRange`, by reference.
 * - Preset of N months: from the first axis day on or after (latest axis day minus N
 *   calendar months, inclusive) to the last index. A series shorter than N months resolves
 *   to `[0, last]`; a latest day that is not an ISO day gives `fullRange`.
 * - Manual range, STRICT off-axis rule: a start before the axis's first day, or an end
 *   after its last day, gives `fullRange`. This mirrors the old index fallback (a user
 *   range pointing past the end of a SHRUNK axis fell back to the current full range,
 *   else the chart clamped both ends to the last index and showed a one-day range).
 * - Otherwise start → the first index on or after the start date, end → the last index
 *   on or before the end date. A range whose two dates fall between the same two axis
 *   points (start index after end index) gives `fullRange`.
 *
 * No widening here: a range narrower than `MIN_VISIBLE_SAMPLES` is returned as resolved.
 * Widening happens only when the user writes a range (`setXRange`).
 */
export function resolveStoredRange(
  stored: StoredRange | null,
  axis: readonly string[],
  fullRange: readonly [number, number],
): readonly [number, number] {
  if (stored === null || axis.length === 0) return fullRange;
  const last = axis.length - 1;
  if (stored.kind === "preset") {
    const boundary = subtractMonths(axis[last], stored.months);
    if (boundary === null) return fullRange;
    return [lowerBound(axis, boundary), last];
  }
  if (stored.start < axis[0] || stored.end > axis[last]) return fullRange;
  const s = lowerBound(axis, stored.start);
  const e = upperBound(axis, stored.end) - 1;
  if (s > e) return fullRange;
  return [s, e];
}

/**
 * The date axis of the active basis view. It MUST stay equal to Layer 1 of
 * `useBasisSeriesView` in `basis-context.tsx` (mark_to_market and smoothed_mtm select
 * their own `seriesByBasis` bundle; cash, or an absent bundle, keeps the payload's own
 * dates). `basis-context.active-axis.test.tsx` pins the two by value.
 */
export function basisAxisDates(payload: FactsheetPayload, basis: Basis): readonly string[] {
  const bundle =
    basis === "mark_to_market"
      ? payload.seriesByBasis?.mark_to_market
      : basis === "smoothed_mtm"
        ? payload.seriesByBasis?.smoothed_mtm
        : undefined;
  if (basis === "cash_settlement" || !bundle) return payload.dates;
  return bundle.dates;
}
