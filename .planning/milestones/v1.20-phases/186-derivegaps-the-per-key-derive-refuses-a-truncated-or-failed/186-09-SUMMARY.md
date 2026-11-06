---
phase: 186-derivegaps-the-per-key-derive-refuses-a-truncated-or-failed
plan: 09
subsystem: analytics-service (per-key derive refusal)
tags: [derivegaps, derive-broker-dailies, read-incomplete, dq-flags, d-05, sc-2, sc-6]
status: complete

requires:
  - phase: 186-04
    provides: "gate: proceed; g1-malformed-final: refuse"
  - phase: 186-05
    provides: "daily_pnl_read_verdict, DailyPnlReadVerdict"
  - phase: 186-06
    provides: "FundingRowsMalformed, on_malformed keyword on the three funding fetchers"
  - phase: 186-08
    provides: "copy-answer-strategy sentence"
provides:
  - "services/job_worker.py: READ_INCOMPLETE_KIND_PREFIX, READ_INCOMPLETE_TOKENS, _record_read_incomplete, _clear_read_incomplete, _enqueue_allocator_compose, the drain and refusal in run_derive_broker_dailies_job"
  - "row family read_incomplete:<api_key_id> in allocator_equity_derived (owner-only, no migration)"
affects: [186-10, 186-11, 186-13, 186-14]

key-files:
  modified:
    - analytics-service/services/job_worker.py
    - analytics-service/tests/test_derive_broker_dailies_dualmode.py

key-decisions:
  - "D-05: a truncated or failed realized or funding read writes nothing for the key (no csv_daily_returns, key_inputs, nav mark, compose-from-csv enqueue); the key is named, the last good stored days stay"
  - "Disposition: truncation, Binance income fallback, funding ceiling and malformed funding rows are PERMANENT; a daily-pnl fetch error is TRANSIENT; a swallowed rate limit re-raises ccxt.RateLimitExceeded for the existing 429 arm"

plan_head_before: c48526579a27ccf2a00703ea5b088f6228bfa9df
plan_head_after: d1755764b583a3ec6cb587a13b33b986bb349bc2
commits: 2

actuals:
  tokens: 11000
  tasks: 2
  commits: 2
---

# Phase 186 Plan 09: The per-key derive refuses a truncated or failed read by name Summary

`run_derive_broker_dailies_job` now drains the DQ buffer on the statement right after the realized read and refuses a truncated or failed realized or funding read by name: nothing is written for the key, key mode records an owner-only `read_incomplete:<api_key_id>` marker and enqueues the compose, strategy mode stamps the founder-approved sentence with `heal_series=False`.

## Token set as shipped

`READ_INCOMPLETE_TOKENS` (closed, 7 names): `daily_pnl_fetch_error`, `daily_pnl_truncated_okx`, `daily_pnl_truncated_bybit`, `daily_pnl_binance_income_fallback`, `funding_truncated`, `funding_fetch_error`, `funding_rows_malformed` (included because 186-04 `g1-malformed-final: refuse`).

| Cause | Token | error_kind |
|---|---|---|
| OKX / Bybit truncation, Binance income fallback | the daily-pnl flag name | permanent |
| realized read failed (non rate limit) | `daily_pnl_fetch_error` + class name | transient |
| realized read rate limited | none (raises `ccxt.RateLimitExceeded`, `_stamp_429` once, no marker) | n/a |
| funding page ceiling (`PaginationCeilingExceeded`) | `funding_truncated` | permanent |
| `FundingRowsMalformed` (fetchers called with `on_malformed="raise"`) | `funding_rows_malformed` | permanent |
| any other non-rate-limit funding exception | `funding_fetch_error` + class name, marker only, SAME exception re-raised | dispatcher's own classification |

