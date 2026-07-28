---
phase: 134-mt5spike-feasibility-spike-mt5client-contract
plan: 01
subsystem: api
tags: [mt5, mt5linux, rpyc, ingestion, fail-loud, redact, pytest, api_verified]

# Dependency graph
requires:
  - phase: 118-123 (sFOX arc)
    provides: SfoxClient/SfoxApiError read-only fail-loud client template + services.redact.scrub_freeform_string
provides:
  - "Mt5Client — synchronous, read-only narrowing RPyC facade over mt5linux.MetaTrader5 (login/account_info/history_deals_get/order_check/close)"
  - "Mt5ClientError — typed fail-loud error carrying MT5 (code, text), secret-scrubbed at construction"
  - "MT5_REQUEST_TIMEOUT_S / MT5_LOGIN_TIMEOUT_MS dual-timeout constants (login ms strictly < rpyc s)"
  - "Offline contract test suite (25 tests) — the load-bearing CI gate 135/136 stub against, green with mt5linux uninstalled"
affects: [135-mt5-source-registration, 136-mt5-equity-reconstruction, 137-mt5-concurrency, 139-mt5-golive]

# Tech tracking
tech-stack:
  added: []  # mt5linux install is gated to plan 134-03 (human-verify); imported lazily only
  patterns:
    - "Narrowing RPyC facade: compose only read methods + order_check probe; NO trade-path wrapper, NO generic attribute-forwarding hook"
    - "Injectable _connect transport seam for zero-dependency offline contract tests (RPyC/MT5-shaped double, not MagicMock)"
    - "Lazy transport import inside _default_connect only — module import must not pull mt5linux"
    - "netref->native materialization via _asdict() + scalar _coerce; degenerate shape fails loud"

key-files:
  created:
    - analytics-service/services/mt5_client.py
    - analytics-service/tests/test_mt5_client_contract.py
  modified: []

key-decisions:
  - "Synchronous client (rpyc classic is blocking); NO async/aiohttp — supersedes the ARCHITECTURE.md HTTP-shim sketch per 134-CONTEXT lock. Event-loop bound (to_thread/wait_for) is a Phase 136/137 worker-seam concern."
  - "Structural read-only = facade composition: exact public surface pinned to {login, account_info, history_deals_get, order_check, close} by a test; parametrized forbidden trade-surface guard."
  - "order_check retcode/comment investor-vs-master signal is [ASSUMED] until MT5SPIKE-01 leg 2 runs live; client only exposes the materialized probe, the decision rule is a Phase 135 call-site concern combining it with account_info().trade_allowed."

patterns-established:
  - "None (error) != () (honest empty) at every read: None -> immediate last_error() capture + typed raise; () -> []; populated -> native dicts. Never a truthiness check."
  - "Secret hygiene: every Mt5ClientError detail passes scrub_freeform_string; never log the RPyC-interpolated code string."

requirements-completed: [MT5GW-02]

# Metrics
duration: ~20min
completed: 2026-07-23
---

# Phase 134 Plan 01: Mt5Client contract + offline suite Summary

**Synchronous read-only `Mt5Client` narrowing RPyC facade over `mt5linux.MetaTrader5` (login/account_info/history_deals_get/order_check/close) with None≠() fail-loud, netref→native materialization, secret scrub, and dual-timeout ordering — plus a 25-test offline contract suite that is green with `mt5linux` uninstalled.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-23
- **Completed:** 2026-07-23
- **Tasks:** 2 (both TDD)
- **Files modified:** 2 created

## Accomplishments
- `Mt5Client` + `Mt5ClientError` (213 lines): the buildable half of MT5GW-02 — a narrow, synchronous, structurally read-only RPyC facade phases 135/136 stub against.
- Load-bearing offline contract suite (354 lines, 25 tests) green with **zero live dependencies** — no terminal, no network, no `mt5linux` install; asserts `"mt5linux" not in sys.modules` after import.
- All four non-negotiable disciplines pinned by named tests: None≠() fail-loud, structural read-only, netref→native materialization, secret hygiene; dual-timeout ordering asserted (`MT5_LOGIN_TIMEOUT_MS < MT5_REQUEST_TIMEOUT_S * 1000`).
- Full `analytics-service` suite regression-clean: 4253 passed, 96 skipped.

