---
phase: 21-surfacing-correlation-honest-projection
plan: 03
subsystem: ui
tags: [react, nextjs, correlation, heatmap, honesty, scenario, vitest, tdd, falsifiable-guard]

# Dependency graph
requires:
  - phase: 21-01
    provides: visible Scenario tab (own-book composer surface) the heatmap/badge/caveat mount into
  - phase: 21-02
    provides: show-all CorrelationHeatmap (overlappingDays + avgAbsCorrelation props), shortestHistoryName helper, single-sourced Avg |ρ| seam
provides:
  - Own-book ScenarioComposer mounts CorrelationHeatmap with de-aliased axis labels (CORR-01)
  - Single-sourced Avg |ρ| — the heatmap caption and KpiStrip read one scenarioMetrics.avg_pairwise_correlation (CORR-03 value half)
  - Persistent neutral-outline PROJECTED badge + coverage caveat (N overlapping days + shortest-history name) on the composer (IMPACT-01)
  - Falsifiable no-peer-ranking guard — PercentileRankBadge ABSENT by a unique render-only data-testid, with a positive control proving non-vacuity (IMPACT-02)
affects:
  - 21-04 (Strategy Sandbox / ScenarioBuilder) — same PROJECTED badge + caveat pattern (the builder already mounts the heatmap; Plan 04 adds its honesty framing)
  - 22 (honesty scaffolding) — reuses the persistent-badge + reason-routed caveat pattern

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Net-new presentational consumer: the composer mounts the (Plan-02) dumb CorrelationHeatmap, passing scenarioMetrics.{correlation_matrix,n,avg_pairwise_correlation} read-only — it never recomputes the matrix or the average (single-source across caption + KPI strip)"
    - "Honesty badge as label-not-alert: neutral-outline pill (border-text-muted/text-text-muted, no fill), always-rendered, plain text, NO role=alert — a projection is metadata, not a transient error"
    - "Falsifiable ABSENT guard: assert a peer panel is absent by a UNIQUE render-only data-testid (not a title-attr-only string and not a colliding visible label), paired with a REQUIRED positive-control isolation render that proves the query matches a real badge — mutation-verified both directions"

key-files:
  created: []
  modified:
    - src/components/strategy/PercentileRankBadge.tsx
    - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
    - src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx

key-decisions:
  - "The heatmap is mounted as a full-width 'Pairwise correlation' Card AFTER the lg:grid-cols-2 charts grid (not inside it) — mirrors ScenarioBuilder's card, keeps the heatmap legible at large N (its own ~70vh both-axis scroll container), and avoids cramming a wide grid into a half-width column."
  - "strategyNames is built in a useMemo keyed on deAliased (for (const s of deAliased.strategies) out[s.id]=s.name) — the exact ScenarioBuilder analog — so labels always match the de-aliased matrix computeScenario produced (no stale alias surviving the collapse)."
  - "The coverage caveat omits the 'Shortest history: {name}.' half when the de-aliased set is empty (shortestHistoryName → null) rather than printing a phantom/blank name — N is still named honestly. With ≥1 strategy the name always renders."
  - "IMPACT-02 guard keys on data-testid, NOT queryByText(/percentile/i): 'percentile' lives ONLY in PercentileRankBadge's title= attribute (Testing Library queryByText does not match attributes → a vacuous pass), and the visible labels ('Sharpe', 'Max DD') collide with the honest KPI strip. The render-only testid is the only unique, non-colliding signal."

patterns-established:
  - "Persistent PROJECTED honesty badge: neutral-outline pill next to the panel title, always visible, plain text (reused by 21-04 + Phase 22)"
  - "Mutation-verify a falsifiable guard before claiming it: temporarily wire the hazard (badge on projection) → ABSENT assertion must fail; temporarily remove the signal (testid) → positive control must fail"

requirements-completed: [CORR-01, CORR-03, IMPACT-01, IMPACT-02]

# Metrics
duration: 6min
completed: 2026-06-21
---

# Phase 21 Plan 03: Own-Book Composer Heatmap, Honest Projection & Falsifiable Peer-Ranking Lock Summary

**Wired the own-book `ScenarioComposer` to mount the Plan-02 `CorrelationHeatmap` with de-aliased labels and a single-sourced Avg |ρ| (CORR-01/03), added a persistent neutral-outline PROJECTED badge + coverage caveat naming N overlapping days and the shortest-history strategy (IMPACT-01), and hardened the R3 neuter guard into a falsifiable lock that asserts `PercentileRankBadge` is absent on the hypothetical blend via a unique render-only `data-testid` with a non-vacuous positive control (IMPACT-02) — the frozen scenario engine untouched.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-06-21T17:11Z (first RED commit)
- **Completed:** 2026-06-21T17:17Z
- **Tasks:** 3 (Task 1 via TDD RED→GREEN)
- **Files:** 3 modified (0 created)

