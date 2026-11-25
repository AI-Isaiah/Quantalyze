---
phase: 252-deribitoptions
reviewed: 2026-11-25T20:27:38Z
depth: standard
files_reviewed: 56
files_reviewed_list:
  - analytics-service/scripts/deribit_options_smoothed_probe.py
  - analytics-service/tests/test_deribit_options_smoothed_probe.py
  - src/__tests__/options-cash-wallet-withhold.census.test.ts
  - src/__tests__/recompute-verdict-census.test.ts
  - src/app/(dashboard)/allocations/components/HoldingsTable.figure-gate.test.tsx
  - src/app/(dashboard)/allocations/components/HoldingsTable.strategy-rows.test.tsx
  - src/app/(dashboard)/allocations/lib/constituent-figure.test.ts
  - src/app/(dashboard)/allocations/lib/constituent-figure.ts
  - src/app/(dashboard)/allocations/lib/strategies-row-adapter.test.ts
  - src/app/(dashboard)/allocations/lib/strategies-row-adapter.ts
  - src/app/(dashboard)/compare/page.test.tsx
  - src/app/(dashboard)/compare/page.tsx
  - src/app/(dashboard)/recommendations/page.figure-gate.test.tsx
  - src/app/(dashboard)/recommendations/page.tsx
  - src/app/api/og/factsheet/[id]/route.figure-gate.test.tsx
  - src/app/api/og/factsheet/[id]/route.tsx
  - src/app/api/strategies/[id]/returns/route.test.ts
  - src/app/api/strategies/[id]/returns/route.ts
  - src/app/factsheet-share/[token]/page.cache-isolation.test.tsx
  - src/app/factsheet/[id]/v2/FactsheetBody.basis.test.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.headline-coverage.test.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.window-kpis.test.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.withheld-renderings.test.tsx
  - src/app/factsheet/[id]/v2/MetricsColumn.headline-bench.test.tsx
  - src/app/factsheet/[id]/v2/MetricsColumn.tsx
  - src/app/factsheet/[id]/v2/MetricsColumn.withheld-panels.test.tsx
  - src/app/factsheet/[id]/v2/basis-context.leverage.test.tsx
  - src/app/factsheet/[id]/v2/basis-context.test.tsx
  - src/app/factsheet/[id]/v2/basis-context.tsx
  - src/app/factsheet/[id]/v2/page.public-cache-key.test.tsx
  - src/app/factsheet/[id]/v2/page.tsx
  - src/components/strategy/CompareEquityOverlay.test.tsx
  - src/components/strategy/CompareEquityOverlay.tsx
  - src/components/strategy/StrategyTable.options-withhold.test.tsx
  - src/components/strategy/StrategyTable.tsx
  - src/components/strategy/annualized-cell.tsx
  - src/lib/factsheet/build-payload.headline-source.test.ts
  - src/lib/factsheet/build-payload.ts
  - src/lib/factsheet/composite-read-path.headline-basis.test.ts
  - src/lib/factsheet/composite-read-path.ts
  - src/lib/factsheet/fetch-and-build-payload.ts
  - src/lib/factsheet/headline-basis.test.ts
  - src/lib/factsheet/headline-basis.ts
  - src/lib/factsheet/headline-verdict.parity.test.ts
  - src/lib/factsheet/types.ts
  - src/lib/figure-gate.test.ts
  - src/lib/figure-gate.ts
  - src/lib/figure-record-scalars.test.ts
  - src/lib/figure-record-scalars.ts
  - src/lib/queries.my-allocation.test.ts
  - src/lib/queries.options-withhold.test.ts
  - src/lib/queries.percentile-columns.test.ts
  - src/lib/queries.test.ts
  - src/lib/queries.ts
  - src/lib/types.ts
findings:
  critical: 0
  warning: 0
  info: 8
  total: 8
  necessity: 0
status: clean
round: 2
round_1_findings:
  warning: 2
  info: 9
---

# Phase 252: Code Review Report

