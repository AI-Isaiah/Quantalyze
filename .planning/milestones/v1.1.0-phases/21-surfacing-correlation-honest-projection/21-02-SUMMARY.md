---
phase: 21-surfacing-correlation-honest-projection
plan: 02
subsystem: ui
tags: [react, nextjs, correlation, heatmap, honesty, scenario, vitest, tdd]

# Dependency graph
requires:
  - phase: 21-01
    provides: visible Scenario tab + allocator-only Strategy Sandbox surfaces that the heatmap/caveat mount into (Wave 2)
  - phase: (v1.0.0) scenario engine
    provides: frozen computeScenario (correlation_matrix null thresholds + avg_pairwise_correlation off-diagonal absolute mean) and collapseAliasedHoldingStrategies (StrategyForBuilder element type)
provides:
  - Show-all CorrelationHeatmap (no top-10 truncation) with a both-axis ~70vh scroll container and an aria-label naming the TRUE strategy count
  - Reason-routed correlation empty state (overlappingDays prop) — distinct <2-strategies vs <10-days copy, never a 1×1 grid or fabricated number
  - Single-sourced "Avg |ρ|" heatmap caption (avgAbsCorrelation prop; the heatmap never computes its own average)
  - "Avg |ρ|" KPI strip cell label (relabeled from "Avg ρ"; value/semantics unchanged)
  - shortestHistoryName pure helper for the IMPACT-01 coverage caveat (unit-tested against the real de-aliased call-site shape)
affects:
  - 21-03 (own-book composer) — mounts the heatmap with overlappingDays + avgAbsCorrelation, renders the caveat via shortestHistoryName
  - 21-04 (Strategy Sandbox) — same heatmap mount + caveat
  - 22 (honesty scaffolding) — reuses the honest-empty-state pattern

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Presentational heatmap is dumb: host passes a single-sourced avgAbsCorrelation + overlappingDays; the component renders, never computes an average or knows the day count itself (prevents caption/KPI-strip divergence and false precision)"
    - "Component-level `ids.length < 2` gate is the load-bearing guard against a 1×1 grid — the engine returns a non-null 1×1 {id:{id:1}} for a single strategy, so the null-matrix guard alone does NOT cover CORR-02"
    - "Empty-state reason routing: <10-days arrives as a null matrix + host overlappingDays<10 (check FIRST); <2 strategies arrives as a non-null 1×1 (ids.length<2 with a 10+ window); else combined fallback"
    - "Pure reduce helper (shortestHistoryName) mirrors the removed pickTopTenByAvgCorr shape + the scenario-dealias.ts sibling-file convention; reads only client-side daily_returns (no new server field)"

key-files:
  created:
    - src/lib/scenario-history.ts
    - src/lib/scenario-history.test.ts
  modified:
    - src/components/portfolio/CorrelationHeatmap.tsx
    - src/components/portfolio/CorrelationHeatmap.test.tsx
    - src/app/(dashboard)/allocations/components/KpiStrip.tsx
    - src/app/(dashboard)/allocations/components/KpiStrip.test.tsx

key-decisions:
  - "CORR-04 satisfied by REMOVAL (show-all), not a disclosure: deleted pickTopTenByAvgCorr; render all ids in a bounded both-axis scroll container; no 'top 10' caption. The aria-label auto-names the true count via the existing n=ids.length interpolation."
  - "Shortest history = fewest daily_returns points (window length), not earliest start — window length is the count that actually feeds the overlap; first-seen tiebreak is deterministic; empty→null, single→lone name."
  - "Heatmap palette: KEPT the local correlation-sign palette (teal/orange); did NOT import the factsheet return-magnitude palette (semantically inverted for correlation) — UI-SPEC §Color ratified divergence."
  - "Avg |ρ| caption hidden (not rendered as 0.00) when the host passes null/non-finite — no fabricated number; the KPI strip's honest-pending semantics are untouched."

patterns-established:
  - "Surfacing-honesty empty state: name the SPECIFIC reason (heading + reason-routed body), assert no number is shown, never render a degenerate grid"
  - "Single-source a derived metric across two surfaces by passing the host-computed value into the presentational component rather than recomputing it locally"

requirements-completed: [CORR-02, CORR-03, CORR-04]

# Metrics
duration: 8min
completed: 2026-06-21
---

# Phase 21 Plan 02: Correlation Presentational Foundation Summary

**Promoted `CorrelationHeatmap` to its show-all, honest-empty-state, single-sourced form (CORR-02/03/04), relabeled the KPI strip's correlation cell to "Avg |ρ|", and created the unit-tested `shortestHistoryName` pure helper the IMPACT-01 coverage caveat will consume — all presentational/pure-logic, with the frozen scenario engine untouched.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-06-21T14:56:16Z
- **Completed:** 2026-06-21T17:04Z (wall-clock per execution log)
- **Tasks:** 3 (Task 1 via TDD RED→GREEN)
- **Files:** 6 (2 created, 4 modified)

