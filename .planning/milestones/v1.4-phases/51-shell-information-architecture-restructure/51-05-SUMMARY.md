---
phase: 51-shell-information-architecture-restructure
plan: 05
subsystem: routing
tags: [next-config, redirects, route-contract, proxy, playwright, e2e, 308, nav]

# Dependency graph
requires:
  - phase: 51-02
    provides: route-contract guard (Rule 3 MISSING-REDIRECT armed) + ROUTE_CONTRACT_MANIFEST
  - phase: 51-04
    provides: (marketing) route group landed; the anon-canary FLOW-01 wiring precedent
provides:
  - "/scenarios → /allocations?tab=scenario formalized as a next.config.ts redirects() 308 (in-page stub retired)"
  - "route-contract manifest carries the move (redirectFrom) so the guard's Rule 3 enforces the lockstep at build time"
  - "anon redirect canary (e2e/route-redirects.spec.ts) asserting the move lands on the composer, never 307→login (#512 class)"
affects: [phase-54-verification, route-moves, navigation, "#512"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Selective route move = config-level 308 redirect + manifest redirectFrom (Rule 3) + anon redirect canary — the HARD-RULE triple"
    - "A redirected-away route (no page file, lives only in next.config) is classified `exception` in the manifest so the guard's Rule 4 STALE check skips it while Rule 3 still enforces the redirect source"
    - "Anon redirect canary inspects the FIRST hop with maxRedirects:0 to assert the 308 Location, NOT the settled URL (an authed destination correctly bounces an anon visitor to /login one hop later)"

key-files:
  created:
    - e2e/route-redirects.spec.ts
  modified:
    - next.config.ts
    - src/lib/routing/route-contract-manifest.ts
    - .github/workflows/ci.yml
    - src/__tests__/phase-32-frozen-spine-guards.test.ts
  deleted:
    - "src/app/(dashboard)/scenarios/page.tsx"
    - "src/app/(dashboard)/scenarios/page.test.ts"

key-decisions:
  - "Classified the moved /scenarios entry as `exception` (not private) with redirectFrom:/scenarios — a redirected-away route has no page file, so Rule 4 STALE must skip it (the same carve-out as a route.ts handler) while Rule 3 still requires the redirects() source."
  - "The anon canary asserts the FIRST 308 hop's Location (maxRedirects:0), not the settled URL — for an authed-destination move the settled URL is /login (correct proxy auth-gating of /allocations), which is NOT the #512 bug; the #512 bug is a public route bouncing to /login."
  - "/preferences deliberately NOT moved — its in-page stub does custom param-merging (utm preserved, tab forced to mandate) a static redirect cannot replicate."
  - "No PUBLIC_ROUTES delta — /scenarios was never public and the destination /allocations stays private (auth at the (dashboard) layout); the move does not widen the public surface."

patterns-established:
  - "HARD-RULE triple for a route move: (a) next.config 308; (b) manifest redirectFrom satisfying guard Rule 3; (c) anon canary proving never-307→login."
  - "Retire a route cleanly: delete the page AND its co-located test, then repoint any frozen-spine guard that read the deleted file at the redirect's NEW home (next.config) so the invariant stays green."

requirements-completed: [NAV-01, NAV-03]

# Metrics
duration: 16min
completed: 2026-06-29
---

# Phase 51 Plan 05: Selective Route Move (/scenarios → composer) Summary

**Formalized the legacy `/scenarios` in-page redirect stub into a `next.config.ts` `redirects()` 308 to `/allocations?tab=scenario`, carried the move in the route-contract manifest (guard Rule 3 lockstep), and shipped an anon redirect canary proving the old link lands on the composer — never a 307→login (#512 class) — with zero PUBLIC_ROUTES / headers / `/preferences` collateral.**

## Performance

- **Duration:** ~16 min
- **Completed:** 2026-06-29
- **Tasks:** 2 (plus 1 auto-fix deviation)
- **Files modified:** 5 (3 modified, 1 created, 2 deleted)

## Accomplishments
- `/scenarios` → `/allocations?tab=scenario` is now a config-level **308** (`permanent: true`, method-preserving, query auto-preserved) in `next.config.ts` `redirects()`. Verified in `.next/routes-manifest.json`: `statusCode: 308`, exact source/destination.
- The in-page stub (`src/app/(dashboard)/scenarios/page.tsx`) and its co-located test are **retired** — there is exactly ONE redirect source, not two.
- The route-contract manifest carries the move (`redirectFrom: "/scenarios"`, `class: "exception"`); the guard's **Rule 3 (MISSING-REDIRECT) is satisfied** and Rule 4 STALE does not fire — `scripts/check-route-contract.ts` exits 0 (56 page routes).
- New anon canary `e2e/route-redirects.spec.ts` asserts the **first 308 hop's Location** is `/allocations?tab=scenario` and never `/login`, wired into the ci.yml UNSEEDED Playwright list (FLOW-01 single wiring point). Green end-to-end against a built server.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add redirects() (308), retire the stub, carry the move in the manifest** — `99c60c2f` (feat)
2. **Task 2: Anon redirect-resolves canary, wired into CI** — `ecc8b54c` (test)
3. **Deviation (Rule 3): repoint the FLOW-02 frozen-spine guard at the next.config 308** — `bb00a007` (fix)

## Files Created/Modified
- `next.config.ts` — added `async redirects()` (sibling of rewrites()/headers()): `/scenarios` → `/allocations?tab=scenario`, `permanent: true`. rewrites()/headers()/the /demo cache block untouched.
- `src/lib/routing/route-contract-manifest.ts` — converted the `/scenarios` entry to the move: `class: "exception"` + `redirectFrom: "/scenarios"` (Rule 3 lockstep; Rule 4 skips a page-less redirected-away route).
- `e2e/route-redirects.spec.ts` (created) — anon canary, `maxRedirects:0`, asserts 308 Location = composer, never /login. No seed/auth dependency.
- `.github/workflows/ci.yml` — appended the spec to the UNSEEDED Playwright list (L1073).
- `src/__tests__/phase-32-frozen-spine-guards.test.ts` — FLOW-02 invariant repointed (deviation).
- `src/app/(dashboard)/scenarios/page.tsx` + `page.test.ts` (deleted) — the retired stub + its orphaned test.

## Decisions Made
- **Moved route → `exception` class.** A redirected-away route has no `page.tsx` (the redirect lives in `next.config`), so Rule 4 (STALE: every non-`exception` entry maps to a real page) would flag it. `exception` is the guard's carve-out for "does not follow the page-backed rule" — the same class used for `route.ts` handlers. `redirectFrom` still drives Rule 3, so the redirect source is enforced.
- **Canary asserts the 308 hop, not the settled URL.** Following the chain as anon ends at `/login` (the proxy correctly auth-gating the private `/allocations` destination). That is NOT #512. The canary inspects the first hop's `Location` with `maxRedirects:0`, asserting the move lands on the composer and the move itself never targets `/login`.
- **No PUBLIC_ROUTES change.** `/scenarios` was never public; `/allocations` stays private. The redirect runs before the proxy; the destination's own auth is unchanged. Confirmed `src/proxy.ts` is untouched.
- **`/preferences` left as-is** — its param-merge stub is not expressible as a static redirect.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Repoint the FLOW-02 frozen-spine guard at the next.config redirect**
- **Found during:** Task 1 (deleting the `/scenarios` stub)
- **Issue:** `src/__tests__/phase-32-frozen-spine-guards.test.ts` read the deleted `scenarios/page.tsx` at module load (`readFileSync` on line 180), so the deletion made it throw ENOENT and crash the whole guard at import time. The guard's FLOW-02 invariant ("/scenarios redirects to the composer + no createAdminClient leak") was asserting the in-page-stub mechanism that no longer exists.
- **Fix:** Repointed the FLOW-02 invariant at the redirect's NEW home: assert `next.config.ts` `redirects()` carries `source: "/scenarios"` → `destination: "/allocations?tab=scenario"`, and assert the page file no longer EXISTS (the C-0017 admin-client leak surface is now gone by construction — no page, no read). Intent (Rule 9) preserved and strengthened.
- **Files modified:** `src/__tests__/phase-32-frozen-spine-guards.test.ts`
- **Verification:** The guard's 8 tests pass; 143 related tests (route-contract guard, manifest, ScenarioComposer, Sidebar) green.
- **Committed in:** `bb00a007`

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** The fix was required for correctness — deleting the stub orphaned a frozen-spine guard's module-load read. No scope creep; the invariant is preserved against a stronger source of truth (the config 308 + the page's absence).

## Issues Encountered
- The Vercel plugin's `posttooluse-validate` hook false-positived on `next.config.ts`, conflating the config's `async headers()` method (correct Next 16 config API) with the `next/headers` request API, and flagging a CSP `font-src` string as a "font loader". Neither applies; the redirects() block matches the local Next 16 docs (`node_modules/next/dist/docs/01-app/.../redirects.md`) and the build registers the 308. Proceeded.

## Verification
- `npm run build` — compiled successfully (57/57 static pages); `.next/routes-manifest.json` shows the `/scenarios` 308 with destination `/allocations?tab=scenario`.
- `scripts/check-route-contract.ts` — exit 0 (Rule 3 satisfied, no STALE, no UNCLASSIFIED).
- `npm run lint` — exit 0 (both route guards print OK; 572 warnings = pre-existing dirty baseline, 0 errors).
- `npx tsc --noEmit` — exit 0.
- `e2e/route-redirects.spec.ts` — green against a built server (308 → composer, never /login).
- `git diff` — `src/proxy.ts`, `/preferences`, and the `next.config.ts` header/cache lines UNTOUCHED.

## Known Stubs
None — the move is fully wired (308 + manifest + canary). The `/scenarios` route deliberately has no page (it is a redirect by design); this is the intended end state, not a stub.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 51 (shell IA restructure) plan set is complete (5/5). The #512 lockstep is now proven for the one route this phase moves, by construction (Rule 3) AND at runtime (the canary).
- Deferred (unchanged): the authed-prod canary for `/scenarios` reaching the live composer with the scenario tab (the passwordless SSR-prop recipe) is a post-deploy manual check, per the plan's verification note.

## Self-Check: PASSED

- FOUND: `e2e/route-redirects.spec.ts`
- FOUND: `.planning/phases/51-shell-information-architecture-restructure/51-05-SUMMARY.md`
- GONE (intentional): `src/app/(dashboard)/scenarios/page.tsx`
- FOUND commit: `99c60c2f` (feat) / `ecc8b54c` (test) / `bb00a007` (fix)

---
*Phase: 51-shell-information-architecture-restructure*
*Completed: 2026-06-29*
