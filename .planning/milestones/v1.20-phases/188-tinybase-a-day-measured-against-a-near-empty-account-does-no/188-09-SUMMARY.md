---
phase: 188-tinybase-a-day-measured-against-a-near-empty-account-does-no
plan: 09
subsystem: scenario-engine
tags: [tiny-base, scenario, live-baseline, compare-panel, key-inputs, d-07, sc-2, sc-3, sc-5]
requires: ["188-06", "188-08"]
provides:
  - "StrategyForBuilder.undefined_return_days?: readonly string[] (last field), honoured by computeScenario"
  - "readMarksStart return field tinyBaseDaysByKeyId, its call moved ahead of the live baseline"
  - "MyAllocationDashboardPayload.tinyBaseDaysByApiKeyId?: Record<string, string[]> (both return branches, present only when non-empty)"
  - "optional last parameter tinyBaseDaysByApiKeyId on liveBaselineMetricsFromPerKeyDailies and buildPerKeyStrategyForBuilderSet"
  - "ScenarioCompareInputs.tinyBaseDaysByApiKeyId and the ScenarioComparePanel payload field, copied by deriveCompareInputs"
affects: ["188-10"]
tech-stack:
  added: []
  patterns: ["the days ride the unit, not ScenarioState (T-KL1-UNIT)", "one correlation day set for every pair (T-KL1-CORR)", "optional trailing parameter, present only when non-empty"]
key-files:
  created:
    - src/lib/scenario.tiny-base.test.ts
    - src/app/(dashboard)/allocations/lib/scenario-tiny-base.test.ts
  modified:
    - src/lib/scenario.ts
    - src/lib/queries.ts
    - src/lib/queries.my-allocation.test.ts
    - src/app/(dashboard)/allocations/lib/scenario-adapter.ts
    - src/app/(dashboard)/allocations/lib/scenario-compare.ts
    - src/app/(dashboard)/allocations/components/ScenarioComparePanel.tsx
    - src/app/(dashboard)/allocations/components/ScenarioComparePanel.test.tsx
key-decisions:
  - "D-07 built as decided: the engine mirrors the compose's dropped days. A named day leaves the unit's numerator, its weight in activeWeightSum and its date axis; a day no unit has a return on is absent, never 0."
  - "T-KL1-UNIT: the days ride the unit (undefined_return_days), so every merge and projection copies them without a ScenarioState change."
  - "T-KL1-CORR: one correlation day set for every pair (the axis days no member names)."
  - "KL-4: a failed key_inputs read or malformed list gives that key no days; the panels compute exactly what they did before this phase for that key."
requirements-completed: [SC-2, SC-3, SC-5]
status: complete
commits: 4
plan_head_before: 3385865655c7088fa2220a1e139bcc0552d1b5d5
plan_head_after: 76814774296db837be1526d1478e93368baf397c
actuals:
  tokens: 28000
  tasks: 2
  commits: 4
duration: single session
completed: 2026-11-04
---

# Phase 188 Plan 09: the live baseline and every compare column sit a key out of its tiny-base days

**`computeScenario` now treats a unit's tiny-base day as a day with no return (not a flat 0%), and the SSR live baseline plus every compare column built from per-key units pass those days to it, so they agree with each other and with the stored book.**

## What was built

- `src/lib/scenario.ts`: `StrategyForBuilder.undefined_return_days?: readonly string[]` as the last field. In `computeScenario`, a `Map` of named-day sets is built only for units with a non-empty list (the default path does no extra work). Both `allDateSet` loops skip a unit's named days (T-KL1-AXIS); the weighted-sum loop `continue`s past a unit on its named day before it adds to `r` or `activeWeightSum`; the correlation loop measures every pair on one keep-set (the axis days no member names, T-KL1-CORR), and calls `pearson` on the unfiltered series when nobody names a day. File-header behaviour note 6 records the rule. Coverage-span membership, include-from, the `n < 10` floor, the curve, Sortino and drawdown are untouched.
- `src/lib/queries.ts`: `readMarksStart` also returns `tinyBaseDaysByKeyId` (the valid per-key lists its row loop already collected; `{}` on the error and empty-key branches; doc comment extended). `liveBaselineMetricsFromPerKeyDailies` gained an optional last parameter and spreads `undefined_return_days` only for a key with a non-empty list. In `getMyAllocationDashboard` the `marksIncludedKeys(` call and the `readMarksStart(` destructuring moved to directly after `const bookEntryGateSatisfied`, ahead of the baseline, unchanged except for the extra field; the baseline takes the lists as its third argument; both return branches carry `tinyBaseDaysByApiKeyId` beside `tinyBaseDays`, only when non-empty. `MyAllocationDashboardPayload.tinyBaseDaysByApiKeyId?` added next to `tinyBaseDays?`.
- `scenario-adapter.ts`: `buildPerKeyStrategyForBuilderSet` takes the optional last parameter and sets the field only for a key with a non-empty list; a list for a key with no series creates no unit. `mergeAddedIntoPerKeySet` spreads `perKey.strategies`, so the field rides through it.
- `scenario-compare.ts` / `ScenarioComparePanel.tsx`: `ScenarioCompareInputs.tinyBaseDaysByApiKeyId?`; `computeMetricsForDraft` passes `liveInputs.tinyBaseDaysByApiKeyId ?? {}` as the builder's fourth argument; the panel's `payload` type gained the field and `deriveCompareInputs` copies it beside `contributingApiKeyIds`.

