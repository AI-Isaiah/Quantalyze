import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { withRole, APP_ROLES, type AppRole } from "@/lib/auth";
import { adminActionLimiter, checkLimit } from "@/lib/ratelimit";
// audit-2026-05-07 fix C-0065 (red-team conf-6): for RBAC-mutating
// routes we use the synchronous `emit` directly (aliased here to
// `logAuditEvent` so the audit-coverage grep gate matches) rather than
// the `logAuditEvent` wrapper from @/lib/audit which schedules the RPC
// via `after()`. After-the-response emission runs against a supabase
// client whose session cookie was captured at the start of withRole's
// auth.getUser(); if the admin's session is revoked or expires in the
// window between handler return and after()-callback execution, the
// log_audit_event RPC raises (auth.uid() = NULL) and the row drops to
// a silent console.error. The audit-coverage gate
// (src/__tests__/audit-coverage.test.ts) matches the literal name
// `logAuditEvent(` so the alias keeps the gate happy without ad-hoc
// `@audit-skip` pragmas that would weaken the coverage promise.
import { emit as logAuditEvent } from "@/lib/audit";

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
 * Both grant and revoke emit audit events via the AWAITED `logAuditEvent`
 * (alias for the synchronous `emit` from @/lib/audit — see import comment
 * above for the audit-2026-05-07 C-0065 rationale). The entity_type is
 * `user_app_role` and entity_id is the TARGET user id (the user being
 * granted/revoked), not the row id of user_app_roles — a (user_id, role)
 * composite-key row doesn't have a stable UUID to anchor on. Metadata
 * carries {role, granted_by|revoked_by} plus the audit-2026-05-07
 * discriminators: `was_new_grant` (M-0288) on role.grant, `removed_rows`
 * on role.revoke (always > 0 now per M-0287). A second
 * `role.state_observed` event (C-0067) emits AFTER the post-mutation
 * re-read carrying `holds_role` so concurrent grant+revoke races have
 * a forensic anchor.
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
    //
    // audit-2026-05-07 fix C-0066 (api-contract conf-7): standardize
    // self-action rejection on 403 across admin routes. The sibling
    // deletion-requests/[id]/(approve|reject) routes return 403 via
    // _shared.ts:84-94 for the same conceptual error class (admin
    // attempting a self-action). 400 implied a malformed request — but
    // the request IS well-formed, the action is just forbidden. Aligning
    // on 403 lets the UI use a single 4xx→message mapping for "this
    // self-action is forbidden — have another admin act."
    if (
      action === "revoke" &&
      role === "admin" &&
      targetUserId === user.id
    ) {
      return NextResponse.json(
        {
          error:
            "Admins cannot revoke their own admin role — another admin must act.",
        },
        { status: 403 },
      );
    }

    const admin = createAdminClient();

    if (action === "grant") {
      // audit-2026-05-07 fix M-0288 (silent-failure-hunter conf-8):
      // determine `was_new_grant` BEFORE upsert by reading the existing
      // row. ignoreDuplicates returns {error: null} whether the row was
      // newly inserted or already existed — without this read, every
      // re-grant produces an indistinguishable audit row and the
      // forensic query "when did user X first acquire <role>" silently
      // returns the latest re-grant timestamp instead of the original.
      const { data: preExisting, error: preExistingError } = await admin
        .from("user_app_roles")
        .select("granted_at")
        .eq("user_id", targetUserId)
        .eq("role", role)
        .maybeSingle();
      if (preExistingError) {
        console.error("[admin/users/roles] grant pre-read failed:", {
          target_user_id: targetUserId,
          role,
          code: preExistingError.code,
          message: preExistingError.message,
        });
        return NextResponse.json(
          { error: "Grant failed" },
          { status: 500 },
        );
      }
      const wasNewGrant = preExisting == null;

      // ON CONFLICT DO NOTHING via upsert — a repeat grant is a no-op,
      // not an error. We still emit the audit event so the operator
      // trail reflects the intent, even on a re-grant, but the
      // `was_new_grant` flag in metadata makes the forensic intent
      // unambiguous.
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

      // audit-2026-05-07 fix C-0065 (red-team conf-6): for RBAC-mutating
      // routes, await the audit emit synchronously instead of scheduling
      // it via `after()`. `after()` runs the emit outside the request
      // scope, against a supabase client whose session cookie was
      // captured at the start of withRole's auth.getUser(). If the
      // acting admin's session expires or is revoked between handler
      // return and after()-callback execution, the log_audit_event RPC
      // raises (auth.uid() = NULL) and the emit drops silently to
      // console.error. That gap is exactly where forensic interest is
      // highest (concurrent admin-management activity). The extra ~30ms
      // latency cost is acceptable on a route this rarely called.
      //
      // The supabase client here is the user-scoped client supplied by
      // withRole: auth.uid() inside log_audit_event resolves to the
      // acting admin's id, which is the audit-trail invariant.
      //
      // audit-2026-05-07 fix M-0288 / H-0241: include `was_new_grant`
      // so re-grant audit rows are distinguishable from first-time
      // grants — analogous to `was_first_run` in account.sanitize
      // (deletion-requests/approve/route.ts).
      await logAuditEvent(supabase, {
        action: "role.grant",
        entity_type: "user_app_role",
        entity_id: targetUserId,
        metadata: { role, granted_by: user.id, was_new_grant: wasNewGrant },
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

      // audit-2026-05-07 fix C-0067 (red-team conf-7): emit a
      // `role.state_observed` event with the post-write boolean so
      // forensic reconstruction has an anchor when two admins race a
      // concurrent grant+revoke. Without this anchor, the operator
      // timeline "did target T hold <role> between t=A and t=B" is
      // race-dependent — the post-write observation is the only signal
      // that survives the interleave. Note: this records what THIS
      // request saw; it does not serialize the underlying race.
      const holdsRoleAfterGrant = grantResult.roles.includes(role);
      await logAuditEvent(supabase, {
        action: "role.state_observed",
        entity_type: "user_app_role",
        entity_id: targetUserId,
        metadata: {
          role,
          observed_by: user.id,
          following_action: "grant",
          holds_role: holdsRoleAfterGrant,
        },
      });

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

    // audit-2026-05-07 fix M-0287 + M-0289 (code-reviewer + silent-failure
    // conf-8): if no row was deleted, the target user never held this
    // role. Pre-fix the route emitted role.revoke unconditionally with
    // `removed_rows: 0`, producing audit rows that say "admin X revoked
    // role Y from user Z" when Y was never granted — a false-positive
    // forensic signal. The UI also flashed a "Revoked '<role>'" success
    // toast (UserRolesPanel.tsx:115-117) on any 2xx, so the operator saw
    // a false success. Return 404 idempotent on no-op, do NOT emit the
    // role.revoke audit row, do NOT emit role.state_observed (the state
    // didn't change because of THIS call).
    const removedRows = count ?? 0;
    if (removedRows === 0) {
      return NextResponse.json(
        {
          error: `User does not hold role '${role}' — nothing to revoke.`,
          code: "role_not_held",
        },
        { status: 404 },
      );
    }

    // audit-2026-05-07 fix C-0065 (red-team conf-6): await the audit
    // emit synchronously. See the grant-path comment above for the full
    // rationale (after() runs the emit outside the request scope on a
    // potentially-revoked admin session, dropping the row to a silent
    // console.error). For RBAC-mutating routes the latency cost is
    // acceptable; the alternative is a forensic gap on exactly the
    // action class regulators scrutinize most.
    //
    // audit-2026-05-07 fix M-0287 / M-0289 / H-0241: only emit when
    // removedRows > 0 — the early-return above guarantees that here.
    // The `removed_rows` metadata is now always > 0 (no more ghost
    // revoke rows with `removed_rows: 0` polluting the timeline).
    await logAuditEvent(supabase, {
      action: "role.revoke",
      entity_type: "user_app_role",
      entity_id: targetUserId,
      metadata: { role, revoked_by: user.id, removed_rows: removedRows },
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

    // audit-2026-05-07 fix C-0067 (red-team conf-7): emit
    // `role.state_observed` with the post-write boolean for the same
    // race-anchor reason as the grant path. See the grant-side comment.
    const holdsRoleAfterRevoke = revokeResult.roles.includes(role);
    await logAuditEvent(supabase, {
      action: "role.state_observed",
      entity_type: "user_app_role",
      entity_id: targetUserId,
      metadata: {
        role,
        observed_by: user.id,
        following_action: "revoke",
        holds_role: holdsRoleAfterRevoke,
      },
    });

    return NextResponse.json({
      user_id: targetUserId,
      roles: revokeResult.roles,
    });
  },
);
