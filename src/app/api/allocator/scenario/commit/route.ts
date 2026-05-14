/**
 * Phase 10 / Plan 07 / SCENARIO-07. POST /api/allocator/scenario/commit
 *
 * Commits a batch of scenario diffs (voluntary_remove / voluntary_add /
 * voluntary_modify / bridge_recommended) through the Bridge outcome graph.
 *
 * H4 — single Postgres transaction. The entire batch is delegated to the
 * SECURITY DEFINER RPC `commit_scenario_batch` shipped by Plan 02 migration
 * 082. Supabase JS does NOT expose multi-statement transactions to a route
 * handler — every `supabase.from().insert()` commits independently — so the
 * RPC IS the single-tx implementation. Without it, CONTEXT D-09's "single
 * Postgres transaction" invariant cannot be honoured. Any per-row failure
 * inside the RPC RAISE EXCEPTIONs the entire batch, so the route either
 * returns full-success or full-failure (NO partial state).
 *
 * M6 — rejection_reason is z.enum(REJECTION_REASONS) (the same 5-value enum
 * the bridge_outcomes column constraint enforces) and is REQUIRED for
 * voluntary_remove (NOT .nullish()), since bridge_outcomes' kind='rejected'
 * CHECK requires a non-null rejection_reason after migration 081.
 *
 * M7 — reuse-or-create logic for bridge_recommended diffs lives INSIDE the
 * RPC body (see migration 082). The route does NOT duplicate it client-side
 * — the RPC is the single source of truth. The RPC SELECTs match_decisions
 * for the existing (allocator_id, original_holding_ref, strategy_id,
 * kind='bridge_recommended') tuple FIRST; if a row exists → REUSE its id
 * (skip the INSERT); else INSERT new. This eliminates duplicate-tuple unique-
 * index violations against migration 074's widened unique index.
 *
 * Audit emission: per-row, ONLY in full-success batches (rolled-back tx
 * results in NO audit rows for the failed batch — matches the on-disk
 * outcome).
 *
 * T-10-01 mitigation: the body's `allocator_id` (if any) is silently dropped
 * by zod's strip default. The RPC always receives `p_allocator_id = user.id`
 * sourced from withAuth; the RPC additionally re-asserts auth.uid() matches
 * (defence-in-depth). The RPC is invoked via the USER-SCOPED supabase client
 * (not the service-role admin client) so auth.uid() resolves to the caller's
 * user.id — service-role would set auth.uid() to NULL and the migration 082
 * guard `IF v_caller IS NULL OR v_caller <> p_allocator_id THEN RAISE` would
 * fail closed, breaking every commit. SECURITY DEFINER inside the RPC still
 * bypasses RLS for the body, so per-row ownership probes are the gate.
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withAuth } from "@/lib/api/withAuth";
import { userActionLimiter, checkLimit } from "@/lib/ratelimit";
import { logAuditEvent } from "@/lib/audit";
import { stampOutcomeMarker } from "@/lib/analytics/onboarding-funnel";

export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Discriminated union schema (M6 — rejection_reason enum)
// ---------------------------------------------------------------------------

const HOLDING_REF_RE = /^holding:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:(spot|derivative)$/;

// M6 — rejection_reason MUST match the bridge_outcomes column constraint:
// (mandate_conflict / already_owned / timing_wrong / underperforming_peers /
// other). REQUIRED for voluntary_remove (kind='rejected' on bridge_outcomes
// per migration 081 CHECK), NOT .nullish().
const REJECTION_REASONS = [
  "mandate_conflict",
  "already_owned",
  "timing_wrong",
  "underperforming_peers",
  "other",
] as const;

const VoluntaryRemoveDiff = z.object({
  kind: z.literal("voluntary_remove"),
  holding_ref: z.string().regex(HOLDING_REF_RE),
  size_at_decision_usd: z.number().nonnegative(),
  effective_date: z.string().date().optional(),
  note: z.string().max(2000).nullish(),
  rejection_reason: z.enum(REJECTION_REASONS),
});

const VoluntaryAddDiff = z.object({
  kind: z.literal("voluntary_add"),
  strategy_id: z.string().uuid(),
  percent_allocated: z.number().min(0).max(100),
  size_at_decision_usd: z.number().nonnegative(),
  effective_date: z.string().date().optional(),
  note: z.string().max(2000).nullish(),
});

// P1956 (audit-2026-05-07 round 2): single canonical percent encoding.
// Migration 128 removed the SQL-side `COALESCE(percent_allocated, new_weight*100)`
// fallback, so the RPC reads ONLY `percent_allocated`. This zod schema accepts
// either `new_weight` (legacy, 0..1 fraction) OR `percent_allocated` (0..100)
// — the POST handler below validates at-least-one is set and normalises both
// shapes into `percent_allocated` before the RPC call. Discriminated-union
// constraints (each member must be a ZodObject) prevent putting the
// at-least-one check via `.refine()`, so we do it imperatively post-parse.
// Once Block C/D's drawer + adapter retarget lands and stops emitting
// `new_weight`, this dual-shape can collapse to `percent_allocated` required.
const VoluntaryModifyDiff = z.object({
  kind: z.literal("voluntary_modify"),
  holding_ref: z.string().regex(HOLDING_REF_RE),
  new_weight: z.number().min(0).max(1).optional(),
  percent_allocated: z.number().min(0).max(100).optional(),
  size_at_decision_usd: z.number().nonnegative(),
  effective_date: z.string().date().optional(),
  note: z.string().max(2000).nullish(),
});

const BridgeRecommendedDiff = z.object({
  kind: z.literal("bridge_recommended"),
  holding_ref: z.string().regex(HOLDING_REF_RE),
  strategy_id: z.string().uuid(),
  percent_allocated: z.number().min(0).max(100),
  size_at_decision_usd: z.number().nonnegative(),
  effective_date: z.string().date().optional(),
  note: z.string().max(2000).nullish(),
});

export const CommitDiffSchema = z.discriminatedUnion("kind", [
  VoluntaryRemoveDiff,
  VoluntaryAddDiff,
  VoluntaryModifyDiff,
  BridgeRecommendedDiff,
]);

// DoS cap — max 50 diffs per request.
export const CommitBodySchema = z.object({
  diffs: z.array(CommitDiffSchema).min(1).max(50),
});

// ---------------------------------------------------------------------------
// Recorded-row envelope returned by the RPC
// ---------------------------------------------------------------------------

interface RpcRecordedRow {
  index: number;
  match_decision_id: string;
  bridge_outcome_id: string;
  kind: string;
}

interface RpcEnvelope {
  ok: boolean;
  recorded?: RpcRecordedRow[];
  errors?: Array<{ index: number; error: string }>;
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export const POST = withAuth(async (req: NextRequest, user: User): Promise<NextResponse> => {
  const rl = await checkLimit(userActionLimiter, `scenario_commit:${user.id}`);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const json = await req.json().catch(() => null);
  const parsed = CommitBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // P1956 (audit-2026-05-07 round 2): single canonical percent encoding.
  // Migration 128 dropped the SQL-side `new_weight * 100` fallback — the RPC
  // now reads ONLY `percent_allocated`. The VoluntaryModifyDiff schema accepts
  // either shape; here we normalise into `percent_allocated`, returning 400
  // if a voluntary_modify diff has neither (the schema allows this state so
  // we have to enforce at-least-one imperatively — discriminated unions
  // require each member to be a ZodObject, no `.refine()`).
  const normalisedDiffs: typeof parsed.data.diffs = [];
  for (let i = 0; i < parsed.data.diffs.length; i++) {
    const d = parsed.data.diffs[i];
    if (d.kind === "voluntary_modify") {
      const hasPct = d.percent_allocated !== undefined;
      const hasWeight = d.new_weight !== undefined;
      if (!hasPct && !hasWeight) {
        return NextResponse.json(
          {
            error: "Invalid request body",
            issues: [
              {
                code: "custom",
                path: ["diffs", i, "percent_allocated"],
                message:
                  "voluntary_modify requires either new_weight or percent_allocated",
              },
            ],
          },
          { status: 400 },
        );
      }
      // percent_allocated wins when both are present (legacy clients sending
      // both should be deterministic on the canonical field).
      const pct = hasPct ? d.percent_allocated! : (d.new_weight as number) * 100;
      const { new_weight: _drop, ...rest } = d;
      normalisedDiffs.push({ ...rest, percent_allocated: pct });
    } else {
      normalisedDiffs.push(d);
    }
  }

  const supabase = await createClient();

  // H4 — single Postgres transaction via SECURITY DEFINER RPC. Invoked through
  // the user-scoped supabase client so auth.uid() resolves to user.id and the
  // RPC's `IF v_caller IS NULL OR v_caller <> p_allocator_id THEN RAISE` guard
  // passes. The RPC runs per-row ownership/strategy gates inside one
  // BEGIN..COMMIT scope, performs M7 reuse-or-create for bridge_recommended,
  // and RAISE EXCEPTIONs on any failure (rolling back the entire batch). NO
  // partial state — full-success or full-failure.
  const { data: rpcData, error: rpcErr } = await supabase.rpc(
    "commit_scenario_batch",
    { p_allocator_id: user.id, p_diffs: normalisedDiffs },
  );

  if (rpcErr) {
    console.error("scenario_commit RPC error", {
      user: user.id,
      message: rpcErr.message,
      code: rpcErr.code,
    });
    return NextResponse.json(
      { error: "Commit failed", message: rpcErr.message },
      { status: 500 },
    );
  }

  const rpcResult = rpcData as RpcEnvelope | null;
  if (!rpcResult || rpcResult.ok !== true) {
    // FULL FAILURE — single-tx rolled back. Return per-row errors so the
    // drawer can surface them inline. NO audit events emitted (the batch
    // was rolled back, so emitting audit would mis-represent on-disk state).
    console.error("scenario_commit full failure", {
      user: user.id,
      diff_count: parsed.data.diffs.length,
      errors: rpcResult?.errors ?? [{ index: -1, error: "Unknown commit failure" }],
    });
    return NextResponse.json(
      {
        recorded: 0,
        results: [],
        errors:
          rpcResult?.errors ?? [{ index: -1, error: "Unknown commit failure" }],
      },
      { status: 200 },
    );
  }

  // FULL SUCCESS — emit one audit event per inserted match_decision.
  const recorded = rpcResult.recorded ?? [];
  for (const row of recorded) {
    logAuditEvent(supabase, {
      action: "match.decision_record",
      entity_type: "match_decision",
      entity_id: row.match_decision_id,
      metadata: {
        kind: row.kind,
        source: "scenario_commit",
        bridge_outcome_id: row.bridge_outcome_id,
      },
    });
  }

  // Phase 11 / Plan 03 / D-13 / ONBOARD-05 — stamp first_outcome_at marker.
  // The /allocations Server Component reader emits the PostHog
  // `first_outcome_recorded` event on the next dashboard request. Idempotent
  // (helper reads metadata first, no-ops once stamp is set). Non-blocking:
  // a stamp failure does NOT affect the route response or the committed
  // batch.
  try {
    const admin = createAdminClient();
    await stampOutcomeMarker(admin, user.id);
  } catch (err) {
    // Phase 11 review fix IN-05: log err.stack ?? err.message so a
    // future ts/lint regression (e.g. an undefined.method typo inside
    // stampOutcomeMarker) surfaces in the warn output rather than
    // being swallowed by the broad catch + message-only render.
    console.warn(
      "[scenario-commit] first_outcome_at stamp failed:",
      err instanceof Error ? (err.stack ?? err.message) : err,
    );
  }

  return NextResponse.json(
    { recorded: recorded.length, results: recorded, errors: [] },
    { status: 200 },
  );
});
