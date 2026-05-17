import "server-only";
import { cache } from "react";
import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { assertSameOrigin } from "@/lib/csrf";
import { APP_ROLES, type AppRole } from "@/lib/auth-types";
import { isAdminUser } from "@/lib/admin";

// Re-export so existing server-side callers (routes, tests) keep
// resolving `import { AppRole, APP_ROLES } from "@/lib/auth"` without a
// rewrite. The /review follow-up (T2-I2) extracted the raw types into a
// client-importable module; this file now owns the server-only surface
// (Supabase client, NextResponse, etc.) while keeping the single-import
// ergonomics for existing server-side consumers.
export { APP_ROLES, type AppRole };

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
 * Postgrest/Postgres error codes that getUserRoles treats as "expected"
 * non-error states — both map to "the user has no roles visible from
 * this caller":
 *
 *   - '42501' — Postgres `insufficient_privilege` (RLS denial). Caller
 *     has no read access to the row(s); from the caller's perspective
 *     the user has no visible roles.
 *   - 'PGRST116' — PostgREST "no rows" sentinel. Empty result set
 *     under maybeSingle()-style helpers; for our `.select` chain this
 *     surfaces only on adjacent helpers but is kept here for parity.
 *
 * Any OTHER error (timeout, connection refused, malformed SQL,
 * permission failures unrelated to RLS, schema drift, etc.) is a real
 * fault. Pre-fix, getUserRoles caught EVERY error and returned `[]`,
 * which `requireRole` then translated to a silent 403 for a legitimate
 * admin — masking outages as authorization errors. Finding 5 narrows
 * the swallow.
 */
const EXPECTED_NO_ROLES_CODES = new Set<string>(["42501", "PGRST116"]);

/**
 * Discriminated-union return shape for {@link getUserRolesResult} — the
 * error-aware sibling of {@link getUserRoles}.
 *
 * The legacy `getUserRoles` callers want `AppRole[]` and treat every
 * error as "no roles". The new shape lets callers (notably
 * `requireRole`) distinguish "no roles" from "fetch faulted" so the
 * latter surfaces as 500 instead of silently 403.
 */
export type GetUserRolesResult =
  | { ok: true; roles: AppRole[] }
  | { ok: false; error: { code: string | null; message: string } };

/**
 * Fetch the role set for a specific user, returning an explicit
 * discriminated union. Returns `{ ok: true, roles: [] }` for the
 * expected "no roles visible" path (RLS denial or empty result),
 * and `{ ok: false, error }` for any unexpected fault.
 *
 * Use this when the caller needs to distinguish "no roles" from
 * "fetch failed" — typically inside a guard that wants to return 500
 * on real DB faults rather than 403.
 *
 * M-0501 (audit-2026-05-07): wrapped with React `cache()` so duplicate
 * calls inside the SAME request with the same `(supabase, userId)`
 * pair share one DB round-trip. The cache is REQUEST-SCOPED — does NOT
 * memoize across requests, Lambda invocations, or sessions.
 *
 * React `cache()` keys on argument IDENTITY (===), so a cache hit
 * requires the caller to pass the SAME SupabaseClient instance. The
 * `withRole` wrapper guarantees this — it builds ONE client via
 * `createClient()` and reuses it for `getUser()` + `requireRole()` +
 * the handler context — but `createClient()` itself (in
 * `src/lib/supabase/server.ts`) is NOT `cache()`-wrapped, so two
 * independent `await createClient()` calls within the same request
 * return two distinct clients and bypass this cache. New call sites
 * outside `withRole` must reuse a single client per request or accept
 * the duplicate round-trip. Audit reference: audit-2026-05-07 security
 * S2 (MED conf 8). Cross-request caching (JWT custom claims, Edge
 * Config) is tracked as a Sprint 7 follow-up — see ADR-0005.
 */
