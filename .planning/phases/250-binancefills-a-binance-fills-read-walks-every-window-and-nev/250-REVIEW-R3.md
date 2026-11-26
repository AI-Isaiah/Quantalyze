---
phase: 250-binancefills-a-binance-fills-read-walks-every-window-and-nev
round: 3
reviewed: 2026-11-26T00:00:00Z
depth: standard
diff_base: 9028e0bc4
diff_head: 6eaaa5b13
files_reviewed: 4
files_reviewed_list:
  - analytics-service/services/exchange.py
  - analytics-service/services/job_worker.py
  - analytics-service/tests/test_binancefills_cursor.py
  - analytics-service/tests/test_binancefills_walk.py
severity:
  critical: 0
  high: 0
  medium: 3
  low: 3
  info: 0
findings:
  critical: 0
  warning: 6
  info: 0
  total: 6
  necessity: 1
status: issues_found
---

# Phase 250: Code Review Report, round 3 (final)

**Reviewed:** 2026-11-26
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found (3 MEDIUM, 3 LOW)

## Summary

**Scope.** This round reviews the round-2 fix commits only: `git diff 9028e0bc4 6eaaa5b13 -- analytics-service/`. That covers two commits:
- `25bc5e4e7`: the spot revert;
- `6eaaa5b13`: the `binance_stop_below_cursor` flag and the gate-block move.

The disposition rows and the ship hand-over that `584e2f53a` wrote about these commits were read as well.

**Read outside the diff:**
- all of `run_sync_trades_job`, from the seed computation to the `advance_sync_cursor` RPC (`job_worker.py:2164-2975`);
- the Binance walk and its `Semaphore(5)` (`exchange.py:2700-2900`), the overlap subtraction (`exchange.py:2560-2570`) and the flag recording (`exchange.py:2960-3030`);
- `parse_since_ms` (`exchange.py:3598-3627`);
- the follow-on chain's flag writes:
  - `JOB_CHAIN_FOLLOW_ON` (`job_worker.py:1083`);
  - the derive prestamp (`job_worker.py:11317`, `:11716-11721`);
  - the CSV rebuild in `run_csv_strategy_analytics` (`analytics_runner.py:2216`, `:2240-2366`, `:2472`).

**Binance docs.** The raw spot doc, `binance-spot-api-docs/rest-api.md`, was fetched this round with `curl`. Lines 98-102 read: "Data is returned in **chronological order**, unless noted otherwise. ... With `startTime`, returns oldest items from `startTime` up to the limit. ... With both, behaves like `startTime` but does not exceed `endTime`." Line 4771 is the `fromId` note that round 1 misread.

**Tests.** All runs used a `git archive 6eaaa5b13` copy in the scratchpad, never the worktree, one file at a time. All green at HEAD:
- `test_binancefills_cursor.py`: 21 passed;
- `test_binancefills_walk.py`: 34 passed;
- `test_binancefills_e2e.py`: 11 passed;
- `test_okxtrades_cursor.py`: 20 passed;
- `test_job_worker.py -k "sync_trades or mt5 or phase2 or cursor"`: 19 passed;
- `mypy` on `services/job_worker.py` and `services/exchange.py`: clean.

**Probes.** Each one drives the real `run_sync_trades_job`.
- **Harness probes** in `test_r3_probe.py` (scratchpad): `fetch_raw_trades` is mocked with a chosen flag set.
- **Real-walk probes:**
  - The existing `test_repeated_deadline_stops_advance_the_frontier_every_run`, with an assertion added that no run sets `binance_stop_below_cursor`. It stays green across 4 real deadline-stopped runs.
  - A scaled heavy-overlap-hour drive (`r3_e2e_probe_snippet.txt`, scratchpad).

**Neuters.** Each was restored from a byte backup and checked with `cmp`.
- **R2-N1:** re-applying the round-1 full-spot-page stop turns `test_an_oldest_first_spot_window_of_several_pages_is_read_whole` RED, as its docstring says.
- **Partial disjunct:** deleting `or exchange_dq_flags.get("binance_partial_symbols")` from the flag condition leaves all 21 cursor arms GREEN (WR-05).

