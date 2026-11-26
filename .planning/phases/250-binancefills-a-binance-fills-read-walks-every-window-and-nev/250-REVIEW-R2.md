---
phase: 250-binancefills-a-binance-fills-read-walks-every-window-and-nev
round: 2
reviewed: 2026-11-26T00:00:00Z
depth: standard
diff_base: e91e3019c
files_reviewed: 6
files_reviewed_list:
  - analytics-service/services/exchange.py
  - analytics-service/services/job_worker.py
  - analytics-service/tests/_binance_fills.py
  - analytics-service/tests/test_binancefills_cursor.py
  - analytics-service/tests/test_binancefills_e2e.py
  - analytics-service/tests/test_binancefills_walk.py
severity:
  critical: 0
  high: 1
  medium: 1
  low: 4
  info: 3
findings:
  critical: 1
  warning: 5
  info: 3
  total: 9
  necessity: 0
status: issues_found
---

# Phase 250: Code Review Report, round 2

**Reviewed:** 2026-11-26
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found (1 HIGH, 1 MEDIUM, 4 LOW, 3 INFO)

## Summary

**Scope.** The round-1 fix commits only: `git diff e91e3019c HEAD -- analytics-service/`, six commits
from `41a85bbb1` to `9db17efbf`.

**Read outside the diff:**
- the epilogue gate of `run_sync_trades_job` (`job_worker.py:2805-2856`);
- the forward-only CASE in `supabase/migrations/20260602173710_advance_sync_cursor_claim_token_fence.sql:128-134`. It is still the only definition of `advance_sync_cursor`;
- `create_exchange` and `EXCHANGE_CLASSES` (`exchange.py:1153-1187`);
- the body of `normalize_symbol`;
- ccxt 4.5.89 from the worktree venv: `binance.fetch_my_trades` (`async_support/binance.py:8619-8720`), `binance.market` (`:2913-2961`) and `options.defaultType` (`:1405`);
- the round-1 disposition table and the RESEARCH and hand-over records written in `9028e0bc4`.

**Binance docs.** `binance-spot-api-docs/rest-api.md` was fetched raw on 2026-11-26. The newest commit to
that file is dated 2026-11-24, which predates round 1's fetch, so round 1 read the same text. The parts
read were `## General API Information` (lines 85-114) and `GET /api/v3/myTrades` (lines 4743-4781).

**Tests.** One file at a time, all green at HEAD:
- `test_binancefills_walk.py`: 36 passed;
- `test_binancefills_cursor.py`: 19 passed;
- `test_binancefills_e2e.py`: 11 passed.

**Neuters.** These were run on a `git archive HEAD` copy in the scratchpad, never in the worktree:
- N-CR01 (`elif False:`): the CR-01 arm goes RED with "run 2 seeded at 1794873600000, past run 1's walk start 1787832000000".
- R1-N1 (`markets.get` in place of `exchange.market`): the SFH-3 arm goes RED.
- R1-N2 (`if is_spot:` replaced with `if False:`): both arms of `test_a_full_spot_page_ends_the_window_below_every_unread_fill` go RED, the oldest-first arm included (see CR-01 below).

**Verdict per round-1 finding:**
- **CR-01: closed at the root for the NULL-column case.** The anchor is taken from `_exchange._now_ms()` before `fetch_raw_trades` takes `read_now`, so the anchor is never later than the walk start. The two-run arm fails without the fix.
- **WR-01: still open.** The disposition table calls it "fixed in scope". It is recorded only: no runtime signal and no owner. The comment claims an acceptance that no ruling records (MEDIUM below).
- **WR-02: the fix is a regression.** It rests on a partial reading of the spot doc (HIGH below).
- **WR-03: closed as a record.** Round 1 offered amending the record as an alternative fix, and the switch comment, the call-site comment, the constant comment and the 250-08 hand-over line 157 all agree. No finding.
- **SFH-3: the rebuttal holds.** Window selection now uses the same `exchange.market()` that `fetch_my_trades` calls, so it matches ccxt's routing by construction. ccxt's binance `market()` override, with `create_exchange` setting no `defaultType` (the class default is `'spot'`), resolves a venue id to spot first. The strip half of the rebuttal is sound: `normalize_symbol`'s CCXT branch, the reverse map and `positions.py:408` apply the same `/`, `:USDT`, `:USD` strip, so `BTCUSDCC` round-trips.
- **SFH-4: the rebuttal holds for the resolution-miss class** (one residual, IN-03).

**Necessity.** `necessity-review.md` was read. No necessity finding: the spot stop guards venue data, which
is a trust boundary, so it is a correctness question (CR-01 below), not a necessity one. No source file was
modified.

