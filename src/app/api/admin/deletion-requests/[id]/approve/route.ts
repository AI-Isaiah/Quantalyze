import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withRole } from "@/lib/auth";
import { logAuditEvent } from "@/lib/audit";
import { loadDeletionRequestForAction } from "../_shared";

/**
 * POST /api/admin/deletion-requests/[id]/approve
 *
 * Admin approval of a GDPR Art. 17 deletion request. Wrapped by
 * `withRole("admin")` — the second pilot adopter of the Task 7.2 wrapper
 * (the first being `/api/admin/users/[id]/roles`).
 *
 * Sprint 6 closeout Task 7.3. Flow:
 *   1. Load the deletion request row; reject if not found, already
 *      completed, or already rejected.
 *   2. Call `sanitize_user(target_user_id)` via the admin client — the
 *      RPC is SECURITY DEFINER, service_role-only EXECUTE (migration
 *      055).
 *   3. Mark the request `completed_at = now()`.
 *   4. Emit TWO audit events: `deletion.request.approve` (entity =
 *      data_deletion_request) AND `account.sanitize` (entity = user).
 *
 * Both audit events are emitted through the USER-scoped supabase client
 * supplied by `withRole` via the handler context so that `auth.uid()`
 * inside log_audit_event resolves to the acting admin's id — the
 * audit-trail invariant from ADR-0023.
 *
 * Idempotency: sanitize_user is itself idempotent (migration 055), so a
 * re-run on the same request is safe. The `completed_at IS NOT NULL`
 * guard here keeps us from re-emitting the audit events on a duplicate
 * approval click.
 */

export const POST = withRole<{ id: string }>("admin")(
  async (
    req: NextRequest,
    { user, supabase, params },
  ) => {
    const requestId = params?.id;
    const admin = createAdminClient();

    // Load the row + run the 7-check preamble (missing id / 500 / 404 /
    // self-action / terminal-state). The self-action guard fires before
    // the terminal-state guards — see _shared.ts.
    const loaded = await loadDeletionRequestForAction(
      admin,
      requestId,
      user.id,
      "approve",
    );
    if (!loaded.ok) return loaded.res;
    const reqRow = loaded.row;

    // Fire the anonymize RPC. Returns BOOLEAN: TRUE on the first-run
    // anonymize, FALSE on idempotent re-run (already sanitized). Either
    // is success — the audit event records `was_first_run` so forensic
    // review can distinguish.
    const { data: wasFirstRun, error: rpcErr } = await admin.rpc(
      "sanitize_user",
      { p_user_id: reqRow.user_id },
    );
    if (rpcErr) {
      console.error(
        "[admin/deletion-requests/approve] sanitize_user failed:",
        rpcErr,
      );
      return NextResponse.json(
        { error: "Sanitize failed" },
        { status: 500 },
      );
    }

    // Mark the request completed. Idempotent via the completed_at guard
    // above — if two admins race on the same request, only one will
    // emit the audit events (the second gets the 409 already-completed).
    const { error: updateErr } = await admin
      .from("data_deletion_requests")
      .update({ completed_at: new Date().toISOString() })
      .eq("id", requestId);
    if (updateErr) {
      console.error(
        "[admin/deletion-requests/approve] update completed_at failed:",
        updateErr,
      );
      return NextResponse.json(
        { error: "Failed to mark request completed" },
        { status: 500 },
      );
    }

    // Audit: approval event (anchored to the request row)
    logAuditEvent(supabase, {
      action: "deletion.request.approve",
      entity_type: "data_deletion_request",
      entity_id: requestId,
      metadata: {
        target_user_id: reqRow.user_id,
        approved_by: user.id,
      },
    });

    // Audit: the sanitize itself (anchored to the target user).
    // `was_first_run` is the honest forensic signal from sanitize_user's
    // BOOLEAN return (migration 055): TRUE means this call did the
    // anonymize, FALSE means it was a no-op re-run or the profile was
    // absent. Replaces the prior `mutated_rows` metadata which was
    // forensically useless (only incremented for 2 of ~15 mutations).
    logAuditEvent(supabase, {
      action: "account.sanitize",
      entity_type: "user",
      entity_id: reqRow.user_id,
      metadata: {
        request_id: requestId,
        was_first_run: wasFirstRun === true,
      },
    });

    return NextResponse.json({
      success: true,
      request_id: requestId,
      target_user_id: reqRow.user_id,
      was_first_run: wasFirstRun === true,
    });
  },
);
