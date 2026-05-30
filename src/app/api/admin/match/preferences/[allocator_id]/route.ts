import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminUser } from "@/lib/admin";
import { assertSameOrigin } from "@/lib/csrf";
import { pickAdminEditableFields, validateAdminEditableInput } from "@/lib/preferences";
import { adminActionLimiter, checkLimit, rateLimitDenyJson } from "@/lib/ratelimit";
import { logAuditEventAsUser } from "@/lib/audit";
import { isUuid } from "@/lib/utils";

// PUT /api/admin/match/preferences/[allocator_id]
// Admin can edit both self-editable AND admin-only fields.
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ allocator_id: string }> },
): Promise<NextResponse> {
  const csrfError = assertSameOrigin(req);
  if (csrfError) return csrfError;

  const { allocator_id } = await params;

  // PR-2 security S-3 (2026-05-28): UUID-validate the URL param BEFORE it
  // crosses into the rate-limit key. Without this, a buggy/malicious admin
  // client can fan out arbitrary random suffixes into Upstash's sliding-
  // window storage (one Redis SORTED SET per unique key), amplifying our
  // Upstash command bill at zero cost to the attacker.
  if (!isUuid(allocator_id)) {
    return NextResponse.json(
      { error: "allocator_id must be a UUID" },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // P444 (audit-2026-05-07) — RFC 7235: 401 unauthenticated, 403 forbidden.
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await isAdminUser(supabase, user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // audit-2026-05-07 H-0222/H-0223 (PR-2 2026-05-28): mutating admin
  // surface MUST consume a rate-limit token. Key scoped per (admin, target
  // allocator) so a buggy admin client running PUT-in-a-loop against one
  // mandate cannot starve a different admin's edits on a different mandate.
  const rl = await checkLimit(
    adminActionLimiter,
    `admin-prefs:${user.id}:${allocator_id}`,
  );
  if (!rl.success) return rateLimitDenyJson(rl);

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

  // Sprint 8 Phase 2 — audit the admin-edited mandate. B4b: the mandate
  // writes above ride the service-role `admin` client (RLS-bypassing), so
  // the audit emits via the service path with the explicit acting-admin id
  // (log_audit_event_service) — JWT-immune, unlike the user-JWT auth.uid()
  // path which can silently drop in the post-response after() window.
  logAuditEventAsUser(admin, user!.id, {
    action: "mandate_preference.admin_update",
    entity_type: "allocator_preference_mandate",
    entity_id: allocator_id,
    metadata: {
      fields: Object.keys(fields),
      self_edit: false,
      edited_by: user!.id,
    },
  });

  // PR-2 code-reviewer I1: capture + log the badge-update result so a
  // silent regression (e.g. RLS drift on profiles) is observable in SRE
  // logs even though it does NOT fail the request. The badge falls out
  // of sync (UI shows stale "last edited" hint) but the mandate change
  // has already landed and been audited above — degrading non-blocking
  // UI metadata is the right tradeoff vs. failing the admin's PUT.
  // @audit-skip: denormalization cache touch — preferences_updated_at on
  // profiles is a UI-badge hint; user-intent audit fired above.
  const { error: badgeErr } = await admin
    .from("profiles")
    .update({ preferences_updated_at: new Date().toISOString() })
    .eq("id", allocator_id);
  if (badgeErr) {
    console.warn(
      "[api/admin/match/preferences/[allocator_id]] preferences_updated_at badge update failed (non-fatal):",
      { allocator_id, code: badgeErr.code, message: badgeErr.message },
    );
  }

  return NextResponse.json({ success: true });
}