## Accomplishments

- **Task 1 — CorrelationHeatmap mount (CORR-01, CORR-03; TDD):** Imported `CorrelationHeatmap` + `Card` into the composer, built a `strategyNames` `useMemo` from `deAliased.strategies` exactly like `ScenarioBuilder.tsx:206-210`, and mounted `<CorrelationHeatmap correlationMatrix={scenarioMetrics.correlation_matrix} strategyNames={strategyNames} overlappingDays={scenarioMetrics.n} avgAbsCorrelation={scenarioMetrics.avg_pairwise_correlation} />` in a full-width "Pairwise correlation" Card after the charts grid. The Avg |ρ| caption and the already-wired `KpiStrip` now read the SAME `scenarioMetrics.avg_pairwise_correlation` (the composer computes no second average). RED tests (3) committed before GREEN: ≥2-strategy de-aliased-label render, <2-strategy honest empty state (no 1×1 grid), and a single-source assertion that the caption value equals the value passed to KpiStrip.
- **Task 2 — PROJECTED badge + coverage caveat (IMPACT-01):** Rendered a persistent `data-testid="scenario-projected-badge"` neutral-outline pill (`inline-flex items-center rounded-sm border border-text-muted px-2 py-0.5 text-[10px] uppercase tracking-wide font-semibold text-text-muted`) with the literal copy `PROJECTED — hypothetical, not your live book` next to the "Scenario" `<h2>` — always rendered, plain text, no `role="alert"`, no `bg-accent`/warning/`<Badge>`. Added a `data-testid="scenario-coverage-caveat"` line reusing the leverage-caveat typography (`mt-2 text-[11px] text-text-muted`) reading `Projected from {scenarioMetrics.n} overlapping days. Shortest history: {name}. Not a forecast.`, where `name = shortestHistoryName(deAliased.strategies)` (imported from `@/lib/scenario-history`, computed once in a memo). Tests assert the badge is present even with no leverage applied, the neutral-outline token (no accent/warning/alert), and that the caveat names the live N + the shortest-history strategy name.
- **Task 3 — Falsifiable no-peer-ranking lock (IMPACT-02):** Added a one-line render-only `data-testid="percentile-rank-badge"` to the root `<span>` of `PercentileRankBadge.tsx` (no behavior change; nothing else touched). Strengthened the existing R3 guard (`ScenarioComposer.test.tsx`): replaced the vacuous `queryByText(/percentile/i)` (which only matched a `title=` attribute) with `expect(screen.queryByTestId("percentile-rank-badge")).toBeNull()`, keeping every prior ABSENT assertion (factsheet-allocator, factsheet-signatures, /ranked against peers/i) and the `kpi-strip-mock` positive control. Added the REQUIRED positive-control sub-step: an isolation `render(<PercentileRankBadge metric="sharpe" percentile={95} />)` asserting `getByTestId("percentile-rank-badge")` IS found — proving the testid query is non-vacuous.

## Task Commits

Each task committed atomically (Task 1 split RED/GREEN per the TDD gate):

1. **Task 1 RED — failing CORR-01/02/03 heatmap-mount tests** — `487a6db5` (test)
2. **Task 1 GREEN — mount CorrelationHeatmap with de-aliased labels + single-sourced Avg |ρ|** — `e2497a90` (feat)
3. **Task 2 — persistent PROJECTED badge + coverage caveat** — `ea810f0d` (feat)
4. **Task 3 — falsifiable no-peer-ranking guard via data-testid** — `df535b6f` (feat)

_Note: `.planning/` is gitignored — the docs/state commit writes files to disk for GSD tooling but is a no-op for git._

## Decisions Made

- **Heatmap placement = full-width Card after the charts grid, not inside the half-width `lg:grid-cols-2`.** A wide N-strategy grid needs the heatmap's own ~70vh both-axis scroll container; a half-column would force premature truncation. Mirrors the `ShipScenarioBuilder` "Pairwise correlation" card.
- **Coverage caveat omits the name half on an empty set** (`shortestHistoryName → null`) rather than rendering "Shortest history: ." — N is still named; the phrasing degrades honestly. With any de-aliased strategy present (the live own-book case) the name always renders.
- **IMPACT-02 guard keys on a unique render-only `data-testid`, not visible text.** The visible labels ("Sharpe", "Max DD") collide with the honest KPI strip / MetricCards (an ABSENT assertion keyed on them would false-fail on the honest tree), and "percentile" lives only in a `title=` attribute (queryByText never matches it → vacuous pass). The testid is the only non-colliding, non-vacuous signal.

## Deviations from Plan

None — plan executed exactly as written. No bugs, missing critical functionality, blocking issues, or architectural changes encountered.

