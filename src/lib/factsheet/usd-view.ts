/**
 * Phase 164.6.6.2.1 (D-06, D-22) — the honesty facts of a native strategy's USD
 * view: which native return days the conversion could not price, which calendar
 * days are to blame, and whether the USD series starts late.
 *
 * `convertNativeReturnsToUsd` pairs native day `d_k` with the BTC closes over
 * the interval `[d_{k-1}, d_k]` and drops the day when ANY calendar day of that
 * interval has no stored close (UI-SPEC C, "What is absent"). So one unpriced
 * day removes more than itself: if it is a native day and another native day
 * follows, BOTH returns go; if it falls between two native days, only the later
 * one goes. This module counts, locates and names exactly those removals, so a
 * hole is never silent (UI-SPEC B: the `{k}` of the unpriced note).
 *
 * What the chart does with these (UI-SPEC C, option (a)): `missingSegments` marks
 * a seam at the first present point after each run. The joining line claims no
 * value for an absent day: those dates are not in the USD series, the seam sits
 * on the join, and the note names the days. Nothing here fills, interpolates or
 * carries a value.
 *
 * Interior only. The window is "after the USD series' first date, up to its last":
 *   - a LEADING stretch (USD starts later than the native series' SECOND date)
 *     is reported as `leadingHole`, not as removals (UI-SPEC B / D-22; the
 *     one-day offset of the first native day is inherent and is not a hole);
 *   - a TRAILING stretch (closes end before the native series does) is neither a
 *     hole nor a removal: `usdEnd` and the native track-record end state both ends.
 *
 * Pure and isomorphic: no React, no I/O.
 */

/** One run of consecutive removed native return days, inclusive calendar span. */
export interface UsdMissingSegment {
  start: string;
  end: string;
  kind: "gap";
  /** Calendar days from `start` through `end`, both ends counted (as `deriveSegmentMarkers`). */
  days: number;
}

export interface UsdViewFacts {
  missingSegments: UsdMissingSegment[];
  /** Calendar days (ISO, UTC, ascending) with no stored close that caused a removal. */
  unpricedDays: string[];
  /** Native return days absent from the USD series because their interval holds an unpriced day. */
  removedReturns: number;
  usdStart: string;
  usdEnd: string;
  /** USD series starts later than the native series' second date (D-22). */
  leadingHole: boolean;
}

const DAY_MS = 86_400_000;

const toMs = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);
const toIso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/**
 * @param nativeDates every date of the native series the conversion read, ascending,
 *   INCLUDING its absent-day placeholders (the interval of a day is measured from the
 *   previous entry, exactly as the converter does).
 * @param usdDates the dates of the converted USD series, ascending. Must be non-empty:
 *   a USD view with no priced day is `usdViewUnavailable`, never a facts object.
 * @param closeDays the calendar days with a stored (valid) BTC close.
 */
export function buildUsdViewFacts(
  nativeDates: readonly string[],
  usdDates: readonly string[],
  closeDays: ReadonlySet<string>,
): UsdViewFacts {
  if (usdDates.length === 0) {
    throw new Error("buildUsdViewFacts: a USD view needs at least one priced day");
  }
  const usdStart = usdDates[0];
  const usdEnd = usdDates[usdDates.length - 1];
  const present = new Set(usdDates);

  const leadingHole = nativeDates.length >= 2 && usdStart > nativeDates[1];

  const segments: UsdMissingSegment[] = [];
  const unpriced = new Set<string>();
  let removedReturns = 0;
  let run: { start: string; end: string } | null = null;
  const closeRun = () => {
    if (run === null) return;
    segments.push({
      start: run.start,
      end: run.end,
      kind: "gap",
      days: Math.round((toMs(run.end) - toMs(run.start)) / DAY_MS) + 1,
    });
    run = null;
  };

  for (let k = 1; k < nativeDates.length; k += 1) {
    const day = nativeDates[k];
    if (day <= usdStart || day > usdEnd) continue;
    if (present.has(day)) {
      closeRun();
      continue;
    }
    // Absent from the USD series. Price-caused only when a calendar day of its
    // pairing interval has no close; any other absence (a native placeholder
    // day) is the native series' own business and is not counted here.
    const blamed: string[] = [];
    for (let t = toMs(nativeDates[k - 1]); t <= toMs(day); t += DAY_MS) {
      const d = toIso(t);
      if (!closeDays.has(d)) blamed.push(d);
    }
    if (blamed.length === 0) continue;
    removedReturns += 1;
    for (const d of blamed) unpriced.add(d);
    run = run === null ? { start: day, end: day } : { start: run.start, end: day };
  }
  closeRun();

  return {
    missingSegments: segments,
    unpricedDays: [...unpriced].sort(),
    removedReturns,
    usdStart,
    usdEnd,
    leadingHole,
  };
}
