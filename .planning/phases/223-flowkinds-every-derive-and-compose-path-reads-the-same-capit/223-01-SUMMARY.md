---
phase: 223-flowkinds-every-derive-and-compose-path-reads-the-same-capit
plan: 01
subsystem: analytics-service
tags: [okx, archive-rebuild, funding, flowk-02]
requires: []
provides:
  - "okx_archive_rebuild stops by name (live_anchor_unusable live_funding=malformed) on a malformed live funding row"
affects: [analytics-service/services/okx_archive_job.py]
key-files:
  modified:
    - analytics-service/services/okx_archive_job.py
    - analytics-service/tests/test_okx_archive_apply.py
decisions:
  - "Ruling 1 (founder 2026-11-24, Stop by name): fixed-literal detail, raised from None, no new stop class"
status: complete
commits: 1
plan_head_before: 62c402d19
plan_head_after: 72c56ab456a98bf65000091f9344ef8325567c4c
actuals:
  tokens: 4000
  tasks: 3
  commits: 1
completed: 2026-11-24
---

# Phase 223 Plan 01: okx_archive_job named stop for a malformed live funding row

`_live_reference` now passes `on_malformed="raise"` to `fetch_funding_okx` and maps `FundingRowsMalformed` to `_Stop("live_anchor_unusable", "live_funding=malformed")` (`from None`), so calibrate and apply both end FAILED permanent with zero writes when the live funding read drops a row.

## Tasks

| Task | Result | Commit |
|------|--------|--------|
| 1 tracer + 2 apply arm, clean boundary, docstring | `TestLiveFundingMalformed` (3 tests), keyword + mapping, docstring refreshed | 72c56ab45 |
| 3 PROOF-01 | two neuter cycles, no code change | (none, recorded below) |

## Verification

- Tracer RED on pre-change code (before the production edit): `2 failed, 1 passed` (calibrate and apply RED, clean arm green); `E AssertionError: assert (<DispatchOutcome.DONE ...> == <DispatchOutc...FAILED ...>`.
- After the change: `3 passed in 4.71s`.
- `tests/test_okx_archive_apply.py tests/test_okx_archive_job.py tests/test_daily_pnl_read_verdict.py`: `858 passed`. After PROOF-01 `tests/test_okx_archive_apply.py tests/test_okx_archive_job.py`: `366 passed`.
- mypy strict (CI command): `Success: no issues found in 142 source files`.
- `verify-plan-anchors.mjs`: `OK: 1 plan file(s), no stale claims.`
- Acceptance greps: `on_malformed="raise"` 1; `FundingRowsMalformed` 2; `since_ms: Any, **kwargs: Any)` 2; old three-arg signature 0; `live_funding=malformed` 2 in the job; `daily_pnl_malformed` 0. `STOP_CLASSES` and `TRANSIENT_STOP_CLASSES` untouched; their pins pass unedited. `git diff --numstat 62c402d19 HEAD` on the job: `15 6`; the only mention of `_check_live_realized_flags` in the diff is an unchanged context line.

## PROOF-01

Backup: scratchpad `p01/okx_archive_job.py.bak` (byte copy of the committed file).

### Cycle A (the keyword)

Edit:
```
@@ -1687,7 +1687,7 @@
     try:
         funding = await _within(
-            budget, fetch_funding_okx(exchange, api_key_id, None, on_malformed="raise"),
+            budget, fetch_funding_okx(exchange, api_key_id, None),
             step="live_funding", cap=_BROKER_CRAWL_TIMEOUT_S,
```
Command: `python -m pytest "tests/test_okx_archive_apply.py::TestLiveFundingMalformed" -q -p no:cacheprovider`

RED:
```
FAILED tests/test_okx_archive_apply.py::TestLiveFundingMalformed::test_a_malformed_live_funding_row_is_a_named_stop_with_zero_writes[calibrate]
FAILED tests/test_okx_archive_apply.py::TestLiveFundingMalformed::test_a_malformed_live_funding_row_is_a_named_stop_with_zero_writes[apply]
2 failed, 1 passed in 5.21s
```
Restore: `cp .../p01/okx_archive_job.py.bak services/okx_archive_job.py; cmp .../p01/okx_archive_job.py.bak services/okx_archive_job.py` printed nothing, `cmp exit=0`.

GREEN: `3 passed in 4.75s`

### Cycle B (the mapping)

Edit: the `try:` / `except FundingRowsMalformed: raise _Stop(...)` wrapper removed, the guarded `funding = await _within(... on_malformed="raise" ...)` statement kept (de-indented).

RED:
```
E       AssertionError: assert (<DispatchOutc...LED: 'failed'> == <DispatchOutc...LED: 'failed'>
E           failed and 'unknown' == 'permanent'
FAILED tests/test_okx_archive_apply.py::TestLiveFundingMalformed::test_a_malformed_live_funding_row_is_a_named_stop_with_zero_writes[calibrate]
FAILED tests/test_okx_archive_apply.py::TestLiveFundingMalformed::test_a_malformed_live_funding_row_is_a_named_stop_with_zero_writes[apply]
2 failed, 1 passed in 4.73s
```
Restore: `cmp` printed nothing, `cmp exit=0`.

GREEN: `3 passed in 4.69s`

After both cycles `git status --porcelain -- analytics-service/services/okx_archive_job.py` printed nothing.

## Deviations from Plan

- Tasks 1 and 2 share the same two files and hunks, so they were committed together as one commit (72c56ab45); the tracer RED was observed on pre-change code before the production edit. No `.git` plan-head ledger was created before the first commit, so `plan_head_before` is the dispatch base 62c402d19 (identical to the worktree start).

## Observation (no code change)

A funding page-ceiling raise from the same `fetch_funding_okx` call still takes the generic path (RESEARCH Pattern 1); ruling 1 was not widened.

## Known Stubs

None.

## Self-Check: PASSED

Files exist (job, test); commit 72c56ab45 is an ancestor of HEAD.
