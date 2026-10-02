---
phase: 105-composite-the-one-csv-finalize-route
plan: 01
subsystem: analytics
tags: [basis-series, derive, densify-policy, nan-dates, round-trip-guard, sc-4, jsonb-schema]

# Dependency graph
requires:
  - phase: 103-dailies-canonical-derive-route
    provides: derive_basis_series shared route + anti-divergence round-trip guard
  - phase: 104-cash-series-dark-write
    provides: additive benchmark_symbol kwarg template + cash_settlement kind + _PAYLOAD_SCHEMA_VERSION
provides:
  - "kw-only scalar_returns + densify_policy params on derive_basis_series (byte-invisible default)"
  - "D1 rows-vs-scalar-input decoupling: honest sparse rows independent of the scalar cache input"
  - "conventions[densify] echo ({sparse,broker_nan,zero_fill}) with closed-set fail-loud validation"
  - "composite zero_fill nan_dates additive JSONB payload key; _PAYLOAD_SCHEMA_VERSION 1->2 (NO DDL)"
  - "BasisSeriesResult.insufficient_window pass-through (duck-compat for Plans 04/05)"
  - "densify-policy-aware _roundtrip_recompute guard covering all 3 policies + composite guard-NaN flagship"
affects: [105-03-seam, 105-04-runner-swap, 105-05-composite-reroute, 106-cash-reader]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Additive-only param / JSONB key (default None -> byte-invisible), extending the Phase-104 benchmark_symbol precedent"
    - "Rows-vs-scalar-input decoupling: the persisted sparse rows and the scalar cache input are independent (D1)"
    - "densify_policy echo enabling by-construction round-trip reconstruction of the exact scalar input"

key-files:
  created: []
  modified:
    - analytics-service/services/basis_series.py
    - analytics-service/tests/test_basis_series.py
    - analytics-service/tests/test_derive_broker_dailies_dualmode.py

key-decisions:
  - "nan_dates emitted ONLY under zero_fill + non-None scalar_returns; every other path leaves it None (byte-invisible)"
  - "densify_policy validated against the closed set {sparse,broker_nan,zero_fill} with a fail-loud ValueError (code-controlled input, T-105-01)"
  - "zero_fill reconstruction uses union-reindex so an edge guard-NaN date OUTSIDE [first_row,last_row] re-extends the span"
  - "_PAYLOAD_SCHEMA_VERSION bumped 1->2 as a JSONB-additive shape change, NOT a migration (no DDL shipped)"

patterns-established:
  - "Per-policy scalar reconstruction in the round-trip guard branches on conventions[densify]; the default (no key) branch stays byte-identical"
  - "Every new test names its neuter target (falsifiable RED assertion), incl. an in-test nan_dates-dropped inequality on the composite flagship"

requirements-completed: [BB-02]

# Metrics
duration: 12min
completed: 2026-07-14
---

# Phase 105 Plan 01: derive_basis_series D1 scalar_returns/densify_policy mechanism Summary

**Decoupled the honest sparse persisted rows from the scalar-cache input in `derive_basis_series` via kw-only `scalar_returns`/`densify_policy` params, added the composite `zero_fill` `nan_dates` additive payload key (schema 1->2, no DDL), and made the round-trip guard reconstruct the exact scalar input per densify policy — MTM and every current caller stay byte-identical by default.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-07-14T16:52Z
- **Completed:** 2026-07-14T17:00Z
- **Tasks:** 2 (both TDD: RED test commit -> GREEN feat commit)
- **Files modified:** 3