**Verdicts on the three checks asked for:**

1. **The gate-block move is clean.**
   - The 121 moved lines are byte-identical. I diffed the removed hunk against the added hunk. The only additions are the two `None` initialisers and the new flag block.
   - The only code between the old position and the new one is the H-0691 flag-stamp block (`job_worker.py:2735-2891`):
     - It reads `phase1_failed`, `phase2_failed`, `_RAW_TRADE_INGESTION_ENABLED` and `exchange_dq_flags`.
     - It writes only its own locals: `existing_flags`, `write_needed`, `flag_load_failed`, `flag_was_set`, `phase2_success`, `needs_flag_write` and `exchange_dq_flags_present`. The gate reads none of them.
     - The gate writes only its `_`-prefixed locals and `_p_last_fetched`, plus the new `exchange_dq_flags` key, which is why the block moved.
   - No name collides. The gate's `except ... as exc` is unbound when its block ends. Every later handler binds its own name: `load_exc`, `flag_exc`, and a fresh `exc` at the RPC.
   - `advance_fetched_cursor` still requires `phase2_complete`, and the new position comes after the persist block (`job_worker.py:2586`). The stamp still exists only after a successful persist. The RPC's position and inputs are unchanged.
   - Neither block can raise:
     - Neither the gate nor the flag block is inside a `try`.
     - Both `datetime` computations are guarded, `parse_since_ms` swallows its own errors, and the stamp path catches its five exception classes.
     - So the move adds no path that skips the flag stamp or the RPC.
   - Exceptions still hold the cursor. A re-raised `RateLimitExceeded` leaves before the epilogue, and a Phase 2 raise sets `phase2_failed`.
   - The other paths are untouched:
     - MT5 and ingestion-off never assign `_fills_cursor_ms`, so the new block is skipped.
     - OKX, Bybit and Deribit never record `binance_page_cap_symbols`, `binance_untimed_page_symbols`, `binance_deadline_symbols`, `binance_read_through_ms` or `binance_partial_symbols`, so `_fills_stopped` and the partial disjunct are both false.
2. **The flag condition is right for the cases named, but has a real-loss false negative and a narrow false positive** (WR-01, WR-04).
   - It fires for the shared-key case: the shipped arm and the partial-only probe both set it.
   - It does NOT fire on the ordinary deadline stop where the column is the newest stored fill. Four real deadline-stopped runs through the real walk never set it. Under FIFO `Semaphore(5)` every symbol's first page goes out in the first round, and a page that passes the column puts the stop bound at or above it.
   - It never holds the cursor, because it does not touch `_p_last_fetched`.
   - Separately, the flag does not survive the follow-on chain (WR-02).
3. **The spot revert is exact.**
   - `git diff 2414e8b38^ 6eaaa5b13 -- analytics-service/services/exchange.py` differs only by the comment `9db17efbf` added to the 840 s constant.
   - The SFH-3 window change (`00a12974c`) predates `2414e8b38`, so it is kept.
   - `_binance_resolves_to_spot` is still used by `_binance_fills_window_ms` (`exchange.py:779`).
   - The inverted arm is a real pin (R2-N1) and agrees with the doc as read this round.

**Necessity.** `necessity-review.md` was read. One finding: WR-06. No source file was modified.

**Severity mapping (as in round 2):** `critical` = HIGH, `warning` = MEDIUM + LOW, `info` = INFO. Under the review rule only MEDIUM and above is acted on. WR-04 to WR-06 are recorded here only.

## Warnings

### WR-01 (MEDIUM, data-integrity): the flag misses a real permanent unread span on the shared-key first sync when a stop and a failed symbol coincide, because the stop bound replaces the failed symbol's earlier unread start

**File:** `analytics-service/services/job_worker.py:2720`

