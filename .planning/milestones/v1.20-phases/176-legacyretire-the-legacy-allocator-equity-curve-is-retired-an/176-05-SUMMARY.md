---
phase: 176-legacyretire-the-legacy-allocator-equity-curve-is-retired-an
plan: 05
subsystem: allocations-reader
tags: [queries, kpi-strip, warm-up, D-02, D-07, legacy-retire, vitest]
status: complete

requires:
  - phase: 176-legacyretire
    provides: "plan 03 (allocatorEligibleApiKeyIds = eligibleKeyIds in queries.ts); CONTEXT D-02, D-07, Discretion"
provides:
  - "getMyAllocationDashboard issues no read of public.allocator_equity_snapshots (the last product reader)"
  - "snapshotCount: number | null on the drawn derived curve's days (null while not ready)"
  - "KpiStrip warm-up gate snapshotCount !== null && snapshotCount < 30 && !allKeysStale, generic countdown copy only"
  - "TODOS 176-INERT-LEFTOVERS"
affects: [176-06 (fixture and call-site sweep), 176-07, PR 2 writer stop, PR 3 table drop]

actuals:
  tokens: 27600
  tasks: 3
  commits: 3
plan_head_before: f5475112e6d1c4b1a3ecdfbe76d81904f3e436ab
plan_head_after: fb63948f2c5564fbc8fc62b843301e351e1f5138
commits: 3

tech-stack:
  added: []
  patterns:
    - "a withheld-history count is null, never 0, and the consumer guards null explicitly (null < 30 is true in JS)"
    - "a removed payload field is pinned absent with not.toHaveProperty while the old rows stay seeded in the mock"

key-files:
  created: []
  modified:
    - src/lib/queries.ts
    - src/lib/queries.my-allocation.test.ts
    - src/lib/__tests__/getMyAllocationDashboard.scenario.test.ts
    - src/app/(dashboard)/allocations/components/KpiStrip.tsx
    - src/app/(dashboard)/allocations/components/KpiStrip.warmup.test.tsx
    - src/app/(dashboard)/allocations/components/KpiStrip.test.tsx
    - src/app/(dashboard)/allocations/components/KpiStrip.scenario.test.tsx
    - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
    - src/app/(dashboard)/allocations/AllocationDashboardV2.tsx
    - src/app/(dashboard)/allocations/AllocationDashboardV2.rebuilding.test.tsx
    - src/lib/allocation-helpers.ts
    - TODOS.md
  deleted:
    - src/app/(dashboard)/allocations/AllocationDashboardV2.baseline-unknown.test.tsx
    - src/lib/allocation-helpers.equity-adapter.test.ts

key-decisions:
  - "Discretion, stated once in the snapshotCount field doc: derived drawn-curve days when equityHistoryState is ready, null otherwise; the D-07 30-day countdown stays, counted on derived days, and a rebuilding book never shows one (D-15)."
  - "equityCurveSource keeps its two-value type (planner call); its 'legacy' value now means no trustworthy derived curve. The rename is booked in TODOS 176-INERT-LEFTOVERS with the managerSide* plumbing."
  - "activeVenues stays on the payload (the factsheet markets line reads it); ScenarioComposer's only use was the KPI strip, so its destructure went with the prop."

requirements-completed: [SC-1]
---

# Phase 176 Plan 05: the dashboard reads no legacy curve, and warm-up counts derived days Summary

`getMyAllocationDashboard` no longer queries `allocator_equity_snapshots`; `snapshotCount` is now the drawn derived curve's day count (null while the history is rebuilding), KpiStrip warms up only on a non-null count under 30, and the "Only N months of history" copy and the "Limited equity history" banner are gone.

## What was done

**Task 1 (tracer), commit 08fc1319f.** Four new tests (B-02, B-01, B-01b, D-07) were written first and seen RED on the unchanged producer. In `src/lib/queries.ts`: deleted the legacy `Promise.all` arm and its destructured result, its `assertOk`, `rawEquitySnapshots` and the partition/`snapshotCount` block; `derivePhase07Fields` lost its `equitySnapshots`, `snapshotCount` and `equityBaselineUnknown` parameters and computes `snapshotCount = equityHistoryState === "ready" ? equityDailyPoints.length : null` itself (the other parameters keep their order); deleted the depths block, `minHistoryDepthMonths`, the three payload members and `partitionTrustworthyEquitySnapshots` with its docblock. `snapshotCount: number | null` carries the one doc paragraph for the rule; `equityCurveSource`'s doc carries the planner-call sentence. Tests: TC p7-01 lists the surviving field names; p7-02, p7-03 and p7-07 were rewritten onto version-2 derived rows (`p7DerivedV2Row(n)` plus one identified key); p7-08, p7-09, p7-CL9, p7-CL9b and the snapshot-only P1151 arms were deleted with their fields; the seed was dropped from every test that only used it as a side input (`seedSnapshotsBTC`, `SNAP_BTC`, the two inline seeds, `P1151_SNAPSHOTS`, `legacyExpectedDailyPoints`). The partition describe block and its import left `getMyAllocationDashboard.scenario.test.ts`, whose `derivePhase07Fields` fixture call moved to `(apiKeys, NO_HOLDINGS, null)`.

