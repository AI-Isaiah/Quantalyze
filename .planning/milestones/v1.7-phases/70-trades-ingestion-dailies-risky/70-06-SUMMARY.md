---
phase: 70-trades-ingestion-dailies-risky
plan: 06
subsystem: analytics-service / ingestion registry
tags: [deribit, ingestion-adapter, source-widening, fail-loud, DRB-08, D-13]
requires:
  - "services.deribit_ingest.fetch_deribit_fills (70-04)"
  - "services.deribit_ingest.resolve_scope_auth / exchange_token (70-03)"
  - "services.key_permissions.detect_deribit_permissions (P68)"
  - "services.exchange.create_exchange / validate_key_permissions (deribit routed)"
provides:
  - "services.ingestion.deribit.DeribitAdapter (5-method IngestionAdapter)"
  - "SUPPORTED_SOURCES + _FACTORIES admit deribit; get_adapter('deribit') resolves"
  - "ledger-backed fail-loud compute_metrics guard (BYB-02 corruption class closed)"
affects:
  - "services/ingestion/__init__.py (registry)"
  - "services/ingestion/adapter.py (Phase-68 comment)"
  - "long_fetch.get_adapter('deribit') now resolves"
tech-stack:
  added: []
  patterns:
    - "BybitAdapter template mirrored for a new venue"
    - "fail-loud NotImplementedError as an intentional corruption guard (not a stub)"
    - "lazy _make_*_adapter factory registry (M-11) extended by one line"
key-files:
  created:
    - analytics-service/services/ingestion/deribit.py
    - analytics-service/tests/test_ingestion_deribit.py
  modified:
    - analytics-service/services/ingestion/__init__.py
    - analytics-service/services/ingestion/adapter.py
    - analytics-service/tests/test_boundary_literals_parity.py
decisions:
  - "compute_metrics FAILS LOUD for deribit (raises) — returns are ledger-backed via the broker-dailies ONE-path (70-05); never fill-derived (A3 zero cashflow)"
  - "registry widening is CAPABILITY only — process_key per-flow onboarding sets stay deribit-free (Phase 72)"
  - "fingerprint / reconstruct_positions delegate to the shared exchange-agnostic impls (execution-detail axis is not corruption-bearing)"
metrics:
  duration: ~35m
  completed: 2026-07-05
  tasks: 2
  files: 5
---

# Phase 70 Plan 06: Source-registry widening + read-only-gated DeribitAdapter + fail-loud compute_metrics guard Summary

Landed the D-13 Source-widening half of DRB-08 — the final plan of Phase 70. The
ingestion registry is now deribit-capable (`get_adapter("deribit")` resolves a
`DeribitAdapter`), and the adapter's returns are ledger-backed: `compute_metrics`
FAILS LOUD rather than silently persisting a fill-derived zero-PnL track record.

## What was built

**Task 1 — `services/ingestion/deribit.py` (`DeribitAdapter`).** A 5-method
`IngestionAdapter` mirroring `BybitAdapter`:
- `validate` → `create_exchange("deribit", …)` + `validate_key_permissions`
  (which routes deribit through `detect_deribit_permissions`, P68): a
  write-capable key yields `valid=False / read_only=False / TRADE_SCOPE`. The
  read-only scope gate is enforced; no write path is opened.
- `fetch_raw` → lazy-imports `deribit_ingest.fetch_deribit_fills` (which reuses
  the 70-03 per-scope auth so subaccount fills are reachable) and normalizes each
  FillRow to a `Trade` via the shared `_normalize_trade` (`exchange="deribit"`).
- `compute_metrics` → **raises `NotImplementedError`** directing to the txn-log
  ledger / broker-dailies ONE-path (70-05). This is the subtlest guard of the
  phase (see below). It deliberately does NOT delegate to `EquityCurveBuilder`.
- `compute_fingerprint` / `reconstruct_positions` → delegate to the shared
  exchange-agnostic impls (execution-detail axis; not corruption-bearing).

