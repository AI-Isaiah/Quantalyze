---
phase: 208-uiquick-alert-digest-link-browse-error-state-and-share-link
plan: 02
subsystem: ui
tags: [share-link, error-handling, a11y, live-region, vitest]
requires: []
provides:
  - "ShareMintError (status-carrying) and status-mapped share-mint labels on ShareableLink"
  - "mint catch logs { strategyId, err }; signed-out redirect to /login read as 401"
  - "row LiveRegion mirroring the visible failure label"
  - "file-level FactsheetView warm-up and explicit lazy-panel await timeouts (D-11)"
affects: [208-03, 208-04]
actuals:
  tokens: 5300
  tasks: 3
  commits: 3
plan_head_before: a2c7875f36c28fdfe83d337cf97a3329037dfbe7
plan_head_after: 87296cdccfbc57d1f584ba583c84fb74cf6cd39b
commits: 3
key-files:
  modified:
    - src/components/strategy/ShareableLink.tsx
    - src/components/strategy/ShareableLink.test.tsx
key-decisions:
  - "403 and 404 share one non-revealing string (T-164-03 preserved); 401 and the /login redirect read signed out; everything else keeps the retryable label"
  - "res.json().catch(() => null) in mintShareUrl stays: a parse failure becomes the no-url ShareMintError, which the mint catch logs"
requirements-completed: [SC-3, SC-4]
status: complete
---

# Phase 208 Plan 02: ShareableLink mint failures Summary

A share-link mint failure is now logged with the strategy id (`console.warn("[ShareableLink] share mint failed", { strategyId, err })`, status-only message), reads `Signed out — sign in again to share` (401, including the proxy's redirect to `/login`) or `You can't share this strategy here` (403/404) instead of a useless "try again", and is announced by a polite `LiveRegion` after the row button.

## Commits

- `b50f2c785` fix(208-02): a 404 share mint says what happened, is logged and announced
- `9632393c7` test(208-02): pin the 401, redirect, 403, 404 and other share-mint wording and the live region
- `87296cdcc` test(208-02): warm the lazy share panel once per file and give its awaits an explicit timeout (D-11)

## RED-first and GREEN lines

- Task 1 RED (test added, no source change): `Tests 1 failed | 30 passed (31)` (received `Couldn't create the link — try again`, expected `You can't share this strategy here`).
- Task 1 GREEN: `Tests 31 passed (31)`; `npm run typecheck` and eslint clean.
- Task 2: all 12 new arms were green on first run (Task 1 implemented the mapping, as the plan anticipated), `Tests 43 passed (43)`. The neuters below are this task's RED proof.

## Neuter evidence

- neuter-208-02 (a): mint catch `console.warn` deleted. RED `9 failed | 34 passed (43)`: the 404 arm ("a 404 mint says the owner can't share here, logs { strategyId, err } …"), the 401 arm, the D-13 arm and all six "other" arms. Restored with `cp -p`, `cmp` exit 0, GREEN `43 passed (43)`.
- neuter-208-02 (b): `mintFailureKind` returns `"other"` for every input. RED `4 failed | 39 passed (43)`: the 404, 401, D-13 and 403 arms. Restored, `cmp` exit 0, GREEN `43 passed (43)`.
- neuter-208-02 (c): redirect-to-`/login` branch deleted from `mintShareUrl`. RED `1 failed | 42 passed (43)`: "D-13: a fetch redirected to /login (the proxy's answer to a signed-out POST) is a 401, not 'try again'". Restored, `cmp` exit 0, GREEN `43 passed (43)`.
- neuter-208-02 (d): row `<LiveRegion message={null} />`. RED `10 failed | 33 passed (43)`: the 404, 401, 403 region assertions, the six "other" arms and "the row region announces the copy failure too". Restored, `cmp` exit 0, GREEN `43 passed (43)`.

## D-11 readings (Task 3)

Three consecutive runs after the edit: `Tests 43 passed (43)`, `Tests 43 passed (43)`, `Tests 43 passed (43)`.

No neuter-RED is claimed for D-11: the 1 s CI failure does not reproduce locally (RESEARCH measured the cold path at 143-407 ms even without a warm-up). The closing evidence here is the cited mechanism (react-loadable singleton: only the first mount in a file pays the import), the two protections (one file-level `beforeAll` warm-up replacing the two describe-level copies, and `{ timeout: 5000 }` on all five `Copy share link` / `Revoke link` awaits, each commented), and repeated green runs. Plan 04 takes the binding 3-quiet plus 3-loaded reading after the last edit to this file. No `vitest.config.ts` or global timeout changed (`git status --short vitest.config.ts` is empty).

## Gates line

Gate set (copy-census, display-sign-single-source, trim-removed-surfaces, critical-regressions, FactsheetView.share-affordance): `Test Files 5 passed (5)`, `Tests 296 passed (296)`. `strategies/page.share-affordance.test.tsx`: `Tests 9 passed (9)`. `npm run typecheck`: no `error TS`. `npx eslint` on both files: exit 0.

## Deviations from Plan

None - plan executed exactly as written. Minor test-typing fix inside Task 1 (the `writeText` mock is typed `Mock<(s: string) => Promise<void>>` so `setClipboard` typechecks); no behavior change.

## Known Stubs

None.

## Threat Flags

None. The log carries `{ strategyId, err }` only and `ShareMintError` messages are status-only (T-208-06, pinned by the exact `share mint failed: 404` assertion); 403 and 404 share one string (T-208-07).

## Self-Check: PASSED

Files `src/components/strategy/ShareableLink.tsx` and `.test.tsx` present; commits `b50f2c785`, `9632393c7`, `87296cdcc` are ancestors of HEAD.
