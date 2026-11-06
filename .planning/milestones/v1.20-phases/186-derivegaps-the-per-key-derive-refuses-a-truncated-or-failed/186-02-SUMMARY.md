---
phase: 186-derivegaps-the-per-key-derive-refuses-a-truncated-or-failed
plan: 02
subsystem: analytics-service tooling
tags: [probe, read-only, okx, bybit, binance, realized-read, sc-1]
status: complete

requires:
  - phase: 184-walletoffset
    provides: scripts/walletoffset_probe.py (ReadOnlySupabase, record/emit pattern, fingerprint)
provides:
  - "analytics-service/scripts/derivegaps_probe.py: the SC-1 Gap 1 section (skeleton, realized read, continuation past the caps, Bybit limit probe)"
  - "analytics-service/tests/test_derivegaps_probe.py: 40 offline tests (36 test functions)"
affects: [186-03, 186-04, 186-05]

plan_head_before: 57d07c9499a7436200d42d1de1f69b3c3e9b5dad
plan_head_after: f3839d861d2ee514664b2f47437dbd719d6d06f6

actuals:
  tokens: 20000
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns: [GET-only recording exchange view, closed-vocabulary emitter, in-coroutine DQ buffer drain]

key-files:
  created:
    - analytics-service/scripts/derivegaps_probe.py
    - analytics-service/tests/test_derivegaps_probe.py
  modified: []

key-decisions:
  - "The DQ buffer is drained INSIDE the timed coroutine (immediately after fetch_all_trades returns), not after asyncio.wait_for, so the flags are this read's own on every Python version."
  - "A realized timeout is a measured key (realized_state timeout, flags field-absent), not an unmeasurable one; a spent call budget during the realized read IS unmeasurable (call_ceiling), but during the continuation it is a lower bound."
  - "Keys the backfill does not derive are recorded key_not_eligible and do not fail the run; a summary key keys_not_eligible makes that visible (additive to the plan's summary list)."

duration: ~1h
completed: 2026-11-03
---

# Phase 186 Plan 02: Derivegaps probe, skeleton and Gap 1 section Summary

**A read-only worker-side probe that runs the derive's own `fetch_all_trades(view, since_ms=None)` per eligible OKX, Bybit and Binance key, drains the same DQ buffer, and records realized state, page counts, timing, the pages a truncated key's full history needs and whether Bybit honours `limit: 200`.**

## What was built

- `ReadOnlyRecordingExchange(inner, ceiling)`: resolves only the plain attributes `id`, `markets`, `has`, `options`, `rateLimit`, the implicit GET prefixes and a closed read list; counts calls and refuses the one past `KEY_CALL_CEILING` (`ceiling_reached` reads True so a spent budget is told apart from a venue failure); keeps each successful reply and its request in memory, never printed.
- `measure_realized`: real `fetch_all_trades`, state `complete | truncated | fetch_error | timeout`, the four flags, closed `fetch_error_class`, rows, days, oldest-age bucket, per-venue page counts (OKX per instType on bills and archive, Bybit per window), elapsed seconds, seconds per page, equity-read timing (the equity value is kept on the view for plan 186-03).
- `measure_past_cap`: for a truncated key, continues each capped walk on the same endpoint and params with the `after` / `cursor` taken from the last recorded page, up to `CONTINUATION_PAGE_CEILING`, and records `pages_needed_*`, `past_cap_reached_end`, `past_cap_oldest_age`.
- `measure_bybit_limit`: two GETs on the most recent 7-day window at `limit` 200 and 100 with the derive's own params.
- `emit_record` / `validate_record` over a closed vocabulary (34 key-record keys, 33 summary keys), `deploy_fingerprint`, `run`, `main`.

Fingerprint at the reviewed commit: `derivegaps 0 1 34 33 5 4 okx,bybit,binance`

`ReadOnlyRecordingExchange` allows these reads:
- plain attributes: `id`, `markets`, `has`, `options`, `rateLimit`
- implicit GET prefixes: `private_get_`, `public_get_`, `fapiPrivate_get_`, `fapiPublic_get_`, `fapiPrivateGet`, `fapiPublicGet`
- unified reads: `fetch_deposits`, `fetch_withdrawals`, `fetch_balance`, `fetch_my_trades`, `load_markets`

Plan 186-03 adds to `_READ_METHODS` / `_GET_PREFIXES` if its Gap 2 and Gap 4 readers call anything else.

## Verification

- `pytest tests/test_derivegaps_probe.py`: 40 passed (36 test functions; with `tests/test_walletoffset_probe.py` 218 passed).
- `mypy --strict ... scripts/derivegaps_probe.py`: Success, no issues found in 1 source file.
- CI mypy line (`services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`): Success, no issues found in 131 source files.
- Text pin `grep -anE 'private_post_|create_order|cancel_order|withdraw\(|transfer\(|\.(insert|upsert|delete|rpc)\(|enqueue'` over the probe prints nothing; `git diff --name-only -- analytics-service/services` prints nothing.
- The probe was NOT run against any venue or database (plan 186-04 owns the run).

## Deviations from Plan

- Additive: summary key `keys_not_eligible` (a key the backfill does not derive is recorded and does not fail the exit code; without the key the summary could not distinguish it from a measured one). `keys_unmeasurable` therefore counts eligible keys only.
- Additive: `measure_realized`, `measure_past_cap` take an optional `run_day` (the age buckets need the run date); `measure_past_cap` also takes the realized walks the view recorded before any continuation.
- Additive: `EQUITY_READ_TIMEOUT_S` and `KEY_TOTAL_TIMEOUT_S` bound the equity read and a whole key.
- Plan 05 will hoist the derive's function-local caps to module constants; until then the probe holds copies (`TODAY_OKX_PAGE_CAP`, `TODAY_OKX_PAGE_ROWS`, `TODAY_BYBIT_PAGE_CAP`) and a cap hit is detected by the derive's own test (last allowed page read, full for OKX, still has a moving cursor for Bybit).

## Known limits

- A page count counts successful replies. A 429 retry inside the derive's backoff is counted against the call ceiling but is not a page.
- The shared 3000-call ceiling also bounds the continuation: a heavy Bybit key may read `past_cap_reached_end` False from the ceiling rather than from `CONTINUATION_PAGE_CEILING`; both mean the page counts are lower bounds.
- An OKX history that is an exact multiple of 100 bills per instType reads truncated (the derive's accepted over-refusal); the probe reports the derive's verdict.

## Known Stubs

None.

## Threat Flags

None. The probe adds no network endpoint or auth path; it reads through the GET-only view and the select-only database handle (T-186-03, T-186-04, T-186-05 mitigated and tested).

## Self-Check: PASSED

- FOUND: analytics-service/scripts/derivegaps_probe.py
- FOUND: analytics-service/tests/test_derivegaps_probe.py
- FOUND commits: 1d28a1de7 (tracer: skeleton and Gap 1), f3839d861 (continuation and Bybit limit)
