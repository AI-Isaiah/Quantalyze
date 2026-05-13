import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { withRole, APP_ROLES, type AppRole } from "@/lib/auth";
import { adminActionLimiter, checkLimit } from "@/lib/ratelimit";
import { logAuditEvent } from "@/lib/audit";

/**
 * Admin role provisioning endpoint.
 *
 * Sprint 6 closeout Task 7.2 — pilot route for `withRole("admin")`.
 *
 * GET /api/admin/users/[id]/roles
 *   200 on success → { user_id, roles: AppRole[] }
 *   404 if the target user does not exist
 *   401/403 if caller is unauthenticated / lacks admin role (via withRole)
 *
 * POST /api/admin/users/[id]/roles
 *   Body: { action: "grant" | "revoke", role: AppRole }
 *   200 on success → { user_id, roles: AppRole[] } (post-mutation role set)
 *   400 on invalid body, 403 if caller lacks admin role.
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
  role: z.enum(APP_ROLES),
});

/**
 * Read the current role set for a target user via the service-role client.
 * Mirrors `getUserRoles` in `@/lib/auth` but bypasses RLS so an admin can
 * inspect any user's roles. Filters to known AppRole values defensively.
 *
 * Issue 3 (audit-2026-05-07 follow-up): previously returned `[]` on PG
 * error after a successful grant/revoke mutation. The UI then saw "user
 * has zero roles" and an admin could re-grant — producing duplicate audit
 * rows for what was actually one logical operation. The function now
 * returns a discriminated result so callers can surface a 500 (mutation
 * already committed; instructs the user to refresh, not retry) rather
 * than silently masking the read failure.
 */
type FetchUserRolesResult =
  | { roles: AppRole[] }
  | {
      error: {
        code: string | null;
        message: string;
      };
    };

async function fetchUserRoles(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<FetchUserRolesResult> {
  const { data, error } = await admin
    .from("user_app_roles")
    .select("role")
    .eq("user_id", userId);
  if (error) {
    return {
      error: {
        code: error.code ?? null,
        message: error.message,
      },
    };
  }
  const rows = data ?? [];
  const roles = rows
    .map((row: { role: string }) => row.role)
    .filter((role: string): role is AppRole =>
      (APP_ROLES as readonly string[]).includes(role),
    );
  return { roles };
}

/**
 * GET /api/admin/users/[id]/roles
 *
 * Returns the target user's current role set. The admin UI calls this to
 * refresh the role panel after a grant/revoke without trusting the
 * mutation response alone.
 *
 * 404 is emitted when the target user does not exist in `profiles`. We
 * check profiles (not `auth.users`) because RLS-safe and because the
 * grant/revoke endpoints already operate on the same `(user_id, role)`
 * keyspace anchored to profile ids in practice. A 404 is preferable to
 * silently returning `{ roles: [] }` for a typo'd id.
 *
 * P442 (audit-2026-05-07) — fills the missing-GET gap on the role panel.
 * P462 — envelope matches POST: `{ user_id, roles: string[] }`.
 */
export const GET = withRole<{ id: string }>("admin")(
  async (_req: NextRequest, { params }) => {
    const targetUserId = params?.id;
    if (!targetUserId) {
      return NextResponse.json(
        { error: "Missing target user id in path" },
        { status: 400 },
      );
    }

    const admin = createAdminClient();

    // Existence check. profiles has a row-per-auth.user via trigger; an id
    // not present here is a genuine 404 (not just "user has no roles").
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id")
      .eq("id", targetUserId)
      .maybeSingle();

    if (profileError) {
      console.error("[admin/users/roles] GET profile lookup failed:", {
        target_user_id: targetUserId,
        code: profileError.code,
        message: profileError.message,
      });
      return NextResponse.json(
        { error: "Failed to fetch user roles" },
        { status: 500 },
      );
    }

    if (!profile) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 },
      );
    }

    // Issue 3: surface read errors instead of returning `{ roles: [] }`.
    // For the GET path there's no prior mutation, so the right answer is
    // "couldn't load roles — retry the request later" (stable 500).
    const result = await fetchUserRoles(admin, targetUserId);
    if ("error" in result) {
      console.error("[admin/users/roles] GET fetchUserRoles failed:", {
        target_user_id: targetUserId,
        code: result.error.code,
        message: result.error.message,
      });
      return NextResponse.json(
        { error: "Failed to fetch user roles", code: "roles_read_failed" },
        { status: 500 },
      );
    }
    return NextResponse.json({ user_id: targetUserId, roles: result.roles });
  },
);

