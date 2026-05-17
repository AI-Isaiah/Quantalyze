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
 * Adding a new role requires updates in FOUR places (audit-2026-05-07
 * M-0500 — the previous "THREE places" claim missed the runtime array):
 *
 *   1. The migration 054 `user_app_roles_role_check` constraint.
 *   2. The `AppRole` type union below.
 *   3. The `APP_ROLES` runtime array below — the role-list value used
 *      by admin UIs and by the regression test in `auth.test.ts` that
 *      asserts the four expected roles in a stable order.
 *   4. The ADR-0005 role table.
 *
 * `AppRole` and `APP_ROLES` live in the SAME file now, but they are
 * still two distinct sources of truth — one type, one value — that the
 * compiler does NOT cross-check (TS can't enforce that a runtime array
 * exactly enumerates a union). The auth.test.ts regression guard is the
 * only thing keeping them aligned.
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