**Issue.** The code sets `_unread_from_ms = _read_through_raw if _read_through is not None else fills_since_ms`. When `binance_partial_symbols` and a stop bound are both present:
- the failed symbol is unread from the walk start, which on a first sync with no seed is the reach;
- the bound says only that the STOPPED symbols are complete through it;
- the code takes the bound anyway.

Take the shared-key first sync that the record names:
1. The column C was set by the other strategy. This strategy has no stored fill and no daily row, so the seed is None and the walk starts at the reach.
2. Symbol A is deadline-stopped past C. Symbol B's read raises, so B is listed in `binance_partial_symbols`.
3. `_unread_from_ms` is the bound, which is at least C, so no flag is set.
4. The hold leaves the stamp None. Phase 1 stores daily rows and the healthy symbol stores a fill. The next seed is `min(C, newest stored fill)`, so B's span `[reach, min(C, newest stored fill) - 1 h)` is never read.

Nothing names that span. The loss itself is the pre-existing open SC-3 gap. What is wrong in this diff is that its signal misses it. This is a compound case, but the first sync of a new strategy walks the full 85-day reach under the 840 s deadline. That read is the one most likely to stop and most likely to see a per-symbol error. `250-08-SUMMARY.md:156` says the gap "is now loud on every such run", and it is not.

**Proof.** Probe `test_probe_false_negative_partial_plus_stop_above_column`:
- setup: column `2026-06-20`, no stored rows, deadline bound `2026-06-21`, `binance_partial_symbols: ['BTCUSDT']`;
- flags written: `{'binance_deadline_symbols': ['ADAUSDT'], 'binance_read_through_ms': 1782000000000, 'binance_partial_symbols': ['BTCUSDT']}`, with no `binance_stop_below_cursor`.

The control with the partial flag alone (no bound) does set the flag.

**The same root, wider, and pre-existing.** Probe `test_probe_raised_read_column_ahead` makes the read RAISE on the same shared-key first sync (`raw_error=`):
- It records only `phase2_fill_ingestion_failed`, and no `binance_stop_below_cursor`.
- The next run seeds at `min(C, daily seed)`, and `[reach, that - 1 h)` is never read.
- The phase-2 flag then self-heals on the next clean run (`phase2_recovered_at`).

This part predates phase 250. Name it in the record, or let `phase2_failed` join `_partial` in the predicate below.

**Fix.** A failed symbol's unread start is the walk start. Compare the earliest complete-through instant with the next run's walk start, which is at most `column - OVERLAP_WINDOW_MS`. I ran this predicate in the scratch copy:
- this probe now flags;
- the partial-only control still flags;
- WR-04's probe stops flagging;
- all 21 `test_binancefills_cursor.py` arms stay green, including the shipped positive arm and its exact bound in the WARNING;
- `mypy` is clean.

```python
_partial = bool(exchange_dq_flags.get("binance_partial_symbols"))
if _fills_cursor_ms is not None and (_fills_stopped or _partial):
    # Complete-through instant: a stop is complete through its bound; a failed symbol (or a
    # stop with no usable bound) is unread from the walk start, the seed minus the overlap,
    # or the reach when there was no seed (None).
    _throughs: list[int | None] = []
    if _read_through is not None:
        _throughs.append(_read_through_raw)
    if _partial or _read_through is None:
        _throughs.append(
            None if fills_since_ms is None
            else fills_since_ms - _exchange.OVERLAP_WINDOW_MS - 1
        )
    _unread_from_ms = (
        None if None in _throughs else min(t for t in _throughs if t is not None)
    )
    # The next run seeds at or below the column and walks from that seed minus the overlap,
    # so a span whose first unread instant is at or after column - overlap is re-read.
    if _unread_from_ms is None or (
        _unread_from_ms + 1 < _fills_cursor_ms - _exchange.OVERLAP_WINDOW_MS
    ):
        exchange_dq_flags["binance_stop_below_cursor"] = True
        ...  # WARNING unchanged
```