**Reviewed:** 2026-11-25T20:27:38Z
**Depth:** standard, with call-chain tracing into unchanged consumers (Holdings, tearsheet, scenario-share, OG, percentile reads, the Python producer)
**Files Reviewed:** 56 (diff `89a9e3d97..HEAD`, `.planning/` and `TODOS.md` excluded)
**Status:** clean (after round 2; round 1 was issues_found)

## Summary

The predicate has one owner. `isOptionsCashWalletBook` / `isOptionsCashWalletReason` in
`headline-basis.ts` use strict `===` on `"unsmoothed_options_book"`, have no numeric input, and
are checked first in `headlineVerdict`, so the options cause beats `dated`. Every surface the
ruling names reads it on the effective flags generation: the factsheet resolve stage, OG,
recommendations, the returns route, the list shaper (`effectiveListFlag`), Compare, and both
percentile reads. I checked each one.

**Non-flagged rows, including MT5, do not move.** I traced every changed predicate for that:
- `applyHeadlineBasis`'s `twrChainBroken` spread, the `buildFromBuildableSeries`
  `headlineWithheld` gate, `isHeadlineWithheld`, `headlineBenchSource` and `leverageEligibleFor`
  each drop or reorder a chain-break conjunct. Before this phase every setter of
  `headlineWithheld` was `applyHeadlineBasis`, and it always set `twrChainBroken: true` too.
- The `shapedNativeUnit` to `effectiveListFlag` refactor gives the same result for `native_unit`.
- `figureRecord` and `recordFromScalars` add no key unless the exact reason is present.

MT5 rows cannot carry the reason, on three pieces of evidence:
- Its only producer is `mark_to_market_available` in `stitch_composite.py:335-349`, which is
  composite-only and keyed on option activity.
- That activity comes only from Deribit raw rows: `has_option_activity` is set only at
  `deribit_ingest.py:2753`.
- The single-key paths stamp only the other reason values (`job_worker.py` around lines
  6842-6935 and 11065). A row that leaves a composite drops the composite-era reason
  (`analytics_runner.py:2290-2292`, `_was_composite`), so the withhold cannot fire on it under a
  false reason.

**Public projections leak no flags.** The ranked list and Compare project only two `->>`
closed-vocabulary scalars. `shapeStoredAnalytics` and the Compare page delete both before any
client object is built. The flagged arm is built from `EMPTY_ANALYTICS`. The probe's only stdout
path is `emit_record`, which applies a key whitelist, refuses any float, and runs
`assert_sanitized`. stderr carries exception type names only.

**Two user-facing MEDIUMs.** The first: On Holdings, a flagged strategy still shows its cash-wallet Max DD
and MTD. Recommendations, Discovery and Compare withhold both, and the factsheet withholds both
(Max DD is a stored cash scalar, MTD a trailing window). So the surfaces disagree for the same
row. The reachable case today: a founder-owned private options composite that is
own-capital-marked or held as a position. The second (WR-02): inside a zoom, the rolling charts'
"avg" label still prints for this cause, while the rail dashes the same figure.

**Verification run:**
- `tsc --noEmit`: exit 0.
- All 32 changed vitest files: 1586/1586 pass, but only with `--testTimeout=60000`.
  - At the default 5 s timeout, the full parallel run failed 7 tests across 2 files.
  - I identified only one of those files: `FactsheetView.window-kpis.test.tsx`. Every failure I
    saw was a 5 s timeout. I did not identify the other file.
  - Re-run in a three-file batch at 5 s, one window-kpis test still timed out (5.4 s).
  - That file passes 32/32 at 60 s.
  - So these are slow tests near the default timeout, not assertion failures. None of them is on
    the known local-failure list.
- Probe pytest: 53/53.

**Necessity:** I read the reference (`necessity-review.md`) and found no necessity finding. The
single-key `isOptionsCashWalletBook` arm in `readSingleKeyBasisOpts` guards stored JSONB, which
is a trust boundary. The snapshot-generation pick is one shared rule with `native_unit`, not a
second instantiation.

**Skills:** the project has no `.claude/skills` or `.agents/skills` directory.

## Warnings

### WR-01: [MEDIUM] Holdings shows a flagged strategy's cash-wallet Max DD and MTD; only Sharpe is withheld

