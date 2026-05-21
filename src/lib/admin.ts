/**
 * Admin gate — SINGLE SOURCE OF TRUTH (audit-2026-05-07 C-0144 + C-0150).
 *
 * Prior to this consolidation `withRole('admin')` (in `src/lib/auth.ts`) and
 * `isAdminUser` here ran a three-signal OR-union:
 *
 *   1. `user_app_roles.role='admin'` (migration 054).
 *   2. `profiles.is_admin = TRUE` (migration 011).
 *   3. `ADMIN_EMAIL` env-var fallback (legacy break-glass).
 *
 * The DB-side RLS policies that gate the actual rows still reference
 * `profiles.is_admin = TRUE` almost universally (the user_app_roles
 * substrate is mid-rollout — see ADR-0005). That means the OR-union in
 * code was strictly LOOSER than what RLS actually enforced:
 *
 *   - "Dead-admin": a user whose email matches `ADMIN_EMAIL` but whose
 *     `profiles.is_admin = FALSE` passed the code gate yet hit RLS denial
 *     on every privileged DB read. The route returned 200 / 403 mixed
 *     responses depending on which check fired first — a confusing UX
 *     and an audit-trail mess (the "admin" was attributed to an account
 *     RLS treated as a normal user).
 *
 *   - "Ghost-admin": the inverse — `profiles.is_admin = TRUE` but no
 *     `user_app_roles.role='admin'` row. The OR-union let this user
 *     pass, RLS lets them write to admin-gated tables, and that's the
 *     contract we want to preserve (profile flag wins).
 *
 * C-0144 / C-0150 collapse the three signals into ONE rule, aligned
 * with the DB-side policy:
 *
 *     admin = (profiles.is_admin = TRUE)
 *
 * `user_app_roles.role='admin'` is still consulted as a SECONDARY signal
 * during the migration period — a hit there still grants admin, because
 * migration 054's backfill mirrored every legacy `is_admin=TRUE` profile
 * into the join table and Sprint 7 will eventually flip the DB-side
 * source of truth. Until then the join-table signal is additive, not
 * subtractive, so the code gate stays at least as permissive as what an
 * admin can see in the UI.
 *
 * `ADMIN_EMAIL` is downgraded to OBSERVATIONAL ONLY. If a caller's email
 * matches the env var, we emit a Sentry-tagged log breadcrumb so an
 * operator can see "this user would have been granted via the old
 * fallback" — but we do NOT flip the gate to TRUE on that signal alone.
 * Break-glass is now strictly out-of-band: an operator with DB access
 * sets `profiles.is_admin = TRUE` on the locked-out user.
 *
 * `withRole('admin')` (src/lib/auth.ts) DELEGATES to `isAdminUser` for
 * the admin role specifically. Non-admin roles still resolve through
 * `user_app_roles` alone — there is no profile flag for `allocator` /
 * `quant_manager` / `analyst`, so `user_app_roles` is authoritative for
 * those.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The legacy break-glass env var. Kept as a runtime read so an operator
 * who set it on the function instance can still see the audit
 * breadcrumb fire, but the value is NEVER used to grant access — it is
 * read inside `logEnvEmailFallbackMatch` purely to compare against the
 * caller's email for observational logging.
 */
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "";

/**
 * Startup-time warning — emitted once on module load if `ADMIN_EMAIL`
 * is set in a production environment. Operators see this in their
 * function-init logs and can clean up the leftover env var. The variable
 * no longer affects the gate; this nudge is so the misleading config
 * doesn't sit on the deployment forever.
 */
if (ADMIN_EMAIL && process.env.NODE_ENV === "production") {
  console.warn(
    `[SECURITY] ADMIN_EMAIL env var is set (${ADMIN_EMAIL}) but is now OBSERVATIONAL ONLY — it no longer grants admin access. Set profiles.is_admin = TRUE via SQL to grant admin. See src/lib/admin.ts and ADR-0005.`,
  );
}

