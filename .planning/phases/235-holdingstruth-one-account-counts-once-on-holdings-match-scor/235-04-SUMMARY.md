---
phase: 235-holdingstruth-one-account-counts-once-on-holdings-match-scor
plan: 04
subsystem: my-allocation Overview and Holdings tab (HOLD-04 UI half)
tags: [holdings, degrade-registry, DegradeLine, scan-ledger, HOLD-04]
requires: ["235-03"]
provides:
  - "degrade registry entry allocation.holdings-unpriced-check-failed (read_failure, scope none, A-RELOAD)"
  - "Mount A: dashboard-holdings-unpriced-check-note on the Overview"
  - "Mount B: positions-holdings-unpriced-check-note under the Positions header"
affects:
  - src/lib/degrade-warnings.ts
  - src/lib/degrade-warnings.test.tsx
  - src/__tests__/degrade-warning-scan.test.ts
  - src/app/(dashboard)/allocations/AllocationDashboardV2.tsx
  - src/app/(dashboard)/allocations/HoldingsTabPanel.tsx
key-files:
  created:
    - src/app/(dashboard)/allocations/AllocationDashboardV2.unpriced-check.test.tsx
    - src/app/(dashboard)/allocations/HoldingsTabPanel.unpriced-check.test.tsx
  modified:
    - src/lib/degrade-warnings.ts
    - src/lib/degrade-warnings.test.tsx
    - src/__tests__/degrade-warning-scan.test.ts
    - src/app/(dashboard)/allocations/AllocationDashboardV2.tsx
    - src/app/(dashboard)/allocations/HoldingsTabPanel.tsx
decisions:
  - "The note renders only when holdingsUnpricedCheckFailed === true AND holdings rows exist; it is not gated on equityHistoryState (the glance Holdings group prints in both states)"
  - "Scenario tab is NOT mounted (plan assumption, still open to founder override)"
status: complete
actuals:
  tokens: 9000
  tasks: 2
  commits: 2
plan_head_before: a474e63dabc2c716d7a5573e3d7eb36a23aec851
plan_head_after: 03c6e4ff7918d15b4b14a7dfaa5ff330c328861c
commits: 2
---

# Phase 235 Plan 04: unpriced-check note on the Overview and the Holdings tab Summary

When plan 03's `holdingsUnpricedCheckFailed` is true and holdings rows exist, the Overview (under the missing-data message, before the departed-history note) and the Holdings tab (under the Positions header, before the first table) each show the registry sentence "We could not check whether each account's newest day could be priced in USD, so the holdings shown may include an account's positions from an earlier day. Reload this page to try again." through `DegradeLine`; nothing renders otherwise.

## Commits

- `fb9cb2123` Task 1 (tracer): registry entry, registry SAMPLES row and pin arm, Mount A, arms U1 to U6, scan-ledger `[DASHBOARD]` row moved.
- `03c6e4ff7` Task 2: Mount B, arms V1 to V4, new scan-ledger row for `HoldingsTabPanel.tsx`.

## Measured scan-ledger deltas (`degrade-warning-scan.test.ts`)

- `AllocationDashboardV2.tsx`: `tripHits` 7 to 8 (scan printed "8 warning-styling hits, ledger pins 7"); id `allocation.holdings-unpriced-check-failed` added in sorted position.
- `HoldingsTabPanel.tsx`: new row, `tripHits` 1 (scan printed "unledgered file has 1 warning-styling hits"), one id.

## Pre-fix RED lines (tests written first, no implementation)

Overview (`AllocationDashboardV2.unpriced-check.test.tsx`), first run:

```
     × U1: flag true with rows shows the verbatim sentence, as a status, with its id marker, visible at 390px 62ms
     × U2: renders while the history is rebuilding too, after the missing-data message 13ms
     × U3: precedes the departed-history note and moves no sibling note 9ms
     × U6: follows the polled payload (true, false, true) and is never latched in local state 22ms
TestingLibraryElementError: Unable to find an element by: [data-testid="dashboard-holdings-unpriced-check-note"]
 Test Files  1 failed (1)
      Tests  4 failed | 2 passed (6)
```

U4 and U5 are absence arms: they cannot be RED before the note exists. They are proven by neuters N3 and N4 below (see Deviations for the U4 vacuity found and fixed).

Holdings (`HoldingsTabPanel.unpriced-check.test.tsx`), first run:

