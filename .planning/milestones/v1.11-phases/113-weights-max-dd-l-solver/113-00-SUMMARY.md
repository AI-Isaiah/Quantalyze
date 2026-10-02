---
phase: 113-weights-max-dd-l-solver
plan: 00
subsystem: testing
tags: [vitest, solver, leverage, max-drawdown, scenario-composer, red-scaffold, sc-3]

# Dependency graph
requires:
  - phase: 112-weights-leverage-rows-per-constituent
    provides: per-key leverageByRef path, handleLeverageChange, pruneLeverageToDraftRefs(eligiblePerKeyIds), derived notional column, MAX_LEVERAGE contract
provides:
  - "solve-leverage.ts contract skeleton (SolveLeverageResult union, DD_TOL/L_TOL, solveLeverageForMaxDD signature) that Plans 113-01/02 implement against"
  - "13 RED tests pinning the sleeve max-DD→L solver behavior + Target-mode UI testids + solved-L persistence, each failing by assertion on the current tree"
  - "pinned UI identifiers for Plan 113-03: scenario-leverage-mode-toggle[data-mode], target-dd-<ref>, scenario-target-dd-state, scenario-target-dd-portfolio-note"
affects: [113-01 solver bisect, 113-02 round-trip + honest states, 113-03 composer UI, 113-04 phase-close gate]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Interface-first contract skeleton with a Wave-0-only 'unimplemented' union variant (grep-gate deletable) so every downstream RED test fails by assertion, never a crash"
    - "Sleeve-level solve fixtures verified against the REAL frozen engine before pinning (5%→20%→4.000 founder acceptance)"
    - "Non-tautological round-trip: target derived FROM computeScenario, solved, re-fed THROUGH computeScenario, plus a +0.15 perturbation that must break the match"

key-files:
  created:
    - "src/app/(dashboard)/allocations/lib/solve-leverage.ts — Wave-0 solver contract skeleton"
    - "src/app/(dashboard)/allocations/lib/solve-leverage.test.ts — 7 RED solver units"
  modified:
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx — +5 RED Target-mode component tests"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.save.test.tsx — +1 RED solved-L persistence test"

key-decisions:
  - "targetMaxDD is a POSITIVE magnitude; engine max_drawdown is NEGATIVE — the contract compares Math.abs"
  - "The 'unimplemented' union variant is Wave-0-only scaffolding; Plan 113-02 deletes it (T-113-01 mitigation)"
  - "Component/save RED tests LEAD with expect(queryByTestId).not.toBeNull() so the RED is a clean assertion, not a getByTestId crash"

patterns-established:
  - "Pattern: RED scaffold — skeleton returns { ok:false, reason:'unimplemented' }; unit tests assert the real contract → assertion mismatch on every solve"
  - "Pattern: sleeveStateAt(L) single-constituent weight-1 state reduces the frozen engine to portDaily = L·r (sleeve standalone max-DD source)"

requirements-completed: [WEIGHTS-03, WEIGHTS-04]

# Metrics
duration: 40min
completed: 2026-07-17
---

# Phase 113 Plan 00: WEIGHTS max-DD→L Solver RED Scaffold Summary

**Interface-first `solveLeverageForMaxDD` contract skeleton + 13 assertion-RED tests (7 solver units, 5 Target-mode component, 1 solved-L save) pinning the founder sleeve-level lock (5%→20%→L=4.000) against the byte-frozen engine.**

## Performance

- **Duration:** ~40 min
- **Started:** 2026-07-17
- **Completed:** 2026-07-17
- **Tasks:** 3
- **Files modified:** 4 (2 created, 2 extended)

