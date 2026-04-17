/**
 * Shared RBAC type primitives — the *type* layer of `src/lib/auth.ts`
 * extracted into a `server-only`-free module so client components can
 * import the same source of truth.
 *
 * Sprint 6 closeout /review follow-up (T2-I2): the `AppRole` union +
 * `APP_ROLES` literal array previously lived in `src/lib/auth.ts` which
 * is `server-only`. Client components (notably the admin
 * `UserRolesPanel`) had to duplicate the role list. Three copies of the
 * same source of truth (SQL CHECK in migration 054, `auth.ts`, and the
 * client panel) is one drift surface too many; we collapse the two TS
 * copies into one and leave the migration SQL as the ground-truth
 * side-by-side.
 *
 * This file has NO `server-only` directive by design — importing it
 * from a client component must keep working. Anything that needs a
 * Supabase client, `auth.getUser`, or `NextResponse` lives in
 * `src/lib/auth.ts` (which re-exports these types so existing
 * server-side imports keep resolving without a rewrite).
 *
 * Adding a new role still requires updates in THREE places, the same
 * as before — migration CHECK constraint, the `AppRole` union here, and
 * the ADR-0005 role table — but the two TS spots are now in one file
 * instead of two files that could silently drift.
 */

/**
 * Canonical app role union. Kept in sync with the
 * `user_app_roles_role_check` constraint in migration 054.
 */
export type AppRole = "admin" | "allocator" | "quant_manager" | "analyst";

/** Runtime array of all valid role strings. Useful for validation in
 * admin UIs that build a checkbox list from this source of truth. */
export const APP_ROLES: readonly AppRole[] = [
  "admin",
  "allocator",
  "quant_manager",
  "analyst",
] as const;