export const getUserRolesResult = cache(async function getUserRolesResult(
  supabase: SupabaseClient,
  userId: string,
): Promise<GetUserRolesResult> {
  const { data, error } = await supabase
    .from("user_app_roles")
    .select("role")
    .eq("user_id", userId);

  if (error) {
    const code = (error as { code?: string | null }).code ?? null;
    if (code && EXPECTED_NO_ROLES_CODES.has(code)) {
      // Expected non-error: RLS denial or no-rows. Caller-facing answer
      // is "this user has no visible roles".
      return { ok: true, roles: [] };
    }
    // Real fault — propagate so the caller can return 500 instead of
    // mis-translating to 403.
    console.error("[auth] getUserRolesResult faulted:", {
      user_id: userId,
      message: error.message,
      code,
    });
    return { ok: false, error: { code, message: error.message } };
  }

  if (!data) return { ok: true, roles: [] };

  // H-0429 (audit-2026-05-07): the DB CHECK constraint on
  // `user_app_roles.role` is the source-of-truth narrowing. The TS layer
  // still treats Supabase's untyped `.from("user_app_roles").select(...)`
  // shape as a heterogeneous row, so we use `APP_ROLES.includes` as the
  // type predicate. `String(row.role)` (instead of `row.role as string`)
  // coerces non-string DB values defensively rather than asserting them.
  const roles = data
    .map((row: { role: unknown }) => String(row.role))
    .filter((role): role is AppRole =>
      (APP_ROLES as readonly string[]).includes(role),
    );
  return { ok: true, roles };
});

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
 *
 * Finding 5 (audit-2026-05-07 red-team): pre-fix this helper swallowed
 * EVERY error and returned `[]`, which `requireRole` then translated to
 * a silent 403 — masking real outages as "you're not authorized".
 * Now: only the expected RLS-denial / no-rows codes are swallowed; any
 * other error is logged AND the helper still returns `[]` for backward
 * compatibility with the many legacy callers that ignore the
 * discrimination. Callers that need to fail-loud on real faults should
 * use {@link getUserRolesResult} instead — `requireRole` does.
 */
