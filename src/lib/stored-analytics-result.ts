/**
 * Phase 190 (FACTSHEETQUEUED) plan 03 — what a `strategy_analytics` row STORES
 * from its last successful compute, and which flags belong to those numbers.
 *
 * Dependency-free on purpose: no server-only module, no client directive, no
 * import at all. The factsheet resolve stage, the lists' shapers, the admin
 * route and client code all share it, so no two of them can disagree about what
 * "a stored success result" means. Row state only, never lane state: nothing
 * here reads a viewer, a cookie or a header.
 *
 * WHY the evidence is not `computed_at`: the column is `DEFAULT now() NOT NULL`,
 * so a row that never computed carries one too. It is used here only to BIND a
 * snapshot to the success that stored the row's numbers.
 */

/**
 * 167.2.1-REVIEW-SFH M-3 — how many dated return entries a stored series
 * column HOLDS, before any normalization drops a malformed one. An array
 * counts its distinct string dates, plus each entry with no string date on its
 * own (a malformed entry is still an entry the writer stored). A flat
 * `{date: value}` dict counts its keys, and a nested `{year: {MM-DD: value}}`
 * dict its inner keys. Anything else holds none.
 */
export function storedEntryCount(raw: unknown): number {
  if (raw === null || typeof raw !== "object") return 0;
  if (Array.isArray(raw)) {
    const keys = new Set<string>();
    raw.forEach((entry, i) => {
      const date =
        entry !== null && typeof entry === "object" ? (entry as { date?: unknown }).date : undefined;
      keys.add(typeof date === "string" ? `date:${date}` : `entry:${i}`);
    });
    return keys.size;
  }
  let count = 0;
  for (const value of Object.values(raw)) {
    count +=
      value !== null && typeof value === "object" && !Array.isArray(value)
        ? Object.keys(value).length
        : 1;
  }
  return count;
}

/**
 * The key under which the derive hop carries the last success's flags across
 * its prestamp: `data_quality_flags.last_success_snapshot`.
 *
 * The contract (plan 09 writes it, this module reads it, plan 05 pins the two
 * equal): the value is an object `{ computed_at, flags }`, where `computed_at`
 * is the row's `computed_at` string as the derive hop read it and `flags` is the
 * row's `data_quality_flags` as it read them, without a `last_success_snapshot`
 * key. It is JSON null when the derive had no snapshot to carry. Only the derive
 * hop's prestamp writes it, and it writes the key on every strategy-mode
 * prestamp. Every success write leaves a top-level `cumulative_method`, and the
 * live flags then take precedence.
 *
 * Python twin: `LAST_SUCCESS_SNAPSHOT_KEY` in
 * `analytics-service/services/job_worker.py`.
 */
export const LAST_SUCCESS_SNAPSHOT_KEY = "last_success_snapshot";

/**
 * True only when both values are strings that parse to a finite instant and the
 * two instants are equal. Compared as instants, not as text, because Postgres
 * writes `...10:00:00.123456+00:00` and a JS `toISOString` writes
 * `...10:00:00.123Z` for the same moment.
 *
 * Millisecond precision is enough: two success writes are separated by at least
 * one full derive hop and one full compute hop. Any parse failure answers false,
 * which fails closed: an unbound snapshot is never used.
 */
export function isSameInstant(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  return Number.isFinite(ta) && Number.isFinite(tb) && ta === tb;
}

/** The slice of a `strategy_analytics` row the flag resolution reads. */
type FlagsRow = { data_quality_flags?: unknown; computed_at?: unknown } | null | undefined;

type FlagBag = Record<string, unknown>;

function asBag(raw: unknown): FlagBag | null {
  return raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as FlagBag) : null;
}

function hasMarker(bag: FlagBag | null): boolean {
  const m = bag?.cumulative_method;
  return typeof m === "string" && m.length > 0;
}

export type EffectiveFlags = {
  /** The flags every reader of this row should use, or null when the row has none. */
  flags: FlagBag | null;
  /** The row's own `data_quality_flags`, when it is a non-array object. */
  live: FlagBag | null;
  /** Where `flags` came from. */
  source: "live" | "snapshot";
};

/**
 * Phase 190 plan 03 (D-02, SC-3, SC-6) — the flags that belong to the numbers
 * the row stores.
 *
 * The live `data_quality_flags` win when they carry a top-level non-empty string
 * `cumulative_method`: only the two terminal-success writers stamp it, so those
 * flags were written by the same run as the stored series and headline. When
 * they do not, the derive hop's prestamp (or a csv_source-only failure arm) has
 * replaced them, and the last success's flags may still ride in
 * `last_success_snapshot`. That snapshot is used only when it is a well-formed
 * non-null object, its `computed_at` is the SAME instant as the row's
 * `computed_at`, and its `flags` carry the marker. Only the two terminal-success
 * writers stamp `computed_at` (plan 01 verdict SNAPSHOT), so a snapshot taken
 * from an earlier success cannot be bound to a later one's numbers, and a
 * stale, racing or version-skewed snapshot fails closed to the live flags
 * (which then lack the marker, so the row is withheld, never mixed).
 *
 * Row state only, never lane state.
 */
