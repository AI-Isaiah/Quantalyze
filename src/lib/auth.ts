import "server-only";
import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { assertSameOrigin } from "@/lib/csrf";
import { APP_ROLES, type AppRole } from "@/lib/auth-types";
import { isAdminUser, isAdminUserGivenUserAppRoles } from "@/lib/admin";
// NEW-C15-01: lazy import to avoid adding a static top-level import to a
// widely-tested module (auth.ts). The dynamic import is resolved on the
// first withRole call that needs the approval gate — well before any RPC
// work — and the module is cached by the Node module system thereafter.
// This also matches the lazy-import pattern already used in audit.ts for
// @sentry/nextjs, keeping the module-init surface minimal under vitest.
type ApprovalGateModule = typeof import("@/lib/api/approval-gate");
let _approvalGate: ApprovalGateModule | null = null;
async function getApprovalGate(): Promise<ApprovalGateModule> {
  if (!_approvalGate) {
    _approvalGate = await import("@/lib/api/approval-gate");
  }
  return _approvalGate;
}

// Re-exported here so server-side callers can keep using
// `import { AppRole, APP_ROLES } from "@/lib/auth"`. The raw types live
// in a client-importable module; this file owns the server-only surface.
export { APP_ROLES, type AppRole };

/**
 * Role-Based Access Control (RBAC) helpers. `user_app_roles` is the
 * `(user_id, role)` join table; roles ∈
 * ('admin','allocator','quant_manager','analyst'); a user may hold
 * multiple roles.
 *
 * The admin decision has a SINGLE SOURCE OF TRUTH (audit-2026-05-07
 * C-0144 + C-0150): `isAdminUser()` in `src/lib/admin.ts`. The check is:
 *
 *     admin = (profiles.is_admin = TRUE)            -- primary (matches RLS)
 *           OR (user_app_roles.role='admin')        -- additive (Sprint 7 rollout)
 *
 * `ADMIN_EMAIL` is OBSERVATIONAL ONLY — it no longer grants admin.
 * `withRole('admin')` delegates to `isAdminUser` (via
 * `isAdminUserGivenUserAppRoles`, which trusts the already-fetched
 * user_app_roles set instead of issuing a redundant round-trip). Non-admin
 * role requests resolve through `user_app_roles` alone — there is no
 * profile-flag analogue for `allocator` / `quant_manager` / `analyst`.
 *
 * Defense in depth: new routes should use BOTH the route wrapper (so the
 * response is 403 before touching the DB) AND the RLS policy on the
 * target table (so a bypassed route can't widen access).
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
 * M-0501 (audit-2026-05-07): memoized so duplicate calls inside the same
 * logical scope with the same `(supabase, userId)` pair share one DB
 * round-trip.
 *
 * Implementation note: originally wrapped with React `cache()` for
 * RSC-render-scope dedup, but `cache()` in React 19 is ONLY active inside
 * the renderer's per-request AsyncLocalStorage — Route Handlers and any
 * non-RSC execution path get NO dedup. Vitest also cannot observe the
 * dedup, so the contract test (auth.test.ts:272) was unprovable. We now
 * use a WeakMap keyed on the SupabaseClient instance, with an inner Map
 * of `userId → Promise<GetUserRolesResult>`. This makes the dedup
 * deterministic in every environment (RSC, Route Handler, Edge, vitest)
 * while preserving the existing safety property: distinct SupabaseClient
 * instances do NOT share cache entries, so a fresh client per request
 * (the standard `await createClient()` pattern) gets fresh roles. The
 * outer WeakMap lets the entire role map garbage-collect when the client
 * is released, so there is no cross-request leak.
 *
 * Cross-user contamination is impossible while distinct SupabaseClient
 * instances are passed. The `withRole` wrapper guarantees this — it
 * builds ONE client via `createClient()` and reuses it for `getUser()` +
 * `requireRole()` + the handler context. `createClient()` itself is NOT
 * memoized, so two `await createClient()` calls in the same request
 * return two distinct clients and bypass this cache. New call sites
 * outside `withRole` must reuse a single client per request or accept
 * the duplicate round-trip.
 *
 * DANGER ZONE: if a future refactor wraps `createClient()` with a cache
 * that yields the SAME instance for two requests inside a warm Lambda,
 * two requests could share both the SupabaseClient identity AND the
 * resolved role set — cross-user contamination becomes possible. Pin
 * fresh-per-request before landing such a refactor. Cross-request
 * caching (JWT custom claims, Edge Config) is tracked as a Sprint 7
 * follow-up — see ADR-0005.
 *
 * NEW-C15-03 (audit-2026-05-26 red-team): INTRA-REQUEST TOCTOU WINDOW.
 * The memo FREEZES the role set for the lifetime of the SupabaseClient
 * used in a given request. A role REVOKE that lands between the outer
 * `withRole` gate and a subsequent `getUserRoles`/`requireRole` call on
 * the SAME client (e.g. inside an `after()`-deferred task, or a long-
 * running streaming response) will NOT be observed — the cached promise
 * returns the pre-revoke role set. This creates an intra-request
 * staleness window that `requireAdmin` (which always re-queries fresh)
 * does NOT share, so the two verification paths DISAGREE after a revoke.
 *
 * MANDATORY RULE: privileged RPCs (sanitize_user, log_audit_event_service,
 * or any SECURITY DEFINER function) MUST be gated by `requireAdmin` or
 * `isAdminUser` — NOT by `getUserRoles`/`requireRole` after the initial
 * `withRole` check. These helpers issue a fresh DB query and are
 * unaffected by the memo. See {@link requireAdmin} for the recommended
 * TOCTOU-close pattern.
 *
 * Use {@link getUserRoles} only for read-only authorization decisions
 * that can tolerate the intra-request window (e.g. reading the role set
 * to shape a UI response, where a stale 'admin' grants no extra write
 * privilege beyond what is already gated at the RPC level).
 */
