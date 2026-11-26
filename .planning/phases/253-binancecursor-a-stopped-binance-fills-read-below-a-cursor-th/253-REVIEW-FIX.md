---
phase: 253-binancecursor
fixed_at: 2026-11-26T00:00:00Z
review_path: .planning/phases/253-binancecursor-a-stopped-binance-fills-read-below-a-cursor-th/253-REVIEW.md
iteration: 1
findings_in_scope: 4
fixed: 2
skipped: 2
status: partial
---

# Phase 253: Code Review Fix Report (round 1)

**Fixed at:** 2026-11-26
**Source review:** 253-REVIEW.md (CR-01, WR-01) plus the silent-failure-hunter items SFH-1, SFH-2 (SFH-3 is CR-01)
**Iteration:** 1
**Verification ran in:** the phase worktree `quantalyze-wt-253` (branch `gsd/phase-253-binancecursor`), the main checkout of that branch (no hand-rolled worktree), `python3 -m pytest` from `analytics-service/`, targeted files only.

**Summary:**
- Findings in scope: 4 (CR-01, SFH-1, SFH-2, WR-01)
- Fixed: 2 (CR-01 and SFH-2, one commit, one mechanism). Both are data-integrity logic changes: `fixed: requires human verification`.
- Not changed: 2. SFH-1 (premise not reproducible at HEAD, pinned by a characterisation arm) and WR-01 (measured; behaviour change conflicts with founder-ruled SC-3, left for the founder).

## Fixed Issues

### CR-01 (HIGH) + SFH-2 (MEDIUM): a lost bound write loses the span; a cancelled persist never writes the bound

**Status:** fixed: requires human verification
**Files modified:** `analytics-service/services/job_worker.py` (`run_sync_trades_job`), `analytics-service/tests/test_binancefills_cursor.py`
**Commit:** 35ba4f45c
**Applied fix (one mechanism closes both):**
- `run_sync_trades_job` now writes the bound right after the read returns and BEFORE the Phase 1 and fills persists (new block after the `finally: aclose_exchange`; the stop-record derivation `_fills_incomplete`/`_read_through`/`_fills_stopped` moved up unchanged to feed it; `_walk_start_ms`, `_covers_from_iso`, `_earliest_through()`, `_set_bound(unread_ms, covers_iso)` are defined there and reused by the epilogue). The early write passes `p_covers_from = None`.
- If the early write raises, the stop is unrecorded and nothing has moved yet, so the run discards its fills (`raw_fills = []`) and counts as a failed Phase 2 (`phase2_failed`, `phase2_error` names `re-read bound write failed (<ExcClass>)`). That reuses the raised-read path: a NULL column keeps its bootstrap anchor (`fills_anchor_iso` is stamped on a failed Phase 2), a set column keeps its seed because no fill moved the stored high-water, and `phase2_failed` blocks the D-09 clear of `binance_stop_below_cursor`.
- The epilogue write keeps the real covers and is the only clearing arm. Its failure no longer sets `_p_last_fetched = None` (that line threw the anchor away; the reviewer showed it never protects anything).
- An orphan answer (FALSE) from the early write is left to the epilogue write, which logs it (one orphan WARNING per run, as before).