export function effectiveDataQualityFlags(row: FlagsRow): EffectiveFlags {
  const live = asBag(row?.data_quality_flags);
  if (hasMarker(live)) return { flags: live, live, source: "live" };
  const snap = asBag(live?.[LAST_SUCCESS_SNAPSHOT_KEY]);
  if (snap && isSameInstant(snap.computed_at, row?.computed_at)) {
    const snapFlags = asBag(snap.flags);
    if (hasMarker(snapFlags)) return { flags: snapFlags, live, source: "snapshot" };
  }
  return { flags: live, live, source: "live" };
}

/**
 * The columns the evidence reads. Projections that do not ship the flags blob
 * (the ranked lists) carry the marker and snapshot as aliases, so the same
 * rule can be asked of them.
 */
type EvidenceRow =
  | {
      daily_returns?: unknown;
      returns_series?: unknown;
      series_end?: unknown;
      cumulative_return?: unknown;
      data_quality_flags?: unknown;
      computed_at?: unknown;
      cumulative_method?: unknown;
      last_success_cumulative_method?: unknown;
      last_success_computed_at?: unknown;
    }
  | null
  | undefined;

function nonEmptyString(v: unknown): boolean {
  return typeof v === "string" && v.length > 0;
}

/**
 * How check (c) is satisfied: through the row's own flags ("live"), through a
 * snapshot bound to the row's `computed_at` ("snapshot"), or not at all (null).
 */
function markerSource(row: EvidenceRow): "live" | "snapshot" | null {
  const effective = effectiveDataQualityFlags(row);
  if (hasMarker(effective.live)) return "live";
  if (nonEmptyString(row?.cumulative_method)) return "live";
  if (effective.source === "snapshot") return "snapshot";
  if (
    nonEmptyString(row?.last_success_cumulative_method) &&
    isSameInstant(row?.last_success_computed_at, row?.computed_at)
  ) {
    return "snapshot";
  }
  return null;
}

/**
 * Phase 190 plan 03 (D-02) — does this row STORE the result of a successful
 * compute? True only when ALL three hold:
 *
 * (a) a stored series: `daily_returns` or `returns_series` holds at least one
 *     entry, or `series_end` (the ranked-list alias of the last `returns_series`
 *     date) is a non-empty string. A first-ever compute has none.
 * (b) a finite stored headline: `cumulative_return` is a finite number. A
 *     failure arm or a defect that leaves no finite headline fails closed.
 * (c) success-written flags: the effective flags carry a non-empty string
 *     `cumulative_method` (or its alias on a projection without the blob, or the
 *     last-success alias bound to the row's `computed_at`). Only the two
 *     terminal-success writers (`run_csv_strategy_analytics` and the composite
 *     stitch's `merged_flags`) stamp it into the flags (plan 01 verdict
 *     MARKER). The derive hop's `_prestamp_dq_flags` and every csv_source-only
 *     failure arm replace the flags without it, and the derive hop carries the
 *     last success's flags inside the snapshot (plan 09), which is why the
 *     snapshot counts here only when bound.
 */
export function hasStoredAnalyticsResult(row: EvidenceRow): boolean {
  if (!row) return false;
  const hasSeries =
    storedEntryCount(row.daily_returns) > 0 ||
    storedEntryCount(row.returns_series) > 0 ||
    nonEmptyString(row.series_end);
  if (!hasSeries) return false;
  const cr = row.cumulative_return;
  if (typeof cr !== "number" || !Number.isFinite(cr)) return false;
  return markerSource(row) !== null;
}

/**
 * True exactly when check (c) is satisfied only through a snapshot (the blob's
 * `last_success_snapshot` or the last-success aliases). Plans 05 and 07 use it
 * to pair the inner gates and the list projections with the same flags.
 */
export function usesLastSuccessSnapshot(row: EvidenceRow): boolean {
  return markerSource(row) === "snapshot";
}

/**
 * Phase 190 D-04 (founder 2026-11-03) — a derive prestamp replaced the success
 * flags and left no snapshot the reader may use. The live flags are then the new
 * derive's while the stored numbers are the last success's, so a factsheet built
 * from this row would draw old figures under new flags.
 *
 * True exactly when all four hold: (i) the row's `data_quality_flags` is a
 * non-null, non-array object (the live flags); (ii) the live flags have no
 * non-empty string top-level `cumulative_method`; (iii) the live flags carry the
 * `last_success_snapshot` KEY, whatever its value, null included; (iv) no
 * snapshot is bound, so `effectiveDataQualityFlags(row).source` is "live".
 *
 * The key, not the missing marker, is the evidence: plan 09 writes it on every
 * strategy-mode prestamp (null when it has no snapshot), while a legacy row
 * computed before the marker existed, and a prestamp from code older than plan
 * 09, carry none. Keying on the missing marker alone would hide every legacy
 * factsheet at rest, the defect class this phase fixes. A projection without the
 * flags blob always answers false, which is why plan 07 records that the lists
 * and /compare do not apply it.
 *
 * It reads no status: the caller decides which statuses it applies to. Row state
 * only, never lane state.
 */
export function hasUnboundDerivePrestamp(row: FlagsRow): boolean {
  const effective = effectiveDataQualityFlags(row);
  const live = effective.live;
  if (!live) return false;
  if (hasMarker(live)) return false;
  if (!Object.prototype.hasOwnProperty.call(live, LAST_SUCCESS_SNAPSHOT_KEY)) return false;
  return effective.source === "live";
}
