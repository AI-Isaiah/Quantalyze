import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withRole, requireAdmin } from "@/lib/auth";
import { logAuditEvent } from "@/lib/audit";
import {
  adminActionLimiter,
  checkLimit,
  isRateLimitMisconfigured,
} from "@/lib/ratelimit";
import { loadDeletionRequestForAction } from "../_shared";

/**
 * POST /api/admin/deletion-requests/[id]/approve
 *
 * Admin approval of a GDPR Art. 17 deletion request. Wrapped by
 * `withRole("admin")` — the second pilot adopter of the Task 7.2 wrapper
 * (the first being `/api/admin/users/[id]/roles`).
 *
 * Sprint 6 closeout Task 7.3 / audit-2026-05-07 Cluster-K. Flow:
 *   1. Rate-limit (adminActionLimiter, 20/min keyed on admin user id).
 *      Cluster-K C-0032 — sanitize_user is irreversible (migration 055
 *      preserves auth.users, profiles, audit_log per step 3i, but every
 *      OTHER table is anonymized) so a stolen admin session must not be
 *      able to fire hundreds of approves in one burst.
 *   2. Load the deletion request row; reject if not found, already
 *      completed, or already rejected.
 *   3. Call `sanitize_user(target_user_id)` via the admin client — the
 *      RPC is SECURITY DEFINER, service_role-only EXECUTE (migration
 *      055).
 *   4. Emit `account.sanitize` audit IMMEDIATELY after the RPC returns
 *      (Cluster-K H-0216 / M-0265 — the destructive step has already
 *      happened, so its forensic record must not be gated on the
 *      downstream completed_at UPDATE succeeding).
 *   5. Mark the request `completed_at = now()` with a compare-and-swap
 *      `WHERE id=$1 AND completed_at IS NULL` predicate. Two admins
 *      racing the same request will both pass loadDeletionRequest (no
 *      row lock) and both call sanitize_user (idempotent), but only ONE
 *      UPDATE will affect a row — the loser sees affectedRows=0 and
 *      skips the approve audit event (Cluster-K C-0033 / H-0217 — no
 *      duplicate `approved_by` rows in audit_log).
 *   6. Emit `deletion.request.approve` audit only when the CAS won.
 *
 * Both audit events are emitted through the USER-scoped supabase client
 * supplied by `withRole` via the handler context so that `auth.uid()`
 * inside log_audit_event resolves to the acting admin's id — the
 * audit-trail invariant from ADR-0023.
 *
 * Idempotency: sanitize_user is itself idempotent (migration 055), so a
 * re-run on the same request is safe. The CAS keeps us from re-emitting
 * the deletion.request.approve audit on a duplicate click while still
 * letting account.sanitize record both `was_first_run: true` (the call
 * that actually anonymized) and `was_first_run: false` (the idempotent
 * re-run) — both are honest forensic signal.
 */

export const POST = withRole<{ id: string }>("admin")(
  async (
    req: NextRequest,
    { user, supabase, params },
  ) => {
    const requestId = params?.id;

    // Cluster-K C-0032: rate-limit BEFORE doing any work. Key on the
    // admin user id (not IP) so a stolen-session attacker behind a
    // single admin account can't burst through the cap by rotating
    // IPs. adminActionLimiter is 20/min — well above legitimate
    // operator cadence (queue review pace) and well below the
    // hundreds-per-second a script could fire.
    const rl = await checkLimit(
      adminActionLimiter,
      `del-approve:${user.id}`,
    );
    if (!rl.success) {
      if (isRateLimitMisconfigured(rl)) {
        return NextResponse.json(
          { error: "Rate limiting unavailable — try again shortly" },
          {
            status: 503,
            headers: { "Retry-After": String(rl.retryAfter) },
          },
        );
      }
      return NextResponse.json(
        { error: "Too many approve attempts — slow down" },
        {
          status: 429,
          headers: { "Retry-After": String(rl.retryAfter) },
        },
      );
    }

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

    // audit-2026-05-07 P705: TOCTOU close. Re-verify admin status
    // against the unified union source IMMEDIATELY before invoking
    // sanitize_user — the gap between `withRole('admin')` at request
    // entry and the RPC call is wide enough for a concurrent admin
    // revoke to slip through. `requireAdmin` consults the same
    // user_app_roles + profiles.is_admin + ADMIN_EMAIL union as the
    // wrapper, so a revoke that landed during the loadDeletionRequest
    // round-trip is reflected here. The DB-side sentinel trigger
    // inside sanitize_user (migration 120) is the second half of the
    // defense; this TS re-check returns a clean 403 before the RPC
    // fires at all in the common case.
    const adminGuard = await requireAdmin(supabase, user);
    if (adminGuard) return adminGuard;

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

    // Cluster-K H-0216 / M-0265: emit `account.sanitize` IMMEDIATELY
    // after the RPC returns. The destructive step has already happened
    // — sanitize_user is irreversible per migration 055 — so its
    // forensic record must not be gated on the downstream completed_at
    // UPDATE succeeding. If we emitted only after the UPDATE, a network
    // blip on the UPDATE would leave the anonymize un-audited forever
    // (sanitize_user is idempotent, but the audit_log row for the
    // FIRST-run anonymize would never be written — a retry sees
    // was_first_run=false and the actual destruction is invisible).
    //
    // Anchored to the target user (entity_type='user'). was_first_run
    // is the honest signal from sanitize_user's BOOLEAN return.
    logAuditEvent(supabase, {
      action: "account.sanitize",
      entity_type: "user",
      entity_id: reqRow.user_id,
      metadata: {
        request_id: requestId,
        was_first_run: wasFirstRun === true,
      },
    });

    // Cluster-K C-0033 / H-0217: compare-and-swap UPDATE on the
    // completed_at marker. Without the `completed_at IS NULL` predicate
    // two admins racing on the same request would BOTH write completed_at
    // (last-write-wins) and BOTH emit deletion.request.approve with
    // different `approved_by` ids — a regulator asking "who approved
    // this" would see two answers and audit_log is immutable
    // (migration 049 REVOKE UPDATE/DELETE), so the contradiction is
    // permanent. The CAS-WHERE-IS-NULL + .select() returns ONLY the
    // rows the UPDATE actually flipped; the loser sees rowsAffected=0
    // and skips the approve audit event, leaving a single canonical
    // approver in the audit trail.
    const { data: updatedRows, error: updateErr } = await admin
      .from("data_deletion_requests")
      .update({ completed_at: new Date().toISOString() })
      .eq("id", requestId)
      .is("completed_at", null)
      .select("id");
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
    const rowsAffected = Array.isArray(updatedRows) ? updatedRows.length : 0;

    // Audit: approval event (anchored to the request row). Only emit
    // when the CAS won — the loser of a race already saw account.sanitize
    // emitted (idempotent re-run, was_first_run:false), which is the
    // honest signal; we deliberately do NOT also claim they "approved"
    // the request since the winning admin already owns that row.
    if (rowsAffected > 0) {
      logAuditEvent(supabase, {
        action: "deletion.request.approve",
        entity_type: "data_deletion_request",
        entity_id: requestId,
        metadata: {
          target_user_id: reqRow.user_id,
          approved_by: user.id,
        },
      });
    }

    return NextResponse.json({
      success: true,
      request_id: requestId,
      target_user_id: reqRow.user_id,
      was_first_run: wasFirstRun === true,
      // Surface CAS outcome so test/UAT can verify race semantics
      // without having to inspect audit_log directly.
      completed_by_this_call: rowsAffected > 0,
    });
  },
);
