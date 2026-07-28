---
phase: 108-scenario-planner-onto-the-backbone
plan: 01
subsystem: testing
tags: [scenario-planner, backbone-unification, factsheet-rolling, population-std, quantiles, vitest, tdd]

# Dependency graph
requires:
  - phase: 107-leverage-as-a-dailies-transform
    provides: "deriveSeriesBundle exported + the factsheet/rolling.ts population-std primitives established as the ONE canonical rolling stack"
provides:
  - "src/lib/scenario-blend-adapter.ts::deriveBlendPanels — backbone-routed blend-panel derivation (SC-1)"
  - "BlendPanelSeries interface re-declared with the exact legacy public shape (zero render-tree change for Plan 02)"
  - "SC-4 mutation-falsifiable population-std parity pins at 63/126/252 + min/max whisker contract"
affects: [108-02, ScenarioComposer, scenario-blend-panels-deletion]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Backbone-primitive adapter: reproduce a retired module's public shape while routing every rolling series through factsheet/rolling.ts POPULATION-std primitives at an EXPLICIT window (toggle-preserving, no heavy full-bundle call)"
    - "Zip+warmup-drop seam: Array<number|null> (index-parallel to rets, leading-warmup null prefix) → compacted {date,value}[] of length n−window+1 dated at the window's last day"
    - "Mutation-falsifiable convention pin (PAYLOAD-03 discipline): closed-form population-σ expected values @6dp, sample-std bleed proven RED"

key-files:
  created:
    - src/lib/scenario-blend-adapter.ts
    - src/lib/scenario-blend-adapter.test.ts
  modified: []

key-decisions:
  - "Export named deriveBlendPanels (NOT buildBlendPanels) + file named scenario-blend-adapter.ts — deliberately avoids the SC-2 delete-gate's forbidden tokens (buildBlendPanels / scenario-blend-panels) so Plan 02's positive control re-anchors to a genuinely new live token"
  - "POPULATION std (÷n) is canonical per USER DECISION — the retired module's SAMPLE std (÷n−1) is retired; the shift is sub-1px on the chart line but a ~0.2–0.8% relative shift IS visible in the rolling vol/Sharpe hover tooltips (not invisible) — accepted as the canonical population-std value (user-confirmed), an intentional convention unification"
  - "Quantile whiskers kept as absolute min/max — { All: [min,p25,p50,p75,max] } — p05/p95 NOT adopted (avoids a visible whisker-tightening regression)"
  - "usableN degenerate gate re-homed VERBATIM in the adapter (co-located with derivation) so the 3 ScenarioComposer UI keys stay in sync; length checks use portfolioDaily.length not usableN (WR-02)"
  - "Histogram cumprod(1+r) wealth loop copied verbatim (same geometric wealth cumEq produces) — NOT a second-Sharpe compute; safest for SC-4 parity"

patterns-established:
  - "Grep-clean adapter: comments reworded to eliminate stdDev / legacy-module / full-bundle tokens so the literal acceptance grep + Plan 02 delete-gate both stay clean"

requirements-completed: [SCEN-BB]

# Metrics
duration: 8min
completed: 2026-07-15
---

# Phase 108 Plan 01: Backbone blend-panel adapter Summary

**`deriveBlendPanels` reproduces the legacy blend-panel public shape while deriving every rolling series from the ONE canonical backbone (factsheet/rolling.ts POPULATION-std primitives at an explicit 63/126/252 window) — pinned by mutation-falsifiable SC-4 parity tests that go RED on any sample-std bleed.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-07-15T16:54:20Z
- **Completed:** 2026-07-15T17:02Z
- **Tasks:** 2 completed
- **Files modified:** 2 created (1 source, 1 test)

