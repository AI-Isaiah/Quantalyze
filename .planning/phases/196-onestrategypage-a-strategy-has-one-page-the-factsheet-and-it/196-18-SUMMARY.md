---
phase: 196-onestrategypage-a-strategy-has-one-page-the-factsheet-and-it
plan: 18
subsystem: routing
tags: [route-deletion, census, redirects, lean]
requires: ["196-02"]
provides:
  - "no file under src/app/strategy; /strategy/<id> and /strategy/<id>/v2 reach the factsheet through plan 02's 308s"
affects: [196-07, 196-14]
tech-stack:
  added: []
  patterns: ["a frozen census row moves in the same commit as the file it lists"]
key-files:
  created: []
  modified:
    - src/lib/complete-status-scan.test.ts
    - src/__tests__/figure-gate-census.test.ts
  deleted:
    - "src/app/strategy/[id]/v2/ (6 files)"
    - "src/app/strategy/[id]/ (7 files: error, loading, page, and their tests)"
key-decisions:
  - "composite-joint.ts had no importer outside the v2 tree, so it was deleted with it"
  - "The 194.1 carry note was applied in Task 2: the EXCLUDED row is gone and the redirected set is five"
requirements-completed: [LEAN-02, ROUTE-02]
status: complete
commits: 2
plan_head_before: aab9f6a1abc16d008aea11e447054698e1767686
plan_head_after: 29aa5a58159f93130fbebb4d4254c62eb400a24d
actuals:
  tasks: 2
  commits: 2
---

# Phase 196 Plan 18: Delete the retired /strategy route trees Summary

Both retired strategy route trees (13 files) are deleted, and the two census rows that listed the old page moved in the same commit as the deletion.

## Commits

| Task | Commit | What |
|------|--------|------|
| 1 (tracer) | 443abbb65 | `git rm -r "src/app/strategy/[id]/v2"` (6 files) |
| 2 | 29aa5a581 | `git rm -r src/app/strategy` (7 files), `complete-status-scan` ALLOWLIST row, `figure-gate-census` EXCLUDED row and `six` list |

## Verification (HEAD -> after)

- composite-joint importer check: `grep -a -rn "composite-joint|readCompositeV2Joint|withV2Joint" src scripts tests` outside the v2 tree returned nothing, so `composite-joint.ts` and its test were deleted.
- Task 1: `find "src/app/strategy/[id]/v2" -type f` 6 -> 0; `StrategyV2Shell.tsx` still present; `tsc --noEmit` clean; `check:route-contract` printed `OK — 51 page routes, all declared in the manifest.`; `strategy-route-redirects` and `check-route-contract` vitest: 23 passed.
- Task 2: `find src/app/strategy -type f` 13 -> 0; comment-stripped grep for `app/strategy/[id]/page.tsx` in `complete-status-scan.test.ts` 1 -> 0; `grep -c '"/strategy"' src/proxy.ts` 2 -> 2 (PUBLIC_ROUTES untouched); `196-KNIP-BASELINE.txt` not touched; `tsc --noEmit` clean; `check:route-contract` printed `OK — 50 page routes, all declared in the manifest.`; vitest on `complete-status-scan`, `check-route-contract`, `figure-gate-census`, `strategy-route-redirects`: 35 passed.
- Precondition: `grep -a -c 'redirectFrom: "/strategy/:id/v2"' route-contract-manifest.ts` returned 1.

## 194.1 exclusion-row result

`figure-gate-census.test.ts` carried `"src/app/strategy/[id]/page.tsx": REDIRECTED` in `EXCLUDED` and listed it in the test "the six 196-redirected files are EXCLUDED with exactly the redirect reason". Removed the row and the list entry; the test is now "the five 196-redirected files" and the five remaining `src/components/strategy-v2/*` rows stay for plan 14 to remove. Moved-test table: `src/__tests__/figure-gate-census.test.ts` (row removed, test renamed six -> five).

## RED evidence

Both censuses fail both ways, so the rows were put back from a cp backup with the page already deleted:

- `figure-gate-census.test.ts` RED: `stale: EXCLUDED key src/app/strategy/[id]/page.tsx names a file the walk does not find`.
- `complete-status-scan.test.ts` RED: `Missing/stale allowlist entries: ["app/strategy/[id]/page.tsx"]`.
- New files restored with cp, `cmp` identical, both GREEN (12 passed).

## Deviations from Plan

None - plan executed as written. The carry note was in scope and applied in Task 2.

## Not measured

- The `/strategy/<id>` and `/strategy/<id>/v2` 308s were covered by the redirect unit tests and the route-contract check only; no live server request was made.
- No PROD access.

## Known Stubs

None.

## Threat Flags

None.

## Self-Check: PASSED

Both commits exist on `worktree-agent-196-18`; `src/app/strategy` has no files; SUMMARY written.
