---
phase: 198-mybook-my-allocation-answers-how-is-my-book-doing-in-three-tabs
plan: 01
subsystem: allocations-overview
tags: [glance-panel, figure-gate, scenario-parity, book-equity]
requires:
  - phase: 194.1
    provides: figure-gate census, 194 D-15 gate modules
provides:
  - liveBookFigures, bookEquityUsd, unreportedDerivativeCount, holdingsReadDay, BOOK_FIGURES_SERIES_CAPTION
  - GlancePanel on the Overview (Book at a glance)
  - Scenario live strip reads the shared, gated live Sharpe
affects: [198-03, 198-06, 198-09, 198-10, 198-11]
tech-stack:
  added: []
  patterns: [one pure figures module read by two surfaces, parity test over several payloads]
key-files:
  created:
    - src/app/(dashboard)/allocations/lib/book-figures.ts
    - src/app/(dashboard)/allocations/lib/book-figures.test.ts
    - src/app/(dashboard)/allocations/components/GlancePanel.tsx
    - src/app/(dashboard)/allocations/components/GlancePanel.test.tsx
    - src/app/(dashboard)/allocations/components/GlancePanel.scenario-parity.test.tsx
  modified:
    - src/app/(dashboard)/allocations/AllocationDashboardV2.tsx
    - src/app/(dashboard)/allocations/components/KpiStrip.tsx
    - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
    - src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx
    - src/app/(dashboard)/allocations/components/ScenarioComposer.d11.test.tsx
    - src/app/(dashboard)/allocations/AllocationDashboardV2.rebuilding.test.tsx
key-decisions:
  - "Return and Risk on the glance never depend on equityHistoryState (C7 over the UI-SPEC Missing history row); noteBelow only adds sr-only text."
  - "Book equity sums holdingEquityContribution over every holdingsSummary row, never the baseline AUM field (C5); the unreported derivative count is stated."
  - "The live Sharpe is gated once in liveBookFigures on the baseline's own record (365 periods), then again by the own-book record in gatedLiveMetrics, as the plan specifies."
requirements-completed: [ROUTE-07]
status: complete
duration: about 75 min
completed: 2026-11-08
commits: 2
plan_head_before: d345f588e7cf6cd57a6e0bb331d2d119e0163e74
plan_head_after: 018474fa642c0884f0ccae8bae3653380084adf0
actuals:
  tokens: 13000
  tasks: 2
  commits: 2
---

# Phase 198 Plan 01: Glance panel and shared figures module Summary

The Overview now opens with a "Book at a glance" data panel (YTD TWR, Sharpe, Max DD 12m, Book equity, Positions) read from one pure module, `book-figures.ts`, that Scenario's live strip also reads, so the two surfaces print byte-equal strings and the live Sharpe is gated by 194 D-15 on both.

## What was built

- **`lib/book-figures.ts`** (pure, no React): `liveBookFigures` builds the live baseline's record (`figureRecord`, 365 periods, covered days from first to last equity date), judges it with `gateAnnualized` and withholds Sharpe with `gatedValue`. `bookEquityUsd`, `unreportedDerivativeCount` and `holdingsReadDay` serve the Holdings group and the stamp.
- **`components/GlancePanel.tsx`**: one `<section aria-labelledby>`, square hairline panel, `@container` host on its own ancestor, three groups stacking below `@lg`. Withheld Sharpe goes through `annualizedCell` (reason in `title` and sr-only), a short record carries the `<1y` marker. Stamp days come from `formatCloseDay` over payload days only.
- **`AllocationDashboardV2.tsx`**: glance mounted after the staleness banner, before the key notes, inside the branch after the `no_eligible_key` early return.
- **`KpiStrip.tsx`**: `valueColorClass` and `isImpossibleDrawdown` exported (one tone rule, nothing else changed).
- **`ScenarioComposer.tsx`**: `liveFigures` and `liveMetricsForStrip` memos; the live strip gets `metrics={liveMetricsForStrip}`; `gatedLiveMetrics.sharpe` derives from the module. No other hunk touched.

## Task commits

| Task | Commit | Scope |
|------|--------|-------|
| 1 (tracer) | 7da87ab5a | module, GlancePanel, mount, KpiStrip exports, GlancePanel tests |
| 2 | 018474fa6 | composer reads the module, book-figures and parity tests, composer cases |

## Gate evidence (neuters, each on a byte copy restored with cmp)

