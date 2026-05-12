import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminUser } from "@/lib/admin";
import { assertSameOrigin } from "@/lib/csrf";
import { adminActionLimiter, checkLimit } from "@/lib/ratelimit";
import { notifyAllocatorIntroStatus } from "@/lib/email";
import { logAuditEvent } from "@/lib/audit";

const VALID_STATUSES = ["pending", "intro_made", "completed", "declined"] as const;

// audit-2026-05-07 P197 + P200 — admin POST surface keeps the CSRF + rate-limit
// imports + calls directly in the route file so the CI grep gate in
// src/__tests__/admin-csrf-ratelimit-grep.test.ts can verify defense-in-depth
// at the route layer.
//
// Review-fix v0.22.24.2 (red-team HIGH conf 7): handler body inlined to drop
// the withAdminAuth indirection. The outer POST proves the user is admin and
// applies the rate limit; we then parse the body and create the service-role
// admin client locally instead of re-running auth via withAdminAuth.
//
// Order:
//   1. assertSameOrigin            (cheap reject, no DB)
//   2. createClient + getUser      (one auth round-trip)
//   3. unauth → 401 immediately    (no rate-limit consumed by anonymous callers)
//   4. isAdminUser → non-admin 403 (closes timing oracle on admin-status)
//   5. checkLimit keyed on verified admin user.id (bucket can no longer be
//                                   polluted by non-admin user_ids)
//   6. parse JSON body
//   7. createAdminClient (service-role) for privileged DB writes
//   8. business logic — uses already-resolved admin client + audit context
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

  // Sprint 6 Task 7.1b — audit the admin-driven status transition. We need a
  // USER-scoped client for log_audit_event (derives acting admin from
  // auth.uid()); admin client is service-role.
  logAuditEvent(supabase, {
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
}
