---
phase: 201-plainwords-one-name-per-concept-explained-and-the-small-inco
plan: 09
subsystem: factsheet-panels
tags: [d-01, d-02, d-03, d-04, d-06, d-11, d-19, d-20, clar-03, clar-04, clar-06, copy-census]
requires: [201-25, 201-26]
provides:
  - PlainTerms around the factsheet body under printView
  - Term on the KPI strip, Style Drift rows, the Kolmogorov-Smirnov name, Distribution percentiles, Calmar by Year, the bootstrap interval and Volatility Matched
  - CollapsibleSection `term` prop (Form B Tooltip on the title) for Returns Signatures
  - Constituents heading and the allocation wording in BatchDPanels, months through formatMonth
  - ledger plan-09 with pending {} and one pinned exception
affects: [201-24]
tech-stack:
  added: []
  patterns:
    - "TermLead: a label longer than its term wraps only the term's own words (Max DD (shallower = better))"
    - "CollapsibleSection title Form B: Tooltip around the title, no focusable inside the summary"
key-files:
  created: []
  modified:
    - src/app/factsheet/[id]/v2/FactsheetView.tsx
    - src/app/factsheet/[id]/v2/FactsheetView.terms.test.tsx
    - src/app/factsheet/[id]/v2/FactsheetView.kpistrip.test.tsx
    - src/app/factsheet/[id]/v2/FactsheetView.volmatched-panel.test.tsx
    - src/app/factsheet/[id]/v2/FactsheetBody.basis.test.tsx
    - src/app/factsheet/[id]/v2/FactsheetBody.joint-floor.test.tsx
    - src/app/factsheet/[id]/v2/FactsheetBody.degenerate.test.tsx
    - src/app/factsheet/[id]/v2/BatchDPanels.tsx
    - src/app/factsheet/[id]/v2/BatchDPanels.ownbook.test.tsx
    - src/app/factsheet/[id]/v2/BatchDPanels.peer-scenario.test.tsx
    - src/app/factsheet/[id]/v2/BatchDPanels.d11.test.tsx
    - src/app/factsheet/[id]/v2/DistributionPanels.tsx
    - src/app/factsheet/[id]/v2/AnalyticalPanels.tsx
    - src/app/factsheet/[id]/v2/MandatePanels.tsx
    - src/app/factsheet/[id]/v2/MandatePanels.scenario.test.tsx
    - src/app/factsheet/[id]/v2/panels.signed-zero.test.tsx
    - src/components/ui/CollapsibleSection.tsx
    - scripts/copy-census/ledgers/plan-09.ts
decisions:
  - "Returns Signatures gets its definition through a new optional `term` prop on CollapsibleSection (Form B, Tooltip around the title text), because the title sits inside a summary and Term would nest a focusable in it."
  - "The 'Returns Signatures' mention inside the Advanced contents sentence is a pinned ledger exception (not a label position); the section's own title carries the definition."
metrics:
  tasks: 3
  completed: 2026-11-11
status: complete
actuals:
  tokens: 16000
  tasks: 3
  commits: 3
plan_head_before: 8724de1ab708bff9ef2d452ffeb07ac6c4a2d03b
plan_head_after: 25a1fdfedfb5cd92d0d346fbfdf95867835af1fa
---

# Phase 201 Plan 09: factsheet panels, KPI strip, constituents Summary

The factsheet's KPI strip and every panel label now open their registry definition, the print view renders every Term plain, "Mandate" no longer names the constituents panel, and BatchDPanels speaks of the allocation with months through `formatMonth`.

This was a resume of an interrupted run. Tasks 1 and 2 were already committed (`0dee3c233`, `2a6aea783`); Task 3 was left as an uncommitted working tree, which this run reviewed, completed, verified and committed (`25a1fdfed`).

## Tasks

| Task | Commit | What |
|------|--------|------|
| 1 (tracer) | `0dee3c233` | Strip labels through Term inside the original `factsheet-kpi-label` `<p>` (test id and first-letter class kept); `PlainTerms` under `printView`; terms test with the print arm |
| 2 | `2a6aea783` | `ConstituentMandatePanel` reads Constituents / "no type or market listed"; BatchDPanels own-book block on the allocation family; `monthYear` through `formatMonth` |
| 3 | `25a1fdfed` | Style Drift rows (separate term member, label stays the React key), K-S name inline Term, percentile labels, Calmar by Year, bootstrap, Volatility Matched, Returns Signatures; ledger to `pending: {}` |

## todos-196-style-drift:

