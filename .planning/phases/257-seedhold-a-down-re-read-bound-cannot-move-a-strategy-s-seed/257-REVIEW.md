---
phase: 257-seedhold-a-down-re-read-bound-cannot-move-a-strategy-s-seed
reviewed: 2026-11-28T11:07:03Z
depth: deep
files_reviewed: 16
files_reviewed_list:
  - analytics-service/services/exchange.py
  - analytics-service/services/job_worker.py
  - analytics-service/services/trade_resume.py
  - analytics-service/tests/test_nullanchor_bound.py
  - analytics-service/tests/test_seedhold_bound.py
  - scripts/baseline-content-drift-check.mjs
  - scripts/dump-sql-functions.ts
  - scripts/mutation-floors.mjs
  - src/__tests__/gate-family-meta.test.ts
  - src/__tests__/lint-sql-gates.test.ts
  - src/__tests__/mutation-annotation-parser.test.ts
  - src/__tests__/mutation-runner-floors.test.ts
  - supabase/migrations/20261128120000_compute_job_seed_hold.sql
  - supabase/migrations/down/20261128120000-rollback.sql
  - supabase/schema/functions/set_compute_job_seed_hold.sql
  - supabase/tests/test_compute_job_seed_hold.sql
findings:
  critical: 0
  warning: 3
  info: 7
  total: 10
  necessity: 0
status: issues_found
---

# Phase 257: Code Review Report

**Reviewed:** 2026-11-28T11:07:03Z
**Depth:** deep
**Files Reviewed:** 16
**Status:** issues_found

**Severity mapping used in this file:** Critical (`CR-`) = HIGH or CRITICAL. Warning (`WR-`) = MEDIUM.
Info (`IN-`) = LOW or INFO. Under this repo's review rule, only `CR-` and `WR-` items are fixed or routed.
`IN-` items are recorded here and nowhere else.

**Scope:** `git diff $(git merge-base HEAD origin/main) HEAD -- . ':!.planning'` in the phase-257 worktree,
16 files. The migration, its rollback, the generated snapshot and the SQL gate were read for two things:
that the Python-to-SQL contract is consistent, and that every gate can actually fail. They had already
passed migration-reviewer and rls-policy-auditor. The TypeScript and `scripts/` changes are census and
ratchet moves. Each one was read against the counts it claims.

## Summary

The Bybit half holds up when traced against the code:

- A window counts as complete only on the two natural ends that `walk_paginated` breaks on: an empty
  page, or an empty cursor while `stop_on_short_page=False`.
- The in-flight window is never handed out.
- The refusal's attributes survive the bare `raise` in `fetch_raw_trades`.
- `_earliest_through()` reads `_fills_persist_failed` when it is called, which is after the persist.
- With no completed window, the bound holds at the seed (RPC R4, no creep).
- A deadline stop always keeps `phase2_failed`, so `phase2_fill_ingestion_failed` is stamped and the
  `phase2_success` clear is never taken.
- The stamp is filtered to fills at or before the mark.
- The Binance, OKX and Deribit branches of `_earliest_through()` and of the stamp gate are unchanged.
- `advance_sync_cursor` gets the same parameters as before.
- The Python fence passes the claim token, and the SQL fence refuses NULL, stale or non-running rows.

The tests can fail. The Bybit deadline arms assert, with equalities, the persisted fill ids, the bound,
the stamp, the flag and run 2's walk start. The parity test has a twin that misspells every name and
proves the pin can go red. Each of the SQL gate's 9 arms carries a `RED-UNDER-M` twin. One exception is
the budget test, which only re-checks hand-typed assumptions (see IN-05).

