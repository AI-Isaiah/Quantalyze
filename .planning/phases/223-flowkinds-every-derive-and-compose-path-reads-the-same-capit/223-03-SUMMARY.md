---
phase: 223-flowkinds-every-derive-and-compose-path-reads-the-same-capit
plan: 03
subsystem: analytics-service
tags: [bybit, funding, pagination, C27]
requires: []
provides:
  - "fetch_funding_bybit(..., until_ms=) end bound"
  - "bybit_funding_windows(since_ms, now_ms) public window helper"
affects: [223-04]
key-files:
  created: []
  modified:
    - analytics-service/services/funding_fetch.py
    - analytics-service/tests/test_funding_fetch.py
decisions:
  - "until_ms replaces the walker's now_ms only; _fetch_page, the contract and every other line are unchanged"
status: complete
actuals:
  tokens: 9000
  tasks: 3
  commits: 2
plan_head_before: 62c402d19760cf4b3953fca9cfce99c8bb7c838c
plan_head_after: 9425fb84be545cba8fd3fff86b43d50389401a66
requirements: [FLOWK-02]
---

# Phase 223 Plan 03: Bybit funding end bound and window helper Summary

`fetch_funding_bybit` takes a keyword-only `until_ms`, and a public `bybit_funding_windows` returns the exact (start, end) pairs one full walk uses, both built on the existing `_windows` +1 ms seam.

BASE (plan start): `62c402d19760cf4b3953fca9cfce99c8bb7c838c`.

## Commits

- `fc42fa3d4` feat(223-03): `until_ms` keyword plus the tracer test (Task 1)
- `9425fb84b` feat(223-03): `bybit_funding_windows` plus the four edge pins (Task 2)
- Task 3 (PROOF-01) makes no commit: both neuters were restored byte-identical (`git status --porcelain -- analytics-service` empty).

## Verification

- `tests/test_funding_fetch.py` + `tests/test_bybitreads_census_pins.py`: 81 passed (census C27 pin unedited, existing tests unedited).
- `TestBybitUntilMs`: 5 passed.
- mypy strict (CI command): `Success: no issues found in 142 source files`.
- Tracer RED on pre-change code: `TypeError: fetch_funding_bybit() got an unexpected keyword argument 'until_ms'` (1 failed); GREEN after the keyword: `1 passed`.
- The diff to `funding_fetch.py` touches only the import block, `fetch_funding_bybit` (signature, docstring, `now_ms`) and the new `bybit_funding_windows`.

## PROOF-01

### Cycle A (end bound ignored)

Edit (unified diff vs the byte backup):

```diff
@@ -690,11 +690,7 @@
     """
     dropped = [0]  # boxed for the closure
 
-    now_ms = (
-        until_ms
-        if until_ms is not None
-        else int(datetime.now(timezone.utc).timestamp() * 1000)
-    )
+    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
 
     async def _fetch_page(req: PageRequest) -> PageResult[FundingFeeRow]:
         params: dict[str, str] = {
```

Command: `cd analytics-service && python -m pytest "tests/test_funding_fetch.py::TestBybitUntilMs::test_until_ms_bounds_every_request_and_reads_linear_then_inverse_in_one_window" -q -p no:cacheprovider`

RED:
```
FAILED tests/test_funding_fetch.py::TestBybitUntilMs::test_until_ms_bounds_every_request_and_reads_linear_then_inverse_in_one_window
1 failed in 4.44s
```

Restore: `cp <scratchpad>/p03/funding_fetch.py.bak services/funding_fetch.py; cmp <scratchpad>/p03/funding_fetch.py.bak services/funding_fetch.py; echo "cmp exit $?"`
```
cmp exit 0
```

GREEN: `1 passed in 4.46s`

### Cycle B (helper's window width changed)

Edit:

```diff
@@ -892,7 +892,7 @@
     )
     return [
         (w_start, w_end)
-        for w_start, w_end in _windows(start, now_ms, 7)
+        for w_start, w_end in _windows(start, now_ms, 6)
         if w_start is not None and w_end is not None
     ]
```

Command: `cd analytics-service && python -m pytest "tests/test_funding_fetch.py::TestBybitUntilMs::test_bybit_funding_windows_equals_the_windows_one_walk_sends" -q -p no:cacheprovider`

RED:
```
FAILED tests/test_funding_fetch.py::TestBybitUntilMs::test_bybit_funding_windows_equals_the_windows_one_walk_sends
1 failed in 4.50s
```

Restore and `cmp`: output empty, `cmp exit 0`.

GREEN: `1 passed in 4.46s`

## Deviations from Plan

None - plan executed as written. Notes: the tests import `bybit_funding_windows` inside the two helper tests (not at module top) so the tracer commit stays importable before the helper exists. The plan's `python` was the CI-pinned venv interpreter per the dispatch brief.

## Known Stubs

None.

## Threat Flags

None. T-223-06 mitigated by one `_windows` seam shared by helper and walk, pinned by the helper-equals-walk test and Cycle B; the bound is pinned by Cycle A.

## Self-Check: PASSED

Files and commits `fc42fa3d4`, `9425fb84b` exist on `wt/223-p03`.
