---
phase: 201-plainwords-one-name-per-concept-explained-and-the-small-inco
plan: 03
subsystem: ui-formatting
tags: [dates, utc, formatDay, CLAR-06]
requires: []
provides:
  - "formatDay, formatMonth, formatDayTime, MONTH_ABBR in src/lib/utils.ts"
affects: [201-06, 201-08, 201-23]
tech-stack:
  added: []
  patterns: ["UTC-getter-only date helpers, em dash on null/empty/unparseable"]
key-files:
  created: []
  modified:
    - src/lib/utils.ts
    - src/lib/utils.test.ts
decisions:
  - "formatAbsoluteDate and formatIsoDay kept and marked @deprecated; plan 201-23 deletes them"
status: complete
commits: 2
plan_head_before: 8dbc36a02
plan_head_after: 03c07f7604e0824d3c6f0aecada0e92827142018
actuals:
  tokens: 6000
  tasks: 2
  commits: 2
completed: 2026-11-11
---

# Phase 201 Plan 03: One date helper Summary

`formatDay` (`Oct 9, 2026`), `formatMonth` (`Oct 2026`), `formatDayTime` (`Oct 9, 2026, 14:05 UTC`) and a single exported `MONTH_ABBR`, all UTC-getter-only with an em dash for null, undefined, empty and unparseable input; `formatRelativeTime` now falls back to `formatDay` past 30 days.

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 (tracer) | formatDay + MONTH_ABBR, arms first (RED: 6 failed, then green) | df48207f9 |
| 2 | formatMonth, formatDayTime, relative-time fallback, deprecations | 03c07f760 |

## Files

Modified: `src/lib/utils.ts`, `src/lib/utils.test.ts`.

No other `formatRelativeTime` test pinned the yearless form. `src/components/mandate/formatRelativeTime.test.ts` tests a different function (the mandate-local `formatRelativeTime` in `src/components/mandate/formatRelativeTime.ts`, which prints `YYYY-MM-DD` and is not the one changed here). `MandateSaveStatus.test.tsx`, `NoteSaveStatus.test.tsx` and `EquityChart.test.tsx` were run unchanged and are green (152 tests across the five files). The only arm that changed is the `utils.test.ts` past-30-days one, now pinned to `formatDay` and to the literal `Feb 25, 2026`.

## Neuter proof (T-201-05)

Backup: `cp -p src/lib/utils.ts <scratchpad>/201-03/utils.ts.bak`. Neuter: `formatDay` switched to the local getters (`getMonth`, `getDate`, `getFullYear`). Command: `TZ=America/New_York npx vitest run src/lib/utils.test.ts`.

RED, 4 failed, the cause named in each:
- `formatDay > prints a bare date as Oct 9, 2026`: `expected 'Oct 8, 2026' to be 'Oct 9, 2026'`
- `formatDay > handles a year boundary`: `expected 'Dec 31, 2025' to be 'Jan 1, 2026'`
- `formatDay > prints Sep, not Sept, with an unpadded day`: `expected 'Sep 2, 2026' to be 'Sep 3, 2026'`
- `formatDayTime > zero-pads hours and minutes`: `expected 'Oct 8, 2026, 03:07 UTC' to be 'Oct 9, 2026, 03:07 UTC'`

Restored with `cp -p`, `cmp` exit 0, then GREEN (84 passed, under both the default TZ and `TZ=America/New_York`).

Observation, recorded rather than hidden: the offset arm the plan named (`2026-10-09T23:30:00-05:00`) does NOT go red under `America/New_York`, because that instant (04:30 UTC on the 10th) is 00:30 EDT on the 10th, the same calendar day as UTC. The bare-date, year-boundary and day-time arms are the ones that catch the local-time defect under that TZ. The offset arm still guards the `slice(0, 10)` defect.

gc-201-03-neuter: gate=src/lib/utils.test.ts result=red restored=identical

gc-201-03-gates: vitest=green eslint=clean tsc=clean

## Deviations from Plan

None - plan executed as written. The per-plan commit-ledger file (protocol 0c) was not created; `plan_head_before` is the worktree's fork point, and `git rev-list --count 8dbc36a02..HEAD` printed 2 at the last task commit (the SUMMARY commit follows).

## Known Stubs

None.

## Threat Flags

None.

## Self-Check: PASSED

- `grep -a -c "export function formatDay" src/lib/utils.ts` = 1; `export const MONTH_ABBR` = 1; `formatMonth` = 1; `formatDayTime` = 1; `@deprecated` = 2.
- Commits df48207f9 and 03c07f760 are on `wt/201-p03`.
