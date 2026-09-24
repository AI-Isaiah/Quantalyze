/**
 * Phase 167.2 / KCS-07, KCS-20 — the ONE job-selection rule for a strategy's
 * factsheet compute, shared by `/api/strategies/[id]/sync-progress` and every
 * surface that states a strategy's compute state.
 *
 * Lifted from the `GET` handler of the sync-progress route (the `isNewer`
 * reducer, the stitch preference, the member projection and the stitch-only
 * stall rule), so the rule is written once instead of re-implemented per
 * surface. One deliberate change rides the lift (KCS-20): the non-stitch
 * fallback is no longer "latest job of ANY kind" but "latest job whose kind is
 * in FACTSHEET_CHAIN_KINDS". Recurring cron kinds (`reconcile_strategy`,
 * `sync_funding`) and per-request kinds (`compute_intro_snapshot`,
 * `poll_positions`) can be a strategy's newest row and say nothing about its
 * factsheet; letting one of them answer made a failed chain read `done`.
 *
 * DEPENDENCY-FREE BY DESIGN, like `./sync-progress` (the only import): safe to
 * pull into a server page, a route and a client bundle. It carries no client
 * directive (server pages call it; the RSC boundary would turn these into client
 * references), and imports no Next.js cache or server module (the owner-lane
 * cache-isolation guard scans for cache reach). No function here reads the
 * clock: callers pass `nowMs` from the server.
 */

import {
  coerceMemberProgressStatus,
  STALL_THRESHOLD_MS,
  type MemberProgressEntry,
} from "./sync-progress";

/**
 * The factsheet-chain job kinds a strategy's non-stitch fallback may select,
 * from the closed `compute_jobs_kind_check` set (167.2-RESEARCH § Q3).
 * `stitch_composite` is selected separately and preferred, so it is not here.
 *   - process_key_long → derive_broker_dailies / sync_trades (the fetch head)
 *   - sync_trades → derive_broker_dailies
 *   - derive_broker_dailies → compute_analytics_from_csv
 *   - compute_analytics_from_csv (chain terminal: compiles the factsheet)
 *   - compute_analytics (legacy; historical rows only)
 */
export const FACTSHEET_CHAIN_KINDS = [
  "process_key_long",
  "sync_trades",
  "derive_broker_dailies",
  "compute_analytics_from_csv",
  "compute_analytics",
] as const;

/**
 * Rows asked of `get_user_compute_jobs` (its own default). A chain-filtered
 * fallback over a small window can be hidden behind a run of daily cron rows
 * (RESEARCH P11), so the window is the RPC default rather than the 20 the route
 * used to ask for. A read that fills the window is NOT exhaustive: absence of a
 * chain row inside it proves nothing.
 */
export const COMPUTE_STATE_READ_LIMIT = 100;

/**
 * 167.2-REVIEW-SFH M-5: the most rows `get_user_compute_jobs` will return
 * (`LIMIT GREATEST(1, LEAST(p_limit, 1000))` in its latest definition,
 * migration 20260826140000). A caller whose first window is full with no
 * factsheet-chain row in it re-asks ONCE at this size (see
 * `readOwnerComputeJobs`), because a strategy whose newest 100 rows are
 * recurring kinds would otherwise derive `unreadable` on every render, and a
 * reload could never help.
 */
export const COMPUTE_STATE_READ_LIMIT_MAX = 1000;

/** Minimal shape read off a `get_user_compute_jobs` row. */
export interface ComputeJobRow {
  kind?: string;
  status?: string;
  error_kind?: string | null;
  claimed_at?: string | null;
  created_at?: string;
  metadata?: {
    member_progress?: unknown;
    member_progress_at?: string | null;
  } | null;
}

const STITCH_KIND = "stitch_composite";

function isFactsheetChainKind(kind: string | undefined): boolean {
  return (FACTSHEET_CHAIN_KINDS as readonly string[]).includes(kind as string);
}

