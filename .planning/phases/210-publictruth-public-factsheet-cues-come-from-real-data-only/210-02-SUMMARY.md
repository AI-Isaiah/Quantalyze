---
phase: 210-publictruth-public-factsheet-cues-come-from-real-data-only
plan: 02
subsystem: factsheet
tags: [factsheet, payload, no-demo-data, api-arm, tracer]
requires: []
provides:
  - the api factsheet payload carries neither a demo peer cohort nor demo allocator blends (D-10, D-15)
  - every reader of the two removed fields asserts absence instead of presence
affects: [factsheet, publictruth]
key-files:
  modified:
    - src/lib/factsheet/build-payload.ts
    - src/lib/factsheet/types.ts
    - src/lib/factsheet/build-payload.test.ts
    - src/lib/factsheet/__snapshots__/build-payload.test.ts.snap
    - src/app/factsheet/[id]/v2/FactsheetBody.no-demo-content.test.tsx
    - src/lib/factsheet/audit-c20.test.ts
    - src/app/factsheet/[id]/v2/StressWindowsPanel.unreadable.test.tsx
    - src/__tests__/figure-parity-pages.test.tsx
    - src/app/factsheet/[id]/v2/BatchDPanels.peer-scenario.test.tsx
    - src/app/factsheet/[id]/v2/BatchDPanels.ownbook.test.tsx
    - src/lib/factsheet/build-payload.null-honest.test.ts
    - src/lib/factsheet/return-stats.sites.test.ts
    - src/lib/factsheet/allocator-portfolio-payload.ts
  deleted:
    - src/lib/factsheet/build-payload.peer-withheld.test.ts
decisions:
  - "PeerPercentilePayload is kept: the csv arm's scenarioPeer still uses it"
  - "The audit-c20 peer-rank test was deleted whole; its trailing sqrt(365/252) headline-Sharpe assertion is covered by og-metrics, allocator-portfolio-payload and rolling tests"
metrics:
  completed: 2026-11-14
status: complete
actuals:
  tokens: 60000
  tasks: 2
  commits: 2
plan_head_before: be589e66e826d7a2f87a5ceeca1daa961e4ff65f
plan_head_after: 53eba441a41b0ffbfd2b1476488b30f2aa56898f
commits: 2
---

# Phase 210 Plan 02: api payload drops demo cohort and blends Summary

`buildFactsheetPayload`'s api arm no longer builds a canned peer-percentile cohort or the three canned allocator blends (60/40, risk parity, crypto book), and the `FactsheetApiPayload` type no longer declares them, so an anonymous visitor's RSC payload cannot carry demo figures. A new D-15 test proves it on a built, serialized payload and was seen RED with a field put back.

## Commits

- `ae92834d1` feat(210-02): producer arm, type, D-15 test, snapshot (one added and one deleted line, api entry only), premise test flipped (Task 1, tracer).
- `53eba441a` test(210-02): readers of the removed fields assert absence; the null-honest allocator-blend describe and `build-payload.peer-withheld.test.ts` removed (Task 2).

## Verbatim readings

- Neuter proof (Task 1, D-15): `peerPercentile: null` re-added after `ingestSource: "api"` turned the D-15 test RED on the `in` assertion; restored from a byte backup, sha256 `a5a0a9642e56dc6f908b12f7b7f6202ef16e19e685149de43194533aa6c76d38` equal to the pre-neuter value; re-run GREEN (52 passed).
- Snapshot numstat `1 1`; `grep -c -a -E 'peerPercentile|allocatorPortfolios'` on the snapshot prints 0.
- `npx tsc --noEmit`: 0 `error TS` lines after Task 2 (it was red in six test files after Task 1, as the plan predicted).
- Plan verify vitest run, 10 files: `Test Files 10 passed (10)`, `Tests 412 passed (412)`.
- `npx eslint` on build-payload.ts, types.ts, allocator-portfolio-payload.ts and build-payload.null-honest.test.ts: exit 0 (after dropping the now-unused `GLD_DAILY`, `IEF_DAILY`, `SPX_DAILY` import from null-honest).
- Acceptance greps: `AllocatorPortfolioPayload` count in null-honest 0; `allocatorPortfolios).(toBeNull|toHaveLength)` 0 in both files; `build-payload.peer-withheld.test.ts` gone; no `.peerPercentile`/`.allocatorPortfolios` reader left in `src` or `scripts`.
- The commit's only deletion is the intended `build-payload.peer-withheld.test.ts`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Dropped an unused import left by the deleted describe**
- **Found during:** Task 2 eslint run
- **Issue:** removing the allocator-blend describe left `GLD_DAILY`, `IEF_DAILY`, `SPX_DAILY` unused in `build-payload.null-honest.test.ts` (3 warnings).
- **Fix:** removed that import line.
- **Files modified:** src/lib/factsheet/build-payload.null-honest.test.ts
- **Commit:** 53eba441a

**2. [Rule 1 - Bug] `return-stats.sites.test.ts` title**
- **Issue:** the constant-yield api-payload test title still said "no Sortino rank" after the peer assertion was removed (the peer field read there was a cast, so tsc did not flag it; it would have failed at runtime).
- **Fix:** title now reads "carries no Sortino/Calmar"; the NaN assertions are kept.
- **Commit:** 53eba441a

## Known Stubs

None.

## Threat Flags

None. The change removes serialized surface; it adds none.

## Not run

The full `npm test` suite was not run in this executor; the plan's targeted verify set, `tsc` and eslint were.

## Self-Check: PASSED

Both commits are ancestors of HEAD; the SUMMARY's key files exist (`build-payload.peer-withheld.test.ts` is intentionally absent).