**Task 2, commit 1611aced5.** Wrote Tests E (removed props ignored), N (null count never warms up and the scenario primary shows) and O (null count in live mode) first; 3 RED. `KpiStrip.tsx`: `snapshotCount?: number | null`, `minHistoryDepthMonths` and `activeVenues` props deleted, `warmupCopy(snapshotCount)` is the generic countdown only, `warmingUp = snapshotCount !== null && snapshotCount < 30 && !allKeysStale`, header doc updated. `ScenarioComposer.tsx` stops destructuring and passing the two props (`activeVenues` had no other reader there). `KpiStrip.test.tsx`, `KpiStrip.scenario.test.tsx` and `KpiStrip.warmup.test.tsx` lost the removed props and the venue-copy tests (old Tests E, F, G, H and the "Venue-specific warmup precedence" test).

**Task 3, commit fb63948f2.** `AllocationDashboardV2.rebuilding.test.tsx`: the banner arms became the D-07 pin (a ready and a rebuilding cast payload still carrying `equityBaselineUnknown: true` render no `dashboard-baseline-unknown-banner` and no "Limited equity history"); 2 RED. Removed the prop, both render sites, `BaselineUnknownBanner` and the comments naming the legacy table in `AllocationDashboardV2.tsx`; `git rm` of `AllocationDashboardV2.baseline-unknown.test.tsx`; deleted `equitySnapshotsToDailyPoints` (and the then-unused `DailyPoint` import) from `allocation-helpers.ts` and `git rm` of its only consumer test; appended TODOS `176-INERT-LEFTOVERS` under the Phase 176 section.

## RED-then-GREEN evidence

Task 1, base log `/tmp/legacyretire-05/red-at-base.log`: `Tests  4 failed | 188 skipped (192)`. The four failing names:
- `B-02: the read issues no .from of the legacy table` (expected a length of +0, got 1)
- `B-01: a ready book reports snapshotCount on the drawn derived days, not the legacy row count` (expected 20 to be 12; ready and 12 drawn points passed first, so the failure is the count)
- `B-01b: a rebuilding book (no derived row) reports snapshotCount null, never a count over held-back history` (expected 20 to be null)
- `D-07: the payload carries no equitySnapshots, minHistoryDepthMonths or equityBaselineUnknown`

GREEN: `npx vitest run src/lib/queries.my-allocation.test.ts src/lib/__tests__/getMyAllocationDashboard.scenario.test.ts` -> 2 files, `Tests  200 passed (200)`.

Task 2, base log `/tmp/legacyretire-05/t2-red.log`: `Tests  3 failed | 3 passed (6)` (`Test E (removed props ignored)`, `Test N (null count = rebuilding)`, `Test O (null count, live mode)`). GREEN: the three KpiStrip files, `Tests  49 passed (49)`.

Task 3, base log `/tmp/legacyretire-05/t3-red.log`: `Tests  2 failed | 53 passed (55)` (`D-07: a rebuilding payload ...` and `D-07: a ready payload ...`, both failing on `expected <div role="status"> to be null` after their positive control passed). GREEN: `Tests  55 passed (55)`.