Add this probe as a positive arm, along with a partial-only arm (WR-05). Correct "loud on every such run" in `250-08-SUMMARY.md:156` to say what the predicate covers.

### WR-02 (MEDIUM, data-integrity signal): `binance_stop_below_cursor` does not survive the sync's own follow-on chain; the WARNING log is the only lasting signal

**Files:**
- `analytics-service/services/job_worker.py:1083`, `:11317`, `:11716-11721`;
- `analytics-service/services/analytics_runner.py:2216`, `:2240-2366`, `:2472`;
- against `250-08-SUMMARY.md:156` and the R2 WR-01 disposition (`250-REVIEW.md:330`).

**Issue.** The sync epilogue merges the flag into `strategy_analytics.data_quality_flags`, and the shipped arm checks exactly that write. Then the chain runs:
1. `run_sync_trades_job` always enqueues its follow-on, `JOB_CHAIN_FOLLOW_ON["sync_trades"] = ("derive_broker_dailies",)`.
2. The derive builds a fresh `_prestamp_flags = {"csv_source": True}` (`:11317`) and upserts it as the row's `data_quality_flags` (`:11716-11721`). It never reads the existing flags.
3. Its follow-on, `run_csv_strategy_analytics`, rebuilds `data_quality_flags` wholesale from `{"csv_source": True}` (`analytics_runner.py:2216`). It carries only the NAV, allocated-capital and legacy guard keys, a fixed list of named keys, and `daily_pnl_malformed_*` (`:2240-2366`). No `binance_*` key is carried.

So on the normal path the flag is overwritten one hop after the sync writes it. A strategy in the open gap shows nothing on `strategy_analytics` once its factsheet is compiled. Only the WARNING in the worker log remains.

R2 WR-01 asked for "a named flag plus a WARNING". The flag half lasts seconds, yet the records describe it as the run-time signal that lands on `strategy_analytics`. The same overwrite applies to every sync-time DQ flag (`binance_deadline_symbols`, `binance_partial_symbols`, `binance_page_cap_symbols`, `sync_truncated_*`). That class predates this phase. It matters here because this flag is the only answer to an open data-integrity gap. The founder-ruled quiet-prefix exception, "named by `binance_deadline_symbols` on every such run", rests on the same short-lived write.

Not traced: whether any early return in `derive_broker_dailies` skips the prestamp for a Binance key. The claim above covers the path that reaches `:11716`.

**Fix.** Pick one:
- **(a) Carry the flag.** Carry `binance_stop_below_cursor` (and, if the founder wants the deadline exception durably named, the other sync-time `binance_*` keys) through both the derive prestamp and the CSV rebuild, present-only and `is True`, the way `daily_pnl_malformed_*` is carried. Pin it with a two-hop arm.
- **(b) Accept the log.** Accept the WARNING as the only durable signal, and change the hand-over and the disposition to say the flag lasts only until the follow-on derive.

Either way, the records must stop implying a durable admin-visible flag.

### WR-03 (MEDIUM, records): the hand-over and both disposition rows say the open SC-3 gap is "booked in TODOS.md"; no entry exists, and the code comment says "no owner yet"

**Files:**
- `.planning/phases/250-.../250-08-SUMMARY.md:156` ("Closing it needs an RPC change, booked in TODOS.md");
- `.planning/phases/250-.../250-REVIEW.md:316` and `:330`;
- the comment they contradict: `analytics-service/services/job_worker.py:357` ("has no owner yet").

**Issue.** `TODOS.md` has no entry for this gap: a grep for `stop_below_cursor`, `advance_sync_cursor` and phase 250 finds nothing, and the file has not changed since `4c0426773`. R2 WR-01's fix list said: "Book the RPC change with an owner, or put the acceptance to the founder." Neither happened. The ship hand-over, which feeds the CHANGELOG, says the first one did. The source comment says the opposite. The gap is an open data-integrity gap, so the repo's TODOS rule requires booking it.