**Files:**
- `src/app/(dashboard)/allocations/lib/strategies-row-adapter.ts:272-274` and `:322-324`
- `src/app/(dashboard)/allocations/components/HoldingsTable.tsx:581` and `:587`

**Issue:** `gatedSharpe` honours `figure_withheld_by` (`strategies-row-adapter.ts:189-193`). The
same row object still carries two figures:
- `mtd: computeMtd(s.strategy_analytics?.daily_returns)`, or the server-computed `s.mtd` on the
  own-capital half.
- `maxDd: s.strategy_analytics?.max_drawdown ?? null`.

`HoldingsTable` prints both unconditionally.

Both are cash-wallet figures, and every other surface withholds them for the same row:
- Recommendations: `recommendations/page.tsx:421`, whose comment reads "Max DD is a cash-wallet
  figure on an options book, withheld like CAGR and Sharpe".
- Discovery and owner lists: `shapeRowAnalytics` blanks the whole row.
- Compare: the column is composed from `EMPTY_ANALYTICS`.
- Factsheet: Max DD is one of the seven `BASIS_KPI_MAP` scalars nulled by `applyHeadlineBasis`,
  and MTD is one of the windows `withSuffixWindows` nulls.

That breaks CONTEXT's "They agree for the same row, and the reason is named on each one" for a
surface the plan claims ("book legs carry the marker to the composer and Holdings").

**Reachability:** an owner who marks a flagged private composite as own capital, or holds a
position in it. PROD has two flagged rows, both founder-owned private composites.

**Test gap:** neither Holdings test asserts on these cells. Both Holdings test diffs only add
`figure_withheld_by: null` to fixtures. The adapter test (`strategies-row-adapter.test.ts`,
+68 lines) asserts `sharpe`, `sharpeState` and `sharpeRecord` only.

**Fix:** in `strategiesToRows`, on both halves, null `mtd` and `maxDd` when
`s.figure_withheld_by === OPTIONS_CASH_WALLET_CAUSE`. Then have `HoldingsTable` render those two
cells as a dash carrying `withheldCellTitle(row.sharpeRecord)` (the record already carries
`withheldBy`), the way `strategySharpeCell` does for a withheld Sharpe:

```ts
const optionsBook = s.figure_withheld_by === OPTIONS_CASH_WALLET_CAUSE;
// ...
mtd: optionsBook ? null : computeMtd(s.strategy_analytics?.daily_returns),
...gatedSharpe(s.strategy_analytics?.sharpe, s),
maxDd: optionsBook ? null : (s.strategy_analytics?.max_drawdown ?? null),
```

Add a `HoldingsTable` test that renders a row with `figure_withheld_by: "options_cash_wallet"`
and a finite `max_drawdown` and `daily_returns`. It should assert that the MTD and Max DD cells
read "—" with the cash-wallet sentence, and that the same row with `null` shows both figures.

**Scope check:** this list of WR-01 surfaces is complete for per-strategy figures under
`allocations/`. `ScenarioCompareTable`, `ScenarioBenchmarkSection`, `AlphaBetaDecomposition` and
`scenario-factsheet-payload` gate scenario (blend) metrics, which CONTEXT defers. The composer's
added-constituent cells (CAGR and Sharpe only) are already withheld through `constituentFigure`.

### WR-02: [MEDIUM] Inside a zoom, the rolling charts' "avg" label still prints a cash-wallet figure for this cause while the rail dashes it

**File:** `src/app/factsheet/[id]/v2/FactsheetView.tsx:1048` (consumed at `:1146`)

**Issue:** the comment at `FactsheetView.tsx:1034-1037` says this label goes with the rail's
Rolling Metrics Avg. The label is the rolling Sharpe and volatility average over the visible
range, and it is decided by `railAvgWithheld = fullHistoryWithheld && !zoomed`. This phase made
the rail's `wholeRecordWithheld` also hold inside a range for the options cause
(`MetricsColumn.tsx:407`, `isRangeWithheld`), but left the label's gate alone. So inside a zoom:
- the rail's Rolling Avg (and the strip, the Main Metrics and the bootstrap panel) read "—";
- the chart prints `showStratAverage`, a ratio averaged over the cash-wallet slice.