## Accomplishments

- **Task 1 — `shortestHistoryName` (IMPACT-01 support, TDD):** New `src/lib/scenario-history.ts` exporting a pure reduce over the de-aliased `StrategyForBuilder` set that returns the NAME of the strategy with the fewest `daily_returns` points. Documented "shortest = fewest available trading days" inline; first-seen tiebreak; empty→`null`, single→lone name (degenerate cases never throw). Reads only client-side `daily_returns` (no new server field, Assumption A1). The test fixture builds full `StrategyForBuilder` objects — the element type of `deAliased.strategies` (the `collapseAliasedHoldingStrategies` output the composer/builder actually pass) — not a hand-rolled struct. RED committed before GREEN.
- **Task 2 — Show-all heatmap + reason-routed empty state + Avg |ρ| caption (CORR-02/03/04):**
  - **CORR-04 (show-all):** Deleted `pickTopTenByAvgCorr` + its `useMemo`; `ids = Object.keys(matrix)`. Wrapped the grid in a `max-h-[70vh] overflow-x-auto overflow-y-auto` container so a large-N grid scrolls both axes (cells stay ≥48px). No "top 10" disclosure. The `role="figure"` aria-label names the TRUE count (e.g. "12 strategies") via the existing `n = ids.length` interpolation.
  - **CORR-02 (empty state):** Extended the gate to `ids.length < 2` (the load-bearing guard against the engine's non-null 1×1 matrix) and added an optional `overlappingDays?` prop. Reason-routed copy: heading "Not enough overlap to correlate"; body = few-strategies / few-days (distinct) / combined-fallback. Never a 1×1 grid; never a number in the empty state.
  - **CORR-03 (caption):** Added optional `avgAbsCorrelation?` prop → single-sourced "Avg |ρ|" caption (`text-[11px] text-text-muted` label + `font-metric` number). The heatmap never computes its own average; hidden when null/non-finite.
  - Kept the correlation-sign palette + full ARIA/WCAG render contract; did NOT import the factsheet palette. Both existing call sites (`ScenarioBuilder.tsx`, `portfolios/[id]/page.tsx`) pass only the two required props and compile unchanged.
- **Task 3 — KPI strip relabel (CORR-03):** Changed the cell `label: "Avg ρ"` → `"Avg |ρ|"` in `KpiStrip.tsx`; value (`avg_pairwise_correlation`), honest-pending copy (`AVG_RHO_*_SUB`), stale→null semantics, and cell order all unchanged. Updated the docstring/direction-table/precedence comments to the same literal for truthfulness. Every "Avg ρ" literal in `KpiStrip.test.tsx` (incl. the load-bearing `labels` array) → "Avg |ρ|". `KpiStrip.scenario.test.tsx` + `KpiStrip.warmup.test.tsx` carry no literal and were verified green.

## Task Commits

Each task committed atomically (Task 1 split RED/GREEN per the TDD gate):

1. **Task 1 RED — failing test for shortestHistoryName** — `4eec94e1` (test)
2. **Task 1 GREEN — implement shortestHistoryName** — `bee0ca33` (feat)
3. **Task 2 — show-all heatmap + reason-routed empty state + Avg |ρ| caption** — `5bf459a1` (feat)
4. **Task 3 — relabel KPI strip correlation cell to "Avg |ρ|"** — `71bfd8e8` (feat)

_Note: `.planning/` is gitignored — the docs/state commit writes files to disk for GSD tooling but is a no-op for git._

## Decisions Made

- **CORR-04 is removal, not disclosure.** Show-all supersedes the "top 10" requirement; the disclosure caption must NOT render. ROADMAP success-criterion #3's ">10 strategies discloses it shows the 10 most-correlated" is superseded by this ratified show-all decision (UI-SPEC §3 + 21-RESEARCH anti-patterns).
- **"Shortest history" = fewest `daily_returns` points** (window length), the count that constrains the overlap — not earliest start. First-seen tiebreak for determinism.
- **Empty-state reason routing checks `overlappingDays < 10` FIRST** because the <10-days case arrives as a NULL matrix (ids.length 0) with the host's `overlappingDays` set, while a genuine <2-strategy set arrives as a non-null 1×1 (ids.length 1) with a 10+-day window.
- **Single-source the average via a host prop**, never a self-computed heatmap average (T-21-06 false-precision mitigation): the CORR-03 caption test asserts the host value 0.37 renders, NOT the 0.30 the heatmap would compute from the matrix — proving the single-source wiring.

## Deviations from Plan

None — plan executed exactly as written. No bugs, missing critical functionality, blocking issues, or architectural changes encountered. The empty-state reason-routing logic required careful ordering (overlappingDays-first) to correctly distinguish the two degenerate cases the engine surfaces differently (null matrix vs non-null 1×1) — this is faithful implementation of the plan's CORR-02 contract, not a deviation.

CLAUDE.md compliance: changes touch only the planned files; the frozen engine (`scenario.ts`/`scenario-dealias.ts`) was read-only and is byte-unchanged (`git status` clean); the kept correlation-sign palette honors DESIGN.md §Color; no banned packages; no git branch ops.

## Threat Surface Scan

No new security-relevant surface. These are presentational/pure-logic files with no network endpoint, auth path, file access, or schema change. The plan's threat register (T-21-04/05/06) is honesty/data-integrity, all addressed:
- **T-21-04** (empty-state honesty): the `ids.length < 2` gate + reason-routed copy render an honest empty state for both degenerate cases; tests assert no number is shown.
- **T-21-06** (false precision): the heatmap renders a host-passed single-sourced average, never computes its own — pinned by the CORR-03 caption test (0.37 host value, not the 0.30 self-computed).
- **T-21-05** (alias ρ=1.0): unchanged — de-aliasing is upstream in the frozen `collapseAliasedHoldingStrategies`.

## Authentication Gates

None. No external service, login, or secret was required.

## Verification

- `npx vitest run "src/lib/scenario-history.test.ts" "src/components/portfolio/CorrelationHeatmap.test.tsx" "src/app/(dashboard)/allocations/components/KpiStrip.test.tsx" "src/app/(dashboard)/allocations/components/KpiStrip.scenario.test.tsx"` → **49 passed (4 files)**. GREEN.
- `npx vitest run src/lib/scenario.test.ts src/app/\(dashboard\)/scenarios/page.role-gate.test.ts` → 33 passed (frozen engine pins + role gate intact). GREEN.
- `npx vitest run src/app/\(dashboard\)/allocations/components/KpiStrip.warmup.test.tsx` → 7 passed (Phase 07 invariants intact). GREEN.
- `npx tsc --noEmit` → no errors (whole project; both existing heatmap call sites compile unchanged).
- `npx eslint` on all four touched files → 0 violations.
- Coverage: new `scenario-history.ts` at **100% statements** under its own test; the heatmap changes are covered by the updated component spec (show-all, both empty-state reasons, caption present/absent). Blocking coverage gate not regressed.
- Frozen-engine guard: `git status --short src/lib/scenario.ts src/lib/scenario-dealias.ts` → empty (untouched).
- Source assertions (acceptance criteria): `pickTopTenByAvgCorr` count (excl. comments) = 0; `overflow-x-auto` present; `max-h-[70vh]` present; factsheet `v2/palette` import count = 0; `KpiStrip.tsx` has `"Avg |ρ|"`, zero "Avg ρ"; zero "Avg ρ" anywhere in `src/`+`tests/`.
- WCAG contrast sweep test still green (palette untouched).

## Known Stubs

None. No hardcoded empty values, placeholder copy, or unwired data sources introduced. The new optional props (`overlappingDays`, `avgAbsCorrelation`) are host-integration seams consumed in Wave 2 (21-03/04); they are not stubs — they are correctly-typed optional inputs with honest fallback behavior (hidden caption / combined-reason copy) when absent, which is the intended degradation. The `shortestHistoryName` helper has no production caller yet (its callers land in 21-03/04), but it is fully implemented and unit-tested — not a stub.

## User Setup Required

None.

## Next Phase Readiness

- The presentational foundation is complete: a show-all + reason-routed heatmap, an "Avg |ρ|" KPI label, a single-source caption seam, and the `shortestHistoryName` caveat helper. Wave 2 (21-03 composer, 21-04 sandbox) can now mount the heatmap with `overlappingDays={scenarioMetrics.n}` + `avgAbsCorrelation={scenarioMetrics.avg_pairwise_correlation}` and render the caveat via `shortestHistoryName(deAliased.strategies)`.
- No blockers.

## Self-Check: PASSED

- FOUND: `src/lib/scenario-history.ts`
- FOUND: `src/lib/scenario-history.test.ts`
- FOUND commit: `4eec94e1` (Task 1 RED)
- FOUND commit: `bee0ca33` (Task 1 GREEN)
- FOUND commit: `5bf459a1` (Task 2)
- FOUND commit: `71bfd8e8` (Task 3)
- FOUND source: `export function shortestHistoryName` in scenario-history.ts
- FOUND source: `pickTopTenByAvgCorr` removed (0 non-comment occurrences) + `overflow-x-auto` + `max-h-[70vh]` in CorrelationHeatmap.tsx
- FOUND source: `label: "Avg |ρ|"` in KpiStrip.tsx; zero "Avg ρ" in src/+tests/

---
*Phase: 21-surfacing-correlation-honest-projection*
*Completed: 2026-06-21*
