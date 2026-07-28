---
phase: 113-weights-max-dd-l-solver
plan: 02
subsystem: allocations-solver
tags: [solver, leverage, max-drawdown, round-trip, honest-states, weights-04, sc-3, eval-budget]

# Dependency graph
requires:
  - phase: 113-01
    provides: "solveLeverageForMaxDD real implementation (monotone sleeve bisect + ruin-clamped domain); solver units (a)-(g) GREEN; the 'unimplemented' union variant retained for this plan to delete"
provides:
  - "Final solver contract: no 'unimplemented' variant (grep-gated), honest-reason TSDoc pinning the Plan-113-03 UI copy, eval budget pinned ≤70 computeScenario calls/solve"
  - "Hardened WEIGHTS-04 tests: two-sided round-trip (lever-up L*=2.5 + deleverage L*=0.6) with perturbation teeth, T-113-02 input gate (NaN/±Inf/≤0/≥1 → degenerate, no throw), value-free infeasible branches (structural `in`), all-negative-solves-finite, eval-budget spy"
affects: [113-03 composer Target-mode UI (consumes the final SolveLeverageResult + honest-reason copy), 113-04 phase-close gate battery]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Non-tautological round-trip via ENGINE re-feed (computeScenario), proven on BOTH sides of 1× (lever-up + deleverage), each with a +0.15 perturbation that must break the DD_TOL match — a round-trip that survives a perturbed L is tautological (Nyquist lock)"
    - "Eval-budget pin via vi.spyOn on the imported @/lib/scenario namespace binding — counts one full solve's computeScenario calls; >0 proves the spy intercepts, ≤70 guards an unbounded-loop regression (ruin path measures 28)"
    - "grep-gated deletion of a Wave-0 scaffolding union variant: `! grep -q \"unimplemented\"` on the module keeps the dead state from ever returning"

key-files:
  created: []
  modified:
    - "src/app/(dashboard)/allocations/lib/solve-leverage.ts — deleted the 'unimplemented' union variant + all TSDoc references; refreshed the stale WAVE-0 module/function TSDoc to the implemented solver; pinned the Plan-113-03 honest-reason UI copy contract"
    - "src/app/(dashboard)/allocations/lib/solve-leverage.test.ts — added the deleverage round-trip (g2); added the Plan-113-02 honest-state/input-gate/value-free/eval-budget describe block; removed a pre-existing unused MAX_LEVERAGE import"

key-decisions:
  - "Test (g) was already GREEN from 113-01 — this plan HARDENS (adds the deleverage-side round-trip + the full honest-state matrix + the eval-budget pin), never weakens; DD_TOL=1e-3 / L_TOL=1e-2 unchanged (grep-confirmed)"
  - "The eval-budget spy asserts BOTH >0 (the spy actually intercepts the solver's imported binding — a silent 0 would falsely pass ≤70) AND ≤70 (the research envelope); the ruin fixture is used so BOTH the ruin-predicate bisect AND the solve bisect are counted (measured 28)"
  - "The T-113-02 input gate ('degenerate' for NaN/Infinity/-Infinity/0/-0.05/1/1.5) is asserted inside an expect(...).not.toThrow() so the fail-loud backstop is proven to refuse honestly, never throw or clamp"

requirements-completed: [WEIGHTS-04]

# Metrics
duration: 18min
completed: 2026-07-17
---

# Phase 113 Plan 02: WEIGHTS-04 round-trip hardening + honest-state finalization Summary

**Finalized the max-DD→L solver for UI consumption: a two-sided non-tautological round-trip (lever-up + deleverage, each with perturbation teeth), the complete honest-failure matrix (input-gate `degenerate` for non-finite/out-of-range targets, value-free infeasible branches, all-negative-solves-finite), the Wave-0 `"unimplemented"` union variant deleted under a grep gate, and the per-solve eval budget pinned ≤70 computeScenario calls (ruin path measures 28) — zero scenario.ts edits.**

## Performance
- **Duration:** ~18 min
- **Started:** 2026-07-17
- **Completed:** 2026-07-17
- **Tasks:** 2
- **Files modified:** 2 (solve-leverage.ts, solve-leverage.test.ts)

