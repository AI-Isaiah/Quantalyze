import "server-only";
import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { assertSameOrigin } from "@/lib/csrf";

/**
 * Role-Based Access Control (RBAC) helpers.
 *
 * Sprint 6 closeout Task 7.2. See migration 054 (user_app_roles) and
 * ADR-0005 (admin-authorization) for the full rationale. TL;DR:
 *
 *   - `user_app_roles` is a join table: (user_id, role) with role in
 *     ('admin','allocator','quant_manager','analyst').
 *   - A user can hold multiple roles. Grants go through an admin UI
 *     and are audited (see src/lib/audit.ts).
 *   - Legacy `profiles.is_admin` remains the canonical admin gate for
 *     `withAdminAuth` + `isAdminUser()` until Sprint 7 fans `withRole`
 *     out across all admin routes. This file ships the new path; the
 *     old path keeps working in parallel.
 *
 * The three exports below form the Task 7.2 public surface:
 *
 *   - `AppRole`          — the closed TS union of role strings.
 *   - `getUserRoles(id)` — DB fetch of a specific user's role set.
 *   - `requireRole(...)` — server-side guard returning a 403 NextResponse
 *                          when the caller lacks the required roles.
 *   - `withRole(role)`   — route wrapper alongside `withAdminAuth` for
 *                          routes that need role-gated access.
 *
 * The SQL helper `current_user_has_app_role(TEXT[])` (migration 054) is
 * the counterpart of `requireRole` at the Postgres layer. Both consult
 * `user_app_roles`. Defense in depth: new routes should use BOTH — the
 * route wrapper (so the response is 403 before touching the DB) AND the
 * RLS policy on the target table (so a bypassed route can't widen access).
 */

/**
 * Canonical app role union. Kept in sync with the
 * `user_app_roles_role_check` constraint in migration 054. Adding a new
 * role requires:
 *   1. Updating the CHECK constraint (new migration).
 *   2. Adding the literal to `APP_ROLES` and this union.
 *   3. Updating ADR-0005's role table.
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

/**
 * Fetch the role set for a specific user. Returns an empty array if the
 * user has no roles (or doesn't exist — we don't distinguish those two
 * cases here, callers that need to shouldn't use this helper).
 *
 * Caller supplies the Supabase client. For user-JWT code paths pass the
 * client from `createClient()`; RLS filters to owner OR admin rows so a
 * non-admin caller reading someone else's roles gets an empty set (which
 * is the right answer — they have no read access).
 *
 * For admin-UI paths that need to read any user's roles, pass the admin
 * client from `createAdminClient()` — service_role bypasses RLS.
 */
export async function getUserRoles(
  supabase: SupabaseClient,
  userId: string,
): Promise<AppRole[]> {
  const { data, error } = await supabase
    .from("user_app_roles")
    .select("role")
    .eq("user_id", userId);

  if (error) {
    console.error("[auth] getUserRoles failed:", {
      user_id: userId,
      message: error.message,
      code: error.code,
    });
    return [];
  }

  if (!data) return [];

  // Filter to known AppRole values in case the DB constraint ever drifts
  // (defensive; the CHECK constraint in migration 054 should prevent it).
  return data
    .map((row) => row.role as string)
    .filter((role): role is AppRole =>
      (APP_ROLES as readonly string[]).includes(role),
    );
}

/**
 * Server-side role guard. Call at the top of a Route Handler after
 * `createClient()` + `auth.getUser()`; returns a `NextResponse` with
 * status 403 if the caller lacks ANY of the requested roles, or `null`
 * on pass-through.
 *
 * Why a response-or-null shape: mirrors `assertSameOrigin` in src/lib/csrf.ts
 * so the call-site idiom is identical.
 *
 *   const forbidden = await requireRole(supabase, user, "admin");
 *   if (forbidden) return forbidden;
 *
 * If `user` is null (unauthenticated), returns 401 — matches `withAuth`.
 */
export async function requireRole(
  supabase: SupabaseClient,
  user: User | null,
  ...roles: AppRole[]
): Promise<NextResponse | null> {
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (roles.length === 0) {
    // Caller passed no roles — treat as "must be authenticated but no
    // specific role required". Return null so the caller proceeds.
    // This is the conservative read of requireRole(user, /* nothing */).
    return null;
  }

  const userRoles = await getUserRoles(supabase, user.id);
  const hasAny = roles.some((r) => userRoles.includes(r));
  if (!hasAny) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return null;
}

/** Handler signature for `withRole`. Mirrors `withAuth` (Next 16
 * `NextRequest` → `NextResponse`) plus the user + resolved role set so
 * the handler doesn't re-query the DB. */
export type RoleHandler = (
  req: NextRequest,
  ctx: { user: User; roles: AppRole[] },
) => Promise<NextResponse>;

/**
 * Route wrapper: requires the caller to hold at least one of `roles`.
 * Mutating methods (POST/PUT/PATCH/DELETE) also get the CSRF same-origin
 * check via `assertSameOrigin`, matching `withAuth`.
 *
 * Usage:
 *
 *   export const POST = withRole("admin")(async (req, { user }) => {
 *     // ... only admins reach here
 *     return NextResponse.json({ ok: true });
 *   });
 *
 *   // Multiple allowed roles:
 *   export const POST = withRole("admin", "quant_manager")(async (...) => { ... });
 *
 * This wrapper is a PEER to `withAdminAuth`, not a replacement. See
 * ADR-0005 for the sprint-over-sprint migration plan.
 */
export function withRole(...roles: AppRole[]) {
  return function (handler: RoleHandler) {
    return async (req: NextRequest): Promise<NextResponse> => {
      // CSRF defense-in-depth on mutating requests. GET/HEAD/OPTIONS
      // are safe and skip the origin check.
      if (
        req.method !== "GET" &&
        req.method !== "HEAD" &&
        req.method !== "OPTIONS"
      ) {
        const csrfError = assertSameOrigin(req);
        if (csrfError) return csrfError;
      }

      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const forbidden = await requireRole(supabase, user, ...roles);
      if (forbidden) return forbidden;

      // `user` is guaranteed non-null here — requireRole returns 401 above.
      // Fetch the full role set once so the handler can branch on it
      // without a second round-trip.
      const userRoles = await getUserRoles(supabase, user!.id);

      return handler(req, { user: user!, roles: userRoles });
    };
  };
}