/**
 * The factsheet job for a strategy: the LATEST `stitch_composite` by
 * `created_at`, else the latest row whose kind is in FACTSHEET_CHAIN_KINDS,
 * else null. The RPC already orders `created_at` DESC, but the reduce is
 * explicit so the rule does not silently depend on RPC ordering.
 *
 * IN-FLIGHT FIRST among chain rows (2026-09-24): when any chain row is still
 * in flight (`isFactsheetJobInFlight`), the latest IN-FLIGHT chain row
 * answers, even if a finished chain row was created after it. Two chains can
 * overlap (a duplicate resync used to start a second one), and the newest row
 * can be the first chain's finished compute while the second chain's
 * `process_key_long` is still running. Reporting that `done` told the wizard
 * and KCS-18's success gate the chain had settled while the SQL status bridge
 * still held the strategy at `computing`. A stitch row is not affected: the
 * in-flight unique index allows one non-terminal row per kind, so the newest
 * stitch is already the in-flight one whenever one exists.
 *
 * Stitch-PREFERRING (154-04): the stitch row is the only row that carries
 * member progress or a heartbeat, so whenever one exists it answers even if a
 * chain row ran afterwards (PIN-COMPOSITE-WINS in the route test).
 *
 * 167.2-REVIEW IN-03: `preferStitch: false` is for a strategy that has NO
 * `strategy_keys` members now. A strategy converted from a composite to a
 * single key before KCS-23 keeps its old stitch rows for their 30/90-day
 * retention, and stitch preference made that stale stitch answer for the
 * single-key chain running now (and read its `done` as "settled" in KCS-18's
 * success gate). With it false, the stitch answers only when it is at least as
 * new as the newest chain row. The default (true) is the rule above, unchanged,
 * and is what a caller passes when the member count is above zero OR could not
 * be read: a composite whose members' chain rows run after its stitch must keep
 * its stitch projection.
 */
export function selectFactsheetJob(
  rows: readonly (ComputeJobRow | null | undefined)[],
  opts: { preferStitch?: boolean } = {},
): ComputeJobRow | null {
  const isNewer = (row: ComputeJobRow, current: ComputeJobRow | null) =>
    current === null ||
    Date.parse(row.created_at ?? "") > Date.parse(current.created_at ?? "");
  let latestStitch: ComputeJobRow | null = null;
  let latestChain: ComputeJobRow | null = null;
  let latestInFlightChain: ComputeJobRow | null = null;
  for (const row of rows) {
    if (!row) continue;
    if (row.kind === STITCH_KIND) {
      if (isNewer(row, latestStitch)) latestStitch = row;
    } else if (isFactsheetChainKind(row.kind)) {
      if (isNewer(row, latestChain)) latestChain = row;
      if (isFactsheetJobInFlight(row.status) && isNewer(row, latestInFlightChain)) {
        latestInFlightChain = row;
      }
    }
  }
  const chain = latestInFlightChain ?? latestChain;
  if (opts.preferStitch === false && latestStitch !== null && chain !== null) {
    // An in-flight chain row outranks a finished stitch whatever their ages:
    // the stale stitch this option exists for must not read as settled over
    // a chain that is still running.
    if (latestInFlightChain !== null && !isFactsheetJobInFlight(latestStitch.status)) {
      return latestInFlightChain;
    }
    return isNewer(chain, latestStitch) ? chain : latestStitch;
  }
  return latestStitch ?? chain;
}

/**
 * Field-by-field member projection of a stitch row — NEVER a spread of the
 * worker's entry, and touching ONLY `member_progress` (never last_error /
 * user_message / source / correlation_id / ciphertext). [] for a non-stitch
 * row: only the stitch worker writes member progress.
 */
export function memberProgressOf(row: ComputeJobRow): MemberProgressEntry[] {
  const rawEntries =
    row.kind === STITCH_KIND && Array.isArray(row.metadata?.member_progress)
      ? (row.metadata!.member_progress as unknown[])
      : [];
  return rawEntries.map((e) => {
    const entry = (e ?? {}) as Record<string, unknown>;
    return {
      seq: Number(entry.seq),
      // Security L1 — harden exchange/label symmetrically with seq/status: a
      // non-string value (object, number) in these positions projects to
      // null rather than passing through verbatim. Only the trusted worker
      // writes member_progress, so this is defense-in-depth, but the
      // projection must be UNIFORMLY defensive (never a bare ?? coalesce
      // that lets a truthy non-string through).
      exchange: typeof entry.exchange === "string" ? entry.exchange : null,
      label: typeof entry.label === "string" ? entry.label : null,
      status: coerceMemberProgressStatus(entry.status),
    };
  });
}

/**
 * PROG-03 stall (server clock only): heartbeat = member_progress_at ??
 * claimed_at; stalled only when running AND the heartbeat is older than
 * STALL_THRESHOLD_MS at `nowMs`. Date.parse of a missing/garbage value → NaN,
 * and `NaN > threshold` is false, so an unparseable heartbeat never cries
 * stall. RT-1: nothing here reads the analytics table.
 *
 * ⛔ STALL IS STITCH-ONLY, AND MUST STAY THAT WAY (154-04). The heartbeat
 * is written by the stitch worker at member boundaries; no other job kind
 * refreshes anything. For a non-stitch job the fallback would be
 * `claimed_at`, which is stamped ONCE at claim time and never moves — so a
 * long, perfectly healthy single-key crawl would cross the 12-minute
 * threshold and be reported stalled purely for taking a while.
 * That false positive is not cosmetic: the client's stall affordance
 * invites a retry, i.e. it would push users to abort healthy work. A
 * non-stitch job therefore reports not-stalled ALWAYS — there is no evidence
 * about it either way, and "no evidence" is not "stalled".
 */
