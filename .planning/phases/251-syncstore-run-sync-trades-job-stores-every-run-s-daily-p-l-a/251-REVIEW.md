---
phase: 251-syncstore-run-sync-trades-job-stores-every-run-s-daily-p-l-a
reviewed: 2026-11-26T00:00:00Z
depth: deep
base: d7cd0443a
files_reviewed: 3
files_reviewed_list:
  - analytics-service/services/job_worker.py
  - analytics-service/tests/test_sync_trades_store_truth.py
  - analytics-service/tests/test_sync_trades_enqueue_failure_bridge_live.py
severity_counts:
  critical: 0
  high: 0
  medium: 0
  low: 5
  info: 4
findings:
  critical: 0
  warning: 0
  info: 9
  total: 9
  necessity: 0
status: issues_found
---

# Phase 251: Code Review Report

**Reviewed:** 2026-11-26
**Depth:** deep (call chains traced into `services/exchange.py`, `services/geo_block.py`, the status bridge SQL in `supabase/schema/baseline.sql`, and the dispatcher's error classification)
**Files Reviewed:** 3 (`git diff d7cd0443a..HEAD -- analytics-service/`)
**Status:** issues_found (LOW and INFO only; nothing at MEDIUM or above)

**Severity scale.** Every finding has one of the caller's five levels (CRITICAL / HIGH / MEDIUM / LOW / INFO). The template frontmatter keys map like this: `critical` = CRITICAL + HIGH, `warning` = MEDIUM, `info` = LOW + INFO. `severity_counts` holds the five-level counts. Per the repo rule, LOW and INFO survivors are recorded here only and are not booked in `TODOS.md`.

## Summary

I reviewed `run_sync_trades_job` and the new `_is_sync_owned_daily_pnl_key` against ROADMAP Phase 251 SC-1 to SC-6 and 251-CONTEXT.md, including its Research resolutions. I traced every branch of the reordered handler: the store, the refusal, the rate limit, the owned-key replace, the flag-read failure, the epilogue and the 222 tail.

**Contract conformance. Every clause holds in the code:**

- **SC-1.** The store runs inside the ccxt arm before `fetch_usdt_balance` and the fills walk (`job_worker.py:2268-2324`). The `persist_exc` arm catches `Exception`, never `CancelledError`, so a `wait_for` cancel cannot be swallowed into `phase1_failed`.
- **SC-2.** A verdict reason sets `phase1_read_refused`, never `phase1_failed`. It stores nothing, `_p_last_sync` is `None` (`:2924`), `advance_fetched_cursor` is held (`:2862`), `trade_count` is 0 (`:3237`), and the stale persist-failed flag is kept (`:2741`). `rate_limited` is checked before `reasons`, so a 429 always raises rather than being refused (`:2269`).
- **SC-3 and SC-4.**
  - On every ccxt run, `needs_flag_write` includes `phase1_read_ran` (`:2640-2642`).
  - The owned keys are popped and then re-merged from the drain (`:2707-2733`).
  - The class is the verdict's sanitized identifier (`:2723-2728`).
  - `daily_pnl_malformed_*` is never popped.
  - A failed flag read with Phase 2 not run writes nothing (`:2793-2804`).
  - `write_needed` only accumulates (`:2689`), and the old trailing `else: write_needed = False` is gone.
  - `_is_sync_owned_daily_pnl_key({key: True})` matches the verdict exactly, because every verdict reason key is either a literal or a prefix of the key itself.
- **SC-5.** The write and the re-read have separate `try` scopes (`:3127-3217`):
  - write raises: FAILED;
  - zero rows, then the re-read raises: DONE;
  - zero rows, then the re-read finds a published row: DONE;
  - zero rows, then the re-read finds nothing: FAILED.

  `_nothing_published` is only ever cleared, never re-set, so no path flips DONE back to FAILED.

**MT5 and ingestion-on runs.** For MT5 with ingestion off, the run never reads `strategy_analytics` (pinned by `test_mt5_run_makes_no_daily_flag_read`). For MT5 with ingestion on, nothing changes. For ccxt with ingestion on, the only changes are the ones CONTEXT records:

- the reorder;
- the refusal;
- the `write_needed` accumulation, which now really stamps and clears `phase1_daily_pnl_persist_failed`;
- the clear of the owned keys.

**Tests.**

- **Mocked suite.** The 37 arms drive the real handler and plant flags through the real `_record_dq_flag` buffer, which is never patched. The fake upsert replaces the column, and the live A1 arm checks that assumption against real PostgREST. The SC-5 twin patches `db_read_with_retry` by function name and raises a `BaseException` when the handler reads more often than scripted, so the handler cannot hide a surprise read.
- **Live arms.** I traced all three by hand; none was run locally (CI only):
  - **Ordering.** The flag block runs before the enqueue. In the SC-5 arm the flag read therefore sees no row and writes nothing, and the race row only lands after publish read #1.
  - **Isolation.** Each `_drive` calls `asyncio.run`, which runs in a fresh task context, so flags planted in `_LAST_DQ_FLAGS` cannot leak between arms.
  - **Q2.** Its `failed` relies on the flag-only INSERT taking the `pending` default (`supabase/schema/baseline.sql:14752`). The conditional UPDATE matches a `pending` row (it skips only success statuses and `computing` with `metrics_json`).

**Runs at worktree HEAD.** Targeted files only, with `-p no:cacheprovider`:

- `tests/test_sync_trades_store_truth.py`: 37 passed.
- `test_okxtrades_cursor`, `test_mt5_sync_path`, `test_no_contact_support_copy`, `test_daily_pnl_read_verdict` and both censuses: 1042 passed.
- `test_ana_recon_audit`, `test_failed_status_logged`, `test_exchange`, `test_mt5_handover` and `test_job_worker`: 431 passed, 1 skipped.
- `test_sync_trades_preserves_fills`, `test_sync_trades_resume_seed` and the live file: 4 passed, 12 skipped (the live arms skip off CI).

**Decisions not reopened** (locked in CONTEXT, so recorded here and not filed as findings):

- a queued Deribit sync is refused every run;
- a page-capped (truncated) read is refused outright, with no prefix-store allowance;
- a cancelled run loses its flag write;
- the Phase-2 load-failed recovery write still happens when Phase 2 ran;
- a write that raises stays FAILED;
- the T-222-13 residual.

The necessity rubric (`necessity-review.md`) was read; no necessity finding applies.

## Info

### IN-01 (LOW): A venue geo-block reaches `_stamp_429` as a rate limit, because the re-raise carries only static text

**File:** `analytics-service/services/job_worker.py:2268-2272` (`run_sync_trades_job`). Called chain: `services/exchange.py:2328-2332` and `:2389-2402` (`fetch_daily_pnl`), `job_worker.py:1693` (`_stamp_429`), `:1448` (`classify_exception`).

**Issue:**

1. ccxt mis-maps Bybit's non-JSON CloudFront 403 geo-block to `RateLimitExceeded` (documented at `services/geo_block.py:59-62` and `job_worker.py:1438-1447`).
2. `fetch_daily_pnl` swallows it and records only `daily_pnl_fetch_error_class = "RateLimitExceeded"`, so `daily_pnl_read_verdict` reports `rate_limited`.
3. The handler then raises a fresh `ccxt.RateLimitExceeded("sync_trades: daily P&L read was rate limited")`. `is_geo_blocked` cannot see the CloudFront marker in that exception.
4. So `_stamp_429` stamps a phantom cooldown on the key, and `classify_exception` returns `transient` instead of `permanent`.
5. Under a persistent geo-block every post-cooldown attempt raises (DEFERRED refunds an attempt, the raise does not). The job reaches `failed_final`, and the bridge takes branch (b) for `sync_trades`. That kind is protected only under the derive's or ledger-refresh conditions (`supabase/schema/baseline.sql`, the `failed_final` CTE with `is_protected`, around `:12260-12340`).

**Why only LOW:** the derive mirrors this exactly, so the end state on the strategy row is the same as before Phase 251. Its realized-read raise (`job_worker.py:9076-9079`) reaches the same outer `_stamp_429` arm (`:9351-9353`). Before 251 a geo-blocked chain was "sync DONE, then derive phantom-429, then derive `failed_final`, then branch (b)". After 251 the sync fails first and the derive never runs. The raise itself is the locked CONTEXT decision and SC-2. The information needed to tell a geo-block apart is lost in `services/exchange.py`, outside this phase's files.

**Fix (in `services/exchange.py`, benefits both callers):** classify before recording the class, so a geo-block is refused by name rather than treated as a 429:
```python
except Exception as e:
    _record_dq_flag("daily_pnl_fetch_error", True)
    _record_dq_flag(
        "daily_pnl_fetch_error_class",
        "GeoBlocked" if is_geo_blocked(e) else type(e).__name__,
    )
```
`"GeoBlocked"` is not in `DAILY_PNL_RATE_LIMIT_CLASSES` and passes `_DAILY_PNL_ERROR_CLASS_RE`.

### IN-02 (LOW): "Phase 2 ran" is the ingestion flag, so for MT5 with ingestion on the recovery arm and the guessed-payload write still run although Phase 2 never ran

**File:** `analytics-service/services/job_worker.py:2637`, `:2754-2757`, `:2790-2793`

**Issue:**

- **What CONTEXT says.** The Research resolution says the Phase-2 load-failed recovery arm stays "gated on Phase 2 having actually run". The new comment at `:2756` says the `elif phase2_success:` arm is "entered only when Phase 2 RAN".
- **What the code does.** `phase2_success = _RAW_TRADE_INGESTION_ENABLED and not phase2_failed`, and `phase2_ran = phase2_failed or phase2_success`. For an `Mt5Session` with ingestion on, the fills walk is skipped (`:2341`), but `phase2_ran` is True. So:
  - (a) A stored `phase2_fill_ingestion_failed` is cleared and `phase2_recovered_at` is stamped, a recovery that did not happen.
  - (b) After a failed flag read, the `{phase2_fill_ingestion_failed: False, phase2_recovered_at}` payload is upserted. That replaces the whole column, which is exactly the guessed-payload write the new skip exists to prevent.
- **Why only LOW.** This is pre-existing behaviour, and keeping it was a deliberate choice for MT5 (251-01-SUMMARY key-decisions). `USE_RAW_TRADE_INGESTION` defaults to off (`job_worker.py:332-333`). The only new defect is that the comment is false.

**Fix:** make the comment true, or gate on the real condition:
```python
phase2_ran = _RAW_TRADE_INGESTION_ENABLED and not isinstance(ctx.exchange, Mt5Session)
phase2_success = phase2_ran and not phase2_failed
```
Choosing between those two is a scope decision, because it changes MT5 behaviour with ingestion on. If it stays as it is, change `:2756` to say "entered whenever ingestion is on, MT5 included".

### IN-03 (LOW): The live SC-5 arm does not assert that the injected re-read raise fired

**File:** `analytics-service/tests/test_sync_trades_enqueue_failure_bridge_live.py:533` (`test_reread_failure_after_a_zero_row_write_keeps_the_published_row`) and `:255-267` (`_racing_read`)

**Issue:**

- **How the arm passes.** It asserts DONE and that the published row survives. That outcome is also produced by the R2-WR-01 branch: the re-read succeeds and finds the race row.
- **When it would pass vacuously.** If the re-read ever stops going through `db_read_with_retry` (for example, it is moved to `db_execute`), `publish_reads[0]` never reaches 2 and the raise never fires. The re-read then sees the published row, and the arm still passes while the raise arm goes untested.
- **Why only LOW.** The mocked twin pins `rec.publish_reads == 2` and the log sentence (`tests/test_sync_trades_store_truth.py:1000-1023`), so the pair together still bites.

**Fix:** have `_drive` return or expose `publish_reads[0]` (for example through `after_handler["publish_reads"]`). Assert it equals 2 in this arm, plus `caplog` containing "the re-read of the publish state then raised".

### IN-04 (LOW): SC-6: two SC clauses rely on assertions that no recorded RED ever tripped

**File:** `analytics-service/tests/test_sync_trades_store_truth.py:533-557` (`test_refused_read_stores_nothing`) and `:631-648` (`test_refused_non_usd_okx_flag_lands_with_flag_off`); 251-01-SUMMARY PROOF-01 table

**Issue:**

- **No dedicated neuter.** These two clauses have none:
  - SC-2 and SC-4's "holds `last_sync_at`" (`job_worker.py:2924`, `_p_last_sync = None if phase1_read_refused`);
  - SC-2's "never stamps `phase1_daily_pnl_persist_failed`".
- **What the recorded REDs tripped instead.** The pre-fix REDs of both tests stopped at earlier assertions in the same test (`'sync_trades' not in ...`, `assert 0 == 1` on the upsert count). So neither assertion was ever seen failing.
- **Why only LOW.** By inspection they bite: `_p_last_sync` would be `_now_iso` without the refusal term, and `assert advance["p_last_sync_at"] is None` would fail.

**Fix:** add two PROOF-01 rows. First, drop `None if phase1_read_refused else` from `:2924` and run `-k "test_refused_read_stores_nothing and non_usd_okx"`. Second, set `phase1_failed = True` in the refusal branch and run the same arm. Record both REDs.

### IN-05 (LOW): The AST pin only sees literal first arguments and uses a hand-set floor

**File:** `analytics-service/tests/test_sync_trades_store_truth.py:921-947` (`test_every_daily_pnl_flag_exchange_records_is_owned_or_malformed`)

**Issue:** The scan only collects `_record_dq_flag("<literal>", ...)`. Two forms would be skipped silently: a new `daily_pnl_*` key built with an f-string (`_record_dq_flag(f"daily_pnl_truncated_{venue}", True)`), and a key passed through a variable. The new flag would then escape the owned-set check the test exists for. Today every recorder is a literal and only `services/exchange.py` calls `_record_dq_flag` (I checked by grep). `assert len(names) >= 12` is a floor that would need editing by hand.

**Fix:** also fail on any `_record_dq_flag` call whose first argument is not an `ast.Constant`:
```python
non_literal = [n.lineno for n in calls if not isinstance(n.args[0], ast.Constant)]
assert non_literal == [], non_literal
```

### IN-06 (INFO): A refused first sync creates a `pending` `strategy_analytics` row with `computed_at = now()`

**File:** `analytics-service/services/job_worker.py:2805-2813` (`_stamp_phase2_flags`)

**Issue:** RESEARCH Q2 and A4 record this:

- The flag-only upsert INSERTs a row with the column defaults: `pending`, `computed_at = now()` and NULL metrics.
- Readers that gate on `computation_status` are unaffected.
- A reader that treats row existence or `computed_at` as freshness was not enumerated.
- The bridge creates the same shape moments later in the normal chain.

Recorded, not a defect.

**Fix:** none required. If A4 is ever enumerated, cite it here.

### IN-07 (INFO): The Phase-2 failure log still says "(Phase 1 succeeded)"

**File:** `analytics-service/services/job_worker.py:2432-2436`

**Issue:** The sentence `"Raw fill ingestion failed for strategy %s (Phase 1 succeeded): %s"` now also fires after a refused daily read, and after a Phase-1 persist failure (that case is pre-existing). In both cases Phase 1 did not succeed.

**Fix:** drop the parenthetical, or render it from `phase1_read_refused` and `phase1_failed`.

### IN-08 (INFO): With ingestion off, non-owned drained keys reach the row only when an owned key changes

**File:** `analytics-service/services/job_worker.py:2717-2733`

**Issue:** `existing_flags.update(exchange_dq_flags)` merges every drained key, `daily_pnl_malformed_*` included. On the ingestion-off path, though, the upsert only runs when the owned subset changed. So a malformed flag is written if it happens to coincide with a refusal or a clear, and dropped otherwise. `test_clean_read_flag_off_malformed_only_writes_nothing` pins that "today's behaviour" is kept. Whether a non-owned key lands therefore depends on an unrelated owned-key change. The derive owns the malformed key and rebuilds it anyway, so nothing is lost.

**Fix:** none required by the contract. If wanted, merge only owned keys on runs where Phase 2 did not run.

### IN-09 (INFO): The `data_quality_flags` read-modify-write is now live in PROD's ingestion-off configuration

**File:** `analytics-service/services/job_worker.py:2640-2669` and `:2805-2822`

**Issue:** The read-modify-write is pre-existing, and the TOCTOU note at `:2613-2621` records it. Before 251 it ran only with ingestion on, which is off in PROD. It now runs on ccxt syncs whenever the owned set changes. The window is two adjacent round trips, and the write only happens on a refusal or the first clean run after one. A concurrent wholesale writer (the derive pre-stamp or the CSV runner) landing in that window would be overwritten with the sync's stale copy.

**Fix:** none required at this frequency. A conditional jsonb write (`data_quality_flags - owned_keys || drained`) through an RPC would remove the window if it ever matters.

---

_Reviewed: 2026-11-26_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

---

## Silent-failure hunter (round 1, 2026-11-26)

Run in parallel with the code review over the same diff. No CRITICAL, no HIGH, one MEDIUM.

### SFH-M1 (MEDIUM, observability, not user-facing) — booked, not fixed this phase
`run_sync_trades_job`, the `_stamp_phase2_flags` upsert's `except Exception` arm: the upsert is now the only carrier of the daily refusal keys (items 3 and 4) and of `phase1_daily_pnl_persist_failed`, yet its failure is logged at WARNING as "failed to stamp data_quality_flags phase2_*", naming none of the keys lost. A transient write fault on a refused run leaves a held `last_sync_at` with no named reason until the next sync self-heals it. Disposition per the review rule: a non-user-facing MEDIUM gets no fixer round; booked in TODOS.md at ship as `[251-FLAG-WRITE-FAILURE-LOG]` (fix: ERROR or `logger.exception`, say "data_quality_flags", name `phase1_read_refused`, `phase1_failed` and the owned keys written or cleared; outcome unchanged).

### LOW (recorded here only)
- SFH-L1: `_load_existing_flags` uses `db_execute`, not `db_read_with_retry`; a single blip skips a refusal write (logged) or leaves a stale refusal key uncleared (only the load warning).
- SFH-L2: the refusal warning names the reasons but not the sanitized `error_class`.
- SFH-L3: with ingestion ON, a flag-load failure still replaces the whole `data_quality_flags` column (pre-existing Red-team M-conf=8 design; ingestion is off in PROD).
- SFH-L4: a refused first sync creates a `pending` row with `computed_at = now()` (same as IN-06 / RESEARCH A4).
- SFH-L5: read-modify-write race window, Deribit refused every run, re-read DONE recorded only in the log: all locked or rare.
