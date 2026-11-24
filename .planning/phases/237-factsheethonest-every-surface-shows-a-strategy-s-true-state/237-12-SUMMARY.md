---
phase: 237-factsheethonest-every-surface-shows-a-strategy-s-true-state
plan: 12
subsystem: factsheet
tags: [factsheet, withheld, eoy-returns, calmar-by-year, style-drift, FACT-01]
requires: [237-03]
provides:
  - "EOY Returns, Calmar by Year and Style Drift withheld on a Withheld full-history view, at both mount sites and inside a zoom"
  - "CalmarByYearPanel and StyleDriftPanel optional withheldBody prop (no MetricsColumn import)"
affects: [237-09]
tech-stack:
  added: []
  patterns: ["one verdict decided once in MetricsColumn (fullHistoryWithheld + panelNote); panels receive the note body as a prop"]
key-files:
  modified:
    - src/app/factsheet/[id]/v2/MetricsColumn.tsx
    - src/app/factsheet/[id]/v2/AnalyticalPanels.tsx
    - src/app/factsheet/[id]/v2/BatchDPanels.tsx
    - src/app/factsheet/[id]/v2/MetricsColumn.withheld-panels.test.tsx
    - src/app/factsheet/[id]/v2/FactsheetView.headline-coverage.test.tsx
    - src/app/factsheet/[id]/v2/panels.signed-zero.test.tsx
decisions:
  - "Full rail keeps its unconditional Style section (MetricsColumn.numerals pins part=all as always mounting Style), so the failed-arm omission of the empty numbered heading applies to part=detailed only; on part=all the heading renders exactly as it already does for a strategy with no Style Drift"
status: complete
actuals:
  tokens: 26000
  tasks: 3
  commits: 1
plan_head_before: 73d18d712b56f0d60f79e11db00df31cf6f19856
plan_head_after: 4ca7c3c029c45c4682dbcab5f572559ea55db5f3
---

# Phase 237 Plan 12: EOY Returns, Calmar by Year and Style Drift withheld panels Summary

