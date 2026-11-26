---
phase: 239-surfacecache-the-composer-range-and-the-discovery-ranking-re
plan: 02
subsystem: ui
tags: [react, factsheet, composer, dates, vitest]
requires:
  - phase: 239-01
    provides: "StoredRange, resolveStoredRange, the date-holding store and useXRange"
provides:
  - "subtractMonths(day, months) in src/lib/dateday.ts (UTC, clamps to month end)"
  - "The preset member of StoredRange and its rolling branch in resolveStoredRange"
  - "setPresetRange(months) on useXRange"
  - "PeriodControl 3M/6M/12M as rolling calendar-month presets (PERIOD_MONTHS)"
affects: []
actuals:
  tasks: 2
  commits: 2
tech-stack:
  added: []
  patterns:
    - "A preset is stored as intent (month count) and resolved per render, so it rolls with the data"
key-files:
  created:
    - src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.period-presets.test.tsx
  modified:
    - src/lib/dateday.ts
    - src/lib/dateday.test.ts
    - src/app/factsheet/[id]/v2/range-dates.ts
    - src/app/factsheet/[id]/v2/range-dates.test.ts
    - src/app/factsheet/[id]/v2/factsheet-context.tsx
    - src/app/factsheet/[id]/v2/factsheet-context.provider.test.tsx
    - src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.tsx
    - src/app/(dashboard)/allocations/widgets/performance/scenario-shared-window.test.tsx
key-decisions:
  - "Month-end rule: subtracting N months clamps to the last day of the target month in UTC, and the boundary is inclusive (the plan's pick)"
  - "setPresetRange writes eagerly (not in startTransition), like resetXRange"
  - "The composer preset arms carry a 20 s per-test timeout, as other full-body factsheet tests do"
requirements-completed: [CACHE-02]
coverage:
  - id: D1
    description: "Composer 3M/6M/12M select the last N calendar months ending on the latest day"
    requirement: CACHE-02
    verification:
      - kind: unit
        ref: "src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.period-presets.test.tsx#12M is the last 12 calendar months ending on the latest day"
        status: pass
    human_judgment: false
  - id: D2
    description: "An active preset rolls to a new latest day and still ends on the latest day after front growth; a short series shows Full history"
    requirement: CACHE-02
    verification:
      - kind: unit
        ref: "src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.period-presets.test.tsx"
        status: pass
      - kind: unit
        ref: "src/app/factsheet/[id]/v2/factsheet-context.provider.test.tsx"
        status: pass
    human_judgment: false
  - id: D3
    description: "subtractMonths month-end rule and the preset resolver"
    requirement: CACHE-02
    verification:
      - kind: unit
        ref: "src/lib/dateday.test.ts#subtractMonths"
        status: pass
      - kind: unit
        ref: "src/app/factsheet/[id]/v2/range-dates.test.ts#resolveStoredRange — a preset rolls with the latest day"
        status: pass
    human_judgment: false
duration: 45min
completed: 2026-11-24
status: complete
---

# Phase 239 Plan 02: composer presets are rolling calendar months Summary

**The composer's 3M/6M/12M now select the last 3/6/12 calendar months ending on the latest day. They are held as a preset the provider resolves on every render, so they roll when a newer day arrives and keep ending on the latest day when earlier days arrive (founder Q4 "Presets roll, manual stays", Q5 "12 calendar months").**

## Performance

- **Duration:** about 45 min
- **Tasks:** 2
- **Files:** 1 created, 8 modified

## Accomplishments

