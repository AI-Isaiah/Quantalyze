---
phase: 236-figuremath-every-engine-annualizes-one-way-cvar-is-historica
plan: 07
subsystem: ts-cvar-floor
tags: [cvar, cvar-min-obs, total-record, census, moved-pins, factsheet, scenario, widget]
requires: [236-03, 236-05]
provides:
  - "buildFactsheetPayload nulls cvar95 where `overlaid` is built when the TOTAL record has fewer than CVAR_MIN_OBS = 60 observations, so the strategy factsheet and the allocator-portfolio payload both inherit it, from the stored row or the computed fallback"
  - "the book's ES95 widget shows the dash below 60 returns while VaR still shows; the n<10 insufficient state is kept"
  - "the Scenario blend CVaR is null below 60 observations of the blend's whole common series (A6)"
  - "src/__tests__/cvar-reader-census.test.ts: every TS CVaR reader classified, exact-set in both directions"
affects: [236-08, 236-09, 236-11]
key-files:
  created:
    - src/lib/factsheet/cvar-floor.test.ts
    - src/__tests__/cvar-reader-census.test.ts
  modified:
    - src/lib/factsheet/build-payload.ts
    - src/app/(dashboard)/allocations/widgets/risk/VarExpectedShortfall.tsx
    - src/app/(dashboard)/allocations/widgets/risk/VarExpectedShortfall.boundary.test.tsx
    - src/app/(dashboard)/allocations/lib/scenario-stress.ts
    - src/app/(dashboard)/allocations/lib/scenario-stress.test.ts
    - src/app/(dashboard)/allocations/widgets/widgets.signed-zero.test.tsx
decisions:
  - "the whole-record count is the stored record_observations when the payload carries it (the D-15 gate's count), else the non-NaN count of stratRet; a stored non-null CVaR on a record under the floor is still withheld"
  - "compute() and historicalVarCvar carry no floor and are classified window / definition in the census, which forbids CVAR_MIN_OBS in them"
  - "the widget keeps its all-zero insufficient state by reading a null ES95 as 'not decisive' (var95 === 0 && var99 === 0 && es95 null or 0), so the old behaviour on an all-zero short book is unchanged"
metrics:
  duration: "about 1h"
  completed: 2026-11-25
status: complete
actuals:
  tokens: 45000
  tasks: 2
  commits: 3
plan_head_before: 86c5baafe9d805dd76ace140cfb798c9cd5a2602
plan_head_after: 4a28e11e5a931b2f1ee8f44fe226e5cc2ea19afc
---

# Phase 236 Plan 07: the total-record CVaR floor at every reader Summary

CVaR is null below `CVAR_MIN_OBS = 60` observations on the factsheet whole record (both payloads), the book's ES95 widget and the Scenario blend, never on a zoomed window, and a census fails any new unclassified reader.

## Commits

| Task | Commit | What |
|---|---|---|
| 1 (tracer) | f2e07e752 | `buildFactsheetPayload` floors `cvar95` right after `overlaid` is built; `cvar-floor.test.ts` reads the `cvar_floor` fixture through the whole-record path, the allocator payload, v2 / v3 stored rows and a narrowed window |
| 2 | a8b2a2eba | widget ES95 floor, `computeVarPath` floor (A6), `cvar-reader-census.test.ts`, two moved pins |
| 2 (fix) | 4a28e11e5 | the narrowed-window case in `cvar-floor.test.ts` names its slices (see deviation 4) |

## RED at HEAD (before each edit)

- Task 1: 5 of 9 new cases failed: `n = 59 is below the floor`, `a v2 (unmigrated) stored row ... nulls at n = 59`, `a v3 stored non-null CVaR on a record under the floor is still withheld`, `the stored record_observations decides` (its reverse arm), `a 59-day book carries cvar95 NaN`. The n = 60 closed-form case, the v3 stored-null case, the shown-by-stored-count arm and the narrowed-window case passed at HEAD, as they should (the floor must not touch them).
- Task 2: widget `30 returns` and `59 returns` failed (`expected '-3.00%' to be '—'`); scenario `a 59-day blend` failed (`expected -0.07 to be null`); census `every total-record reader references CVAR_MIN_OBS` failed naming `VarExpectedShortfall.tsx` and `scenario-stress.ts`. The `60 returns` and `5 returns` widget cases and the `60-day blend` case passed at HEAD.

