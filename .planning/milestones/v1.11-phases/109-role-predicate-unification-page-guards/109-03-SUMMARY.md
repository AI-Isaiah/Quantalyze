---
phase: 109-role-predicate-unification-page-guards
plan: 03
subsystem: auth
tags: [nextjs, app-router, segment-layout, rls, role-guard, redirect]

# Dependency graph
requires:
  - phase: 109-01
    provides: requireRolePage server guard (profiles.role, three-branch discipline, internal loop-free homeHref)
  - phase: 109-02
    provides: atomic staff role='both' backfill + pure-role nav (Sidebar/MobileNav)
provides:
  - Server-side role enforcement at all 7 owned-route entry points
  - Allocator surface guarded: allocations/recommendations/compare/decks page.tsx + discovery/layout.tsx subtree
  - Manager surface guarded by NEW segment layouts (strategies/layout.tsx + portfolios/layout.tsx) covering ALL nested routes
  - Loop-free proxy-hop proof (manager 1 hop, allocator/both 0, unknown → /pending-approval terminal)
  - Exhaustive (dashboard) page.tsx → guard-site coverage table (zero unclassified owned pages)
affects: [110-contrib, scenario-composer-v2, role-predicate]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Segment layout.tsx as the single guard site for a nested subtree (layout wraps all descendant page.tsx)"
    - "Role guard call at top level, one line below the !user guard, OUTSIDE any try/catch (redirect throws NEXT_REDIRECT)"

key-files:
  created:
    - src/app/(dashboard)/strategies/layout.tsx
    - src/app/(dashboard)/portfolios/layout.tsx
  modified:
    - src/app/(dashboard)/allocations/page.tsx
    - src/app/(dashboard)/recommendations/page.tsx
    - src/app/(dashboard)/compare/page.tsx
    - src/app/(dashboard)/decks/page.tsx
    - src/app/(dashboard)/discovery/layout.tsx

key-decisions:
  - "Manager subtrees guarded by ONE segment layout each (not per-index-page), because a sibling page.tsx guard does not wrap nested routes"
  - "Allocator flat pages (no nested routes) guarded per-page; discovery already had a subtree layout"
  - "proxy.ts left byte-unchanged — a role-aware DEFAULT_AUTHENTICATED_ROUTE would re-couple the proxy to a profiles read it deliberately avoids; single-hop redirect through the discovery guard is loop-free and accepted"
  - "strategies/new/wizard guarded manager-only NOW; Phase 110 (CONTRIB) carves the allocator exception there, not here"

patterns-established:
  - "Nested-route authorization: attach the guard at the owning segment layout, never rely on the index page.tsx"
  - "Never wrap requireRolePage in try/catch — NEXT_REDIRECT must propagate"

requirements-completed: [ROLE-04]

# Metrics
duration: 20min
completed: 2026-07-16
---

# Phase 109 Plan 03: Attach Role Guard to Every Owned Route Summary

**Server-side role enforcement wired into all 7 owned-route entry points — 4 allocator flat pages + discovery/layout, plus 2 NEW manager segment layouts (strategies + portfolios) that close the nested-route ROLE-04 bypass.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-07-16
- **Tasks:** 3
- **Files modified:** 5 modified + 2 created = 7

## Accomplishments
- Allocator surface fully guarded: `allocations`, `recommendations`, `compare`, `decks` page.tsx each call `requireRolePage(supabase, user, "allocator")` one line below the `!user` guard; `discovery/layout.tsx` guards the whole `/discovery/*` subtree.
- Manager surface fully guarded via NEW segment layouts `strategies/layout.tsx` + `portfolios/layout.tsx`, each mirroring the `discovery/layout.tsx` shell (`force-dynamic` + `createClient` + `getUser` + `!user` redirect + `requireRolePage(..., "manager")` outside any try/catch). Because a layout is the outermost component in its segment, it wraps EVERY descendant `page.tsx` — closing the nested-route bypass (`strategies/new`, `new/wizard`, `[id]/edit`; `portfolios/[id]`, `[id]/manage`, `[id]/documents`).
- Exhaustive coverage audit: every owned `page.tsx` under `(dashboard)` mapped to a guard site; zero unclassified owned pages.
- Proxy-hop enumeration proves single-hop, loop-free termination for every role; `proxy.ts` left byte-unchanged.