## TDD record

### Task 1 (tracer): engine and SSR baseline

- RED (commit 91688ec63), `/tmp/tinybase-09/red1.log`: 9 failed (6 of 7 engine arms; 3 SSR arms), the rest pass by construction (byte-identity engine arm, and the SSR "no row", "read fails" and "fresh branch" arms before the field existed). Failures were on the planned assertions: A alone on 2026-03-07 read 0.005 not 0.02, twr 0.05352 not 0.06121, sole-unit output 12 entries not 11, `tinyBaseDaysByApiKeyId` undefined.
- I wrote the engine edit before the RED tests by mistake, noticed, discarded it (it was a scripted edit, reproduced exactly at GREEN) and wrote the tests first; RED was verified against the engine with no change.
- GREEN (commit cd562710a): the ten targeted files, 808 tests passed (`scenario.tiny-base`, `queries.my-allocation`, `scenario`, `scenario.peer-basis`, `scenario-blend07`, `scenario-optimizer-parity`, `scenario-sample-ratios`, `getMyAllocationDashboard.scenario`, `diversification`, `ScenarioComposer`). One SSR arm for the fresh-allocator branch was added in the GREEN commit (the second return branch had no arm after the first run caught that I had missed it in the edit).
- Neuter drills, each against byte backup `/tmp/tinybase-09/scenario.bak`, restored with `cp` and `cmp` clean:
  - the weighted-sum `continue` on a named day removed (`neuter1.log`): 7 failed, 14 passed (engine blend, twr, window, SC-4, and the three SSR arms that compare against the typed twr).
  - both axis `continue`s removed (`neuter1b.log`): 1 failed (the sole-unit stale-row arm).
  - the correlation keep-filter removed (`neuter1c.log`): 1 failed (the one-day-set arm).
- Acceptance: `grep -ac undefined_return_days src/lib/scenario.ts` prints 4 (baseline 0); `grep -ac tinyBaseDaysByApiKeyId src/lib/queries.ts` prints 7 (baseline 0); the `readMarksStart` line is before `const liveBaselineMetrics = bookEntryGateSatisfied` (awk exit 0; baseline exit 1); `grep -ac 'from("allocator_equity_derived")' src/lib/queries.ts`: before 2, after 2 (equal, no new query).

### Task 2: builder and compare columns

