---
phase: 253-binancecursor
reviewed: 2026-11-26T00:00:00Z
depth: deep
round: 2
files_reviewed: 3
files_reviewed_list:
  - analytics-service/services/job_worker.py
  - analytics-service/tests/test_binancefills_cursor.py
  - supabase/migrations/20261126140000_strategy_fills_reread_bound.sql
findings:
  critical: 2
  warning: 1
  info: 3
  total: 6
  necessity: 0
status: issues_found
---

# Phase 253: Code Review Report (round 2)

**Reviewed:** 2026-11-26
**Depth:** deep. Scope: the round-1 fix commit `35ba4f45c`, read against all of `run_sync_trades_job`, the RPC `set_strategy_fills_reread_bound`, the Binance walk in `services/exchange.py`, and `origin/main` at `a74459751`, which carries Phase 251 SYNCSTORE (`c7e1fe682`).
**Files Reviewed:** 3
**Status:** issues_found

## Summary

At this branch's HEAD the fix does what it says on the path round 1 named. A failed bound write no longer drops the NULL-column anchor. A failed early write discards the fills, so the stored high-water does not move. I traced both column cases and found no single-fault loss there.

Ids continue round 1's numbering so the two documents never collide: round 2's findings are CR-02, CR-03, WR-02 and IN-10 to IN-12. "Round-1 CR-01" and "round-1 WR-01" name the earlier findings.

Two HIGH findings remain:

- **CR-02.** The branch cannot ship without a rebase onto `origin/main`, and the trial merge conflicts in exactly this block. Phase 251 moved the Phase 1 `sync_trades` persist into the outer `try`, ahead of the fills read. After the rebase, the early write is no longer "before anything is persisted". A NULL-column run whose fills read is cancelled, or raises a 429, after Phase 1 stored a daily row loses the span. The SFH-1 "no state moves" claim is true at HEAD and false on main. The fix's own characterisation arm goes RED on the merge.
- **CR-03.** SFH-2 is closed only at or above `U - OVERLAP`. The early write records the run's READ frontier `U` while nothing is stored yet. When the persist is then cancelled, a read-but-unstored fill below `U - OVERLAP` is never re-read on a column ahead of the stored fills. That is the round-1 SFH-2 arm's own setup.

A shared fix covers both, checked against the RPC case table below: write a provisional bound at the seed before the fills read.

WR-02 is cross-phase. The same NULL-column loss exists on `origin/main` for OKX without this branch, because Phase 251 introduced it. It should be routed, not fixed here. Ownership of CR-02 follows from it: this phase does not introduce the loss, but after the rebase it fails to close it for Binance, and its SFH-1 skip rested on a tree that predates main. CR-02 and WR-02 differ in who can fix them, not in the damage.

Everything is dormant in PROD while `USE_RAW_TRADE_INGESTION` is off. Round-1 WR-01 (routed as `[253-BINANCE-SYMBOLS-ON-PUBLIC-FLAGS]`) was not reopened, because nothing new bears on it.

Necessity was assessed with `necessity-review.md` and produced no findings.

## Verdicts on the four questions

### 1. Does the early write (covers NULL, before Phase 1 and the fills persist) close round-1 CR-01 and SFH-2 with no new loss path?

**Round-1 CR-01 at HEAD: closed for a single fault.**
- **NULL column, early write raises.** The early-write handler sets `raw_fills = []` and `phase2_failed = True`, so `advance_fetched_cursor` is False. The `elif (phase2_failed or _fills_incomplete) and fills_anchor_iso` arm then stamps the anchor. The epilogue's except no longer clears `_p_last_fetched`, and `advance_sync_cursor` writes the anchor into the NULL column.
- **Set column, early write raises.** No fill is stored, so `min(column, fill high-water)` cannot move past the span. A seed that the stored bound lowered keeps that bound.
- The fixer's double fault (the persist fails part-way AND the epilogue write fails on a set column) is a correctly recorded limit.

