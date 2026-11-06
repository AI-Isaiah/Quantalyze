---
phase: 169-pagetruth
topic: T1 (persisted headline, series reads, leverage view)
fixed_at: 2026-09-29T18:40:57Z
review_path: .planning/phases/169-pagetruth/169-REVIEW.md, .planning/phases/169-pagetruth/169-REVIEW-SFH.md
iteration: 1
branch: feat/169-fix1 (cut from feat/169-pagetruth at 8d9155b7a)
findings_in_scope: 9
fixed: 8
partial: 1
skipped: 0
status: partial
---

# Phase 169: Code Review Fix Report, topic T1

**Fixed at:** 2026-09-29T18:40:57Z
**Source reviews:** `169-REVIEW.md` (WR-01, WR-05, IN-01, IN-02) and `169-REVIEW-SFH.md` (H-1, H-2, M-1, M-2, M-3, L-2)
**Iteration:** 1

**Summary:**
- In scope: 9. WR-01 = M-1 and WR-05 = M-3, so those count once each. CSV-READ-CAP was added by the orchestrator.
- Fixed: 8.
- Partial: 1. H-1: the data half is done. The rendered caveat lives in T2's files.
- Skipped: 0.

**Status of the logic fixes:** H-2, M-2 and the H-1 date derivation are logic changes. Each one has a red-first test. They are marked `fixed: requires human verification`, because a test pins the rule we chose, and does not prove the rule is the right one.

## Where verification ran

Everything ran in the orchestrator-provided checkout `quantalyze-169-fix1`, a git worktree of the repo on `feat/169-fix1`. I did not create a separate GSD worktree: the orchestrator's instructions were to work only in this checkout. `node_modules` resolves there, so the numbers below reproduce in that tree.

| Gate | Result |
|---|---|
| `npx tsc --noEmit -p .` | exit 0 |
| `npm run lint` (eslint, route manifests, planning hygiene) | exit 0 |
| `npx vitest run src/lib/factsheet src/app/factsheet src/app/factsheet-share "src/app/(dashboard)/discovery"` | 81 files, 1125 tests, all passed |
| The same, plus `src/app/(dashboard)/strategies`, `phase-148-owner-lane-cache-isolation`, `phase-147-series-resolution-guards` | 123 files, 1942 tests, all passed |
| Every other test file importing a touched module (7 files) | 6 passed, 1 skipped |

The skipped file is `src/__tests__/factsheet-buildable-live-db.test.ts`. It needs a live-DB credential and skips without one. It is the one suite that would exercise the new keyset read against a real PostgREST. **It was not run.**

Baseline before any edit (same glob plus phase-148): 82 files, 1116 tests, all green.

## Fixed Issues

### CSV-READ-CAP (orchestrator-added): the composite read dropped every row after the first 1000

**Files modified:** `src/lib/factsheet/composite-read-path.ts`, plus the csv mocks in `composite-read-path.test.ts`, `fetch-and-build-payload.test.ts` and `v2/page.composite-read-error.test.tsx`
**Commit:** 50c823f63
**Applied fix:** `readCsvDailyReturns` reads in date-keyset pages of 1000. The first page is `.order("date").limit(1000)`. Each later page adds `.gt("date", cursor)`. The read stops only on an empty page. Three conditions throw `CompositeSeriesReadError`, which the resolve stage answers `read_error` and the public cache never stores:
- `page_order`: a date that does not strictly follow the cursor;
- `no_data`: a page that returns neither rows nor an error;
- `row_ceiling`: more than 20000 rows (the old flat ceiling).

**Keyset, not `.range()`, and why:** a keyset is anchored to a date, so a row written between two pages cannot shift a page boundary and repeat a day. That is the `benchmark-source.ts` reasoning (169.2 WR-03). It also keeps the first-page chain identical, so T3's discovery test mock, which ends in `.limit()`, keeps working. The test fake follows the orchestrator's spec: it caps every response at 1000 rows, and an unpaged call gets only the first 1000.

