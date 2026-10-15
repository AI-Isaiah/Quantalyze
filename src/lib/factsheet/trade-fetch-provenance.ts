/**
 * Phase 167.1.2.2.2 (TRADESYNC), D-02: the named-gap record.
 *
 * `strategy_analytics.series_provenance` is an object whose optional
 * `unrecovered_gaps` array holds `{ from, to, ... }` spans (dates `YYYY-MM-DD`,
 * inclusive) that neither the daily tick nor the venue can supply. This module
 * is the ONLY reader of that record: the UI renders server truth only and never
 * infers a gap from holes in `payload.dates`. `legacy_ranges`, the sibling key,
 * is storage provenance and is deliberately not surfaced.
 *
 * Phase 167.1.2.2.2.1 (OKXHISTORY), D-05: the same object also holds the
 * optional `reconstructed_ranges` array, spans of days rebuilt from the venue's
 * bills archive. This module is the ONLY reader of BOTH keys
 * (`unrecovered_gaps` and `reconstructed_ranges`); neither the column set nor
 * any per-row marker changed, so a rebuilt day is told apart from a live one
 * only through this server-truth record, never inferred client-side.
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

/**
 * The only `source` the rebuild RPC writes into `reconstructed_ranges`. The RPC
 * is the sole writer, so any other value is a defect and is never rendered.
 */
export const RECONSTRUCTED_SOURCE = "okx_bills_history_archive" as const;

export interface ReconstructedRange {
  from: string;
  to: string;
  source: typeof RECONSTRUCTED_SOURCE;
}

/**
 * What `readReconstructedRanges` found in a `series_provenance` value.
 *
 * `malformed` is `null` when the record is absent or valid, and a short reason
 * string when it is present but unusable. The two are NOT the same fact for a
 * reader: absent means nothing was rebuilt, malformed means we cannot say (and
 * the rebuild RPC has already taken the rebuilt days out of `unrecovered_gaps`,
 * so a silent empty list would present them as live days).
 */
export interface ReconstructedRangesRead {
  ranges: ReconstructedRange[];
  malformed: string | null;
}

function malformedReconstructed(reason: string): ReconstructedRangesRead {
  console.warn(
    `[trade-fetch-provenance] series_provenance.reconstructed_ranges is malformed (${reason}); naming no range`,
  );
  return { ranges: [], malformed: reason };
}

/**
 * Parse the validated reconstructed-range list out of a `series_provenance`
 * value (Phase 167.1.2.2.2.1, D-05), in the posture of `parseUnrecoveredGaps`,
 * and say whether the record was malformed (review round 1, F5 / IN-01).
 *
 * Pure and total. Absent provenance, an absent key or an empty list yields
 * `{ ranges: [], malformed: null }` silently. Any malformed shape (non-object
 * provenance, non-array list, a non-object entry, a date that is not a real
 * `YYYY-MM-DD`, `to` before `from`, a `source` other than
 * `RECONSTRUCTED_SOURCE`) yields `{ ranges: [], malformed: <reason> }` and one
 * `console.warn`: one bad entry voids the whole record rather than rendering a
 * partial public claim. The CALLERS own the loud half: each reports a non-null
 * `malformed` to Sentry and renders the unavailable line, so a disclosure
 * failure is visible to an operator and to the reader. Output ranges are
 * `{from, to, source}` only (`recorded_at` and any other stored field are
 * dropped), newest `to` first.
 */
export function readReconstructedRanges(seriesProvenance: unknown): ReconstructedRangesRead {
  try {
    if (seriesProvenance == null) return { ranges: [], malformed: null };
    if (typeof seriesProvenance !== "object" || Array.isArray(seriesProvenance)) {
      return malformedReconstructed("provenance is not an object");
    }
    const raw = (seriesProvenance as Record<string, unknown>).reconstructed_ranges;
    if (raw == null) return { ranges: [], malformed: null };
    if (!Array.isArray(raw)) return malformedReconstructed("reconstructed_ranges is not an array");

    const ranges: ReconstructedRange[] = [];
    for (const entry of raw) {
      if (entry == null || typeof entry !== "object" || Array.isArray(entry)) {
        return malformedReconstructed("an entry is not an object");
      }
      const { from, to, source } = entry as Record<string, unknown>;
      if (!isIsoCalendarDate(from) || !isIsoCalendarDate(to)) {
        return malformedReconstructed("an entry date is not a YYYY-MM-DD calendar date");
      }
      // ISO dates order lexicographically.
      if (to < from) return malformedReconstructed("an entry ends before it starts");
      if (source !== RECONSTRUCTED_SOURCE) {
        return malformedReconstructed("an entry carries an unknown source");
      }
      ranges.push({ from, to, source: RECONSTRUCTED_SOURCE });
    }
    return {
      ranges: ranges.sort((a, b) => (a.to < b.to ? 1 : a.to > b.to ? -1 : 0)),
      malformed: null,
    };
  } catch {
    return malformedReconstructed("provenance could not be read");
  }
}

/**
 * The ranges alone, for a caller that has no use for the verdict. Production
 * surfaces call `readReconstructedRanges` so a malformed record is reported and
 * disclosed; this keeps the original total `ReconstructedRange[]` contract.
 */
export function parseReconstructedRanges(seriesProvenance: unknown): ReconstructedRange[] {
  return readReconstructedRanges(seriesProvenance).ranges;
}
