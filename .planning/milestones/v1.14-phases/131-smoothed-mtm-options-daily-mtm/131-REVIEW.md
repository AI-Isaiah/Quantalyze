---
phase: 131-smoothed-mtm-options-daily-mtm
reviewed: 2026-07-22T00:00:00Z
depth: deep
re_review_round: 3
files_reviewed: 8
files_reviewed_list:
  - analytics-service/services/allocated_capital.py
  - analytics-service/services/deribit_ingest.py
  - analytics-service/services/deribit_txn.py
  - analytics-service/tests/test_deribit_ingest.py
  - analytics-service/tests/test_deribit_txn.py
  - analytics-service/tests/test_native_nav_sc4_identity.py
  - analytics-service/tests/test_smoothed_mtm_core.py
  - analytics-service/docs/evidence/drb-option-daily-marks-2026-07.json
findings:
  critical: 2
  warning: 5
  info: 3
  total: 10
re_review_findings:
  resolved: 10
  not_resolved: 0
  new_blockers: 0
re_review_verdict: PASS
status: resolved
---

# Phase 131: Code Review Report (smoothed-MTM analytics core)

**Reviewed:** 2026-07-22
**Depth:** deep (money-path, cross-file: deribit_txn → deribit_ingest → native_nav)
**Scope:** commits `ab4b8250..32c3a41c` (plans 131-01a + 131-01b)
**Status:** issues_found — **BLOCK for the phase goal** (smoothed basis cannot survive a live OPEN options book). **No blocker for the existing bases** — `cash_settlement` and `mark_to_market` byte-identity is CONFIRMED (see "What was verified clean").

## Summary

The additive gating discipline is genuinely excellent: every production hunk is inside
a `use_smoothed`/smoothed-gated arm, a new function, an enum line, or a defaulted
field/kwarg, and the `series_daily = native_daily` alias is byte-identical for
non-smoothed bases (same object → same iteration order → same float ops). SC-4 holds.

However, the smoothed core itself has a structural defect cluster around **open
option positions** — the everyday live state of an options account. The marks-fetch
window and the day-grid both terminate at the last *event* day instead of the last
*settlement*, and the fetch end-bound excludes the newest day's 08:00-stamped bar
entirely. Every open-book code path either hard-fails (D-07 hole / book-channel
breach) or silently truncates the daily series. The identity channels additionally
contain a window-boundary mis-slice that will spuriously breach on real accounts.
All open-book tests are masked: the stub ignores `start_timestamp`/`end_timestamp`,
every open fixture has a single event day, and the summary cross-check fixture derives
its expected `rpl` from the implementation's own formula (a self-referential oracle,
the exact failure mode the money-math testing rule forbids).

Nothing invokes `smoothed_mtm` in production yet (worker/frontend land in 131-02/03),
so nothing live is broken today — but these must be fixed before 131-02, and CR-01/CR-02
invalidate the phase success criterion "a Deribit options book renders a smoothed_mtm
factsheet."

## Critical Issues

### CR-01: Marks fetch end-bound excludes the newest day's 08:00 bar — open positions can never be marked on their last held day

**File:** `analytics-service/services/deribit_ingest.py:748` (`end_ms = int(pd.Timestamp(newest_day, tz="UTC").timestamp() * 1000)` in `fetch_deribit_option_daily_marks`), interacting with `_build_smoothed_option_mtm` (`deribit_ingest.py:1958-1962`)
**Issue:** The phase's own evidence (M1/M7: `bar_stamp_utc: 08:00`) pins that 1D bars are ticked at **08:00 UTC**. The fetch requests `[oldest_day 00:00, newest_day 00:00]`, so the bar for `newest_day` itself (ticked `newest_day 08:00`) is **outside the requested range** and never returned. The perp sibling avoids this deliberately by using `end_ms = now()` (`deribit_ingest.py:637`); the clone replaced that with a midnight bound. Consequences:
- Single open instrument (opened day T, no later events): window is `[T 00:00, T 00:00]` → **zero bars** → wholly-empty response → in-retention → kept → `option_mtm_daily` hole guard fires on day T → `LedgerValuationError` on a perfectly healthy account.
- Multi-day open instrument: `mark[last_event_day]` is unfetchable while the position is nonzero on that day → same spurious D-07 hole.