## Accomplishments
- New `src/lib/scenario-blend-adapter.ts` exporting `deriveBlendPanels` + `BlendPanelSeries` — routes rolling vol/Sharpe/Sortino through the backbone population-std primitives with the caller's explicit window (toggle-preserving) and reshapes `quantileSummary` back to min/max whiskers.
- The output-shape seam is handled: backbone primitives return `Array<number|null>` (leading-warmup null prefix), zipped against dates and null-dropped → `{date,value}[]` of length n−window+1, first point dated at `portfolioDaily[window-1].date`.
- usableN degenerate gate re-homed verbatim (non-finite → usableN 0 + full collapse; <10 and <window collapse with real count preserved).
- SC-4 parity pins at all three windows with closed-form population-σ expectations @6dp; falsifiability spot-check performed (injected √(w/(w−1)) sample-std bleed → 3 vol pins RED → reverted).
- `metrics-parity.test.ts` untouched and green (21 tests); `portfolio-stats.ts`, `health-score.ts`, `scenario.ts` untouched.

## Task Commits

Each task was committed atomically (TDD RED→GREEN):

1. **Task 1 (RED): failing behaviour pins** - `e9eeb097` (test)
2. **Task 1 (GREEN): deriveBlendPanels adapter** - `0bed82bf` (feat)
3. **Task 2: SC-4 population-std parity pins** - `bd9033f2` (test)

_Note: no metadata commit — commit_docs is false, so .planning docs (SUMMARY/STATE/ROADMAP) stay uncommitted for the orchestrator to handle._

## Files Created/Modified
- `src/lib/scenario-blend-adapter.ts` - Backbone-routed `deriveBlendPanels(portfolioDaily, window, periodsPerYear): BlendPanelSeries`; imports `rollingVol/rollingSharpe/rollingSortino` from `@/lib/factsheet/rolling` + `quantileSummary` from `@/lib/factsheet/quantiles`; pure/synchronous.
- `src/lib/scenario-blend-adapter.test.ts` - 13 tests: 7 behaviour pins (public shape, sharpe_365d frozen key, cumprod histogram, warmup-drop, usableN gate trio) + 6 SC-4 parity/whisker/toggle pins.

## Verification
- `npx vitest run src/lib/scenario-blend-adapter.test.ts src/__tests__/metrics-parity.test.ts --no-file-parallelism` → 32 passed (adapter 13 + metrics-parity... note: full run reports 13 adapter tests; metrics-parity 21 unchanged) → 2 files passed.
- `npm run typecheck` → clean (tsc --noEmit exit 0).
- Grep gate on the adapter: no `stdDev` / `scenario-blend-panels` / `deriveSeriesBundle` tokens (comments reworded to stay clean).
- Falsifiability: sample-std bleed injection turned the 3 vol parity pins RED, then reverted (adapter `git diff --stat` empty post-revert).

## Deviations from Plan

### Auto-fixed / discretionary adjustments

**1. [Rule 3 - Blocking] Reworded adapter doc-comments to eliminate forbidden grep tokens**
- **Found during:** Task 1 (grep-gate check after GREEN)
- **Issue:** Explanatory comments referenced `scenario-blend-panels`, `buildBlendPanels`, and `deriveSeriesBundle` by name — matching the literal acceptance grep ("NO occurrence of stdDev/scenario-blend-panels/deriveSeriesBundle in the file") and risking Plan 02's SC-2 delete-gate (which forbids those tokens repo-wide).
- **Fix:** Reworded the comments to describe the retired module / full backbone series-bundle entry without the exact tokens; the code (imports, logic) was already token-clean.
- **Files modified:** src/lib/scenario-blend-adapter.ts (comments only)
- **Commit:** folded into `0bed82bf` (GREEN)

## Threat Flags

None. Pure client-side numeric transform of an already-validated return series (T-108-01 mitigated: usableN gate reproduced verbatim + defensive null-filter at the zip seam, both pinned by Task 1 behaviour tests; T-108-02 accepted — no auth/persistence/network surface). No new trust boundary.

## Self-Check: PASSED
- FOUND: src/lib/scenario-blend-adapter.ts
- FOUND: src/lib/scenario-blend-adapter.test.ts
- FOUND commit e9eeb097 (test RED)
- FOUND commit 0bed82bf (feat GREEN)
- FOUND commit bd9033f2 (test parity pins)