The seed-hold half has two MEDIUM gaps that defeat the phase goal ("run 2's walk start is at or before
run 1's seed"). For each one I ran a two-run probe built on the phase's own harness (`JobsStore`,
`FlakyBounds`, `_run`), calling the real `run_sync_trades_job`. All 5 of the probe's arms failed, with the
walk starts quoted below.

- **WR-01** comes from a realistic path: a later run with the bound RPC recovered whose `compute_jobs`
  read fails once.
- **WR-02**: the probe hand-built the two `compute_jobs` rows. That production can produce that pair of
  rows is shown from the schema and the RPCs, cited in the finding.

Founder residual (a) is rated MEDIUM (WR-03). That agrees with the phase's own `RESIDUAL_DOUBLE_FAULT`
marker, so per the founder ruling it is booked in `TODOS.md` and not fixed in this phase. Residual (b)
is LOW (IN-01).

`necessity-review.md` was read. No necessity finding applies. The malformed-mark guards validate data
read back from the database, which is a trust boundary and therefore excluded.

## Narrative Findings (AI reviewer)

## Warnings

### WR-01: A failed seed-hold read is fail-open whenever the bound write succeeds, and the run's `done` row then hides run 1's mark for good

**File:** `analytics-service/services/job_worker.py:2556-2582` (`_hold_read_failed` is consumed only at `:2666-2670`); `analytics-service/services/trade_resume.py:202-258`

**Issue:** `_hold_read_failed` is only read inside the `except` arm of the provisional bound write. Take
the case where run 1 wrote its mark because the bound RPC was down. A later run (call it "mid") finds the
RPC recovered, but hits one transient `compute_jobs` read error or a malformed mark. Mid then:

1. drops the hold term and seeds from the column, the stored fills or the daily high-water, which a
   cron-style writer may already have moved past run 1's span;
2. records that later seed as its provisional bound, which succeeds, so no fail-safe mark is written;
3. reads cleanly from there and clears the bound (R6). From the code (`phase2_success` at `:3350`; not
   asserted in the probe), it also clears `phase2_fill_ingestion_failed`;
4. ends `done` with no `seed_hold_ms`.

From then on, `load_strategy_seed_hold` returns mid's mark-less row, and run 1's unread span is never
re-read. The Phase 253 bound read behaves differently: a read blip there is harmless because the bound
ROW survives in `strategy_fills_reread_bounds` (R4 and R6 need `covers <= bound`). The hold has no row of
its own and clears by recency, so one blip makes the loss permanent. It lands on exactly the column
states this phase targets. Research arm B covers a failed hold read only while the RPC is still down.
The existing pin `test_a_malformed_stored_hold_is_ignored`, case (1), asserts this fail-open behaviour
(`since_ms == SET_SEED_MS` with the bound RPC working).

**Measured** with the real worker. Run 1 used `FlakyBounds(PERSISTENT)` and then went `done`. Mid ran with
`fail_next = 0` and `jobs.read_error` set. Run 2 followed:

```
PROBE-D okx set:   run1 walk 1778108400000 mid walk 1781910000000 run2 walk 1781910000000 mid metadata {}
PROBE-D bybit set: run1 walk 1778108400000 mid walk 1781910000000 run2 walk 1781910000000 mid metadata {}
PROBE-D okx first: run1 walk 1776081600000 mid walk 1783983600000 run2 walk 1783983600000 mid metadata {}
FAILED x3  (neither mid nor run 2 walked from at or before run 1's walk start)
```

**Fix:** When the hold could not be read, put the floor on the SEED. The provisional bound row, which
outlives the run, then records the floor whatever happens to the mark. Take one `min` over the floor and
the hold terms, so an own-row hold below the reach still wins. Narrow `_reach_anchor_ms` explicitly for
mypy strict, because it is still `int | None` inside `if _bound_read:`:

```python
_floor_terms = [t for t in (_hold_ms, _own_hold_ms) if t is not None]
if _hold_read_failed and _reach_anchor_ms is not None:
    # An earlier mark may be hidden: over-fetch from the reach, never skip a span.
    _floor_terms.append(_reach_anchor_ms)
if _floor_terms and min(_floor_terms) < fills_since_ms:
    fills_since_ms = min(_floor_terms)
    if _fills_cursor_ms is None:
        fills_anchor_iso = _iso_of_ms(fills_since_ms)
```

The `except`-arm floor at `:2666` then reduces to `_provisional_unread_ms`. Add hand-off arm "D" to
`TestSeedHoldHandOff`: an intervening run with the RPC recovered and `jobs.read_error` set, which is RED
at HEAD. Case (1) of `test_a_malformed_stored_hold_is_ignored` needs a dated intent-change note, because
the expected seed becomes the reach anchor.

### WR-02: `load_strategy_seed_hold` picks the "latest" `done` row by `created_at`, so a mark written by an older row's later retry is hidden by a newer row

**File:** `analytics-service/services/trade_resume.py:232`

**Issue:** A second `sync_trades` row for a strategy can exist, and run, while an older row is in
`failed_retry`. Every step of that is in the schema and the RPCs:

- `mark_compute_job_failed` moves a retryable failure to `failed_retry`
  (`supabase/schema/functions/mark_compute_job_failed.sql:89`).
- The only uniqueness on in-flight rows, `compute_jobs_one_inflight_per_kind_strategy`, has the
  predicate `status IN ('pending','running','done_pending_children')` (`supabase/schema/baseline.sql:16969`).
  The enqueue dedupe in `_enqueue_compute_job_internal` uses the same list. So a new row is created
  while the old one is `failed_retry`.
- The claim takes both `pending` and `failed_retry` rows
  (`claim_compute_jobs_with_priority.sql:242`). It serializes only against `running` rows, and orders by
  `next_attempt_at`. The new row B therefore runs and finishes `done` while the older row A waits out its
  backoff.

A's retry then runs. If its bound RPC raises, it writes `seed_hold_ms` and ends `done`. The next run reads
by `created_at desc`, picks B (created later, no mark), and seeds past A's span. A's first attempt
typically fails retryably on a 900 s handler cancel or a 429. So beyond the RPC failure the feature
presumes, this needs only an ordinary interleaving. The phase's `JobsStore` fake maps `created_at` to
insertion order and never models it.

**Measured**: the probe hand-built the rows. A was added first as `failed_retry` and B second as `done`
with `{}`. A was then re-claimed with the bound RPC down and went `done`. Run 2 followed with the RPC
recovered:

```
PROBE-E rows: [('job-A', 'done', 1, {'seed_hold_ms': 1778112000000}), ('job-B', 'done', 2, {})]
PROBE-E okx set:   A walk-start 1778108400000 run2 walk 1781910000000
PROBE-E bybit set: A walk-start 1778108400000 run2 walk 1781910000000
FAILED x2
```

**Fix:** Order by the column that tracks which run ran last. `claimed_at` is set to `now()` on every claim,
including the final attempt (`claim_compute_jobs_with_priority.sql:401`):

```python
.eq("status", "done")
.order("claimed_at", desc=True)
.limit(1)
```

Model `claimed_at` in `JobsStore` by stamping it in `start()` and `reclaim()`. Note that
`_JobsQuery.order()` keeps only the last call, so a second `.order("created_at")` tie-break would make
the fake sort by `created_at` again. Either extend the fake to sort by several keys or drop the
tie-break. Add an arm where the marked row has the lower `created_at` but the later claim.

### WR-03: Founder residual (a), the RPC down AND the mark write failing in one run, is MEDIUM: book it, do not fix it here

**File:** `analytics-service/services/job_worker.py:2683-2690`; pinned by `RESIDUAL_DOUBLE_FAULT` (`analytics-service/tests/test_seedhold_bound.py:185`)

**Issue:** The rating agrees with the phase's own marker, which already calls it MEDIUM and data-integrity.
The span is lost on a set column with no stored fill (the two first-sync C arms measure GREEN) when the
provisional bound write, the mark write and the epilogue bound write all fail in one run, and the next
run seeds past the span. That combination is not rare. The mark shares a failure domain with the bound
write (same PostgREST, same database), so a short general outage that covers a run fails all three
writes together. Run 1 skips its fills read, which makes the run short. The mark mainly protects against
failures specific to the bound RPC or its table, such as a `20261126150000` rollback or a lock timeout.
Research shows a positive hand-off would not close this.

**Fix:** None in this phase. Per the founder ruling of 2026-11-28, book it in `TODOS.md` at ship under
the id the marker names (`[257-SEEDHOLD-DOUBLE-FAULT]`). The SUMMARY should state the correlated failure
domain.

## Info

### IN-01: Founder residual (b), the mark ageing out with the 30-day `done` reaper, is rated LOW

**File:** `analytics-service/services/trade_resume.py:202-258`

**Issue:** While the RPC stays down, every run writes a fresh mark, so the newest `done` row is always
recent. A mark ages out only if no `sync_trades` row of the strategy finishes `done` for 30 days after it,
while other writers keep storing daily rows. Per the founder ruling it is not booked.

**Fix:** None required.

### IN-02: A mark on a row that ends `failed_final` is never read

**File:** `analytics-service/services/trade_resume.py:231`

**Issue:** After the mark write, the run cannot raise an ordinary exception. The daily 429 raise comes
before the seed block, and `fetch_usdt_balance_with_status` catches `Exception`. Only repeated handler
cancels or process deaths across every attempt leave a marked row `failed_final`, and the reader, which
reads `done` only, then skips it.

**Fix:** None required.

### IN-03: A re-claimed row that ends `done` keeps its own mark, so the next run lowers the bound back below a read-through advance

**File:** `analytics-service/services/job_worker.py:2561-2582`, `:2630-2632`

**Issue:** Attempt 1 writes mark M. Attempt 2, with the RPC up, reads its own M and records it. On Bybit
it then stops at its deadline and advances the bound to read-through R, which is above M. The row ends
`done` still carrying M. The next run reads M, and its provisional write (covers NULL, so it can only
LOWER) drags the bound from R back to M. The result is one run of over-fetch, never a skipped span. On a
dense Bybit account, one run of read-through progress is discarded.

**Fix:** Optional. Once the epilogue bound write lands, clear the row's own `seed_hold_ms`. That needs an
RPC arm.

### IN-04: The Bybit 420 s persist margin rests on an unmeasured round trip, and nothing caps the fill count

**File:** `analytics-service/services/exchange.py:840-857`, `analytics-service/services/job_worker.py:2813-2818`, `analytics-service/tests/test_seedhold_bound.py:1085`

**Issue:** The margin assumes at least 0.5 s per page and a round trip `r` of at most about 0.27 s. `r`
is unmeasured. A deadline stop can hand out about 84,000 fills, which means 1,680 round trips across the
amendment probe and the upsert. If `r` is above break-even, the handler cancel lands mid-persist and the
epilogue is skipped. The provisional bound still names the seed, so the next run repeats the same read
and persist and is cancelled at the same point. That is a visible, permanent stall for the strategy, with
no data loss and no creep. The budget test re-checks the hand-typed assumptions, so it goes red only when
a constant moves, never when `r` is wrong. This is the one Info rating here that rests on an unmeasured
number.

**Fix:** Optional. Cap what a deadline refusal hands out: keep completed windows only while their
cumulative fill count is at most N, and set `read_through_ms` to the last kept window's end.
Alternatively, measure `r` on PROD.

### IN-05: A deadline stop discards `fee_currency_mismatch` and its samples for fills it persists

**File:** `analytics-service/services/job_worker.py:2856`, `:2875-2880`

**Issue:** The `except Exception` arm drains the DQ buffer and throws it away before taking
`e.completed_fills`. The completed windows' fills are now stored and later runs seed past them, so their
mismatch signal is never stamped. The flag has no reader under `src/`, so this is observability only.

**Fix:** On the deadline arm, carry the `fee_currency_mismatch*` keys from the drained flags into
`exchange_dq_flags`.

### IN-06: The fail-safe floor is the reach anchor, not the hidden mark

**File:** `analytics-service/services/job_worker.py:2666-2670`

**Issue:** `min(_reach_anchor_ms, seed)` does not cover a hidden mark older than the reach: 365 days for
Bybit (whose venue history is 730 days), 93 for OKX, 85 for Binance.

**Fix:** None required.

### IN-07: `load_strategy_seed_hold` logs the exception text and traceback

**File:** `analytics-service/services/trade_resume.py:252-258`

**Issue:** `logger.exception` and the returned `f"{exc}"` carry PostgREST error text. This matches the
function's siblings, and the caller never logs the returned string. No fill content reaches any log line
added by this phase. The Bybit refusal text is static, and the other new log lines name the strategy and
the exception class only.

**Fix:** None required.

---

_Reviewed: 2026-11-28T11:07:03Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
