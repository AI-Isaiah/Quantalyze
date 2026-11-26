---
phase: 253-binancecursor
reviewed: 2026-11-26T00:00:00Z
depth: deep
round: 1
files_reviewed: 22
files_reviewed_list:
  - analytics-service/services/analytics_runner.py
  - analytics-service/services/binance_sync_flags.py
  - analytics-service/services/job_worker.py
  - analytics-service/services/trade_resume.py
  - analytics-service/tests/_binance_fills.py
  - analytics-service/tests/test_binance_sync_flags.py
  - analytics-service/tests/test_binancefills_cursor.py
  - analytics-service/tests/test_csv_analytics_runner.py
  - analytics-service/tests/test_derive_broker_dailies_dualmode.py
  - analytics-service/tests/test_okxtrades_cursor.py
  - analytics-service/tests/test_stamp_io_exhaustive.py
  - scripts/baseline-content-drift-check.mjs
  - scripts/dump-sql-functions.ts
  - scripts/mutation-floors.mjs
  - src/__tests__/gate-family-meta.test.ts
  - src/__tests__/lint-sql-gates.test.ts
  - src/__tests__/mutation-annotation-parser.test.ts
  - src/__tests__/mutation-runner-floors.test.ts
  - supabase/migrations/20261126140000_strategy_fills_reread_bound.sql
  - supabase/migrations/down/20261126140000-rollback.sql
  - supabase/schema/functions/set_strategy_fills_reread_bound.sql
  - supabase/tests/test_strategy_fills_reread_bound.sql
findings:
  critical: 1
  warning: 1
  info: 9
  total: 11
  necessity: 0
status: issues_found
---

# Phase 253: Code Review Report (round 1)

**Reviewed:** 2026-11-26
**Depth:** deep (call chains traced: the seed block and epilogue of `run_sync_trades_job`, the Binance walk in `services/exchange.py`, the derive prestamp and derive-failed stamp, every `run_csv_strategy_analytics` writer, the TS and SQL writers of `data_quality_flags`, and the RLS and grants on `strategy_analytics`)
**Files Reviewed:** 22 (diff `c57961a54..HEAD`; `.planning/` and `TODOS.md` excluded)
**Status:** issues_found

## Summary

The SQL half is solid. The table has deny-all RLS, the REVOKE/GRANT pair is correct, the function is SECURITY DEFINER with `search_path = public, pg_catalog`, the fence has the same shape as `advance_sync_cursor`, and the snapshot body is byte-equal to the migration's. The gate arms C0 to C10 match `_CASE_TABLE` and the `bound_after_set` mirror literally, and the rollback is correct. The worker's seed term and the round-3 predicate (`_unread_from_ms + 1 < column - OVERLAP`) are right. The approximations the worker makes (the walk start ignores the reach clamp, and `_reach_anchor_ms` is taken before the read) can only make the bound earlier, never later.

Two findings are MEDIUM or worse:

- **CR-01 (HIGH, data-integrity).** A failed bound write sets `_p_last_fetched = None`. That throws away the NULL-column bootstrap anchor, and the next run then seeds past the unread span. On a set column the span is also lost. In both cases the next clean sync deletes `binance_stop_below_cursor`, so after one cycle the only record left is an ERROR log line. Two scratch probes prove this; the traces are below. 253-02-SUMMARY recorded the NULL-column half as an "open item". Plans 03 and 04 left it unfixed.
- **WR-01 (MEDIUM, security/privacy).** The carry keeps traded-symbol lists on `strategy_analytics.data_quality_flags`, which anon can SELECT for a published strategy. Before this phase those keys were overwritten within minutes. Now they persist until the next clean sync. The repo deliberately keeps `trades`/`positions` and per-key read-incomplete markers owner-only.

Both are dormant in PROD while `USE_RAW_TRADE_INGESTION` is off, which it is (SC-4 holds). Both must be fixed before the switch flips.

Nine LOW/INFO items are recorded below. None of them is booked in `TODOS.md`.

## Verdicts on the four items the orchestrator asked about

### Item 1: the name-based exemption of `read_binance_sync_flags` in `test_stamp_io_exhaustive.py`. Verdict: SOUND today, with one LOW gap (IN-04)

