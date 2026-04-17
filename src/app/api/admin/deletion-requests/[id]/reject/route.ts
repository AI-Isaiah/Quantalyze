import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { withRole } from "@/lib/auth";
import { logAuditEvent } from "@/lib/audit";

/**
 * POST /api/admin/deletion-requests/[id]/reject
 *
 * Admin rejection of a GDPR Art. 17 deletion request. Wrapped by
 * `withRole("admin")` — the second pilot adopter of the Task 7.2 wrapper.
 *
 * Sprint 6 closeout Task 7.3. Flow:
 *   1. Load the deletion request row; reject if not found, already
 *      completed, or already rejected.
 *   2. Mark the request `rejected_at = now()` + optional reason.
 *   3. Emit a `deletion.request.reject` audit event.
 *
 * The audit is emitted via the user-scoped client (from the handler
 * context) so `auth.uid()` inside log_audit_event resolves to the
 * acting admin's id — same pattern as the pilot role-grant route and
 * the approve sibling route.
 */

const BODY_SCHEMA = z.object({
  reason: z.string().trim().max(1000).optional(),
});

export const POST = withRole<{ id: string }>("admin")(
  async (
    req: NextRequest,
    { user, supabase, params },
  ) => {
    const requestId = params?.id;
    if (!requestId) {
      return NextResponse.json(
        { error: "Missing deletion-request id in path" },
        { status: 400 },
      );
    }

    const rawBody = await req.json().catch(() => ({}));
    const parsed = BODY_SCHEMA.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const { reason } = parsed.data;

    const admin = createAdminClient();

    const { data: reqRow, error: readErr } = await admin
      .from("data_deletion_requests")
      .select("id, user_id, requested_at, completed_at, rejected_at")
      .eq("id", requestId)
      .maybeSingle();

    if (readErr) {
      console.error("[admin/deletion-requests/reject] load failed:", readErr);
      return NextResponse.json(
        { error: "Failed to load deletion request" },
        { status: 500 },
      );
    }

    if (!reqRow) {
      return NextResponse.json(
        { error: "Deletion request not found" },
        { status: 404 },
      );
    }

    if (reqRow.completed_at) {
      return NextResponse.json(
        { error: "Deletion request is already completed — cannot reject" },
        { status: 409 },
      );
    }

    if (reqRow.rejected_at) {
      return NextResponse.json(
        { error: "Deletion request is already rejected" },
        { status: 409 },
      );
    }

    const { error: updateErr } = await admin
      .from("data_deletion_requests")
      .update({
        rejected_at: new Date().toISOString(),
        rejection_reason: reason ?? null,
      })
      .eq("id", requestId);
    if (updateErr) {
      console.error(
        "[admin/deletion-requests/reject] update rejected_at failed:",
        updateErr,
      );
      return NextResponse.json(
        { error: "Failed to mark request rejected" },
        { status: 500 },
      );
    }

    logAuditEvent(supabase, {
      action: "deletion.request.reject",
      entity_type: "data_deletion_request",
      entity_id: requestId,
      metadata: {
        target_user_id: reqRow.user_id,
        rejected_by: user.id,
        reason: reason ?? null,
      },
    });

    return NextResponse.json({
      success: true,
      request_id: requestId,
      target_user_id: reqRow.user_id,
    });
  },
);
