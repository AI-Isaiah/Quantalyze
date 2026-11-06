---
phase: 176-legacyretire-the-legacy-allocator-equity-curve-is-retired-an
plan: 06
subsystem: allocations-tests
tags: [fixture-sweep, derivePhase07Fields, e2e-seed, D-02, D-07, legacy-retire, vitest]
status: complete

requires:
  - phase: 176-legacyretire
    provides: "plan 05 (derived-only derivePhase07Fields signature, payload without equitySnapshots / minHistoryDepthMonths / equityBaselineUnknown, snapshotCount: number | null)"
provides:
  - "every derivePhase07Fields caller passes (apiKeys, holdingsRows, derivedEquityRow, partialReads, accountByKey, reconstructLinkSource, reconstructInFlightKeyIds)"
  - "no payload fixture names a removed field (the only remaining mentions are plan 05's own absence pins)"
  - "seedAllocatorBook writes only the version-2 allocator_equity_derived curve (no allocator_equity_snapshots upsert)"
  - "PR 1 tree green: tsc 0, lint 0, full suite with only the two known noise files failing"
affects: [176-07, PR 2 writer stop, PR 3 table drop]

actuals:
  tokens: 11000
  tasks: 3
  commits: 3
plan_head_before: 0e65b3df1b392f8b7dea94b11547585ff72cacc1
plan_head_after: 8a98ab042904c121176467674fc17db36bb6fa37
commits: 3

tech-stack:
  added: []
  patterns:
    - "a producer-shaped non-ready fixture carries snapshotCount null; a ready one carries its drawn day count"
    - "a fixture that is NOT producer-shaped (no equityHistoryState, or a test that varies the count on purpose) keeps its number, so a count-keyed assertion can still fail"

key-files:
  created: []
  modified:
    - src/lib/queries.test.ts
    - src/lib/queries.holdings-per-key.test.ts
    - src/lib/fingerprint-unpriced-parity.test.ts
    - src/lib/fingerprint-sameday-empty-parity.test.ts
    - src/lib/__tests__/derive-refusal-rows.test.ts
    - src/lib/__tests__/writer-residual-parity.test.ts
    - "src/app/(dashboard)/allocations/ (23 test files: AllocationDashboardV2.*, AllocationsTabs.*, HoldingsTabPanel.*, OverviewRisk.history-parity, components/HoldingsTable.*, components/ScenarioComposer.*)"
    - e2e/helpers/seed-test-project.ts
  deleted: []

key-decisions:
  - "Fixtures without equityHistoryState (cast partial payloads) and the AllocationDashboardV2.warmup baseProps keep their snapshotCount numbers. Only explicit producer-shaped rebuilding fixtures moved to null. Reason: the staleness / warm-up tests prove a suppression that needs a non-null count under 30 to be able to fail; nulling them would make those assertions vacuous."
  - "The D-15 arms in ScenarioComposer.test.tsx keep a non-null count of 3 beside the producer-shaped null, so 'chosen by state, never by count' still has an arm that fails if the component keys on the count."

requirements-completed: [SC-1]
---

# Phase 176 Plan 06: the derivePhase07Fields callers and payload fixtures follow the derived-only shape Summary

The 60 tsc errors plan 05 handed over are gone (`tsc --noEmit` exit 0), every call site and payload fixture follows the derived-only signature and payload, and the e2e seed no longer writes `allocator_equity_snapshots`.

## What was done

