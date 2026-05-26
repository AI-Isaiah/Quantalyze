import { NextRequest, NextResponse } from "next/server";
import type { Database } from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";
import { assertSameOrigin } from "@/lib/csrf";
import { assertProfileApproved } from "@/lib/api/approval-gate";
import {
  pickSelfEditableFields,
  validateSelfEditableInput,
  getOwnPreferences,
} from "@/lib/preferences";
import {
  mandateAutoSaveLimiter,
  preferencesReadLimiter,
  checkLimit,
  isRateLimitMisconfigured,
} from "@/lib/ratelimit";
import { logAuditEvent } from "@/lib/audit";

/**
 * RPC parameter bag for `update_allocator_mandates`. Each non-null
 * self-editable field is passed as a `p_<field>` named parameter; keys the
 * caller explicitly sent as `null` are collected into `p_clear_fields` (the
 * Reset affordance — see the null-to-clear transform below). Aliased
 * straight to the generated `Args` (H-0297) so the parameter names stay in
 * lockstep with the RPC signature: if the SQL function gains or renames a
 * parameter, this type tracks it on the next type regen instead of silently
 * diverging from a hand-maintained list. The generated Args is already
 * all-optional (every `p_*` is `?`), which matches the per-PUT shape — each
 * request only carries the fields the caller touched, and `p_clear_fields`
 * is present only when at least one field is reset.
 */
type MandateRpcArgs =
  Database["public"]["Functions"]["update_allocator_mandates"]["Args"];

