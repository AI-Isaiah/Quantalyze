---
phase: 194-figuretruth-a-figure-means-one-thing-everywhere-and-shows-on
plan: 05
subsystem: scenario, exposure widgets, D-08 labels
tags: [trust-04, trust-05, d-08, d-15, scenario, peer-rank]

requires:
  - phase: 194-03
    provides: figure-gate.ts (figureRecord, gateAnnualized, gatedValue, recordClears, withheldReason, shortTrackNote)
provides:
  - "194-D08-SITES.md: 24 classified label sites, 0 routed to 194-08, `d08-book-equity: none` with what was searched"
  - "D-08 labels: `Gross exposure`, `Net exposure` (KPI, table headers, chart legend and series), `Modelled equity (USD)` (Scenario book mode)"
  - "`scenario-figure-gate-note` test id; the Scenario blend strip gated by the blend's overlap record"
  - "`buildScenarioPeerRankRequest(metrics, record)` ranks exactly when `recordClears(record) === true`; `PEER_RANK_MIN_OBS` retired"
affects: [194-08, 194-16]

actuals:
  tokens: 26000
  tasks: 3
  commits: 3

plan_head_before: e795d76269efcaad31e3bac7a6d713878794336a
plan_head_after: 0cf069a6048868a9244918e972dd0bf9bfbc99a7

key-files:
  created:
    - .planning/phases/194-figuretruth-a-figure-means-one-thing-everywhere-and-shows-on/194-D08-SITES.md
  modified:
    - src/app/(dashboard)/allocations/widgets/positions/ExposureByClass.tsx
    - src/app/(dashboard)/allocations/widgets/positions/ExposureByClass.test.tsx
    - src/app/(dashboard)/allocations/widgets/positions/NetExposureChart.tsx
    - src/app/(dashboard)/allocations/widgets/positions/NetExposureChart.test.tsx
    - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
    - src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx
    - src/lib/scenario-peer-request.ts
    - src/lib/scenario-peer-request.test.ts

key-decisions:
  - "The whole-book dollar headline does not exist on any surface after Phase 64 removed the KpiStrip AUM cell; `Book equity` has no site to land on, recorded with what was searched."
  - "Book-mode Scenario label is `Modelled equity (USD)`; blank mode keeps the literal `PORTFOLIO AUM (USD)`."
  - "The gate is a display rule on the strip only. Peer rank, commit and compare keep raw engine values."

requirements-completed: []  # TRUST-04 / TRUST-05 close with the surface plans

duration: 1 session (3 task commits)
completed: 2026-11-07
status: complete
---

# Phase 194 Plan 05: D-08 labels, site census and the Scenario blend gate Summary

**Gross and net exposure and the modelled book now name their quantity, every D-08 site is censused, and the Scenario blend's annualised figures and peer rank follow D-15's overlap-record rule (crypto any leg: 90 calendar days; non-crypto: 60 observations) instead of the retired 252-observation floor.**

## Accomplishments

- **Census (task 1).** 24 rows, each with class and `apply-in`. 8 rows carry exposure labels and 1 the modelled-equity label, all `194-05`; the rest are class `none` (mandate thresholds, the discovery `AUM` column, aria-labels, a strategy-declared `AUM` chip, per-position values, a P&L total). `d08-apply-194-08: 0`: neither `EquityChart.tsx`, `BridgeWidget.tsx` nor `AllocationsTabs.tsx` has a label to change. `PortfolioKpiPanel.tsx` no longer exists at this HEAD.
- **`d08-book-equity: none`.** Searched every dollar-figure render and every total/sum under the allocations tree, the Overview factsheet mount (`hideHeader`, so the `CapacityChip` never shows) and the Holdings tab. Each hit is a per-position value, a P&L total, a declared strategy AUM or an exposure. The payload's `aum` is a sum of strategies' own declared `aum`, not custody.
- **Labels (task 2).** `Gross exposure` / `Net exposure` on the KPI cells, the drilldown table headers, the legend chips and the series names; `Modelled equity (USD)` on the Scenario field in book mode (CSS uppercases it), the Models-N-of-M note kept beside it. Numbers, test ids, headings, aria-labels and the "portfolio AUM" error strings are unchanged.
- **Blend gate (task 3).** One memoised `blendRecord` (`figureRecord` over `effective_start`/`effective_end`, `n`, `blendBasis`) read by the strip gate and the peer-rank effect. The strip receives `gatedBlendMetrics` (cagr, volatility, sharpe, sortino through `gatedValue`), plus one muted `scenario-figure-gate-note` caption (`withheldReason("blend", record)` or `shortTrackNote("blend", spanDays)`). `buildScenarioPeerRankRequest(metrics, record)` returns null unless `recordClears(record) === true` and the metrics are finite; the SAMPLE FLOOR doc is now a dated D-15 paragraph.

