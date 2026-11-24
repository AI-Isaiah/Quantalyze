---
phase: 237-factsheethonest-every-surface-shows-a-strategy-s-true-state
plan: 03
subsystem: factsheet
tags: [factsheet, withheld, worst-10-drawdowns, FACT-01]
requires: []
provides:
  - "HeadlineNoteSlot 'panel' (headlineCoverageNote) with FH237-PANEL-WITHHELD and FH237-PANEL-RECOMPUTING"
  - "PanelWithheldNote component (exported from MetricsColumn.tsx), the single markup source of a withheld panel body"
  - "Worst 10 Drawdowns withheld on a Withheld full-history no-what-if view, at both mount sites"
affects: [237-09, 237-12]
tech-stack:
  added: []
  patterns: ["one verdict decided once in MetricsColumn (wholeRecordWithheld), the panel never calls isHeadlineWithheld"]
key-files:
  created:
    - src/app/factsheet/[id]/v2/MetricsColumn.withheld-panels.test.tsx
  modified:
    - src/app/factsheet/[id]/v2/MetricsColumn.tsx
    - src/app/factsheet/[id]/v2/FactsheetView.headline-coverage.test.tsx
decisions:
  - "The failed cause is handled at the mount (no panel mounted), not inside the panel, so both mount sites share one `worstDrawdownsPanel` element"
  - "No pin moved: copy-census PINNED_EXCEPTION_COUNT and the FactsheetBody.census counter were measured unchanged, so neither file was edited"
metrics:
  duration: "about 40 minutes"
  completed: 2026-11-23
status: complete
actuals:
  tokens: 14000
  tasks: 2
  commits: 1
plan_head_before: 4002cf06e657e1fea49eee74e1048edb2ccad9af
plan_head_after: 55661f321a2913f76ef6a4fc3303d42df345ff3f
---

# Phase 237 Plan 03: Worst 10 Drawdowns withheld panel Summary

On a Withheld full-history view with no what-if, the Worst 10 Drawdowns rail panel keeps its header and replaces its whole body with one amber `panel-withheld-note` paragraph; inside a zoom it keeps its slice. The `"panel"` note slot and the `PanelWithheldNote` component that plan 09 and plan 12 build on now exist.

Agent branch: `worktree-agent-a0ecf245e66e01957`, based on `4002cf06e657e1fea49eee74e1048edb2ccad9af`. Worktree re-based to that sha before any work (verified `git rev-parse HEAD`).

## What changed

- `MetricsColumn.tsx`: `HeadlineNoteSlot` gains `"panel"`. In `headlineCoverageNote`'s withheld arm the panel branch sits before the strip/stripRelative/main early return (recomputing gives FH237-PANEL-RECOMPUTING, failed gives `null`, otherwise FH237-PANEL-WITHHELD with `{R}` from `joinGuardPhrases`). The Dated switch returns `null` for `"panel"`. `PanelWithheldNote` is exported (one `<p data-testid="panel-withheld-note" class="text-fixed-10 italic">`, inline amber colour, glyph prefix, no role or aria). The panel note and the gated element are computed once in `MetricsColumn` next to the two existing gates, and both mounts render the same `worstDrawdownsPanel`. `WorstDrawdownsTablePanel` takes `wholeRecordWithheld` and `note`, keeps its `useWindowedView` call and rows-empty early return first, then renders header plus note instead of the table. The failed cause (gate on, note null) mounts no panel.
- `MetricsColumn.withheld-panels.test.tsx` (new, 31 tests): slot unit cases (exact FH237 strings, one/two/zero/undefined reasons, failed, Dated/clean/non-cash null), component markup, and for each of the two mount sites: full-history note with header plus one child only, no clipping classes on the note or its ancestors, no digit in the body and no title/aria attribute, recomputing sentence, failed omits the panel, a range keeps its slice, empty Worst 10 has no panel; gate off: Dated, held re-run (analyticsUpdating) cell-equal to the settled Dated row, clean, MTM (cash vs MTM on the same payload), what-if leverage.
- `FactsheetView.headline-coverage.test.tsx`: D6 rewritten in place.

## Tests rewritten in place

| Test | Why |
|---|---|
| headline-coverage D6 ("superseded by Phase 237 FACT-01") | It pinned "the Worst 10 table keeps at least one Depth figure" on a Withheld full-history row, which founder ruling Q1 replaces. It now asserts the panel header, exactly one note with the exact FH237 text, zero table rows and no table, with a Dated premise proving the fixture does have Worst 10 rows. |

Nothing outside the five declared files was edited; only three of them needed edits (see Pins). No other case in the headline-coverage file reads Worst 10 on a Withheld full-history row.

## PROOF-01 (byte-backed neuter, RED then GREEN)

Backup `cp MetricsColumn.tsx MetricsColumn.tsx.bak`; restore `cp MetricsColumn.tsx.bak MetricsColumn.tsx`; `cmp` printed `cmp exit 0` after each restore; the `.bak` was deleted and never committed.

