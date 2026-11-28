---
phase: 256-okxunitswitch-an-okx-account-that-moves-from-usdt-into-a-coi
fixed_at: 2026-11-27
review_path: .planning/phases/256-okxunitswitch-an-okx-account-that-moves-from-usdt-into-a-coi/256-REVIEW.md
iteration: 1
scope: Python side only (analytics-service). src/ untouched (SF-04 / IN-04 go to another fixer).
findings_in_scope: 8
fixed: 7
partial: 1
status: partial
---

# Phase 256: Code Review Fix Report (Python, round 1)

Verification ran in the isolated harness worktree (a checkout of `gsd/phase-256-okxunitswitch` at
`c44166f96`), with the system `python3` (the main checkout's `.venv` was not used). Commands:
`cd analytics-service && python3 -m pytest <files>` and
`python3 -m mypy --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`
(the `make typecheck` command line, with the system mypy because the worktree has no `.venv`).

Commits, in order:

| Finding | Commit | Status |
|---|---|---|
| SF-05 | `8d44fae8a` | fixed |
| SF-01 | `1153688ee` | fixed |
| SF-02 | `c351044b9` | fixed (logic: requires human verification) |
| WR-01 | `a7d895075` | fixed (logic: requires human verification) |
| CR-01 (founder ruling "Move switch to coin majority") + SF-03 splitter half | `b3f470140` | fixed, with the limit below (logic: requires human verification) |
| WR-02 (+ SF-03 builder half) | `0af4ad13f` | partial: flow arm not fixed |
| CR-02 | `9e1edc547` | fixed (logic: requires human verification) |

## Fixed

### SF-05: skipped holdings rows were silent
`unit_switch.unusable_holdings_rows` counts what `end_of_day_holdings_from_rows` skips; the resolver in
`job_worker` logs the count and refuses `holdings_unavailable` when most spot rows do not parse.

### SF-01: an old coin bill set S with no holdings history
With no observed holdings the derive now refuses `holdings_unavailable` (the live balance cannot say
when the majority began). Superseded in shape by CR-01 (S only from observed holdings), landed first so
its tests are RED on the pre-fix code.

### SF-02: a flow dated today refused the refresh
`_book_switched_series` takes today's flows out of the anchor (`equity - sum(flows after the latest
completed day)`) and out of the flows the builder books, instead of refusing. Not a bare deletion of
the guard: a flow left in the anchor would shift every earlier level by its size. An anchor that is not
positive after the subtraction refuses `switch_anchor_unpriced` (transient). The dead token
`flow_after_latest_close` is removed.

### WR-01: anchor at yesterday's close against live equity
`exchange._okx_ccy_price` records `eqUsd / eq` per currency from the SAME balance response
(`get_and_clear_last_okx_ccy_price`); `build_switched_series` takes it as the required `anchor_price`.
A response with no readable price for the coin refuses `switch_anchor_unpriced` (transient), never a
fallback to the close. The latest completed day must still have a close (its coin return is converted
with it). The harness default balance details now carry `eq`.

### CR-01 (founder ruling 2026-11-27, "Move switch to coin majority"): recorded in 256-CONTEXT.md and the ROADMAP
- `derive_unit_switch`: S is the start of the final unbroken run of coin-majority end-of-days, from
  observed holdings only (no bill, live balance or clock pins it). No persistent majority:
  `coin_bills_without_majority` (a majority that later fell back: `switch_back`). First coin bill more
  than `COIN_LEAD_TOLERANCE_DAYS` before S: `bills_precede_majority_beyond_tolerance`. No observation of
  the day before S: `ambiguous_boundary`.
- `split_daily_pnl_at_switch`: a coin amount on or before S is valued at its own day's close into the
  USD segment (the rule that held for S, extended back). `exchange._okx_book_switched_coin` no longer
  refuses a coin bill dated before S.
- The founder-shaped fixtures now read 25 % BTC from the end of 11-14 and 99.7 % from the end of 11-20,
  so S = 11-20 and the first coin day 11-21, the date in the ruling.

**Limit, stated plainly.** The relayed instruction said the headline USD path must equal the true USD
path on the mixed days. With bills alone it cannot: the held coin's own price move (25 % of the
account on those days) is in no bill. The founder ruling's own wording rests on the marks ("The USD
figures for those days are true USD values (marks)"), and the marks block is unchanged. What is fixed
and tested: the mixed days are USD days (the coin is never booked, so no BTC move is invented on the
whole NAV: a mixed day with no P&L now returns 0 where it returned +0.44 %), and S, the segments and
the transition fees follow the ruling. An UNMARKED derive of a mixed account still omits the held
coin's price move on those days; closing that would need the coin's end-of-day holdings value times
the close ratio booked as USD P&L, which is beyond the ruling and not done. A residual stable balance
after S (up to 50 %) is still valued as coin, as the ruling accepts ("clear majority").

### CR-02: the switch was rebuilt nightly from the 93-day bills window
- `derive_unit_switch(..., prior=)`: a stored switch persists unless the evidence contradicts it
  (another census coin or another coin majority: `two_coins`; the coin falling back below the majority
  after S or on the live balance: `switch_back`). An empty census is no evidence of "no switch".
- The derive reads the stored `unit_segments` (strategy row, or the key's `key_inputs` payload) before
  the bills read, validates it, passes the switch to the resolver, and, when no coin bill is in the
  window, confirms the stored switch itself and synthesizes the read from the stable records.
- `build_switched_series(..., bills_from_day=)`: when S is older than the window the coin segment is
  based on the day before it; the stretch before is not rebuilt (it would be zero-return rows
  overwriting stored real ones) and the USD segment is not rebuilt. `SwitchedSeries.coin_base_day`
  carries it; key mode's native converter bases there too.
- `_unit_segments_payload` carries the stored segments' older USD and coin points and older unpriced
  days forward for the same switch, so both segments cover the whole stored history.
- S can no longer drift forward as bills age out: S never comes from a bill (CR-01) and a stored S is
  kept.

## Partial

### WR-02 + SF-03
Fixed:
- A coin day with no stored close is withheld by name the same way whatever it carries. A stable
  amount (`split_daily_pnl_at_switch`, landed in the CR-01 commit) or a funding row (builder) on such a
  day is left out and the day named; the account is kept. Nothing is priced at a neighbour's close.
- Strategy mode (`span_unpriced_days=True`) carries the coin level across the hole: the first priced
  day after it holds the compounded native returns of the whole run times `close(d) / close(base)`, so
  no return is lost. Key mode keeps its holes (its compose segments the key there).
- Without marks the derive stamps `marks_covered_from` at the first unpriced day, so the runner's dense
  reindex does not turn the named day into a chain break. With marks the marks block owns it. No `src/`
  reader of `marks_covered_from` exists.
- `unpriced_days` of the sidecar is recomputed against the FINAL headline (after marks), so no day the
  marks (or the carried hole) gave a figure is named.

Not fixed:
- An external FLOW on an unpriced coin day still refuses `coin_segment_unpriced`: it cannot be left out
  without shifting every earlier level. It is a named, permanent refusal as before.
- A coin amount on a USD-segment day (on or before S) with no close refuses `switch_day_unpriced`:
  a USD day cannot be left out of the chain, so it is named rather than given a figure missing the
  amount. The relayed CR-01 text asked for "withheld by name"; for USD days that is not representable
  without a NaN row.
- Marks that start AFTER a hole keep the runner's chain break (the marks boundary wins).

## PROOF-01 record

Each test was written against the pre-fix code and seen RED, or the fix was neutered from a byte backup
(`cp` to the scratchpad, neutered or pre-fix copy, run, `cp` back, `cmp` silent, GREEN). Key lines:

- SF-05: new test RED pre-fix (`DONE` where `FAILED holdings_unavailable` expected), GREEN after.
- SF-01: pre-fix `unit_switch.py` restored from `HEAD`: `3 failed, 96 passed`
  (`no_holdings_live_majority`, `..._no_holdings_history_refuses_by_name`,
  `test_no_stored_holdings_refuses_by_name_even_with_a_live_btc_majority`); fixed copy restored,
  `cmp-silent`, `99 passed`.
- SF-02: anchor neutered to `float(equity)`: `1 failed` (`comparison failed`); restored, `cmp-silent`,
  `1 passed`.
- WR-01: builder neutered to divide by `close_by_day[latest_close_day]`: `2 failed`
  (`test_the_pre_switch_history_does_not_move_with_the_overnight_price`,
  `test_stored_rows_before_the_switch_do_not_move_with_the_price_the_derive_ran_at`); restored,
  `cmp-silent`, `89 passed`.
- CR-01: `unit_switch.py` and `exchange.py` restored from `HEAD` (old `min(first bill, first majority)`
  rule): the S assertion fails (`last_usd_day 2026-11-13 != 2026-11-19`-shaped diff) and the mixed day
  returns `0.004405286343612369` where `0.0` is expected; restored, `cmp-silent`, `173 passed`.
- WR-02: `job_worker.py` and `unit_switch_series.py` restored from `HEAD`:
  `3 failed` (`TestADayWithNoCloseIsWithheldByNameAndTheAccountIsKept`); restored, `cmp-silent`,
  `180 passed`.
- CR-02: `job_worker.py`, `unit_switch_series.py` and `unit_switch.py` restored from `HEAD`:
  `3 failed` (`TestASwitchPersistsAfterItsCoinBillsAgeOutOfTheBillsWindow`, strategy, switch-back and
  key mode); restored, `cmp-silent`, `188 passed`. The window is cut with
  `monkeypatch.setattr(services.exchange, "OKX_BILLS_REACH_DAYS", 5)`.

Final run of the six unit-switch test files: see the handback. `mypy` (the `make typecheck` path set):
`Success: no issues found in 148 source files`.

---

_Fixer: Claude (gsd-code-fixer), iteration 1. Not committed here: the orchestrator commits this file._

---

## Round 2

Python side only (`analytics-service`); `src/` untouched. Verification ran in the isolated harness
worktree on top of `3eb9da4aa`, with the main checkout's `.venv` used read-only. Commands: `cd analytics-service
&& python -m pytest <files>` and the `make typecheck` line (`mypy --config-file=pyproject.toml services/ routers/
models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`): `Success: no issues found in 148 source
files`. The six unit-switch files: 199 passed; `test_derive_broker_dailies*.py` plus `test_csv_analytics_runner.py`:
222 passed.

| Finding | Commit | Status |
|---|---|---|
| R2-02 | `97e68128c` | fixed (logic: requires human verification) |
| R2-04 / SF2-02 | `d76b4be9e` | fixed |
| R2-03 + SF2-03 | `9d1b5b700` | fixed (logic: requires human verification) |
| R2-05 + SF2-01 | `965497ce0` | fixed |
| R2-01 (founder answer "95% coin and stays") | `3bc882680` | fixed (logic: requires human verification) |

### R2-02: earlier USD returns were rescaled by the held coin's unbooked price move
`build_switched_series(usd_marks=, mixed_from_day=)`. The derive reads the stored marks before the builder
(`read_key_marks`, realized-basis level `nav_usd - open_pnl_usd`) and passes the first coin bill day from the
census. The days through the earliest mark are rebuilt by a second engine run anchored at THAT mark's level; the
marks block still replaces every day from that mark on. A mixed day (after the first coin bill, through S) that
no mark precedes is NaN in the headline and named in `unpriced_days`, never read as 0 %.
Limit, stated plainly: the early days are exact only when the earliest mark predates the first coin holding. A
mark that begins inside the mixed days leaves the stretch between the coin's first day and that mark rescaled by
that stretch's unbooked move (the mixed days before the mark are withheld, the days before the coin are not). With
no mark at all the pre-coin days stay rescaled; only the mixed days are withheld. Two existing derive tests that
asserted a mixed day reads 0 % were changed to assert the new withholding (that assertion is the defect).
Oracle: the reviewer's case, 11-10 is 100 / 9600 = +1.0417 % (booked +0.9752 % in the test scenario before the fix).

### R2-04 / SF2-02: the runner's chain boundary
The record is built once before the prestamp, and `marks_covered_from` is the oldest day of its final
(carried plus fresh) `unpriced_days`, not `_switched.unpriced_days[0]`.

### R2-03 + SF2-03: the first switched derive's chart
The derive reads the stored `csv_daily_returns` rows through S (same scope as the reconcile: `strategy_id`, or
`api_key_id` in key mode, paged with `paginated_select`) once a switch is booked. When no stored record carried
older USD points, they seed the USD segment (stored rows older than the first fresh point). The coin days between
`first_coin_return_day` and the first coin point are named in `unpriced_days` (the declared `from_day` stays at
S + 1, which `_stored_unit_switch` validates), so the chart cannot draw across the gap. A side effect that is the
point of R2-04: those named days also set `marks_covered_from`.

### R2-05 + SF2-01: the stored record
The record carries `api_key_id`. A record of another key is ignored (derived from scratch, no refusal); a record
with no id is treated the same way. A record that exists but fails validation logs only its type and top-level key
names and refuses transient with the new closed detail token `stored_segments_malformed`, so it is never
overwritten.

### R2-01: the threshold
Founder answer "95% coin and stays". New `COIN_SWITCH_SHARE = 0.95` drives S, the persistence confirm, the
switch-back arms and the live check. `COIN_MAJORITY_SHARE = 0.5` is kept for the separate `two_coins` rule (another
coin that is itself a majority). Fixtures restored to the measured shape (75 % BTC from the end of 11-14, 99.7 %
from the end of 11-20): S = 11-20, first coin day 11-21. New arms: a 75 % account does not switch (RED at 50 %), and
the threshold is inclusive at 95 %. Other fixtures that used 55-80 % as "majority" were moved to 96-99 %. No rule
version is stored in the record (R2-01 asked for one only if the threshold changed for stored accounts: none exist
on `main` yet), so a future threshold change will not reach a stored record; recorded, not fixed.

### PROOF-01 (each fix)
Each new or changed test was RED before the fix (new keyword arguments raised `TypeError`; the others failed on
their assertion). After each fix the pre-fix source was copied over the fixed file from a byte backup, the tests ran
RED again, the fixed file was restored with `cp`, and `cmp` was silent:
- R2-02: 6 failed pre-fix (3 in `test_unit_switch_series.py`, 3 in `test_okx_unit_switch_derive.py`).
- R2-04: the chain-boundary test: `'2026-11-25' == '2026-11-17'` pre-fix.
- R2-03 + SF2-03: the first-derive seed test: `[] == [17 stored points]` pre-fix.
- R2-05 + SF2-01: both tests RED pre-fix (`KeyError: 'api_key_id'`, and DONE where a refusal is required).
- R2-01: 3 failed with the 0.5 constant restored (founder shape, mixed account, the 75 % arm).

Not fixed, by instruction: LOW and Info items.

---

_Fixer: Claude (gsd-code-fixer), iteration 2 (round 2). Not committed by the fixer beyond this file._

---

## Round 3

Targeted round on top of `71c747958`. Python (`analytics-service`) and TS (`src`). Verification ran in the
isolated harness worktree with the main checkout's `.venv` read-only and a `node_modules` symlink (untracked,
ignored, never committed). Not touched, by instruction: R3-02, R3-04, R3-05, R3-07, SF3-01 (they wait on
founder decisions or are routed), and every LOW/Info item.

| Finding | Commit | Status |
|---|---|---|
| R3-01 | `3eaf4fc63` | fixed |
| SF3-02 | `d8a653a9c` | fixed |
| SF3-03 | `af7c8d813` | fixed |
| R3-03 (founder ruling "<50% for 7 days") | `3f7ee87af` | fixed (logic: requires human verification) |
| R3-06 | `d68d6cbf1` | fixed |

### R3-01: the raw key id is out of the anon-readable column
`_unit_segments_payload` writes `key_binding = sha256(key id)` (hex) and no `api_key_id`; `_read_stored_unit_segments`
compares digests. A key id is a random UUID, so the unsalted digest cannot be walked back to it; no server secret
is needed and none is added. Key mode's record lives in `allocator_equity_derived.payload`, which has an
owner-only SELECT policy and NO anon policy (anon is denied by RLS, though the table-level grant stands), and
whose row `kind` already carries the key id. It would have been safe to keep the id there, but the record is one
function with one shape, so key mode stores the digest too. A record with no `key_binding` is treated as another
key's (no record exists on PROD yet). Not done: the review's optional SQL gate arm for anon reading a key id
through `strategy_analytics`; the minimal fix removes the value, and the Python test pins that it is absent.

### SF3-02: `stored_segments_malformed` is permanent
Removed from `_UNIT_SWITCH_TRANSIENT_TOKENS`; added to the closed detail set on its own so the token still rides
the message; the refusal call now derives `permanent` from the transient set instead of a literal `False`.

### SF3-03: named transient refusals for the marks and stored-returns reads
`_book_switched_series` wraps `read_key_marks` and `_read_stored_usd_rows` wraps its page read and its row
parse, each like `holdings_read_failed`: `_READ_PROGRAMMING_ERRORS` re-raise, any other failure logs the class
name only and returns `marks_read_failed` / `stored_returns_read_failed` through the existing
`_refuse_incomplete_read` path. Both tokens are in the transient set and so in the closed detail set. The harness
(`okx_unit_switch_derive_harness.py`) gained `marks=` and `stored_csv_rows=` accepting an exception.

### R3-03: a switch back is the coin under 50 % for 7 consecutive days
Founder ruling 2026-11-27 ("<50% for 7 days (Recommended)"). `unit_switch.py`: `SWITCH_BACK_SHARE = 0.5`,
`SWITCH_BACK_DAYS = 7`, helper `_switched_back`. `COIN_SWITCH_SHARE` (95 %) now decides only WHEN. Interpretations
made, so they can be checked:
- "Consecutive" is calendar-consecutive observed days; a day with no observation or a day at or over 50 % ends
  the stretch. Any such 7-day stretch after S counts, including one the coin later recovers from.
- The live reading no longer refuses on its own in either path (it still feeds `two_coins` and the no-holdings arm).
- First-derive path: S is the FIRST end-of-day at 95 % (was: the start of the last unbroken run), so a short dip
  no longer moves S. The existing test of the old rule was changed to assert that.
- Existing fixtures for switch_back were widened to seven days (`tests/test_unit_switch.py`, two derive tests);
  the single-live-reading refusal case was dropped and replaced by a no-refusal test.
Tests (RED before): one night at 90 % after S, 6 days under half, a live 90 % reading, each for the stored and
the first-derive path; 7 consecutive days stays `switch_back`.

### R3-06: withheld and gap days have their own list and copy
`SwitchedSeries.withheld_days` (default `()`) carries the withheld mixed days; `unpriced_days` keeps its meaning
for existing callers. The record gains `withheld_days` (withheld mixed days plus the SF2-03 gap days) and its
`unpriced_days` now means "no stored close" only. Older withheld days are carried from the stored record like
the older unpriced days; the runner's `marks_covered_from` is the oldest day of either list. TS:
`parseUnitSegments` reads `withheld_days` (absent reads as none, malformed reads the record as absent),
`unitSwitchWithheldNote` composes "No stored USD value for {m} day(s) around the move into BTC: ... The USD
figures leave {that day|those days} out." (cause-neutral between mixed days and gap days, never "close"), and
`UnitSwitchDisclosure` renders it as its own line (`factsheet-unit-switch-withheld-note`). UI-SPEC copy table
has the new row. Three test fixtures that build a `UnitSegmentsView` gained `withheldDays: []`.

### Verification
Python, from `analytics-service/`: `test_unit_switch.py`, `test_unit_switch_series.py`,
`test_okx_unit_switch_derive.py`, `test_okx_unit_switch_key_mode.py`, `test_csv_analytics_runner.py` and
`test_derive_broker_dailies*.py` green; `make typecheck` line (`mypy --config-file=pyproject.toml services/
routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`): `Success: no issues found in
148 source files`. TS: `npm run typecheck` clean; vitest `unit-segments.test.ts`, `FactsheetView.unit-switch.test.tsx`,
`FactsheetView.unit-switch-leverage.test.tsx`, `TimeSeriesChart.unit-switch.test.tsx`: 99 passed. Ran in the
isolated worktree, not the main checkout.

### PROOF-01
Pre-fix RED was run on the untouched source before each fix: R3-01 + SF3-02 + SF3-03, 7 failed (the re-point,
malformed, raw-key-id x2, marks, stored-returns and unparseable-row tests); R3-03, 6 failed (90 % night, 6 days,
live reading, each stored and first-derive); R3-06, 4 failed Python (the mixed-day, marks-before-coin, first-derive gap and carry tests); its TS tests went
RED in the neuter run below. After the five commits, the pre-round `job_worker.py`, `unit_switch.py`, `unit_switch_series.py` and
`unit-segments.ts` were copied from byte backups over the fixed files: Python 18 failed, 129 passed; TS 13 failed,
59 passed. The fixed files were restored with `cp` and `cmp` was silent for all four; `git status` clean.

---

_Fixer: Claude (gsd-code-fixer), iteration 3 (round 3)._

## Security-review follow-up to R3-01 (2026-11-28)
- Finding (automated security review, MEDIUM): the R3-01 `key_binding` was an unkeyed sha256 of the key id in the anon-readable column, so the same key could be matched across strategies, which still defeated the Phase 170.6.1.1 anon key-id rule.
- Fix: `_key_binding(key_id, scope)` salts the digest with the record's own scope (the strategy id in strategy mode, the allocator id in key mode, which is owner-only), so the same key gives a different digest on every strategy. A key id is a random UUID, so the digest still cannot be walked back to it. No server secret is needed, so a rotation cannot silently unbind records.
- PROOF-01: neutered to the unsalted digest, then `test_the_stored_record_never_carries_the_raw_key_id[False]`, `[True]` and `test_the_key_binding_differs_per_strategy_for_the_same_key` FAILED (3 failed). Restored with `cp`, `cmp` silent, then 3 passed. The affected suites gave 64 passed, and mypy strict reports no issues.