## Accomplishments
- Created the `solve-leverage.ts` Wave-0 contract skeleton: `SolveLeverageResult` discriminated union (`ok:true{leverage,sleeveMaxDD}` | `ok:false{reason,ceiling?}`), `DD_TOL=1e-3`, `L_TOL=1e-2`, and the `solveLeverageForMaxDD(args)` signature whose body returns `{ ok:false, reason:"unimplemented" }` and contains zero engine math (SC-3 / Don't-Hand-Roll).
- 7 RED solver units covering every Phase-113 behavior with engine-verified pinned values: founder 4.000, compounding 2.6015 (and measurably ≠ the retired 0.15/0.0591≈2.538 closed-form), deleverage 0.500, ruin-clamp 1.6667, unreachable {reason:"unreachable", ceiling:2.5} with no leverage, degenerate trio (no-drawdown / insufficient-history / degenerate), and a non-tautological round-trip with a +0.15 perturbation.
- 5 RED component tests pinning the Target-mode UI contract (mode toggle default-Leverage, Target-mode reveal + read-only derived L, solve-commit writes L + portfolio-DD note, infeasible honesty + no fabricated L, landmine non-regression on weights).
- 1 RED save test proving a solved L persists in the POST payload's `leverageOverrides` with no schema bump and no transient mode/target field.

## RED-Proof Evidence (non-tautological)

All 13 new tests fail on the current tree; every failure is an ASSERTION mismatch (0 crashes / import errors):

- **solve-leverage.test.ts** — `7 failed`. Failure messages: `expected false to be true` (a/b/c/d/g — the stub's `ok:false` vs the expected `ok:true` solve), `expected 'unimplemented' to be 'unreachable'` (e), `expected 'unimplemented' to be 'no-drawdown'` (f). The founder 5%→20%→**4.000** case is present as `Math.abs(ok.leverage - 4.0) <= L_TOL`.
- **ScenarioComposer.test.tsx** — `5 failed | 187 passed`. All 5 fail with `AssertionError: expected null not to be null` (the pinned `scenario-leverage-mode-toggle` testid does not exist yet).
- **ScenarioComposer.save.test.tsx** — `1 failed | 30 passed`. Fails with `expected null not to be null` on the same toggle query.

Fixture values were confirmed against the REAL `computeScenario` before pinning: `dd(1)=−0.05, dd(4)=−0.20` (founder); `dd(1)=−0.0591, dd(2.6015)=−0.15, dd(2.5)=−0.14437` (compounding); `dd(0.5)=−0.05` (deleverage); `dd(1.6667)=−0.50001, dd(3.4)=null` (ruin); flat `dd=0`, 5-obs `null`, −1.5-day `null` (degenerate trio).

## Task Commits

1. **Task 1: Solver contract skeleton + RED solver unit file** — `7e6b5b8b` (test)
2. **Task 2: RED Target-mode component tests** — `2f9aa70d` (test)
3. **Task 3: RED solved-L save-survival test** — `b6323802` (test)

## Files Created/Modified
- `src/app/(dashboard)/allocations/lib/solve-leverage.ts` — Wave-0 solver contract (union, tolerances, signature; unimplemented stub, no engine math)
- `src/app/(dashboard)/allocations/lib/solve-leverage.test.ts` — 7 RED solver units (a–g)
- `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx` — +Phase-113 describe block, 5 RED tests (h–l)
- `src/app/(dashboard)/allocations/components/ScenarioComposer.save.test.tsx` — +Phase-113 describe block, 1 RED test (a)

## Decisions Made
- Followed the plan as specified. `targetMaxDD` positive-magnitude vs engine negative-fraction convention documented in the skeleton TSDoc; `unimplemented` variant flagged Wave-0-only for Plan 113-02 deletion (T-113-01).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None. The RED tests were verified assertion-clean by grepping the vitest output for `Unhandled` / import errors (0) and inspecting the failure messages (all `AssertionError`). The pre-existing localStorage/benchmark-URL `TypeError` console noise in the composer suite is a long-standing harness artifact swallowed by the component, unrelated to the new tests, and present across the whole suite.

## Known Stubs
- `solve-leverage.ts` returns `{ ok:false, reason:"unimplemented" }` — this is the INTENTIONAL Wave-0 contract stub. Plan 113-01/113-02 implement the ruin-clamped monotone bisect and delete the `unimplemented` variant (grep-gated). Documented as the plan's core deliverable, not a defect.

## Gates
- `git diff --exit-code origin/main -- src/lib/scenario.ts` — clean (SC-3 byte-frozen).
- `npx tsc --noEmit` — exit 0.
- `scenario-backbone-gates.test.ts` — 9 passed.
- Pre-existing suites in the two touched component files — 187 + 30 green.

## Next Phase Readiness
- The solver contract is fixed and RED-proven. Plan 113-01 implements the monotone sleeve bisect + ruin-clamp to flip (a)/(c)/(d) green; Plan 113-02 adds the round-trip + honest states (e)/(f)/(g) and deletes the `unimplemented` variant; Plan 113-03 wires the composer UI against the pinned testids to flip (h)–(l) and the save test.
- `wave_0_complete: true` set in 113-VALIDATION.md.

## Self-Check: PASSED
- Created files present: solve-leverage.ts, solve-leverage.test.ts, 113-00-SUMMARY.md.
- Commits present: 7e6b5b8b (Task 1), 2f9aa70d (Task 2), b6323802 (Task 3).

---
*Phase: 113-weights-max-dd-l-solver*
*Completed: 2026-07-17*