export async function getUserRoles(
  supabase: SupabaseClient,
  userId: string,
): Promise<AppRole[]> {
  const result = await getUserRolesResult(supabase, userId);
  if (!result.ok) {
    // Already logged in getUserRolesResult. Legacy contract: return [].
    return [];
  }
  return result.roles;
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
 *
 * Type-level safety (audit-2026-05-07 H-0428): the variadic `roles`
 * parameter is typed `[AppRole, ...AppRole[]]` — a non-empty tuple — so
 * calling `requireRole(supabase, user)` with zero roles is a COMPILE
 * error. Pre-fix the empty-args form silently fell through to an
 * authenticated-only gate, which is a different security contract
 * mistakenly accessible through the same function signature. Routes
 * that need authenticated-only gating should use `withAuth` instead.
 */
export async function requireRole(
  supabase: SupabaseClient,
  user: User | null,
  ...roles: [AppRole, ...AppRole[]]
): Promise<RequireRoleResult> {
  if (!user) {
    return {
      forbidden: NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      ),
    };
  }

  // Finding 5 (audit-2026-05-07 red-team): pre-fix, getUserRoles
  // swallowed every error and returned []. A genuine fault (DB
  // timeout, schema drift, etc.) then made `hasAny` evaluate to false
  // and `requireRole` returned 403 — masking outages as authorization
  // errors. Now we use the discriminated variant; non-42501/PGRST116
  // errors propagate as a 500 so on-call sees the real signal.
  const rolesResult = await getUserRolesResult(supabase, user.id);
  if (!rolesResult.ok) {
    return {
      forbidden: NextResponse.json(
        { error: "Internal Server Error" },
        { status: 500 },
      ),
    };
  }
  const userRoles = rolesResult.roles;

  // The non-empty tuple type on `roles` (H-0428) guarantees length >= 1
  // here, so we never need a zero-role fall-through branch.
  const hasAny = roles.some((r) => userRoles.includes(r));
  if (!hasAny) {
    // audit-2026-05-07 P459 + P699 + P703: admin-gate consolidation.
    //
    // `withRole('admin')` and the legacy `isAdminUser` must agree on the
    // SAME decision. If the caller is requesting the 'admin' role and
    // user_app_roles does not return an admin row, fall back to the
    // unified `isAdminUser` check (which OR's user_app_roles, the legacy
    // `profiles.is_admin` column, and the audited ADMIN_EMAIL env
    // fallback). A grant in any one of those three signals lights up
    // BOTH the route wrapper and the legacy guard, closing the drift
    // surface a parallel-RBAC reviewer flagged.
    //
    // Non-admin role requests skip this branch — there is no fallback
    // signal for `allocator` / `quant_manager` / `analyst`, so the
    // user_app_roles check is authoritative for those.
    if (roles.includes("admin")) {
      const adminUnion = await isAdminUser(supabase, user);
      if (adminUnion) {
        // Synthesize the admin role into the resolved set so handlers
        // that read `roles` from the context see a consistent answer.
        // Idempotent under repeated grants — Array.includes guards.
        const resolved = userRoles.includes("admin")
          ? userRoles
          : [...userRoles, "admin" as AppRole];
        return { roles: resolved };
      }
    }
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
 * Server-side admin guard — TOCTOU close for sanitize_user and other
 * privileged RPCs (audit-2026-05-07 P705).
 *
 * Re-verifies the caller's admin status against the SAME unified union
 * source (`isAdminUser` in `src/lib/admin.ts`) immediately before a
 * privileged RPC call. Use this at the call site of `sanitize_user`,
 * `log_audit_event_service`, or any other SECURITY DEFINER RPC where
 * the gap between the route wrapper's auth check and the RPC execution
 * is wide enough for a role-revoke to slip through.
 *
 * Returns:
 *   - `null` — caller is still an admin; proceed with the RPC.
 *   - a `NextResponse` — caller is no longer an admin (or never was);
 *     return this response immediately. Caller MUST NOT continue.
 *
 * Typical use:
 *
 *   const guard = await requireAdmin(supabase, user);
 *   if (guard) return guard;
 *   const { data } = await admin.rpc('sanitize_user', { p_user_id });
 *
 * The function is intentionally re-entrant — calling it before EVERY
 * privileged RPC is the recommended pattern (cheap: one DB round-trip
 * on success, one extra one on the rare race). The accompanying
 * DB-side sentinel trigger inside `sanitize_user` (migration 120) is
 * the second half of the defense-in-depth: even if a race slips this
 * TS check, the RPC refuses to fire without an admin context.
 */
export async function requireAdmin(
  supabase: SupabaseClient,
  user: User | null,
): Promise<NextResponse | null> {
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ok = await isAdminUser(supabase, user);
  if (!ok) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

/**
 * Context object passed to a `withRole`-wrapped handler.
 *
 * - `user`: the authenticated caller (non-null once the wrapper passes).
 * - `roles`: the caller's full resolved role set (superset of the required roles).
 *   SECURITY: this is the actor's COMPLETE role membership (e.g.
 *   `['admin', 'allocator']`). Treat it as internal — do NOT log, echo
 *   to clients, or include in error responses (audit-2026-05-07 H-0431
 *   / M-0502). Use `roles.includes(...)` for routing decisions; never
 *   serialize the array as-is.
 * - `supabase`: the user-scoped Supabase client the wrapper already created.
 *   Reuse this for DB reads/writes that should run under the caller's JWT
 *   (RLS-scoped queries, audit-event emission where `auth.uid()` matters).
 *   For cross-tenant admin writes, still use `createAdminClient()`.
 * - `params`: the resolved Next 16 dynamic-route params — generic over
 *   the route's param shape. Defaults to `Record<string, never>` so that
 *   STATIC routes (no `[id]` segment) compile-error on any `params.foo`
 *   access (audit-2026-05-07 H-0430 / M-0505). Dynamic routes must
 *   declare the shape explicitly via the generic parameter, e.g.
 *   `withRole<{ id: string }>("admin")`.
 */
export type RoleContext<P = Record<string, never>> = {
  user: User;
  roles: AppRole[];
  supabase: SupabaseClient;
  params: P;
};

/** Handler signature for `withRole`. Mirrors `withAuth` (Next 16
 * `NextRequest` → `NextResponse`) plus a {@link RoleContext} so the
 * handler gets the user, resolved role set, user-scoped Supabase
 * client, and resolved dynamic-route params in one object.
 *
 * Default `P = Record<string, never>` so static routes get a context
 * whose `params` is the empty shape `{}` and any `params.foo` access is
 * a compile error (audit-2026-05-07 H-0430). */
export type RoleHandler<P = Record<string, never>> = (
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
export function withRole<P = Record<string, never>>(
  ...roles: [AppRole, ...AppRole[]]
) {
  return function (handler: RoleHandler<P>) {
    return async (
      req: NextRequest,
      // H-0430 (audit-2026-05-07): the default `{ params: Promise.resolve({}) }`
      // is the STATIC-route shape — the cast lands on `Record<string, never>`
      // (the default `P`) so any `params.foo` access in a wrapper invoked
      // without a context is a compile error. Dynamic routes pass `P`
      // explicitly via the wrapper's generic, e.g.
      // `withRole<{ id: string }>("admin")`, and the runtime ALWAYS
      // supplies `rawCtx` via Next 16's route invocation — so the default
      // is only ever reached by static routes / tests, not by a
      // type-asserted dynamic route missing its params at runtime.
      rawCtx: { params: Promise<P> } = {
        params: Promise.resolve({} as P),
      },
    ): Promise<NextResponse> => {
      // M-0499 (audit-2026-05-07): auth check runs FIRST so the response
      // shape for an unauthenticated caller does not depend on Origin
      // header presence (eliminates the
      // unauth-with-good-origin = 401 vs unauth-with-bad-origin = 403
      // information disclosure). CSRF still runs for mutating methods,
      // but only AFTER the caller is authenticated.
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        return NextResponse.json(
          { error: "Unauthorized" },
          { status: 401 },
        );
      }

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

      const result = await requireRole(supabase, user, ...roles);
      if ("forbidden" in result) return result.forbidden;

      const params = await rawCtx.params;
      return handler(req, {
        user,
        roles: result.roles,
        supabase,
        params,
      });
    };
  };
}