## Measured census map

Reader pattern (the plan's, over comment-stripped non-test `src` code, `git ls-files --cached --others`): `cvar95|computeExpectedShortfall|historicalVarCvar|cvar_95|expected_shortfall`. 12 files match. The plan's draft map was adjusted by ONE measurement: `src/lib/glossary.ts` (the `cvar_95` term key) matches and is classified `display`.

| Class | Files |
|---|---|
| total-record (floored, must reference CVAR_MIN_OBS) | `src/lib/factsheet/build-payload.ts`, `src/app/(dashboard)/allocations/widgets/risk/VarExpectedShortfall.tsx`, `src/app/(dashboard)/allocations/lib/scenario-stress.ts` |
| window (always shows, must not) | `src/lib/factsheet/compute.ts` |
| definition (no floor, must not) | `src/lib/return-stats.ts`, `src/lib/portfolio-stats.ts` |
| pass-through | `src/lib/factsheet/basis-metrics.ts`, `src/lib/factsheet/fetch-and-build-payload.ts`, `src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.ts` (sets `cvar95: NaN`), `src/lib/factsheet/types.ts` |
| display | `src/app/factsheet/[id]/v2/MetricsColumn.tsx`, `src/lib/glossary.ts` |

## Moved pins: old -> new -> why

No `build-payload` snapshot moved: its fixtures are 62-day series, above the floor, and the whole `src/lib/factsheet` suite stayed green with the snapshot untouched. No `-u` was run.

1. `scenario-stress.test.ts` golden CVaR, 20-day series: `-0.080` -> `null`. Why: 20 < 60 observations of the blend's total record. VaR on the same series stays `-0.060` (asserted in the same case).
2. `scenario-stress.test.ts` new golden CVaR arm, `-0.080` kept on the 20 values each repeated 3 times (n = 60, same shuffled order). Independent derivation: sorted = [-0.080 x3, -0.060 x3, ...]; k = max(1, floor(0.05 * 60)) = 3; the 3 smallest are all -0.080, so CVaR = -0.080 exactly; VaR = sorted[floor(0.05 * 60)] = sorted[3] = -0.060.
3. `widgets.signed-zero.test.tsx` `renderConstant`: fixture 20 -> 60 constant returns. Why: its intent is that all THREE printed figures follow the printed sign; at 20 returns CVaR is now the dash. At n = 60 the 3 smallest of a constant series equal it, so the three expected strings (`+1.00%`, `-3.00%`, a printed zero) are unchanged.

## PROOF-01 (verbatim)

Neutered copy of each file, RED with the named arm first, restored by `cp` from a byte backup, `cmp`, GREEN.

Task 1: floor deleted in `build-payload.ts`.
```
     × a 59-day book carries cvar95 NaN and a 60-day book carries the closed-form value 28ms
     × a v2 (unmigrated) stored row falls back to the computed figure, which the floor then nulls at n = 59 18ms
     × a v3 stored non-null CVaR on a record under the floor is still withheld (the floor reads the record, not the figure's source) 16ms
     × n = 59 is below the floor: cvar95 is NaN (the dash) while VaR still shows 56ms
      Tests  5 failed | 4 passed (9)
     × the stored record_observations decides when the payload carries it (the D-15 gate's count) 44ms
CMP_OK
 Test Files  1 passed (1)
      Tests  9 passed (9)
```

Task 2 (a): widget floor removed.
```
     × 30 returns: VaR95 and VaR99 show, ES95 is the dash 12ms
     × 59 returns: ES95 is still the dash, one under the floor 4ms
AssertionError: expected '-3.00%' to be '—' // Object.is equality
      Tests  2 failed | 4 passed (6)
CMP_OK widget
```

Task 2 (b): scenario-stress floor set to 10 at its use site.
```
     × golden CVaR — on the 20-day series CVaR is null: 20 < CVAR_MIN_OBS = 60 observations (236 FIG-03, A6) while VaR still shows 6ms
     × a 59-day blend: cvar is null, the VaR is unchanged and still shows 1ms
AssertionError: expected -0.08 to be null
AssertionError: expected -0.07 to be null
      Tests  2 failed | 18 passed (20)
CMP_OK scenario
```

Task 2 (c): `const cvar95 = 0;` appended to a byte-backed `src/lib/utils.ts`.
```
     × every CVaR reader is classified: a new unclassified reader fails naming its file 6ms
AssertionError: CVaR reader(s) the census does not name: src/lib/utils.ts. Classify each as total-record (and floor it at CVAR_MIN_OBS), window, definition, pass-through or display.: expected [ 'src/lib/utils.ts' ] to deeply equal []
      Tests  1 failed | 3 passed (4)
CMP_OK utils
```

GREEN after all three restores: `npx vitest run "src/app/(dashboard)/allocations" src/__tests__/cvar-reader-census.test.ts src/lib/factsheet` -> `Test Files  257 passed (257)`, `Tests  5072 passed (5072)`. `npx tsc --noEmit -p tsconfig.json` exit 0.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `widgets.signed-zero.test.tsx` is outside the plan's file list**
- **Found during:** Task 2 (the allocations suite)
- **Issue:** its three tone cases build 20 constant returns and read all three printed figures; CVaR is now the dash at 20.
- **Fix:** fixture moved to 60 constant returns with the derivation in the comment (moved pin 3). The test's intent is unchanged.
- **Commit:** a8b2a2eba

**2. [Plan wording] `build-payload.test.ts` and `allocator-portfolio-payload.test.ts` are listed but not edited**
- No expectation in either moved (62-day and longer fixtures), so the cases for those payloads live in the new `cvar-floor.test.ts` (including the allocator payload at 59 and 60 days).

**3. [Census map] one measured entry added:** `src/lib/glossary.ts` as `display` (see the map above).

**4. [Rule 1 - Bug] my own `cvar-floor.test.ts` tripped the SC-5 gate**
- **Found during:** the whole-repo run after Task 2
- **Issue:** `leverage-backbone-gates.test.ts` (SC-5) flags any `compute(<series>.map(...))` outside scenario.ts; the narrowed-window case passed `win.map(...)` inline.
- **Fix:** the two slices are named before the call; same assertions. Commit 4a28e11e5.

## Whole-repo run

`npx vitest run` under Node 22.22.1 with a second worktree's suite running at the same time: the only failures were the SC-5 case above (fixed, passes) and five load-only timeouts or whole-tree scans (`scripts/factsheet-census/count.test.tsx` x2 timeouts at about 5 s, `display-sign-single-source` R2, `return-stats.single-source` x2); all three files pass alone (`Test Files  3 passed (3)`, `Tests  79 passed (79)`), the same load-only pattern 236-05 recorded. The run was cut by its 580 s timeout before the final totals line, so no whole-repo totals are claimed.

Out of scope, not touched: the Node 25 last-ulp `skew` pins already recorded in `deferred-items.md` (this run used Node 22.22.1, the `.nvmrc` Node).

## Known Stubs

None.

## Threat Flags

None. No network, auth or schema surface was added.

## Self-Check: PASSED

- `src/lib/factsheet/cvar-floor.test.ts`, `src/__tests__/cvar-reader-census.test.ts`: FOUND.
- Commits f2e07e752, a8b2a2eba and 4a28e11e5: ancestors of HEAD.
- `grep -a -c CVAR_MIN_OBS` is >= 1 in `build-payload.ts`, `VarExpectedShortfall.tsx` and `scenario-stress.ts`.