- RED (commit 9bb1c090c), `/tmp/tinybase-09/red2.log`: 4 failed, 12 passed (builder field missing; live-book column twr 0.05352 vs the SSR baseline's 0.06121; saved draft read 0.01 not 0.02 on 2026-03-07; the panel did not pass the field). A first run failed to import `queries.ts` (server-only), fixed in the test with the module mocks other `queries` importers use before the RED was recorded.
- GREEN (commit 768147742): new module, `scenario-adapter.test.ts`, `scenario-compare.test.ts`, `ScenarioComparePanel.test.tsx` and `scenario.tiny-base.test.ts`, 79 tests passed.
- Neuter drills (restored with `cp` and `cmp` clean each time):
  - the builder stops setting the field, `neuter2.log`: 3 failed, 3 passed.
  - the panel stops copying `tinyBaseDaysByApiKeyId`, `neuter2b.log`: 1 failed, 9 passed.
- Acceptance: `grep -ac undefined_return_days scenario-adapter.ts` prints 2; `grep -ac tinyBaseDaysByApiKeyId` prints 2 in `scenario-compare.ts` and 2 in `ScenarioComparePanel.tsx` (baselines 0).

## Arithmetic (oracles are typed, not derived from the code under test)

Fixture (synthetic): 12 days, `key-a` every day, `key-b` missing 2026-03-07 and 2026-03-08, weights 1 : 3 (equity 10000 : 30000). A shared day is `(rA + 3 rB) / 4`, e.g. 2026-03-01: `(0.01 + 0.09) / 4 = 0.025`; a named day is `key-a` alone, 0.02 and -0.01. twr is the product of the twelve typed day returns minus 1 (0.06121), against 0.05352 when the days read as 0. A saved draft at 0.5 / 0.5 reads 2026-03-07 as 0.02 (was `(0.02 + 0) / 2 = 0.01`). Correlation is checked against a Pearson written out in the test, on the 10 days no unit names, for the A-B, A-K and B-K cells, with a non-vacuity check that the 12-day value rounds differently.

## Gates

- `npx tsc --noEmit`: exit 0, no `error TS` (after each task).
- `npx eslint` on every changed src and test file: exit 0, no output.
- `npm run lint`: exit 0 (2 warnings, both pre-existing: `isRankableAnalyticsRow` in `composite-read-path.ts:12`, `nativeUnitReason` in `MetricsColumn.tsx`), then the route-contract, planning-hygiene and canonical-domain checks OK.
- Full `npx vitest run` after the last commit: 1210 files (1189 passed, 1 failed, 20 skipped); 23758 tests (23447 passed, 2 failed, 309 skipped). The 2 failures are the KNOWN PRE-EXISTING `src/lib/factsheet/compute.conventions.test.ts` fixture B ("a series with zero-return days") and fixture C ("a series with interior calendar gaps"); that file is untouched. `ci-apt-bounded.contract.test.ts` R4 passed in this run (it can time out under load, known).

## DESIGN.md

No string a user reads was added or edited, and no UI element, class or layout changed. No DESIGN.md check was needed or made.

## Mergeability with Phase 186

`src/lib/queries.ts` is the one file shared with 186's planned set, edited in disjoint hunks: `liveBaselineMetricsFromPerKeyDailies` and its comment, `readMarksStart` and its doc, the block of `getMyAllocationDashboard` from `const bookEntryGateSatisfied` to the baseline, both return branches beside `tinyBaseDays`, and the payload field beside `tinyBaseDays?`. Nothing inside `derivePhase07Fields`, no `unpricedNativeAccounts` line, no import re-sort, no signature break (optional and trailing). 186's other planned files (`queries.test.ts`, `AllocationDashboardV2.tsx`, its failing-key test) are not touched.

## Deviations from Plan

None - plan executed exactly as written. No existing test newly failed from this change; the STOP rule did not fire, and no existing test was edited except by addition (one new arm in `queries.my-allocation.test.ts`, one in `ScenarioComparePanel.test.tsx`).

## Recorded consequences and carried limits

- **KL-4 (carried limit):** a failed `key_inputs` read or a malformed list (through plan 06's strict `readTinyBaseDays`, as plan 08 reads it) gives that key no named days, so the panels compute exactly what they did before this phase for that key; the existing warn and Sentry capture report the failure (asserted: once). Chosen over em-dashing every scenario KPI on a transient read error.
- **KL-5 (carried limit, not changed):** a STRATEGY leg carries no `undefined_return_days`. A strategy added in the composer (merged by `mergeAddedIntoPerKeySet`) and a shared scenario's published series (`share-resolve.ts`, which calls `computeScenario`) still read a day their stored series lacks as r = 0 inside a blend, as for any absent day today.
- **T-KL1-CORR cost:** on a named day every correlation pair loses that day, not only the named key's pairs, so the diversification panel's single covariance matrix can reproduce the engine's `correlation_matrix`. Plan 10 aligns that panel on the same set.
- **`tinyBaseDaysByKeyId` is not narrowed by `departedHistoryUnavailable`**, unlike plan 08's union: a list describes that key's own stored series, and only a unit built from the contributing set reads it.
- **Plan 10 scope:** the composer's own engine set (KpiStrip `scenarioMetrics`, equity and drawdown charts, Monte Carlo, stress, benchmark, target max-DD solver), the diversification panel and the tab's `comparePanelPayload` feed are not changed here. Until plan 10 lands, the tab's feed to the compare panel does not carry `tinyBaseDaysByApiKeyId`; this plan proves the panel through its `payload` prop only.
- No migration, no Python, no PROD/TEST/Railway access, no service-role client, no new Supabase query.

## Known Stubs

None.

## Threat Flags

None. The owner-RLS `key_inputs` read and its explicit allocator filter are plan 08's and unchanged (T-188-14, T-188-24); the lists are taken only through the strict reader (T-188-23); T-188-22 is mitigated by the engine rule and proven by the RED arms and neuter drills above.

## Self-Check: PASSED

- Created files present: `src/lib/scenario.tiny-base.test.ts`, `src/app/(dashboard)/allocations/lib/scenario-tiny-base.test.ts`.
- Commits present on `wt/188-p09`: 91688ec63, cd562710a, 9bb1c090c, 768147742.
- `.planning/STATE.md` and `.planning/ROADMAP.md` untouched.