On a Withheld full-history view, EOY Returns, Calmar by Year and Style Drift keep their header and replace their whole body with the one amber `panel-withheld-note` from plan 03, inside a zoom as well, with no year row, no KS sentence and no half-dates subline. The failed cause omits all three (and the detailed part's Style section).

Agent branch: `worktree-agent-adef86d983f6516fb`, re-based to `73d18d712b56f0d60f79e11db00df31cf6f19856` before any work (verified).

## What changed

- `MetricsColumn.tsx`: next to plan 03's gates, `wholeRecordPanelOmitted = fullHistoryWithheld && panelNote === null` and `wholeRecordPanelNote = fullHistoryWithheld ? panelNote : null`. Three elements (`eoyReturnsPanel`, `calmarByYearPanel`, `styleDriftPanel`) are built once and used at both mounts. `EoyReturnsPanel` takes `withheldNote` instead of `fullHistoryWithheld`; when set it renders the Panel header with its scope note (no comparator bench header) and `PanelWithheldNote`. The last-year dash is gone. The detailed Style section condition is `(hasStyleDrift && !wholeRecordPanelOmitted) || scenarioMode`.
- `AnalyticalPanels.tsx`: `CalmarByYearPanel({ withheldBody })` renders its own header and ScopeNote with `withheldBody` as the only body (after its own no-rows null check). `fullHistoryWithheld`, `lastYear` and the `dashed` cells are removed. No import of MetricsColumn.
- `BatchDPanels.tsx`: `StyleDriftPanel({ withheldBody }: ... = {})` renders header only (no half-dates subline) plus the body. Optional, so `BatchDPanels.d11.test.tsx` (no props) is unchanged and green. No import of MetricsColumn.

## Tests rewritten in place (all named in the plan)

| Test | Why |
|---|---|
| headline-coverage D1, D4 | pinned "every row except the last keeps its figure"; now assert the header, zero year rows, no table, exactly one note (Dated premise proves the fixture has year rows) |
| headline-coverage WR-01 | pinned the last-year em-dash cells; now keeps the clean-row premise (last year = YTD digits) and asserts no row, one note on a Withheld row |
| headline-coverage R3-WR-01 | pinned dashed last-year cells inside a zoom; now asserts the note, no rows and the Full history scope note in a zoom |
| headline-coverage "scope" describe, rail half | `readCopies` `eoy` and `calmar` read `{ lastRow, notes }` (lastRow null on a Withheld cash row); the cash, MTM and zoom cases assert note vs row. The chart half (`barTexts`, `heatYtd`, `avg`) is untouched (plan 09) |
| panels.signed-zero | dropped the removed `fullHistoryWithheld={false}` attribute from the Calmar mount, nothing else |
| withheld-panels (plan 03's own) "empty edge" Worst 10 | asserted zero notes in the whole container; that is now three (the other panels' notes), so it asserts three and the absence of a Worst 10 section |

MetricsColumn.no-loss-residues, BatchDPanels.d11, MetricsColumn.parts, MetricsColumn.headline-bench and FactsheetView.window-kpis stayed green untouched. The copy-census, degrade-warning-scan and figure-gate-census pins did not move; no FactsheetBody.census fixture is a Withheld row (RESEARCH A3 holds).

New cases (`MetricsColumn.withheld-panels.test.tsx`, 97 tests now): per panel and per mount site, full-history note shape, no-digit/no-title/no-aria/no-footnote read, recomputing cause, failed omission, range keeps it withheld (with scope note where the panel has one), and gate-off equality for a Dated row, a held re-run (cell-equal to settled), a clean row, MTM and what-if leverage. Plus: EOY drops the comparator, no-years panels stay absent, Style Drift KS and half-dates present on Dated and absent on Withheld, and the failed-arm detailed numbering equals the same payload with `styleDrift: null`.

## PROOF-01 (byte-backed neuter, RED then GREEN)

Backup `cp MetricsColumn.tsx <scratchpad>/MetricsColumn.tsx.bak` (outside the repo); each neuter was undone with `cp` from the backup and `cmp` printed `cmp exit 0` before the next one; the working file ended byte-equal to the backup, and the backup was never committed.

**Neuter 1: EOY Returns gate off (`withheldNote={null}`).** `npx vitest run MetricsColumn.withheld-panels.test.tsx FactsheetView.headline-coverage.test.tsx -t "EOY Returns|D1"`. RED, verbatim (failing lines):

```
 × D1 (superseded by Phase 237 FACT-01, Q2): EOY Returns keeps its header and prints the withheld note, with no year row at all 1274ms
 × full history: the header stays and the body is exactly one panel-withheld-note, no table and no year row  (part=all and part=detailed)
 × gate off, mark-to-market: the same Withheld payload keeps its table; under cash it is the note  (both parts)
 × gate off, what-if leverage on a clean row: the table renders; a Withheld row cannot be levered and stays withheld  (both parts)
 × inside a selected range the panel stays withheld (it shows the whole record), and keeps its scope note where it has one  (both parts)
 × no figure the panel hides reaches the DOM through it: no digit in the body, no title or aria attribute, no footnote  (both parts)
 × recomputing cause: the FH237-PANEL-RECOMPUTING sentence  (both parts)
 × the withheld EOY Returns panel drops the vs-comparator bench header and the comparator column 658ms
      Tests  14 failed | 9 passed | 274 skipped (297)
```

**Neuter 2: Calmar by Year gate off (`withheldBody={undefined}`).** `-t "Calmar by Year|D4|WR-01"`. RED, verbatim:

```
 × D4 (superseded by Phase 237 FACT-01, Q2): Calmar by Year keeps its header and prints the withheld note, with no year row at all 1122ms
 × full history: the header stays and the body is exactly one panel-withheld-note, no table and no year row  (both parts)
 × gate off, mark-to-market ... / gate off, what-if leverage ... / inside a selected range ... / no figure the panel hides ... / recomputing cause  (both parts each)
 × R3-WR-01 (superseded by Phase 237 FACT-01, Q2): inside a zoom both panels stay withheld and keep their Full history scope note, because both show the whole record 2067ms
 × WR-01 (superseded by Phase 237 FACT-01, Q2): the old last-year dash is gone; on a clean row the last year still carries the Year-to-date digits, on a Withheld row neither panel prints a row 957ms
      Tests  15 failed | 10 passed | 272 skipped (297)
```

**Neuter 3: EOY gated on `wholeRecordWithheld` instead (`withheldNote={selected ? null : wholeRecordPanelNote}`).** `-t "EOY Returns|R3-WR-01|zoom"`. RED, verbatim:

```
 × inside a selected range the panel stays withheld (it shows the whole record), and keeps its scope note where it has one  (part=all and part=detailed)
 × inside a zoom the full-history copies stay dashed on a Withheld row (they show the whole record there too) 2710ms
 × R3-WR-01 (superseded by Phase 237 FACT-01, Q2): inside a zoom both panels stay withheld and keep their Full history scope note, because both show the whole record 1237ms
      Tests  4 failed | 23 passed | 270 skipped (297)
```

**Neuter 4: Style Drift gate off (`<StyleDriftPanel />`).** `-t "Style Drift"`. RED, verbatim:

```
 × full history: the header stays and the body is exactly one panel-withheld-note, no table and no year row  (both parts)
 × part=all: a Dated row prints the KS sentence and the half-dates subline; a Withheld row prints neither 684ms
 × part=detailed: a Dated row prints the KS sentence and the half-dates subline; a Withheld row prints neither 451ms
 (plus gate-off MTM, leverage, range, no-figure and recomputing cases, both parts each)
      Tests  14 failed | 10 passed | 73 skipped (97)
```

**Neuter 5: detailed Style condition reverted to `(hasStyleDrift || scenarioMode) && {`.** `-t "failed-arm"`. RED, verbatim:

```
 × detailed part, failed cause: no Style heading renders, and the numbering is exactly that of a strategy with no Style Drift 852ms
AssertionError: expected '§I Performance|§II Risk|§III Style|§I…' not to match /Style/
      Tests  1 failed | 3 passed | 93 skipped (97)
```

**Import-cycle guard (grep acceptance).** On the real files `grep -a -c -F 'from "./MetricsColumn"'` (comments stripped) is `0` for AnalyticalPanels.tsx and BatchDPanels.tsx; on scratch copies with the mutation line appended (`import { headlineCoverageNote } ...` / `import { PanelWithheldNote } ...`) it is `1` and `1`. `withheldBody` counts: 3 and 3 (>= 2). `fullHistoryWithheld && r.year === lastYear` count: 0 (HEAD was 1).

**GREEN after the final restore (`cmp exit 0`):** `MetricsColumn.withheld-panels`, `FactsheetView.headline-coverage`, `panels.signed-zero`, `MetricsColumn.no-loss-residues`, `BatchDPanels.d11` together: `Test Files  5 passed (5)  Tests  355 passed (355)`.

## Gates

- `npx vitest run 'src/app/factsheet/[id]/v2' src/__tests__/copy-census.test.ts src/__tests__/degrade-warning-scan.test.ts src/__tests__/figure-gate-census.test.ts --maxWorkers=3`: `Test Files  1 failed | 127 passed (128)  Tests  1 failed | 1877 passed (1878)`. The one failure, `FactsheetBody.advanced.test.tsx` "writes 'open' and 'closed' under the registered factsheet-collapse: key on a toggle" (2824 ms), is load timing on a shared machine: re-run alone it is `Test Files  1 passed (1)  Tests  26 passed (26)`. That file reads nothing this plan changed.
- `npm run typecheck`: no output (exit 0).
- Lint chain, step by step: `eslint src/app/factsheet` (no `--cache`): 0 errors, 1 pre-existing warning (`nativeUnitReason` unused, MetricsColumn.tsx line 14, not mine); `check-admin-route-manifest`, `check-route-contract`, `check-planning-hygiene`, `check-canonical-domain` all OK.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Plan 03's own Worst 10 "empty edge" case counted notes across the whole container**
- **Found during:** Task 2 first run (2 failures, both parts)
- **Issue:** it asserted zero `panel-withheld-note` in the container; with the three new panels each carrying their note the count is 3 by design
- **Fix:** asserts the absence of a Worst 10 section and exactly the three other notes
- **Files modified:** MetricsColumn.withheld-panels.test.tsx (a declared file)

### Process note

Tasks 1 and 2 edit the same lines of MetricsColumn.tsx and the same test file, and `git add -p` is unavailable, so they are one commit (`4ca7c3c02`) rather than one per task. Task 3 needed no edit (no further test went red), so it has no commit of its own.

### Decision

Full rail (`part="all"`) keeps its unconditional Style section: `MetricsColumn.numerals.test.tsx` pins that `all` always mounts Style, so a no-Style-Drift strategy already renders an empty numbered heading there. On the failed cause the full rail therefore renders the same heading with no Style Drift panel, which is exactly its existing no-Style-Drift form. The plan's own wording ("if Style Drift is its only possible child ... apply the same condition, otherwise leave it") was resolved against that pin.

## Known Stubs

None.

## Threat Flags

None. T-237-21 mitigated: the whole body is replaced; tests assert no year row, no table, no digit in the body, no title or aria attribute and no KS sentence, at full history and inside a zoom, and gate-off renders are unchanged.

## Self-Check: PASSED

- All six modified files present; `withheldBody` in AnalyticalPanels.tsx and BatchDPanels.tsx; `withheldNote` in MetricsColumn.tsx.
- Commit `4ca7c3c02` is an ancestor of HEAD.
