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

import { createHash, randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withAllocatorAuth } from "@/lib/api/withAllocatorAuth";
import { userActionLimiter, checkLimit } from "@/lib/ratelimit";
import { logAuditEvent } from "@/lib/audit";
import { stampOutcomeMarker } from "@/lib/analytics/onboarding-funnel";

export const runtime = "nodejs";

// audit-2026-05-07 round-2 Block D / P1947 — every response from this route
// carries `private, no-store`. The payload includes allocator-scoped match
// decision IDs + per-row audit metadata; serving it from any shared cache
// would leak across tenants.
const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" } as const;

// audit-2026-05-07 round-2 Block D / P1945 — accepted Idempotency-Key length
// range. Matches the CHECK on scenario_commit_idempotency.idempotency_key
// (migration 130) so a request bearing a malformed key takes the
// "no-idempotency" path rather than hitting a 23514 check_violation at INSERT
// time. RFC draft-ietf-httpapi-idempotency-key recommends client-generated,
// opaque, hard-to-guess values — 16 chars is the floor for collision safety.
const IDEMPOTENCY_KEY_MIN = 16;
const IDEMPOTENCY_KEY_MAX = 128;
const IDEMPOTENCY_TABLE = "scenario_commit_idempotency";

// Round-2-D type-design review (conf 9): bump this when the success-body
// shape changes. Cached rows with a different schema_version are treated
// as a miss so an older route revision's payload is never served by a
// newer route. Stored on every cache row by migration 130.
const RESPONSE_SCHEMA_VERSION = 1;

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
//
// Round-2-D type-design review (conf 9): the previous flat shape
// `{ ok: boolean; recorded?; errors? }` admitted four states for two valid
// ones (`{ok:true,errors:[...]}` and `{ok:false,recorded:[...]}` are
// nonsense given the single-tx contract). The route then needed defensive
// `?? []` / `recorded ?? []` fallbacks throughout. A discriminated union on
// `ok` removes those fallbacks AND surfaces a real mismatch loudly via the
// runtime-validation parse below.
// ---------------------------------------------------------------------------

const CommitKindSchema = z.enum([
  "voluntary_remove",
  "voluntary_add",
  "voluntary_modify",
  "bridge_recommended",
]);

const RpcRecordedRowSchema = z.object({
  index: z.number().int(),
  match_decision_id: z.string(),
  bridge_outcome_id: z.string(),
  kind: CommitKindSchema,
});

type RpcRecordedRow = z.infer<typeof RpcRecordedRowSchema>;

const RpcEnvelopeSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    recorded: z.array(RpcRecordedRowSchema),
  }),
  z.object({
    ok: z.literal(false),
    errors: z.array(
      z.object({ index: z.number().int(), error: z.string() }),
    ),
  }),
]);

type RpcEnvelope = z.infer<typeof RpcEnvelopeSchema>;

// Success body that gets cached in scenario_commit_idempotency.response.
// Used to validate cached rows BEFORE returning them to a retry — a row
// written by an older route revision with a different shape is treated
// as a cache miss rather than served verbatim to the client.
const SuccessBodySchema = z.object({
  recorded: z.number().int().nonnegative(),
  results: z.array(RpcRecordedRowSchema),
  errors: z.array(z.never()).max(0),
});

type SuccessBody = z.infer<typeof SuccessBodySchema>;

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

/**
 * Lazy-import Sentry to capture idempotency-cache failures without pulling
 * Sentry into routes that don't need it. Mirrors the pattern in
 * `src/lib/admin.ts` / `src/lib/audit.ts`. The kind tag lets SRE filter
 * lookup-vs-write failures separately.
 */
