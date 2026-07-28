---
phase: 113-weights-max-dd-l-solver
plan: 01
subsystem: allocations-solver
tags: [solver, leverage, max-drawdown, bisect, ruin-clamp, scenario-composer, sc-3, weights-03]

# Dependency graph
requires:
  - phase: 113-00
    provides: "solve-leverage.ts contract skeleton (SolveLeverageResult union, DD_TOL/L_TOL, solveLeverageForMaxDD signature) + 7 RED solver units (a)-(g)"
  - phase: 112-weights-leverage-rows-per-constituent
    provides: "leverageByRef engine path, MAX_LEVERAGE contract, sanitizeLeverage"
provides:
  - "solveLeverageForMaxDD real implementation: sleeve-state builder, per-solve memoized ddAt, monotone smallest-L bisect, monotone ruin-predicate L_ruin bisect, ruin-clamped domain [0, min(maxLeverage ?? MAX_LEVERAGE, L_ruin)], fail-loud target validation, honest degenerate/no-drawdown/insufficient-history/unreachable states"
  - "Wave-0 solver tests (a)-(g) GREEN — the numerical sleeve-level max-DD→L solve on the frozen engine"
affects: [113-02 round-trip + honest-state refinement + unimplemented-variant deletion, 113-03 composer Target-mode UI]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Monotone smallest-L bisect over the frozen engine's real r→L·r transform (founder sleeve-level lock) — the ROADMAP grid-scan-then-bisect degenerates to a plain monotone bisect under the single-constituent unique-root regime"
    - "Monotone ruin-predicate up-set bisect for L_ruin; L_max = last-proven-non-ruined lo (ε-margin) so no eval ever lands in the null/ruin region (Pitfall 2)"
    - "Per-solve memoized computeScenario keyed by L.toFixed(4) — zero duplicated engine math (SC-3 / Don't-Hand-Roll)"

key-files:
  created: []
  modified:
    - "src/app/(dashboard)/allocations/lib/solve-leverage.ts — replaced the Wave-0 unimplemented body with the real ruin-clamped monotone bisect (union variant retained for Plan 113-02 to delete)"

key-decisions:
  - "sleeveStateAt(L) restricts selected/weights to exactly { [ref]: true } / { [ref]: 1 } (does NOT spread engineState.selected) so the engine reduces to portDaily = L·r; startDates + window carried verbatim"
  - "ddAt(0) null is the clean insufficient-history discriminator (at L=0 all scaled returns are 0 → the only null path is the n<10 floor); ddAt(1) null (with ddAt(0) non-null) is the catastrophic-1× degenerate"
  - "L_max uses the last-proven-non-ruined lo of the ruin bisect as the ε-margin ceiling — never sample above it; the unreachable branch reports this ruin-clamped ceiling honestly (not a fabricated MAX_LEVERAGE)"

requirements-completed: [WEIGHTS-03]

# Metrics
duration: 20min
completed: 2026-07-17
---

# Phase 113 Plan 01: WEIGHTS max-DD→L Solver CORE Summary

**Real `solveLeverageForMaxDD` — a per-solve-memoized, ruin-clamped MONOTONE smallest-L bisect over the byte-frozen engine's sleeve `r→L·r` transform (founder lock: single weight-1 constituent → `portDaily = L·r`), flipping the 7 Wave-0 solver RED tests (a)-(g) green with zero scenario.ts edits.**

## Performance
- **Duration:** ~20 min
- **Started:** 2026-07-17
- **Completed:** 2026-07-17
- **Tasks:** 2
- **Files modified:** 1 (solve-leverage.ts; the test file needed no fixture correction)

## Accomplishments
- **Task 1 — sleeve builder + short-circuits + monotone smallest-L bisect (`fdd0398b`):** replaced the `unimplemented` body with `sleeveStateAt(L)` (single weight-1 constituent, `selected`/`weights` restricted to `ref`, `startDates`/`window` carried verbatim), `ddAt(L)` (per-solve memoized `computeScenario(...).max_drawdown`, keyed `L.toFixed(4)`, zero local drawdown math), fail-loud target validation (finite, `(0,1)` → honest `degenerate`, never a clamp — T-113-02), the two ordered degenerate short-circuits (`ddAt(0)` null → `insufficient-history`; `ddAt(1)` null → `degenerate`), and the monotone smallest-L bisect on `[0, L_max]` (invariant `lo`|dd|<target / `hi`|dd|≥target, returns `hi` → smallest-L on any flat 5dp-rounding plateau) with an honest reachability pre-check (`no-drawdown` / `unreachable` with ceiling) and a defensive in-bisect null guard.
- **Task 2 — ruin-clamped domain (`5711d908`):** `ruinedAt(L) = ddAt(L)===null` (valid only after the short-circuits proved n≥10 + non-ruin at 1×), a monotone ruin up-set bisect on `[1, ceil]` (lo=non-ruined / hi=ruined, width ≤1e-2), `L_max = lo` (last-proven-non-ruined = the ε-margin), threaded into the reachability check + solve domain so no eval ever samples the null/ruin region; the explicit `maxLeverage` ceiling is honored and reported on the `unreachable` branch.

