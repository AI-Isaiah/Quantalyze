import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { withRole, APP_ROLES, type AppRole } from "@/lib/auth";
import { captureToSentry } from "@/lib/sentry-capture";
import {
  adminActionLimiter,
  checkLimit,
  isRateLimitMisconfigured,
} from "@/lib/ratelimit";
// audit-2026-05-07 fix C-0065 (red-team conf-6): RBAC-mutating routes await the
// synchronous `emit` (aliased to `logAuditEvent` so the audit-coverage grep gate
// matches the literal) rather than the fire-and-forget `logAuditEvent` wrapper.
// The wrapper schedules the RPC via `after()`, which runs AFTER the response
// flushes against a session-cookie client captured at withRole's auth.getUser();
// if the admin's session expires in that window the log_audit_event RPC raises
// (auth.uid()=NULL) and the row drops to a silent console.error. Awaiting the
// user-scoped emit inside the request keeps auth.uid() = the acting admin.
import { emit as logAuditEvent } from "@/lib/audit";

/**
 * Admin role provisioning endpoint.
 *
 * GET  /api/admin/users/[id]/roles  → { user_id, roles: AppRole[] }  (404 if no profile)
 * POST /api/admin/users/[id]/roles  body { action: "grant"|"revoke", role: AppRole }
 *                                   → { user_id, roles: AppRole[] }  (post-mutation set)
 *
 * B4 (audit-2026-05-07) — Atomic Admin RBAC RPC
 * ---------------------------------------------
 * The grant/revoke mutation runs entirely inside the `admin_role_mutate`
 * SECURITY DEFINER RPC (migration 20260530120000): one transaction under a
 * per-target advisory lock that does the dual-store write (profiles.is_admin +
 * user_app_roles), the dedup-UNION last-admin guard, fresh-actor authz, and the
 * took-effect verify atomically. That closes — by construction — the whole class
 * the former 660-line hand-rolled POST body fought one finding at a time:
 *   NEW-C17-01 ghost-admin half-write  · NEW-C17-02/H-02 double-counted last-admin
 *   NEW-C17-03 case-sensitive self-revoke rail · NEW-C17-05 JS-side TOCTOU window.
 * The route now only: rate-limits, validates the body, calls the RPC, maps the
 * returned SQLSTATE/outcome to an HTTP response, and emits the (type-checked,
 * TS-side) audit events. Audit emission stays in TS — the awaited `emit`-aliased
 * `logAuditEvent` keeps both the audit-coverage grep gate and the C-0065/C-0067
 * ordering guarantees (the SECDEF write authority is service-role-only EXECUTE).
 *
 * SQLSTATE → HTTP map (from the RPC):
 *   42501 insufficient_privilege  → 403  (hint=self_revoke_forbidden ⇒ self-revoke 403)
 *   23514 check_violation         → 409  would_orphan_last_admin
 *   P0002 no_data_found           → 404  user_not_found
 *   22023 invalid_parameter_value → 400  (defensive; body is Zod-validated)
 * Outcome → response: granted/revoked → role.grant|role.revoke (+state_observed) → 200;
 *   revoke_noop → role.revoke_noop → 404 role_not_held; took_effect:false → 409.
 */

const BODY_SCHEMA = z.object({
  action: z.enum(["grant", "revoke"]),
  role: z.enum(APP_ROLES),
});

/**
 * Shape returned by the `admin_role_mutate` RPC (migration 20260530120000).
 * The RPC performs the mutation atomically; the route reads these fields to map
 * the result to an HTTP response and build the audit-event metadata.
 */
interface AdminRoleMutateResult {
  outcome: "granted" | "revoked" | "revoke_noop";
  was_new_grant: boolean;
  removed_rows: number;
  is_admin_changed: boolean;
  holds_role: boolean;
  took_effect: boolean;
  roles: string[];
}