**Severity mapping:** `critical` = HIGH, `warning` = MEDIUM + LOW, `info` = INFO. Data-integrity findings:
CR-01 and WR-01.

## Critical Issues

### CR-01 (HIGH, data-integrity, venue; regression from the WR-02 fix): the spot doc says a `startTime` + `endTime` request returns the OLDEST rows, so the new full-spot-page stop turns a complete read into a certain, permanent loss and holds back the cursor for the whole key

**Files:**
- `analytics-service/services/exchange.py:2822-2842`: the `if is_spot:` stop.
- `analytics-service/services/exchange.py:2615-2617`: the docstring premise.
- `analytics-service/tests/test_binancefills_walk.py:1067-1117`: the `oldest-first` arm.
- `250-RESEARCH.md:276`: the "CORRECTED 2026-11-26" note.
- `250-08-SUMMARY.md:154`: the ship hand-over line.

**The doc.** The same file round 1 cited, `binance-spot-api-docs/rest-api.md`, says at lines 98-102 under
`## General API Information`:

> Data is returned in **chronological order**, unless noted otherwise.
> - Without `startTime` or `endTime`, returns the most recent items up to the limit.
> - With `startTime`, returns oldest items from `startTime` up to the limit.
> - With `endTime`, returns most recent items up to `endTime` and the limit.
> - With both, behaves like `startTime` but does not exceed `endTime`.

**What the walk sends.** ccxt sends `startTime = since` and `endTime = until` for spot
(`async_support/binance.py:8664-8679`, then `privateGetMyTrades`). Every walk request carries both. Per the
doc, a full page is therefore the 1,000 OLDEST rows of `[since, until]`, which is exactly what the
pre-fix since-advance walk assumed.

**Where round 1 went wrong.** Round 1's premise, and the fix's comment, quote the `myTrades` note at line
4771: "If `fromId` is set, it will get trades >= that `fromId`. Otherwise most recent trades are
returned." That note contrasts `fromId` with no `fromId`. It matches the general rule's case with no time
parameters ("Without `startTime` or `endTime`, returns the most recent items"). It does not mention time
parameters, so it is a weak candidate for the "unless noted otherwise" override.

The venue's actual order is still UNMEASURED: no signed call was made. But the doc does not support "a
time-bounded spot request may be newest-first". It states the opposite. Round 1 read only lines 4743-4781,
and I have to correct my own round-1 premise here.

**What the fix does when a spot-resolved name has 1,000 or more fills in one 24-hour window:**
1. The walk sends one request, keeps 1,000 rows and stops with `stop = "cap"` and `read_through_ms = window_start - 1`.
2. On the first window, `window_start` is the seed minus the overlap hour, so the bound sits BELOW the seed.
3. The gate takes the minimum bound across symbols (`stop_bounds`) and stamps the newest persisted fill at or before it. This run read nothing at or before that bound, so the stamp is None. The column is not NULL, so `fills_anchor_iso` is None and nothing is written.
4. The next run seeds from the same column, reads the same 1,000 oldest rows of the same window and stops again. The rows after the first 1,000 are never read.
5. After `BINANCE_FILLS_REACH_DAYS` the column falls behind the reach. The walk then starts at the reach, with a bound of `reach - 1` and still no stamp. A name that is heavy every day therefore pins the column for good: each run reads only the first 1,000 rows of its oldest reachable day, and its recent fills are never read.
6. Because the bound is the KEY-WIDE minimum, every other symbol on the key re-walks from the pinned column on every run. That grows toward a full 85-day walk, raises `binance_fills_reach_clamped` on every run and runs into the 840 s deadline. Once the walk from a fixed start reaches the same deadline frontier on every run, the recent fills of every symbol past that frontier are not read either.

Before the fix, under the doc-stated order, the walk read up to 20 pages (20,000 fills) per window and lost
nothing.

**The test pins the loss.** The `oldest-first` arm of
`test_a_full_spot_page_ends_the_window_below_every_unread_fill` asserts that, with a venue serving
oldest-first, ids 4 and 5 stay unread and the walk sends one request. Neutered (`if False:`), that arm goes
RED because the pre-fix walk reads all five. So the test encodes the data loss as the intended behaviour.

**The stop's name is wrong too.** It reuses kind `cap`, so `binance_page_cap_symbols` now means both
"20 pages in one window" and "one full spot page". It also breaks the stated invariant in the
overlap-exemption comment (`exchange.py:2878-2889`): "a cap's bound is strictly later than the seed and the
next run resumes past the cap". A spot cap's bound is `window_start - 1`, at or below the seed.

