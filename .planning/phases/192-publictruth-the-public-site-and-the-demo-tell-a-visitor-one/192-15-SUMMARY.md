---
phase: 192-publictruth-the-public-site-and-the-demo-tell-a-visitor-one
plan: 15
subsystem: api
tags: [proxy, public-routes, retire-demo, seed-integrity, pdf]
status: complete
requires:
  - phase: 192-publictruth
    provides: "192-16 retired the nightly spec that minted demo PDF tokens, so the route, token module and constants could leave in import order"
provides:
  - "The demo PDF endpoint is gone from the build and from PUBLIC_ROUTES; a signed-out request for it gets the same 307 to /login as a never-existing API path"
  - "proxy.test.ts fails if /api/demo becomes public again (two redirect rows, shown RED on the old list)"
  - "src/lib/demo.ts and src/lib/personas.ts are deleted; the seed-integrity census still bites on the demo constant names"
affects: [192-10]
plan_head_before: 64bc7c266222c95b6599a65d3a57353c7fb314c0
plan_head_after: 75b1e4b27bb298da33b1c1abc67cbc0493bdfd98
commits: 2
actuals:
  tokens: 15000
  tasks: 2
  commits: 2
tech-stack:
  added: []
  patterns:
    - "A retired route is pinned by a proxy redirect row, shown RED against the old PUBLIC_ROUTES, plus a build-manifest absence reading"
key-files:
  created: []
  modified:
    - src/proxy.ts
    - src/proxy.test.ts
    - next.config.ts
    - src/lib/api/limiter-ordering.test.ts
    - src/__tests__/critical-regressions.test.ts
    - src/lib/pdf-render-token.ts
    - src/__tests__/seed-integrity.test.ts
    - src/__tests__/contracts/env-manifest.test.ts
    - vitest.node-env.ts
    - .env.example
    - README.md
    - docs/architecture/adr-0014-secret-handling.md
    - .planning/phases/192-publictruth-the-public-site-and-the-demo-tell-a-visitor-one/192-EVIDENCE.md
  deleted:
    - src/app/api/demo/portfolio-pdf/[id]/route.ts
    - src/app/api/demo/portfolio-pdf/[id]/route.test.ts
    - src/lib/demo-pdf-token.ts
    - src/lib/demo-pdf-token.test.ts
    - src/lib/demo.ts
    - src/lib/demo.test.ts
    - src/lib/personas.ts
    - src/lib/personas.test.ts
key-decisions:
  - "DEMO_PDF_SECRET keeps its name and its .env.example key line: pdf-render-token.ts still signs portfolio PDF render tokens with it, and renaming a provisioned secret would be a Vercel change outside D-11"
  - "The /api/demo-evil sibling redirect row was removed as the plan says, because the premise (a sibling of a public prefix) is gone; /api/demo itself is now a redirect row"
requirements-completed: [ROUTE-03]
coverage:
  - id: D1
    description: "The demo PDF endpoint and its token module are gone from the build and public routing, and answer a signed-out visitor like an unknown API path"
    requirement: "ROUTE-03"
    verification:
      - kind: unit
        ref: "npx vitest run src/proxy.test.ts src/lib/api/limiter-ordering.test.ts src/__tests__/critical-regressions.test.ts src/lib/pdf-render-token.test.ts src/__tests__/phase-164-share-lane-headers.test.ts src/__tests__/phase-32-frozen-spine-guards.test.ts (319 passed)"
        status: pass
      - kind: other
        ref: "192-EVIDENCE.md lines 'D-11 /api/demo: build-route=absent' and 'D-11 /api/demo anon answer: matches control' (placeholder build, next start -p 3199, curl)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The persona and allocator constants are gone and the census that keeps them out still bites"
    requirement: "ROUTE-03"
    verification:
      - kind: unit
        ref: "src/__tests__/seed-integrity.test.ts neuter-and-restore (2 RED naming src/lib/utils.ts, then 25/25 GREEN after byte restore)"
        status: pass
    human_judgment: false
duration: 7min
completed: 2026-11-07
---

# Phase 192 Plan 15: Retire the demo PDF endpoint, token module and persona constants Summary

**`/api/demo` leaves PUBLIC_ROUTES and the build, so a signed-out request gets the same 307 to `/login` as an API path that never existed, and the demo persona and allocator constants are deleted with a census that still fails if they return.**

## Performance

- **Duration:** about 7 min
- **Started:** 2026-11-07T02:20:00Z
- **Completed:** 2026-11-07T02:28:00Z
- **Tasks:** 2
- **Files:** 8 deleted, 13 modified

## Accomplishments

