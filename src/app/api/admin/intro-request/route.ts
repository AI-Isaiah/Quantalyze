import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { withAdminAuth } from "@/lib/api/withAdminAuth";
import { notifyAllocatorIntroStatus } from "@/lib/email";
import { logAuditEvent } from "@/lib/audit";

const VALID_STATUSES = ["pending", "intro_made", "completed", "declined"] as const;

export const POST = withAdminAuth(async (body, admin) => {
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
    }).catch(() => {});
  }

  return NextResponse.json({ success: true });
});
