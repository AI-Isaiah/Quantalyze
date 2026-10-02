---
phase: 58-coverage-legibility-disclosure
plan: 02
subsystem: ui
tags: [react, tailwind-v4, scenario-composer, coverage-window, a11y, include-cost]

# Dependency graph
requires:
  - phase: 58 (plan 01)
    provides: "CoverageStateChip.tsx (with the amber auto-excluded variant already built + unit-tested), the composer.-prefixed storage, and the wired composer surfaces"
  - phase: 57 (window control & auto-toggle state machine)
    provides: "AutoExcludedRow, the autoExcluded memo, applyWindow, coverageEligible, selectedSpanById, the :1813 desync guard, the coverage-window control"
  - phase: 55 (frozen blend engine)
    provides: "scenario.ts member_count/member_ids (the honest divisor the include oracle reads) + scenario-window.ts intersectionOf"
provides:
  - "AutoExcludedRow extended (COVERAGE-02): the amber 'Outside window' CoverageStateChip alongside the existing coverageDropReason text — the third visually-distinct per-row state now renders"
  - "AutoExcludedRow include-cost text-button (COVERAGE-04): 'Include → shortens window to {date} (−{N} mo)' — the cost is disclosed in the label before applying, one reversible click via applyWindow"
  - "includeCostFor() pure helper — delegates the include-target bound math to scenario-window.ts intersectionOf, month cost via dateday diffDays (timezone-free)"