**Claim verified against `supabase/migrations/20261126140000_strategy_fills_reread_bound.sql` (two writes compose):**
- Early write, covers NULL: `v_covers := p_covers_from IS NOT NULL AND ...` is FALSE, so the RPC takes R1 (insert), R2 (replace on a re-point) or R5 (`LEAST(stored, new)`). It can never reach R4 (forward move) or R6 (clear), so it can only LOWER a stored bound.
- Epilogue write: stored bound is now `LEAST(old, U)`. With covers set it takes R4 (`unread_from := U`, same instant or earlier) or R5 (`LEAST`, same instant); both are idempotent against the early write. Only the epilogue passes `p_unread_from = NULL`, and it does so only when the early block did not fire (the epilogue's complete-through instants are a superset of the early ones: `phase2_failed` can only add).
- Why covers NULL and not "the run's covers-from" as the brief suggested for SFH-1: with covers set the early write could take R4 and move a stored bound FORWARD before anything is persisted; a cancel in the persist would then leave the bound past fills that were read but not stored. Pinned by `test_sfh2_the_early_write_never_advances_a_stored_bound` (neuter R1-P3).

**Tests (all in `analytics-service/tests/test_binancefills_cursor.py`):**
- `TestFailedBoundWriteStillRereadsTheSpan::test_cr01_a_null_column_run_whose_bound_write_fails_is_reread_by_the_next_run` and `..._a_set_column_run_...`: two real runs through one shared flag dict and one bound store; run 1's bound RPC raises; run 2 asserts its WALK START `<= ` run 1's unread start (outcome, not stamp). The set-column arm also asserts run 2's clean read clears the flag.
- `TestEarlyBoundWrite::test_sfh2_a_persist_cancelled_by_the_handler_timeout_still_leaves_the_bound`: 100 healthy fills persist, the second batch raises `asyncio.CancelledError`; the bound row must exist, and run 2's walk start must be at or before the stop.
- `TestEarlyBoundWrite::test_sfh2_the_early_write_never_advances_a_stored_bound`.
- Existing arms adapted: the stop/partial/raised arms now see two RPC calls per run (early + epilogue); `calls[0]` readers became `calls[-1]`, counts became 2, the D-03 arm checks every call. `test_a_failed_bound_write_on_an_incomplete_read_is_loud_and_holds_the_stamp` keeps its assertions and gains `rec.upserted_batches == []`; the module docstring marks neuter P5 superseded.

**RED on pre-fix code (PROOF-01).** Pre-fix `job_worker.py` (HEAD of review, byte backup `scratchpad/253/r1fix/job_worker.py.orig`) copied in with `cp`, `cmp` clean, then restored with `cp` from `job_worker.py.fixed` and `cmp` clean:

```
E  AssertionError: run 2 must walk from at or before the unread start; pre-fix it seeds at the moved daily high-water 2026-07-14
E  assert 1783983600000 <= 1778198400000
E  AssertionError: run 2 must walk from at or before the stop; pre-fix it seeds at the healthy ETHUSDT fill (1780477200000)
E  assert 1780473600000 <= 1780390800000
E  AssertionError: the bound is written before the persist, so a cancelled run leaves it
E  assert {} == {'strat-232-cursor': ('key-1', '2026-06-02T09:00:00+00:00')}
FAILED ...::TestFailedBoundWriteStillRereadsTheSpan::test_cr01_a_null_column_run_whose_bound_write_fails_is_reread_by_the_next_run
FAILED ...::TestFailedBoundWriteStillRereadsTheSpan::test_cr01_a_set_column_run_whose_bound_write_fails_is_reread_by_the_next_run
FAILED ...::TestEarlyBoundWrite::test_sfh2_a_persist_cancelled_by_the_handler_timeout_still_leaves_the_bound
3 failed, 2 passed, 57 deselected
```
(the 2 that pass pre-fix are the never-advances guard and the SFH-1 characterisation.)

**Neuters on the fixed code, each restored with `cp` and `cmp`:**
- R1-P1 (early-write failure no longer discards fills / sets `phase2_failed`): set-column CR-01 arm RED, 1 failed 4 passed.
- R1-P2 (delete the early write call): set-column CR-01 arm and the CancelledError arm RED, 2 failed 3 passed.
- R1-P3 (early write sends the real covers): never-advances arm RED, 1 failed 4 passed.
- R1-P4 (re-add `_p_last_fetched = None` in the epilogue except): NULL-column CR-01 arm RED, 1 failed 4 passed.

**GREEN:** `python3 -m pytest tests/test_binancefills_cursor.py tests/test_okxtrades_cursor.py tests/test_binance_sync_flags.py tests/test_stamp_io_exhaustive.py -q` gives `282 passed`. Also green: `test_binancefills_e2e.py`, `test_sync_trades_preserves_fills.py`, `test_sync_trades_resume_seed.py`, `test_mt5_sync_path.py`, `test_fetch_trades_resume_seed.py`, `test_sync_trades_enqueue_failure_bridge_live.py` (48 passed, 9 skipped). CI mypy command from the `python` job (`mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`): `Success: no issues found in 145 source files`, before and after.

**One commit for two findings, deliberately:** CR-01's fail-closed behaviour rests on the early write, and SFH-2 is that early write. Splitting them would commit a CR-01 fix that does not work.

**Open (honest limits):**
- A double fault is not covered: the fills persist fails part-way (`phase2_failed` after persist) AND the epilogue bound write also fails on a SET column. The stored high-water has moved and no bound names the span. The signal (`phase2_fill_ingestion_failed` plus `binance_stop_below_cursor`, an ERROR log) stays because `phase2_failed` blocks the clear. A NULL column is protected by the kept anchor.
- While the bound RPC is down every Binance run that stops, fails a symbol or raises discards its fills (over-fetch, nothing lost, flagged `phase2_fill_ingestion_failed`). That is the fail-closed cost.
- The epilogue's ERROR text ("may not be re-read") over-claims when the early write already recorded the bound. Left as is: loud rather than quiet.

## Not changed

### SFH-1 (MEDIUM): `except ccxt.RateLimitExceeded` skips the epilogue bound write

**Status:** skipped: premise not reproducible at HEAD. Pinned by a characterisation arm instead.
**File:** `analytics-service/services/job_worker.py` `run_sync_trades_job`, the Phase-2 `except ccxt.RateLimitExceeded: ...; raise` and the outer handler.
**Measurement:** a 429 out of `fetch_raw_trades` re-raises out of the function BEFORE the Phase 1 `sync_trades` persist (which sits after the `try`/`finally`), before any fill is stored and before any cursor write. `fetch_raw_trades` itself only reads (`supabase` is passed for symbol discovery). So the run moves no state, the retry seeds exactly as this run did, and there is no span a bound would have to name. The brief's "if Phase 1 moved the daily high-water" does not occur on this path. Writing a bound before the re-raise would only add a write for a read that stored nothing.
**Pin:** `TestEarlyBoundWrite::test_sfh1_a_raised_429_moves_nothing_so_no_bound_is_owed` asserts, with a daily row in hand, that no `sync_trades`, `advance_sync_cursor` or bound RPC ran and no fill was stored. It passes pre-fix and post-fix by design (a characterisation, not a neuter); it goes RED if a future change persists anything before that re-raise, at which point the early write must cover the raise too.
**Note:** the related real window (a cancel or process death AFTER Phase 1 persisted a daily row and before the epilogue anchor, on a NULL column with a stop) is closed by the early write, because it sits before the Phase 1 persist.

### WR-01 (MEDIUM, user-facing): the carry keeps traded-symbol lists on the anon-readable `data_quality_flags`

**Status:** not changed. Stopped per the decision rule; needs a founder decision.
**Measurement (grep -a, schema and git at base `c57961a54`):**
1. The exposure PRE-EXISTS, and this phase only lengthens it. At the base the sync epilogue already merges the drained flags into the row (`existing_flags.update(exchange_dq_flags)` then the `strategy_analytics` upsert, `job_worker.py` line 2829 at `c57961a54`). `binance_partial_symbols` has been written there since `de1e31fe0` (2026-05-17); Phase 250 (`c57961a54`, merged) added `binance_page_cap_symbols`, `binance_untimed_page_symbols`, `binance_deadline_symbols`, `binance_unlisted_symbols` and `binance_read_through_ms` the same way. Related precedent in the same column: `fee_currency_mismatch_samples` and `unknown_trade_side_samples` hold `exchange:symbol:...` strings. The chained derive's wholesale `_prestamp_flags` (`{"csv_source": True, ...}` at base) then erased them, so the old window was minutes; the carry makes it "until the next clean sync".
2. The traded symbols are NOT anon-readable anywhere else that I could find. `strategy_analytics` carries `GRANT SELECT ... TO anon` and `analytics_read` admits any caller for a `published` strategy (`supabase/schema/baseline.sql`, policy and grants blocks), so direct PostgREST access to `data_quality_flags` works whatever the factsheet page renders (the page itself reads only specific keys such as `native_unit`). `trades` and `positions` are owner-only (`trades_read`, `positions_read`, G12.D.1). `strategies.markets` is the closed set `Futures`/`Spot` (`src/lib/constants.ts` `MARKETS`). The position and exposure writers put `symbol` only into `positions` rows; `trade_metrics`, `exposure_metrics` and `volume_metrics` are aggregates. I did not audit every key of `metrics_json`. The repo's own precedent keeps per-key read-incomplete markers off this column for exactly this reason (`_record_read_incomplete`, `_record_nav_mark_refusal` write to the owner-only `allocator_equity_derived`).
**Outcome:** rule branch 2: do NOT change behaviour, report. Removing the list conflicts with founder-booked ROADMAP SC-3 (`binance_deadline_symbols` itself must survive the derive and the CSV rebuild) and with the Phase 250 quiet-prefix exception that reads it.
**Options for the founder (none applied):**
- A. Accept: the lists were already public for minutes per sync; now they stay public until the next clean sync. Dormant while `USE_RAW_TRADE_INGESTION` is off.
- B. Narrow the carry: keep `binance_deadline_symbols` (SC-3) and drop or count the other four lists (`binance_*_symbol_count: int`), keep `binance_read_through_ms` or drop it. Smallest change that still meets SC-3 literally.
- C. Move the lists to an owner-only home (`allocator_equity_derived` precedent) and carry only booleans and counts on the public row; larger, touches the quiet-prefix reader.

## Round-1 items not in scope here

IN-01 to IN-09 (LOW/INFO) are recorded in 253-REVIEW.md only and are never fixed or booked.

---

_Fixed: 2026-11-26_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_

## WR-01 orchestrator decision (2026-11-26)

Option A, behaviour unchanged. The exposure class (symbol strings in the anon-readable `data_quality_flags`) predates this phase (`binance_partial_symbols` since 2026-05-17, plus the `*_samples` keys). A minutes-long public window can be polled just as well, so lengthening it is not a new exposure. The only fix that removes it, moving the lists off the public row, conflicts with founder-booked SC-3 (`binance_deadline_symbols` must survive). Routed as `TODOS.md` `[253-BINANCE-SYMBOLS-ON-PUBLIC-FLAGS]`, owned by the phase that turns the Binance switch on. It is surfaced to the founder in the phase report.

---

# Round 2

**Fixed at:** 2026-11-26
**Source review:** 253-REVIEW-R2.md (CR-02, CR-03, WR-02, IN-10 to IN-12) plus the silent-failure-hunter items SFH-R2-M1 (a complete read cancelled mid-persist writes no bound) and SFH-R2-M2 (= IN-11, an orphan answer is ignored)
**Iteration:** 2
**Verification ran in:** the phase worktree `quantalyze-wt-253` (branch `gsd/phase-253-binancecursor`), the main checkout of that branch (no hand-rolled worktree). `python3 -m pytest` from `analytics-service/`, targeted files only; `npx vitest run` on the four census files the merge touched; no Docker.

**Summary:**
- In scope: CR-02, CR-03, SFH-R2-M1, SFH-R2-M2/IN-11 (one mechanism, one commit), WR-02 (routed, not fixed), the switch comment.
- Fixed: CR-02, CR-03, SFH-R2-M1, SFH-R2-M2. All are data-integrity logic changes: `fixed: requires human verification`.
- Routed: WR-02 as `TODOS.md` `[253-NULL-COLUMN-ANCHOR-ALL-VENUES]` (commit `87b28a5f3`).
- Not changed: IN-10 (LOW, recorded in 253-REVIEW-R2.md only; never fixed or booked), IN-12 (guarded: resolved as the review describes, see the merge below).

## Step 1: the merge with origin/main

`git merge origin/main` at `9c26bf3f7` (v0.133.91.0): merge commit **`c0327b2b3`** (no rebase, no trailers). Conflicts and how they were resolved:

- `analytics-service/services/job_worker.py`, hunk 1 (Phase 251 moved the Phase-1 persist): kept 253's moved stop-record block and early write, took main's placement (the persist lives in the ccxt arm, inside the outer `try`, ahead of the balance read and the fills walk), dropped HEAD's old after-the-`finally` persist block (keeping it would persist the daily rows twice).
- Hunk 2 (IN-12): kept `elif binance_flags_cleared`, dropped HEAD's `else: write_needed = False` (Phase 251 made `write_needed` accumulate-only). `test_sync_trades_store_truth.py` is GREEN on the merge.
- Migration stamp: **Phase 230 took `20261126140000`** (`20261126140000_mt5_terminal_lease.sql`) while this branch was open, a same-version collision (`down/20261126140000-rollback.sql` was an add/add conflict). 253's migration, rollback, function snapshot, gate (`supabase/tests/test_strategy_fills_reread_bound.sql`, including every `RED-UNDER-M` file path), `_binance_fills.py` docstring and `job_worker.py` comment moved to **`20261126150000`**. Main's rollback kept as main's. `20261126150000` is later than every migration on `origin/main` (the latest there is `20261126140000`). The migration body is byte-identical apart from the stamp in comments.
- Gate census conflicts (Phase 230 and Phase 253 each added one gate file): `scripts/mutation-floors.mjs`, `scripts/baseline-content-drift-check.mjs`, `scripts/dump-sql-functions.ts` (the `snapshot-only` row for `set_strategy_fills_reread_bound` kept beside Phase 230's three), and the four `src/__tests__` census files were merged ADDITIVELY: `FILES_FLOOR` 96, `ARMS_FLOOR` 1065, `COMPARED_FLOOR` 148, `stepsSeen` 1216, lint scan 123, annotated files 96. MEASURED on the merged tree, not derived: `node scripts/mutation-runner/run.mjs --parse-only` printed `coverage: files 96/123`, `arms: 0/1065/0`, `No static defects`; `node scripts/lint-sql-gates.mjs` printed `scanned 123 file(s); 0 finding(s)`; `node scripts/baseline-content-drift-check.mjs` printed `functions compared 148`. `npx vitest run` on `mutation-annotation-parser`, `mutation-runner-floors`, `lint-sql-gates` and `gate-family-meta`: 4 files, 336 tests passed (a second run of `gate-family-meta` after the lineage-note commit `9da3ac376`: 21 passed). The CI `sql-mutation` FULL run is still the measurement of the merged corpus's biting count (`1065` is the static annotated count).
- After the merge, before any fix: the targeted Python files gave 318 passed and 1 failed, the failure being the round-1 SFH-1 characterisation arm (`test_sfh1_a_raised_429_moves_nothing_so_no_bound_is_owed`), exactly as REVIEW-R2 predicted.

## CR-02 + CR-03 + SFH-R2-M1 + SFH-R2-M2 (HIGH, HIGH, MEDIUM, INFO): one provisional bound before anything can move

**Status:** fixed: requires human verification
**Files modified:** `analytics-service/services/job_worker.py` (`run_sync_trades_job`), `analytics-service/tests/test_binancefills_cursor.py`
**Commit:** `4ff124dee`

**Applied fix:**
- The Phase-2 seed derivation (cursor, stored-fill high-water, the Phase 253 bound term, the NULL-column anchor) moved, unchanged, into the ccxt arm, directly after the `phase1_verdict.rate_limited` re-raise and BEFORE the Phase 251 daily store (`elif phase1_verdict.reasons` became `if`). It reads only values that are the same before and after the store (`daily_since_ms` is the in-memory pre-store value; the fills high-water is `is_fill` rows the daily store does not touch).
- Right after the seed, `_set_bound(seed, None)` writes a PROVISIONAL bound: `p_unread_from = fills_since_ms`, or `_reach_anchor_ms` when the walk starts at the reach; `p_covers_from = None`. It can only insert, replace or lower (RPC R1, R2, R5) and never reaches R4 or R6.
- The post-read early write is DELETED (subsumed). The epilogue write is unchanged: real covers and the run's real complete-through instant.
- A failed provisional write: ERROR, `phase2_failed = True`, `phase2_error` names `re-read bound write failed (<ExcClass>)`, the fills read is skipped (`_fills_read_skipped`; `fetch_raw_trades` is never called, nothing is stored). Phase 1's daily store still runs. A NULL column keeps its bootstrap anchor through the existing epilogue arm.
- An orphan (FALSE) answer: `worker_orphan_write_blocked` WARNING, the read is skipped, `phase2_failed` is NOT set, and `_binance_read` is reset to False so the epilogue neither clears the stored `binance_*` flags nor writes a second bound. `phase2_success` and the D-09 clear are additionally gated on `not _fills_read_skipped`, so a skipped read never reads as a clean one (the self-heal would otherwise stamp `phase2_recovered_at`).
- Comments corrected: the "before the Phase 1 and fills persists" and "BEFORE anything is persisted" claims are gone, the epilogue's ERROR text no longer says the span "may not be re-read" when the provisional row landed, and `_RAW_TRADE_INGESTION_ENABLED`'s T-250-19 paragraph now says what the fix does (the loud stall repeats; on a column set ahead of the stored fills it was silent loss before round 2). The switch stays OFF.

**Checked against the RPC table (`bound_after_set` mirror, SQL gate unchanged):**
- Stored row none: provisional R1 inserts the seed S. Epilogue covers = walk start = S - overlap, which is at or before S: R4 sets the run's instant U' (stop, failed symbol) or R6 deletes it (complete read). A walk from the reach sends covers `-infinity`: same outcomes.
- Stored row same key B: the seed was already lowered to B, so S = B and R5 is a no-op; the epilogue reaches R4 or R6 the same way. Other key: R2 replaces, then R4/R6.
- A cancel, a 429 or a death anywhere after the write leaves S. The next seed is the minimum of the column, the stored fills and S, so run 2's walk start equals run 1's.
- ⛔ Why the seed and not `walk_start - 1`: the epilogue's covers is the walk start, and `walk_start <= walk_start - 1` is false, so the row would fall to R5/R7 and never advance or clear. The R2-P2 neuter below proves it.
- Cost, stated: every Binance run now makes two bound RPC calls (provisional, epilogue) and the row is inserted and deleted per run instead of only on a stop. Dormant while the switch is off.

**Tests (all in `analytics-service/tests/test_binancefills_cursor.py`, class `TestProvisionalBoundBeforeTheRead`; each arm is a TWO-RUN outcome whose run-2 store carries what run 1 left: persisted fills, the moved daily row, the column through `column_after_advance`):**
- `test_cr02_a_null_column_run_raised_or_cancelled_after_the_daily_store_is_reread[429|cancel]` replaces the round-1 SFH-1 pin: NULL column, a daily row stored, then the fills read raises `RateLimitExceeded` or `CancelledError`; run 2's walk start is at or before run 1's; the provisional write precedes `sync_trades`.
- `test_cr03_a_stopped_read_cancelled_mid_persist_on_a_column_ahead_is_reread`: column ahead, BTC capped, batch 1 stores 100 ETH fills, batch 2 (a SOL fill below the stop minus the overlap) is cancelled.
- `test_cr03_a_complete_read_cancelled_mid_persist_on_a_column_ahead_is_reread`: the complete-read case (no sibling step).
- `test_in11_an_orphaned_run_stores_no_fill_and_the_next_run_rereads_the_span`: ahead column, stopped read, newer healthy fill, orphan FALSE; stored flags unchanged.
- `test_a_failed_provisional_write_skips_the_read_and_stores_nothing`, `test_a_clean_run_clears_the_provisional_bound_it_wrote`, `test_the_provisional_write_never_advances_a_stored_bound`, `test_an_epilogue_orphan_after_a_landed_provisional_write_is_logged_once`.
- Existing arms re-pinned (legitimately RED after the change): the call lists now carry the provisional value first (seed or reach) then the epilogue's; the per-run RPC counts stay 2; the failed-write arm sees two ERRORs and `fetch_raw` is never called; the orphan arm asserts nothing was read or stored and no `phase2_*` stamp; the round-1 never-advances and SFH-2 arms were rewritten into the round-2 arms above (the round-1 CR-01 two-run arms are unchanged and GREEN).

**RED on the pre-fix (post-merge) code, R2-P0.** The committed post-merge `job_worker.py` (byte backup `scratchpad/253/r2fix/job_worker.postmerge.py`, `cmp` against `git show HEAD:` clean) copied in with `cp`, `cmp` clean, then the fixed file restored with `cp` and `cmp` clean:

```
E  AssertionError: run 2 must walk from run 1's walk start; pre-fix it seeds at the moved daily high-water 2026-07-14
E  assert 1783983600000 <= (1778112000000 - 3600000)                  (429 and cancel, both)
E  AssertionError: run 2 must walk from at or before the unstored SOLUSDT fill; pre-fix it walks from the stop minus the overlap (2026-06-02T08:00Z)
E  assert 1780387200000 <= 1780344000000
E  AssertionError: run 2 must walk from at or before the unstored BTCUSDT fill; pre-fix it seeds at the stored ETHUSDT fills (2026-06-10)
E  assert 1781078400000 <= 1780358400000
E  AssertionError: run 2 must walk from the stored fill minus the overlap; pre-fix the orphaned run stored the healthy ETHUSDT fill and run 2 seeded past the stop
E  assert 1780473600000 <= (1780304400000 - 3600000)
E  assert [None] == ['2026-06-01T...+00:00', None]                     (clear arm: no provisional write)
9 failed, 59 deselected      (the nine arms of TestProvisionalBoundBeforeTheRead)
```

**Neuters on the fixed code, each restored with `cp` and `cmp` clean** (`-k "TestProvisionalBoundBeforeTheRead or TestFailedBoundWriteStillRereadsTheSpan"`):
- R2-P1 delete the provisional write call: 10 failed, 1 passed (every round-2 arm and the round-1 set-column CR-01 arm).
- R2-P2 write the walk start minus 1 ms instead of the seed: 5 failed (both CR-02 arms, the clear arm, the never-advances arm, the epilogue-orphan arm), 6 passed.
- R2-P3 ignore the orphan answer: 1 failed (`test_in11_...`), 10 passed.
- R2-P4 let a failed provisional write fall through to the read: 2 failed (the failed-write arm and the round-1 set-column CR-01 arm), 9 passed.

**GREEN:** `python3 -m pytest tests/test_binancefills_cursor.py tests/test_okxtrades_cursor.py tests/test_binance_sync_flags.py tests/test_stamp_io_exhaustive.py tests/test_sync_trades_store_truth.py tests/test_sync_trades_preserves_fills.py tests/test_sync_trades_resume_seed.py tests/test_binancefills_e2e.py tests/test_sync_trades_enqueue_failure_bridge_live.py tests/test_job_worker.py tests/test_mt5_sync_path.py tests/test_fetch_trades_resume_seed.py tests/test_derive_broker_dailies_dualmode.py tests/test_csv_analytics_runner.py` gave `726 passed, 13 skipped`. CI `python`-job mypy (`mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`): `Success: no issues found in 146 source files`. `ruff check` reports 5 findings in `job_worker.py`, all pre-existing (identical on the post-merge backup).

## WR-02 (MEDIUM, cross-phase): routed, not fixed

**Status:** routed. `TODOS.md` `[253-NULL-COLUMN-ANCHOR-ALL-VENUES]` in `## 🟡 FIX MID-TERM` (commit `87b28a5f3`; owner: a Phase 251 follow-up; trigger: before `USE_RAW_TRADE_INGESTION` turns on for any further venue). Re-measured on the Phase 253 merge with the OKX probe: run 2 `since_ms` 1783987200000 against the old seed 1778112000000 (still open for OKX, Bybit and Deribit; Binance is closed by this round).
**Switch state (measured, `grep -a`, 2026-11-26):** `USE_RAW_TRADE_INGESTION` defaults to `false` (`_RAW_TRADE_INGESTION_ENABLED = os.environ.get("USE_RAW_TRADE_INGESTION", "false").lower() == "true"`, `job_worker.py`). No tracked config, Dockerfile, workflow or env example sets it for any venue; only tests and comments mention it. The Railway worker environment was NOT read, so a founder-set `true` there is unmeasured. Everything in this round is dormant while it is off.

## Open (honest limits, none fixed here)

- **Phase 251's daily store still runs on both failure branches** (a failed provisional write, an orphan answer). The daily-high-water leg is then unprotected if that run is also cancelled, or the job is orphaned, or the column is set with no stored fill (the seed is then the daily high-water). Skipping the store would break Phase 251's behaviour; not done. An orphaned worker's unfenced `sync_trades` store can therefore still move the daily high-water the re-claiming worker seeds from (reachability near nil, IN-11).
- **A set column while the bound RPC is down** keeps its seed only because no fill moved; a sibling strategy advancing the shared column in the same window is the D-01 class and the bound cannot name it (the bound is the only carrier). Over-fetch otherwise.
- **A failed epilogue write on a stop run** leaves the provisional row at the seed: the span is re-read (more than needed), the flag `binance_stop_below_cursor` is raised and an ERROR logged; a failed clear on a complete run over-fetches once.
- **Cost:** two bound RPC calls and one insert plus one delete per Binance run when the switch is on.
- **IN-10** (a discarded read keeps its `binance_*` lists on the early-failure path) no longer exists as such: the failed-write path now never reads, so there is no read to keep flags from. Left as a LOW record.
- The gate arms count (`1065`) is the static annotated count; the CI `sql-mutation` FULL run is the real biting measurement.

---

_Fixed: 2026-11-26_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 2_

---

# Round 3

**Fixed at:** 2026-11-26
**Source review:** 253-REVIEW-R3.md (WR-03, the WR-02 scope evidence, IN-13 to IN-17) plus the silent-failure-hunter orphan item (= IN-14)
**Iteration:** 3
**Verification ran in:** the phase worktree `quantalyze-wt-253` (branch `gsd/phase-253-binancecursor`), the main checkout of that branch (no hand-rolled worktree). `python3 -m pytest` from `analytics-service/`, targeted files only; the CI `python`-job mypy command; no Docker, no full suite.

**Summary:**
- Fixed: WR-03, IN-14 (= the SFH-R3 orphan item), IN-15, and IN-13 (pinned, the code already had the term). All are data-integrity logic changes: `fixed: requires human verification`. One commit, one mechanism: `6d0a48a7a`.
- Routed: WR-02's wider scope, `TODOS.md` `[253-NULL-COLUMN-ANCHOR-ALL-VENUES]` (commit `7344ebe77`).
- Not changed: IN-16, IN-17 (comment-only, and I did not touch those lines; the migration is not edited).

## WR-03 + IN-14 + IN-15 (MEDIUM, LOW, LOW): a run with no recorded bound moves no seed term

**Status:** fixed: requires human verification
**Files modified:** `analytics-service/services/job_worker.py` (`run_sync_trades_job`), `analytics-service/tests/test_binancefills_cursor.py`, `analytics-service/tests/test_okxtrades_cursor.py` (one additive `_run_job(balance_error=...)` parameter, default None)
**Commit:** `6d0a48a7a`

**Applied fix (`run_sync_trades_job`, Binance branches that 253 added, all inside `if _binance_read and _reach_anchor_ms is not None` under `_RAW_TRADE_INGESTION_ENABLED`):**
- When the provisional bound write raises, or answers FALSE (orphan), the branch also sets `phase1_read_refused = True`. That is the hold a refused daily read already has: the `elif trades` store is now `elif trades and not phase1_read_refused`, so `sync_trades` is not called, `trade_count` is 0 and `last_sync_at` is held (`_p_last_sync = None`). Nothing in that run moves the daily high-water.
- Orphan only: a new `_bound_orphaned` flag removes the Phase-251 daily-read term from `needs_flag_write` (`phase1_read_ran and not _bound_orphaned`). That was the same unfenced `strategy_analytics` upsert (it pops stale owned `daily_pnl_*` keys), not a separate write, so it is skipped by narrowing the one gate.
- Loud signals kept: the ERROR log (its text now says the daily store is held too), `phase2_failed` and `phase2_fill_ingestion_failed` on the failed-write branch, the `worker_orphan_write_blocked` WARNING (text now says no daily rows are stored). The held store has its own signal on the failed-write branch: `phase2_fill_ingestion_failed` stays set (it blocks the D-09 clear), so the run cannot look clean; on an orphan the re-claiming worker owns the strategy and the WARNING is the signal.
- IN-13: `phase2_success` already carried `not _fills_read_skipped` (round 2); the gap was that nothing pinned it. The orphan arm now seeds a stale `phase2_fill_ingestion_failed` and asserts it survives (neuter R3-P4 proves it goes RED).
- IN-15 falls out of the same hold: with the daily store held, a 429 or cancel after the (failed) provisional write moves nothing, NULL column included.
- IN-16 and IN-17 comments not touched (I did not edit those lines; the migration was off limits).

**Cost, stated:** while the bound RPC is down (or the function is missing) every Binance run with the switch on holds its daily `sync_trades` store, so daily P&L for that strategy stops advancing and the strategy shows `phase2_fill_ingestion_failed`. That is the fail-closed price the reviewer's fix named (hold the store "the way a refused daily read holds it"). It is dormant while `USE_RAW_TRADE_INGESTION` is off.

**Non-Binance paths unchanged (proof):**
- Every new assignment sits in the two failure branches of the provisional write, which only run for `ctx.key_row["exchange"] == "binance"` with the switch on.
- `elif trades:` became `elif trades and not phase1_read_refused`. It is the `else` of `if phase1_verdict.reasons:`, and `phase1_read_refused` is set True only in that arm or the two new branches, so on every non-Binance run it is False there and the condition is identical.
- `needs_flag_write` differs only through `_bound_orphaned`, which is False unless the Binance orphan branch ran.
- Measured: `test_okxtrades_cursor.py`, `test_sync_trades_store_truth.py`, `test_sync_trades_preserves_fills.py`, `test_sync_trades_resume_seed.py`, `test_mt5_sync_path.py` unchanged and green (below). Binance runs whose provisional write succeeds do not enter either branch.

**Tests (`tests/test_binancefills_cursor.py`, class `TestHeldDailyStoreWhenNoBoundIsRecorded`; each is a TWO-RUN outcome whose run-2 store holds exactly what run 1 left, the daily row only if run 1 actually called `sync_trades`):**
- `test_wr03_a_set_column_with_no_stored_fill_keeps_its_span_when_the_bound_rpc_is_down`: the promoted r3 probe. Column 2026-06-20, no stored fill, both RPC calls fail, a daily row for 2026-06-10: run 2 walk start at or before run 1's (2026-05-07 minus the overlap), `sync_trades` not called, the flag kept.
- `test_in14_an_orphaned_run_stores_no_daily_row_and_run_two_seeds_unchanged`: orphan answer, no `sync_trades`, stored flags (a stale `phase2_fill_ingestion_failed` and a stale owned `daily_pnl_unsupported_venue`) unchanged, no strategy-flags upsert, run 2 seeds where run 1 did. Covers IN-13.
- `test_in15_a_null_column_run_with_a_failed_bound_write_then_a_429_or_cancel_is_reread[429|cancel]`: NULL column, bound RPC down, the balance read raises (after Phase 1's store, before the walk); run 2 walks from at or before run 1's seed.
- `test_a_failed_provisional_write_skips_the_read_and_stores_nothing` was re-pinned (it asserted the daily store ran): now asserts no `sync_trades`, `trade_count == 0`, `p_last_sync_at` None.

**RED on the pre-fix code (R3-P0).** The committed `job_worker.py` at HEAD `022d90cea` (byte backup `scratchpad/253/r4fix/job_worker.py.head`, `cmp` clean) copied in with `cp`, then the fixed file restored with `cp` and `cmp` clean:

```
E  assert 1781046000000 <= (1778112000000 - 3600000)       (WR-03 set-column arm)
E  AssertionError: run 2 must walk from run 1's walk start; pre-fix Phase 1's store moved the daily high-water to 2026-06-10 and the span before it was never read
E  AssertionError: assert 'sync_trades' not in ['set_strategy_fills_reread_bound', 'sync_trades', 'advance_sync_cursor', 'enqueue_compute_job']   (IN-14 orphan arm)
E  assert 1781046000000 <= (1778112000000 - 3600000)       (IN-15 [429] and [cancel])
E  AssertionError: run 2 must walk from run 1's walk start; pre-fix the daily store moved the high-water to 2026-06-10 and no anchor was written
FAILED ...::TestProvisionalBoundBeforeTheRead::test_a_failed_provisional_write_skips_the_read_and_stores_nothing
FAILED ...::TestHeldDailyStoreWhenNoBoundIsRecorded::test_wr03_a_set_column_with_no_stored_fill_keeps_its_span_when_the_bound_rpc_is_down
FAILED ...::TestHeldDailyStoreWhenNoBoundIsRecorded::test_in14_an_orphaned_run_stores_no_daily_row_and_run_two_seeds_unchanged
FAILED ...::TestHeldDailyStoreWhenNoBoundIsRecorded::test_in15_a_null_column_run_with_a_failed_bound_write_then_a_429_or_cancel_is_reread[429]
FAILED ...::TestHeldDailyStoreWhenNoBoundIsRecorded::test_in15_a_null_column_run_with_a_failed_bound_write_then_a_429_or_cancel_is_reread[cancel]
5 failed, 67 deselected
```

**Neuters on the fixed code, each restored with `cp` and `cmp` clean** (`-k "TestHeldDailyStoreWhenNoBoundIsRecorded or test_a_failed_provisional_write_skips_the_read_and_stores_nothing"`):
- R3-P1 drop the hold on the failed-write branch: 4 failed, 1 passed (the set-column arm, both NULL-column arms, the re-pinned failed-write arm).
- R3-P2 drop the hold on the orphan branch: 1 failed, 4 passed (the orphan arm).
- R3-P3 drop the orphan's flag-write skip: 1 failed, 4 passed (`assert {'phase2_erro...failed': True} == {'daily_pnl_u...failed': True}`: the stale owned key was popped).
- R3-P4 `phase2_success` ignores `_fills_read_skipped` (the reviewer's N5): 1 failed, 4 passed (`assert {'phase2_reco...': ...} == {...}`: the stale failure was cleared and `phase2_recovered_at` stamped). IN-13 is now pinned.

**GREEN:** `python3 -m pytest tests/test_binancefills_cursor.py tests/test_okxtrades_cursor.py tests/test_sync_trades_store_truth.py tests/test_binance_sync_flags.py tests/test_stamp_io_exhaustive.py tests/test_binancefills_e2e.py tests/test_sync_trades_preserves_fills.py tests/test_sync_trades_resume_seed.py tests/test_mt5_sync_path.py -q` gave `372 passed, 2 skipped`. `test_binancefills_cursor.py` alone: `72 passed`. CI `python`-job mypy (`mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`): `Success: no issues found in 146 source files`. `ruff` is not installed here, so it was not run.

## WR-02 scope (MEDIUM, cross-phase): routed, widened

**Status:** routed. `TODOS.md` `[253-NULL-COLUMN-ANCHOR-ALL-VENUES]` (commit `7344ebe77`) now covers the set-column / no-stored-fill case on a 429, a cancel and a plain raised read, for OKX, Bybit and Deribit, with the REVIEW-R3 measurements. The plain-raised-read variant is recorded as pre-dating Phase 251 (Phase 232's set-column seed class; base `c57961a54`); only the 429 and cancel variants are Phase 251's ordering. The owner is now "the phase that turns `USE_RAW_TRADE_INGESTION` on for a further venue". The entry says the `advance_sync_cursor` anchor cannot lower a set column, so the extend-the-bound direction is the only one that covers both cases. **The id was kept** as a family label (it is cited by name in REVIEW-R2, REVIEW-R3 and this file); the entry says so.

## Open (honest limits, none fixed here)

- **The fail-closed cost grows by one item:** while the bound RPC is unavailable, a Binance run also holds its daily store (see "Cost, stated").
- **The orphan branch still does the balance read and the epilogue's fenced `advance_sync_cursor`.** Both are harmless (the cursor RPC is fenced); only the daily store and the unfenced flag write were moved.
- **A failed epilogue write on a stop run, the double fault (persist raises and the epilogue write fails on a set column) and the cost line** from round 2's Open list are unchanged.
- **IN-16 and IN-17** are comment-only and untouched; IN-16 is in the unapplied migration, which was off limits this round.
- The `1065` arms count is still the static annotated count; the CI `sql-mutation` FULL run is the real biting measurement. No SQL gate or census file changed this round.

---

_Fixed: 2026-11-26_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 3_