- `subtractMonths(day, months)` in `dateday.ts`: UTC arithmetic that clamps to the target month's last day; `null` for an invalid day or a month count that is not a non-negative integer. No date library was added.
- `range-dates.ts`: the `{ kind: "preset"; months }` member and the preset branch, which runs from `lowerBound(subtractMonths(latest, N))` to the last index. A series shorter than N months gives `[0, last]`; a non-ISO latest day gives `fullRange`.
- `factsheet-context.tsx`: `setPresetRange(months)` on `useXRange` (additive, eager, stable identity). A later `setXRange` or `resetXRange` replaces the preset.
- `ScenarioFactsheetChart.tsx`: `PERIOD_MONTHS` (3/6/12) replaces the trading-day record. `PeriodControl` calls `setPresetRange`; ALL and `axisLength <= 1` still call `resetXRange`. Both docblocks were rewritten. The returned JSX, classes, labels and ARIA are byte-identical. The parity-guard literals stay. `ScenarioComposer.tsx` is untouched.
- `scenario-shared-window.test.tsx`: only the comment above the 3M click changed; no assertion changed.

## Task Commits

1. **Task 1: subtractMonths, preset branch, setPresetRange, PeriodControl, composer test**: `9061020a6` (feat)
2. **Task 2: month-end, resolver and provider preset arms, neuters, gates**: `5f56bf7ec` (test)

## PROOF-01 evidence (verbatim; paths rewritten to repo-relative or `$SCRATCH/...`)

### Composer arms on the code as plan 01 left it (Task 1 RED, before any production change)

The 12M window and roll arms fail on both edges. The front-growth arm fails on its start only, because plan 01 already keeps a manual range's dates on front growth.

```
     × 12M is the last 12 calendar months ending on the latest day 435ms
     × 12M preset rolls to the new latest day on back growth 580ms
     × 12M preset still ends on the latest day after front growth 601ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |jsdom| src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.period-presets.test.tsx > ScenarioFactsheetChart — presets are calendar months ending on the latest day (CACHE-02) > 12M is the last 12 calendar months ending on the latest day
AssertionError: expected 'Sep 4, 2024 – May 14, 2025' to be 'May 14, 2024 – May 14, 2025' // Object.is equality
 FAIL  |jsdom| src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.period-presets.test.tsx > ScenarioFactsheetChart — presets are calendar months ending on the latest day (CACHE-02) > 12M preset rolls to the new latest day on back growth
AssertionError: expected 'Sep 4, 2024 – May 14, 2025' to be 'Jun 13, 2024 – Jun 13, 2025' // Object.is equality
 FAIL  |jsdom| src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.period-presets.test.tsx > ScenarioFactsheetChart — presets are calendar months ending on the latest day (CACHE-02) > 12M preset still ends on the latest day after front growth
AssertionError: expected 'Sep 4, 2024 – May 14, 2025' to be 'May 14, 2024 – May 14, 2025' // Object.is equality
 Test Files  1 failed (1)
      Tests  3 failed | 3 passed (6)
```

### Composer arms after the fix (Task 1 GREEN)