affects: [58-03 (POLISH-03 note reuses the same auto-excluded group anchor), 60 (golden/e2e re-bake picks up the new include button + amber chip)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Include-cost apply routes through the existing applyWindow path (never a bespoke window setter) so the Phase-57 auto-toggle state machine re-runs downstream and the divisor is re-derived by the engine"
    - "Bound math delegated to scenario-window.ts intersectionOf — the include target is intersectionOf([currentWindow-as-span, strategySpan]); no hand-rolled Math.min/max over date strings (Rule 2)"
    - "Month-delta folded from timezone-free dateday diffDays (never new Date(iso)); round-to-nearest, floored at 1 mo for a sub-month narrow (A3 discretion)"
    - "onInclude calls ONLY applyWindow — it never touches deAliased.state.selected, so a manually-off strategy is never reselected (T-58-05); reversibility is the existing Common-period / Full-range presets"

key-files:
  created: []
  modified:
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx"

key-decisions:
  - "includeCostFor() is a module-level pure helper (next to coverageDropReason), returning { target, date, months } or null — null when there is no window that re-admits the strategy (no data / empty intersection), which suppresses the include button on that row"
  - "The headline moved bound in the label is the END bound when both ends move (an ended strategy is the common auto-exclude case); when only one end moves, that single bound is shown. {months} is the NET whole-month cost across both moved ends (head-forward + tail-back days summed, then folded)"
  - "AutoExcludedRow restructured to items-start with a right-side column (chip+reason on one line, include button below) — additive (Rule 3), keeping the existing data-testid='auto-excluded-reason' span and the single fade+slide enter transition intact"
  - "Include button omitted (not disabled) when includeCost is null — no dead affordance for a row that no window can re-admit"

patterns-established:
  - "member_count-rise as the include oracle: the COVERAGE-04 integration test drives the REAL computeScenario and asserts clicking Include raises member_count (B re-admitted) — proving the disclosed cost genuinely reaches the engine, not just moves a label"
  - "Manual-off stickiness proven at the engine axis: mounting a strategy selected:false and applying a window that WOULD cover it, member_ids stays [A] — the applyWindow path never mutates selected"

requirements-completed: [COVERAGE-02, COVERAGE-04]

# Metrics
duration: 20min
completed: 2026-07-01
---

# Phase 58 Plan 02: Auto-Excluded Amber Chip + Include-Cost Affordance Summary

**Completes the three-state per-row legibility (COVERAGE-02, the amber "Outside window" chip on each auto-excluded row) and the include-cost affordance (COVERAGE-04, a one-click "Include → shortens window to {date} (−{N} mo)" text-button that discloses the cost before applying and narrows the window via the existing applyWindow path so the strategy becomes a member) — all bound math delegated to scenario-window.ts intersectionOf, month cost via timezone-free dateday diffDays, and onInclude never reselecting a manually-off strategy.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-07-01
- **Tasks:** 2
- **Files modified:** 2 (0 created, 2 modified)

## Accomplishments
- **COVERAGE-02 (amber chip)**: `AutoExcludedRow` now renders `<CoverageStateChip state="auto-excluded" />` (the amber "Outside window" chip built + unit-tested in wave 1) alongside the existing `coverageDropReason` text — the third visually-distinct per-row state now renders (in-blend / manually-excluded / auto-excluded). Never red (auto-excluded is transient-recoverable).
- **COVERAGE-04 (include-cost)**: each auto-excluded row gains a real `<button>` with the LOCKED verbatim label `Include → shortens window to {date} (−{N} mo)`, `{date}` + `−{N} mo` in `font-mono tabular-nums`, styled as an accent text-button. On click it narrows the window (via `applyWindow`) to the intersection that re-admits the strategy — the Phase-57 auto-toggle state machine re-runs and the engine re-derives the divisor.
- **Delegated bound math**: `includeCostFor(span, window)` computes the include target as `intersectionOf([{first:window.start,last:window.end}, span])` — no hand-rolled interval math (Rule 2). The month delta sums the head-forward + tail-back calendar days (timezone-free `dateday.diffDays`), folds to whole months (round-to-nearest, floored at 1 mo for a sub-month narrow).
- **Manual-off stickiness**: `onInclude` calls ONLY `applyWindow` — it never touches `deAliased.state.selected`. A manually-off strategy is never reselected by a window move (T-58-05), proven at the engine axis (member_ids stays [A]).
- **Integration oracle**: extended the existing Phase-57 REAL-`computeScenario` window block (no new spec, no HAS_SEED_ENV const, no ci.yml entry) with two COVERAGE-04 tests — the amber chip + cost-disclosing label, the member_count-rise on include (B re-admitted, B leaves the auto-excluded group), and the manual-off-not-reselected invariant.

## Task Commits

1. **Task 1: Extend AutoExcludedRow (amber chip + include-cost button) + includeCostFor + onInclude handler** — `b74232e1` (feat)
2. **Task 2: COVERAGE-04 integration assertions in ScenarioComposer.test.tsx** — `ddd8784d` (test)

_Note: `.planning/` is gitignored in this repo (commit_docs=false); no docs metadata commit is made — the two code commits above are the deliverable._

## Files Created/Modified
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` — added `intersectionOf` + `diffDays` imports; `IncludeCost` type + `includeCostFor()` pure helper (delegating to `intersectionOf`, month cost via `diffDays`); `autoExcluded` memo now carries `includeCost` per row; group render passes `includeCost` + an `onInclude` that calls only `applyWindow(target)`; `AutoExcludedRow` extended additively with the amber `CoverageStateChip` + the include text-button
- `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx` — two COVERAGE-04 integration tests extending the existing Phase-57 window block (chip + include label + member_count-rise oracle; manual-off never reselected)

## Decisions Made
- **`includeCostFor` returns null when no window re-admits the row** (null span / empty intersection) — the include button is then OMITTED (not disabled), so there is no dead affordance.
- **Headline moved bound = the END bound when both ends move** (an ended strategy is the common auto-exclude case); a single-end move shows that bound. `{months}` is the NET whole-month cost across both moved ends.
- **AutoExcludedRow restructured to `items-start` with a right-side column** (chip+reason on one line, include button below) — additive (Rule 3), preserving the `data-testid="auto-excluded-reason"` span and the single fade+slide enter transition (Pitfall 5: the one transition-carrying element).

## Deviations from Plan

None — plan executed exactly as written. One test-design note: the plan's manual-off assertion ("if B was instead manually-off, the include click does not reselect it") was realized by mounting B as `selected: false` in the adapter fixture (these window fixtures are adapter-level, not composition-list toggle rows, so there is no DOM toggle switch for them) and asserting the `applyWindow` path never re-admits B into the engine `member_ids`. This proves the exact invariant (T-58-05: the window move never mutates `selected`) at the load-bearing engine axis rather than via a DOM toggle that does not exist for these fixtures.

## Issues Encountered
- **First draft of the manual-off test queried `getByRole("switch", …)` for B** — but the Phase-57 window fixtures (`REF_WIN_A`/`REF_WIN_B`) are adapter-level strategies that feed `computeScenario`, not composition-list added-strategy rows, so they have no toggle switch in the DOM. Resolved by mounting B as `selected: false` in the adapter mock and asserting the invariant at the `member_ids` axis. Caught immediately by the failing test before the commit.

## Threat Flags
None — no new security-relevant surface. The only new "input" is the include-button click, which sets `winStart`/`winEnd` from `scenario-window.ts`-derived bounds (`intersectionOf([currentWindow, span])`, always within existing data bounds — never free-form user text). Strategy names / date strings render as React text children (auto-escaped). The threat register's mitigate dispositions are all satisfied: T-58-04 (unbounded window) by the intersectionOf-derived target; T-58-05 (reselects a manual-off strategy) by `onInclude` calling only `applyWindow` + the integration test asserting `member_ids` never gains B; T-58-06 (chip/membership drift) by the row set being the existing `autoExcluded` memo (the same axis the :1813 guard reconciles) + the member_count-rise oracle.

## Known Stubs
None. `includeCostFor` derives its target + cost from the real strategy span + current window; `onInclude` wires to the real `applyWindow` setter; the amber chip is the wave-1 component. No hardcoded empty values, no placeholder text, no unwired data source.

## User Setup Required
None — no external service configuration required.

## Verification
- `npx vitest run "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx"` — 134 passed (132 baseline + 2 new COVERAGE-04).
- `npm run test` — full frontend suite green: **7316 passed / 0 failed / 288 skipped** (was 7314 in wave 1; +2 new tests). No numeric/engine change.
- `src/lib/scenario-window.test.ts` (incl. the BLEND-07 numpy gate) + `phase-52-frozen-spine-guards` + the `frozen|BLEND-07|parity` name-pattern sweep — all green (no frozen file touched).
- `npm run test:coverage` — ratchet PASSED, `npm exit: 0`: lines 85.46 (≥82), statements 83.36 (≥80), functions 79.79 (≥74), branches 76.09 (≥72).

## Next Phase Readiness
- COVERAGE-01 (mini-gantt) is the remaining Phase-58 disclosure surface not yet built; POLISH-03 (default-change note) is Plan 03 and reuses the same auto-excluded-group anchor + the `composer.` storage prefix wave 1 registered.
- No numeric/engine change — the frozen spine, BLEND-07, and parity guards stay green; the include-cost apply is a pure window-state move that re-runs the existing engine.

## Self-Check: PASSED
- FOUND: src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
- FOUND commit b74232e1 (Task 1)
- FOUND commit ddd8784d (Task 2)
- Acceptance greps: `Include → shortens window to` present (2 sites); `intersectionOf` present (5 sites); hand-rolled Math.max/min over first/last in diff = 0; onInclude→setSelected/state.selected/onToggle in diff = 0; `data-testid="auto-excluded-reason"` retained (1); no new `.spec.` file created (0)

---
*Phase: 58-coverage-legibility-disclosure*
*Completed: 2026-07-01*