- gc-198-01-neuter: gate=GlancePanel "a 60-day record withholds Sharpe" (module returns the raw Sharpe, no gate) result=red restored=identical
- gc-198-01-neuter: gate=GlancePanel "C7: a rebuilding history still prints Return and Risk" (glance blanks Return and Risk when noteBelow) result=red restored=identical
- gc-198-01-neuter: gate=ScenarioComposer "198 plan 01: a 60-day live record: the strip's Sharpe is withheld" (strip prop reverted to `metrics={liveMetricsForKpi}`) result=red restored=identical
- gc-198-01-neuter: gate=GlancePanel.scenario-parity (glance prints Max DD at 1 dp instead of the strip's 2 dp; 4 of 8 cases red) result=red restored=identical
- gc-198-01-gates: vitest=green census=green tsc=clean lint=eslint-clean-but-planning-hygiene-red-pre-existing (see Deferred Issues)

Note on the third neuter: the plan expected the 60-day parity case to go RED too. It cannot: the parity test builds the strip's props itself from `liveBookFigures`, so it cannot see the composer's prop. The composer case is what pins the prop; the parity test is pinned by the fourth neuter (a glance-only formatting drift), which is an addition to the plan.

## Existing tests edited (reason: "pinned C6 ungated live Sharpe")

All pinned the two-day default `makePayload` baseline reaching the live strip with Sharpe 1.2, which is the C6 defect. Each now carries a 400-day live record; no test deleted.
- `ScenarioComposer.test.tsx`: `T_C_M4_live_ssr_lifted ...`; `rebuilding: the live-book KPIs (liveBaselineMetrics) still reach the KPI strip (D-03)`; the `expectLiveBookKpis` arms (4 cases, through `producerRebuildingPayload`).
- `ScenarioComposer.d11.test.tsx`: `a 400-day book beside a 400-day blend: both surfaces keep the Sharpe delta`.

Edited for a different reason (C7, not C6): `AllocationDashboardV2.rebuilding.test.tsx` used `getByText("Sharpe")` on the factsheet mock as the proxy for "the factsheet mounted". The glance now legitimately carries its own `Sharpe` label while rebuilding (C7), so the mock label is renamed `Factsheet Sharpe` (7 assertions). The intent of those tests is unchanged.

## Deviations from Plan

**1. [Precondition, judgment call] `git merge-base --is-ancestor origin/main HEAD` exits non-zero.**
`origin/main` is one commit ahead of this branch: a baseline re-dump release commit (touches `supabase/schema/*`, `package.json`, `VERSION`, `CHANGELOG.md`; none of this plan's files). The substance of the precondition holds: Phase 194.1 is merged (`4b5ccacfb`, PR 1222, is an ancestor of HEAD), `figure-gate-census.test.ts` exists and `ScenarioComposer.tsx` carries the 194.1 `scenario-detail-*` area. I proceeded and am flagging it rather than halting; a rebase before ship picks the commit up.

**2. [Rule 1 - Bug] Rebuilding test collided with the glance label** (see above). Commit 7da87ab5a.

**3. [Plan vs repo] Stale-test fixtures** listed above. Commit 018474fa6.

**4. STATE.md and ROADMAP.md not edited.** The plan's standing rules say not to edit them (the ship writes those) while the dispatch success criteria ask for a plan-progress update. I followed the plan's explicit rule; the orchestrator should run `roadmap.update-plan-progress` and `state` handlers and `git diff` the result.

## Deferred Issues

- `npm run lint` ends red on `check-planning-hygiene` rule 6e: `ROADMAP.md:376` (the `198-08-PLAN.md` bullet names "Phase 196" in an unchecked bullet). Present at HEAD before this plan, authored by the phase planning commit, out of this plan's scope and in a file the plan says not to edit. ESLint itself reports 0 errors (2 pre-existing unused-var warnings in `MetricsColumn.tsx` and `composite-read-path.ts`); `check-admin-route-manifest`, `check-route-contract` and `check-canonical-domain` pass.

## Known Stubs

None.

## Threat Flags

None. No endpoint, auth path or schema change; figures are formatted client-side from the SSR payload.

## Residuals (from the plan's flagged assumptions)

- Glance Sharpe and the factsheet body's Sharpe on the ready Overview come from different series; the series caption covers it, no distinct label was added (D-06 asks for distinct YTD labels only, pinned: no `YTD TWR` under `src/app/factsheet`).
- The glance does not report an impossible positive drawdown to Sentry (it prints the dash); Scenario's `KpiStrip` still reports it when mounted.

## Self-Check: PASSED

Files exist (module, component, three new tests, SUMMARY); commits 7da87ab5a and 018474fa6 are ancestors of HEAD; allocations suite 2988 tests across 173 files green with the contracts registry, figure-gate census, display-sign census and figure-parity-pages; `tsc --noEmit` exit 0.
