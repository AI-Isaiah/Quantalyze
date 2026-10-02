---
phase: 30-factsheet-graphs-on-the-blend
plan: 02
subsystem: ui
tags: [scenario-composer, recharts, blend-graphs, honesty-guard, frozen-engine, tdd]

# Dependency graph
requires:
  - phase: 30-01
    provides: "buildBlendPanels(portfolioDaily, window) → BlendPanelSeries (histogramSeries cumulative-wealth, quantiles, rollingSharpe keyed sharpe_365d, rollingVol, rollingSortino, usableN)"
  - phase: 29
    provides: "ScenarioComposer unified projection region + the R3/IMPACT-02 honesty guard + the phase-29 frozen-spine guard pattern"
provides:
  - "Returns-distribution Card (GRAPH-02): ReturnHistogram fed the CUMULATIVE-wealth series + ReturnQuantiles, own overlap-N/horizon disclosure, role=status empty branch"
  - "Rolling-metrics Card (GRAPH-03): 3M/6M/12M SegmentedControl (63/126/252, default 126) + RollingMetrics(sharpe_365d, daysOfHistory=usableN) + RollingVolatilityChart + RollingSortinoChart, own disclosure, role=status empty branch"
  - "Extended R3/IMPACT-02 honesty guard — non-vacuous WITH the new panels mounted; static import guard (no FactsheetBody/MetricsColumn/payload-builder/PercentileRankBadge, no ingestSource:api)"
  - "phase-30-frozen-spine-guards.test.ts — git-delta zero-diff gate on scenario.ts + scenario.test.ts (fails loud on unresolvable baseline)"
affects: [31-graphs-lead-collapsible, 32-scenarios-retirement, 33-bridge-continuity-wcag]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Props-only <Card className=\"mt-6\"> sibling mount in the composer projection region (mirrors ScenarioBenchmarkSection/StressVarSection/CorrelationHeatmap)"
    - "LEAF charts only fed by the pure-TS adapter — never the strategyId-coupled *Panel.tsx wrappers; structural omission of the api-only peer/percentile path (LOCKED honesty invariant)"
    - "Per-panel GRAPH-04 disclosure (own overlap-N/horizon line) + role=status PartialDataBanner empty branch keyed off portfolio_daily_returns.length / usableN<window; never role=alert"
    - "Static source-read import guard (reads the .tsx off disk via node:fs) to block the forbidden factsheet/api-ingest path structurally"
    - "Phase frozen-spine git-delta guard mirroring phase-29 (execFileSync git, merge-base→FALLBACK_BASE_SHA fallback, fail-loud Rule 12)"

key-files:
  created:
    - "src/__tests__/phase-30-frozen-spine-guards.test.ts"
  modified:
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx"

key-decisions:
  - "Reword the source COMMENTS to avoid the literal forbidden tokens (factsheet body / metrics column / payload-builder / api-ingest) so the static import guard's regex passes on the real .tsx (same lesson as Plan 30-01 deviation #2)"
  - "Fold portfolioDaily into its own useMemo keyed on the engine output reference rather than a `?? []` const, so the buildBlendPanels memo is stable (react-hooks/exhaustive-deps)"
  - "Inert-mock the five blend-graph leaf charts in the composer test so the unit-under-test is the host panel CHROME (Card/heading/disclosure/empty/prop-wiring), not recharts internals; the histogram's cumulative-wealth input is asserted via vi.mocked(ReturnHistogram).mock.calls[0][0]"

patterns-established:
  - "Pattern: non-vacuous honesty guard EXTENDED in place — assert the new data-panel Cards ARE mounted alongside the percentile-rank-badge ABSENT checks, keeping the isolated PercentileRankBadge positive control intact"
  - "Pattern: frozen-engine zero-diff guard per phase, mirroring phase-29 verbatim with a phase-specific FALLBACK_BASE_SHA"

requirements-completed: [GRAPH-02, GRAPH-03, GRAPH-04]

# Metrics
duration: ~25min
completed: 2026-06-23
---

# Phase 30 Plan 02: Mount the Blend Graphs Summary

