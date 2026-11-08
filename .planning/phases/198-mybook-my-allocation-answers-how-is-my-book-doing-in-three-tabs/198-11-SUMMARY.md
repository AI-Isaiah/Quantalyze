---
phase: 198-mybook-my-allocation-answers-how-is-my-book-doing-in-three-tabs
plan: 11
subsystem: holdings-panel
tags: [route-07, route-08, lean-06, holdings, dust, positions-header, outcomes, d-02, d-04]
requires:
  - phase: 198-01
    provides: bookEquityUsd, holdingsReadDay, unreportedDerivativeCount, GlancePanel
  - phase: 198-02
    provides: isDust and its copy (DUST_RULE_CAPTION, dustControlLabel, dustAnnouncement, dustHiddenLine)
  - phase: 198-13
    provides: the spot table the dust ids extend
provides:
  - Holdings in the D-02 order, Strategies, Positions, Exposure, Outcomes, Watchlist and Optimizer, Notes
  - a Positions header printing the glance's Book equity, read day and unreported-derivative caption from one set of helpers
  - one dust control over both position tables, with totals untouched
affects: [198-12]
tech-stack:
  added: []
  patterns: [tables take every row plus a set of ids to leave unrendered, never a pre-filtered array]
key-files:
  created:
    - src/app/(dashboard)/allocations/HoldingsTabPanel.positions-header.test.tsx
    - src/app/(dashboard)/allocations/HoldingsTabPanel.dust.test.tsx
  modified:
    - src/app/(dashboard)/allocations/HoldingsTabPanel.tsx
    - src/app/(dashboard)/allocations/HoldingsTabPanel.test.tsx
    - src/app/(dashboard)/allocations/HoldingsTabPanel.exposure.test.tsx
    - src/app/(dashboard)/allocations/HoldingsTabPanel.key-read-notes.test.tsx
    - src/app/(dashboard)/allocations/lib/book-figures.ts
    - src/app/(dashboard)/allocations/lib/book-figures.test.ts
    - src/app/(dashboard)/allocations/components/GlancePanel.tsx
    - src/app/(dashboard)/allocations/components/HoldingsTable.tsx
    - src/app/(dashboard)/allocations/components/OpenPositionsTable.tsx
key-decisions:
  - "An all-dust derivatives table prints its hidden line as a body row inside the table, not instead of the table, so the footer total and its notes (which count every row) stay on screen. The spot table has no footer, so it uses the plain paragraph."
requirements-completed: [LEAN-06, ROUTE-07, ROUTE-08]
status: complete
duration: about 45 min
completed: 2026-11-08
commits: 4
plan_head_before: a099508ec09e066f3a267a659709da0b243e4ba6
plan_head_after: 1eb01e6ac7fb9b1548c883f448b44deed458f660
actuals:
  tokens: 13400
  tasks: 3
  commits: 4
---

# Phase 198 Plan 11: Holdings order, Positions header and dust Summary

Holdings now reads Strategies, Positions, Exposure, Outcomes, Watchlist and Optimizer, then Notes; the Positions header prints the glance's Book equity from the same helpers; and positions under $50 or under 0.1% of the book fold behind one control that never moves a figure.

## Tasks

| Task | Name | Commit |
| ---- | ---- | ------ |
| 1 | The D-02 Holdings order, Positions second and Outcomes after Exposure | 866992ec4 |
| 2 | The Positions header matches the glance (C5, SC-2 parity) | 890a7af95 |
| 3 | Dust hidden behind one control, totals untouched (D-04) | e289523c3 |
| - | Comment cleanup (the retired heading name) | 1eb01e6ac |

## What was built

- `HoldingsTabPanel.tsx`: the former `Exchange Positions` section is now `<section id="positions">` labelled by its `Positions` heading, directly after Strategies and the `AllocateDialog`. A new `<section id="outcomes">` after Exposure mounts `OutcomesTabPanel` (the unchanged `OutcomesWidget` with its own empty state). The file docblock and section comments are renumbered to the D-02 order.
- Positions header: a `positions-book-equity` span (`Book equity {formatUsd} · read {day}`, read half only when a day is known, a dash for an empty book) and a `positions-unreported-caption` line, both memoised over every `holdingsSummary` row.
- `book-figures.ts`: new `unreportedDerivativeCaption(n)`; `GlancePanel` prints its caption through it, so the sentence exists once.
- Dust: `dustIds` is one `isDust` pass over spot rows (priced = not a price gap) and derivative rows (priced = finite positive mark), `trustedKey` = not `keyNeedsAttention` and not `source_key_missing`, against `bookEquityUsd`. `HoldingsTable` (legacy mode) and `OpenPositionsTable` take an optional `hiddenRowIds` set and skip those ids in the body only; `openPositionCount` stays the full count. Each table sits in `#positions-spot` / `#positions-derivatives`. The ghost `Button` (`aria-expanded`, `aria-controls` naming both wrappers), the caption and a polite `LiveRegion` render only when the dust count is above zero; the toggle is `useState(false)`, so a reload hides dust again.
- No migration, no API route change, no package added.