PEER-03's 252-observation floor is retired per D-15 ("peer ranks follow the same rule"): it mirrored the factsheet's n<252 caveat that plan 04 removes. A blend from 90 days (crypto) or 60 observations (non-crypto) is now ranked; the request body is byte-identical.

## RED proofs (neuter, `cp -p` byte backup, restore, `cmp` clean)

1. Raw values instead of `gatedValue` in `ScenarioComposer.tsx`: `AssertionError: expected 9.31011 to be null` in the 89-day case (and `expected 10.788 to be null` in the crypto-basis case). 2 failed, 3 passed.
2. Record built with `periodsPerYear: 252` instead of `blendBasis`: the same two cases RED (`expected 9.31011 to be null`, `expected 10.788 to be null`), because 90 observations clear the non-crypto bound.
3. `n < 252` restored in `buildScenarioPeerRankRequest`: 3 failed. `AssertionError: expected null to deeply equal { sharpe: 1.42, sortino: 1.88, …(2) }` (crypto 90-day request), plus `expected null not to be null` for the non-crypto 60-observation case and the no-252-floor case.

All three restored byte-identical; suites green after.

## Gates

- `npx vitest run "src/app/(dashboard)/allocations" src/lib/scenario-peer-request.test.ts`: 161 files, 2733 passed.
- `npm run typecheck`: clean. `npx eslint` on the four touched source/test files: 0 errors.
- Task 1 and task 3 `<automated>` greps pass (`scenario-figure-gate-note` present, `recordClears(` present, `PEER_RANK_MIN_OBS` gone from `src`, `scripts`, `docs`).

## Deviations from Plan

**1. [Rule 1 - Bug] Nine existing composer tests went RED once the strip was gated.** They read the volatility/Sharpe the composer hands `KpiStrip`, on 12-60 day fixtures built to test engine plumbing (leverage edits, source toggles, AUM invariance). The gate now correctly withholds those figures. Fix: `@/lib/figure-gate` is mocked as a pass-through spy on `gateAnnualized`; those nine tests call `openFigureGate()`, and a file-level `afterEach` restores the real gate, so the five new gate tests and every other test run the real function. No assertion in those nine tests changed.

**2. [Scope] The plan's "blend metrics section" is the `Scenario blend` KpiStrip.** The composer does not render a CAGR/volatility/Sortino/Calmar block of its own: the blend's only annualised cell in the composer is the strip's Sharpe, and the five-figure factsheet preview is plan 08's `scenarioMode` work. The gate wraps `scenarioMetrics` for the strip (cagr, volatility, sharpe, sortino; `ComputedMetrics` has no calmar), so the plan-08 mount can reuse `blendRecord`'s rule.

**3. [Judgement] The caption is hidden for an empty blend (`n <= 0`).** Otherwise a blank-slate Scenario would print "It has 0 trading days"; every figure is already `—` there.

**4. Composer cases are crypto-only.** A per-key book is always crypto (365), and building a non-crypto blend through the composer needs a drawer-added strategy with a resolved asset class. The 60/59-observation and 84-day non-crypto cases are pinned at the module level in `scenario-peer-request.test.ts` (and in plan 03's `figure-gate.test.ts` blend vectors).

**5. [Judgement] Table headers also relabelled.** The census classed the `ExposureByClass` drilldown `Gross`/`Net` column headers as the same quantities, so they follow the KPI labels (`apply-in: 194-05`).

## Known Stubs

None.

## Threat Flags

None. T-194-09 (label-only diff; values asserted unchanged by the existing tests) and T-194-47 (request body byte-identical; route cohort floor and `scenarioPeerLimiter` untouched) hold.

## Self-Check: PASSED

Files exist: the census and all eight modified sources. Commits `be28e9628`, `f33845f83`, `0cf069a60` are ancestors of HEAD.