```
     × V1: flag true with rows shows the verbatim sentence, as a status, with its id marker, visible at 390px 78ms
     × V2: follows the Allocation equity header and precedes the first table of the Positions section 16ms
TestingLibraryElementError: Unable to find an element by: [data-testid="positions-holdings-unpriced-check-note"]
 Test Files  1 failed (1)
      Tests  2 failed | 2 passed (4)
```

V3 and V4 are absence arms, proven by N9 and N10 below.

## PROOF-01 transcripts (verbatim; backups in the scratchpad `p235/plan-04/`, restored with `cp`, checked with silent `cmp`)

Exit 0 on the `cmp` line means byte-identical. The only edit to the transcripts is that the machine-local scratchpad directory prefix is written as `$SCRATCH` (public repo: no home paths in tracked text).

### Task 1 neuters N1 to N7 (N3 appears twice: first run was vacuous, see Deviations; the second run is the valid one)

```
=== N1 on src/app/(dashboard)/allocations/AllocationDashboardV2.tsx
$ cp src/app/(dashboard)/allocations/AllocationDashboardV2.tsx $SCRATCH/235-04-N1.bak
--- RED run (neuter N1):
     × U1: flag true with rows shows the verbatim sentence, as a status, with its id marker, visible at 390px 46ms
     × U2: renders while the history is rebuilding too, after the missing-data message 9ms
     × U3: precedes the departed-history note and moves no sibling note 8ms
     × U6: follows the polled payload (true, false, true) and is never latched in local state 9ms
 Test Files  1 failed (1)
      Tests  4 failed | 2 passed (6)
$ cp $SCRATCH/235-04-N1.bak src/app/(dashboard)/allocations/AllocationDashboardV2.tsx
$ cmp $SCRATCH/235-04-N1.bak src/app/(dashboard)/allocations/AllocationDashboardV2.tsx  -> exit 0 (silent)
--- GREEN run (restored):
 Test Files  1 passed (1)
      Tests  6 passed (6)
=== N2 on src/app/(dashboard)/allocations/AllocationDashboardV2.tsx
$ cp src/app/(dashboard)/allocations/AllocationDashboardV2.tsx $SCRATCH/235-04-N2.bak
--- RED run (neuter N2):
     × U2: renders while the history is rebuilding too, after the missing-data message 21ms
 Test Files  1 failed (1)
      Tests  1 failed | 5 passed (6)
$ cp $SCRATCH/235-04-N2.bak src/app/(dashboard)/allocations/AllocationDashboardV2.tsx
$ cmp $SCRATCH/235-04-N2.bak src/app/(dashboard)/allocations/AllocationDashboardV2.tsx  -> exit 0 (silent)
--- GREEN run (restored):
 Test Files  1 passed (1)
      Tests  6 passed (6)
=== N3 on src/app/(dashboard)/allocations/AllocationDashboardV2.tsx
$ cp src/app/(dashboard)/allocations/AllocationDashboardV2.tsx $SCRATCH/235-04-N3.bak
--- RED run (neuter N3):
 Test Files  1 passed (1)
      Tests  6 passed (6)
$ cp $SCRATCH/235-04-N3.bak src/app/(dashboard)/allocations/AllocationDashboardV2.tsx
$ cmp $SCRATCH/235-04-N3.bak src/app/(dashboard)/allocations/AllocationDashboardV2.tsx  -> exit 0 (silent)
--- GREEN run (restored):
 Test Files  1 passed (1)
      Tests  6 passed (6)
=== N4 on src/app/(dashboard)/allocations/AllocationDashboardV2.tsx
$ cp src/app/(dashboard)/allocations/AllocationDashboardV2.tsx $SCRATCH/235-04-N4.bak
--- RED run (neuter N4):
     × U5: flag false, and flag absent, show nothing and leave no id marker in the DOM 15ms
     × U6: follows the polled payload (true, false, true) and is never latched in local state 12ms
 Test Files  1 failed (1)
      Tests  2 failed | 4 passed (6)
$ cp $SCRATCH/235-04-N4.bak src/app/(dashboard)/allocations/AllocationDashboardV2.tsx
$ cmp $SCRATCH/235-04-N4.bak src/app/(dashboard)/allocations/AllocationDashboardV2.tsx  -> exit 0 (silent)
--- GREEN run (restored):
 Test Files  1 passed (1)
      Tests  6 passed (6)
=== N5 on src/app/(dashboard)/allocations/AllocationDashboardV2.tsx
$ cp src/app/(dashboard)/allocations/AllocationDashboardV2.tsx $SCRATCH/235-04-N5.bak
--- RED run (neuter N5):
     × U2: renders while the history is rebuilding too, after the missing-data message 10ms
 Test Files  1 failed (1)
      Tests  1 failed | 5 passed (6)
$ cp $SCRATCH/235-04-N5.bak src/app/(dashboard)/allocations/AllocationDashboardV2.tsx
$ cmp $SCRATCH/235-04-N5.bak src/app/(dashboard)/allocations/AllocationDashboardV2.tsx  -> exit 0 (silent)
--- GREEN run (restored):
 Test Files  1 passed (1)
      Tests  6 passed (6)
=== N6 on src/app/(dashboard)/allocations/AllocationDashboardV2.tsx
$ cp src/app/(dashboard)/allocations/AllocationDashboardV2.tsx $SCRATCH/235-04-N6.bak
--- RED run (neuter N6):
     × U3: precedes the departed-history note and moves no sibling note 10ms
 Test Files  1 failed (1)
      Tests  1 failed | 5 passed (6)
$ cp $SCRATCH/235-04-N6.bak src/app/(dashboard)/allocations/AllocationDashboardV2.tsx
$ cmp $SCRATCH/235-04-N6.bak src/app/(dashboard)/allocations/AllocationDashboardV2.tsx  -> exit 0 (silent)
--- GREEN run (restored):
 Test Files  1 passed (1)
      Tests  6 passed (6)
=== N7 on src/lib/degrade-warnings.ts
$ cp src/lib/degrade-warnings.ts $SCRATCH/235-04-N7.bak
--- RED run (neuter N7):
     × allocation.holdings-unpriced-check-failed is a read_failure that ends on A-RELOAD and never says the total (Phase 235 HOLD-04) 7ms
 Test Files  1 failed (1)
      Tests  1 failed | 81 passed (82)
$ cp $SCRATCH/235-04-N7.bak src/lib/degrade-warnings.ts
$ cmp $SCRATCH/235-04-N7.bak src/lib/degrade-warnings.ts  -> exit 0 (silent)
--- GREEN run (restored):
 Test Files  1 passed (1)
      Tests  82 passed (82)
=== N3 on src/app/(dashboard)/allocations/AllocationDashboardV2.tsx
$ cp src/app/(dashboard)/allocations/AllocationDashboardV2.tsx $SCRATCH/235-04-N3.bak
--- RED run (neuter N3):
     × U4: flag true with zero rows shows nothing (no earlier-day row can be shown) 10ms
 Test Files  1 failed (1)
      Tests  1 failed | 5 passed (6)
$ cp $SCRATCH/235-04-N3.bak src/app/(dashboard)/allocations/AllocationDashboardV2.tsx
$ cmp $SCRATCH/235-04-N3.bak src/app/(dashboard)/allocations/AllocationDashboardV2.tsx  -> exit 0 (silent)
--- GREEN run (restored):
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

### Task 2 neuters N8 to N11

```
=== N8 on src/app/(dashboard)/allocations/HoldingsTabPanel.tsx
$ cp src/app/(dashboard)/allocations/HoldingsTabPanel.tsx $SCRATCH/235-04-N8.bak
--- RED run (neuter N8):
     × V1: flag true with rows shows the verbatim sentence, as a status, with its id marker, visible at 390px 96ms
     × V2: follows the Allocation equity header and precedes the first table of the Positions section 20ms
 Test Files  1 failed (1)
      Tests  2 failed | 2 passed (4)
