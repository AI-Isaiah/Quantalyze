---
phase: 252-deribitoptions-a-deribit-options-strategy-s-published-figure
plan: 02
subsystem: factsheet
tags: [headline-verdict, options-book, trailing-windows, selected-range, leverage, proof-01]
requires: ["252-01"]
provides:
  - "isRangeWithheld: the one withhold that also holds inside a selected range (options cause, cash basis)"
  - "trailing windows withheld for any withheld headline (window gate reads headlineWithheld alone)"
  - "headlineBenchSource, windowCoverageNote, the rail gate and KpiStrip honouring the options cause at full history and inside a range"
  - "leverageEligibleFor excluding a withheld headline"
  - "options toggle copy that no longer says the strategy reports its cash basis"
affects: [252-03, 252-04, 252-05]
status: complete
commits: 4
plan_head_before: 3ed0bfaaf3b22ae0e85c385bcc31ead0aa2617fc
plan_head_after: ba708b40d670e7ef8a3a3679064a65c7ecc7b887
actuals:
  tokens: 11391
  tasks: 3
  commits: 4
tech-stack:
  added: []
  patterns:
    - "one predicate (isRangeWithheld) owns the range-scope withhold; strip, rail, bench cells and note all call it"
key-files:
  created: []
  modified:
    - src/lib/factsheet/build-payload.ts
    - src/app/factsheet/[id]/v2/MetricsColumn.tsx
    - src/app/factsheet/[id]/v2/FactsheetView.tsx
    - src/app/factsheet/[id]/v2/basis-context.tsx
    - src/lib/factsheet/build-payload.headline-source.test.ts
    - src/app/factsheet/[id]/v2/MetricsColumn.headline-bench.test.tsx
    - src/app/factsheet/[id]/v2/FactsheetView.withheld-renderings.test.tsx
    - src/app/factsheet/[id]/v2/FactsheetView.window-kpis.test.tsx
    - src/app/factsheet/[id]/v2/MetricsColumn.withheld-panels.test.tsx
    - src/app/factsheet/[id]/v2/basis-context.test.tsx
    - src/app/factsheet/[id]/v2/basis-context.leverage.test.tsx
    - src/app/factsheet/[id]/v2/FactsheetBody.basis.test.tsx
key-decisions:
  - "isRangeWithheld is the options cause only: a chain-broken Withheld row of any other cause keeps D-78's slice figures inside a range (orchestrator decision 2026-11-25, W3)."
  - "The rail's seven headline rows (Cumulative Return through Calmar, Max Drawdown) get their own dash for the options cause inside a range, because at full history they are dashed by the read path's nulls and not by the rail's wr gate."
requirements-completed: []
---

# Phase 252 Plan 02: the options-book withhold across the rest of the factsheet Summary

A withheld options book on an intact chain is now withheld everywhere a chain-broken Withheld row already is: the seven trailing windows, the headline benchmark cells and the rail panels, and (decision W3) inside a selected range, where the strip, the rail and the note name the cash-wallet measurement in muted text. The leverage what-if is not offered for any withheld headline, and the mark-to-market toggle sentence is true beside it. No stored value changes.

## What was built

