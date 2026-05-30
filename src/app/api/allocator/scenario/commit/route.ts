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
import { after, type NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withAllocatorAuth, type AllocatorUser } from "@/lib/api/withAllocatorAuth";
import { NO_STORE_HEADERS } from "@/lib/api/headers";
import { captureToSentry } from "@/lib/sentry-capture";
import { userActionLimiter, checkLimit, isRateLimitMisconfigured } from "@/lib/ratelimit";
import { emit, type AuditEvent } from "@/lib/audit";
import { stampOutcomeMarker } from "@/lib/analytics/onboarding-funnel";
import { holdingScopeKey } from "@/lib/keys";

export const runtime = "nodejs";

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

// Post-normalisation shape of a voluntary_modify diff. After the
// imperative at-least-one-percent-encoding check runs and the diff is
// rewritten with `percent_allocated` set and `new_weight` removed, this
// is the shape the RPC actually receives. Typing the normalisedDiffs
// array against this — rather than `typeof parsed.data.diffs` —
// documents the invariant + lets the type system flag a future
// regression that re-introduces `new_weight` into the RPC payload.
type NormalisedVoluntaryModifyDiff = Omit<
  z.infer<typeof VoluntaryModifyDiff>,
  "new_weight" | "percent_allocated"
> & {
  percent_allocated: number;
};

type NormalisedCommitDiff =
  | z.infer<typeof VoluntaryRemoveDiff>
  | z.infer<typeof VoluntaryAddDiff>
  | NormalisedVoluntaryModifyDiff
  | z.infer<typeof BridgeRecommendedDiff>;

/**
 * H-0254 audit-metadata projection — extracts the per-arm forensic fields
 * from a NormalisedCommitDiff for inclusion in the audit_log row.
 *
 * Exhaustive `switch (kind)` + a `never`-typed assignment in the default
 * branch so a future union arm fails the build at this site rather than
 * silently producing a sparse audit row downstream.
 */
