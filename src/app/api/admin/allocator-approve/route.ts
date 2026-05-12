import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { withAdminAuth } from "@/lib/api/withAdminAuth";
import { isAdminUser } from "@/lib/admin";
import { assertSameOrigin } from "@/lib/csrf";
import { adminActionLimiter, checkLimit } from "@/lib/ratelimit";
import { logAuditEvent } from "@/lib/audit";

// audit-2026-05-07 P199 + P200 — see intro-request/route.ts for the rationale
// on keeping the CSRF + rate-limit imports + calls in this file alongside the
// `withAdminAuth` wrapper, AND for the v0.22.24.1 review-fix order
// (assertSameOrigin → auth → admin gate → rate-limit) that closes the
// timing-oracle + bucket-pollution + unauth-bypass holes (C4 / I1 / I2).
const adminHandler = withAdminAuth(async (body, admin) => {
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

  // Sprint 6 Task 7.1b — audit the allocator approval. entity is the
  // target user's profile id. withAdminAuth hands us the service-role
  // `admin` client; grab a user-scoped client locally so log_audit_event
  // resolves auth.uid() to the acting admin's id.
  const auditSupabase = await createClient();
  logAuditEvent(auditSupabase, {
    action: "allocator.approve",
    entity_type: "user",
    entity_id: id as string,
    metadata: { new_status: "verified" },
  });

  return NextResponse.json({ success: true });
});

export async function POST(req: NextRequest) {
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Unauth shortcut before the limiter (I2).
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Admin gate before the limiter — closes the timing oracle + bucket
  // pollution by non-admins (C4).
  if (!(await isAdminUser(supabase, user))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
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

  return adminHandler(req);
}