Marker payload: `{token, error_class, first_seen_day, last_seen_day}`; the class is kept only when it matches the identifier regex. Written like `_record_nav_mark_refusal` (never raises, first_seen carried, upsert on `allocator_id,kind`), cleared after the `key_inputs` upsert on the next clean key-mode derive. `allocator_id` is `ctx.key_row["user_id"]`.

## Tasks

1. Tracer: drain + `_refuse_incomplete_read`, marker helpers, `_enqueue_allocator_compose` lifted out of the epilogue closure. Commit `c2ffed29a`.
2. Funding naming (narrow `try` around the three venue arms), strategy-mode stamp, marker cleared after `key_inputs`. Commit `d1755764b`.

## RED before GREEN

- Task 1: 20 of the 22 new tests FAILED on the unchanged code (`red-09-1.log`; realized-read cases returned DONE and the helpers did not exist). The 2 that pass today are deliberate pins (a clean read is not refused; a funding rate limit is not marked).
- Task 1 neuter: drain replaced by `daily_pnl_read_verdict({})`, 7 of 8 `TestRealizedReadRefusedByName` tests FAILED (the 8th is the clean-read pin), restored from a byte backup, `cmp` equal (`neuter-09-1.log`).
- Task 2: the 9 Task 2 tests FAILED on the Task 1 tree (`red-09-2.log`), then passed.

## Verification

- `pytest tests/test_derive_broker_dailies_dualmode.py tests/test_job_worker.py tests/test_stamp_io_exhaustive.py tests/test_ledger_refresh_publish_guard.py tests/test_ledger_refresh_gates.py tests/test_ledger_refresh_nondestructive.py`: 372 passed, 1 skipped.
- Full suite `python -m pytest -q -n auto --dist loadgroup`: 13702 passed, 97 skipped, 0 failed.
- CI mypy line: `Success: no issues found in 131 source files`.
- Test counts: `test_derive_broker_dailies_dualmode.py` 34 existing + 22 new = 56.
- `data_quality_flags` appears in 0 added lines of job_worker.py; the approved sentence is in job_worker.py verbatim (verify grep OK).

## Deviations from Plan

**1. [Naming] The drain's local is `_realized_verdict`, not `_verdict`**
- **Issue:** `run_derive_broker_dailies_job` already assigns `_verdict = meta.get("series_completeness")` further down; reusing the name made `mypy --strict` fail (2 errors, Any assigned to a `DailyPnlReadVerdict`).
- **Fix:** the line is `_realized_verdict = daily_pnl_read_verdict(get_and_clear_last_dq_flags())`. The plan's verify grep `_verdict = daily_pnl_read_verdict\(get_and_clear_last_dq_flags\(\)\)` is unanchored and matches it.

**2. Tests**: `tests/test_stamp_io_exhaustive.py` and `tests/test_ledger_refresh_publish_guard.py` needed no registration for the new stamp literal (it is a first-positional string literal on a textual `await _stamp_strategy_analytics_failed(` site, which both censuses already measure); neither file changed.

No other deviation. `_stamp_429`, the outer `except ccxt.RateLimitExceeded` and `finally: aclose_exchange` are untouched; the refusal returns inside the existing `try`, so the exchange still closes.

## Known Stubs

None.

## Threat Flags

None. T-186-21 (closed token + class name only, asserted with a signed-URL-shaped class slot), T-186-22 (marker `allocator_id` asserted `alloc-fh` from the key row), T-186-23 (drain is the next statement; neuter proof bites), T-186-24 (only a fetch error is transient) are mitigated and tested.

## Notes for downstream plans

- 186-11 reads `READ_INCOMPLETE_KIND_PREFIX`; a `funding_fetch_error` marker is written without a compose enqueue (the job retries; the next clean derive clears it).
- No migration added.

## Self-Check: PASSED

- Commits `c2ffed29a` and `d1755764b`: both ancestors of HEAD.
- `analytics-service/services/job_worker.py`, `analytics-service/tests/test_derive_broker_dailies_dualmode.py`: FOUND.
