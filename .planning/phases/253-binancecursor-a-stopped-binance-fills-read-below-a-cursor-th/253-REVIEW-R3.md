---
phase: 253-binancecursor
reviewed: 2026-11-26T00:00:00Z
depth: deep
round: 3
files_reviewed: 12
files_reviewed_list:
  - analytics-service/services/job_worker.py
  - analytics-service/tests/test_binancefills_cursor.py
  - analytics-service/tests/_binance_fills.py
  - supabase/migrations/20261126150000_strategy_fills_reread_bound.sql
  - supabase/migrations/down/20261126150000-rollback.sql
  - scripts/mutation-floors.mjs
  - scripts/baseline-content-drift-check.mjs
  - scripts/dump-sql-functions.ts
  - src/__tests__/mutation-annotation-parser.test.ts
  - src/__tests__/mutation-runner-floors.test.ts
  - src/__tests__/lint-sql-gates.test.ts
  - src/__tests__/gate-family-meta.test.ts
findings:
  critical: 0
  warning: 1
  info: 5
  total: 6
  necessity: 0
status: issues_found
---

# Phase 253: Code Review Report (round 3, final)

**Reviewed:** 2026-11-26
**Depth:** deep. Scope:
- merge `c0327b2b3` (origin/main `9c26bf3f7`, which brings Phase 251 SYNCSTORE and Phase 230 MT5NIGHTLY);
- `9da3ac376` (floor lineage notes);
- `4ff124dee` (the provisional bound before Phase 1's store and the fills read);
- `87b28a5f3` (TODOS routing of WR-02).

I read them against all of `run_sync_trades_job` at HEAD `329270d12`, the same function on `origin/main`, and the RPC `set_strategy_fills_reread_bound`.
**Files Reviewed:** 12
**Status:** issues_found

## Summary

Ids continue rounds 1 and 2: WR-03, then IN-13 to IN-17.

- **CR-02 and CR-03 are closed** on every path where the provisional write lands. I checked each path against rules R0 to R7 (table below). Every cancel, 429 or death after the provisional write leaves the row at the seed. The next run's seed is the minimum of the column, the stored fills and that row, so it never walks later than run 1 did. The epilogue can only advance the row (R4) or clear it (R6) after the persist has finished.
- **Phase 251 survived the merge.** Outside the moved seed derivation and the Binance-gated additions, the function matches `origin/main`. Moving the seed before the daily store changes no input: `sync_trades` deletes only `is_fill = false` rows.
- **OKX and the other venues are unaffected.**
- **The census merge is correct.** Every literal is the sum of both sides, and the four census vitest files pass.
- **One MEDIUM remains (WR-03).** It sits on the fail-closed branch: a set column, no stored fill for the strategy, and the bound RPC failing on both of a run's calls. That run skips its fills read, but Phase 251 still moves the daily high-water, which is the seed in this case. The span is lost, and both flags clear on the next sync. `origin/main` does not have this loss, because it simply reads. Measured below.

Round-1 WR-01 is routed in `TODOS.md`, nothing new bears on it, and it was not reopened. Round-2 WR-02 was not re-rated either, but there is new evidence on its scope. The `TODOS.md` entry `[253-NULL-COLUMN-ANCHOR-ALL-VENUES]` covers less than the measured class (see "WR-02 scope: new evidence"). Everything here is dormant while `USE_RAW_TRADE_INGESTION` is off.

Necessity was assessed with `necessity-review.md` and produced no findings.

## Verdicts

### 1. Are CR-02 and CR-03 closed with no new loss path?

Closed, with one exception: the failed-write branch (WR-03).

Terms used in the table:
- **S** is the provisional value: the seed, or the reach anchor when there is no seed.
- **walk** is S minus the overlap, or the reach.
- **U'** is the stop's read-through instant.
- **B** is a stored row for the same key.

The provisional write always passes `p_covers_from = NULL`, so it can only reach R1, R2 or R5.

| Path | Provisional write | Epilogue write | Row the next run seeds from |
|---|---|---|---|
| clean, persisted | R1 / R2 / R5 → S | unread NULL, covers = walk ≤ S → **R6** deletes it | none needed (whole span read and stored) |
| stopped, persisted | → S | U', covers ≤ S → **R4** → U' | U' (healthy symbols' fills are all stored) |
| partial symbol | → S | `walk - 1` → **R4** | `walk - 1` |
| raised read (not 429) | → S | `phase2_failed` → `walk - 1` → **R4** | `walk - 1` |
| persist raises part-way | → S | `phase2_failed` → `walk - 1` → **R4** | `walk - 1` |
| 429 out of `fetch_raw_trades` or `fetch_usdt_balance` | → S | not reached (re-raise) | **S** |
| cancel or death after the provisional write | → S | not reached | **S** |
| 429 in the daily read or the verdict | not reached | not reached | nothing moved |
| walk starts at the reach | → reach anchor | covers `-infinity` → R4 or R6 | as above |
| bound read failed and B < S | R5 keeps B | covers = walk; if walk > B, R5 or R7 keeps B | B (over-fetch only) |
| epilogue orphan or raise after the provisional landed | → S | dropped | S (over-fetch only) |
| orphan provisional (FALSE) | no write; read skipped; `_binance_read = False` | skipped | IN-14 |
| **provisional raises** | none | `walk - 1` (R1 / R4 / R5) when it lands | **WR-03 when it also fails** |

