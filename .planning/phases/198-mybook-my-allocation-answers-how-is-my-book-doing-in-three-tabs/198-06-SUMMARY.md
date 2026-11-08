---
phase: 198-mybook-my-allocation-answers-how-is-my-book-doing-in-three-tabs
plan: 06
subsystem: allocations-overview
tags: [overview, risk, mandate, history-gate, d-02]
requires:
  - phase: 198-01
    provides: GlancePanel mounted in the Overview
  - phase: 198-04
    provides: three-tab shell and the legacy alias scroll to #risk and #mandate
provides:
  - Overview section "Risk" (`#risk`), gated by the Overview's one historyGate call
  - Overview section "Mandate" (`#mandate`), last, one square hairline data panel
affects: [198-08, 198-09, 198-11]
tech-stack:
  added: []
  patterns: [one gate call in the parent mounts a client-only next/dynamic child, so the child cannot disagree with the page]
key-files:
  created: []
  modified:
    - src/app/(dashboard)/allocations/AllocationDashboardV2.tsx
    - src/app/(dashboard)/allocations/RiskTabPanel.tsx
    - src/app/(dashboard)/allocations/MandateTabPanel.tsx
    - src/app/(dashboard)/allocations/OverviewRisk.history-parity.test.tsx
    - src/app/(dashboard)/allocations/RiskTabPanel.book-series.test.tsx
    - src/app/(dashboard)/allocations/MandateTabPanel.test.tsx
key-decisions:
  - "The Risk section's loading slot and the grid are client-only (next/dynamic, server rendering off), the runtime the grid had as a tab. The section and its heading are in the server-rendered tree, so the anchor exists on first paint."
  - "RiskTabPanel no longer gates itself. It draws the grid for any payload it is handed, so its only caller is the Overview's ready branch."
  - "The rebuilding, class-heading and fail-closed cases that stood in RiskTabPanel.book-series.test.tsx moved to the Overview test (the heading cases are covered by its per-reason heading matrix). The standalone VaR, correlation and decomposition cases are unchanged."
requirements-completed: [LEAN-06, ROUTE-07]
status: complete
duration: about 30 min
completed: 2026-11-08
commits: 2
plan_head_before: 433937cbb73404fd661d461dc65da00331eab51e
plan_head_after: 800c727f2dd1480efcd904880100a4eaf4eef3b5
actuals:
  tokens: 11000
  tasks: 2
  commits: 2
---

# Phase 198 Plan 06: Risk and Mandate on the Overview Summary

The retired Risk and Mandate tabs now live on the Overview as two sections after the factsheet body: Risk shows its six widgets only when the Overview's single history gate reads ready (one line otherwise), and Mandate comes last as one square hairline panel with an `Edit mandate` link.

## Tasks

| Task | Name | Commit |
| ---- | ---- | ------ |
| 1 | The Overview's Risk section, under the one gate (D-02, P5) | 0588aafb1 |
| 2 | The Overview's Mandate section, last, as one data panel (D-02) | 800c727f2 |

## What was built

- `AllocationDashboardV2.tsx`: `RiskTabPanel` is a module-scope `next/dynamic` import (client-only, `role="status"` loading line `Loading risk figures…`). After the ready, warm-up or rebuilding branch, `<section id="risk" aria-labelledby>` holds an `<h2>` `Risk` and either the grid (gate `ready`) or the one line `Risk figures need the equity history. See the note above.`. `<section id="mandate">` follows with an `<h2>` `Mandate` and `MandateTabPanel` (static import). Both sit below the `no_eligible_key` early return, which is unchanged, so the connect card replaces them. `historyGate(` is still called once in the file.
- `RiskTabPanel.tsx`: both early returns, the gate call and their imports removed. Grid, `RISK_WIDGETS`, `data-widget-id`, per-widget `Suspense` and the unavailable tile are unchanged.
- `MandateTabPanel.tsx`: one outer `border border-border bg-surface` panel, no rounding or shadow, an interior `border-t border-border` above the link row. Link copy is `Edit mandate`, href `/profile?tab=mandate`. Snapshot content, tier labels and number formatting are byte-identical.
- Tests: `OverviewRisk.history-parity.test.tsx` rewritten as one-tab tests (72-cell reason x key x book x syncing matrix with hand-derived answers, connect-card absence of `#risk` and `#mandate`, per-reason panel heading, key_not_syncing naming, ready with six widgets in order after the factsheet body, all-closed book, warm-up order, fail-closed for missing, null and unknown state, the 2026-10-03 regression, the Mandate order and its absence in the connect state). Every absence check settles dynamic imports first, so a lazily mounted grid cannot hide a gate failure. `MandateTabPanel.test.tsx` gained the single-panel case and the new link label.

## Gate evidence

- gc-198-06-neuter: gate=OverviewRisk.history-parity.test.tsx (Risk section mounts the grid whatever the gate says) result=red restored=identical (the 2026-10-03 case, the fail-closed cases and the rebuilding matrix cells RED; byte copy restored with `cp -p`, `cmp` exit 0, 94/94 GREEN)
- gc-198-06-neuter: gate=MandateTabPanel.test.tsx (old link label restored) result=red restored=identical (the link case RED, `cmp` exit 0)
- gc-198-06-neuter: gate=OverviewRisk.history-parity.test.tsx (Mandate section moved above Risk) result=red restored=identical (both order cases, ready and rebuilding, RED, `cmp` exit 0)
- gc-198-06-gates: vitest=green tsc=clean lint=clean-except-known (see Notes)

Results: `src/app/(dashboard)/allocations` plus `contracts-registry`: 174 files, 3084 tests, all green. `node scripts/verify-plan-anchors.mjs` on the plan: OK (17 claims). The TDD RED was seen before each implementation (73 failures before the Risk section, 5 before the Mandate section).

## Deviations from Plan

None - plan executed exactly as written. One note on a plan sentence: it says "no `ssr: false` count above 1"; the first draft's comment contained the literal and printed 2, so the comment was reworded and the count is `1`.

## Notes

- `npm run lint`: eslint reports 0 errors (two pre-existing unused-variable warnings in `MetricsColumn.tsx` and `composite-read-path.ts`, not touched here). `check-planning-hygiene` fails on the known rule 6e `ROADMAP.md` bullet naming Phase 196, which the phase brief says is not this plan's to fix. All other lint steps pass.
- The Risk widget tiles keep `rounded-lg` (the plan says leave them unchanged); only the Mandate panel is square.
- Residual, as the plan states: `AllocationsTabs*.test.tsx` mocks of `./RiskTabPanel` and `./MandateTabPanel` are dead after 198-04 and left for 198-08.
- The 320px reflow backstop (widgets scroll inside their own track, `#main-content` never scrolls sideways) is this plan's Risk half but is verified by 198-08's sweep, not here.

## Known Stubs

None.

## Threat Flags

None. T-198-12 is mitigated: the one gate decides the section, a missing state reads as rebuilding, and the neuter of the gate goes RED on the rebuilding and fail-closed cases.

## Self-Check: PASSED

- 0588aafb1 and 800c727f2 are ancestors of HEAD.
- The six modified source and test files exist and are committed; the tree was clean before this SUMMARY.
