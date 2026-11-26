---
phase: 252-deribitoptions-a-deribit-options-strategy-s-published-figure
plan: 04
subsystem: discovery-lists
tags: [options-book, shapeRowAnalytics, percentile, discovery, holdings, proof-01]
requires: ["252-01", "252-03"]
provides:
  - "StrategyAnalytics.headline_withheld_cause: the shaped marker on a row blanked for the options-book withhold"
  - "StrategyAnalytics.mtm_gated_reason, last_success_mtm_gated_reason: alias inputs, deleted before a shaped row leaves queries.ts"
  - "effectiveListFlag (queries.ts, private): the one generation pick for list flags"
  - "PERCENTILE_WITHHOLD_COLUMNS: the percentile reads' generation alias inputs"
  - "OwnCapitalStrategy.figure_withheld_by and the dashboard book legs' figure_withheld_by"
  - "gatedSharpe withholds the Holdings Sharpe on the marker"
affects: [252-05]
status: complete
commits: 3
plan_head_before: 2a90422830f89e432c1dcad95a36dad57d24a71e
plan_head_after: 22a6f006a209a7b0dcb73d7f0a4ce1d0650f742b
actuals:
  tokens: 19484
  tasks: 3
  commits: 3
tech-stack:
  added: []
  patterns:
    - "one private helper owns the snapshot-aware flags generation pick for every list flag; the census counts do not move"
    - "a structural withhold on the list shape is a named marker (absence is the convention) that the table, the record and the percentile reads key on"
key-files:
  created:
    - src/lib/queries.options-withhold.test.ts
    - src/components/strategy/StrategyTable.options-withhold.test.tsx
  modified:
    - src/lib/queries.ts
    - src/lib/types.ts
    - src/components/strategy/annualized-cell.tsx
    - src/components/strategy/StrategyTable.tsx
    - src/app/(dashboard)/allocations/lib/strategies-row-adapter.ts
    - src/lib/queries.test.ts
    - src/lib/queries.percentile-columns.test.ts
    - src/lib/queries.my-allocation.test.ts
    - src/app/(dashboard)/allocations/lib/strategies-row-adapter.test.ts
    - src/app/(dashboard)/allocations/components/HoldingsTable.figure-gate.test.tsx
    - src/app/(dashboard)/allocations/components/HoldingsTable.strategy-rows.test.tsx
key-decisions:
  - "A row carrying the marker is held out of the table's series-verdict map, so a blank series_end (blank BECAUSE of the withhold) never reads as 'the data date could not be read'; the rank cell then names the withheld sentence. The plan's wording was 'when no stale-series reason applies'; the effect is the same for every row that has a verdict, and the marker row never has one."
  - "getOwnCapitalStrategies resolves the reason on the live flags (its projection carries no computed_at, shared with MT5 parity surfaces); a case pins that a bound-looking snapshot alone does not mark the row."
requirements-completed: []
---

# Phase 252 Plan 04: Discovery, owner lists, percentiles and book legs honour the options-book withhold Summary

A row whose effective flags carry `mtm_gated_reason === "unsmoothed_options_book"` now leaves the list shaper blank and marked, takes no `#n` and no percentile, and its cells name the cash-wallet reason; its book leg carries `figure_withheld_by` to the Scenario composer and the Holdings Sharpe. No migration, no RPC change, no stored value changes.

## What was built

