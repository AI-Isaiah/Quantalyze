---
phase: 223-flowkinds-every-derive-and-compose-path-reads-the-same-capit
plan: 02
subsystem: analytics-service
tags: [flowk-03, d-12, data-quality, docstring, proof-01]
requires: []
provides:
  - "The D-12 docstrings (daily_pnl_read_verdict and its pin) carry the 2026-11-24 PROD reading and founder ruling 2 (Keep flagging)"
affects: [analytics-service/services/exchange.py, analytics-service/tests/test_daily_pnl_read_verdict.py]
key-files:
  modified:
    - analytics-service/services/exchange.py
    - analytics-service/tests/test_daily_pnl_read_verdict.py
decisions:
  - "Ruling 2 (2026-11-24): Keep flagging. Phase 186 D-12 stays; no realized-row refusal is built."
metrics:
  duration: short
  completed: 2026-11-24
status: complete
actuals:
  tokens: 1000
  tasks: 2
  commits: 1
plan_head_before: 62c402d19760cf4b3953fca9cfce99c8bb7c838c
plan_head_after: 44678f1035e02133cf8de9d8eb70d4d505c00c4e
---

# Phase 223 Plan 02: FLOWK-03 record in code and PROOF-01 Summary

Both docstrings that pointed at the TODOS entry asking for the malformed-row count now state the dated reading (0 flags on every measured key and strategy, two pre-Phase-186 Bybit key rows not measured) and the founder's "Keep flagging" ruling; the D-12 pin is proven able to fail.

closes-todos: 186-REALIZED-MALFORMED-COUNT (FLOWK-03)

BASE commit: 62c402d19760cf4b3953fca9cfce99c8bb7c838c. START_COUNT (unedited tree): 492 passed.

## Tasks

| Task | Name | Commit |
| ---- | ---- | ------ |
| 1 | Tracer: docstrings carry the reading and ruling 2, pin green (492 passed, count unchanged) | 44678f103 |
| 2 | PROOF-01: neuter, RED, byte restore, GREEN (no file change, so no commit) | none |

Diff of task 1: exchange.py +3/-2 lines, test file +4/-2 lines, all inside the two docstrings. Acceptance greps: `186-REALIZED-MALFORMED-COUNT` is 0 in both files; `Keep flagging` is 1 in both.

## PROOF-01

Neuter edit (from byte backup in the scratchpad, outside the repo), a realized-row refusal switched on:

```diff
@@ -242 +242 @@ def daily_pnl_read_verdict(flags: Mapping[str, Any]) -> DailyPnlReadVerdict:
-        if key.startswith(("daily_pnl_truncated_", "daily_pnl_deadline_"))
+        if key.startswith(("daily_pnl_truncated_", "daily_pnl_deadline_", "daily_pnl_malformed_"))
```

Command: `cd analytics-service && python -m pytest "tests/test_daily_pnl_read_verdict.py::test_a_dropped_malformed_row_is_not_a_reason_the_key_keeps_publishing" -q -p no:cacheprovider`

RED (first line; all three venue arms failed, `3 failed in 10.49s`):

```
FAILED tests/test_daily_pnl_read_verdict.py::test_a_dropped_malformed_row_is_not_a_reason_the_key_keeps_publishing[daily_pnl_malformed_okx]
```

Restore: `cp "$SCRATCH/exchange.py.bak" analytics-service/services/exchange.py`, then `cmp "$SCRATCH/exchange.py.bak" analytics-service/services/exchange.py` printed nothing (exit 0).

GREEN: `3 passed in 6.43s` for the pin; full file `492 passed in 5.34s`.

Post-cycle: `git status --porcelain -- analytics-service/services/exchange.py` prints nothing; `cat routers/cron.py services/okx_archive_job.py | grep -a -c daily_pnl_malformed` prints 0.

For the ship CHANGELOG: FLOWK-03 is satisfied by the recorded reading plus ruling 2; no code adds a realized-row refusal.

## Verification

- pytest tests/test_daily_pnl_read_verdict.py: 492 passed.
- mypy --strict (CI command): Success, no issues found in 142 source files.

## Deviations from Plan

None - plan executed exactly as written. Phase 232 territory (`fetch_daily_pnl`, `_record_dq_flag`, DQ buffer) was not touched. The `plan_head_before` ledger file was not created before the first commit; the base is the worktree's recorded phase head and the count is measured with `git rev-list`.

## Known Stubs

None.

## Self-Check: PASSED

Commit 44678f103 is an ancestor of HEAD; both modified files exist.
