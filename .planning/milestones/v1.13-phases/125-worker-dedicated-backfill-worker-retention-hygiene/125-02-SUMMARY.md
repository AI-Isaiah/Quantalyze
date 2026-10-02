---
phase: 125-worker-dedicated-backfill-worker-retention-hygiene
plan: 02
subsystem: testing
tags: [pytest, asyncio, worker, healthz, tcp, wait_for, deribit, flipretry]

# Dependency graph
requires:
  - phase: 123 (FLIPRETRY groundwork, landed in v1.12)
    provides: "asyncio.wait_for crawl bounds (_BROKER_CRAWL_TIMEOUT_S), mid-dispatch heartbeat (_HEARTBEAT_INTERVAL_S / LAST_TICK_AT), role-aware claim (WORKER_CLAIM_ROLE / BACKFILL_KINDS)"
provides:
  - "End-to-end WORKER-02 regression proof: real dispatch_tick + real heartbeat + real healthz TCP server + genuinely-hung crawl, composed"
  - "Real-socket healthz honesty test (200 mid-backfill, 503 when stale)"
  - "Production-seam transient-classification proof for a bounded hung crawl"
  - "Role-disjointness proof (backfill/interactive claim scopes provably disjoint)"
affects: [129-FLIP, worker-hardening, WORKER-02]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Bind the REAL start_healthz_server on an ephemeral port and probe over a raw asyncio.open_connection socket — no HTTP client dependency, no mocked server"
    - "Production-seam oracle: drive the real dispatch path against a hung crawl and assert ONLY the returned DispatchResult (never re-type the classification in the test — P115 anti-pattern)"

key-files:
  created:
    - analytics-service/tests/test_worker_isolation_e2e.py
  modified: []

key-decisions:
  - "Hung the cash-pass crawl (build_deribit_native_ledger) rather than the anchor read named in the plan — empirical probe proved the anchor read (fetch_deribit_native_account_state) classifies error kind 'unknown', NOT 'transient'; the cash-pass crawl is the genuine production 'transient' seam (job_worker.py:2649)"
  - "fetch_deribit_native_account_state is still patched (to a VALID anchor) so execution reaches the cash pass — the plan's stated patch target is honored, only the HUNG awaitable moved to the seam that actually classifies transient"
  - "Zero production-file changes — main_worker.py / main_worker_healthz.py / services/job_worker.py are read-only (re-implementing the v1.12 groundwork is the phase's named failure mode)"

patterns-established:
  - "Regression-first hung-crawl test: the crawl awaits an unset asyncio.Event, so removing the production wait_for bound makes the test hang → the outer 5s test-body guard fails fast (the test cannot pass without the groundwork)"
  - "Every test save/restores main_worker_healthz.LAST_TICK_AT and the fallback-latch module globals in finally for order-independence"

requirements-completed: [WORKER-02]

# Metrics
duration: ~40min
completed: 2026-07-19
---

# Phase 125 Plan 02: Worker Isolation E2E Proof Summary

**WORKER-02 now has an end-to-end regression proof: a genuinely-hung deribit crawl ends only via the real `asyncio.wait_for` bound and is classified transient BY production code, the worker loop survives and keeps ticking, the real healthz TCP server answers 200 mid-backfill / 503 when stale over an actual socket, and the backfill/interactive claim scopes are provably disjoint.**

## Performance

- **Duration:** ~40 min
- **Started:** 2026-07-19
- **Completed:** 2026-07-19
- **Tasks:** 2/2
- **Files modified:** 1 (new test file only)

## Accomplishments

- **Task 1 (Case B — healthz honesty over real TCP):** `TestHealthzTcpServerHonesty` binds the REAL `main_worker_healthz.start_healthz_server` on an ephemeral port and probes it via `asyncio.open_connection`.
  - `test_healthz_stays_200_through_long_backfill`: with `_HEARTBEAT_INTERVAL_S` shrunk to 0.02, a yielding 0.3s dispatch answers `"200 OK"` to a probe captured MID-dispatch (asserted via `not dt.done()`), and `LAST_TICK_AT` advances past the dispatch-start stamp — the heartbeat keeps healthz honest through a long-but-alive crawl.
  - `test_healthz_503_when_tick_stale`: a forced-stale `LAST_TICK_AT` yields `"503 Service Unavailable"` + `"status": "stale"` — the staleness contract is real, not a stub.
