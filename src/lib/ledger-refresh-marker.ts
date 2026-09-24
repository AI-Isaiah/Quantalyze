import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Phase 164.6 / 161.1-D13 — the ledger-refresh markers a `compute_jobs` row
 * can carry in `metadata.source`.
 *
 * ⛔ PARITY-PINNED to Python's `LEDGER_REFRESH_JOB_SOURCES` in
 * `analytics-service/services/job_worker.py` (the union of
 * `LEDGER_REFRESH_SINGLE_KEY_SOURCE` and `LEDGER_REFRESH_COMPOSITE_SOURCE`).
 * `ledger-refresh-marker.test.ts` reads that file and fails when the two sets
 * differ, so a marker added on one side cannot silently go unretracted on the
 * other.
 */
export const LEDGER_REFRESH_JOB_SOURCES = [
  "ledger-refresh",
  "ledger-refresh-composite",
] as const;

const MARKER_SET: ReadonlySet<string> = new Set(LEDGER_REFRESH_JOB_SOURCES);

/**
 * Phase 164.6 / 161.1-D13 — a user's composite sync may not INHERIT the
 * ledger-refresh protection from a job row the enqueue dedup handed it.
 *
 * The TypeScript twin of Python's `_retract_refresh_marker_on_reuse`
 * (`analytics-service/services/ingestion/long_fetch.py`), with the same
 * semantics: with the job id `enqueue_compute_job` returned, read
 * `compute_jobs.metadata`; if its `source` is a ledger-refresh marker, write the
 * metadata back WITHOUT `source`, plus `refresh_marker_retracted = <marker>` and
 * `correlation_id = <this request's id>`. Every other key is preserved.
 *
 * `enqueue_compute_job` dedups on (target, kind) over the in-flight statuses and
 * returns the EXISTING id with the caller's `p_metadata` discarded. If a
 * recurring ledger refresh already holds the strategy's `stitch_composite`, the
 * user's request is now served by a job carrying the refresh marker — a
 * protection meant for background work nobody is watching.
 *
 * ⛔ WHY THE WRITE TARGETS `metadata->>'source'` AND NOT A NEW KEY. Two readers
 * consume exactly that expression: the honour sites in
 * `analytics-service/services/job_worker.py`, and the `is_protected` predicate
 * of `sync_strategy_analytics_status` in SQL. The SQL end decides the publish
 * state on every path where no Python stamp runs at all, and it cannot be taught
 * about a new key from here. Retracting the marker itself stands both ends down
 * with one write. `refresh_marker_retracted` and `correlation_id` are
 * provenance only; nothing keys on either.
 *
 * ⛔ THE UNION OF BOTH MARKERS, NOT ONE. Narrowing a PROTECTION to the arm that
 * owns it is the careful direction; retraction is the LOUD direction, so
 * widening it can only make more failures visible.
 *
 * ⚠️ RESIDUAL, stated rather than hidden (161.1-D12): this is a
 * read-modify-write. A concurrent writer to the same `metadata` column between
 * the read and the update (the claim RPC additively writes
 * `unified_backbone_at_claim`) loses its key. The real closure is a merge arm in
 * `enqueue_compute_job` (161.1-D11); that RPC is on every enqueue path and is
 * out of scope here.
 *
 * Error contract: a read or update error THROWS an `Error` carrying the
 * PostgREST error as `cause`. The CALLER owns `console.error` +
 * `captureToSentry` under its own tag, and must not fail the user's request:
 * the enqueue already succeeded.
 */
export async function retractInheritedRefreshMarker(
  admin: SupabaseClient,
  jobId: string | null | undefined,
  correlationId: string,
): Promise<{ retracted: false } | { retracted: true; marker: string }> {
  if (!jobId) return { retracted: false };

  const { data: row, error: readErr } = await admin
    .from("compute_jobs")
    .select("metadata")
    .eq("id", jobId)
    .maybeSingle();
  if (readErr) {
    throw new Error("compute_jobs metadata read failed", { cause: readErr });
  }

  const metadata: unknown = row?.metadata;
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
    return { retracted: false };
  }
  const { source, ...rest } = metadata as Record<string, unknown>;
  if (typeof source !== "string" || !MARKER_SET.has(source)) {
    return { retracted: false };
  }

  // @audit-skip: job-row provenance metadata on a worker queue row, not a
  // user-visible mutation; the caller's route audits the user's intent.
  const { error: updateErr } = await admin
    .from("compute_jobs")
    .update({
      metadata: {
        ...rest,
        refresh_marker_retracted: source,
        correlation_id: correlationId,
      },
    })
    .eq("id", jobId);
  if (updateErr) {
    throw new Error("compute_jobs metadata update failed", { cause: updateErr });
  }
  return { retracted: true, marker: source };
}
