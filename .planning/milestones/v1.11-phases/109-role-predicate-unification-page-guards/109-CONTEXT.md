# Phase 109: ROLE — predicate unification + page guards - Context

**Gathered:** 2026-07-16
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — grey areas auto-resolved from locked requirements + milestone memory; no open forks warranting a user gate.

<domain>
## Phase Boundary

One predicate drives the marketplace surface: `profiles.role` (`allocator` | `manager` | `both`) is the persona; `is_admin` is an ops overlay that grants ONLY the Admin section. Nav, server-side page access, and API gates all derive from `role`. Staff keep full allocator+manager access via `role='both'`, backfilled atomically with the `|| isAdmin` drop. This phase delivers ROLE-01..06 only — it does NOT add the allocator "Add a Strategy" contribution entry (that is Phase 110/CONTRIB) and does NOT touch the composer/constituent surface (Phase 111+).

</domain>

<decisions>
## Implementation Decisions

### Nav predicate unification
- Drop `|| isAdmin` from all three `shows*` derivations in `Sidebar.tsx:49-51` (`showsAllocatorWorkspace`, `showsManagerWorkspace`, `showsDiscovery`) so they become pure `isAllocator` / `isManager` (role-derived). Apply the identical drop anywhere `MobileNav`/other nav surfaces duplicate the OR-in (planner to enumerate — the two navs must not drift; `formatBadgeCount` is already shared for this reason).
- `is_admin` gates ONLY the Admin section. An `is_admin`+`manager` account sees the manager workspace + Admin, NOT the allocator workspace (ROLE-03).
- At 109 close: an allocator-role account shows ZERO sell-side surfaces (Strategies, Portfolios). The scoped "Add a Strategy" entry is a Phase-110 future exception, not built here (ROLE-02).

### Server-side page guards (three-branch failure model)
- Add ONE shared server helper (`requireRolePage` / analogous), mirroring `withAllocatorAuth.ts`'s three-branch discipline, called in each role-owned route group's server layout/page:
  - **DB-error branch** → do NOT redirect (a transient PostgREST 5xx / statement_timeout must not masquerade as "wrong role"); surface as an error/503-equivalent and report to Sentry, matching `withAllocatorAuth`.
  - **Missing-profile branch** → handled explicitly (Sentry soft signal), not a silent redirect loop.
  - **Wrong-role branch** → server-side `redirect()` to the caller's role home surface (never a 403 page, never a half-rendered page) (ROLE-04).
- Redirect target = the role's home surface (planner to confirm exact routes: manager home vs allocator home from existing routing). The full `role × is_admin` matrix MUST be enumerated and proven redirect-loop-free (a `both` user owns both surfaces → never redirected off either).

### Atomic staff backfill [GATE — hard]
- SQL migration in the SAME PR/deploy as the `|| isAdmin` drop: `UPDATE profiles SET role='both' WHERE is_admin = true AND role <> 'both';` (idempotent; timestamped per convention).
- Pre-merge SQL assertion (in `supabase/tests/test_*.sql`) proving `is_admin = true AND role NOT IN ('both')` returns the empty set — no staff member loses access when the OR-in drops.
- The migration MUST be MCP-applied to the test project (qmnijlgmdhviwzwfyzlc) BEFORE merge so the RED-guarded SQL assertion passes in CI (test-project catch-up rule).

### Honest denied-action copy
- Any role-denied action names the role requirement in its copy and never offers a retry that cannot succeed (ROLE-06). Reuse the existing `withAllocatorAuth` "Forbidden — allocator role required" style (specific-cause copy, not a generic 403).

### Claude's Discretion
- Exact helper name/signature and file location; exact home-route redirect targets (derived from existing routing); whether a signup/creation-time default is added for new `is_admin` accounts (backfill covers existing; a forward-guard is optional polish, not required by success criteria).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/api/withAllocatorAuth.ts` — canonical three-branch role gate (503 DB-error / 403 missing-profile / 403 wrong-role). The page-guard helper mirrors this exactly (redirect substitutes for the wrong-role 403; DB-error still must NOT redirect).
- `src/components/layout/Sidebar.tsx:49-51` — the three `|| isAdmin` OR-ins. `buildNavSections(populatedSlugs, isAdmin, isAllocator, flaggedCount, isManager)` already derives `isManager` independently (fix for the old `!isAllocator` short-circuit).
- `src/app/(dashboard)/layout.tsx:45-46` — `isAllocator/isManager` already computed as `role === 'x' || role === 'both'`; the SSR source of truth for nav flags.
- Admin dashboard queries already use `role IN ('allocator','both')` / `('manager','both')` (`admin/page.tsx`, `admin/match/allocators/route.ts`) — the `both`-inclusive pattern is established.

### Established Patterns
- Role = `role IN ('x','both')`; `is_admin` is a separate boolean overlay. `both` == manager AND allocator.
- Three-branch auth: never collapse infra failure into a policy 403.
- Nav derivation is centralized in `buildNavSections`; MobileNav shares helpers to avoid drift.

### Integration Points
- Nav flags flow from `(dashboard)/layout.tsx` → `Sidebar`/`MobileNav`.
- Page guards attach at route-group server layout/page level.
- Backfill migration under `supabase/migrations/**` (auto-applies to prod on merge — verify objects post-deploy).

</code_context>

<specifics>
## Specific Ideas

- The `role='both'` backfill and the `|| isAdmin` drop are ONE atomic unit — never split across PRs (the GATE). Landing the drop without the backfill would lock every staff account out of the allocator workspace.
- Rejected (from REQUIREMENTS non-goals): an admin/QA "preview as the other role" nav toggle — staff use `role='both'` accounts instead; a nav backdoor would institutionalize the half-broken empty-payload surface.

</specifics>

<deferred>
## Deferred Ideas

- Allocator-scoped "Add a Strategy" nav entry → Phase 110 (CONTRIB-01).
- Any composer/constituent role interplay → Phase 111+.
- Optional creation-time `role='both'` default for newly-flagged `is_admin` accounts (forward-guard beyond the one-time backfill) — not required by 109 success criteria; note for a future hardening pass if staff onboarding creates admins without setting role.

</deferred>
