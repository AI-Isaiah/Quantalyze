import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withRole } from "@/lib/auth";
import { logAuditEvent } from "@/lib/audit";

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
    if (!requestId) {
      return NextResponse.json(
        { error: "Missing deletion-request id in path" },
        { status: 400 },
      );
    }

    const admin = createAdminClient();

    // Load the row. We need target_user_id to pass to sanitize_user and
    // the terminal-state guards to avoid double-processing.
    const { data: reqRow, error: readErr } = await admin
      .from("data_deletion_requests")
      .select("id, user_id, requested_at, completed_at, rejected_at")
      .eq("id", requestId)
      .maybeSingle();

    if (readErr) {
      console.error("[admin/deletion-requests/approve] load failed:", readErr);
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

    // Self-action guard: admins cannot approve their own deletion
    // request — another admin must act. Sprint 7.2 set the precedent
    // with the self-revoke block on /api/admin/users/[id]/roles; this
    // applies the same principle to GDPR approve.
    if (reqRow.user_id === user.id) {
      return NextResponse.json(
        {
          error:
            "Admins cannot approve their own deletion request — another admin must act.",
        },
        { status: 403 },
      );
    }

    if (reqRow.completed_at) {
      return NextResponse.json(
        { error: "Deletion request is already completed" },
        { status: 409 },
      );
    }

    if (reqRow.rejected_at) {
      return NextResponse.json(
        { error: "Deletion request was rejected — cannot approve" },
        { status: 409 },
      );
    }

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