CONTEXT W3 withholds range figures for this cause "whatever the window". It lets the charts draw
the series, and this label is a printed number, not a line. It is the same defect class as
WR-01: a figure the phase withholds elsewhere for the same row, still shown on one surface.

**Fix:**

```ts
const railAvgWithheld =
  fullHistoryWithheld && (!zoomed || isRangeWithheld(payload.dataQuality, basisForNote));
```

`isRangeWithheld` is already imported in this file. Add a window-kpis or withheld-renderings test
that zooms an options-book payload and asserts the rolling chart config has
`showStratAverage: false`. It must also show that a chain-broken Withheld payload keeps the
label inside a zoom (D-78).

## Info (LOW and Info: recorded here only, never fixed or booked)

### IN-01: [LOW] Own-capital Holdings and positioned Holdings judge the reason on different flags generations

**File:** `src/lib/queries.ts:2354` (`getOwnCapitalStrategies`) versus `:6604` (`getMyAllocationDashboard`)

**Issue:** the own-capital projection (`queries.ts:2236-2245`) carries no `computed_at`, so
`effectiveListFlag` can never bind a snapshot and always reads the live flags. The my-allocation
projection does carry `computed_at`, so it reads the effective generation. One strategy could
then be marked on one half and not the other. This is unreachable today:
- The producer is composite-only.
- The composite stitch rewrites flags from `existing_flags` with the marker
  (`job_worker.py:14481-14495`).
- `last_success_snapshot` is written only by the strategy-mode `derive_broker_dailies` prestamp
  (`job_worker.py:11573-11583`).

So a composite row is never in the prestamp/snapshot state.

**Fix (if ever needed):** add `computed_at` to the own-capital projection.

### IN-02: [LOW] The census is per file, and `getFactsheetDetail` shapes a row whose projection cannot carry the reason

**Files:**
- `src/__tests__/options-cash-wallet-withhold.census.test.ts:310-313`
- `src/lib/queries.ts:1838-1865`

**Issue:** arm 4 marks a whole file "covered" when it calls any seam once. So every reader in
`queries.ts` passes because of one `shapeRowAnalytics` call somewhere in the file. Arm 4 also
does not look at `.rpc(` readers.

A concrete blind spot: `getFactsheetDetail` selects `PUBLIC_ANALYTICS_COLUMNS`, which has no
`mtm_gated_reason` alias and no flags blob. Its `shapeRowAnalytics` call therefore fails open,
and a flagged published row would come back with its full cash figures, `monthly_returns` and
`metrics_json`. Its only consumer, the tearsheet, uses the result for existence and identity
only (`tearsheet/page.tsx:41,120-123`); the figures come from the shared payload. So nothing
leaks today, but the census claims a guarantee it does not check. It also could not have caught
WR-01, because the adapter reads no `strategy_analytics` directly.

**Fix:** add the two reason aliases to `getFactsheetDetail`'s embed. Or make arm 4 check per
select string: every select string containing `strategy_analytics (` and a figure column must
also contain `mtm_gated_reason` or `data_quality_flags`.

### IN-03: [LOW] The returns route still ships raw `cagr` and `sharpe` in JSON for a flagged strategy

**File:** `src/app/api/strategies/[id]/returns/route.ts:499-507` and `:655-661`

**Issue:** by design, the route marks the record (`figure_withheld_by`) and relies on the
consumer to withhold, the same pattern as `figure_unreadable`. The only consumer,
`ScenarioComposer` through `parseConstituentRecord`, does withhold. But the cash-wallet CAGR (in
the evidence row, about 5e14%) still crosses the wire to any viewer the route admits.

**Fix (defence in depth):** null `cagr` and `sharpe` server-side when `record.withheldBy` is set.
The series is a blend input and is deferred per CONTEXT.

### IN-04: [LOW] Recommendations: with the asset-class read failed, a flagged card shows a plain dash and no reason

**File:** `src/app/(dashboard)/recommendations/page.tsx:396-421`

