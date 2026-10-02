---
phase: 113-weights-max-dd-l-solver
verified: 2026-07-17T10:00:00Z
status: passed
score: 4/4 requirements delivered
method: goal-backward, working-tree + live gate run (SUMMARY claims NOT trusted)
gates:
  - name: "Phase-113 solver + composer + save tests"
    command: "npx vitest run solve-leverage.test.ts ScenarioComposer.test.tsx ScenarioComposer.save.test.tsx --no-file-parallelism"
    result: "3 files passed, 235 tests passed"
  - name: "SC-3 backbone gates + scenario freeze"
    command: "npx vitest run src/lib/scenario-backbone-gates.test.ts src/lib/scenario.test.ts"
    result: "2 files passed, 59 tests passed"
  - name: "SC-3 byte-freeze"
    command: "git diff --exit-code origin/main -- src/lib/scenario.ts"
    result: "CLEAN (byte-frozen)"
advisory_human_check:
  - test: "/qa on dev server — set a sleeve Target max-DD; confirm derived-L cell + resulting portfolio max-DD readout render read-only, em-dash on infeasible, honest copy per DESIGN.md Numbers Contract"
    why_human: "Visual copy nuance; functional path fully proven by automated tests (j/k/l)"
    blocking: false
---

# Phase 113: WEIGHTS (max-DD → leverage solver) Verification Report

**Phase Goal:** An allocator can set a per-constituent max-drawdown target that back-solves the implied leverage, with the derived leverage always visible and honest failure states.
**Verified:** 2026-07-17
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A per-row mode toggle defaults to Leverage; Target-max-DD is opt-in | ✓ VERIFIED | `ScenarioComposer.tsx:5193` `isTarget = targetModeByRef[ref] === true` (absent ⇒ default Leverage); toggle rendered `renderModeToggle` at 5396/5522; test (i) at `ScenarioComposer.test.tsx:5840` asserts default-Leverage + editable lev input |
| 2 | A sleeve max-DD target back-solves L numerically on the REAL frozen transform | ✓ VERIFIED | `solve-leverage.ts:136-162` builds `{selected:{[ref]:true},weights:{[ref]:1},leverage:{[ref]:L}}` → `computeScenario(...).max_drawdown`; monotone smallest-L bisect 227-251; NO hand-rolled DD math |
| 3 | Derived L stays visible read-only | ✓ VERIFIED | `ScenarioComposer.tsx:5409` `readOnly={targetModeByRef[k.id]===true}` on the leverage input (never `disabled` in Target mode) — value `leverageByRef[k.id]` still shown; test (j) 5919-5923 asserts value updates & visible |
| 4 | Solved L routes through the Phase-112 leverageByRef path | ✓ VERIFIED | `handleTargetCommit` (2779-2799) on `result.ok` calls `handleLeverageChange(scopeRef, round(L))` — same clamp/message/persist path |
| 5 | Resulting PORTFOLIO max-DD is a COMPUTED display value, not solved | ✓ VERIFIED | note reads `portfolioMaxDrawdown` (5261) = `scenarioMetrics.max_drawdown` (4719); copy says "computed for the whole book"; test (j) 5927 asserts note renders |
| 6 | Honest infeasible/degenerate states, never a fabricated leverage/DD | ✓ VERIFIED | discriminated `reason` union (`solve-leverage.ts:66-76`); UI em-dash `renderSolveState` 5266-5273; test (k) 5938 asserts "unreachable at …×" + em-dash + leverage byte-unchanged |
| 7 | Mode + target transient; only solved L persists; no schema bump | ✓ VERIFIED | `targetModeByRef`/`solveResultByRef` reset at 3 session-bleed sites (1382, 1605, 1660); no `SCENARIO_SCHEMA_VERSION` write; save.test 392 asserts `schema_version === SCENARIO_SCHEMA_VERSION` |
| 8 | scenario.ts byte-frozen (SC-3) | ✓ VERIFIED | `git diff --exit-code origin/main -- src/lib/scenario.ts` CLEAN; 59 backbone/scenario tests green |

