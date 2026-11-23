---
phase: 208-uiquick-alert-digest-link-browse-error-state-and-share-link
plan: 05
subsystem: api
tags: [share-link, csrf, preview-host, d-16, vitest]
requires: []
provides:
  - "resolveAppUrl(req) in the D-16 order (request origin, NEXT_PUBLIC_APP_URL, localhost literal) in both share routes"
  - "route.csrf-integration.test.ts: the real withAllocatorAuth -> withAuth -> assertSameOrigin chain pinned for the scenario share POST"
affects: [208-03]
actuals:
  tokens: 9000
  tasks: 2
  commits: 2
plan_head_before: d41256fef718205226f6ba25886ef83fb7fb299a
plan_head_after: ae1cabda3b5c137f4e92b4bb256728e6ec89c53e
commits: 2
key-files:
  created:
    - src/app/api/allocator/scenario/share/route.csrf-integration.test.ts
  modified:
    - src/app/api/strategies/[id]/share/route.ts
    - src/app/api/strategies/[id]/share/route.test.ts
    - src/app/api/allocator/scenario/share/route.ts
    - src/app/api/allocator/scenario/share/route.test.ts
key-decisions:
  - "D-16: both routes build the share url on the origin of Origin ?? Referer first (the expression the same-origin gate validated), then NEXT_PUBLIC_APP_URL, then the localhost literal"
  - "The scenario route adds no second assertSameOrigin call and no allow-list export; src/lib/csrf.ts is untouched, so no caller meets a new 403"
  - "The two functions stay twins (no shared helper): two call sites, and the file pair is already written as twins"
requirements-completed: [SC-4]
status: complete
---

# Phase 208 Plan 05: share link host (D-16) Summary

A share link now comes back on the host the owner minted it on. Both `POST /api/strategies/[id]/share` and `POST /api/allocator/scenario/share` build the url from the CSRF-validated request origin ahead of `NEXT_PUBLIC_APP_URL`, with the `http://localhost:3000` literal as the last rung, so a preview deploy no longer hands out production-host links (TODOS `SHARE-HOST-01`, deleted later in the release commit, not here).

## Commits

- `5a13852b9` fix(208-05): a strategy share link comes back on the host it was minted on (D-16)
- `ae1cabda3` fix(208-05): a scenario share link comes back on the host it was minted on (D-16)

## Decision on D-16's open point (scenario-route validation), evidence by symbol

- D-16 records that the scenario route "does not call `assertSameOrigin`". That is true of the route file and incomplete for the request path.
- `export const POST = withAllocatorAuth(...)` in `src/app/api/allocator/scenario/share/route.ts`; `withAllocatorAuth` (`src/lib/api/withAllocatorAuth.ts`) returns `withAuth(async (req, user) => ...)`; `withAuth` (`src/lib/api/withAuth.ts`) calls `assertSameOrigin(req)` for every method other than GET, HEAD and OPTIONS and returns its 403 before `createClient`, before `getUser` and before the handler.
- So every request that reaches the scenario handler already presented an `Origin ?? Referer` that parsed and whose host is in `ALLOWED_HOSTS`. `src/proxy.ts` and `withAllocatorAuth.ts` carry no further origin check.
- Chosen: neither a second `assertSameOrigin` call nor a new allow-list export. `resolveAppUrl(req)` reads the same `Origin ?? Referer` expression the wrapper validated. No new 403 path exists, because every caller already passes the wrapper's gate today.
- Gap found and closed: no test pinned that gate on a POST (`withAuth.test.ts`, `withAuth.approval-gate.test.ts` and `withAuthLimited.test.ts` mock `@/lib/csrf`; `withAllocatorAuth.test.ts` mocks `./withAuth` and sends GET; the scenario `route.test.ts` mocks `withAllocatorAuth` away). `route.csrf-integration.test.ts` now runs the real chain.

**For the records PR:** D-16's ROADMAP success criterion is still to be added there (this plan added none). D-16's premise "does not call `assertSameOrigin`" is true of the route file and incomplete for the request path.

## RED-first and GREEN lines