**Two-write composition, checked case by case against the migration:**

| Stored row | Early write (`U`, covers NULL) | Epilogue (`U'` ≤ `U`, covers = walk start or `-infinity`) | Outcome |
|---|---|---|---|
| none | R1 insert `U` | R4 sets `U'` when the walk start ≤ `U` (or covers is `-infinity`); otherwise `U = walk_start - 1 = U'` and R5 `LEAST` keeps it | `U'` |
| other key | R2 replace with (this key, `U`) | as the row above (R4 or R5) | `U'` |
| same key, `B` | R5 `LEAST(B, U)` | covers ≤ B: R4 sets `U'`; otherwise R5 `LEAST` | never later than `U'` |
| any, early write skipped (complete read) | none | R0, R3, R6 or R7 exactly as before the fix | unchanged |

- The early write can never reach R4 or R6. Neuter R1-P3 pins that.
- Only the epilogue passes `p_unread_from = NULL`.

**SFH-2: closed only partly (CR-03).** The early write is correct as a LOWER bound against the stored bound. It is not a STORED-through mark.

**New loss path:**
- At HEAD, the fix itself adds none.
- After the rebase, CR-02 applies. The fix relies on an ordering that main has already changed.

### 2. Do the discarded fills and `phase2_failed` cause a regression, and does the change reach other venues?

**No reach outside Binance:**
- The early block is gated on `_binance_read and _reach_anchor_ms is not None`. `_binance_read` is set only for `ctx.key_row["exchange"] == "binance"`, inside the `_RAW_TRADE_INGESTION_ENABLED and not Mt5Session` arm.
- The stop-record derivation that moved up (`_fills_incomplete`, `_read_through`, `_fills_stopped`) reads only `exchange_dq_flags`. Nothing writes `exchange_dq_flags` between the old position and the new one; `awk` over that line range found no mention.
- OKX, Bybit, Deribit and MT5 therefore see byte-identical inputs to the cursor gate.
- `test_binancefills_cursor.py` plus `test_okxtrades_cursor.py` at HEAD: 82 passed. On the trial merge, the two plus `test_sync_trades_store_truth.py` and `test_binance_sync_flags.py` gave 206 passed and 1 failed. The failure is the SFH-1 pin (CR-02).

**Costs on Binance:**
- Over-fetch while the bound RPC is down, as the fixer recorded.
- An admin-only `phase2_fill_ingestion_failed` with `phase2_error = "re-read bound write failed (...)"`.
- A flag inconsistency (IN-10).

`phase2_failed` changes nothing downstream except the flag block and the D-09 clear guard. The follow-on enqueue and the job outcome do not read it.

**Phase 251's reach.** Phase 251 edits the same function, and the trial merge conflicts in two hunks. One hunk carries CR-02. The other is a resolution hazard (IN-12).

### 3. Is SFH-1's "no state moves before the 429 re-raise" true?

**At HEAD: yes.** Before the re-raise the outer `try` makes only these calls:
- reads: `load_strategy_high_waters`, `load_strategy_fill_high_water`, `load_strategy_fills_reread_bound`;
- the exchange calls `fetch_all_trades`, `fetch_usdt_balance` and `fetch_raw_trades`. In `fetch_raw_trades`, Binance symbol discovery (`_get_symbols` in `exchange.py`) is select-only on `trades` and `position_snapshots`.

`_stamp_429` writes `api_keys.last_429_at`, which is not a cursor. Per-symbol 429s inside the Binance walk are gathered as `binance_partial_symbols`. Only an error outside the gather (for example `load_markets()`) escapes as `RateLimitExceeded`.

**On `origin/main`: no.** Phase 251 persists `sync_trades` inside the `try`, before `fetch_usdt_balance` and the fills walk. On the trial merge the fixer's own pin fails:

```
E  AssertionError: Phase 1 did not persist
E  assert 'sync_trades' not in ['sync_trades', 'stamp_api_key_429']
```

`c7e1fe682` landed on main before `35ba4f45c` was written, so this evidence was available when SFH-1 was marked as not reproducible.

### 4. Can the new tests fail?

- **Neuter R1-P1, re-run by me** on the resolved trial-merge tree. I deleted the early handler's `raw_fills = []` and kept `phase2_failed = True`. `-k "cr01 or sfh2"` gave 1 failed and 3 passed: the set-column round-1 CR-01 arm went RED. Restored with `cp`, checked with `cmp`.
- **R1-P2 to R1-P4** are the fixer's record. I did not re-run them.
- The two round-1 CR-01 arms assert run 2's walk start, which is the intended outcome, not the mechanism. They are sound.
- **Gap.** No arm checks the stored frontier against the read frontier, which is CR-03. `test_sfh2_a_persist_cancelled_by_the_handler_timeout_still_leaves_the_bound` puts its unstored fill (BTC at the stop) at `U`, inside the overlap. It cannot fail on a fill below `U - OVERLAP`.
- The SFH-1 pin is a characterisation arm. As designed, it fails on the rebase.

## Critical Issues

### CR-02: After the required rebase onto main, a NULL-column Binance run cancelled or rate-limited in its fills read loses the span (HIGH, data-integrity)

**File:** `analytics-service/services/job_worker.py`, `run_sync_trades_job`: the early bound-write block, the `except ccxt.RateLimitExceeded: ... raise` of the fills read, and (on main) the Phase 1 persist that Phase 251 moved into the outer `try`
**User-facing:** no. **Data-integrity:** yes. Dormant while the switch is off.