Baselines at HEAD before the plan: `grep -acF 'from("allocator_equity_snapshots")' src/lib/queries.ts` was 1, `grep -acE 'minHistoryDepthMonths' src/lib/queries.ts` was 5, `grep -acF 'BaselineUnknownBanner'` in AllocationDashboardV2.tsx was 3, and `grep -acF 'months of history available on'` in KpiStrip.tsx was 2 (the plan's acceptance line said 1; the second hit was the header doc). After: all four are 0.

## Verification run

- Task 1/2/3 `<automated>` chains each print `OK`.
- Files this plan owns: `npx vitest run src/lib/queries.my-allocation.test.ts src/lib/__tests__/getMyAllocationDashboard.scenario.test.ts "src/app/(dashboard)/allocations/components/KpiStrip" "src/app/(dashboard)/allocations/AllocationDashboardV2.rebuilding.test.tsx"` -> 7 files, `Tests  306 passed (306)`. `ScenarioComposer*` -> 3 files, 511 passed.
- `npx vitest run src/lib/queries` plus the files above (28 files): `Test Files  2 failed | 26 passed`, `Tests  78 failed | 564 passed (642)`. All 78 failures are in two plan-06 files calling `derivePhase07Fields` with the old argument list: `src/lib/queries.test.ts` (69) and `src/lib/queries.holdings-per-key.test.ts` (9). Plan 06 owns both.
- `npx eslint` on every touched source and test file: no output.
- `node scripts/verify-plan-anchors.mjs <plan>`: OK, 8 claims.
- No non-test file under `src`, `e2e` or `scripts` names `minHistoryDepthMonths`, `equityBaselineUnknown`, `equitySnapshotsToDailyPoints`, `partitionTrustworthyEquitySnapshots` or `BaselineUnknownBanner`.

## Typecheck residue handed to plan 06

`npm run typecheck > /tmp/legacyretire-05/tsc-after.log` exits 2 with 60 errors in 13 files, each once below with its error count, and every one is in plan 06's `files_modified`:

| File | Errors |
|---|---|
| src/lib/queries.test.ts | 46 |
| src/lib/queries.holdings-per-key.test.ts | 2 |
| src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx | 2 |
| src/lib/__tests__/derive-refusal-rows.test.ts | 1 |
| src/lib/__tests__/writer-residual-parity.test.ts | 1 |
| src/lib/fingerprint-sameday-empty-parity.test.ts | 1 |
| src/lib/fingerprint-unpriced-parity.test.ts | 1 |
| src/app/(dashboard)/allocations/HoldingsTabPanel.exposure-agreement.test.tsx | 1 |
| src/app/(dashboard)/allocations/AllocationsTabs.addalloc.test.tsx | 1 |
| src/app/(dashboard)/allocations/AllocationsTabs.onboarding.test.tsx | 1 |
| src/app/(dashboard)/allocations/AllocationsTabs.scenario-composer.test.tsx | 1 |
| src/app/(dashboard)/allocations/AllocationsTabs.scenario-state-preservation.test.tsx | 1 |
| src/app/(dashboard)/allocations/AllocationsTabs.test.tsx | 1 |

No tsc error is outside that set. The fixture errors are `equitySnapshots` object-literal keys and `derivePhase07Fields` calls with the old 8-to-10 argument list.

## Deviations from Plan

**1. [Judgment] The mock harness keeps `state.allocatorEquitySnapshots` and its `rowsFor` case.** The plan says to delete them once no test seeds the table. The four new 176 arms seed 40 legacy rows on purpose: B-01 is only RED at base because a producer that still read them would report their count, and B-02 / D-07 mean nothing against an empty table. The field comment now says only the "176 D-02 / D-07" arms seed it. Not a deviation from the intent (no test seeds it for any other purpose).

**2. [Rule 3 - Blocking] `equitySnapshotsToDailyPoints` left `queries.my-allocation.test.ts` in Task 1, not Task 3.** The file imported it for one positive control, and Task 3 deletes the helper; the import and the control went with the P1151 snapshot arms.

**3. [Rule 1 - Test that could not fail] The Phase 36 "(4) no snapshot reconstruction is mixed in" assertion was replaced.** It shifted the seeded snapshots and asserted the baseline did not move, which is vacuously true once the table is unread. It now asserts the chain audit holds no `allocator_equity_snapshots` entry, which still fails if a snapshot read returns.

**4. [Scope] `getMyAllocationDashboard.scenario.test.ts` also carried a `derivePhase07Fields` fixture call and an `equitySnapshots` type reference** (`NO_SNAPSHOTS`), which the plan did not name. Both moved to the new signature in the same file.

No Rule 4 items. Fix-attempt limit never reached.

## Auth gates

None.

## Known Stubs

None. Nothing emits a placeholder for a removed field.

## Threat Flags

None. Only fields and one read were removed (T-176-14 accepted). T-176-13 is mitigated: `snapshotCount` is null while not ready (B-01b) and KpiStrip guards null (Tests N and O), each seen RED at base.

## CHANGELOG inputs

- Changed: the Overview and Scenario KPI strip count their 30-day warm-up on the days of the equity curve actually drawn, not on legacy snapshot rows.
- Changed: a book whose history is still rebuilding no longer shows "Warming up - need N more days"; it shows no countdown.
- Removed: the "Only N months of history available on {venues}" KPI copy.
- Removed: the "Limited equity history" banner on the allocations Overview.
- Removed: `equitySnapshots`, `minHistoryDepthMonths` and `equityBaselineUnknown` from the dashboard payload, and `partitionTrustworthyEquitySnapshots` / `equitySnapshotsToDailyPoints`.
- Notes: `getMyAllocationDashboard` no longer reads `allocator_equity_snapshots`, the last product reader; the writer stop (PR 2) and the table drop (PR 3) wait on plan 07's PROD observation. Inert leftovers booked as `176-INERT-LEFTOVERS`.

## Self-Check: PASSED

- FOUND: 08fc1319f, 1611aced5, fb63948f2 (all ancestors of HEAD on wt/176-p05).
- FOUND: the modified files above; MISSING (intended): the two deleted test files.
- `git rev-list --count f5475112e..HEAD` was 3 before this commit; `git status` clean apart from this SUMMARY.
