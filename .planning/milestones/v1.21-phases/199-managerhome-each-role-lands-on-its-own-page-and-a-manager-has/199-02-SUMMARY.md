---
phase: 199-managerhome-each-role-lands-on-its-own-page-and-a-manager-has
plan: 02
subsystem: ui
tags: [health, freshness, pure-function, tdd]
requires: []
provides:
  - "src/lib/strategy-health.ts: strategyHealthOf, healthWord, HEALTH_TONE, rowChipStatus, StrategyHealthKind"
affects: [199-07, 199-09, 199-10, 199-12]
tech-stack:
  added: []
  patterns: ["one listSeriesVerdict call, no threshold typed", "satisfies Record<Union, string> tone table"]
key-files:
  created: [src/lib/strategy-health.ts, src/lib/strategy-health.test.ts]
  modified: []
key-decisions:
  - "Series judged by exactly one listSeriesVerdict(seriesEnd, assetClass, nowMs) call (R-05); freshness.ts untouched"
  - "rowChipStatus takes a structural param so the table's StrategyWithAnalytics satisfies it unchanged"
status: complete
metrics:
  duration: ~15m
  completed: 2026-11-10
actuals:
  tokens: 9000
  tasks: 2
  commits: 2
plan_head_before: 1157767ef061176922916f1da92f3276a9083efd
plan_head_after: e647e8fb166af1b724fda6629591d10e731a2685
---

# Phase 199 Plan 02: Health derivation Summary

The Health word as one pure, tested function: `strategyHealthOf` follows the UI-SPEC first-match order and judges the series with the single Phase 197 `listSeriesVerdict` call, so the word agrees with the Discovery list.

## Commits

- 9b67a56ab: tracer, `strategy-health.ts` and the first tests (stale Oct 3, 2026 word and tone, fresh row Healthy, `rowChipStatus`)
- e647e8fb1: Task 2 tests (order, Updating, Stale no data yet, per-class boundaries, em dash cases, tables)

BASE (plan start) = 1157767ef061176922916f1da92f3276a9083efd. `git diff --exit-code 1157767ef..HEAD -- src/lib/freshness.ts src/lib/freshness.test.ts` exits 0 (freshness.ts and its test not edited).

## Verification

- `node scripts/verify-plan-anchors.mjs <plan>`: OK, 13 claims, exit 0
- `npx vitest run src/lib/strategy-health.test.ts src/lib/freshness.test.ts`: 2 files, 90 tests passed
- `npx tsc --noEmit`: exit 0, no output
- `npx eslint src/lib/strategy-health.ts src/lib/strategy-health.test.ts`: exit 0
- No-threshold gate (`grep -a -v -E '^[[:space:]]*(\*|//|/\*)' … | grep -a -E -c 'ageDays|thresholdDays|SERIES_STALE_DAYS|SERIES_END_|[^=][<>]=? *[0-9]'`): 0
- `grep -a -c -E "assetClass|asset_class"` on the test: 11 (at least 2 required)
- `grep -a -c -E "export function seriesVerdictOf|^export function bucketSeriesAge" src/lib/freshness.ts`: 0

gc-199-02-neuter: (a) `listSeriesVerdict(i.seriesEnd, null, i.nowMs)` (asset class dropped) on a `cp -p` byte backup: RED, 2 failed (`crypto: age 7 reads Healthy, age 8 reads Stale`, `the same day (age 8) is Stale for crypto and Healthy for traditional`); restored, `cmp` identical.
gc-199-02-neuter: (b) `keyStatusUnreadable` demotion dropped (`return is("healthy")`) on a byte backup: RED, 1 failed (`keyStatusUnreadable turns Healthy into the em dash`); restored, `cmp` identical.
gc-199-02-gates: vitest=green tsc=clean

SQL checks: none apply (pure TS plan); nothing left to CI beyond the normal frontend gates.

## Deviations from Plan

**1. [Process - TDD ordering] Task 1's first GREEN commit already contains every first-match arm.** The tracer was RED first (4 tests failed against an empty module), but I wrote the whole `strategyHealthOf` body in one pass rather than only the stale/healthy arms. So Task 2's "see each RED before the arm exists" was not observed arm by arm. Compensation: Task 2's tests were proven able to fail by the two plan-mandated neuters, which both went RED on the intended cases. The other arms (archived, key_problem, analytics_failed, updating, stale_no_data, 2-days-ahead and em dash cases) were not individually neutered. No behaviour differs from the plan.

Otherwise none: plan executed as written. freshness.ts and freshness.test.ts untouched (R-05).

## Accepted residual (R-05, flagged for the founder)

The factsheet freshness chip and `SyncBadge` still use the private 3d/7d ladder (`bucketSeriesAge`), which ignores asset class. A non-crypto strategy whose newest bar is 8 to 10 days old reads Healthy here and on the Discovery list but stale on its factsheet chip. This plan does not unify the two ladders.

## Notes for downstream plans

- `rowChipStatus` is hoisted here with a body identical to `StrategyTable.tsx`'s private copy, which was NOT deleted (plan 199-07 deletes it and imports this one).
- Callers must pass the row's `asset_class` as `assetClass` (plan 199-12).
- `strategyHealthOf` step 5 (`stale_no_data`) fires for any non-computed, non-running chip status, including an unrecognised value (consistent with `deriveEmptySeriesState`'s "empty").

## Known Stubs

None.

## Threat Flags

None: pure function over server-read rows, no new surface.

## Self-Check: PASSED

- FOUND: src/lib/strategy-health.ts, src/lib/strategy-health.test.ts
- FOUND commits 9b67a56ab, e647e8fb1 (ancestors of HEAD)
