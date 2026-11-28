---
phase: 257-seedhold-a-down-re-read-bound-cannot-move-a-strategy-s-seed
fixed_at: 2026-11-28T00:00:00Z
review_path: .planning/phases/257-seedhold-a-down-re-read-bound-cannot-move-a-strategy-s-seed/257-REVIEW.md
iteration: 1
findings_in_scope: 2
fixed: 2
skipped: 0
status: all_fixed
---

# Phase 257: Code Review Fix Report

**Fixed at:** 2026-11-28
**Source review:** 257-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 2 (WR-01, WR-02; WR-03 is booked at ship per the founder ruling, IN-* are never fixed)
- Fixed: 2
- Skipped: 0

Verification ran in the phase-257 worktree (`quantalyze-257`, branch `gsd/phase-257-seedhold`), not an
isolated temporary worktree, and not the main checkout.

## Fixed Issues

### WR-01: A failed seed-hold read is fail-open whenever the bound write succeeds

**Files modified:** `analytics-service/services/job_worker.py`, `analytics-service/tests/test_seedhold_bound.py`
**Commit:** cf5da34d7 (fixed: requires human verification, logic fix)
**Applied fix:** When the hold read failed or the stored mark was malformed (`_hold_read_failed`),
`_reach_anchor_ms` is appended to the hold terms, so the run's seed, and therefore its provisional
bound row, drops to the reach anchor whether or not the bound RPC works. `_reach_anchor_ms` is
narrowed with an explicit `is not None` for mypy strict. The now-redundant `min(reach, seed)` floor in
the provisional-write failure arm is reduced to the seed (`_provisional_unread_ms`), which is already
at or below the reach in that case, so the mark carries the same value as before.

Tests: hand-off arm "D" added to `TestSeedHoldHandOff` (okx and bybit, set and first sync): the bound
RPC has recovered, the jobs read fails once in the intervening run. The arm asserts the span is read by
some run (the earliest walk start of the intervening run and run 2 is at or before run 1's walk start).
It deliberately does not pin run 2 alone: after the fix the intervening run itself walks from the reach
and clears the bound honestly, so run 2 may rightly walk on. Case (1) of
`test_a_malformed_stored_hold_is_ignored` now expects the reach anchor, with a dated
`INTENT CHANGE 2026-11-28 (Phase 257 review WR-01)` note.

**RED/GREEN evidence.** Byte backup of the fixed `job_worker.py` taken to the scratchpad. The
committed-HEAD source (pre-fix) was copied over it and the file was run:
`tests/test_seedhold_bound.py` gave `7 failed, 59 passed, 2 xfailed`. The failures were exactly the 4
new D arms (`okx-set-D`, `okx-first-D`, `bybit-set-D`, `bybit-first-D`, message
`SEEDHOLD-WALK-START: ... neither the intervening run nor run 2 walked from at or before run 1's walk
start`) and the 3 case-(1) arms of `test_a_malformed_stored_hold_is_ignored` (`SEEDHOLD-MECHANISM: a
malformed stored mark is a failed read; the seed must drop to the OKX reach anchor`). The backup was
copied back, `cmp` printed identical, and the file ran `66 passed, 2 xfailed`. A second, narrower
neuter (`if False and ...` on the new branch) was also RED on the same arms.

### WR-02: `load_strategy_seed_hold` picks the "latest" `done` row by `created_at`

**Files modified:** `analytics-service/services/trade_resume.py`, `analytics-service/tests/test_seedhold_bound.py`
**Commit:** 614276e13
**Applied fix:** `.order("created_at", desc=True)` became `.order("claimed_at", desc=True)`, with a short
reason comment. The `JobsStore` test fake now models `claimed_at` (a second increasing counter stamped
when a row is added or started and re-stamped by `reclaim()`); its single-`order()` behaviour needed no
change because the reader makes one `order()` call and no tie-break was added. New arm
`TestSeedHoldRetry::test_an_older_rows_retry_mark_outranks_a_newer_done_row` (okx and bybit): row A
(`failed_retry`, created first) and row B (`done`, no mark, created second), then A's retry is claimed
last with the bound RPC down, writes the mark and ends `done`. Premise asserts pin that A is older by
creation and carries the mark. Run 2 must walk at or before A's walk start.

**RED/GREEN evidence.** Byte backup of the fixed `trade_resume.py` taken to the scratchpad. The
committed-HEAD source (ordering by `created_at`) was copied over it: `2 failed, 66 passed, 2 xfailed`.
The 2 failures were both new arms, with `SEEDHOLD-WALK-START: okx two-row retry: run 2 walked from
since_ms=1781913600000 (walk start 1781910000000), after run 1's walk start 1778108400000` and the
bybit twin. The backup was copied back, `cmp` printed identical, and the file ran
`68 passed, 2 xfailed`.

## Gates

Run in `analytics-service/` after both commits:

- `python3 -m pytest tests/test_seedhold_bound.py tests/test_nullanchor_bound.py tests/test_binancefills_cursor.py tests/test_okxtrades_cursor.py tests/test_job_worker.py -q`: `393 passed, 1 skipped, 2 xfailed`. The 2 xfailed are the pre-existing `RESIDUAL_DOUBLE_FAULT` arms (WR-03, booked at ship); the skip is pre-existing.
- `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`: `Success: no issues found in 148 source files`.

Not run: SQL gates, vitest, CI. No SQL or migration file changed, so the generated snapshot and the
parity test are unaffected.

---

_Fixed: 2026-11-28_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
