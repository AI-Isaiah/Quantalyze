---
phase: 123-flipretry-derived-equity
plan: 01
subsystem: infra
tags: [asyncio, worker, timeout, deribit, ccxt, wait_for, event-loop]

# Dependency graph
requires:
  - phase: 120-sfox-broker-dailies
    provides: "The sFOX FLIPRETRY-01 wait_for mirror pattern (_SFOX_CRAWL_TIMEOUT_S, transient-classified TimeoutError arm) copied verbatim for the deribit + ccxt venues"
provides:
  - "Every derived-equity exchange crawl in run_derive_broker_dailies_job (deribit cash pass, ccxt transfers ×2, ccxt price-index) is hard-bounded by asyncio.wait_for → classified transient FAILED on hang, never an unbounded event-loop wedge"
  - "The legacy reconstruct orchestrating crawl (_fetch_and_price_window) is defensively wait_for-bounded (A4 mitigation: both pipelines guarded)"
  - "Fake-hang regression tests proving each bound fires transient (deribit / ccxt-transfers / ccxt-price-index / reconstruct) + a behavior-neutral non-timeout-still-permanent test"
affects: [123-02 dedicated worker, 123-03 ground-truth gate, FLIPRETRY retry go-live]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-crawl asyncio.wait_for bound with a dedicated `except asyncio.TimeoutError` arm ordered BEFORE any broader/permanent-stamping catch (3.11+ TimeoutError IS OSError)"

key-files:
  created:
    - analytics-service/tests/test_job_worker_flipretry.py
  modified:
    - analytics-service/services/job_worker.py
    - analytics-service/services/equity_reconstruction.py

key-decisions:
  - "300s per-crawl bound for the deribit/ccxt venues (BROKER_CRAWL_TIMEOUT_S), mirroring the landed sFOX 300s; 1500s (25 min) for the reconstruct window crawl (RECONSTRUCT_CRAWL_TIMEOUT_S) since a 500-page window crawl is legitimately long, both env-overridable"
  - "The new deribit TimeoutError arm is placed FIRST in the :2309 except chain (before the LedgerCompleteness/LedgerValuation/Nav permanent arms) so a timeout can never mis-dispose permanent — pinned by the deribit test asserting error_kind=='transient'"
  - "A single shared TimeoutError arm wraps all three ccxt awaits; the pure ccxt_rows_to_dated_flows valuer (HIGH-1 permanent NavReconstructionError) stays OUTSIDE the wait_for wrap, preserving WR-04 (non-timeout fetch errors still bubble to the dispatcher classifier)"

patterns-established:
  - "wait_for-bound crawl + transient-classified TimeoutError arm: static scrubbed logger.warning only (never logger.exception / interpolated crawl content, H-3 leak class), DispatchResult(FAILED, error_kind='transient'), no terminal _stamp_strategy_analytics_failed"

requirements-completed: [FLIPRETRY-01]

# Metrics
duration: 40min
completed: 2026-07-19
---

# Phase 123 Plan 01: FLIPRETRY-01 crawl wait_for bounds Summary

**Every unwrapped derived-equity exchange crawl (deribit native-ledger cash pass, ccxt transfers ×2, ccxt price-index, + the legacy reconstruct window crawl) is now hard-bounded by `asyncio.wait_for` and classified transient on hang — closing the v1.11 FLIP wedge root cause where a slow live crawl blocked the SEQUENTIAL worker's single event loop.**

## Performance

- **Duration:** ~40 min
- **Tasks:** 2 completed (both TDD, RED-first)
- **Files modified:** 2 source + 1 new test file

## Accomplishments

- **Task 1 (load-bearing):** Added module constant `_BROKER_CRAWL_TIMEOUT_S` (env `BROKER_CRAWL_TIMEOUT_S`, default 300) next to `_SFOX_CRAWL_TIMEOUT_S`. Wrapped the deribit cash-pass `build_deribit_native_ledger` await (C1) and both `fetch_ccxt_transfers` awaits + `_resolve_ccxt_flow_price_index` (C2/C3) in `asyncio.wait_for`. Added a deribit `except asyncio.TimeoutError` arm **first** in the :2309 chain and one shared ccxt TimeoutError arm — both return `DispatchResult(FAILED, error_kind="transient", "(FLIPRETRY-01)")` with a static scrubbed `logger.warning`, no terminal stamp.
- **Task 2 (defensive):** Added `_RECONSTRUCT_CRAWL_TIMEOUT_S` (env `RECONSTRUCT_CRAWL_TIMEOUT_S`, default 1500) in equity_reconstruction.py and wrapped the single `_fetch_and_price_window` orchestrating crawl in `asyncio.wait_for`, with an `except asyncio.TimeoutError` arm placed **before** the broader `except Exception`, returning transient FAILED + `reconstruct_failed` audit.
- 4 new fake-hang tests (deribit / ccxt-transfers / ccxt-price-index / reconstruct) each assert transient FAILED within a monkeypatched sub-second bound + wall-clock timeout; a 5th behavior-neutral test proves a fast structural `LedgerValuationError` still disposes **permanent** (the wrap only intercepts timeouts). Plus source-scan gates for the wait_for sites, the constant, and no-logger.exception.

## Verification

- `pytest tests/test_job_worker_flipretry.py tests/test_job_worker.py tests/test_sfox_reconstruct.py -q` → **182 passed, 1 skipped**.
- Full analytics suite: **4040 passed, 96 skipped**.
- `git diff` hunks are confined to :196 (constant), the deribit cash pass, the new deribit TimeoutError arm (inserted after the untouched MTM block), and the ccxt branch. The sFOX block (:2662-2698) and the deribit MTM second pass (:2472) are **byte-identical** (no hunks there).
- Arm ordering confirmed: **the deribit timeout disposes `error_kind="transient"` (NOT "permanent")** — the dedicated `except asyncio.TimeoutError` precedes every broader permanent-stamping arm.
- mypy `--strict --follow-imports=silent services/ routers/ models/`: **0 new errors** introduced (the 12 reported errors are pre-existing branch tech-debt in sfox_client.py / sfox_read.py / a job_worker.py:730 `pd` false-positive, identical with these changes stashed).

## Deviations from Plan

None — plan executed exactly as written (both tasks, TDD RED→GREEN, sfox/MTM byte-identical, transient classification, arm ordering per the plan-checker addendum).

## Known Stubs

None.

## Deferred Issues

- Pre-existing mypy `--strict` errors on this v1.12 branch (12 total, all in sfox_client.py / sfox_read.py / a job_worker.py `pd` isolated-file false-positive) are unchanged by this plan and out of scope (sfox phases 118-122). Logged for a future type-hardening pass.

## Notes for Downstream (123-02 / 123-03)

- Per-crawl bounding is **necessary but not sufficient** on the shared worker: a claimed batch of 5 bounded jobs can still freeze `LAST_TICK_AT` for up to 5×bound. The dedicated off-sequential worker (123-02) remains the load-bearing healthz guarantee; a truly non-yielding (sync/CPU) await inside a crawl also cannot be cancelled by `wait_for`.
- The founder must verify the 300s / 1500s bounds against a real deribit-inception / bybit-19k crawl duration before the live enqueue (assumption A1).

## Self-Check: PASSED

- FOUND: analytics-service/tests/test_job_worker_flipretry.py
- FOUND: .planning/phases/123-flipretry-derived-equity/123-01-SUMMARY.md
- FOUND commit 40710e1d (Task 1: deribit + ccxt bounds)
- FOUND commit f6a46d50 (Task 2: reconstruct bound)
