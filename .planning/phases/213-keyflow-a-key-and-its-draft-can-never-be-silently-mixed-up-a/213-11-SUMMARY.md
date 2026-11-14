---
phase: 213-keyflow-a-key-and-its-draft-can-never-be-silently-mixed-up-a
plan: 11
subsystem: ui
tags: [react, scenario-composer, blend-basis, peer-rank, vitest, sc-4, sc-6]

requires:
  - phase: 213-05
    provides: "legsPending memo beside blendBasis; deferredReturnsFetch() harness and the real-KpiStrip decision (d) describe"
provides:
  - "The blend gate caption (scenario-figure-gate-note) renders only when not legsPending"
  - "peerSharpe / peerSortino are null while legsPending, so no /api/scenario/peer-rank request is made; one request follows the settle with the raw final values"
affects: [213-09, 213-10]

actuals:
  tokens: 4200
  tasks: 2
  commits: 3
plan_head_before: 8416e18bf5c84157f4b6e05be9da1cda8b5487db
plan_head_after: b48c42281b1964ae55ed64c8f30faeeb34b5e638

tech-stack:
  added: []
  patterns:
    - "Strip-adjacent consumers of the blend basis are gated on the single legsPending boolean; the 365/252 rule stays blendPeriodsPerYear alone"

key-files:
  created: []
  modified:
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.added-metrics.test.tsx"

key-decisions:
  - "The peer-rank hold only nulls the two ranked inputs; it never applies a basis factor (BLEND-01 fence kept and annotated)"
  - "The caption case uses a 200-day record (short, so the caption is genuinely on offer on a settled render); the 400-day fixtures render no caption and cannot exercise the surface"

requirements-completed: []

coverage:
  - id: D1
    description: "The gate caption is absent while a drawer leg's probe is open and returns exactly once after the answer"
    verification:
      - kind: automated_ui
        ref: "src/app/(dashboard)/allocations/components/ScenarioComposer.added-metrics.test.tsx#decision (d): the gate caption is silent while a drawer leg's probe is open, then returns once on the final basis"
        status: pass
    human_judgment: false
  - id: D2
    description: "No peer-rank request while a leg is pending; exactly one after the settle, carrying the raw final Sharpe (the figure the strip shows)"
    verification:
      - kind: automated_ui
        ref: "src/app/(dashboard)/allocations/components/ScenarioComposer.added-metrics.test.tsx#decision (d): no peer-rank request is made while a leg is pending; exactly one follows the settle, carrying the raw final Sharpe"
        status: pass
    human_judgment: false

duration: 6min
completed: 2026-11-14
status: complete
---

# Phase 213 Plan 11: Gate caption and peer-rank hold Summary

**While any leg's asset-class probe is open the composer shows no gate caption and sends no peer-rank request; both arrive once, on the final basis, after the last leg settles.**

## Accomplishments