**Stop on empty, not short:** stopping on a short page would stop after page 1 on any server whose cap is below 1000. The cost is one extra round trip per composite read, for the terminating empty page.

**Red-first:**
- On the old code the 1112-row case read exactly 1000 rows: "expected [ …(1000) ] to have a length of 1112".
- Neutering to one page turned 3 cases RED; restoring and running `cmp` passed.

### M-3 = WR-05: a failed MTM or smoothed series read was cached as a degraded payload

**Status:** fixed

**Files modified:** `composite-read-path.ts`, `fetch-and-build-payload.ts`, and their tests, plus `v2/page.composite-read-error.test.tsx`

**Commit:** ccb1e5384

**Applied fix:**
- **Readers:** `readMtmSeries` and `readSmoothedSeries` now throw `CompositeSeriesReadError`. The class gained a `read` discriminant, which is one of `csv_daily_returns`, `mtm_daily_returns`, `smoothed_mtm_daily_returns` or `cash_settlement`. The class keeps its name because the discovery page and the resolve stage catch it by class. A missing or malformed row still degrades to `null`, because that is a fact about the row.
- **Resolve stage:** the single-key basis assembly (`readSingleKeyBasisOpts`) moved from `buildFromResolved` into `resolveFactsheetInputs`. The composite reader already read its basis series there. A failed read now answers `read_error` on every lane:
  - the public cache throws `FactsheetReadError` and stores nothing;
  - the owner lane gets the reason;
  - the probe answers `read_error`.
- **Invariant:** NO-NULL-AFTER-RESOLVE is unchanged. The structural scan still passes.
- **Logging:** one helper, `seriesReadError`, logs and captures a series read error once per build, tagged with `read`.
- **Comment:** the false "Log at ERROR (→ Sentry)" comment is gone.

**Red-first:**
- A new page-level case, MTM-READ-ERROR-NOT-CACHED, drives a single-key options row whose MTM read fails. On the old code it built and cached a payload with no MTM bundle.
- Neutering the throw back to `return null` turned 3 cases RED.
- Restore, then `cmp` OK.

**Consequence:** the probe now reads the MTM and smoothed series for a row that carries a by-basis object. For a composite it already did. Its docblock says so. A row with no by-basis object reads nothing.

### IN-02: `cash_settlement` was typed all-number and carried nulls through a cast

**Status:** fixed

**Files modified:** `types.ts`, `composite-read-path.ts`

**Commit:** 7ab347d81

**Applied fix:**
- The three per-basis types and `extractBasisObject` are now `Record<string, number | null>`.
- `persistedCashHeadline` builds its record with no cast. A non-number is carried as `null`, which the strict overlay renders as "—", the same as before.

**Verification:** this change is type-only, so there is no red test. `tsc` is the gate, and it passes.

### M-1 = WR-01: a null stored `cumulative_return` silently fell back to the TypeScript headline

**Status:** fixed

**Files modified:** `composite-read-path.ts`, `build-payload.headline-source.test.ts`

**Commits:** 9005ade35, plus 1e5c97865 (see the regression below)

**Applied fix:**
- **Gate:** `persistedCashHeadline` now gates on structure only: the seven `BASIS_KPI_MAP` keys must be present. A stored null renders "—" under the strict overlay, as it does in the lists.
- **Missing keys:** a missing key means the select stopped projecting the headline. It is logged with `reason: "missing_keys"` and the list of keys, and captured to Sentry.
- **Non-finite `cumulative_return`:** when a rankable row stores no finite `cumulative_return`, it is warned and captured at `warning`, with the non-finite keys in `extra`.
- **Legitimate nulls:** a lone null Sortino or Calmar is legitimate, and nothing is captured for it.
- **Lingering raw `cash_settlement`:** that arm now warns with the strategy id.
- **Why Sentry:** `console.*` does not reach Sentry here, because `instrumentation.ts` has no console integration. The capture is `captureToSentry`.