/**
 * Email match against ADMIN_EMAIL — preserved for `src/proxy.ts` which
 * needs a synchronous pure check at the middleware layer (no Supabase
 * round-trip available there).
 *
 * IMPORTANT: a TRUE result here is NOT a grant. The proxy uses it as a
 * fast-path FILTER to redirect non-admin emails away from `/admin/*`
 * URLs without a DB call; the authoritative `isAdminUser` check still
 * runs at the page / route handler layer and is what actually gates the
 * privileged work. If `ADMIN_EMAIL` is unset, every caller fails this
 * filter and the page-layer check decides — matching the prior behavior
 * but without the silent grant.
 *
 * If `ADMIN_EMAIL` is unset, this returns FALSE for every caller — the
 * proxy then redirects authenticated non-matching emails away from
 * `/admin/*`. That over-redirect on a misconfigured deployment is the
 * safe default (admins can still hit the admin pages from a directly
 * navigated path if they bypass the redirect, since the authoritative
 * check still runs server-side).
 */
export function isAdmin(email: string | null | undefined): boolean {
  if (!ADMIN_EMAIL || !email) return false;
  return email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
}

/**
 * Lazy Sentry reporter used by the narrowed error paths in
 * `hasAdminRoleRow` / `hasIsAdminFlag`. The lazy import avoids pulling
 * Sentry into middleware bundles that don't otherwise need it, and the
 * inner try/catch prevents a Sentry-transport failure from masking the
 * caller's signal.
 */
function reportNonRlsError(
  err: unknown,
  options: {
    fn: "hasAdminRoleRow" | "hasIsAdminFlag";
    userId: string;
    code: string | null;
    message: string;
  },
): void {
  try {
    void import("@sentry/nextjs")
      .then((Sentry) => {
        try {
          Sentry.captureException(err, {
            tags: {
              admin_gate_non_rls_error: "true",
              admin_gate_fn: options.fn,
              admin_gate_code: options.code ?? "unknown",
            },
            extra: {
              user_id: options.userId,
              code: options.code,
              message: options.message,
            },
            level: "error",
          });
        } catch {
          // Swallow — caller already logged via console.error.
        }
      })
      .catch(() => {
        // Sentry import failed — swallow.
      });
  } catch {
    // import() construction failed (extremely unlikely) — swallow.
  }
}

/**
 * Internal: does `userId` have role='admin' in `user_app_roles`?
 *
 * Treated as an ADDITIVE signal during the user_app_roles rollout —
 * Sprint 7 may flip this to authoritative once every RLS policy has
 * been migrated off `profiles.is_admin`. Until then a hit here grants
 * admin (matching migration 054's backfill, which mirrors every legacy
 * is_admin=TRUE row into the join table) but a miss does NOT revoke —
 * `hasIsAdminFlag` still gets a vote.
 *
 * Tolerates RLS rejections (returns false on error). Non-RLS errors are
 * logged + Sentry-reported but still return false so the
 * `hasIsAdminFlag` signal continues to work — a single DB blip on one
 * signal must not lock an admin out.
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
    if (error.code === "42501") {
      return false;
    }
    console.error("[admin] hasAdminRoleRow non-RLS error:", {
      user_id: userId,
      code: error.code,
      message: error.message,
    });
    reportNonRlsError(error, {
      fn: "hasAdminRoleRow",
      userId,
      code: error.code ?? null,
      message: error.message,
    });
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

/**
 * Internal: does `userId` have `profiles.is_admin = TRUE`?
 *
 * This is the PRIMARY signal — aligned with the DB-side RLS policies
 * which reference `profiles.is_admin = TRUE` directly. If this returns
 * TRUE the user is admin; if FALSE the gate falls through to
 * `hasAdminRoleRow` (the additive secondary).
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

  if (error) {
    if (error.code === "42501" || error.code === "PGRST116") {
      return false;
    }
    console.error("[admin] hasIsAdminFlag non-RLS error:", {
      user_id: userId,
      code: error.code,
      message: error.message,
    });
    reportNonRlsError(error, {
      fn: "hasIsAdminFlag",
      userId,
      code: error.code ?? null,
      message: error.message,
    });
    return false;
  }
  if (!data) return false;
  return data.is_admin === true;
}

/**
 * Observational logging when the legacy `ADMIN_EMAIL` env var matches
 * the caller's email but `isAdminUser` has ALREADY returned FALSE.
 * Emits a console breadcrumb so operators can see "this user would have
 * been granted via the deprecated fallback" — useful when migrating
 * away from the env-var-based break-glass to ensure no one was relying
 * on it silently.
 *
 * Intentionally fire-and-forget; never throws. NOT a grant.
 */