CLAUDE.md / constraint compliance: changes touch only the 3 planned files; the frozen engine (`scenario.ts`/`scenario-dealias.ts`) was read-only and is byte-unchanged (`git status` clean throughout); no git branch ops (stayed on `feat/v1.1.0-scenario-surfacing`, asserted before every commit); the PROJECTED pill follows the UI-SPEC §4 neutral-outline token and DESIGN.md badge ladder (no accent fill, no warning amber, no filled `<Badge>`); `shortestHistoryName` is imported, not re-implemented; no banned packages, zero installs.

## Threat Surface Scan

No new security-relevant surface. All changes are presentational/test-only inside an existing `"use client"` component with no network endpoint, auth path, file access, or schema change. The plan's threat register is addressed:

- **T-21-07 (false peer-ranking on a hypothetical blend):** the strengthened R3 guard asserts `PercentileRankBadge` ABSENT by a unique testid and is **mutation-verified both directions** — (a) temporarily wiring a `data-testid="percentile-rank-badge"` span onto the projection made the ABSENT assertion FAIL at the `queryByTestId(...).toBeNull()` line; (b) temporarily removing the testid from `PercentileRankBadge` made the positive control FAIL. The composer builds from `scenarioMetrics` + `KpiStrip`, never `FactsheetBody`, so the badge is structurally absent today.
- **T-21-08 (false precision / double-compute):** the caveat N is `scenarioMetrics.n`; the shortest name is the unit-tested `shortestHistoryName`; Avg |ρ| is single-sourced from `scenarioMetrics.avg_pairwise_correlation` (the CORR-03 test pins caption-value === KpiStrip-value). No invented numbers.
- **T-21-09 (fabricated ρ=1.0 from venue aliases):** unchanged — `deAliased` collapses aliases upstream in the frozen `collapseAliasedHoldingStrategies`; the heatmap inherits the honest matrix.

## Authentication Gates

None. No external service, login, or secret was required.

## Verification

- `npx vitest run "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx"` → **57 passed (1 file)**. GREEN (54 prior + 3 CORR + 3 IMPACT-01; the R3 guard strengthened in place).
- Wave-2 batch — `ScenarioComposer.test.tsx` + `CorrelationHeatmap.test.tsx` + `scenario-history.test.ts` + `scenario.test.ts` (frozen-engine pins) + `KpiStrip.test.tsx` + `KpiStrip.scenario.test.tsx` → **134 passed (6 files)**. GREEN.
- `npx tsc --noEmit` → no errors (whole project).
- `npx eslint` on all 3 touched files → 0 violations.
- **Falsifiability proof (IMPACT-02):** mutation 1 (remove the testid) → positive control fails; mutation 2 (wire a `percentile-rank-badge` span onto the projection) → ABSENT assertion fails at line 2194. Both restored; the guard is non-vacuous and catches a real leak.
- Frozen-engine guard: `git status --short src/lib/scenario.ts src/lib/scenario-dealias.ts` → empty (untouched).
- Source assertions (acceptance criteria): heatmap import+JSX count (excl. comments) = 2; `PercentileRankBadge.tsx` root-span `data-testid="percentile-rank-badge"` count = 1; R3 `queryByTestId("percentile-rank-badge")).toBeNull` count = 1; positive-control `getByTestId(...).toBeInTheDocument` count = 1; `shortestHistoryName` imported from `@/lib/scenario-history` (count = 1); no `@/components/ui/Badge` import in the composer.

## Known Stubs

None. No hardcoded empty values, placeholder copy, or unwired data sources introduced. The heatmap, badge, and caveat all consume live `scenarioMetrics` + `deAliased.strategies` already computed in the composer.

## User Setup Required

None.

## Next Phase Readiness

- The own-book composer now has the full honesty surface: mounted heatmap (de-aliased labels, single-sourced Avg |ρ|), persistent PROJECTED badge, coverage caveat, and a falsifiable no-peer-ranking lock. Plan 21-04 (Strategy Sandbox / `ScenarioBuilder`) can reuse the same PROJECTED-badge + coverage-caveat pattern (the builder already mounts the heatmap from Plan 02).
- No blockers.

## Self-Check: PASSED

- FOUND: `src/components/strategy/PercentileRankBadge.tsx`
- FOUND: `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx`
- FOUND: `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx`
- FOUND commit: `487a6db5` (Task 1 RED)
- FOUND commit: `e2497a90` (Task 1 GREEN)
- FOUND commit: `ea810f0d` (Task 2)
- FOUND commit: `df535b6f` (Task 3)
- FOUND source: `<CorrelationHeatmap` mounted in ScenarioComposer.tsx (import + JSX = 2)
- FOUND source: `data-testid="percentile-rank-badge"` on PercentileRankBadge root span
- FOUND source: `queryByTestId("percentile-rank-badge")).toBeNull()` + isolation positive control in the test
- VERIFIED: frozen engine (scenario.ts/scenario-dealias.ts) byte-unchanged

---
*Phase: 21-surfacing-correlation-honest-projection*
*Completed: 2026-06-21*
