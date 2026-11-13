---
phase: 201-plainwords-one-name-per-concept-explained-and-the-small-inco
plan: 16
subsystem: ui
tags: [glossary, tooltips, discovery, compare, copy-census]
requires:
  - phase: 201-25
    provides: copy census ledgers
  - phase: 201-26
    provides: required viewer argument on displayStrategyName
provides:
  - discovery column tooltips read from the glossary registry, pinned by hand-typed literals
  - plain discovery headers as Form A terms (keyboard path)
  - Terms on grid, All Filters, compare table; "Save view"; formatDay dates; empty ledger plan-16
affects: [201-23, 201-24]
tech-stack:
  added: []
  patterns: [Form A Term on plain headers, Form B Tooltip kept on sort headers, Tooltip (not Term) where a label sits inside a link]
key-files:
  created:
    - src/components/strategy/discovery-columns.tooltips.test.ts
  modified:
    - src/components/strategy/discovery-columns.ts
    - src/components/strategy/StrategyTable.tsx
    - src/components/strategy/StrategyGrid.tsx
    - src/components/strategy/StrategyFilters.tsx
    - src/components/strategy/CompareTable.tsx
    - src/components/strategy/CompareEquityOverlay.tsx
    - src/components/strategy/CustomizeDrawer.tsx
    - src/app/(dashboard)/strategies/page.tsx
    - e2e/helpers/discovery-selectors.ts
    - scripts/copy-census/ledgers/plan-16.ts
decisions:
  - "StrategyGrid AUM label uses Tooltip (Form B), not Term: it sits inside the card's factsheet link, and a Term tab stop would nest a focusable in a link. Recorded as a ledger exception."
  - "e2e helper key renamed savePreferences to saveView; no spec used the key (grep -a over src e2e tests), so the rename is safe."
status: complete
actuals:
  tokens: 40000
  tasks: 3
  commits: 3
plan_head_before: 8724de1ab708bff9ef2d452ffeb07ac6c4a2d03b
plan_head_after: 23f7059efe1616a2ad709090b30fd92282c08796
completed: 2026-11-11
---

# Phase 201 Plan 16: Discovery, compare and Strategies page terms Summary

Discovery column tooltips now read the glossary registry (`termDefinition(key, "discovery")`) with a hand-typed literal pin, the two plain headers are keyboard-reachable Form A terms, and grid, filter, compare surfaces, "Save view" and `formatDay` dates are in place with ledger plan-16 at `pending: {}`.

## Tasks

| Task | Commit | Result |
|------|--------|--------|
| 1 (tracer) registry-read tooltips + literal pin | 62b476079 | `FULL_RECORD_BASIS` private copy gone from discovery-columns.ts; 23 pins |
| 2 Form A headers, Terms, dates, Save view | 19b7f2fac | Return curve / Underwater are `[data-term]`, tabIndex 0, not inside a button; sort headers unchanged (no nested tab stop); Created cell and track title via `formatDay`; drawer and e2e selector say Save view |
| 3 overlay, Strategies page, ledger | 23f7059ef | `CompareEquityOverlay` drops its private date formatter for `formatDay`; Strategies draft banner through `formatDay`; ledger `pending: {}`, 16 exceptions |

Resume note: the interrupted executor had committed Task 1 and left Tasks 2 and 3 uncommitted. I reviewed the diff, kept it, and committed it in task order. The ledger is one file shared by Tasks 2 and 3 and the live tree for Task 3's files was already fixed in the working tree, so the copy census is only consistent at the Task 3 commit (red at the Task 2 commit alone).

compare/page.tsx, CompareAddStrategy.tsx, browse pages and PercentileRankBadge produced no census hits (runner prints nothing) and were not edited.

## Verification

- `node scripts/verify-plan-anchors.mjs` on the plan: green before Task 1 (previous executor); re-run after the work reports 3 symbol-absent MISSes (`FULL_RECORD_BASIS`, `formatIsoDay`, `savePreferences`), which are exactly the symbols this plan removes, so the misses are the expected post-change reading, not a defect.
- Task 3 scoped vitest (all families plus copy-census, figure-gate-census, figure-parity-pages, glossary): 48 files passed, 1063 tests passed, 0 failed.
- `npx tsx scripts/copy-census/run.ts --ledger plan-16`: no hits; `src/__tests__/copy-census.test.ts` 28/28.
- `npx eslint` on every touched source, test and helper file: exit 0, clean.
- `npm run typecheck` (tsc --noEmit): no errors.
- Acceptance greps: `const FULL_RECORD_BASIS` 0; `formatIsoDay` in StrategyTable.tsx 0; `Save preferences` in CustomizeDrawer.tsx 0 and discovery-selectors.ts 0.

gc-201-16-neuter: gate=discovery-columns.tooltips.test.ts result=red restored=identical
(RED line: `sharpe: the tooltip reads exactly the words it read at HEAD` — Expected "...annualized volatility over the whole record..." Received "...annualized variance over the whole record..."; glossary.ts restored with `cp -p`, `cmp` exit 0, GREEN)

gc-201-16-neuter: gate=StrategyTable.headers.test.tsx result=red restored=identical
(RED lines: `Return curve, full record: the label is a focusable [data-term] and not inside a button` and `Underwater, full record: ...`, 4 failures with the Form A wrap removed; StrategyTable.tsx restored, `cmp` exit 0, 62/62 GREEN)

gc-201-16-gates: vitest=green eslint=clean tsc=clean

## Deviations from Plan

None in behaviour. One structural note: ledger exceptions cover native `<option>` text (CustomizeDrawer, StrategyFilters), the "Not shown" prose sentence in StrategyTable, and the StrategyGrid AUM label inside a link; each uses a closed reason from policy.ts and `pinnedExceptionCount` is 16.

## cross-plan-pins

- `src/lib/glossary.test.ts` (plan 201-01 parity test) is now tautological for discovery tooltips because the columns read the registry; passes unchanged. Plan 201-23 decides. Plan 201-24 full run is the cross-plan gate.

## reported-not-edited

None. No phase-200 file was touched. Playwright was not run (per plan).

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or name source (T-201-22: browse and viewer-argument tests stayed green in the scoped run).

## Self-Check: PASSED

- FOUND: src/components/strategy/discovery-columns.tooltips.test.ts
- FOUND commits 62b476079, 19b7f2fac, 23f7059ef on wt/201-p16
