---
phase: 188-tinybase-a-day-measured-against-a-near-empty-account-does-no
plan: 10
subsystem: scenario-composer
tags: [tiny-base, scenario-composer, diversification, compare-panel, d-07, sc-2, sc-3, sc-5]
requires: ["188-09"]
provides:
  - "ScenarioComposer perKeyAdapterOutput passes payload.tinyBaseDaysByApiKeyId to buildPerKeyStrategyForBuilderSet (and lists it in the memo's dependencies)"
  - "AllocationsTabs comparePanelPayload.tinyBaseDaysByApiKeyId"
  - "alignConstituentReturns on the engine's correlation day set; optional AlignedConstituents.correlationDates"
affects: []
tech-stack:
  added: []
  patterns: ["the days ride the unit (T-KL1-UNIT), so the composer changes in one argument", "one correlation day set for every pair (T-KL1-CORR), present only when a member names an axis day"]
key-files:
  created:
    - src/lib/diversification.tiny-base.test.ts
  modified:
    - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
    - src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx
    - src/app/(dashboard)/allocations/AllocationsTabs.tsx
    - src/lib/diversification.ts
key-decisions:
  - "D-07 built as decided: the composer's engine set, solver and diversification memo read a key's tiny-base day as a day with no return, from the same per-key lists plan 09 puts on the dashboard payload."
  - "alignConstituentReturns mirrors plan 09's engine rule exactly: axis without a member's named days; correlationDates only when some member names a day that is on the axis; otherwise the output is today's, key for key."
requirements-completed: [SC-2, SC-3, SC-5]
status: complete
commits: 4
plan_head_before: 330d68d7cd84fbce7be5e384c10d301ab874ce29
plan_head_after: ac36914849ac9cd6dccd457351179c2f477df5d0
actuals:
  tokens: 14000
  tasks: 2
  commits: 4
duration: single session
completed: 2026-11-04
---

# Phase 188 Plan 10: the composer, its diversification panel and the tab's compare feed sit a key out of its tiny-base days

**The scenario composer's KPIs, charts, solver and diversification panel now read a key's tiny-base day as a day with no return (not a flat 0%), using the lists plan 09 put on the dashboard payload, and the compare panel gets the same lists from the tab.**

## What was built

- `ScenarioComposer.tsx`: `perKeyAdapterOutput` passes `payload.tinyBaseDaysByApiKeyId ?? {}` as the per-key builder's fourth argument, and the memo lists `payload.tinyBaseDaysByApiKeyId` as a dependency. Nothing else in the composer changed: every unit carries its days (T-KL1-UNIT), so `engineSet`, `scenarioMetrics`, the charts, Monte Carlo/stress/benchmark sections, the target max-DD solver and the diversification memo receive them as they are.
- `AllocationsTabs.tsx`: `comparePanelPayload` carries `tinyBaseDaysByApiKeyId: props.tinyBaseDaysByApiKeyId`, so the compare panel (plan 09) and the composer read one set of days on one screen.
- `diversification.ts`: `alignConstituentReturns` skips a member's named days when it builds the axis (the engine's rule), and only when some member names a day that is on the axis it aligns every `returnsById` array on `correlationDates`, the axis days no member names, returned as an optional field of `AlignedConstituents`. Otherwise it returns exactly today's shape (the key is not even present). The two `AlignedConstituents` doc comments and the function's doc comment are updated. `covarianceMatrix`, `constituentVols` and `computeDiversification` are not edited.

## TDD record

### Task 1: composer and tab feed

- RED (commit 4f2974b56), `/tmp/tinybase-10/red1.log`: the new arm failed on the planned assertion (`expected -0.00435 to be close to -0.00331`: the composer's twr read the two days as 0 against the run with the lists). The new arm sits in the Phase 37 describe and has two oracles: the REAL builder and REAL engine with the lists (the describe's `independentRecompute` idiom, extended by two optional trailing parameters, series and lists, so every existing call is unchanged), and a hand product of typed per-day returns (days 2026-02-07 and 2026-02-08 are key-A alone; the other twelve are `0.7*rA + 0.3*rB`), which does not run the engine. Non-vacuity asserted: the field-less recompute's twr differs from the with-lists twr.
- GREEN (commit 4423175d0): the eight targeted files (`ScenarioComposer`, `ScenarioComposer.added-metrics`, `solve-leverage`, `AllocationsTabs.scenario-composer`, `AllocationsTabs`, `ScenarioComparePanel`, `scenario.tiny-base`, `scenario-tiny-base`), 587 tests passed. No existing test edited; every existing arm of the describe passes unchanged.
- Neuter drill (byte backup `/tmp/tinybase-10/composer.bak`, `cp` restore, `cmp` clean): dropping the builder's fourth argument, `/tmp/tinybase-10/neuter1.log`: 1 failed, 455 passed (the new arm only).
- Acceptance: `grep -ac 'payload.tinyBaseDaysByApiKeyId'` in the composer prints 2 (baseline 0); `grep -ac 'tinyBaseDaysByApiKeyId: props.tinyBaseDaysByApiKeyId'` in the tab prints 1 (baseline 0); `git diff --stat` from the plan base for `KpiStrip.tsx`, `EquityChart.tsx`, `DrawdownChart.tsx` and `book-risk-input.ts` is empty.

### Task 2: diversification alignment

