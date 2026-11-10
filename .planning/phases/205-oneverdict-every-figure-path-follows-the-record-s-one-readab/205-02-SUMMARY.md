---
phase: 205-oneverdict-every-figure-path-follows-the-record-s-one-readab
plan: 02
subsystem: factsheet
tags: [figure-record, stress-windows, usd-view, parity]
requires: ["205-01"]
provides:
  - deriveSeriesBundle stress predicate on the record verdict
affects: [205-03]
tech-stack:
  added: []
  patterns: [one verdict decides every figure path, never a per-bundle date test]
key-files:
  created: []
  modified:
    - src/lib/factsheet/build-payload.ts
    - src/app/factsheet/[id]/v2/StressWindowsPanel.unreadable.test.tsx
    - src/__tests__/figure-parity-pages.test.tsx
decisions:
  - "D-02: rule lives in deriveSeriesBundle on args.figureRecord?.unreadable === true; one edit covers the cash, MTM and smoothed bundles and the browser leverage re-derive"
  - "The dates[0] test stays only as throw-avoidance for computeStressWindows when the record is unknown (null)"
metrics:
  duration: ~20m
  completed: 2026-11-10
status: complete
requirements: [194.2-R3-WR-02]
actuals:
  tokens: 6500
  tasks: 2
  commits: 2
plan_head_before: 51039e3f5
plan_head_after: 3811eaa74
---

# Phase 205 Plan 02: the stress block follows the record verdict Summary

`deriveSeriesBundle` now withholds `stressWindows` (the existing `unreadable: true`, no windows form) whenever `args.figureRecord?.unreadable === true`, so an unreadable record shows the same withheld stress line on the native view, the USD view and a levered re-derive, wherever the bad date sits. This closes 194.2-REVIEW-R3 WR-02.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 | 2f27aa7e9 | fix(205): the stress block follows the record verdict (D-02) |
| 2 | 3811eaa74 | test(205): native and USD stress views agree on an unreadable record (D-02) |

(`plan_head_before` is the plan 01 docs commit `51039e3f5`; the ledger was not written by plan 01's runner for this plan, so the base is the HEAD at this plan's start. `git rev-list --count 51039e3f5..HEAD` = 2 at the second task commit.)

## What changed

