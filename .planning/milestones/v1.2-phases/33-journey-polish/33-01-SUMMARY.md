---
phase: 33-journey-polish
plan: 01
subsystem: testing
tags: [vitest, regression-test, scenario-composer, bridge-seam, projection, non-vacuous, flow-01, frozen-spine]

# Dependency graph
requires:
  - phase: 10-scenario-state
    provides: scenario-state.addStrategyBridge pure mutator (the Bridge-add weight transform)
  - phase: 23-persistence
    provides: scenario-compare.computeMetricsForDraft (the pure frozen-engine projection path)
  - phase: 29-32-allocator-cohesion
    provides: ScenarioComposer.tsx:2334 composer-owned BridgeDrawer onAddToScenario mount; SCENARIO-05 frozen-spine zero-diff guards
provides:
  - "Non-vacuous JOURNEY-01 regression test pinning the integrated Bridge→composer seam (CTA → mutator → projection MOVES)"
  - "FLOW-01 reachability-hinge guard: composer-owned BridgeDrawer is the ONLY onAddToScenario mount (1 vs 0 source-count)"
affects: [journey-polish, scenario-composer, bridge, regression-suite]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Non-vacuous seam test: assert a projection DELTA out of computeMetricsForDraft, not just addedStrategies membership"
    - "Falsifiability-by-construction: test fails when the mutator is neutered to `return draft` (proven once, recorded)"
    - "Source-inspecting reachability guard via fs.readFileSync + prop-form regex count (mirrors src/__tests__ phase-3x frozen-spine idiom)"

key-files:
  created:
    - "src/app/(dashboard)/allocations/components/__tests__/bridge-to-composer-seam.test.tsx"
  modified: []

key-decisions:
  - "Reused the scenario-compare.test.ts liveInputs/buildDates/altReturns fixtures verbatim instead of export-widening any production module — the bridge candidate is given a DISTINCT return profile so its inclusion provably moves the blended-curve metrics."
  - "Reachability hinge counts the JSX prop-assignment form `onAddToScenario={` (regex), NOT a bare `onAddToScenario` substring — ScenarioComposer.tsx mentions the prop name once in its file-header comment, so the prop-form count (1) is comment-free and unambiguous; BridgeWidget.tsx is 0."
  - "Assertion (d) (projection delta on twr AND volatility, toBeCloseTo precision 6 negated) is the load-bearing non-vacuous gate; assertions (a)/(b)/(c) mirror scenario-state.test.ts:250-253 (T1.5) exact-weight style."

patterns-established:
  - "Integrated-seam regression test: drive mutator → projection and assert a numeric metric move, with an explicit falsifiability comment so a future reader can verify non-vacuity without re-deriving it."
  - "Reachability guard self-pin: assert the matcher counts a synthetic positive sample as 1 so a future regex-loosening that makes the guard inert is itself caught."

requirements-completed: [JOURNEY-01]

# Metrics
duration: ~9min
completed: 2026-06-23
---

# Phase 33 Plan 01: JOURNEY-01 Non-Vacuous Bridge→Composer Seam Regression Test Summary

**One Vitest spec that drives the integrated Bridge-add path (addStrategyBridge → computeMetricsForDraft) and proves the projection MOVES — not just a membership flag — plus a source-inspecting FLOW-01 reachability guard that the composer-owned BridgeDrawer is the sole onAddToScenario seeding path. Zero production-code change; frozen `scenario.ts` stays zero-diff.**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-06-23T22:32:00Z (approx)
- **Completed:** 2026-06-23T22:35:00Z (approx)
- **Tasks:** 1
- **Files modified:** 1 created (test only)

## Accomplishments

- **Non-vacuous projection-delta pin (JOURNEY-01 core):** builds the 2-holding `defaultDraftFromHoldings(HOLDINGS_2)` baseline (BTC 0.6 / ETH 0.4), snapshots `computeMetricsForDraft`, applies `addStrategyBridge(draft, "holding:binance:BTC:spot", STRAT_B)`, recomputes, and asserts (a) membership, (b) exact bridged weight `0.6/1.6` to 9 places, (c) flagged-holding dilution, and (d) a genuine numeric move in `twr` AND `volatility`. Closes the T_USE6 gap (the existing hook test asserts membership only, vacuous w.r.t. the projection).
- **Falsifiability demonstrated and recorded:** neutering `addStrategyBridge` to `return draft` makes the test go RED at assertion (a) (`expected [] to include 'uuid-2'`); reverted immediately. Red output captured below.
- **FLOW-01 reachability-hinge guard:** reads `ScenarioComposer.tsx` and `BridgeWidget.tsx` from disk and asserts the `onAddToScenario={` prop-form count is exactly 1 vs 0 — pinning that only the composer-owned drawer can seed the draft. Includes a self-pin so the regex cannot silently go inert.
- **Frozen-spine integrity preserved:** `git diff --exit-code src/lib/scenario.ts src/lib/scenario.test.ts` is clean (SCENARIO-05); `scenario-state.ts` returned to zero-diff after the falsifiability probe.

## Task Commits

Each task was committed atomically:

1. **Task 1: Non-vacuous Bridge-add projection-delta + reachability regression test** - `5ce18bcc` (test)

