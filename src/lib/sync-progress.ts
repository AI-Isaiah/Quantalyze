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
 * The `stitch_composite` compute_jobs status domain (CHECK constraint,
 * migration 20260411144407). `pending` and `running` are in-flight; `done` /
 * `done_pending_children` are terminal-success; `failed_retry` is the queue
 * retrying (progress, NOT a stall); `failed_final` is terminal-failure.
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
  /** null = no `stitch_composite` job visible for this strategy (idle). */
  jobStatus: StitchJobStatus | null;
  /** Server-computed from the JOB heartbeat only — never `strategy_analytics`. */
  stalled: boolean;
  /** [] until the worker's first member-progress write. */
  memberProgress: MemberProgressEntry[];
}

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
 * genuinely inflight (T-95-09: accept).
 */
export const STALL_THRESHOLD_MS = 720_000; // 12 min
