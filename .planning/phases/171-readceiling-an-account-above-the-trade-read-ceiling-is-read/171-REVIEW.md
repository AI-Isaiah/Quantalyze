---
phase: 171-readceiling-an-account-above-the-trade-read-ceiling-is-read
reviewed: 2026-10-27T15:07:18Z
depth: deep
files_reviewed: 25
files_reviewed_list:
  - .github/workflows/ci.yml
  - analytics-service/main_worker.py
  - analytics-service/scripts/allocator_history_probe.py
  - analytics-service/services/equity_reconstruction.py
  - analytics-service/services/trade_read_store.py
  - analytics-service/tests/test_allocator_history_probe.py
  - analytics-service/tests/test_bybit_two_year_window.py
  - analytics-service/tests/test_equity_reconstruction.py
  - analytics-service/tests/test_reconstruct_force_rebuild.py
  - analytics-service/tests/test_reconstruct_whole_account.py
  - analytics-service/tests/test_trade_pages.py
  - analytics-service/tests/test_trade_read_resume.py
  - analytics-service/tests/test_trade_read_store.py
  - analytics-service/tests/test_trade_read_store_live.py
  - scripts/mutation-floors.mjs
  - scripts/pg-lane/fixtures/41-fixture-api-keys-user-id-fk.sql
  - src/__tests__/drift-check-scripts.test.ts
  - src/__tests__/gate-family-meta.test.ts
  - src/__tests__/lint-sql-gates.test.ts
  - src/__tests__/mutation-annotation-parser.test.ts
  - src/__tests__/mutation-runner-floors.test.ts
  - src/lib/database.types.ts
  - supabase/migrations/20261031120000_allocator_trade_reads.sql
  - supabase/migrations/down/20261031120000-rollback.sql
  - supabase/tests/test_allocator_trade_reads.sql
findings:
  critical: 0
  warning: 2
  info: 0
  total: 2
status: issues_found
---

# Phase 171: Code Review Report

**Reviewed:** 2026-10-27T15:07:18Z
**Depth:** deep
**Files Reviewed:** 25
**Status:** issues_found

## Summary

Scope: `git diff 53f25ac3e..HEAD -- . ':!.planning'` on `feat/171-readceiling`. The
service code (`trade_read_store.py`, the Bybit read, the resumable read, the forced
account crawl, the handler arms, `_defer_reconstruct`, the watchdog sweep), the migration,
its rollback and the probe were read in full. The SQL gate, the CI census edit, the
mutation floors, the TS pin tests and the Python tests were read for reliability only.
Only MEDIUM and above is reported, as asked.

Traced and found sound:
- The resumable read's money-math. Windows are tiled on a UTC-midnight grid, so a UTC day
  never spans two windows and the replay's per-day stable sort sees each day's rows in the
  order they were read. The window holding now, and any window ending within
  `_STORE_SETTLE_MS`, is never stored. The straddle window is cut to `timestamp >= since_ms`.
  Dropping `info` and `id` in the projection does not change a Bybit replay:
  `_resolve_perp_amt_base` ignores `inst_type` when the venue is not OKX.
- The store's atomicity and concurrency. A window is used only when every chunk is present
  under one `chunk_count`, one `window_end_ms`, the current version and an unexpired
  `expires_at`. Interleaved writers, a purge racing a save, and a cancelled save in a thread
  all leave a window that is either whole or ignored. Two grids after an origin reset can
  only match on identical bounds.
- The handler arms. `TradeReadDeferred` and `TradeReadStalled` come before the generic
  `except Exception`. Deferral returns DEFERRED before the persist half. `created_at` is
  present on the claimed row (`RETURNS SETOF compute_jobs`). `last_job_id UUID` matches
  `compute_jobs.id`.
- The scope ContextVar propagates through `wait_for` and `gather`, and each member is
  bound to its own key.
- The migration is service-role only by grant, has a catalogue-only verify block and
  cascades on api_key delete. The rollback keeps the data.

Both findings are in the new layer-1 continuation, `_read_bybit_window`. I reproduced each
one with a fake exchange against this branch's code. Scripts are in `<scratchpad>`.

## Warnings

### WR-01 (MEDIUM, data-integrity): an empty first page of a continuation segment silently ends the window as complete, and the partial window is then stored for reuse

**File:** `analytics-service/services/equity_reconstruction.py:758-759` (reached from the continuation at `:784-794`, stored at `:979`)

