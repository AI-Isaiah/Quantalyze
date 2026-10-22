/**
 * Phase 167.2.1.1.2 (ACCTREBUILD), D-03: the rebuild-boundary record.
 *
 * D-03: "Where the rebuilt window meets the older unchanged days, the curve may
 * jump by the open-position profit at that date. Leave the jump, store the
 * boundary date so charts and returns can name it, and invent no values."
 *
 * AR-3: the rebuild function writes that date as ONE `allocator_equity_derived`
 * row, `kind = 'snapshot_rebuild_boundary'`, payload
 * `{"boundary_date": "YYYY-MM-DD"}`, in the same transaction as the snapshot
 * rewrite. This module is the ONLY reader of that payload. The JSONB crosses
 * from the worker/SQL into a typed field here, so it is untrusted: only a real
 * calendar date written exactly `YYYY-MM-DD` is accepted and every other key is
 * dropped.
 *
 * OQ-1: nothing renders it. The curve on screen is the derived `equity_curve`
 * row, which does not carry the seam, so a note there would describe a jump the
 * drawn curve does not have. The field exists so a later note is a UI-only
 * change.
 */

export const SNAPSHOT_REBUILD_BOUNDARY_KIND = "snapshot_rebuild_boundary" as const;

export interface SnapshotRebuildBoundary {
  /** `YYYY-MM-DD`, a real calendar date. */
  boundaryDate: string;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date written exactly as `YYYY-MM-DD`. */
function isIsoCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Logs the reason only, never a value from the payload. */
function warnMalformed(reason: string): null {
  console.warn(
    `[snapshot-rebuild-boundary] allocator_equity_derived snapshot_rebuild_boundary payload is malformed (${reason}); naming no boundary`,
  );
  return null;
}

/**
 * Parse the validated boundary out of a `snapshot_rebuild_boundary` payload.
 *
 * Pure and total. An absent payload (`null` / `undefined`) yields `null`
 * silently: no row means nothing was rebuilt. Any other shape that is not an
 * object holding a real `YYYY-MM-DD` `boundary_date` yields `null` and one
 * `console.warn` carrying the reason only. Output is `{ boundaryDate }` only.
 */
export function parseSnapshotRebuildBoundary(payload: unknown): SnapshotRebuildBoundary | null {
  try {
    if (payload == null) return null;
    if (typeof payload !== "object" || Array.isArray(payload)) {
      return warnMalformed("payload is not an object");
    }
    const boundaryDate = (payload as Record<string, unknown>).boundary_date;
    if (!isIsoCalendarDate(boundaryDate)) {
      return warnMalformed("boundary_date is not a YYYY-MM-DD calendar date");
    }
    return { boundaryDate };
  } catch {
    return warnMalformed("payload could not be read");
  }
}