- The seed is at or below every instant a run can leave unread or unstored. So "the provisional row holds S, and the epilogue alone moves it after the persist" is the correct invariant. It also closes CR-03: during the persist the row is S, never U'.
- The `walk_start - 1` trap that round 2 warned about is avoided. The epilogue's covers is at most S, so it reaches R4 or R6. Neuter N8 (below) shows a late provisional value going RED.
- **R0 and R3** are no longer reachable from the worker in normal operation:
  - Every epilogue write follows a provisional write that landed, and that write left a row for this key. An orphaned provisional write skips the epilogue, and a failed one makes the epilogue send a non-NULL `walk - 1`.
  - R0 (no row, NULL) is reached only if the row disappears mid-run, through the strategy or key cascade.
  - R3 (another key, NULL) is not reached at all.
  - Both stay in the SQL as safety arms. Neither is a loss path.
- I checked the test mirror `bound_after_set` (`tests/_binance_fills.py`) rule by rule against the migration body. It is faithful, including the inclusive `<=` and the handling of `-infinity`.

### 2. Was Phase 251's behaviour preserved by the merge?

Yes. I diffed `run_sync_trades_job` between `origin/main` and HEAD. Apart from the Phase 253 additions:

- **The seed derivation moved.** It now sits after the `phase1_verdict.rate_limited` re-raise and before the daily store; on main it came after the balance read. The new position changes no input:
  - `daily_since_ms` is the in-memory value from before the store.
  - `load_strategy_fill_high_water` reads `is_fill = true` rows, and `sync_trades` deletes only `COALESCE(is_fill, false) = false` rows (migration `20260510180535`).
  - On main the derivation already sat outside the Phase-2 `try`, so exceptions behave the same.
- **The store still precedes the balance read and the walk.** Phase 251's "a run cancelled or raised in that walk has already kept its daily rows" still holds.
- **The verdict chain is equivalent.** `elif phase1_verdict.reasons` became `if`, which changes nothing because the arm above it raises.
- **The flag chain matches main.** It keeps main's accumulate-only `write_needed` and adds `elif binance_flags_cleared`. HEAD's old `else: write_needed = False` is gone, as round 2's IN-12 required.
- **Measured:** `test_sync_trades_store_truth.py`, `test_okxtrades_cursor.py`, `test_binancefills_cursor.py` and `test_binance_sync_flags.py` gave **213 passed**. `test_binancefills_e2e.py`, `test_sync_trades_preserves_fills.py`, `test_sync_trades_resume_seed.py`, `test_fetch_trades_resume_seed.py` and `test_stamp_io_exhaustive.py` gave **130 passed, 2 skipped**.

### 3. Are OKX and the other venues unaffected?

Yes:
- `_reach_anchor_ms` and `_binance_read` are set only when `ctx.key_row["exchange"] == "binance"`.
- The provisional write and its two failure branches (the only places that set `_fills_read_skipped`) are inside `if _binance_read and _reach_anchor_ms is not None`.
- The epilogue bound block has the same gate.
- For OKX, Bybit and Deribit, the only change is that the seed is computed earlier, from identical inputs (point 2).

