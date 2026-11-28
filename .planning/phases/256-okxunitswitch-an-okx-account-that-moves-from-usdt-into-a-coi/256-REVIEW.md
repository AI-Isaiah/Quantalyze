---
phase: 256-okxunitswitch-an-okx-account-that-moves-from-usdt-into-a-coi
reviewed: 2026-11-27T19:24:28Z
depth: standard
files_reviewed: 24
files_reviewed_list:
  - analytics-service/services/unit_switch.py
  - analytics-service/services/unit_switch_series.py
  - analytics-service/services/exchange.py
  - analytics-service/services/job_worker.py
  - analytics-service/services/analytics_runner.py
  - analytics-service/services/allocator_equity_compose.py
  - analytics-service/services/broker_dailies.py
  - analytics-service/services/transforms.py
  - src/lib/factsheet/unit-segments.ts
  - src/lib/factsheet/fetch-and-build-payload.ts
  - src/lib/factsheet/types.ts
  - src/lib/factsheet/returns-unit.ts
  - src/lib/queries.ts
  - src/lib/types.ts
  - src/lib/database.types.ts
  - src/app/factsheet/[id]/v2/chart-configs.ts
  - src/app/factsheet/[id]/v2/TimeSeriesChart.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.tsx
  - src/app/factsheet/[id]/v2/MetricsColumn.tsx
  - src/app/factsheet/[id]/v2/page.tsx
  - src/app/api/og/factsheet/[id]/route.tsx
  - src/app/api/strategies/[id]/returns/route.ts
  - src/components/strategy/StrategyTable.tsx
  - src/components/strategy/UnitSwitchChip.tsx
findings:
  critical: 2
  warning: 2
  info: 4
  total: 8
  necessity: 0
status: issues_found
---

# Phase 256: Code Review Report

**Reviewed:** 2026-11-27T19:24:28Z
**Depth:** standard
**Files Reviewed:** 24. Scope is the source files of `git diff ac12c1e36..f33a7cf67 -- analytics-service src`.
`supabase/`, `scripts/mutation-floors.mjs` and the census tests were excluded as instructed. No
test file was reviewed. Test files were only grepped, to check whether bill aging is exercised.
**Status:** issues_found

