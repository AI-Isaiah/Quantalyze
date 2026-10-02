---
phase: 120-sfox-equity-reconstruction-backbone
plan: 01
subsystem: ingestion
tags: [sfox, ingestion-adapter, broker-dailies, fail-loud, source-literal, api_verified]

# Dependency graph
requires:
  - phase: 118-sfox-read-client
    provides: SfoxClient (GET-only Bearer adapter, get_balances, aclose)
  - phase: 119-sfox-read-adapter-key-validation
    provides: _validate_sfox_key auth-probe pattern, AUTH_FAILED_DETAIL hoisted constant, SQL CHECK widen (sfox), boundary Literal admits
  - phase: 70-deribit-ingestion
    provides: DeribitAdapter — the broker-dailies compute_metrics-fail-loud analog
provides:
  - SfoxAdapter — 5-method IngestionAdapter, compute_metrics + fetch_raw fail-loud
  - sfox registered in Source Literal + SUPPORTED_SOURCES + _FACTORIES (lockstep)
  - get_adapter("sfox") resolves + caches an SfoxAdapter (F2/F7 seam resolution)
  - the phase-119 Source-Literal deferral RESOLVED (registry + Literal land together)
affects: [120-02, 120-03, 120-04, 122-sfox-wizard-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Broker-dailies adapter: compute_metrics fail-loud forces returns through the ONE backbone (deribit precedent, now sfox)"
    - "Registration lockstep: Source Literal + SUPPORTED_SOURCES + _FACTORIES widen in ONE commit (never a Literal-without-registry split)"

key-files:
  created:
    - analytics-service/services/ingestion/sfox.py
    - analytics-service/tests/test_ingestion_sfox.py
  modified:
    - analytics-service/services/ingestion/adapter.py
    - analytics-service/services/ingestion/__init__.py
    - analytics-service/tests/test_boundary_literals_parity.py
    - analytics-service/tests/test_ingestion_protocol.py

key-decisions:
  - "SfoxAdapter.compute_metrics RAISES (fail-loud) — sFOX returns can only ever come from the balance-history usd_value series via the broker-dailies ONE-path; a fill-based snapshot is the BYB-02 corruption class"
  - "SfoxAdapter.fetch_raw RAISES — no synchronous flow admits sfox; a bespoke sFOX->Trade mapping with no consumer would be unverifiable invented data (the raise is the tripwire)"
  - "validate: 401/403 -> AUTH_FAILED (byte-identical ccxt string); transient (status 0/429/5xx) PROPAGATES untouched (119 F4 honesty); aclose on every path"
  - "read_only=True is STRUCTURAL (GET-only SfoxClient, no scope endpoint — 119 A1), never a probed scope claim"
  - "Registration landed in lockstep so test_source_literal_and_registry_agree stayed green with zero edits — resolving the 119 deferral (b82d4d79 pinned sfox OUT precisely because the factory did not exist)"

patterns-established:
  - "Pattern 1: sfox broker-dailies adapter mirrors DeribitAdapter — only the RETURNS axis (compute_metrics) is guarded; compute_fingerprint/reconstruct_positions delegate to shared impls"
  - "Pattern 2: lockstep registry+Literal widen with a set-equality parity pin as the invariant guard"

requirements-completed: []  # SFOX-05 is PARTIAL here (adapter + registration half only); the daily-return reconstruction through derive_basis_series is plans 120-02/120-03. Stays ⏳ in REQUIREMENTS.md until the full backbone flow lands.
requirements-progressed: [SFOX-05]

# Metrics
duration: 18min
completed: 2026-07-18
---

# Phase 120 Plan 01: SfoxAdapter + Ingestion Registration Summary

**Shipped `SfoxAdapter` (compute_metrics/fetch_raw fail-loud, mirroring `DeribitAdapter`) and registered `'sfox'` in the ingestion `Source` Literal + `SUPPORTED_SOURCES` + `_FACTORIES` in one lockstep commit — resolving the phase-119 Source-Literal deferral and the F2/F7 finalize/process/verify seams (`get_adapter("sfox")` now resolves).**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-07-18
- **Completed:** 2026-07-18
- **Tasks:** 2 completed
- **Files modified:** 6 (2 created, 4 modified)

## Accomplishments
- `SfoxAdapter` — a 5-method `IngestionAdapter` whose `compute_metrics` and `fetch_raw` fail loud, so sFOX returns can only ever flow through the broker-dailies ONE-path (`chain_linked_twr` → `derive_basis_series`), never a fill-based `process_key` snapshot (BYB-02 corruption class blocked).
- `validate` proves auth via a real `SfoxClient.get_balances()` read, reports `read_only=True` structurally, maps 401/403 → `AUTH_FAILED` (byte-identical ccxt string), and PROPAGATES transient (status 0/429/5xx) failures untouched; `aclose` runs on every path.
- Lockstep registration: `'sfox'` added to the `Source` Literal + `SUPPORTED_SOURCES` + `_FACTORIES` together; both former sfox-exclusion pins flipped; `test_source_literal_and_registry_agree` stayed green with zero edits.
- Resolves the phase-119 deferral (the `b82d4d79` Source-Literal revert) and F2/F7 (finalize-wizard/process_key/verify can now resolve sfox; `api_verified` auto-stamps at `process_key.py:828` for the non-csv source).

## Task Commits

Each task was committed atomically:

1. **Task 1 (TDD RED): failing SfoxAdapter unit + registration pins** - `4479bed4` (test)
2. **Task 1 (TDD GREEN): implement SfoxAdapter** - `95b9edd5` (feat)
3. **Task 2: lockstep registration — Source Literal + registry + parity-test flips** - `57654f2e` (feat)

_Task 1 is TDD (RED test → GREEN impl). No REFACTOR commit was needed._

## Files Created/Modified
- `analytics-service/services/ingestion/sfox.py` (created) — `SfoxAdapter`: validate (auth via SfoxClient, honest classification), compute_metrics/fetch_raw fail-loud, fingerprint/positions delegate to shared impls.
- `analytics-service/tests/test_ingestion_sfox.py` (created) — 15 tests: fail-loud pins, validate auth-honesty + aclose, protocol conformance, registration resolve/cache/parity.
- `analytics-service/services/ingestion/adapter.py` (modified) — `Source` Literal admits `'sfox'`; stale phase-119 deferral comment rewritten to the landed note.
- `analytics-service/services/ingestion/__init__.py` (modified) — `SUPPORTED_SOURCES` + `_make_sfox_adapter` + `_FACTORIES['sfox']`; `get_adapter` docstring allowlist.
- `analytics-service/tests/test_boundary_literals_parity.py` (modified) — flipped `test_source_literal_excludes_sfox_until_phase_120` → `test_source_literal_includes_sfox`.
- `analytics-service/tests/test_ingestion_protocol.py` (modified) — expected `Source` set now includes `'sfox'`.

## Verification

- `pytest tests/test_ingestion_sfox.py tests/test_boundary_literals_parity.py tests/test_ingestion_protocol.py tests/test_ingestion_deribit.py tests/test_sfox_validate.py tests/test_sfox_read.py -q` → **81 passed**.
- `test_source_literal_and_registry_agree` GREEN with **zero edits** to `test_ingestion_deribit.py` (confirmed via `git diff --name-only`) — the lockstep held.
- `mypy --strict services/ingestion/` → clean (12 source files).
- Full analytics-service suite → **3890 passed, 95 skipped, 0 failed** (the 2 pre-existing 119-01 Source-Literal REDs noted in STATE are now resolved).
- Acceptance greps: `adapter.py` admits `"sfox"` (≥1, non-comment); stale `"does not add 'sfox'"` wording gone (count 0); `get_adapter('sfox')` resolves an `SfoxAdapter`.

## Deviations from Plan

None — plan executed exactly as written. (Task 1's test file already contains the registration pins per Task 2 step 5; those two tests were RED after the Task 1 GREEN commit and turned green in the Task 2 lockstep commit, as the plan's two-task ordering intends.)

## Threat Coverage

- **T-120-01 (Tampering, economic):** `compute_metrics` fail-loud pinned by `test_compute_metrics_fails_loud_naming_the_one_path` (message names `chain_linked_twr`/`derive_basis_series`).
- **T-120-02 (Spoofing):** `validate` auth proven by a real GET read; 401/403 → AUTH_FAILED, transient propagates — pinned by the auth/transient parametrized tests (never false-verified).
- **T-120-03 (Info disclosure):** `human_message` is the shared `AUTH_FAILED_DETAIL` constant, never a raw error; SfoxClient already scrubs the Bearer (118).
- **T-120-04 (Elevation):** the adapter constructs its own GET-only `SfoxClient`; no caller-supplied client accepted.
- **T-120-SC:** zero new packages this phase.

## Known Stubs

None. `fetch_raw` is an intentional fail-loud tripwire (documented), not a stub returning empty data — no synchronous sfox consumer exists (long-fetch routes through the worker broker-dailies branch, plan 120-03).

## Self-Check: PASSED

- `services/ingestion/sfox.py` — FOUND
- `tests/test_ingestion_sfox.py` — FOUND
- Commit `4479bed4` — FOUND
- Commit `95b9edd5` — FOUND
- Commit `57654f2e` — FOUND