## Accomplishments

- **Task 1 — deleverage round-trip + perturbation teeth both sides of 1× (`6b62ae94`, test-only):** test (g) was already GREEN from 113-01, so this plan HARDENED rather than flipped. Added **(g2)** — the same non-tautological forward-then-back contract at a DELEVERAGE root `L* = 0.6` on the −0.10-day fixture (`|dd(L)| = 0.10·L`): derives the target FROM the engine at 0.6, solves, asserts `L < 1` and `|L_solved − 0.6| ≤ L_TOL`, re-feeds the solved L through `computeScenario` (the ENGINE, not the solver) within `DD_TOL`, and proves a `+0.15` perturbation (0.6→0.75, `|dd|` 0.06→0.075, a 0.015 move ≈15× DD_TOL) breaks the match. The tolerance contract is now proven on BOTH sides of 1×. No solver change was needed (the current bisect already returns 0.6); no test tolerance was loosened (`DD_TOL=1e-3` / `L_TOL=1e-2` grep-confirmed unchanged).

- **Task 2 — honest-state completion + delete `"unimplemented"` + eval budget (`29a21af5`, feat):**
  - **Deleted the Wave-0 `"unimplemented"` union variant** and all TSDoc references; `! grep -q "unimplemented"` on the module now passes (T-113-01). Refreshed the stale WAVE-0 module header + function TSDoc (which still claimed an unconditional stub) to describe the implemented ruin-clamped monotone solver.
  - **Pinned the Plan-113-03 UI copy contract** per honest reason in the union TSDoc: `unreachable` → "Unreachable at {ceiling}×"; `no-drawdown` → "No drawdown in this series"; `insufficient-history` → "Insufficient history to model drawdown"; `degenerate` → "Series can't be modeled (data quality)".
  - **Completed the honest-failure matrix** (research §Honest-failure table) with NEW tests: the **T-113-02 input gate** returns `degenerate` (no throw) for `NaN`/`Infinity`/`-Infinity`/`0`/`-0.05`/`1`/`1.5`; the **value-free guarantee** asserts `"leverage" in result === false` AND `"sleeveMaxDD" in result === false` on a degenerate AND an unreachable branch (Pitfall 3 — the em-dash UI can never surface a value-shaped lie); the **all-negative series** (every day −0.01) solves NORMALLY to a finite `ok` leverage (honesty = a finite L, not a refusal) reproducing a 20% target within DD_TOL.
  - **Pinned the eval budget** with a `vi.spyOn(scenarioModule, "computeScenario")` wrap counting one full solve on the ruin fixture (exercises BOTH the ruin-predicate bisect AND the solve bisect): asserts `> 0` (the spy actually intercepts the solver's imported binding) AND `≤ 70` (research envelope). Measured **28 calls** on the ruin path.

## WEIGHTS-04 test set (`solve-leverage.test.ts` — 12/12 pass)
- (a)-(g) — the 113-01 solver units, unchanged and still GREEN.
- **(g2) ROUND-TRIP DELEVERAGE** — solved L ≈ 0.6 re-fed through the engine reproduces the target; a +0.15 perturbation breaks it (both-sides-of-1× tolerance contract).
- **input gate** — NaN/±Inf/≤0/≥1 target → `degenerate`, no throw (T-113-02).
- **value-free branches** — no `leverage`/`sleeveMaxDD` field on degenerate or unreachable (Pitfall 3, structural `in`).
- **all-negative solves finite** — an all-down series returns a finite `ok` L, not a fabricated failure.
- **eval budget** — ≤ 70 computeScenario calls/solve (measured 28 on the ruin path).

## Deviations from Plan

### Auto-fixed / clarified

**1. [Rule 3 — blocking-issue cleanup] Removed a pre-existing unused `MAX_LEVERAGE` import from the test file**
- **Found during:** Task 2 lint gate.
- **Issue:** `import { MAX_LEVERAGE } from "@/lib/leverage"` (test line 36) was referenced only in comments, never as a value — a dead import carried since the 113-00 Wave-0 scaffold (confirmed via `git show HEAD~2`). It surfaced as a `@typescript-eslint/no-unused-vars` warning once I re-ran eslint on the file I was already modifying.
- **Fix:** Deleted the one dead import line. Zero behavior impact; the plan's gate is "lint 0", and the warning lived in a file this plan already commits — surgical in-file cleanup, not adjacent-code churn.
- **Files modified:** src/app/(dashboard)/allocations/lib/solve-leverage.test.ts (Task 2 commit `29a21af5`).

**2. [Rule 1 — clarification] No solver-logic change was needed for the deleverage round-trip**
- **Found during:** Task 1.
- **Issue:** The plan's Task 1 allowed tightening the solver if the round-trip was RED. It was already GREEN (113-01), and the new deleverage case (g2) also passed against the existing bisect on the first run — the ruin-clamped `L_max` already keeps the −0.10-day ceiling eval non-null, so the solve returns 0.6 cleanly.
- **Fix:** Task 1 is test-only (`6b62ae94`); no solver edit. This is a strengthening, exactly as the plan's "if a test is already green, strengthen it, don't weaken it" note directs.

## Out-of-scope RED (expected, declared later-plan)
6 tests remain RED, all the declared **Plan 113-03 composer-UI scope** (they fail on the `scenario-leverage-mode-toggle` testid that 113-03 adds — nothing to do with the solver), matching the 113-01 baseline exactly:
- `ScenarioComposer.test.tsx` Phase-113 Target-mode (h)-(l) component tests (5).
- `ScenarioComposer.save.test.tsx` Phase-113 (a) solved-L persistence test (1).

## Known Stubs
None. The Wave-0 `"unimplemented"` scaffolding variant — the last remaining stub from 113-00/113-01 — was DELETED in this plan (grep-proven). The solver module is final for Plan 113-03 UI consumption.

## Gates
- `! grep -q "unimplemented"` on solve-leverage.ts — PASS (variant + all TSDoc references gone).
- `git diff --exit-code origin/main -- src/lib/scenario.ts` — clean (SC-3 byte-frozen; the solver only CALLS `computeScenario`).
- `npx tsc --noEmit` — exit 0.
- `npx eslint solve-leverage.ts solve-leverage.test.ts` — exit 0, 0 warnings (after the dead-import removal).
- `solve-leverage.test.ts` — 12/12 green.
- Full `src/app/(dashboard)/allocations` sweep — 1550 passed, 6 failed (all the declared 113-03 UI REDs above; no unexpected regressions vs the 113-01 baseline).

## Threat surface
- **T-113-02 (Tampering, target input) — mitigated + now TESTED:** the `Number.isFinite` + `(0,1)` gate returns honest `degenerate` for NaN/±Infinity/≤0/≥1, proven inside `expect(...).not.toThrow()` (never a throw, never a clamp).
- **T-113-04 (Repudiation, infeasible results) — mitigated + now TESTED:** every `{ ok: false }` branch is value-free (`"leverage" in result === false`), so the UI can never render a value-shaped lie; `unreachable` carries only a machine-readable `ceiling`.
- No new threat surface introduced (pure client-side numerical module; no network/auth/schema).

## Task Commits
1. **Task 1: deleverage round-trip both sides of 1×** — `6b62ae94` (test)
2. **Task 2: finalize honest states, delete 'unimplemented', pin eval budget** — `29a21af5` (feat)

## Self-Check: PASSED
- Modified files present: `src/app/(dashboard)/allocations/lib/solve-leverage.ts` (FOUND), `src/app/(dashboard)/allocations/lib/solve-leverage.test.ts` (FOUND).
- Commits present: `6b62ae94` (Task 1, FOUND), `29a21af5` (Task 2, FOUND).
- `unimplemented` gone (grep gate PASS); scenario.ts freeze clean; tsc 0; eslint 0; 12/12 solver tests green; eval budget measured 28 ≤ 70.

---
*Phase: 113-weights-max-dd-l-solver*
*Completed: 2026-07-17*
