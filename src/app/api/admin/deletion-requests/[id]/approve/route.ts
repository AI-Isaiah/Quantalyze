import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withRole, requireAdmin } from "@/lib/auth";
import { emit, logAuditEvent } from "@/lib/audit";
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
 * Sprint 6 closeout Task 7.3 / audit-2026-05-07 Cluster-K + red-team
 * follow-up (2026-05-17). Flow:
 *   1. `requireAdmin(supabase, user)` TOCTOU re-check (red-team-MED
 *      rate-limit-burn-before-toctou — a demoted admin must not touch
 *      the rate-limit bucket before being told 403).
 *   2. Rate-limit (adminActionLimiter, 20/min keyed on admin user id).
 *      Cluster-K C-0032 — sanitize_user is irreversible (migration 055
 *      preserves auth.users, profiles, audit_log per step 3i, but every
 *      OTHER table is anonymized) so a stolen admin session must not be
 *      able to fire hundreds of approves in one burst.
 *   3. Load the deletion request row; reject if not found, already
 *      completed, or already rejected. (Fast-path 7-check — the actual
 *      race close lives in the CAS predicate at step 6.)
 *   4. Call `sanitize_user(target_user_id)` via the admin client — the
 *      RPC is SECURITY DEFINER, service_role-only EXECUTE (migration
 *      055). Caveat: a reject landing between step 3 and this RPC
 *      still fires the destructive call; the CAS in step 6 catches the
 *      logical violation but cannot un-destroy. Defense-in-depth lives
 *      in the migration 20260516160000 CHECK constraint (completed_at
 *      XOR rejected_at) and the sanitize_user sentinel trigger.
 *   5. Emit `account.sanitize` audit SYNCHRONOUSLY (via `emit`)
 *      IMMEDIATELY after the RPC returns (Cluster-K H-0216 / M-0265 +
 *      red-team-MED fire-and-forget-loses-destructive-audit — the
 *      destructive step has already happened, so its forensic record
 *      must not be gated on the downstream completed_at UPDATE
 *      succeeding NOR on a fire-and-forget after() that could swallow a
 *      permission_denied failure into Sentry-only). Metadata includes
 *      `acting_admin` (red-team-HIGH cas-loser-misattribution) so
 *      forensic review can correlate the destructive RPC to the admin
 *      who fired it independent of the CAS-driven `approved_by`.
 *   6. Mark the request `completed_at = now()` with a compare-and-swap
 *      `WHERE id=$1 AND completed_at IS NULL AND rejected_at IS NULL`
 *      predicate. Two admins racing the same request will both pass
 *      loadDeletionRequest (no row lock) and both call sanitize_user
 *      (idempotent), but only ONE UPDATE will affect a row — the loser
 *      sees affectedRows=0 and skips the approve audit event
 *      (Cluster-K C-0033 / H-0217 — no duplicate `approved_by` rows in
 *      audit_log). The `rejected_at IS NULL` arm (red-team-CRITICAL
 *      cas-misses-rejected-at) closes the approve-vs-reject race so a
 *      logically-rejected request cannot end up with completed_at set.
 *   7. Emit `deletion.request.approve` audit only when the CAS won.
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

    // audit-2026-05-07 red-team-MED (rate-limit-burn-before-toctou):
    // Re-verify admin status BEFORE consuming a rate-limit token. The
    // gap between `withRole('admin')` at request entry and the RPC call
    // is wide enough for a concurrent admin revoke to slip through, and
    // if checkLimit fires first a demoted admin (or a malicious actor
    // who knows the revoke is imminent) can burn the legitimate admin's
    // 20/min quota on bursted requests that should have been rejected
    // pre-token-consumption. The two-layer auth gate contract is
    // tightened here: a non-admin should never touch a rate-limit bucket.
    //
    // `requireAdmin` consults the same user_app_roles + profiles.is_admin
    // + ADMIN_EMAIL union as the wrapper. The DB-side sentinel trigger
    // inside sanitize_user (migration 120) is the third half of the
    // defense; this TS re-check returns a clean 403 before either the
    // rate-limit token or the RPC are touched.
    //
    // audit-2026-05-07 red-team (MED conf 8): pass `req` so requireAdmin
    // also re-runs the CSRF same-origin check — defense-in-depth on the
    // mutating POST path. `withRole` already ran the check upstream;
    // the second pass is cheap (one Origin-header comparison, no I/O)
    // and protects against a future refactor that drops the outer CSRF.
    const adminGuard = await requireAdmin(supabase, user, req);
    if (adminGuard) return adminGuard;

    // Cluster-K C-0032: rate-limit BEFORE doing any work. Key on the
    // admin user id (not IP) so a stolen-session attacker behind a
    // single admin account can't burst through the cap by rotating
    // IPs. adminActionLimiter is 20/min — well above legitimate
    // operator cadence (queue review pace) and well below the
    // hundreds-per-second a script could fire. Ordered AFTER the
    // requireAdmin TOCTOU re-check per red-team-MED above.
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
    //
    // audit-2026-05-07 red-team-CRITICAL (cas-misses-rejected-at): the
    // 7-check 'already rejected → 409' guard here is INSUFFICIENT alone
    // — Admin-B's reject can land between THIS load and the CAS UPDATE
    // below, which is why the CAS predicate ALSO checks rejected_at.
    // This load is the fast-path optimisation; the CAS is the actual
    // race close.
    const loaded = await loadDeletionRequestForAction(
      admin,
      requestId,
      user.id,
      "approve",
    );
    if (!loaded.ok) return loaded.res;
    const reqRow = loaded.row;

    // audit-2026-05-07 P705: post-load TOCTOU close. Re-verify admin
    // status IMMEDIATELY before invoking sanitize_user — the gap
    // between the pre-rate-limit `requireAdmin` above and this RPC
    // call (loadDeletionRequest round-trip) is wide enough for a
    // concurrent admin revoke to slip through. The pre-rate-limit
    // check (red-team-MED rate-limit-burn-before-toctou) and this
    // post-load check together cover the full window. The DB-side
    // sentinel trigger inside sanitize_user (migration 120) is the
    // last half of the defense; this TS re-check returns a clean 403
    // before the RPC fires at all in the common case.
    const rpcGuard = await requireAdmin(supabase, user, req);
    if (rpcGuard) return rpcGuard;

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

    // Cluster-K H-0216 / M-0265 + red-team-MED
    // (fire-and-forget-loses-destructive-audit): emit `account.sanitize`
    // SYNCHRONOUSLY (via `emit` not `logAuditEvent`) IMMEDIATELY after
    // the RPC returns. The destructive step has already happened —
    // sanitize_user is irreversible per migration 055 — so its forensic
    // record must not be gated on the downstream completed_at UPDATE
    // succeeding NOR on a fire-and-forget after() that might swallow a
    // permission_denied / unknown failure into Sentry-only after the
    // response has already flushed.
    //
    // `emit` re-throws on permission_denied + unknown (per @/lib/audit.ts
    // L486-537) and swallows transient infra blips. A thrown failure
    // here means destruction happened but the audit row never landed —
    // we return 500 with an operator-alert error so the gap is visible
    // at the HTTP boundary instead of permanently invisible (audit_log
    // is immutable, migration 049 REVOKEs UPDATE/DELETE).
    //
    // red-team-HIGH (cas-loser-misattribution): include `acting_admin`
    // in the metadata so forensic review can correlate the destructive
    // RPC call to the admin who fired it, INDEPENDENT of the CAS-driven
    // `approved_by` on the downstream deletion.request.approve event.
    // Two admins racing produces TWO account.sanitize rows (one with
    // was_first_run=true, one with was_first_run=false) and the
    // acting_admin field anchors each to the admin that ran the RPC.
    try {
      await emit(supabase, {
        action: "account.sanitize",
        entity_type: "user",
        entity_id: reqRow.user_id,
        metadata: {
          request_id: requestId,
          was_first_run: wasFirstRun === true,
          acting_admin: user.id,
        },
      });
    } catch (auditErr) {
      console.error(
        "[admin/deletion-requests/approve] account.sanitize audit emission failed:",
        auditErr,
      );
      return NextResponse.json(
        {
          error:
            "Audit emission failed after destruction — operator alert",
        },
        { status: 500 },
      );
    }

    // Cluster-K C-0033 / H-0217 + red-team-CRITICAL
    // (cas-misses-rejected-at): compare-and-swap UPDATE on the
    // completed_at marker. Without the `completed_at IS NULL` predicate
    // two admins racing on the same request would BOTH write completed_at
    // (last-write-wins) and BOTH emit deletion.request.approve with
    // different `approved_by` ids — a regulator asking "who approved
    // this" would see two answers and audit_log is immutable
    // (migration 049 REVOKE UPDATE/DELETE), so the contradiction is
    // permanent.
    //
    // The CRITICAL addition: ALSO check `rejected_at IS NULL`. Without
    // it, an approve-vs-reject race (Admin-A starts approve, Admin-B
    // starts reject, both pass loadDeletionRequestForAction's 7-check,
    // Admin-B's reject UPDATE lands first setting rejected_at, then
    // Admin-A's sanitize_user RPC IRREVERSIBLY anonymizes the user
    // despite the request being logically rejected) is closed: the CAS
    // sees rejected_at IS NOT NULL → 0 rows affected → Admin-A's branch
    // is the CAS-loser path (200 with completed_by_this_call:false, no
    // approve audit). Per the route docstring caveat, the destructive
    // sanitize_user RPC still fires for Admin-A in that window (no row
    // lock between load and RPC) — the residual is inherent without a
    // DB-side trigger; the CHECK constraint from migration 20260516160000
    // (completed_at XOR rejected_at) is the last-line defense if the
    // CAS itself were ever bypassed.
    const { data: updatedRows, error: updateErr } = await admin
      .from("data_deletion_requests")
      .update({ completed_at: new Date().toISOString() })
      .eq("id", requestId)
      .is("completed_at", null)
      .is("rejected_at", null)
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
    const rowsAffected = (updatedRows ?? []).length;

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