/**
 * Read the current role set for a target user via the service-role client.
 * Used by GET only (POST gets the post-mutation set back from the RPC).
 * Returns a discriminated result so a read failure surfaces a stable 500 rather
 * than masquerading as "user has zero roles".
 */
type FetchUserRolesResult =
  | { roles: AppRole[] }
  | { error: { code: string | null; message: string } };

async function fetchUserRoles(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<FetchUserRolesResult> {
  const { data, error } = await admin
    .from("user_app_roles")
    .select("role")
    .eq("user_id", userId);
  if (error) {
    return { error: { code: error.code ?? null, message: error.message } };
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
 * Returns the target user's current role set. 404 (code=user_not_found) when the
 * target has no `profiles` row. P442/P462: envelope is `{ user_id, roles }`.
 */
export const GET = withRole<{ id: string }>("admin")(
  async (_req: NextRequest, { user, params }) => {
    // audit-2026-05-07 specialist-apply (code-reviewer M conf-7): the same
    // adminActionLimiter as POST (a `:get` suffix so the read cadence doesn't
    // pollute POST accounting) — a compromised admin session can otherwise probe
    // every user_id to map the full role table with no audit (reads aren't audited).
    const rl = await checkLimit(
      adminActionLimiter,
      `admin:${user.id}:users-roles:get`,
    );
    if (!rl.success) {
      if (isRateLimitMisconfigured(rl)) {
        return NextResponse.json(
          { error: "Rate limiter unavailable", code: "ratelimit_misconfigured" },
          { status: 503, headers: { "Retry-After": String(rl.retryAfter) } },
        );
      }
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
      );
    }

    const targetUserId = params?.id;
    if (!targetUserId) {
      return NextResponse.json(
        { error: "Missing target user id in path" },
        { status: 400 },
      );
    }

    const admin = createAdminClient();

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
        { error: "Failed to fetch user roles", code: "profile_read_failed" },
        { status: 500 },
      );
    }
    if (!profile) {
      return NextResponse.json(
        { error: "User not found", code: "user_not_found" },
        { status: 404 },
      );
    }

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
  async (req: NextRequest, { user, supabase, params }) => {
    // audit-2026-05-07 review fix I4 (red-team conf 9): withRole runs CSRF + the
    // admin gate but no rate limit. adminActionLimiter (20/min/user) caps a
    // compromised admin session. Keyed on the verified admin id, AFTER auth — no
    // timing oracle on admin status. The admin-csrf-ratelimit grep gate requires
    // this checkLimit call to stay present on this route.
    const rl = await checkLimit(adminActionLimiter, `admin:${user.id}:users-roles`);
    if (!rl.success) {
      // silent-failure-hunter HIGH conf-9: translate the misconfigured-limiter
      // variant to 503 (Upstash outage) instead of masking it as an ordinary 429.
      if (isRateLimitMisconfigured(rl)) {
        return NextResponse.json(
          { error: "Rate limiter unavailable", code: "ratelimit_misconfigured" },
          { status: 503, headers: { "Retry-After": String(rl.retryAfter) } },
        );
      }
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
      );
    }

    const rawTargetUserId = params?.id;
    if (!rawTargetUserId) {
      return NextResponse.json(
        { error: "Missing target user id in path" },
        { status: 400 },
      );
    }
    // Normalize to lowercase so the actor/target comparison and the audit
    // entity_id are canonical. (The case-sensitive self-revoke rail NEW-C17-03
    // is now enforced server-side in SQL inside admin_role_mutate, but a
    // canonical id keeps the audit trail consistent.)
    const targetUserId = rawTargetUserId.toLowerCase();

    const rawBody = await req.json().catch(() => null);
    const parsed = BODY_SCHEMA.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const { action, role } = parsed.data;

    // ── The entire mutation, atomically (B4 / admin_role_mutate) ─────────────
    // Dual-store write + dedup-UNION last-admin guard + per-target advisory lock
    // + fresh-actor authz + took-effect verify, all in one SECDEF transaction.
    const admin = createAdminClient();
    const { data, error: rpcError } = await admin.rpc("admin_role_mutate", {
      p_actor_id: user.id.toLowerCase(),
      p_target_id: targetUserId,
      p_role: role,
      p_action: action,
    });

    if (rpcError) {
      const code = rpcError.code;
      const hint = (rpcError as { hint?: string | null }).hint;
      // 42501 insufficient_privilege → 403. The hint distinguishes the self-revoke
      // rail (NEW-C17-03) from an actor-no-longer-admin TOCTOU rejection (NEW-C17-05).
      if (code === "42501") {
        if (hint === "self_revoke_forbidden") {
          return NextResponse.json(
            {
              error:
                "Admins cannot revoke their own admin role — another admin must act.",
            },
            { status: 403 },
          );
        }
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      // 23514 check_violation → 409 last-admin lockout (NEW-C17-02 / H-02).
      if (code === "23514") {
        return NextResponse.json(
          {
            error:
              "Cannot revoke: this is the last admin account. Grant admin to another user first.",
            code: "would_orphan_last_admin",
          },
          { status: 409 },
        );
      }
      // P0002 no_data_found → 404 user_not_found (mirrors GET).
      if (code === "P0002") {
        return NextResponse.json(
          { error: "User not found", code: "user_not_found" },
          { status: 404 },
        );
      }
      // 22023 invalid_parameter_value → 400 (defensive; body is Zod-validated).
      if (code === "22023") {
        return NextResponse.json(
          { error: "Invalid role mutation request", code: "invalid_role_mutation" },
          { status: 400 },
        );
      }
      console.error("[admin/users/roles] admin_role_mutate failed:", {
        target_user_id: targetUserId,
        action,
        role,
        code,
        message: rpcError.message,
      });
      return NextResponse.json(
        { error: "Role mutation failed", code: "admin_role_mutate_failed" },
        { status: 500 },
      );
    }

    // Defensive shape guard on the RPC's `any`-typed return (createAdminClient
    // is intentionally untyped). A non-null jsonb carrying `outcome` is the
    // contract every SQL path satisfies today (RETURNS jsonb, single
    // jsonb_build_object exit); this guards a FUTURE SQL refactor (an early
    // RETURN / void / SETOF) from turning a contract break into an unhandled
    // TypeError instead of this route's stable, logged 500.
    if (!data || typeof data !== "object" || !("outcome" in data)) {
      console.error(
        "[admin/users/roles] admin_role_mutate returned an empty/malformed result:",
        { target_user_id: targetUserId, action, role },
      );
      return NextResponse.json(
        { error: "Role mutation failed", code: "admin_role_mutate_failed" },
        { status: 500 },
      );
    }
    const result = data as AdminRoleMutateResult;

    // ── No-op revoke: target never held the role → 404 + role.revoke_noop ────
    // (M-0287/M-0289 — do NOT emit role.revoke; keep the operator-intent anchor
    // so an off-the-books (user,role) probe still leaves a forensic trail.
    // Fail-soft: an anchor failure must not change the 404.)
    if (result.outcome === "revoke_noop") {
      try {
        await logAuditEvent(supabase, {
          action: "role.revoke_noop",
          entity_type: "user_app_role",
          entity_id: targetUserId,
          metadata: { role, attempted_by: user.id, was_held: false, removed_rows: 0 },
        });
      } catch (auditError) {
        console.error(
          "[admin/users/roles] role.revoke_noop audit emit failed (non-fatal):",
          {
            target_user_id: targetUserId,
            role,
            error:
              auditError instanceof Error ? auditError.message : String(auditError),
          },
        );
      }
      return NextResponse.json(
        { error: `User does not hold role '${role}' — nothing to revoke.`, code: "role_not_held" },
        { status: 404 },
      );
    }

    const isGrant = result.outcome === "granted";

    // ── Primary intent row (role.grant | role.revoke) — awaited + fail-LOUD.
    // C-0065: the RPC already committed; if THIS emit fails surface a stable
    // mutation_succeeded_but_audit_failed 500 so the UI refreshes rather than
    // re-firing the mutation. ────────────────────────────────────────────────
    try {
      await logAuditEvent(supabase, {
        action: isGrant ? "role.grant" : "role.revoke",
        entity_type: "user_app_role",
        entity_id: targetUserId,
        metadata: isGrant
          ? { role, granted_by: user.id, was_new_grant: result.was_new_grant }
          : {
              role,
              revoked_by: user.id,
              removed_rows: result.removed_rows,
              // Ghost-admin revoke (is_admin=TRUE, no row) demotes via the flag
              // with removed_rows:0 — surface is_admin_changed so a forensic
              // reader understands a removed_rows:0 role.revoke was still a real
              // demotion (NEW-C17-01), not a stray no-op row.
              is_admin_changed: result.is_admin_changed,
            },
      });
    } catch (auditError) {
      console.error(
        `[admin/users/roles] ${isGrant ? "grant" : "revoke"} committed but audit emit failed:`,
        {
          target_user_id: targetUserId,
          role,
          error:
            auditError instanceof Error ? auditError.message : String(auditError),
        },
      );
      return NextResponse.json(
        {
          error: `${isGrant ? "Grant" : "Revoke"} committed but audit emission failed. Refresh to verify state.`,
          code: "mutation_succeeded_but_audit_failed",
        },
        { status: 500 },
      );
    }

    // NEW-C17-04 observability: alert on every admin grant so rogue
    // self-elevation / bulk backdoor minting surfaces to on-call. Fire-and-forget
    // — a Sentry failure must not change the caller's response.
    if (isGrant && role === "admin") {
      captureToSentry(
        new Error(
          `[admin/users/roles] admin role granted to ${targetUserId} by ${user.id}`,
        ),
        {
          tags: {
            area: "admin-roles",
            action: "role.grant",
            role: "admin",
            granted_by: user.id,
            target_user_id: targetUserId,
          },
          extra: { was_new_grant: result.was_new_grant },
          level: "warning",
        },
      );
    }

    // ── role.state_observed anchor (C-0067) — awaited, fail-SOFT. The RPC's
    // took-effect verify re-read the post-mutation reality under the advisory
    // lock; record holds_role for the concurrent-race forensic anchor. ───────
    try {
      await logAuditEvent(supabase, {
        action: "role.state_observed",
        entity_type: "user_app_role",
        entity_id: targetUserId,
        metadata: {
          role,
          observed_by: user.id,
          following_action: isGrant ? "grant" : "revoke",
          holds_role: result.holds_role,
        },
      });
    } catch (auditError) {
      console.error(
        "[admin/users/roles] role.state_observed emit failed (non-fatal):",
        {
          target_user_id: targetUserId,
          role,
          error:
            auditError instanceof Error ? auditError.message : String(auditError),
        },
      );
    }

    // ── Took-effect gate (NEW-C17-06 / NEW-C17-07). Under the RPC's advisory
    // lock this is structurally unreachable, but the RPC reports took_effect and
    // the route surfaces 409 defensively rather than a false 200. ────────────
    if (!result.took_effect) {
      return NextResponse.json(
        isGrant
          ? {
              error:
                "Grant committed but the role is not observed as held (possible concurrent revoke). Refresh and retry if needed.",
              code: "grant_did_not_take",
            }
          : {
              error:
                "Revoke committed but the role is still observed as held (possible concurrent re-grant). Refresh and retry if needed.",
              code: "revoke_did_not_take",
            },
        { status: 409 },
      );
    }

    return NextResponse.json({ user_id: targetUserId, roles: result.roles });
  },
);