- **Task 1 (tracer), commit `959df7bc0`.** `CATEGORY_RANKING_ANALYTICS_COLUMNS` gains the two `->>` text aliases (`mtm_gated_reason`, `last_success_mtm_gated_reason`); `queries.test.ts` pins the exact set, the allowed forms and a new two-alias case. `effectiveListFlag(a, key)` generalises `shapedNativeUnit`'s generation pick for `native_unit` and `mtm_gated_reason`; `shapedNativeUnit` calls it, so the unit is byte-identical. `shapeRowAnalytics` gets a first arm after the null row: when `isOptionsCashWalletReason(effectiveListFlag(a, "mtm_gated_reason"))` it returns the failed arm's blank shape plus `headline_withheld_cause`, before the terminal-success and held-re-run arms. `shapeStoredAnalytics` deletes both alias inputs, so every other row (MT5 included) leaves unchanged. `types.ts` gets the three optional fields; `rowRecord` passes `withheldBy` when the marker is set.
- **Task 2, commit `d877141d3`.** `PERCENTILE_WITHHOLD_COLUMNS` (the six generation aliases, composed after `PERCENTILE_SPAN_COLUMNS`, which is untouched) lets `getPercentiles` and `getOwnRowPercentiles` skip a flagged row with `continue` right after the rankability check, judged through `effectiveListFlag`. The `ownSubjects` filter excludes a subject carrying the marker inside the same callback. `OwnCapitalStrategy.figure_withheld_by` and the dashboard leg's optional twin; `figureRecordScalars` takes `mtmGatedReason` and returns the field; both callers pass `effectiveListFlag(analyticsObj, "mtm_gated_reason")`. `gatedSharpe` spreads `withheldBy` into its record.
- **Task 3, commit `22a6f006a`.** `isRankedRow` excludes the marker row (no ordinal, unranked partition under the metric sorts, no hole under the Created sort). The rank cell's title and sr-only text take `withheldCellTitle(record)` when no stale-series reason applies. The flagged row is not added to the series-verdict map (see key decisions).

## Sentence (hand-typed in the tests)

