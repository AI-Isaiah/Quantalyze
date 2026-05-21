import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { assertSameOrigin } from "@/lib/csrf";
import { assertProfileApproved } from "@/lib/api/approval-gate";
import {
  pickSelfEditableFields,
  validateSelfEditableInput,
  getOwnPreferences,
} from "@/lib/preferences";
import { mandateAutoSaveLimiter, checkLimit } from "@/lib/ratelimit";
import { logAuditEvent } from "@/lib/audit";

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
  const rpcArgs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === null) {
      clearFields.push(key);
    } else {
      rpcArgs[`p_${key}`] = value;
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
      return NextResponse.json({ error: error.message }, { status: 400 });
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
