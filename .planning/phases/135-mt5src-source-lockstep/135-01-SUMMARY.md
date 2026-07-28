---
phase: 135-mt5src-source-lockstep
plan: 01
subsystem: api
tags: [mt5, ingestion-registry, source-lockstep, validate, read-only, fail-loud, python, pytest]

# Dependency graph
requires:
  - phase: 134-mt5-gateway-contract
    provides: "Mt5Client / Mt5ClientError read-only sync RPyC facade + injected _connect offline contract seam"
  - phase: 120-sfox-ingestion
    provides: "SfoxAdapter fail-loud adapter template + closed_sets sfox_enabled_server gate + boundary-literal parity pattern"
provides:
  - "'mt5' registered as a first-class Source in lockstep (Source Literal + SUPPORTED_SOURCES + _FACTORIES) — get_adapter('mt5') resolves a cached Mt5Adapter"
  - "Mt5Adapter: validate implemented against the Phase-134 Mt5Client contract (investor accepted, master rejected, fail-closed auth/server, transient propagates); compute_metrics/fetch_raw fail-loud raise until Phase 136"
  - "services/mt5_validation.py — the ONE seam for the [ASSUMED] investor-vs-master + login-error-classification rules (mt5_probe_request, is_trade_capable, classify_mt5_login_error)"
  - "Cross-plan MT5 detail-string contract + mt5_enabled_server() go-dark gate in closed_sets.py (plans 03/04 consume verbatim)"
  - "Pydantic key-save boundary Literals (VerifyStrategyRequest.exchange, debug_key_flow.Broker) admit 'mt5'"