- Task 1 (tracer): `git rm` of the demo PDF route and its test, and `src/lib/demo-pdf-token.ts` and its test. `/api/demo` removed from `PUBLIC_ROUTES`; the demo route's Chromium tracing key removed from `next.config.ts`; the SEC-003 `pdfRoutes` row, the limiter-ordering `PUBLIC_IP_EXCEPTION` row and the node-env list entry removed.
- Placeholder production build (CI env of `frontend-build`, temporary `turbopack.root`, `next start -p 3199`): `.next/app-path-routes-manifest.json` lists `/security` and `/api/portfolio-pdf/[id]` and no path starting with `/api/demo`. The persona-id path, `/api/demo` and the control `/api/no-such-route-192` each answer 307 to `/login`. Recorded in 192-EVIDENCE.md.
- Task 2: `git rm` of `src/lib/demo.ts`, `src/lib/personas.ts` and their tests. `seed-integrity.test.ts` now uses the seeder's own `ACTIVE_PORTFOLIO_ID` and `STALLED_PORTFOLIO_ID`; the two "match src/lib/demo.ts" describes are gone; the PURGE census keeps `DEMO_PATTERN` and every case, with the deleted files out of the allowlist, `DEMO_ROUTE_PREFIXES` deleted, and the `src/app/api` case scanning the whole directory.
- `.env.example`, the env-manifest comment and README now describe the tree that exists. `DEMO_PDF_SECRET` and its key line stay.

## RED and neuter evidence

- **RED before the PUBLIC_ROUTES edit** (`npx vitest run src/proxy.test.ts` after adding the two rows): `2 failed | 107 passed`. `× /api/demo → 307 redirect to /login` and `× /api/demo/portfolio-pdf/abc-123 → 307 redirect to /login`, both `expected 200 to be 307`.
- **Census RED** (a line comment containing `ALLOCATOR_ACTIVE_ID` appended to `src/lib/utils.ts`, backup in the scratchpad): `2 failed | 23 passed`. `no file under src/lib (excluding admin/match.ts) references demo constants` and `exact allowlist — set of all referencing files is known` (`unexpected demo reference: src/lib/utils.ts`). After the byte restore `cmp` was silent and the run was `25 passed`.

## Task Commits

1. **Task 1: demo PDF endpoint and token module leave the build, proxy, tracing config and census rows** - `6797db617` (feat)
2. **Task 2: persona and allocator constants leave; census keeps biting; docs stop naming the demo lane** - `75b1e4b27` (feat)

**Plan metadata:** the SUMMARY commit that carries this file.

## Reference check (Task 1 and Task 2 importer checks)

- `git grep -n -E "api/demo/portfolio-pdf|demo/portfolio-pdf|demo-pdf-token" -- src e2e scripts next.config.ts .github` before the edits: hits in this task's files; `src/lib/demo.ts` and `src/lib/personas.ts` (Task 2); and comment-only lines in `alert-ack-token.ts`, `scenario-share-token.ts`, `scrub-share-path.ts` and `strategy-share-token.ts`, which cite the deleted module as a design precedent and stay as lineage. `e2e/portfolio-pdf-demo.spec.ts` was already gone (plan 192-16).
- `git grep -n -E "lib/demo\"|lib/demo'|lib/personas|from \"\./demo\"|from \"\./personas\"" -- src e2e scripts`: `seed-integrity.test.ts` and the two tests (Task 2 files), plus comment-only lines in `scripts/seed-full-app-demo.ts` (lines 47 and 141). No other importer.

## Decisions Made

- `DEMO_PDF_SECRET` is not renamed or removed (see key-decisions).
- The plan's `INDIRECT_READS` set in `env-manifest.test.ts` is unchanged, since `pdf-render-token.ts` still reads the secret through `SECRET_ENV`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] docs/architecture/adr-0014-secret-handling.md cited the deleted token module**
- **Found during:** Task 1 (the dispatch note asked for a `docs/architecture` grep when a module is deleted)
- **Issue:** the ADR's Evidence list said `HMAC_SECRET: src/lib/demo-pdf-token.ts`, and its secret-class table described the secret as "Demo PDF token signing". Both name a path or purpose that no longer exists.
- **Fix:** the evidence line now points at `src/lib/pdf-render-token.ts` (which reads `DEMO_PDF_SECRET`) and says the demo token module was retired; the table row says "Portfolio PDF render token signing". Nothing else in the ADR changed.
- **Files modified:** docs/architecture/adr-0014-secret-handling.md
- **Verification:** `npx vitest run src/__tests__/adr-*.test.ts` (15 passed); `grep -a -rn -E "demo-pdf-token|lib/demo|lib/personas" docs/architecture` now prints 0 hits.
- **Committed in:** `6797db617`

