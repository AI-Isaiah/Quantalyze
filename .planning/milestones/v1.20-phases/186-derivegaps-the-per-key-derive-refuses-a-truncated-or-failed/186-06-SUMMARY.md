---
phase: 186-derivegaps-the-per-key-derive-refuses-a-truncated-or-failed
plan: 06
subsystem: analytics-service funding fetch
tags: [derivegaps, funding, sc-7, d-04, d-05, malformed-rows]
requires: ["186-04"]
provides:
  - "FundingRowsMalformed and keyword on_malformed on the three funding fetchers (consumed by plan 186-09)"
  - "Bybit two-leg regression guard"
affects: [186-09]
key-files:
  modified:
    - analytics-service/services/funding_fetch.py
    - analytics-service/tests/test_funding_fetch.py
decisions:
  - "q-g4 no-pairs: the OKX in-memory dedup key is left on match_key; the count is the answer (D-04)."
  - "A Bybit settlement with no funding/change/cashFlow field counts as dropped for on_malformed=raise."
status: complete
commits: 2
plan_head_before: f10dde76be73645a7c529ffb00c9c47916190f3b
plan_head_after: b3a1a0977e3f6ecb50a0497c30e617ce77bcf356
actuals:
  tokens: 9000
  tasks: 2
  commits: 2
---

# Phase 186 Plan 06: funding fetch gates Summary

The SC-1 gate decided Gap 4 needs no dedup change (no same-hour pairs on PROD) and that a dropped malformed funding row refuses the key. So this plan pins the Bybit two-leg behaviour with a guard and adds `FundingRowsMalformed` plus a keyword-only `on_malformed` to the OKX, Bybit and Binance fetchers.

## Gate lines

sc7: no-change (q-g4: no-pairs; g4-pairs okx=0 bybit=0)
malformed: raise-mode (red seen)

## Task 1: SC-7 (no-pairs branch)

`186-04-SUMMARY.md` holds `q-g4: no-pairs` and `g4-pairs: okx=0 bybit=0 same_id=110`. Under D-04 the dedup key in `fetch_funding_okx` stays `match_key`, so the plan wrote only the Bybit guard (`TestBybitKeepsBothSameHourLegs`). `_build_match_key`, `upsert_funding_rows` and the `funding_fees` UNIQUE key are untouched, and there is no migration.

Guard honesty: it is green today by design. Neuter check: adding a `match_key` dedup to `fetch_funding_bybit` made it FAIL (log `neuter-06-0.log` in the DG_SP cache), then the file was restored byte-equal (`cmp`). The `[186-FUNDING-FEES-SAME-HOUR-LEG]` booking from the gate still owns the table-side collapse.

## Task 2: D-05 funding half (refuse branch)

`g1-malformed-final: refuse`. Added in `services/funding_fetch.py`:
- `class FundingRowsMalformed(RuntimeError)`; the message is `<venue> funding read dropped <n> malformed row(s)` and carries no symbol, amount, row id or strategy id (T-186-15; a test asserts the absence of each).
- keyword-only `on_malformed: Literal["drop", "raise"] = "drop"` on `fetch_funding_binance`, `fetch_funding_okx` and `fetch_funding_bybit`. The raise happens after the existing WARNING, so the default log line is unchanged.
- the dispatcher `fetch_funding` and every caller are unchanged (a test pins that the dispatcher has no `on_malformed`); plan 186-09 passes the keyword in the derive only.

RED first: 10 of 11 new tests failed before the change (`red-06-2.log`; the 11th, the dispatcher-signature pin, is green by design). Neuter on the Bybit missing-field count made its test FAIL (`neuter-06-2.log`), restored byte-equal.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] A Bybit row with no funding/change/cashFlow field was skipped without counting**
- **Found during:** Task 2
- **Issue:** the pre-existing `continue` for a row carrying none of the three amount fields logged a line but did not touch the `dropped` counter, so `on_malformed="raise"` would have accepted a walk that was short by that settlement (the same silent truncation D-05 refuses).
- **Fix:** that branch now increments `dropped[0]`. In default mode this only changes the count printed by the existing `dropped %d malformed rows` WARNING (existing tests assert only on rows with a bad symbol or amount and still pass); the returned rows are identical.
- **Files modified:** analytics-service/services/funding_fetch.py, analytics-service/tests/test_funding_fetch.py
- **Commit:** b3a1a0977

## Verification

- `tests/test_funding_fetch.py`: 73 passed.
- Every test file importing `funding_fetch` (27 files) plus `tests/test_okx_archive_job.py`: 1547 passed, 1 skipped.
- Full suite `python -m pytest -q -n auto --dist loadgroup` (venv python): 13553 passed, 97 skipped, 0 failed.
- CI mypy line, verbatim: `Success: no issues found in 131 source files`.

## Known Stubs

None.

## Threat Flags

None. T-186-14 (OKX dedup) is not exercised on the no-pairs branch; T-186-15 is mitigated by the message-shape test.

## Self-Check: PASSED

- analytics-service/services/funding_fetch.py contains `class FundingRowsMalformed`: FOUND
- commits 0373c5605 and b3a1a0977 are ancestors of HEAD: FOUND