```
 ✓ |jsdom| src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.period-presets.test.tsx > ScenarioFactsheetChart — presets are calendar months ending on the latest day (CACHE-02) > 12M is the last 12 calendar months ending on the latest day 493ms
 ✓ |jsdom| src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.period-presets.test.tsx > ScenarioFactsheetChart — presets are calendar months ending on the latest day (CACHE-02) > 12M preset rolls to the new latest day on back growth 793ms
 ✓ |jsdom| src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.period-presets.test.tsx > ScenarioFactsheetChart — presets are calendar months ending on the latest day (CACHE-02) > 12M preset still ends on the latest day after front growth 722ms
 ✓ |jsdom| src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.period-presets.test.tsx > ScenarioFactsheetChart — presets are calendar months ending on the latest day (CACHE-02) > a preset on a short series is Full history 136ms
 ✓ |jsdom| src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.period-presets.test.tsx > ScenarioFactsheetChart — presets are calendar months ending on the latest day (CACHE-02) > every period tab stays aria-selected false 635ms
 ✓ |jsdom| src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.period-presets.test.tsx > ScenarioFactsheetChart — presets are calendar months ending on the latest day (CACHE-02) > a one-point series ignores a preset 32ms
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

The one-point arm ("a one-point series ignores a preset") is a smoke arm, not a PROOF-01 gate: on a one-point axis every window equals the full range, so no neuter can make it observable. The short-series composer arm already passed on pre-fix code (a 252-point window over 200 points also clamps to the full range); its gate is the preset-end neuter below.

Each neuter below used `$SCRATCH/neuter.sh`. It copies the source file to `$SCRATCH/bak/<name>.orig`, applies the neuter, runs RED, copies the backup back, runs `cmp` (exit printed), then runs GREEN. No git checkout, restore or stash was used.

- **p-monthend**: `subtractMonths` used overflowing `setUTCMonth` arithmetic instead of the clamp.
- **p-presetend**: the preset branch ended one index before the last. It was run over every arm the plan lists for it, including the four extra arms.
- **p-manual**: `selectPeriod` computed an index window at click time (`N * 365 / 12` points) and called `setXRange`.
- **p-aria**: the tab's `aria-selected` was set to `true`.
- **p-stickypreset**: `setXRange` kept a stored preset and dropped the manual write.
- **p-stickyreset**: `resetXRange` kept a stored preset.

### Neuter: p-monthend

```
### NEUTER p-monthend (src/lib/dateday.ts)
--- RED
     × 31 Mar - 1M is 28 Feb 22ms
     × 29 Feb 2024 - 12M is 28 Feb 2023 2ms
     × clamps other month ends and keeps a day every month has 1ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |jsdom| src/lib/dateday.test.ts > subtractMonths — calendar months in UTC, clamped to month end > 31 Mar - 1M is 28 Feb
AssertionError: expected '2025-03-03' to be '2025-02-28' // Object.is equality
 FAIL  |jsdom| src/lib/dateday.test.ts > subtractMonths — calendar months in UTC, clamped to month end > 29 Feb 2024 - 12M is 28 Feb 2023
AssertionError: expected '2023-03-01' to be '2023-02-28' // Object.is equality
 FAIL  |jsdom| src/lib/dateday.test.ts > subtractMonths — calendar months in UTC, clamped to month end > clamps other month ends and keeps a day every month has
AssertionError: expected '2026-03-03' to be '2026-02-28' // Object.is equality
 Test Files  1 failed (1)
      Tests  3 failed | 1 passed | 30 skipped (34)
cmp exit: 0
--- GREEN
 Test Files  1 passed (1)
      Tests  4 passed | 30 skipped (34)
```

### Neuter: p-presetend

```
### NEUTER p-presetend (src/app/factsheet/[id]/v2/range-dates.ts)
--- RED
     × a preset ends on the latest axis day 14ms
     × 12M preset still ends on the latest day after front growth 256ms
     × 12M preset rolls to the new latest day on back growth 165ms
     × a 12M preset on a short series is the full range 77ms
     × a short-series preset start moves earlier on front growth 149ms
     × 12M is the last 12 calendar months ending on the latest day 788ms
     × 12M preset rolls to the new latest day on back growth 1074ms
     × 12M preset still ends on the latest day after front growth 1320ms
     × a preset on a short series is Full history 685ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 9 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |jsdom| src/app/factsheet/[id]/v2/factsheet-context.provider.test.tsx > FactsheetProvider — xRange follows the full range until the user sets one (D-07) > 12M preset still ends on the latest day after front growth
AssertionError: expected '2024-05-14..2025-05-13' to be '2024-05-14..2025-05-14' // Object.is equality
 FAIL  |jsdom| src/app/factsheet/[id]/v2/factsheet-context.provider.test.tsx > FactsheetProvider — xRange follows the full range until the user sets one (D-07) > 12M preset rolls to the new latest day on back growth
AssertionError: expected '2024-06-13..2025-06-12' to be '2024-06-13..2025-06-13' // Object.is equality
 FAIL  |jsdom| src/app/factsheet/[id]/v2/factsheet-context.provider.test.tsx > FactsheetProvider — xRange follows the full range until the user sets one (D-07) > a 12M preset on a short series is the full range
