---
phase: 213-keyflow-a-key-and-its-draft-can-never-be-silently-mixed-up-a
plan: 10
subsystem: ui
tags: [react, scenario-composer, blend-basis, benchmark, factsheet-preview, vitest, sc-4, sc-6]

requires:
  - phase: 213-05
    provides: "legsPending memo beside blendBasis; deferredReturnsFetch() harness and the real-KpiStrip decision (d) describe"
  - phase: 213-09
    provides: "rolling panels, delta consumers and persistence pin held; the own-book caption gap handed to this plan"
  - phase: 213-11
    provides: "gate caption and peer-rank hold; mountWithBookLeg fixture"
provides:
  - "ScenarioBenchmarkSection takes an optional basisPending: TE, IR and Alpha read the dash inside the populated layout, no annualization note, no '{N}-day annualized' sentence; beta kept; empty states still decided by data only"
  - "buildScenarioFactsheetPayload takes an optional basisPending that holds every basis-dependent preview slot silently; slot map recorded in its docblock"
  - "ScenarioFactsheetChart forwards basisPending; the composer passes basisPending={legsPending} to both consumers"
affects: [213-12]

actuals:
  tokens: 12430
  tasks: 2
  commits: 2
plan_head_before: 0cff260d94147fa7ba925893fd4b7f9847012062
plan_head_after: 26b8f16178aab640dab5ceb7cb69f7008136ae82

tech-stack:
  added: []
  patterns:
    - "A held consumer takes the form its renderer already prints as nothing (NaN dash, absent field, absent carve-out), never an empty form that names a cause"
    - "Differential render of the real FactsheetBody, settled first (non-vacuous), then pending"

key-files:
  created:
    - "src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.pending.test.tsx"
  modified:
    - "src/app/(dashboard)/allocations/components/ScenarioBenchmarkSection.tsx"
    - "src/app/(dashboard)/allocations/components/ScenarioBenchmarkSection.test.tsx"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.added-metrics.test.tsx"
    - "src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.tsx"
    - "src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.ts"

key-decisions:
  - "The hand-off gap (OwnBookDeltaPanel prints sample/{N} basis with records withheld, reading the interim 365) is closed by leaving scenarioOwnBookDelta off the held payload, the panel's existing silently-absent path; no FactsheetBody prop was needed, so the plan's STOP rule did not trigger"
  - "scenarioPeer is left off the held payload for the same reason: PeerPercentilePanel prints sample/{N} basis and, once figureRecord is held back, N would read the interim 365"
  - "rollingWindow while pending keeps window and label and drops only annualization (absent verdict = figures as carried, no note); emptyBlendRollingWindow() was rejected because withheld/record prints a cause"
  - "bootstrapCI while pending blanks only Sharpe and Sortino (NaN, empty histogram, n_valid omitted); emptyBootstrapCI() (n 0) and n_valid 0 were rejected because they print 'drawn from 0 observations' and 'no resample has a Sharpe'"
  - "CAGR and Calmar are held only when the 365 and 252 gate verdicts for the blend record differ (UI-SPEC 4.3 CAGR rule); verified by diffing compute() at 252 vs 365 that only ann_vol, sharpe, sortino move"

patterns-established:
  - "Pending hold for a child that cannot be given a new prop: strip the input at the builder, not the renderer"

requirements-completed: [SC-4, SC-6]