- `blendGateNote` now renders only under `blendGateNote !== null && !legsPending`. Its verdict reads `blendRecord`, built at `blendBasis`, so its text was basis-dependent during the interim 365 clock. Dated comment cites decision (d).
- `peerSharpe` / `peerSortino` are `null` while `legsPending`; `buildScenarioPeerRankRequest` returns null on a null Sharpe/Sortino, so the existing effect sets `scenarioPeer` to null (the panel's reason-free absence) and fetches nothing. When the last leg settles the inputs change and the effect requests once. The BLEND-01 fence comment is kept, with a dated note that the hold only nulls inputs and never rescales.
- Cases (in the plan 05 decision (d) describe, real `KpiStrip`): caption silent then once; peer-rank none while pending then exactly one with `body.sharpe.toFixed(2) === "7.96"`, the same literal the strip shows on the final 252 clock (so the BLEND-01 raw-value fence is pinned too). Each case first asserts the non-vacuous settled state (caption present with the book leg alone; one peer-rank call with the book leg alone).
- The shared fixture helpers `bookPayload` / `mountWithBookLeg` take an optional series (default unchanged) so the 200-day record reuses them.

## Task Commits

1. **Task 1 (tracer): gate caption silent while pending** - `311105be9` (feat)
2. **Task 2 (tdd): no peer-rank request while pending** - `6ceacea07` (feat)
3. **Type fix for the peer-rank call tuple in the new test** - `b48c42281` (test)

## SC-6 neuter evidence

Byte backups in the scratchpad, restored with `cp`, `shasum -a 256` matched each time (Task 1 `31998d38...`, Task 2 `77145f1f...`). No `git checkout`, `git restore` or `git stash` was used.

- **Task 1 neuter** (render the caption regardless of `legsPending`): RED.
  - `decision (d): the gate caption is silent while a drawer leg's probe is open, then returns once on the final basis` - `AssertionError: expected <p …(2)></p> to be null` (the caption `CAGR, volatility, Sharpe, Sortino and Calmar are annualized from 200 days of overlapping record, under one year.` was on screen mid-hold).
  - Pre-implementation RED was the same assertion for the same reason.
- **Task 2 neuter** (pass raw `scenarioMetrics.sharpe` / `.sortino` while pending): RED.
  - `decision (d): no peer-rank request is made while a leg is pending; exactly one follows the settle, carrying the raw final Sharpe` - `AssertionError: a peer-rank request went out while the drawer leg's probe was open: expected [ [ …(2) ], [ …(2) ] ] to have a length of 1 but got 2`.
  - Pre-implementation RED (TDD, before the fix) failed on that same line; the target executed and failed on the planned assertion (a request leaves while pending), not on setup, import or fixture. The `gsd_run check tdd-red-evidence` classifier was not run; the evidence is the vitest assertion text recorded here.

## Moved pins (same-commit rule)

None. All four composer suites (`added-metrics`, `ScenarioComposer.test`, `d11`, `constituent-figure-gate`) stayed green after each change: 542 at baseline, 543 after Task 1, 544 after Task 2. No existing case expected the gate caption or a peer-rank request while a drawer leg's probe was open, so nothing was edited, retitled or deleted.

## Verification

- Four composer suites: 4 files, 544 passed (final run).
- `npx tsc --noEmit -p tsconfig.json`: clean (after the type fix commit).
- `npm run lint`: 0 errors (4 pre-existing warnings in unrelated files).
- `node scripts/verify-plan-anchors.mjs` on the plan: OK, 4 claims.
- SC-5: `git diff --stat <merge-base> -- supabase/` prints nothing.

## Deviations from Plan

**1. [Process] Task 2 has no separate RED commit.** The plan's same-commit rule forbids a commit carrying a red test, so Task 2 is one `feat` commit; the RED was observed before the fix and is recorded above. Same shape as plan 05.

**2. [Process] A third commit for a tsc error in my new test.** The first Task 2 commit carried a TS2352 in the `peerCalls` helper (caught by the end-of-plan `tsc`); fixed in `b48c42281`, no behaviour change.

**Total deviations:** 0 source deviations, 2 process notes. **Impact on plan:** none.

## TDD Gate Compliance

`git log --grep='^test\(213-11\)'` returns only the type-fix commit, not a RED gate commit; the plan's single-commit-per-task shape forbids committing a red test, so RED evidence is recorded above rather than as a commit.

## Known Stubs

None.

## Threat Flags

None. T-213-12 (interim-basis peer rank) and T-213-26 (interim-basis caption) are mitigated and pinned as above.

## Next Phase Readiness

`legsPending` now gates every strip-adjacent basis consumer owned by plans 05 and 11. Plans 09 (rolling panels, deltas, persistence pin) and 10 (benchmark section, factsheet preview, two-basis CAGR rule) remain.

---
*Phase: 213-keyflow-a-key-and-its-draft-can-never-be-silently-mixed-up-a*
*Completed: 2026-11-14*