AssertionError: expected '0-198' to be '0-199' // Object.is equality
 FAIL  |jsdom| src/app/factsheet/[id]/v2/factsheet-context.provider.test.tsx > FactsheetProvider — xRange follows the full range until the user sets one (D-07) > a short-series preset start moves earlier on front growth
AssertionError: expected '2023-07-18..2024-07-17' to be '2023-07-18..2024-07-18' // Object.is equality
 FAIL  |jsdom| src/app/factsheet/[id]/v2/range-dates.test.ts > resolveStoredRange — a preset rolls with the latest day > a preset ends on the latest axis day
AssertionError: expected [ 134, 498 ] to deeply equal [ 134, 499 ]
 FAIL  |jsdom| src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.period-presets.test.tsx > ScenarioFactsheetChart — presets are calendar months ending on the latest day (CACHE-02) > 12M is the last 12 calendar months ending on the latest day
AssertionError: expected 'May 14, 2024 – May 13, 2025' to be 'May 14, 2024 – May 14, 2025' // Object.is equality
 FAIL  |jsdom| src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.period-presets.test.tsx > ScenarioFactsheetChart — presets are calendar months ending on the latest day (CACHE-02) > 12M preset rolls to the new latest day on back growth
AssertionError: expected 'Jun 13, 2024 – Jun 12, 2025' to be 'Jun 13, 2024 – Jun 13, 2025' // Object.is equality
 FAIL  |jsdom| src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.period-presets.test.tsx > ScenarioFactsheetChart — presets are calendar months ending on the latest day (CACHE-02) > 12M preset still ends on the latest day after front growth
AssertionError: expected 'May 14, 2024 – May 13, 2025' to be 'May 14, 2024 – May 14, 2025' // Object.is equality
 FAIL  |jsdom| src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.period-presets.test.tsx > ScenarioFactsheetChart — presets are calendar months ending on the latest day (CACHE-02) > a preset on a short series is Full history
AssertionError: expected 'Selected range: Jan 1, 2024 – Jul 17,…' to match /^Full history/
 Test Files  3 failed (3)
      Tests  9 failed | 37 skipped (46)
cmp exit: 0
--- GREEN
 Test Files  3 passed (3)
      Tests  9 passed | 37 skipped (46)
```

### Neuter: p-manual

```
### NEUTER p-manual (src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.tsx)
--- RED
     × 12M preset rolls to the new latest day on back growth 1258ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |jsdom| src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.period-presets.test.tsx > ScenarioFactsheetChart — presets are calendar months ending on the latest day (CACHE-02) > 12M preset rolls to the new latest day on back growth
AssertionError: expected 'May 14, 2024 – May 14, 2025' to be 'Jun 13, 2024 – Jun 13, 2025' // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed | 5 skipped (6)
cmp exit: 0
--- GREEN
 Test Files  1 passed (1)
      Tests  1 passed | 5 skipped (6)
```

### Neuter: p-aria

```
### NEUTER p-aria (src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.tsx)
--- RED
     × every period tab stays aria-selected false 416ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |jsdom| src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.period-presets.test.tsx > ScenarioFactsheetChart — presets are calendar months ending on the latest day (CACHE-02) > every period tab stays aria-selected false
AssertionError: expected 'true' to be 'false' // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed | 5 skipped (6)
cmp exit: 0
--- GREEN
 Test Files  1 passed (1)
      Tests  1 passed | 5 skipped (6)
```

### Neuter: p-stickypreset

```
### NEUTER p-stickypreset (src/app/factsheet/[id]/v2/factsheet-context.tsx)
--- RED
     × a manual range set after a preset keeps its dates 163ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |jsdom| src/app/factsheet/[id]/v2/factsheet-context.provider.test.tsx > FactsheetProvider — xRange follows the full range until the user sets one (D-07) > a manual range set after a preset keeps its dates