export const POST = withRole<{ id: string }>("admin")(
  async (
    req: NextRequest,
    { user, supabase, params },
  ) => {
    // audit-2026-05-07 review fix I4 (red-team conf 9) — withRole runs
    // assertSameOrigin + the admin role check but enforces NO rate limit.
    // A compromised admin session would otherwise spam role grants
    // unbounded. adminActionLimiter (20/min/user) is well above
    // legitimate operator cadence and well below abuse.
    //
    // Key is the verified admin's id (withRole has already proven
    // `user.id` holds the admin role), so the bucket cannot be polluted
    // by unauthenticated or non-admin callers and the gate sits AFTER
    // auth — no timing oracle on admin-status (mirrors the C4 reorder
    // applied to the other admin POST routes).
    const rl = await checkLimit(
      adminActionLimiter,
      `admin:${user.id}:users-roles`,
    );
    if (!rl.success) {
      return NextResponse.json(
        { error: "Too many requests" },
        {
          status: 429,
          headers: { "Retry-After": String(rl.retryAfter) },
        },
      );
    }

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

      // P462 (audit-2026-05-07) — unify the response envelope across GET,
      // grant, and revoke. The UI's role panel uses the same parser for
      // all three: { user_id, roles: string[] }. Pre-fix grant returned
      // `{ role: ... }`, revoke returned `{ removed_rows: ... }` — the
      // shape drift forced two separate UI parsers and made the GET added
      // for P442 awkward to consume. Single shape, single parser.
      //
      // Issue 3 (audit-2026-05-07 follow-up): if the post-mutation read
      // fails, the GRANT has already committed — returning `{ roles: [] }`
      // would deceive the UI into thinking the user has no roles and
      // tempt the admin to re-grant (producing a duplicate audit row for
      // one logical operation). Surface a 500 with a stable code so the
      // UI can prompt the admin to refresh instead of retrying.
      const grantResult = await fetchUserRoles(admin, targetUserId);
      if ("error" in grantResult) {
        console.error(
          "[admin/users/roles] grant succeeded but post-mutation read failed:",
          {
            target_user_id: targetUserId,
            role,
            code: grantResult.error.code,
            message: grantResult.error.message,
          },
        );
        return NextResponse.json(
          {
            error:
              "Grant committed but the role set could not be re-read. Refresh to see the latest state.",
            code: "mutation_succeeded_but_read_failed",
          },
          { status: 500 },
        );
      }
      return NextResponse.json({
        user_id: targetUserId,
        roles: grantResult.roles,
      });
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

    // P462 (audit-2026-05-07) — same envelope as grant + GET. The
    // `removed_rows` count is dropped from the response body; it was a
    // diagnostic-only field never read by any UI and the audit-event
    // metadata above already retains it for the forensic trail.
    //
    // Issue 3 (audit-2026-05-07 follow-up): mirror the grant path — if
    // the post-mutation read fails after a successful REVOKE, surface
    // a 500 with the same stable code instead of returning `[]`. The
    // mutation already committed; the admin should refresh, not retry.
    const revokeResult = await fetchUserRoles(admin, targetUserId);
    if ("error" in revokeResult) {
      console.error(
        "[admin/users/roles] revoke succeeded but post-mutation read failed:",
        {
          target_user_id: targetUserId,
          role,
          code: revokeResult.error.code,
          message: revokeResult.error.message,
        },
      );
      return NextResponse.json(
        {
          error:
            "Revoke committed but the role set could not be re-read. Refresh to see the latest state.",
          code: "mutation_succeeded_but_read_failed",
        },
        { status: 500 },
      );
    }
    return NextResponse.json({
      user_id: targetUserId,
      roles: revokeResult.roles,
    });
  },
);