- RED (commit 462425ee5), `/tmp/tinybase-10/red2.log`: 3 failed, 3 passed. Failures on the planned assertions: `correlationDates` undefined (two arms), and the rebuilt rho `-0.2` against the engine's `-0.226`. The three that pass on today's code are the ones that pass by construction: the non-vacuity arm, the no-named-day `toStrictEqual`, and the empty-list/off-axis `toStrictEqual`.
- Fixture is plan 09's A/B/K typed again: 12 days, B lacks 2026-03-07 and 2026-03-08; weights 1 : 3 : 1. Oracles: aligned arrays are the typed series without the two days; `commonDates` length equals the engine's `n` (12); `correlationDates` is 10; rebuilt rho equals the engine's `correlation_matrix` to 3 dp for every pair AND a Pearson written out in the test; the 0-fill reading gives a rho more than 0.001 away from the engine's on at least one pair.
- GREEN (commit ac3691484): the new module (7 tests), `diversification.test.ts`, `ScenarioComposer.test.tsx` and `scenario.tiny-base.test.ts`, 505 tests passed.
- One arm was added in the GREEN commit rather than the RED one: "a day only the naming member has is not on the axis at all" (B carries and names 2026-03-13, nobody else has it; `commonDates` must stay the engine's 12 days). Written after the first neuter drill showed the axis-skip line was not covered by the RED arms (they were all satisfied by A and K supplying the named days). It fails on the neutered axis skip (below) and would have failed on pre-change code (13-day axis).
- Neuter drills (byte backups, `cp` restore, `cmp` clean each time):
  - alignment keeps the full 0-filled axis and drops `correlationDates` (`neuter2.log`): 3 failed, 3 passed (length/values arm, rebuilt-rho arm, windowed arm).
  - the axis loop stops skipping a member's named days (`neuter2b.log`): 1 failed, 6 passed (the new axis arm).
- Acceptance: `grep -ac undefined_return_days src/lib/diversification.ts` prints 4 (baseline 0); `grep -ac correlationDates` prints 7 (baseline 0).

## Gates

- `npx tsc --noEmit`: exit 0, no `error TS`.
- `npx eslint` on every changed src and test file: exit 0 (a Babel deoptimisation note for the 500KB composer test file, not a lint finding).
- `npm run lint`: 0 errors, 2 warnings (the same two pre-existing warnings plan 09 recorded), then the route-contract, planning-hygiene and canonical-domain checks OK.
- Full `npx vitest run` after the last commit: 1211 files (1190 passed, 1 failed, 20 skipped); 23766 tests (23455 passed, 2 failed, 309 skipped). The 2 failures are the KNOWN PRE-EXISTING `src/lib/factsheet/compute.conventions.test.ts` fixture B and fixture C; that file is untouched. `ci-apt-bounded.contract.test.ts` R4 passed in this run.

## DESIGN.md

No string a user reads was added or edited, and no UI element, class or layout changed (a client memo argument, a prop-object field and a pure module). No DESIGN.md check was needed or made.

## Deviations from Plan

None - plan executed exactly as written. No existing test newly failed from this change; the STOP rule did not fire. No existing test was edited except by addition (one arm in `ScenarioComposer.test.tsx`, plus two optional trailing parameters on that describe's `independentRecompute` helper with the previous behaviour as the default).

## Findings for the orchestrator

- **The tab's compare feed has no test that can fail.** I neutered the one added line in `AllocationsTabs.tsx` (the `tinyBaseDaysByApiKeyId: props.tinyBaseDaysByApiKeyId` field): `AllocationsTabs.scenario-composer.test.tsx` and `AllocationsTabs.test.tsx` stay green (72 passed), because the first mocks `ScenarioComparePanel` and its `SavedScenariosList` mock does not expose `onCompare`. The plan names the field's presence only through a grep acceptance criterion and lists no AllocationsTabs test file, so I did not add one (the plan's must_haves say no file outside its five changes, for mergeability with Phase 186). The wiring is a one-line pass-through of a prop the panel already tests (plan 09's `ScenarioComparePanel.test.tsx` proves the panel through its `payload` prop). If the founder wants this arm to be able to fail, it needs a small additive test in `AllocationsTabs.scenario-composer.test.tsx` (expose `onCompare` in the list mock, capture the panel mock's `payload`); I left it for a decision.

## Recorded consequences and carried limits

- **KL-5 (plan 09) is carried and unchanged:** a strategy added in the composer (`mergeAddedIntoPerKeySet`) carries no `undefined_return_days`, so the engine still 0-fills a day its stored series lacks inside a blend, as for any absent day today; a shared scenario's published series likewise.
- **KL-4 (plan 09) applies here unchanged:** a key with no list (failed `key_inputs` read or malformed list) is computed exactly as before this phase.
- On a named day the diversification panel (like the engine's matrix) drops that day for EVERY pair, not only the named key's pairs (T-KL1-CORR cost, from plan 09), so DR, ENB and PCR sit on 10 days where the KPIs sit on 12. This is the consistency the panel needs to reproduce the engine's matrix.
- No migration, no Python, no PROD/TEST/Railway access, no Supabase query, no package change.

## Known Stubs

None.

## Threat Flags

None. T-188-25 is mitigated by the composer passing the lists to plan 09's builder, the alignment on the engine's correlation set, the rebuilt-rho pin tying the panel to the engine, and RED arms plus neuter drills proving each can fail (except the tab's one-line feed, see Findings).

## Self-Check: PASSED

- Created file present: `src/lib/diversification.tiny-base.test.ts`.
- Commits present on `wt/188-p10`: 4f2974b56, 4423175d0, 462425ee5, ac3691484.
- `.planning/STATE.md` and `.planning/ROADMAP.md` untouched; no file outside the plan's five changed.