**Red-first:**
- The null-`cumulative_return` case rendered the TypeScript Sharpe (1.1478…) on the old code, not the stored 1.5.
- Restoring the finite gate turned it RED again.
- Restore, then `cmp` OK.

### H-2: a single-key allocated-capital row got an arithmetic headline over a geometric chart

**Status:** fixed, requires human verification

**Files modified:** `composite-read-path.ts`, `fetch-and-build-payload.ts`, `build-payload.headline-source.test.ts`

**Commit:** 0516e4428

**Applied fix:**
- `readSingleKeyBasisOpts` takes the strategy's `returns_denominator_config` as a 7th, optional argument. It returns `cumulativeMethod: "arithmetic"` when `attributionBasisFromConfig` says so, which is the composite's own rule.
- A geometric strategy's options are unchanged.
- The resolve stage passes the config.

**Red-first:**
- On the old code the curve ended at the compounded product (0.17262), not the stored sum (0.16918).
- Neutering the method resolution turned 2 cases RED.
- Restore, then `cmp` OK.

**Not closed, and reported:** see "Handoffs" (T3) and "Residuals".

### M-2: the cash leverage view mixed stored and recomputed scalars

**Status:** fixed, requires human verification

**Files modified:** `basis-context.tsx`, `composite-read-path.ts`, `types.ts`, `basis-context.cash-leverage-repin.test.tsx`, `build-payload.headline-source.test.ts`

**Commit:** 6f7e1875f

**D-25, read first:**
- D-25 (i) accepts the L=1 to L≠1 seam for the leverage-variant scalars on a clean series. This fix does not reverse it: the Sharpe/Sortino re-pin and the clean-series behaviour are untouched.
- On H-1 and H-2 rows, the leveraged view cannot be derived on the basis of the L=1 headline, so it is withheld, as it already is for a composite.

**Applied fix:**
- `leverageEligibleFor` returns false for either of these:
  - `dataQuality.twrChainBroken`: an H-1 row;
  - `dataQuality.returnsConventionOverride`: an H-2 row. The single-key owner sets this flag when the config is `cumulative_method: "simple"` or `metrics_basis: "active_day"`. The flag is present only when true.
- The view stays the L=1 view, by reference, at every L.
- The ControlBar and the KpiStrip read the same predicate, so they hide the what-if with no edit to T2's files.

**Red-first:**
- Both flagged payloads levered on the old code.
- Removing the two guards turned them RED again.
- A clean control still levers.

**Not done:** the SFH suggested a continuity test at L = 1 ± ε for `cum_ret`/`cagr` on a clean series. It was not added. The unit fixtures use synthetic stored values, so a continuity pin would need Python parity numbers.

### L-2 (SFH Low): a series read error's Sentry event carried only the code

**Status:** fixed

**Files modified:** `fetch-and-build-payload.ts`, `fetch-and-build-payload.test.ts`, `v2/page.composite-read-error.test.tsx`

**Commit:** 7507ad36a

**Applied fix:** the capture now carries the PostgREST message in `extra.errorMessage`. `captureToSentry` scrubs `extra` string values.

**Red-first:**
- Both capture pins were RED before the change.
- Removing the `extra` turned them RED again.
- Restore, then `cmp` OK.

### IN-01: comments that said the single-key cash headline is never overlaid

**Status:** fixed

**Files modified:** `basis-metrics.ts`, `build-payload.ts`, `types.ts`, `basis-context.tsx`

**Commit:** b19254c61

