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
 * An error or a non-array answer is `ok: false` with a message for the caller
 * to log. A THROW (a network-layer failure, a client with no `rpc` member)
 * propagates: every caller already wraps this read in its own try/catch and
 * logs and captures the thrown value as it stands. It never logs itself (the
 * caller owns the route tag). No client directive and no Next.js cache import (the owner-lane
 * cache-isolation guard scans this closure).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  COMPUTE_STATE_READ_LIMIT,
  COMPUTE_STATE_READ_LIMIT_MAX,
  isWindowFullWithoutFactsheetJob,
  type ComputeJobRow,
} from "./compute-state";
import { compositeHistoryOf, type CompositeHistory } from "./strategy-shape";

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
}

/**
 * 167.2-REVIEW-R2 CR-01 / SFH-R2 R2-H1 (round 2): the composite-HISTORY read
 * has its own widening rule. Its question is "is any `stitch_composite` row on
 * record?", not the chain-selection question `readOwnerComputeJobs` widens
 * for. That read re-asks at the cap only when the first window holds NO chain
 * row, so a mature strategy whose newest 100 rows include a chain row came
 * back non-exhaustive, `compositeHistoryOf` called it "unreadable", and the
 * edit page resolved an ordinary unlinked strategy to "unknown" on every
 * render (Add Key gone after "delete the failed key").
 *
 * The rule here: when the read at hand is not exhaustive and holds no stitch,
 * re-ask ONCE at `COMPUTE_STATE_READ_LIMIT_MAX`. Only a read that failed or
 * threw, or a window still full at the cap with no stitch, is "unreadable".
 *
 * `first` is an already-made `readOwnerComputeJobs` answer (the owner
 * factsheet has one); omit it and this makes the read itself. It never
 * throws: a throw is folded into "unreadable". `message` says why the answer
 * is not "none" (null when it is), for the caller to log and capture.
 */
export async function readOwnerCompositeHistory(
  client: SupabaseClient,
  strategyId: string,
  first?: ComputeJobsRead,
): Promise<{ history: CompositeHistory; message: string | null }> {
  let rows: readonly ComputeJobRow[];
  let readExhaustive: boolean;
  try {
    const read = first ?? (await readOwnerComputeJobs(client, strategyId));
    if (!read.ok) {
      return { history: "unreadable", message: `compute job history read failed: ${read.message}` };
    }
    rows = read.rows;
    readExhaustive = read.readExhaustive;
    if (
      !readExhaustive &&
      !rows.some((r) => r?.kind === "stitch_composite") &&
      rows.length < COMPUTE_STATE_READ_LIMIT_MAX
    ) {
      const wide = await rpcOnce(client, strategyId, COMPUTE_STATE_READ_LIMIT_MAX);
      if (!wide.ok) {
        return { history: "unreadable", message: `compute job history read failed: ${wide.message}` };
      }
      rows = wide.rows;
      readExhaustive = rows.length < COMPUTE_STATE_READ_LIMIT_MAX;
    }
  } catch (err) {
    return {
      history: "unreadable",
      message: `compute job history read threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const history = compositeHistoryOf({ ok: true, rows, readExhaustive });
  if (history === "seen") {
    return {
      history,
      message: "a stitch_composite job is on record for a strategy with no members and no linked key",
    };
  }
  if (history === "unreadable") {
    return {
      history,
      message: "the compute job history is full at the RPC cap with no stitch_composite job",
    };
  }
  return { history, message: null };
}