## Wave-0 tests flipped GREEN (`solve-leverage.test.ts` — 7/7 pass)
- **(a) FOUNDER** — 5% unlevered sleeve max-DD, target 20% → **L = 4.000** ± L_TOL (founder acceptance value).
- **(b) COMPOUNDING** — target 15% → **L ≈ 2.6015** AND measurably > L_TOL away from the retired closed-form 0.15/0.0591 ≈ 2.538 (proves numerical-not-linear).
- **(c) DELEVERAGE** — below-base target 5% → **L = 0.500** (L<1 on the ruin-clamped domain).
- **(d) RUIN-CLAMP** — target 50% on a −30% day → **L ≈ 1.6667**, terminates below the ruin ceiling ≈3.333 (no null-region scan).
- **(e) UNREACHABLE** — target 20% with `maxLeverage: 2.5` → `{ reason: "unreachable", ceiling: 2.5 }`, no `leverage` property.
- **(f) DEGENERATE trio** — flat → `no-drawdown`; 5 obs → `insufficient-history`; −150% day → `degenerate`.
- **(g) ROUND-TRIP (non-tautological)** — solved L re-fed through `computeScenario` reproduces the target; a +0.15 perturbation breaks it.

Task 1 alone flipped (a)/(b)/(e)/(f)/(g); Task 2 added (c)/(d).

## Deviations from Plan

### Auto-fixed / clarified

**1. [Rule 1 — scope correction] (c) DELEVERAGE needed Task 2's ruin clamp, not Task 1**
- **Found during:** Task 1 verification.
- **Issue:** The plan's Task-1 acceptance listed (c) as green after Task 1. But (c)'s fixture is a single −0.10 day: the reachability pre-check evaluates `ddAt(L_max)` at the un-clamped ceiling `L=10`, where `1 − 0.10·10 = 0` trips the engine's `minCumulative ≤ 0` ruin guard → `ddAt(10) = null` → the defensive `degenerate` return. So (c) — like (d) — structurally requires the ruin-clamped `L_max` from Task 2 to keep the ceiling eval inside the non-null domain.
- **Fix:** No code change to Task 1's logic (the defensive null → `degenerate` is correct fail-loud behavior); Task 2's ruin bisect clamps `L_max` just below the ruin point (≈9.99 for the −0.10 fixture, ≈3.32 for the −0.30 fixture), after which (c) and (d) both go green.
- **Files modified:** src/app/(dashboard)/allocations/lib/solve-leverage.ts (Task 2 commit `5711d908`).
- **Net:** No tolerance loosened, no fixture edited, no behavior compromise — only the plan's per-task green expectation shifted one task later. Wave contract (a)-(d) + ruin-clamp all green is satisfied.

No fixture corrections were required (Task 2's contingency for (d)/(e) fixture-value fixes went unused — the pinned 1.6667 / ceiling:2.5 values held against the real engine).

## Out-of-scope RED (expected, declared later-plan)
6 tests remain RED, all declared **Plan 113-03 composer-UI scope** (they fail on the `scenario-leverage-mode-toggle` testid that 113-03 adds — nothing to do with the solver):
- `ScenarioComposer.test.tsx` Phase-113 (h)-(l) Target-mode component tests (5).
- `ScenarioComposer.save.test.tsx` Phase-113 (a) solved-L persistence test (1).

## Known Stubs
- `SolveLeverageResult` still carries the `"unimplemented"` union variant. This is the Wave-0-only scaffolding flag; **Plan 113-02 grep-deletes it** (T-113-01). The implemented solver never returns it — it is dead-but-declared until 113-02. Documented in the module TSDoc.

## Gates
- `git diff --exit-code origin/main -- src/lib/scenario.ts` — clean (SC-3 byte-frozen; the solver only CALLS `computeScenario`).
- `npx tsc --noEmit` — exit 0.
- `npx eslint src/app/(dashboard)/allocations/lib/solve-leverage.ts` — exit 0.
- `solve-leverage.test.ts` — 7/7 green.
- Full `src/app/(dashboard)/allocations` sweep — 1545 passed, 6 failed (all the declared 113-03 UI REDs above; no unexpected regressions vs the 113-00 baseline).

## Threat surface
- T-113-02 (Tampering, target input) — mitigated: `Number.isFinite` + `(0,1)` gate returns honest `degenerate`, never a clamp/NaN-propagation.
- T-113-03 (DoS, per-solve eval loop) — mitigated: hard domain bounds + fixed-iteration bisects (~30-35 memoized `computeScenario` calls, no unbounded loop). No new threat surface introduced (pure client-side numerical module, no network/auth/schema).

## Task Commits
1. **Task 1: sleeve-state builder + degenerate short-circuits + monotone smallest-L bisect** — `fdd0398b` (feat)
2. **Task 2: ruin-clamped domain via monotone L_ruin bisect + honest ceiling** — `5711d908` (feat)

## Self-Check: PASSED
- Created/modified files present: `src/app/(dashboard)/allocations/lib/solve-leverage.ts` (FOUND).
- Commits present: `fdd0398b` (Task 1, FOUND), `5711d908` (Task 2, FOUND).
- scenario.ts freeze clean; tsc 0; eslint 0; 7/7 solver tests green.

---
*Phase: 113-weights-max-dd-l-solver*
*Completed: 2026-07-17*