**Task 2 — registry widening.** Added `"deribit"` to `SUPPORTED_SOURCES`, a
`_make_deribit_adapter` lazy factory, and the `_FACTORIES["deribit"]` entry;
`get_adapter("deribit")` resolves + caches, unknown sources still raise. Updated
the Phase-68 "exclude deribit until Phase 70" comment in `adapter.py` to record
that Phase 70 now SHIPS the ingestion path (capability only). Flipped the 68-03
parity pin (`test_supported_sources_excludes_deribit` →
`test_supported_sources_includes_deribit`) while leaving the process_key per-flow
onboarding exclusion pin intact (Phase 72).

## The fail-loud guard (BYB-02 corruption class)

Deribit `type=trade` fills carry ZERO realized cashflow (Wave-0 A3 — realized PnL
crystallizes at settlement, captured only in the txn-log ledger). OKX/Bybit
legitimately derive metrics from fills via `EquityCurveBuilder`; doing that for
Deribit would persist a silently-empty/wrong track record through
`long_fetch.process_key`. `DeribitAdapter.compute_metrics` therefore raises.
`test_deribit_compute_metrics_fails_loud` is **revert-proof** on two axes: it
asserts the raise AND greps the method source for `to_metrics_snapshot` (the
shared-delegation call) — re-introducing silent delegation turns it RED.

## Verification

- `tests/test_ingestion_deribit.py` — 11 tests, all pass (protocol conformance,
  fetch_raw delegation, read-only validate gate, fail-loud compute_metrics,
  fingerprint/positions parity, registry resolution + Source-Literal parity).
- `tests/test_ingestion_protocol.py` (14) + `tests/test_boundary_literals_parity.py`
  (5) — green (no regressions; parity pin flipped consciously).
- `tests/test_deribit_ground_truth.py` (21), `test_deribit_scope_validation.py`
  (15), `test_deribit_txn.py` (24) — green locally.
- `mypy --strict services/ingestion/` — clean (11 source files).

## CI-Py3.12-only

`tests/test_deribit_ingest.py` (pre-existing, 70-04) SEGFAULTS on the local
Python 3.14 venv (the known pandas/Py3.14 fault documented in the plan +
CLAUDE.md). It does not import the new module and is unaffected by this plan; its
authority is CI Python 3.12. All other targeted deribit + ingestion files run
green locally.

## Deviations from Plan

**1. [Rule 3 - Blocking] Flipped the 68-03 registry-exclusion parity pin.**
- **Found during:** Task 2.
- **Issue:** `tests/test_boundary_literals_parity.py::test_supported_sources_excludes_deribit`
  was a deliberate failing pin ("Phase 70 flips this") asserting `deribit not in
  SUPPORTED_SOURCES`. Admitting deribit made it fail.
- **Fix:** Renamed to `test_supported_sources_includes_deribit` asserting inclusion,
  with an updated docstring; left `test_process_key_flow_sets_exclude_deribit`
  intact (onboarding stays Phase 72).
- **Files:** analytics-service/tests/test_boundary_literals_parity.py
- **Commit:** d128d968

**2. [Rule 3 - Blocking] Updated the stale `get_adapter` docstring allowlist.**
- **Found during:** Task 2.
- **Issue:** `get_adapter`'s docstring hard-listed `okx, binance, bybit, csv`.
- **Fix:** Updated to include deribit + the Phase-72 onboarding caveat.
- **Commit:** d128d968

## Scope guard held

Ingestion CAPABILITY only. No live onboarding of the 3 LTP accounts (verified
strategies, per-subaccount key provisioning, secret rotation — Phase 72) and no
allocator positions (Phase 71) were pulled in. process_key onboarding allow-sets
remain deribit-free; Deribit returns flow through the broker-dailies ONE-path.

## Self-Check: PASSED
- FOUND: analytics-service/services/ingestion/deribit.py
- FOUND: analytics-service/tests/test_ingestion_deribit.py
- FOUND commit 979110ea (test/RED), 92615d16 (feat/Task1), d128d968 (feat/Task2)
