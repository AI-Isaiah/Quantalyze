---
phase: 113-weights-max-dd-l-solver
plan: 03
subsystem: allocations-scenario-composer
tags: [scenario-composer, weights, leverage, max-drawdown, solver, target-mode, sc-3, react]

# Dependency graph
requires:
  - phase: 113-00
    provides: pinned Target-mode UI testids + solved-L save RED tests
  - phase: 113-02
    provides: solveLeverageForMaxDD final contract (SolveLeverageResult union, honest reason copy, DD_TOL/L_TOL)
  - phase: 112-weights-leverage-rows-per-constituent
    provides: leverageByRef / handleLeverageChange / pruneLeverageToDraftRefs path, CompositionList row anatomy, derived notional column
provides:
  - "Per-row Leverage|Target-max-DD mode toggle (default Leverage) on BOTH constituent row types"
  - "Solve-on-commit wiring: handleTargetCommit → solveLeverageForMaxDD (sole call site) → handleLeverageChange → leverageByRef"
  - "Read-only derived-L display in Target mode + computed portfolio max-DD readout + honest em-dash infeasible states"
  - "Solved L persists through the untouched Phase-112 save fold (no SCENARIO_SCHEMA_VERSION bump); mode/target transient"
affects: [113-04 phase-close gate, 116 +Allocation, 117 UIFIX]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Transient UI state (targetModeByRef/solveResultByRef useState) reset at every leverageByRef session-bleed seam — persists NOTHING, no schema bump"
    - "One-shot calculator: solveLeverageForMaxDD invoked ONLY inside the commit handler (no useEffect/useMemo re-solve)"
    - "Shared render helpers (renderModeToggle/renderTargetInput/renderSolveState) render the identical Target surface into both row types — one definition"
    - "Portfolio max-DD readout costs ZERO extra computeScenario calls — reads the existing full-book scenarioMetrics.max_drawdown memo"

key-files:
  created: []
  modified:
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx — parent wiring (transient state + handleTargetCommit/handleSetTargetMode + prop threading) and CompositionList Target-mode row surface"

key-decisions:
  - "Solved L rounded to 3dp and routed through handleLeverageChange — a solved L IS a leverage on the exact same clamp/message/persistence path as a typed one"
  - "Out-of-range target (non-finite/≤0/≥100) is an honest refusal that keeps the prior value — never a clamp (a clamped target would solve for a value the allocator never typed, T-113-05)"
  - "CompositionListProps interface fields added in the Task-1 commit (they are the wiring contract) so the parent compiles cleanly; rendering added in Task 2"
  - "Landmine evidence via the existing Wave-0 (l) weight-byte-stability test + the (a) save-payload test — no redundant new test (plan-sanctioned)"

requirements-completed: [WEIGHTS-03, WEIGHTS-04]

# Metrics
duration: 45min
completed: 2026-07-17
---

# Phase 113 Plan 03: Scenario Composer Target-max-DD UI Summary

**Wired the max-DD→leverage solver into the Scenario Composer: a per-row Leverage|Target-max-DD mode toggle (default Leverage) on both row types, solve-on-commit → read-only derived L, a computed portfolio max-DD readout, honest em-dash infeasible states, and solved-L Save→reopen survival with no schema bump — flipping the last 6 Phase-113 Wave-0 reds green.**

## Performance
- **Duration:** ~45 min
- **Started:** 2026-07-17
- **Completed:** 2026-07-17
- **Tasks:** 3 (2 code, 1 verification)
- **Files modified:** 1 (ScenarioComposer.tsx)

## Accomplishments
- **Parent wiring (Task 1):** added TRANSIENT `targetModeByRef` / `solveResultByRef` `useState` (never persisted, never serialized) reset at all three `leverageByRef` session-bleed seams (reset/commit + the two saved-scenario opens). `handleTargetCommit` is the SOLE `solveLeverageForMaxDD` call site (one-shot calculator, founder lock — no effect/subscription re-solve): it validates the target fail-loud (out-of-range → honest refusal, never a clamp), runs the solver over the MEMOIZED `engineSet.strategies` / `engineState` / `dateMapCache` / `blendBasis` (zero rebuilt caches, zero new `computeScenario` sites), and on success routes the 3dp-rounded L through `handleLeverageChange` (same clamp + message + persistence). `handleSetTargetMode` flips mode and clears the row's solve outcome on flip-back to Leverage. Threaded `targetModeByRef` / `onSetTargetMode` / `onCommitTarget` / `solveResultByRef` / `portfolioMaxDrawdown: scenarioMetrics.max_drawdown` into `CompositionList`.
- **Row UI (Task 2):** shared `renderModeToggle` / `renderTargetInput` / `renderSolveState` helpers rendered identically into BOTH `scenario-constituent-perkey` and `scenario-constituent-added` rows. Mode toggle carries `data-mode="leverage|target"` (default Leverage, disabled when excluded). Target mode reveals `target-dd-<ref>` (percent, blur+Enter commit) and sets `leverage-<ref>` `readOnly` (never disabled — the derived L stays visible with its value). The honest state line under the row controls: `scenario-target-dd-portfolio-note` (computed full-book max-DD at the solved L via the shared `formatPercent`, signed 2dp, labelled "computed", em-dash on null) on success; `scenario-target-dd-state` (reason copy from `solveReasonCopy` + em-dash, no semantic color) on failure. The `<li>` was wrapped to `flex-col` so the state line sits beneath the controls; weight input, notional span, provenance badge, and coverage chip are byte-unchanged.
- **Save survival + battery (Task 3):** the Wave-0 solved-L save test flipped GREEN with ZERO edits to the save fold / `pruneLeverageToDraftRefs` / the test — a solved L rides the existing Phase-112 leverage path indistinguishably from a typed L (`leverageOverrides[ref]` = solved L, current `SCENARIO_SCHEMA_VERSION`, no `targetMaxDD` / `rowMode` key).