## Accomplishments
- `derive_basis_series` gained kw-only `scalar_returns` + `densify_policy` (default None -> today's behavior byte-for-byte).
- D1 decouple: the scalar cache computes on the caller's exact `scalar_returns` when supplied, while `series_rows`/`gap_spans` stay on `_drop_nonfinite(returns)`.
- Composite `zero_fill` `nan_dates` (sorted ISO of in-index NaN positions) surfaced as an additive JSONB payload key; `_PAYLOAD_SCHEMA_VERSION` bumped to 2 with NO DDL.
- `BasisSeriesResult` gained `nan_dates` + `insufficient_window` (the latter a MetricsResult pass-through for Plans 04/05 duck-swap).
- Purged the last `_metrics_result_for` docstring token in `basis_series.py` (unblocks 105-05's `git grep == 0` gate).
- `_roundtrip_recompute` now reconstructs per densify policy (sparse verbatim / broker_nan dense-reindex / zero_fill gap_fill+NaN-reinstate with union-reindex); all 3 policies + the composite guard-NaN flagship round-trip dict-equal, and the nan_dates-dropped reconstruction diverges (RED pinned in-test).

## Task Commits

Each task was committed atomically (TDD RED -> GREEN):

1. **Task 1: scalar_returns + densify_policy + nan_dates + insufficient_window (byte-invisible default)**
   - RED: `4c23f94f` (test) — new behavior tests + 3 schema-pinned asserts flipped 1->2
   - GREEN: `faf8299f` (feat) — params, D1 decouple, densify echo, nan_dates, schema bump, docstring purge
2. **Task 2: densify-policy-aware round-trip guard + 3-policy fixtures (composite guard-NaN flagship)**
   - RED: `6ca14557` (test) — sparse/broker_nan/zero_fill + edge + simple/active fixtures
   - GREEN: `07f5e4d1` (feat) — `_roundtrip_recompute` branches on `conventions[densify]`

**Plan metadata:** committed separately (docs: complete plan).

## Files Created/Modified
- `analytics-service/services/basis_series.py` — `scalar_returns`/`densify_policy` kwargs, D1 scalar-input decouple, `conventions[densify]` echo, closed-set validation, `nan_dates`, `BasisSeriesResult.nan_dates`+`insufficient_window`, additive payload key, `_PAYLOAD_SCHEMA_VERSION`=2, module docstring rewrite (purged `_metrics_result_for`).
- `analytics-service/tests/test_basis_series.py` — densify-aware `_roundtrip_recompute`; 12 new tests (Task 1 behavior + Task 2 round-trip fixtures); the two full-dict payload asserts at `:309`/`:378` updated 1->2.
- `analytics-service/tests/test_derive_broker_dailies_dualmode.py` — live cash-persist schema assert `:994` updated 1->2.

## Decisions Made
- None beyond the plan — all four key-decisions above are the plan's locked D1 contract, followed exactly.

## Deviations from Plan

None - plan executed exactly as written. The only pre-existing test edits are the three schema-pinned asserts (`:309`, `:378`, dualmode `:994`), exactly as the plan mandated. `_KIND_BY_BASIS`, `compute_all_metrics`, `gap_fill_daily_returns`, `_drop_nonfinite` untouched. No DDL / no migration file created.

## Verification Results
- `pytest tests/test_basis_series.py` — 31 passed.
- `pytest tests/test_basis_series.py tests/test_cash_basis_series_sc4.py` — 38 passed (SC-4 dual-run byte-identity green).
- Dualmode live cash-persist test (`test_strategy_mode_persists_cash_settlement_series`) — passed with `schema == 2`.
- `mypy services/basis_series.py --strict` — clean.
- Grep gates: `scalar_returns` count = 12 (>=3); `_PAYLOAD_SCHEMA_VERSION = 2` count = 1 (==1); `git grep _metrics_result_for -- services/basis_series.py | wc -l` = 0.
- Byte-invisible default confirmed: `test_default_path_byte_invisible` (no `densify` key, `nan_dates` None, payload carries no `nan_dates`) + existing MTM/cash round-trip tests unmodified and green.
- Composite flagship neuter: `assert naive != r.metrics_json` holds — dropping `nan_dates` (plain `gap_fill`) 0.0-bridges the guard day and diverges from the persisted scalar (RED confirmed, pinned in-test).

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required. No DDL, no environment variables.

## Next Phase Readiness
- 105-03 (seam), 105-04 (runner swap), 105-05 (composite re-route) can now pass their exact legacy-conditioned `scalar_returns` and reproduce legacy scalars byte-identically by construction.
- `insufficient_window` pass-through is in place for the Plans 04/05 duck-swap.
- `_metrics_result_for` is fully purged from `basis_series.py`, so 105-05's `git grep == 0` gate is achievable once its own files are cut.

## Self-Check: PASSED

- FOUND: `.planning/phases/105-composite-the-one-csv-finalize-route/105-01-SUMMARY.md`
- FOUND commits: `4c23f94f` (RED T1), `faf8299f` (GREEN T1), `6ca14557` (RED T2), `07f5e4d1` (GREEN T2)

---
*Phase: 105-composite-the-one-csv-finalize-route*
*Completed: 2026-07-14*