**Task 1 (tracer), commit 0fca3ed20.** Re-measured at the plan base: `npm run typecheck` exited 2 with 60 errors in the same 13 files plan 05 listed (46 in `queries.test.ts`, 2 in `queries.holdings-per-key.test.ts`, 2 in `ScenarioComposer.test.tsx`, one each in 10 others). The call-site rewrite dropped the second, third and fifth arguments (snapshots array, snapshot count, baseline flag): a reviewed regex over the 8 single-line calls in `queries.test.ts` (backups first), the multi-line calls by hand or exact-string replacement (`queries.test.ts` x2, `fingerprint-unpriced-parity`, `fingerprint-sameday-empty-parity`, `HoldingsTabPanel.exposure-agreement`), and the one-liners in `queries.holdings-per-key`, `derive-refusal-rows` and `writer-residual-parity`. The `Parameters<typeof derivePhase07Fields>[n]` indices moved with the signature (`[3]` -> `[1]` holdings row, `[5]` -> `[2]` derived row, `[8]` -> `[5]` link source). `holder-matrix-parity`, `holding-scope-key-census`, `equity-curve.equitydailypoints.test.tsx` and `EquityHistoryRebuilding.tsx` only name the function in prose: no change needed, so no edit (the plan's "doc comment only if the compiler or a reader needs it" did not apply).

**Task 2, commit a6bd2ee7a.** 61 single-line `equitySnapshots: []`, `minHistoryDepthMonths: ...` and `equityBaselineUnknown: ...` keys removed from 24 fixture files by a scripted line-pattern edit (byte backups under the scratch dir). Producer-shaped rebuilding fixtures (`AllocationsTabs.*` x6) now carry `snapshotCount: null`. In `ScenarioComposer.test.tsx` the `producerRebuildingPayload` builder defaults `snapshotCount: null`, the second D-15 `it.each` lost its `snapshotCount: 0` override, the first D-15 `it.each` rows became (null count, the producer's own shape) and (a non-null 3 that must not decide it), and the blank-mode `it.each` lost its snapshot-count column (ready rows carry `THREE_POINT_CURVE.length`, the producer's count; others null).

**Task 3, commit 8a98ab042.** `seedAllocatorBook` lost the legacy upsert and its error throw; the local `snapshots` became `daySeries`, and the version-2 trustworthy derived curve and returns are built from it exactly as before (same values, same day count, so the e2e books still draw the same curve and warm up on the derived day count). The doc list of seeded tables names `allocator_equity_derived` instead of the legacy table.

## Tests deleted or rewritten (T-176-15)

Deleted: none. This plan removes only argument positions and fixture keys; the three removed-field assertions (`minHistoryDepthMonths`, `equityBaselineUnknown`, snapshots array) were already deleted with their fields by plan 05, so nothing here needed deleting.

Rewritten, subject kept:
- `queries.test.ts` "legacy snapshots and no derived row stay rebuilding with an empty curve (plan 11 removed the snapshot fallback)" is now "no derived row stays rebuilding with an empty curve (there is no snapshot fallback to draw from)". It can no longer pass snapshots to prove they are ignored, because the producer has no such parameter; "the producer reads no snapshot" is pinned by plan 05's B-02 in `queries.my-allocation.test.ts`. The remaining assertions (rebuilding, `awaiting_derivation`, empty curve and returns) still fail if the producer invents a curve for a missing row.
- `queries.test.ts` FLIPRETRY: the `SNAPSHOTS` constant and the "falls back to the snapshot render" wording left the FAIL arm's title; both arms keep their assertions. Spot-check (neuter): changing both `p.is_trustworthy !== true` guards in `src/lib/queries.ts` to `=== undefined` turned 6 tests in `queries.test.ts` RED, including the FLIPRETRY FAIL arm; restored from a byte backup and `git diff` on the file is empty.
- `ScenarioComposer.test.tsx` D-15 arms: column removal described above; titles no longer say "legacy snapshots".

Deliberately left as is (named so it is not read as an omission): `AllocationDashboardV2.warmup.test.tsx` keeps `snapshotCount: 0` in `baseProps` and its `it.each([0, 1, 60])` arms. Their subject is that the warm-up note counts the curve days and never the `snapshotCount` prop; varying that prop independently is the test. `display-sign-census-misses.test.tsx` needed no change (it passes `snapshotCount={30}` to KpiStrip, still a valid prop).

## Verification run

- Plan-anchor check: `node scripts/verify-plan-anchors.mjs <plan>` -> OK, 4 claims.
- Before: `npm run typecheck` exit 2, 60 errors, 13 files (same set as plan 05's table, no difference).
- Task 1 files (10): 10 files, `Tests  377 passed (377)`.
- Task 2: `npx vitest run "src/app/(dashboard)/allocations" src/__tests__/display-sign-census-misses.test.tsx` -> `Test Files  158 passed (158)`, `Tests  2754 passed (2754)`.
- `npm run typecheck` -> exit 0. `npm run lint` -> exit 0.
- Full `npm test` (vitest run): `Test Files  2 failed | 1182 passed | 20 skipped (1204)`, `Tests  3 failed | 23308 passed | 315 skipped (23626)`. The 3 failures are all the known environment noise, none touched by this plan:
  - `src/lib/factsheet/compute.conventions.test.ts` fixture B and fixture C (last-digit float snapshot skew from the shared node_modules; 2 snapshot failures).
  - `src/__tests__/contracts/ci-apt-bounded.contract.test.ts` R4 timeout under full-suite load; run alone it passes (`Tests  68 passed (68)`).
- Acceptance greps: `grep -rIanE 'derivePhase07Fields\([^)]*\[\][[:space:]]*,[[:space:]]*0[[:space:]]*,' src` prints nothing. `grep -rIlE '\b(minHistoryDepthMonths|equityBaselineUnknown|equitySnapshots)\b' src` lists only `AllocationDashboardV2.rebuilding.test.tsx`, `KpiStrip.warmup.test.tsx` and `queries.my-allocation.test.ts`, which are plan 05's deliberate absence pins (baseline before plan 05: 35 files). `grep -acF 'from("allocator_equity_snapshots")' e2e/helpers/seed-test-project.ts` is 0 (baseline 1).
- The e2e suite was not run (no Docker, no local stack, no remote DB by constraint); the seed change is verified by typecheck and by reading that the derived upsert is untouched.

## Deviations from Plan

**1. [Judgment] Producer-shape `snapshotCount: null` applied only to explicit rebuilding fixtures** (see key-decisions). The plan's Task 2 text names `producerRebuildingPayload` and the D-15 rows; I additionally nulled the six `AllocationsTabs.*` fixtures (explicit `equityHistoryState: "rebuilding"`, empty curve). Fixtures with no state, and the warm-up/staleness fixtures, kept their numbers to keep their suppression assertions able to fail.

**2. [Scope] `HoldingsTabPanel.exposure-agreement.test.tsx` was committed in Task 1, not Task 2,** because its call-site fix and its fixture-key removal sit in one file and a split commit would leave it half-typed.

**3. [Set difference] None.** The re-measured file set matched the plan's list; plus `ScenarioComposer.test.tsx` was the only file whose errors spanned both tasks.

No Rule 4 items. Fix-attempt limit never reached.

## Auth gates

None.

## Known Stubs

None.

## Threat Flags

None. Test fixtures and one e2e seed helper only; no new endpoint, auth path or schema.

## CHANGELOG inputs

- Tests: every `derivePhase07Fields` caller and every dashboard payload fixture follows the derived-only shape; producer-shaped rebuilding fixtures carry `snapshotCount: null`.
- Tests: the e2e allocator seed no longer writes `allocator_equity_snapshots` and still seeds the same version-2 derived curve.

## Self-Check: PASSED

- FOUND: 0fca3ed20, a6bd2ee7a, 8a98ab042 (all ancestors of HEAD on wt/176-p06).
- `git rev-list --count 0e65b3df1b392f8b7dea94b11547585ff72cacc1..HEAD` was 3 before this commit; `git status` clean apart from this SUMMARY.
- STATE.md, ROADMAP.md and state.json untouched.