"Withheld: measured on the cash wallet, which leaves out open option positions." (figure-gate's `withheldCellTitle`; the table never retypes it.)

## RED runs (before the behaviour existed)

Task 1, the new file against `queries.ts` and `annualized-cell.tsx` at HEAD (byte-backed, restored, `cmp` exit 0):

```
 Test Files  1 failed (1)
      Tests  13 failed | 5 passed (18)
 FAIL  an anon ranked row (aliases only), complete, is the blank shape plus the named marker
 FAIL  the withhold does not depend on the status: a failed flagged row is blank, marked and keeps its failed status
 FAIL  a row held over a stored success (live alias gone with the prestamp, snapshot bound to computed_at) is still blank and marked
 FAIL  an owner wildcard row (flags blob carrying the reason) is blank and marked
 FAIL  an owner wildcard row held over a bound snapshot that carries the reason is blank and marked
 FAIL  an alias row whose reason is <each of 7 NOT_TRIGGERS> is shaped byte-identically to the same row without the alias keys   (x7: the alias keys leaked)
 FAIL  a blanked, marked row carries withheldBy, the gate withholds, and the cell sentence is the hand-typed one
```

Task 3, the table file against `StrategyTable.tsx` at HEAD:

```
 Test Files  1 failed (1)
      Tests  4 failed | 8 passed (12)
 FAIL  ... owner-all-statuses mount > has no #n ...           AssertionError: expected '#4' not to contain '#'
 FAIL  ... published-only mount > has no #n ...               expected 'Not ranked: the data date could not b…' to be 'Withheld: measured on the cash wallet…'
 FAIL  ... published-only mount > carries no 'No data' chip, no 'Data date unknown' chip ...
 FAIL  ... a stale-series reason still wins the rank cell's title ...
```

(The Created-sort case was added after this run, on the same code it fails as well; see R1 below.)

## PROOF-01 (verbatim)

Every neuter was made on a file backed up byte for byte, restored with `cp`, proven with `cmp` (exit 0), then re-run GREEN. Lines are vitest FAIL and summary lines with the describe prefixes shortened. Backups lived in the session scratchpad.

### Task 1 - shaper arm made unreachable (`if (false && ...)`)

```
 FAIL  an anon ranked row (aliases only), complete, is the blank shape plus the named marker
 FAIL  the withhold does not depend on the status: a failed flagged row is blank, marked and keeps its failed status
 FAIL  a row held over a stored success ... is still blank and marked
 FAIL  an owner wildcard row (flags blob carrying the reason) is blank and marked
 FAIL  an owner wildcard row held over a bound snapshot that carries the reason is blank and marked
 FAIL  the trigger and a non-trigger are different outputs (the table is not comparing two blanks)
 FAIL  a blanked, marked row carries withheldBy, the gate withholds, and the cell sentence is the hand-typed one
 Test Files  1 failed (1)
      Tests  7 failed | 11 passed (18)
cmp exit 0
 Test Files  1 passed (1)
      Tests  18 passed (18)
```

### Task 1 - generation: the arm reads the live alias only (`a.mtm_gated_reason`)

```
 FAIL  a row held over a stored success (live alias gone with the prestamp, snapshot bound to computed_at) is still blank and marked
 FAIL  a held row whose snapshot does NOT carry the reason is not withheld, even when the raw live alias still does (the live flags of a held row are never read)
 FAIL  an owner wildcard row (flags blob carrying the reason) is blank and marked
 FAIL  an owner wildcard row held over a bound snapshot that carries the reason is blank and marked
 Test Files  1 failed (1)
      Tests  4 failed | 14 passed (18)
cmp exit 0
 Test Files  1 passed (1)
      Tests  18 passed (18)
```

### Task 2 - P1: the `getPercentiles` skip removed

```
 FAIL  five published rows plus one flagged row with the best figures: the flagged row has no entry, and no other row's rank moves
 FAIL  W5 held generation: a terminal row whose live alias lacks the marker and the reason, with a snapshot BOUND to computed_at that carries the reason, is skipped
 Test Files  1 failed (1)
      Tests  2 failed | 27 passed (29)
cmp exit 0
 Test Files  1 passed (1)
      Tests  29 passed (29)
```

### Task 2 - P2 (percentile generation): the `getPercentiles` skip reads the live alias directly

```
 FAIL  W5 held generation: a terminal row whose live alias lacks the marker and the reason, with a snapshot BOUND to computed_at that carries the reason, is skipped
 Test Files  1 failed (1)
      Tests  1 failed | 28 passed (29)
cmp exit 0
 Test Files  1 passed (1)
      Tests  29 passed (29)
```

### Task 2 - P3: the `getOwnRowPercentiles` population skip removed

```
 FAIL  a flagged PUBLISHED row is skipped from the population: it has no published entry and moves nobody's rank
 FAIL  a flagged own row that is ALSO published gets no entry in either map
 Test Files  1 failed (1)
      Tests  2 failed | 27 passed (29)
cmp exit 0
 Test Files  1 passed (1)
      Tests  29 passed (29)
```

### Task 2 - P4: the `ownSubjects` marker filter removed

First run, before the dedicated case existed: the neuter went UNDETECTED (`Tests 29 passed`), because a shaped flagged row has null KPIs and is never ranked anyway, so the filter was redundant behind the blanking. A case was added that hands the reader a subject carrying the marker AND figures (a state the shaper never emits) so the filter is pinned on its own:

```
 FAIL  the subject filter stands on its own: a subject carrying the marker AND figures (a state the shaper never emits) still gets no entry
 Test Files  1 failed (1)
      Tests  1 failed | 29 passed (30)
cmp exit 0
 Test Files  1 passed (1)
      Tests  30 passed (30)
```

### Task 2 - P5: `figureRecordScalars` returns `figure_withheld_by: null`

```
 FAIL  getMyAllocationDashboard ... Phase 252: figure_withheld_by names an options book > flags carrying the options reason mark the leg; every other leg carries null, never absent
 FAIL  getMyAllocationDashboard ... Phase 252: figure_withheld_by names an options book > a derive-prestamped leg (no live marker) over a snapshot BOUND to computed_at that carries the reason is marked; a snapshot bound to another success is not
 FAIL  252 getOwnCapitalStrategies - figure_withheld_by on the Holdings marked half > live flags carrying the reason mark the row; another reason, a case variant, and no flags do not
 Test Files  2 failed (2)
      Tests  3 failed | 282 passed (285)
cmp exit 0
 Test Files  2 passed (2)
      Tests  285 passed (285)
```

### Task 2 - P6 (Holdings): the `withheldBy` spread dropped from `gatedSharpe`

```
 FAIL  Phase 252: the options-book marker withholds the Holdings Sharpe on both halves > a positioned row marked options_cash_wallet answers sharpe null, state withheld and a record carrying withheldBy
 FAIL  Phase 252: the options-book marker withholds the Holdings Sharpe on both halves > a marked-only row (own-capital half) is withheld the same way
 Test Files  1 failed (1)
      Tests  2 failed | 50 passed (52)
cmp exit 0
 Test Files  1 passed (1)
      Tests  52 passed (52)
```

### Task 3 - R1 (rank): `isRankedRow` restored to `isDisplayedRow` alone

```
 FAIL  on the owner-all-statuses mount > has no #n, shows a dash in the rank cell with the hand-typed sentence ...
 FAIL  under the Created sort (the manager mount), where unranked rows interleave, the flagged row is still unnumbered and the ranked rows number #1 to #3 with no hole
 Test Files  1 failed (1)
      Tests  2 failed | 11 passed (13)
cmp exit 0
 Test Files  1 passed (1)
      Tests  13 passed (13)
```

The plan expected the "partition" case to fail under R1. It does not on a metric sort: the blank row has null figures and `compareWithMissingLast` already sinks it, so the sorts-after-every-ranked-row cases pass either way. The partition is only observable where unranked rows interleave, which is the Created sort; the case above pins that and fails under R1.

### Task 3 - R2: the marker sentence fallback removed from `notRankedText`

```
 FAIL  owner-all-statuses mount > has no #n, shows a dash in the rank cell with the hand-typed sentence ...
 FAIL  published-only mount > has no #n, shows a dash in the rank cell with the hand-typed sentence ...
 FAIL  under the Created sort ... the flagged row is still unnumbered ...
 FAIL  a stale-series reason still wins the rank cell's title on a row that has one ...
 Test Files  1 failed (1)
      Tests  4 failed | 9 passed (13)
cmp exit 0
 Test Files  1 passed (1)
      Tests  13 passed (13)
```

### Task 3 - R3: the flagged row put back into the series-verdict map

```
 FAIL  published-only mount > has no #n, shows a dash in the rank cell with the hand-typed sentence ...
 FAIL  published-only mount > carries no 'No data' chip, no 'Data date unknown' chip and no 'could not be read' reason
 FAIL  a stale-series reason still wins the rank cell's title on a row that has one ...
 Test Files  1 failed (1)
      Tests  3 failed | 10 passed (13)
cmp exit 0
 Test Files  1 passed (1)
      Tests  13 passed (13)
```

## Verification

- `npm run typecheck`: clean.
- `npm run lint`: 0 errors, 4 warnings, the same four unused-variable warnings plan 01 recorded (`isRankableAnalyticsRow` in `composite-read-path.ts`, `nativeUnitReason` in `MetricsColumn.tsx`, two in `queries.stale-analytics-detail.test.ts`); none comes from a line this plan added.
- `node scripts/verify-plan-anchors.mjs --pending`: `OK: 16 plan file(s), no stale claims.`
- `recompute-verdict-census.test.ts`, `figure-record-scalars.test.ts` (three-way pin) and `queries.percentile-columns.test.ts` pass; the census file is unedited and `queries.ts::usesLastSuccessSnapshot` (1), `queries.ts::effectiveDataQualityFlags` (3), `queries.ts::isRankableAnalyticsRow` (4) did not move.
- Task verify commands: Task 1 five files green; Task 2 seven files green (140 tests); Task 3 four files green (116 tests).
- Plan verification sweep (`src/lib/queries`, `figure-record-scalars`, `src/components/strategy`, `src/app/(dashboard)/allocations`, `src/app/(dashboard)/strategies`, the census, the Phase 149 parity test): `Test Files 2 failed | 335 passed (337)`, `Tests 2 failed | 6553 passed (6555)`. The two failures:
  - `StrategyTable.selection.test.tsx` ("keeps a page-1 selection across paging, a sort, and a search that hides the rows"): failed only inside the parallel sweep; PASSES when run alone. Load flake, not caused here.
  - `RiskTabPanel.book-series.test.tsx` ("ready, empty legacy strategies: VaR renders a value computed from the book's 60 daily returns"): fails alone too, and ALSO fails on a detached checkout of the plan's base commit `2a9042283` (measured in a throwaway worktree, since removed). Its fixture uses fixed 2026 dates, so it is almost certainly time-dependent. Pre-existing and out of scope; not fixed.
- `src/lib/factsheet/compute.conventions.test.ts` fixtures B and C (Node 25 vs CI Node 22 float difference) were not touched and were not in this plan's sweep.
- No database access.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Two Holdings fixtures built `OwnCapitalStrategy` by hand and failed typecheck on the new required field.**
- **Found during:** Task 2 typecheck.
- **Issue:** `figure_withheld_by` is required on `OwnCapitalStrategy` (the plan's interface), so `HoldingsTable.figure-gate.test.tsx` and `HoldingsTable.strategy-rows.test.tsx` did not compile.
- **Fix:** one line each, `figure_withheld_by: null`. Both files pass unchanged otherwise.
- **Files modified:** the two test files above (not in the plan's file list).
- **Commit:** `d877141d3`.

**2. [Rule 2 - Missing coverage] The book-leg producer case lives in `queries.my-allocation.test.ts`, not `queries.options-withhold.test.ts`.**
- The plan's behaviour list needs `getMyAllocationDashboard` driven end to end, and that file already owns the fixture machinery for it (`psProvenance`, the `total-record scalars` describe). Three cases added there (live flags, bound snapshot vs another success's, the reason never riding the payload). Not in the plan's file list.
- **Commit:** `d877141d3`.

**3. [Rule 1 - Defect in the plan's expectation] The table's series verdict would have overwritten the withheld sentence.** On the published-only mount a blanked row has `series_end: null`, so `listSeriesVerdict` answers "unknown" and the rank cell read "Not ranked: the data date could not be read." with a "Data date unknown" chip, which is wrong: the date is blank because of the withhold. The plan's "when no stale-series reason applies" would have left that in place for every published-only mount. The marker row is now excluded from the verdict map, so no stale reason applies to it and the sentence shows; a genuinely stale row beside it keeps its own reason (a case pins both). Commit `22a6f006a`.

### Other notes

- **The subject filter was redundant behind the blanking** (P4 above) and now has its own case.
- **Acceptance count, named.** The plan's `grep -c "last_success_mtm_gated_reason:data_quality_flags->last_success_snapshot->flags->>mtm_gated_reason" src/lib/queries.ts` says EXPECT==1. It reads 2: the ranking projection and `PERCENTILE_WITHHOLD_COLUMNS`, which the same plan's Task 2 requires to spell the alias "exactly as `CATEGORY_RANKING_ANALYTICS_COLUMNS` spells them". The criterion was written before the W5 revision added the second spelling.
- **A case variant of the reason on the percentile path.** Covered ("a case variant of the reason is not the reason: the row ranks").

## Known Stubs

None.

## Threat Flags

None. T-252-09 (two `->>` scalars of a closed vocabulary, exact set pinned, both inputs deleted before a shaped row leaves) and T-252-10 (generation pick through `effectiveListFlag`, held-row case) are mitigated as planned. T-252-11 (percentile peer sets) is mitigated for the TS readers; `get_verified_cohort_rank` is unchanged by CONTEXT decision. T-252-SC accepted (no install).

## Issues Encountered

- A `sed -i` with a multi-line replacement failed on macOS (bad flag), changed nothing, and the two edits were redone with a script.

## Self-Check: PASSED

- Commits `959df7bc0`, `d877141d3`, `22a6f006a` are reachable from HEAD; `commits: 3` was measured from the persisted ledger (`plan_head_before` to HEAD).
- Both new test files exist and are in the commits; every file under `key-files` is in the three commits.
- STATE.md, state.json and ROADMAP.md were not touched. Phase 233's files were not touched.
