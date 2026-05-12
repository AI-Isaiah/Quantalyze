import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { withAdminAuth } from "@/lib/api/withAdminAuth";
import { isAdminUser } from "@/lib/admin";
import { assertSameOrigin } from "@/lib/csrf";
import { adminActionLimiter, checkLimit } from "@/lib/ratelimit";
import { notifyAllocatorIntroStatus } from "@/lib/email";
import { logAuditEvent } from "@/lib/audit";

const VALID_STATUSES = ["pending", "intro_made", "completed", "declined"] as const;

// audit-2026-05-07 P197 + P200 — admin POST surface keeps the CSRF + rate-limit
// imports + calls directly in the route file (in addition to the duplicate CSRF
// check inside `withAdminAuth`) so the CI grep gate in
// src/__tests__/admin-csrf-ratelimit-grep.test.ts can verify defense-in-depth
// at the route layer.
//
// Review-fix v0.22.24.1 (C4 / I1 / I2): the outer handler now runs auth
// BEFORE rate-limit. Order is:
//   1. assertSameOrigin            (cheap reject, no DB)
//   2. createClient + getUser      (one auth round-trip; withAdminAuth
//                                   will redo this — see I1; refactoring
//                                   the wrapper is out of scope)
//   3. unauth → 401 immediately    (no rate-limit consumed by anonymous
//                                   callers — addresses I2)
//   4. isAdminUser → non-admin 403 (closes the timing oracle on
//                                   admin-status — addresses C4)
//   5. checkLimit keyed on verified admin user.id (bucket can no longer
//                                   be polluted by non-admin user_ids —
//                                   addresses C4)
//   6. adminHandler (withAdminAuth re-runs the auth checks defense-in-
//                                   depth; the rate-limit budget is now
//                                   guaranteed to belong to a real admin)
const adminHandler = withAdminAuth(async (body, admin) => {
  const { id, status, admin_note } = body;
  if (!id || !VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number])) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const update: Record<string, unknown> = {
    status,
    responded_at: new Date().toISOString(),
  };

  if (typeof admin_note === "string") {
    update.admin_note = admin_note;
  }

  const { error } = await admin
    .from("contact_requests")
    .update(update)
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  // Sprint 6 Task 7.1b — audit the admin-driven status transition. We
  // need a USER-scoped client for log_audit_event (derives acting admin
  // from auth.uid()); withAdminAuth only hands us the service-role
  // `admin` client, so read the user client locally for the audit
  // emission. isAdminUser() already ran inside withAdminAuth so the
  // session is guaranteed valid by the time we get here.
  const auditSupabase = await createClient();
  logAuditEvent(auditSupabase, {
    action: "contact_request.status_change",
    entity_type: "contact_request",
    entity_id: id as string,
    metadata: {
      new_status: status as string,
      has_note: typeof admin_note === "string" && admin_note.length > 0,
    },
  });

  if (status !== "pending") {
    Promise.resolve(
      admin.from("contact_requests").select("allocator_id, strategy_id").eq("id", id).single()
    ).then(async ({ data: request }) => {
      if (!request) return;
      const [{ data: allocator }, { data: strategy }] = await Promise.all([
        admin.from("profiles").select("email").eq("id", request.allocator_id).single(),
        admin.from("strategies").select("name").eq("id", request.strategy_id).single(),
      ]);
      if (allocator?.email && strategy?.name) {
        notifyAllocatorIntroStatus(allocator.email, strategy.name, status as string);
      }
    }).catch((err) =>
      console.error(
        "[admin/intro-request] allocator-status notify failed:",
        err?.message ?? err,
      ),
    );
  }

  return NextResponse.json({ success: true });
});

export async function POST(req: NextRequest) {
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Unauth shortcut — must happen BEFORE the limiter so anonymous
  // callers cannot consume bucket capacity (I2). Matches the pattern
  // already in use by /api/admin/notify-submission.
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Verify admin BEFORE the rate-limit so (a) the bucket is keyed
  // against an established admin identity (no pollution by random
  // signed-in non-admins) and (b) non-admins do not observe a timing
  // transition between the limiter response and the inner auth response
  // that would leak admin-status (C4).
  if (!(await isAdminUser(supabase, user))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const rl = await checkLimit(
    adminActionLimiter,
    `admin:${user.id}:intro-request`,
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

  return adminHandler(req);
}
