---
phase: 21-surfacing-correlation-honest-projection
plan: 04
subsystem: ui
tags: [react, nextjs, correlation, heatmap, honesty, scenario, sandbox, vitest, falsifiable-guard]

# Dependency graph
requires:
  - phase: 21-01
    provides: allocator-only Strategy Sandbox surface (/scenarios) the honesty badges/caveat mount into
  - phase: 21-02
    provides: show-all CorrelationHeatmap (overlappingDays + avgAbsCorrelation props) + shortestHistoryName helper
  - phase: 21-03
    provides: the PROJECTED-badge + coverage-caveat pattern (own-book composer) AND the render-only data-testid="percentile-rank-badge" on PercentileRankBadge that this plan's neuter guard consumes
provides:
  - The example-universe Strategy Sandbox (ScenarioBuilder) at honesty parity with the own-book composer
  - Persistent neutral-outline "Example universe" (SURF-03) + "PROJECTED — hypothetical, not your live book" (IMPACT-01) badges in a new header row at the top of the Sandbox container
  - Coverage caveat (N overlapping days + shortest-history strategy name via shortestHistoryName)
  - "Avg |ρ|" relabel (CORR-03) reconciled with the composer/KPI strip; single-sourced heatmap caption (overlappingDays + avgAbsCorrelation passed to the existing mount)
  - The Sandbox's FIRST test file — a falsifiable, non-vacuous IMPACT-02 neuter guard (PercentileRankBadge ABSENT by data-testid + isolated positive control) + IMPACT-01/CORR-03 framing tests
affects:
  - 22 (honesty scaffolding) — reuses the persistent-badge + reason-routed-caveat pattern, now on both scenario surfaces
  - The phase verifier — the Sandbox now carries a regression lock against peer-ranking a what-if blend

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Honesty framing as a new header row at the top of the surface container, NOT a title-block edit: the page title lives in the parent PageHeader (scenarios/page.tsx) and is untouched — the badges/caveat are ScenarioBuilder's own new row"
    - "shortestHistoryName(strategies) consumed read-only: ScenarioBuilder takes the already-collapsed strategies prop (page.tsx enriches + the page-level set is the de-aliased universe), so the builder passes its own `strategies` directly — the composer's `deAliased.strategies` analog for this surface"
    - "Single-sourced Avg |ρ| on the Sandbox too: overlappingDays={metrics.n} + avgAbsCorrelation={metrics.avg_pairwise_correlation} feed the heatmap caption — the label now appears as BOTH the KPI MetricCard label and the heatmap caption (one literal, two honest read sites)"
    - "Falsifiable ABSENT guard replicated for a NEW surface: queryByTestId('percentile-rank-badge') null on the Sandbox + a REQUIRED isolated positive-control render of a real PercentileRankBadge, mutation-verified by temporarily wiring the hazard into ScenarioBuilder (the ABSENT assertion failed, then reverted)"

key-files:
  created:
    - src/components/scenarios/ScenarioBuilder.honesty.test.tsx
  modified:
    - src/components/scenarios/ScenarioBuilder.tsx

key-decisions:
  - "ScenarioBuilder does NOT de-alias internally — it receives the already-collapsed `strategies` prop. The plan's 'de-aliased strategy set the builder computes' resolves to the builder's `strategies` prop; shortestHistoryName(strategies) is the correct, faithful call (the composer's deAliased.strategies analog for this surface)."
  - "The 'Avg |ρ|' literal legitimately appears twice on the rendered Sandbox (the KPI MetricCard label AND the single-sourced heatmap caption introduced by wiring avgAbsCorrelation). Tests assert via getAllByText(...).length >= 1 rather than getByText to honor this single-source reconciliation rather than fight it."
  - "Coverage caveat omits the 'Shortest history: {name}.' half when shortestHistoryName returns null (empty set) — mirrors the composer's honest degradation; N is still named. With the live ≥1-strategy example universe the name always renders."
  - "IMPACT-02 guard keys on the unique render-only data-testid (Plan 03 added it to PercentileRankBadge), NOT queryByText(/percentile/i) (only a title= attr → vacuous) and NOT a visible label like 'Sharpe' (collides with the Sandbox's own MetricCards). Surface positive controls (Sharpe + Avg |ρ|) + the isolated badge render keep the guard non-vacuous."

patterns-established:
  - "A net-new surface inherits the honesty contract by replicating the composer's exact badge tokens + caveat copy + falsifiable guard structure, keyed on the shared render-only testid — not by re-deriving the framing"

requirements-completed: [SURF-03, CORR-03, IMPACT-01, IMPACT-02]

# Metrics
duration: ~9min
completed: 2026-06-21
---