- The exemption keys on the call stack, not on a name alone. `_in_the_guarded_flag_read` walks frames for `co_name == "read_binance_sync_flags"` and `co_filename.endswith("binance_sync_flags.py")`. A same-named function in another module does not match unless its filename ends in `binance_sync_flags.py`, for example `legacy_binance_sync_flags.py`. `endswith` without a path separator lets such a file through, but that is cosmetic.
- What is still caught:
  - A guarded call that starts to raise. `test_a_failing_guarded_flag_read_never_blocks_the_failed_stamp` pins "same outcome as clean, plus one WARNING", so a removed `try` goes RED (the recorded neuter).
  - A new `strategy_analytics` WRITE added inside the helper. It would count in `analytics_writes` and break `len(outcome.analytics_writes) == 1`.
  - The helper being renamed or moved out of the closure. The anti-vacuity test checks the scenario set exactly.
- What would slip: a SECOND I/O inside the helper (an extra read, or a write to another table). Both would be marked `guarded`, skipped by `_cases`, and swallowed by the helper's `try` under failure injection. Nothing pins that each scenario has exactly ONE guarded call, nor that it is a `select` on `strategy_analytics`.
- The three CSV-runner callers (`_mark_failed`, `_mark_truncated`, `_mark_config_failed`) are outside this census. Only the insufficient-history writer has a failing-read arm (IN-07).
- The disposition itself is sound. A failure stamp must land, and the re-read guarantee lives in the bound table, not in these keys.

### Item 2: a failed bound write sets `_p_last_fetched = None`. Verdict: NOT fail-loud. The span is lost, and the signal clears after one cycle (CR-01)

- **NULL column.** The stamp gate has set `_p_last_fetched = fills_anchor_iso`, the seed. The except replaces it with `None`, so the column stays NULL and no bound is written. The next run's seed is the daily high-water, and Phase 1 of the failing run moved it forward. The span from the old seed to the new high-water is never re-read. This is exactly the 232 CR-01 / 250 CR-01 class the anchor exists to close.
- **Set column ahead.** The stamp was at or before the stop bound, which is below the column, so `advance_sync_cursor` would have dropped it anyway. The hold changes nothing there. The next seed is `min(column, newest stored fill)`, and the stored fills now include this run's healthy newer fills. That seed is past the span, and no bound exists to pull it back.
- **In both cases** the next run's predicate does not fire: the NULL column short-circuits it, and the set column moved past the span. Its clean read then runs `clear_absent_binance_sync_flags`, which pops `binance_stop_below_cursor`. The flag lasts one cycle.
- **The hold never protects anything.** Whenever `_unread_from_ms` is not None, `_p_last_fetched` is one of two things:
  - A persisted fill at or before `_read_through`, which is at or before `_unread_from_ms` when no failed symbol lowers it.
  - `fills_anchor_iso`, the seed, whose walk start `seed - OVERLAP` equals `_unread_from_ms + 1`.
  
  Neither can sit past unread data, so `= None` defends against nothing and only does harm on a NULL column.
- **The test that pins it encodes mechanism, not intent.** `test_a_failed_bound_write_on_an_incomplete_read_is_loud_and_holds_the_stamp` asserts `p_last_fetched_ts is None` on a column-ahead case, where the forward-only RPC would drop the stamp anyway. It goes RED if the hold is removed (P5). It stays GREEN if the span stops being re-read, which is the behaviour that matters.

### Item 3: Plan 02's reading of D-03 ("at or before every complete-through ceiling"). Verdict: CORRECT. No off-by-one, and no ceiling the bound can land above

- **Against the text.** CONTEXT D-03 says "neither may record a point past where the run is complete through". The plan's must_have says "never later than the earliest complete-through instant (the stop bound, or walk start minus 1 ms for a failed symbol or a raised read)". Those agree. The SUMMARY deviation correctly drops the literal "at or before the walk start" wording, which a plain stop whose bound is later than the walk start would falsify.
- **Arithmetic.**
  - `_unread_from_ms = min(read_through, walk_start - 1 if partial/raised/unusable-stop)`.
  - `read_through` is `min(stop_bounds)`. Each stop bound is `window_newest` or `window_start - 1` for cap, untimed and deadline stops (`exchange.py`, in `_fetch_one`). A symbol that sends no request before the deadline gets `walk_start - 1`.
  - The worker's `_walk_start_ms = fills_since_ms - OVERLAP_WINDOW_MS` ignores the walk's `max(…, reach)` clamp, and `_reach_anchor_ms` is taken before the read's own clock. Both can only make the bound earlier.
  - `covers_from` can name an instant below the actual clamped walk start, but only inside the unreachable region below the reach, where clearing a bound loses nothing reachable.
- **Boundaries.**
  - The predicate's `+ 1` is right: the unread start is the first instant not complete through, and the next walk starts at most at `column - OVERLAP`.
  - The RPC's inclusive `p_covers_from <= v_existing_from` (C10) is right, even conservative.
  - R4 (covered) moving the bound to the run's own instant is right: the run read from at or before the stored bound up to its new instant.