- **Task 2 (Case A — hung crawl + role disjointness):** `TestHungCrawlAndRoleIsolation`.
  - `test_hung_crawl_times_out_worker_stays_live`: drives a `derive_broker_dailies` job through the REAL `services.job_worker.dispatch` → `run_derive_broker_dailies_job` path with the cash-pass crawl hung on an unset `asyncio.Event`. PRODUCTION code runs the `wait_for` bound and returns `outcome=FAILED, error_kind="transient"`; the test asserts ONLY the returned `DispatchResult`. Then a real `dispatch_tick` advances `LAST_TICK_AT` — the loop survived the hang.
  - `test_roles_never_contend`: `backfill` sends `p_kind_include == BACKFILL_KINDS` (no exclude); `interactive` sends `p_kind_exclude == BACKFILL_KINDS` (no include); the two sets are equal, so the claim scopes are provably disjoint. Tested at both the helper (`_claim_kind_args`) and the wiring (`dispatch_tick`) level.

## Verification

- `cd analytics-service && python -m pytest tests/test_worker_isolation_e2e.py -x -q` → **4 passed**.
- `python -m pytest tests/test_worker_isolation_e2e.py tests/test_main_worker.py -q` → **53 passed** (no cross-test pollution of module globals).
- Full wave-close suite `python -m pytest -n auto` → **4077 passed, 96 skipped, 0 failed**.
- `git diff --name-only` across both task commits → exactly one file: `analytics-service/tests/test_worker_isolation_e2e.py` (zero production-file edits).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Plan factual bug / Rule 7 - Surface conflict] The named transient seam classifies 'unknown', not 'transient'**
- **Found during:** Task 2, Test 3.
- **Issue:** The plan's `<interfaces>` block (and Test 3 acceptance criteria) name `fetch_deribit_native_account_state` (the anchor read, `job_worker.py:2319`) as the seam that classifies a hung crawl `error_kind="transient"`. An empirical throwaway probe proved this is **incorrect**: the anchor-read timeout raises a Deribit transient-read `RuntimeError`, which is NOT caught by any local `except` in `run_derive_broker_dailies_job` (its outer `except` only catches `ccxt.RateLimitExceeded`). It propagates to `dispatch()`'s generic handler → `classify_exception` → the `RuntimeError` catch-all → `error_kind="unknown"` (still retryable, but not `"transient"`).
- **Root cause:** `classify_exception` has no branch for the Deribit transient-read type; the genuine `error_kind="transient"` classification lives in the **cash-pass** crawl's dedicated `except asyncio.TimeoutError` arm (`build_deribit_native_ledger` → `job_worker.py:2623` → `:2649`).
- **Fix:** Hung the cash-pass crawl (`build_deribit_native_ledger`) — the seam that genuinely classifies `"transient"` — while patching `fetch_deribit_native_account_state` to a VALID anchor so execution reaches the cash pass. This keeps the oracle HONEST (never assert `"transient"` against a path that yields `"unknown"`) and still exercises the real `_BROKER_CRAWL_TIMEOUT_S` bound end-to-end. The plan's stated patch target (`fetch_deribit_native_account_state`) is still patched; only the HUNG awaitable moved to the correct seam.
- **Files modified:** `analytics-service/tests/test_worker_isolation_e2e.py` (test-only; no production change).
- **Commit:** d0c8791a
- **Documented in-test:** a `SEAM NOTE` docstring in `test_hung_crawl_times_out_worker_stays_live` records the empirical finding.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: classification-gap | analytics-service/services/job_worker.py | The deribit ANCHOR-read crawl bound (`:2319-2328`) raises a transient-read `RuntimeError` that classifies `error_kind="unknown"` rather than `"transient"`. Both are retryable so there is no production wedge or data-loss risk, but the anchor-read hang is classified LESS specifically than the cash-pass hang. Out of scope for this test-only plan — flagged for a future `classify_exception` branch (or an explicit `except` in the anchor-read arm) so anchor-read hangs also classify `"transient"`. Not a regression introduced here. |

## TDD Gate Compliance

Plan tasks are `tdd="true"`. This is a test-only plan proving EXISTING v1.12 production behavior, so the conventional RED→GREEN inversion does not apply (there is no new production code to make pass). The regression-first property is preserved structurally: the hung crawl awaits an unset `Event`, so if the production `wait_for` bound were removed the test would hang and fail via its outer 5s guard — the tests cannot pass without the v1.12 groundwork. Both task commits use `test(...)` prefixes.

## Self-Check: PASSED

- `analytics-service/tests/test_worker_isolation_e2e.py` — FOUND
- Commit `51bbc4dc` (Task 1) — FOUND
- Commit `d0c8791a` (Task 2) — FOUND
