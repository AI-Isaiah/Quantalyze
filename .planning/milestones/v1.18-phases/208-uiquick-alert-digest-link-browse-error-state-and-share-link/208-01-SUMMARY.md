---
phase: 208-uiquick-alert-digest-link-browse-error-state-and-share-link
plan: 01
subsystem: ui
tags: [nextjs, browse, error-state, email, vitest, playwright]
requires: []
provides:
  - "/browse tells a failed category read apart from an empty one"
  - "alert digest link reads 'Open your allocation →' and makes no dashboard claim"
affects: [208-02, 208-03, 208-04, 208-05]
actuals:
  tokens: 4200
  tasks: 3
  commits: 3
plan_head_before: 3b3c7443b98bf901380057a0215a513d58427315
plan_head_after: 9324a41a9ca2211f62cbcf7bf4fd5dc8ba90a096
commits: 3
key-files:
  modified:
    - src/lib/queries.ts
    - src/lib/queries.anon-read-errors.test.ts
    - src/app/browse/browse-categories.ts
    - src/app/browse/page.tsx
    - src/app/browse/page.test.tsx
    - src/lib/email.ts
    - src/lib/email.test.ts
key-decisions:
  - "getPopulatedCategorySlugs throws through failAnonRead; getBrowseCategories maps the throw to the error state and captures nothing twice (D-02)"
  - "The retry control is a next/link Link with prefetch={false}; a click re-runs the server read (proven live), so no raw anchor fallback was needed"
requirements-completed: [SC-1, SC-2, SC-4]
status: complete
---

# Phase 208 Plan 01: Browse error state and digest link Summary

`/browse` now renders a role=alert error block with a working Try again link on a failed category read (instead of five invented cards), an empty line on an empty read, and the digest email link reads `Open your allocation →` while still targeting `/allocations`.

## Commits

- `da808fb03` fix(208-01): /browse tells a failed category read from an empty one
- `527fc3a61` fix(208-01): an ok read with no known category renders the empty state (D-14)
- `9324a41a9` fix(208-01): alert digest link reads "Open your allocation" and makes no dashboard claim

## RED-first lines

- Task 1 step 2 (before any source edit): `npx vitest run src/app/browse/page.test.tsx src/lib/queries.anon-read-errors.test.ts` gave `Test Files 2 failed (2)`, `Tests 3 failed | 12 passed (15)`. The three failures were the helper throw arm and both rewritten page arms (empty line, error block).
- Task 2 step 1: with the D-14 arm added and Task 1's code, `Tests 1 failed | 8 passed (9)` (the D-14 arm).
- Task 3 step 1: with the renamed digest arm and the old label, `Tests 1 failed | 45 passed (46)`.

## Neuter evidence

- neuter-208-01 (a): `src/lib/queries.ts`, the `failAnonRead("getPopulatedCategorySlugs", ...)` statement replaced with `return []`. `npx vitest run src/lib/queries.anon-read-errors.test.ts` RED: `throws on a 42501 and reports it to Sentry with the op and the code` (`1 failed | 6 passed (7)`). Restored with `cp -p`, `cmp` exit 0, GREEN `7 passed (7)`.
- neuter-208-01 (b): `src/app/browse/browse-categories.ts`, the catch reporting `"empty"` instead of `"error"`. `npx vitest run src/app/browse/page.test.tsx` RED: `renders the error block, no cards, no empty line and no redirect when the read rejects` (`1 failed | 7 passed (8)`). Restored, `cmp` exit 0, GREEN `8 passed (8)`.
- neuter-208-01 (c): the pre-phase fallback restored in BOTH files (`categories` = every `DISCOVERY_CATEGORIES` entry on non-ok in `browse-categories.ts`, and the grid gate in `page.tsx` made always-true). RED: `renders the empty line, no cards and no redirect when the read returns empty` and `renders the error block, no cards, no empty line and no redirect when the read rejects` (`2 failed | 6 passed (8)`). Restored both files, `cmp` exit 0 on each, GREEN `8 passed (8)`. See Deviations: the fallback is guarded by two layers, so a `browse-categories.ts`-only neuter stayed GREEN (8 passed) and was not the pin.
- neuter-208-01 (d): D-14 statement (`if (state === "ok" && categories.length === 0) state = "empty";`) deleted. RED: `a successful read whose slugs match no known category renders the empty state, never a card or the error block (D-14)` (`1 failed | 8 passed (9)`). Restored with `cp -p`, `cmp` exit 0, GREEN `9 passed (9)`.
- neuter-208-01 (e): `src/lib/email.ts` link label put back to the old text. `npx vitest run src/lib/email.test.ts` RED: `alert digest link reads 'Open your allocation →', targets /allocations and makes no dashboard claim (D-01)` (`1 failed | 45 passed (46)`). Restored with `cp -p`, `cmp` exit 0, GREEN `46 passed (46)`.

