---
phase: 186-derivegaps-the-per-key-derive-refuses-a-truncated-or-failed
plan: 13
subsystem: analytics-service composite member derive
tags: [composite, stitch, q-composite, book, sc-2, sc-3]
status: complete

requires:
  - phase: 186-04
    provides: "gate: proceed; q-composite: book; g2-flow-final: replace"
provides:
  - "Recorded outcome: the composite member path is byte-unchanged because q-composite is book; the gap stays booked as [186-COMPOSITE-MEMBER-READ-GAPS]"
affects: [186-14]

plan_head_before: 28e3268c81215a149ad8b478f522f76e7dfabcbc
plan_head_after: 28e3268c81215a149ad8b478f522f76e7dfabcbc
commits: 0

actuals:
  tokens: 0
  tasks: 2
  commits: 0

tech-stack:
  added: []
  patterns: []

key-files:
  modified: []

key-decisions:
  - "q-composite: book (186-04 gate, no PROD exposure: 186-01 composite_strategies_with_ccxt_member is 0). Both tasks take the plan's book branch: no code, no test change."
---

# Phase 186 Plan 13: Composite member parity Summary

The composite member derive (`_reconstruct_ccxt_member`, called by `run_stitch_composite_job`) is left exactly as it was, because the gate answer this plan branches on is `q-composite: book`. Nothing was edited in `services/job_worker.py` or `tests/test_stitch_composite_job.py`.

## Gate read

`186-04-SUMMARY.md` holds one `q-composite:` line, `q-composite: book (no PROD exposure) (no question: 186-01 composite_strategies_with_ccxt_member is 0)`, and `gate: proceed`. `g2-flow-final: replace`. The gap is booked in `TODOS.md` as `[186-COMPOSITE-MEMBER-READ-GAPS]` (confirmed present at execution time).

## Task results

composite: no-change (q-composite: book)

composite-flows: no-change (q-composite: book)

- Task 1 (member drain, `realized_read_incomplete`): not applied. The reason string is absent from the composite path. A grep of `services/job_worker.py` for `realized_read_incomplete` returns no hit, which is the baseline the plan's book-branch verify requires.
- Task 2 (Bybit member Unified flow source): not applied. `_reconstruct_ccxt_member` is unchanged.
- No RED logs exist for 13-1 or 13-2: the include-only tests were not written, as the plan specifies under `book`.

## Verification (from `analytics-service/`)

- Composite suites: `tests/test_stitch_composite_job.py tests/test_stitch_composite.py tests/test_stitch_flow_agreement.py` -> `150 passed, 106 warnings`.
- Full suite: `pytest -q -n auto --dist loadgroup` -> `13725 passed, 97 skipped, 1159 warnings in 243.68s`. No failures. The 97 skips are pre-existing and are not touched by this plan.
- CI mypy line verbatim -> `Success: no issues found in 131 source files`.

## Deviations from Plan

None - plan executed exactly as written (book branch). There are no per-task commits because both tasks are record-only; the only commit is this SUMMARY.

## Known Stubs

None.

## Threat Flags

None. T-186-34 and T-186-35 are dispositioned `mitigate` for the `include` branch only; under `book` the gap is booked by name at the 186-04 gate, as the register states.

## Self-Check: PASSED

- `186-04-SUMMARY.md` `q-composite: book` line found; the two `composite*:` lines in this file are `no-change` and agree with the gate.
- `realized_read_incomplete` absent from `analytics-service/services/job_worker.py`; `git status` shows no code change.