**Fix.** Do one of these, and keep the source comment and the records in agreement:
- Write the `TODOS.md` entry, and cite its id in all three places. The entry needs an owner, a trigger, and the RPC change: let a stopped read lower the column, or move to a per-strategy cursor.
- Or drop "booked in TODOS.md" from the hand-over and both rows, and put the open gap to the founder.

### WR-04 (LOW): the flag fires on a stop whose bound lies inside the overlap hour below a column that equals the newest stored fill, where nothing is skipped

**File:** `analytics-service/services/job_worker.py:2717-2724`

**Issue.** The flag compares the stop bound against the column, but the bound already has the overlap taken off and the column does not. With the column C equal to the newest stored fill:
- The seed is C. The walk starts at `C - 1 h`, and the next run starts there again.
- A bound inside `[C - 1 h - 1 ms, C)` therefore leaves no gap, yet the flag fires and the WARNING says "the span may not be re-read".

The ordinary case does not reach this:
- Under the FIFO `Semaphore(5)`, every symbol sends its first page before any symbol sends its second.
- The deadline is checked before each request, and a symbol that has read past C records `window_newest >= C`.
- The four real deadline-stopped runs in the repeated-deadline arm never set the flag.

It is reachable in two ways:
- a symbol holds at least one full page (1,000 fills) inside its overlap hour, and the deadline hits while it pages there;
- a key has so many symbols that the first round alone outlasts 840 s.

The scaled real-walk drive reproduces the first: page limit 3, six fills in `[C - 1 h, C)`, one request let out. It records bound `1792580700000`, which is below C `1792584000000`, and sets `binance_stop_below_cursor`. The overwrite in WR-02 limits how long a false positive stays visible.

**Fix.** WR-01's predicate. It clears this probe and keeps every shipped arm green. Add a negative arm in the shape of the scaled drive.

### WR-05 (LOW, test reliability): the flag's `binance_partial_symbols` arm is unpinned; the disposition's "RED on two neuters" names one

**File:** `analytics-service/tests/test_binancefills_cursor.py:48`, `:277-335`; `250-REVIEW.md:330`.

**Issue.**
- Deleting `or exchange_dq_flags.get("binance_partial_symbols")` from the flag condition leaves all 21 cursor arms green.
- The module docstring lists one neuter, R2-N2 (the write itself), but the disposition row says "RED on two neuters (R2-N2)".
- No arm covers the partial-only entry: the shared-key first sync where one symbol fails and nothing stops.

**Fix.**
- Add a partial-only positive arm (the shape of `test_probe_control_partial_alone_from_reach_is_flagged`) and list its neuter.
- Correct the disposition's neuter count.

### WR-06 (LOW, necessity): impossible-state guard: the stamp clause of the flag condition can never be false when the unread clause is true

**File:** `analytics-service/services/job_worker.py:2721-2724`
**Category:** necessity

**Issue.**
- When `_fills_cursor_ms is not None`, `fills_anchor_iso` is None, because it is set only in the NULL-column branch (`job_worker.py:2290-2309`). Both anchor assignments (`:2699`, `:2708`) are therefore dead.
- `_p_last_fetched` is then one of two values:
  - None, on a hold, a partial read or an unusable bound, since all of these set `_fills_incomplete` (`:2626-2653`);
  - the newest persisted fill at or before `_read_through` (`:2672-2676`).
- When `_unread_from_ms` is the bound and lies below the column, the stamp is at most the bound, so it is below the column too.
- When `_unread_from_ms` is the seed, the stamp is None.

So `_stamp_ms is None or _stamp_ms < _fills_cursor_ms` never decides the outcome.

**Fix.** Drop the stamp clause and `_stamp_ms`; WR-01's predicate already does. If the clause is kept as a guard against a future anchor on a set column, say so in the comment.

---

_Reviewed: 2026-11-26_
_Reviewer: Claude (gsd-code-reviewer), round 3_
_Depth: standard_
