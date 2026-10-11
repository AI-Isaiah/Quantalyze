/**
 * Phase 167.1.2.2.2 (TRADESYNC), D-02: the named-gap record.
 *
 * `strategy_analytics.series_provenance` is an object whose optional
 * `unrecovered_gaps` array holds `{ from, to, ... }` spans (dates `YYYY-MM-DD`,
 * inclusive) that neither the daily tick nor the venue can supply. This module
 * is the ONLY reader of that record: the UI renders server truth only and never
 * infers a gap from holes in `payload.dates`. `legacy_ranges`, the sibling key,
 * is storage provenance and is deliberately not surfaced.
 */

export interface UnrecoveredGap {
  from: string;
  to: string;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date written exactly as `YYYY-MM-DD`. */
function isIsoCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function warnMalformed(reason: string): [] {
  console.warn(
    `[trade-fetch-provenance] series_provenance.unrecovered_gaps is malformed (${reason}); naming no gap`,
  );
  return [];
}

/**
 * Parse the validated gap list out of a `series_provenance` value.
 *
 * Pure and total. Absent, empty or gap-free input yields `[]` silently. Any
 * malformed shape (non-object provenance, non-array gap list, a non-object
 * entry, a date that is not a real `YYYY-MM-DD`, `to` before `from`) yields
 * `[]` and one `console.warn`: one bad entry voids the whole record rather than
 * rendering a partial claim. Output is `{from, to}` only, newest `to` first.
 */
export function parseUnrecoveredGaps(seriesProvenance: unknown): UnrecoveredGap[] {
  try {
    if (seriesProvenance == null) return [];
    if (typeof seriesProvenance !== "object" || Array.isArray(seriesProvenance)) {
      return warnMalformed("provenance is not an object");
    }
    const raw = (seriesProvenance as Record<string, unknown>).unrecovered_gaps;
    if (raw == null) return [];
    if (!Array.isArray(raw)) return warnMalformed("unrecovered_gaps is not an array");

    const gaps: UnrecoveredGap[] = [];
    for (const entry of raw) {
      if (entry == null || typeof entry !== "object" || Array.isArray(entry)) {
        return warnMalformed("an entry is not an object");
      }
      const { from, to } = entry as Record<string, unknown>;
      if (!isIsoCalendarDate(from) || !isIsoCalendarDate(to)) {
        return warnMalformed("an entry date is not a YYYY-MM-DD calendar date");
      }
      // ISO dates order lexicographically.
      if (to < from) return warnMalformed("an entry ends before it starts");
      gaps.push({ from, to });
    }
    return gaps.sort((a, b) => (a.to < b.to ? 1 : a.to > b.to ? -1 : 0));
  } catch {
    return warnMalformed("provenance could not be read");
  }
}