**Neuter 1: Worst 10's `wholeRecordWithheld` forced to `false`.** Command: `npx vitest run MetricsColumn.withheld-panels.test.tsx FactsheetView.headline-coverage.test.tsx -t "Worst 10|D6"`. RED, verbatim (failing lines, deduplicated):

```
 × D6 (superseded by Phase 237 FACT-01, founder Q1 2026-11-23): the Worst 10 Drawdowns panel keeps its header and shows the withheld note instead of a table 971ms
 × full history: the header stays and the body is exactly one panel-withheld-note, no table 301ms   (part=all)
 × full history: the header stays and the body is exactly one panel-withheld-note, no table 509ms   (part=detailed)
 × no figure a withheld panel hides reaches the DOM through it: no digit from the table, no title or aria attribute  (both parts)
 × recomputing cause: the same panel carries the FH237-PANEL-RECOMPUTING sentence  (both parts)
 × under mark-to-market the same Withheld payload keeps its table (the verdict describes the cash headline only); under cash it is the note  (both parts)
 × with what-if leverage applied a clean row renders the table and no note; a Withheld row cannot be levered, so it stays withheld at L=2  (both parts)
      Tests  11 failed | 14 passed | 206 skipped (231)
```

**Neuter 2: `wholeRecordWithheld={fullHistoryWithheld}` (the gate that ignores the range).** RED, verbatim:

```
     × inside a selected range the panel keeps its windowed slice table and carries no note 483ms
     × inside a selected range the panel keeps its windowed slice table and carries no note 715ms
      Tests  2 failed | 29 passed (31)
```

**GREEN after both restores (`cmp exit 0`):** `MetricsColumn.withheld-panels.test.tsx` 31 passed; with the headline-coverage file, `Tests  1 failed | 230 passed (231)` once, where the one failure was `a chain-broken row with neither a valid date nor the withheld flag makes no claim (UI-SPEC 1.3 arm 3)` timing out at 5000 ms under machine load (see Deferred). Re-run alone: `Test Files  1 passed (1)  Tests  200 passed (200)`.

## Gates

- `npx vitest run 'src/app/factsheet/[id]/v2' src/__tests__/copy-census.test.ts src/__tests__/degrade-warning-scan.test.ts src/__tests__/figure-gate-census.test.ts --maxWorkers=3`: `Test Files  128 passed (128)  Tests  1808 passed (1808)`.
- `npm run typecheck` (`tsc --noEmit`): exit 0, no output.
- Lint chain run step by step: `eslint src/` 0 errors, 4 pre-existing warnings (none introduced here; `nativeUnitReason`, `isRankableAnalyticsRow`, `WARNED_ROW`, `COMPUTING_ROW` unused vars in files this plan did not change or in lines it did not touch); `check-admin-route-manifest`, `check-route-contract`, `check-planning-hygiene` and `check-canonical-domain` all OK. The eslint step ran without `--cache` so as not to write into the shared node_modules cache of the symlinked checkout.

## Pins

No pin moved, so neither pin file was edited. `copy-census.test.ts` (PINNED_EXCEPTION_COUNT 36) and `FactsheetBody.census.test.tsx` passed untouched in the run above: the two FH237 sentences trip none of rules A, B or C, and no `FactsheetBody.census` fixture is a Withheld row (RESEARCH A3 holds). MetricsColumn.parts, MetricsColumn.headline-bench, FactsheetView.window-kpis and MetricsColumn.no-loss-residues stayed green untouched.

## Deviations from Plan

None - plan executed as written. Task 2 produced no file edit and therefore no commit (it was a measurement task whose only edit trigger, a moved pin, did not occur).

### Notes

- What-if leverage: `leverageEligibleFor` excludes chain-broken rows, so leverage can never apply to a Withheld row. The "what-if leverage applied (gate off)" case is therefore exercised on a clean row at L=2 (table renders, no note), and a second assertion pins that a Withheld row at L=2 stays withheld. The leverage term in the gate is provably false there, as the existing comment in MetricsColumn says.
- The Worst 10 empty edge is pinned with `strategyWorst10: []` on a Withheld row (no header, no note).

## Deferred Issues

Under a default-parallel run of the factsheet directory, nine existing FactsheetBody-level tests across four files (`FactsheetBody.basis`, `FactsheetView.headline-coverage`, `FactsheetView.kpistrip`, `FactsheetView.window-kpis`) timed out at the 5000 ms default (5.0 to 7.3 s). Re-running the same four files with `--maxWorkers=2`, and the whole set with `--maxWorkers=3`, passed 315/315 and 1808/1808. This is machine load on a parallel run, not behaviour; no test was edited for it.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema surface; the change only withholds figures (T-237-05 mitigated: the whole body is replaced, a test asserts no table, no digit in the body and no title/aria attribute, and gate-off renders are cell-equal to the settled render).

## Self-Check: PASSED

- `src/app/factsheet/[id]/v2/MetricsColumn.withheld-panels.test.tsx` present; `MetricsColumn.tsx` contains `export function PanelWithheldNote`, `"panel"` and `panel-withheld-note`.
- Commit `55661f321` is an ancestor of HEAD.
