import { NextRequest, NextResponse, after } from "next/server";
import { fetchTrades, computeAnalytics } from "@/lib/analytics-client";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withAuth } from "@/lib/api/withAuth";
import { userActionLimiter, keysSyncUserLimiter, checkLimit } from "@/lib/ratelimit";
import { logAuditEventAsUser } from "@/lib/audit";
import { getCorrelationId } from "@/lib/correlation-id";
import { isUnifiedBackboneActive } from "@/lib/feature-flags";
import { postProcessKey } from "@/lib/process-key-client";
import { NO_STORE_HEADERS } from "@/lib/api/headers";
import { isUuid } from "@/lib/utils";
import { isComputedAnalytics } from "@/lib/closed-sets";
import { captureToSentry } from "@/lib/sentry-capture";
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
 * Phase 89 / PREV-01 — composite-first kickoff. A member-bearing composite
 * (strategies.api_key_id === null AND a strategy_keys count > 0) enqueues the
 * SAME `stitch_composite` job finalize dispatches, HOISTED ahead of
 * isUnifiedBackboneActive() (prod runs unified='on', whose single-key arm
 * cannot honestly derive a NULL-api_key composite). This mirrors the Phase-88
 * finalize-wizard hoist and fails CLOSED on an unknowable membership count.
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
 *   (f) set_wizard_composite_members RPC (migration 20260712120000, RT-1) —
 *       when the composite draft's member set CHANGES, resets a COMPLETED row
 *       ('complete'/'complete_with_warnings' → 'pending') to invalidate the
 *       stale stitch so the wizard re-stitches. Scoped to completed/IDLE rows
 *       ONLY (never a 'computing' row the worker owns), so it does not race the
 *       worker's compute-time writes; an identical re-Continue leaves it
 *       untouched (WIZ-05 no-op invariant).
 * No other paths write strategy_analytics.computation_status for strategies.
 * ──────────────────────────────────────────────────────────────────────
 */
export const maxDuration = 300;

