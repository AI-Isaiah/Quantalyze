---
phase: 169-pagetruth
reviewed: 2026-09-29T00:00:00Z
depth: standard
files_reviewed: 30
files_reviewed_list:
  - src/app/(dashboard)/allocations/components/HoldingsTable.tsx
  - src/app/(dashboard)/allocations/components/HoldingsTable.test.tsx
  - src/app/(dashboard)/allocations/components/OpenPositionsTable.tsx
  - src/app/(dashboard)/allocations/components/OpenPositionsTable.all-columns.test.tsx
  - src/app/(dashboard)/allocations/components/untrusted-key-status.surfaces.test.tsx
  - src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx
  - src/app/(dashboard)/discovery/[slug]/[strategyId]/page.pending-fallback.test.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.chip-honesty.test.tsx
  - src/app/factsheet/[id]/v2/FactsheetBody.basis.test.tsx
  - src/app/factsheet/[id]/v2/MandatePanels.tsx
  - src/app/factsheet/[id]/v2/MetricsColumn.tsx
  - src/app/factsheet/[id]/v2/MetricsColumn.record-length.test.tsx
  - src/app/factsheet/[id]/v2/MetricsColumn.window-rows.test.tsx
  - src/app/factsheet/[id]/v2/basis-context.tsx
  - src/app/factsheet/[id]/v2/page.tsx
  - src/app/factsheet/[id]/v2/page.composite-read-error.test.tsx
  - src/components/portfolio/RiskAttribution.tsx
  - src/components/portfolio/RiskAttribution.test.tsx
  - src/lib/dollar-validation.ts
  - src/lib/dollar-validation.test.ts
  - src/lib/factsheet/composite-read-path.ts
  - src/lib/factsheet/compute.ts
  - src/lib/factsheet/compute.metrics.test.ts
  - src/lib/factsheet/fetch-and-build-payload.ts
  - src/lib/factsheet/fetch-and-build-payload.test.ts
  - src/lib/factsheet/record-length.ts
  - src/lib/factsheet/record-length.test.ts
  - src/lib/factsheet/types.ts
  - src/lib/types.ts
  - DESIGN.md
findings:
  critical: 0
  warning: 5
  info: 5
  total: 10
status: issues_found
---

# Phase 169: Code Review Report

**Reviewed:** 2026-09-29
**Depth:** standard
**Files Reviewed:** 30 (17 source files plus the tests beside them)
**Status:** issues_found

## Narrative Findings (AI reviewer)

## Summary

The review covered the Phase 169 FACTSHEETTRUTH diff (`origin/main...feat/169-pagetruth`) against the
phase goal. The goals were: one stored CAGR and Sharpe on every surface (D-25), a return window only when
the record covers it (D-11, D-17, D-57), the record length stated one way (D-12), a composite read outage
never cached (D-41, key v7 -> v8, D-62), the risk-attribution percent applied once (D-49), and sub-dollar
money with no signed zero (D-50).

The core mechanics are sound, and each one was checked against its code:
- `compute()`'s `windowReturn` gate.
- The `CompositeSeriesReadError` throw, with its catch in both callers.
- The `unstable_cache` throw-not-store path, the v8 key, and the `factsheet-share` key test that moved with it.
- The strict single-key cash overlay through `readSingleKeyBasisOpts`. Python writes `cash_settlement`
  only on the composite stitch (`job_worker.py:6401-6439`), so the SC-4 raw-key exclusion is safe.
- `signAtCents` rounding. It uses the same half-away-from-zero rule as `toLocaleString`.
- The percent-to-fraction conversion in RiskAttribution.

The snapshot moves were diffed key by key. Only `mtd/ytd/p3m/p6m/p1y` went from the whole-record value to
`null`, and `p3y/p5y` were added. No headline scalar moved.

The tests encode why, and they can fail. The money and percent oracles are typed literals. The chip test's
C-12 rewrite still pins the compute date on its labelled line. Finding C in `FactsheetBody.basis.test.tsx`
still asserts that the row is absent under cash and reads `+554.00%` under MTM.

There are no blockers. There are five warnings. Two are the phase's own contract leaking at an edge: the
single-key headline can still fall back to the recompute (WR-01), and the record length can be stated from
two different summaries on the same page (WR-03). One is a D-11 parameter that yields a false em-dash on
weekday venues (WR-02). One is a new chip contradiction introduced by the D-16 rounding (WR-04). One is the
D-41 outage-caching class that remains open on the MTM and smoothed series reads (WR-05).