- **Side effect (IN-01, LOW).** For a symbol that fails on every run, R4 moves the bound back by `OVERLAP + 1 ms` per run. A scratch probe measured `2026-06-01T07:59:59.999`, then `06:59:59.998`, then `05:59:59.997`. This is over-fetch only, never a missed span.

### Item 4: the WR-01 predicate and the WR-02 flag carry, against SC-1 to SC-5. Verdict: SC-2, SC-3 and SC-4 are met. SC-1 is unmet on the bound-write failure path (CR-01). The carry has a public-exposure defect (WR-01)

- **SC-1.**
  - Met on the normal path. The two-run arm and the D-02 interleave both drive the real job against a stateful mirror cross-checked with the SQL case table.
  - UNMET when `set_strategy_fills_reread_bound` errors (CR-01).
  - "The cursor never stamps past stored data" holds: the column logic is unchanged apart from the hold.
- **SC-2.** Met. Stop-plus-partial, partial-only and raised-read arms exist, and the predicate compares the earliest complete-through instant with `column - OVERLAP`.
- **SC-3.** Met.
  - Per-hop arms exist for both `binance_stop_below_cursor` and `binance_deadline_symbols`: derive prestamp, derive-failed stamp, CSV rebuild, and the CSV insufficient-history, truncated, config and unrecoverable writers.
  - The allowlist (9 keys) matches the producers exactly: 8 `_record_dq_flag("binance_…")` calls in `exchange.py`, plus `binance_stop_below_cursor` in `job_worker.py`.
  - Writer census:
    - Python read-modify-write writers carry by construction: `_mark_unrecoverable`, the sibling-kinds flag, stitch composite's `merged_flags`, and the sync epilogue.
    - The SQL functions only read the column.
    - The TS wholesale writers are the wizard and CSV finalize routes. One of them, `finalize-wizard`'s `membership_unknown` failure, is reachable for a key strategy and drops the keys (IN-09, pre-existing, outside the D-08 scope).
  - Clearing: the next Binance sync that ran, did not raise, and loaded the flags pops the absent keys and forces the row write.
  - Two LOW clearing cases: the flags are cleared while a bound survives (IN-03), and the keys are never cleared after a cross-venue re-point (IN-02).
- **SC-4.** Met. The switch is still env-gated and defaults to `"false"` (`job_worker.py` `_RAW_TRADE_INGESTION_ENABLED`). The comment block says the gap is closed and how. `[250-BINANCE-STOP-BELOW-CURSOR]` has 0 hits in `TODOS.md`. The CHANGELOG entry is a ship-time item.
- **SC-5.** The neuters are recorded in each test module's docstring and in the SUMMARYs. Not re-run here beyond the targeted arms (load limit).

## Critical Issues

### CR-01: A failed re-read bound write drops the NULL-column anchor and loses the unread span, and the flag clears on the next sync (HIGH, data-integrity)

**File:** `analytics-service/services/job_worker.py`, `run_sync_trades_job`, in the `except Exception` of the `_set_bound` block (`_p_last_fetched = None`, near line 2869)
**User-facing:** no (operator signal; the switch is off in PROD). **Data-integrity:** yes.
**Issue:** When `set_strategy_fills_reread_bound` raises and `_unread_from_ms is not None`, the except logs an ERROR, sets `binance_stop_below_cursor`, and sets `_p_last_fetched = None`.

1. **NULL column.** The `None` overwrites the bootstrap anchor that the stamp gate just set (`_p_last_fetched = fills_anchor_iso`, the Phase 232 / Phase 250 CR-01 anchor). The column stays NULL and no bound row exists. The next run's seed is the daily high-water, which Phase 1 of the failing run moved forward. The stopped or failed span is never re-read.
2. **Set column ahead.** The hold has no effect, because the stamp is at or before the bound, which is below the column, so it is dropped by the forward-only RPC anyway. The next seed is `min(column, newest stored fill)`, which this run's healthy fills moved past the span.
3. **Both cases.** The next run reads clean, its predicate cannot fire (NULL column, or a seed past the span), and `clear_absent_binance_sync_flags` pops `binance_stop_below_cursor`. One cycle later the only trace is one ERROR log line.

Measured with two scratch probes driving the REAL `run_sync_trades_job` through the repo's own fakes. The probes are `test_probe_null_column_bound_write_fail.py` and `test_probe_two_run.py` under the session scratchpad.

