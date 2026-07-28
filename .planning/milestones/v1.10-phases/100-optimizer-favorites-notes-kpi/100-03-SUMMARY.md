---
phase: 100-optimizer-favorites-notes-kpi
plan: 03
subsystem: ui
tags: [react, kpi, refactor, portfolio, allocations, presentational-primitive]

# Dependency graph
requires:
  - phase: 100-01/100-02
    provides: Phase-100 /allocations widgets scaffold (KpiStrip is the shared allocations KPI surface)
provides:
  - "Shared KpiPanel presentational primitive (one white panel, N cells, hairline dividers, @container reflow)"
  - "PortfolioKpiPanel adapter mapping PortfolioAnalytics → KpiPanel for /portfolios/[id]"
  - "Deletion of the divergent PortfolioKPIRow 4-centered-Cards anti-pattern"
affects: [any future KPI surface; DESIGN.md shared-panel conformance]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Presentational-primitive extraction: KpiPanel holds ONLY the panel/cell shell; all warmup/stale/scenario/delta/formatter logic stays in the consumer and is passed as resolved strings/classes + a below-value children slot (render-tree-neutral)"

key-files:
  created:
    - src/components/kpi/KpiPanel.tsx
    - src/components/portfolio/PortfolioKpiPanel.tsx
    - src/components/portfolio/PortfolioKpiPanel.test.tsx
  modified:
    - src/app/(dashboard)/allocations/components/KpiStrip.tsx
    - src/app/(dashboard)/portfolios/[id]/page.tsx
  deleted:
    - src/components/portfolio/PortfolioKPIRow.tsx

key-decisions:
  - "KpiPanel extraction is render-tree-neutral — KpiStrip's emitted DOM is byte-identical, proven by its 36 existing tests passing with ZERO test-file edits"
  - "Delta pill + sub-copy passed to KpiPanel as a `children` node (React fragment) rather than modeled as typed props — keeps the scenario/warmup markup byte-identical and avoids leaking KpiStrip-only concerns into the shared primitive"
  - "correlationColor lifted VERBATIM into PortfolioKpiPanel (it lived locally in the deleted row, not in utils); ≥0.7-red pre-existing risk signal preserved, not changed (UI-SPEC W4)"
  - "AUM cell KEPT on the portfolio detail page (real, load-bearing data); the adapter owns its 4-cell list independently of the allocations KpiStrip which dropped AUM in Phase 64"

patterns-established:
  - "Fold divergent bespoke KPI surfaces onto one shared KpiPanel via a thin typed adapter + a fixture regression test asserting value/label/color byte-identity"

requirements-completed: [PI-06]

# Metrics
duration: ~12min
completed: 2026-07-12
---

# Phase 100 Plan 03: KPI Fold Adapter Summary

**Extracted a shared `KpiPanel` primitive from `KpiStrip` render-tree-neutrally, folded the portfolio detail KPI row onto it via a `PortfolioKpiPanel` adapter (AUM kept, MTD never YTD, values byte-identical), and deleted the divergent `PortfolioKPIRow` 4-centered-Cards anti-pattern — no metric value/label/color changed on either page.**

## Performance

- **Duration:** ~12 min
- **Tasks:** 2/2
- **Files:** 3 created, 2 modified, 1 deleted

## Accomplishments

- **Task 1 — `KpiPanel` primitive:** New `src/components/kpi/KpiPanel.tsx` renders the DESIGN.md-blessed shared shell (one white panel, N columned cells with micro uppercase muted label + Geist Mono `tabular-nums` value + an optional below-value `children` slot, `@container` host on a separate ancestor from the `@sm`/`@lg` grid variants). `KpiStrip` now renders through it while keeping ALL warmup/stale/scenario/delta logic locally and passing the delta pill + sub-copy as `children` verbatim. The extraction is render-tree-neutral.
- **Task 2 — `PortfolioKpiPanel` adapter + swap + delete:** New adapter maps `PortfolioAnalytics` onto `KpiPanel` per the UI-SPEC W4 table (AUM→`formatCurrency`/`text-text-primary`; MTD TWR→`formatPercent`/`metricColor`; Avg Correlation→`formatNumber`/`correlationColor`; Portfolio Sharpe→`formatNumber`/`metricColor`). Swapped in at the sole call site `portfolios/[id]/page.tsx:291`. `PortfolioKPIRow.tsx` deleted; zero remaining importers.

## No-Regress Evidence

- **KpiStrip tests unmodified:** `git diff --stat` on `KpiStrip.test.tsx`, `KpiStrip.scenario.test.tsx`, `KpiStrip.warmup.test.tsx` is EMPTY. All 36 pass. Byte-identical DOM is what makes the extraction safe (the scenario suite queries the delta pill by `aria-label`/`title`/`className` and the shape suite counts `group.children` and asserts `@container` host separation — all still green).
- **Portfolio KPI 1:1 (T-100-08):** `PortfolioKpiPanel.test.tsx` (5 tests, RED→GREEN) asserts, against a fixed mixed real+null fixture, that rendered AUM/MTD/corr/Sharpe strings equal the SAME formatters the deleted row used (`formatCurrency`/`formatPercent`/`formatNumber`; null→"—"), that the MTD label is present and NO "YTD" label exists, that the AUM cell is present (4 cells in canonical order), and that `correlationColor`'s ≥0.7-red / 0.4–0.7 / <0.4 / null bands are preserved verbatim.
- **Deletion proof:** `grep -rn "PortfolioKPIRow" src/` is EMPTY.
- **SC-4:** No /allocations change — KpiStrip behavior byte-identical; no new KPI strip added.

## Verification

- KpiStrip suites (36) + PortfolioKpiPanel (5) + portfolios/[id] loading/error (8) = 49 tests, all green.
- `npx tsc --noEmit` clean.
- `npm run lint` — 0 errors (1 pre-existing unrelated warning in `EquityChart.tsx`, out of scope).
- `grep -rn "PortfolioKPIRow" src/` empty.

## Deviations from Plan

None — plan executed as written. One in-scope refinement: reworded doc/test-name references so the literal token `PortfolioKPIRow` does not survive anywhere under `src/`, satisfying the explicit `grep -rn "PortfolioKPIRow" src/` empty acceptance criterion (the component + all importers were already gone; only prose references remained).

## Commits

- `9cf9f95c` refactor(100-03): extract shared KpiPanel primitive from KpiStrip
- `4b8cb1c8` feat(100-03): PortfolioKpiPanel adapter + call-site swap, delete KPI row

## Self-Check: PASSED

- FOUND: src/components/kpi/KpiPanel.tsx
- FOUND: src/components/portfolio/PortfolioKpiPanel.tsx
- FOUND: src/components/portfolio/PortfolioKpiPanel.test.tsx
- DELETED (confirmed): src/components/portfolio/PortfolioKPIRow.tsx
- FOUND commit: 9cf9f95c
- FOUND commit: 4b8cb1c8
