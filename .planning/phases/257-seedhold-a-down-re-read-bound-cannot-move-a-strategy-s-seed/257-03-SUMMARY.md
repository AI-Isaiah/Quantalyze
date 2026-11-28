---
phase: 257-seedhold-a-down-re-read-bound-cannot-move-a-strategy-s-seed
plan: 03
subsystem: analytics-service (Bybit fills reader, run_sync_trades_job epilogue)
tags: [seedhold, bybit-deadline, read-through, budget, margin-pin]
requires: ["257-01"]
provides:
  - "BybitTradeWindowIncomplete.completed_fills / .read_through_ms on a deadline refusal"
  - "run_sync_trades_job Bybit deadline epilogue branch (persist completed windows, stamp at or before the mark, bound at the mark or the seed)"
  - "BYBIT_SYNC_FILLS_READ_DEADLINE_S = 420.0 and its margin pin"
affects: [257-04, 257-05]
key-files:
  modified:
    - analytics-service/services/exchange.py
    - analytics-service/services/job_worker.py
    - analytics-service/tests/test_seedhold_bound.py
    - analytics-service/tests/test_nullanchor_bound.py
key-decisions:
  - "Budget 420 s (planner decision, below RESEARCH's 485 s): a lower budget costs only more runs to catch up, never data."
  - "No persist-time guard; handler cancel above the break-even round trip is rated LOW and left for the phase REVIEW (T-257-10)."
status: complete
actuals:
  tokens: 3100
  tasks: 2
  commits: 2
plan_head_before: c4ee28cbe134b3b2c531f506804450b651bf075f
plan_head_after: fe5040342372d8da409761c0ef11d7aa4ebb6e92
completed: 2026-11-28
---

# Phase 257 Plan 03: the Bybit deadline read-through Summary

A Bybit fills read that hits its deadline now hands back the 7-day windows it completed and the end of the last one; the worker persists them, stamps the newest persisted fill at or before that mark and bounds the next run at the mark (or holds at the seed when no window completed), instead of creeping the bound down 1 h + 1 ms per refusal. The run stays flagged `phase2_fill_ingestion_failed`.

## Commits

| Commit | Subject |
|--------|---------|
| `2b92caa4f` | fix(257-03): a deadline-stopped Bybit fills read keeps its completed windows and advances the bound to them |
| `fe5040342` | fix(257-03): the Bybit sync read gets its own 420 s budget so a deadline stop's persist fits the handler |

`plan_head_before` `c4ee28cbe`, `plan_head_after` `fe5040342`, `git rev-list --count` between them: 2.

## Results, verbatim