$ cp $SCRATCH/235-04-N8.bak src/app/(dashboard)/allocations/HoldingsTabPanel.tsx
$ cmp $SCRATCH/235-04-N8.bak src/app/(dashboard)/allocations/HoldingsTabPanel.tsx  -> exit 0 (silent)
--- GREEN run (restored):
 Test Files  1 passed (1)
      Tests  4 passed (4)
=== N9 on src/app/(dashboard)/allocations/HoldingsTabPanel.tsx
$ cp src/app/(dashboard)/allocations/HoldingsTabPanel.tsx $SCRATCH/235-04-N9.bak
--- RED run (neuter N9):
     × V3: flag true with zero rows shows nothing (no earlier-day row can be shown) 11ms
 Test Files  1 failed (1)
      Tests  1 failed | 3 passed (4)
$ cp $SCRATCH/235-04-N9.bak src/app/(dashboard)/allocations/HoldingsTabPanel.tsx
$ cmp $SCRATCH/235-04-N9.bak src/app/(dashboard)/allocations/HoldingsTabPanel.tsx  -> exit 0 (silent)
--- GREEN run (restored):
 Test Files  1 passed (1)
      Tests  4 passed (4)
=== N10 on src/app/(dashboard)/allocations/HoldingsTabPanel.tsx
$ cp src/app/(dashboard)/allocations/HoldingsTabPanel.tsx $SCRATCH/235-04-N10.bak
--- RED run (neuter N10):
     × V4: flag false, and flag absent, show nothing and leave no id marker in the DOM 16ms
 Test Files  1 failed (1)
      Tests  1 failed | 3 passed (4)