Severity mapping (caller's scale): `CR-` = HIGH, `WR-` = MEDIUM, `IN-` = LOW/INFO.

**Evidence labels.** Each finding says which of these it rests on:

- **EXECUTED:** reproduced by calling the real `services.unit_switch`, `services.unit_switch_series`
  and `services.nav_marks_apply.apply_marks` from a throwaway script (no source edits). The
  fixture is inlined under CR-01 so it can be re-run.
- **TRACED:** control flow read at the cited symbols, not executed end to end through the derive.

## Summary

The clean case is right (EXECUTED). When the whole account moves into the coin on S, the switched
headline matches the true USD equity path to the fifth decimal on every day. The boundary rule
(S is the last USD return day, S+1 the first coin return day, the coin base at S priced at
close(S)) books each day exactly once and drops none.

The refusal seams stay closed (TRACED). `unit_switch=` is passed only at
`job_worker.run_derive_broker_dailies_job` and through `exchange.fetch_all_trades`. `routers/cron.py`,
`routers/portfolio.py`, `routers/exchange.py`, `okx_archive_job` and the sync and other
`job_worker` call sites still refuse. A blank or malformed `ccy` never reaches the resolver, and a
coin bill dated before S refuses. The TS surfaces match the UI-SPEC copy table, and the leverage
hold, the OG note, the list chip and the returns API field are wired correctly. The hover
readout prints `1.03×` with no sign (`formatFixedSigned` defaults `plus=false`).

The defects sit where the model meets real accounts:

1. **CR-01:** a gradual mover, which the 14-day tolerance admits on purpose, is reported as 100%
   coin from S+1. The headline invents BTC exposure for the stable residual, and the residual's
   drift rescales every pre-switch USD return. Marks repair only the days they cover. No flag is
   raised.
2. **CR-02:** the switch is re-derived every night from the 93-day OKX bills reach alone. The
   chart's USD segment covers only that window, the two-segment break disappears once S leaves it,
   and the switch marker and sidecar are cleared once no coin bill is left in reach.
3. **WR-01:** the coin anchor divides the live USD equity by yesterday's close. The overnight BTC
   move therefore re-scales the stored USD history every night.
4. **WR-02:** an unpriced coin day either refuses the whole account permanently or, when it gets
   through, breaks the TWR chain in the runner. The masthead copy misstates both outcomes.

Necessity rubric (`necessity-review.md`) was read. No necessity finding met its evidence rule.

## Critical Issues

### CR-01 (HIGH): A gradual mover is booked as 100% coin from S+1. The stable residual's value is reported as moving with BTC, and its drift rescales every pre-switch USD return

**Evidence:** EXECUTED.

**File:** `analytics-service/services/unit_switch_series.py`, `build_switched_series`: the coin
anchor `anchor_usd / anchor_close`, the backward level roll, and the USD-segment
`account_balance=coin_base_level * switch_close`. Also `analytics-service/services/unit_switch.py`,
`derive_unit_switch`: `S = min(first coin bill, first majority)` plus `COIN_LEAD_TOLERANCE_DAYS`
admit a mostly-stable account into the coin segment.

**Issue:** From S+1 the coin segment's P&L is only the coin bills plus stable P&L divided by the
day's close. A stable balance that is still held after S has no bill, but its coin value changes
every day with the BTC price. So:

- (a) the headline's coin days are converted as if the whole NAV were BTC;
- (b) the backward roll from the live anchor puts the residual's whole coin-value drift into
  `coin_base_level`;
- (c) that base, times close(S), becomes the anchor of the USD segment, so every pre-switch return
  is rescaled.

The recorded "known limit" (256-04 hand-off 5, 256-06 notes) names only the native coin line and
says the headline is repaired "through the marks". That holds only for days the marks cover.

**Fixture:**
- Days: S = 2026-11-14.
- BTC closes from S-4 to S+9: 90000, 90000, 91000, 92000, **90000 (S)**, 92000, 95000, 97000,
  99000, 99000, 99000, 100000, 101000, 100000.
- Account: USDT P&L of +100/day from S-3 to S-1, about 10k USDT.
- On S, 2,500 USDT is bought into BTC (fee bill of 0.0001 BTC dated S) and 7,500 USDT stays as a
  residual. The residual is bought into BTC at close(S+6).
- The anchor is the true live equity. Marks are `AppliedMark(day, true_nav, 0.0, …)` passed
  through the real `apply_marks`.

| day | true USD return | no marks | true USD marks from S-1 | true USD marks from S+3 |
|---|---|---|---|---|
| S-2 (USD segment, pre-mark) | +1.02041% | **+1.09671%** | **+1.09671%** | **+1.09671%** |
| S+1 (coin) | +0.55405% | **+2.22222%** | +0.55405% | **+2.22222%** |
| S+2 (coin) | +0.82650% | **+3.26087%** | +0.82650% | **+3.26087%** |
| S+4 (coin) | +0.54351% | **+2.06186%** | +0.54351% | +0.54351% |
| S+7 | +1.01010% | +1.01010% | +1.01010% | +1.01010% |

The USD anchor at S is 9,309.18 against a true 9,991.00, which is -6.8%. With no residual every
day matches exactly, so the error is entirely the residual.

Marks fix only the days they cover. Every realized day before `marks_since` keeps the rescaled
value (L1), coin days before `marks_since` keep the 100%-coin return, and a strategy without
marks keeps everything. No DQ flag fires.

The founder's account carried about 25% USDT from 11-14 to 11-20 (ROADMAP "History"), so its
pre-mark USD history carries about 25% of that week's BTC move as a base error.

**Fix:** this extends a known limit already flagged for the founder, so the remedy needs a founder
decision, not a mechanical patch. The faithful fix is to book the residual: add a daily coin P&L of
`stable_balance(d-1) * (1/c_d - 1/c_{d-1})` in the coin segment. The per-day stable balance comes
from the `allocator_holdings` rows the resolver already reads (`end_of_day_holdings_from_rows`).
Where that history is absent for the coin days, raise a named DQ warning (for example
`stable_residual_unvalued`, which sets `complete_with_warnings`) instead of publishing 100%-coin
returns unmarked. A refusal would go against CONTEXT's ruling that a gradual mover must not
refuse, so it is not suggested.

### CR-02 (HIGH): The switch is re-derived nightly from the 93-day bills reach alone. The chart drops older history, the break disappears once S leaves the window, and the marker and sidecar are cleared when no coin bill is left in reach

**Evidence:** TRACED, except point 3, which is EXECUTED on `derive_unit_switch`.

**File:**
- `analytics-service/services/exchange.py`: `OKX_BILLS_REACH_DAYS`, and in `fetch_daily_pnl` the
  gate that awaits the resolver only when `_okx_non_usd_census` is non-empty.
- `analytics-service/services/job_worker.py`: `_resolve_unit_switch` never consults the stored
  switch, and `_unit_segments_payload` builds the USD segment from this derive's `returns` only.
- `src/lib/factsheet/unit-segments.ts`: `parseUnitSegments` rejects a USD segment with no points.

**Issue:** the derive's realized read starts at the 93-day reach. `csv_daily_returns` keeps older
days from earlier derives (the reconcile deletes only inside this derive's span). The switch and
its sidecar are recomputed from scratch on every run.

1. **Chart truncation (new).** `unit_segments.segments[0].returns` holds only the in-window USD
   days, because `_unit_segments_payload` reads this derive's `returns` through S. Whenever the
   strategy's stored series predates the window, `resolveUnitSwitchChart` replaces the headline
   line with segments that start at the window. The USD history older than about 93 days is then
   missing from the Cumulative Returns chart, while the KPIs (read from the stored rows) still
   cover it.
2. **The break disappears once S leaves the window (new).** `usd_has_history` becomes False and
   the USD segment is written as `returns: []`. `parseUnitSegments` then returns null, and
   `resolveUnitSwitchChart` falls back to one unbroken line. The masthead and KPI note still say
   "In USD to …". For the founder's account this is about 2027-02-15.
3. **S drifts forward on a key with no `allocator_holdings` rows (new).** EXECUTED with
   `derive_unit_switch` and live share `{BTC: 0.997, USDT: 0.003}`:
   - census first bill 11-14 gives `last_usd_day='2026-11-14'`;
   - census first bill 11-20 (the 11-14 bill aged out) gives `last_usd_day='2026-11-20'`;
   - with holdings that show the majority from 11-14, S stays at 11-14.

   On such a key, the copy moves to "In USD to Nov 20". Days on which the account was mostly BTC are
   then booked as USD days from USDT bills alone, and are upserted over the converted rows stored
   earlier.
4. **The switch marker vanishes, 93 days after the last BTC fee bill.** A held BTC position
   generates no coin bill. Once none is in reach, `_okx_non_usd_census` is empty, the resolver is
   never awaited and `_unit_switch_read` stays None, so the derive takes the plain-USD branch.
   - *Inherited, not new:* reading a spot-coin account that has no coin bills as plain USD (USDT
     bills against a coin-heavy live equity) predates this phase.
   - *New:* the prestamp drops `unit_switch` (the flags are replaced wholesale) and writes
     `unit_segments: null`, so the factsheet, chip and OG note stop naming the switch. The window's
     converted rows are also overwritten by the plain-USD reconstruction. Days on or after
     `marks_since` stay correct through the marks.

None of the unit-switch tests puts a coin bill outside the reach. A grep for
`OKX_BILLS_REACH_DAYS` or an aging fixture in `tests/test_okx_unit_switch_*.py` and
`tests/test_unit_switch*.py` finds none, and the fixtures use a calendar relative to today.

**Fix:**
- Make the switch sticky. Read the stored `data_quality_flags.unit_switch` (strategy) or
  `key_inputs.unit_segments` (key) as prior evidence for `derive_unit_switch`. Once derived, the
  switch is kept unless newer evidence contradicts it (a switch back, which already has a refusal
  token).
- An in-reach census that would move S, or an empty census on a key with a stored switch, should
  refuse by a named token rather than read as "no switch".
- Build `segments[0]` from the stored `csv_daily_returns` rows through S, merged with this derive's
  in-window USD days, rather than from `returns` alone. Alternatively, carry the previous sidecar's
  USD points forward for days older than the window.

## Warnings

### WR-01 (MEDIUM): The coin anchor divides live `totalEq` by yesterday's close, so the overnight BTC move re-scales the whole stored USD history every night

**Evidence:** EXECUTED.

**File:** `analytics-service/services/unit_switch_series.py`, `build_switched_series`:
`anchor_close = close_by_day.get(latest_close_day)` and `anchor_coin = anchor_usd / anchor_close`.
`analytics-service/services/job_worker.py`, `_book_switched_series`: `latest_close_day` is the
previous UTC day, while `equity` is read live at about 05:30Z.

**Issue:** `anchor_usd` is the live USD equity, which is `BTC_held × live price`. Dividing it by
close(latest completed day) gives `BTC_held × (1+δ)`, where δ is BTC's move since that close. The
error goes into `coin_base_level`, then into the USD-segment anchor, so every pre-switch return
shifts by about δ. Each night's derive rewrites those stored rows with a new δ.

EXECUTED on a clean full switch with no residual (the CR-01 fixture, all 10,000 USDT into BTC on
S). The S-2 USD return is +1.02041% (exact) at δ=0 and **+1.00002%** at δ=+2%. The coin days are
unchanged. With the CR-01 residual, δ=±2% gives +1.07476% and +1.11957% against +1.09671%.

**Fix:** anchor the coin segment natively from the same balance response the share is read from.
Use `details[].eq` of the switched coin, plus the stable `eqUsd` divided by close(latest day).
Record it beside `_LAST_OKX_CCY_SHARE` in `fetch_okx_total_equity_and_upl_usd`. Alternatively,
convert `anchor_usd` at the live coin price implied by that response (`eqUsd / eq` of the coin),
not at yesterday's close.

### WR-02 (MEDIUM): An unpriced coin day either refuses the account permanently or breaks the TWR chain in the runner, and the masthead copy misstates both

**Evidence:** EXECUTED for the builder arms, TRACED for the runner and marks arms.

**File:**
- `analytics-service/services/unit_switch.py`, `split_daily_pnl_at_switch`: the
  `coin_segment_unpriced` return for a stable amount.
- `analytics-service/services/unit_switch_series.py`, `build_switched_series`: the same token for a
  funding row or flow.
- `analytics-service/services/analytics_runner.py`, `run_csv_strategy_analytics`: the broker dense
  reindex.
- `analytics-service/services/job_worker.py`, `_unit_segments_payload`: `unpriced_days` is taken
  before marks.

**Issue:** CONTEXT ("Readers") says: "A missing close for a coin-segment day withholds that day by
name, never invents it."

- **Refusal arm (EXECUTED).** Drop the close of S+3 and put a 5 USDT stable amount on that day.
  `split_daily_pnl_at_switch` returns `coin_segment_unpriced`. That token is not in
  `_UNIT_SWITCH_TRANSIENT_TOKENS`, so it is a permanent refusal of the whole account, and it
  repeats every night until the close is backfilled. The same day carrying only coin P&L passes.
- **Pass-through arm (EXECUTED and TRACED).** With only coin P&L that day, the headline loses both
  S+3 and S+4 (2026-11-17 and 2026-11-18). `unpriced_days` names both. The derive stores no row for
  them and the reconcile deletes old ones. With no `marks_covered_from`, the runner's dense reindex
  turns them into interior NaNs, and `cumulative_twr_segmented` makes the headline a suffix.
  `headline_since` moves past the gap, which the existing headline-since note in `MetricsColumn`
  does disclose. The "whole record in USD" KPI ruling and the masthead's "The USD figures leave
  those days out" are then both untrue: everything before the gap is left out.
- **Marks arm (TRACED).** When marks cover those days, `apply_marks` emits rows for them from the
  USD marks. The sidecar's `unpriced_days` are computed before marks, so the masthead names days
  the figures actually include.

**Fix:**
- Treat a coin day without a close the same way whatever it carries: withhold the day by name and
  keep the account. Carry the coin LEVEL across the hole, the way key mode's `segment_terminals`
  does. Do not price a stable, funding or flow amount at a neighbour's close (T-256-10).
- In strategy mode, stamp a boundary like `marks_covered_from` so the runner does not turn a named
  unpriced day into a chain break. Otherwise, change the masthead copy to say the headline restarts
  after the gap.
- Recompute `unpriced_days` after `apply_marks` (drop days the marked series covers) before writing
  the sidecar.

## Info

### IN-01: OKX funding rows' `currency` is ignored (pre-existing, inherited)

**File:** `analytics-service/services/funding_fetch.py`, `fetch_funding_okx`, consumed in
`build_switched_series`.
**Issue:** a coin-settled funding row's `pnl` is read as USD on both sides of S. This predates the
phase, and the founder's account has no coin-margined contract.
**Fix:** refuse or convert a non-stable funding row.

### IN-02: A stale comment says the resolver goes to strategy-mode OKX only

**File:** `analytics-service/services/job_worker.py`, in `run_derive_broker_dailies_job`, the
comment above the `fetch_all_trades` call.
**Issue:** the comment says key mode is byte-identical. Since plan 09, every OKX derive gets the
resolver (`_unit_switch_resolver`).
**Fix:** update the comment.

### IN-03: The module header says "coin-margined"

**File:** `src/lib/factsheet/unit-segments.ts` (module header) and `src/lib/factsheet/types.ts`
(`unitSwitch` doc).
**Issue:** the measured account moved into spot BTC.
**Fix:** reword to "moves from USDT into a coin".

### IN-04: The switch flag and its sidecar can come from different generations

**File:** `src/lib/factsheet/fetch-and-build-payload.ts`, `buildFromResolved`.
**Issue:** `unit_switch` comes from the effective flags (the snapshot during a held re-run), and
`unit_segments` from the live row. The parser rejects a mismatched S, so the worst case for one
re-run is a switch sentence with no two-segment chart.
**Fix:** optional. Skip the sidecar while `effectiveFlags.source === "snapshot"`.

---

_Reviewed: 2026-11-27T19:24:28Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Silent-failure hunter (round 1, same diff), MEDIUM+ findings merged here by the orchestrator

- **SF-01 (MEDIUM)** `unit_switch.py:derive_unit_switch`, live-share-only path (`first_majority is None`, no observed holdings): `COIN_LEAD_TOLERANCE_DAYS` is enforced only when holdings exist, so an old coin fee bill with no holdings history sets S months back and rebuilds stable-held days in BTC. Fix: with no observed holdings, require the first coin bill within tolerance of today, or refuse `holdings_unavailable`.
- **SF-02 (MEDIUM)** `job_worker.py:_book_switched_series` (`flow_after_latest_close`): any deposit or withdrawal dated today UTC refuses the whole refresh as transient; same-day retries hit it again and end final, freezing figures for a day. Fix: leave flows after the latest close to the next derive, as P&L and funding rows already are.
- **SF-03 (MEDIUM)** `unit_switch.py:split_daily_pnl_at_switch` (`coin_segment_unpriced`): one missing BTC close on a day after S with a non-zero stable amount refuses the whole series permanently, while coin days with a missing close are omitted and named. Fix: name and omit the stable day the same way (overlaps WR-02).
- **SF-04 (MEDIUM)** `src/lib/factsheet/fetch-and-build-payload.ts` (`parseUnitSegments(a?.unit_segments, unitSwitch)`): `unitSwitch` comes from the effective flags (possibly the `last_success_snapshot` generation) while `unit_segments` is the raw newest column; a mismatch parses null silently and the page shows the switch sentence with a single USD line and drops the unpriced-days disclosure. Fix: read both from the same generation, or show a named "segments unavailable" note (overlaps IN-04).
- **SF-05 (MEDIUM)** `job_worker.py:_resolve_unit_switch` / `unit_switch.py:end_of_day_holdings_from_rows`: skipped holdings rows (bad asof, symbol or value) drop silently, though the docstring says the caller logs their count. Fix: log the skipped count and refuse by name above a threshold (e.g. a majority of rows).
- LOW (not fixed, recorded only): SF-06 non-finite funding amounts in `build_switched_series`; SF-07 a garbled BTC `eqUsd` renormalises shares; SF-08 contract-breach `ValueError` in `_book_switched_series` has no named handler; SF-09 `_okx_book_switched_coin` early returns store no `UnitSwitchRead`; SF-10 stale "strategy-mode OKX" comment.

## Round 2

**Reviewed:** 2026-11-27T20:23:02Z, at head `6c3e5eaed`, by the code reviewer (gsd-code-reviewer).
**Scope:** the fix diff `git diff c44166f96..6c3e5eaed -- analytics-service src`, read against the whole
phase diff `ac12c1e36..6c3e5eaed`. The founder ruling on CR-01 ("Move switch to coin majority") was read
from `256-CONTEXT.md`. Only MEDIUM and above count. LOW items are recorded at the end and are not routed.

**Findings:** HIGH 2 (R2-01, R2-02) · MEDIUM 3 (R2-03, R2-04, R2-05) · LOW 6 (recorded only).

**Evidence.** EXECUTED means the real `services.unit_switch.derive_unit_switch`,
`split_daily_pnl_at_switch`, `services.unit_switch_series.build_switched_series` and
`services.nav_marks_apply.apply_marks` were called from a throwaway script, with no source edits.
TRACED means the control flow was read at the cited symbols.

**Fixture used by R2-01 and R2-02, so it can be re-run.**
- Days 11-06 to 11-26. USDT P&L of +100 a day through 11-14, about 10k USDT.
- At the end of 11-14, 75 % of the value is in BTC. This is the share RESEARCH "Bills finding" measured
  at holdings asof 11-15. At the end of 11-20 it is 99.7 % BTC.
- BTC rises 1.67 % a day from 11-14 to 11-19, about 10 % over the mixed week.
- The live anchor is the true NAV at the true price. Marks are `AppliedMark(day, true_nav, 0.0)` from
  11-13 on.

### Status of the round-1 findings

| id | status at `6c3e5eaed` |
|---|---|
| CR-01 | **Not fixed on the measured account.** It is fixed only for the rewritten 25 % fixture. See R2-01 and R2-02. |
| CR-02 | Points 2, 3 and 4 are fixed: the switch persists, S no longer drifts, and the marker survives once the bills age out. **Point 1, the chart truncation, is not fixed** (R2-03). |
| WR-01 | Fixed. The anchor is `eqUsd / eq` of the same balance response. There is no fallback to the close; a missing price refuses `switch_anchor_unpriced`. |
| WR-02 | Fixed for a hole that is inside the bills window. **The fix stops working once the hole is older than the window** (R2-04). Verdicts on the three partials are below. |
| SF-01 | Fixed. With no holdings history the derive refuses `holdings_unavailable`. |
| SF-02 | Fixed. Today's flows are taken out of the anchor and out of the flows the builder books. The signs are right for both a deposit and a withdrawal. |
| SF-03 | Fixed for the splitter half and the funding half. The external-flow arm stays a named refusal (partial a, LOW). |
| SF-04 | Fixed by the "segments unavailable" masthead note (`unitSwitchSegmentsUnavailableNote`). The generation mismatch itself (IN-04) remains, and it is LOW. |
| SF-05 | Fixed. Unusable rows are logged, and the derive refuses when more than half of them do not parse. |

### R2-01 (HIGH): On the measured holdings, the code derives S = 11-14, not the ruling's 11-20. The founder-shaped fixture was rewritten from 75 % BTC to 25 % BTC so that the ruling's date passes

**Evidence:** EXECUTED.
**File:** `analytics-service/services/unit_switch.py`: `COIN_MAJORITY_SHARE = 0.5` and
`derive_unit_switch` (the final-run search). Also `analytics-service/tests/test_unit_switch.py`:
`_founder_shape`, which now uses `BTC_25` where it used `BTC_75`, and whose docstring says "the founder
ruling reads the 11-15 split as a stable majority".

**Issue:** The ruling records the rule as "the first day the coin is the clear majority ... and stays so"
and records the result as "2026-11-21 for this account". It also gives the copy "In USD to Nov 20, 2026,
in BTC from Nov 21, 2026". RESEARCH measured the account at about 75 % BTC from holdings asof 11-15. At a
50 % threshold that is already the majority, so the code's answer is the pre-ruling date:

- `derive_unit_switch` on the measured shape returns `UnitSwitch('BTC', last_usd_day='2026-11-14',
  first_coin_return_day='2026-11-15')`.
- The six mixed days are therefore still coin days, which is exactly the CR-01 defect. Unmarked, 11-16
  reads +1.6700 % against a true +1.2577 %, and the pre-switch day 11-10 reads +1.0531 % against a true
  +1.0417 %.
- The copy reads "In USD to Nov 14", which contradicts the copy the ruling recorded.

The rule (50 %) and the date (11-21) cannot both hold on the measured data. The fixer resolved the
conflict by changing the test data rather than by surfacing it. The derive harness
(`founder_holdings_rows`) goes from USDT-only straight to 99.7 % BTC, so no derive-level test has a
mixed day in it at all.

**Compounded by CR-02's persistence.** `derive_unit_switch(prior=...)` returns the stored S without
re-deriving it (`_confirm_stored_switch`). The first PROD derive therefore stores S = 11-14 permanently.
A later change to the threshold or the rule never reaches an account that already has a stored record,
because the record carries no rule version.

**Fix:** This needs a founder decision. Do not average the two readings. Ask which one wins:
- (a) "Clear majority" means a share above the 75 % this account held on the mixed days. Set
  `COIN_MAJORITY_SHARE` to the chosen value, and the ruling's 11-21 date follows.
- (b) 50 % stays. Then the ruling's date and copy in CONTEXT and the ROADMAP are corrected to 11-15.

Either way, `_founder_shape` must use the measured `BTC_75`, and the harness needs a mixed-day stretch.
Add a rule version to the stored `unit_segments` record, and re-derive (do not confirm) a record whose
version differs, so that a rule change reaches stored accounts.

### R2-02 (HIGH): CR-01's rescale of history survives the ruling, even with marks on every mixed day. The held coin's price move on the USD-segment mixed days is in no bill, so the backward USD roll rescales every pre-mark return

**Evidence:** EXECUTED, with marks.
**File:** `analytics-service/services/unit_switch_series.py`, `build_switched_series`: the USD segment
anchored at `account_balance=coin_base_level * switch_close` and rolled back over `split.usd_by_day`.
Also `analytics-service/services/unit_switch.py`, `split_daily_pnl_at_switch`, which puts only the
stable P&L and the coin fee bills into the USD days.

**Issue:** Under the ruling, the mixed days are USD days. The coin held on them (75 % of the account on
the measured data) moves in price every day, but no bill carries that move. The USD segment is rolled
back from its anchor at S, which is the true equity, by subtracting the booked P&L. Each level before
the mixed week is therefore too high by the coin's whole unbooked gain over that week.

`apply_marks` replaces only the days the marks cover. The realized days before `marks_since` keep the
inflated base. Fixture above, with S at the ruling's 11-20:

| day | true USD return | unmarked | marks from 11-13 |
|---|---|---|---|
| 11-10 (pre-mark USD) | +1.0417 % | **+0.9492 %** | **+0.9492 %** |
| 11-12 (pre-mark USD) | +1.0204 % | **+0.9315 %** | **+0.9315 %** |
| 11-16 (mixed) | +1.2577 % | **+0.0000 %** | +1.2577 % |
| 11-18 (mixed) | +1.2679 % | **+0.0000 %** | +1.2679 % |

So the ruling's own premise holds: "The USD figures for those days are true USD values (marks)". Every
pre-mark USD return, however, is about 9 % low in relative terms, and no DQ flag fires. On this data,
moving S to the majority makes the pre-mark error about eight times larger than leaving it at 11-14,
which gives +1.0531 % against +1.0417 %. That is because a 75 % unbooked coin is a bigger error than a
25 % stable residual valued as coin. The fixer's "Limit" note names the omitted move on the mixed days
only, not the rescale of the whole earlier history. Without marks, the mixed days also read 0 %.

**Fix:** Book the held coin's daily revaluation as USD P&L on every USD-segment day after the first
coin holding: `qty_coin(d-1) × (close(d) − close(d-1))`. Take `qty_coin(d-1)` from the end-of-day
holdings value divided by close(d-1). That is the same `end_of_day_holdings_from_rows` read the resolver
already makes. Where those holdings are missing for a mixed day, raise a named DQ warning (for example
`mixed_days_unvalued`, which gives `complete_with_warnings`) rather than publishing the rescaled history
silently. If the founder accepts the limit instead, record it in CONTEXT as the history rescale, not as
"omits the move on those days".

### R2-03 (MEDIUM): CR-02 point 1 is not fixed. The first switched derive seeds the chart's USD segment from the 93-day window only, and every later derive keeps that start

**Evidence:** TRACED.
**File:** `analytics-service/services/job_worker.py`: `_unit_segments_payload` and
`_carry_older_points`. Also `src/app/factsheet/[id]/v2/chart-configs.ts`, `resolveUnitSwitchChart`
(`compoundNative(seg.fromReturns, dates)`).

**Issue:** `usd_points` come from this derive's `final_returns`. Those start at the bills reach,
because the OKX walk starts at `now − OKX_BILLS_REACH_DAYS`. `_carry_older_points` adds only the points
an earlier `unit_segments` record held. Nothing reads the stored `csv_daily_returns` rows. The
reconcile in the derive deletes only inside `_span_start.._span_end`, so the older rows stay and the
KPIs still cover them.

On the first switched derive (there is no stored record today: the derive code is not on `main`), the
USD segment therefore starts about 93 days back. `resolveUnitSwitchChart` replaces the headline line
with the segments, so the Cumulative Returns chart draws no USD line before that point, while the KPIs
and the masthead cover the whole record. For this account, months of USD history drop off the chart.
The fix report's claim that "both segments cover the whole stored history" holds only for points that
some record already carried.

**Fix:** When there is no stored record (or no carried USD points before the window), seed
`segments[0]` from the stored `csv_daily_returns` rows dated through S, read in the same scope as the
reconcile (`strategy_id`, or `api_key_id` in key mode). Then merge this derive's in-window USD days
over them. Add a test with stored rows older than the window and assert the first USD point.

### R2-04 (MEDIUM): The WR-02 boundary stamp uses only this window's unpriced days. Once a hole is older than the window, or when an older hole sits before a newer one, the runner's chain break returns

**Evidence:** TRACED.
**File:** `analytics-service/services/job_worker.py`, at the prestamp:
`_prestamp_flags["marks_covered_from"] = _switched.unpriced_days[0]`. Also
`analytics-service/services/analytics_runner.py`, `run_csv_strategy_analytics`, which reindexes
densely before `marks_covered_from` and keeps the rows sparse from it on.

**Issue:** `_switched.unpriced_days` holds only the days this derive rebuilt. The prestamp replaces
`data_quality_flags` wholesale. When a hole leaves the bills window (93 days later), the stamp is no
longer written. The runner then dense-reindexes the whole series, the absent hole day becomes an
interior NaN, and `cumulative_twr_segmented` turns the headline into a suffix. That is the WR-02 defect
the fix was meant to remove.

The same happens when a carried older hole and a fresh hole coexist: the stamp lands on the fresh one,
and the older hole falls before the boundary. Meanwhile `_unit_segments_payload` keeps naming the old
hole (`carried_unpriced`), so the masthead says the day is left out while the headline restarts after
it.

**Fix:** Stamp at the earliest day of the payload's final `unpriced_days` (carried plus fresh), not at
`_switched.unpriced_days[0]`. Add a test where the hole is older than `OKX_BILLS_REACH_DAYS`
(monkeypatched as in the CR-02 test).

### R2-05 (MEDIUM): The persisted switch belongs to the strategy, not to the key it was derived from. Relinking a strategy to another OKX key applies the old S to the new account

**Evidence:** TRACED.
**File:** `analytics-service/services/job_worker.py`: `_read_stored_unit_segments` (strategy mode reads
`strategy_analytics.unit_segments` by `strategy_id`) and `_stored_unit_switch`. Also
`analytics-service/services/unit_switch.py`: `_confirm_stored_switch`. Also
`src/components/strategy/ApiKeyManager.tsx`, where the re-point writes
`strategies.update({ api_key_id })`.

**Issue:** The key manager re-points a strategy by updating `strategies.api_key_id` only. Nothing
clears `strategy_analytics.unit_segments`: `check_strategy_api_key_ownership` checks ownership only,
and the only writer of the column is the derive. The next derive reads the old record as `prior`, and
`_confirm_stored_switch` checks the NEW key's holdings and live balance against the OLD S:

- If the new account is a USDT account, the coin share is below 50 % after S, so the derive refuses
  `switch_back`. That refusal is permanent and repeats every night. The strategy stays frozen at its
  last figures, and no data path ever clears it.
- If the new account is a coin account with a different history, the old S is applied to it without
  any check, and its days are split at the wrong date.

Re-pointing to a sibling key of the same account, which is the intended case, works.

**Fix:** Store the `api_key_id` the switch was derived from in the record, and ignore a record whose
key differs from the current one, so the switch is re-derived from scratch. Alternatively, null
`unit_segments` when `strategies.api_key_id` changes. Key mode is not affected, because its record is
keyed by `key_inputs:<api_key_id>`.

### Verdicts on the three partials the fixer left (WR-02 / SF-03)

All three are acceptable as named refusals, at LOW. None is MEDIUM.

- **(a) A flow on a coin day with no close refuses `coin_segment_unpriced`.** This needs a BTC close
  hole on the exact day of a deposit or withdrawal. The refusal is named, the figures are kept, and it
  clears when the close is backfilled. Any way of booking the flow would price it at a neighbour's close
  (T-256-10). LOW.
- **(b) A coin amount on a USD-segment day with no close refuses `switch_day_unpriced`.** This deviates
  from CONTEXT's ruling text "A day with no close is withheld by name": the account is refused, not the
  day withheld. The precondition is a BTC close hole within `COIN_LEAD_TOLERANCE_DAYS` before S, and the
  amount is the size of a fee (about 0.0006 BTC). The refusal clears when the close is backfilled or the
  bill leaves the 93-day window. LOW, but record the deviation. A cheap alignment is to leave the fee
  out of that day and name it, as the splitter already does for a stable amount after S.
- **(c) Marks that start after a hole keep the runner's chain break.** This needs a hole between the
  first coin day and `marks_since`, and the restart is disclosed by the headline-since note. LOW. R2-04
  is the MEDIUM variant of the same boundary rule.

### LOW (recorded only, not routed)

- The prior path refuses `switch_back` on ANY sub-majority holdings day after S, for example one night's
  missing BTC row. The no-prior path accepts a dip followed by a renewed majority by moving S
  (`test_the_switch_is_the_start_of_the_final_unbroken_majority_not_the_first_majority_day`). The same
  history therefore derives or refuses depending on whether a record exists, and once the dip is stored
  the refusal never clears.
- With `marks_covered_from` stamped, a guarded (NaN) coin day after the boundary is bridged by the
  runner as a covered day. `_convert_across_holes`, however, restarts the chain there, so the guarded
  move is dropped rather than segmented. The guard flag still fires.
- A funding row or a stable amount on an unpriced coin day is dropped from the booked P&L. The backward
  roll then shifts every earlier level by that amount. The day is named, and the size is funding-scale.
- IN-04 (a generation mismatch between the switch flag and the segments) now renders the "segments
  unavailable" note. That is acceptable.
- The unpriced-days masthead copy ("The USD figures leave those days out") is slightly inaccurate in
  span mode, because the move of a hole day rides on the next priced day.
- `bills_from_day` is computed from `_now_utc`, while the fetch window uses `_now_ms()`. A derive that
  crossed 00:00Z between the two would rebuild one uncovered day as zero P&L. The derive runs at about
  05:30Z, so this does not happen in practice.

_Round 2 reviewed: 2026-11-27T20:23:02Z · Reviewer: Claude (gsd-code-reviewer) · Depth: standard_

### Round 2, silent-failure hunter (merged by the orchestrator)
- **SF2-01 (MEDIUM)** `job_worker.py:_read_stored_unit_segments` / `_stored_unit_switch`: a stored record that exists but is malformed is dropped with no log; with no coin bills in the window the derive concludes "no switch" and overwrites the stored two-unit history with a plain USD headline. Fix: warn (shape only) and refuse transient instead of overwriting.
- **SF2-02 (MEDIUM, same defect as R2-04)** prestamp `marks_covered_from = _switched.unpriced_days[0]` sees only this derive's fresh holes. Fix: stamp the minimum of the final carried-plus-fresh `unpriced_days`, or a distinct flag.
- **SF2-03 (MEDIUM)** `job_worker.py:_unit_segments_payload`: on a first derive with `coin_base_day` later than S, the declared coin/USD `from_day` spans days with no points, so the chart draws a continuous line over a hole. Fix: set `from_day` to the first real point or name the gap days in `unpriced_days`.
- LOW (recorded only): live-only `switch_back`/`two_coins` refusals are permanent; `SWITCH_ANCHOR_UNPRICED` retries on a permanently missing `eqUsd`; `_kept_stable` price `or 0.0`; today-flow subtracted at recorded USD value; hard-coded 50% unusable-rows threshold.

## Round 3

**Reviewed:** 2026-11-27T20:58:47Z, at head `7d14b53f0`, by the code reviewer (gsd-code-reviewer).
**Scope:** the round-2 fix diff `git diff 3eb9da4aa..7d14b53f0 -- analytics-service src`, read against the
whole phase diff `ac12c1e36..7d14b53f0`. The founder ruling on R2-01 ("≥95% coin and stays") was read from
`256-CONTEXT.md`. Only MEDIUM and above count.

**Findings:** HIGH 1 (R3-01) · MEDIUM 6 (R3-02 to R3-07) · LOW 6 (recorded only).

**Evidence.** EXECUTED means the real `derive_unit_switch`, `end_of_day_holdings_from_rows`,
`split_daily_pnl_at_switch`, `build_switched_series` (with `usd_marks` and `mixed_from_day`) and `apply_marks`
(with `flow_instants`) were called from throwaway scripts at `7d14b53f0`, with no source edits. TRACED means the
control flow was read at the cited symbols. The series runner was not executed.

**Fixture (EXECUTED).**
- Days 11-05 to 11-26. USDT P&L of +100 a day from 11-06 to 11-14.
- At the end of 11-14, 75 % of the value is bought into BTC (one fee bill).
- BTC rises 1.67 % a day from 11-15 to 11-19.
- At the end of 11-20 the rest is bought, leaving 0.3 % USDT (one fee bill).
- Holdings rows are the true end-of-day values, stamped `asof` the next day.
- Marks are the true NAV, read at 05:30Z the next day.

### Status of the round-2 findings

| id | status at `7d14b53f0` |
|---|---|
| R2-01 | **Fixed.** On the measured shape, `derive_unit_switch` returns `last_usd_day='2026-11-20'` and `first_coin_return_day='2026-11-21'` (EXECUTED), which gives the ruling's copy. `COIN_SWITCH_SHARE = 0.95` drives: S; the final-run search; both `switch_back` arms (observed and live); `coin_bills_without_majority`; and the persistence confirm. `two_coins` stays at 0.5 by design. `_founder_shape` is back on `BTC_75`, and the derive tests have a 75 % stretch (`_mixed_holdings_rows`). For what 95 % does to persistence, see R3-03. |
| R2-02 | **Fixed when the first mark comes before the coin and no flow is moved into that mark.** With marks from 11-08, every day from 11-06 to 11-26 equals the true USD return (worst error 1e-16). The cumulative return is +16.67870 % against a true +16.67870 % (EXECUTED). The same holds with a deposit on the first mark day, and with a non-zero `open_pnl` on every mark: the first marked day books the open profit once, as the documented rule says (EXECUTED). With a mark gap over the mixed week (marks to 11-13, resuming 11-22), the next mark carries the gap as one return, and the cumulative return is exact. PROD marks for this key run from 10-26 to 11-23 (RESEARCH), so the measured account takes the exact path. Exceptions: R3-04 (first mark on a mixed day), R3-05 (a flow moved into the first mark) and R3-07 (no mark before the coin). **NaN days and KPIs, per regime (TRACED):** (a) marks before the coin: no day is withheld and no NaN reaches the runner. (b) No marks: `marks_covered_from` is stamped at the earliest withheld day, the runner stays sparse from there, the withheld days are absent and not NaN, and the chain does not break. (c) First mark inside the mixed week: the withheld days fall before `_applied_marks.covered_from`, so the runner's dense reindex makes them interior NaN and the headline becomes a suffix. That is the round-2 partial (c) class, disclosed by the headline-since note. NaN never enters KPI arithmetic. |
| R2-03 / SF2-03 | **Fixed.** On a first derive, the USD segment is seeded from the stored `csv_daily_returns` rows dated before the first fresh point through S, in the same scope as the reconcile. The coin gap days are named. NaN and non-finite rows are dropped. For the cause the masthead gives for those days, see R3-06. |
| R2-04 / SF2-02 | **Fixed.** The stamp is read from the final record. Its `unpriced_days` are `sorted({carried, fresh, gap})`, so `[0]` is the oldest day. |
| R2-05 | **Fixed for a re-point to another account. The fix writes the key id into an anon-readable column (R3-01), and it breaks a re-point to another key on the same account (R3-02).** The fixer implemented exactly what round 2 recommended, so both defects trace back to round 2's own fix text. |
| SF2-01 | **Fixed.** A record that does not read logs its shape only and refuses with the transient token `stored_segments_malformed`. Nothing is overwritten. |

### R3-01 (HIGH): The R2-05 fix publishes the strategy's OKX key id to anonymous visitors, reversing Phase 170.6.1.1 ANONKEYID

**Evidence:** TRACED (grants read from `supabase/schema/baseline.sql` and the migrations at head).
**File:** `analytics-service/services/job_worker.py`, `_unit_segments_payload` (`"api_key_id": api_key_id`),
written to `strategy_analytics.unit_segments` by the strategy-mode prestamp. Also
`supabase/schema/baseline.sql`: `GRANT SELECT,… ON TABLE "public"."strategy_analytics" TO "anon"` at table
level, and policy `analytics_read` (`s.status = 'published' OR s.user_id = auth.uid()`). No migration at head
revokes anon on `strategy_analytics`.

**Issue:** Migration `20261022120000_strategies_anon_api_key_id_revoke.sql` exists because "A key id is the handle
that targets an exchange key (167.1.2.1 D-18)". It removed anon's SELECT on `strategies.api_key_id` and made new
columns anon-invisible by default.

`strategy_analytics` is still anon-readable at table level for every published strategy. Any visitor holding the
publishable key can therefore select `unit_segments->>'api_key_id'`. The founder's switched strategies are
published, so the first switched derive after ship exposes the key id of a live OKX key. Authenticated non-owners
can read it the same way. `parseUnitSegments` drops the field on the page, but that does not protect the column.

**Fix:** Keep the key id out of every anon-readable column. Options:
- Store an opaque binding instead, for example an HMAC of the key id under a server-side secret, compared in the
  worker.
- Keep the binding in a service-role-only place, for example a deny-all table such as `strategy_analytics_series`,
  or a column with no anon grant. A column-level revoke alone is a no-op while the table-level grant stands, as the
  ANONKEYID migration records.

Add a SQL gate arm that fails if anon can read a key id through `strategy_analytics`.

### R3-02 (MEDIUM): After the R2-05 fix, re-pointing a switched strategy to a new key on the same account refuses for good, or loses the switch

**Evidence:** EXECUTED for the `derive_unit_switch` outcomes. TRACED for the derive path once the bills have aged out.
**File:** `analytics-service/services/job_worker.py`, `_read_stored_unit_segments`
(`if stored.get("api_key_id") != ctx.key_row["id"]: return None`), and `_resolve_unit_switch`, which reads
`allocator_holdings` for the CURRENT key only. Also `analytics-service/services/unit_switch.py`,
`derive_unit_switch`.

**Issue:** Round 2 said the sibling-key re-point "works". That is the realistic re-point: OKX has no in-place
rotation (`rotate-secret` is MT5-only), so a replacement key is added and the strategy re-pointed through
`ApiKeyManager` (`strategies.update({ api_key_id })`).

The fix now discards the record whenever the key id differs, and derives the switch from scratch from the NEW key's
holdings, which start on the day the new key was added:
- **Within 14 days of the first coin bill:** the first observed day is already at or above 95 %, so
  `run_start == 0`, and the result is `ambiguous_boundary`. EXECUTED with holdings from asof 11-26 and census 11-14.
- **Later than that:** the result is `bills_precede_majority_beyond_tolerance`. EXECUTED with holdings from asof 12-05.

Both tokens are permanent, so the strategy stays frozen at its last figures every night.

**Once the coin bills have left the 93-day window** (TRACED): the census is empty and `_stored_switch` is None. The
resolver is never awaited, and the CR-02 prior arm (`_unit_switch_read is None and _stored_switch is not None`) does
not fire. The account takes the plain USD path. For a BTC account with no USDT bills, that path rebuilds the window
from realized P&L alone, priced only by the new key's own marks, because marks are read per key. The reconcile
overwrites the stored true rows in the window, and `unit_segments` is written as an explicit null, with no refusal
and no flag. The pure function given the same empty census and no prior returns `no_coin_evidence` (EXECUTED), so
nothing downstream catches it.

With the record kept (the round-1 behaviour), the same inputs return the stored
`UnitSwitch('BTC','2026-11-20','2026-11-21')` (EXECUTED). Even then the in-window USD days are rebuilt without the
old key's marks. That part predates this round.

**Fix:** This is a design decision.
- The sound binding is the exchange ACCOUNT, not the key. For example, compare the OKX account uid the worker can
  read from the account config, kept off any anon-readable column (see R3-01).
- A live-share heuristic (keep the record when the new key still holds the coin at or above 95 %) is not enough. A
  different all-BTC account would inherit the old S, which is R2-05's second case.

Add derive tests for a same-account re-point inside and beyond the bills window, and for a different-account
re-point.

### R3-03 (MEDIUM): At 95 %, one night below the threshold after S is a permanent `switch_back`, even after the coin is back at 99.7 % for weeks

**Evidence:** EXECUTED.
**File:** `analytics-service/services/unit_switch.py`, `_confirm_stored_switch`:
`if any(s.coin < COIN_SWITCH_SHARE for d, s in observed if d > switch_day): return "switch_back"`. The resolver
reads the key's WHOLE `allocator_holdings` history on every derive.

**Issue:** Round 2 recorded this shape as LOW, because a dip below 50 % needed a real move out of the coin. At 95 %,
routine activity crosses the line:
- a USDT deposit worth about 5 % of NAV or more, left overnight before it is converted;
- a USDT residual near 5 % together with a price drop;
- a partial take-profit.

EXECUTED: stored S of 11-20, then 99.7 % BTC, then one end-of-day at 93.8 % (asof 11-26), then 20 days back at
99.7 %. The result is `switch_back`. That token is not in `_UNIT_SWITCH_TRANSIENT_TOKENS`, and the dip row stays in
the holdings history. The refusal therefore repeats every night forever, and the strategy's figures stay frozen.

The no-prior path treats the same history differently: it moves S past the dip (the final unbroken run). The ruling
("first day the coin is at least 95 % … and stays at or above it") defines S. It does not say that an account which
recovers is refused forever.

**Fix:** This needs a founder decision on what a dip after S means. Options:
- **Minimum:** judge `switch_back` on the latest observation and the live share only, and name the dip days rather
  than refusing over them. The refusal then clears once the coin is back at or above 95 %.
- **Alternative:** use `COIN_MAJORITY_SHARE` for persistence after S, and accept that a dip day books its stable
  share as coin.

Add a test with a one-night dip followed by recovery.

### R3-04 (MEDIUM): When the first mark falls on a mixed day, that day reads the booked P&L only (0.00 % against a true +1.26 %) and is not named

**Evidence:** EXECUTED.
**File:** `analytics-service/services/unit_switch_series.py`, `build_switched_series`, in the withholding condition
`(first_mark is None or ts.date().isoformat() < first_mark)`. Also `services/nav_marks_apply.py` rule 3.

**Issue:** The docstring says "the marks block replaces every day from that mark on". The first mark day is
replaced, but its base is rolled back through the early run's own return on that day,
`L(S-1) = (w_S - F_S)/(1 + r_S)`. That return is the booked P&L over a level that omits the held coin's move. So
the first marked return is `(P + upl)/L_booked`, and that day's coin move is lost.

On the fixture with marks from 11-17, 11-15 and 11-16 are withheld and named. 11-17 reads **+0.00000 %** against a
true **+1.26242 %**, and it is not in `unpriced_days`. This is reachable for any key whose marks begin during its
transition, for example a new OKX connection made after the first BTC buy. It does not apply to the measured account
(marks from 10-26).

**Fix:** When `first_mark` is itself a mixed day (`mixed_from_day < first_mark <= last_usd_day`), withhold it too
(`<= first_mark` in that case). Then `r_S` is NaN, `apply_marks` rule 4 pins the mark with no row, and the next mark
chains from it. Add the fixture's marks-from-11-17 case as a test.

### R3-05 (MEDIUM): A flow that lands before the first mark's read on the next UTC day skews every return before the first mark

**Evidence:** EXECUTED.
**File:** `analytics-service/services/unit_switch_series.py`, `build_switched_series`, the early run:
`external_flows=[f for f in flows_usd_side if str(f[0])[:10] <= first_mark]`, anchored at
`usd_marks[first_mark]`. Also `services/nav_marks_apply.py` rule 10, which the derive applies for OKX through
`_apply_instants = _event_flow_instants`.

**Issue:** A mark is read on the UTC day after its label, so its wallet already holds a flow made on that day before
the read. Rule 10 moves such a flow into the mark's day. The early run, though, is anchored at that same wallet and
filters flows by their own day. The moved flow is therefore read as level that was already there, and every pre-mark
level is too high by its amount.

EXECUTED with a 500 USDT deposit at 03:00Z on 11-09 (mark 11-08 read at 05:30Z): 11-06 reads +1.03093 % against a
true +1.08696 %, and 11-07 reads +1.02041 % against a true +1.07527 %. 11-08 and 11-09 are off as well. The error is
the flow over the level on every pre-mark USD day, it is permanent (the first mark is fixed history), and no flag
fires. The same deposit placed at 12:00Z on the mark day itself is exact.

Whether the measured key had a flow on 10-27 before its 10-26 mark was read is unmeasured.

**Fix:** Place flows for the early run by the same rule as the apply. Count the amount that
`placed_flow_instants`/`flow_moves` moves into `first_mark` as a flow on `first_mark`, and leave it out of
`first_mark + 1`. Alternatively, anchor the early run at the base `apply_marks` computes for the first mark. Add the
03:00Z-deposit case as a test.

### R3-06 (MEDIUM): The masthead says "No BTC close" for withheld mixed days and window-gap days, which have a stored close

**Evidence:** TRACED.
**File:** `analytics-service/services/unit_switch_series.py` (`unpriced_days = withheld_usd_days + …`).
Also `analytics-service/services/job_worker.py`, `_unit_segments_payload`, where the SF2-03 gap days are appended to
`unpriced_days`. Also `src/lib/factsheet/unit-segments.ts`, `unitSwitchUnpricedNote`, which renders
`No ${toUnit} close for ${m} days: …. The ${fromUnit} figures leave those days out.`

**Issue:** R2-02 and SF2-03 reuse the one `unpriced_days` list, which means "no stored close", for two new causes:
- USD-segment mixed days with no mark. These are days before the switch, and they have closes.
- Coin days outside the bills window with no point.

On the fixture with no marks, or with marks only after S, the page reads "No BTC close for 6 days: Nov 15 – Nov 20".
All six days have stored closes, and they are USD days, not BTC days. The user-facing disclosure states a false
cause.

**Fix:** Carry the withheld mixed days and the gap days in their own sidecar list (for example `withheld_days`) with
their own copy, for example "No USD value is stored for N days during the move into BTC: …". Keep `unpriced_days`
for missing closes only, or make the note state no cause. Update `parseUnitSegments` and its tests.

### R3-07 (MEDIUM): R2-02's remaining limit is silent and is not recorded in CONTEXT, which the R2-02 fix required

**Evidence:** EXECUTED for the strategy path. TRACED for key mode.
**File:** `analytics-service/services/unit_switch_series.py`, `build_switched_series` (the `first_mark is None` arm).
Also `analytics-service/services/job_worker.py`, `_switched_key_usd` (`unpriced = list(coin.unpriced_days)`). Also
`256-CONTEXT.md`.

**Issue:** With no mark before the coin, or with marks only after S, every pre-coin USD return is still rescaled by
the held coin's unbooked move. On the fixture, 11-10 reads +0.97530 % against a true +1.04167 %. The cumulative
return is +9.04 % against a true +16.68 %, because the mixed week is also withheld. Only the mixed days are named,
and no DQ flag marks the rescaled days.

In key mode, the withheld mixed days are NaN in the headline but are not in the key's `key_inputs.unpriced_days`,
which lists only the converter's coin days. The compose therefore meets them as unexplained missing return days
rather than named ones.

The fix report states this limit. CONTEXT records no founder acceptance of the pre-coin rescale, although R2-02 asked
for a fix or for that acceptance. The measured account is not affected (marks from 10-26), but any OKX key added
after its owner began moving into a coin is.

**Fix:** Do one of the following:
- Raise a named DQ warning whenever a mixed day is withheld and no mark predates `mixed_from_day` (for example
  `mixed_days_unvalued`, giving `complete_with_warnings`).
- Record the founder's acceptance of the pre-coin rescale in CONTEXT and in the ROADMAP.

In key mode, add the withheld USD days to `key_inputs.unpriced_days`, so the compose names them.

### LOW (recorded only, not routed)

- `build_switched_series` drops `_early_meta`. Guard or floor flags from the early (mark-anchored) run are lost, and
  the meta of the S-anchored run, which the marks replace, is kept.
- `_usd_marks` reads every stored mark. For an allocated-capital strategy, `_marks_to_apply` keeps only the
  in-mandate marks, so the early run can be anchored at a mark that the apply does not use.
- `COIN_LEAD_TOLERANCE_DAYS = 14` was set when S came at 50 %. At 95 %, an account that averages into the coin over
  more than two weeks refuses `bills_precede_majority_beyond_tolerance` permanently.
- A first derive for an account that switched more than 93 days ago names every day from S+1 to the window as
  unpriced (SF2-03), while the stored rows for those days stay in the KPIs.
- Marks that start after S, together with withheld (NaN) mixed days, leave those days before
  `_applied_marks.covered_from`, and the runner breaks the chain there. This is the round-2 partial (c) class.
- `stored_segments_malformed` is transient but can never clear by itself, because only the refused derive would
  rewrite the record. It is reachable only through a foreign or future-version record.

**Reachability at ship.** Only R3-01 is reachable on the measured account at its first switched derive, because its
strategies are published. R3-02 needs a key re-point. R3-03 needs a dip below 95 % after S. R3-04 and R3-07 need
marks that start after the coin. R3-05 needs a flow before the first mark's read (unmeasured for this key). R3-06
needs withheld days. R3-02 and R3-03 need founder decisions. R3-07 needs either a fix or a recorded founder
acceptance.

_Round 3 reviewed: 2026-11-27T20:58:47Z · Reviewer: Claude (gsd-code-reviewer) · Depth: standard_

### Round 3, silent-failure hunter (merged by the orchestrator)
- **SF3-01 (MEDIUM-HIGH)** `job_worker.py` `_book_switched_series` call `mixed_from_day=(read.census.get(switch.coin) or (None,))[0]`: once the coin bills age out of the window, or the switch comes from the stored record, `mixed_from_day` is None and no mixed day is withheld for keys without marks. Fix: persist `mixed_from_day` in the record and fall back to it.
- **SF3-02 (MEDIUM)** `_UNIT_SWITCH_STORED_MALFORMED` is transient, but a malformed record never clears by retrying. Fix: make it permanent.
- **SF3-03 (MEDIUM)** `_read_stored_usd_rows` and `read_key_marks` failures escape unnamed to the generic classifier (siblings use `holdings_read_failed` / `closes_read_failed`); `float(r["daily_return"])` unguarded. Fix: named transient tokens.
- **SF3-04 (MEDIUM)** a record without `api_key_id` is treated as another key and re-derived silently. Moot at ship (no record exists on PROD yet), superseded by the R3-01 fix.
