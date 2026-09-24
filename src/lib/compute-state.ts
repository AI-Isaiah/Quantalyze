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
 * Stitch-PREFERRING (154-04): the stitch row is the only row that carries
 * member progress or a heartbeat, so whenever one exists it answers even if a
 * chain row ran afterwards (PIN-COMPOSITE-WINS in the route test).
 */
export function selectFactsheetJob(
  rows: readonly (ComputeJobRow | null | undefined)[],
): ComputeJobRow | null {
  const isNewer = (row: ComputeJobRow, current: ComputeJobRow | null) =>
    current === null ||
    Date.parse(row.created_at ?? "") > Date.parse(current.created_at ?? "");
  let latestStitch: ComputeJobRow | null = null;
  let latestChain: ComputeJobRow | null = null;
  for (const row of rows) {
    if (!row) continue;
    if (row.kind === STITCH_KIND) {
      if (isNewer(row, latestStitch)) latestStitch = row;
    } else if (isFactsheetChainKind(row.kind) && isNewer(row, latestChain)) {
      latestChain = row;
    }
  }
  return latestStitch ?? latestChain;
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
