/**
 * Phase 167.2 review-fix (167.2-REVIEW-SFH M-4, M-5, L-3) — the ONE bounded,
 * owner-scoped read of a strategy's `compute_jobs` rows through the SECURITY
 * DEFINER RPC `get_user_compute_jobs`, shared by the sync-progress route, the
 * owner factsheet's pending lane and the `/strategies` share notes.
 *
 * WHAT IT ADDS OVER ONE RPC CALL. A first window of `COMPUTE_STATE_READ_LIMIT`
 * rows that is FULL and holds no factsheet-chain row proves nothing (RESEARCH
 * P10 / P11): a strategy whose newest 100 rows are recurring kinds
 * (`reconcile_strategy`, `sync_funding`) would derive `unreadable` on every
 * render, deterministically, and "reload" could never help. So that one case
 * re-asks ONCE at the RPC's own cap (`COMPUTE_STATE_READ_LIMIT_MAX`). Every
 * other read is a single call, exactly as before.
 *
 * ⚠️ PRECONDITION (167.2-REVIEW-SFH L-3). The RPC answers `[]` with NO error
 * when `auth.uid()` is null (`IF v_auth_uid IS NULL THEN RETURN;`), the same
 * bytes as "this strategy has no jobs". Call this only after the request's
 * session resolved a user (`auth.getUser()`), as every caller does today;
 * otherwise an empty answer here is not evidence of "never started".
 *
 * Never throws: an error, a non-array answer or a throw is `ok: false` with a
 * message for the caller to log. It never logs itself (the caller owns the
 * route tag). No client directive and no Next.js cache import (the owner-lane
 * cache-isolation guard scans this closure).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  COMPUTE_STATE_READ_LIMIT,
  COMPUTE_STATE_READ_LIMIT_MAX,
  isWindowFullWithoutFactsheetJob,
  type ComputeJobRow,
} from "./compute-state";

export type ComputeJobsRead =
  | {
      ok: true;
      rows: ComputeJobRow[];
      /** Fewer rows than were asked for, so absence inside it is real. */
      readExhaustive: boolean;
      /** Still full at the cap with no factsheet-chain row: unreadable, and deterministic. */
      windowFull: boolean;
    }
  | { ok: false; code?: string; message: string };

async function rpcOnce(
  client: SupabaseClient,
  strategyId: string,
  limit: number,
): Promise<{ ok: true; rows: ComputeJobRow[] } | { ok: false; code?: string; message: string }> {
  const { data, error } = await client.rpc("get_user_compute_jobs", {
    p_strategy_id: strategyId,
    p_limit: limit,
  });
  if (error) return { ok: false, code: error.code, message: error.message };
  if (!Array.isArray(data)) {
    return {
      ok: false,
      message: "compute job read returned no rows array and no error",
    };
  }
  return { ok: true, rows: data as ComputeJobRow[] };
}

/**
 * Read a strategy's compute jobs (see the module header). The client is the
 * caller's RLS-scoped request client, typed loosely because the generated
 * types' RPC signature is not needed here; the RPC resolves `auth.uid()`
 * server-side.
 */
export async function readOwnerComputeJobs(
  client: SupabaseClient,
  strategyId: string,
): Promise<ComputeJobsRead> {
  try {
    const first = await rpcOnce(client, strategyId, COMPUTE_STATE_READ_LIMIT);
    if (!first.ok) return first;
    let rows = first.rows;
    let readExhaustive = rows.length < COMPUTE_STATE_READ_LIMIT;
    if (isWindowFullWithoutFactsheetJob(rows, readExhaustive)) {
      const wide = await rpcOnce(client, strategyId, COMPUTE_STATE_READ_LIMIT_MAX);
      if (!wide.ok) return wide;
      rows = wide.rows;
      readExhaustive = rows.length < COMPUTE_STATE_READ_LIMIT_MAX;
    }
    return {
      ok: true,
      rows,
      readExhaustive,
      windowFull: isWindowFullWithoutFactsheetJob(rows, readExhaustive),
    };
  } catch (err) {
    return {
      ok: false,
      message: `compute job read threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
