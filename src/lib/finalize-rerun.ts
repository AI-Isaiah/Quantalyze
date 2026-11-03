/**
 * Phase 190 (FACTSHEETQUEUED) Defect 1 / SC-2 — should the wizard's finalize
 * step queue an analytics re-run?
 *
 * WHY THIS EXISTS. By the time a user reaches SubmitStep the wizard's
 * SyncPreviewStep has already run `/api/keys/sync`, so the full
 * `process_key_long -> sync_trades -> derive_broker_dailies ->
 * compute_analytics_from_csv` chain has usually finished. `enqueue_compute_job`
 * dedupes ONLY onto an in-flight job of the SAME kind, so once that chain is
 * done a fresh `sync_trades` row is not absorbed by anything: it re-runs the
 * whole chain and bounces a complete `strategy_analytics` row back to
 * computing. PROD measured 4 of 4 finalize-sourced jobs in the retention
 * window landing after the strategy's first computation (190-01-SUMMARY).
 *
 * THE RULE. Queue a re-run only when one is needed:
 *   - this finalize changed `strategies.asset_class` (the annualization clock);
 *     a hop that read the old clock would publish the wrong annualization, so
 *     this wins over everything else and needs no read;
 *   - a terminal success is also compared with the clock it was computed on:
 *     the `periods_per_year` the analytics service froze into the
 *     `cash_settlement` series echo must equal `annualizationPeriods` of the
 *     strategy's CURRENT asset class. `assetClassChanged` lives in one request
 *     (the asset_class write commits before later probes and the RPC, so a
 *     retry after a rejection sees "no change"); the stored echo does not. The
 *     row has production readers (the factsheet reads it through
 *     `readCashConventions`, and so does this decision), so it is not dark. An
 *     absent echo, or a failed read of it, cannot prove it and queues;
 *   - otherwise skip when the strategy's analytics are already a terminal
 *     success (`isComputedAnalytics`, never an exact match on one status) AND
 *     provably current for their inputs: `strategy_analytics.computed_at` is
 *     not older than the key link (`api_keys.created_at` of the linked key) or
 *     the newest composite member (`strategy_keys.created_at`). A key or member
 *     added after the last computation is an input the stored result never
 *     saw, so the run is queued; a missing or unparseable timestamp cannot
 *     prove currency and also queues. Only existing columns are read.
 *     A composite is also compared with the START of the run that produced its
 *     result: `computed_at` is stamped when the stitch WRITES, but the stitch
 *     reads its member set near its start, so a member change made while it ran
 *     is older than `computed_at` and still unseen by the result. The newest
 *     member must predate the latest `done` `stitch_composite` job's
 *     `created_at`; a job that cannot be read, or is absent, queues. (A
 *     single-key link needs no such bound: its chain is keyed by the key row,
 *     which exists before any job reads it, and a different key is a new chain.)
 *     KNOWN LIMIT: a re-link of a single-key strategy to an older key leaves no
 *     timestamp, so it is not detected and the stored result stands;
 *   - otherwise skip when a LIVE factsheet-chain job is already in flight (a
 *     job `computeJobDeadReason` calls dead is not evidence the run will
 *     finish, so it does not count);
 *   - otherwise queue.
 *
 * FAIL DIRECTION (Rule 12). A read that errors, throws, or answers `null`
 * without an error on the jobs read queues the run: a failed read is not
 * "already current", and the cost of a redundant run is far lower than the
 * cost of a strategy that never computes. `no analytics row` is NOT a failed
 * read, it is the ordinary "never computed" answer.
 *
 * KNOWN NON-EXHAUSTIVENESS. A `derive_broker_dailies` hop keyed by
 * `api_key_id` carries no `strategy_id` and is invisible to the jobs read
 * here. That errs toward queueing, which is today's behaviour.
 *
 * The decision is server-derived from database rows and takes no client hint,
 * so a request cannot ask finalize to skip a run. The function never throws.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  FACTSHEET_CHAIN_KINDS,
  IN_FLIGHT_JOB_STATUSES,
  computeJobDeadReason,
  isFactsheetJobInFlight,
  type ComputeJobRow,
} from "./compute-state";
import { annualizationPeriods, isComputedAnalytics } from "./closed-sets";
import { readCashConventions } from "./factsheet/composite-read-path";

export type FinalizeRerunDecision =
  | {
      enqueue: true;
      reason: "no_terminal_success" | "asset_class_changed" | "inputs_changed";
    }
  | {
      enqueue: true;
      reason: "read_failed";
      failedRead:
        | "strategy_analytics"
        | "compute_jobs"
        | "api_keys"
        | "strategy_keys"
        | "strategy_analytics_series";
      error: unknown;
    }
  | { enqueue: false; reason: "already_current" | "chain_in_flight" };

export async function decideFinalizeRerun(
  admin: SupabaseClient,
  strategyId: string,
  opts: {
    assetClassChanged: boolean;
    /** The strategy's asset class as it stands after this finalize's write. */
    assetClass: string | null;
    composite: boolean;
    /** The single-key arm's linked key; null for a composite. */
    apiKeyId: string | null;
    nowMs: number;
  },
): Promise<FinalizeRerunDecision> {
  if (opts.assetClassChanged) {
    return { enqueue: true, reason: "asset_class_changed" };
  }

  let status: string | null | undefined;
  let computedAt: string | null | undefined;
  try {
    const { data, error } = await admin
      .from("strategy_analytics")
      .select("computation_status, computed_at")
      .eq("strategy_id", strategyId)
      .maybeSingle();
    if (error) {
      return {
        enqueue: true,
        reason: "read_failed",
        failedRead: "strategy_analytics",
        error,
      };
    }
    const row = data as {
      computation_status?: string | null;
      computed_at?: string | null;
    } | null;
    status = row?.computation_status;
    computedAt = row?.computed_at;
  } catch (error) {
    return {
      enqueue: true,
      reason: "read_failed",
      failedRead: "strategy_analytics",
      error,
    };
  }
  if (isComputedAnalytics(status)) {
    // Terminal success is current only if no input is newer than the result.
    const failedRead = opts.composite ? "strategy_keys" : "api_keys";
    let inputAt: number | null = null; // newest input creation, ms
    try {
      if (opts.composite) {
        const { data, error } = await admin
          .from("strategy_keys")
          .select("created_at")
          .eq("strategy_id", strategyId);
        if (error) return { enqueue: true, reason: "read_failed", failedRead, error };
        const stamps = (Array.isArray(data) ? data : []).map((r) =>
          Date.parse((r as { created_at?: string }).created_at ?? ""),
        );
        if (stamps.length > 0 && stamps.every(Number.isFinite)) {
          inputAt = Math.max(...stamps);
        }
      } else if (opts.apiKeyId) {
        const { data, error } = await admin
          .from("api_keys")
          .select("created_at")
          .eq("id", opts.apiKeyId)
          .maybeSingle();
        if (error) return { enqueue: true, reason: "read_failed", failedRead, error };
        const stamp = Date.parse(
          (data as { created_at?: string } | null)?.created_at ?? "",
        );
        if (Number.isFinite(stamp)) inputAt = stamp;
      }
    } catch (error) {
      return { enqueue: true, reason: "read_failed", failedRead, error };
    }
    const computedMs = Date.parse(computedAt ?? "");
    if (inputAt === null || !Number.isFinite(computedMs) || inputAt > computedMs) {
      return { enqueue: true, reason: "inputs_changed" };
    }
    if (opts.composite) {
      // The stitch reads its members near its START, so the newest member must
      // predate the start of the run that produced the stored result.
      try {
        const { data, error } = await admin
          .from("compute_jobs")
          .select("created_at")
          .eq("strategy_id", strategyId)
          .eq("kind", "stitch_composite")
          .eq("status", "done")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) {
          return { enqueue: true, reason: "read_failed", failedRead: "compute_jobs", error };
        }
        const producedFrom = Date.parse((data as { created_at?: string } | null)?.created_at ?? "");
        if (!Number.isFinite(producedFrom) || inputAt >= producedFrom) {
          return { enqueue: true, reason: "inputs_changed" };
        }
      } catch (error) {
        return { enqueue: true, reason: "read_failed", failedRead: "compute_jobs", error };
      }
    }
    // The stored result must have been annualized on the strategy's CURRENT
    // clock. The echo is read through the factsheet's own reader.
    const cash = await readCashConventions(admin, strategyId);
    if (cash.failed) {
      return {
        enqueue: true,
        reason: "read_failed",
        failedRead: "strategy_analytics_series",
        error: cash.message,
      };
    }
    const stored = cash.conventions?.periods_per_year;
    if (typeof stored !== "number" || !Number.isFinite(stored)) {
      return { enqueue: true, reason: "inputs_changed" };
    }
    if (stored !== annualizationPeriods(opts.assetClass)) {
      return { enqueue: true, reason: "asset_class_changed" };
    }
    return { enqueue: false, reason: "already_current" };
  }

  const kinds: string[] = [...FACTSHEET_CHAIN_KINDS];
  if (opts.composite) kinds.push("stitch_composite");
  try {
    const { data, error } = await admin
      .from("compute_jobs")
      .select("kind, status, attempts, max_attempts, created_at")
      .eq("strategy_id", strategyId)
      .in("kind", kinds)
      .in("status", [...IN_FLIGHT_JOB_STATUSES]);
    if (error || !Array.isArray(data)) {
      return {
        enqueue: true,
        reason: "read_failed",
        failedRead: "compute_jobs",
        error: error ?? new Error("compute_jobs read returned no rows array"),
      };
    }
    const live = (data as ComputeJobRow[]).some(
      (row) =>
        isFactsheetJobInFlight(row.status) &&
        computeJobDeadReason(row, opts.nowMs) === null,
    );
    if (live) return { enqueue: false, reason: "chain_in_flight" };
  } catch (error) {
    return {
      enqueue: true,
      reason: "read_failed",
      failedRead: "compute_jobs",
      error,
    };
  }
  return { enqueue: true, reason: "no_terminal_success" };
}