Seven Bybit arms (`-k TestBybitDeadlineKeepsWhatItRead`, marks removed), measured after the reader and worker change, as part of the whole module: `tests/test_seedhold_bound.py`: `24 passed, 23 xfailed in 6.36s` (47 arms: the 7 Bybit arms now pass; the 23 xfails are plan 04's `RED_AT_HEAD_HOLD` arms and the permanent `RESIDUAL_DOUBLE_FAULT` marks, untouched). Precondition before the change: `40 deselected, 7 xfailed`.

Ten-file census (`test_seedhold_bound`, `test_nullanchor_bound`, `test_binancefills_cursor`, `test_okxtrades_cursor`, `test_job_worker`, `test_sync_trades_store_truth`, `test_sync_trades_resume_seed`, `test_ana_recon_audit`, `test_exchange`, `test_binancefills_e2e`), final run after both commits' changes:

```
644 passed, 1 skipped, 23 xfailed, 14 warnings in 31.07s
```

The one skip is `tests/test_job_worker.py:4677`, `LANE_DB_URL unset (local dev)`: a database-lane test, pre-existing and not reachable without Docker (this plan runs no database). After Task 1 alone the census read `643 passed, 1 skipped, 23 xfailed` (the extra pass is the new margin pin).

mypy strict, run before each commit, both times: `Success: no issues found in 148 source files`.

Guards: `git diff --quiet "$(git merge-base HEAD origin/main)" -- analytics-service/services/exchange_pagination.py` exit 0; `git diff -U0 ... services/exchange.py | grep -a -c '^@@.*okx'` prints 0 (hunks: exception class x2, `_fetch_raw_trades_bybit` x3, the dedup tail, and the new constant, which sits in the hunk context of no OKX function). Acceptance greps: `self.completed_fills` 1, `self.read_through_ms` 1, `_bybit_read_through_ms` 8 (job_worker), `_fills_persist_failed` 5, `marks=RED_AT_HEAD_BYBIT` 0, the 420.0 line 1, the 840.0 line 1, `INTENT CHANGE 2026-11-28 (Phase 257` 1, `test_nullanchor_bound.py` numstat `5 added, 1 deleted`.

## Search strings (plan 05 neuters by exact text)

| Hunk | File | Exact search text |
|------|------|-------------------|
| deadline-branch attachment | `services/exchange.py` | `refusal.completed_fills = _dedup_on_exec_id(completed_rows)` (and the next line `refusal.read_through_ms = completed_through[0]`) |
| natural-end test | `services/exchange.py` | `if not items or not next_cursor:` (in `_fetch_page`, followed by `completed_rows.extend(window_rows)` and `completed_through[0] = req.window_end`) |
| Phase-2 except arm | `services/job_worker.py` | `raw_fills = list(e.completed_fills)` |
| `_earliest_through` Bybit branch condition | `services/job_worker.py` | `elif _bybit_deadline_stop and not _fills_persist_failed:` |
| `_bybit_partial_ok` disjunct | `services/job_worker.py` | `and (not phase2_failed or _bybit_partial_ok)` (the definition: `_bybit_read_through_ms is not None and phase2_complete and not _fills_persist_failed`) |
| persist-failure marker | `services/job_worker.py` | `_fills_persist_failed = True` (one assignment, in the persist `except Exception as exc:` arm beside `phase2_failed = True`) |
| constant's value line | `services/exchange.py` | `BYBIT_SYNC_FILLS_READ_DEADLINE_S: float = 420.0` |

## Design as built

- Reader: closure state `window_rows`, `completed_rows`, `completed_through` (a one-slot list) declared before `_fetch_page`; the success path's `seen` loop is now the local `_dedup_on_exec_id`, used by the success return and the deadline branch (keep-first, a fill with no execId always kept). A window is recorded complete only on `not items or not next_cursor`; a short page on a live cursor is not an end; a page-cap or stuck-cursor window raises before this point, so it is never counted. `walk_paginated` and `_fetch_raw_trades_okx` are byte-unchanged.
- Worker: `phase2_failed` stays True on a deadline stop. `_read_through` for a Bybit mark is the UTC epoch plus the mark in milliseconds, so the stamp filter keeps only persisted fills at or before it. A persist failure sets `_fills_persist_failed`, which both removes the stamp eligibility and sends `_earliest_through` to the walk start minus 1 ms.
- Bound semantics (CONTEXT [Bybit read-through shape]): mark when a window completed, else the run's seed (the column's `fills_since_ms`, or the reach anchor on a first sync); RPC R4 sets the bound to the passed instant because `covers` (the walk start) is at or below the provisional seed, so the seed value leaves it unchanged and the mark advances it.
- Bybit v5 docs read (`/v5/execution/list`, fetched 2026-11-28): "sorted by execTime in descending order" (so an in-flight window holds its newest fills), `endTime - startTime <= 7 days`, `limit` 1 to 100, paging by `nextPageCursor`; the drop-the-in-flight-window rule rests on exactly that ordering.

## Margin statement

`BYBIT_SYNC_FILLS_READ_DEADLINE_S = 420.0`. Worst case (no time elapsed before the read): `(1 + 4r) x 420 + 25 <= 900`, with 900 s the handler, 10 s the in-flight request, 15 s the tail, persist 2 round trips per 100 fills against 0.5 s per full page. Margin 119 s at r = 0.2 s, 287 s at r = 0.1 s, break-even r about 0.27 s. r is UNMEASURED (assumed 0.05 to 0.2 s). `test_the_bybit_sync_budget_leaves_the_persist_margin` pins the inequality with hand-typed inputs, `== 420.0` and `< 840.0`. The handler cap is not raised.

## Residuals left for plan 05's rating

1. Handler cancel above the break-even round trip (T-257-10, LOW): above r = 0.27 s the cancel can land mid-persist after a deadline stop. The provisional bound still names the seed, upserts are idempotent and no span is lost; the job fails loudly as a timeout and the flag is lost for that run. Record in the phase REVIEW, do not book.
2. Fee-currency data-quality flags of a deadline stop are discarded (the Phase-2 except arm drains them before the completed fills are persisted). The stored fills are correct; only the mixed-currency warning is missing. LOW observability gap; record in the phase REVIEW, do not book.

## Deviations from Plan

None - plan executed exactly as written. Notes that are not deviations: `_fills_persist_failed` counts 5 (the plan predicted at least 3); the `_bybit_read_through_ms` derivation sits just before the `_fills_stopped and _read_through is None` guard, which is after the Binance derivation as specified and is a no-op for Bybit because `_fills_stopped` is Binance-keyed. No stubs, no new threat surface, no new log line carrying fill content, no `data_quality_flags` key added.

## Self-Check: PASSED

- `analytics-service/services/exchange.py`, `analytics-service/services/job_worker.py`, `analytics-service/tests/test_seedhold_bound.py`, `analytics-service/tests/test_nullanchor_bound.py`: modified, all present.
- Commits `2b92caa4f` and `fe5040342` are ancestors of HEAD.
