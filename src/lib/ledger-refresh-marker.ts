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
 * other. The set is also parity-pinned to the SQL function
 * `retract_ledger_refresh_marker` (Phase 191): the same test reads its generated
 * snapshot and compares both literal marker lists.
 */
export const LEDGER_REFRESH_JOB_SOURCES = [
  "ledger-refresh",
  "ledger-refresh-composite",
] as const;

const MARKER_SET: ReadonlySet<string> = new Set(LEDGER_REFRESH_JOB_SOURCES);

/**
 * The SQL function that does the retraction. A contract with
 * `supabase/schema/functions/retract_ledger_refresh_marker.sql`: the parity
 * describe in `ledger-refresh-marker.test.ts` reads that snapshot and fails when
 * this name, the marker set or `RETRACTION_OUTCOMES` drift from it.
 *
 * ⛔ The helper below writes this name as a QUOTED LITERAL at its `.rpc(` call,
 * never through this constant. The audit scanner (`MUTATING_RPC_RE` in
 * `src/__tests__/audit-coverage.test.ts`) matches only a literal after `.rpc(`;
 * a call through the constant would make the helper a non-mutator and leave the
 * Sync routes' `@audit-skip` pragmas decorative. The parity describe pins the
 * constant equal to that literal.
 */
export const RETRACT_REFRESH_MARKER_RPC = "retract_ledger_refresh_marker";

/**
 * The `outcome` words `retract_ledger_refresh_marker` answers with. A contract
 * with the SQL function, pinned to the generated snapshot in
 * `ledger-refresh-marker.test.ts`.
 */
export const RETRACTION_OUTCOMES = ["retracted", "done", "no_marker", "no_row"] as const;

/**
 * Phase 164.6 / 161.1-D13 / Phase 191 — a user's composite sync may not INHERIT
 * the ledger-refresh protection from a job row the enqueue dedup handed it.
 *
 * The TypeScript twin of Python's `_retract_refresh_marker_on_reuse`
 * (`analytics-service/services/ingestion/long_fetch.py`). With the job id
 * `enqueue_compute_job` returned, it makes ONE call to the SQL function
 * `retract_ledger_refresh_marker(p_job_id, p_correlation_id)` (Phase 191 D-01).
 * That function runs a single UPDATE that removes `metadata.source` when it is a
 * ledger-refresh marker, and records `refresh_marker_retracted = <marker>` and
 * `correlation_id = <this request's id>` beside every other key, untouched.
 * There is no read-then-write window here: a concurrent writer to the same
 * `metadata` column (the claim RPC additively writes `unified_backbone_at_claim`)
 * can no longer lose its key to a stale copy this helper wrote back.
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
 * of `sync_strategy_analytics_status` in SQL. Retracting the marker itself
 * stands both ends down with one write. `refresh_marker_retracted` and
 * `correlation_id` are provenance only; nothing keys on either.
 *
 * ⛔ THE UNION OF BOTH MARKERS, NOT ONE. Narrowing a PROTECTION to the arm that
 * owns it is the careful direction; retraction is the LOUD direction, so
 * widening it can only make more failures visible.
 *
 * ⚠️ D-02, UNCHANGED and stated rather than hidden: `enqueue_compute_job`
 * itself still discards the caller's metadata on a dedup, so the user's request
 * is served by the existing job until this retraction runs. This phase closes
 * the retraction's race, not that gap.
 *
 * Outcomes (`RETRACTION_OUTCOMES`):
 *   * `retracted`  -> `{ retracted: true, marker }`. The marker must be one of
 *     `LEDGER_REFRESH_JOB_SOURCES`; a foreign marker THROWS rather than reading
 *     as a retraction.
 *   * `done`       -> `{ retracted: false }`. A FINISHED job's protection was
 *     decided when it ran (D-07, 166.5); the function leaves its row alone so
 *     `updated_at` still tells when it finished.
 *   * `no_marker`  -> `{ retracted: false }`. A job without a marker is ordinary.
 *   * `no_row`     -> THROWS. `enqueue_compute_job` returned that id a moment
 *     ago, so an unreadable row is an anomaly, not an unmarked job.
 *
 * Error contract: an rpc error THROWS an `Error` carrying the PostgREST error as
 * `cause`; so do an unknown outcome and a non-object answer, because an answer
 * this helper cannot read must not pass as "nothing to retract". The CALLER owns
 * `console.error` + `captureToSentry` under its own tag, and must not fail the
 * user's request: the enqueue already succeeded. `retractionFailureCode` reads
 * the SQLSTATE back out of that `cause` for the caller's log line.
 */
export async function retractInheritedRefreshMarker(
  admin: SupabaseClient,
  jobId: string | null | undefined,
  correlationId: string,
): Promise<{ retracted: false } | { retracted: true; marker: string }> {
  if (!jobId) return { retracted: false };

  // The name is a quoted literal on purpose (see RETRACT_REFRESH_MARKER_RPC):
  // the audit scanner reads only a literal after `.rpc(`.
  // @audit-skip: job-row provenance metadata on a worker queue row, not a
  // user-visible mutation; the caller's route audits the user's intent.
  const { data, error } = await admin.rpc("retract_ledger_refresh_marker", {
    p_job_id: jobId,
    p_correlation_id: correlationId,
  });
  if (error) {
    throw new Error("compute_jobs marker retraction failed", { cause: error });
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error(
      "retract_ledger_refresh_marker answered with something that is not an object; an inherited marker may still be in place",
    );
  }
  const { outcome, marker } = data as { outcome?: unknown; marker?: unknown };
  switch (outcome) {
    case "retracted":
      if (typeof marker !== "string" || !MARKER_SET.has(marker)) {
        throw new Error(
          `retract_ledger_refresh_marker reported a retraction of a marker outside LEDGER_REFRESH_JOB_SOURCES (${String(marker)})`,
        );
      }
      return { retracted: true, marker };
    case "done":
    case "no_marker":
      return { retracted: false };
    case "no_row":
      throw new Error(
        "compute_jobs row not readable for the job enqueue_compute_job just returned; an inherited marker may still be in place",
      );
    default:
      throw new Error(
        `retract_ledger_refresh_marker answered with an unknown outcome (${String(outcome)}); an inherited marker may still be in place`,
      );
  }
}

/**
 * The SQLSTATE a `retractInheritedRefreshMarker` failure carries in its
 * `cause` (the PostgREST error), for the caller's log line: the thrown
 * message is generic by design, and the code is what tells a revoked
 * privilege from a lost row (164.6 review fix, LOW-2). `"none"` when the
 * failure carries no code, e.g. the two no-row outcomes above.
 */
export function retractionFailureCode(err: unknown): string {
  const cause: unknown = err instanceof Error ? err.cause : undefined;
  const code =
    typeof cause === "object" && cause !== null ? (cause as { code?: unknown }).code : undefined;
  return typeof code === "string" && code.length > 0 ? code : "none";
}
