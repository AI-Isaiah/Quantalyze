---
phase: 201-plainwords-one-name-per-concept-explained-and-the-small-inco
plan: 13
subsystem: ui-copy
tags: [plainwords, glossary, term, allocation-wording, copy-census]
requires: [201-25, 201-26]
provides:
  - optimizer glossary on Term from the registry (one affordance, one definition source)
  - allocation wording across impact, insight, simulate-impact, replacement and exchanges surfaces
  - full close-day balance stamp on the exchange key row
  - plan-13 copy census ledger emptied (pending: {})
key-files:
  modified:
    - src/app/(dashboard)/allocations/components/OptimizerPanel.tsx
    - src/app/(dashboard)/allocations/components/OptimizerPanel.test.tsx
    - src/components/portfolio/PortfolioOptimizer.tsx
    - src/components/portfolio/PortfolioOptimizer.test.tsx
    - src/components/portfolio/PortfolioImpactPanel.tsx
    - src/components/portfolio/PortfolioImpactPanel.test.tsx
    - src/components/portfolio/InsightStrip.tsx
    - src/components/portfolio/InsightStrip.test.tsx
    - src/components/portfolio/CorrelationHeatmap.tsx
    - src/components/portfolio/CorrelationHeatmap.test.tsx
    - src/components/portfolio/ReplacementPanel.tsx
    - src/components/portfolio/portfolio.signed-zero.test.tsx
    - src/components/discovery/SimulateImpactButton.tsx
    - src/components/discovery/SimulateImpactButton.test.tsx
    - src/components/exchanges/ExchangesTabContent.tsx
    - src/components/exchanges/ExchangesTabContent.test.tsx
    - src/components/exchanges/AllocatorExchangeManager.tsx
    - src/components/exchanges/AllocatorExchangeManager.native-balance.test.tsx
    - src/lib/portfolio-insights.ts
    - src/lib/portfolio-insights.test.ts
    - src/__tests__/widget-state-no-duplicate-empty.test.ts
    - scripts/copy-census/ledgers/plan-13.ts
status: complete
actuals:
  tasks: 3
  commits: 3
plan_head_before: 8724de1ab
plan_head_after: c52ca4a52facd4778d129b717e58d0ca15c90f03
---

# Phase 201 Plan 13: Optimizer, impact and exchanges copy Summary

The optimizer's private dotted-underline glossary now renders through `Term` with registry definitions, the column labels and tooltips read the same registry text, and the impact, insight, simulate-impact and exchanges surfaces name the allocator's holdings "allocation" with a full-year balance stamp.

## Task to commit map (resume of an interrupted run)

| Task | Commit | Result |
|------|--------|--------|
| 1 (tracer) optimizer glossary and columns read one registry definition | 68c7f8f15 | `METRIC_TOOLTIPS` gone, labels `Corr w/ allocation`, three `Term` keys (sharpe_lift, corr_with_allocation, dd_improve), PortfolioOptimizer tooltips via `termDefinition` |
| 2 allocation wording, full balance date | a58f2b535 | impact panel, insight strip, simulate-impact button, exchanges tab, insight sentences; `formatCloseDay(closeDate)` with no yearless option |
| 3 remaining terms, ledger empty | c52ca4a52 | `Avg |rho|` wrapped in `Term` (CorrelationHeatmap), ReplacementPanel empty copy, ledger `pending: {}` |

The resumed executor re-verified every acceptance criterion at HEAD (below) and finished no code work: all three tasks were already committed; only the SUMMARY and the neuter line were missing.

## Verification (real output at HEAD c52ca4a52)

- Scoped vitest (portfolio, discovery, exchanges, OptimizerPanel test, portfolio-insights test, widget-state-no-duplicate-empty, copy-census, figure-gate-census): **21 files, 586 tests, 586 passed, 0 failed**.
- `npx eslint` on all 13 touched source files: exit 0, clean.
- `npm run typecheck` (`tsc --noEmit`): exit 0, no output.
- `npx tsx scripts/copy-census/run.ts --ledger plan-13`: no remaining hits listed; ledger is `pending: {}` with 2 exceptions, `pinnedExceptionCount: 2`.
- Acceptance greps: `METRIC_TOOLTIPS` in OptimizerPanel = 0; `Corr w/ portfolio` in PortfolioOptimizer = 0 and OptimizerPanel = 0; `year: false` in AllocatorExchangeManager = 0; `Open My Allocation` in ExchangesTabContent = 0.

## Neuter (T-201-18, label equality must be able to fail)

Backed up PortfolioOptimizer.tsx with `cp -p`, put the old label `Corr w/ portfolio` back in that file only, ran the two optimizer test files: **4 failed, 47 passed**, first cause `AssertionError: expected 'Corr w/ portfolio' to be 'Corr w/ allocation'`. Failing tests: the registry-label equality test and the glossary-equals-column test (U-17), plus two PortfolioOptimizer behaviour tests that locate the column by its label. Restored with `cp -p`, `cmp` exit 0, re-run **2 files, 51 tests, all green**. Working tree clean afterwards.

gc-201-13-neuter: gate=OptimizerPanel.test.tsx+PortfolioOptimizer.test.tsx result=red restored=identical

gc-201-13-gates: vitest=green eslint=clean tsc=clean

## Deviations from Plan

### Notes (no code deviation)

**1. Plan anchor check reports one stale symbol after the task ran.**
`node scripts/verify-plan-anchors.mjs` on the plan prints `MISS ... METRIC_TOOLTIPS ... [symbol-absent]` at HEAD. This is expected: the anchor is a pre-task claim about the code Task 1 removes (it has 2 hits at the base commit 8724de1ab, 0 now). It was valid before Task 1 and cannot be valid after it. Not a defect; not "fixed" because the plan file is read-only to this plan.

**2. Task 3 touched fewer files than listed.** BridgeTrigger.tsx, ReplacementCard.tsx and AllocatorSyncStatus.tsx are unchanged: the runner listed no hit that needed wrapping there beyond the two ReplacementCard `Sharpe`/`MaxDD` unit-suffix exceptions recorded in the ledger (reason: not a label position, the key prints as the suffix of one formatted value). BridgeTrigger copy was not changed; the F-04 Bridge retirement and F-12 egress changes belong to plans 201-28..201-34 and were not applied here.

**3. Extra owned test files edited:** `CorrelationHeatmap.test.tsx` and `portfolio.signed-zero.test.tsx` (both in the `src/components/portfolio/*` family this plan owns) changed with their source strings. Added to the file list above.

## reported-not-edited

None. No phase-200 file (ApiKeyManager.tsx, ConfirmKeyChangeDialog.tsx, the two e2e specs) was touched or needed a copy change.

## cross-plan-pins

None found in this plan's scoped runs. `AllocationDashboardV2.*` and `AllocationsTabs.*` tests (plan 201-12) and any test outside the owned directories were not run here; plan 201-24's full `npm test` on the merged branch is the cross-plan gate.

## Known Stubs

None.

## Threat Flags

None. Copy and display of the allocator's own data; no new endpoint, auth path or schema.

## Self-Check: PASSED

- Commits 68c7f8f15, a58f2b535, c52ca4a52 are ancestors of HEAD on wt/201-p13.
- All 22 files in the table exist; ledger `scripts/copy-census/ledgers/plan-13.ts` has `pending: {}`.
