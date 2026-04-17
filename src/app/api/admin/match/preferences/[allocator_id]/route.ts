import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminUser } from "@/lib/admin";
import { assertSameOrigin } from "@/lib/csrf";
import { pickAdminEditableFields, validateAdminEditableInput } from "@/lib/preferences";
import { logAuditEvent } from "@/lib/audit";

// PUT /api/admin/match/preferences/[allocator_id]
// Admin can edit both self-editable AND admin-only fields.
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ allocator_id: string }> },
): Promise<NextResponse> {
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;

  const { allocator_id } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!(await isAdminUser(supabase, user))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Whitelist to admin-editable fields (self + admin-only)
  const fields = pickAdminEditableFields(body);
  const validationError = validateAdminEditableInput(fields);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("allocator_preferences")
    .upsert(
      {
        user_id: allocator_id,
        ...fields,
        edited_by_user_id: user!.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

  if (error) {
    console.error("[api/admin/match/preferences/[allocator_id]] error:", error);
    return NextResponse.json({ error: "Failed to save preferences" }, { status: 500 });
  }

  // Sprint 6 Task 7.1b — audit the admin-edited preferences. user-scoped
  // `supabase` client already bound to the acting admin; log_audit_event
  // derives the acting admin from auth.uid().
  logAuditEvent(supabase, {
    action: "notification_preferences.update",
    entity_type: "user",
    entity_id: allocator_id,
    metadata: {
      fields: Object.keys(fields),
      self_edit: false,
      edited_by: user!.id,
    },
  });

  // @audit-skip: denormalization cache touch. The preferences_updated_at
  // column on profiles is a UI-badge hint; the user-intent audit event
  // was emitted above on the allocator_preferences upsert.
  await admin
    .from("profiles")
    .update({ preferences_updated_at: new Date().toISOString() })
    .eq("id", allocator_id);

  return NextResponse.json({ success: true });
}