function reportIdempotencyError(
  err: unknown,
  options: {
    kind: "lookup_error" | "write_error" | "envelope_invalid";
    userId: string;
    code: string | null;
    message: string;
  },
): void {
  try {
    void import("@sentry/nextjs")
      .then((Sentry) => {
        try {
          Sentry.captureException(err, {
            tags: {
              scenario_commit_idem: "true",
              scenario_commit_idem_kind: options.kind,
              scenario_commit_idem_code: options.code ?? "unknown",
            },
            extra: {
              user_id: options.userId,
              code: options.code,
              message: options.message,
            },
            level: "error",
          });
        } catch {
          // Swallow — caller already logged via console.error.
        }
      })
      .catch(() => {
        // Sentry import failed — swallow.
      });
  } catch {
    // import() construction failed — swallow.
  }
}

export const POST = withAllocatorAuth(async (req: NextRequest, user: User): Promise<NextResponse> => {
  const rl = await checkLimit(userActionLimiter, `scenario_commit:${user.id}`);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: { ...NO_STORE_HEADERS, "Retry-After": String(rl.retryAfter) },
      },
    );
  }

  // Read the raw body bytes once. The bytes drive (a) JSON parse + zod
  // validation and (b) the SHA-256 request_hash used to bind Idempotency-Key
  // cache rows to the exact body. Round-2-D code-reviewer (conf 8): the prior
  // implementation only matched on (allocator_id, idempotency_key) — a client
  // re-using the same key with a different body got the FIRST body's cached
  // response, masking the bug silently. RFC draft-ietf-httpapi-idempotency-key
  // §2.5 requires us to detect this and 422.
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch (err) {
    // Body read failure (network drop, abort, decompression). 400 keeps the
    // pre-audit shape while console.error surfaces the underlying class for
    // diagnostics — silent-failure-hunter #5 (conf 7).
    console.error("[scenario-commit] body read failed:", err);
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  let json: unknown;
  try {
    json = rawBody === "" ? null : JSON.parse(rawBody);
  } catch (err) {
    // Distinguish malformed JSON from other body failures in logs so SRE
    // can tell client bugs from infra. Still 400 + zod-shaped response.
    console.warn(
      "[scenario-commit] JSON parse failed:",
      err instanceof Error ? err.message : err,
    );
    json = null;
  }

  const parsed = CommitBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", issues: parsed.error.issues },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  // Bind cache rows to the body bytes. The hash is over the RAW request text
  // (what the client sent), not over a re-serialised parsed view — this
  // matches the RFC intent (clients control retry payloads) and avoids
  // canonical-JSON-ordering bugs.
  const requestHash = createHash("sha256").update(rawBody).digest("hex");

  // ---------------------------------------------------------------------------
  // P1945 — Idempotency-Key short-circuit.
  //
  // If the request bears a well-formed Idempotency-Key (length within the
  // 16..128 CHECK on migration 130's scenario_commit_idempotency table), look
  // up the cached response for (allocator_id, idempotency_key). On a hit we
  // compare the stored request_hash against this request's hash:
  //   - hash matches + schema_version matches + response validates → return
  //     the cached 200 (RPC is skipped entirely)
  //   - hash mismatches                                            → 422
  //     (RFC §2.5 — same key, different body is a client bug)
  //   - schema_version mismatches OR response fails validation     → treat
  //     as cache miss; re-run the RPC and overwrite the row
  //
  // Round-2-D silent-failure-hunter (conf 8): on cache lookup ERROR (Postgres
  // outage, RLS misconfig, etc.) the route FAIL-CLOSES with 503. The prior
  // implementation logged and fell through to the RPC, which negated the
  // whole P1945 contract: a flaky downstream is exactly when retries fire,
  // and falling through doubles writes precisely when the user needs dedup.
  //
  // The lookup uses the SERVICE-ROLE admin client because the dedup table's
  // RLS policy admits SELECT only for `auth.uid() = allocator_id`, and the
  // post-success upsert is also via the admin client — using the same client
  // for both keeps a single place to reason about RLS bypass.
  // ---------------------------------------------------------------------------
  const idempotencyKey = req.headers.get("Idempotency-Key");
  const idempotencyKeyValid =
    !!idempotencyKey &&
    idempotencyKey.length >= IDEMPOTENCY_KEY_MIN &&
    idempotencyKey.length <= IDEMPOTENCY_KEY_MAX;

  const admin = createAdminClient();

  if (idempotencyKeyValid) {
    const { data: cached, error: cacheErr } = await admin
      .from(IDEMPOTENCY_TABLE)
      .select("request_hash, response, schema_version")
      .eq("allocator_id", user.id)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (cacheErr) {
      // Fail-closed. The client retries, the underlying cache outage gets
      // a Sentry breadcrumb, and we never silently double-commit.
      console.error("[scenario-commit] idempotency lookup failed:", {
        user_id: user.id,
        code: cacheErr.code,
        message: cacheErr.message,
      });
      reportIdempotencyError(cacheErr, {
        kind: "lookup_error",
        userId: user.id,
        code: cacheErr.code ?? null,
        message: cacheErr.message ?? "",
      });
      return NextResponse.json(
        { error: "Idempotency cache unavailable; please retry" },
        { status: 503, headers: NO_STORE_HEADERS },
      );
    }

    if (cached) {
      const row = cached as {
        request_hash: string;
        response: unknown;
        schema_version: number;
      };

      if (row.request_hash !== requestHash) {
        return NextResponse.json(
          {
            error: "Idempotency-Key reuse with different body",
            detail:
              "An earlier request used this Idempotency-Key with a different payload. Generate a new key for this request.",
          },
          { status: 422, headers: NO_STORE_HEADERS },
        );
      }

      if (row.schema_version === RESPONSE_SCHEMA_VERSION) {
        const validated = SuccessBodySchema.safeParse(row.response);
        if (validated.success) {
          return NextResponse.json(validated.data, {
            status: 200,
            headers: NO_STORE_HEADERS,
          });
        }
        // Schema version is current but body fails validation — treat as
        // miss and overwrite. Log loudly because this means a corrupt or
        // hand-mutated row exists in the cache.
        console.error(
          "[scenario-commit] cached response failed schema validation",
          { user_id: user.id, issues: validated.error.issues },
        );
        reportIdempotencyError(validated.error, {
          kind: "envelope_invalid",
          userId: user.id,
          code: null,
          message: "Cached response failed SuccessBodySchema parse",
        });
      }
      // Schema version mismatch (older row, route revision changed shape)
      // OR validation failed above — both paths fall through to a fresh
      // RPC run and overwrite the row.
    }
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
          { status: 400, headers: NO_STORE_HEADERS },
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
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }

  // Round-2-D type-design review (conf 9): runtime-validate the RPC envelope
  // instead of `as RpcEnvelope | null`. A malformed envelope (RPC schema drift,
  // body NULL, partial JSONB) hits a loud failure here rather than producing
  // a confusing 200 with empty arrays.
  const envelopeParsed = RpcEnvelopeSchema.safeParse(rpcData);
  if (!envelopeParsed.success) {
    console.error("[scenario-commit] RPC envelope failed validation:", {
      user_id: user.id,
      issues: envelopeParsed.error.issues,
      raw: rpcData,
    });
    reportIdempotencyError(envelopeParsed.error, {
      kind: "envelope_invalid",
      userId: user.id,
      code: null,
      message: "commit_scenario_batch returned a malformed envelope",
    });
    return NextResponse.json(
      { error: "Commit failed", message: "Malformed RPC envelope" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
  const rpcResult: RpcEnvelope = envelopeParsed.data;

  if (rpcResult.ok === false) {
    // FULL FAILURE — single-tx rolled back. Return per-row errors so the
    // drawer can surface them inline. NO audit events emitted (the batch
    // was rolled back, so emitting audit would mis-represent on-disk state).
    //
    // audit-2026-05-07 round-2 Block D / P1945:
    // Status is 422 (Unprocessable Entity), NOT 200. A 200 on a rolled-back
    // batch was the pre-audit shape and made retry-loops indistinguishable
    // from success at the HTTP layer — every legacy client that watched for
    // 2xx-then-stop would silently swallow per-row errors. 422 surfaces the
    // semantic distinction ("syntactically valid request, but the server
    // refused to commit it") while keeping the recorded:0 + errors[] payload
    // shape so the existing drawer UI can render inline failures unchanged.
    console.error("scenario_commit full failure", {
      user: user.id,
      diff_count: parsed.data.diffs.length,
      errors: rpcResult.errors,
    });
    return NextResponse.json(
      {
        recorded: 0,
        results: [],
        errors: rpcResult.errors,
      },
      { status: 422, headers: NO_STORE_HEADERS },
    );
  }

  // FULL SUCCESS — emit one audit event per inserted match_decision.
  //
  // Round-2-D code-reviewer (conf 8): include a per-request commit_batch_id
  // in audit metadata AND in the cached response. If the cache upsert fails
  // and a subsequent retry re-runs the RPC, the duplicate audit rows will
  // share the same commit_batch_id, giving the audit operator a deterministic
  // dedup key. This converts a silent audit-duplication leak into something
  // a SQL `SELECT ... GROUP BY commit_batch_id HAVING COUNT(*) > 1` can spot.
  const recorded = rpcResult.recorded;
  const commitBatchId = randomUUID();
  for (const row of recorded) {
    logAuditEvent(supabase, {
      action: "match.decision_record",
      entity_type: "match_decision",
      entity_id: row.match_decision_id,
      metadata: {
        kind: row.kind,
        source: "scenario_commit",
        bridge_outcome_id: row.bridge_outcome_id,
        commit_batch_id: commitBatchId,
      },
    });
  }

  const successBody: SuccessBody = {
    recorded: recorded.length,
    results: recorded,
    errors: [],
  };

  // P1945 — persist the success envelope so a subsequent retry with the same
  // Idempotency-Key short-circuits at the top of this handler. The cache row
  // carries request_hash (RFC §2.5 body-binding) and schema_version (so a
  // future shape change invalidates stale rows deterministically). Upsert
  // (not INSERT) so a concurrent retry through the RPC doesn't trip the
  // (allocator_id, idempotency_key) PK.
  //
  // Round-2-D silent-failure-hunter (conf 9): on upsert failure, log at
  // error level + Sentry breadcrumb. A swallowed failure here means the NEXT
  // retry will re-run the RPC, double-recording match_decisions; the only
  // signal in that case is the commit_batch_id on the duplicate audit rows.
  //
  // @audit-skip: scenario_commit_idempotency is a denormalization cache for
  // the Idempotency-Key contract. Writes are server-side dedup state, NOT
  // a user-visible mutation, and the per-row match_decisions / bridge_outcomes
  // emitted above (line 549) ARE the audit-event source of truth. Auditing
  // the cache write would double-count every commit + emit a "commit" event
  // for retry-deduped requests that never recorded a decision.
  if (idempotencyKeyValid) {
    const { error: cacheWriteErr } = await admin
      .from(IDEMPOTENCY_TABLE)
      .upsert(
        {
          allocator_id: user.id,
          idempotency_key: idempotencyKey,
          request_hash: requestHash,
          response: successBody,
          schema_version: RESPONSE_SCHEMA_VERSION,
        },
        { onConflict: "allocator_id,idempotency_key" },
      );
    if (cacheWriteErr) {
      console.error("[scenario-commit] idempotency cache write failed:", {
        user_id: user.id,
        code: cacheWriteErr.code,
        message: cacheWriteErr.message,
        commit_batch_id: commitBatchId,
      });
      reportIdempotencyError(cacheWriteErr, {
        kind: "write_error",
        userId: user.id,
        code: cacheWriteErr.code ?? null,
        message: cacheWriteErr.message ?? "",
      });
    }
  }

  // Phase 11 / Plan 03 / D-13 / ONBOARD-05 — stamp first_outcome_at marker.
  // The /allocations Server Component reader emits the PostHog
  // `first_outcome_recorded` event on the next dashboard request. Idempotent
  // (helper reads metadata first, no-ops once stamp is set). Non-blocking:
  // a stamp failure does NOT affect the route response or the committed
  // batch.
  try {
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

  return NextResponse.json(successBody, {
    status: 200,
    headers: NO_STORE_HEADERS,
  });
});
