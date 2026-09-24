/**
 * Phase 95 / Plan 95-03 — PROG-02 + PROG-03 shared response contract.
 *
 * The wire contract for GET /api/strategies/[id]/sync-progress. Defined in
 * `@/lib` (NOT co-located with the route) so plan 95-04's wizard poller can
 * import the SAME types + STALL_THRESHOLD_MS the route serializes — one source
 * of truth for the projected shape, so a rename cannot drift the two surfaces.
 *
 * DEPENDENCY-FREE BY DESIGN: this module imports nothing. The wizard is a
 * client component, so the contract must be safe to pull into the browser
 * bundle without dragging a server-only transitive (supabase, next/server).
 *
 * SECRETLESS BY CONSTRUCTION (Option A — 95-VALIDATION decision 1): the ONLY
 * fields that cross the network are the ones named here. `compute_jobs.metadata`
 * (which may carry `source`, `correlation_id`, and — belt-and-suspenders — any
 * ciphertext a future writer mistakenly stows) never reaches the browser; the
 * route projects field-by-field into `SyncProgressResponse` and nothing else.
 */

/**
 * Per-member stitch status, mirrored from the worker's boundary writes
 * (plan 95-02, `metadata.member_progress[*].status`). An out-of-enum value from
 * a future/rogue worker is coerced to "waiting" on read (fail-safe rendering)
 * via `coerceMemberProgressStatus` — the client never sees an unknown token.
 */
export type MemberProgressStatus =
  | "waiting"
  | "in_process"
  | "successful"
  | "degraded";

/**
 * The canonical member-status set. Single source of truth for the coercion in
 * the route AND any client-side exhaustiveness check. A readonly tuple so it
 * doubles as the `MemberProgressStatus` domain.
 */
export const MEMBER_PROGRESS_STATUSES = [
  "waiting",
  "in_process",
  "successful",
  "degraded",
] as const;

/**
 * Coerce an untrusted worker-written status token to a known enum member.
 * Anything outside `MEMBER_PROGRESS_STATUSES` (e.g. a future worker emitting a
 * new state, or a corrupt row) collapses to "waiting" so the wizard renders a
 * safe placeholder rather than an unhandled string. Pure + dependency-free.
 */
export function coerceMemberProgressStatus(raw: unknown): MemberProgressStatus {
  return (MEMBER_PROGRESS_STATUSES as readonly string[]).includes(
    raw as string,
  )
    ? (raw as MemberProgressStatus)
    : "waiting";
}

/**
 * One projected member-progress row. EXACTLY these four fields — never a spread
 * of the worker's metadata entry, never `metadata`, never a DB column.
 */
export interface MemberProgressEntry {
  seq: number;
  exchange: string | null;
  label: string | null;
  status: MemberProgressStatus;
}

/**
 * The compute_jobs status domain (CHECK constraint, migration 20260411144407).
 * `pending` and `running` are in-flight; `done` is terminal-success;
 * `done_pending_children` is ALSO in flight (167.2 KCS-19): it is a child job
 * waiting on its parents, flipped to `pending` when the last parent finishes,
 * and the SQL status bridge and the in-flight unique index both count it
 * non-terminal; `failed_retry` is the queue retrying (progress, NOT a
 * stall); `failed_final` is terminal-failure.
 *
 * The CHECK is table-wide, so this union is exact for EVERY job kind — which is
 * what lets 154-04 project the status of a single-key job (`process_key_long`,
 * `derive_broker_dailies`, `compute_analytics_from_csv`) through the same field
 * without widening the domain. The name is historical; it is not stitch-only.
 */
export type StitchJobStatus =
  | "pending"
  | "running"
  | "done"
  | "done_pending_children"
  | "failed_retry"
  | "failed_final";

/**
 * The complete GET /api/strategies/[id]/sync-progress response. TOP-LEVEL
 * WHITELIST — these three keys and nothing else. 95-04 consumes this verbatim.
 */
export interface SyncProgressResponse {
  /**
   * The latest `stitch_composite` job's status, else the latest
   * factsheet-chain job's (154-04 widened the fallback to any kind; 167.2 KCS-20
   * narrowed it to the chain kinds). null = no factsheet-chain job is visible
   * for this strategy; rows of other kinds (recurring cron jobs) may exist.
   */
  jobStatus: StitchJobStatus | null;
  /**
   * Server-computed from the STITCH JOB heartbeat only — never
   * `strategy_analytics`, and never a non-stitch job (nothing refreshes a
   * heartbeat for those, so a long healthy run would read as stalled).
   */
  stalled: boolean;
  /** [] until the worker's first member-progress write; [] for non-stitch jobs. */
  memberProgress: MemberProgressEntry[];
  /**
   * SF-3 — TRUE only on the `if (rpcError)` degrade branch (the owner-scoped
   * RPC read failed), so the client can distinguish "couldn't read" from a real
   * idle. Real reads OMIT this field (absent === not degraded). A degraded
   * payload is NOT evidence of "not stalled": the client keeps its last-known
   * `memberProgress`/`stalled` instead of overwriting them with the empty
   * degrade body until a real read arrives.
   */
  degraded?: boolean;
  /**
   * 167.2-REVIEW-R2 IN-04 / SFH-R2 R2-L1: present only on a DEGRADED body
   * whose cause is DETERMINISTIC, so a reload or a retry gives the same
   * answer: `window_full` (the job window is still full at the RPC cap with no
   * factsheet-chain row) or `bad_status` (the selected job's status is outside
   * the six-value domain). A closed, non-sensitive string. Absent on a
   * transient degrade (a failed or thrown read) and on every real read.
   */
  degradedReason?: DegradedReason;
}

/** 167.2-REVIEW-R2 IN-04: the deterministic degrade causes (see `degradedReason`). */
export type DegradedReason = "window_full" | "bad_status";

/**
 * Stall threshold: a `running` job whose heartbeat
 * (`metadata.member_progress_at ?? claimed_at`) is older than this is `stalled`.
 *
 * 12 MINUTES (720_000 ms) — NOT the 10 min the 95-03 plan originally penciled.
 *
 * The 95-02 worker (WARNING-2 resolution, 95-02-SUMMARY) heartbeats ONLY at
 * member boundaries — there is no cheap mid-member tick, because the per-member
 * crawl (`build_deribit_native_ledger` / the ccxt fetch layer) is a single
 * awaited call several layers below the loop. So a legitimately slow single
 * member (a large Deribit history is plausibly >10 min) leaves `member_progress_at`
 * stale on a HEALTHY run. 10 min would false-positive that crawl; 12 min gives it
 * headroom while still surfacing a genuine stall INSIDE the 15-min wizard patience
 * budget (LOCKED), so the user sees the stall banner before the give-up point.
 *
 * A false positive is low-harm by construction: the 95-04 retry CTA re-POSTs
 * /api/keys/sync, which the partial-unique index
 * `compute_jobs_one_inflight_per_kind_strategy` makes a no-op while the job is
 * genuinely inflight — i.e. `pending`/`running` (T-95-09: accept). NB (F-3): that
 * index EXCLUDES `failed_retry`, so a re-POST during a retry backoff would insert
 * a SECOND stitch rather than no-op; the client suppresses the manual Retry
 * whenever `jobStatus === "failed_retry"` (the job auto-retries) to close that gap.
 */
export const STALL_THRESHOLD_MS = 720_000; // 12 min