## Task Commits

Each task was committed atomically (TDD RED → GREEN):

1. **Task 1 (RED): failing core-read contract suite** - `c296c4dc` (test)
2. **Task 1 (GREEN): Mt5Client core + Mt5ClientError** - `1f9c365d` (feat)
3. **Task 2 (RED): failing order_check + structural read-only guards** - `7eed3e70` (test)
4. **Task 2 (GREEN): order_check probe** - `41595012` (feat)

_Note: `.planning/` is a gitignored local ledger — no metadata commit; SUMMARY/STATE/ROADMAP updated on disk only._

## Files Created/Modified
- `analytics-service/services/mt5_client.py` - `Mt5Client` narrowing RPyC facade + `Mt5ClientError` + dual-timeout constants + lazy `_default_connect` + `_materialize`/`_coerce`.
- `analytics-service/tests/test_mt5_client_contract.py` - offline contract suite: `_FakeNamedTuple`/`_FakeMt5` RPyC-shaped double, injected `_connect` seam, 25 tests covering the full contract.

## Decisions Made
- Synchronous by construction (rpyc classic blocks); no async/aiohttp — follows the 134-CONTEXT lock over the ARCHITECTURE.md HTTP-shim sketch.
- Public surface pinned exactly to the 5-method contract by a dedicated test so any accidental widening fails loud.
- `order_check` investor-vs-master retcode marked `[ASSUMED]` (test docstring) pending the live MT5SPIKE-01 leg 2; the client only exposes the materialized probe.

## Deviations from Plan

None - plan executed exactly as written.

Two docstring rewordings were required to keep the literal grep acceptance gates at 0 (the anti-pattern strings `if not deals` and `__getattr__` had appeared in explanatory prose): reworded to "a truthiness check on `deals`" and "no dunder getattr hook" respectively. These are wording-only, no behavior change, folded into the same task commits — not scope deviations.

## Issues Encountered
- Grep acceptance gates (`if not deals` == 0, `__getattr__` == 0) initially tripped on explanatory docstring prose. Resolved by rewording the prose to describe the anti-pattern without the literal token; both gates then returned 0 and all tests stayed green.

## User Setup Required
None - `mt5linux` install is intentionally deferred to plan 134-03 (behind a human-verify checkpoint); the contract suite runs without it.

## Next Phase Readiness
- MT5GW-02 buildable half complete: a proven `Mt5Client` contract shape exists with a green offline gate, so Phase 135 (Source registration / validate) and Phase 136 (equity reconstruction) can stub against it.
- Remaining Phase 134 deliverables (spike harness `scripts/mt5_spike.py`, go/no-go doc template, `pip install mt5linux==1.0.3` human-verify gate) are separate plans (134-02/134-03); the four live MT5SPIKE-01 proof legs remain `human_needed`.

## Self-Check: PASSED
- `analytics-service/services/mt5_client.py` — FOUND (213 lines, ≥120)
- `analytics-service/tests/test_mt5_client_contract.py` — FOUND (354 lines, ≥150)
- Commit `c296c4dc` — FOUND
- Commit `1f9c365d` — FOUND
- Commit `7eed3e70` — FOUND
- Commit `41595012` — FOUND
- `pytest tests/test_mt5_client_contract.py -x -q` — 25 passed
- Grep gates: `order_send(`=0, `__getattr__`=0, module-level `mt5linux` import=0, `if not deals`=0, `async def`=0, `scrub_freeform_string`=4, `is None`=4

---
*Phase: 134-mt5spike-feasibility-spike-mt5client-contract*
*Completed: 2026-07-23*