**Applied fix:**
- Rewrote the `overlayBasisScalars` docblock, the `hasBasisHeadline` docblock, the build-payload cash-overlay and `cumulativeMethod` comments, the `metricsByBasis` docblock, and the `useBasisMetrics` docblock.
- Deleted the unreachable "a payload cached before Phase 169" clause (`basis-context.tsx`).
- The `hasBasisHeadline` docblock pointed at gates in page.tsx that have since moved. It also did not say that the single-key headline gate no longer uses it.
- The fifth site (`fetch-and-build-payload.ts` "the overlay always applies") was rewritten in the M-3 commit, where that comment block moved.

Comments only.

### Regression found and fixed within this topic: the probe sent Sentry events

**Status:** fixed

**Commit:** 1e5c97865

**What happened:**
- M-3 moved the single-key assembly into the resolve stage, and M-1/H-1 made its defects reach Sentry.
- The resolve stage also serves `/strategies`' buildability probe, so a defective row sent one event per row per page load. That is the event storm 167.2.1-REVIEW-R2 WR-01 removed.
- Found by running `src/app/(dashboard)/strategies/page.key-pill.test.tsx`, which is outside the topic's test glob. Three cases went red there.

**Fix:**
- `readSingleKeyBasisOpts` takes `options.captureDefects`, which defaults to true, so the uncached discovery page is unchanged.
- The resolve stage passes `caller === "build"`.
- Defects are still logged on every call.

**Red-first:**
- A new build-captures-once / probe-captures-nothing case was RED.
- Forcing capture on turns it and the three page.key-pill cases RED.
- Restore, then `cmp` OK.

### Cache key (no move needed)

**Commit:** 54afefaf0 (comment only)

- The round-1 payload changes ride the one v8 key: the optional `dataQuality` fields, an arithmetic single-key curve, and read outages that now throw.
- Measured: `origin/main` still carries `factsheet-v2-payload-v7` in `v2/page.tsx`. So no v8 entry exists yet, and D-62's single bump covers these changes.
- The key comment in `page.tsx` now says so. `page.public-cache-key.test.tsx` is untouched and passes.

## Partially fixed

### H-1: a chain-broken single-key row's headline covers only the stretch after the break

**Status:** partial (data half fixed, render not done)

**File:** `src/lib/factsheet/composite-read-path.ts` (data); the render is in `FactsheetView.tsx` / `MetricsColumn.tsx` (T2)

**Commit (data half):** 39c072c89

**What the stored data can name:**
- `data_quality_flags.twr_chain_broken` is a boolean only. Python does not persist where the break is.
- The stored `cash_settlement` series row in `strategy_analytics_series` (`basis_series.derive_basis_series` / `persist_basis_series`) can name it under one condition: the row's `conventions.densify` is `"broker_nan"`.
- **Why that condition is enough.** On the broker path the runner reindexes the series to a dense daily calendar. A refused (guard) day therefore becomes NaN. That day is then:
  - dropped from `rows`;
  - recorded in `gap_spans`.
- **The date.** So the first stored day after the last gap span is exactly where `nav_twr._last_interior_break_suffix` starts compounding, and where `metrics._cagr_index` starts annualizing.
- **When it cannot be named.** Under any other echo there is no date, so the answer is `null`, never a guess:
  - a `"sparse"` user CSV, which is absent on weekends too;
  - a row written before Phase 105, which echoes nothing;
  - a series with no gap, or no stored row.

**What shipped (data half):**
- `dataQuality.twrChainBroken`: strict `=== true`, present only when true. Both surfaces get it through `singleKeyDataQuality`.
- `dataQuality.headlineCoversFrom`: an ISO date, or `null`. On a chain-broken row whose headline is overlaid, one extra read of the stored cash series supplies it.
- When the answer is `null`, a warning is logged and captured to Sentry.
- A failed read is `read_error`.
- The headline itself stays the stored value (SC4, D-25).
- Leverage is withheld on these rows (M-2).

**Red-first:**
- 10 cases were RED on the old code.
- Neutering the chain-broken read turned 3 RED.
- Neutering the densify guard turned 2 RED.
- Restore, then `cmp` OK.