export const POST = withAuth(async (req: NextRequest, user: User) => {
  const body = await req.json();
  const { strategy_id } = body;

  if (!strategy_id || typeof strategy_id !== "string") {
    return NextResponse.json({ error: "Missing strategy_id" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  // F6 (code-review): reject a malformed strategy_id BEFORE it becomes the
  // limiter bucket key, so the per-(user, strategy) keyspace is bounded to real
  // UUIDs — an attacker can't mint unlimited throwaway buckets (each with a
  // fresh allowance + an ownership SELECT) from arbitrary strings. A
  // valid-but-unowned id still gets the uniform 404 below (P458, no existence leak).
  if (!isUuid(strategy_id)) {
    return NextResponse.json({ error: "Invalid strategy_id" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  // F6 (M-0327/H-0279): two-tier rate limit.
  //  (1) A per-user AGGREGATE ceiling caps total endpoint volume so an
  //      authenticated caller can't bypass the limit by varying strategy_id
  //      across unbounded UUIDs (red-team) — checked first so probing is capped
  //      before it can spend a per-strategy bucket or an ownership SELECT.
  //  (2) A per-(user, strategy) bucket gives each strategy its own throughput,
  //      so one allocator's concurrent resyncs don't starve each other and a
  //      foreign strategy_id (CSRF/probe on a victim's session) can only exhaust
  //      its own throwaway bucket, never the victim's owned-strategy buckets.
  // A per-user-ONLY bucket (the pre-F6 `keys-sync:${user.id}`) had the
  // starvation + cross-strategy-burn problem; a per-strategy-ONLY bucket
  // removed the per-user ceiling. Both together close both holes.
  const userRl = await checkLimit(keysSyncUserLimiter, `keys-sync-user:${user.id}`);
  if (!userRl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { ...NO_STORE_HEADERS, "Retry-After": String(userRl.retryAfter) } },
    );
  }
  const rl = await checkLimit(
    userActionLimiter,
    `keys-sync:${user.id}:${strategy_id}`,
  );
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { ...NO_STORE_HEADERS, "Retry-After": String(rl.retryAfter) } },
    );
  }

  // Verify ownership via the user-scoped client so we get a clean
  // 403 before ever reaching the Railway pipeline.
  const supabase = await createClient();
  const { data: strategy } = await supabase
    .from("strategies")
    // 89-02: api_key_id joins the ownership select so the composite-first
    // branch below can gate on api_key_id === null with ZERO extra queries for
    // single-key (api_key_id-bearing) strategies.
    .select("id, user_id, api_key_id")
    .eq("id", strategy_id)
    .eq("user_id", user.id)
    .single();

  if (!strategy) {
    // P458 (audit-2026-05-07): uniform 404 for both "no such strategy" AND
    // "exists but unowned". Pre-fix this returned 403 in both cases, which
    // let an attacker probe strategy ID existence by distinguishing
    // 403-unowned from 404-not-found. Now there is no asymmetry: an
    // attacker probing a foreign strategy_id and an attacker probing a
    // random uuid both see the same response shape.
    return NextResponse.json(
      { error: "Strategy not found" },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }

  // ── Composite-first kickoff ────────────────────────────────────────────
  // Phase 89 / PREV-01. The preview step (wizard index 2) POSTs /api/keys/sync
  // BEFORE finalize; a member-bearing composite must kick off the SAME
  // production `stitch_composite` job finalize enqueues — NOT sync_trades /
  // the unified single-key resync — so the stitched strategy_analytics row the
  // preview reads actually exists. Placed AHEAD of isUnifiedBackboneActive()
  // because prod runs process_key_unified_backbone='on' and the unified arm
  // cannot honestly derive a NULL-api_key composite (it would mis-route to a
  // single-key path). This MIRRORS the Phase-88 finalize-wizard hoist
  // (finalize-wizard/route.ts:517-621).
  //
  // Scoped to api_key_id === null: a composite has strategies.api_key_id NULL
  // (members live in strategy_keys); api_key_id SET is definitively single-key
  // (mutually exclusive by construction), so single-key strategies pay ZERO
  // extra queries. The probe reads a COUNT only — never key material (all key
  // handling is worker-only, LOCKED).
  if (strategy.api_key_id === null) {
    const admin = createAdminClient();
    let memberCount: number;
    try {
      // compositeMemberCount fails CLOSED (stamps a terminal 'failed' row, then
      // throws) on an unknowable count — never falls open to a single-key
      // sync_trades dispatch of a POSSIBLE composite (W-4 / T-88-10).
      memberCount = await compositeMemberCount(admin, strategy_id);
    } catch (err) {
      console.error(
        `[keys/sync] composite membership probe failed for ${strategy_id}:`,
        err,
      );
      return NextResponse.json(
        { error: "Could not start sync. Try again in a moment." },
        { status: 503, headers: NO_STORE_HEADERS },
      );
    }

    if (memberCount > 0) {
      // stitch_composite is a compute_jobs kind — without the queue there is NO
      // worker to derive it. Fail LOUD (terminal 'failed' stamp + 503) rather
      // than orphan a composite that never derives. Mirrors finalize :889-906.
      if (process.env.USE_COMPUTE_JOBS_QUEUE !== "true") {
        await stampCompositeFailedUnlessComplete(
          admin,
          strategy_id,
          {
            computation_status: "failed",
            computation_warned: false,
            computation_error:
              "Composite strategy requires the compute-jobs queue " +
              "(USE_COMPUTE_JOBS_QUEUE) to derive; enable it and retry.",
            data_quality_flags: { csv_source: true, composite: true },
          },
          "queue-off composite",
        );
        return NextResponse.json(
          { error: "Could not start sync. Try again in a moment." },
          { status: 503, headers: NO_STORE_HEADERS },
        );
      }

      // #597 / F-1 (UAT): a composite annualizes its headline on the venue blend
      // — every supported member venue is crypto, so √365 — but strategies.asset_class
      // carries the NOT NULL DEFAULT 'traditional' (√252) until finalize force-derives
      // it (finalize-wizard :492-499). The stitch runs HERE, at the PREVIEW kickoff,
      // BEFORE finalize — so without this the worker reads 'traditional', the
      // run_stitch_composite_job guard trips (`asset_class 252 != venue-blend 365`),
      // and every composite preview fails-loud. Force 'crypto' before the dispatch so
      // preview and finalize agree. Best-effort + logged (ownership was verified by the
      // select above; the worker guard remains the hard backstop) — mirrors finalize.
      //
      // ⚠️ HARDCODED 'crypto' is correct ONLY while every SUPPORTED_EXCHANGES venue is
      // crypto. When a traditional venue (e.g. MetaTrader5, √252) is added, this must
      // become a per-member-venue derive — `isCryptoExchange` over the members,
      // mirroring the worker's "365 if ANY leg crypto else 252" blend. The tripwire in
      // keys/sync route.test.ts reddens the instant the supported set changes so this
      // (and the finalize sibling) can't silently mis-annualize an MT5 composite.
      const { error: assetClassErr } = await admin
        .from("strategies")
        .update({ asset_class: "crypto" })
        .eq("id", strategy_id)
        // Belt-and-braces owner scope, mirroring the finalize sibling
        // (finalize-wizard :497-499). strategy_id is already proven owned by the
        // user-scoped ownership select above, but keeping the invariant local to
        // the admin (RLS-bypassing) statement is cheap defense-in-depth.
        .eq("user_id", user.id);
      if (assetClassErr) {
        console.warn(
          `[keys/sync] composite asset_class derive failed (non-blocking) for ${strategy_id}:`,
          assetClassErr,
        );
        // Parity with finalize (:504-507): a persistent write failure would
        // otherwise be invisible in Sentry and surface only as recurring
        // composite-preview fail-louds (the worker √365-vs-asset_class guard).
        captureToSentry(assetClassErr, {
          tags: { op: "keys-sync.composite_asset_class_derive" },
          level: "warning",
        });
      }

      // Thread the inbound correlation_id like the sync_trades arm (:253-259)
      // so the forensic chain stays queryable end-to-end.
      const correlation_id = await getCorrelationId();
      const { data: rpcData, error: rpcError } = await admin.rpc(
        "enqueue_compute_job",
        {
          p_strategy_id: strategy_id,
          p_kind: "stitch_composite",
          p_metadata: { source: "keys/sync", correlation_id },
        },
      );
      if (rpcError) {
        console.error(
          `[keys/sync] enqueue_compute_job (stitch_composite) RPC failed for ${strategy_id}:`,
          rpcError,
        );
        return NextResponse.json(
          { error: "Could not start sync. Try again in a moment." },
          { status: 503, headers: NO_STORE_HEADERS },
        );
      }
      console.log(
        `[keys/sync] enqueued stitch_composite job=${rpcData} for strategy=${strategy_id}`,
      );

      // Idempotent double-submit is handled by the compute_jobs partial unique
      // index (finalize comment :860-864); repeated preview mounts re-POST safely.
      logAuditEventAsUser(admin, user.id, {
        action: "sync.start",
        entity_type: "sync",
        entity_id: strategy_id,
        metadata: { path: "queue", kind: "stitch_composite" },
      });

      // PREV-01 / Finding-H: `composite: true` is the AUTHORITATIVE discriminator
      // the preview step threads into `isComposite` — derived from server truth
      // (this is the branch that took `stitch_composite`), NOT a fragile client
      // `strategy_keys` count re-read. An unknowable membership fails CLOSED
      // above (compositeMemberCount → 503, never a 2xx), so every 2xx carries a
      // definite boolean and the client never has to assume single-key.
      return NextResponse.json(
        { ok: true, accepted: true, strategy_id, status: "syncing", composite: true },
        { status: 202, headers: NO_STORE_HEADERS },
      );
    }
    // memberCount === 0 (CSV strategy, api_key_id null, no members) → fall
    // through to the existing unified/legacy split byte-unchanged.
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
 * Stamp a terminal 'failed' analytics row ONLY when doing so won't DESTROY a
 * prior successful derive (R2-1, red-team).
 *
 * keys/sync runs REPEATEDLY on MATURE rows — the wizard revisits it and
 * ApiKeyManager POSTs it on every resync — unlike finalize's mirror, which runs
 * ONCE on a fresh draft. A raw upsert of `computation_status:'failed'` +
 * `computation_warned:false` REPLACES `data_quality_flags` WHOLESALE, so a
 * single transient `strategy_keys` 5xx on a PUBLISHED, COMPLETE composite would
 * flip its live analytics row to `failed` AND drop
 * `per_key`/`gap_spans`/`gap_day_count`/`overlap_days`/`mtm_gated_reason` —
 * degrading the public factsheet until a full re-derive.
 *
 * Guard-on-complete: read the existing row first; if a completed derive already
 * exists, SKIP the destructive write (the transient error must not clobber it) —
 * the caller still returns 503, so the request fails closed. Only stamp when
 * there is genuinely no completed row (a real first-derive that can't proceed).
 * On an inconclusive read we also skip (preserve) rather than risk clobbering.
 * The stamp remains best-effort; a write error is logged, never swallowed.
 */
async function stampCompositeFailedUnlessComplete(
  admin: ReturnType<typeof createAdminClient>,
  strategyId: string,
  payload: Record<string, unknown>,
  logLabel: string,
): Promise<void> {
  const { data: existing, error: readErr } = await admin
    .from("strategy_analytics")
    .select("computation_status")
    .eq("strategy_id", strategyId)
    .maybeSingle();

  if (isComputedAnalytics(existing?.computation_status)) {
    console.warn(
      `[keys/sync] skipped terminal 'failed' stamp (${logLabel}) — ` +
        `preserving existing completed derive for ${strategyId}`,
    );
    return;
  }
  if (readErr) {
    // Inconclusive: we could not confirm the absence of a completed row, so we
    // do NOT risk clobbering one. The 503 the caller returns still fails the
    // request closed; the stamp is best-effort.
    console.error(
      `[keys/sync] could not read existing analytics before stamping 'failed' ` +
        `(${logLabel}) for ${strategyId}:`,
      readErr,
    );
    return;
  }

  const { error: stampErr } = await admin.from("strategy_analytics").upsert(
    { strategy_id: strategyId, ...payload },
    { onConflict: "strategy_id" },
  );
  if (stampErr) {
    // A swallowed failure hides the fail-loud signal (mirrors the enqueue-error
    // pattern in the POST handler above).
    console.error(
      `[keys/sync] failed to stamp terminal 'failed' (${logLabel}) for ${strategyId}:`,
      stampErr,
    );
  }
}

/**
 * Composite membership head-count probe.
 *
 * DUPLICATED (Rule 7, consciously) from finalize-wizard/route.ts
 * `compositeMemberCount` (:1027-1058). Extracting a shared helper would touch
 * the just-verified, frozen Phase-88 finalize surface for ZERO behavior change,
 * against this milestone's additive-only discipline — flagged for Phase-91
 * consolidation.
 *
 * Fails CLOSED (stamps a terminal 'failed' analytics row so the wizard poller
 * reaches a gate, then throws) when the count is unknowable — a query error, or
 * a null count with NO error (PostgREST can return count===null without
 * erroring; `(count ?? 0) > 0` would fall OPEN to a single-key path). Routing a
 * possible member-bearing composite through a single-key path would silently
 * produce a wrong/partial derivation, and the reconcile cron never re-drives a
 * composite.
 *
 * Reads ONLY a count — never key material (all key handling is worker-only, LOCKED).
 */
async function compositeMemberCount(
  admin: ReturnType<typeof createAdminClient>,
  strategyId: string,
): Promise<number> {
  const { count, error: countErr } = await admin
    .from("strategy_keys")
    .select("*", { count: "exact", head: true })
    .eq("strategy_id", strategyId);
  if (countErr || count === null) {
    const reason = countErr
      ? `strategy_keys count failed: ${countErr.message}`
      : "strategy_keys count returned null without an error";
    // Finding 10 (mirrored): membership is UNKNOWN here — do NOT assert
    // `composite: true`, which claims a fact we could not establish. An honest
    // `membership_unknown` reason avoids mislabeling a single-key strategy.
    await stampCompositeFailedUnlessComplete(
      admin,
      strategyId,
      {
        computation_status: "failed",
        computation_warned: false,
        computation_error:
          "Could not determine composite membership " +
          "(strategy_keys count unavailable). Please retry.",
        data_quality_flags: { csv_source: true, membership_unknown: true },
      },
      "membership_unknown",
    );
    throw new Error(reason);
  }
  return count;
}

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
  //
  // CT-5 (army2) — branch on queued: a real enqueue (`queued===true`)
  // returns 202 syncing; an idempotent WIZARD_DUPLICATE
  // (`queued===false && code==='WIZARD_DUPLICATE'`) returns 200 with the
  // upstream's preserved status (e.g. 'validated' or whatever the
  // pre-existing row holds), the idempotent flag, and the WIZARD_DUPLICATE
  // code so the wizardErrors copy can render even on a 200.
  const upstream = (result.body ?? {}) as Record<string, unknown>;
  if (upstream && typeof upstream === "object" && "queued" in upstream) {
    if (upstream.queued === false && upstream.code === "WIZARD_DUPLICATE") {
      return NextResponse.json(
        {
          // H-0309: uniform `ok: true` success discriminator (alongside the
          // legacy `accepted`) so all wizard endpoints share one shape.
          ok: true,
          accepted: true,
          strategy_id: args.strategy_id,
          status: typeof upstream.status === "string" ? upstream.status : "syncing",
          verification_id: upstream.verification_id ?? null,
          queued: false,
          code: "WIZARD_DUPLICATE",
          idempotent: true,
          // Unified is a single-key resync path — never a composite.
          composite: false,
        },
        { status: 200, headers: NO_STORE_HEADERS },
      );
    }
    return NextResponse.json(
      {
        ok: true,
        accepted: true,
        strategy_id: args.strategy_id,
        status: "syncing",
        verification_id: upstream.verification_id ?? null,
        queued: upstream.queued ?? true,
        // Unified is a single-key resync path — never a composite.
        composite: false,
      },
      { status: 202, headers: NO_STORE_HEADERS },
    );
  }
  // Drift fallback: a 2xx upstream whose body lacks `queued` is an unrecognized
  // shape (every well-formed resync carries it). Deliberately NOT stamped with
  // ok:true — the structured success branches above own the discriminator, and
  // marking an unrecognized shape ok:true would falsely signal success. The
  // correct hardening (fail-loud-on-drift like finalize-wizard's unified
  // handler) is the B9 no-passthrough-on-ipc rule's domain, not F5's.
  return NextResponse.json(upstream, { headers: NO_STORE_HEADERS });
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
  const { strategy_id } = args;

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
        { status: 503, headers: NO_STORE_HEADERS },
      );
    }

    console.log(
      `[keys/sync] enqueued sync_trades job=${rpcData} for strategy=${strategy_id}`,
    );

    logAuditEventAsUser(admin, args.userId, {
      action: "sync.start",
      entity_type: "sync",
      entity_id: strategy_id,
      metadata: { path: "queue" },
    });

    return NextResponse.json(
      // Single-key/CSV legacy queue path — `composite: false` so the preview
      // step's discriminator stays byte-neutral for non-composite strategies.
      { ok: true, accepted: true, strategy_id, status: "syncing", composite: false },
      { status: 202, headers: NO_STORE_HEADERS },
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
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  logAuditEventAsUser(admin, args.userId, {
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
              // SI-02 (LOW-MEDIUM, v1.9): clear the runner-owned warned marker
              // on the terminal 'failed' write, mirroring the Python fix
              // (analytics_runner / job_worker). Without it a prior-warned
              // strategy can be resurrected to `complete_with_warnings` by the
              // status bridge OVER a genuine failure. Defensive: this legacy
              // after() path is dormant in prod (unified backbone active +
              // USE_COMPUTE_JOBS_QUEUE unset), but the clear is cheap correctness.
              computation_warned: false,
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
    // Single-key/CSV legacy after() path — `composite: false` (see above).
    { ok: true, accepted: true, strategy_id, status: "syncing", composite: false },
    { status: 202, headers: NO_STORE_HEADERS },
  );
}