**Failing scenario:** Buy `BTC-27MAR26-50000-C` on 2026-07-20, hold; crawl on 2026-07-22 under `smoothed_mtm` → fetch `[2026-07-20T00:00, 2026-07-20T00:00]` → 0 bars → hole guard names 2026-07-20 → ledger build hard-fails.

**Why tests are green:** `_OptionsAdapterStub.public_get_get_tradingview_chart_data` (test_smoothed_mtm_core.py:214-224) **ignores `start_timestamp`/`end_timestamp` entirely** and returns every scripted bar. The new ingest test pins the params (`end_timestamp == newest_day 00:00`) — i.e. the bug is test-blessed, never exercised against the 08:00 stamping the evidence records.

**Fix:** End-bound must cover the newest needed bar: `end_ms = int(pd.Timestamp(newest_day, tz="UTC").timestamp() * 1000) + 24*3600*1000` (or mirror the sibling's `now()` capped at expiry+1d). Add a regression test whose stub *filters bars by the requested range* with 08:00-ticked bars.

### CR-02: Marks window and day-grid stop at the last EVENT day, not the last settlement — open books hard-fail or silently truncate; multi-instrument books trip spurious D-07 holes

**File:** `analytics-service/services/deribit_ingest.py:1958-1962` (`newest = last_day if expiry is None else min(last_day, expiry)`); `analytics-service/services/deribit_txn.py:1955-1959` (`candidate_lasts` in `option_mtm_daily`); `replay_option_positions` (`deribit_txn.py:1963` — `last_day` = last trade/delivery day)
**Issue:** The pinned identity (131-CONTEXT, M5/M7 evidence) is `Σ_d native_pnl = Σchange + Book[last_settlement]`, and the Task-5 book channel reconciles the terminal book against the anchor's **current** settled book (`options_value − options_session_upl`, read at crawl time). But the implementation values the book only through the last *event* day per instrument (`last_day` from the replay = last trade/delivery row). Even with CR-01 fixed:

- **(a) Open single instrument, no trades since day T:** grid ends at T; `terminal_book = Book(T)` at the day-T mark; the anchor is the settled book at crawl time. Tolerance is `max($1-equiv, 1e-4·max(throughput, |anchor|))` — any mark move > ~1bp since T breaches `_assert_smoothed_book_channel` → hard fail. If the mark happens not to have moved, the ΔMTM series silently **omits every day between T and the current settlement** — the factsheet's "honest daily worth" simply stops at the last trade.
- **(b) Interleaved instruments:** the dense grid is global (`global_last = max` over all instruments), but marks are fetched per-instrument only through that instrument's own `last_day`. Instrument A held open past its last event while instrument B trades later → A carries a nonzero position on days `(A.last_event, B.last_event]` with **no fetched marks** → spurious `LedgerValuationError` hole naming A, even though the bars exist on Deribit — the fetcher was simply never asked.

**Failing scenario (b):** Buy `BTC-27JUN25-100000-C` on Jun-1 (hold open), trade `BTC-4JUL25-90000-P` on Jun-10. Marks for the call fetched only for Jun-1; grid runs Jun-1→Jun-10; Jun-2 has call position 1.0 and `mark=None` → hole guard fires with a false "structural hole" message.

**Why tests are green:** every open-book fixture (`_OPEN_ROWS`, acceptance C) has exactly ONE event day and an anchor hand-set equal to the stale one-day book (`0.15 − 0.03 = 2.0 × 0.06`); no fixture has two instruments with interleaved lives.

**Fix:** For an instrument whose final replayed position is nonzero (no delivery/close), extend the marks window and the held life to `min(current_settlement_day, expiry)` — i.e. `newest = min(max(last_day, today_or_last_settlement), expiry)` when the terminal position ≠ 0 — and make `option_mtm_daily`'s grid honor "held through last settlement," not "held through last event." Add: (i) an open fixture with ≥2 days between last trade and crawl and a moved mark; (ii) a two-instrument interleave fixture.

## Warnings

### WR-01 (HIGH): H1 wedge double-counts the open settled book under smoothed_mtm — §5 inception reconciliation breaks on any open-book smoothed NAV account

**File:** `analytics-service/services/deribit_ingest.py:2180-2191`
**Issue:** The H1 wedge branch is `if pnl_basis == PNL_BASIS_MARK_TO_MARKET: wedge = session_upl; else: wedge = session_upl + options_value`. `smoothed_mtm` falls into the `else` — but under smoothed the ΔMTM merge already carries the settled open book INTO `native_pnl` (that is precisely what `_assert_smoothed_book_channel` asserts: `terminal_book == options_value − options_session_upl`). Adding full `options_value` to the wedge counts the settled book **twice**. Using the phase's own pinned anchor identity (acceptance C: `equity − session_upl == cash + options_value − options_session_upl`) with a green book channel and zero flows: required wedge `= equity − Σnative_pnl = session_upl` — i.e. smoothed belongs with the **MTM arm**, not the cash arm. With the `_OPEN_SUMMARIES` fixture, `reconstruct_native_nav_and_twr` §5 would see residual ≈ `options_value = 0.15` and permanently fail a healthy account — the exact failure class the H1 comment itself warns about for MTM ("adding it to the wedge would DOUBLE-COUNT").
**Why tests are green:** no test runs the NAV reconstruction (§5) under smoothed with an open book; ledger-build tests stop at `build_deribit_native_ledger`.
**Fix:** `if pnl_basis in (PNL_BASIS_MARK_TO_MARKET, PNL_BASIS_SMOOTHED_MTM): wedge = native_upnl` — plus decide the `options_session_upl` residue explicitly (with the pinned decomposition, `session_upl` alone closes; pin it with a §5-through test on the open fixture). Gate this on the CR-02 fix (the terminal book must be at the current settlement for the closure to be exact).

### WR-02 (HIGH): Summary cross-check (Q3-3) ΔBook window mis-slices day-boundary book entries — spurious breaches on real accounts; fixture oracle is self-referential

**File:** `analytics-service/services/deribit_txn.py:1806-1826` (`_assert_smoothed_summary_cross_check`)
**Issue:** ΔBook is summed over `start_day < day <= end_day` with `start_day = day(first_summary_ts − 24h)` and cash rows filtered by **millisecond** window membership. Two concrete live-breach classes:
1. **Coverage-era first trade after 08:00 on `start_day`.** For any post-rollout options account, the first summary lands at the 08:00 after the first option trade, so `start_day` = the first trade's day. A trade at, e.g., 10:00 is inside the ms-window (its cash counts) but its book entry `ΔMTM[start_day] = +Book[start_day]` is excluded by the day-slice → residual = the position's full initial book value ≫ `1e-4·throughput`. Cross-check this against Phase-82's own validated E3 closure: flat-flat windows close `Σ(rpl+upl) == Σ(change+commission)` to <$1 on the live Phoenix key; the code's identity instead yields `Σ(change+commission) − Book[start_day]` for that same shape — a contradiction with settled evidence, not a tolerance matter.
2. **Trailing trade on `end_day` after the last summary's stamp.** Its cash is outside the ms-window (`instant > end`), but its book entry lands in `ΔMTM[end_day]`, which IS summed → residual ≈ position book value. Any option trade on crawl day after 08:00 triggers this.
The green fixture (`_cross_check_rows`, `rpl=0.06 == −0.04 + 0.10`) sets `rpl` to whatever the code's formula produces — Deribit's actual session P&L for a position opened intra-session at premium 0.04 with `mark₁₆ = 0.15` would be ≈ 0.11, which breaches. This is exactly the self-referential-oracle failure mode the money-math testing rule pins against.
**Fix:** Align both sides on the same boundary semantics — either evaluate Book at the window-start/end *instants* (position-at-08:00, which the day-granular replay cannot express) or move BOTH boundary-day cash and boundary-day ΔMTM consistently in/out of the window (e.g., cash filter by UTC day `start_day < day(row) <= end_day` to match the ΔBook slice). Then re-pin the fixture with an economics-derived `rpl` (mark-vs-trade-price), and add the two boundary failing-scenario tests above.

### WR-03 (MEDIUM): Currency casing not normalized in the replay/ΔMTM path — phantom series bucket on non-uppercase currency

**File:** `analytics-service/services/deribit_txn.py:1938` (`ccy_of[instrument] = str(row.get("currency", ""))` — no `.upper()`); merge at `deribit_ingest.py:2054-2057`
**Issue:** Every other read site in this module uppercases the currency (~20 occurrences); `txn_rows_to_native_daily` buckets by `.upper()`. The replay stores raw case, `option_mtm_daily` keys `delta_mtm`/`terminal_book` on it, and the adapter merges those raw keys into the uppercase-keyed `series_daily` — a `"btc"` row would fork a phantom series bucket beside `"BTC"`, mis-splitting the daily series per currency. The book channel would NOT catch it (it uppercases both sides before comparing), and the pre-retention path DOES uppercase (`deribit_ingest.py:1975`) — internally inconsistent within the same function pair.
**Fix:** `ccy_of[instrument] = str(row.get("currency", "")).upper()` in `replay_option_positions` (one line; the rest follows).

### WR-04 (MEDIUM): `price <= 0` skip converts a legitimately-worthless option close into a "structural hole"

**File:** `analytics-service/services/deribit_ingest.py:772-773` (`if price <= 0: continue` in `fetch_deribit_option_daily_marks`)
**Issue:** Cloned verbatim from the perp index fetcher, where a non-positive price is nonsense. For options, a 0.0 close on a deep-OTM instrument near expiry is economically legitimate; skipping it deletes the day from the marks map, and the D-07 guard then hard-fails a held worthless position as a "structural hole" — a spurious fail-loud with a misleading message ("missing bar" when the bar existed with close 0). The M7 probe observed "closes: real, positive" on 4 instruments — not proof the venue never emits 0.
**Fix:** For the option fetcher, skip only `price < 0` (or coerce-and-keep 0.0), or record evidence that Deribit clamps option bars at the min tick and pin that in a comment + test.

### WR-05 (MEDIUM): Option-activity gate and the replay disagree on what "activity" means — empty replay vs nonzero anchor breaches; incremental crawls silently unsupported

**File:** `analytics-service/services/deribit_ingest.py:2046-2048` (gate) vs `_build_smoothed_option_mtm` early-return (`deribit_ingest.py:1948-1949`)
**Issue:** `deribit_raw_rows_have_option_activity` returns True on summary rows or ANY option-instrument row (any type), but the replay only consumes `trade`/`delivery` rows. If rows carry option evidence without trade/delivery rows (summary-only slice, option-instrument `correction`), the branch runs, replay returns `{}`, `terminal_book = {}` is still passed → book channel compares `{}` against a possibly nonzero venue anchor → breach. Relatedly, if `since_ms` is ever passed to `build_deribit_native_ledger` (the parameter exists), the replay sees absolute positions only from the first in-window row — days before it are silently unmarked and the first in-window day absorbs a book jump. Full-history is the Deribit norm today, but nothing pins it for this branch.
**Fix:** Either gate the smoothed branch on the replay itself (`positions` non-empty) with the anchor check still run when the anchor is nonzero (fail-loud kept), or assert/document `since_ms is None` for the smoothed arm. Both are one-liners plus a test.

## Info

### IN-01: Lexicographic id tie-break can mis-pick the end-of-day position on same-millisecond multi-fills

**File:** `analytics-service/services/deribit_txn.py:1944-1946`
**Issue:** `key=(instant, str(id))` — same-ms fills (market order sweeping levels) with ids of different digit length sort wrongly (`"999" > "1000"`), so the "last row of the day" can be an intermediate fill → wrong EOD position → mis-attributed (not mis-totaled) ΔMTM across two days; the book channel only catches it if it survives to the terminal day.
**Fix:** numeric-aware key, e.g. `(instant, len(sid), sid)` or int-parse with string fallback.

### IN-02: `_option_expiry_iso` uses locale-dependent `strptime(%d%b%y)`

**File:** `analytics-service/services/deribit_ingest.py:1904-1911`
**Issue:** `%b` parses the locale's month abbreviations. Under a non-C `LC_TIME` (e.g. de_DE: MAR/OCT/DEC fail), expiry → `None` → the pre-retention partition can never bucket → old wholly-empty instruments hard-fail instead of warning. No other `services/` code uses `%b`. Containers run C locale today — latent only.
**Fix:** explicit month map (`{"JAN":1,...}`) instead of `strptime`.

### IN-03: Old fully-intraday-scalped instruments are bucketed into pre_mark_retention warnings although no MTM was ever needed

**File:** `analytics-service/services/deribit_ingest.py:1969-1976`
**Issue:** An instrument opened and closed the same day (all EOD positions 0.0) needs no marks; if its expiry predates retention, its wholly-empty response still buckets its event days into `pre_mark_retention_option_days` → spurious `complete_with_warnings` stamp in 131-02.
**Fix:** skip bucketing when every replayed EOD position is 0.0.

## What was verified clean (review priorities 1, 5, 6, 7)

- **SC-4 / byte-identity of cash_settlement and mark_to_market: CONFIRMED, not just asserted.** Traced every production hunk: (i) enum additions only widen frozensets; (ii) `use_smoothed` arm in `txn_rows_to_native_daily` is unreachable for other bases and precedes no shared mutation; (iii) the `series_daily = native_daily` alias binds the SAME dict object for non-smoothed bases — the `native_pnl` comprehension iterates identical keys in identical order over identical floats (no copy, no re-ordering, no re-summation); (iv) `assert_balance_identity`'s four new kwargs default `None` and are referenced only inside the `pnl_basis == PNL_BASIS_SMOOTHED_MTM and terminal_book is not None` block appended after the existing body; (v) `native_options_session_upl` is parsed on all bases but only populates a new defaulted field — no existing output reads it; (vi) the adapter smoothed branch is doubly gated (basis AND `deribit_raw_rows_have_option_activity`); (vii) H1 wedge, CR-01 exemption, pre-coverage warnings all still branch on `PNL_BASIS_MARK_TO_MARKET` explicitly. Bit-exact pins (`check_exact=True`, `struct.pack`) corroborate.
- **Telescoping math** in `option_mtm_daily` is exact over the gridded span; `Book[d]−Book[d−1]` telescopes to `terminal_book`; shorts invert correctly (signed position × mark); a legitimately-closed position (EOD 0 on close day) does NOT trip the hole guard; delivery-day handling (position zeroed before marking) is correct. The defect is the SPAN (CR-01/CR-02), not the arithmetic.
- **Enum sync:** `smoothed_mtm` present in BOTH `deribit_txn._PNL_BASES` and `allocated_capital._VALID_PNL_BASES`; `DEFAULT_PNL_BASIS` unchanged (`cash_settlement`).
- **Leak discipline:** replay guard names id/type only (bespoke, stricter than `_coerce_float`); hole guard names instrument+day; both identity channels name currency + residual/tolerance ratio class only; the marks fetcher scrubs ccxt errors. No row payloads/balances in any new message.
- **Purity:** all `deribit_txn.py` additions are stdlib-only (date/timedelta), pandas/async-free; the ΔMTM merge lives in the async adapter as planned.

## Verdict

**BLOCK** — for the smoothed_mtm phase goal. CR-01 + CR-02 mean any account with an
open option position (the normal live state) either hard-fails the ledger build or
silently truncates its smoothed series at the last trade; WR-01/WR-02 add further
hard-fail classes on real data that the self-referential fixtures cannot see. The
existing `cash_settlement` / `mark_to_market` bases are byte-identical and safe to
ship as-is; the block applies only to proceeding to 131-02 (worker wiring) before
CR-01, CR-02, WR-01, WR-02 are fixed, each with a range-filtering stub, a
multi-day/multi-instrument open fixture, and economics-derived (non-self-referential)
oracles.

---

_Reviewed: 2026-07-22_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

---

# Re-Review (Round 2) — fixer verification against `32c3a41c..7ed1da0e`

**Re-reviewed:** 2026-07-22 · **Verdict: BLOCK (one more fix round)** · 9/10 genuinely resolved, CR-02 only partially — a reachable spurious hard-fail remains on the crawl day.

I verified each fix on economics, not "a test now passes." I traced `_combined_session_upl` (WR-01), re-derived the WR-02 boundary slice + oracle by hand, and empirically ran a crawl-day interleave scenario with today-relative dates (the tests all use historical 2026-01 dates, so `_last_settled_option_mark_day()` never constrains them — the one place a real production edge hides).

## Per-finding verdict

| ID | Verdict | Basis |
| -- | ------- | ----- |
| CR-01 | **RESOLVED** | End bound `newest_day 00:00 + 24h` now covers the `newest_day 08:00` bar (M7 stamp) while excluding the next day's; the `_OptionsAdapterStub`/`_RangeRespectingChartStub` now actually filter by `start/end_timestamp` and stamp 08:00, so the single-day `[T,T]` window returns T's bar instead of a spurious hole. The masking test infra was fixed too. |
| CR-02 | **NOT RESOLVED (partial)** | Lone-open-position (book channel now reconciles at the settled boundary) and settled-day interleave are genuinely fixed. But the general "interleaved-open-instrument no spurious hole" claim is only half-true — see **NF-01** below (crawl-day variant still hard-fails a healthy account). |
| WR-01 | **RESOLVED** | Confirmed `state.native_upnl = _combined_session_upl` = futures leg (`session_upl`/`futures_session_upl`) **+** `options_session_upl`. M5 decomposition holds: `Σnative_pnl = cash + (options_value − options_session_upl)` (book-channel-guarded), so required wedge `= equity − Σnative_pnl = combined session uPnL` — no double-count. The §5-through test is economics-derived (`equity 0.09 = cash −0.10 + futures_upl 0.01 + options_value 0.18`; wedge `0.03 = 0.01 + 0.02`), and I re-ran it: `reconstruct_native_nav_and_twr` closes. |
| WR-02 | **RESOLVED** | Slice `[start_day, end_day)` now agrees with the inclusive-ms cash filter at BOTH 08:00 boundaries (hand-checked: coverage-era first trade's opening ΔMTM entry is IN with its cash; trailing post-summary crawl-day trade's entry is OUT with its cash). Oracle is genuinely hand-derived from economics (`upl = settlement mark 0.05 − trade price 0.04 = 0.01`), **not** the code's formula (old self-referential `0.06` is gone). Phase-82 E3 flat-flat closure re-pinned (`0.02 == 0.02`, ΔBook 0). |
| WR-03 | **RESOLVED** | `replay_option_positions` now `.upper()`s `currency`, matching the merge's uppercase keys — no phantom bucket. |
| WR-04 | **RESOLVED** | Option fetcher drops only `price < 0`; a legitimate `0.0` worthless close is kept and booked as the −Book collapse (perp-index sibling untouched, where non-positive IS nonsense). Wiring test proves the collapse books instead of holing. |
| WR-05 | **RESOLVED** | `smoothed_mtm` + `since_ms is not None` → fail loud **before** crawling (absolute-position replay needs full history); `cash_settlement` still accepts `since_ms` (SC-4). |
| IN-01 | **RESOLVED** | Shortlex key `(instant, len(sid), sid)` orders numeric ids numerically; the true last same-ms fill wins EOD. |
| IN-02 | **RESOLVED** | Explicit English month map replaces `strptime(%b)`; locale-independent (RED under `de_DE` documented). |
| IN-03 | **RESOLVED** | Intraday-scalped instruments (no nonzero EOD position) skip the fetch and are never bucketed pre-retention. |

## NEW BLOCKER

### NF-01 (BLOCKER): CR-02's grid extension still spuriously holes a healthy OPEN instrument on the crawl day

**File:** `analytics-service/services/deribit_ingest.py:1997-2009` (`_build_smoothed_option_mtm`: `newest = ... max(last_day, last_settled)`, per-instrument window) interacting with `analytics-service/services/deribit_txn.py:1955-1959` (`option_mtm_daily` global `global_last = max(candidate_lasts)`)

**Issue:** An OPEN instrument A (held, no crawl-day event) is fetched only through `last_settled` (= yesterday). But if ANY sibling instrument B has an event on the **crawl day** (today) — a delivery, a settlement, or a fresh trade — then B's `last_day = today` (or B's fetched marks reach today) pushes `option_mtm_daily`'s `global_last` to **today**. The dense grid then iterates onto today, where A carries a nonzero carried position and has **no mark** (A's window stopped at yesterday) → `LedgerValuationError` D-07 hole naming the perfectly healthy instrument A. This is the exact "interleaved-open-instrument spurious hole" class CR-02 claimed to close — the fix only closed the *settled-day* sub-case, not the *crawl-day* one.

