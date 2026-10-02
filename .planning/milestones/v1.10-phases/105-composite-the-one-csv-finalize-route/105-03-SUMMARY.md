---
phase: 105-composite-the-one-csv-finalize-route
plan: 03
subsystem: analytics-worker-broker-derive-seam
tags: [MED-2, collapse-6, D3, densify-tag, heal-delete, venue-agnostic, gate-harness, BB-02]
requires:
  - derive_basis_series scalar_returns/densify_policy (Phase 105-01)
  - shouldReadCashSettlementSeries read gate (Phase 105-02, primary D3 guarantee)
provides:
  - venue-agnostic returns_denominator_config parse at the single-key broker seam (MED-2)
  - broker_nan densify-tagged, round-trip-complete cash_settlement series echo
  - D3 secondary heal-deletes at both terminal-failure arms (single choke point + <2 arm)
  - _trusted_cash_payload gate-respecting SC-4 harness helper
affects:
  - Phase 105-04 (analytics_runner authoritative cash-scalar flip mirrors this preparation seam)
  - Phase 105-05 (composite finalize mirrors the #6 upstream-conditioning pattern)
tech-stack:
  added: []
  patterns:
    - "venue-agnostic override parse hoisted to branch-outer (analytics_runner:2304-2316 parity)"
    - "collapse #6: per-source conditioning (broker_nan) upstream, derive path branchless"
    - "single-choke-point heal inside the terminal-failure stamp helper (covers all call sites)"
    - "gate-respecting test harness: trust a captured payload only on terminal-success"
key-files:
  created: []
  modified:
    - analytics-service/services/job_worker.py
    - analytics-service/tests/test_cash_basis_series_sc4.py
decisions:
  - "MED-2 fixed by HOISTING the parse (not duplicating): one venue-agnostic call feeds echo + deribit consumers, byte-identical for deribit by construction"
  - "terminal-failure stamp helper renamed venue-neutral (_stamp_deribit_analytics_failed → _stamp_strategy_analytics_failed) so ccxt malformed-config fails loud through the SAME helper"
  - "heal-deletes are D3 SECONDARY (defense-in-depth); the Plan-02 read gate is the primary guarantee — heal failure never masks the terminal stamp"
  - "single-seam A3 guard updated to exempt result=None heals (a heal DELETES, never fabricates)"
metrics:
  duration: ~40m
  completed: 2026-07-14
  tasks: 2
  files: 2
---

# Phase 105 Plan 03: Single-Key Broker-Derive Seam — MED-2 + Collapse #6 + D3 Secondary Heals Summary

Collapsed the last real fork at the single-key broker-derive seam: the
`returns_denominator_config` parse now lives ONCE at the branch-outer, venue-agnostic
scope (analytics_runner parity), feeding a single branchless cash derive that receives
`scalar_returns=returns` + `densify_policy="broker_nan"` so its echo is round-trip-complete
by construction. Added D3 secondary heal-deletes at both terminal-failure arms and a
gate-respecting SC-4 harness. Deribit byte-identity preserved (the unmodified dual-run
test stays green); zero DDL.

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | MED-2 — hoist the parse venue-agnostic + venue-neutral stamp helper | `06a02098` | job_worker.py, test_cash_basis_series_sc4.py |
| 2 | Seam densify-tag + terminal-arm heal-deletes + gate-respecting harness | `cd43ea2e` | job_worker.py, test_cash_basis_series_sc4.py |
| — | This SUMMARY + state (gitignored `.planning/`) | (unstaged) | 105-03-SUMMARY.md |

## Task 1 — MED-2 venue-agnostic parse (collapse #6, upstream)

Moved `parse_returns_denominator_config` and its `ReturnsDenominatorConfigError → PERMANENT`
disposition from inside the `if venue == "deribit":` arm to the branch-outer, venue-agnostic
scope (inside the big try so the `aclose_exchange` finally still runs on the permanent
return). Hoisted + renamed the terminal-failure stamp helper
`_stamp_deribit_analytics_failed → _stamp_strategy_analytics_failed`; the deribit arm keeps
calling the SAME helper (4 renamed call sites) for its own ledger/scope/valuation failures.
Moved the `parse_returns_denominator_config` / `ReturnsDenominatorConfigError` imports (and
`scrub_freeform_string`) out of the deribit-arm-local import block to branch-outer; kept
`exclude_spot_extraction_for` in the arm. The deribit consumers (`pnl_basis`,
`exclude_spot_extraction`, `combine_native_ledger`) read the SAME branch-outer
`denominator_config` — **byte-identical for deribit by construction**.

**#6 single-derive confirmation:** the derive path has NO venue/denominator branch. Grep gate:
exactly ONE `parse_returns_denominator_config(` call in the single-key seam region
(`job_worker.py:2099`); the composite parse (`:3548`) is separate and untouched.

**MED-2 ccxt-override round-trip result:** a ccxt (binance) strategy with a Zavara-style
override now echoes `{periods_per_year:365, cumulative_method:"simple", day_basis:"active",
benchmark:"BTC", densify:"broker_nan"}` — was `geometric/calendar` before (the MED-2 bug).
A malformed ccxt config now returns a PERMANENT `DispatchResult` + terminal `failed` stamp
(`metrics_json_by_basis=None`), parity with the runner's B2 disposition.

## Task 2 — densify-tag + D3 secondary heals + gate harness

- **Densify tag / byte-identity:** the seam cash derive passes `scalar_returns=returns`
  (the exact dense post-terminus series the `csv_daily_returns` rows are built from) +
  `densify_policy="broker_nan"`. The persisted `conventions` gains `{"densify":"broker_nan"}`
  (schema 2); `persist_basis_series` discards `metrics_json`, so **no cash scalar leaks into
  `metrics_json_by_basis`** (only `mark_to_market`). Because `scalar_returns` IS the legacy
  cash scalar input, the broker cash scalars are **byte-identical by construction** (the same
  series feeds `compute_all_metrics`); the user-CSV path (Plan 04, `sparse`) is a separate
  policy. Round-trip guard (`_roundtrip_recompute`) reconstructs the exact scalar from the
  sparse rows end-to-end and matches the reference derive's `metrics_json`.
- **Heal-deletes (D3 SECONDARY):** one heal choke point (`_heal_delete_basis_series`) called
  from inside `_stamp_strategy_analytics_failed` (covering the parse-malformed + all deribit
  terminal failures) and from the `<2-interpretable-days` strategy-mode arm. Each deletes
  BOTH `cash_settlement` and `mtm_daily_returns` rows via `persist_basis_series(result=None)`.
  Heal failure is swallowed + warned so it never masks the terminal stamp. Strategy-mode only.
- **Gate-respecting harness:** `_trusted_cash_payload(capture)` trusts a captured cash payload
  ONLY on terminal-success (a csv_source prestamp, no `computation_status='failed'`), so the
  terminal-arm tests expect-absent and a legitimately-failed strategy never reddens the harness.

## Deviations from Plan

None — plan executed as written. One test-guard adjustment was required by the new code and is
in-scope: the A3 single-seam guard (`test_single_cash_settlement_persist_seam`) was updated to
exempt `result=None` heal-deletes (a heal DELETES a stale row, it never fabricates a series), so
it now pins exactly ONE result-bearing `basis="cash_settlement"` persist while permitting the D3
heal. The pre-existing dict-exact conventions assertions (Zavara Test 3, ccxt-override) gained the
additive `densify:"broker_nan"` key.

## Falsifiability (neuter proofs)

- Remove `scalar_returns`/`densify_policy` from the seam derive → `test_cash_series_broker_nan_densify_tag_and_roundtrip` RED (KeyError on `conventions["densify"]`). Verified.
- Remove the heal call from `_stamp_strategy_analytics_failed` → `test_stamp_failed_heals_both_series` RED (0 series deletes). Verified.
- Re-scope the parse inside the deribit arm → ccxt-override + malformed tests RED (verified pre-implementation).

## Verification

- `test_cash_basis_series_sc4.py` + `test_mtm_single_key.py` + `test_derive_broker_dailies_dualmode.py` + `test_basis_series.py` + `test_stitch_composite_job.py`: 155 passed.
- `test_sc4_cash_series_dual_run_byte_identity` (deribit byte-identity gate) green UNMODIFIED.
- Wave gate `pytest --cov --cov-fail-under=80`: 3706 passed, 93 skipped, 92.53% coverage.
- `ruff check` clean; `mypy services/job_worker.py` clean.

## Known Stubs

None. The cash SCALAR authoritative flip is deliberately deferred to Plan 04 (analytics_runner);
this seam remains series-persist for the authoritative scalars by design (documented at the seam),
not a stub.

## Self-Check: PASSED
- job_worker.py modified (2099 parse hoist, seam densify tag, heal choke points) — verified via grep + tests.
- test_cash_basis_series_sc4.py additions (ccxt runner, MED-2 + densify + heal + gate tests) — verified green.
- Commits `06a02098`, `cd43ea2e` present on `gsd/v1.10-portfolio-intelligence-options-mtm`.