**Issue:** `figureState` is `"null"` when `classKnown` is false, so CAGR and Sharpe print the
plain unknown dash. The options sentence never appears, even though `record.withheldBy` is known.

**Fix:** when `record.withheldBy` is set, decide `figureState = "withheld"` before checking
`classKnown`.

### IN-05: [LOW] Discovery grid card: the Return footer dashes without the reason

**File:** `src/components/strategy/StrategyGrid.tsx:280-285`

**Issue:** the cumulative-return footer reads `formatPercent(null)`, a bare dash. Only the CAGR
cell beside it carries the sentence, through `annualizedCell`. The table names the reason in its
rank cell; the grid has no equivalent line.

**Fix:** have the footer reuse `withheldCellTitle(record)` as a title when
`analytics.headline_withheld_cause` is set.

### IN-06: [LOW, judgment] The Monthly Returns heatmap cells still print cash-wallet monthly figures

**File:** `src/app/factsheet/[id]/v2/HeatmapPanels.tsx:46,122-123`

**Issue:** for any Withheld cause, only the YTD column and the last month are withheld. This
matches the existing chain-break Withheld behaviour, and CONTEXT scopes the ruling to headline
figures and lets the charts draw the series. Recorded so the founder's visual check can decide.

### IN-07: [LOW] Probe: the "no such strategy" refusal (exit 2) cannot fire, and its test stub cannot fail

**File:** `analytics-service/scripts/deribit_options_smoothed_probe.py:468-480`

**Issue:** `_load_strategy` uses `.single()`. When no row matches, postgrest-py raises
`APIError` (PGRST116) instead of returning a response with `data=None`. The run then exits 1
with `failed: APIError`, not the exit 2 `refused: no such strategy` the docstring promises. The
test `_Query` stub returns a value from `single()`, so it cannot catch this.

**Fix:** use `.maybe_single()`, as `_load_key` does, so `one()` returns `None`.

### IN-08: [LOW] Probe: a crawl timeout aborts the run with no verdict line, against "other build error is a FAIL"

**File:** `analytics-service/scripts/deribit_options_smoothed_probe.py:399-415,438-440`

**Issue:** `asyncio.wait_for` raises `TimeoutError`, which is not in `_BUILD_ERRORS`. So does
anything else outside the tuple, including from the unguarded `fetch_deribit_native_account_state`
call at `:438`. Any of these propagates to `main` and exits 1 after earlier members' records have
printed, with no verdict line. The direction is safe (no pass), but the run shape differs from
C1's documented "is a FAIL" record.

**Fix:** catch `TimeoutError` in `_build_basis` as `build-error:other`, or document that a
timeout aborts the run.

### IN-09: [Info] Probe docstring says it "reads no environment variable"

**File:** `analytics-service/scripts/deribit_options_smoothed_probe.py:61-64,516`

**Issue:** `get_kek()` reads the KEK from the worker environment. The claim is true only of the
probe's own code. Reword it to "reads no environment variable beyond the worker's KEK".

---

_Reviewed: 2026-11-25T20:27:38Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Round 2

**Reviewed:** 2026-11-25, the fix commits only: `git diff c38e56112 HEAD -- . ':!.planning'`
(`f2e540856`, `c0a3da3ed`, `f701b9103`, `2354497db`, `418043a48`, merge `a54033fcd`).

**Verdict:** no MEDIUM or higher remains, so the status is now `clean`. The open counts in the
frontmatter are what is left: round 1's IN-02 to IN-06, IN-08 and IN-09 (7), plus R2-IN-01 below.
IN-01 and IN-07 are closed.

**Verification:**
- `tsc --noEmit`: exit 0.
- The 7 affected vitest files (both Holdings test files, the adapter test, withheld-renderings,
  `queries.options-withhold`, `queries.my-allocation`, the census): 432/432 pass with
  `--testTimeout=60000`.
- Probe pytest: 59/59. `mypy` on the probe: clean.