affects: [135-02, 135-03, 135-04, 136-mt5recon, 138-mt5ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Lockstep Source-registry widening (Literal + tuple + factory land in ONE change — SFOX-01 pin precedent)"
    - "Fail-loud broker adapter (returns axis raises until the ledger-recon phase; execution-detail axis delegates to shared impls)"
    - "ONE seam holding [ASSUMED] rules so a live-spike refinement is a one-line follow-up"
    - "Module-level _build_client factory as the offline _connect injection seam (mirrors sfox make_sfox_client)"

key-files:
  created:
    - "analytics-service/services/ingestion/mt5.py — Mt5Adapter"
    - "analytics-service/services/mt5_validation.py — probe/classification seam"
    - "analytics-service/tests/test_ingestion_mt5.py — lockstep + fail-loud + validate suite (offline)"
  modified:
    - "analytics-service/services/ingestion/adapter.py — Source Literal +'mt5'"
    - "analytics-service/services/ingestion/__init__.py — SUPPORTED_SOURCES + _make_mt5_adapter + _FACTORIES"
    - "analytics-service/services/closed_sets.py — 3 MT5 detail strings + mt5_enabled_server()"
    - "analytics-service/models/schemas.py — VerifyStrategyRequest.exchange Literal +'mt5'"
    - "analytics-service/routers/debug_key_flow.py — Broker Literal +'mt5'"
    - "analytics-service/tests/test_boundary_literals_parity.py — mt5 CONTAIN + _KEY_SAVE_EXCHANGES"
    - "analytics-service/tests/test_ingestion_protocol.py — Source set-equality +'mt5'; unknown-source example -> 'kraken'"

key-decisions:
  - "Mt5Adapter.validate IMPLEMENTED (resolved Q-A) — faithful clone of the sfox validate posture, future-proof, low cost"
  - "Go-dark gate adopted (Q-C): mt5_enabled_server() mirrors sfox_enabled_server (MT5_ENABLED, fail-closed .strip().lower()=='true')"
  - "is_trade_capable is DEFENSIVE (Pitfall 4): trade_allowed OR order_check retcode==10009 [ASSUMED] — either positive signal rejects the master login"
  - "classify_mt5_login_error checks server/connection tokens FIRST (fail-closed: never falsely blame creds on an ambiguous bridge error), then auth tokens, else transient"
  - "compute_metrics/fetch_raw fail-loud until Phase 136 — a fill-based MT5 snapshot is the BYB-02 corruption class"

patterns-established:
  - "Cross-plan string contract lives in closed_sets.py (single source; wizardErrors.ts substring-collision invariant documented at the definition)"
  - "MT5 credential-slot reuse: login->api_key, investor password->api_secret, broker server->passphrase (no new columns)"

requirements-completed: [MT5SRC-01, MT5SRC-02]

# Metrics
duration: 22min
completed: 2026-07-23
---

# Phase 135 Plan 01: MT5 Source lockstep + Mt5Adapter + shared validate seam Summary

**'mt5' becomes a first-class ingestion Source in three-point lockstep, with an Mt5Adapter whose read-only validate is implemented against the Phase-134 Mt5Client contract (investor accepted, master rejected, fail-closed) and whose returns axis fails loud until Phase 136 — plus the cross-plan MT5 error-string contract and classification seam.**

## Performance

- **Duration:** ~22 min
- **Started:** 2026-07-23
- **Completed:** 2026-07-23
- **Tasks:** 2
- **Files modified:** 10 (3 created, 7 modified)

## Accomplishments
- Registered `'mt5'` atomically across the Source Literal + `SUPPORTED_SOURCES` + `_FACTORIES` (no Literal-ahead-of-registry split — `test_source_literal_and_registry_agree` stays green)
- Landed `Mt5Adapter`: `validate` proves auth+read via `login`→`account_info`, runs an `order_check` investor-vs-master probe off the event loop (`asyncio.to_thread`), rejects master logins (never persisted), and `close()`s on every path; `compute_metrics`/`fetch_raw` fail loud until Phase 136
- Created `services/mt5_validation.py` — the ONE seam holding the `[ASSUMED]` probe/classification rules so the live-spike refinement is a one-line follow-up
- Defined the cross-plan MT5 detail-string contract (`MT5_DISABLED_DETAIL`, `MT5_MASTER_PASSWORD_DETAIL`, `MT5_WRONG_SERVER_DETAIL`) + `mt5_enabled_server()` go-dark gate in `closed_sets.py`
- Widened the two pydantic key-save boundary Literals and added an offline `test_ingestion_mt5.py` suite driving the adapter against the injected `_connect` double

## Task Commits

Each task was committed atomically:

1. **Task 1: Registry lockstep + Mt5Adapter + shared MT5 constants/classification seam** - `88d5235c` (feat)
2. **Task 2: Pydantic boundary Literals + parity-test edits + test_ingestion_mt5.py clone** - `9042701d` (test)

_TDD note: because the three registry points are pinned in lockstep by pre-existing parity tests (`test_source_literal_and_registry_agree`), the adapter + registry widening land together in Task 1 (no cross-commit RED window on the lockstep pin); Task 2 clones the full offline behavior suite that pins the Task-1 validate contract._

## Files Created/Modified
- `analytics-service/services/ingestion/mt5.py` - `Mt5Adapter` (validate implemented; metrics/fetch_raw fail-loud)
- `analytics-service/services/mt5_validation.py` - `mt5_probe_request` + `is_trade_capable` + `classify_mt5_login_error` seam
- `analytics-service/tests/test_ingestion_mt5.py` - lockstep/caching, fail-loud, validate suite, gate truth-table (offline)
- `analytics-service/services/ingestion/adapter.py` - Source Literal +`'mt5'` + lockstep comment
- `analytics-service/services/ingestion/__init__.py` - `SUPPORTED_SOURCES` + `_make_mt5_adapter` + `_FACTORIES`
- `analytics-service/services/closed_sets.py` - 3 MT5 detail strings + `mt5_enabled_server()`
- `analytics-service/models/schemas.py` - `VerifyStrategyRequest.exchange` Literal +`'mt5'`
- `analytics-service/routers/debug_key_flow.py` - `Broker` Literal +`'mt5'`
- `analytics-service/tests/test_boundary_literals_parity.py` - 3 mt5 CONTAIN assertions + `_KEY_SAVE_EXCHANGES`
- `analytics-service/tests/test_ingestion_protocol.py` - Source set-equality +`'mt5'`; unknown-source example fixed

## Decisions Made
- **Q-A (validate posture):** implemented `Mt5Adapter.validate` fully (faithful sfox clone) rather than a minimal stub — future-proof and low cost.
- **Q-C (go-dark gate):** adopted `mt5_enabled_server()` mirroring `sfox_enabled_server` so the seam ships DARK until Phase 139.
- **classify_mt5_login_error ordering:** server/connection tokens checked FIRST (fail-closed — an ambiguous bridge error must never falsely blame the user's credentials), then auth tokens, else `transient` (propagates).
- **is_trade_capable:** either positive signal (`trade_allowed` OR `order_check` retcode `10009` `[ASSUMED]`) rejects — a refinement of either signal alone still fails closed (Pitfall 4).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `test_get_adapter_unknown_source` used 'mt5' as its unknown-source example**
- **Found during:** Task 2 (Source widening broke a pre-existing test)
- **Issue:** `test_ingestion_protocol.py::test_get_adapter_unknown_source` asserted `get_adapter("mt5")` raises `ValueError`; after MT5SRC-01 registration `'mt5'` is a valid Source, so the test failed (DID NOT RAISE).
- **Fix:** Repointed the unknown-source example to `'kraken'` (the convention already used in the sfox/mt5 suites) with a Phase-135 comment; the test still pins the unknown-source rejection intent.
- **Files modified:** `analytics-service/tests/test_ingestion_protocol.py`
- **Verification:** targeted suites + full analytics pytest green.
- **Committed in:** `9042701d` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug, directly caused by the in-scope Source widening)
**Impact on plan:** Necessary correctness fix; no scope creep.

## Issues Encountered
- My own module docstring in `mt5_validation.py` initially contained the literal call token `order_send(` inside a prose reference to the grep gate, tripping the `! grep -rn "order_send("` acceptance check. Reworded to name the trade method without call parentheses. Grep gate now clean.

## User Setup Required
None - no external service configuration required this plan. (`MT5_ENABLED` / `MT5_GATEWAY_HOST` / `MT5_GATEWAY_PORT` are consumed at go-live, Phase 139; the seam ships dark.)

## Next Phase Readiness
- **135-02** (migration + TS enum widening) and **135-03** (`routers/exchange.py` `is_mt5` branch) can consume the exported contract: the three MT5 detail strings, `mt5_enabled_server()`, and the `mt5_validation` seam are all in place and unit-pinned.
- The migration-parity byte-read class was DELIBERATELY NOT added to `test_boundary_literals_parity.py` — it reads a migration file that lands in 135-02.
- `[ASSUMED]` markers (order_check retcode `10009`, the auth/server token tables) remain pending the MT5SPIKE-01 leg-2 live spike; all are isolated in `mt5_validation.py` for a one-line refinement.

## Self-Check: PASSED

- Created files verified present: `services/ingestion/mt5.py`, `services/mt5_validation.py`, `tests/test_ingestion_mt5.py`.
- Commits verified in `git log`: `88d5235c` (Task 1), `9042701d` (Task 2).
- Full `analytics-service` pytest: 4301 passed, 96 skipped, 0 failed.
- Grep gate: `! grep -rn "order_send(" services/ingestion/mt5.py services/mt5_validation.py` exits 0.
- `python3 -c "from services.ingestion import get_adapter; get_adapter('mt5')"` resolves an `Mt5Adapter`.

---
*Phase: 135-mt5src-source-lockstep*
*Completed: 2026-07-23*