coverage:
  - id: D1
    description: "Benchmark section: TE, IR and Alpha read the dash, no note, no basis sentence, beta kept, no empty state because of pending; numbers return once on the final basis"
    verification:
      - kind: automated_ui
        ref: "src/app/(dashboard)/allocations/components/ScenarioBenchmarkSection.test.tsx#decision (d): pending shows TE, IR and Alpha as the dash, Beta as a number, no note, no annualization sentence"
        status: pass
      - kind: automated_ui
        ref: "src/app/(dashboard)/allocations/components/ScenarioComposer.added-metrics.test.tsx#decision (d): the benchmark section blanks TE, IR and Alpha, names no basis and never shows its empty state while a leg's probe is open, then shows numbers once on the 252 clock"
        status: pass
    human_judgment: false
  - id: D2
    description: "Factsheet preview: Ann. Volatility, Sharpe, Sortino, rolling series, 1y window, bootstrap Sharpe/Sortino and every basis caption are held; settled render of the same blend shows numbers and its captions"
    verification:
      - kind: automated_ui
        ref: "src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.pending.test.tsx#decision (d): Ann. Volatility, Sharpe and Sortino read the dash, no basis caption is printed, and the settled render of the same blend shows numbers and its captions"
        status: pass
      - kind: automated_ui
        ref: "src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.pending.test.tsx#decision (d): the 1y rolling window and its table are not drawn while pending, and are on offer once settled"
        status: pass
    human_judgment: false
  - id: D3
    description: "No sample/{N} basis word prints while pending (the own-book and peer panels are absent), and both read sample/252 once settled; closes the 213-09 Known Gap"
    verification:
      - kind: automated_ui
        ref: "src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.pending.test.tsx#decision (d): no sample/{N} basis caption is printed while pending: the own-book and peer panels are absent, and read sample/252 once settled"
        status: pass
    human_judgment: false
  - id: D4
    description: "Default off is byte-identical: omitted or false basisPending deep-equals today's payload, so the v2 factsheet suites are unaffected; the composer wires legsPending to both consumers"
    verification:
      - kind: automated_ui
        ref: "src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.pending.test.tsx#decision (d): basisPending omitted or false builds a payload deep-equal to today's"
        status: pass
      - kind: automated_ui
        ref: "src/app/(dashboard)/allocations/components/ScenarioComposer.added-metrics.test.tsx#decision (d): the factsheet preview is handed basisPending while a leg's probe is open, and not before or after"
        status: pass
    human_judgment: false

duration: 34min
completed: 2026-11-14
status: complete
---

# Phase 213 Plan 10: Benchmark and factsheet preview hold Summary

**The "vs BTC" section and the composer's factsheet preview now hold every basis-dependent figure and basis caption silently while a leg's asset-class probe is open (one optional `basisPending` input each, wired from `legsPending`), then render once on the final basis.**

## Accomplishments