const rolesByClient = new WeakMap<SupabaseClient, Map<string, Promise<GetUserRolesResult>>>();

export async function getUserRolesResult(
  supabase: SupabaseClient,
  userId: string,
): Promise<GetUserRolesResult> {
  let perUser = rolesByClient.get(supabase);
  if (!perUser) {
    perUser = new Map();
    rolesByClient.set(supabase, perUser);
  }
  const cached = perUser.get(userId);
  if (cached) return cached;
  // Cache the PROMISE (not the resolved value) so concurrent callers share
  // the in-flight round-trip rather than racing to start a second one.
  const promise = fetchUserRolesResult(supabase, userId);
  perUser.set(userId, promise);
  // Evict on failure so a transient DB blip doesn't poison the cache for the
  // remaining lifetime of this SupabaseClient. Successful results (including
  // `{ ok: true, roles: [] }`) stay cached — that IS the dedup contract.
  promise
    .then((result) => {
      if (!result.ok) perUser?.delete(userId);
    })
    .catch(() => perUser?.delete(userId));
  return promise;
}

async function fetchUserRolesResult(
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
}

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
    // audit-2026-05-07 C-0144 + C-0150: admin-gate consolidation.
    //
    // `withRole('admin')` and `isAdminUser` share ONE decision — they
    // are no longer parallel gates. If the caller is requesting the
    // 'admin' role and user_app_roles does not return an admin row,
    // delegate to the canonical `isAdminUser` check (which consults
    // `profiles.is_admin` as the PRIMARY signal — matches DB-side RLS
    // — and `user_app_roles.role='admin'` as the additive secondary).
    // `ADMIN_EMAIL` is no longer a grant; it only emits an observational
    // log. So:
    //   - "Ghost-admin" (profile.is_admin=TRUE, no role enum) → admin ✓
    //   - "Dead-admin"  (in ADMIN_EMAIL, profile.is_admin=FALSE) → NOT admin ✗
    //
    // Non-admin role requests skip this branch — there is no fallback
    // signal for `allocator` / `quant_manager` / `analyst`, so
    // `user_app_roles` is authoritative for those.
    //
    // Use the `isAdminUserGivenUserAppRoles` variant which trusts the
    // already-fetched `userRoles` as the user_app_roles signal instead
    // of re-issuing the join-table query. On the non-admin reject path
    // this drops DB round-trips from 3 → 2.
    if (roles.includes("admin")) {
      const adminUnion = await isAdminUserGivenUserAppRoles(
        supabase,
        user,
        userRoles,
      );
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
 * Typical use (inside a `withRole`-wrapped handler, which has already
 * run the CSRF check — pass `req` anyway for defense-in-depth):
 *
 *   const guard = await requireAdmin(supabase, user, req);
 *   if (guard) return guard;
 *   const { data } = await admin.rpc('sanitize_user', { p_user_id });
 *
 * The function is intentionally re-entrant — calling it before EVERY
 * privileged RPC is the recommended pattern (cheap: one DB round-trip
 * on success, one extra one on the rare race). The accompanying
 * DB-side sentinel trigger inside `sanitize_user` (migration 120) is
 * the second half of the defense-in-depth: even if a race slips this
 * TS check, the RPC refuses to fire without an admin context.
 *
 * CSRF (audit-2026-05-07 red-team, MED conf 8): when `req` is
 * supplied, mutating-method calls (POST/PUT/PATCH/DELETE) also pass
 * through `assertSameOrigin` — closing the gap where a future caller
 * uses `requireAdmin` STANDALONE inside a mutating route (without
 * going through `withRole` / `withAdminAuth`) and inherits no CSRF
 * defense. The `req` parameter is OPTIONAL only to keep the
 * sub-resource TOCTOU-close call sites (which already ran CSRF in the
 * outer wrapper) source-compatible; new mutating call sites MUST pass
 * `req` so the CSRF gate fires.
 *
 * Defense-in-depth (call sites are encouraged to pass `req` even
 * inside a withRole-wrapped handler): an attacker who somehow lands a
 * mutating POST past the outer wrapper but bypasses CSRF still gets a
 * second CSRF veto here. The cost is one Origin-header comparison
 * (no I/O), which is negligible.
 */
export async function requireAdmin(
  supabase: SupabaseClient,
  user: User | null,
  req?: NextRequest,
): Promise<NextResponse | null> {
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // CSRF defense-in-depth on mutating requests. GET/HEAD/OPTIONS are
  // safe methods and skip the origin check. We only run the check if
  // a request object was supplied; older call sites that did not pass
  // `req` remain compatible (they are all inside withRole/withAdminAuth
  // wrappers that already ran CSRF). audit-2026-05-07 red-team MED.
  if (
    req &&
    req.method !== "GET" &&
    req.method !== "HEAD" &&
    req.method !== "OPTIONS"
  ) {
    const csrfError = assertSameOrigin(req);
    if (csrfError) return csrfError;
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
 * Options for {@link withRole}.
 *
 * NEW-C15-01 (audit-2026-05-26 red-team): `withAuth` and `withAllocatorAuth`
 * both enforce `assertProfileApproved` by default — `withRole` was missing this
 * gate, leaving a latent fail-open for any future non-admin role route. Without
 * the gate, a freshly-registered but UNAPPROVED user who holds a role enum row
 * (every new signup lands with a role but unapproved) can reach the handler. For
 * admin routes today `isProfileApproved` short-circuits on `is_admin=true` (no
 * observable bug), but Sprint 7 plans to route `allocator`/`quant_manager`/
 * `analyst` roles through this same wrapper — those users CAN be unapproved.
 *
 * Default: `requireApproval: true`. Opt out only for routes that explicitly
 * serve pending-approval callers (e.g. an account-deletion route or a public
 * status endpoint). Mirror of {@link WithAuthOptions} in `withAuth.ts`.
 */
export interface WithRoleOptions {
  requireApproval?: boolean;
}

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
 *   // Opt out of approval gate (rare — only for pending-approval surfaces):
 *   export const POST = withRole("admin", { requireApproval: false })(async (...) => { ... });
 *
 * This wrapper is a PEER to `withAdminAuth`, not a replacement. See
 * ADR-0005 for the sprint-over-sprint migration plan.
 */
export function withRole<P = Record<string, never>>(
  ...args: [AppRole, ...AppRole[]] | [...([AppRole, ...AppRole[]]), WithRoleOptions]
) {
  // Split trailing options object from role list. Options must be a plain
  // object (not a string), so the check is safe even if no options are passed.
  const lastArg = args[args.length - 1];
  const hasOptions = lastArg !== null && typeof lastArg === "object" && !Array.isArray(lastArg);
  const roles = (hasOptions ? args.slice(0, -1) : args) as [AppRole, ...AppRole[]];
  const options: WithRoleOptions = hasOptions ? (lastArg as WithRoleOptions) : {};
  const requireApproval = options.requireApproval ?? true;

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

      // NEW-C15-01: approval gate. Mirrors withAuth's requireApproval default.
      // Uses a lazy dynamic import so auth.ts's module initialisation isn't
      // widened (avoids hoisting conflicts in vitest that broke APP_ROLES
      // export during test collection). The module is cached after first load.
      if (requireApproval) {
        const gate = await getApprovalGate();
        const denied = await gate.assertProfileApproved(supabase, user.id);
        if (denied) return denied;
      }

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
