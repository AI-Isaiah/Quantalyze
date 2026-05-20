/**
 * RBAC manifest — single source of truth for which admin gate every
 * route under `src/app/api/admin/**` uses today, plus the target state.
 *
 * audit-2026-05-07 C-0153 (api-contract): the codebase has THREE
 * parallel admin-gating mechanisms in active use:
 *
 *   1. `withRole(...)`   — declarative wrapper, threaded params,
 *      user-scoped Supabase client. Source: `src/lib/auth.ts`.
 *   2. `withAdminAuth`   — pre-parses JSON body, returns the
 *      service-role client, requires the body to be an object.
 *      Source: `src/lib/api/withAdminAuth.ts`.
 *   3. `isAdminUser`     — inline check in the route body. Source:
 *      `src/lib/admin.ts` (the unified-union helper).
 *
 * The migration plan (ADR-0005) commits to converging on `withRole` for
 * all admin routes, but the fanout has not happened across every route
 * yet. Until it does, this manifest is the audit trail: any new admin
 * route MUST appear in this manifest with an explicit current + target
 * gate declaration, OR the route is missing an explicit RBAC gate.
 *
 * The CI check `scripts/check-admin-route-manifest.ts` (chained into
 * `npm run lint` and therefore the `frontend-lint` job in
 * `.github/workflows/ci.yml`) compares the on-disk admin routes against
 * this manifest and FAILS if a new route lacks an entry or if an
 * existing route's mechanism drifts from the manifest. That is the
 * closure for the audit finding: a new admin route can no longer slip
 * through without an explicit gate declaration.
 *
 * This file is data-only — it imports nothing and runs no logic — so
 * it can be loaded from any context (tests, CI scripts, docs gen)
 * without pulling in `server-only` or the Supabase client.
 */

/**
 * Admin-gate mechanisms in active use across `src/app/api/admin/**`.
 * New routes MUST pick one (and document the choice in the manifest
 * entry); the long-term target for ALL routes is `withRole` per
 * ADR-0005.
 *
 * `authenticated-non-admin` is a CARVE-OUT — a route that lives under
 * `/api/admin/` for historical reasons but is NOT admin-only. It must
 * still gate on `auth.getUser()` + a resource-scoped predicate
 * (e.g., `.eq("user_id", user.id)`). The only known instance is
 * `notify-submission/route.ts`; new uses require explicit review and
 * an updated note here.
 */
export type AdminGateMechanism =
  | "withRole"
  | "withAdminAuth"
  | "isAdminUser-inline"
  | "authenticated-non-admin";

export type AdminRouteEntry = {
  /** Path relative to repo root. */
  route: string;
  /** Which mechanism the route uses today. */
  current: AdminGateMechanism;
  /**
   * Target mechanism per ADR-0005. Currently this is always
   * `"withRole"` — the manifest documents the convergence direction
   * without prescribing the per-route migration timing.
   */
  target: AdminGateMechanism;
  /**
   * Free-text note for migration sequencing. Empty string for routes
   * already on the target.
   */
  notes: string;
};

/**
 * Manifest of every admin route under `src/app/api/admin/**`.
 *
 * Keep this list ALPHABETICAL by `route` for deterministic ordering and
 * to make code-review diffs of additions clear.
 *
 * CI check `scripts/check-admin-route-manifest.ts` is the enforcement
 * mechanism. Manual updates to this file are required when adding,
 * removing, or migrating an admin route.
 */
export const ADMIN_ROUTE_MANIFEST: readonly AdminRouteEntry[] = [
  {
    route: "src/app/api/admin/allocator-approve/route.ts",
    current: "isAdminUser-inline",
    target: "withRole",
    notes:
      "v0.22.24.2 review-fix inlined the handler to drop withAdminAuth round-trip",
  },
  {
    route: "src/app/api/admin/allocators/[id]/holdings/route.ts",
    current: "isAdminUser-inline",
    target: "withRole",
    notes: "",
  },
  {
    route: "src/app/api/admin/compute-jobs/route.ts",
    current: "isAdminUser-inline",
    target: "withRole",
    notes: "",
  },
  {
    route: "src/app/api/admin/deletion-requests/[id]/approve/route.ts",
    current: "withRole",
    target: "withRole",
    notes: "",
  },
  {
    route: "src/app/api/admin/deletion-requests/[id]/reject/route.ts",
    current: "withRole",
    target: "withRole",
    notes: "",
  },
  {
    route: "src/app/api/admin/for-quants-leads/process/route.ts",
    current: "withAdminAuth",
    target: "withRole",
    notes: "",
  },
  {
    route: "src/app/api/admin/intro-request/route.ts",
    current: "isAdminUser-inline",
    target: "withRole",
    notes:
      "v0.22.24.2 review-fix inlined the handler to drop withAdminAuth round-trip",
  },
  {
    // `[allocator_id]` sorts before `allocators` under default localeCompare
    // (brackets are punctuation, ignored at primary collation level so the
    // letters that follow compare first — `a` of `allocator_id` < `a` of
    // `allocators` via length tiebreak after stripping punctuation).
    // rbac-manifest.test.ts:25 enforces this exact ordering.
    route: "src/app/api/admin/match/[allocator_id]/route.ts",
    current: "isAdminUser-inline",
    target: "withRole",
    notes: "",
  },
  {
    route: "src/app/api/admin/match/allocators/route.ts",
    current: "isAdminUser-inline",
    target: "withRole",
    notes: "",
  },
  {
    route: "src/app/api/admin/match/decisions/route.ts",
    current: "isAdminUser-inline",
    target: "withRole",
    notes: "",
  },
  {
    route: "src/app/api/admin/match/eval/route.ts",
    current: "isAdminUser-inline",
    target: "withRole",
    notes: "",
  },
  {
    route: "src/app/api/admin/match/kill-switch/route.ts",
    current: "isAdminUser-inline",
    target: "withRole",
    notes: "",
  },
  {
    route: "src/app/api/admin/match/preferences/[allocator_id]/route.ts",
    current: "isAdminUser-inline",
    target: "withRole",
    notes: "",
  },
  {
    route: "src/app/api/admin/match/recompute/route.ts",
    current: "isAdminUser-inline",
    target: "withRole",
    notes: "",
  },
  {
    route: "src/app/api/admin/match/send-intro/route.ts",
    current: "isAdminUser-inline",
    target: "withRole",
    notes: "",
  },
  {
    route: "src/app/api/admin/notify-submission/route.ts",
    current: "authenticated-non-admin",
    target: "authenticated-non-admin",
    notes:
      "CARVE-OUT: route lives under /api/admin/ for historical reasons but is NOT admin-only — gated on auth.getUser() + .eq('user_id', user.id) ownership check on the strategy. See audit-2026-05-07 P203 and the file's top-of-file comment.",
  },
  {
    route: "src/app/api/admin/partner-import/route.ts",
    current: "isAdminUser-inline",
    target: "withRole",
    notes: "",
  },
  {
    route: "src/app/api/admin/strategy-review/route.ts",
    current: "isAdminUser-inline",
    target: "withRole",
    notes:
      "v0.22.24.2 review-fix inlined the handler to drop withAdminAuth round-trip",
  },
  {
    route: "src/app/api/admin/users/[id]/roles/route.ts",
    current: "withRole",
    target: "withRole",
    notes: "",
  },
];
