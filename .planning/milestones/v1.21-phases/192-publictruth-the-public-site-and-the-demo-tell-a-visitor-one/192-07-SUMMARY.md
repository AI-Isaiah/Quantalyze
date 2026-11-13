---
phase: 192-publictruth-the-public-site-and-the-demo-tell-a-visitor-one
plan: 07
subsystem: routing
tags: [demo, route-contract, ci, e2e, next]

requires:
  - phase: 192-publictruth
    provides: "192-01 evidence reading: D-09 outcome remove (the founder view cannot be filled from the demo data)"
provides:
  - "/demo/founder-view no longer exists (page, manifest entry, eslint scope entry); a production build answers 404"
  - "the public /api/demo/match/[allocator_id] route and its test are deleted, with its entries in vitest.node-env.ts and limiter-ordering.test.ts"
  - "no CI command runs the founder-view e2e spec and the spec file is gone"
affects: [192-05, 192-08, 192-09, 192-10]

plan_head_before: 86a118d9c76e9a4e497f2ba4ee2f3decfb2496d6
plan_head_after: e59574e1bf1f49f271c578ba84885e7f3abafda3
commits: 3
actuals:
  tokens: 11400
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified:
    - src/lib/routing/route-contract-manifest.ts
    - eslint.config.mjs
    - src/lib/demo.ts
    - next.config.ts
    - vitest.node-env.ts
    - src/lib/api/limiter-ordering.test.ts
    - src/lib/admin/match.ts
    - .github/workflows/ci.yml
  deleted:
    - src/app/(marketing)/demo/founder-view/page.tsx
    - src/app/api/demo/match/[allocator_id]/route.ts
    - src/app/api/demo/match/[allocator_id]/route.test.ts
    - e2e/demo-founder-view.spec.ts

key-decisions:
  - "UI-SPEC vs RESEARCH on the forceReadOnly demo path in AllocatorMatchQueue (CLAUDE.md Rule 7): followed RESEARCH. The shared admin component and its test stay; the props become dead code with no production caller, booked by plan 192-10."

requirements-completed: [ROUTE-03]

coverage:
  - id: D1
    description: "GET /demo/founder-view returns 404 on a production build; page and manifest entry removed together; route-contract check passes"
    requirement: ROUTE-03
    verification:
      - kind: command
        ref: "npx tsx scripts/check-route-contract.ts (OK, 57 page routes)"
        status: pass
      - kind: e2e
        ref: "local next build + next start -p 3194, curl /demo/founder-view prints 404"
        status: pass
    human_judgment: false
  - id: D2
    description: "Public /api/demo/match route and test deleted with every registry entry; limiter stale-entry case green"
    verification:
      - kind: unit
        ref: "src/lib/api/limiter-ordering.test.ts (6 passed)"
        status: pass
      - kind: command
        ref: "npx tsc --noEmit (rc 0)"
        status: pass
    human_judgment: false
  - id: D3
    description: "CI no longer runs the founder-view spec; spec file deleted; CI structure pins still pass"
    verification:
      - kind: unit
        ref: "src/__tests__/critical-regressions.test.ts (184 passed)"
        status: pass
      - kind: command
        ref: "actionlint -shellcheck= -pyflakes= .github/workflows/ci.yml (rc 0)"
        status: pass
    human_judgment: false

duration: 8min
completed: 2026-11-07
status: complete
---

# Phase 192 Plan 07: Remove the founder view and its public match API Summary

**/demo/founder-view and the public /api/demo/match service-role route are deleted along with every manifest, lint-scope, node-env, limiter and CI entry that named them; a real production build answers 404 for the founder view.**

## Performance

- **Duration:** about 8 min (start 2026-11-07, three task commits)
- **Tasks:** 3 of 3 (task 1 was the tracer)
- **Files:** 12 changed (4 deleted, 8 edited); 15 insertions, 970 deletions

## Accomplishments

- Task 1 (tracer): `git rm` of the founder-view page; the manifest entry and the eslint per-file scope line removed in the same commit; founder-view mentions removed from the `src/lib/demo.ts` docblock and from `next.config.ts` comments only (the `/demo/:path*` header rule is byte-identical). Commit `4d23c8d1d`.
- Task 2: the public `/api/demo/match/[allocator_id]` route and its test deleted; their lines removed from `NODE_ENV_TEST_FILES` and from the limiter `NO_INPUT` set; `src/lib/admin/match.ts` and `src/lib/demo.ts` comments updated (no code line changed). Commit `6f686ba56`. This removes the public service-role fan-out and the persona email in cached JSON (threat T-192-15, T-192-16); plan 192-10 closes the TODOS entry.
- Task 3: `e2e/demo-founder-view.spec.ts` deleted; its token removed from the unconditional Playwright command in `ci.yml` and its name removed from the two comments that list the spec set. Commit `e59574e1b`.

## Tracer end-to-end evidence (Task 1)