## App Router docs citation (layout wraps descendants)

Next 16.2.10, `node_modules/next/dist/docs`:
- `01-app/03-api-reference/03-file-conventions/layout.md:24` — "In the component hierarchy, `layout.js` is the outermost component in a route segment. It wraps `template.js`, `error.js`, `loading.js`, `not-found.js`, and `page.js`."
- `01-app/01-getting-started/03-layouts-and-pages.md:58` — "`children` will be populated with the route segments the layout is wrapping. These will primarily be the component of a child Layout (if it exists) or Page."
- `01-app/03-api-reference/04-functions/redirect.md` — "`redirect` throws an error so it should be called **outside** the `try` block when using `try/catch` statements."

Together these confirm: (1) a segment `layout.tsx` executes before and can block ALL descendant `page.tsx`, so it is the correct single guard site for a nested manager subtree; (2) the guard must sit outside any try/catch or the NEXT_REDIRECT throw is swallowed (fail-open).

## Coverage table — every (dashboard) page.tsx → guard site

| Route (page.tsx) | Classification | Guard site |
|------------------|----------------|------------|
| allocations/page.tsx | allocator-owned | own page guard (allocator) |
| recommendations/page.tsx | allocator-owned | own page guard (allocator) |
| compare/page.tsx | allocator-owned | own page guard (allocator) |
| decks/page.tsx | allocator-owned | own page guard (allocator) |
| discovery/[slug]/page.tsx | allocator-owned | discovery/layout.tsx (allocator) |
| discovery/[slug]/[strategyId]/page.tsx | allocator-owned | discovery/layout.tsx (allocator) |
| strategies/page.tsx | manager-owned | strategies/layout.tsx (manager) |
| strategies/new/page.tsx | manager-owned | strategies/layout.tsx (manager) |
| strategies/new/wizard/page.tsx | manager-owned | strategies/layout.tsx (manager) — Phase-110 seam |
| strategies/[id]/edit/page.tsx | manager-owned | strategies/layout.tsx (manager) |
| portfolios/page.tsx | manager-owned | portfolios/layout.tsx (manager) |
| portfolios/[id]/page.tsx | manager-owned | portfolios/layout.tsx (manager) |
| portfolios/[id]/manage/page.tsx | manager-owned | portfolios/layout.tsx (manager) |
| portfolios/[id]/documents/page.tsx | manager-owned | portfolios/layout.tsx (manager) |
| preferences/page.tsx | role-neutral/shared | none (shared) |
| profile/page.tsx | role-neutral/shared | none (shared) |
| referral/page.tsx | role-neutral/shared | none (shared) |
| admin/** (14 pages) | role-neutral (is_admin-gated separately) | admin manifest / is_admin — NOT a role surface (ROLE-03) |

**Guard sites = exactly 7:** 4 allocator flat pages + discovery/layout.tsx + strategies/layout.tsx + portfolios/layout.tsx. Confirmed via `grep -rl "requireRolePage(supabase, user," "src/app/(dashboard)"` → 7 files. Zero owned pages unclassified. Admin pages carry `is_admin` gating (ROLE-03: the admin flag grants no marketplace surface; staff retain access via `role='both'`), so they are role-neutral to this guard by design.

## Proxy-hop enumeration (loop-free)

`DEFAULT_AUTHENTICATED_ROUTE = "/discovery/crypto-sma"` (proxy.ts:25) — the post-login/auth-bounce target for ALL roles; the proxy deliberately does NOT enforce role (cookie-only `getSession`, ~L146-160).

| Role | Hop path | Hops | Terminal? |
|------|----------|------|-----------|
| manager | proxy → /discovery/crypto-sma → discovery/layout(need=allocator, !owns) → redirect /strategies → strategies/layout(need=manager, owns) → renders | 1 | yes, loop-free |
| allocator | proxy → /discovery/crypto-sma → discovery/layout(need=allocator, owns) → renders | 0 | yes |
| both | proxy → /discovery/crypto-sma → discovery/layout(owns, both) → renders | 0 | yes |
| unknown/malformed | proxy → /discovery/crypto-sma → discovery/layout(!owns, homeHref=/pending-approval) → /pending-approval | 1 | yes, terminal unguarded route (structurally cannot loop between surface homes) |

`homeHref` is derived INTERNALLY from the visitor's actual role inside requireRolePage (109-01), so no redirect can point at an unowned route. `proxy.ts` byte-unchanged (`git diff` empty).

## Task Commits

1. **Task 1: Guard the allocator surface — 4 flat pages + discovery layout** — `46a37541` (feat)
2. **Task 2: Guard the manager surface with segment layouts** — `a71b5017` (feat)
3. **Task 3: Full owned-route coverage audit + loop-free proxy-hop proof** — audit-only (no code change; proof recorded above; grep 7-site gate + proxy byte-check + targeted vitest green)

## Files Created/Modified
- `src/app/(dashboard)/strategies/layout.tsx` (NEW) — manager segment guard for the whole strategies subtree
- `src/app/(dashboard)/portfolios/layout.tsx` (NEW) — manager segment guard for the whole portfolios subtree
- `src/app/(dashboard)/allocations/page.tsx` — allocator guard below !user
- `src/app/(dashboard)/recommendations/page.tsx` — allocator guard below !user, before attestation try/catch
- `src/app/(dashboard)/compare/page.tsx` — allocator guard below !user
- `src/app/(dashboard)/decks/page.tsx` — allocator guard below !user
- `src/app/(dashboard)/discovery/layout.tsx` — allocator guard before attestation try/catch (subtree)

## Decisions Made
- Manager subtrees guarded by ONE segment layout each, not per-index-page — the only site that covers nested routes.
- `proxy.ts` left byte-unchanged; a role-aware default would re-couple the proxy to a profiles read it avoids by design. Single-hop through the discovery guard is loop-free and accepted (RESEARCH Open Q1).
- `strategies/new/wizard` guarded manager-only; the Phase-110 CONTRIB allocator exception is carved there, not weakened here.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Lint emits 1 pre-existing warning in `allocations/widgets/performance/EquityChart.tsx` (`react-hooks/exhaustive-deps`, line 1119) — unrelated to this plan's changes, out of scope (logged, not fixed). 0 lint errors. Route-contract + admin-manifest checks pass (56 page routes, 20 admin routes); the 2 new files are layouts, not page routes, so no manifest change is required.

## Phase-110 seam (forward flag)
Phase 110 (CONTRIB) will intentionally admit allocators to the contribution wizard at `/strategies/new/wizard`. That exception MUST be carved in Phase 110 — relax `strategies/layout.tsx` or intercept at `new/wizard` — and is flagged in the `strategies/layout.tsx` docstring. Do NOT weaken the manager layout for the wizard as part of the 109 close.

## Next Phase Readiness
- ROLE-04 complete: every owned route (flat + nested) is server-guarded; the nested-route bypass is closed.
- Manual post-deploy confirm per 109-VALIDATION.md (log in as manager/allocator/both/is_admin+manager; direct-URL a cross-role route incl. a nested one like `/portfolios/<id>/manage` as an allocator; confirm single-hop redirect, no loop, no 403/half-render).

## Self-Check: PASSED

- All 7 guard-site files exist on disk.
- Both task commits (`46a37541`, `a71b5017`) exist in git history.
- 7-site grep gate returns exactly 7 files; `proxy.ts` byte-unchanged; targeted vitest 73/73 green; tsc + lint (0 errors) green.

---
*Phase: 109-role-predicate-unification-page-guards*
*Completed: 2026-07-16*
