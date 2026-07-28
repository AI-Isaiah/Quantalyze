import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withAuth } from "@/lib/api/withAuth";
import {
  userActionLimiter,
  keysSyncUserLimiter,
  checkLimit,
  rateLimitDenyJson,
} from "@/lib/ratelimit";
import { logAuditEventAsUser } from "@/lib/audit";
import { getCorrelationId } from "@/lib/correlation-id";
import { postProcessKey } from "@/lib/process-key-client";
import { NO_STORE_HEADERS } from "@/lib/api/headers";
import { isUuid } from "@/lib/utils";
import { isComputedAnalytics } from "@/lib/closed-sets";
import { captureToSentry } from "@/lib/sentry-capture";
import { scrubSeamError } from "@/lib/seam-redaction";
import type { User } from "@supabase/supabase-js";

/**
 * POST /api/keys/sync — kicks off trade sync + analytics computation.
 *
 * Phase 19 / BACKBONE-10: the route delegates to
 * `${ANALYTICS_SERVICE_URL}/process-key` with `flow_type=resync` via the
 * unified backbone. The legacy compute-jobs-queue / `after()`
 * fire-and-forget paths were retired in Stage B (106-07) — the unified
 * dispatch is now unconditional. The Python worker is the sole writer of
 * strategy_analytics.computation_status (via the `sync_strategy_analytics_status`
 * RPC, migration 038); this route never upserts computation_status directly.
 *
 * Response shape: 202 {ok, accepted, strategy_id, status:'syncing'}.
 *
 * Phase 89 / PREV-01 — composite-first kickoff. A member-bearing composite
 * (strategies.api_key_id === null AND a strategy_keys count > 0) enqueues the
 * SAME `stitch_composite` job finalize dispatches, HOISTED ahead of the unified
 * dispatch (the unified single-key arm cannot honestly derive a NULL-api_key
 * composite). This mirrors the Phase-88 finalize-wizard hoist and fails CLOSED
 * on an unknowable membership count.
 *
 * ─── Direct-writes audit (D.10) ───────────────────────────────────────
 * Post-2.9 R2 writers of strategy_analytics.computation_status:
 *   (a) Worker: sync_strategy_analytics_status RPC (migration 038) — the
 *       compute_jobs worker is the sole writer on the unified/queue path.
 *   (c) analytics_runner.py (Python /api/compute-analytics) — upserts
 *       'computing'/'complete'/'failed' during compute, invoked by the
 *       worker internally.
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

  // ── Phase 140.3-10 / SEAMUX-03 — a machine code on EVERY arm ──────────
  // Every non-2xx this route emits now carries a `code`, so a consumer
  // discriminates on a stable token instead of sniffing the prose. Prose is
  // 140.3-12's to reword; a client branching on it breaks the day it does.
  // The codes are chosen so each names the fact that is actually true of its
  // own arm — a missing id, a malformed id, our own throttle, an unknowable
  // composite membership, a failed enqueue, a Supabase transport fault and an
  // absent draft are seven different facts, and collapsing them onto one token
  // would leave the consumer exactly where it started.
  if (!strategy_id || typeof strategy_id !== "string") {
    return NextResponse.json(
      { error: "Missing strategy_id", code: "MISSING_STRATEGY_ID" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  // F6 (code-review): reject a malformed strategy_id BEFORE it becomes the
  // limiter bucket key, so the per-(user, strategy) keyspace is bounded to real
  // UUIDs — an attacker can't mint unlimited throwaway buckets (each with a
  // fresh allowance + an ownership SELECT) from arbitrary strings. A
  // valid-but-unowned id still gets the uniform 404 below (P458, no existence leak).
  if (!isUuid(strategy_id)) {
    return NextResponse.json(
      { error: "Invalid strategy_id", code: "INVALID_STRATEGY_ID" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
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
  //
  // ⚠️ 140.3-10 — THE TWO THROTTLE ARMS BELOW ARE TWO DISTINCT SITES emitting
  // the same sentence. A grep of the string finds them both, but a "fix the
  // arm" reading treats them as one and leaves the second codeless. They carry
  // the SAME code deliberately: to the caller both are the one fact "our own
  // limiter refused this request, here is how long to wait", and which BUCKET
  // ran out is our internal accounting, not something the caller can act on
  // differently. `RATE_LIMITED` is the app-global vocabulary's own name for
  // exactly that fact (see WizardErrorCode's note: OUR limiter, as opposed to
  // KEY_RATE_LIMIT which is an EXCHANGE throttle) — reusing it here keeps one
  // token for one fact across the seam instead of minting a route-local
  // synonym. Each site is pinned by its own case, driven through its own
  // bucket key with its own wait, so a code dropped from one does not hide
  // behind the other's assertion.
  //
  // ⚠️ 140.4-13 / SEAMRIM-05 — AND THE SAME "TWO DISTINCT SITES" WARNING NOW
  // APPLIES TO THE 503 SPLIT. Both arms deny through `rateLimitDenyJson`, and
  // both are pinned by their own case driven through their own bucket. A guard
  // that only asked "does this FILE mention the builder" would stay green with
  // the second arm reverted to an inlined 429 — which is exactly the mutation
  // this plan's ledger row M105 runs.
  //
  // The 429 body and headers below are UNCHANGED: `{error, code:"RATE_LIMITED"}`
  // in that key order, with NO_STORE_HEADERS + Retry-After. The `code` is a live
  // contract — `SyncPreviewStep`'s KNOWN_KICKOFF_CODES maps `RATE_LIMITED` — so
  // flattening it onto the builder's default body would have been a regression,
  // not a simplification.
  const userRl = await checkLimit(keysSyncUserLimiter, `keys-sync-user:${user.id}`);
  if (!userRl.success) {
    return rateLimitDenyJson(userRl, {
      headers: NO_STORE_HEADERS,
      throttledBody: { error: "Too many requests", code: "RATE_LIMITED" },
      misconfiguredBody: {
        error: "Rate limiter unavailable",
        code: "SEAM_MISCONFIGURED",
      },
    });
  }
  const rl = await checkLimit(
    userActionLimiter,
    `keys-sync:${user.id}:${strategy_id}`,
  );
  if (!rl.success) {
    return rateLimitDenyJson(rl, {
      headers: NO_STORE_HEADERS,
      throttledBody: { error: "Too many requests", code: "RATE_LIMITED" },
      misconfiguredBody: {
        error: "Rate limiter unavailable",
        code: "SEAM_MISCONFIGURED",
      },
    });
  }

  // Verify ownership via the user-scoped client so we get a clean
  // 403 before ever reaching the Railway pipeline.
  const supabase = await createClient();
  // ⚠️ 140.3-10 / TRAP-3 (LIVE, not hypothetical) — this read used to be
  // `.single()` destructured as `const { data: strategy } =`, DISCARDING
  // `error`. `.single()` answers `data: null` for three different facts: no
  // such row, a row this user does not own, AND a transport/query failure. The
  // old code folded all three into "Strategy not found" — so a Supabase blip
  // DURING OUR OWN OUTAGE told the user their draft was gone, and the state
  // that names is the one whose way forward is to throw the draft away. Naming
  // a vague error arm is what turns it into a specific lie.
  //
  // The split copies the in-tree template at
  // `strategies/finalize-wizard/route.ts:624-646` verbatim in shape:
  // `.maybeSingle()`, then the transport error first (a 500 ABOUT US, with the
  // caught value scrubbed through the shipped `scrubSeamError` — never a
  // hand-rolled scrub), then the genuinely-absent row.
  const { data: strategy, error: strategyErr } = await supabase
    .from("strategies")
    // 89-02: api_key_id joins the ownership select so the composite-first
    // branch below can gate on api_key_id === null with ZERO extra queries for
    // single-key (api_key_id-bearing) strategies.
    .select("id, user_id, api_key_id")
    .eq("id", strategy_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (strategyErr) {
    console.error(
      `[keys/sync] strategy lookup failed for ${strategy_id}:`,
      scrubSeamError(strategyErr),
    );
    return NextResponse.json(
      { error: "Could not load draft", code: "DRAFT_LOOKUP_FAILED" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }

  if (!strategy) {
    // P458 (audit-2026-05-07): uniform 404 for both "no such strategy" AND
    // "exists but unowned". Pre-fix this returned 403 in both cases, which
    // let an attacker probe strategy ID existence by distinguishing
    // 403-unowned from 404-not-found. Now there is no asymmetry: an
    // attacker probing a foreign strategy_id and an attacker probing a
    // random uuid both see the same response shape.
    //
    // ⚠️ 140.3-10 — THE SPLIT ABOVE MUST NOT WEAKEN THIS. Both facts still
    // reach THIS line and produce a byte-identical body, status and header
    // set; the only thing pulled out is the transport failure, which is a
    // statement about US and was never a statement about the strategy. Adding
    // any response difference between not-found and not-owned here re-opens
    // the enumeration hole. Pinned by a dedicated byte-identity case.
    //
    // The code is `GATE_DRAFT_GONE`, the same token `finalize-wizard` already
    // emits for the same fact — one fact, one token across both routes.
    return NextResponse.json(
      { error: "Strategy not found", code: "GATE_DRAFT_GONE" },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }

  // ── Composite-first kickoff ────────────────────────────────────────────
  // Phase 89 / PREV-01. The preview step (wizard index 2) POSTs /api/keys/sync
  // BEFORE finalize; a member-bearing composite must kick off the SAME
  // production `stitch_composite` job finalize enqueues — NOT sync_trades /
  // the unified single-key resync — so the stitched strategy_analytics row the
  // preview reads actually exists. Placed AHEAD of the unified single-key arm
  // because the backbone is permanent-on (Phase 106) and the unified arm
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
        scrubSeamError(err),
      );
      // 140.3-10 — `COMPOSITE_MEMBERSHIP_UNKNOWN` is the EXISTING wizard code
      // for precisely this fail-closed: finalize-wizard already emits it from
      // its mirror of this probe. This route was the straggler emitting the
      // same 503 codeless, so the identical fact carried a token on one route
      // and nothing on the other.
      return NextResponse.json(
        {
          error: "Could not start sync. Try again in a moment.",
          code: "COMPOSITE_MEMBERSHIP_UNKNOWN",
        },
        { status: 503, headers: NO_STORE_HEADERS },
      );
    }

    if (memberCount > 0) {
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
          scrubSeamError(assetClassErr),
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
          scrubSeamError(rpcError),
        );
        // 140.3-10 — a DISTINCT fact from the membership fail-closed above:
        // membership was known, the enqueue itself failed. Same sentence, same
        // status, different cause, so a different token.
        return NextResponse.json(
          {
            error: "Could not start sync. Try again in a moment.",
            code: "SYNC_KICKOFF_FAILED",
          },
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

  // Phase 19 / BACKBONE-10 — unified backbone is now the unconditional path
  // (the legacy flag-off dispatch was retired in Stage B 106-07).
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
  // Phase 140.3-02 / TS-15 — forward the END USER's Supabase access token so the
  // unified router can build a USER-SCOPED (RLS-enforcing) client. Only the CSV
  // finalize flow forwarded it before, which is why PYAPI-01's second defence
  // layer had to be an explicit Python `strategies` id+user_id filter rather
  // than letting RLS do it. With the token forwarded, that filter becomes
  // belt-and-braces rather than the only belt.
  //
  // BEST-EFFORT ON PURPOSE, and the direction is deliberate. `csv-finalize`
  // fails CLOSED (401) on a missing session because its RPC is SECURITY DEFINER
  // and CANNOT run without `auth.uid()`. Here the token is an ENHANCEMENT: the
  // caller is already authenticated (withAuth ran `getUser` above) and ownership
  // is already proven by the user-scoped select above, so a session read that
  // hiccups must not fail a resync on the money-onboarding chokepoint. The
  // header is optional by construction — an absent token simply sends no header.
  //
  // ⚠️ This token is a LIVE user JWT and undici embeds outgoing headers in
  // `err.message`. It is passed to `postProcessKey` as a VALUE (never assembled
  // into a header here) so it reaches `scrubSeamError(message, [userAccessToken])`
  // at the client's transport log site. Do not hand-roll a second path.
  let userAccessToken: string | undefined;
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    userAccessToken = session?.access_token;
  } catch (sessionErr) {
    // SEAMRIM-06 — the WHOLE caught value goes through the leaf, not `.message`.
    // `err.message` is exactly where undici puts the outgoing headers, so a
    // hand-rolled `instanceof Error ? err.message : String(err)` is the banned
    // shape rather than a mitigation of it. `scrubSeamError` is total and
    // renders both arms (Error and non-Error), so the ternary buys nothing.
    // No per-request secret is passed: `userAccessToken` is the value this try
    // block was ASSIGNING, so it is necessarily still `undefined` here.
    console.warn(
      `[keys/sync] could not read the session to forward X-User-Access-Token (non-blocking) for ${strategy_id}:`,
      scrubSeamError(sessionErr),
    );
  }

  return await unifiedKeysSyncHandler({
    strategy_id,
    userId: user.id,
    source: resolvedSource,
    userAccessToken,
  });
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
      scrubSeamError(readErr),
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
      scrubSeamError(stampErr),
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
  /**
   * TS-15 — the end user's Supabase JWT, when a session was readable. OPTIONAL
   * by construction: the client emits `X-User-Access-Token` only when this is
   * present, so an absent value fabricates nothing.
   */
  userAccessToken?: string;
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
    // TS-15 — see the block at the call site for why this is best-effort here
    // and fail-CLOSED at csv-finalize.
    userAccessToken: args.userAccessToken,
  });
  if (!result.ok) return result.response;

  // I-API1: translate unified `{queued, verification_id}` back to the legacy
  // 202 `{accepted, strategy_id, status:'syncing'}` shape so callers reading
  // `body.strategy_id` keep working. Preserve verification_id + queued as
  // additive fields.
  //
  // CT-5 (army2) — a real enqueue returns 202 syncing; a duplicate returns 200
  // with the upstream's preserved status (e.g. 'validated' or whatever the
  // pre-existing row holds), the idempotent flag, and the WIZARD_DUPLICATE code
  // so the wizardErrors copy can render even on a 200.
  //
  // ⚠️ Phase 140.3-02 / TS-02 — THE DUPLICATE BRANCH KEYS ON THE CODE ALONE.
  // It used to read `queued === false && code === "WIZARD_DUPLICATE"`, and that
  // conjunct was provably wrong in BOTH directions. `queued` and `code` are
  // ORTHOGONAL facts on this reply:
  //   · `queued` / `job_state` is a JOB fact — a compute job is now enqueued or
  //     running for this verification.
  //   · `code: "WIZARD_DUPLICATE"` + `idempotent: true` is a SUBMISSION fact —
  //     this submission was a duplicate; no new verification was created.
  // Neither implies the other, and `process_key.py:_resume_duplicate_job` exists
  // precisely to produce the state where BOTH are true: the RESUMED WEDGE — a
  // duplicate submission whose wedged job we re-enqueued. Both duplicate
  // emitters share ONE builder (`_wizard_duplicate_reply`) which takes `queued`
  // as a PARAMETER, so `queued: true` beside the code is the normal reply.
  // The old conjunct therefore SKIPPED the duplicate branch on exactly the case
  // that most needs it, and reported a recognised duplicate as a fresh sync.
  // `SubmitStep.tsx` already branches on `data.code === "WIZARD_DUPLICATE"`
  // alone on the finalize side; this route was the straggler. (The same false
  // mutual exclusion was deleted from the onboard predicate by TS-01/TS-03 —
  // see `src/lib/process-key-onboard-contract.ts`. Do not re-introduce it here.)
  const upstream = (result.body ?? {}) as Record<string, unknown>;
  if (upstream && typeof upstream === "object" && "queued" in upstream) {
    if (upstream.code === "WIZARD_DUPLICATE") {
      return NextResponse.json(
        {
          // H-0309: uniform `ok: true` success discriminator (alongside the
          // legacy `accepted`) so all wizard endpoints share one shape.
          ok: true,
          accepted: true,
          strategy_id: args.strategy_id,
          status: typeof upstream.status === "string" ? upstream.status : "syncing",
          verification_id: upstream.verification_id ?? null,
          // TS-02 — FORWARD the job fact rather than asserting it. This was
          // hardcoded `false`, which on a resumed wedge states the opposite of
          // what the backbone just did: a job IS enqueued. Re-pointing the
          // branch without this would have moved the lie instead of removing it.
          queued: upstream.queued === true,
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