## Decisions Made

- An all-dust derivatives table keeps its `<table>` and puts the `{n} small position(s) hidden.` line in a `tbody` row (colSpan 7). The plan said "instead of its shipped empty line"; replacing the whole table would have removed the footer total, the P&L-unavailable note and the key-trust note from view, which count every row and must not move with the toggle (T-198-20). The spot table has no footer and uses the paragraph.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Order test needed the Notes heading**
- **Found during:** Task 1
- **Issue:** `DashboardNoteCard` owns its own `h3`, so the section-heading list ends with `Notes`; the behavior list names four headings and treats Notes as the last landmark.
- **Fix:** the order case asserts the five `h3`s and that the last section is the `Notes` landmark.
- **Files modified:** `HoldingsTabPanel.test.tsx`
- **Commit:** 866992ec4

**2. [Rule 2 - Missing critical] All-dust derivatives table keeps its footer** (see Decisions Made)
- **Files modified:** `OpenPositionsTable.tsx`
- **Commit:** e289523c3

**3. [Scope] `book-figures.test.ts` gained a case for `unreportedDerivativeCaption`** (a file outside the plan's list; the new exported helper needs its own pin).
- **Commit:** 890a7af95

No other deviations. The plan's D-08 precondition held (`figure-gate-census.test.ts`, `dust.ts` and `isCashHolding(` in `HoldingsTable.tsx` all exist at HEAD).

## Gate evidence

- gc-198-11-neuter: gate=HoldingsTabPanel.test.tsx + HoldingsTabPanel.exposure.test.tsx (Outcomes section moved before Exposure) result=red restored=identical (2 order cases RED, `cp -p` restore, `cmp` exit 0, 27/27 GREEN)
- gc-198-11-neuter: gate=HoldingsTabPanel.positions-header.test.tsx (header Book equity computed from spot rows only) result=red restored=identical (3 cases RED: the byte-equal parity case, the derivative-equity case and the no-read-day case; `cmp` exit 0, GREEN)
- gc-198-11-neuter: gate=HoldingsTabPanel.dust.test.tsx (derivatives footer pass skips hidden ids) result=red restored=identical (the totals-unchanged case RED, `cmp` exit 0, 16/16 GREEN)
- gc-198-11-neuter: gate=HoldingsTabPanel.dust.test.tsx (control rendered at zero dust) result=red restored=identical (4 cases RED including the zero-dust case, `cmp` exit 0, 16/16 GREEN)
- gc-198-11-gates: vitest=green census=green tsc=clean lint=eslint-clean (see Notes)

## Verification

- `node scripts/verify-plan-anchors.mjs` on the plan: OK, 19 claims.
- `npx vitest run "src/app/(dashboard)/allocations" src/__tests__/contracts/contracts-registry.test.ts src/__tests__/display-sign-single-source.test.ts src/__tests__/holding-scope-key-census.test.ts src/__tests__/figure-gate-census.test.ts`: 181 files, 3265 tests passed.
- `npx tsc --noEmit`: clean.
- Acceptance greps: `id="outcomes"` 1, `id="positions"` 1, `<OutcomesTabPanel` 1, `Exchange Positions` 0, `buildHoldingRef(` still 2, `hiddenRowIds` present in both tables, `no reported P&L` 0 in `GlancePanel.tsx`.

## Notes

- Lint: `eslint src/` reports 0 errors (two unused-var warnings in files this plan did not touch). The chained `check-planning-hygiene` fails on rule 6e, the known ROADMAP.md "Phase 196" bullet named in the phase notes; it is not this plan's and was left alone. So `lint=clean` is recorded as `eslint-clean`, not as a full `npm run lint` exit 0.
- Flagged-holdings list: `ScenarioFlaggedHoldingsList` still renders inside the Positions section, untouched; plan 198-12 removes it.
- `?tab=outcomes` scrolling to `#outcomes` is 198-04's alias; this plan supplies the `#outcomes` target.

## Known Stubs

None.

## Threat Flags

None. No new network endpoint, auth path or schema; T-198-20 (dust must not move totals or hide unpriced/untrusted rows) is mitigated and pinned by the dust and parity tests.
