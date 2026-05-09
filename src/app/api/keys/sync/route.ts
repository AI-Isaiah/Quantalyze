import { NextRequest, NextResponse, after } from "next/server";
import { fetchTrades, computeAnalytics } from "@/lib/analytics-client";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withAuth } from "@/lib/api/withAuth";
import { userActionLimiter, checkLimit } from "@/lib/ratelimit";
import { logAuditEvent } from "@/lib/audit";
import { getCorrelationId } from "@/lib/correlation-id";
import { isUnifiedBackboneActive } from "@/lib/feature-flags";
import { postProcessKey } from "@/lib/process-key-client";
import type { User } from "@supabase/supabase-js";

/**
 * POST /api/keys/sync — kicks off trade sync + analytics computation.
 *
 * Phase 19 / BACKBONE-10: when `isUnifiedBackboneActive()` is true, the
 * route delegates to `${ANALYTICS_SERVICE_URL}/process-key` with
 * `flow_type=resync`. Otherwise the existing legacy code path runs (queue
 * via USE_COMPUTE_JOBS_QUEUE or the `after()` fire-and-forget).
 *
 * Two legacy execution paths controlled by USE_COMPUTE_JOBS_QUEUE:
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
 * Response shape is identical on both legacy paths: 202 {accepted, strategy_id, status}.
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

  // Phase 19 / BACKBONE-10 — gate behind unified-backbone flag.
  if (await isUnifiedBackboneActive()) {
    // API-8: resolve the actual exchange from strategies.api_key_id →
    // api_keys.exchange so we don't hardcode `source: 'okx'`. Falls back to
    // 'okx' when the strategy has no api_key (CSV-only resync, which the
    // unified router will short-circuit).
    let resolvedSource = "okx";
    const { data: stratKey } = await supabase
      .from("strategies")
      .select("api_key_id")
      .eq("id", strategy_id)
      .single();
    if (stratKey?.api_key_id) {
      const admin = createAdminClient();
      const { data: keyRow } = await admin
        .from("api_keys")
        .select("exchange")
        .eq("id", stratKey.api_key_id)
        .single();
      if (keyRow?.exchange) {
        resolvedSource = keyRow.exchange;
      }
    }
    return await unifiedKeysSyncHandler({
      strategy_id,
      userId: user.id,
      source: resolvedSource,
    });
  }

  return await legacyKeysSyncHandler({ supabase, strategy_id, userId: user.id });
});

/**
 * Phase 19 / BACKBONE-01 unified path. Delegates to /process-key with
 * `flow_type=resync`. Source defaults to "okx" — when the strategy has a
 * linked api_key the worker resolves the actual exchange from the
 * api_keys.exchange column server-side.
 */
async function unifiedKeysSyncHandler(args: {
  strategy_id: string;
  userId: string;
  source: string;
}): Promise<NextResponse> {
  const result = await postProcessKey({
    flow_type: "resync",
    source: args.source, // API-8: resolved from strategies.api_keys.exchange.
    context: {
      strategy_id: args.strategy_id,
      user_id: args.userId,
    },
    routeTag: "keys/sync",
    // CT-4 (army2) — forward tenant id for cross-tenant rate-limit isolation.
    userId: args.userId,
  });
  if (!result.ok) return result.response;

  // I-API1: translate unified `{queued, verification_id}` back to the legacy
  // 202 `{accepted, strategy_id, status:'syncing'}` shape so callers reading
  // `body.strategy_id` keep working. Preserve verification_id + queued as
  // additive fields.
  const upstream = (result.body ?? {}) as Record<string, unknown>;
  if (upstream && typeof upstream === "object" && "queued" in upstream) {
    return NextResponse.json(
      {
        accepted: true,
        strategy_id: args.strategy_id,
        status: "syncing",
        verification_id: upstream.verification_id ?? null,
        queued: upstream.queued ?? true,
      },
      { status: 202 },
    );
  }
  return NextResponse.json(upstream);
}

/**
 * Legacy path preserved verbatim from the pre-Phase-19 implementation.
 * Will be removed in a follow-up cleanup PR after the 7-day stability
 * window passes.
 */
// DEPRECATED: remove after 2026-05-15 (PR-D + 7d)
async function legacyKeysSyncHandler(args: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  strategy_id: string;
  userId: string;
}): Promise<NextResponse> {
  const { supabase, strategy_id } = args;

  // ── Queue path (USE_COMPUTE_JOBS_QUEUE=true) ──────────────────────
  if (process.env.USE_COMPUTE_JOBS_QUEUE === "true") {
    const admin = createAdminClient();
    // Phase 18 forensic patch (Day-2 Bug #1): thread the inbound
    // correlation_id into compute_jobs.metadata so the SC-1 fifth layer
    // is queryable end-to-end (Next.js → enqueue_compute_job RPC →
    // compute_jobs row → worker dispatch → strategy_analytics bridge).
    const correlation_id = await getCorrelationId();
    const { data: rpcData, error: rpcError } = await admin.rpc(
      "enqueue_compute_job",
      {
        p_strategy_id: strategy_id,
        p_kind: "sync_trades",
        p_metadata: { correlation_id },
      },
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

    logAuditEvent(supabase, {
      action: "sync.start",
      entity_type: "sync",
      entity_id: strategy_id,
      metadata: { path: "queue" },
    });

    return NextResponse.json(
      { accepted: true, strategy_id, status: "syncing" },
      { status: 202 },
    );
  }

  // ── Legacy path (flag OFF — default) ──────────────────────────────
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

  logAuditEvent(supabase, {
    action: "sync.start",
    entity_type: "sync",
    entity_id: strategy_id,
    metadata: { path: "legacy" },
  });

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
}
