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

// audit-2026-05-07 round-2 Block D / P1945 — accepted Idempotency-Key shape.
// The charset is restricted to ASCII alphanumerics + URL-safe punctuation
// (RFC 8941 token-ish) for two reasons:
//   1. JS `.length` counts UTF-16 code units; Postgres `length(text)` counts
//      characters. A 16-code-unit emoji key (which JS admits) is 8 chars in
//      Postgres → fails the migration 130 CHECK at upsert time → cache row
//      never written → next retry duplicates the RPC. The ASCII regex
//      eliminates the JS/Postgres counting mismatch by construction.
//   2. The RFC's "opaque, hard-to-guess, client-generated" guidance maps
//      naturally to uuid-style hex / base64url charsets; restricting here
//      also prevents homoglyph confusion in logs.
// 16 chars is the collision-safety floor; 128 the practical upper bound
// before the key starts to look like an attempt to stash payload in a
// header.
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._~-]{16,128}$/;

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

// Migration 131 idempotency error codes. When ok:false carries one of
// these codes the route maps to a specific HTTP status (not the default
// 422 for per-row commit failure).
const IdempotencyErrorCode = z.enum([
  "idempotency_body_mismatch",
  "idempotency_in_flight",
  "idempotency_schema_drift",
]);

const RpcEnvelopeSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    recorded: z.array(RpcRecordedRowSchema),
    // Set when the response was served from the dedup cache (migration 131).
    // The body shape is otherwise identical to a fresh commit.
    cached: z.boolean().optional(),
  }),
  z.object({
    ok: z.literal(false),
    errors: z.array(
      z.object({
        index: z.number().int(),
        error: z.string(),
        code: IdempotencyErrorCode.optional(),
      }),
    ),
  }),
]);

type RpcEnvelope = z.infer<typeof RpcEnvelopeSchema>;

// Final response body returned to the client (200 path). The migration
// 131 SQL function persists the same shape inside scenario_commit_idempotency
// for cached replays. Type-only — the function-side validation lives in
// the RpcEnvelopeSchema parse above.
interface SuccessBody {
  recorded: number;
  results: RpcRecordedRow[];
  errors: [];
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

/**
 * Lazy-import Sentry to capture idempotency-cache failures without pulling
 * Sentry into routes that don't need it. Mirrors the pattern in
 * `src/lib/admin.ts` / `src/lib/audit.ts`. The kind tag lets SRE filter
 * lookup-vs-write failures separately.
 */
function reportEnvelopeError(
  err: unknown,
  options: {
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
              scenario_commit_envelope_invalid: "true",
              scenario_commit_code: options.code ?? "unknown",
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
  // P1945 — Idempotency-Key contract is now enforced INSIDE the RPC
  // (migration 131). The route extracts + validates the key and hash, then
  // passes both to commit_scenario_batch which atomically reserves
  // (allocator_id, idempotency_key) via INSERT ... ON CONFLICT DO NOTHING
  // in the SAME transaction as the data inserts. Concurrent retries either:
  //   - lose the race and see the in-flight placeholder      → 409 Retry-After
  //   - lose the race and see the completed cache row        → 200 cached
  //   - send a different body under the same key             → 422
  //   - succeed                                              → 200 fresh
  //
  // Round-2-D red-team F.2 (conf 9): the previous route-layer
  // SELECT-then-RPC-then-UPSERT had a race window where two clients could
  // both pass the SELECT before either UPSERT — both then invoked the RPC,
  // double-recording match_decisions/bridge_outcomes. Server-side dedup
  // eliminates that window entirely.
  // ---------------------------------------------------------------------------
  const idempotencyKey = req.headers.get("Idempotency-Key");
  const idempotencyKeyValid =
    !!idempotencyKey && IDEMPOTENCY_KEY_RE.test(idempotencyKey);
  const admin = createAdminClient();

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
  //
  // Migration 131 added p_idempotency_key / p_request_hash params. When the
  // caller supplies these, the RPC's first step is an atomic
  // INSERT ... ON CONFLICT DO NOTHING on scenario_commit_idempotency, in
  // the SAME transaction as the match_decisions inserts. This is the only
  // place a concurrent retry can be deterministically deduped.
  const { data: rpcData, error: rpcErr } = await supabase.rpc(
    "commit_scenario_batch",
    {
      p_allocator_id: user.id,
      p_diffs: normalisedDiffs,
      p_idempotency_key: idempotencyKeyValid ? idempotencyKey : null,
      p_request_hash: idempotencyKeyValid ? requestHash : null,
    },
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
    reportEnvelopeError(envelopeParsed.error, {
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
    // Map migration 131's idempotency error codes to specific HTTP statuses.
    // Anything else (per-row commit failure envelopes from older code paths
    // or hand-tested fixtures) keeps the existing 422 semantics — the
    // recorded:0 + errors[] body shape is preserved so the drawer UI does
    // not need to change.
    const firstCode = rpcResult.errors[0]?.code;

    if (firstCode === "idempotency_body_mismatch") {
      // RFC §2.5 — same Idempotency-Key, different body is a client bug.
      return NextResponse.json(
        {
          error: "Idempotency-Key reuse with different body",
          detail:
            "An earlier request used this Idempotency-Key with a different payload. Generate a new key for this request.",
        },
        { status: 422, headers: NO_STORE_HEADERS },
      );
    }

    if (firstCode === "idempotency_in_flight") {
      // A concurrent retry holds the placeholder row. The client can
      // re-poll once the winner completes (typically <1s — the RPC body
      // is fast).
      return NextResponse.json(
        {
          error: "Idempotent commit is already in flight; please retry",
        },
        {
          status: 409,
          headers: { ...NO_STORE_HEADERS, "Retry-After": "1" },
        },
      );
    }

    if (firstCode === "idempotency_schema_drift") {
      // Cached row written by an older route revision. Treat as server-
      // side data state requiring SRE follow-up; client retry with a
      // fresh key.
      console.error("[scenario-commit] idempotency schema drift:", {
        user_id: user.id,
        errors: rpcResult.errors,
      });
      return NextResponse.json(
        {
          error: "Idempotency cache has a stale entry; please retry with a fresh key",
        },
        { status: 503, headers: NO_STORE_HEADERS },
      );
    }

    // FULL FAILURE (non-idempotency) — single-tx rolled back. Return
    // per-row errors so the drawer can surface them inline. NO audit
    // events emitted (the batch was rolled back, so emitting audit would
    // mis-represent on-disk state).
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

  // FULL SUCCESS. Emit one audit event per inserted match_decision UNLESS
  // this was a cached replay (rpcResult.cached === true) — the original
  // commit already emitted audit events when the cache row was first
  // written; re-emitting them on every retry would duplicate the audit
  // trail. The commit_batch_id below is included so a forensic SQL `GROUP
  // BY commit_batch_id` can still cluster the per-row events for one
  // logical commit if needed.
  const recorded = rpcResult.recorded;
  const commitBatchId = randomUUID();
  const isCachedReplay = rpcResult.cached === true;

  if (!isCachedReplay) {
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
  }

  const successBody: SuccessBody = {
    recorded: recorded.length,
    results: recorded,
    errors: [],
  };

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