## Live reading (Task 2 step 5)

Dev server on port 3218 with a closed-port Supabase URL and placeholder keys. First `/browse` GET returned `200`.

Try again JSON line:
`{"alertBefore":true,"n0":2,"n1":3,"alertAfter":true,"path":"/browse"}`

Sweep (`CI=1 PLAYWRIGHT_BASE_URL=http://localhost:3218 npx playwright test e2e/axe-app-wide.spec.ts e2e/no-clip-sweep.spec.ts e2e/reflow-sweep.spec.ts -g "/browse( no| @)" --reporter=line`): `8 passed (1.0m)`.

Teardown: dev server killed (`pgrep` prints nothing), `AGENTS.md` restored from the byte backup, `cmp` exit 0, `git status --short` clean of `AGENTS.md` and stray files.

## Gates

Final run, after all three commits: email test + browse + helper test `Test Files 7 passed (7)`, `Tests 81 passed (81)`. Gate set (copy-census, display-sign-single-source, trim-removed-surfaces, critical-regressions, FactsheetView.share-affordance): `Test Files 5 passed (5)`, `Tests 296 passed (296)`. `npm run typecheck` clean. `npx eslint src/lib/email.ts src/lib/queries.ts src/app/browse/page.tsx src/app/browse/browse-categories.ts` exit 0. `node scripts/verify-plan-anchors.mjs` on this plan: `OK: 1 plan file(s), no stale claims.`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Plan defect] Neuter (c) needs both files**
- **Found during:** Task 1 step 7(c)
- **Issue:** The plan's neuter (c) edits only `browse-categories.ts` (non-ok states return every category). The page also gates the card grid on `state === "ok"`, so that single-file neuter stayed GREEN (8 passed): the fallback is defended by two layers.
- **Fix:** neuter (c) was re-run with both layers reverted (see the line above); it went RED naming the empty and error arms. No source change.
- **Files modified:** none
- **Commit:** n/a

**2. [Rule 2 - extra assertions, test only]** The rewritten error arm additionally asserts the thrown message (`db down`) never reaches the page (T-208-02) and that the footer disclaimer text renders.

### Handlers run on the dispatch's instruction

The plan's standing rules say never edit ROADMAP.md or STATE.md, but the dispatch brief required `roadmap update-plan-progress` and the STATE handlers. They were run (`roadmap.update-plan-progress 208`, `state.advance-plan`, `state.update-progress`, `state.record-metric`, `state.add-decision`, `state.record-session`) and `git diff` showed only intended changes (ROADMAP: the 208 progress row, the `**Plans:**` count, the 208-01 tick; STATE: position, metric, decision, session; state.json: counters), so nothing was reverted. `requirements.mark-complete` was skipped: SC-1, SC-2 and SC-4 are ROADMAP success criteria, not REQUIREMENTS.md ids.

## Known Stubs

None.

## Threat Flags

None. No new network endpoint, auth path or schema surface.

## Self-Check: PASSED

- Commits `da808fb03`, `527fc3a61`, `9324a41a9` are ancestors of HEAD.
- All seven modified source and test files exist and are committed.