---

**Total deviations:** 1 auto-fixed (1 blocking-class documentation citation).
**Impact on plan:** a one-line doc follow-up to a file the plan deleted; no scope creep.

## Gates (real numbers)

- Task 1 verify: `npx vitest run` on proxy, limiter-ordering, critical-regressions, pdf-render-token, phase-164-share-lane-headers, phase-32-frozen-spine-guards: 6 files, 319 passed. Evidence lines both present (`grep -qxF`).
- Task 2 verify: seed-integrity, env-manifest, phase-150-capital-ownership-invariant: 3 files, 46 passed.
- Wider readers of changed files: `npx vitest run src/__tests__/contracts src/__tests__/gitleaks-allowlist.test.ts src/__tests__/local-stack-lane-wiring.test.ts src/__tests__/csv-finalize-concurrent-never-classified.test.ts src/__tests__/seed-demo-data-*.test.ts src/lib/api`: 26 files, 550 passed, 1 skipped (the skip is pre-existing, not touched here). ADR tests: 15 passed.
- `npx tsc --noEmit`: exit 0, no output.
- `npm run lint`: 0 errors, 2 warnings, both pre-existing unused-variable warnings in `src/app/factsheet/[id]/v2/MetricsColumn.tsx` and `src/lib/factsheet/composite-read-path.ts` (files this plan did not touch). Planning-hygiene, route-contract and admin-manifest checks OK.
- `npm run build` ran on the placeholder env: exit 0. Playwright and the seeded e2e lane were not run here (no seeded env).
- Acceptance criteria all met: both deleted-path tests pass; `"/api/demo"` in proxy.ts 0; `api/demo` in next.config.ts and pdf-render-token.ts 0; `demo/portfolio-pdf` in the limiter and critical-regressions tests 0; `demo-pdf-token` in vitest.node-env.ts 0; `turbopack` in next.config.ts 0 (restored from a byte backup, `cmp` silent); UUID grep on 192-EVIDENCE.md 0; `@/lib/demo` import 0, `DEMO_PATTERN` 6 hits; README demo grep 0; `^DEMO_PDF_SECRET=` 1.

## Demo hits left in place (classified, listed, not edited)

- `scripts/seed-demo-data.ts`, `scripts/seed-full-app-demo.ts`, `scripts/seed-demo-profiles.ts`: local-dev and e2e seeders. `seed-full-app-demo.ts` (lines 47, 141) and `seed-demo-profiles.ts` (line 28) carry comments that still describe the retired `/demo` page and `src/lib/demo.ts`. Unsure whether those persona steps are still wanted; left for plan 192-10.
- `analytics-service/routers/match.py` and `analytics-service/tests/test_match_router.py`: comments and code about the demo allocator exclusion and `/api/demo/match`. The exclusion stays load-bearing while the PROD demo rows stay (D-11); the `/api/demo/match` route no longer exists in `src`, so those comments are stale. Left for plan 192-10.
- `TODOS.md` entry `[170.1.2-DEMO-MATCH-PAYLOAD-EMAIL]` names `src/app/api/demo/match/[allocator_id]/route.ts`, which is already gone (earlier plans). Left for plan 192-10 to close or reroute.
- `src/app/factsheet/[id]/v2/BatchDPanels.tsx` and its peer-scenario test: the "Demo portfolios" section, Phase 193 scope fence (D-11). Not touched.
- `docs/superpowers/plans/2026-04-09-*` and `docs/runbooks/fix-list-reverify-2026-05-17.md`: dated historical plans and reverify tables that name the deleted routes. Not edited.
- `src/proxy.test.ts` header comment (lines about C-0186) still names `'/demo'` and `'/api/demo'` as audit history; it describes the 2026-05-07 audit and is left as lineage.

## Known Stubs

None.

## Threat Flags

None. This plan removed a public network surface (T-192-34 mitigated: `/api/demo` out of PUBLIC_ROUTES, RED-then-GREEN redirect rows, the admin-client read, allowlist and token verifier deleted with the route). T-192-37 mitigated: the persona portfolio id used for the probe stayed in the scratchpad, the evidence names it in words, and the UUID grep prints 0. No PROD write or delete, no package installed.

## Issues Encountered

None. The first build under the symlinked `node_modules` succeeded with the temporary `turbopack.root`; it was removed from `next.config.ts` by byte restore before the commit.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 192-10 can take the left-in-place list above. No blockers.

## Self-Check: PASSED

- Files: the eight deleted paths are absent (`test ! -e`), the thirteen modified paths exist.
- Commits: `6797db617` and `75b1e4b27` are ancestors of HEAD.
