/**
 * Admin gate — unified source of truth (audit-2026-05-07 P459 + P699 + P700 + P703).
 *
 * Prior to this consolidation there were THREE parallel admin-decision
 * mechanisms wired into routes / pages / middleware:
 *
 *   1. `ADMIN_EMAIL` env-var fallback in this module — a single email
 *      string that, if set, granted superuser to that email WITHOUT any
 *      database row. Invisible to the audit trail (P700).
 *   2. `profiles.is_admin` boolean column (migration 011).
 *   3. `user_app_roles` join table with `role = 'admin'` (migration 054).
 *
 * Drift risk: a user added to `user_app_roles` but not `profiles.is_admin`
 * (or vice versa) could pass one gate and fail the other depending on
 * which call path executed. This file collapses the three runtime checks
 * into ONE internal helper — `isAdminUser` and `isAdmin` keep their
 * public signatures (so existing callers don't have to change) but now
 * both delegate to the same union check:
 *
 *     admin = (user_app_roles has 'admin')
 *           OR (profiles.is_admin = TRUE)
 *           OR (ADMIN_EMAIL env-fallback matches user.email)
 *
 * The OR-union retains all three signals for back-compat (migrations are
 * still mid-rollout — see ADR-0005) but routes them through a single
 * decision so a grant in any one of the three places lights up the gate.
 *
 * Break-glass intent for ADMIN_EMAIL
 * ----------------------------------
 * ADMIN_EMAIL is intentionally retained as a recovery mechanism for the
 * "all admins locked out of `user_app_roles`" disaster scenario. Setting
 * the env var on the deployed function grants the named email admin
 * access without requiring a DB write. Two operational safeguards:
 *
 *   - Every successful fallback grant emits an audit_log row with
 *     action='admin.access.via_env_email_fallback' so the access is
 *     visible to forensic review (no more silent grants).
 *   - A startup-time warning is logged when ADMIN_EMAIL is set in
 *     production, nudging operators to migrate to `user_app_roles`.
 *
 * If the dependency on the env-fallback is dropped in a future sprint,
 * `ADMIN_EMAIL_FALLBACK_ENABLED` can be flipped to `false` below without
 * touching call sites. The audit-log action stays in the taxonomy as a
 * forensic anchor for historical access.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "";

/**
 * Master toggle for the ADMIN_EMAIL env fallback. Kept as a constant
 * (not a runtime env switch) so flipping the policy is a code review
 * with attribution rather than a silent ops change. See ADR-0005 for
 * the long-term plan to drop the fallback once user_app_roles has been
 * verified across all admin paths.
 */
const ADMIN_EMAIL_FALLBACK_ENABLED = true;

/**
 * Startup-time warning — emitted exactly once on module load if
 * ADMIN_EMAIL is set in a production environment. NODE_ENV gate keeps
 * dev / test logs quiet (where ADMIN_EMAIL is routinely set for
 * convenience). Operators see this in their Vercel function-init logs.
 */
if (
  ADMIN_EMAIL_FALLBACK_ENABLED &&
  ADMIN_EMAIL &&
  process.env.NODE_ENV === "production"
) {
  console.warn(
    `[SECURITY] ADMIN_EMAIL env fallback is active for ${ADMIN_EMAIL} — prefer user_app_roles. See src/lib/admin.ts and ADR-0005.`,
  );
}

/**
 * Email-only check (legacy). Use isAdminUser() for the full check.
 *
 * Preserved as a pure (no-DB) check for the rare middleware paths that
 * need a synchronous answer without a Supabase round-trip — notably
 * `src/proxy.ts` which gates the /admin/* path prefix. Page/route
 * handlers MUST use isAdminUser() instead so the union check covers
 * the user_app_roles + profiles.is_admin signals.
 */
export function isAdmin(email: string | null | undefined): boolean {
  if (!ADMIN_EMAIL_FALLBACK_ENABLED) return false;
  if (!ADMIN_EMAIL || !email) return false;
  return email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
}

/**
 * Internal: does `userId` have role='admin' in `user_app_roles`?
 *
 * Tolerates RLS rejections (returns false on error) — getUserRoles in
 * `src/lib/auth.ts` has the canonical version with the AppRole filter,
 * but this module purposely does not import from `auth.ts` to keep the
 * call surface narrow (admin.ts is imported by middleware / pages that
 * shouldn't bundle the full RBAC surface).
 */