export function isStitchStalled(row: ComputeJobRow, nowMs: number): boolean {
  const isStitch = row.kind === STITCH_KIND;
  const heartbeat = isStitch
    ? (row.metadata?.member_progress_at ?? row.claimed_at ?? null)
    : null;
  return (
    isStitch &&
    row.status === "running" &&
    heartbeat != null &&
    nowMs - Date.parse(heartbeat) > STALL_THRESHOLD_MS
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// KCS-07 / KCS-08 / KCS-19 / KCS-20 — the ONE derivation of a strategy's
// compute state. Every surface that states it (the owner factsheet, the share
// page, the /strategies list, the owner share note) calls `deriveComputeState`
// and, for a recipient, `recipientArm`, so the surfaces cannot disagree.
//
// ⛔ No new job state is invented (ROADMAP fence). Each output maps one-to-one
// to a `compute_jobs.status` value or to the absence of a row, except
// `stalled` (the rule sync-progress already ships) and `unreadable` (the read
// could not answer, which is not a job state and never an in-progress claim).
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The `compute_jobs.status` domain (table-wide CHECK). A selected row whose
 * status is outside it derives `unreadable`, never a guess.
 */
const COMPUTE_JOB_STATUSES = [
  "pending",
  "running",
  "done",
  "done_pending_children",
  "failed_retry",
  "failed_final",
] as const;
type ComputeJobStatus = (typeof COMPUTE_JOB_STATUSES)[number];

/**
 * 167.2-REVIEW-SFH M-4: is `raw` one of the six `compute_jobs.status` values?
 * Exported so the sync-progress route answers DEGRADED for a status outside the
 * domain, exactly as `deriveComputeState` answers `unreadable` for it.
 */
export function isComputeJobStatus(raw: unknown): raw is ComputeJobStatus {
  return (COMPUTE_JOB_STATUSES as readonly unknown[]).includes(raw);
}

/**
 * 167.2-REVIEW-SFH M-5: did this read fill its window with no factsheet-chain
 * row in it? `deriveComputeState` calls that `unreadable`, the same word it
 * uses for a failed read, so a caller asks this to log (and capture) the
 * window case separately: it is deterministic, and a reload cannot fix it.
 */
export function isWindowFullWithoutFactsheetJob(
  rows: readonly (ComputeJobRow | null | undefined)[],
  readExhaustive: boolean,
): boolean {
  return !readExhaustive && selectFactsheetJob(rows) === null;
}

/**
 * The statuses of a job that will still do work (KCS-18's success gate).
 * `done_pending_children` is here (KCS-19): a child waiting on its parents,
 * flipped to `pending` when the last one finishes, and counted non-terminal by
 * the SQL status bridge and the in-flight unique index.
 */
const IN_FLIGHT_JOB_STATUSES = [
  "pending",
  "running",
  "failed_retry",
  "done_pending_children",
] as const satisfies readonly ComputeJobStatus[];

/** The `compute_jobs.error_kind` domain; anything else, null included, is null. */
const JOB_ERROR_KINDS = ["permanent", "transient", "unknown", "orphaned"] as const;
type JobErrorKind = (typeof JOB_ERROR_KINDS)[number];

/** KCS-08: kinds whose running phase reads trades from the exchange. */
const FETCH_JOB_KINDS = [
  "process_key_long",
  "sync_trades",
  "derive_broker_dailies",
] as const;

/**
 * KCS-08: kinds whose running phase computes analytics. `stitch_composite`
 * is a compute kind; `deriveComputeState` refines a running stitch to the fetch
 * phase ("key N of M") while one of its members has not yet succeeded.
 */
const COMPUTE_JOB_KINDS = [
  "compute_analytics_from_csv",
  "compute_analytics",
  STITCH_KIND,
] as const;

export type ComputeJobPhase = "fetch" | "compute" | "unknown";

/** The one derived compute state (UI-SPEC § C "One mapping, three consumers"). */
export type ComputeState =
  | { state: "queued" }
  | { state: "retrying" }
  | {
      state: "running";
      phase: ComputeJobPhase;
      memberOf?: { n: number; m: number };
    }
  | { state: "stalled" }
  | { state: "failed"; errorKind: JobErrorKind | null }
  | { state: "finished" }
  | { state: "never_started" }
  | { state: "unreadable" };

/**
 * What a share-link recipient is told (UI-SPEC § C): the data is being
 * prepared, it is not available, or (owner surfaces only) the state could not
 * be read. The share page folds `unreadable` into `not_available`.
 */
export type RecipientArm = "in_progress" | "not_available" | "unreadable";

function isOneOf<T extends string>(
  domain: readonly T[],
  raw: unknown,
): raw is T {
  return (domain as readonly unknown[]).includes(raw);
}

function coerceJobErrorKind(raw: unknown): JobErrorKind | null {
  return isOneOf(JOB_ERROR_KINDS, raw) ? raw : null;
}

/**
 * True while the job will still do work: `pending`, `running`, `failed_retry`
 * or `done_pending_children` (KCS-18, KCS-19). `done`, `failed_final`, null and
 * any unrecognised string are false.
 */
export function isFactsheetJobInFlight(
  status: string | null | undefined,
): boolean {
  return isOneOf(IN_FLIGHT_JOB_STATUSES, status);
}

/**
 * KCS-08: the running phase by job kind, from the closed
 * `compute_jobs_kind_check` set. An unrecognised kind is `unknown` (a neutral
 * "working on it" line downstream), never a guess.
 */
export function jobPhaseOf(kind: string | null | undefined): ComputeJobPhase {
  if (isOneOf(FETCH_JOB_KINDS, kind)) return "fetch";
  if (isOneOf(COMPUTE_JOB_KINDS, kind)) return "compute";
  return "unknown";
}

function runningStateOf(row: ComputeJobRow): ComputeState {
  if (row.kind !== STITCH_KIND) {
    return { state: "running", phase: jobPhaseOf(row.kind) };
  }
  // A composite: the stitch fans out over its members (fetch), then stitches
  // (compute). m = member count; n = successful + 1, never above m (UI-SPEC
  // KCS-09). No member progress written yet reads as fetch with no N of M.
  const members = memberProgressOf(row);
  const m = members.length;
  if (m === 0) return { state: "running", phase: "fetch" };
  const successful = members.filter((e) => e.status === "successful").length;
  if (successful >= m) return { state: "running", phase: "compute" };
  return {
    state: "running",
    phase: "fetch",
    memberOf: { n: Math.min(successful + 1, m), m },
  };
}

/**
 * Derive a strategy's compute state from its `get_user_compute_jobs` rows (or
 * an equivalent bounded read).
 *
 * - `readError: true` → unreadable (a failed read is never "none" and never
 *   "computing").
 * - No factsheet-chain job selected → never_started ONLY when the read was
 *   exhaustive (`rows.length < COMPUTE_STATE_READ_LIMIT`); a full window with
 *   no chain job proves nothing and is unreadable (RESEARCH P10 / P11).
 * - pending, done_pending_children → queued (KCS-19); failed_retry → retrying;
 *   done → finished; failed_final → failed with its error_kind coerced through
 *   the closed domain; running → stalled (stitch only, heartbeat older than
 *   STALL_THRESHOLD_MS at `nowMs`) or running with its phase.
 * - A selected status outside the six-value domain → unreadable.
 *
 * `nowMs` is the caller's SERVER clock; nothing here reads the clock.
 */
export function deriveComputeState(
  input:
    | {
        rows: readonly (ComputeJobRow | null | undefined)[];
        readExhaustive: boolean;
        nowMs: number;
        /** 167.2-REVIEW IN-03: see `selectFactsheetJob`. Default true. */
        preferStitch?: boolean;
      }
    | { readError: true },
): ComputeState {
  if ("readError" in input) return { state: "unreadable" };
  const row = selectFactsheetJob(input.rows, { preferStitch: input.preferStitch });
  if (row === null) {
    return input.readExhaustive
      ? { state: "never_started" }
      : { state: "unreadable" };
  }
  const status = row.status;
  if (!isOneOf(COMPUTE_JOB_STATUSES, status)) return { state: "unreadable" };
  switch (status) {
    case "pending":
    case "done_pending_children":
      return { state: "queued" };
    case "failed_retry":
      return { state: "retrying" };
    case "done":
      return { state: "finished" };
    case "failed_final":
      return { state: "failed", errorKind: coerceJobErrorKind(row.error_kind) };
    case "running":
      return isStitchStalled(row, input.nowMs)
        ? { state: "stalled" }
        : runningStateOf(row);
  }
}

/**
 * The recipient arm for a derived state (UI-SPEC § C). queued, retrying and
 * running are in progress; stalled, failed, finished (no payload) and
 * never_started are not available; unreadable stays unreadable so an owner
 * surface can say something true in both arms.
 */
export function recipientArm(state: ComputeState): RecipientArm {
  switch (state.state) {
    case "queued":
    case "retrying":
    case "running":
      return "in_progress";
    case "stalled":
    case "failed":
    case "finished":
    case "never_started":
      return "not_available";
    case "unreadable":
      return "unreadable";
  }
}
