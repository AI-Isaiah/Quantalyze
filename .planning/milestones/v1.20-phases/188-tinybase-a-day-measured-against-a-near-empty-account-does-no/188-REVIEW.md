---
phase: 188-tinybase
reviewed: 2026-11-03T22:48:47Z
depth: deep
files_reviewed: 47
files_reviewed_list:
  - analytics-service/services/analytics_runner.py
  - analytics-service/services/broker_dailies.py
  - analytics-service/services/job_worker.py
  - analytics-service/services/nav_marks_apply.py
  - analytics-service/services/nav_twr.py
  - analytics-service/services/tiny_base.py
  - analytics-service/services/transforms.py
  - analytics-service/tests/test_allocator_equity_dropped_day_pnl.py
  - analytics-service/tests/test_mt5_deal_reconstruction.py
  - analytics-service/tests/test_nav_twr.py
  - analytics-service/tests/test_tiny_base.py
  - analytics-service/tests/test_tiny_base_book.py
  - analytics-service/tests/test_tiny_base_derive_flags.py
  - analytics-service/tests/test_tiny_base_marks.py
  - analytics-service/tests/test_tiny_base_quiet_days.py
  - analytics-service/tests/test_tiny_base_realized.py
  - analytics-service/tests/test_tiny_base_roundtrip.py
  - analytics-service/tests/test_tiny_base_runner.py
  - analytics-service/tests/test_tiny_base_venues.py
  - src/__tests__/tiny-base-literal-pin.test.ts
  - src/app/(dashboard)/allocations/AllocationDashboardV2.tiny-base.test.tsx
  - src/app/(dashboard)/allocations/AllocationDashboardV2.tsx
  - src/app/(dashboard)/allocations/AllocationsTabs.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComparePanel.test.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComparePanel.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
  - src/app/(dashboard)/allocations/lib/scenario-adapter.ts
  - src/app/(dashboard)/allocations/lib/scenario-compare.ts
  - src/app/(dashboard)/allocations/lib/scenario-tiny-base.test.ts
  - src/app/factsheet/[id]/v2/FactsheetView.tiny-base.test.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.tsx
  - src/lib/diversification.tiny-base.test.ts
  - src/lib/diversification.ts
  - src/lib/factsheet/allocator-portfolio-payload.test.ts
  - src/lib/factsheet/allocator-portfolio-payload.ts
  - src/lib/factsheet/composite-read-path.test.ts
  - src/lib/factsheet/composite-read-path.ts
  - src/lib/factsheet/headline-basis.test.ts
  - src/lib/factsheet/headline-basis.ts
  - src/lib/factsheet/types.ts
  - src/lib/queries.my-allocation.test.ts
  - src/lib/queries.ts
  - src/lib/scenario.tiny-base.test.ts
  - src/lib/scenario.ts
  - src/lib/tiny-base-flag.test.ts
  - src/lib/tiny-base-flag.ts
findings:
  critical: 2
  warning: 4
  info: 0
  total: 6
status: issues_found
---

# Phase 188: Code Review Report

**Reviewed:** 2026-11-03T22:48:47Z
**Depth:** deep
**Files Reviewed:** 47 (scope: `git diff 1490ece41..846fee13e -- . ':!.planning'`, head `846fee13e`)
**Status:** issues_found

## Summary

Scope was the phase's 47 non-planning files, read against 188-CONTEXT D-01..D-09, the `### Phase 188`
ROADMAP entry and the 188-01..188-10 SUMMARYs. Only MEDIUM and above are reported. Severity mapping:
HIGH = Critical (BLOCKER), MEDIUM = Warning.

Things that hold up under review:
- The threshold and window agree on both sides. `TINY_BASE_FRACTION` / `TINY_BASE_WINDOW_DAYS` in
  `tiny_base.py` match `TINY_BASE_PERCENT` / `TINY_BASE_WINDOW_DAYS` in `tiny-base-flag.ts`, and the
  literal-pin test checks them.
- The note copy matches the spec string.
- `chain_linked_twr` judges on `prev` with `pnl_t = cur - prev - flow_t`, and the window (t-30..t-1) is
  consistent.
- `apply_marks` rule 15 keeps the P&L in `writer_day_pnl`, and the per-key compose sits the key out of
  the day.
- The scenario engine, the SSR baseline, the compare columns and the diversification axis all read the
  same per-key lists.

Two paths still break the rule. The composite stitch turns a marked-era tiny day into a 0% day in its
stats. The realized-era guard bool, and the chain break it causes, reach a marked key's factsheet
even though that key's published series has no break.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: Composite stitch scores a marked-era tiny day as a flat 0% day in its stats (HIGH, data-integrity + user-facing)