async function hasAdminRoleRow(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("user_app_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .limit(1);

  if (error) {
    // RLS denial is the expected failure mode for a non-admin caller
    // reading another user's roles. Treat as "no admin row" — the other
    // signals (is_admin column, ADMIN_EMAIL fallback) still get a vote.
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

/**
 * Internal: does `userId` have `profiles.is_admin = TRUE`?
 *
 * Kept for the migration period — Sprint 7 will drop the column once
 * every admin grant has been mirrored into user_app_roles. Per ADR-0005
 * we keep BOTH signals OR'd until the column is dropped so a partial
 * migration cannot silently revoke admin access.
 */
async function hasIsAdminFlag(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", userId)
    .single();

  if (error || !data) return false;
  return data.is_admin === true;
}

/**
 * Fire-and-forget audit-log emission when the ADMIN_EMAIL env-fallback
 * grants admin access. Intentionally writes through the user-scoped
 * supabase client so `auth.uid()` inside log_audit_event resolves to
 * the acting user — the audit row attributes the grant to the user who
 * benefited from the fallback, not to a service identity.
 *
 * Catches all failures internally; never re-throws. An audit-log RPC
 * failure must NOT propagate into a 500 on a user-facing request, and
 * MUST NOT block the admin from completing their action — the fallback
 * is a break-glass surface and a logging hiccup cannot lock everyone
 * out.
 */
async function emitEnvEmailFallbackAudit(
  supabase: SupabaseClient,
  user: { id: string; email?: string | null },
): Promise<void> {
  try {
    const { error } = await supabase.rpc("log_audit_event", {
      p_action: "admin.access.via_env_email_fallback",
      p_entity_type: "user",
      p_entity_id: user.id,
      p_metadata: {
        admin_email: ADMIN_EMAIL,
        matched_user_email: user.email ?? null,
      },
    });
    if (error) {
      console.error(
        "[admin] audit emit for ADMIN_EMAIL fallback returned error:",
        { code: error.code, message: error.message, user_id: user.id },
      );
    }
  } catch (err) {
    console.error(
      "[admin] audit emit for ADMIN_EMAIL fallback threw:",
      {
        message: err instanceof Error ? err.message : String(err),
        user_id: user.id,
      },
    );
  }
}

/**
 * Full admin check — UNION across all three signals.
 *
 * Returns TRUE if ANY of:
 *   - The user has role='admin' in `user_app_roles` (migration 054).
 *   - The user has `profiles.is_admin = TRUE` (migration 011).
 *   - The user's email matches ADMIN_EMAIL (break-glass; audited).
 *
 * Use this in EVERY admin-decision path that has a Supabase client.
 * The two parallel `withRole('admin')` and `withAdminAuth` wrappers
 * both consult this helper (transitively, via `getUserRoles` in the
 * RBAC path and directly in the legacy path) so a grant in any one of
 * the three sources lights up both gates — closing the P459 / P699 /
 * P703 drift surface.
 *
 * Returns Promise<boolean> — never throws to the caller. A failed DB
 * read on one signal does NOT short-circuit the other signals; the
 * caller still gets the OR of whatever signals succeeded.
 */
export async function isAdminUser(
  supabase: SupabaseClient,
  user: { id: string; email?: string | null } | null | undefined,
): Promise<boolean> {
  if (!user) return false;

  // Signal 1: user_app_roles (new substrate, migration 054). Run first
  // because it's the going-forward source of truth — a hit here means
  // we don't need the other two round-trips.
  if (await hasAdminRoleRow(supabase, user.id)) {
    return true;
  }

  // Signal 2: profiles.is_admin (legacy column, migration 011). Backfill
  // from migration 054 means every is_admin=TRUE row already has a
  // matching user_app_roles row — but a manual `UPDATE profiles SET
  // is_admin = TRUE` (no corresponding user_app_roles INSERT) still
  // grants access through this path. Surface the divergence in logs
  // so we can clean it up before dropping the column.
  if (await hasIsAdminFlag(supabase, user.id)) {
    return true;
  }

  // Signal 3: ADMIN_EMAIL env fallback (break-glass). Audited on every
  // hit — see emitEnvEmailFallbackAudit above. Disabled if the toggle
  // at the top of this file is flipped off.
  if (isAdmin(user.email)) {
    // Fire-and-forget audit emission. We do NOT await it — the admin
    // gate decision must return as quickly as the other two signals,
    // and emitEnvEmailFallbackAudit catches its own errors so a logging
    // failure cannot leak into the gate's return value.
    void emitEnvEmailFallbackAudit(supabase, user);
    return true;
  }

  return false;
}