### 4. Can the tests fail?

I re-ran four neuters in a scratch copy of `analytics-service/`. The copy was byte-identical to the worktree (`cmp`), and each neuter was restored from the byte backup and checked equal.

| Neuter | Result |
|---|---|
| N7: the provisional write sends `"-infinity"` covers (so it can reach R4 and R6) | 6 failed, including `test_the_provisional_write_never_advances_a_stored_bound` and three D-03 arms |
| N8: the provisional value is the seed plus 6 h | 10 failed, including both CR-02 arms, the clear arm and the never-advances arm |
| N9: a failed provisional write skips the read but does not set `phase2_failed` | 4 failed, including both round-1 CR-01 arms and the failed-write arm |
| N5: `phase2_success` ignores `_fills_read_skipped` | **68 passed**: unpinned (IN-13) |

- The fixer's R2-P1 to R2-P4 are their own record; I did not re-run them.
- Both CR-03 arms put their unstored fill below the stop minus the overlap, on a column ahead. They assert run 2's walk start, which is the outcome, so they are sound.
- No arm covers WR-03.

### 5. Census merge

Phase 230 and Phase 253 each added one gate file. Every literal is the sum of both sides:

| Literal | Calculation |
|---|---|
| `FILES_FLOOR` | 95 + 1 = 96 |
| `ARMS_FLOOR` and `armsSeen` | 1041 + 24 = 1065 |
| `stepsSeen` | 1195 + 21 = 1216 (the branch moved 1186 → 1207) |
| corpus | 122 → 123 files |
| `COMPARED_FLOOR` | 147 → 148 |

- The `NAME_SET_RATCHET` row is `snapshot-only` for `set_strategy_fills_reread_bound`.
- Main's `20261126140000` rollback is untouched.
- Every 253 reference moved to `20261126150000`. No stray `20261126140000` remains outside Phase 230's own files.
- `npx vitest run --maxWorkers=2` over the four census files gave **4 files, 336 passed**.

### 6. WR-02 scope: new evidence (not re-rated, not fixed)

WR-03's probe shows that the exposed class is "the seed rests on the daily high-water". That covers a set column with no stored fill, not only a NULL column. I re-ran the same shape for OKX:
- a column at 2026-06-20 (`CURSOR_AHEAD_TS`) and `DAILY_ONLY_TRADES`;
- a daily row for 2026-06-10 stored in run 1;
- the fills read failing.

`test_probe_r3_okx_set_column.py` (session scratchpad), on `origin/main` (`9c26bf3f7`) and on HEAD alike:

```
[RateLimitExceeded] run1 rpcs=['sync_trades', 'stamp_api_key_429'] stamp=None run2 since_ms=1781049600000 vs run1 seed 1778112000000
[CancelledError]    run1 rpcs=['sync_trades']                      stamp=None run2 since_ms=1781049600000 vs run1 seed 1778112000000
[RuntimeError]      run1 rpcs=['sync_trades', 'advance_sync_cursor', 'enqueue_compute_job'] stamp=None run2 since_ms=1781049600000 vs run1 seed 1778112000000
```

- **The entry is too narrow.** Its title, gate and first fix line cover the NULL column only, and an `advance_sync_cursor` anchor cannot lower a set column. The entry's own second clause ("extend the per-strategy bound to that venue instead") is the only direction that reaches this case.
- **The plain raised-read variant predates Phase 251.** On the pre-251 base `c57961a54`, run 1 still called `sync_trades` and run 2 seeded at 2026-06-10, so "owner: a Phase 251 SYNCSTORE follow-up" is wrong for that variant. Its class is Phase 232's set-column seed.
  - On that base the 429 and cancel variants stored nothing in run 1 (rpcs `['stamp_api_key_429']` and `[]`).
  - Their run-2 result there is an artefact: the probe hard-codes the daily row into run 2's store. So for 429 and cancel, Phase 251's ownership stands.
- **Binance is not exposed** to any of the three variants while the bound RPC works:
  - a 429 or a cancel leaves the provisional row at S;
  - a plain raised read makes the epilogue write `walk - 1`.

  With the RPC down, see WR-03.