- **Task 1 (tracer), commit `478f8e80a`.** `build-payload.ts`: the `withSuffixWindows` argument is `opts?.dataQuality?.headlineWithheld === true` (the `twrChainBroken` conjunct is gone), docblock extended. `MetricsColumn.tsx`: new exported `isRangeWithheld(dataQuality, basis)` (`isHeadlineWithheld` and cause equals `OPTIONS_CASH_WALLET_CAUSE`); `headlineBenchSource` returns null for it at full history and in a range, before the existing `selected` / chain-broken early return.
- **Task 2, commit `3facf9ecd`.** `leverageEligibleFor` gains `payload.dataQuality?.headlineWithheld !== true` with a docblock bullet. The options case of `mtmDisabledReasonCopy` now reads: "Mark-to-market unavailable: this strategy's open option positions are not valued at market prices, so its headline figures measured on the cash wallet are withheld." Steady tone unchanged, no flag name.
- **Task 3, commit `e64308dc4`.** `windowCoverageNote` answers the options cause first (variant `structural`, `OPTIONS_CASH_WALLET_PHRASES.range`), before the chain-broken early return. The rail's one gate is `wholeRecordWithheld = fullHistoryWithheld && (!selected || isRangeWithheld(...))`. `KpiStrip` computes `rangeWithheld`, dashes the seven cells (no tone) and widens `relativeWithheld` so alpha and IR dash too. Charts are not edited and still draw.
- **Comment-only follow-up, commit `ba708b40d`.** Reworded the options-toggle comment so the old sentence is not quoted (the plan's acceptance grep for it expects 0).

## RED runs (before the source edit, verbatim FAIL lines, prefixes shortened)

Task 1, on the plan 252-01 tree (new cases only; the options-cause secondary renderings, the muted note and the chain-broken control already passed on that tree because plan 01 wired the panel slots):

```
 FAIL  build-payload.headline-source.test.ts > ... > 252: the withheld flag alone withholds all seven windows, with no chain break on the payload
 FAIL  MetricsColumn.headline-bench.test.tsx > 252 ... > headlineBenchSource: null for the cause on the cash basis at full history, with or without a chain break
 FAIL  MetricsColumn.headline-bench.test.tsx > 252 ... > headlineBenchSource: null for the cause inside a selected range too (W3)
 FAIL  MetricsColumn.headline-bench.test.tsx > 252 ... > isRangeWithheld: true only for the options cause on the cash basis
 FAIL  MetricsColumn.headline-bench.test.tsx > 252 ... > the rendered rail: every headline benchmark cell reads the em-dash on an intact chain
 FAIL  MetricsColumn.headline-bench.test.tsx > 252 ... > the rendered rail: the strategy's trailing windows read the em-dash beside them
 FAIL  MetricsColumn.headline-bench.test.tsx > 252 ... > the rendered rail inside a selected range: the benchmark cells read the em-dash too
 FAIL  FactsheetView.withheld-renderings.test.tsx > 252 ... > premise: the payload carries no chain break, and its trailing windows are nulled by the builder
 FAIL  FactsheetView.withheld-renderings.test.tsx > 252 ... > the strip's seven cells and the rail's trailing windows read the dash
   (received: mtd 0.009071786791575276 where null was expected; Year-to-date '-8.36%' where '—' was expected)
```

Task 2, on the Task 1 tree:

```
 FAIL  basis-context.leverage.test.tsx > 252 leverageEligibleFor ... > a single-key payload with a withheld headline and NO chain break is ineligible
 FAIL  basis-context.test.tsx > Test 6 — mtmDisabledReasonCopy is a closed set ...
 FAIL  FactsheetBody.basis.test.tsx > MTM gate = server truth (RED): ... aria-disabled with EXACT reason copy
```

Task 3, on the Task 2 tree:

```
 FAIL  FactsheetView.window-kpis.test.tsx > 252 ... > windowCoverageNote: the structural range sentence ... (expected null to deeply equal { variant: 'structural', ... })
 FAIL  FactsheetView.window-kpis.test.tsx > 252 ... > the strip: the seven cells and alpha and IR read the dash ... (Cum. Return: expected '+23.5%' to be '—')
 FAIL  FactsheetView.window-kpis.test.tsx > 252 ... > the strip: no cell carries a tone inside the range
 FAIL  MetricsColumn.withheld-panels.test.tsx > 252 ... > Main Metrics: the figures the rail dashes at full history read the em-dash inside a range (Cumulative Return: expected '-3.54%' to be '—')
 FAIL  MetricsColumn.withheld-panels.test.tsx > 252 ... > Worst 10 Drawdowns inside a range, part=all: the muted options note replaces the table
 FAIL  MetricsColumn.withheld-panels.test.tsx > 252 ... > Worst 10 Drawdowns inside a range, part=detailed: the muted options note replaces the table
 Test Files  2 failed (2)   Tests  7 failed | 128 passed (135)   (one more failure was a test-authoring premise, fixed before the source edit: Max Drawdown is its own panel)
```

## PROOF-01 (verbatim)

Every neuter was made on a copy backed up byte-for-byte, restored with `cp`, proven with `cmp` (exit 0), then re-run GREEN. Output is the vitest FAIL and summary lines (describe prefixes shortened).

### Windows: the `twrChainBroken` conjunct put back in `build-payload.ts`

```
 FAIL  build-payload.headline-source.test.ts > ... > 252: the withheld flag alone withholds all seven windows, with no chain break on the payload
 FAIL  FactsheetView.withheld-renderings.test.tsx > 252 ... > premise: the payload carries no chain break, and its trailing windows are nulled by the builder
 FAIL  FactsheetView.withheld-renderings.test.tsx > 252 ... > the strip's seven cells and the rail's trailing windows read the dash
 FAIL  MetricsColumn.headline-bench.test.tsx > 252 ... > the rendered rail: the strategy's trailing windows read the em-dash beside them
 Test Files  3 failed (3)
      Tests  4 failed | 78 passed (82)
cmp exit 0
 Test Files  3 passed (3)
      Tests  82 passed (82)
```

### Bench: the withheld tests removed from `headlineBenchSource` (both the `isRangeWithheld` line and the `headlineWithheld === true` line)

```
 FAIL  MetricsColumn.headline-bench.test.tsx > a Withheld row: no measured span, so the headline benchmark cells read the em-dash (B19) > every headline benchmark cell is the em-dash
 FAIL  MetricsColumn.headline-bench.test.tsx > 252 ... > headlineBenchSource: null for the cause on the cash basis at full history, with or without a chain break
 FAIL  MetricsColumn.headline-bench.test.tsx > 252 ... > headlineBenchSource: null for the cause inside a selected range too (W3)
 FAIL  MetricsColumn.headline-bench.test.tsx > 252 ... > headlineBenchSource: a chain-broken Withheld row of another cause keeps its range behaviour (summary in a range)
 FAIL  MetricsColumn.headline-bench.test.tsx > 252 ... > the rendered rail: every headline benchmark cell reads the em-dash on an intact chain
 FAIL  MetricsColumn.headline-bench.test.tsx > 252 ... > the rendered rail inside a selected range: the benchmark cells read the em-dash too
 Test Files  1 failed | 1 passed (2)
      Tests  6 failed | 47 passed (53)
cmp exit 0
 Test Files  1 passed (1)
      Tests  24 passed (24)
```

### Leverage: the `headlineWithheld` conjunct removed from `leverageEligibleFor`

```
 FAIL  basis-context.leverage.test.tsx > 252 leverageEligibleFor — a withheld headline is leverage-ineligible > a single-key payload with a withheld headline and NO chain break is ineligible
 Test Files  1 failed (1)
      Tests  1 failed | 16 passed (17)
cmp exit 0
 Test Files  1 passed (1)
      Tests  17 passed (17)
```

### Range note: the options arm of `windowCoverageNote` removed

```
 FAIL  FactsheetView.window-kpis.test.tsx > 252 ... > windowCoverageNote: the structural range sentence for any range start on the cash basis, none off it
 FAIL  FactsheetView.window-kpis.test.tsx > 252 ... > the strip: the seven cells and alpha and IR read the dash, and one muted range note names the reason
 Test Files  1 failed | 1 passed (2)
      Tests  2 failed | 133 passed (135)
cmp exit 0
```

### Strip: `rangeWithheld` set to `false` in `KpiStrip`

```
 FAIL  FactsheetView.window-kpis.test.tsx > 252 ... > the strip: the seven cells and alpha and IR read the dash, and one muted range note names the reason
 FAIL  FactsheetView.window-kpis.test.tsx > 252 ... > the strip: no cell carries a tone inside the range
 Test Files  1 failed | 1 passed (2)
      Tests  2 failed | 133 passed (135)
cmp exit 0
```

### Rail: `wholeRecordWithheld` put back to `!selected && fullHistoryWithheld`

```
 FAIL  MetricsColumn.withheld-panels.test.tsx > 252 ... > Worst 10 Drawdowns inside a range, part=all: the muted options note replaces the table
 FAIL  MetricsColumn.withheld-panels.test.tsx > 252 ... > Worst 10 Drawdowns inside a range, part=detailed: the muted options note replaces the table
 Test Files  1 failed (1)... (window-kpis + withheld-panels run: 1 failed | 1 passed, Tests 2 failed | 133 passed)
cmp exit 0
```

### Rail headline rows: the `rw` dash made an identity function

```
 FAIL  MetricsColumn.withheld-panels.test.tsx > 252 ... > Main Metrics: the figures the rail dashes at full history read the em-dash inside a range
 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 134 passed (135)
cmp exit 0
```

After the last restore (window-kpis + withheld-panels): `Test Files  2 passed (2)`, `Tests  135 passed (135)`.

## Verification

- `npm run typecheck`: clean.
- `npm run lint`: 0 errors, 4 warnings, the same four unused-symbol warnings plan 01 recorded (`nativeUnitReason`, `isRankableAnalyticsRow`, `WARNED_ROW`, `COMPUTING_ROW`); none is from a line this plan added.
- `node scripts/verify-plan-anchors.mjs --pending`: `OK: 18 plan file(s), no stale claims.`
- `npx vitest run 'src/app/factsheet/[id]/v2' src/lib/factsheet`: `Test Files 1 failed | 195 passed (196)`, `Tests 2 failed | 3656 passed (3658)`. The two failures are `src/lib/factsheet/compute.conventions.test.ts` fixtures B and C, the known Node 25 versus CI Node 22 float difference; not touched.
- Acceptance greps: all eight read the expected value (windows conjunct 0, new conjunct 1, `isRangeWithheld` export 1, leverage conjunct 1, old toggle wording 0, `OPTIONS_CASH_WALLET_PHRASES.range` 1, old rail gate 0, `isRangeWithheld(` in `FactsheetView.tsx` 1).
- The tasks' own verify commands were each run as part of the above (Task 1's five files, Task 2's four files, Task 3's four files): all green.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] An existing case pinned the dropped conjunct**
- **Found during:** Task 1
- **Issue:** `build-payload.headline-source.test.ts`, "WR-01: the withheld flag without twrChainBroken sets nothing", asserted that `headlineWithheld: true` with no chain break leaves the windows alone. That is exactly the conjunct the plan removes, and the read path never produced that state before plan 01.
- **Fix:** replaced it with a clean-row control plus two 252 cases (the flag alone withholds all seven windows and nothing else moves; the cause withholds with a broken chain too). Intent kept: a clean row is never withheld.
- **Files modified:** `src/lib/factsheet/build-payload.headline-source.test.ts`
- **Commit:** `478f8e80a`

