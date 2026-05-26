import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { withRole, requireAdmin } from "@/lib/auth";
import { logAuditEventAsUser } from "@/lib/audit";
import {
  adminActionLimiter,
  checkLimit,
  isRateLimitMisconfigured,
} from "@/lib/ratelimit";
import { loadDeletionRequestForAction } from "../_shared";

/**
 * POST /api/admin/deletion-requests/[id]/reject
 *
 * Admin rejection of a GDPR Art. 17 deletion request. Wrapped by
 * `withRole("admin")` — sibling pilot adopter alongside `/approve`. The
 * first pilot was `/api/admin/users/[id]/roles`; this pair was added
 * together by Sprint 6 closeout Task 7.3.
 *
 * Sprint 6 closeout Task 7.3 + audit-2026-05-07 red-team
 * (reject-asymmetry-vs-approve-hardening, 2026-05-17). Flow MIRRORS the
 * approve sibling so the destructive-workflow surface area is symmetric
 * against stolen-session attackers — an attacker reading the changelog
 * for the approve route cannot pivot to /reject as a wide-open back
 * door for permanent denial-of-deletion against pending Art. 17
 * requests (rejected_at + rejection_reason are RLS-bypassed via
 * service-role and the user must file a NEW request to re-try; they
 * cannot clear the rejection themselves).
 *
 *   1. `requireAdmin(supabase, user)` TOCTOU re-check BEFORE rate-limit
 *      consumption — mirrors the approve route's red-team-MED ordering
 *      so a demoted-mid-session admin cannot burn the legitimate
 *      admin's quota.
 *   2. Rate-limit (`adminActionLimiter`, 20/min keyed on admin user id)
 *      — mirrors approve's Cluster-K C-0032 so a stolen admin session
 *      cannot burst-REJECT every pending DSR in one request.
 *   3. Load the deletion request row; reject if not found, already
 *      completed, or already rejected. (Fast-path 7-check — the actual
 *      race close lives in the CAS predicate at step 4.)
 *   4. Mark the request `rejected_at = now()` with a compare-and-swap
 *      `WHERE id=$1 AND completed_at IS NULL AND rejected_at IS NULL`
 *      predicate. Two admins racing the same request (reject vs.
 *      reject, or reject vs. approve in the OPPOSITE direction from
 *      approve's red-team-CRITICAL race) will both pass the load but
 *      only ONE UPDATE will affect a row — the loser sees
 *      affectedRows=0 and skips the reject audit event so audit_log
 *      doesn't carry two different `rejected_by` admins.
 *   5. Emit `deletion.request.reject` audit only when the CAS won.
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

    // audit-2026-05-07 red-team-HIGH (reject-asymmetry-vs-approve-hardening):
    // requireAdmin TOCTOU re-check BEFORE consuming a rate-limit token.
    // Mirrors approve's red-team-MED ordering — a demoted admin must
    // not touch the rate-limit bucket before being told 403.
    //
    // NEW-C36-01 (audit 2026-05-26, LOW conf-9): pass `req` so requireAdmin
    // re-runs assertSameOrigin as a defense-in-depth CSRF arm on this
    // mutating path — matching the symmetry the docstring claims and that
    // approve already enforces. Without `req`, a future refactor that drops
    // the outer withRole CSRF wrapper would leave this irreversible-adjacent
    // path (permanent Art. 17 denial) with zero CSRF defense while approve
    // remains protected. The req arg is optional on requireAdmin (so older
    // callers remain compatible); new mutating call sites MUST pass it.
    const adminGuard = await requireAdmin(supabase, user, req);
    if (adminGuard) return adminGuard;

    // audit-2026-05-07 red-team-HIGH (reject-asymmetry-vs-approve-hardening):
    // Rate-limit BEFORE the destructive rejected_at write. Mirrors
    // approve's Cluster-K C-0032 — a stolen admin session must not be
    // able to fire hundreds of rejects in one burst (each one is a
    // permanent denial-of-deletion against an Art. 17 request).
    // Identifier is `del-reject:${user.id}` (per-user bucket, separate
    // from the `del-approve:` bucket so the two paths share the 20/min
    // policy independently).
    const rl = await checkLimit(
      adminActionLimiter,
      `del-reject:${user.id}`,
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
        { error: "Too many reject attempts — slow down" },
        {
          status: 429,
          headers: { "Retry-After": String(rl.retryAfter) },
        },
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

    // audit-2026-05-07 red-team-HIGH (reject-asymmetry-vs-approve-hardening):
    // compare-and-swap UPDATE on the rejected_at marker. The
    // `completed_at IS NULL AND rejected_at IS NULL` predicate closes
    // the race where (a) two admins both reject the same request
    // simultaneously (both would emit deletion.request.reject with
    // different `rejected_by` ids without the CAS — duplicate
    // attribution in an immutable audit_log per migration 049), and
    // (b) the approve-then-reject race where Admin-B's approve lands
    // between Admin-A's load and Admin-A's UPDATE (CAS catches that
    // completed_at IS NOT NULL → 0 rows affected, no false reject
    // audit on an already-completed destruction).
    const { data: updatedRows, error: updateErr } = await admin
      .from("data_deletion_requests")
      .update({
        rejected_at: new Date().toISOString(),
        rejection_reason: reason ?? null,
      })
      .eq("id", requestId)
      .is("completed_at", null)
      .is("rejected_at", null)
      .select("id");
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
    const rowsAffected = (updatedRows ?? []).length;

    // Audit: rejection event (anchored to the request row). Only emit
    // when the CAS won — the loser of a race has nothing honest to
    // claim about who rejected the request (the winning admin already
    // owns that row).
    //
    // NEW-C10-01 (audit-2026-05-26 security): switched from logAuditEvent
    // (user-scoped, deferred after()) to logAuditEventAsUser (service-role)
    // so the RPC does not depend on auth.uid() resolving from an admin JWT
    // that may expire between response flush and after() settle. Deletion
    // rejection is a security-critical write — a missed audit row is
    // unacceptable.
    if (rowsAffected > 0) {
      logAuditEventAsUser(admin, user.id, {
        action: "deletion.request.reject",
        entity_type: "data_deletion_request",
        entity_id: requestId,
        metadata: {
          target_user_id: reqRow.user_id,
          rejected_by: user.id,
          reason: reason ?? null,
        },
      });
    }

    return NextResponse.json({
      success: true,
      request_id: requestId,
      target_user_id: reqRow.user_id,
      // Surface CAS outcome so test/UAT can verify race semantics
      // without having to inspect audit_log directly.
      rejected_by_this_call: rowsAffected > 0,
    });
  },
);