- **Task 1 (tracer).** `ScenarioBenchmarkSection` takes `basisPending` (default false). Pending: Tracking Error, Information Ratio and Alpha are formatted from `null` (the em-dash), the annualization note is not rendered, and the methodology line keeps `methodologyLine(n)` without the "Metrics are {N}-day annualized active returns." sentence. Beta is untouched. The three empty-state branches sit above the metrics path and are decided by data presence only, so pending never selects one. The composer passes `basisPending={legsPending}`.
- **Task 2 (tdd).** `buildScenarioFactsheetPayload` takes `basisPending` (default false). After the normal computation it replaces only the slots in the slot map recorded in its docblock: `ann_vol`/`sharpe`/`sortino` NaN; `cagr`/`calmar` NaN only when the 365 and 252 gate verdicts for the blend record differ; `figureRecord` omitted; the six rolling series empty (row window `[]`, 1y `null` with `rollingWindow1y` null); `rollingWindow.annualization` omitted; bootstrap Sharpe and Sortino blanked with Max Drawdown, `n_resamples`, `block_len`, `n` kept; `scenarioPeer` and `scenarioOwnBookDelta` left off. `ScenarioFactsheetChart` forwards the prop into the builder call and its memo deps; the composer passes `legsPending`.
- **The 213-09 hand-off gap is closed.** `OwnBookDeltaPanel` printed `sample/{N} basis` reading the interim 365 once `records` were withheld. No silent path existed inside the panel, but the panel's existing silently-absent path (no `scenarioOwnBookDelta`) does, and the builder is this plan's file. So the held payload omits the carve-out and the panel is absent while pending, then appears on the settled basis. The peer panel prints the same caption and, with `figureRecord` held, would read 365 too, so `scenarioPeer` is omitted the same way (defence in depth: the composer already nulls it, but its effect runs after the first held render).
- **Step 1 measurements (the plan's open question).** `rollingWindow.annualization` withheld/`record` and `emptyBootstrapCI()` both print a cause, so neither was used (see key-decisions). An absent verdict and an `n_valid`-less NaN Sharpe/Sortino print nothing. `rollingWindow1y` null already unmounts the 1y table and window choice. No `FactsheetBody` prop was needed, so the STOP rule did not trigger for `rollingWindow.annualization`, `rollingWindow1y`, `bootstrapCI`, or the own-book caption.

## Task Commits

1. **Task 1 (tracer): benchmark hold** - `e3a5777e7` (feat)
2. **Task 2 (tdd): factsheet preview hold** - `26b8f1617` (feat)

## SC-6 neuter evidence

Byte backups in a `mktemp -d` scratch dir, restored with `cp`, `shasum -a 256` matched after every restore (section `706c5202...`, composer `f19dfcc3...` / `4cca688a...`, builder `13675bc5...`). No `git checkout`, `git restore` or `git stash` was used.

**Task 1**
- Ignore `basisPending` in `ScenarioBenchmarkSection`: RED.
  - `ScenarioBenchmarkSection decision (d): basisPending > decision (d): pending shows TE, IR and Alpha as the dash, Beta as a number, no note, no annualization sentence` - `AssertionError: expected '+32.30%' to be '—'`
  - `decision (d): the benchmark section blanks TE, IR and Alpha, names no basis and never shows its empty state while a leg's probe is open, then shows numbers once on the 252 clock` - `AssertionError: expected '+17.89%' to be '—'`
- Composer passes `basisPending={false}` (prop dropped at the mount): the composer-level case RED with `AssertionError: expected '+17.89%' to be '—'`.

**Task 2** (builder `scenario-factsheet-payload.ts`)
- (i) Ignore `basisPending` entirely: 8 of 11 RED, including the differential render `decision (d): Ann. Volatility, Sharpe and Sortino read the dash, no basis caption is printed, and the settled render of the same blend shows numbers and its captions` - `AssertionError: expected '7.17%' to be '—'`; the 1y case `AssertionError: expected <div …(1)>…(1)</div> to be null`; the deep-equal case `expected {…} to not deeply equal {…}`.
- (ii) Keep `figureRecord` while pending: the builder case (`expected true to be false`) and the differential render RED on `AssertionError: expected 'Full history: …' not to contain 'CAGR, volatility, Sharpe, Sortino and…'` (the no-caption assertion).
- (iii) Keep the rolling annualization verdict: `AssertionError: expected { state: 'short', days: 126, …(1) } to be undefined` and the render case `not to match /annualized from/i`.
- (iv) Keep the two carve-outs: `the peer and own-book carve-outs are left off while pending…` (`expected true to be false`) and `no sample/{N} basis caption is printed while pending…` (`not to match /sample\/\d+ basis/`).
- (v) Do not blank the bootstrap Sharpe/Sortino: builder case and the render case on `AssertionError: expected '[1.05, 11.87]' to be '[—, —]'`.
- (vi) CAGR rule never holds: `CAGR and Calmar are NaN when the verdicts differ (70 days…)` RED (`expected false to be true`).
- Composer drops `basisPending={false}` at the chart mount: `decision (d): the factsheet preview is handed basisPending while a leg's probe is open, and not before or after` - `AssertionError: a render between the add and the answer was not held: expected false to be true`.

**TDD RED before the fix (Task 2).** Target file `scenario-factsheet-payload.pending.test.tsx`, run before any source change: 6 of 9 cases failed on the planned assertions (`expected false to be true` for the NaN/absent/empty slots, `expected '7.17%' to be '—'` on the rail's Ann. Volatility, `expected <div> to be null` for the 1y table, `expected {…} to not deeply equal {…}` for the held-vs-today payload). Semantic assessment: each target executed and failed on the held value it names (a number or caption still on screen), not on import, setup or fixture. One earlier fixture slip (a 199-day constant where the real covered span is 200) was fixed before this RED run. `gsd_run check tdd-red-evidence` was not run; the evidence is the vitest assertion text above.

## Moved pins (same-commit rule)

None. The composer suites (`added-metrics`, `ScenarioComposer.test`, plus the 213-05/09/11 cases) and both existing `FactsheetBody` suites stayed green after each change. No existing case expected a basis-dependent figure or basis text while a drawer leg's probe was open, so nothing was edited, retitled or deleted.

## Verification

- Task 1 verify (`ScenarioBenchmarkSection.test`, `ScenarioComposer.added-metrics.test`, `ScenarioComposer.test`): 3 files, 528 passed.
- Task 2 verify plus the benchmark file: 6 files, 555 passed; the new pending file is in the reported list (11 cases).
- Full v2 factsheet suite `src/app/factsheet/[id]/v2`: 124 files, 1722 passed. `src/app/(dashboard)/allocations/widgets/performance`: 22 files, 252 passed.
- `npx tsc --noEmit -p tsconfig.json`: clean.
- `npm run lint`: 0 errors (4 pre-existing warnings in unrelated files); planning-hygiene, route, domain checks OK.
- `node scripts/verify-plan-anchors.mjs` on the plan: OK, 6 claims.
- SC-5: `git diff --stat -- supabase/` prints nothing.

## Deviations from Plan

**1. [Process] The composer-level benchmark case lives in `ScenarioComposer.added-metrics.test.tsx`, not `ScenarioComposer.test.tsx`.** The plan lists `ScenarioComposer.test.tsx` among the files, but the `deferredReturnsFetch` / `mountWithBookLeg` harness that can hold a probe open (plans 05, 09, 11) is in the added-metrics file, and that file renders the real `ScenarioBenchmarkSection`. `ScenarioComposer.test.tsx` needed no edit (it still passes unedited).

**2. [Rule 2 - Missing critical functionality] `scenarioPeer` also left off the held payload.** The plan names the own-book gap only. With `figureRecord` held, `PeerPercentilePanel` would read basis 365 and print `sample/365 basis` on a stale peer from the previous blend (the composer's peer effect runs after the first held render). Same builder file, same mechanism, pinned by the carve-out cases.

**3. [Process] The Task 1 composer test had a TS2554 (`fetchMock(url, init)`, one-arg mock) that tsc caught at end of plan.** Fixed in the Task 2 commit (same file as that commit's new composer case); no behaviour change.

**4. [Process] Neither task has a separate RED commit**, per the plan's same-commit rule (no commit carries a red test). Task 1 is a tracer with a neuter-proven pin; Task 2's RED is recorded above.

**Total deviations:** 1 Rule 2, 3 process notes. **Impact on plan:** none on scope or files beyond the above.

## TDD Gate Compliance

`git log --grep='^test\(213-10\)'` returns nothing: both tasks are single `feat` commits because the plan forbids committing a red test. RED evidence for Task 2 is recorded in the SC-6 section above.

## Known Gaps (recorded, not fixed here)

- **Zoomed window while pending.** The held payload still carries the interim `periodsPerYear`, which `windowView` reads when the user zooms the preview to a sub-range (3M/6M/12M) during the open-probe window, so a zoomed range's Sharpe/Sortino/Ann. Volatility is derived on the interim basis. Closing it needs a hold input on `FactsheetBody` (a shared public surface outside this plan's files, and the plan's STOP rule says not to improvise one). Omitting `periodsPerYear` instead would print the window's "needs an annualization basis" reason, which is worse. Surface for a follow-up decision: either a `FactsheetBody` hold prop or disabling the preview's period control while `basisPending`. Recorded in the builder docblock.
- **Own-book panel absent while pending.** The Max DD delta row (basis-invariant) disappears for the open-probe window with the rest of the panel, because the panel has no per-row silent path. It returns on the settled basis.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path, file access or schema surface. T-213-23 and T-213-24 are mitigated and pinned (neuter-proven); T-213-25 holds: pending never selects an empty or unavailable branch, and caption-printing empty forms (`emptyBlendRollingWindow()`, `emptyBootstrapCI()`) are not used while pending.

## Next Phase Readiness

Together with plans 05, 09 and 11, every composer consumer of `blendBasis` is held while a leg's probe is open, except the zoomed-window gap above. Plan 12 is unaffected.

## Self-Check: PASSED

All seven source/test files exist and are committed; commits `e3a5777e7` and `26b8f1617` are ancestors of HEAD.

---
*Phase: 213-keyflow-a-key-and-its-draft-can-never-be-silently-mixed-up-a*
*Completed: 2026-11-14*
