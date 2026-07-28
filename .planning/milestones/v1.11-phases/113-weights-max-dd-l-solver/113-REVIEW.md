---
phase: 113-weights-max-dd-l-solver
reviewed: 2026-07-17T08:01:44Z
depth: deep
files_reviewed: 2
files_reviewed_list:
  - src/app/(dashboard)/allocations/lib/solve-leverage.ts
  - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
findings:
  blocker: 0
  high: 0
  medium: 1
  low: 2
  total: 3
status: issues_found
---

# Phase 113: Code Review Report — max-DD → leverage solver

**Reviewed:** 2026-07-17T08:01:44Z
**Depth:** deep (solver traced against the frozen engine contract + full UI wiring + all 3 test files + CONTEXT/RESEARCH)
**Files Reviewed:** 2 production files (solver + ScenarioComposer)
**Status:** issues_found — no BLOCKER/HIGH. The solver core is sound; 3 UI-state-hygiene defects in `ScenarioComposer.tsx`.

## Summary

The solver (`solve-leverage.ts`) is **correct on every domain-risk axis I was asked to hunt**:

- **Bisect / monotonicity (risk 1):** the target function is a *pure* single sleeve — `sleeveStateAt` hard-restricts `selected={[ref]:true}` / `weights={[ref]:1}` and never spreads `engineState.selected`, so no other constituent leaks in. `portDaily = L·r` is genuinely monotone-|dd| in L until ruin → the plain smallest-L bisect is valid. Invariant is sound: `lo=0` (`|dd(0)|=0<target`), `hi=L_max` (proven `≥target` by the reachability pre-check); `hi` converges to the lower end of any 5dp plateau = smallest-L semantics. Magnitude comparison via `Math.abs` is consistent with the engine's negative-fraction convention.
- **Ruin-clamp (risk 2):** the ruin predicate `ddAt(L)===null` is only consulted after `ddAt(0)` (n≥10) and `ddAt(1)` (non-ruin at 1×) short-circuits, so an in-domain null can only mean ruin. Ruin bisect keeps `L_max` = last-proven-non-ruined `lo`; the solve never samples above it. A never-ruining sleeve clamps to `MAX_LEVERAGE`; ruin ≤1× → honest `degenerate`.
- **Honest states (risk 3):** every infeasible/degenerate branch returns a value-FREE discriminated result (no `leverage`/`sleeveMaxDD` field). Input gate refuses non-finite/≤0/≥1 targets as `degenerate` without clamping. `insufficient-history` uses the clean `ddAt(0)===null` discriminator (all-zero series at L=0 ⇒ engine null only via the n<10 floor). Tests (e)/(f)/113-02 RED-proof the no-fabrication contract.
- **Tolerances (risk 4):** `DD_TOL=1e-3` sits above the engine's 5dp rounding; round-trip test (g)/(g2) is non-tautological (re-feeds the ENGINE + a perturbation that must break the match).
- **SC-3 (risk 9):** confirmed — the diff touches only the 2 production files + 3 test files; `src/lib/scenario.ts` is untouched. The solver calls `computeScenario`, never re-implements it.
- **Phase-112 landmine (risk 8):** the mode toggle + solve write LEVERAGE only (`handleLeverageChange`); no weight write, no sole-unit refuse, no `diffCount` leak. Test (l) guards weight-byte-invariance.

Three defects remain — all **UI transient-state hygiene**, none affecting solver correctness or persisted data. The one MEDIUM is a stale/dishonest transient display; the two LOWs are error-banner coherence nits. All three are concrete and reproducible.

---

## Findings

| ID | Severity | File:line | Issue |
|----|----------|-----------|-------|
| F1 | MEDIUM | ScenarioComposer.tsx:2043-2088 | `handleRemoveAdded` purges `leverageByRef` but NOT `targetModeByRef`/`solveResultByRef` — stale Target mode + dishonest solve note bleed across remove→re-add of the same id |
| F2 | LOW | ScenarioComposer.tsx:5238 / 2779-2785 | Empty-target blur (`Number("")===0`) fires the out-of-range commit-error banner on a benign focus/blur |
| F3 | LOW | ScenarioComposer.tsx:2793-2797 | A valid-but-infeasible target commit does not clear a prior stale range-error banner, contradicting the honest state line |

---

## MEDIUM