**2. [Rule 1 - Bug] A second test hand-typed the old toggle sentence**
- **Found during:** Task 2
- **Issue:** the plan said `FactsheetBody.basis.test.tsx` compares against the function's own output and needs no edit. Its "MTM gate = server truth" case actually pins the old sentence literally.
- **Fix:** updated that literal to the new sentence (file is outside the plan's `files_modified`; the plan's own verify command runs it).
- **Files modified:** `src/app/factsheet/[id]/v2/FactsheetBody.basis.test.tsx`
- **Commit:** `3facf9ecd`

**3. [Rule 2 - Missing critical functionality] The rail's seven headline rows needed their own range dash**
- **Found during:** Task 3
- **Issue:** the plan names only the one rail gate (`wholeRecordWithheld`). But Main Metrics' Cumulative Return, CAGR, Ann. Volatility, Sharpe, Sortino, Calmar and the Max Drawdown row are dashed at full history by the read path's nulls, not by that gate, and inside a range they read the windowed slice. Without a dash there the rail printed slice figures for this cause, contradicting the plan's own truth ("every rail figure the rail dashes at full history").
- **Fix:** one local helper `rw` in `MetricsColumn`, on the same `isRangeWithheld` verdict, applied to those seven rows. No second verdict was added; chain-broken, smoothed and clean rows are unchanged (controls pass).
- **Files modified:** `src/app/factsheet/[id]/v2/MetricsColumn.tsx`
- **Commit:** `e64308dc4`