- BatchDPanels.tsx WAS edited by this plan (the trigger file of `196-STYLE-DRIFT-CENSUS-BLIND-01`): `StyleDriftPanel` rows gained a sixth tuple member (the term key); the label is still the React key and the displayed text.
- The factsheet census does NOT read the Style Drift rows: the counter was not changed. `scripts/factsheet-census/count.test.tsx` and `FactsheetBody.census` stay green with no edit.
- The two small-sample notes are unchanged and still render: `style-drift-figure-gate-note` (the figure-gate note) and the `thinHalf` note (a half below 126 days). Neither was edited or removed.

## Neuter record

- `gc-201-09-neuter: gate=FactsheetView.terms.test.tsx (print arm "renders no data-term and no Term tab stop, and still prints the Sharpe label") result=red restored=identical`
  - Neuter: `return printView ? <PlainTerms>{tree}</PlainTerms> : tree;` replaced by `return tree;` on a `cp -p` backup in the scratchpad. RED line: `FAIL |jsdom| FactsheetView.terms.test.tsx > the print view (D-20, U-03) > renders no data-term and no Term tab stop, and still prints the Sharpe label`, `Tests 1 failed | 17 passed (18)`. Restored with `cp -p`; `cmp` exit 0; GREEN below.
  - Note: the interrupted run had left that exact neuter in the working tree (the `PlainTerms` return was reduced to `return tree;`). It was found by reading `git diff` and restored before anything was committed; the committed `FactsheetView.tsx` carries the `printView ? <PlainTerms>` return.

## Verification

- `node scripts/verify-plan-anchors.mjs <canonical 201-09-PLAN.md>`: `claims: 10 checked`, `OK: 1 plan file(s), no stale claims.`, exit 0.
- vitest over the task-3 command's families plus `src/components/ui`: `Test Files 57 passed (57)`, `Tests 915 passed (915)` (FactsheetView, BatchDPanels, DistributionPanels, AnalyticalPanels, SignaturePanels, MandatePanels, StressWindowsPanel, FactsheetBody.census, copy-census, figure-gate-census, factsheet-census/count, figure-parity-pages, components/ui).
- `npx tsx scripts/copy-census/run.ts --ledger plan-09`: no hits listed, exit 0.
- `npx eslint` on the seven touched panel files, CollapsibleSection and the four touched test files: exit 0, no output.
- `npm run typecheck` (`tsc --noEmit`): clean.
- Acceptance: `grep -a -c PlainTerms FactsheetView.tsx` is at least 1; `grep -a -c 'data-testid="factsheet-kpi-label"'` is 1; `grep -a -c Constituents MandatePanels.tsx` is at least 1; `plan-09.ts` has `pending: {}`.
- `gc-201-09-gates: vitest=green eslint=clean tsc=clean`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] CollapsibleSection gained an optional `term` prop**
- **Found during:** Task 3 (Returns Signatures)
- **Issue:** the section title renders inside a `<summary>`, where Term (a focusable) must not nest; `CollapsibleSection.tsx` is not in `files_modified`.
- **Fix:** optional `term?: TermKey` wraps the title text in `Tooltip` with the registry text (Form B); a test asserts nothing focusable is added inside the title. Backward compatible: callers without `term` render as before.
- **Files modified:** `src/components/ui/CollapsibleSection.tsx`
- **Commit:** `25a1fdfed`

**2. [Rule 1 - Bug] Colocated tests read a label as one text node**
- **Found during:** Task 3 verify
- **Issue:** after the Term wrap, `BatchDPanels.d11`, `BatchDPanels.peer-scenario` and `FactsheetView.volmatched-panel` read the label from a single text node and failed (5 + 2 tests).
- **Fix:** the tests now find the Term trigger and read the whole label through it (Term renders label span > Tooltip wrapper > Tooltip inner span > trigger); the volmatched test reads the h3's full text.
- **Files modified:** the three test files above
- **Commit:** `25a1fdfed`

**3. [Pinned exception] one ledger exception**
- `Returns Signatures` in `FactsheetView.tsx` as a section name inside the Advanced contents sentence (not a label position); `pinnedExceptionCount: 1`.

## cross-plan-pins:

None. No test outside this plan's families pinned a changed literal (`grep -a -rn -F` over src, e2e, tests and scripts for the old literals found only this plan's tests, the census count fixture, and the glossary alias, all green).

## reported-not-edited:

None. No phase-200 file was edited.

## Known Stubs

None.

## Threat Flags

None. Display only; definitions come from the registry (T-201-13 mitigated by the per-label registry-text smokes in `FactsheetView.terms.test.tsx`).

## Self-Check: PASSED

- Commits `0dee3c233`, `2a6aea783`, `25a1fdfed` are ancestors of HEAD.
- `FactsheetView.terms.test.tsx`, `plan-09.ts` and this SUMMARY exist in the plan worktree.
