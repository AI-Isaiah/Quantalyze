import { NextRequest, NextResponse, after } from "next/server";
import { fetchTrades, computeAnalytics } from "@/lib/analytics-client";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withAuth } from "@/lib/api/withAuth";
import { userActionLimiter, checkLimit } from "@/lib/ratelimit";
import type { User } from "@supabase/supabase-js";

/**
 * POST /api/keys/sync — kicks off trade sync + analytics computation.
 *
 * Two execution paths controlled by the USE_COMPUTE_JOBS_QUEUE feature flag:
 *
 *   Flag ON  → enqueue a `sync_trades` job into the compute_jobs queue via
 *              the `enqueue_compute_job` RPC (migration 032). The Python
 *              worker is the sole writer of strategy_analytics.computation_status
 *              on this path (via the `sync_strategy_analytics_status` RPC,
 *              migration 038). No direct upsert from this route.
 *
 *   Flag OFF → legacy `after()` fire-and-forget path. This route upserts
 *              computation_status='computing' directly, then runs fetchTrades
 *              + computeAnalytics in the background. This is the only
 *              non-worker writer of computation_status in the codebase.
 *
 * Response shape is identical on both paths: 202 {accepted, strategy_id, status}.
 *
 * ─── Direct-writes audit (D.10) ───────────────────────────────────────
 * Post-2.9 R2 writers of strategy_analytics.computation_status:
 *   (a) Worker: sync_strategy_analytics_status RPC (migration 038) — sole
 *       writer when USE_COMPUTE_JOBS_QUEUE=true.
 *   (b) Legacy after() path below (flag OFF only) — upserts 'computing' on
 *       entry and 'failed' on error. Will be removed when flag is retired.
 *   (c) analytics_runner.py (Python /api/compute-analytics) — upserts
 *       'computing'/'complete'/'failed' during direct compute calls. Called
 *       by the worker internally; also reachable via the legacy after() path.
 *   (d) portfolio.py (Python /api/portfolio-analytics) — writes
 *       computation_status for portfolio_analytics rows only, not strategy.
 *   (e) Initial strategy creation: migration 001 DEFAULT 'pending' on INSERT.
 * No other paths write strategy_analytics.computation_status for strategies.
 * ──────────────────────────────────────────────────────────────────────
 */
export const maxDuration = 300;

export const POST = withAuth(async (req: NextRequest, user: User) => {
  const rl = await checkLimit(userActionLimiter, `keys-sync:${user.id}`);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const body = await req.json();
  const { strategy_id } = body;

  if (!strategy_id || typeof strategy_id !== "string") {
    return NextResponse.json({ error: "Missing strategy_id" }, { status: 400 });
  }

  // Verify ownership via the user-scoped client so we get a clean
  // 403 before ever reaching the Railway pipeline.
  const supabase = await createClient();
  const { data: strategy } = await supabase
    .from("strategies")
    .select("id, user_id")
    .eq("id", strategy_id)
    .eq("user_id", user.id)
    .single();

  if (!strategy) {
    return NextResponse.json(
      { error: "Strategy not found or not owned by you" },
      { status: 403 },
    );
  }

  // ── Queue path (USE_COMPUTE_JOBS_QUEUE=true) ──────────────────────
  if (process.env.USE_COMPUTE_JOBS_QUEUE === "true") {
    const admin = createAdminClient();
    const { data: rpcData, error: rpcError } = await admin.rpc(
      "enqueue_compute_job",
      { p_strategy_id: strategy_id, p_kind: "sync_trades" },
    );

    if (rpcError) {
      console.error(
        `[keys/sync] enqueue_compute_job RPC failed for ${strategy_id}:`,
        rpcError,
      );
      return NextResponse.json(
        { error: "Could not start sync. Try again in a moment." },
        { status: 503 },
      );
    }

    console.log(
      `[keys/sync] enqueued sync_trades job=${rpcData} for strategy=${strategy_id}`,
    );

    return NextResponse.json(
      { accepted: true, strategy_id, status: "syncing" },
      { status: 202 },
    );
  }

  // ── Legacy path (flag OFF — default) ──────────────────────────────
  // Mark the row as `computing` via the service-role client. The
  // CHECK constraint at migration 001:74 only allows the four
  // canonical states, so we reuse `computing` rather than adding a
  // distinct `syncing` value.
  const admin = createAdminClient();
  // @audit-skip: compute-job state tracking. `strategy_analytics.computation_status`
  // is an internal state machine for the Railway worker pipeline, not a
  // user-visible state change. The user-facing action is "start a key
  // sync" which dispatches via enqueue_compute_job (no direct mutation
  // on this path).
  const { error: upsertErr } = await admin
    .from("strategy_analytics")
    .upsert(
      {
        strategy_id,
        computation_status: "computing",
        computation_error: null,
      },
      { onConflict: "strategy_id" },
    );
  if (upsertErr) {
    console.error(
      `[keys/sync] strategy_analytics upsert failed for ${strategy_id}:`,
      upsertErr,
    );
    return NextResponse.json(
      { error: "Could not start sync. Try again in a moment." },
      { status: 503 },
    );
  }

  after(async () => {
    try {
      await fetchTrades(strategy_id);
      // Python compute-analytics writes the terminal status directly.
      const result = await computeAnalytics(strategy_id);
      console.log(
        `[keys/sync] compute complete for strategy=${strategy_id} status=${result.status}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sync failed";
      console.error(
        `[keys/sync] async sync failed for strategy=${strategy_id}:`,
        err,
      );
      try {
        // @audit-skip: compute-job state tracking, failure branch.
        // Internal state machine, not user-intent.
        await admin
          .from("strategy_analytics")
          .upsert(
            {
              strategy_id,
              computation_status: "failed",
              computation_error: message,
            },
            { onConflict: "strategy_id" },
          );
      } catch (updateErr) {
        console.error(
          `[keys/sync] failed to write failed-status row for strategy=${strategy_id}:`,
          updateErr,
        );
      }
    }
  });

  return NextResponse.json(
    { accepted: true, strategy_id, status: "syncing" },
    { status: 202 },
  );
});