The orchestrator should widen the entry's scope and owner. This review changes nothing in `TODOS.md`.

## Warnings

### WR-03: When the bound RPC fails on both of a run's calls, a set-column strategy with no stored fill loses its span, and both flags clear on the next sync (MEDIUM, data-integrity)

**File:** `analytics-service/services/job_worker.py`, `run_sync_trades_job`:
- the provisional write's `except Exception` branch, which sets `_fills_read_skipped = True` and `phase2_failed = True`;
- the Phase 251 daily store that follows it (`elif trades:` → `_sync`);
- the seed derivation `_seed_bound_ms = _fill_hw_ms if _fill_hw_ms is not None else daily_since_ms`.

**User-facing:** no. **Data-integrity:** yes. Dormant while the switch is off.

**Issue:**
- On a set column with no `is_fill` row for the strategy, the seed is `min(column, daily high-water)`.
- The failed-write branch skips the fills read, but the daily store still runs and moves the daily high-water.
- `fills_anchor_iso` is None on a set column, and the forward-only cursor RPC cannot lower the column. So the only carrier of the span is the epilogue's bound write.
- When that write fails too, the next run seeds from `min(column, new daily high-water)`, and the span between the two seeds is never read.
- The next clean run then clears `phase2_fill_ingestion_failed` (self-heal) and `binance_stop_below_cursor` (the D-09 clear). The loss is loud for one sync and silent after.
- This configuration is the D-01 case the phase exists for: a strategy newly added to a key whose column a sibling strategy has already moved. On a first sync the seed is None, so S is the reach anchor, and the whole reachable history before `min(column, today)` is skipped.
- `origin/main` has no such loss in this configuration, because it never consults the RPC and simply reads.

**Trigger.** The bound RPC must fail while `sync_trades` succeeds between its two calls. If PostgREST is wholly down, the daily store fails too (`phase1_failed`), the daily high-water does not move, and nothing is lost. So the trigger is a fault specific to the function, such as:
- a worker running with the switch on against a database without migration `20261126150000`;
- the rollback `down/20261126150000-rollback.sql` applied while the worker still calls the RPC;
- a function-level error.

It is one sustained fault, not two independent ones.

**Not caught before.** Both earlier claims are wrong for this configuration:
- REVIEW-FIX round 1 says the fail-closed cost is "over-fetch, nothing lost".
- Round 2's case analysis says "Set column, early write raises. No fill is stored, so min(column, fill high-water) cannot move past the span".

The round-2 fixer's "Open" list names the leg ("or the column is set with no stored fill (the seed is then the daily high-water)") but did not measure it. The branch dates from the round-1 fail-closed design (`35ba4f45c`). Round 2 kept it.

**Measured** with `test_probe_r3_set_column_no_fill.py` in the session scratchpad, against a byte-identical copy of HEAD's `job_worker.py`:
- column 2026-06-20, `DAILY_ONLY_TRADES` (daily seed 2026-05-07, no fill), and a daily row for 2026-06-10 stored by Phase 1;
- run 2 has the RPC back and that daily row in its store.

```
[whole-run-outage] run1 fetch_raw calls=0 rpcs=['set_strategy_fills_reread_bound', 'sync_trades', 'set_strategy_fills_reread_bound', 'advance_sync_cursor', 'enqueue_compute_job'] bounds={} stamp=None flags phase2_failed=True stop_below=True
[whole-run-outage] run2 since_ms=1781049600000 walk=1781046000000 vs run1 walk 1778108400000 | after run2: phase2_failed=None stop_below=None bounds={}
[provisional-only] run1 ... bounds={'strat-232-cursor': ('key-1', '2026-05-06T22:59:59.999000+00:00')}
[provisional-only] run2 since_ms=1778108399999 walk=1778104799999 vs run1 walk 1778108400000 | after run2: phase2_failed=None stop_below=None bounds={}
```

- With the RPC down for the whole run, run 2 walks from 2026-06-09T23:00Z instead of 2026-05-06T23:00Z, and both flags are gone after run 2.
- When only the provisional write fails, the epilogue's insert at `walk - 1` saves the span. So the loss needs both calls to fail.

