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
 * The exports below form the Task 7.2 public surface:
 *
 *   - `AppRole`          — the closed TS union of role strings.
 *   - `RoleContext<P>`   — the context a `withRole` handler receives.
 *   - `RoleHandler<P>`   — the handler signature `withRole` expects.
 *   - `getUserRoles(id)` — DB fetch of a specific user's role set.
 *   - `requireRole(...)` — server-side guard returning EITHER a 401/403
 *                          NextResponse OR the caller's resolved role set.
 *   - `withRole(role)`   — route wrapper alongside `withAdminAuth` for
 *                          routes that need role-gated access. Threads
 *                          the Next 16 `{ params }` context through to
 *                          the handler alongside the resolved user /
 *                          role set / user-scoped supabase client.
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
 * Discriminated-union result of {@link requireRole}. Either the caller
 * failed the guard (`forbidden` holds the 401/403 NextResponse to return)
 * or they passed (`roles` holds their resolved role set so the caller can
 * skip a second `getUserRoles` round-trip).
 */
export type RequireRoleResult =
  | { forbidden: NextResponse }
  | { roles: AppRole[] };

/**
 * Server-side role guard. Call at the top of a Route Handler after
 * `createClient()` + `auth.getUser()`; returns either a `forbidden`
 * NextResponse (401 if unauthenticated, 403 if the caller lacks ANY of
 * the requested roles) or the caller's full resolved role set.
 *
 * The role set is returned so callers (notably {@link withRole}) can
 * build a handler context without issuing a second `getUserRoles` call.
 *
 *   const result = await requireRole(supabase, user, "admin");
 *   if ("forbidden" in result) return result.forbidden;
 *   const { roles } = result; // caller's resolved roles
 *
 * If `user` is null (unauthenticated), returns a 401 — matches `withAuth`.
 * If `roles` is empty the caller is treated as "must be authenticated but
 * no specific role required" and the resolved role set is still fetched
 * (one round-trip, consistent with the documented contract).
 */
export async function requireRole(
  supabase: SupabaseClient,
  user: User | null,
  ...roles: AppRole[]
): Promise<RequireRoleResult> {
  if (!user) {
    return {
      forbidden: NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      ),
    };
  }

  const userRoles = await getUserRoles(supabase, user.id);

  if (roles.length === 0) {
    // Caller passed no roles — treat as "must be authenticated but no
    // specific role required". Return the resolved set so the caller
    // can still branch on role membership without another round-trip.
    return { roles: userRoles };
  }

  const hasAny = roles.some((r) => userRoles.includes(r));
  if (!hasAny) {
    return {
      forbidden: NextResponse.json(
        { error: "Forbidden" },
        { status: 403 },
      ),
    };
  }

  return { roles: userRoles };
}

/**
 * Context object passed to a `withRole`-wrapped handler.
 *
 * - `user`: the authenticated caller (non-null once the wrapper passes).
 * - `roles`: the caller's full resolved role set (superset of the required roles).
 * - `supabase`: the user-scoped Supabase client the wrapper already created.
 *   Reuse this for DB reads/writes that should run under the caller's JWT
 *   (RLS-scoped queries, audit-event emission where `auth.uid()` matters).
 *   For cross-tenant admin writes, still use `createAdminClient()`.
 * - `params`: the resolved Next 16 dynamic-route params — generic over
 *   the route's param shape, defaults to `unknown`.
 */
export type RoleContext<P = unknown> = {
  user: User;
  roles: AppRole[];
  supabase: SupabaseClient;
  params: P;
};

/** Handler signature for `withRole`. Mirrors `withAuth` (Next 16
 * `NextRequest` → `NextResponse`) plus a {@link RoleContext} so the
 * handler gets the user, resolved role set, user-scoped Supabase
 * client, and resolved dynamic-route params in one object. */
export type RoleHandler<P = unknown> = (
  req: NextRequest,
  ctx: RoleContext<P>,
) => Promise<NextResponse>;

/**
 * Route wrapper: requires the caller to hold at least one of `roles`.
 * Mutating methods (POST/PUT/PATCH/DELETE) also get the CSRF same-origin
 * check via `assertSameOrigin`, matching `withAuth`.
 *
 * Threads the Next 16 dynamic-route `{ params }` context through so
 * dynamic routes don't need to re-parse `req.url` manually. The generic
 * `P` is the shape of the resolved params for a given route.
 *
 * Usage (static route):
 *
 *   export const POST = withRole("admin")(async (req, { user }) => {
 *     return NextResponse.json({ ok: true });
 *   });
 *
 * Usage (dynamic route — `app/api/admin/users/[id]/roles/route.ts`):
 *
 *   export const POST = withRole<{ id: string }>("admin")(
 *     async (req, { user, params, supabase }) => {
 *       const { id } = params;
 *       // ...
 *     },
 *   );
 *
 *   // Multiple allowed roles:
 *   export const POST = withRole("admin", "quant_manager")(async (...) => { ... });
 *
 * This wrapper is a PEER to `withAdminAuth`, not a replacement. See
 * ADR-0005 for the sprint-over-sprint migration plan.
 */
export function withRole<P = unknown>(...roles: AppRole[]) {
  return function (handler: RoleHandler<P>) {
    return async (
      req: NextRequest,
      rawCtx: { params: Promise<P> } = {
        params: Promise.resolve({} as P),
      },
    ): Promise<NextResponse> => {
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

      const result = await requireRole(supabase, user, ...roles);
      if ("forbidden" in result) return result.forbidden;

      // `user` is guaranteed non-null here — requireRole returns the 401
      // branch above when user is null, which we already returned.
      const params = await rawCtx.params;
      return handler(req, {
        user: user!,
        roles: result.roles,
        supabase,
        params,
      });
    };
  };
}