**Returns-distribution + Rolling-metrics Cards mounted on the BLENDED portfolio in the unified composer — fed by the Plan 30-01 `buildBlendPanels` adapter (leaf charts only, no factsheet/peer-rank path), each owning its own overlap-N/horizon disclosure and a role=status honest empty branch — plus a non-vacuous extension of the IMPACT-02 honesty guard, a static import guard, and a phase-30 frozen-engine zero-diff exit gate. The frozen engine stayed byte-frozen.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-06-23
- **Tasks:** 3 (all `auto`; Task 1 + Task 2 `tdd="true"`)
- **Files modified:** 2 modified, 1 created

## Accomplishments

- **GRAPH-02 Returns-distribution Card** mounts after the CorrelationHeatmap Card: `ReturnHistogram` fed the adapter's CUMULATIVE-wealth `histogramSeries` (Pitfall 1 — the leaf derives daily internally) + `ReturnQuantiles`, with the verbatim "Distribution of {n} overlapping daily returns · historical realized · not a forecast." disclosure.
- **GRAPH-03 Rolling-metrics Card** mounts as a sibling: a `SegmentedControl` (3M/6M/12M → 63/126/252-day windows, default 6M=126; an option is disabled when `usableN < its window`) + `RollingMetrics` (keyed `sharpe_365d` for CHART_ACCENT, `daysOfHistory={usableN}` so the avg line self-suppresses below 365) + `RollingVolatilityChart` + `RollingSortinoChart`, with the "{W}-day rolling window · 252-day annualized · {n} overlapping days · not a forecast." disclosure.
- **GRAPH-04 honest empty branch** on EACH Card: below the floor (`portfolio_daily_returns.length < 10` for distribution; `usableN < rollingWindow` for rolling) the body swaps to a `PartialDataBanner` (`role="status"`) with the prescribed copy; the Card heading + chrome stay; NO `role="alert"` anywhere.
- **R3/IMPACT-02 honesty guard EXTENDED** to be non-vacuous WITH the panels mounted (asserts both `data-panel` Cards present alongside the percentile-rank-badge ABSENT checks; the isolated real-`PercentileRankBadge` positive control unchanged), plus per-panel empty/disclosure tests and a **static import guard** that reads the .tsx off disk and fails loud if `FactsheetBody`/`MetricsColumn`/`buildAllocatorPortfolioFactsheetPayload`/`PercentileRankBadge` are imported or `ingestSource:"api"` appears.
- **Phase-30 frozen-engine guard** (`phase-30-frozen-spine-guards.test.ts`) mirrors the phase-29 git-delta guard: two `.not.toContain` asserts on `src/lib/scenario.ts` + `src/lib/scenario.test.ts`, `FALLBACK_BASE_SHA="03d0699c"`, fails loud (Rule 12) if no baseline resolves.

## Task Commits

1. **Task 1: Mount the two Cards** - `216a838f` (feat)
2. **Task 2: Extend the composer test (R3-guard-with-panels + per-panel empty/disclosure + static import guard)** - `de89540a` (test)
3. **Task 3: Frozen-engine zero-diff exit-gate guard** - `1d5189a4` (test)
4. **Deviation fix: memoize portfolioDaily (exhaustive-deps)** - `3d51a592` (fix)

_Note: Plan 30-02's `tdd="true"` tasks were executed mount-first (Task 1) then test-extension (Task 2) — the panels must exist for the composer suite to keep passing and for the R3 guard to assert their presence. RED-first did not apply because the test extends an existing green guard rather than introducing a fresh failing spec; the histogram-cumulative + import-guard non-vacuity were proven by targeted mutation instead (see Issues)._

## Files Created/Modified

- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` - Imports `buildBlendPanels` + the five leaf charts + `SegmentedControl`/`PartialDataBanner`; adds `rollingWindow` state (default 126) + a `WINDOW_LABEL` constant + memoized `portfolioDaily`/`blendPanels`; mounts the two new `<Card className="mt-6">` siblings after the CorrelationHeatmap Card.
- `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx` - Inert-mocks the five leaf charts; extends the R3 guard; adds blend-panel empty / disclosure / 12M-below-floor / static-import-guard `it`s.
- `src/__tests__/phase-30-frozen-spine-guards.test.ts` - NEW phase-30 frozen-engine zero-diff exit-gate guard.

## Decisions Made

- **Source comments avoid the literal forbidden tokens.** The static import guard regexes the real `.tsx` source; spelling out `FactsheetBody`/`ingestSource:"api"` in an explanatory comment would trip the guard (the exact lesson from Plan 30-01 deviation #2). The panel comments use prose ("factsheet body", "api-ingest literal") so the source carries zero forbidden strings.
- **`portfolioDaily` memoized on the engine output reference**, not a `?? []` const — see Deviation #1.
- **Leaf charts inert-mocked in the composer test** so the assertions target the host's panel chrome and the histogram's cumulative-wealth prop, not recharts SVG internals.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug / perf] `portfolioDaily` allocated a fresh array each render, defeating the blend-panels useMemo**
- **Found during:** post-Task-3 ESLint pass
- **Issue:** `const portfolioDaily = scenarioMetrics.portfolio_daily_returns ?? []` produces a new `[]` reference on every render when the engine output is undefined, so the `buildBlendPanels` `useMemo` (keyed on `portfolioDaily`) would recompute every render — `react-hooks/exhaustive-deps` flagged it.
- **Fix:** Wrapped `portfolioDaily` in its own `useMemo` keyed on `scenarioMetrics.portfolio_daily_returns`, so both memos recompute only on a genuine series/window change.
- **Files modified:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx`
- **Verification:** ESLint clean (0 warnings/errors on the file); composer suite still 75/75; engine zero-diff.
- **Committed in:** `3d51a592`

---

**Total deviations:** 1 auto-fixed (1 Rule-1 bug/perf).
**Impact on plan:** The fix is a correctness/perf improvement matching the plan's stated "wrap in useMemo to match the props-only sibling discipline" intent. No scope creep; no behavior change.

## Issues Encountered

- **Non-vacuity proof for the new tests (Rule 9).** The histogram-cumulative assertion was proven non-vacuous by temporarily feeding raw daily returns (≈0.0002) instead of the cumulative-wealth series (≈1.0) — the test failed loudly (`firstWealth` not > 0.9) — then reverted. The static import-guard regexes were verified to match the forbidden tokens and not the clean source. The frozen-spine `.not.toContain` was shown non-vacuous against the real `BASE..HEAD` delta (which DOES contain other src files but NOT the frozen engine).

## User Setup Required

None - no external service configuration required (pure client-side TS/TSX; zero new dependencies, no DB, no env).

## Known Stubs

None — both panels are fully wired to the live `buildBlendPanels` adapter over `scenarioMetrics.portfolio_daily_returns`. The honest empty branch is intentional behavior (a degenerate blend is not an error), not a stub.

## Threat Flags

None — no new network endpoint, auth path, file-access pattern, or schema change. The two trust boundaries in the plan's threat model (blend projection → rendered panels; phase delta → frozen engine) are mitigated by the extended R3 guard + static import guard + per-panel role=status disclosure (T-30-04/05/07) and the frozen-spine zero-diff guard (T-30-06). T-30-SC n/a (zero installs).

## Next Phase Readiness

- The blend graphs are live in the composer projection region as plain Card siblings — Phase 31 (graphs-lead reorder + collapsibility) can now build on a mounted, tested surface.
- No blockers. Full suite green (6559 passed / 284 skipped), engine byte-frozen, all phase-30 exit gates pinned by tests.

## Self-Check: PASSED

- `src/__tests__/phase-30-frozen-spine-guards.test.ts` — FOUND
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` (panels mounted) — FOUND
- `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx` (extended) — FOUND
- Commit `216a838f` (Task 1) — FOUND in git log
- Commit `de89540a` (Task 2) — FOUND in git log
- Commit `1d5189a4` (Task 3) — FOUND in git log
- Commit `3d51a592` (deviation fix) — FOUND in git log

---
*Phase: 30-factsheet-graphs-on-the-blend*
*Completed: 2026-06-23*
