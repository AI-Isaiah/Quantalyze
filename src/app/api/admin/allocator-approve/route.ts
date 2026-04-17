import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { withAdminAuth } from "@/lib/api/withAdminAuth";
import { logAuditEvent } from "@/lib/audit";

export const POST = withAdminAuth(async (body, admin) => {
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