$ cp $SCRATCH/235-04-N10.bak src/app/(dashboard)/allocations/HoldingsTabPanel.tsx
$ cmp $SCRATCH/235-04-N10.bak src/app/(dashboard)/allocations/HoldingsTabPanel.tsx  -> exit 0 (silent)
--- GREEN run (restored):
 Test Files  1 passed (1)
      Tests  4 passed (4)
=== N11 on src/app/(dashboard)/allocations/HoldingsTabPanel.tsx
$ cp src/app/(dashboard)/allocations/HoldingsTabPanel.tsx $SCRATCH/235-04-N11.bak
--- RED run (neuter N11):
     × V2: follows the Allocation equity header and precedes the first table of the Positions section 18ms
 Test Files  1 failed (1)
      Tests  1 failed | 3 passed (4)
$ cp $SCRATCH/235-04-N11.bak src/app/(dashboard)/allocations/HoldingsTabPanel.tsx
$ cmp $SCRATCH/235-04-N11.bak src/app/(dashboard)/allocations/HoldingsTabPanel.tsx  -> exit 0 (silent)
--- GREEN run (restored):
 Test Files  1 passed (1)
      Tests  4 passed (4)
```

## Wave checks (final state, both tasks committed)

- `npx vitest run` over the two render files `HoldingsTabPanel.unpriced-check`, `HoldingsTabPanel.positions-header`, `HoldingsTabPanel.exposure-agreement`, `AllocationDashboardV2.unpriced-check`, `degrade-warnings.test.tsx`, `degrade-warning-scan.test.ts`, `copy-census.test.ts`, `computed-at-reader-census.test.ts`, `holding-scope-key-census.test.ts`: `Test Files 9 passed (9)`, `Tests 233 passed (233)`.
- Task 1's six-file command (unpriced-check, departed-history, warmup, degrade-warnings, scan, copy-census): `Test Files 6 passed (6)`, `Tests 145 passed (145)`, run before the U4 hardening and re-run in the 9-file set above after it.
- `npm run typecheck`: no output, exit 0.
- `npx eslint` over the seven files: exit 0.
- Acceptance greps: `allocation.holdings-unpriced-check-failed` in `degrade-warnings.ts` 1; `positions-holdings-unpriced-check-note` in `HoldingsTabPanel.tsx` 1; `role="status"` in `HoldingsTabPanel.tsx` 1; `dashboard-holdings-unpriced-check-note` in `AllocationDashboardV2.tsx` 1.

## Scenario-tab assumption (restated, open to founder override)

The note is NOT mounted on the Scenario tab (UI-SPEC 1.3, CD-2). Scenario seeds its draft weights from the same rows but prints no holdings dollar figure; its live strip reads `liveBaselineMetrics`, not the rows; and the scenario commit already reports the same condition to Sentry. "Scenario shows no unpriced-check note" is an accepted assumption, not a proven edge. Adding it later is the same entry and the same `<p>` plus a third ledger move.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug in own test] U4 passed vacuously**
- **Found during:** Task 1 neuter N3 (dropping the rows clause stayed GREEN, first N3 transcript).
- **Issue:** with `holdingsSummary: []` and no `hasConnectedKeys`, the Overview returns the connect-a-key card early (`historyGate` returns `no_eligible_key`), so the note could never render and U4 could not fail.
- **Fix:** U4 now passes `hasConnectedKeys` and asserts the glance (`glance-book-equity`) rendered before asserting the note is absent. N3 was re-run and is RED on U4 (second N3 transcript). V3 got the same guard from the start (asserts `section#positions` rendered).
- **Files modified:** `AllocationDashboardV2.unpriced-check.test.tsx`
- **Commit:** `fb9cb2123`

Otherwise, none: the plan was executed as written. No Known Stubs, no new network surface (static registry text, server boolean only).

## Threat Flags

None.

## Self-Check: PASSED

- Files exist: both new test files, SUMMARY.
- Commits `fb9cb2123` and `03c6e4ff7` are ancestors of HEAD; `git rev-list --count` from the recorded base is 2.