function pickAuditDiffFields(
  d: NormalisedCommitDiff,
): Record<string, string | number | undefined> {
  switch (d.kind) {
    case "voluntary_remove":
      // Security M conf=9 (2026-05-28 specialist): rejection_reason is a
      // closed-set z.enum (mandate_conflict / already_owned / etc.), safe
      // to pass through. Free-text rationale lives in `note`, reduced to
      // note_present:boolean below by design.
      return {
        holding_ref: d.holding_ref,
        rejection_reason: d.rejection_reason,
      };
    case "voluntary_add":
      return {
        strategy_id: d.strategy_id,
        percent_allocated: d.percent_allocated,
      };
    case "voluntary_modify":
      return {
        holding_ref: d.holding_ref,
        percent_allocated: d.percent_allocated,
      };
    case "bridge_recommended":
      return {
        holding_ref: d.holding_ref,
        strategy_id: d.strategy_id,
        percent_allocated: d.percent_allocated,
      };
    default: {
      // Red-team H1 (2026-05-28): pre-fix the never-typed return value
      // was the live `d` at runtime — schema drift (new `kind` added in
      // SQL not yet redeployed to TS) would silently spread every field
      // of `d` into the audit row, including fields the redaction layer
      // wasn't designed for. Fail loud per Rule 12.
      const _exhaustive: never = d;
      throw new Error(
        `pickAuditDiffFields: unhandled diff kind — RPC schema drift? got=${JSON.stringify(_exhaustive)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Recorded-row envelope returned by the RPC
//
// The envelope is a discriminated union on `ok` rather than the flat
// `{ ok: boolean; recorded?; errors? }` shape — the flat shape admitted
// four states for two valid ones (`{ok:true,errors:[...]}` and
// `{ok:false,recorded:[...]}` are nonsense given the single-tx contract)
// and forced defensive `?? []` fallbacks throughout. The runtime-validation
// parse below makes a malformed envelope fail loud.
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

// Migration 131 idempotency error codes. The SQL function in 131
// returns ok:false envelopes carrying one of these `code` values; the
// route maps each to a specific HTTP status (not the default 422 for
// per-row commit failure). Centralised here so SQL/TS comparisons don't
// drift on a typo — keep the SQL function (migration 131) in sync.
export const IDEM_CODES = {
  BODY_MISMATCH: "idempotency_body_mismatch",
  IN_FLIGHT: "idempotency_in_flight",
  SCHEMA_DRIFT: "idempotency_schema_drift",
} as const;

const IdempotencyErrorCode = z.enum([
  IDEM_CODES.BODY_MISMATCH,
  IDEM_CODES.IN_FLIGHT,
  IDEM_CODES.SCHEMA_DRIFT,
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
 * Run a task after the response flushes. Uses Next's after() in a request
 * scope; falls back to a microtask when after() throws outside one
 * (vitest/cron/prerender). Single home for the fallback contract that the
 * audit-flush and onboarding-stamp paths both rely on (mirrors src/lib/audit.ts).
 */
function scheduleBackground(task: () => Promise<void>): void {
  try {
    after(task);
  } catch {
    queueMicrotask(() => {
      void task();
    });
  }
}

export const POST = withAllocatorAuth(async (req: NextRequest, user: AllocatorUser): Promise<NextResponse> => {
  // Read the raw body bytes once. The bytes drive (a) JSON parse + zod
  // validation and (b) the SHA-256 request_hash used to bind Idempotency-Key
  // cache rows to the exact body. Earlier implementations only matched on
  // (allocator_id, idempotency_key) — a client re-using the same key with
  // a different body got the FIRST body's cached response, masking the
  // bug silently. RFC draft-ietf-httpapi-idempotency-key §2.5 requires
  // the server to detect this case and respond 422.
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

  // Bind cache rows to the body. The hash is over the UTF-8-decoded
  // request text (the JS string returned by `req.text()`), re-encoded
  // as UTF-8 by `createHash().update()`. For VALID-UTF-8 input this is
  // byte-identical to the on-wire bytes — which is the only payload
  // shape `req.json()` would have accepted downstream anyway. For
  // malformed UTF-8 input the decoder substitutes U+FFFD, so the hash
  // diverges from the on-wire bytes — but in that case `JSON.parse`
  // fails immediately below and we return 400 before the hash is used.
  // We chose this over `req.arrayBuffer()` + raw-byte hashing because
  // the route also needs the parsed JSON, so a single text() + parse
  // pass is simpler than two stream reads.
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
  // The previous route-layer SELECT-then-RPC-then-UPSERT had a race
  // window where two clients could
  // both pass the SELECT before either UPSERT — both then invoked the RPC,
  // double-recording match_decisions/bridge_outcomes. Server-side dedup
  // eliminates that window entirely.
  // ---------------------------------------------------------------------------
  const idempotencyKey = req.headers.get("Idempotency-Key");
  // PR-2 full-file reviewer #2 (2026-05-28): when the header is PRESENT
  // but fails the format regex, fail loud with 400. Pre-fix the malformed
  // key was silently dropped (passed null to the RPC) which turned the
  // commit into a non-idempotent operation while the client kept retrying
  // with the same malformed key — duplicate match_decisions + duplicate
  // audit rows. Per RFC draft-ietf-httpapi-idempotency-key §2.5, an
  // invalid key must be rejected, not ignored.
  if (idempotencyKey !== null && !IDEMPOTENCY_KEY_RE.test(idempotencyKey)) {
    return NextResponse.json(
      {
        error: "Idempotency-Key format invalid",
        detail:
          "Header must match /^[A-Za-z0-9._~-]{16,128}$/. Generate a fresh key and retry.",
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const idempotencyKeyValid =
    !!idempotencyKey && IDEMPOTENCY_KEY_RE.test(idempotencyKey);

  // P1956 (audit-2026-05-07 round 2): single canonical percent encoding.
  // Migration 128 dropped the SQL-side `new_weight * 100` fallback — the RPC
  // now reads ONLY `percent_allocated`. The VoluntaryModifyDiff schema accepts
  // either shape; here we normalise into `percent_allocated`, returning 400
  // if a voluntary_modify diff has neither (the schema allows this state so
  // we have to enforce at-least-one imperatively — discriminated unions
  // require each member to be a ZodObject, no `.refine()`).
  const normalisedDiffs: NormalisedCommitDiff[] = [];
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

  // B15 limiter-ordering: consume the rate-limit token only AFTER all pure
  // input validation has passed (body read, JSON parse, CommitBodySchema,
  // Idempotency-Key regex, voluntary_modify percent-encoding). A malformed /
  // invalid request now returns 400 WITHOUT burning one of the caller's own
  // tokens — the token is reserved for requests that reach the side-effecting
  // RPC below. Canonical order: auth -> input-validation -> rate-limit ->
  // handler. The limiter variable, key string, and 503/429 deny shape are
  // unchanged from the original top-of-handler block.
  const rl = await checkLimit(userActionLimiter, `scenario_commit:${user.id}`);
  if (!rl.success) {
    if (isRateLimitMisconfigured(rl)) {
      return NextResponse.json(
        { error: "Rate limiter unavailable" },
        {
          status: 503,
          headers: { ...NO_STORE_HEADERS, "Retry-After": String(rl.retryAfter) },
        },
      );
    }
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: { ...NO_STORE_HEADERS, "Retry-After": String(rl.retryAfter) },
      },
    );
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
    // The RPC is SECURITY DEFINER and its RAISE EXCEPTION messages
    // (migration 082/131) echo internal state — the literal holding_ref,
    // strategy_id, row index, and the `auth.uid() <> p_allocator_id` guard
    // text — plus any raw Postgres constraint/column names on an unexpected
    // error. Echoing rpcErr.message verbatim to an allocator client leaked
    // that schema detail (api-contract M-0295). Log the full message
    // server-side for diagnostics; return a stable, non-leaking message to
    // the client (matches the allocator/holdings/sync sibling and the
    // "Malformed RPC envelope" branch below).
    console.error("scenario_commit RPC error", {
      user: user.id,
      message: rpcErr.message,
      code: rpcErr.code,
    });
    return NextResponse.json(
      { error: "Commit failed", message: "Could not commit scenario. Try again in a moment." },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }

  // Runtime-validate the RPC envelope instead of `as RpcEnvelope | null`.
  // A malformed envelope (RPC schema drift, body NULL, partial JSONB)
  // hits a loud failure here rather than producing a confusing 200 with
  // empty arrays.
  const envelopeParsed = RpcEnvelopeSchema.safeParse(rpcData);
  if (!envelopeParsed.success) {
    console.error("[scenario-commit] RPC envelope failed validation:", {
      user_id: user.id,
      issues: envelopeParsed.error.issues,
      raw: rpcData,
    });
    captureToSentry(envelopeParsed.error, {
      tags: { scenario_commit_envelope_invalid: "true" },
      extra: {
        user_id: user.id,
        message: "commit_scenario_batch returned a malformed envelope",
      },
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

    if (firstCode === IDEM_CODES.BODY_MISMATCH) {
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

    if (firstCode === IDEM_CODES.IN_FLIGHT) {
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

    if (firstCode === IDEM_CODES.SCHEMA_DRIFT) {
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
      diff_count: normalisedDiffs.length,
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

  // NEW-C18-04 (PR-2 2026-05-28, audit-trust scope): pre-fix, the audit row
  // stored `size_at_decision_usd` verbatim from the client payload. A
  // malicious allocator could write any number and have it land in audit
  // forever. The data-integrity scope is already safe — the RPC ignores
  // this field entirely; `percent_allocated` is the authoritative
  // dimensioning column — but the AUDIT TRAIL still trusted client truth.
  //
  // Fix: one SELECT against allocator_holdings to assemble the authoritative
  // total_aum and per-holding value_usd map. The audit emit loop then
  // derives size from server data:
  //   - voluntary_remove: server_size = the removed holding's value_usd
  //   - voluntary_modify / voluntary_add / bridge_recommended:
  //       server_size = percent_allocated * total_aum / 100
  //   - lookup failure: fall back to client number with a `_size_source`
  //     sentinel of "client_unverified" so forensic readers can filter.
  //
  // CRITICAL — asof handling (code-reviewer C1 catch, PR-2 2026-05-28):
  // allocator_holdings has UNIQUE (allocator_id, venue, symbol, asof) — one
  // row PER DAY per holding (migration 20260420073003 line 147). A long-
  // lived allocator can have 730+ snapshots per holding. A naive `SUM(value_usd)`
  // would inflate AUM by the snapshot count (100×–730×) and the per-holding
  // map would pick a non-deterministic asof. We mirror the RPC's MAX(asof)
  // pattern (migration 20260515210400 lines 286/359/411) by ordering DESC and
  // KEEPING ONLY THE FIRST-SEEN entry per (venue, symbol, holding_type) — the
  // newest snapshot. Then sum across the deduped map for AUM.
  //
  // Skipped on cached replays (the original commit already emitted the
  // server-side number; replays produce no new audit rows).
  let serverAumUsd = 0;
  const holdingValueByRef = new Map<string, number>();
  // Hoisted so the per-row audit loop below can distinguish
  // lookup_failed (Supabase error) from no_holdings_snapshot (legitimate
  // empty-but-ok) from "the lookup never ran" (cached replay; today the
  // audit loop is skipped on cached replays, but if a future refactor
  // ever audits on cached path the explicit "not_run" state prevents
  // the sentinel from falsely reading "no_holdings_snapshot" when the
  // SELECT never executed). Red-team C2 (2026-05-28).
  let holdingsLookupErr: { message?: string } | null = null;
  let holdingsLookupRan = false;
  if (!isCachedReplay) {
    // I3 (PR-2 specialist code-reviewer): pre-filter to the two
    // holding_type values the audit recompute knows about. A legacy /
    // drifted row with holding_type="margin" (or any other value) would
    // otherwise bloat serverAumUsd without ever matching a client diff's
    // holding_ref, producing inflated AUM denominators silently.
    // Reviewer #1 (2026-05-28): add holding_type tiebreaker so the
    // first-seen-wins dedup is deterministic when two rows for the same
    // (venue, symbol, asof) but different holding_type exist. Postgres
    // would otherwise return them in an unspecified order.
    const { data: holdingRows, error: holdingErr } = await supabase
      .from("allocator_holdings")
      .select("venue, symbol, holding_type, value_usd, asof")
      .eq("allocator_id", user.id)
      .in("holding_type", ["spot", "derivative"])
      .order("asof", { ascending: false })
      .order("holding_type", { ascending: true });
    holdingsLookupErr = holdingErr;
    holdingsLookupRan = true;
    if (holdingErr) {
      // Don't fail the commit — the data layer already landed. Log + mark
      // every per-row audit with `_size_source: "lookup_failed"` so the
      // sparse path is observable in forensic queries.
      console.warn(
        "[scenario-commit] allocator_holdings lookup for audit recompute failed:",
        holdingErr.message,
      );
      captureToSentry(new Error("scenario_commit: holdings lookup for audit recompute failed"), {
        tags: { area: "scenario-commit", gate: "audit_size_recompute" },
        extra: { user_id: user.id, supabase_err: holdingErr.message },
        level: "warning",
      });
    } else {
      for (const row of holdingRows ?? []) {
        const ref = holdingScopeKey(row);
        // Order is asof DESC; the FIRST row seen for a given ref is the
        // newest snapshot. Skip subsequent (older) rows.
        if (holdingValueByRef.has(ref)) continue;
        const v = typeof row.value_usd === "number" && Number.isFinite(row.value_usd)
          ? row.value_usd
          : 0;
        holdingValueByRef.set(ref, v);
        serverAumUsd += v;
      }
    }
  }

  if (!isCachedReplay) {
    // NEW-C18-11 (audit-2026-05-07): collect the per-row audit events and
    // flush them as ONE batch below so a HARD audit failure becomes a
    // distinct, commit-scoped alert instead of N swallowed fire-and-forget
    // emits. (Pre-fix this loop called logAuditEvent per row, whose
    // `.catch(() => {})` hid the re-throw — emit() reported each failure to
    // Sentry but with no scenario-commit tag / commit_batch_id, so an
    // operator could not tell that THIS financial commit lost its trail,
    // and a cached replay returned 200 trusting the original had emitted.)
    const auditEvents: AuditEvent[] = [];
    for (const row of recorded) {
      // audit-2026-05-07 H-0254: pre-fix the metadata captured only
      // `kind / source / bridge_outcome_id`. A scenario commit is a
      // FINANCIAL decision; the audit needs the full decision shape
      // (which strategy, how much, when), not just the join keys.
      const inputDiff = normalisedDiffs[row.index];
      // Type-design M conf=8 + silent-failure M conf=9 (2026-05-28
      // specialist): a missing inputDiff implies RPC index drift / schema
      // regression. Pre-fix `inputDiff && ...` spread dropped forensic
      // fields silently. Per Rule 12 (Fail loud): capture to Sentry and
      // emit a sparse-but-flagged audit row so forensic readers can tell
      // "RPC index drift" apart from "diff fields legitimately absent".
      if (!inputDiff) {
        captureToSentry(
          new Error(
            "scenario_commit: RPC echoed out-of-range index — audit metadata sparse",
          ),
          {
            tags: { area: "scenario-commit", gate: "rpc_index_drift" },
            extra: {
              row_index: row.index,
              batch_size: normalisedDiffs.length,
              match_decision_id: row.match_decision_id,
            },
            level: "error",
          },
        );
      }
      const diffFields = inputDiff ? pickAuditDiffFields(inputDiff) : {};

      // NEW-C18-04 audit-trust recompute: derive size from server data
      // when possible; fall back to client number with sentinel otherwise.
      //
      // Reviewer #4 (2026-05-28): added "ref_not_found" sentinel so a
      // voluntary_remove against a stale/missing holding_ref is
      // distinguishable from a Supabase-side error (lookup_failed) and
      // from a true client-only fallback (client_unverified).
      let serverSizeUsd: number | null = null;
      let sizeSource:
        | "server_holding"
        | "server_aum"
        | "client_unverified"
        | "lookup_failed"
        | "ref_not_found"
        | "no_holdings_snapshot" =
        "client_unverified";
      // Distinguish "Supabase errored" (lookup_failed) from "allocator
      // legitimately has no holdings yet" (no_holdings_snapshot). The
      // holdingsLookupOk flag captures the first; the empty-but-ok case
      // captures the second.
      // Red-team C2: holdingsLookupOk is true ONLY when the SELECT
      // actually ran AND returned without error. holdingsLookupRan guards
      // against the future cached-replay-audit refactor described above.
      const holdingsLookupOk = holdingsLookupRan && holdingsLookupErr === null;
      const holdingsEmptyOk = holdingsLookupOk && holdingValueByRef.size === 0;
      if (inputDiff) {
        if (inputDiff.kind === "voluntary_remove") {
          const v = holdingValueByRef.get(inputDiff.holding_ref);
          if (v !== undefined) {
            serverSizeUsd = v;
            sizeSource = "server_holding";
          } else if (!holdingsLookupOk) {
            sizeSource = "lookup_failed";
          } else if (holdingsEmptyOk) {
            sizeSource = "no_holdings_snapshot";
          } else {
            sizeSource = "ref_not_found";
          }
        } else if (
          inputDiff.kind === "voluntary_modify" ||
          inputDiff.kind === "voluntary_add" ||
          inputDiff.kind === "bridge_recommended"
        ) {
          if (serverAumUsd > 0) {
            serverSizeUsd = (inputDiff.percent_allocated * serverAumUsd) / 100;
            sizeSource = "server_aum";
          } else if (!holdingsLookupOk) {
            sizeSource = "lookup_failed";
          } else if (holdingsEmptyOk) {
            sizeSource = "no_holdings_snapshot";
          }
        }
      }

      auditEvents.push({
        action: "match.decision_record",
        entity_type: "match_decision",
        entity_id: row.match_decision_id,
        metadata: {
          kind: row.kind,
          source: "scenario_commit",
          bridge_outcome_id: row.bridge_outcome_id,
          commit_batch_id: commitBatchId,
          allocator_id: user.id,
          // Sentinel — distinguishes "diff present" from "RPC index drift".
          _diff_present: Boolean(inputDiff),
          ...diffFields,
          ...(inputDiff && {
            // NEW-C18-04: server-recomputed authoritative figure.
            // Pre-fix this was the unverified client number; a malicious
            // allocator could inflate or deflate it without bound. Now
            // the `_size_source` sentinel below distinguishes six states:
            //   server_holding        — voluntary_remove uses holdings.value_usd
            //   server_aum            — other arms recompute pct × total_aum
            //   ref_not_found         — voluntary_remove's holding_ref absent
            //                           from a non-empty holdings map
            //   no_holdings_snapshot  — lookup ran, returned zero rows
            //   lookup_failed         — allocator_holdings SELECT errored
            //   client_unverified     — no inputDiff (shouldn't happen)
            size_at_decision_usd: serverSizeUsd,
            size_at_decision_usd_client: inputDiff.size_at_decision_usd,
            _size_source: sizeSource,
            effective_date: inputDiff.effective_date,
            note_present:
              typeof inputDiff.note === "string" && inputDiff.note.length > 0,
          }),
          // Idempotency key enables joining audit retries across the
          // dedup window introduced in migration 131.
          idempotency_key: idempotencyKeyValid ? idempotencyKey : null,
        },
      });
    }

    // NEW-C18-11: flush the whole financial-commit audit trail in ONE
    // after() callback. Stays non-blocking (response latency unchanged),
    // but a HARD audit failure (permission_denied / unknown — the classes
    // emit() re-throws after Sentry-reporting) now raises a single
    // commit-scoped `scenario_commit_audit_incomplete` alert carrying the
    // commit_batch_id, so ops can find and backfill the exact commit whose
    // Art.-grade financial trail dropped. transient/unauthenticated emits
    // resolve (emit swallows them) and stay infra-level noise, as before.
    // Kick the emits off synchronously (so the RPCs start during the
    // request, matching the prior per-row behaviour) and await them only in
    // after() for the completeness alert — the response itself never waits.
    //
    // CRITICAL (CL1 review, silent-failure H8 / red-team M8): attach the
    // settle handler in the SAME synchronous turn each emit is launched —
    // mirroring logAuditEvent's per-promise `.catch(() => {})` (audit.ts:662).
    // emit() re-throws on permission_denied/unknown, and on Vercel after()
    // runs flushAuditTrail in a LATER macrotask (post-response). If we only
    // attached the handler via Promise.allSettled inside that callback, a
    // rejection settling first would be momentarily handler-less → Node fires
    // unhandledRejection → the Sentry SDK auto-captures an UN-scoped duplicate
    // event (exactly the noise this fix removes) and risks process abort under
    // --unhandled-rejections=throw. `.then(ok, fail)` here is the per-promise
    // guard; flushAuditTrail then just counts the booleans.
    const auditEmissions = auditEvents.map((event) =>
      emit(supabase, event).then(
        () => true,
        () => false,
      ),
    );
    const flushAuditTrail = async () => {
      const results = await Promise.all(auditEmissions);
      const failed = results.filter((ok) => !ok).length;
      if (failed > 0) {
        captureToSentry(
          new Error(
            "scenario_commit: audit trail incomplete — hard audit emit failure",
          ),
          {
            tags: {
              area: "scenario-commit",
              scenario_commit_audit_incomplete: "true",
            },
            extra: {
              commit_batch_id: commitBatchId,
              allocator_id: user.id,
              failed,
              total: auditEvents.length,
            },
            level: "error",
          },
        );
      }
    };
    scheduleBackground(flushAuditTrail);
  }

  const successBody: SuccessBody = {
    recorded: recorded.length,
    results: recorded,
    errors: [],
  };

  // Stamp first_outcome_at marker — PostHog `first_outcome_recorded` fires
  // on the next /allocations dashboard render. Idempotent (helper reads
  // metadata first, no-ops once stamp is set). Two Auth Admin REST calls
  // (getUserById + updateUserById on first commit) ran SYNCHRONOUSLY pre-
  // simplify, extending p95 commit latency by ~50–200 ms. Moved into
  // `after()` so the response returns immediately; Vercel keeps the
  // function alive until the callback resolves. The broad catch routes
  // to Sentry so a regression inside stampOutcomeMarker (TypeError /
  // ReferenceError) doesn't silently break the onboarding funnel.
  //
  // Scheduled via scheduleBackground() (see helper above) — after() throws
  // outside a request scope (vitest, cron, prerender), so it falls back to a
  // microtask, mirroring src/lib/audit.ts. The admin client is created lazily
  // inside the callback so non-success paths don't pay the construction cost.
  const stampMarker = async () => {
    const admin = createAdminClient();
    try {
      await stampOutcomeMarker(admin, user.id);
    } catch (err) {
      console.warn(
        "[scenario-commit] first_outcome_at stamp failed:",
        err instanceof Error ? (err.stack ?? err.message) : err,
      );
      captureToSentry(err, {
        tags: { scenario_commit_stamp_failure: "true" },
        extra: { user_id: user.id },
        level: "warning",
      });
    }
  };
  scheduleBackground(stampMarker);

  return NextResponse.json(successBody, {
    status: 200,
    headers: NO_STORE_HEADERS,
  });
});