### Plan expectation corrected

The plan says to paste RED output for the whole options-cause body on the plan 01 tree. Most secondary renderings (End-of-Year chart, Monthly Returns YTD column, Worst 10 chart, the muted note) were already GREEN there, because plan 01 wired the `panel` slot through `headlineCoverageNote`. The RED cases are the trailing windows, the benchmark cells and the range behaviour. The green ones remain as regression pins.

### Commit trailers

The harness attribution reminder asks for Co-Authored-By and Claude-Session trailers. The plan's project rules and the founder's standing rule say no AI attribution trailers, so none were added (the first commit attempt with trailers was refused by the permission layer; the commits as made carry none).

## Known limits

- The smoothed-basis carve-out is proven at function level (`isRangeWithheld`, `headlineBenchSource`, `windowCoverageNote` return the non-withheld answer off the cash basis) and on the rail under mark-to-market (table and figures kept). No rendered smoothed-basis body case was added: it needs a smoothed bundle fixture, and the gates are the same functions. The founder visual check stays with `/gsd-verify-work`.
- Inside a range the strip may still print its short-track or paired-floor notes beside the options sentence, as it already does at full history for Withheld rows. Not changed.
- The comment above the options case in `mtmDisabledReasonCopy` still describes why the reason is composite-only; that analysis is untouched.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema surface. T-252-05 (leverage what-if fabrication) is mitigated by the `leverageEligibleFor` conjunct and its RED/GREEN proof; T-252-06 (artefact range figures) is mitigated by `isRangeWithheld` on the strip, the rail gate and the benchmark cells, each with PROOF-01.

## Self-Check: PASSED

- Commits `478f8e80a`, `3facf9ecd`, `e64308dc4`, `ba708b40d` are reachable from HEAD; `commits: 4` was measured from the persisted ledger (`plan_head_before` to HEAD, before this SUMMARY's own commit).
- All 12 files under `key-files.modified` exist and are in those four commits.
- STATE.md, state.json and ROADMAP.md were not touched.