**Empirically confirmed** (today-relative dates, range-respecting 08:00 stub):
```
RAISED LedgerValuationError: option daily-MTM hole: instrument=BTC-26MAR27-100000-C
carries a nonzero position on 2026-07-22 but has NO daily mark ...
last_settled = 2026-07-21   today = 2026-07-22
```
Fixture: A opened 5d ago and held open; B opened 3d ago and **delivered today**. This is an ordinary live smoothed options account (hold one option open while another settles/trades on crawl day) → hard-fails the whole ledger build → violates the phase success criterion "a Deribit options book renders a `smoothed_mtm` factsheet."

**Why every test misses it:** all smoothed fixtures use historical 2026-01 dates, so no instrument ever has an event after `last_settled` (~yesterday). The `test_smoothed_interleaved_instruments_no_spurious_hole` fixture interleaves only on **settled** days (01-18/01-19), never the crawl day.

**Fix:** Cap the ΔMTM grid at the last settled bar day — thread `last_settled` into `option_mtm_daily` and cap `global_last = min(max(candidate_lasts), last_settled)` (equivalently, trim each instrument's grid days to `<= last_settled` in `_build_smoothed_option_mtm` before the pure call). Crawl-day cash already books on the cash channel regardless, so nothing is lost; the current partial/unsettled day is simply never marked. This is coherent with the book channel — the anchor's `options_value − options_session_upl` also excludes any position opened after the settlement boundary — and it **subsumes documented residual #1** (a position opened on the crawl day no longer pulls the window onto the partial bar). Add a regression test with today-relative dates: open A + crawl-day sibling B → builds green, ΔMTM series ends at `last_settled`.

## Residuals review (priority 5)

- **Residual #1 (crawl-day-opened position → partial bar → book channel judges):** currently fail-loud (not silent mis-attribution), so acceptable in isolation — but it is the same root cause as NF-01 and the recommended NF-01 fix (cap grid at `last_settled`) eliminates it. Fix them together.
- **Residual #2 (cash-basis H1 wedge over-covers by `options_session_upl` on an open book):** pre-existing, SC-4-frozen, correctly left untouched — modifying the cash arm would break the confirmed `cash_settlement` byte-identity. It is a `mark_to_market`/cash-anchor follow-up, not a Phase-131 regression. Leaving it is correct.

## No-regression check (priority 4)

- Full suite: **4182 passed, 96 skipped**, only the **3 pre-existing OKX `test_equity_reconstruction`** failures (`FakeExchange` attribute drift — documented in 131-01a, independent of this phase). Zero new failures. Re-ran locally.
- SC-4 `test_native_nav_sc4_identity` matrix + `test_usd_native_smoothed_bit_exact_to_cash` (`check_exact=True`) → **32 passed**; cash/MTM byte-identity intact.
- AST purity (`test_option_enters_via_cash_delta_not_perp`) green — all fix additions stdlib-only.
- `mypy --strict` on the three touched services → **0 issues**.
- No existing passing test was weakened: the WR-02/WR-04/CR-01 pins that changed were the *self-referential/masking* ones the original review flagged; they were replaced with economics-derived / range-respecting equivalents, which is the correct direction.

## Overall verdict: BLOCK

Nine of ten original findings are genuinely resolved on the economics, and the fixer's WR-01/WR-02 derivations and oracles are sound (a real improvement — the self-referential oracle is gone). But **NF-01** is a reachable spurious hard-fail on a common live smoothed options account, rooted in the CR-02 fix itself, and no test covers the crawl-day boundary. One more fix round: cap the ΔMTM grid at `last_settled` (subsuming residual #1), add a today-relative interleave regression test, then this is PASS. The existing `cash_settlement` / `mark_to_market` bases remain byte-identical and shippable regardless.

_Re-reviewed: 2026-07-22 · Reviewer: Claude (gsd-code-reviewer) · Depth: deep_

---

# Final Re-Confirm (Round 3) — NF-01 grid-cap verification against `7ed1da0e..023a1b0a`

**Re-reviewed:** 2026-07-22 · **Verdict: PASS — Phase 131 done.** All 10 original findings + the NF-01 blocker are genuinely resolved. No open items.

## NF-01 — RESOLVED (verified on economics, not a mask)

**Fix:** `option_mtm_daily` gains `last_settled_day: str | None = None`; when set, `global_last = min(max(candidate_lasts), last_settled_day)`. `_build_smoothed_option_mtm` threads the `last_settled` it already computes. Default `None` = no cap.

1. **The exact crawl-day scenario I reproduced no longer hard-fails.** I re-ran the round-2 configuration (open A held across a sibling B with a crawl-day event) via the new `test_smoothed_crawl_day_sibling_does_not_hole_open_instrument` — green. The grid caps at `last_settled` (yesterday); the crawl-day (unsettled) cash books on the cash channel (`got[today] == −0.02`) and today is simply never MTM-marked. No spurious D-07 hole.
2. **Economically coherent with the book channel, not a mask.** In the test the venue anchor is `options_value 0.12 − options_session_upl 0.02 = 0.10`, and the capped `terminal_book` is A-only `2.0 × 0.05 = 0.10` — they match. B (opened today, after the settlement boundary) is excluded from BOTH the settled book and the capped grid, so the book-channel guard reconciles exactly. This is the correct settled-boundary semantics (`options_value − options_session_upl` excludes post-boundary positions), not a suppression of the guard. Book channel stays fully load-bearing (the perturbed-anchor/perturbed-mark breach tests still red on tampering).
3. **The cap only ever shrinks the grid** (`min` with a `<` guard), and ISO `YYYY-MM-DD` orders lexicographically = calendar, so the comparison is sound. Terminal book lands at the settled boundary exactly where the anchor decomposition expects it.

## Test is meaningful, not tautological — VERIFIED

- **Today-relative, not hardcoded:** the fixture derives dates from `di._today_utc_iso()` and `di._last_settled_option_mark_day()` (`a_open = last_settled − 3d`, B trades `today`), so it tracks the real crawl reference — the whole reason the historical 2026-01 fixtures could never exercise this.
- **Reddens when the cap is removed:** I transiently deleted the two cap lines from `option_mtm_daily` and re-ran only this test → it FAILED with the exact `LedgerValuationError: option daily-MTM hole: instrument=BTC-26MAR27-100000-C carries a nonzero position on 2026-07-22 but has NO daily mark`. Restored source immediately (verified clean). The guard genuinely fails without the fix.
- Oracle is hand-derived from M5 (`total == Σchange + Book(last settlement) = −0.12 + 0.10`), not the code's own output.

## Residuals — VERIFIED

- **Residual #1 (crawl-day-opened position → partial bar):** genuinely subsumed. A position first appearing on the crawl day has `first_day = today > global_last (last_settled)`, so it never enters the grid and can never pull the window onto an unsettled partial bar. No longer reachable — the class is closed by construction, not deferred.
- **Residual #2 (SC-4-frozen cash-basis wedge over-cover):** untouched, as it must be — the fix is entirely inside the smoothed grid path. `cash_settlement` byte-identity preserved. Correctly left as the `mark_to_market`/cash-anchor follow-up.

## No regression — VERIFIED (ran locally)

- Full suite: **4183 passed** (was 4182; +1 = the new NF-01 test), 96 skipped, only the **3 pre-existing OKX `test_equity_reconstruction`** failures (`FakeExchange` attribute drift, independent of this phase). Zero new failures.
- Affected suites (`test_smoothed_mtm_core` + `test_deribit_txn` + `test_deribit_ingest` + `test_native_nav_sc4_identity`): **389 passed** — every historical smoothed fixture passes unchanged.
- SC-4: `test_usd_native_smoothed_bit_exact_to_cash` + zero-fetch/byte-identical pins → green (the `None`-default keeps pure-core direct callers byte-identical; SC-4 matrix untouched).
- AST purity (`test_option_enters_via_cash_delta_not_perp`) green — the cap is stdlib-only string arithmetic, no pandas/async.
- `mypy --strict --follow-imports=silent services/ routers/ models/` → **Success, 0 issues (84 files)**.
- The one test-infra change (`option_mtm_daily` wiring-guard lambda → `**_kw`) correctly accommodates the new kwarg without weakening the guard's meaning.

## FINAL VERDICT: PASS — Phase 131 (smoothed_mtm analytics core) is DONE

All 10 original findings (2 critical, 5 warning, 3 info) and the NF-01 blocker surfaced in re-review are genuinely resolved on the economics. `cash_settlement` and `mark_to_market` remain byte-identical (SC-4 confirmed at every round). The smoothed_mtm third basis now survives the live open-book and crawl-day configurations that previously hard-failed. No open items; ready to proceed to 131-02 (worker wiring) / 131-03 (frontend).

_Final re-confirm: 2026-07-22 · Reviewer: Claude (gsd-code-reviewer) · Depth: deep_
