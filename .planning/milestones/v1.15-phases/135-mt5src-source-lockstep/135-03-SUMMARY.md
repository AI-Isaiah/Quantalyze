---
phase: 135-mt5src-source-lockstep
plan: 03
subsystem: api
tags: [mt5, validate-key, read-only, fail-closed, go-dark, router, python, pytest]

# Dependency graph
requires:
  - phase: 134-mt5-gateway-contract
    provides: "Mt5Client / Mt5ClientError read-only sync RPyC facade + MT5_REQUEST_TIMEOUT_S"
  - phase: 135-01
    provides: "MT5 detail-string contract + mt5_enabled_server() go-dark gate (closed_sets.py); mt5_validation seam (mt5_probe_request / is_trade_capable / classify_mt5_login_error)"
  - phase: 120-sfox-ingestion
    provides: "_validate_sfox_key fail-CLOSED intercept template + sfox_enabled_server gate pattern"
provides:
  - "routers/exchange.py::_validate_mt5_key — the MT5SRC-02 worker half: gated is_mt5 read-only validate branch (login + account_info + order_check probe, NEVER the trade-submit method)"
  - "is_mt5 intercept BEFORE the ccxt path, behind the mt5_enabled_server() go-dark gate (ccxt branch byte-identical)"
  - "LOUD MT5 credential-slot mapping comment at the single encrypt_key chokepoint (login->api_key, investor pw->api_secret, broker server->passphrase)"
  - "tests/test_mt5_validate.py — 19-test offline branch suite pinning three distinguishable failure paths + master-reject + go-dark gate + grep-gate invariant"
affects: [135-04, 138-mt5ui, 139-mt5-golive]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Non-ccxt validate intercept clone (is_sfox -> is_mt5): fail-CLOSED every arm, gated pre-construction, finally-close"
    - "Synchronous RPyC probe run off the event loop via asyncio.to_thread + asyncio.wait_for ceiling (WEDGE-01 event-loop protection)"
    - "Cross-language detail-string byte-identity pinned by importing the closed-set constants into the test (no retyped literals)"

key-files:
  created:
    - "analytics-service/tests/test_mt5_validate.py — offline is_mt5 branch suite (19 tests)"
  modified:
    - "analytics-service/routers/exchange.py — _validate_mt5_key + gated is_mt5 intercept + encrypt-chokepoint slot comment"

key-decisions:
  - "Pre-construction guard ordering: broker-server-required (MT5_WRONG_SERVER) -> login coercion (AUTH_FAILED) -> blank-password (AUTH_FAILED) -> gateway-config (503) — each fails CLOSED before any client is built"
  - "Transient DIVERGES from the 135-01 adapter: the router maps a transient Mt5ClientError (and a wait_for timeout) to a clean 400 NETWORK_ERROR_DETAIL (mirrors the sfox transient arm), rather than propagating the raw error, so /validate-key never 500s"
  - "Mt5Client is referenced directly at the router import site (patched as router.Mt5Client in tests) — mirrors the sfox make_sfox_client injection seam, Rule 11"
  - "wait_for ceiling = MT5_REQUEST_TIMEOUT_S + 5s margin so the client's own rpyc round-trip fails first and this outer bound is the last-resort healthz protector"

requirements-completed: [MT5SRC-02]

# Metrics
duration: 6min
completed: 2026-07-23
---

# Phase 135 Plan 03: is_mt5 read-only validate branch in the worker Summary

**The MT5SRC-02 worker half — a gated `is_mt5` intercept in `routers/exchange.py` that clones the fail-CLOSED `_validate_sfox_key` template, wires the Phase-134 read-only `Mt5Client` (login + account_info + order_check probe, never the trade-submit method), emits three distinguishable failure-path strings, rejects master logins so they are never persisted, and documents the credential-slot mapping loudly at the single encrypt chokepoint.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-07-23
- **Completed:** 2026-07-23
- **Tasks:** 2
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments
- Added `_validate_mt5_key(api_key, api_secret, passphrase)` below `_validate_sfox_key`: every arm fails CLOSED (never returns `{"valid": true}` on failure). Pre-construction guards reject a missing broker server (`MT5_WRONG_SERVER_DETAIL`), a non-numeric/empty login and a blank investor password (`AUTH_FAILED_DETAIL`), and a missing/malformed gateway config (503 `NETWORK_ERROR_DETAIL`, logged secret-free) BEFORE any `Mt5Client` is built.
- The live probe (`login` -> `account_info` -> `order_check` with `mt5_probe_request()`) runs off the event loop via `asyncio.to_thread` bounded by an `asyncio.wait_for` ceiling — a hung RPyC pipe can never wedge the loop/healthz (WEDGE-01, T-135-12). A timeout maps to a clean 400 `NETWORK_ERROR_DETAIL`.
- Three distinguishable failure paths via the `mt5_validation` classification seam: bad creds -> `AUTH_FAILED_DETAIL` (KEY_AUTH_FAILED byte-identity), master (trade-capable) login -> `MT5_MASTER_PASSWORD_DETAIL` (persisted NOTHING — the EoP gate, T-135-09), wrong server -> `MT5_WRONG_SERVER_DETAIL`.
- Inserted the `is_mt5` intercept directly after the sfox intercept and behind `mt5_enabled_server()` (go-dark, T-135-13); the ccxt branch below is byte-for-byte unchanged.
- Added the LOUD credential-slot mapping comment block at the single `encrypt_key` chokepoint (login->api_key, investor pw->api_secret, broker server->passphrase; no new columns).
- Created `tests/test_mt5_validate.py` (19 tests) cloning the sfox suite posture with an injected `Mt5Client` double; `close()` asserted on every post-construction path; a grep-gate test asserts the `order_send` call token is absent from the router source.