### F1: `handleRemoveAdded` leaks transient Target-mode state across a remove→re-add of the same id

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:2043-2088` (the `setLeverageByRef` purge at :2080)

**The gap.** Phase 113 correctly resets the transient `targetModeByRef` / `solveResultByRef` alongside `setLeverageByRef` at all three *session* seams (reset/commit :1379-1383, readonly-open :1599-1606, editable-reopen :1654-1661). But there is a **fourth** `leverageByRef` mutation seam — `handleRemoveAdded` (:2080-2084) — which purges the removed leg's leverage overlay (LEV-02) yet does **not** purge its `targetModeByRef[id]` / `solveResultByRef[id]`. The adjacent comment (:2073-2079) states the exact reason the leverage purge exists: the leg's overlay "would … re-apply the instant the leg is re-added" — the same seam re-uses the same catalog id (confirmed by the sibling `T_C_ASSETCLASS_PURGE` / `WR-01` remove+re-add tests). The target-mode twins ride that identical seam and are missed.

**Failure scenario (inputs → wrong output).**
1. Add catalog strategy `X`; flip its row to Target mode; commit a reachable target (e.g. 20%). Now `targetModeByRef[X]=true`, `solveResultByRef[X]={ok:true, leverage:4.0, …}`, `leverageByRef[X]=4.0`.
2. Remove `X` (`handleRemoveAdded`). `leverageByRef[X]` is purged → default 1×. `targetModeByRef[X]` and `solveResultByRef[X]` **survive**.
3. Re-add the same `X`. The row re-mounts with `targetModeByRef[X]` still `true` → it opens in **Target mode** with the leverage input read-only showing the purged **1×**, while `renderSolveState` renders the **stale** `ok` note: *"Portfolio max-DD at 4.00× (computed for the whole book): …"*.

The "4.00×" is a stale/fabricated derived value shown against an actual applied leverage of 1× — precisely the value-shaped dishonesty WEIGHTS-04 / DESIGN.md Numbers Contract forbid, and a break of the "a re-add starts clean" contract the surrounding purges enforce. (Engine math itself is correct — the leverage *is* 1× — so this is a display/coherence defect, not a wrong computed number, hence MEDIUM not HIGH.)

**Fix direction.** In `handleRemoveAdded`, mirror the `leverageByRef` purge for the two transient maps (drop `id` from both), exactly as the three session seams do:
```ts
setTargetModeByRef((prev) => { if (!(id in prev)) return prev; const { [id]:_d, ...rest } = prev; return rest; });
setSolveResultByRef((prev) => { if (!(id in prev)) return prev; const { [id]:_d, ...rest } = prev; return rest; });
```
Add a regression test (remove→re-add of a solved Target-mode leg asserts the re-added row is back in Leverage mode with no `scenario-target-dd-portfolio-note`).

---

## LOW

### F2: Empty-target blur surfaces the out-of-range error banner on a benign focus/blur

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:5238` (`onBlur={(e) => onCommitTarget(ref, Number(e.target.value))}`) → `handleTargetCommit` :2779-2785

**Failure scenario.** The Target input is uncontrolled and mounts empty. Flip a row to Target mode, focus the empty input, then move focus away without typing (e.g. click the toggle to go back to Leverage, or click elsewhere). `onBlur` fires with `value===""`; `Number("")===0`; `handleTargetCommit(ref, 0)` hits `targetPct <= 0` and calls `setCommitError("Enter a max-drawdown target above 0% …")`. A no-op gesture raises a global commit-error banner.

**Fix direction.** Treat an empty/blank commit as a no-op before validating: `const raw = e.target.value.trim(); if (raw === "") return;` (or guard `handleTargetCommit` on `e.target.value === ""`). Do not surface the range error for an empty field.

### F3: A valid-but-infeasible commit leaves a stale out-of-range banner up, contradicting the honest state line

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:2793-2797` (the `if (result.ok)` tail of `handleTargetCommit`)

**Failure scenario.**
1. Commit an out-of-range target (e.g. `150`) → banner: *"Enter a max-drawdown target above 0% and below 100% …"*.
2. Commit a now **in-range but unreachable** target (e.g. `99` capped by `MAX_LEVERAGE`). Validation passes, the solver returns `{ok:false, reason:"unreachable"}`. `handleTargetCommit` sets `solveResultByRef` (row shows the honest *"Unreachable at 10× —"* line) but only clears `commitError` **inside `if (result.ok)`** — so the stale *"…below 100%"* banner from step 1 stays up, now contradicting the in-range input and the honest per-row line.

**Fix direction.** Clear the range-error banner as soon as the input passes the range gate (before/independent of the solve outcome), since an honest infeasible result is surfaced by `renderSolveState`, not by `commitError`. E.g. call `setCommitError(null)` right after the range gate passes, regardless of `result.ok`.

---

## Confirmed non-issues (hunted, cleared)

- **Non-monotone target function** — cleared: `sleeveStateAt` is a pure single-sleeve state; no cross-constituent leakage.
- **Bisect returning a non-smallest L / off-by-one bracket / non-termination** — cleared: invariants hold; both loops bounded (`>1e-2` / `>1e-4` width).
- **null/NaN through `Math.abs`** — cleared: every in-domain eval is null-guarded (pre-check + defensive returns inside both loops).
- **Portfolio-DD staleness after solve** — cleared: solve writes `leverageByRef` in the same handler → `scenarioMetrics` memo recomputes → `portfolioMaxDrawdown` prop is fresh in the same render; `formatPercent` returns `—` on null/non-finite (utils.ts:8).
- **Session bleed across scenario switch** — cleared for the three save/reset seams (the miss is the remove seam, F1).
- **Stale closures / missing hook deps** — cleared: `handleTargetCommit` / `handleSetTargetMode` and the three `render*` helpers are plain (non-memoized) closures, re-created each render over fresh memoized engine inputs.
- **SC-3 freeze** — cleared: `scenario.ts` untouched by the diff.

---

_Reviewed: 2026-07-17T08:01:44Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
