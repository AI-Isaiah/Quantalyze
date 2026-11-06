---
phase: 186-derivegaps-the-per-key-derive-refuses-a-truncated-or-failed
plan: 07
subsystem: analytics-service compose
tags: [allocator-equity, compose, failing-key, departed-key, d-03, d-07, sc-4, sc-6]
status: complete

requires:
  - phase: 186-04
    provides: "gate: proceed"
provides:
  - "services/allocator_equity_compose.py: FAILING_KEY_EXIT_REASONS, _FAILING_KEY_EXITED, keyword failing_key_exit_by_key, payload field failing_key_exits"
  - "tests/test_allocator_equity_failing_key_exit.py: the naming contract, the SC-4 oracle, the SC-6 null day"
affects: [186-08, 186-11, 186-12]

plan_head_before: f10dde76be73645a7c529ffb00c9c47916190f3b
plan_head_after: d34f5e07671823d70a04610e9526df5e49f4e26d

actuals:
  tokens: 3800
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns: [name-only keyword beside an existing exit path, benign flag token never a DegradeReason, additive payload field absent when empty]

key-files:
  created:
    - analytics-service/tests/test_allocator_equity_failing_key_exit.py
  modified:
    - analytics-service/services/allocator_equity_compose.py

key-decisions:
  - "D-07 (Discretion 3): the exit reuses the departed-key path (departed_end_by_key); this plan adds only the name. No sibling exit and no new compose math."
  - "Validation raises ValueError for any unknown reason or non-ISO day, including a non-string day, so a malformed name from the job is loud and never repaired."
  - "Every entry in the map is listed (a key that never counted carries day null); unlike no_capital_exited_keys it is not filtered by departed_present."

patterns-established:
  - "The writer half of the failing_key_exits contract that plan 186-08 parses: {api_key_id, reason, day}, sorted by key id, flag token failing_key_exited."

requirements-completed: [SC-4, SC-6]

duration: ~25min
completed: 2026-11-03
---

# Phase 186 Plan 07: Failing-key exit naming in the compose Summary

`compose_allocator_equity` now takes `failing_key_exit_by_key` and writes `payload["failing_key_exits"]` plus the benign flag `failing_key_exited`, so a key the book stopped counting is named with a closed reason and its last counted day, while the exit itself stays the existing `departed_end_by_key` path and no math changes.

## What was built

- `FAILING_KEY_EXIT_REASONS = {"sync_failing", "read_incomplete"}` and `_FAILING_KEY_EXITED = "failing_key_exited"` beside `_NO_CAPITAL_KEY_EXITED`.
- Keyword `failing_key_exit_by_key: Mapping[str, tuple[str, str | None]] | None`, validated at entry (reason in the closed set, day `None` or an exact ISO `YYYY-MM-DD` string, else `ValueError`).
- Payload field `failing_key_exits: [{api_key_id, reason, day}]`, sorted by key id, present only when non-empty; the flag token is added only then. It is a flag, never a `DegradeReason` (`grep -an failing_key_exited services/allocator_equity_derive.py` prints nothing), so `is_trustworthy` is unaffected. The entry carries no amount, level or venue (T-186-16).
- Docstring extended: the keyword names, it changes no math, `day` is the last counted day or `None`.

## Tests (15 collected across 10 `def test_`)

SC-4 oracle (independent invariant, hand-computed): A (40,000 flat, days 1 to 3) exits; B (60,000 at day 5, +1% daily). After the exit the book return on 06-04 and 06-05 is 0.01 within 1e-12. The control without the exit reads between 0.005 and 0.007 (about 0.00598). The exit leaves as an outflow of 40,000: the curve steps to B's level, and the Modified-Dietz scalar equals `(60,000 - B1) / (40,000 + B1 - 0.25 * 40,000)` and is positive, so it reads as a flow, not a loss. SC-6: a key with no returns and no anchor is listed with `day: null` and changes no return or curve value. Also covered: sorting, the closed vocabulary, no extra entry keys, five invalid inputs, absent and empty leave the payload (flags, returns, curve) unchanged, and a no-capital fallback (a refused candidate taken back out as `dropped_key`) leaves the failing key's name and its exit intact.

RED/GREEN record:
- Task 1: first run into `red-07-1.log` was a collection ERROR (the import of `FAILING_KEY_EXIT_REASONS` failed), the keyword did not exist. Then GREEN.
- Task 2: first run into `red-07-2.log` was `15 passed`, because Task 1's implementation already delivered every Task 2 behavior (validation and sorting were written in Task 1). None of the Task 2 tests were RED on first run. To prove they can fail, three neuters were applied against a byte backup and each turned the right test RED: reason check disabled (reason case fails), entries reversed (sort test fails), day check disabled (the four day cases fail); the file was restored byte-for-byte.
- Task 1 oracle neuter: removing the `payload["failing_key_exits"]` write failed the oracle test.

## Verification

- Compose suites (every `tests/` file importing `allocator_equity_compose`, plus returns, inception and the derive job suite): 629 passed.
- CI mypy line, verbatim: `Success: no issues found in 131 source files`.
- Full suite `python -m pytest -q -n auto --dist loadgroup` from `analytics-service/` with the shared venv: `1 failed, 13555 passed, 97 skipped` in 462.94s. The one failure is `tests/test_csv_validation_off_event_loop_170_1.py::test_legacy_route_keeps_the_loop_responsive_during_a_slow_validation`, a wall-clock event-loop responsiveness test. It passes in isolation (`7 passed`) and does not touch the compose; it is load-sensitive under `-n auto` on this machine. Not in this plan's scope; no change made.

## Deviations from Plan

None - plan executed as written. One note: Task 2 had no RED first run (see above), which the plan anticipated.

## Known Stubs

None.

## Threat Flags

None. The new payload entry is key id, closed reason and ISO day only (T-186-16); the job (plan 186-11) is what sets the name and the exit together (T-186-17).

## Self-Check: PASSED

- FOUND: analytics-service/services/allocator_equity_compose.py (contains `failing_key_exits`)
- FOUND: analytics-service/tests/test_allocator_equity_failing_key_exit.py
- FOUND commits a2e35f827 and d34f5e076 on agent-186-p07
