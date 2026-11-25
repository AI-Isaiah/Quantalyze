---
phase: 231-bybitreads-a-bybit-read-covers-every-coin-settle-type-window
reviewed: 2026-11-23T00:00:00Z
depth: standard
diff_base: 8d825f123
files_reviewed: 7
files_reviewed_list:
  - analytics-service/services/exchange.py
  - analytics-service/services/positions.py
  - analytics-service/tests/_bybit_real_markets.py
  - analytics-service/tests/test_bybitreads_census_pins.py
  - analytics-service/tests/test_exchange.py
  - analytics-service/tests/test_positions.py
  - analytics-service/tests/test_upnl_venues.py
findings:
  critical: 1
  warning: 3
  info: 7
  total: 11
  necessity: 1
status: issues_found
---

# Phase 231 (wave 2, plans 03-05): Code Review Report

**Reviewed:** 2026-11-23
**Depth:** standard
**Files Reviewed:** 7
**Status:** issues_found

## Summary

Scope: `git diff 8d825f123..HEAD` for the seven files above. That covers three pieces:
- plan 03, the three-category Bybit holdings poll in `services/positions.py`;
- plan 04, the windowed Bybit execution read `_fetch_raw_trades_bybit` in `services/exchange.py`;
- plan 05, the census pin tests.

I also read the code these changes run through:
- the walker `walk_paginated` / `_windows` (`services/exchange_pagination.py`);
- `fetch_raw_trades`, and the `sync_trades` Phase-2 block with its cursor-advance and flag self-heal (`services/job_worker.py`);
- `run_reconcile_strategy_job`, `BybitAdapter.fetch_raw` (`services/ingestion/bybit.py`) and its two callers: the inline `process_key` route and `long_fetch`;
- the teaser seam budget (`src/lib/resilient-fetch.ts`, `process-key-sync`);
- `_fetch_derivative_rows` and `fetch_allocator_holdings` (`services/allocator_positions.py`);
- `_fetch_current_equity` (`services/equity_reconstruction.py`).

For the tests I read these in full: the new classes (`TestBybitPositionCategories`, `TestBybitExecutionWindowWalk`), `_bybit_real_markets.py`, `test_bybitreads_census_pins.py`, and the four flipped execution tests. For the rest of the test diff I read only its changed hunks: the `test_upnl_venues.py` changes and the flipped `test_positions.py` tests. I did not read the `_holdings_exchange`, `_v5_row` and `_bybit_exchange` helpers in full. None of the hunks I read weakens an assertion beyond what the SUMMARYs record.

**What holds.**
- The money math for inverse rows is right. `positionValue` (coin) x mark is the USD delta exposure, and the coin uPnL x mark is the USD uPnL. Holdings `value_usd - cost_basis_usd` equals the converted uPnL exactly.
- USDC rows keep their raw id on both paths, and USDT rows keep today's symbols.
- A failed category propagates, so no category ships alone.
- The three refusal texts are static and digit-free.
- The window walk is gapless and does not overlap. The +1 ms boundary is pinned.
- The two-year start is refused before any request.

**Main defects.**
1. **CR-01.** The 365-day default lives in the shared reader, so it also reaches the anonymous public teaser. The teaser runs `fetch_raw` inline under a 60 s seam budget, and timeouts there count toward the global breaker. Plan 04 weighed the walk only against the 900 s `sync_trades` budget.
2. **WR-01.** In both new readers, a reply that is missing `result` or `list` reads as an empty window or an empty book. In the position parser, a row with a blank `size` reads as flat. This is the class round 1 fixed in the probe only (WR-01 and SF-M7 in `231-REVIEW.md`). I reproduced both readers with a throwaway script in the session scratchpad (outside the repo).
3. **WR-02.** Bybit option positions are in no census row, and a new comment says the three reads are every list a key can hold.
4. **WR-03.** This one applies only when `USE_RAW_TRADE_INGESTION` is on. It is off by default and its PROD value cannot be read from the repo. A refused window is skipped for good by the cursor advance, and the next clean run then clears the failure flag. That second half is not in the `dependency-232` record.

The necessity rubric (`necessity-review.md`) was read and applied. One finding is tagged `necessity` (IN-03). Ratings use the project's five levels, as in `231-REVIEW.md`: HIGH and above is `CR-`, MEDIUM is `WR-`, and LOW and INFO are `IN-`. Under the project rule, only CR- and WR- findings are actionable.

## Critical Issues

### CR-01: The 365-day default reaches the inline public teaser, which has a 60 s budget and feeds the global breaker