```
NULL column, run 1 (bound RPC raises):      stamp None   (stamp is the anchor 2026-05-07 when the RPC succeeds)
NULL column, run 2 (daily row 2026-07-14):  since_ms 1783987200000 (2026-07-14T00:00Z)   flags {}
set column, run 1 (bound RPC raises):       stamp None, flag binance_stop_below_cursor True
set column, run 2:                          since_ms 1780477200000 (2026-06-03, the healthy fill), past the
                                            stop at 2026-06-02T09:00Z; flags {}
```

253-02-SUMMARY "Open items" records the NULL-column half and suggests holding to `fills_anchor_iso`. Plans 03 and 04 did not fix it. As shown in item 2 above, the `= None` hold never protects anything.

The only arm on this path (`test_a_failed_bound_write_on_an_incomplete_read_is_loud_and_holds_the_stamp`) uses a set column, where the hold is a no-op. It pins the mechanism, so it cannot fail when the span stops being re-read.

**Fix:** The minimal fix is to stop discarding the stamp, and to retry the one write before giving up.

```python
        except Exception as exc:  # noqa: BLE001
            if _unread_from_ms is not None:
                logger.error(...)                       # unchanged
                exchange_dq_flags["binance_stop_below_cursor"] = True
                # Do NOT touch _p_last_fetched: every value it can hold here is at or before
                # the unread start (a stamp <= read-through, or the NULL-column anchor at the
                # seed), and the anchor is the only thing that keeps a NULL column re-reading.
```

Also, either wrap `_set_bound` in the bounded retry the module already uses for idempotent writes, or treat a lost bound write like `phase2_failed` for the D-09 clear. In other words, do not let the NEXT run's clear delete `binance_stop_below_cursor` unless that run's walk covered the lost unread instant. One way to do that is to record the lost instant in the flags and clear only when `covers_from <= it`.

Add two-run arms that can fail on intent:
- NULL column: run 1's bound RPC raises with a Phase-1 daily row. Assert that run 2's `since_ms` is at or before run 1's unread start.
- Set column ahead: assert that run 2 still re-reads from the lost start, or that the flag survives run 2.

## Warnings

### WR-01: The carry keeps traded-symbol lists on the anon-readable `strategy_analytics.data_quality_flags` (MEDIUM, security/privacy)