**Score:** 8/8 truths verified

### Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
|-------------|-------------|--------|----------|
| WEIGHTS-03 | 113-00/01/03/04 | ✓ DELIVERED | Mode toggle (default Leverage) + numerical sleeve solve + derived-L read-only visible + computed portfolio-DD display. Passing tests: solver (a) founder 5%→20%→L=4.000 (`solve-leverage.test.ts:110`); composer (i)(j) toggle+solve wiring. |
| WEIGHTS-04 | 113-00/02/04 | ✓ DELIVERED | Non-tautological round-trip with perturbation teeth: (g) lever-up `solve-leverage.test.ts:203`, (g2) deleverage :238 — both assert `perturbed - target > DD_TOL`. Full honest-state matrix (unreachable/no-drawdown/insufficient-history/degenerate); input-gate degenerate no-throw :274. |
| FOUNDER LOCK | 113-CONTEXT | ✓ DELIVERED | Sleeve target = `computeScenario({[ref]:true},{[ref]:1},{[ref]:L}).max_drawdown` (NOT portfolio-solve) `solve-leverage.ts:136-162`; MONOTONE smallest-L bisect (`hi` converges to lower end on flat plateaus, 227-245); ruin-clamp `[0, min(MAX_LEVERAGE, L_ruin)]` (196-208); one-shot sole call site (2786); transient mode+target; solved L → leverageByRef; NO schema bump. Founder 5%→20%→4.000 is a passing acceptance value. |
| SC-3 | 113-04 | ✓ DELIVERED | scenario.ts byte-frozen (clean diff); backbone gates + scenario.test green (59). |

### Key Link Verification (Nyquist "test the wiring, not just the helper")

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| Mode toggle (UI) | targetModeByRef | `handleSetTargetMode` (2755) | ✓ WIRED | flip on/off; off drops solveResult (2757-2763) |
| Target input commit | `solveLeverageForMaxDD` | `handleTargetCommit` (2786) sole call site | ✓ WIRED | one-shot on blur/Enter, fail-loud on out-of-range |
| Solver result (ok) | leverageByRef | `handleLeverageChange` (2797) | ✓ WIRED | solved L persists via Phase-112 path |
| Solver (single ref) | frozen engine | `computeScenario` sleeve state (154-159) | ✓ WIRED | no engine edit, no duplicated math |
| scenarioMetrics.max_drawdown | portfolio-DD note | `portfolioMaxDrawdown` prop (4719→5261) | ✓ WIRED | computed display, not solved |

End-to-end proven by composer test (j) `ScenarioComposer.test.tsx:5896`: click toggle → type "20" → blur → leverage input value changes to >1 AND ≠ before (solved L written) AND portfolio-DD note renders. Test (k) proves infeasible path writes NOTHING to leverage. Test (l) proves the solve writes leverage only (all weights byte-unchanged — Phase-112 landmines untouched).

### Behavioral Spot-Checks (live gate run)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Solver + composer + save suites | `vitest run solve-leverage/ScenarioComposer/save --no-file-parallelism` | 3 files, **235 tests passed** | ✓ PASS |
| SC-3 backbone + scenario freeze | `vitest run scenario-backbone-gates scenario.test` | 2 files, **59 tests passed** | ✓ PASS |
| scenario.ts byte-freeze | `git diff --exit-code origin/main -- src/lib/scenario.ts` | CLEAN | ✓ PASS |

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| solve-leverage.ts | `"unimplemented"` variant | ℹ️ Info | REMOVED from the result union (66-76); only appears in RED-scaffold test comments/history — cannot ship |
| — | symbol-keyed leverage path | ℹ️ Info | None — inputs key by `k.id`/`a.id` (engine-unit / added-strategy ids), never a symbol/coin (CONSTIT-04 respected) |

No BLOCKER or WARNING anti-patterns. No unreferenced TBD/FIXME/XXX in phase-modified files.

### Human Verification (advisory, non-blocking)

The one manual item from 113-VALIDATION is a **visual copy nuance**, not a functional gap — the functional path is fully proven by tests (j)/(k)/(l):