Deliberately not flagged, because each is already decided:
- The L=1 to L≠1 CAGR/vol discontinuity on the cash basis (D-25 (i)).
- `read_error` replacing `composite_unbuildable` in the /strategies tally (D-41 consequence a).
- The warning sentence keeping "observations" (D-51's edit cap).
- The discovery page's console-only composite catch (D-41, interim until 169.1-01).
- Comparator alignment (Phase 169.5).

## Warnings

### WR-01: A rankable row with a non-finite stored `cumulative_return` silently falls back to the TypeScript headline (SC4 divergence), and its warning names no cause (known item, weighed)

**File:** `src/lib/factsheet/composite-read-path.ts:615-620`
**Issue:** `persistedCashHeadline` adds a second gate beside `isRankableAnalyticsRow`: `hasBasisHeadline(persistedRow)` must hold, and it needs a FINITE `cumulative_return`. Discovery, recommendations and my-strategies show the stored CAGR and Sharpe for any rankable row, whatever its `cumulative_return` holds. On a `complete` row whose stored `cumulative_return` is null or non-finite (Python `_safe_float` persists null for a non-finite value), the factsheet drops back to the `compute()` CAGR and Sharpe while the lists show the stored ones. That is the exact SC4 contradiction D-25 removes. It is also silent to operators. `missing` is built from `!(serverKey in persistedRow)`, and every key IS present (JSON null), so the log line reads `missing: []` and names nothing. The only signal is a `console.warn`, which does not reach Sentry. The 169-01 SUMMARY ("Decisions Made") records the side effect as accepted. It is weighed here because it breaks the phase's own goal rather than an adjacent one. The comment at `fetch-and-build-payload.ts:642-648`, "the overlay always applies to a row that carries the scalars", also says the opposite of this gate.
**Fix:** Gate on structure only. Require the seven keys to be present, which is the case the gate was added for: a select that stops projecting them. Then let the strict `overlayBasisScalars` render a non-finite `cumulative_return` as "—", as the lists do. When a value is non-finite, log which one:
```ts
const absent = BASIS_KPI_MAP.filter(({ serverKey }) => !(serverKey in persistedRow)).map((k) => k.serverKey);
if (absent.length > 0) {
  console.warn("[factsheet] readSingleKeyBasisOpts — select did not project the headline; keeping the computed one", { strategyId, missing: absent });
  return undefined;
}
const nonFinite = BASIS_KPI_MAP.filter(({ serverKey }) => !Number.isFinite(persistedRow[serverKey] as number)).map((k) => k.serverKey);
if (nonFinite.length > 0) console.warn("[factsheet] persisted headline has non-finite scalars (rendered —)", { strategyId, nonFinite });
```
Add a case in `build-payload.headline-source.test.ts`: a rankable row with `cumulative_return: null` and a finite stored Sharpe renders the stored Sharpe. Then correct the `fetch-and-build-payload.ts:642-648` comment.

### WR-02: The D-11 "cutoff + 1 day" tolerance hides a covered window on weekday venues and on records whose first return is dated the day after inception

**File:** `src/lib/factsheet/compute.ts:193-197`
**Issue:** `windowReturn` returns null when `startDate > cutoff + 1 UTC day`. The tolerance is one calendar day, and the first observation of a covered window does not always land within it:
- A weekday strategy (periodsPerYear 252) whose first return is dated 2 January (1 January is a market holiday) covers the whole year, because no trading day was missed. YTD is still `null`, the em-dash, for the entire launch year, while "Since Inception" shows the same period's return.
- The same happens to MTD in a launch month whose 1st falls on a weekend.
- It happens to 3M/6M/1Y/3Y/5Y whenever the cutoff lands on a Saturday and the record starts the following Monday. Those rows are OMITTED, not em-dashed (D-17/D-57), so the page drops a row the record supports.

This is a D-11 parameter, so it is named here rather than re-litigated. The `it.each` boundary table in `compute.metrics.test.ts` pins exactly "+1 day", so it will move with any fix.
**Fix:** Either (a) derive the tolerance from the calendar the record trades on: for `periodsPerYear === 252`, treat the window as covered when no weekday lies between `cutoff + 1` and `startDate - 1`, which is at most three days across a weekend plus a holiday. Or (b) record this as a D-11 known limit and add a weekday-launch fixture that pins the chosen behaviour, so the next reader sees it was intended. Option (a) needs `compute()` to receive the calendar basis. It already receives `periodsPerYear`, so no new parameter is needed.

### WR-03: The record length is stated from two different summaries on one page when the MTM or smoothed basis is active (SC5 / D-12)

**File:** `src/app/factsheet/[id]/v2/MandatePanels.tsx:33,100` vs `src/app/factsheet/[id]/v2/MetricsColumn.tsx:70,80,92`
**Issue:** D-12 routes all four length sites through `formatRecordLength`, but they read different inputs:
- The Strategy Thesis sentence and the Terms "Sample size" read `payload.strategyMetrics` (the cash series).
- "Years Observed" and the observation warning read `view.strategyMetrics` from `useBasisSeriesView`. Under `mark_to_market` / `smoothed_mtm`, that is `compute()` over the MTM/smoothed series, which `build-payload.ts:513-546` builds from its own `mtmSeries.dailyReturns` with its own `gap_spans`.

When the MTM series has a different count or span from cash (a sparse composite cash series against a denser MTM one, or an MTM series that starts later because marks began later), the page states two lengths at once. For example, "0.45 years, 166 daily observations" in the thesis sits beside "Only 180 observations (0.49y)" in the rail. The formatter is one function, but the record is not one record. No test toggles the basis and compares the thesis with the rail.
**Fix:** Make every site answer the same question. Either read `useBasisSeriesView(usePayload()).strategyMetrics` in `StrategyThesisPanel` and `TermsPanel`, so all four follow the active basis as the Returns rows already do. Or pin all four to `payload.strategyMetrics`, if the record length is meant to describe the cash record regardless of basis. Then add a `FactsheetBody.basis` case whose MTM bundle has a different `n` and `years`, and assert that the thesis text and "Years Observed" state the same years.

### WR-04: The chip's series arm buckets the tone on the fractional age but prints the floored age, so it reads "Track record · old (7d)" and "stale (3d)" for most of each boundary day

**File:** `src/app/factsheet/[id]/v2/FactsheetView.tsx:1234-1241,1279`
**Issue:** `seriesAgeDays` is fractional (`(nowMs - seriesEnd) / 86_400_000`), and the tone is bucketed on it: `> SERIES_STALE_DAYS (7)` gives "old". The printed age is `Math.floor(seriesAgeDays)`. A series ending 7 days ago, read on the afternoon of day 7 (age 7.6), is bucketed "old" and printed "(7d)". The ladder the component documents is "Green ≤ 3d, amber 3-7d, red > 7d", so the chip states a 7-day age under the red "old" verdict. The same applies at 3 days ("stale (3d)"). D-16 introduced this: before 169 the series arm printed no age at all. The chip now contradicts itself on the fact D-16 exists to make honest. D16-1 uses 120 days, and no case sits on a threshold.
**Fix:** Bucket and print one number. The series end is a UTC date, so whole elapsed days is the right unit for both:
```ts
const seriesAgeDays = seriesEnd ? Math.floor((nowMs - new Date(seriesEnd.iso).getTime()) / 86_400_000) : NaN;
// bucketByAge(seriesAgeDays, "series") and ageDays = seriesAgeDays on the series arm
```
Check that the future-allowance arm still reads a same-day-west-of-UTC bar as fresh: floor(-0.4) = -1, which is within `SERIES_END_FUTURE_ALLOWANCE_DAYS = 1`. Add threshold cases at ages 3.6 and 7.6 with fake timers, asserting "stale (3d)" -> "(3d)" under a matching verdict. The exact wording depends on which side of the ladder the founder wants whole days to fall.

### WR-05: The outage-caching class D-41 closes for `csv_daily_returns` stays open for the MTM and smoothed series reads

**File:** `src/lib/factsheet/composite-read-path.ts:105-112,156-162` (`readMtmSeries`, `readSmoothedSeries`), reached from `readCompositeFactsheet` (`:344-347`) and `readSingleKeyBasisOpts`
**Issue:** Both readers turn a failed PostgREST read into `null`, "degrade, never throw". The build then succeeds without `seriesByBasis.mark_to_market` / `smoothed_mtm`. `buildFactsheetPayloadCached` (`page.tsx:139-188`) stores that degraded payload under `["factsheet-v2-payload-v8", id, computedAt]` for the whole analytics run (TTL 3600, stale-while-revalidate, `computed_at` unchanged). For that hour, the MTM toggle on the public factsheet renders the cash series (`basis-context.tsx:246`: `!bundle` returns `payload`) under the MTM label. This is the "one blip becomes the run's cached answer" defect D-41 removed for the csv read, on a sibling read in the same file. D-41's letter names only `csv_daily_returns`, so this is recorded as the rest of the class, not as a D-41 regression.
**Fix:** Make the two series readers distinguish "no row" (`data === null`, a fact, cache it) from "read failed" (`error`, an outage). Throw a sibling error class, or reuse `CompositeSeriesReadError` with a `read` discriminant, and have the resolve stage answer `read_error` for a BUILD, as it does for the csv read. The public cache then throws and stores nothing. If the founder prefers "charts stay cash" to the placeholder for an MTM-only outage, the alternative is to keep the degrade but mark the payload uncacheable (throw from the cached callback, and render the degraded payload uncached from the catch). Either way, add a `page.composite-read-error`-style test for the MTM read.

## Info

### IN-01: Stale comments that describe the single-key path as having no overlay (known item, weighed), plus two new ones

**File:** `src/lib/factsheet/types.ts:579-585`; `src/app/factsheet/[id]/v2/basis-context.tsx:93,351-352`; `src/lib/factsheet/fetch-and-build-payload.ts:642-648`
**Issue:**
- The `metricsByBasis` docblock still says `cash_settlement` is "present on a COMPOSITE payload … ABSENT on a single-key options payload … the cash headline stays byte-identical".
- The `useBasisMetrics` docblock still says "byte-identical to today for single-key". The adjacent `basis-metrics.ts` (`overlayBasisScalars` docblock) and `build-payload.ts` (the cash-overlay comment near `:469-476`) are outside this file list, but they carry the same false premise.
- New in this diff: `basis-context.tsx:351-352` names "a payload cached before Phase 169" as a reachable no-cash-object case. The v8 key bump makes it unreachable.
- New in this diff: `fetch-and-build-payload.ts:647` says the overlay "always applies". WR-01's gate makes that false.

**Fix:** Rewrite each comment to state that a rankable single-key payload carries a `cash_settlement` key built from the persisted top-level scalars (169 D-10), and delete the unreachable "cached before Phase 169" clause.

### IN-02: `metricsByBasis.cash_settlement` is typed `Record<string, number>` but now carries persisted nulls through a cast

**File:** `src/lib/factsheet/composite-read-path.ts:624-626`; `src/lib/factsheet/types.ts:587-590`
**Issue:** `persistedCashHeadline` returns `headline as Record<string, number>` while it deliberately keeps `null` (a stored Sortino with no losing day). Every current consumer (`overlayBasisScalars` and the leverage re-pin loop) checks `typeof v === "number" && Number.isFinite(v)`, so nothing breaks today. A future consumer that trusts the type and does arithmetic would read `null` as 0.
**Fix:** Widen the three per-basis types to `Record<string, number | null>` and drop the cast. The existing finite checks already handle it.

### IN-03: The empty-blend scenario summary renders 6 Month / 1 Year as em-dash rows while 3 Year / 5 Year are hidden

**File:** `src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.ts:148-170` (a 167.1.2-owned file; rendered by `MetricsColumn.tsx:116-117,435-439`)
**Issue:** `emptyComputeSummary()` sets `p6m` / `p1y` to `NaN`, which passes `!= null` and renders "—", and leaves `p3y` / `p5y` absent, which hides the row. A zero-observation blend is shorter than every period, so one panel applies two rules for one reason. The 169-05 SUMMARY classes it as "undefined for another reason" (166.2 D7). No false number is stated, so this is Info.
**Fix:** When 167.1.2 next touches the file, set `p6m`, `p1y`, `p3y` and `p5y` to `null` in `emptyComputeSummary` (MTD/YTD/3M can stay NaN), so the empty blend follows D-57's omission.

### IN-04: DESIGN.md's new Currency row says "One formatter module", but private money formatters remain

**File:** `DESIGN.md:160`
**Issue:** The row names `src/lib/dollar-validation.ts` as the one money module. `src/app/(dashboard)/allocations/components/HoldingDetail.tsx:43` and `src/components/exchanges/AllocatorExchangeManager.tsx:188` still define private `formatUsd` copies. Both format amounts, so their behaviour matches the rule, but the prose over-claims. The next reader looking for a sub-dollar P&L site will trust "one module" and miss them.
**Fix:** Replace the two private copies with the module's `formatUsd`. Or narrow the sentence to "Prices and P&L format through `src/lib/dollar-validation.ts`".

### IN-05: RiskAttribution calls risk shares an "unsigned domain", but a component-risk share is negative for a hedge

**File:** `src/components/portfolio/RiskAttribution.tsx:96-97`; `src/lib/types.ts:1477-1482`
**Issue:** `compute_risk_decomposition` (`analytics-service/services/portfolio_risk.py:122-128`) gives `component_risk = w_i * (Σw)_i / σ`, which is negative for a strategy negatively correlated with the book, and the shares then sum to 100 with one below 0. The display stays correct, because `formatPercent(..., { signed: false })` only suppresses `+` and keeps the minus. The comments and D-49's rationale state a false invariant, though, and no test covers a negative share. The table prints a hyphen-minus ("-12.0%") where DESIGN.md's percentage row uses U+2212, and the stacked bar relies on recharts widening the `[0, 1]` domain.
**Fix:** Correct the comment to "weights are unsigned; a risk share is negative for a diversifier". Add a fixture row with a negative `marginal_risk_pct` and assert that the table cell and the tooltip both show it signed. Decide whether the stacked bar should drop negative segments or render them.

---

_Reviewed: 2026-09-29_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