**File:** `analytics-service/services/nav_marks_apply.py:578`, `analytics-service/services/job_worker.py:607-640` (`_composite_mark_summary`), `analytics-service/services/job_worker.py:12134-12137`
**Issue:** Rule 15 drops a withheld mark day, and its T-GAP days, from `returns`. Line 578
(`emitted = {d for d, _ in rows} | set(tiny)`) also keeps those days out of `covered_days`. A composite member runs
`apply_marks` itself, at about lines 10852 and 10995. `_composite_mark_summary` only unions `covered_days` and
`mark_gap_days`, so the member's tiny days reach the stitch as plain absent days. The composite then builds its
scalar input as `_scalar_input_without_covered_days(gap_fill_daily_returns(stitched_cash), _covered)`, and this
0.0-fills every absent day that is not covered. The function's own docstring says so: "every other absent day was 0.0-filled ... and stays so".
Scenario: a composite has a member with key C's shape (a mark on 10-26, then withheld marks on 10-27 and 10-28).
The composite's CAGR, volatility, Sharpe and drawdown then count those two days as 0% observations. Before this
phase they counted +47% and -53%. This is the "fake return" D-02 forbids, and the stats are not "not counted".
The composite job also never writes `tiny_base_days` into `merged_flags`, so the composite factsheet shows no
note either. `test_tiny_base_marks.py::test_the_composite_summary_names_none_of_the_withheld_days` pins the
omission in place, which makes it look intended. KL-2 covers only the chart seam, not the stats.
**Fix:** Add `tiny_base_days` to `_CompositeMarkSummary` (the members' `marked.tiny_base_days` inside each
member's window). Remove those days from the scalar input next to `_covered`:
```python
scalar_returns=_scalar_input_without_covered_days(
    gap_fill_daily_returns(stitched_cash), (*_covered, *_mark_summary.tiny_base_days)
),
```
Then carry the list into `merged_flags["tiny_base_days"]` (present-only), so the note appears.

### CR-02: Realized-era `tiny_base_guard` and `twr_chain_broken` are stamped on a marked key whose published series is unbroken, so the headline is withheld (HIGH, user-facing)

**File:** `analytics-service/services/job_worker.py:9601-9603` (guard loop), `analytics-service/services/job_worker.py:9671-9675` (the list is cut at `marks_since`), `analytics-service/services/analytics_runner.py:2228-2232`, `src/lib/factsheet/headline-basis.ts:113-125`
**Issue:** The realized combiner judges the whole realized history, including the days after the key's
first mark. A key emptied on or after its first mark (key C was emptied on its first mark day, 10-26) gets
realized-era NaN tiny days inside the marked era. `tiny_base_day_list` cuts those days from the stored list
at `marks_since`. The bool `tiny_base_guard` is not cut, and neither is the `twr_chain_broken` that
`cumulative_twr_segmented` raises once a valid realized day follows the NaN days. Both ride the prestamp's
`NAV_TWR_GUARD_KEYS` loop. A valid day follows either when the 30-day peak leaves the window (the D-03
"new normal") or when the account is refunded. The runner carries `twr_chain_broken` verbatim from the
prestamp (`analytics_runner.py:2229-2232`). It computes `headline_since` from its own series, and in the
marked era tiny days are absent and "break no chain", so `headline_since` stays None.
`readHeadlineBasis` then returns `withheld: true`. The single-key factsheet hides its headline scalars and
shows the "near-zero balance" reason for a break that the published series does not have. Even before a
break is raised, the row becomes `complete_with_warnings` with an empty `tiny_base_days`, so it warns
without naming a day. Guard days in the marked era are an older problem of the same class (dust), but 188
makes this the default outcome for the phase's own scenario on any strategy-linked key.
**Fix:** When `_applied_marks` is set, judge the guard flags only on the days before `marks_since`. For
example, raise `tiny_base_guard` only when `_tiny_listed_days` is non-empty. Recompute `twr_chain_broken`
from the realized returns cut at `marks_covered_from`, instead of lifting it from the full-history meta:
```python
if _applied_marks is not None:
    _prestamp_flags.pop("tiny_base_guard", None)
    if _tiny_listed_days:
        _prestamp_flags["tiny_base_guard"] = True
```
Add a derive test: a key with marks, realized tiny days only on or after `marks_since`, and a later valid
realized day. It must stamp neither flag.

## Warnings

### WR-01: A native-unit (BTC) MT5 key's unpriced tiny day stores a BTC amount as `pnl_usd` (MEDIUM, data-integrity)

**File:** `analytics-service/services/job_worker.py:8816-8858`
**Issue:** The fallback block takes `realized_tiny_base_pnl(meta.get("tiny_base_day_pnl"), ...)` for
every NaN tiny day that `dropped_day_pnl` does not already hold. Its comment (8812-8815) assumes that on MT5
the writer's P&L holds every measured tiny day. For a native key that is wrong. `_day_pnl_usd` is
`_usd_key.day_pnl`, and `_convert_native_key_to_usd` drops any day without a stored close ("an unpriced day
drops out"). It drops the live tail too, whose close is not stored yet. `combine_mt5_deal_ledger` ran on the
NATIVE ledger, so `meta["tiny_base_day_pnl"]` holds BTC.
Scenario: a BTC MT5 account is emptied, and its latest measured tiny day has no close yet. The block writes
`{"utc_day_iso": d, "pnl_usd": 0.0123}`. That is 0.0123 BTC, which `read_dropped_day_pnl` reads as $0.0123.
**Fix:** Skip the fallback when `_native_key_usd` is true, except for quiet days (amount 0.0, which means the
same in any unit). Alternatively, price the native amount at the day's close, and leave the day out when
there is no close, with a counts-only warning.

### WR-02: Strategy legs still read a tiny day as 0% (KL-5), and this phase made those days newly absent (MEDIUM, user-facing)

**File:** `src/lib/scenario.ts:480` (`d >= from ? (map.get(d) ?? 0) : 0`), `src/app/scenario-share/[token]/share-resolve.ts:418`, `src/lib/scenario.ts:855`, `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` (added-strategy merge)
**Issue:** Before 188, a strategy-linked key's measured tiny day had a stored row (for example +47%). Now
it has none. A published strategy leg carries no `undefined_return_days`, so wherever another leg puts that
day on the axis, the engine 0-fills it at the strategy's full weight. That happens in a composer blend with
an added strategy, in the public share page, and in the portfolio overlay built at `scenario.ts:855`. The
result is the "never a 0%" violation that D-02 and D-07 rule out. The day list is already stored on
`strategy_analytics.data_quality_flags.tiny_base_days`. KL-5 is an executor-recorded limit, not a founder
decision.
**Fix:** Read `data_quality_flags.tiny_base_days` through `readTinyBaseDays` wherever strategy legs are
built (the strategies read that feeds the composer's added units, `share-resolve.ts` and the overlay), and
set `undefined_return_days` on the leg. Otherwise route it as a decision to the founder.

### WR-03: A malformed `tiny_base_days` list is dropped without any signal, and the scenario then reads the day as 0% (MEDIUM, data-integrity + user-facing)

**File:** `src/lib/queries.ts:4216-4217`, `src/lib/factsheet/composite-read-path.ts:610`, `src/lib/factsheet/allocator-portfolio-payload.ts:162`
**Issue:** When `readTinyBaseDays` gets a list it does not accept, it returns `[]`, and none of its three
callers logs or reports this. In `readMarksStart`, a corrupt `key_inputs.tiny_base_days` gives the key no
entry. The SSR baseline, the composer, the compare panel and the diversification panel then 0-fill that
key's tiny days. Those days are absent from its stored series, and other keys put them on the axis. The book
note also disappears. Nothing records that any of this happened. The failed-read path (KL-4) does log and
send to Sentry, but the UI shows the same 0% arithmetic and gives no sign of it. The Python twin
`_read_navmtm_flags` warns on a malformed list, so the TypeScript side does not match it.
**Fix:** In `readMarksStart`, when the raw value is present and not null but `readTinyBaseDays` returns
`[]`, emit one `console.warn` plus a `captureToSentry` (tag `reason: "tiny_base_days_malformed"`, key id only,
no value). Do the same in `singleKeyDataQuality`. Consider marking the scenario KPIs as degraded for a key
whose list could not be read, so they are not shown as exact.

### WR-04: The compare-panel wiring in `AllocationsTabs` cannot fail a test, and the compiler does not gate it either (MEDIUM, data-integrity)

**File:** `src/app/(dashboard)/allocations/AllocationsTabs.tsx:1176`
**Issue:** The executor reported this and it is confirmed. Deleting
`tinyBaseDaysByApiKeyId: props.tinyBaseDaysByApiKeyId` leaves every `AllocationsTabs*` test green.
`AllocationsTabs.scenario-composer.test.tsx` mocks `ScenarioComparePanel`, and its `SavedScenariosList` mock
does not expose `onCompare`. The CF-05 comment above this block (1153-1161) says that deleting a field here
"fails the build". That holds only for required fields, and the panel declares this one optional
(`ScenarioComparePanel.tsx` props). If the line regresses, the compare panel's live-book and saved-draft
columns 0-fill tiny days, while the composer and the SSR baseline next to them do not. The screen would
then disagree with itself, which D-07 exists to prevent.
**Fix:** Add one arm to `AllocationsTabs.scenario-composer.test.tsx`. Expose `onCompare` in the
`SavedScenariosList` mock, capture the `payload` prop of the `ScenarioComparePanel` mock, and assert
`payload.tinyBaseDaysByApiKeyId` equals the dashboard prop. Check that the arm goes RED when the line is
neutered. Alternatively, make the field required in `ScenarioComparePanelProps["payload"]` so the compiler
gates it.

---

_Reviewed: 2026-11-03T22:48:47Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

## Round 2

**Reviewed:** 2026-11-04T05:00:08Z
**Scope:** `git diff 7fcbd5bfe..HEAD -- . ':!.planning'` at head `621111e3e`, 25 files, the 7 fixer commits for
round-1 findings 1 to 6 and SFH-4. Read against 188-CONTEXT D-01..D-09. MEDIUM and above only.
**Measured at head:** `npx tsc --noEmit` is clean. 342 pytest passed (`test_tiny_base_derive_flags`,
`test_nav_marks_composite`, `test_tiny_base_marks`, `test_tiny_base_runner`, `test_mt5_deal_reconstruction`).
1011 vitest passed across the 10 changed test files.

### Closure of round-1 findings

| Round-1 | Verdict |
|---|---|
| CR-01 / HIGH-1 composite stats | **Closed.** Marked-era tiny days, T-GAP days included, leave the scalar input (`job_worker.py:12165-12166`). They stay in `gap_spans` (not passed as `covered_days`), so the composite keeps its "no data" marker (D-06). The headline is persisted from this cache, and `analytics_runner` does not recompute it (`analytics_runner.py:1991-1993`). See R2-01 for what the marked-only list does once the new strategy-leg readers consume it. |
| CR-02 / HIGH-2 guard and break | **Closed, with one regression (R2-02).** |
| WR-01 / MEDIUM-3 BTC amount as dollars | **Closed.** No day goes silently missing because of this change. An interior measured day with no close is already in `unpriced_days` (`_convert_native_key_to_usd`, `job_worker.py:3965-3968`), and the compose replays the key in segments around it. A live-tail day (after the last stored close) is not listed. Every live-tail day, tiny or not, is handled by the D-17 anchor rules (`unpriced_close_day`, departed end). The new comment at `job_worker.py:8832-8835` says the day "is named in `unpriced_days`". That is wrong for the live tail, but it is only a comment (below MEDIUM). |
| WR-02 / MEDIUM-4 strategy legs | **Closed for single-key strategies. Open for composite legs (R2-01).** `computeCompositeCurve` (round 1's `scenario.ts:855`) has no production caller, so it is moot. |
| WR-03 / MEDIUM-5 silent rejection | **Closed.** |
| WR-04 / MEDIUM-6 compare wiring | **Closed.** T_AT5d captures the panel's `payload` and asserts the field. |
| SFH-4 | **Closed, and safe.** `dropped_day_pnl_payload` emits a row only for a NaN index day. Every legitimate tiny day is a NaN on that index. That covers OKX, Deribit and MT5 quiet days, `apply_marks` pre-mark rows (`_input_days` keeps NaN), and a native key (`formed.reindex(native_returns.index)` keeps the day as NaN). The new raise fires only on a real combiner contradiction. |

### The fixer's three judgment calls

1. **Composite note names only marked-era days.** This is correct for the composite's own stats and chart under
   D-04 and D-06. It is not correct for the list's second consumer. See R2-01.
2. **`twr_chain_broken` recomputed from the published series for every cause.** This is safe and hides no
   real realized break. `apply_marks` keeps every pre-mark row, NaN included (`nav_marks_apply.py:228-246`,
   `pre = [... if d < start]`). So a realized break of any cause (dust, negative NAV, pnl-dominated, coverage,
   tiny) whose NaN lies before `marks_since` is still in `returns`, and `cumulative_twr_segmented(returns)[1]`
   re-raises it. Only a break whose NaN days the marks replaced is dropped, and the published series truly
   has none of those. The `meta.get("twr_chain_broken") and` conjunct (`job_worker.py:9694`) means a break that
   exists only in the published series is never raised. One example: realized NaNs that run to the realized
   end, with valid marks after them. The code behaved the same way before this round, so it is not a
   regression. The other guard bools (`dust_nav_guard` and the rest) are still lifted from the full-history
   meta. That is the older same-class issue round 1 already named, so it is not re-raised here.
3. **MEDIUM-4 scope widened to the dashboard payload and `/api/strategies/[id]/returns`.** No leak. The new
   field (`route.ts:543`) is emitted after the same `withPublishedOrOwner` probe as `daily_returns`, and it is
   read through the caller's RLS client. A non-owner of an unpublished strategy still gets a 404. A published
   strategy's days are already public through its factsheet note (`FactsheetView.tsx:2117-2129`). The field is
   ISO days only. It is emitted even on a non-rankable row, where `daily_returns` is `[]`, but that exposes only
   days, so it is below MEDIUM. On the share page the list stays server-side. It feeds the blend inside
   `resolveSharedScenario` and is never passed to a client component.

### New-defect checks requested

- **`resolveSharedScenario` trailing argument:** there is one production caller, `page.tsx:335`, and it is updated.
  The positional order matches the signature. The test callers omit the optional argument. `tsc` is clean.
- **Throttle token widened:** `"tiny_base_days_malformed"` is its own key, `${allocatorId}:tiny_base_days_malformed`, so
  it cannot suppress the derived-row tokens. The key-level read (`queries.ts:4231`) and the strategy-level read
  (`queries.ts:6399`) share one window per allocator, so the second class reaches only `console.warn` for 6 h. This
  is acceptable for a throttle and is below MEDIUM.
- **BTC MT5 fallback skips non-zero amounts:** no day goes silently missing because of the skip (see the WR-01
  row above).

### R2-01: A composite strategy leg reads its members' realized-era tiny days as 0% (MEDIUM, user-facing)

**File:** `analytics-service/services/job_worker.py:12797-12802` (the composite list is marked-era only),
`src/lib/queries.ts:6399`, `src/app/api/strategies/[id]/returns/route.ts:543`,
`src/app/scenario-share/[token]/page.tsx:308`, `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:2876`,
`src/lib/scenario.ts:480`
**Issue:** MEDIUM-4 made `strategy_analytics.data_quality_flags.tiny_base_days` the list of days that a
strategy leg sits out. For a single-key strategy that list holds the realized-era days before `marks_since`
plus the marked days, so the leg sits out every day its stored series dropped. For a composite, HIGH-1 writes
only the members' marked-era days. A member's realized-era tiny day is a NaN in `stitched_cash`. It becomes a
chain break, so no row is stored for it, and it is never named. The member metas that name it are available
in the stitch (`member_metas`, `job_worker.py:12672`) but are not used.
Scenario: a composite member was emptied before its first mark. Before 188 the day was stored as, for
example, +47%. Now it has no row and no name. When the composite is added to a composer blend, a compare
draft or a public share, any other leg that has that date puts it on the axis. Then
`map.get(d) ?? 0` scores the composite leg at 0% with full weight. That is the "never a 0%" outcome D-02 and
D-07 rule out, and the same leg built from a single-key strategy does not do this.
**Fix:** Keep the composite's scalar exclusion marked-era only, as it is now, since D-04 handles realized
days as breaks. Separately, publish the members' realized-era days (each member's
`meta["tiny_base_days"]` inside its window and before that member's `marks_since`) in the list the leg readers
consume. Either union them into `merged_flags["tiny_base_days"]`, which also puts them in the note (D-02 names
every left-out day), or write a sibling list read only by the leg readers. Add a composite arm to
`scenario-strategy-tiny-base.test.ts` that goes RED today.

### R2-02: The HIGH-2 guard cut drops `tiny_base_guard` for a realized tiny day the published series still holds (the closed-mandate W2 tail) (MEDIUM, data-integrity + user-facing, narrow)

**File:** `analytics-service/services/job_worker.py:9690-9693`, with `job_worker.py:8412-8447` (W2 tail) and
`services/tiny_base.py:114-117` (the cut)
**Issue:** The new block assumes that "from the first mark on the realized rows are replaced by the marks".
For an allocated strategy whose mandate has closed, that is false. NAVMTM plan 16 concatenates the realized
rows in (last applied mark, `mandate_end`] back into `returns` verbatim, and `_tail_without_open_profit` keeps
their NaNs. A realized tiny day there is a NaN in the published series, but it falls on or after
`marks_since`. So `tiny_base_day_list` leaves it out of the list (an older gap), and the new code now also
drops the guard bool, which used to come from the meta. Meanwhile `cumulative_twr_segmented(returns)` still
sees that NaN. Scenario: a mandate ends with a withdrawal, and the last in-window mark is two or more days
before `mandate_end`. The tail day after the withdrawal day is measured against under 5% of the 30-day peak,
so it is NaN and gets no stored row. Before this round the row warned without naming the day, the defect
round 1 named. Now it reads `complete`, with an unnamed hole and no note. If a valid tail day follows the
NaN, the row also carries `twr_chain_broken` with no `tiny_base_guard` and no named day, so the headline is
withheld or restarted with no near-zero-balance reason. It is narrow because daily marks keep the tail short.
**Fix:** Judge the guard and the list on the published series, not on `marks_since` alone. Count as realized
any meta tiny day that is a NaN index day in the final `returns`: the pre-mark rows plus the W2 tail rows.
```python
_published_nan = {ts.date().isoformat() for ts in returns.index[returns.isna().to_numpy()]}
_realized_kept = [d for d in (meta.get("tiny_base_days") or ()) if d in _published_nan]
if _realized_kept:
    _prestamp_flags["tiny_base_guard"] = True
```
Feed `_realized_kept` to `tiny_base_day_list` in place of the `marks_since` cut. Add a derive arm with a closed
mandate whose tail holds a tiny NaN day, asserting both the guard and the named day.

### Round 2 tally

MEDIUM 2 (R2-01 user-facing; R2-02 data-integrity + user-facing, narrow). HIGH 0. All seven round-1 items are
closed except the composite-leg remainder of MEDIUM-4 (R2-01). No money-math regression was found, and no
D-04 era-split regression in the single-key or composite headline.

_Reviewed: 2026-11-04T05:00:08Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep (round 2)_

## Round 3

**Reviewed:** 2026-11-04T07:01:41Z
**Scope:** `git diff 7443ead02..2793d980e -- . ':!.planning'` at head `2793d980e`, 10 files: the fixes for R2-01,
R2-02, SFH-1, SFH-2 and SFH-3. MEDIUM and above only.
**Measured at head:** 58 pytest passed (`test_tiny_base_derive_flags`, `test_nav_marks_composite`,
`test_computation_error_curated`). 296 vitest passed (`returns/route.test.ts`, `scenario-share/[token]/page.test.tsx`,
`queries.my-allocation.test.ts`).

### Closure

| Item | Verdict |
|---|---|
| R2-02 (single-key guard and list) | **Closed.** `_realized_tiny` is the set of meta tiny days that are NaN index days of the final `returns` (`job_worker.py:9715-9716`). That covers the pre-mark rows and the closed mandate's W2 tail. When no marks are applied the input is unchanged (`:9704`). The runner change is an improvement: a named W2-tail day leaves `_covered_days` (`analytics_runner.py:2083-2085`). Before, it was falsely "covered by the next mark"; now it is a flagged gap span. It stays out of the scalars and breaks no chain in the recompute, which matches D-06. There is no money-math change, and `twr_chain_broken` is unchanged. |
| R2-01 (composite leg) | **Closed for the pre-mark era. Open for a closed member's tail (R3-01).** The composite scalar input still uses `_mark_summary.tiny_base_days` only (`:12189`). The realized days stay NaN breaks in `stitched_cash`, so D-04 holds. `gap_spans` is unchanged, so D-06 holds. The note now names the realized days too, which is what D-02 asks for and matches the single-key list. `zip(clipped_cash, member_metas, strict=True)` is safe because both are appended together at `:11843-11850` and `:11960-11963`. |
| SFH-1 | **Closed.** Both key-mode epilogue calls are wrapped (`:9075-9078`, `:9401-9404`) and give a permanent FAILED with a scrubbed message. The raises come before the `key_inputs` upsert, so nothing is half-written. The census test now expects 5. Other `NavReconstructionError`s from the epilogue (`_assert_iso_day_index` in the payload builders) now also land here, with a "tiny-base or dropped day" detail that does not fit them. That only affects the log and result text, since key mode has no stamp row. It is below MEDIUM. |
| SFH-2 | **Closed.** The route is throttled per strategy id. The share page is not throttled, so a malformed stored list sends one Sentry event per view of a public share. That is below MEDIUM. Neither path leaks the value. |
| SFH-3 | **Closed.** The key and strategy tokens are now separate. |

### Fixer's open observation (key mode: `_tiny_since` cut)

**Not reachable, no finding.** A W2 tail exists only when `_returns_are_allocated` is true
(`job_worker.py:8412-8416`). That flag is `venue == "deribit" and denominator_config is not None` (`:5020`), and
`denominator_config` is forced to `None` in key mode (`:4995-4998`, `if not is_key_mode`). So key-mode `returns`
is exactly `apply_marks(...).returns`: the pre-mark rows `d < marks_since` with their NaNs kept
(`nav_marks_apply.py:478-481`), followed by the marked rows. The `marks_since` cut and the NaN-in-final-returns rule
pick the same days. If a future change ever made them differ in the P&L direction, the SFH-4 refusal
(`:8875-8880`) would turn it into a terminal failure, now disposed through SFH-1, not a silent r=0. Severity: none
today. It becomes R3-01's class if key mode ever gains a tail.

### R3-01: A closed composite member's W2-tail tiny day is still unnamed, so its leg reads 0% (MEDIUM, user-facing, narrow)

**File:** `analytics-service/services/job_worker.py:12829-12836`, with the member tails at `:10928-10956` (ccxt and
unallocated Deribit, `tail_from < d < window_end`) and `:11071-11097` (allocated, `tail_from < d <= tail_to`)
**Issue:** The R2-01 fix uses the same `marks_since` cut that R2-02 showed is wrong for a closed series. When a
member's window or mandate has closed, `_apply_member_marks` and `_apply_allocated_member_marks` keep its realized
rows after the last applied mark verbatim. `_tail_without_open_profit` only rewrites the first valid row, so NaNs
survive. The stitch keeps them (`stitch_composite.py`, a plain `pd.concat`). A realized tiny day in that tail is a
NaN in `stitched_cash`, so no row is stored for it. But it is on or after the member's `marks_since`, so
`tiny_base_day_list(meta, _tiny_cut)` drops it. It is not a marked day either, so `_mark_summary` does not list it.
**Scenario:** A composite rotates away from member 1. Its account was drawn down to under 5% of its 30-day peak
(still above the dust floor) a few days before `window_end`, and its last stored mark is from before those days.
The tail days are NaN and get no row, and `merged_flags["tiny_base_days"]` does not name them. Then the composer,
the compare panel or a public share puts that date on the axis through another leg, and `map.get(d) ?? 0` scores
the composite leg at 0% with full weight. The factsheet note also leaves the day out. This is the D-02/D-07 outcome
that R2-01 and R2-02 each closed on their own path. It is narrow because daily marks keep a tail short.
**Fix:** Apply R2-02's rule to the composite. Name a member's meta tiny day when it is inside the member's window
and is a NaN day of the stitched series, rather than cutting at `marks_since`:
```python
_stitched_nan = {ts.date().isoformat() for ts in stitched_cash.index[stitched_cash.isna().to_numpy()]}
for (_tiny_seq, _), _tiny_meta in zip(clipped_cash, member_metas, strict=True):
    _tiny_lo, _tiny_hi = _window_by_seq[_tiny_seq]
    _listed_tiny.update(
        d for d in tiny_base_day_list(_tiny_meta.get("tiny_base_days"), None)
        if d >= _tiny_lo and (_tiny_hi is None or d < _tiny_hi) and d in _stitched_nan
    )
```
Add a composite arm in which a closed-window member has a marked era and a tiny NaN day in its tail, and assert
that the day is in `flags()["tiny_base_days"]` and absent from `csv_rows()`.

### Round 3 tally

MEDIUM 1 (R3-01, user-facing, narrow). HIGH 0. R2-02, SFH-1, SFH-2 and SFH-3 are closed. R2-01 is closed except for
the closed-member tail (R3-01). No regression was found in money math, the D-04 era split, the composite scalars
or the D-06 gap marker. The key-mode observation is not reachable.

_Reviewed: 2026-11-04T07:01:41Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep (round 3)_

## Gap closure review, round 1 (2026-11-05)

**Scope:** `git diff 3e7547bd2 HEAD -- . ':(exclude).planning'`: `analytics-service/services/job_worker.py`
(`_tiny_base_days_stored`, `_reconcile_hull`, the reconcile span), `analytics-service/tests/test_tiny_base_reconcile.py`
(new), `src/lib/scenario.ts` (docstring only). Read against `188-VERIFICATION.md` gaps 1 to 3, CONTEXT D-10, D-11 and
D-12, `188-13-PLAN.md` and `188-13-SUMMARY.md`. MEDIUM and above only.

**Method:** I read the code, then probed each finding through the module's own harnesses (`derive_key_ccxt`,
`_derive_strategy`, `compose_curve`). The probes were throwaway files in the session scratchpad, run with
`python -m pytest -p tests.conftest` from `analytics-service/`, and none was kept. No source file was changed.

### Checks that came back clean

- **Retention-windowed venues.** A stated day never comes before the first day of the combiner's window. The NAV
  core names only index days and the quiet days strictly between two index days (`nav_twr.py`, `quiet_carried`).
  `_leave_out_tiny_base_days` only turns days into NaN, and the DQ-02 terminus also only turns days into NaN
  (`apply_flow_coverage_terminus`), so no stated realized day lies before the first day of `returns`. The marked
  tiny days lie on or after `covered_from`, inside the marked era. So the hull can extend before
  `returns.index.min()` only into days the marks own. It never reaches the older rows a retention-windowed
  venue keeps.
- **Per-axis `eq` scope.** Unchanged. `_reconcile_span_delete` still adds `eq` on `api_key_id` or `strategy_id`.
- **The three lists agree.** Both stored-list sites and the hull call the same helper on the same
  `(meta, returns, _applied_marks)`. Nothing rebinds `returns` or `meta` between the reconcile (`job_worker.py:10004`)
  and the strategy pre-stamp (`:10398`). The key-mode epilogue runs after the reconcile, and the key branch of the
  helper does not read `returns`. In key mode with marks, the realized days before `marks_since` are NaN entries in
  `pre`, because `_input_days` keeps NaN, so they are in the index. In strategy mode the R2-02 filter matches the
  guard block's own `_realized_tiny` expression exactly.
- **`ValueError` path.** `_reconcile_hull` cannot get two empty inputs. Both the key and strategy branches return
  at the `< 2` interpretable-days gate (`:9703`) before the reconcile, so the index holds at least 2 entries. A
  `ValueError` from `tiny_base_day_list` on a malformed meta day now fires before the first upsert instead of
  after the write (strategy pre-stamp) or in the epilogue (key mode). That moves it to the side where a refusal
  costs nothing, so it is not a regression.
- **Tests bite.** The RED runs (red1, red2) and neuter1 to neuter3 in the SUMMARY match the arms' assertions. The
  stated-list equality checks (`== TINY_DAYS`, `== LEAD_STATED`) stop a run that states no days from passing
  vacuously. The one gap is below: the leading-edge fixture seeds a set of stale rows that an earlier derive would
  not have left (GC1-01).

### GC1-01: The hull covers the stated days, not the whole span the marks own, so a stale row on the first mark day (or a trailing unmeasured mark day) survives and is published (MEDIUM, data-integrity + user-facing)

**File:** `analytics-service/services/job_worker.py:10004-10007`. Mechanism in
`analytics-service/services/nav_marks_apply.py:481, 531, 545-575`. Consumer: `analytics-service/services/analytics_runner.py:2047-2060`.

**Issue:** From the first mark on, the marks own every day, and Pitfall 7 means no realized row dated on or after
the first mark is ever emitted. When `pre` is empty, `covered_from` is the first mark day `S`. That day has no base,
so it gets no row, and it is not tiny, so it is not stated either. The hull therefore starts at the first stated
day (`S+1`) and leaves `S` outside it. A realized row that an earlier, pre-marks derive stored on `S` survives. I
reproduced this with the module's own leading-edge fixture plus `csv[S] = 0.05`, which is the row a pre-marks derive
over `LEAD_REALIZED` (03-06..03-11) would have written:
- Key mode: after the derive the rows are `{03-06: 0.05, 03-10: ..., 03-11: ...}`. The book reads `[]` and is
  trustworthy because the compose ignores 03-06, but the stale row stays on the key's axis.
- Strategy mode: after the derive the rows are `{03-06: 0.05, 03-10: ..., 03-11: ...}`, with
  `marks_covered_from = "2026-03-06"`. The series runner uses rows dated on or after `marks_covered_from` as
  stored (`analytics_runner.py:2048-2060`, "Rows on or after it are used as stored"). So a fabricated +5% day is
  published in the factsheet with no flag.

The same mechanism applies at the tail. When the LAST mark's base is not usable (dust after a withdrawal,
`nav_marks_apply.py:545` `usable(base)` false), that mark day and its gap days get no row and are not stated.
`returns.index.max()` is then the previous measured mark, and a stale row on the last mark day survives. I read
this case from the code and did not run it.

This defect existed before this diff (the old span also missed these days), but it is the same class.
VERIFICATION gap 1 flagged it as "Also unmeasured", and the plan claims a root-cause fix for "the leading edge" with
"one rule". The test misses it because `LEAD_STALE` seeds 03-07..03-09 but not 03-06, even though the module
docstring says the stale rows come from "an earlier derive".

**Fix:** Make the hull span the marked era as well as the stated days. Those days are this run's own judgement,
and the marks own them by construction.
```python
_named = _tiny_base_days_stored(meta, returns, _applied_marks, key_mode=is_key_mode)
if _applied_marks is not None and _applied_marks.covered_from is not None:
    assert _applied_marks.terminal is not None
    _named = [*_named, _applied_marks.covered_from, _applied_marks.terminal[0]]
_span_start, _span_end = _reconcile_hull((ts.date().isoformat() for ts in returns.index), _named)
```
`covered_from` is `pre[-1] + 1` or `S`, so it is never before the realized window. The retention guarantee holds.
Add `"2026-03-06": 0.0` (or a non-zero value) to `LEAD_STALE` so that both leading-edge arms' `set(rows) ==
set(LEAD_ROWS)` assertions fail on the current hull. Add a key arm in which the last mark's base is at or below
the dust floor.

### GC1-02: The key-mode `< 2` short-circuit returns DONE with stated days and `dropped_day_pnl`, but it keeps the stale rows on those days, which is the gap-2 `key_inputs_mismatch` (MEDIUM, data-integrity + user-facing)

**File:** `analytics-service/services/job_worker.py:9703-9731`. The key branch calls `_run_key_mode_compose_epilogue()`
and returns DONE without any `csv_daily_returns` write or delete.

**Issue:** The plan's first must-have truth says: "after a derive returns DONE, no `csv_daily_returns` row of that
scope sits on a day the derive's own stated list names." The SUMMARY records this branch as out of scope because it
is "not reachable for keys C, k1 or k2". That argument covers those three keys only. Any young key reaches it once
its marks replace its realized rows and leave fewer than 2 measured mark rows. I reproduced it with marks 03-06 =
100000, 03-08 = 588 and 03-10 = 100800, the flows of `LEAD_FLOWS`, the derive at 03-11 00:10Z, and stale rows that
a pre-marks derive left on 03-06..03-09. The result:
- The outcome is `DONE`.
- `key_inputs.tiny_base_days` is `["2026-03-07", "2026-03-08"]`.
- `dropped_day_pnl` holds 03-07 = 0.0 and 03-08 = 188.0.
- The stored rows are unchanged: `{03-06: 0.0, 03-07: 0.0, 03-08: 0.47, 03-09: 0.001}`.
- `compose_curve` returns `degrade_reasons == ["key_inputs_mismatch"]` and `is_trustworthy False`.

That is VERIFICATION gap 2's symptom, now produced by a path this phase writes (the stated list and the tiny
`dropped_day_pnl` are both 188 additions to this epilogue). The book degrades loudly and falls back to the legacy
curve. It does not corrupt silently.

**Fix:** The minimum change: in the key-mode branch of the `< 2` gate, before the epilogue, delete the stated days on
the key's axis. That keeps the branch's "no upsert" contract.
```python
_stated = _tiny_base_days_stored(meta, returns, _applied_marks, key_mode=True)
for _dstart in range(0, len(_stated), _RECONCILE_DELETE_IN_BATCH):
    _days = _stated[_dstart:_dstart + _RECONCILE_DELETE_IN_BATCH]
    await db_execute(lambda d=_days: ctx.supabase.table("csv_daily_returns").delete()
                     .eq("api_key_id", api_key_id).in_("date", d).execute())
```
Add a reconcile arm with the fixture above that asserts `stored_on_stated(rows, ki["tiny_base_days"]) == set()`
and asserts that the book carries no `key_inputs_mismatch`. A fuller fix also reconciles the rest of the marked era
in this branch, the same way as GC1-01. That is a scope decision for the planner.

### Gap closure round 1 tally

MEDIUM 2 (GC1-01 and GC1-02, both data-integrity, both user-facing). HIGH 0. The fix as written is correct for the
cases it targets: key C's tail, the leading edge it tests, both axes, the retention-window bound and the per-axis
scope. The three stored lists cannot drift apart. Both findings are days that this run owns, or names, and that the
widened span still leaves out. `src/lib/scenario.ts`: docstring only. Its claim matches the builders that set
`undefined_return_days` (`scenario-adapter.ts`, `ScenarioComposer.tsx`, `ScenarioComparePanel.tsx`,
`share-resolve.ts`).

_Reviewed: 2026-11-05_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep (gap closure round 1)_

## Gap closure review, round 2 (2026-11-05)

**Scope:** the fix commits `632cfff91` (GC1-01) and `7f2ab02a8` (GC1-02), read as
`git diff bca440f59 HEAD -- . ':(exclude).planning'` (`analytics-service/services/job_worker.py`,
`analytics-service/tests/test_tiny_base_reconcile.py`). I also re-read the whole gap-closure diff
`git diff 3e7547bd2 HEAD -- . ':(exclude).planning'` to look for regressions. MEDIUM and above only.

**Method:** I read the code, then probed it through the module's own harnesses (`derive_key_ccxt`,
`compose_curve`'s body without its `DONE` / one-upsert asserts, `run_derive_allocator_equity_job`).
The probes were throwaway files, copied into `analytics-service/tests/` for the run and deleted
straight after. The neuter drills ran on a `git archive HEAD` copy in the session scratchpad. I
byte-compared that copy's `job_worker.py` with the worktree's afterwards and they match. No file in
the worktree was changed except this one.

### Round-1 findings

- **GC1-01: FIXED, and the tests bite for the right reason.** The main-path hull now also covers
  `covered_from` and `terminal[0]` (`job_worker.py:10029-10036`), and the delete stays
  "absent from the payload" over that hull (`:10051`), so a measured mark row is never deleted.
  `covered_from` is `pre[-1] + 1`, or `S` when `pre` is empty. When `pre` is empty the index holds
  only mark rows, all on or after `S`. Either way the extension reaches only into the marked era,
  so the retention bound from round 1 still holds. Strategy mode with a mandate window is bounded by
  the in-window marks, because `_marks_in_mandate_window` filters before `apply_marks`.
  Neuter drill (`:10032` → `pass`): RED on
  `test_key_leading_edge_stale_rows_are_deleted`, `test_strategy_leading_edge_stale_rows_are_deleted`
  and `test_key_dust_base_last_mark_day_stale_row_is_deleted`, and green on the other 6.
- **GC1-02: the double count is FIXED, but the widening introduces GC2-01 below.** Neuter drill on the
  delete call alone (`:9748` → `pass`): `test_key_under_two_measured_days_clears_the_marked_era` goes
  RED on `assert {'2026-03-07', '2026-03-08'} == set()`, which is the right reason. Neuter drill on the
  widening alone (`:9739` → `pass`, so only the stated days are deleted): RED on
  `"a stale row sits inside the marked era"`.

### The widening: can it delete a row a current derive would keep?

The other axes are safe. The delete is `.eq("api_key_id", api_key_id)` (`:9744-9746`), so a
sibling key and the strategy axis are out of reach. The `covered_from`..`terminal` part reaches only
into the marked era, where Pitfall 7 means no realized row is emitted. Rows dated after the last mark
are not touched.

The row this run measured is not safe. The branch calls `_calendar_days_absent_from(start, end, ())`
with an EMPTY present-set, so it also deletes the days this derive measured. That is GC2-01. The
"clean `compose_empty` refusal" rationale holds only for a key that has no stored row outside the
deleted span.

### GC2-01: The `< 2` key branch deletes the day it measured, then stores `realized_terminal_day` on that day, so a trustworthy book turns into `key_inputs_mismatch` when the venue window slides (MEDIUM, data-integrity + user-facing, regression against round-1 HEAD)

**File:** `analytics-service/services/job_worker.py:9733-9748`. The terminal is persisted by
`_run_key_mode_compose_epilogue` (`realized_terminal_day`), and the mismatch is raised at
`analytics-service/services/allocator_equity_derive.py:1621-1623`.

**Issue:** In this branch `returns` can still hold one interpretable entry: a measured mark row, or a
realized `pre` day. The main path upserts that row and excludes it from the delete
(`_calendar_days_absent_from(..., rows_payload dates)`, `:10051`). This branch writes nothing and
passes `()`, so it deletes that row as well. The epilogue then stores `realized_terminal_day` = the
last mark day. When the deleted row was on that day, and any older row of the key survives before the
span, the compose's series ends before the terminal and the book is blocked.

Reproduced with the GC1-02 fixture's own marks and flows (03-06 = 100000, 03-08 = 588,
03-10 = 100800, `LEAD_FLOWS`), in two derives at 03-11 00:10Z:
- **Day 1:** the venue window still holds 03-05 (`{03-05: 0.004, **LEAD_REALIZED}`). This takes the
  main path. The rows are `{03-05: 0.004, 03-06: 0.0, 03-10: 212/100588}` and the compose returns
  `degrade_reasons == []`, `is_trustworthy True`.
- **Day 2:** 03-05 has left the window (`LEAD_REALIZED`) and nothing else changed. Only 03-10 is
  interpretable now, so the `< 2` branch runs.
  - At HEAD the rows become `{03-05: 0.004}` and the compose returns
    `['key_inputs_mismatch', 'out_of_window_flow']`, `is_trustworthy False`. The 03-10 row it deleted
    is the same value this derive measured.
  - At round-1 HEAD (no delete in this branch) the day-1 rows stay and the same day-2 `key_inputs`
    compose to `[]`, trustworthy.

So for this shape the widening is a regression. The committed GC1-02 fixture ends in this same state
(see GC2-02). The same blind delete reaches one more case. In key mode the stated list keeps
realized-era tiny days strictly before `marks_since` (`_tiny_base_days_stored`, `:3851-3853`), and
those lie before `covered_from`. The hull then starts there, which is wider than the comment's "first
covered day through the last mark day" (`:9728-9730`), and it also deletes the branch's one
interpretable `pre` row when that row lies between them. The main path keeps that row.

**Fix:** Make the branch keep and write what it measured, as the main path does. Upsert its
interpretable rows, which are at most one, and delete only the days absent from them:
```python
_kept = [
    {"api_key_id": api_key_id, "allocator_id": allocator_id, "strategy_id": None,
     "date": ts.date().isoformat(), "daily_return": float(v)}
    for ts, v in returns.items() if pd.notna(v)
]
if _kept:
    await db_execute(lambda: ctx.supabase.table("csv_daily_returns")
                     .upsert(_kept, on_conflict="api_key_id,date").execute())
_stale_days = _calendar_days_absent_from(_stale_start, _stale_end, (r["date"] for r in _kept))
```
(apply the same `present` set on the no-marks path, where `_stale_days` is the stated list). Probed:
with 03-10 = 212/100588 kept, the day-2 state composes to `[]`, trustworthy. Without the 03-05 row it
composes to `['out_of_window_flow']`, which is the honest reading of a key whose only return day comes
after its flows. Update the comment at `:9728-9732` so it matches the actual span. Do not route key
mode past the gate instead: the MT5-12 verdict seam at `:9847-9850` assumes the `< 2` exits have
already returned.

### GC2-02: The GC1-02 test asserts the mismatched end state as correct, and its no-mismatch claim is false for its own fixture (MEDIUM, test integrity on a data-integrity gate)

**File:** `analytics-service/tests/test_tiny_base_reconcile.py:283-313`.

**Issue:** The docstring says that once the stale rows are gone "the compose cannot read a double
count", and that without the delete "the compose degrades the book with `key_inputs_mismatch`". It
implies the fixed state does not degrade, but no assertion checks that. The test pins
`db.rows() == {"2026-03-05": 0.004}`. Composing exactly that state with the test's own `capture`
returns `['key_inputs_mismatch', 'out_of_window_flow']`, `is_trustworthy False`: the kept 03-05 row
makes the key count, its series ends on 03-09 (the flow day), and `realized_terminal_day` is 03-10.
The rationale given for not asserting it, that `compose_curve` cannot be used for a refusal, holds
only for the variant with NO row before the span, which gives `compose_empty` and no curve upsert.
With the 03-05 row the fixture keeps, the compose upserts a curve and `compose_curve` runs (I ran its
body). So the manual run that backed the claim was not run on this fixture's state. The test passes
on the defect GC2-01 describes, and it would go red on the fix.

**Fix:** In this test, after the derive:
```python
payload = await compose_curve(db, capture)
assert "key_inputs_mismatch" not in payload["degrade_reasons"]
```
and change the expected rows to
`{"2026-03-05": 0.004, "2026-03-10": pytest.approx(212.0 / 100588.0)}`. The new assertion is RED at
HEAD and GREEN with the GC2-01 fix. Keep the `stored_on_stated == set()` and sibling assertions.
Optionally add a variant with no 03-05 row that asserts the stored rows are only the measured day,
without a compose call.

### Gap closure round 2 tally

MEDIUM 2 (GC2-01: data-integrity and user-facing, a regression introduced by the GC1-02 widening;
GC2-02: the test pins that state). HIGH 0.
- GC1-01 is closed. Its fix is bounded to the marked era and to the key's or strategy's own axis, and
  its three arms fail without it, each for the right reason.
- GC1-02's double count is closed. Its widening is right in what it adds (`covered_from`..`terminal`
  on the key's own axis). It is wrong in the one day it should keep: the day this run measured.

_Reviewed: 2026-11-05_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep (gap closure round 2)_

## Gap closure review, round 3 (2026-11-05)

**Scope:** fix commit `ba09218dc` (GC2-01, GC2-02), `git diff 305a51973 HEAD -- . ':(exclude).planning'`
(`analytics-service/services/job_worker.py`, `analytics-service/tests/test_tiny_base_reconcile.py`), plus a
regression pass over the whole gap-closure diff `git diff 3e7547bd2 HEAD -- . ':(exclude).planning'`. MEDIUM and
above only.

**Method:**
- Re-ran the round-2 two-derive repro, plus two edge probes, at HEAD through the module's own harnesses. The
  probes were throwaway files, copied into `analytics-service/tests/` for the run and deleted straight after.
- Ran the neuter drills on a `git archive HEAD` copy in the session scratchpad. Afterwards that copy's
  `job_worker.py` is byte-identical to the worktree's.
- Ran the full `analytics-service` suite and `mypy` on `services/job_worker.py`.
- Changed no file in the worktree except this one.

**Result: CLEAN at MEDIUM+.**

### GC2-01: closed

- **Two-derive repro, re-run at HEAD.**
  - Day 1 takes the main path: the rows are `{03-05, 03-06: 0.0, 03-10: 212/100588}` and the book is
    `[]`, trustworthy.
  - Day 2 takes the `< 2` branch (03-05 has left the window): the rows are `{03-05: 0.004,
    03-10: 212/100588}` and the book is `[]`, trustworthy. At round-2 HEAD the same day 2 read
    `['key_inputs_mismatch', 'out_of_window_flow']`.
  - The 03-06 row from day 1 is deleted on day 2, which is correct. With `pre` empty, 03-06 is the first
    mark and has no base, so the marks own it and no row belongs there.
- **The measured day can be a realized `pre` day.** The branch now keeps that row too. Probe: one
  interpretable `pre` day (03-04) and dust-only marks gave stored rows `{03-04: 0.003}`.
- **The fixer's deviation (upsert and keep-list only in the marks-applied block) is sound.**
  - On the no-marks path, `_stale_days` is the key-mode stated list from `meta`. `_leave_out_tiny_base_days`
    sets every stated day to NaN, and the DQ-02 terminus only ever adds NaN, so no stated day is an
    interpretable day. A keep-list there would never come into play.
  - Writing no row on that path is the behaviour pinned by
    `test_derive_broker_dailies_dualmode.py::TestKeyMode::test_key_mode_insufficient_history_no_strategy_analytics`,
    and this phase does not change it.
  - On the marks path, the one row written is the row the main path would write for the same day, with the
    same payload shape and the same `api_key_id,date` arbiter.
- **Behaviour change I checked.** A key with marks and exactly one measured mark day, nothing older and no
  flows, used to compose as `DROPPED_KEY` (untrustworthy, legacy fallback). It now composes trustworthy,
  with one point equal to its mark NAV and `realized_terminal_day` on that day. This is the main path's
  reading of the same row, and it keeps F1(a)'s aim that the key's capital is visible. It is not a defect.
- **The delete scope is unchanged.** It still runs only on `.eq("api_key_id", ...)`, and the span is the
  hull of the stated days, `covered_from` and the last mark. The keep-list now excludes the measured day,
  so nothing this run measured is deleted.

### GC2-02: closed, and the test goes RED for the right reason

The existing fixture matches the day-2 shape: 03-05 is stored, the venue window is `LEAD_REALIZED`, and
only 03-10 is interpretable. The repro above covers the sequence that leads to it. Neuter drills, each on
the HEAD copy:

| Drill | What was changed in the copy | Result |
|---|---|---|
| N1 | keep-list emptied (`:9760` back to `()`) | RED on the rows assertion: `{'2026-03-05': 0.004}`, length 1 against 2 |
| N1, compose only | N1, with the rows assertion also removed | RED on the new compose assertion: `'key_inputs_mismatch' not in ['key_inputs_mismatch', 'out_of_window_flow']` |
| N2 | upsert removed (`:9750` set to `if False:`) | RED: the stale `03-10: 0.002` survives beside the expected `212/100588` |
| N3 | delete call removed | RED: `{'2026-03-07', '2026-03-08'} == set()` |

The compose assertion therefore bites on its own. The rows assertion catches both a lost measured day and
a stale value left on it.

### Regression pass

- **Full `analytics-service` suite at HEAD:** 14360 passed, 101 skipped, 0 failed.
- **The 43 tiny-base, nav-marks, broker-dailies and allocator-equity files on their own:** 1420 passed.
- **`mypy services/job_worker.py`:** no issues.
- **Code read:**
  - The GC1-01 main-path hull is unchanged since round 2.
  - The `_measured` lambda is awaited at once, so the late-bound closure is safe.
  - The `< 2` gate guarantees at most one measured row.
  - The updated comment at `:9726-9732` now states the actual write and delete contract.
- `src/lib/scenario.ts` is still a docstring-only change.

### Gap closure round 3 tally

MEDIUM 0, HIGH 0. GC1-01, GC1-02, GC2-01 and GC2-02 are all closed. The tests for each fail without its fix,
each for the reason it names.

_Reviewed: 2026-11-05_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep (gap closure round 3)_
