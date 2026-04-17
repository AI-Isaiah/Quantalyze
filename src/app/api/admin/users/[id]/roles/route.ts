import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { withRole, APP_ROLES, type AppRole } from "@/lib/auth";
import { logAuditEvent } from "@/lib/audit";

/**
 * Admin role provisioning endpoint.
 *
 * Sprint 6 closeout Task 7.2 — pilot route for `withRole("admin")`.
 *
 * POST /api/admin/users/[id]/roles
 *   Body: { action: "grant" | "revoke", role: AppRole }
 *   200 on success, 400 on invalid body, 403 if caller lacks admin role.
 *
 * Why this is the pilot for withRole
 * ----------------------------------
 * Task 7.2's spec scopes broad `withRole` adoption to Sprint 7 — this
 * route is the single end-to-end proof of the wrapper's integration with
 * the Next 16 route handler shape (dynamic `{ params }` threaded through
 * the wrapper's context), CSRF check, and audit-event emission path. The
 * rest of the admin surface continues to use `withAdminAuth` (which reads
 * `profiles.is_admin` via `isAdminUser()`) unchanged.
 *
 * Audit emission
 * --------------
 * Both grant and revoke emit audit events via `logAuditEvent`. The
 * entity_type is `user_app_role` and entity_id is the TARGET user id
 * (the user being granted/revoked), not the row id of user_app_roles —
 * a (user_id, role) composite-key row doesn't have a stable UUID to
 * anchor on. Metadata carries the {role, granted_by|revoked_by} tuple.
 *
 * We emit through the USER-scoped supabase client supplied by `withRole`
 * via the handler context so that `auth.uid()` inside the log_audit_event
 * RPC resolves to the acting admin's id. `createAdminClient()` is used
 * only for the user_app_roles mutation itself (service-role bypasses
 * the user_app_roles_service_insert policy).
 */

const BODY_SCHEMA = z.object({
  action: z.enum(["grant", "revoke"]),
  role: z.enum(APP_ROLES as unknown as [AppRole, ...AppRole[]]),
});

export const POST = withRole<{ id: string }>("admin")(
  async (
    req: NextRequest,
    { user, supabase, params },
  ) => {
    const targetUserId = params?.id;

    if (!targetUserId) {
      return NextResponse.json(
        { error: "Missing target user id in path" },
        { status: 400 },
      );
    }

    const rawBody = await req.json().catch(() => null);
    const parsed = BODY_SCHEMA.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const { action, role } = parsed.data;

    // Hard rail: an admin cannot revoke their own admin role via this
    // endpoint. This prevents a self-lockout and closes a narrow race
    // where an admin UI accidentally shows a revoke button for the
    // current user's own admin row. A second admin with service-role
    // credentials can still demote the first admin via a direct RPC or
    // migration if genuinely needed.
    if (
      action === "revoke" &&
      role === "admin" &&
      targetUserId === user.id
    ) {
      return NextResponse.json(
        { error: "Admins cannot revoke their own admin role" },
        { status: 400 },
      );
    }

    const admin = createAdminClient();

    if (action === "grant") {
      // ON CONFLICT DO NOTHING via upsert — a repeat grant is a no-op,
      // not an error. We still emit the audit event so the operator
      // trail reflects the intent, even on a re-grant.
      const { error } = await admin.from("user_app_roles").upsert(
        {
          user_id: targetUserId,
          role,
          granted_by: user.id,
          granted_at: new Date().toISOString(),
        },
        { onConflict: "user_id,role", ignoreDuplicates: true },
      );
      if (error) {
        console.error("[admin/users/roles] grant failed:", {
          target_user_id: targetUserId,
          role,
          code: error.code,
          message: error.message,
        });
        return NextResponse.json(
          { error: "Grant failed" },
          { status: 500 },
        );
      }

      // Audit. Fire-and-forget — logAuditEvent returns void.
      // The supabase client here is the user-scoped client supplied by
      // withRole: auth.uid() inside log_audit_event resolves to the
      // acting admin's id, which is the audit-trail invariant.
      logAuditEvent(supabase, {
        action: "role.grant",
        entity_type: "user_app_role",
        entity_id: targetUserId,
        metadata: { role, granted_by: user.id },
      });

      return NextResponse.json({ success: true, action, role });
    }

    // action === "revoke"
    const { error, count } = await admin
      .from("user_app_roles")
      .delete({ count: "exact" })
      .eq("user_id", targetUserId)
      .eq("role", role);

    if (error) {
      console.error("[admin/users/roles] revoke failed:", {
        target_user_id: targetUserId,
        role,
        code: error.code,
        message: error.message,
      });
      return NextResponse.json(
        { error: "Revoke failed" },
        { status: 500 },
      );
    }

    logAuditEvent(supabase, {
      action: "role.revoke",
      entity_type: "user_app_role",
      entity_id: targetUserId,
      metadata: { role, revoked_by: user.id, removed_rows: count ?? 0 },
    });

    return NextResponse.json({
      success: true,
      action,
      role,
      removed_rows: count ?? 0,
    });
  },
);
