import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminUser } from "@/lib/admin";
import { assertSameOrigin } from "@/lib/csrf";
import { adminActionLimiter, checkLimit } from "@/lib/ratelimit";
import { logAuditEvent } from "@/lib/audit";
import { notifyUserSignupApproved } from "@/lib/email";

// audit-2026-05-07 P199 + P200 — see intro-request/route.ts for the rationale.
// v0.22.24.2 review-fix: handler body inlined to drop the withAdminAuth
// indirection (avoids a second createClient + getUser + isAdminUser round-trip
// per request — red-team HIGH conf 7).
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
  // P444 (audit-2026-05-07) — 403 body says "Forbidden", not "Unauthorized".
  if (!(await isAdminUser(supabase, user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rl = await checkLimit(
    adminActionLimiter,
    `admin:${user.id}:allocator-approve`,
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
  if (!id) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { error } = await admin
    .from("profiles")
    .update({ allocator_status: "verified" })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  // Sprint 6 Task 7.1b — audit the allocator approval. Use the user-scoped
  // `supabase` client so log_audit_event resolves auth.uid() to the acting
  // admin's id. PR #266 red-team: `await` instead of fire-and-forget so a
  // failed audit insert surfaces as a 500 rather than a silent drop —
  // non-repudiation depends on the trail.
  await logAuditEvent(supabase, {
    action: "allocator.approve",
    entity_type: "user",
    entity_id: id as string,
    metadata: { new_status: "verified" },
  });

  // PR #266 red-team: notify the user their signup is approved. The
  // /pending-approval page promises this email; previously no helper
  // existed and the promise was silently broken.
  //
  // SF-F6: check the SELECT error explicitly — the pre-fix code discarded
  // the .error field entirely. A Supabase network error or PGRST116 (row
  // not found) silently skipped the notification and returned 200, while
  // throwOnFailure=true was set on send() implying reliable delivery.
  const { data: approvedProfile, error: profileErr } = await admin
    .from("profiles")
    .select("role, email")
    .eq("id", id as string)
    .single();
  if (profileErr || !approvedProfile?.email || !approvedProfile.role) {
    console.error("[allocator-approve] profile lookup failed, notification skipped:", {
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
  // is already committed at this point — letting the throw propagate as an
  // unhandled exception would return a raw 500 to the admin UI, signalling
  // failure on an operation that SUCCEEDED, causing likely retry and a
  // duplicate audit row. Catch, log, and return 200 with an email_warning
  // field so the admin UI can surface "Approved — email failed, check logs"
  // without re-submitting the approval.
  try {
    await notifyUserSignupApproved(
      approvedProfile.email as string,
      approvedProfile.role as "allocator" | "manager" | "both",
    );
  } catch (emailErr) {
    console.error("[allocator-approve] notification email failed (approval already committed):", {
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