**Issue:**
- On main, Phase 251 (`c7e1fe682`) stores the daily rows before the balance read and the fills walk.
- After the rebase, a cancel (the handler's `wait_for`) or an escaping 429 during the fills read reaches neither write. The early bound write is after the read, and the epilogue anchor is in the epilogue.
- The daily high-water has already moved, and the next NULL-column run seeds from it.
- The cancel window is the one `exchange.py` documents at `BINANCE_SYNC_FILLS_READ_DEADLINE_S`: the 60 s outside the 840 s read must hold "the daily read". On main it must also hold the daily persist.
- A first sync is the NULL-column case and does the longest daily read. With no seed it walks from the reach, so the whole fills history before the new daily high-water is skipped.

**Measured** on the trial merge (`git merge-tree` of HEAD and `origin/main`). Conflicts resolved as a rebase must resolve them:
- kept 253's moved stop-record block and early write, and dropped HEAD's Phase 1 persist block, which main moved;
- kept `elif binance_flags_cleared`, and dropped HEAD's `else: write_needed = False`.

The probe is `test_probe_r2_merged_null_column.py`, in the session scratchpad:

```
429:    run 1 rpcs ['sync_trades', 'stamp_api_key_429']  bounds {}  -> run 2 since_ms 1783987200000 (2026-07-14)
cancel: run 1 rpcs ['sync_trades']                       bounds {}  -> run 2 since_ms 1783987200000
old seed (run 1 walked from here): 1778112000000 (2026-05-07)
```

At HEAD, the same run 1 calls no `sync_trades` (rpcs `['stamp_api_key_429']` and `[]`), so this is a merge-only defect. The HEAD half of that probe is not evidence, because it hard-codes the daily row.

**Fix:** write a provisional bound BEFORE the fills read, and keep the existing writes.
- Call `_set_bound` with `p_unread_from = fills_since_ms` (or `_reach_anchor_ms` when there is no seed) and `p_covers_from = None`.
- Composition:
  - The early write lands only on R1, R2 or R5.
  - The seed already takes the stored bound, so after `LEAST` the stored value is the seed.
  - The later early write (`U`, R5) keeps the seed.
  - The epilogue's covers are the walk start (`seed - OVERLAP`, which is ≤ the seed) or `-infinity`, so it lands on R4 (moves to `U'`) or R6 (clears).
- ⛔ Do not use `walk_start - 1` as the provisional value. Covers `walk_start <= walk_start - 1` is false, so the epilogue falls to R5 or R7 and the bound never advances or clears.
- Replace `test_sfh1_a_raised_429_moves_nothing_so_no_bound_is_owed` with an intent arm, parametrised over `RateLimitExceeded` and `CancelledError` from `fetch_raw_trades`, on a NULL column with a Phase 1 daily row. Assert that run 2's walk start is at or before run 1's seed.
- Correct the comments "before the Phase 1 and fills persists" and "BEFORE anything is persisted", which become false after the rebase.

### CR-03: A persist cancelled after the early write loses read-but-unstored fills below `U - OVERLAP`, so SFH-2 is closed only partly (HIGH, data-integrity)

**File:** `analytics-service/services/job_worker.py`, `run_sync_trades_job`, the early write `_set_bound(_early_unread_ms, None)` and the fills persist loop
**User-facing:** no. **Data-integrity:** yes. Dormant while the switch is off.

**Issue:**
- `_early_unread_ms` is the READ frontier: the stop bound, or `walk_start - 1` for a failed symbol.
- When it is written, nothing from the read is stored. The stored-through instant is still the seed.
- `exchange.py` appends each symbol's fills in turn (the `for idx, item in enumerate(results)` loop), so a 100-row batch boundary splits symbols.
- If the handler cancels after a batch that stored a healthy symbol's newer fills, the stored high-water moves past the seed. The bound then promises only `U`, and a healthy symbol's fill in `[walk_start, U - OVERLAP)` from an unstored batch is never re-read.

**Measured** at HEAD with `test_probe_r2_complete_cancel.py` in the session scratchpad: 100 ETH fills at 2026-06-10 in batch 1, and a cancelled batch 2.

```
stopped read, BTC cap U = 2026-06-02T09:00Z, unstored SOL fill 2026-06-01T20:00Z (inside run 1's walk):
  column 2026-06-20 (ahead): bound {(key-1, 2026-06-02T09:00Z)}, run 2 walk 1780387200000 (06-02T08:00Z)  -> SOL missed
  column 2026-06-01T09:00Z (= stored fill): run 2 walk 1780300800000 (06-01T08:00Z)                     -> re-read
complete read (early write skipped), unstored BTC 2026-06-02T00:00Z, column 2026-06-20 in both runs (no sibling step):
  bound {} (0 calls), run 2 walk 1781078400000 (06-10T08:00Z)                                           -> BTC missed
```

- The ahead column is load-bearing in both cases, and it is enough on its own: no sibling step is needed (the complete-read run above holds the column at 2026-06-20 in both runs; a sibling advancing it to 2026-07-01 gives the same walk start). It is `CURSOR_AHEAD_TS`, the setup of the round-1 SFH-2 arm, and the D-01 class: the shared column was set by another strategy.
- Run 1's seed is `min(column, stored fill)` = 2026-06-01T09:00Z. Run 2's is `min(column, the stored ETH fills at 2026-06-10)`, so the cancelled batch's older fills fall below it.

**Scope conflict, surfaced and not averaged (Rule 7):**
- CONTEXT puts "the T-250-19 handler-tail overrun" out of scope.
- The fix commit and REVIEW-FIX state that SFH-2, a `CancelledError` in the persist, is closed.
- The switch comment at `_RAW_TRADE_INGESTION_ENABLED` describes the T-250-19 consequence as "a loud stall … the cursor did not move, so the next run reads the same span". On a column ahead of the stored fills, the consequence is silent loss.
- I rated this on the fix's own claim and the in-scope stopped read, not on CONTEXT's exclusion. Whether to fix it here or route it is the orchestrator's decision.

**Fix:** the CR-02 provisional bound at the seed closes this too. During the persist the stored bound is the seed, never `U`, until the epilogue's R4 moves it.
- Add a test arm: column ahead, a stopped read, an unstored healthy fill below `U - OVERLAP`, a cancel on batch 2. Assert that run 2's walk start is at or before that fill.
- If the case is routed instead, correct the switch comment's T-250-19 consequence for shared keys.

## Warnings

### WR-02: Cross-phase. Phase 251 on main re-opens the Phase 232 NULL-column anchor class for every venue (MEDIUM, data-integrity, not caused by this phase)

**File:** `analytics-service/services/job_worker.py` on `origin/main` (`a74459751`), `run_sync_trades_job`, the Phase 1 persist inside the outer `try` ahead of the fills walk
**User-facing:** no. **Data-integrity:** yes. Dormant while the switch is off.

**Issue:**
- This is the CR-02 mechanism without this branch.
- An OKX run on a NULL column whose fills read raises a 429, or is cancelled, after Phase 1 stored a daily row writes no anchor. The next run seeds at the moved daily high-water.
- `35ba4f45c` does not touch the OKX path. This is evidence that OKX is unaffected by Phase 253 and affected by Phase 251.

Measured on a clean `origin/main` tree with `test_probe_r2_main_null_column_okx.py`:

```
429:    run 1 rpcs ['sync_trades', 'stamp_api_key_429'] -> run 2 since_ms 1783987200000 vs old seed 1778112000000
cancel: run 1 rpcs ['sync_trades']                      -> run 2 since_ms 1783987200000
```

**Fix (route to the Phase 251 / 232 owner; not this phase):** anchor a NULL column before the fills walk. For example, call `advance_sync_cursor` with only `p_last_fetched_ts = fills_anchor_iso`. The RPC writes only into a NULL or earlier column, and the epilogue already writes that value on a failed read. Book it in `TODOS.md` against the phase that turns the switch on.

## Info (LOW and INFO; recorded here only, never booked in TODOS.md)

### IN-10 (LOW): The early-failure path keeps a discarded read's flags

**File:** `job_worker.py` `run_sync_trades_job`, the early-write except
**Issue:**
- The raised-read path drains and discards the fetch flags ("mixing partial truncation flags would mislead operators").
- The early-failure path discards the fills but keeps `binance_*` lists, `binance_read_through_ms` and `fee_currency_mismatch_samples` from fills that were never stored.
- `phase2_failed` then blocks the D-09 clear, so the derive carries them until the next clean sync. The signals are inconsistent; nothing is lost.

### IN-11 (INFO): An orphan (FALSE) early write does not discard the fills

**File:** `job_worker.py`, the early write ignores its boolean
**Issue:**
- The unfenced `trades` upsert still moves the stored high-water with no bound.
- Reachability is near nil: the `sync_trades` watchdog is 30 min (`main_worker.WATCHDOG_PER_KIND_OVERRIDES`) and the handler `wait_for` is 15 min (`TIMEOUT_PER_KIND`). Only a worker stalled past 30 min without cancellation reaches it.
- Pre-existing: the round-1 epilogue write was fenced the same way.

### IN-12 (INFO): Rebase hazard in the second conflict hunk

**File:** `job_worker.py`, the flag write-decision chain
**Issue:**
- The resolution must drop HEAD's `else: write_needed = False`, because Phase 251 made `write_needed` accumulate-only.
- Measured: keeping it turns `test_sync_trades_store_truth.py::TestFlagWrite::test_persist_failure_stamps_persist_failed_flag[ingestion_on]` and `TestOwnedKeyReplacement::test_clean_read_pops_every_owned_key[ingestion_on]` RED, so the hazard is guarded.
- The first hunk must drop HEAD's Phase 1 persist block, which main moved. Keeping it would persist the daily rows twice.

---

_Reviewed: 2026-11-26_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