- Task 1 RED (test edited, route unchanged): `Tests 2 failed | 24 passed (26)`: the D-16 arm ("D-16: a link minted on a non-production host comes back on that host, ahead of NEXT_PUBLIC_APP_URL") and the Referer arm ("D-16: with no Origin the Referer's origin is used, and its path is stripped"). The env-rung and last-rung arms passed at HEAD, as the plan expected.
- Task 1 GREEN: `Tests 26 passed (26)`.
- Task 2 RED (tests edited, route unchanged): `Tests 2 failed | 37 passed (39)` over the share directory: `T_SH5` (url came back on `share.example.com`) and integration (iii). `T_SH5b`, `T_SH5c`, (i) and (ii) passed at HEAD, as expected.
- Task 2 GREEN: `route.test.ts` 24 plus integration 3: `Tests 27 passed (27)`.

## Neuter evidence

- neuter-208-05: (a) strategies env-first -> RED `2 failed | 24 passed (26)`: the D-16 arm and the Referer arm; restored; cmp 0; GREEN `26 passed (26)`.
- neuter-208-05: (a2) scenario env-first -> RED `2 failed | 25 passed (27)`: `T_SH5` and integration (iii); restored; cmp 0; GREEN `27 passed (27)`.
- neuter-208-05: (b) withAuth gate removed (the `if (csrfError) return csrfError;` line deleted) -> RED `2 failed | 1 passed (3)`: integration (i) forged origin and (ii) header-less; restored; cmp 0; GREEN `27 passed (27)`. `git status --short src/lib/api/withAuth.ts` prints nothing.

Byte backups in the session scratchpad, all `cp -p`, all restored and compared with `cmp` exit 0. No `git checkout`, `restore` or `stash` was used.

## Gate lines

- Anchors: `node scripts/verify-plan-anchors.mjs <this plan>`: `OK: 1 plan file(s), no stale claims.` (14 claims).
- Wrapper gate: `npx vitest run src/lib/csrf.test.ts src/lib/api "src/app/api/strategies/[id]/share" src/app/api/allocator/scenario/share`: `Test Files 16 passed (16)`, `Tests 185 passed (185)`.
- `npm run typecheck`: exit 0.
- `npm run lint`: 0 errors, 4 warnings, all in files this plan does not touch (`src/lib/factsheet/composite-read-path.ts`, `src/lib/queries.stale-analytics-detail.test.ts`); the repo's check-scripts all OK.
- `npm test` under Node v22.22.1: `Test Files 1 failed | 1238 passed | 20 skipped (1259)`, `Tests 1 failed | 26120 passed | 306 skipped (26427)`. The one failure is `src/lib/return-stats.single-source.test.ts > merge-base tree (runs in CI, IN-01) > the committed matcher reports 26 hits on the base tree`, `Test timed out in 5000ms`, while the machine ran at about 650% CPU for 8m47s. That file alone, rerun right after: `Test Files 1 passed (1)`, `Tests 34 passed (34)`. It is a load-induced timeout in a file this plan does not touch, not a regression from this plan; recorded here, not hidden.
- Ordering gate (awk, origin read precedes the last env read): exit 0 on both routes (exit 1 at HEAD).
- Invariants: `grep -ac "D-16"` is 2 on each route; `grep -acE 'headers\.get\("(host|x-forwarded-host)"\)|nextUrl\.origin'` is 0 on both; `grep -ac "assertSameOrigin("` on the scenario route is 0; the integration file has 0 non-comment `vi.mock` calls for `@/lib/csrf`, `withAuth` or `withAllocatorAuth` and contains `__resetAllowedHostsForTest`; `git status --short src/lib/csrf.ts src/lib/api/withAuth.ts src/lib/api/withAllocatorAuth.ts next.config.ts` prints nothing.
- Scope check, `git log --format= --name-only --grep='(208-05)' | sort -u` (before the docs commit): exactly the five `files_modified`.

## Deviations from Plan

None - plan executed exactly as written. (Counts matched: 26, 24 and 3.)

## Auth gates

None.

## Known Stubs

None.

## Threat Flags

None. T-208-14 (spoofing of the link host) is mitigated as planned: the resolver reads only `Origin ?? Referer`, the Host-style grep invariant is 0, and the real-chain file proves a forged or header-less POST is 403 before any database call, with calibration (b) proving the file bites.

## Self-Check: PASSED

- FOUND: src/app/api/allocator/scenario/share/route.csrf-integration.test.ts
- FOUND commit 5a13852b9
- FOUND commit ae1cabda3