**Why the render is not done:** the caveat renders beside the headline (KpiStrip) and the Cumulative Return Metrics panel. Those are `FactsheetView.tsx` and `MetricsColumn.tsx`, which are T2's files. I stopped there, as the brief requires.

**What T2 needs to render** (copy per DESIGN.md, no em dash in new copy):
- **Show it when** `payload.dataQuality?.twrChainBroken === true`.
- **With a date** (`headlineCoversFrom` is a date): say that Since Inception and CAGR cover the record from that date, after a break in the return chain.
- **Without a date** (`headlineCoversFrom` is `null`): say that they cover only the part of the record after a break, with no date.

**Still needs a PROD measurement (read-only; run the marker check first).** I did not query PROD. The 4 chain-broken rows may not all carry a `broker_nan` series row. If they don't, `headlineCoversFrom` is `null` for them:

```sql
SELECT a.strategy_id,
       s.payload->'conventions'->>'densify'   AS densify,
       jsonb_array_length(s.payload->'gap_spans') AS gaps
  FROM strategy_analytics a
  LEFT JOIN strategy_analytics_series s
    ON s.strategy_id = a.strategy_id AND s.kind = 'cash_settlement'
 WHERE a.data_quality_flags->>'twr_chain_broken' = 'true'
   AND a.computation_status IN ('complete', 'complete_with_warnings');
```

**The durable alternative, for a founder or orchestrator call:** Python persists the suffix start itself. For example, `data_quality_flags.twr_retained_from`, written from `_last_interior_break_suffix(returns).index[0]` beside the flag. That removes the densify condition and the extra read. It is a Python change, outside T1.

## Handoffs (files not mine, fixes need them)

**T3: `src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx`**
1. **H-2 / M-2:** pass `strategy.returns_denominator_config` as the 7th argument of `readSingleKeyBasisOpts`. The composite arm already reads it from the same row. Until then, a single-key `simple` or active-day row on discovery keeps the geometric curve and keeps leverage.
2. **M-3, a user-facing regression until done:** wrap the single-key `readSingleKeyBasisOpts` call in the same `CompositeSeriesReadError` catch the composite arm has.
   - An MTM, smoothed or cash-series read outage now throws, where it used to degrade to cash charts.
   - Uncaught on this uncached page, the throw reaches the discovery error boundary.
   - The existing discovery tests pass, but none drives a single-key series outage.
3. **Optional:** the page's own `dataQuality: singleKeyDataQuality(dqf)` line stays correct, because the owner's result is spread over it. It can be deleted when 169.1-01 lands.
4. **Note:** this page runs `readSingleKeyBasisOpts` per request, with capture on. A defective row (M-1) or an unnamed span (H-1) therefore captures on each discovery view until 169.1-01 moves the page onto the shared build.

**T2: `FactsheetView.tsx` / `MetricsColumn.tsx`.** Render the H-1 caveat from the two fields above.

## Residuals (recorded, not fixed)

- **H-2, day basis:** TypeScript `compute()` has no active-day basis. An `active_day` config's stored Sharpe, Sortino and volatility cannot be matched by any TypeScript-side number. The windows (MTD to 5Y), Years Observed and rolling metrics stay geometric and calendar on these rows. The leverage what-if is withheld (M-2). PROD had 0 such single-key rows on 2026-09-29.
- **H-1, windows:** on a chain-broken row the "3 Year" window, Years Observed and the rolling Sharpe cover the whole series, while the headline covers the suffix. SC4 keeps that split, and the caveat is how the page explains it.
- **Probe cost:** the probe now reads basis series for rows that carry a by-basis object or a chain break. Those reads have no abort signal, like the composite csv read (documented on `probeFactsheetBuildable`).
- **CSV read cost:** a composite read now takes one extra round trip, for the terminating empty page.
- **Sentry volume:** the discovery page captures per request, see T3 note 4.

---

_Fixed: 2026-09-29T18:40:57Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