AssertionError: expected '2024-05-14..2025-05-14' to be '2024-01-11..2024-02-10' // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed | 25 skipped (26)
cmp exit: 0
--- GREEN
 Test Files  1 passed (1)
      Tests  1 passed | 25 skipped (26)
```

### Neuter: p-stickyreset

```
### NEUTER p-stickyreset (src/app/factsheet/[id]/v2/factsheet-context.tsx)
--- RED
     × reset after a preset returns the full range 106ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |jsdom| src/app/factsheet/[id]/v2/factsheet-context.provider.test.tsx > FactsheetProvider — xRange follows the full range until the user sets one (D-07) > reset after a preset returns the full range
AssertionError: expected '134-499' to be '0-499' // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed | 25 skipped (26)
cmp exit: 0
--- GREEN
 Test Files  1 passed (1)
      Tests  1 passed | 25 skipped (26)
```

## Verification

- Touched suites (`dateday`, `range-dates`, `factsheet-context.provider`, the whole composer `widgets/performance` directory): 26 files, 333 tests passed.
- Consumer sweep (every test file naming `xRange|setXRange|useXRange`, plus every `basis-context*` file): the first run under a host load average of about 130 (other agents' test runs) gave 7 failed files with 23 failed tests, every one a `Test timed out in 5000ms`. Re-running those 7 files at load about 81: 2 still timed out. With `--testTimeout=60000`, the 7 files passed 369/369 (`basis-context.window-arithmetic`, `basis-context.window-density`, `FactsheetBody.flat-leg`, `FactsheetView.headline-coverage`, `FactsheetView.window-kpis`, `MetricsColumn.figure-gate`, `MetricsColumn.withheld-panels`). No assertion failed in any run.
- Guards (`trim-removed-surfaces`, `phase-52-frozen-spine-guards`, `seam-log-coverage`, `critical-regressions`, every `src/lib/*invariant*` test, the `.planning`-reading tests): the default run had 5 timeouts under the same load. With `--testTimeout=120000`, all 31 files passed 1145/1145.
- `npm run typecheck`: exit 0. `npm run lint`: 0 errors, 4 pre-existing warnings, and every lint-chain check OK.
- Acceptance greps: `subtractMonths` appears 13 times in `dateday.test.ts`, `setPresetRange` twice in the provider test, and `trading days` 0 times in `scenario-shared-window.test.tsx`. In `ScenarioFactsheetChart.tsx`: `PERIOD_MONTHS` 2, `PERIOD_TRADING_DAYS` 0, `trading days` 0, `setPresetRange(` 1. `setPresetRange` appears 4 times in `factsheet-context.tsx`.

## Deviations from Plan

1. **[Rule 3 - Blocking] Composer arms carry a 20 s per-test timeout.** Found during Task 2. Alone, an arm takes under 1 s. One arm hit vitest's 5 s default during a parallel 26-file run under heavy host load. Fix: a `BODY_RENDER_TIMEOUT = 20_000` constant on each arm, matching `FactsheetView.terms.test.tsx`. Files: `ScenarioFactsheetChart.period-presets.test.tsx`. Commit `5f56bf7ec`.
2. **[Rule 1 - Neuter fidelity] Sticky-preset neuter rewritten.** The first form (an early `if (stored?.kind === "preset") return;` in `setXRange`) stayed GREEN. The memoised `setXRange` does not capture `stored`, so that guard never saw the preset; the test was not the cause. The neuter was rewritten to read the current stored range through a functional state update (keep a stored preset, drop the manual write), which is the plan's "make setXRange do nothing while the stored range is a preset". That form went RED (above). Production code is unchanged.

**Total deviations:** 2 (1 test-timeout fix, 1 neuter rewrite). **Impact:** none on production behaviour.

## Issues Encountered

- Host load average reached about 137 during the gate runs (parallel agents), which caused 5 s timeouts in unrelated full-body factsheet tests. They pass with a longer timeout; see Verification.

## Next Phase Readiness

Phase 239 plans are complete.
