/**
 * The calendar-date check `nav-marks-start.ts` imports.
 *
 * This file keeps its name only because of that import. It was written for the
 * Phase 167.2.1.1.2 (ACCTREBUILD) rebuild-boundary record, an
 * `allocator_equity_derived` row of kind `snapshot_rebuild_boundary` that named
 * where a rebuilt window of the legacy snapshot table met the older days. Phase
 * 176 LEGACYRETIRE (D-02) retired that record with the table: its writer, its
 * one reader and its types are gone, so the date check is all that remains.
 */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date written exactly as `YYYY-MM-DD`. */
export function isIsoCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