**Severity:** HIGH (user-facing; public, unauthenticated endpoint; system-wide breaker coupling)
**File:** `analytics-service/services/exchange.py:2994-3003` (`default_lookback_days=BYBIT_EXECUTION_DEFAULT_LOOKBACK_DAYS` in the reader's own contract). It reaches users through `analytics-service/services/ingestion/bybit.py:74-76` (`fetch_raw` passes `since_ms=creds_or_file.get("since_ms")`, which is None on every caller) and `analytics-service/routers/process_key.py:2175` (inline `fetch_raw` for the `teaser`, `csv` and `internal_report` flows, see `_is_long_fetch` at `:718-724`).
**Issue:**
- **The change.** Before plan 04, a Bybit read with no start sent no `startTime`. The venue answered with its last seven days, one window of at most 100 pages. Now the reader itself defaults a missing start to 365 days, which is at least 53 sequential requests plus every extra page.
- **Who calls it with no start.** The public landing-page teaser (`src/app/api/verify-strategy/route.ts`, `flow_type: "teaser"`). Its `teaserContext` carries no `since_ms`, and it runs `fetch_raw` inline.
- **The budget.** The teaser's seam budget is `process-key-sync`, with `timeoutMs: 60_000` in `src/lib/resilient-fetch.ts`. That entry's own ME-04 comment says deadline expiries on the anonymous teaser count toward `breaker:railway`, the key every route checks: "five deadline expiries or transport failures inside the 30 s window open the global circuit for every authenticated user".
- **Measured on the one live PROD key (k6, `231-PROBE-RESULT.md`).**
  - The windowed trade sweep read 34 windows in 600 s and did not finish (`trade_sweep_read_s=600`, `trade_sweep_windows_read=34`, `trade_sweep_complete=false`). A start-less teaser for this key now needs all 53 windows, so it runs far past 60 s.
  - Its last week alone held 8616 executions (`trade_last7d_windowed_rows`), about 87 pages. That is what the old one-window read fetched.
- **Derived, not measured.** The same key's funding walk measured 379 s over 1438 calls, about 0.26 s a call (a different endpoint, same key).
  - At that rate, an account with no executions still needs 53 calls, about 14 s.
  - The 60 s budget then allows about 230 calls, so an average of roughly 3 extra pages a window, about 400 or more fills a week, crosses it.
- **The cap.** A window over `BYBIT_EXECUTION_WINDOW_PAGE_CAP` (200 pages, 20,000 fills a week) now fails the teaser outright with `BybitTradeWindowIncomplete`. The measured lower bound is already 121 pages on the one key. Before, it returned a truncated list.
- **Cancellation (inferred, not verified).** I found no client-disconnect check on the route. In Starlette a handler is not cancelled when the client disconnects, so the walk most likely keeps running on the analytics service after the Vercel side gives up, and anyone can trigger it anonymously.
- **Onboarding and resync.** These also walk 365 days now, through `long_fetch.py:642`, under a 30-minute budget, which is enough. A refusal there falls through `classify_exception` to its default `("unknown", ...)` and fails the onboarding.
- **Precedent.** The same shape already wedges `sync_funding`. Census C27, pinned in this diff by `test_census_c27_*`, records 30 `failed_final` timeouts in 30 days for a 365-day funding walk under a 180 s budget.
- **Not recorded.** The 231-04 SUMMARY names the ingestion adapter only as "the same first-walk length caveat as `oq2-timing`". That caveat is about the 900 s job budget, not a 60 s anonymous seam. No test covers `BybitAdapter.fetch_raw` after the change.

**Fix (a founder decision, because it changes a plan 04 truth):** ruling OQ2 put the 365-day default in the reader, and `test_a_missing_start_walks_three_hundred_sixty_five_days` (census C16) pins it there, so moving it flips that test and that census row. The smallest change keeps the deep default for the strategy fill sync, which is what OQ2 was about, and takes it out of the shared reader. For example, make the lookback a keyword that defaults to the old reach and pass 365 only from `fetch_raw_trades`:
```python
async def _fetch_raw_trades_bybit(
    exchange, since_ms, *, category="linear", now_ms=None,
    default_lookback_days: int = 7,   # a start-less read keeps the venue's old seven-day reach
) -> list[dict[str, Any]]:
    ...
    contract = ProviderPaginationContract(..., default_lookback_days=default_lookback_days, ...)

# fetch_raw_trades (the sync_trades / reconcile seam):
fills = await _fetch_raw_trades_bybit(
    exchange, effective_since, default_lookback_days=BYBIT_EXECUTION_DEFAULT_LOOKBACK_DAYS
)
```
The founder may decide the teaser should read deeper. If so, route the teaser through the queued long fetch instead of the inline path. Either way, add a test that pins how many requests `BybitAdapter.fetch_raw({...})` sends with no `since_ms`, and record the decision as a census row.

## Warnings

### WR-01: A reply missing `result` or `list` reads as empty in both new readers, and a blank `size` reads as flat

**Severity:** MEDIUM (data integrity: "nothing unmeasured becomes 0"; same class as round-1 WR-01 and SF-M7, which were fixed in the probe only)
**File:**
- `analytics-service/services/exchange.py:2882-2886` (trade read page callback);
- `analytics-service/services/positions.py:140` and `:144-147` (`_parse_bybit_v5_positions`);
- `analytics-service/services/positions.py:486-491` (`_read_bybit_positions_raw`).
**Issue:**
- **Trade read.** The callback defaults both keys: `inner = result.get("result", {})` and `items = inner.get("list", [])`. Its new shape check rejects only a non-dict or non-list value. So `{"retCode": 0}` or `{"retCode": 0, "result": {}}` gives `items == []`, `is_empty=True`, and the walker ends the window as a natural stop.
- **Reproduced (trade read).** Page 1 of a window carried a fill and cursor `c1`. Page 2 was `{"retCode": 0}`. The read returned 1 fill, went on to the next window, and raised nothing: a window cut short and returned as complete. (ccxt raises on a non-zero `retCode`, so only a zero-code reply with a missing key reaches this. The probe's WR-01 was the same premise, and it was rated MEDIUM.)
- **Position parser.** It reads `raw_response.get("result", {}).get("list", [])`, so a missing `result` or `list` is an empty category. `_read_bybit_positions_raw` then ends on `not result.get("list")`.
- **Reproduced (positions).** `fetch_positions("bybit", ex)`, with ccxt answering `[]` and every raw reply `{"retCode": 0, "result": {"nextPageCursor": ""}}`, returned `[]`. The holdings poll then writes a book with no derivative rows, so the uPnL leg of AUM reads as 0.
- **Blank size.** `size_base = abs(float(size_raw)) if size_raw else 0.0` drops a row whose `size` is `""` or absent as flat. Reproduced: a row with `size: ""`, `positionValue: "6000"` and `unrealisedPnl: "100"` parsed to `[]`. Round 1 fixed exactly this in the probe (SF-M7, `8453c4412`: "a position row without a readable size fails its category instead of counting as flat"). The production parser this phase rewrote still has it.
- **Not affected.** An empty list that echoes a live cursor is also a stop in both readers. That one is an accepted decision (231-03 SUMMARY, "Decisions to know about"), not part of this finding.

**Fix:** Require the keys rather than defaulting them, the way `c82c1a9f5` did for the probe:
```python
# exchange.py page callback
inner = result.get("result") if isinstance(result, dict) else None
items = inner.get("list") if isinstance(inner, dict) else None
if not isinstance(inner, dict) or not isinstance(items, list):
    raise RuntimeError("Bybit execution list answer has an unexpected shape")

# positions.py
result = raw_response.get("result")
items = result.get("list") if isinstance(result, dict) else None
if not isinstance(items, list):
    raise BybitPositionReadRefused(BYBIT_MALFORMED_REPLY_REASON)   # static text
...
size_raw = item.get("size")
if size_raw is None or (isinstance(size_raw, str) and not size_raw.strip()):
    raise BybitPositionReadRefused(BYBIT_MALFORMED_REPLY_REASON)
size_base = abs(float(size_raw))
```
Add one RED-first test per reader with a `{"retCode": 0}` page.

### WR-02: Bybit option positions are in no census row, and the new comment says the three reads are every list a key can hold

**Severity:** MEDIUM (phase-goal gap: "a Bybit read covers every coin, settle type, window"; the exposure is unmeasured)
**File:** `analytics-service/services/positions.py:454-462` (`_BYBIT_POSITION_READS` and its comment "The three position lists a Bybit key can hold").
**Issue:**
- **Comment versus venue.** The comment is false for a Unified Trading Account. Bybit V5 `/v5/position/list` also serves `category=option` (USDC-settled options), and the book fixture accepts it (`_bybit_real_markets.py`, `category not in ("linear", "inverse", "option", "spot")`).
- **No decision.** No census row reads, measures, routes or pins option positions. The census, CONTEXT and the discussion log never mention option positions (the only "option" hits are the "Option A/B" rulings). The VREAD-02 requirement names USDC-settled and inverse positions only, so options were not excluded on purpose; nobody decided them.
- **No measurement.** The probe's `positions-read:` line measured `linear_usdc` and `inverse` only.
- **Consequence.** A key holding Bybit options is missing those positions and their uPnL from allocator holdings and strategy snapshots. Nothing names the gap, which is the silent-partial shape this phase exists to remove. The plan 05 SUMMARY reports the census as closed.

**Fix:** The minimum is a census row for `category=option`. Either measure the exposure with the probe and pin "not read" with a test (the way C18 and C19 do), or add a fourth read that refuses by name when it returns any row until an option normalizer exists. Correct the comment either way.

### WR-03: When raw ingestion is on, a refused window is skipped for good and the next clean run erases the signal

**Severity:** MEDIUM (data integrity, conditional: `_RAW_TRADE_INGESTION_ENABLED` reads `USE_RAW_TRADE_INGESTION`, default `"false"`, documented "off by default in prod"; its live value is not in the repo)
**File:**
- `analytics-service/services/exchange.py:2855-2857`, `:2895`, `:3018` (the three raises);
- `analytics-service/services/job_worker.py:2655` (`advance_fetched_cursor = (not raw_fills) or ...`);
- `analytics-service/services/job_worker.py:2574-2597` (the self-heal, `if flag_was_set:` at `:2590`).
**Issue:**
- **What `dependency-232` records.** The cursor advances when a raised fetch left `raw_fills` empty.
- **Gap 1: the signal is erased.** On the next run that does not raise, the `else` arm sees `flag_was_set`. It pops `phase2_fill_ingestion_failed`, `phase2_error` and `phase2_failed_at`, and stamps `phase2_recovered_at`. The refused span was already skipped by the cursor, so after one cycle nothing stored says it is missing. The named refusal becomes a silent gap.
- **Gap 2: this loses more than the pre-fix reader did.** Before plan 04, a cap hit returned the fills read so far and persisted them with the `sync_truncated_bybit*` flags. A stuck cursor also returned the fills read so far, but with no flag. Now either input stores no fill, the except arm discards the drained flags, and the cursor still advances.
- **Gap 3: the first sync can wedge (inferred; I did not trace how the handler timeout cancels the job).** With the flag on, a first sync has a NULL `last_fetched_trade_timestamp` and no daily high-water, so it walks 365 days. The Phase-1 daily-P&L persist (`sync_trades` RPC, `job_worker.py:2302-2327`) runs only after `fetch_raw_trades` returns. A walk that hits the 900 s `TIMEOUT_PER_KIND["sync_trades"]` therefore also loses that run's daily P&L. The high-water then never forms, so every later run repeats the same 365-day walk. That is a wedge of the strategy's primary data, not only of its fills. `oq2-timing` says only "may not fit".

**Fix:** Out of plan 04's write scope (ruling OQ5). Extend the `dependency-232` hand-off with gaps 1 to 3. The minimal fix in the owning phase is to gate the advance on the fetch not having raised (`advance_fetched_cursor = not phase2_failed and (...)`), and to keep the refusal flag until a run covers the refused span. Before anyone turns `USE_RAW_TRADE_INGESTION` on, record in the phase report that VREAD-03's "refuses by name" does not survive the `sync_trades` caller.

## Info

### IN-01: A dated USDT future changes symbol with the read path

**Severity:** LOW (pre-existing; one more trigger added)
**File:** `analytics-service/services/positions.py:345-349` vs `:164`. Pinned by `tests/test_positions.py::TestBybitPositionCategories::test_usdt_rows_keep_their_stored_symbol`.
**Issue:**
- **Two names.** The ccxt path stores `BTCUSDT-260925` and the raw path stores `BTCUSDT-25SEP26` for the same position. The test pins both forms as "unchanged".
- **When the path flips.** The USDT category falls to the raw path whenever any of its positions has an exact-zero uPnL, which is pre-existing, and now also on a full ccxt page. Either way the same position changes symbol between polls, which looks like a close plus an open in `position_snapshots` (turnover) and like a new `allocator_holdings` ref.
**Fix:** Record it as a known limit next to the C10/C11 rows, or normalize the dated form on one path in a deliberate, migration-aware change.

### IN-02: The full-page test relies on ccxt's built-in `limit` of 200

**Severity:** LOW
**File:** `analytics-service/services/positions.py:510-517`
**Issue:** `len(raw_positions) < BYBIT_POSITION_PAGE_LIMIT` assumes ccxt sent `limit=200`, but `ccxt_params` sends no `limit`. If a ccxt release changed its default, a truncated page under 200 rows would ship as complete. Today a ccxt bump that changed it would turn the request-shape test red (`test_every_category_is_requested_once_on_the_ccxt_path`), so this is guarded indirectly.
**Fix:** Send it: `exchange.fetch_positions(None, {**ccxt_params, "limit": BYBIT_POSITION_PAGE_LIMIT})`.

### IN-03: Phantom requirement: the cap-hit DQ flags recorded before the refusal reach no reader

**Severity:** LOW
**Category:** necessity
**File:** `analytics-service/services/exchange.py:3010-3018` (`_record_dq_flag` at `:3016`)
**Issue:**
- **What the comment claims.** The reader records `sync_truncated_bybit` and `sync_truncated_bybit_pages` before raising, "for any caller that drains them".
- **What every caller does.** No caller reads them on that path, provably:
  - `run_sync_trades_job` drains and discards them in its generic except arm (`job_worker.py`, "The drained value is intentionally discarded");
  - `run_reconcile_strategy_job` drains and discards them in its except arms;
  - `BybitAdapter.fetch_raw` and `long_fetch` never drain the per-task buffer; I read both and found no drain call. On that path the flags are left in the ContextVar.
- **Rating note.** The rubric would file a repo-provable necessity finding as `WR-`. This review follows the phase's own convention (LOW is `IN-`) and counts it in `necessity:`.
**Fix:** Drop the two `_record_dq_flag` calls on the refusal path and correct the comment, or drain in `BybitAdapter.fetch_raw`.

### IN-04: A start later than `now` makes zero requests and returns `[]`

**Severity:** LOW (pre-existing outcome)
**File:** `analytics-service/services/exchange.py:2855-2857`, with `exchange_pagination.py::_windows` (`while w_start < now_ms`)
**Issue:** TODOS `167.1.2.2.2-LAST-FETCHED-TRADE-TS-AHEAD` records that the fills cursor can be ahead. A start past `now` (beyond the 1 h overlap) yields no window, so the read returns an empty list as complete without asking the venue. The old reader got an empty answer from the venue for the same input, so this is no regression. It is still an unmeasured read returned as zero.
**Fix:** Refuse by name when `since_ms > now`, alongside `start_too_old`.

### IN-05: The inverse fixture's `positionValue` is set at the mark, but Bybit computes it at the entry price

**Severity:** INFO
**File:** `analytics-service/tests/test_positions.py`, `TestBybitPositionCategories.INVERSE_ROW_FIELDS`
**Issue:** The fixture sets `positionValue = 100 / 60000` (the mark), with `avgPrice` 57495. In Bybit's documented linear example, `positionValue = size x avgPrice` (entry-based), so the inverse value is `size / avgPrice`. The code's formula is right under either reading: `positionValue x mark` is the USD delta exposure. But the fixture cannot show which `size_usd` a real reply produces. A1/A9 stay open, as the 231-03 SUMMARY says.
**Fix:** Use `positionValue = size / avgPrice` (0.00173928) and expected `size_usd = 0.00173928 x 60000`.

### IN-06: Canned-page Bybit tests with no start now pass because the walker dedupes 53 copies

**Severity:** INFO (test reliability)
**File:** `analytics-service/tests/test_exchange.py:4764` (fee-currency mismatch) and `:5751` (`test_default_category_linear_passes`)
**Issue:** With `since_ms=None`, the same canned reply is served once per window (53 times) and deduplicated by `execId`. The fee-currency test calls `_check_fee_currency_mismatch` 53 times for one fill, and its row (`execTime` 2023) lies outside every window walked. The assertions still hold, but they no longer describe a one-page read. The 231-04 SUMMARY states this.
**Fix:** Give those tests an explicit one-window start, as the four flipped tests now do.

### IN-07: An inverse mark of `nan` or `inf` raises ccxt's `ValueError`, not the named refusal

**Severity:** INFO (documented in the 231-03 SUMMARY)
**File:** `analytics-service/services/positions.py:510` (the ccxt call runs before `_bybit_inverse_position`)
**Issue:** On the ccxt path, ccxt's `Precise` division raises before the arm sees the row, so the poll fails with an unnamed `ValueError`. It is loud, but not by name.
**Fix:** None needed beyond the record. Optionally, re-raise a `ValueError` from the inverse ccxt read as `BybitPositionReadRefused`.

---

_Reviewed: 2026-11-23_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Silent-failure hunter (parallel review, MEDIUM and above), and the orchestrator's triage

The silent-failure hunter reviewed the same diff, `8d825f123..HEAD`.

| id | finding | triage |
|---|---|---|
| CR-01 (HIGH) | The 365-day default reaches the anonymous teaser through `ingestion/bybit.py::fetch_raw`, which has a 60 s budget. | **Fix.** This narrows ruling OQ2, which is the orchestrator's own reversible technical ruling, so no founder ruling is needed. The reader gets a keyword-only `default_lookback_days`. `fetch_raw_trades`, the strategy sync, keeps 365, and the C16 test is unchanged. `BybitAdapter.fetch_raw` passes 7, the reach the teaser had before this phase. `long_fetch` keeps whatever `since_ms` it already passes. |
| WR-01 = SF-3 | A reply missing `result` or `list` reads as an empty window or a flat account, in both the trade reader and the positions readers. | **Fix.** Raise by name: `BybitTradeWindowIncomplete` with a new static reason, and `BybitPositionReadRefused` with a static malformed-reply reason. One RED-first test per reader. |
| SF-1 | An inverse row with an absent, blank, non-finite or negative `positionValue`, or a non-finite `unrealisedPnl`, ships 0 or NaN. | **Fix.** Refuse with `BybitPositionReadRefused` and a new static reason, with RED tests for absent, blank and nan. |
| SF-2 | The inverse USD notional is skewed by the mark. | **Rejected.** If `positionValue` is entry-based (N/avg), then positionValue × mark = N + uPnL_usd, the market value. Value minus cost basis (N) equals uPnL, the same model as a linear row (qty × mark). The code reviewer agrees ("money math is right"); only the fixture is mark-based (IN-05, INFO). |
| SF-4 | A fill dropped as unreadable never refuses, and no flag is set. | **Fix, scoped.** An `execType == "Trade"` row whose `execTime` cannot be parsed, or whose price or quantity is not finite, raises `BybitTradeWindowIncomplete` with a new static reason. Other existing skips stay as they are. |
| SF-5 | The new exceptions are not classified, so the dispatcher retries them as `unknown`. | **Fix.** Add a `classify_exception` arm returning `permanent` for both, plus a classifier test. |
| SF-6 = WR-03 | The cursor advances after a refusal, and the next run's self-heal erases the flag. | **Routed** to Phase 232 VREAD-08 / 222 under ruling OQ5, and recorded in the phase report with gaps 1-3. No change here. |
| WR-02 | Bybit `category=option` is in no census row. | **Census row C28**, written by the orchestrator: options are not read, and the gap is routed by name. The fixer corrects the comment that claims the three reads cover every list. |

LOW and INFO items (IN-01..IN-07 and the hunter's notes below MEDIUM) are recorded only.

## Fix status (gsd-code-fixer, wave 2 round 1)

One commit per finding, on the triage table above. PROOF-01 for CR-01, WR-01 (both readers), SF-1,
SF-4, SF-5 and the WR-02 pin: the named tests were RED with the fix neutered and GREEN after a `cp`
restore from a byte backup, checked with `cmp`.

| id | status | commit | what changed |
|---|---|---|---|
| CR-01 | fixed | `fbc8e558b` | `_fetch_raw_trades_bybit` takes a keyword-only `default_lookback_days` (default: the 365-day constant). `BybitAdapter.fetch_raw` passes 7. Test: `test_the_ingestion_adapter_with_no_start_sends_one_seven_day_window`. C16's test is unchanged. |
| WR-01 = SF-3 | fixed | `2db02e539` | Trade page without a `result` object or `list` array raises `BybitTradeWindowIncomplete("malformed_reply")`. The positions parser raises `BybitPositionReadRefused` for the same, and for an absent or blank `size` (a reported `"0"` stays flat). `_read_bybit_positions_raw` no longer reads `result` before the parse refuses. |
| WR-01b | fixed | `fd63333d1` | The ccxt path of the position poll (`_normalize_ccxt_position`, Bybit arm) raises `BybitPositionReadRefused(BYBIT_UNREADABLE_SIZE_REASON)` for an absent or blank raw `size` in the row's `info`; a reported `"0"` stays flat. Two hand-built ccxt fixtures (`BYBIT_CCXT_COMPLETE`, `BYBIT_LINEAR_POSITIONS`) gained `info.size`, as a real ccxt row carries. A whitespace-only size never reaches the arm, ccxt raises `ValueError` first. |
| SF-1 | fixed | `1714a47e6` | An inverse row with an absent, blank, non-finite or negative `positionValue`, or a non-finite `unrealisedPnl`, raises `BybitPositionReadRefused` (new static reason). |
| SF-4 | fixed | `eed42f98c` | An `execType == "Trade"` row with an unreadable `execTime`, or an absent or non-finite price or quantity, raises `BybitTradeWindowIncomplete("unreadable_fill")`. No existing test flipped. |
| SF-5 | fixed | `f6bc59517` | `classify_exception` arm beside the `BybitUnifiedFlowReadError` one: permanent, with the static text, for both exception classes. `advance_fetched_cursor` untouched. |
| WR-02 | fixed | `247c6ce7d` | Comment corrected, pin test `test_census_c28_the_poll_never_requests_bybit_options`, census row C28 and a routed-rows bullet. |
| SF-2 | rejected | none | Triage above. |
| SF-6 = WR-03 | routed | none | Phase 232 VREAD-08 / 222 (ruling OQ5). |
| IN-01..IN-07 | recorded only | none | Not fixed, by rule. |

Notes the fixer recorded:
- **CR-01 reaches `long_fetch` too.** `services/ingestion/long_fetch.py` calls the same
  `BybitAdapter.fetch_raw(context)` for onboard and resync, and no caller puts `since_ms` in that
  context. A start-less onboard or resync read therefore also gets seven days now, which is its
  reach before this phase, and loses the 365-day walk plan 04 had given it. The triage said
  `long_fetch` keeps whatever `since_ms` it passes; it passes none. The adapter cannot tell the two
  callers apart.
- **SF-4 scope.** The reader has no `execType` filter. The raise applies to rows whose `execType`
  is exactly `"Trade"`. A row with no `execType`, another execution type, or a zero quantity keeps
  its old skip, so `test_bybit_unparseable_execTime_dropped` (its bad row has no `execType`) stays as it is.

## Round 2 (re-review of the round-1 fixes)

Both reviewers confirm CR-01, WR-01, WR-01b, SF-1, SF-5 and WR-02 are fixed. The code reviewer reverted all 11 fixes on a byte copy and each one went RED. The full suite passes: 15440 passed, 0 failed. Round-2 MEDIUMs and the orchestrator's triage:

| id | finding | triage |
|---|---|---|
| R2-1 (the code reviewer's WR-01 is the same finding) | SF-4 refuses only unreadable `execType == "Trade"` rows, but the reader stores every readable row of any type, so an unreadable liquidation or ADL row is still dropped silently. | **Fix**, using the reviewer's minimal form: refuse any unreadable row that carries an `execType`. A row with no `execType` keeps its skip. Correct the comment, and flip the `Funding` case of the pin test. |
| R2-2 | The blanket `permanent` label also covers refusals a venue blip can cause, which withholds the allocator's whole Bybit book with no retry. | **Fix.** `permanent` applies only to deterministic reasons: `page_cap`, `start_too_old`, `unreadable_fill` and the list-not-ended reason. Everything else stays `unknown` and is retried, so the allocator falls back to partial success with spot rows. The classifier test names both sets. |
| R2-3 | The new trade refusals widen the SF-6 loss. One `unreadable_fill` or `malformed_reply` now discards the whole walk while the cursor still advances. | **Routed:** added to the Phase 232 VREAD-08 / 222 hand-off. The cursor must not advance when `fetch_raw_trades` raised, and the flag must survive until a run covers the refused span. Raw trade ingestion stays off until that lands. |
| R2-4 | Onboard and resync through `long_fetch` keep a 7-day reach that has no start, so VREAD-03 is not met on that path. | **Decided, recorded as census row C29.** 7 days is the pre-phase reach. A 365-day walk inside onboarding risks that job's budget on busy keys (the live key needs 15-20 minutes). The read now completes or refuses instead of truncating at 100 pages. Routed by name, and the comments that name only the inline flows get corrected (IN-06). |
| R2-5 (= code reviewer IN-05) | Linear rows default an absent `positionValue` or `markPrice` to 0, and a `nan` size passes the flat filter. | **Fix.** Refuse by name, matching the inverse arm. |

Round-2 LOW and INFO items (IN-01..IN-06) are recorded in the round-2 scratchpad file only.

### Fix status, round 2

| id | status | commit | what changed |
|---|---|---|---|
| R2-1 | fixed | `85fbf9130` | In `_fetch_raw_trades_bybit`, a row that carries an `execType` and whose time, price or quantity cannot be read raises `unreadable_fill`. A row with no `execType` and a finite zero quantity keep their skip. Comment and `BybitTradeWindowIncomplete` docstring corrected. Flip: the `Funding` case of `test_rows_that_are_not_trades_or_hold_no_quantity_are_still_skipped` now expects the refusal (def line kept). New: `test_an_unreadable_liquidation_or_adl_row_refuses_by_name` (BustTrade and AdlTrade). |
| R2-2 | fixed | `551e67d8b` | The `classify_exception` arm is `permanent` only for `page_cap`, `start_too_old`, `unreadable_fill` (trade read) and the list-not-ended reason (position read). `cursor_stuck`, `malformed_reply` and the other position reasons are `unknown` (retried). The classifier test names both sets. |
| R2-3 | routed | none | Phase 232 VREAD-08 / 222 hand-off (the cursor advance and the flag self-heal). |
| R2-4 | fixed (recorded decision) | `fceb0649b` | Census row C29 and a routed-rows bullet. The adapter comment and the reader docstring name long_fetch onboard and resync. No code behaviour changed. |
| R2-5 | fixed | `51f3d3707` | Linear Bybit rows: an absent or blank `positionValue` or `markPrice` on an open position raises (new static reason `BYBIT_UNREADABLE_LINEAR_VALUE_REASON`), on the raw path and on the ccxt path (a None notional or mark); a non-finite size raises the existing size reason on both paths. Flat rows need no value. |

Notes the fixer recorded in round 2:
- **R2-1 and real Funding rows.** The reader now refuses a `Funding` row (or any typed row) whose
  price or quantity is blank, absent or non-finite. The repo holds no recorded Bybit `Funding`
  execution row, so whether the venue ever sends one with a blank price is unmeasured here. If it
  does, the whole walk refuses (`unreadable_fill`, permanent). Re-check on the first live read.
- **R2-5 scope.** A non-finite `positionValue` or `markPrice` string (for example `nan`) on a linear
  row is not refused; the spec was absent or blank. Only a non-finite size is.

## Round 3

| id | status | commit | what changed |
|---|---|---|---|
| R3-1 | fixed | `569e4340b` | The unreadable-row refusal in `_fetch_raw_trades_bybit` keys on the module constant `BYBIT_FILL_EXEC_TYPES` (Trade, BustTrade, AdlTrade, BlockTrade). Funding, Settle, Delivery and any other typed row, and a row with no `execType`, keep the logged skip. Both skip and refusal log lines carry the `execType` token. The `unreadable_fill` text now says "an execution". Flip back: the `Funding` case of `test_rows_that_are_not_trades_or_hold_no_quantity_are_still_skipped` skips again (def line kept), with a `Settle` row with a blank price and a `Delivery` row with a nan quantity. `BlockTrade` joins the BustTrade and AdlTrade refusal cases. The classifier test's retried list gains `BYBIT_UNREADABLE_LINEAR_VALUE_REASON` (IN-05). This closes the R2-1 risk note about real Funding rows. |

## Round 3, orchestrator notes

- **Round-3 results.** The code reviewer found no MEDIUM or higher; all four round-2 fixes hold, and each test went RED when its fix was reverted. The silent-failure hunter found one MEDIUM, R3-1, which the R2-1 fix had introduced: an unreadable Funding, Settle or Delivery row would permanently refuse the whole walk on the live teaser and onboarding path. The code reviewer rated the same issue LOW (IN-01).
- **R3-1 was fixed after round 3. This deviates from the three-round limit.** The narrowing is one line, and it removes an outage risk this PR introduced. It was reviewed by the orchestrator and carries its own PROOF-01. Refusal now applies only to `BYBIT_FILL_EXEC_TYPES` (Trade, BustTrade, AdlTrade, BlockTrade), and the log lines now carry `execType`.
- **Still unmeasured: the shape of a real Bybit Funding execution row.** An unreadable Funding row is now skipped, as it was before the phase.
- **CI fix (2ecca1c41).** The CI run on PR #1321's first head had 3 red tests in `test_positions.py`. The cause: ccxt 4.5.89 (CI's pin; the local venv had 4.5.85) back-fills `notional` and `unrealizedPnl`. That hid a blank raw `positionValue`, and it stopped a zero or blank raw uPnL from routing the category to the raw read. The position read now uses the raw `info` fields, and the change is verified green on both ccxt versions.