## Landmine Sweep (Phase-112 weight-basis)
A solve writes LEVERAGE only — the Phase-112 landmines are structurally untouched, proven by the existing Wave-0 tests (no redundant new test, plan-sanctioned):
- **Weights byte-stable:** component test **(l)** snapshots every `weight-*` input across ALL rows before a solve and asserts `toEqual` after — GREEN. A solve never calls `handleWeightChange`, so `draft.weightOverrides` and the mixed-book renorm are untouched.
- **Sole-unit refuse not fired:** the refuse (`"A single constituent is always 100%."`) lives only in `handleWeightChange`; `handleTargetCommit` never routes through it, so it cannot fire on a solve (structurally guaranteed; the weight-byte-stability of (l) confirms no weight path executed).
- **Solved L out of diffCount:** leverage is documented (ScenarioComposer.tsx leverageByRef comment) as a what-if overlay, NOT a commit-diff input; a solved L is just a leverage, so it stays out of diffCount exactly like a typed L. The diffCount inputs (`weightOverrides` / `toggleByScopeRef`) are proven untouched by (l). Save test **(a)** confirms the solved L lands in `leverageOverrides` (not `weightOverrides`) with no transient field serialized.

## Deviations from Plan
**1. [Rule 3 - Blocking] CompositionListProps interface fields added in the Task-1 commit rather than Task 2.**
- **Found during:** Task 1 (tsc after prop threading)
- **Issue:** Threading the five new props into the `CompositionList` call site (Task 1 step 3) fails `tsc` until the `CompositionListProps` interface declares them — but the plan scoped the interface extension to Task 2. Task 1's acceptance requires `tsc` exit 0.
- **Fix:** Added the interface fields (the wiring contract) in the Task-1 commit; the row RENDERING that consumes them stayed in Task 2. No behavior change, cleaner commit boundary (contract with the wiring, rendering with the UI).
- **Files modified:** ScenarioComposer.tsx (CompositionListProps interface)
- **Commit:** 67141afa

## Gates
- All 6 remaining Phase-113 Wave-0 reds GREEN: composer (h)-(l) + save (a). **ZERO remaining Phase-113 reds.**
- `git diff --exit-code origin/main -- src/lib/scenario.ts` — clean (SC-3 byte-frozen).
- `npx tsc --noEmit` — exit 0.
- `npx eslint` on ScenarioComposer.tsx — 0 errors/warnings (react-hooks deps checked by hand: `handleTargetCommit`/`handleSetTargetMode` are plain functions like the sibling handlers, no new memo/effect dependency surface).
- Composer suite 192 green; save suite 31 green.
- Full allocations sweep — **118 files / 1556 tests pass** (includes every Phase-113 test).
- Engine/leverage/backbone pins — 78 pass.

## Known Stubs
None. The Target-mode surface is fully wired end-to-end (toggle → solve → derived L → engine → notional → Save). No placeholder data, no hardcoded empties.

## Task Commits
1. **Task 1: Composer parent wiring — transient mode/solve state + handleTargetCommit** — `67141afa` (feat)
2. **Task 2: CompositionList Target-mode row UI — toggle, target input, readOnly derived L, portfolio note, honest states** — `4c3fd467` (feat)
3. **Task 3: Save-survival green + landmine sweep + battery** — verification-only (save fold untouched; nothing to commit)

## Next Phase Readiness
- WEIGHTS-03 UI + WEIGHTS-04 honest states COMPLETE. Phase 113 is ready for 113-04 (phase-close gate battery) and `/gsd:verify-work`.
- Manual browser check of the Target-mode surface (readOnly styling, toggle affordance, DESIGN.md Numbers Contract on the derived-L + portfolio-DD readouts) explicitly handed to `/qa`, not skipped.

## Self-Check: PASSED
- Modified file present: src/app/(dashboard)/allocations/components/ScenarioComposer.tsx.
- Commits present: 67141afa (Task 1), 4c3fd467 (Task 2).

---
*Phase: 113-weights-max-dd-l-solver*
*Completed: 2026-07-17*
