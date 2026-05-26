import { NextRequest, NextResponse } from "next/server";
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
  checkLimit,
  isRateLimitMisconfigured,
} from "@/lib/ratelimit";
import { logAuditEvent } from "@/lib/audit";

/**
 * RPC parameter bag for `update_allocator_mandates`. Each non-null
 * self-editable field is passed as a `p_<field>` named parameter; keys the
 * caller explicitly sent as `null` are collected into `p_clear_fields` (the
 * Reset affordance — see the null-to-clear transform below). Typing the bag
 * (H-0297) keeps the parameter names in sync with the RPC signature at
 * compile time instead of failing at runtime with SQLSTATE 22023 if a key
 * drifts. `Partial` because each PUT only carries the fields the caller
 * touched; `p_clear_fields` is present only when at least one field is reset.
 */
type MandateRpcArgs = Partial<{
  p_mandate_archetype: string;
  p_target_ticket_size_usd: number;
  p_excluded_exchanges: string[];
  p_max_weight: number;
  p_preferred_strategy_types: string[];
  p_correlation_ceiling: number;
  p_max_drawdown_tolerance: number;
  // Mirrors the generated `Args` type for update_allocator_mandates in
  // src/lib/database.types.ts (p_liquidity_preference?: string). The
  // high/medium/low enum is enforced upstream by validateSelfEditableInput.
  p_liquidity_preference: string;
  p_style_exclusions: string[];
  p_clear_fields: string[];
}>;

export async function GET(): Promise<NextResponse> {
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

  try {
    const prefs = await getOwnPreferences(supabase, user.id);
    return NextResponse.json({ preferences: prefs });
  } catch (err) {
    console.error("[api/preferences] GET error:", err);
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

  const rl = await checkLimit(mandateAutoSaveLimiter, `preferences:${user.id}`);
  if (!rl.success) {
    // M-1108: a null limiter in production (missing UPSTASH env) fails CLOSED
    // with reason:'ratelimit_misconfigured'. Translate that to 503 so the
    // outage surfaces to canary/health checks rather than masquerading as
    // ordinary user-side throttling — useMandateAutoSave honors Retry-After
    // and re-fires on 429, so a misconfig presented as 429 would loop
    // silently on every mandate edit. Mirrors src/app/api/simulator/route.ts.
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
      // whitelists it) and `value` passed validateSelfEditableInput, so the
      // `p_<field>` parameter and its type line up with MandateRpcArgs. The
      // single assertion here is the one boundary where the per-field union
      // collapses; the typed bag (H-0297) constrains every read after it.
      (rpcArgs as Record<string, unknown>)[`p_${key}`] = value;
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
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