# Phase 21 Plan 04: Strategy Sandbox Honesty Surface & Falsifiable Peer-Ranking Lock Summary

**Brought the example-universe Strategy Sandbox (`ScenarioBuilder`) to honesty parity with the own-book composer — a new header row with the neutral-outline "Example universe" (SURF-03) and persistent "PROJECTED — hypothetical, not your live book" (IMPACT-01) pills, a coverage caveat naming N overlapping days + the shortest-history strategy, the "Avg |ρ|" relabel single-sourced into the heatmap caption (CORR-03) — and added the Sandbox's FIRST test file: a mutation-verified, non-vacuous IMPACT-02 neuter guard that asserts no `PercentileRankBadge` ever renders on a hypothetical blend (by the render-only `data-testid` Plan 03 added) with a required isolated positive control. The frozen engine and the `/scenarios` route gate were untouched.**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-06-21T17:22Z
- **Completed:** 2026-06-21T17:27Z
- **Tasks:** 2 (auto)
- **Files:** 2 (1 created, 1 modified)

## Accomplishments

- **Task 1 — Honesty framing + relabel on the Sandbox (SURF-03, CORR-03, IMPACT-01):**
  - Inserted a NEW header row at the top of the `mt-6 space-y-6` container (BEFORE the KPI strip, the parent `scenarios/page.tsx` `<PageHeader>` untouched) holding two neutral-outline pills: `data-testid="sandbox-example-universe-badge"` (copy `Example universe`, SURF-03 labeling so the Sandbox is unmistakable vs the own-book Scenario tab) and `data-testid="scenario-projected-badge"` (copy `PROJECTED — hypothetical, not your live book`, always rendered, plain text, no `role="alert"`, no `bg-accent`/warning/`<Badge>`). Both use the exact composer token: `inline-flex items-center rounded-sm border border-text-muted px-2 py-0.5 text-[10px] uppercase tracking-wide font-semibold text-text-muted`.
  - Added a `data-testid="scenario-coverage-caveat"` line (`mt-2 text-[11px] text-text-muted`) reading `Projected from {metrics.n} overlapping days. Shortest history: {name}. Not a forecast.`, where `name = shortestHistoryName(strategies)` (imported from `@/lib/scenario-history`, computed once in a `useMemo`). The name half is omitted on an empty set (null) — N is still named honestly.
  - Relabeled the correlation `MetricCard` from `label="Avg |corr|"` to `label="Avg |ρ|"` (value unchanged) — reconciled with the composer/KPI strip's one definition.
  - Added `overlappingDays={metrics.n}` + `avgAbsCorrelation={metrics.avg_pairwise_correlation}` to the existing `CorrelationHeatmap` mount so the heatmap renders the single-sourced "Avg |ρ|" caption from the same value the KPI strip reads (Plan 02 contract). No change to the data path; the heatmap was already mounted.
- **Task 2 — First Sandbox test file + non-vacuous neuter guard (IMPACT-01, IMPACT-02):** Created `src/components/scenarios/ScenarioBuilder.honesty.test.tsx` (net-new — the component had no test). A deterministic ≥2-strategy / ≥10-overlapping-day fixture built from the REAL `StrategyForBuilder` element type (bounded oscillating returns keeping every `1+r > 0` and cumulative `> 0`) yields a genuine non-null correlation matrix (not the empty state). Four tests:
  1. **IMPACT-01 framing** — asserts the `Example universe` badge, the persistent PROJECTED badge (exact copy), and the coverage caveat (`Projected from {N} overlapping days.` + `Shortest history: Short Leg.` + `Not a forecast.`; "Short Leg" has the fewest return points, so it is the deterministic shortest-history name).
  2. **IMPACT-01 token hygiene** — both pills carry `border-text-muted`/`text-text-muted`, are plain `<span>`s, and carry no `bg-accent` / `warning|amber` / `role="alert"`.
  3. **CORR-03** — `Avg |ρ|` present (`getAllByText(...).length >= 1` — it reads as both the MetricCard label and the single-sourced caption), `Avg |corr|` gone.
  4. **IMPACT-02 neuter guard** — replicates the composer's strengthened R3 structure: `expect(screen.queryByTestId("percentile-rank-badge")).toBeNull()` on the rendered Sandbox + `/ranked against peers/i` absent; surface positive controls (`Sharpe` + `Avg |ρ|`) prove the tree rendered (non-vacuous ABSENT); then a REQUIRED isolated `render(<PercentileRankBadge metric="sharpe" percentile={95} />)` asserting `getByTestId("percentile-rank-badge")` IS found (proving the query matches a real badge).

## Task Commits

Each task committed atomically:

1. **Task 1 — Example universe + PROJECTED badges, coverage caveat, Avg |ρ| relabel** — `995e9bc9` (feat)
2. **Task 2 — first ScenarioBuilder honesty + non-vacuous neuter-guard spec** — `2c3c1628` (test)

_Note: `.planning/` is gitignored — the docs/state commit writes files to disk for GSD tooling but is a no-op for git._

## Decisions Made

- **`shortestHistoryName(strategies)` — not a separately-de-aliased set.** `ScenarioBuilder` receives the already-collapsed example universe as its `strategies` prop and never calls `collapseAliasedHoldingStrategies` itself (unlike the composer, which de-aliases live holdings). So the faithful caveat call is `shortestHistoryName(strategies)` — the builder's analog of the composer's `deAliased.strategies`.
- **"Avg |ρ|" appears twice by design.** Wiring `avgAbsCorrelation` (per Plan 02's single-source contract) makes the heatmap render an "Avg |ρ|" caption in addition to the KPI MetricCard label. This is the CORR-03 reconciliation (one literal across the surface), not a duplication bug — the tests use `getAllByText(...).length >= 1` to assert presence without fighting it.
- **Mutation-verified the IMPACT-02 guard before claiming it.** Temporarily rendered a `PercentileRankBadge` inside `ScenarioBuilder`'s output: the `queryByTestId("percentile-rank-badge")).toBeNull()` assertion FAILED (T-21-10 caught). Reverted; the component carries zero `PercentileRankBadge` reference and the guard is green + falsifiable.

## Deviations from Plan

None — plan executed exactly as written. No bugs, missing critical functionality, blocking issues, or architectural changes encountered within this plan's scope. Two test assertions were written as `getAllByText(...).length >= 1` rather than `getByText(...)` to honor the (intended) twin appearance of "Avg |ρ|" once `avgAbsCorrelation` is wired — this is faithful implementation of the single-source contract, not a deviation.

CLAUDE.md / constraint compliance: changes touch only the 2 planned files; the frozen engine (`scenario.ts`/`scenario-dealias.ts`) and the route (`scenarios/page.tsx`, with its allocator-only gate + `page.role-gate.test.ts`) are byte-unchanged (`git status` clean); no git branch ops (stayed on `feat/v1.1.0-scenario-surfacing`, asserted before every commit); the pills follow the UI-SPEC §4 neutral-outline token + DESIGN.md badge ladder (no accent fill, no warning amber, no filled `<Badge>`); `shortestHistoryName` is imported, not re-implemented; the `percentile-rank-badge` testid is consumed read-only (not re-added); no banned packages, zero installs.

## Out-of-Scope Discovery (logged, not fixed)

A Wave-3 verification run surfaced **2 pre-existing failing tests in `src/app/(dashboard)/allocations/AllocationsTabs.test.tsx`** (`ArrowRight wraps focus … VISIBLE_TAB_KEYS order (Scenario excluded)` + a sibling assertion). Root cause: Plan 21-01's commit `3540cd9a` surfaced the Scenario tab (added it to `VISIBLE_TAB_KEYS` + the keyboard array) but the test still encodes the pre-21-01 "Scenario excluded" expectation. This is **NOT caused by this plan** — `AllocationsTabs.*` is not in the 21-04 diff and the failure reproduces with this plan's changes absent (the test file does not import `ScenarioBuilder`). Per the executor SCOPE BOUNDARY rule it is logged to `.planning/phases/21-surfacing-correlation-honest-projection/deferred-items.md` (DI-21-01) for a 21-01 follow-up / the verifier pass, not fixed here. (A foreign WIP stash on `main`, not this agent's, is also noted there and left untouched per the shared-stash hazard.)

## Threat Surface Scan

No new security-relevant surface. All changes are presentational/test-only inside an existing `"use client"` component with no network endpoint, auth path, file access, or schema change. The route's V4 allocator-only access gate (`scenarios/page.tsx:50-52`, test-pinned by `page.role-gate.test.ts`) is untouched. The plan's threat register is addressed:

- **T-21-10 (peer/percentile panel on the Sandbox blend):** the new neuter guard asserts `PercentileRankBadge` ABSENT by the unique render-only testid and is **mutation-verified** — wiring the badge onto the Sandbox made the ABSENT assertion FAIL; reverting restored green. The Sandbox builds from `computeScenario` + `MetricCard`s, never a `FactsheetBody`/percentile panel, so the badge is structurally absent.
- **T-21-11 (surface confusion):** the persistent "Example universe" + PROJECTED neutral-outline badges make the illustrative, hypothetical nature unmistakable vs the own-book Scenario tab.
- **T-21-12 (false precision):** N is `metrics.n`; the shortest name is the unit-tested `shortestHistoryName`; "Avg |ρ|" is single-sourced from `metrics.avg_pairwise_correlation` (passed once to both the heatmap caption and the KPI strip). No invented numbers.

## Authentication Gates

None. No external service, login, or secret was required.

## Verification

- `npx vitest run "src/components/scenarios/ScenarioBuilder.honesty.test.tsx"` → **4 passed (1 file)**. GREEN.
- Wave-3 batch — `npx vitest run "src/components/scenarios" "src/components/portfolio" "src/app/(dashboard)/allocations"` → **1075 passed**, 2 failed. Both failures are the pre-existing, out-of-scope `AllocationsTabs.test.tsx` cases (DI-21-01 above) — independent of this plan (reproduce with 21-04 changes absent; that test file does not import `ScenarioBuilder`). Every `src/components/scenarios/**` + `src/components/portfolio/**` test and all other `allocations/**` tests are green.
- `npx tsc --noEmit` → exit 0 (whole project).
- `npx eslint src/components/scenarios/ScenarioBuilder.tsx src/components/scenarios/ScenarioBuilder.honesty.test.tsx` → exit 0 (0 violations).
- **Coverage (non-regression):** `ScenarioBuilder.tsx` previously had ZERO test coverage; under the new honesty spec it reaches ~62% statements / ~65.75% lines (the honesty header row, caveat, relabel, and heatmap-prop lines are all in the covered render path). This is a net coverage GAIN, not a regression — the new test file adds coverage to a previously-untested component, as the plan intended. The repo-wide blocking `npm run test:coverage` gate is CI/verifier-owned and would currently red ONLY on the pre-existing DI-21-01 `AllocationsTabs` failures, not on anything in this plan's diff.
- **Falsifiability proof (IMPACT-02):** temporarily wiring `<PercentileRankBadge … />` into `ScenarioBuilder`'s output made `queryByTestId("percentile-rank-badge")).toBeNull()` FAIL; reverted. The guard is non-vacuous and catches a real leak.
- Frozen-engine + route guard: `git status --short src/lib/scenario.ts src/lib/scenario-dealias.ts src/app/(dashboard)/scenarios/page.tsx` → empty (untouched).
- Source assertions (acceptance criteria): `Example universe` literal present; `PROJECTED — hypothetical, not your live book` present (=1); `Avg |ρ|` present (=1) and `Avg |corr|` gone (=0); `overlappingDays={metrics.n}` (=1) + `avgAbsCorrelation={metrics.avg_pairwise_correlation}` (=1) on the heatmap mount; zero `PercentileRankBadge` reference in `ScenarioBuilder.tsx`; no `bg-accent`/`role="alert"`/`@/components/ui/Badge` in the file.

## Known Stubs

None. No hardcoded empty values, placeholder copy, or unwired data sources introduced. The badges, caveat, and heatmap props all consume live `metrics` + `strategies` already computed in the builder.

## User Setup Required

None.

## Next Phase Readiness

- Both scenario surfaces (own-book composer + example-universe Sandbox) now carry the full honesty contract: persistent "Example universe"/PROJECTED badges, coverage caveat, single-sourced "Avg |ρ|", and a mutation-verified no-peer-ranking lock. Phase 22 (methodology-honesty scaffolding) can reuse the persistent-badge + reason-routed-caveat pattern across both.
- Open follow-up (out of scope here): DI-21-01 — update `AllocationsTabs.test.tsx` to expect the now-visible Scenario tab in the keyboard-wrap order (a 21-01 follow-up).

## Self-Check: PASSED

- FOUND: `src/components/scenarios/ScenarioBuilder.honesty.test.tsx`
- FOUND: `src/components/scenarios/ScenarioBuilder.tsx` (modified)
- FOUND commit: `995e9bc9` (Task 1)
- FOUND commit: `2c3c1628` (Task 2)
- FOUND source: `sandbox-example-universe-badge` + `scenario-projected-badge` + `scenario-coverage-caveat` testids in ScenarioBuilder.tsx
- FOUND source: `label="Avg |ρ|"` in ScenarioBuilder.tsx; zero `Avg |corr|`
- FOUND source: `overlappingDays={metrics.n}` + `avgAbsCorrelation={metrics.avg_pairwise_correlation}` on the heatmap mount
- FOUND source: `queryByTestId("percentile-rank-badge")).toBeNull()` + isolated positive control in the test
- VERIFIED: frozen engine (scenario.ts/scenario-dealias.ts) + scenarios/page.tsx byte-unchanged

---
*Phase: 21-surfacing-correlation-honest-projection*
*Completed: 2026-06-21*