**Issue:** When a segment ends without the window ending, the read already holds rows at
`oldest`, and the next segment asks for `[w_start, oldest + 1]` (or `[w_start, oldest]`
after the inclusive-end proof). That range must return at least the rows at `oldest`. An
empty answer can only come from a venue fault: a soft error returned as an empty list, or a
`startTime`/`endTime` handling quirk. The loop treats it exactly like a legitimately empty
window. `if not page: return` hands back only what the earlier segments read, with no
warning.

Reproduced: a 500-row window, page ceiling patched to 2, and an empty first page on
segment 2. `_read_bybit_window` returns 200 of 500 rows after 3 calls and raises nothing.
In the resumable path, `ws < now - 1h` makes that window storable, so the partial window
goes through `save_window`. Every later claim and every later job for the key then reuses
it for up to 7 days (`STORE_EXPIRY_S`). The final claim replays it and persists it as the
whole history.

This is a new silent-truncation path. It breaks the carried rule "Never write a partial read
as the whole history" (TRADEPAGES REVIEW-2 WR-01). The pre-171 read had no continuation
segment, so it had no equivalent case.

**Fix (minimal):** inside the segment loop, an empty page is a normal end only in a
window's FIRST segment, or on a page fetched with a cursor. An empty cursor-less first page
of a continuation segment contradicts rows already read, so it refuses loudly:
```python
if not page:
    if cursor is None and boundary is not None:
        # A continuation segment's range holds the rows at ``oldest``; an empty answer is a venue fault.
        logger.warning(
            "bybit trade window stopped on a page that did not advance "
            "venue=bybit window_age_days=%d page_rows=%d rows=%d",
            age_days, 0, len(trades),
        )
        raise TruncatedTradeRead(_TRUNCATED_READ_MESSAGE, site="bybit_no_advance")
    return
```
Add a test with a fake whose second segment answers `[]` on its first call, and assert
`TruncatedTradeRead` with `site == "bybit_no_advance"`. It goes RED at HEAD: the reproduction
above returns 200 of 500 rows.

### WR-02 (MEDIUM, user-facing regression): a short last page that repeats its cursor used to end a window normally, and now refuses the whole account permanently

**File:** `analytics-service/services/equity_reconstruction.py:777-781` with `:784-801`

**Issue:** The pre-171 read ended a window quietly when a page that was NOT full either
added no new row or returned the cursor it was sent: `if added == 0 or nxt == cursor:` →
`break`, refusing only when the page was full. That is TRADEPAGES D-02's
"non-advancing cursor" stop, which CONTEXT carries forward. The new loop treats any such
cursor page as a stalled segment, whatever its size, and continues by time:
1. `end = oldest + 1` (case 1).
2. If the venue repeats a cursor on short pages again, `end = oldest` (case 2's one retry,
   because the boundary page held a row at `oldest + 1`).
3. Then `TruncatedTradeRead(site="bybit_no_advance")`.

`no_advance` is a `ccxt.BadRequest`, so it is permanent. An unforced reconstruct ends
FAILED permanent. A forced rebuild refuses `account_key_read_failed`.

Reproduced on this branch: a 150-row window whose last (short) page keeps a non-empty
cursor that returns the same page. All 150 rows are read, then the read raises
`TruncatedTradeRead bybit_no_advance` after 6 calls. The base code (`53f25ac3e`) returns the
150 rows. No test pins a short repeating page as a normal end. The existing
`test_a_venue_that_repeats_its_page_ends_the_read_with_one_warning` only covers a FULL
repeated page, which correctly refuses both before and after this phase.

Whether Bybit really answers this way is not measured. The pre-171 code tolerated it on
purpose, and this phase removed that tolerance without a recorded decision. If it does
happen, every reconstruct and forced rebuild of the affected account refuses, the same
"refuses identically on every attempt" outcome this phase exists to remove.

**Fix (minimal):** keep the pre-171 meaning for a short page in the stall test. A page
fetched with a cursor that is shorter than `_TRADE_PAGE_LIMIT` and returns its own cursor,
or adds nothing, ends the window. Only a FULL stalled page ends the segment and continues by
time:
```python
if cursor is not None and (
    nxt == cursor
    or (added == 0 and (boundary is None or any(ts < boundary for ts in stamps)))
):
    if len(page) < _TRADE_PAGE_LIMIT:
        return  # TRADEPAGES D-02: a short page that does not advance is the window's end
    break  # a full stalled page ends the segment; the window is continued by time below
```
Add a test with the short-repeating-cursor fake and assert all rows are returned with no
raise. It goes RED at HEAD.

---

_Reviewed: 2026-10-27T15:07:18Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