function logEnvEmailFallbackMatch(user: {
  id: string;
  email?: string | null;
}): void {
  if (!isAdmin(user.email)) return;
  try {
    console.warn(
      "[admin] ADMIN_EMAIL matched but is no longer a grant — user has profiles.is_admin = FALSE and no user_app_roles.admin row",
      {
        user_id: user.id,
        matched_email: user.email ?? null,
      },
    );
  } catch {
    // Logger failure must not affect the gate's return value.
  }
}

/**
 * Full admin check — SINGLE SOURCE OF TRUTH for every admin-decision
 * path that has a Supabase client.
 *
 * Returns TRUE if EITHER:
 *   - `profiles.is_admin = TRUE` (primary — matches DB-side RLS), OR
 *   - `user_app_roles.role='admin'` (secondary, additive during the
 *     Sprint 7 user_app_roles rollout).
 *
 * Returns FALSE for everything else — including a caller whose email
 * matches `ADMIN_EMAIL` but who has no profile flag and no user_app_roles
 * row. The env var only triggers an observational log breadcrumb.
 *
 * `withRole('admin')` in `src/lib/auth.ts` delegates here for the admin
 * role specifically, so the route wrapper and direct `isAdminUser`
 * callers share ONE decision.
 *
 * Returns Promise<boolean> — never throws to the caller. A failed DB
 * read on one signal does NOT short-circuit the other; the caller still
 * gets the OR of whatever signals succeeded.
 */
export async function isAdminUser(
  supabase: SupabaseClient,
  user: { id: string; email?: string | null } | null | undefined,
): Promise<boolean> {
  if (!user) return false;

  // Signal 1 (PRIMARY): profiles.is_admin — aligned with DB-side RLS.
  if (await hasIsAdminFlag(supabase, user.id)) {
    return true;
  }

  // Signal 2 (additive): user_app_roles.role='admin'. Migration 054's
  // backfill kept these two signals in sync; a manual INSERT into
  // user_app_roles without a corresponding profiles flip still grants
  // admin here so the code gate stays at least as permissive as the
  // join-table substrate.
  if (await hasAdminRoleRow(supabase, user.id)) {
    return true;
  }

  // ADMIN_EMAIL is no longer a grant — log if matched so operators can
  // see who would have been granted under the old fallback, then return
  // FALSE. This is the dead-admin fix (C-0150).
  logEnvEmailFallbackMatch(user);
  return false;
}

/**
 * Same single-source-of-truth check as {@link isAdminUser}, but the
 * caller has ALREADY fetched the user's `user_app_roles` set. Skips the
 * redundant `hasAdminRoleRow` DB round-trip and consults the caller's
 * pre-fetched set instead.
 *
 * Intended caller: `requireRole` in `src/lib/auth.ts`, which already
 * fetched `user_app_roles` via `getUserRolesResult` and would otherwise
 * issue a duplicate query under the `withRole('admin')` admin-fallback
 * path.
 *
 * Precondition: `userAppRoles` MUST be the authoritative role set from
 * `user_app_roles` for THIS user. Passing a stale or filtered set
 * re-opens the drift surface this helper closes.
 */
export async function isAdminUserGivenUserAppRoles(
  supabase: SupabaseClient,
  user: { id: string; email?: string | null } | null | undefined,
  userAppRoles: readonly string[],
): Promise<boolean> {
  if (!user) return false;

  // Signal 1 (PRIMARY): profiles.is_admin.
  if (await hasIsAdminFlag(supabase, user.id)) {
    return true;
  }

  // Signal 2 (additive): user_app_roles — derived from caller's
  // pre-fetched set, not a fresh round-trip.
  if (userAppRoles.includes("admin")) {
    return true;
  }

  // ADMIN_EMAIL: observational only.
  logEnvEmailFallbackMatch(user);
  return false;
}
