import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { withRole } from "@/lib/auth";
import { logAuditEvent } from "@/lib/audit";
import { loadDeletionRequestForAction } from "../_shared";

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

    // Load the row + run the 7-check preamble (missing id / 500 / 404 /
    // self-action / terminal-state). Self-guard fires before terminal
    // guards — see _shared.ts.
    const loaded = await loadDeletionRequestForAction(
      admin,
      requestId,
      user.id,
      "reject",
    );
    if (!loaded.ok) return loaded.res;
    const reqRow = loaded.row;

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