Built with the CI placeholder env set in-process (the same variables the `ci.yml` build step sets, including `SHARE_TOKEN_SECRET`, which the plan's command omitted and without which the build fails at page-data collection). Port 3194 was free before and after (`lsof -ti:3194` printed nothing).

- The build route table lists `/demo` and `/api/demo/portfolio-pdf/[id]` and has no `/demo/founder-view`.
- `curl -s -o /dev/null -w '%{http_code}' http://localhost:3194/demo/founder-view` printed **404**.
- Control reading on the same server: `/demo` printed 200 (it stays public). `/api/demo/match/<seed id>` printed 500 at that moment because the route still existed in Task 1's tree and the placeholder Supabase has no data; it was deleted in Task 2 and was not re-built or re-curled afterwards (the build was not repeated).

## Verification (real numbers, run from the worktree root)

| Gate | Result |
|------|--------|
| `npx tsx scripts/check-route-contract.ts` | OK, 57 page routes, all declared |
| `npx vitest run src/lib/api/limiter-ordering.test.ts` | 6 passed before and after the deletion |
| `npx vitest run src/__tests__/critical-regressions.test.ts` | 184 passed |
| `npx vitest run` on check-route-contract, limiter-ordering, critical-regressions, AllocatorMatchQueue, playwright-console-filter, proxy test files | 6 files, 345 passed |
| `npx vitest run src/__tests__` | 167 files passed, 1 failed (see Issues), 18 skipped; 4666 tests passed, 1 failed, 273 skipped |
| `npx tsc --noEmit` | exit 0 (after deleting the local `.next` build output, whose generated types still named the deleted route) |
| `actionlint -shellcheck= -pyflakes= .github/workflows/ci.yml` | exit 0 |
| `npm run lint` | exit 1: eslint 0 errors, 2 pre-existing warnings; admin-route and route-contract checks OK; `check-planning-hygiene` reports 1 violation in plan 192-01's SUMMARY (see Issues) |
| Playwright e2e | not run (no seeded environment, no Playwright lane in this worktree); not claimed |

## Residue at this plan's end state, for plan 192-10 to book

`grep -rln "api/demo/match\|demo/match/\[allocator_id\]" src e2e .github eslint.config.mjs vitest.node-env.ts next.config.ts` lists exactly these 8 files (per-file counts), all inside the enumerated residue set (`src/app/api/admin/partner-import/route.ts` from the plan's set had no remaining hit):

| Count | File | Note |
|-------|------|------|
| 13 | src/components/admin/AllocatorMatchQueue.test.tsx | shared admin component test (forceReadOnly demo path) |
| 2 | src/components/admin/AllocatorMatchQueue.tsx | forceReadOnly props now dead code, no production caller |
| 12 | src/lib/playwright-console-filter.test.ts | generic helper's examples |
| 3 | src/lib/playwright-console-filter.ts | generic helper's examples |
| 1 | src/proxy.test.ts | proxy prefix example |
| 1 | src/app/api/strategies/browse/route.ts | comment |
| 1 | src/app/api/admin/match/[allocator_id]/route.ts | comment |
| 3 | e2e/demo-public.spec.ts | re-homed by plan 192-08 (drops the ignore entry for the deleted route) |

Other mentions of the literal `founder-view` outside `.planning/` and `docs/` history, found by a wider grep. None is a link or registry entry owned by this plan:

- `src/app/(marketing)/demo/page.tsx` (footer link, plan 192-05) and `src/app/(marketing)/demo/layout.tsx` (docblock, plan 192-05 owns the file).
- `e2e/marketing-shell.spec.ts:46`, a row that visits `/demo/founder-view` (removed by plan 192-09; it will 404 until then).
- `src/components/admin/AllocatorMatchQueue.tsx:147` (comment) and `analytics-service/routers/match.py:221` (comment naming the deleted endpoint; outside this plan's file list and outside the plan's grep scope).
- `TODOS.md` and `CHANGELOG.md` (plan 192-10), `docs/` ADR 0009 and old plans (kept as history on purpose).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Local production build could not run as the plan wrote it**
- **Found during:** Task 1 end-to-end proof
- **Issue:** (a) Turbopack refuses a `node_modules` symlink that resolves outside the worktree root ("Could not find the Next.js package"). (b) The plan's env list omits `SHARE_TOKEN_SECRET`, which the build needs at page-data collection. (c) `next build --webpack` was tried first and fails type-checking generated route types on unrelated routes, so it was not used.
- **Fix:** For the build only, set `turbopack.root` in `next.config.ts` to the parent directory of the worktree (so the symlinked `node_modules` is inside the root), exported the same env the `ci.yml` build step sets, then restored `next.config.ts` from a byte backup before committing. The committed `next.config.ts` carries only this plan's comment edit; no `turbopack` key was committed (`grep -c turbopack next.config.ts` prints 0).
- **Files modified:** none committed for this fix
- **Commit:** none

**Total deviations:** 1 auto-fixed (Rule 3, environment only). **Impact:** none on the shipped diff.

## Authentication Gates

None.

## Issues Encountered

- `npm run lint` and one `src/__tests__` test (the planning-hygiene zero-violations case) fail on `ABSOLUTE-HOME-PATH` at line 110 of `192-01-SUMMARY.md`, a file written by plan 192-01 in wave 1 (commit `b950092b0`) and untouched by this plan. It is out of scope under the scope boundary and was not edited here. The orchestrator or a plan owning 192-01 should rewrite that line; until then `npm run lint` is red for the phase branch independent of this plan. The plan's acceptance criterion "`npm run lint` exits 0" is therefore NOT met by the repo state, though every other lint stage (eslint errors, admin-route manifest, route-contract) is clean.
- The plan's acceptance baseline says 16 files named the match route at HEAD; the end-state grep lists 8, all in the enumerated set.

## Known Stubs

None. This plan only deletes code and comments.

## Threat Flags

None. No new network endpoint, auth path or schema change; T-192-15 and T-192-16 are mitigated by the route deletion.

## Self-Check: PASSED

- Deleted files confirmed absent: founder-view page, `/api/demo/match` route and test, founder-view e2e spec.
- Commits `4d23c8d1d`, `6f686ba56`, `e59574e1b` are ancestors of HEAD; `git rev-list --count` over the ledger base gives 3.
- STATE.md and ROADMAP.md untouched.