**Reachability.** It is latent today. RESEARCH A6 and line 305 record that spot-only stored names are not a
product surface, and PROD holds no Binance rows. A spot-resolved name enters `symbols` only through a
stored `trades.symbol` or `position_snapshots.symbol` that resolves to a spot market. One example is a
derivative's stripped name whose perp has left the loaded markets while a spot market of the same
stripped name remains. Round 1 rated the original WR-02 MEDIUM at the same reachability. This finding is
rated higher because the loss is now certain under the doc-stated order rather than conditional on an
unmeasured one, and because it holds back the cursor for every symbol on the key. The wrong venue fact is
also about to enter the ship CHANGELOG through 250-08-SUMMARY:154.

**Fix:**
1. Revert the `if is_spot:` stop (`2414e8b38`'s `exchange.py` hunk and the `is_spot` local), so spot keeps the since-advance walk.
2. Delete or invert the two WR-02 arms. The useful pin is the reverse: an oldest-first venue with five fills and a page of three must read all five with no stop.
3. Keep `_NewestFirstSpotVenue` only if an arm documents what the walk does if the venue ever deviates from its doc.
4. Replace RESEARCH:276 and hand-over line 154 with a dated CORRECTED note quoting `rest-api.md:98-102`. The spot order for a time-bounded request is documented as oldest-first, and the venue's actual behaviour stays UNMEASURED.
5. If a defence against a non-conforming venue is still wanted, use one that loses nothing. After a full page, continue with `params={"fromId": last_id + 1}` and no time parameters (the doc's `symbol` + `fromId` combination, ">= that fromId"), stopping at the first row past `window_end`. Never a stop whose bound sits below the seed.

## Warnings

### WR-01 (MEDIUM, data-integrity): round-1 WR-01 is still open but recorded as "fixed in scope"; the "accepted the same way" claim has no ruling behind it, nothing signals the skip at runtime, and the most likely way into the state is not named

**Files:**
- `analytics-service/services/job_worker.py:344-351`: the exception text.
- `analytics-service/services/job_worker.py:2302-2312`: the non-NULL-column seed.
- `250-REVIEW.md` disposition table, row WR-01.

**Issue:**
- **The acceptance.** The comment says the second SC-3 exception "is accepted the same way". The first exception rests on a founder ruling dated 2026-11-25. This one does not: `250-CONTEXT.md` has no entry on it, and `9028e0bc4` only writes the fixer's own record. The disposition table says "fixed in scope", but nothing about the behaviour changed.
- **No runtime signal.** Round 1's option (a) was a named flag plus a WARNING, then the record. Only the record was done. The comment's own wording, "only that run's stop flag names it", concedes the skip itself is silent. Run 1's stop flag looks like every other stop, which the next run normally resumes. Nothing on run 2 says a span was passed.
- **No owner.** No `TODOS.md` entry exists (grep for `WR-01`, `stop_below_cursor` and `Pitfall 8` finds nothing for phase 250).
- **An unnamed entry into the state.** The likeliest path is the first sync of a second strategy on a shared key, and the exception does not name it. Shared keys are intended. In that case:
  1. The column C is not NULL, set by the other strategy.
  2. This strategy has no stored fill and no daily row, so `_seed_bound_ms is None`, `fills_since_ms is None`, and the read walks from the reach.
  3. `fills_anchor_iso` stays None because only the NULL-column branch sets it, and the RPC would drop an anchor anyway.
  4. A stop at a bound b < C stamps nothing.
  5. Phase 1 stores daily rows, and healthy symbols store fills near now.
  6. Run 2 seeds from `min(C, ...) = C`, so `[b, C)` is never read.

  The exception's wording, "a column ahead of the strategy's newest stored fill", does not clearly cover a strategy with NO stored fill and no stamp at all. This is the same root as WR-01 and the same unread span as the original CR-01, in a branch the CR-01 fix does not touch.

**Fix (pick per the review rule; it is a data-integrity MEDIUM):**
- Add the runtime signal round 1 proposed. When `_fills_stopped` or `_fills_incomplete` is true and the column was not NULL at read time, set the flag if either (a) or (b) holds:
  - (a) the computed stamp is None, or below the column read at seed time (`_fills_cursor_ms`);
  - (b) `fills_since_ms` was None.

  The flag is named (for example `binance_stop_below_cursor`) and goes with a WARNING naming the strategy. This is code in `job_worker.py` only and needs no migration.
- Extend the exception text to name the shared-key first-sync case.
- Change the disposition row to "recorded, open".
- Book the RPC change with an owner, or put the acceptance to the founder. The comment must not claim an acceptance that no ruling records.

### WR-02 (LOW, data-integrity): once the CR-01 anchor is written, a healthy read that stores no fill never moves it, so later runs walk the full reach and raise the clamp flag on every run

**File:** `analytics-service/services/job_worker.py:2286-2299` with `:2810-2815`, where `advance_fetched_cursor` requires `bool(raw_fills)`.

**Issue:**
1. After an anchored stop or failure, the column is `now - 85 d`.
2. If the following healthy runs persist no fill (an account whose symbols come from `position_snapshots` with no fill in reach), the column never moves.
3. Every later run seeds at the anchor, which is now older than the reach. It walks all 85 days and records `binance_fills_reach_clamped`, even though a complete run has already read the whole reach.

The class is pre-existing: the 232 seeded anchor does the same once it ages past the reach. CR-01 makes the
no-seed case reach that state on the very next run.

**Fix:** none required this phase. Record it beside the quiet-prefix limit, or stamp a complete, empty, unstopped read at its walk start.

### WR-03 (LOW): the WR-01 pin cannot go RED on any production change

**File:** `analytics-service/tests/test_binancefills_cursor.py:248-273`, `analytics-service/tests/_binance_fills.py:373-385`.

**Issue:**
- The second assertion, `column_after_advance(CURSOR_AHEAD_TS, stamp) == CURSOR_AHEAD_TS`, runs only the test helper on two constants.
- The helper is a hand copy of the SQL CASE, so an RPC change that closed the gap would leave it green. The commit message says the arm pins the exception "against the RPC's forward-only rule"; it pins a copy.
- The first assertion pins the gate's stamp, which other arms already pin.

**Fix:** state in the arm's docstring that it pins the record and not the RPC, or drop the helper assertion.

### WR-04 (LOW): the CR-01 arm cannot tell an anchor taken before the read from one taken after it

**File:** `analytics-service/tests/test_binancefills_e2e.py:689-755`.

**Issue:**
- `_now_ms` is frozen at `NOW_MS`, so an anchor computed after `fetch_raw_trades` returns would also equal `reach_ms`, and `since2 <= reach_ms` would still pass. The "taken BEFORE the read" ordering the code comment relies on is not pinned.
- In production the difference is at most the read's 840 s, which the next run's 1-hour overlap absorbs, so this does not reach data.

**Fix:** advance the patched clock per venue call (as `_monotonic` already is) and assert `column2 <= run 1's first startTime`.

### WR-05 (LOW): the harness docstring still lists result order under "the docs are silent"

**File:** `analytics-service/tests/_binance_fills.py:27-29`.

**Issue:** Round 1 asked for this record to be corrected. It still reads "result order (the fake serves oldest first)" under UNMEASURED because the docs are silent. Per CR-01 above, the spot doc states oldest-first for a `startTime` request (`rest-api.md:98-102`). For USD-M and COIN-M the order of a time-bounded request is still undocumented in what RESEARCH fetched.

**Fix:** split the line: spot is documented oldest-first and unmeasured at the venue; USD-M and COIN-M are silent.

## Info

### IN-01: two `exchange.market()` resolutions per symbol

**File:** `analytics-service/services/exchange.py:2770-2771`.

**Issue:** `is_spot` and `_binance_fills_window_ms` each call `_binance_resolves_to_spot`. If CR-01's stop is reverted, `is_spot` goes away. Otherwise compute the window from `is_spot`.

### IN-02: the anchor tests `key_row["exchange"]`, while the dispatch tests `exchange.id`

**File:** `analytics-service/services/job_worker.py:2286`.

**Issue:** The two agree today, because `EXCHANGE_CLASSES` has one key, `"binance"`, mapped to `ccxt.binance`. Use `ctx.exchange.id == "binance"` to match `fetch_raw_trades`' dispatch, so a future alias cannot split them. The ISO build `datetime(1970, ...) + timedelta(...)` also differs from the `datetime.fromtimestamp(ms / 1000, tz=timezone.utc)` form two lines above.

### IN-03: SFH-4 residual, a dated contract that has expired out of the loaded markets

**File:** `analytics-service/services/exchange.py` (BadSymbol branch).

**Issue:** The rebuttal is sound for the round-1 claim. After SFH-3, a client-side BadSymbol means the name is absent from both `markets` and `markets_by_id`. One case remains unmeasured. A COIN-M or USD-M dated contract settled within the 85-day reach drops out of `load_markets`, but its fills may still be readable from the venue. It would be classified unlisted and not held. It is named by `binance_unlisted_symbols`, so it is not silent. Record it with the unlisted-span recovery sentence if it matters.

---

_Reviewed: 2026-11-26_
_Reviewer: Claude (gsd-code-reviewer), round 2_
_Depth: standard_
