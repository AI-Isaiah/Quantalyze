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

## Round 2 (source: 257-REVIEW-R2.md)

**Fixed at:** 2026-11-28
**Iteration:** 2
**Summary:**
- Findings in scope: 1 (WR-R2-01; IN-R2-01 to IN-R2-05 are Info and never fixed, except the stale text of IN-R2-03 on the lines this fix touches)
- Fixed: 1
- Skipped: 0

Verification ran in the phase-257 worktree (`quantalyze-257`, branch `gsd/phase-257-seedhold`), not an isolated temporary worktree and not the main checkout.

### WR-R2-01: The WR-01 reach floor turns one transient hold-read error into a full-reach re-read that never converges

**Files modified:** `analytics-service/services/trade_resume.py`, `analytics-service/services/job_worker.py`, `analytics-service/tests/test_seedhold_bound.py`, `analytics-service/tests/test_okxtrades_cursor.py`
**Commit:** 235634140 (fixed: requires human verification, logic fix)
**Applied fix:**
- `load_strategy_seed_hold` returns `(mark, error, malformed)`. A read error is `(None, err, False)`; a malformed mark is `(None, err, True)`.
- `run_sync_trades_job`: on a read error (`_hold_err is not None and not _hold_malformed`) it returns `DispatchResult(outcome=FAILED, error_kind="transient", error_message="sync_trades: the seed-hold read failed")`. The return sits where the hold is read, before the provisional bound write and the Phase-1 daily store, inside the existing `try`/`finally` that closes the exchange. Nothing is written before that point. It matches the repo's other transient failure returns (`outcome`, `error_kind="transient"`, a constant `error_message`).
- The reach-anchor floor from `cf5da34d7` stays for a malformed mark only (the stored one, or the claimed row's own).
- Stale text reworded (IN-R2-03): the `load_strategy_seed_hold` docstring and its ERROR log (no more "failing OPEN to no hold term"), the `_hold_read_failed` comment, the WR-01 floor comment and the provisional-write-failure comment in `job_worker.py`, and the H5 neuter record in the test module docstring, re-pointed at `_hold_terms.append(_reach_anchor_ms)` with a dated note. H8 (the new early return) is recorded beside it.
- Tests: `_run_job` in `test_okxtrades_cursor.py` gained `expect_outcome` (default `DONE`, so every other caller is unchanged), because the fixed run ends FAILED. Arm D now asserts the intervening job ends FAILED/transient and that run 2 itself walks at or before run 1's walk start (`_verdict`, the same check as A, B and C). Arm B changes the same way, since it also fails its hold read; both carry a dated `INTENT CHANGE 2026-11-28 (Phase 257 review WR-R2-01)` note. `test_a_failed_hold_read_writes_the_reach_anchor` is adapted to a malformed stored mark (okx and bybit), with the same dated note. New arm `TestSeedHoldMechanism::test_a_hold_read_error_fails_the_attempt_and_moves_nothing` (okx and bybit): one read error on a healthy set-column strategy with a working bound RPC ends FAILED/transient, reads no fills, writes no bound, no seed-hold mark and no daily store, advances no cursor, and the same row's retry seeds at the unblipped seed with no bound left.

**RED/GREEN evidence** (byte backups of the pre-fix and fixed sources in the scratchpad; `cp` back and `cmp` after each):
- Pre-fix `job_worker.py` and `trade_resume.py` (the committed HEAD versions) copied over the fixed ones: `tests/test_seedhold_bound.py` gave `10 failed, 60 passed, 2 xfailed`. The failures were `HandOff[okx-set-B]`, `[okx-set-D]`, `[okx-first-B]`, `[okx-first-D]` and the four bybit twins (`the job ended DispatchOutcome.DONE, expected DispatchOutcome.FAILED`), and the new arm `[okx]` and `[bybit]`. Restored, `cmp` identical, `70 passed, 2 xfailed`.
- H8 neuter on the fixed source (`if _hold_err is not None and not _hold_malformed:` becomes `if False:`): the same 10 arms RED. Restored, `cmp` identical.
- H5 neuter on the fixed source (`_hold_terms.append(_reach_anchor_ms)` becomes `pass`): `5 failed, 65 passed, 2 xfailed`. The failures were `Mech::test_a_failed_hold_read_writes_the_reach_anchor[okx]` and `[bybit]`, and `test_a_malformed_stored_hold_is_ignored[string]`, `[bool]` and `[negative]`. Restored, `cmp` identical.
- The adapted `test_a_failed_hold_read_writes_the_reach_anchor` is GREEN on the pre-fix source by design (the malformed floor predates this fix); its bite is the H5 neuter above.
- The reviewer's probes (`test_review257_r2_probe.py`, `test_review257_probe.py`) now fail their blip runs with `the job ended DispatchOutcome.FAILED, expected DispatchOutcome.DONE`: the blip that those probes modelled as a `done` row no longer ends `done`. The no-blip controls still pass.

**Gates** (run in `analytics-service/` after the commit):
- `python3 -m pytest tests/test_seedhold_bound.py tests/test_nullanchor_bound.py tests/test_binancefills_cursor.py tests/test_okxtrades_cursor.py tests/test_job_worker.py tests/test_sync_trades_store_truth.py tests/test_sync_trades_resume_seed.py -q`: `435 passed, 1 skipped, 2 xfailed`. The 2 xfailed are the `RESIDUAL_DOUBLE_FAULT` arms.
- `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`: `Success: no issues found in 148 source files`.

Not run: SQL gates, vitest, CI. No SQL or migration file changed.

---

_Fixed: 2026-11-28_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 2_