**File:** `analytics-service/services/binance_sync_flags.py`, `_SYMBOL_LIST_KEYS` / `carry_binance_sync_flags`. It is applied at `job_worker.py` `run_derive_broker_dailies_job` (`_prestamp_flags.update(carry_binance_sync_flags(...))` and the derive-failed `_upsert`) and at `analytics_runner.py` `run_csv_strategy_analytics` (the success rebuild and the three failure writers).
**User-facing:** yes (a manager's traded symbols visible to anyone). **Data-integrity:** no. Dormant while the switch is off.
**Issue:**
- `strategy_analytics` carries `GRANT SELECT ... TO "anon"` (`supabase/schema/baseline.sql`, the grants block). Its `analytics_read` policy admits any caller when `strategies.status = 'published'`.
- `binance_partial_symbols`, `binance_unlisted_symbols`, `binance_page_cap_symbols`, `binance_untimed_page_symbols` and `binance_deadline_symbols` are lists of the strategy's traded symbols, capped at `_DQ_LIST_MERGE_CAP`. `binance_read_through_ms` adds read timing.
- Before this phase the sync wrote them, and the chained derive's wholesale prestamp erased them minutes later. This phase deliberately keeps them on the public row until the next clean sync, through the factsheet rebuild.
- This cuts against the repo's own boundary:
  - `trades_read` and `positions_read` are owner-only (G12.D.1).
  - `_record_read_incomplete` and `_record_nav_mark_refusal` in `job_worker.py` write per-key read failures to the owner-only `allocator_equity_derived` precisely because `data_quality_flags` "is publicly readable for a published strategy".
- CONTEXT D-08 asked for the carry. It did not weigh where the carried keys can be read, so this conflict is surfaced here (Rule 7) rather than averaged.

**Fix:** Carry only the non-identifying keys on the public row: the three `True` keys, and either `binance_read_through_ms` or nothing. Put the symbol lists in owner-only storage, using the `allocator_equity_derived` precedent or an owner-tier column, or carry a count (`binance_deadline_symbol_count: int`) instead of names. Pin it with an arm asserting that no `_SYMBOL_LIST_KEYS` member reaches the derive prestamp or the CSV rebuild payload.

## Info (LOW and INFO; recorded here only, never booked in TODOS.md)

### IN-01 (LOW): The bound drifts back by `OVERLAP + 1 ms` on every run of a persistently failing symbol

**File:** `job_worker.py` `run_sync_trades_job`, `_throughs.append(_walk_start_ms - 1)` combined with RPC R4.
**Issue:** The run is seeded at bound B, so its walk starts at `B - OVERLAP`, which covers B. A failing symbol then contributes `B - OVERLAP - 1`, and R4 stores that value. The probe measured `07:59:59.999`, then `06:59:59.998`, then `05:59:59.997`. The walk grows by an hour per run on top of wall-clock growth, until it reaches the reach clamp. This is over-fetch only.
**Fix:** For a failed symbol, use `max(walk_start - 1, min(stored bound, walk_start - 1 + OVERLAP))`, or simply LEAST with the stored bound rather than R4 when the only through is a failed-symbol walk start.

### IN-02 (LOW): After a cross-venue key re-point the `binance_*` keys are never cleared

**File:** `job_worker.py`, the clear guard `if _binance_read and not phase2_failed and not flag_load_failed`. It is pinned by `test_binancefills_cursor.py::TestBinanceSyncFlagClearing::test_an_okx_sync_keeps_the_binance_keys`.
**Issue:** D-09 says a key "lives until the NEXT SYNC that does not raise it". An OKX sync on a strategy re-pointed from a Binance key never raises the keys and never clears them, and the derive carries them for ever. The stale bound row is harmless, because the reader filters by key and the row cascades on key deletion.
**Fix:** Clear the allowlisted keys on any successful non-Binance sync of a strategy whose current key is not Binance, or on a re-point.

### IN-03 (LOW): The flags can clear while a bound is still pending

**File:** `trade_resume.py` `load_strategy_fills_reread_bound` (fail-open), RPC R7, and the D-09 clear.
**Issue:** If the bound read fails and the run is complete, `covers_from` is above the stored bound, so R7 keeps it. The clean read still pops `binance_stop_below_cursor`. The re-read is still guaranteed by the row, but nothing visible names it any more. D-09's wording allows this.
**Fix:** Skip the clear when the bound read failed (`_bound_err is not None`).

### IN-04 (LOW): The stamp-I/O exemption does not pin the guarded call's count or shape

**File:** `tests/test_stamp_io_exhaustive.py`, `_in_the_guarded_flag_read` / `_cases`.
**Issue:** A second I/O inside `read_binance_sync_flags` would be skipped by the census and swallowed by its `try` (see item 1). `endswith("binance_sync_flags.py")` also matches any filename with that suffix.
**Fix:** In `test_discovery_sees_the_guarded_flag_read_...`, assert exactly one guarded call per scenario, with `target == "strategy_analytics"` and select-only ops. Match `co_filename` on `os.sep + "binance_sync_flags.py"`.

### IN-05 (INFO): Copy-paste duplication in a census comment

**File:** `src/__tests__/gate-family-meta.test.ts`, the `KNOWN_THRESHOLD_SITES` entries `FILES_FLOOR=95` and `ARMS_FLOOR=1057`.
**Issue:** The Phase 225 plan 16 parenthetical appears twice in each line.
**Fix:** Delete the repeated parenthetical.

### IN-06 (INFO): No SQL arm covers the `strategy_id ... ON DELETE CASCADE`

**File:** `supabase/tests/test_strategy_fills_reread_bound.sql`. Only `CASCADE 1` covers `api_key_id`.
**Fix:** Add a twin arm that deletes the strategy.

### IN-07 (INFO): Only one CSV failure writer has a failing guarded read arm

**File:** `tests/test_csv_analytics_runner.py`. `test_a_failing_prior_flags_read_never_blocks_the_failure_stamp` covers the insufficient-history writer only. The truncated and config-failed writers call the same helper with no failing-read arm.
**Fix:** Parametrise the arm over all three writers.

### IN-08 (INFO): The `api_key_id` foreign key has no index

**File:** `supabase/migrations/20261126140000_strategy_fills_reread_bound.sql`, STEP 1.
**Issue:** A cascade from `api_keys` scans the table. The table is tiny (at most one row per strategy), so this is negligible today.

### IN-09 (INFO): A pre-existing TS wholesale writer drops the carried keys

**File:** `src/app/api/strategies/finalize-wizard/route.ts`, the `membership_unknown` failure upsert, which writes `data_quality_flags: { csv_source: true, membership_unknown: true }`.
**Issue:** If this path runs for a Binance strategy carrying keys, it erases them. It is outside D-08's named hops and predates the phase.

---

_Reviewed: 2026-11-26_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
