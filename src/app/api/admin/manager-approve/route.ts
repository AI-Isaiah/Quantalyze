import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminUser } from "@/lib/admin";
import { assertSameOrigin } from "@/lib/csrf";
import { adminActionLimiter, checkLimit } from "@/lib/ratelimit";
import { logAuditEventAsUser } from "@/lib/audit";
import { notifyUserSignupApproved } from "@/lib/email";

/**
 * POST /api/admin/manager-approve — task #14 sibling of allocator-approve.
 *
 * Mirrors src/app/api/admin/allocator-approve/route.ts but writes
 * `manager_status='verified'` instead of `allocator_status='verified'`.
 * Kept as a separate route (rather than generalising to one user-approve
 * endpoint with a status-field switch) because:
 *   - the audit event `kind` differs (manager.approve vs allocator.approve),
 *   - the rate-limit bucket differs (`admin:<id>:manager-approve` vs the
 *     allocator key), so abuse on one surface does not cap the other,
 *   - admin code-readers can grep for "manager_status" and "allocator_status"
 *     independently when tracking down a role-specific regression.
 *
 * The role='both' case is covered by calling BOTH endpoints from the admin
 * UI; that keeps each route's status-mutation surface narrow.
 */

export async function POST(req: NextRequest) {
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await isAdminUser(supabase, user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rl = await checkLimit(
    adminActionLimiter,
    `admin:${user.id}:manager-approve`,
  );
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfter) },
      },
    );
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json(
        { error: "Request body must be a JSON object" },
        { status: 400 },
      );
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { id } = body;
  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { error } = await admin
    .from("profiles")
    .update({ manager_status: "verified" })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  // B4b: the manager-status UPDATE above rides the service-role `admin`
  // client, so the audit emits via the service path with the explicit
  // acting-admin id (log_audit_event_service) — JWT-immune. Fire-and-forget:
  // it runs in after() AFTER the response flushes and does NOT gate the HTTP
  // status. (The prior PR #266 `await logAuditEvent` implied a 500-on-failure
  // guard, but the wrapper returns void so the await was a no-op — that guard
  // never existed; failures are Sentry-reported. Hard gating via
  // `await emitAsUser` is a separate decision.)
  logAuditEventAsUser(admin, user.id, {
    action: "manager.approve",
    entity_type: "user",
    entity_id: id,
    metadata: { new_status: "verified" },
  });

  // PR #266 red-team: notify the user their signup is approved.
  //
  // SF-F6: check the SELECT error explicitly — the pre-fix code discarded
  // the .error field entirely. See allocator-approve/route.ts for the full
  // rationale.
  const { data: approvedProfile, error: profileErr } = await admin
    .from("profiles")
    .select("role, email")
    .eq("id", id)
    .single();
  if (profileErr || !approvedProfile?.email || !approvedProfile.role) {
    console.error("[manager-approve] profile lookup failed, notification skipped:", {
      id,
      error: profileErr?.message,
      hasEmail: !!approvedProfile?.email,
      hasRole: !!approvedProfile?.role,
    });
    return NextResponse.json(
      { success: true, email_warning: "Account approved but notification lookup failed." },
      { status: 200 },
    );
  }

  // C1 / SF-F1: wrap notifyUserSignupApproved in try/catch. The DB approval
  // is already committed — an unhandled throw returns a raw 500, signalling
  // failure on a committed operation, causing likely admin retry and a
  // duplicate audit row. See allocator-approve/route.ts for full rationale.
  try {
    await notifyUserSignupApproved(
      approvedProfile.email as string,
      approvedProfile.role as "allocator" | "manager" | "both",
    );
  } catch (emailErr) {
    console.error("[manager-approve] notification email failed (approval already committed):", {
      id,
      role: approvedProfile.role,
      error: emailErr instanceof Error ? emailErr.message : String(emailErr),
    });
    return NextResponse.json(
      { success: true, email_warning: "Account approved but notification email failed." },
      { status: 200 },
    );
  }

  return NextResponse.json({ success: true });
}