1. **Target-max-DD copy honesty** — `/qa` on a dev server: set a sleeve target, confirm the derived L and the resulting portfolio max-DD render read-only with honest infeasible states per DESIGN.md Numbers Contract. (Advisory only; does not block the phase.)

### Gaps Summary

None. Every requirement (WEIGHTS-03, WEIGHTS-04, FOUNDER LOCK, SC-3) is DELIVERED against the working tree with a passing, fail-without-the-fix test. The founder 5%→20%→L=4.000 acceptance value is a passing assertion. The UI end-to-end calls the solver and writes `leverageByRef` (Nyquist wiring proven). scenario.ts is byte-frozen. Both gate batteries are green (235 + 59). The sole remaining item is an advisory visual-copy QA check, which is non-blocking.

---

## Post-Verification Review Pipeline (2026-07-17, after this goal-backward pass)

A full review pipeline ran on the shipped state AFTER this goal verification and surfaced UI transient-state hygiene defects the goal check is not designed to catch. All fixed at root, re-gated green; status stays **passed** (fixes strengthened honesty, engine still frozen).

- **Opus code review** → 0 BLOCKER / 0 HIGH / 1 MEDIUM / 2 LOW (solver core cleared as correct on every domain axis — monotone bisect, ruin-clamp, honest states, non-tautological round-trip):
  - **F1** (MEDIUM, fixed `a8842472`) — `handleRemoveAdded` stranded the `targetModeByRef`/`solveResultByRef` twins (only `leverageByRef` purged) → remove→re-add reopened a stale Target-mode note. Fixed at root via a UNIFIED reset (`clearRowTransientState(ref)` + `resetAllTransientState()`), all 4 seams routed through them.
  - **F2** (LOW, fixed `596e3bb1`) — empty-target blur (`Number("")===0`) raised a spurious range banner. Guarded `raw.trim() !== ""` in both commit paths.
  - **F3** (LOW, fixed `8f0b214d`) — a valid-but-infeasible commit left a stale range banner beside the honest infeasible state. Clear on every in-range commit.
- **Fable red team (on the fixed state)** → 1 MEDIUM + 1 LOW confirmed (2 more transient/banner-hygiene issues — same class as F1; solver core + all held items cleared):
  - **RT113-01** (MEDIUM, fixed `4b252c44`) — excluding a solved Target-mode row stranded a misleading portfolio-DD note ("at 4.00×" of a leg no longer in the book). Root-cause render-gate: `renderSolveState` returns null when `draft.toggleByScopeRef[ref] === false` — the exact complement of both call sites' inclusion predicate (per-key `included` :5372 / added `enabled` :5497, both `!== false`), verified by inspection. NOT a twin-clear (exclusion is reversible; re-include recomputes against the live full-book DD).
  - **RT113-02** (LOW, fixed `2db6035b`) — F3's banner clear evicted unrelated shared-banner tenants on a no-op infeasible commit. Scoped via a `TARGET_DD_RANGE_ERROR` const + `setCommitError(prev => prev === TARGET_DD_RANGE_ERROR ? null : prev)` — clears only a stale target-range banner; F3 intent preserved.
- **Delta verification** — the RT113-01 render-gate predicate confirmed to match both row types by construction (recurring "sibling-predicate" failure mode closed); RED-proofs cover per-key AND added rows.

Final gate battery after all fixes: SC-3 `scenario.ts` byte-frozen; Phase-113 suites 241 pass; full allocations sweep 118 files / 1562 tests pass (0 failed; the `AllocationsTabs.scenario-state-preservation` parallelism flake is green under `--no-file-parallelism`); tsc 0; lint 0; coverage held. 5 fix commits total.

**Verdict: Phase 113 (max-DD→L solver) COMPLETE — verified + reviewed + red-teamed clean.**

---

_Verified: 2026-07-17_
_Verifier: Claude (gsd-verifier) — goal-backward, working-tree evidence + live gate run_
_Review pipeline appended: 2026-07-17 (code-review → red-team → all fixed/clean)_