export async function GET(_req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Approval gate (PR #266 follow-up): allocator mandate preferences are
  // an allocator-only surface; a pending-approval user has no business
  // here. Page-level gate already redirects browsers, but a curl-style
  // API hit bypassed it before this check landed.
  const denied = await assertProfileApproved(supabase, user.id);
  if (denied) return denied;

  // NEW-C07-05 (audit-2026-05-26 code-review): rate-limit GET to prevent
  // an authenticated allocator from scripting unbounded SELECT * calls
  // that inflate Supabase egress. checkLimit is already imported for PUT;
  // the read-appropriate bucket is higher than the write limiter (60/min
  // vs 30/min) since reads are idempotent and cheaper, and any legitimate
  // session will load this at most once per page mount.
  const rlRead = await checkLimit(preferencesReadLimiter, `preferences:read:${user.id}`);
  if (!rlRead.success) {
    if (isRateLimitMisconfigured(rlRead)) {
      return NextResponse.json(
        { error: "Service temporarily unavailable" },
        { status: 503, headers: { "Retry-After": String(rlRead.retryAfter) } },
      );
    }
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rlRead.retryAfter) } },
    );
  }

  try {
    const prefs = await getOwnPreferences(supabase, user.id);
    return NextResponse.json({ preferences: prefs });
  } catch (err) {
    // F-04 (specialist-review 2026-05-26): log error code explicitly so ops can
    // distinguish PGRST205 (schema drift), 42501 (RLS denial), 28000 (JWT
    // propagation failure), and network errors without parsing raw error objects.
    const code = (err as { code?: string | null })?.code ?? null;
    console.error("[api/preferences] GET error:", { code, message: (err as Error)?.message ?? String(err) });
    return NextResponse.json({ error: "Failed to load preferences" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Approval gate — see GET handler above for rationale.
  const deniedPut = await assertProfileApproved(supabase, user.id);
  if (deniedPut) return deniedPut;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Whitelist + validate (TS-layer mirror of RPC bounds per D-18).
  const fields = pickSelfEditableFields(body);
  const validationError = validateSelfEditableInput(fields);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  // NEW-C07-04 (audit-2026-05-26 code-review): rate-limit token consumed
  // AFTER body parse + validate. Pre-fix: checkLimit ran before JSON parse,
  // so a client retrying on a 400 (one out-of-range field) burned the full
  // 30/min auto-save budget without reaching the RPC, then 429d their next
  // *valid* edit. The limiter is meant to cap writes, not rejections.
  // Placed here — after validate and after the pickSelfEditableFields
  // whitelist — so only requests that would reach the RPC consume a token.
  // M-1108: a null limiter in production fails CLOSED with
  // reason:'ratelimit_misconfigured' → 503 so the outage surfaces to
  // canary/health checks rather than masquerading as ordinary throttling.
  const rl = await checkLimit(mandateAutoSaveLimiter, `preferences:${user.id}`);
  if (!rl.success) {
    if (isRateLimitMisconfigured(rl)) {
      return NextResponse.json(
        { error: "Service temporarily unavailable" },
        { status: 503, headers: { "Retry-After": String(rl.retryAfter) } },
      );
    }
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  // Null-to-clear transform (Pitfall 1 in RESEARCH.md): the COALESCE UPSERT
  // inside update_allocator_mandates treats a NULL parameter as "preserve
  // existing value". For the Reset affordance (D-11) we need an explicit
  // signal. Split `fields` into (a) non-null values passed as p_<field>
  // named parameters, and (b) keys the caller explicitly sent as null,
  // collected into `p_clear_fields`.
  const clearFields: string[] = [];
  const rpcArgs: MandateRpcArgs = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === null) {
      clearFields.push(key);
    } else {
      // `key` is a SELF_EDITABLE_PREFERENCE_FIELDS member (pickSelfEditableFields
      // whitelists it) and `value` passed validateSelfEditableInput. Narrowing
      // the index to `keyof MandateRpcArgs` enforces the parameter-NAME set at
      // compile time — a stray `p_<field>` that the generated Args doesn't
      // declare won't type-check. The value type is still ASSERTED here (we
      // widen to `unknown`, not the per-field union); this dynamic write is the
      // one boundary where the field-to-type pairing is taken on trust rather
      // than checked, with validateSelfEditableInput standing in for it.
      const k = `p_${key}` as keyof MandateRpcArgs;
      (rpcArgs as Record<keyof MandateRpcArgs, unknown>)[k] = value;
    }
  }
  if (clearFields.length > 0) {
    rpcArgs.p_clear_fields = clearFields;
  }

  // @audit-skip: rpc write path — logAuditEvent is called within 60 lines
  // below. audit-coverage.test.ts scans .insert/.update/.upsert/.delete
  // and does not see .rpc(); this pragma documents the audit path for
  // future maintainers. Remove if audit-coverage.test.ts is updated to
  // scan .rpc(.
  const { error } = await supabase.rpc("update_allocator_mandates", rpcArgs);

  if (error) {
    console.error("[api/preferences] update_allocator_mandates RPC error:", error);
    if (error.code === "28000") {
      // NEW-C07-02 (audit-2026-05-26 silent-failure): we already verified the
      // user is authenticated via auth.getUser() above. If the RPC then raises
      // 28000 (invalid_authorization_specification), auth.uid() resolved NULL
      // inside Postgres — i.e. the JWT did NOT propagate to PostgREST. That is
      // an infra fault (cookie/session binding bug, mid-request expiry on the
      // PostgREST side, service-client misuse), NOT an unauthenticated request.
      // Returning the same 401 a logged-out user gets collapses the two cases
      // and makes the infra fault invisible to ops (only a console.error, no
      // Sentry event). We treat this as an internal 500 so on-call sees it.
      //
      // F-03 (specialist-review 2026-05-26): the prior `void import(...)` pattern
      // detaches the Sentry promise — same reap risk as audit.ts NEW-C10-03.
      // Await the import chain before returning so the capture is not dropped
      // on a cold-finish before the Sentry SDK flushes.
      await import("@sentry/nextjs").then((Sentry) => {
        try {
          Sentry.captureException(new Error("28000 after getUser — JWT did not propagate to PostgREST"), {
            tags: { rpc_auth_uid_null: "true", route: "preferences.PUT" },
            extra: { rpc: "update_allocator_mandates", errorCode: error.code },
          });
        } catch {
          // Sentry SDK threw — swallow.
        }
      }).catch(() => {});
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 },
      );
    }
    if (error.code === "22023") {
      // H-0299: SQLSTATE 22023 is raised by update_allocator_mandates'
      // bound checks. `error.message` is database-author-controlled text
      // (RPC RAISE strings, possibly with column/parameter names appended
      // by a future Postgres reformat) and must not be forwarded to the
      // client verbatim — sibling routes return constant strings. The TS
      // layer (validateSelfEditableInput) already enforces these bounds and
      // surfaces field-specific messages on the 400 above; reaching this
      // branch means TS/RPC validation drifted, so we return a stable
      // generic message and keep the raw error in the console.error above
      // for ops.
      return NextResponse.json(
        { error: "Invalid mandate value" },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Failed to save mandate" }, { status: 500 });
  }

  // Audit emission — fire-and-forget; grepped by audit-coverage.test.ts.
  logAuditEvent(supabase, {
    action: "mandate_preference.update",
    entity_type: "allocator_preference_mandate",
    entity_id: user.id,
    metadata: { fields: Object.keys(fields), self_edit: true },
  });

  return NextResponse.json({ success: true });
}