- `build-payload.ts`: the `stressWindows:` condition in `deriveSeriesBundle` is `args.figureRecord?.unreadable === true || (dates.length > 0 && !isReadableDay(dates[0]))`, withheld literal unchanged; the comment above it gained a `205 D-02` paragraph.
- `StressWindowsPanel.unreadable.test.tsx`: 300 readable days factored into `readableDays()` and a shared `STRATEGY` (existing cases' inputs unchanged); new describe `205 D-02` with three cases: interior `2024-06-31` (element 180, the 2024-06-30 slot) payload plus the rendered panel sentence; a direct `deriveSeriesBundle` call with an unreadable record (and a readable-record control); MTM series with an interior `x`-suffixed date, asserting the `mark_to_market` and `smoothed_mtm` bundles.
- `figure-parity-pages.test.tsx`: the plan 01 curve helpers (`CURVE_N`, `CURVE_START`, `curve2024`, `closes2024`, `btcNativeAnalytics`) moved to file scope unchanged; new describe `205 D-02 parity` with an `it.each` over a bad second curve date (`2024-02-30` at element 1 of a 300-point curve from 2024-02-28) and a bad interior date (`2024-06-31` at element 123, the 2024-06-30 slot), through `fetchAndBuildPayload`, asserting the withheld stress form on native and USD.

## RED at HEAD (before the source edit)

`npx vitest run "src/app/factsheet/[id]/v2/StressWindowsPanel.unreadable.test.tsx"`: `Tests 3 failed | 5 passed (8)`; all three `205 D-02` cases failed with `AssertionError: expected undefined to be true` (interior payload `stressWindows.unreadable`, direct call with the unreadable record, MTM bundle `stressWindows.unreadable`).

## Neuter evidence (D-04)

Byte backups in the scratchpad `205-02/` directory; restored by `cp`, verified by `cmp` (exit 0); never git checkout, restore or stash. After each restore the gate re-ran green.

gc-205-02-neuter: mutation=verdict_dropped scope=panel_file result=red restored=identical
- Removed `args.figureRecord?.unreadable === true ||` from the condition. RED lines: `× an interior unreadable date withholds the stress windows and the panel says so`, `× the leverage re-derive withholds on the record verdict and computes on a readable record (control)`, `× a bad date on the MTM series withholds the stress block on the MTM and smoothed bundles too` (`Tests 3 failed | 5 passed (8)`). cmp=0; 8/8 green after.

gc-205-02-neuter: mutation=verdict_dropped scope=parity_file result=red restored=identical
- Same mutation, parity file. RED: `× a bad second curve date withholds the stress windows on the native AND the USD view` (fails at the USD `stressWindows.unreadable` assertion, `figure-parity-pages.test.tsx:1317`) and `× a bad interior curve date ...` (fails at the native `stressWindows.unreadable` assertion, `:1314`); `Tests 2 failed | 60 passed (62)`. cmp=0; parity plus panel files 70/70 green after, and `git diff --stat` on `build-payload.ts` empty (restored equals the committed bytes).

## Verification (exact commands, counts)

- `npx vitest run "src/app/factsheet/[id]/v2/StressWindowsPanel.unreadable.test.tsx" src/lib/factsheet/build-payload.test.ts src/lib/factsheet/figure-record-unreadable.test.ts "src/app/factsheet/[id]/v2/basis-context.figure-record.test.tsx" "src/app/factsheet/[id]/v2/basis-context.leverage.test.tsx"` (after Task 1): 5 files, 71 passed, 0 failed.
- `npx vitest run src/__tests__/figure-parity-pages.test.tsx` (after Task 2): 1 file, 62 passed, 0 failed.
- `npx vitest run src/__tests__/figure-parity-pages.test.tsx "src/app/factsheet/[id]/v2/StressWindowsPanel.unreadable.test.tsx"`: 2 files, 70 passed, 0 failed.
- `npx tsc --noEmit`: clean.
- Readable-record payload snapshot unmoved: no `-u`; `git diff --stat -- src/lib/factsheet/__snapshots__` empty.
- Plan scope, `npx vitest run src/lib/factsheet "src/app/factsheet" "src/app/(dashboard)/allocations" src/__tests__/figure-parity-pages.test.tsx`: `Test Files 1 failed | 380 passed (381)`, `Tests 2 failed | 6662 passed (6664)`.

gc-205-02-scope: failed=2 files=compute.conventions.test.ts-only

The two failures are `compute.conventions.test.ts` fixture B (zero-return days) and fixture C (interior calendar gaps), the known pre-existing failures at base; not touched, not new.

## Deviations from Plan

None to the rules. Notes: (1) the interior parity case puts `2024-06-31` at element 123 (the 2024-06-30 slot of the 2024-02-28 curve) rather than the RESEARCH probe's element 100, so the date sits in sorted position and only the date is bad; (2) with the predicate neutered the interior parity case fails at the native assertion and the `2024-02-30` case at the USD assertion, together covering both views.

## Side effect to state in the ship CHANGELOG (RESEARCH A2, accepted by D-02)

A record unreadable only through an unreadable `headlineSince` or `seriesEnd` now also withholds its stress windows; the panel sentence stays true. This plan does not edit the CHANGELOG.

## Known Stubs

None.

## Threat Flags

None. T-205-04 mitigated and gated (interior, direct-call, MTM/smoothed and USD parity cases, each with a RED neuter); T-205-05 mitigated (the `dates[0]` guard stays for a `null` record).

## Self-Check: PASSED

- FOUND: src/lib/factsheet/build-payload.ts, src/app/factsheet/[id]/v2/StressWindowsPanel.unreadable.test.tsx, src/__tests__/figure-parity-pages.test.tsx
- FOUND commits 2f27aa7e9 and 3811eaa74 (ancestors of HEAD)
- STATE.md, ROADMAP.md and state.json not modified.