**Fix (record; not applied).** The choice is the orchestrator's, because REVIEW-FIX round 2's "Open" list already declined to skip the store for Phase 251 reasons. When the provisional write raises, move no seed term in that run:
- hold the Phase 1 store in that branch, the way a refused daily read holds it (no `sync_trades`, `last_sync_at` held); or
- fail the job before the store, so it retries with nothing moved.

Either can be narrowed to the one exposed case: a set column on which the strategy has no stored fill, so the seed came from the daily high-water or the reach.
- On a set column with a stored fill, that fill anchors the seed, and the skipped read does not move it.
- On a NULL column, the epilogue's anchor is written through `advance_sync_cursor`, a different RPC that still works.
- Add a two-run gate arm: set column, `DAILY_ONLY_TRADES`, RPC down for the whole of run 1, a daily row stored in run 1. Assert run 2's walk start is at or before run 1's. This probe is RED at HEAD.
- Correct the "nothing lost" sentence.

## Info (LOW and INFO; recorded here only, never booked in TODOS.md)

### IN-13 (LOW): `phase2_success`'s `not _fills_read_skipped` term is unpinned

**File:** `job_worker.py` `run_sync_trades_job` (`phase2_success = ...`); `tests/test_binancefills_cursor.py::test_an_orphan_bound_write_is_logged_and_the_cursor_rpc_still_runs`

**Issue:**
- Neuter N5 leaves the module green (68 passed).
- The orphan arm checks only that `phase2_fill_ingestion_failed` is absent, on a row that never carried it.
- A scratch probe that seeds the row with a stale `phase2_fill_ingestion_failed: True` passes at HEAD. Under N5 it fails: the orphaned run clears the stale failure and stamps `phase2_recovered_at`.
- The signal is admin-only, and an orphan is near-unreachable (watchdog 30 min against the handler's 15 min).

**Fix:** seed that arm's flags with a stale `phase2_fill_ingestion_failed` and assert it survives.

### IN-14 (LOW): An orphaned provisional write still lets Phase 251's unfenced daily store move the seed

**File:** `job_worker.py`, the orphan (`not _bound_owned`) branch, then `_sync`

**Issue:**
- The orphan branch skips the read but not the daily store.
- On a NULL column, or a set column with no stored fill, an orphaned worker can move the daily high-water before the re-claiming worker reads it. Nothing names the span.
- This is the WR-03 mechanism behind the orphan gate, and its reachability is near nil (round 2's IN-11).
- `origin/main` has the same unfenced store, so this is not new. The fixer recorded it under "Open".

### IN-15 (LOW): A failed provisional write followed by a 429 or a cancel after the daily store loses a NULL-column span

**File:** `job_worker.py`, the failed-write branch, then `fetch_usdt_balance`

**Issue:**
- On a NULL column the failed-write branch relies on the epilogue's `fills_anchor_iso` stamp.
- A 429 escaping `fetch_usdt_balance`, or a cancel, after Phase 1 stored reaches no epilogue.
- This needs the RPC fault from WR-03 plus an independent venue or timeout fault in the same run.
- The WR-03 fix (move no seed term when the provisional write fails) closes this too.

### IN-16 (INFO): The migration's catalogue COMMENTs and header still describe a stop-only, epilogue-only row

**File:** `supabase/migrations/20261126150000_strategy_fills_reread_bound.sql:15`, `:68` (table COMMENT, "Sole writer is the analytics worker sync_trades epilogue"), `:77` (`unread_from`, "the earliest instant the stopped run was complete through"), `:222` (function COMMENT, "The analytics worker sync_trades epilogue is the sole caller")

**Issue:**
- Since round 2, every Binance run writes a provisional row at its seed before the read.
- That row survives a cancel or a 429.
- These comments ship to the PROD catalogue.

The migration is not applied yet, so the text can still be corrected in place.

### IN-17 (INFO): The `phase2_ran` comment is false on the orphan path

**File:** `job_worker.py:3289-3290` ("`phase2_failed or phase2_success`, which equals `_RAW_TRADE_INGESTION_ENABLED` (MT5 included)")

**Issue:**
- On an orphaned provisional write both are False while the switch is on.
- The guard below the comment errs in the safe direction (it skips the write when the flag load failed). Only the comment is wrong.

---

_Reviewed: 2026-11-26_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
