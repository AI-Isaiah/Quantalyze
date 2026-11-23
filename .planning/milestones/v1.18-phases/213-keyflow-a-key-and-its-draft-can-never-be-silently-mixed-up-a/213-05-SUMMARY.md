---
phase: 213-keyflow-a-key-and-its-draft-can-never-be-silently-mixed-up-a
plan: 05
subsystem: ui
tags: [react, scenario-composer, blend-basis, vitest, sc-4, sc-6]

requires:
  - phase: 159-04
    provides: "RANK-06: a null asset class derives the conservative 365 clock (kept; only its interim render is superseded)"
provides:
  - "legsPending: the one pending boolean over every engine-set leg, beside blendBasis"
  - "gatedBlendMetrics nulls volatility, sharpe, sortino and cagr while any leg's probe is open, so the strip's Sharpe cell reads the silent em-dash"
  - "F5: a failed probe is terminal for the hydration effect; remove + re-add is the retry"
affects: [213-09, 213-10, 213-11]

actuals:
  tokens: 5043
  tasks: 2
  commits: 2
plan_head_before: e71d40b0fb0edcd987bfe22c577b6e2f74684972
plan_head_after: 5cfdb3787bf56605f92d9e77d9b992adba1e6bb2

tech-stack:
  added: []
  patterns:
    - "Pending is derived once from existing state (lookup metricsState + in-flight set) and gates consumers; the 365/252 rule stays blendPeriodsPerYear alone (MD-01)"
    - "Real KpiStrip delegated to inside a mocked-strip test file so the cell text the user reads is what is asserted"

key-files:
  created: []
  modified:
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.added-metrics.test.tsx"

key-decisions:
  - "legsPending counts every engine-set leg, selected or not (UI-SPEC 4.1 literal reading of decision (d))"
  - "A settled null class or a failed probe is resolved and keeps the nullish => 365 rule, so pending always ends"
  - "F5 option 1: the hydration effect skips ids whose addedMetricsById entry is unavailable, with no second dedup mechanism"

patterns-established:
  - "Strip assertions on a held figure pin literals measured once (8.36 book alone on 252, 10.07 book alone on 365, 7.96 final 252, 9.57 final 365), never re-derived through the formatter"

requirements-completed: []

coverage:
  - id: D1
    description: "A drawer leg with an open probe holds the strip's Sharpe at the em-dash, then one number on the 252 clock once the probe answers traditional"
    verification:
      - kind: automated_ui
        ref: "src/app/(dashboard)/allocations/components/ScenarioComposer.added-metrics.test.tsx#decision (d): a traditional drawer leg whose probe is held open reads the em-dash, then ONE number on the 252 clock"
        status: pass
    human_judgment: false
  - id: D2
    description: "The interim 365 and final 252 Sharpe literals differ, so the hold case proves a real basis flip"
    verification:
      - kind: automated_ui
        ref: "src/app/(dashboard)/allocations/components/ScenarioComposer.added-metrics.test.tsx#decision (d) control: the interim 365 clock and the final 252 clock give DIFFERENT Sharpe literals"
        status: pass
    human_judgment: false
  - id: D3
    description: "A failed probe ends pending, is never re-fetched behind the user's back, the explicit remove + re-add retry still works, and a book-only scenario is never held"
    verification:
      - kind: automated_ui
        ref: "src/app/(dashboard)/allocations/components/ScenarioComposer.added-metrics.test.tsx#F5 / decision (d) (three cases) and #decision (d): a book-only scenario is never held"
        status: pass
    human_judgment: false

duration: 7min
completed: 2026-11-14
status: complete
---

# Phase 213 Plan 05: Composer pending hold Summary

**The composer's blend strip holds Sharpe at the silent em-dash while any leg's asset-class probe is open, shows one number on the final basis, and a failed probe is terminal for the hydration effect so it is never silently re-fetched.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-11-14T16:02:34Z
- **Completed:** 2026-11-14T16:09:22Z
- **Tasks:** 2
- **Files modified:** 2 (one source, one test)

## Accomplishments

- `legsPending` memo beside `blendBasis` over every engine-set leg (selected or not). A leg is pending when it has a lookup entry (a drawer leg) and is in the in-flight set or its `metricsState` is `pending`. Book legs are never pending. `blendPeriodsPerYear` and `blendBasis` are untouched (no local 365/252 ternary).
- `gatedBlendMetrics` returns `null` for volatility, sharpe, sortino and cagr while pending. `KpiStrip` paints only Sharpe of these, so its Sharpe cell reads the silent `—`; no caption, spinner or copy. The dated comment cites decision (d) and that 159-04's interim-basis render is superseded.
- F5 option 1: the hydration `useEffect` adds `addedMetricsById[a.id] !== "unavailable"` to its guard and `addedMetricsById` to its deps. Removal already purges the entry in `handleRemoveAdded`, so no extra clearing was needed and remove + re-add remains the retry.
- Pins in `ScenarioComposer.added-metrics.test.tsx` (new describe, real `KpiStrip` delegated to so the asserted text is the cell the user reads): held-open flip, control showing the two clocks differ, failed probe ends pending, retry-after-failure (leg A failed, leg B added and settled), explicit remove + re-add retry, book-only never held.

## Task Commits

1. **Task 1: end-to-end hold (tracer)** - `bc445a280` (feat)
2. **Task 2: failed probe is terminal (F5, tdd)** - `5cfdb3787` (feat)

**Plan metadata:** the docs commit that carries this SUMMARY.

## Files Created/Modified

- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` - `legsPending`, held `gatedBlendMetrics`, F5 guard on the hydration effect
- `src/app/(dashboard)/allocations/components/ScenarioComposer.added-metrics.test.tsx` - the `KpiStrip` import and the new decision (d) / F5 describe

## SC-6 neuter evidence

Byte backups in the scratchpad, restored with `cp`, `shasum -a 256` matched each time (Task 1 `836e4141...`, Task 2 `b0b4611b...`). No `git checkout`, `git restore` or `git stash` was used.

- **Task 1 neuter** (`gatedBlendMetrics` ignores `legsPending`: the four ternaries became `false ? null : ...`): both new cases RED.
  - `decision (d): a traditional drawer leg whose probe is held open reads the em-dash, then ONE number on the 252 clock` - `AssertionError: expected '10.07' to be '—'`
  - `decision (d) control: the interim 365 clock and the final 252 clock give DIFFERENT Sharpe literals...` - `AssertionError: expected '10.07' to be '—'`
  - Pre-implementation RED (same case, before any source change) failed on the same assertion for the same reason.
- **Task 2 neuter** (removed the `!== "unavailable"` conjunct): three cases RED.
  - `F5 / decision (d): leg A failed, then leg B is added and settles - A is NOT re-fetched...` - `AssertionError: expected '7.96' to be '10.07'` (the silent retry succeeded and the figure moved from the 365 number to the 252 number)
  - `F5 / decision (d): a leg whose probe FAILED ends pending, and the figure stays on the 365 rule` - `AssertionError: expected '7.96' to be '10.07'`
  - `F5 / decision (d): remove + re-add is the retry...` - RED under the neuter (this case's own assertion text was not captured individually; the run reported 3 failed, 3 passed)
- **Task 2 TDD RED before the fix:** target `F5 / decision (d): leg A failed, then leg B is added and settles...`, failing line `AssertionError: adding leg B re-fetched the failed leg A behind the user's back: expected 2 to be 1`. `gsd_run check tdd-red-evidence` on the TAP record returned `RED_EVIDENCE_OK` (`target_test_failed`, 1 failing test). Semantic assessment: the target executed and failed on the planned assertion (the failed leg is requested twice), not on setup, import or a fixture fault.

## Moved pins (same-commit rule)

None. All four composer suites (`added-metrics`, `ScenarioComposer.test`, `d11`, `constituent-figure-gate`) stayed green after each change: 536 passed at baseline, 538 after Task 1, 542 after Task 2. No case expected an interim-basis number while a probe was open, and none expected a failed leg to be re-fetched, so nothing was edited, retitled or deleted.

## Verification

- Four composer suites: 4 files, 542 passed (final run).
- `npx tsc --noEmit -p tsconfig.json`: clean.
- `npm run lint`: 0 errors (4 pre-existing warnings in unrelated files `composite-read-path.ts` and `queries.stale-analytics-detail.test.ts`; the repo checks `check-planning-hygiene`, route and domain manifests OK).
- `node scripts/verify-plan-anchors.mjs` on the plan: OK, 6 claims.
- SC-5: `git diff --stat <merge-base> -- supabase/` prints nothing.
- Acceptance grep: `grep -v '^\s*//' ScenarioComposer.tsx | grep -c legsPending` = 6 (HEAD was 0, expect >= 3).

## Decisions Made

- Sharpe literals are measured once and pinned: book alone 8.36 (252), book alone 10.07 (365 interim, the number the hold withholds), final 7.96 (252, book plus traditional drawer leg), final 9.57 (365, drawer leg answered null or beside a failed leg). 9.57 / 7.96 is about 1.202, the sqrt(365/252) ratio, so the two clocks genuinely differ.
- The "three slots" wording in plan 05 Task 2's behaviour text is not asserted: the strip paints only the Sharpe cell, so the book-only case asserts Sharpe only (per the dispatch note and truth 1).

## Deviations from Plan

### Auto-fixed Issues

None for the source change. One test-harness note:

**1. [Process] TDD RED not committed separately for Task 2**
- **Found during:** Task 2
- **Issue:** the plan's same-commit rule forbids a commit that carries a red test, so Task 2 is one `feat` commit rather than `test` then `feat`.
- **Fix:** the RED was observed and classified (`RED_EVIDENCE_OK`) before the fix and is recorded above. No separate `test(213-05)` commit exists.
- **Files modified:** none beyond the task files.

---

**Total deviations:** 0 source deviations, 1 process note (no separate RED commit, by the plan's own rule).
**Impact on plan:** none; every success criterion in the plan holds.

## TDD Gate Compliance

`git log --grep='^test\(213-05\)'` returns no commit and a `feat(213-05)` commit exists for each task. This is the plan's single-commit-per-task shape (no red commit is allowed), not a skipped gate; the RED evidence is above.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path, file access or schema surface. T-213-11 (strip figures) and T-213-13 (failed probe retry) are mitigated and pinned as above.

## Issues Encountered

- The strip is mocked in the file, so a first attempt to read the Sharpe cell returned an empty string for a mocked node; the new describe delegates to the real `KpiStrip` (restored in `afterEach`) and finds the cell through its `data-term` label.
- The book-only case first failed because the empty-blend render before the book leg joins carries a null Sharpe; the helper now returns the render count just before the add and the case slices from there.

## Next Phase Readiness

`legsPending` is ready for plan 11 (gate caption and peer-rank request), plan 09 (rolling panels, deltas, persistence pin) and plan 10 (benchmark section and factsheet preview, where the CAGR rule lives). `gatedBlendMetrics` already nulls cagr while pending; plan 10 owns the two-basis CAGR rule for the factsheet preview.

---
*Phase: 213-keyflow-a-key-and-its-draft-can-never-be-silently-mixed-up-a*
*Completed: 2026-11-14*