**Plan metadata:** (this commit) (docs: complete plan)

_Note: This is a `type: tdd` task implemented as a single GREEN spec against an already-shipped seam — the seam (addStrategyBridge / computeMetricsForDraft / the composer mount) pre-exists, so the cycle is "write the pinning test → prove it passes live → prove it fails when the seam is neutered → revert", not a fresh RED→GREEN implementation of new behavior._

## Files Created/Modified

- `src/app/(dashboard)/allocations/components/__tests__/bridge-to-composer-seam.test.tsx` - New regression spec: (1) the non-vacuous projection-delta test driving `addStrategyBridge` → `computeMetricsForDraft`, and (2) the source-inspecting FLOW-01 reachability-hinge guard.

## Falsifiability Red-Run (recorded per plan `<output>`)

The seam was neutered once to prove the test is non-vacuous. Edit applied to `src/app/(dashboard)/allocations/lib/scenario-state.ts`:

```ts
export function addStrategyBridge(draft, holdingScopeRef, strategy): ScenarioDraft {
  return draft; // FALSIFIABILITY PROBE — TEMPORARY, REVERTED IMMEDIATELY
  // M9 — dedupe guard: already in addedStrategies → no-op.
  if (draft.addedStrategies.some((s) => s.id === strategy.id)) return draft;
  ...
```

`npx vitest run` output with the seam neutered (RED):

```
 ❯ src/app/(dashboard)/allocations/components/__tests__/bridge-to-composer-seam.test.tsx (2 tests | 1 failed) 16ms
     × carries the candidate into the draft AND MOVES the projection (non-vacuous) 13ms

 FAIL  ... > Bridge → composer seam (JOURNEY-01) > carries the candidate into the draft AND MOVES the projection (non-vacuous)
AssertionError: expected [] to include 'uuid-2'
 ❯ src/app/(dashboard)/allocations/components/__tests__/bridge-to-composer-seam.test.tsx:174:51
    174|     expect(next.addedStrategies.map((s) => s.id)).toContain(STRAT_B.id…

 Test Files  1 failed (1)
      Tests  1 failed | 1 passed (2)
```

The non-vacuous test fails at assertion (a) (membership) — the no-op never adds the candidate, so its weightOverride (b) is never written and the recomputed projection (d) is byte-identical to the baseline. (The reachability-hinge test correctly stays green: it inspects source files, not the mutator.) The probe was reverted immediately; `git diff --exit-code` confirms `scenario-state.ts` is zero-diff and the test re-runs GREEN (2 passed).

## Decisions Made

- **Fixture reuse over export-widening:** redefined the minimal `HOLDINGS_2` / `STRAT_B` / `buildDates` / `altReturns` / `sumEnabled` helpers locally (verbatim copies of the shipped `scenario-state.test.ts` and `scenario-compare.test.ts` idioms) rather than export-widening any production module — honoring the plan's "do NOT export-widen the production module just for the test."
- **Distinct candidate return profile:** the bridge candidate (`uuid-2`) is given a `>=30`-day series (clears the adapter warm-up gate) with an opposite-phase, larger-amplitude profile (`altReturns(dates, -0.015, 0.02)`) so that, once `addStrategyBridge` gives it ~37.5% of the blend, the projected `twr`/`volatility` provably move — making assertion (d) a real gate rather than a coincidental tie.
- **Prop-form regex for the reachability count:** counted `onAddToScenario={` (the JSX prop-assignment form) rather than the bare token, because the composer's file-header comment mentions the prop name in prose; the prop form yields the clean 1-vs-0 split the plan specifies.

## Deviations from Plan

None - plan executed exactly as written. No production source was modified (the falsifiability probe to `scenario-state.ts` was a temporary, immediately-reverted verification step, not a deviation). No new dependency, no schema change, no architectural change. The Next.js / React / cache-component skill injections triggered by the `.tsx` path were correctly disregarded — this is a pure Vitest data/logic spec with no React render, hooks, or Server-Component surface.

## Issues Encountered

None. The analog `scenario-compare.test.ts` fixture pattern transferred directly; typecheck (`tsc --noEmit`) and ESLint on the new file both passed clean on the first run.

## Self-Check: PASSED

- `src/app/(dashboard)/allocations/components/__tests__/bridge-to-composer-seam.test.tsx` — FOUND
- Commit `5ce18bcc` — FOUND (test commit, hooks ran, no --no-verify)
- `git diff --exit-code src/lib/scenario.ts src/lib/scenario.test.ts` — CLEAN (SCENARIO-05)
- Seam test re-run after revert — GREEN (2 passed)

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- JOURNEY-01 is pinned by a non-vacuous, falsifiable test + a FLOW-01 reachability guard. Ready for Plan 33-02 (JOURNEY-02 entry-point/empty-state DESIGN.md consistency sweep) and 33-03 (JOURNEY-03 WCAG-AA composer axe spec).
- No blockers. The composer-owned drawer is confirmed as the sole seeding path; if a future edit wires `onAddToScenario` into a BridgeWidget drawer or drops it from the composer, the reachability count assertion fails loudly.

---
*Phase: 33-journey-polish*
*Completed: 2026-06-23*