## Task Commits

Each task was committed atomically:

1. **Task 1: _validate_mt5_key + gated is_mt5 intercept + encrypt-chokepoint slot comment** - `c8661787` (feat)
2. **Task 2: test_mt5_validate.py — offline branch suite (19 tests)** - `b63db2e6` (test)

## Files Created/Modified
- `analytics-service/routers/exchange.py` - `_validate_mt5_key` + gated `is_mt5` intercept + encrypt-chokepoint slot comment; added `asyncio`/`os` imports, MT5 closed-set + `mt5_client` + `mt5_validation` imports, and the `_MT5_PROBE_TIMEOUT_S` ceiling.
- `analytics-service/tests/test_mt5_validate.py` - 19-test offline branch suite.

## Decisions Made
- **Guard ordering:** broker-server-required -> login coercion -> blank-password -> gateway-config, each pre-construction and fail-CLOSED. Each single-field failure test drives exactly one bad field, so ordering does not perturb the pinned outcomes.
- **Transient divergence from the adapter (135-01):** the router converts a transient `Mt5ClientError` AND a `wait_for` timeout to a clean 400 `NETWORK_ERROR_DETAIL` (mirroring the sfox transient arm) rather than propagating the raw error — so `/validate-key` never surfaces a 500. The 135-01 `Mt5Adapter.validate` propagates transients untouched to its own caller; the router is the HTTP boundary and owns the honest 400.
- **Injection seam:** `Mt5Client` is referenced directly at the router import site and patched as `router.Mt5Client` in tests, conforming to the sfox `make_sfox_client` monkeypatch pattern (Rule 11).

## Deviations from Plan

None - plan executed exactly as written. (Rules 1-4 not triggered; no auth gates.)

## TDD Gate Compliance

Task 2 is marked `tdd="true"` but its `<files>` is test-only, so the MVP+TDD behavior-adding gate does not apply. Following the 135-01 precedent, the router implementation landed in Task 1 (`feat`) and the offline behavior suite that pins it landed in Task 2 (`test`) — there is no separate cross-commit RED window because the branch's contract (the three closed-set detail strings + the `mt5_validation` seam) was already fixed by plan 135-01 and unit-pinned there. The Task-2 suite reddens if any detail string, the go-dark gate, the branch placement, or the `order_send` grep invariant drifts.

## Known Stubs

None. The `[ASSUMED]` markers (order_check retcode `10009`, the auth/server token tables) live in `services/mt5_validation.py` (135-01), isolated for a one-line MT5SPIKE-01 leg-2 refinement; the router consumes the seam verbatim.

## User Setup Required
None this plan. `MT5_ENABLED` / `MT5_GATEWAY_HOST` / `MT5_GATEWAY_PORT` are consumed at go-live (Phase 139); the branch ships DARK behind the fail-closed `mt5_enabled_server()` gate.

## Next Phase Readiness
- **135-04** (Next.js key routes / `classifyKeyValidationError` widening) can consume the worker contract: the three MT5 detail-string substrings (`master password`, `broker server`, plus the existing `authentication failed`) are emitted verbatim by this branch.
- No migration or schema change: MT5 reuses the existing encrypted credential slots (documented at the encrypt chokepoint).

## Self-Check: PASSED

- Created/modified files verified present: `routers/exchange.py`, `tests/test_mt5_validate.py`.
- Commits verified in `git log`: `c8661787` (Task 1, feat), `b63db2e6` (Task 2, test).
- `pytest tests/test_mt5_validate.py` — 19 tests collected/passed; full `analytics-service` pytest: 4322 passed, 96 skipped, 0 failed.
- Grep gate: `grep -rn "order_send(" routers/exchange.py` exits 1 (absent).
- `grep -c "mt5_enabled_server" routers/exchange.py` == 2 (import + gate check preceding `_validate_mt5_key`).

---
*Phase: 135-mt5src-source-lockstep*
*Completed: 2026-07-23*