| Fix | Correct | Minimal | Its test can fail | Regression check |
|---|---|---|---|---|
| WR-01 Holdings MTD and Max DD (`strategies-row-adapter.ts`, `HoldingsTable.tsx` `strategyCashFigureCell`) | Yes. Both adapter halves null `mtd` and `maxDd` on the exact `OPTIONS_CASH_WALLET_CAUSE`, and the cell renders the named sentence as title and sr-only text, the same idiom as `strategySharpeCell`. | Yes | Yes. `HoldingsTable.figure-gate.test.tsx` asserts that the flagged cells (columns 4 and 6) show no `7.0`/`12.0` and carry the reason, and that the same unflagged row prints both figures. Without the fix the flagged cell prints `7.0%`. | An unmarked row takes the old branch byte-for-byte (`value == null ? "—" : formatPercent(value)`). `sharpeRecord` is non-optional on `StrategyRow`. MT5 rows are unchanged. |
| WR-02 rolling avg label (`FactsheetView.tsx:1050`) | Yes. The gate is the rail's own term, `isRangeWithheld`, which needs the options cause on the cash basis. | Yes, one line | Yes. The options payload zoomed draws 0 `avg` labels, and a chain-broken Withheld payload zoomed still draws 1. That premise control proves the label renders in a zoom, so a revert goes red. | `isRangeWithheld` is false for every pre-252 cause, so D-78 slice labels are unchanged. |
| SFH-HIGH-1 own-capital generation (`queries.ts` `getOwnCapitalStrategies`) | Yes. `computed_at` is selected and read only through `effectiveListFlag(analyticsObj, …)`. `nativeUnitOf`, `curveMethodFromFlags(dqf)` and `figureRecordScalars` still read the live blob directly, so for any row, MT5 included, only the reason pick can move. A snapshot can bind only to the options string to set the marker. | Yes | Yes. The test pins `computed_at` in the captured select string (the mock would otherwise mask it), asserts that a bound snapshot marks the row, that a snapshot bound to another success does not, and that `computed_at` is absent from the payload. | Payload shape unchanged: `computed_at` is destructured out of `analyticsRest`, and the test asserts this. |
| Probe C6 (option activity and `series_days > 0`) | Yes. `report.has_option_activity` is set unconditionally on every basis in `_assemble_deribit_native_ledger` (`deribit_ingest.py:2753`), on the report `build_deribit_native_ledger` returns. The verdict also requires at least one judged member with activity. `option_activity` is a closed `yes`/`no` vocabulary in the emitter whitelist. | Yes | Yes. A perp-only member is FAIL with `series_days > 0` (its only missing input), a zero-day series is FAIL with `option_activity == "yes"`, and a verdict with no active judged member is FAIL. | The redaction contract still holds: no new numeric field, and floats are still refused. |
| IN-07 `.maybe_single()` | Yes. `one(None)` returns `None`, so the exit-2 refusal now fires. | Yes | Yes. The stub now raises on `.single()` with zero rows, as PostgREST does, and the test asserts `EXIT_REFUSED`. | None |

### R2-IN-01: [LOW] C6 fails a mixed composite whose healthy perp-only Deribit member has no option activity

**File:** `analytics-service/scripts/deribit_options_smoothed_probe.py:355-365` (the per-member
`outcome.option_activity` conjunct)

**Issue:** every judged member must carry option activity. In a composite of one options member
and one perp-only Deribit member, the perp-only member builds, reconciles and has a series, yet
reads `fail`, so the verdict is `fail`. That records "smoothed valuation does not work" when the
options member may pass. The direction is safe: the withhold stays and nothing is ever promoted
on no evidence. It is also diagnosable, because the record prints `option_activity: "no"` beside
`c3`/`c4` `pass`. The verdict-level `has_activity` check already blocks a pass on no evidence, so
the per-member conjunct adds strictness without adding safety.

**Fix (if the founder wants mixed composites measurable):** drop `outcome.option_activity` from
the per-member verdict and keep the verdict-level `has_activity` and per-member
`series_days > 0`. Whether the PROD trigger composites hold a perp-only member was not measured
here.

_Round 2 reviewed: 2026-11-25. Reviewer: Claude (gsd-code-reviewer)._
