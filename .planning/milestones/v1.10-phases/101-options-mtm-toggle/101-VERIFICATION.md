---
phase: 101-options-mtm-toggle
verified: 2026-07-12T00:00:00Z
status: passed
score: 8/8 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: null   # initial verification
---

# Phase 101: Options MTM Toggle (analytics / pnl_basis) — Verification Report

**Phase Goal:** The single-key Deribit derive runs a SECOND `pnl_basis=mark_to_market`
pass (mirroring the composite dual-pass) and persists `metrics_json_by_basis.mark_to_market`
additively, with an honest single-key gate that degrades-with-reason (`mtm_gated_reason`)
when the `options_settlement_summary` channel can't cover the book. NO smoothing.
`cash_settlement` stays byte-identical (SC-4). Re-derive of existing rows = ship-time step.

**Verified:** 2026-07-12
**Status:** passed — GOAL MET (execute as-is, ready for review/ship)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Single-key Deribit options-book derive persists `metrics_json_by_basis.mark_to_market` (seven headline scalars, finite or JSON null) instead of the key being absent | ✓ VERIFIED | `job_worker.py:2825-2892` computes `mtm_metrics_json = dict(_mtm_result.metrics_json)`; persist at `:2955-2965` writes `{"mark_to_market": mtm_metrics_json}`. Test `test_finite_mtm_object_persisted` asserts all seven scalars present, `cumulative_return` finite, and set of keys == `{"mark_to_market"}` — runs the REAL `compute_all_metrics` on a 30-day series (not patched in `_base_patches`). |
| 2 | Perp-only Deribit / any ccxt / any key-mode derive is byte-identical: no second pass, no by-basis write, no new flag | ✓ VERIFIED | Gate at `job_worker.py:2258-2262`: `not is_key_mode AND pnl_basis == DEFAULT_PNL_BASIS AND _completeness.has_option_activity` (`DEFAULT_PNL_BASIS == cash_settlement`, `deribit_txn.py`). `mtm_attempted` defaults False at branch-outer scope (`:2018-2020`); persist omits the column entirely when `not mtm_attempted` (`:2951-2953` comment + conditional). Tests `test_perp_only_book_runs_single_pass`, `test_key_mode_never_runs_second_pass`, `test_ccxt_venue_leaves_by_basis_untouched`, `test_non_options_deribit_leaves_by_basis_untouched` all green. |
| 3 | Structural MTM reconstruction failure still completes the cash derive and stamps `mtm_gated_reason`; the derive never crashes on the MTM pass; transient errors propagate | ✓ VERIFIED | Catch tuple `job_worker.py:2292-2298` is the TYPED structural family (`LedgerValuationError, NavReconstructionError, LedgerCompletenessError, LedgerTruncatedError, CurrencyEnumerationError, ScopeAuthError`) — bare `ValueError` deliberately EXCLUDED; `DeribitTransientReadError` excluded → propagates. All six names in scope (`NavReconstructionError` @1943; rest @2028-2050). `test_structural_mtm_failure_degrades_with_reason` (DONE + reason stamped), `test_transient_valueerror_on_mtm_propagates` + `test_transient_read_error_on_mtm_propagates` (both `pytest.raises`) green. |
| 4 | Single-key by-basis object NEVER contains a `cash_settlement` key (strict overlay in `basis-metrics.ts` keeps single-key cash byte-identical only when absent) | ✓ VERIFIED | Persist writes only `{"mark_to_market": ...}` or `None` (`job_worker.py:2955-2965`). Grep for `cash_settlement` + `metrics_json_by_basis` in job_worker returns ONLY the composite path (`:3088-4339`), never the single-key seam. `test_finite_mtm_object_persisted` asserts `set(by_basis.keys()) == {"mark_to_market"}`. |
| 5 | Derive-stamped `mtm_gated_reason` SURVIVES the CSV finalizer's wholesale `data_quality_flags` rebuild | ✓ VERIFIED | Bridge at `analytics_runner.py:2385-2389`: `_mtm_reason = existing_flags.get("mtm_gated_reason"); if _mtm_reason and not _was_composite: data_quality_flags["mtm_gated_reason"] = _mtm_reason` — placed after the guard-key loop, before `csv_status`. `test_mtm_gated_reason_survives_finalizer_single_key` imports the constant from source and asserts survival. |
| 6 | `mtm_gated_reason` never promotes `computation_status` (availability annotation, not a warn flag) | ✓ VERIFIED | Bridge does NOT touch `_warned` (verified in diff). `test_mtm_gated_reason_does_not_promote_status` asserts exact-string `computation_status == "complete"` AND `computation_warned is False`. |
| 7 | Composite→single transition does NOT carry a stale composite-era reason forward | ✓ VERIFIED | Carry gated on `not _was_composite` (`_was_composite = bool(existing_flags.get("composite"))`, hoisted to share the Finding-5 lookup). `test_mtm_gated_reason_dropped_on_composite_to_single` (existing `{composite:True, mtm_gated_reason:"unsmoothed_options_book"}` → absent) green; double-guarded by pre-existing `test_noncomposite_rederive_nulls_stale_by_basis`. |
| 8 | Zavara acceptance parity + full analytics suite (coverage ≥80) green with ZERO cash-math edits (SC-4) | ✓ VERIFIED | `git diff --name-only 74471c7f..HEAD` = 5 files, NONE are cash pins. 268 cash-pin tests pass (`test_zavara_acceptance`, `test_deribit_txn`, `test_allocated_capital`, `test_deribit_acceptance`, `test_deribit_ground_truth`) with no edits. SUMMARY reports full suite 3637 passed @ 92.36% coverage (gate ≥80). |

**Score:** 8/8 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `services/stitch_composite.py` | `MTM_REASON_SUMMARY_COVERAGE` constant | ✓ VERIFIED | Added at `:109` next to `MTM_REASON_OPTIONS`/`MTM_REASON_VENUE`; docstring §4 extended. Single vocabulary owner; NOT consumed by `mark_to_market_available` (Phase 102). |
| `services/job_worker.py` | Second MTM pass + honest gate + additive persist | ✓ VERIFIED | +205 lines: branch-outer vars (`:2018-2020`), second pass + structural catch (`:2258-2318`), MTM compute (`:2825-2892`), by-basis prestamp (`:2933-2965`). Imports `PNL_BASIS_MARK_TO_MARKET`. |
| `services/analytics_runner.py` | Finalizer `mtm_gated_reason` bridge + TypedDict enum | ✓ VERIFIED | Bridge `:2385-2389`; `DataQualityFlags.mtm_gated_reason: str` enumerated `:236`; `_was_composite` hoisted (no double-assignment). |
| `tests/test_mtm_single_key.py` | Wave-0 wiring + SC-4 parity tests (≥120 lines) | ✓ VERIFIED | 745 lines, 15 tests, all green. Real `compute_all_metrics` exercised; SC-4 parity uses a distinct `_mtm_series()`. |
| `tests/test_csv_analytics_runner.py` | Finalizer bridge wiring tests | ✓ VERIFIED | +168 lines, 4 new `mtm_gated_reason` tests (survives / non-promoting / dropped-on-composite / absence-is-absence); one imports the constant from source. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `job_worker.py` deribit branch | `build_deribit_native_ledger` | second call `pnl_basis=PNL_BASIS_MARK_TO_MARKET`, gated on `has_option_activity` | ✓ WIRED | `:2264-2271`; `test_options_book_runs_second_mtm_pass_same_anchor` asserts 2 calls, cash then MTM, same `account_state` identity. |
| `job_worker.py` `_prestamp_dq_flags` | `strategy_analytics.metrics_json_by_basis` | additive jsonb `{"mark_to_market": ...}` or SQL NULL | ✓ WIRED | `:2955-2965` payload; `_prestamp_dq_flags` upserts the full payload (`:2967-2971`). |
| `job_worker._prestamp_dq_flags` | `analytics_runner.run_csv_strategy_analytics` rebuild | `existing_flags.get("mtm_gated_reason")` present-only carry | ✓ WIRED | `analytics_runner.py:2386-2389`; survives the wholesale rebuild. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Phase tests (mtm_single_key + csv_analytics_runner) | `pytest tests/test_mtm_single_key.py tests/test_csv_analytics_runner.py -q` | 41 passed | ✓ PASS |
| SC-4 cash pins (zero-edit) | `pytest test_zavara_acceptance test_deribit_txn test_allocated_capital test_deribit_acceptance test_deribit_ground_truth -q` | 268 passed | ✓ PASS |
| Touched-surface regression | `pytest test_job_worker test_job_worker_deribit test_derive_broker_dailies_dualmode test_stitch_composite test_stitch_composite_job -q` | 236 passed, 1 skipped | ✓ PASS |
| Structural exception names in scope | `grep` NavReconstructionError/… in job_worker | all 6 imported before catch site | ✓ PASS (no NameError risk in the except tuple) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| MTM-01 | 101-01, 101-02 | Single-key options MTM second-pass persistence + honest gate (analytics side) | ✓ SATISFIED | Truths 1-8 above; core is complete on the analytics side. Read-side UI / composite compose / live regression = Phase 102 (correctly deferred). |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | No TBD/FIXME/XXX/PLACEHOLDER in the phase diff | ℹ️ Info | Clean. `mtm_metrics_json = None` / `metrics_json_by_basis = None` writes are intentional SQL-NULL degrade paths (heal a stale key), not stubs. |

### Deferred Items (genuinely scheduled, not dropped)

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | Read-side UI toggle (`basis-context.tsx` / `basis-metrics.ts` / `FactsheetView`) | Phase 102 | ROADMAP Phase 102 = "Options MTM Factsheet + Composite + Regression" (confirmed `found: True`). 101-02 SUMMARY "Phase 102 handoff". |
| 2 | Composite MTM compose | Phase 102 | Same. |
| 3 | Zavara LIVE MTM regression | Phase 102 | Same. |
| 4 | `unsmoothed_options_book` reason-copy rewrite | Phase 102 | 101-02 SUMMARY explicitly defers the Phase-90 copy rewrite. |
| 5 | Re-derive backfill of existing options rows | Ship-time operational step | 101-02 SUMMARY "Ship-time operational step (OQ-3)" — verbatim post-deploy backfill + SC-4 live verification recorded. Correctly NOT an in-phase task (worker must deploy to Railway first). |

### Pre-existing (not a regression, not a blocker)

- `test_audit.py::TestAuditTaxonomySyncWithTypeScript::test_action_literal_matches_ts_union` fails on `main` independent of this phase — touches no phase-101 file (diff = 5 files, none audit). Logged in `deferred-items.md`. Not caused by and not fixable within Phase 101.

### Human Verification Required

None as an in-phase gate. The SC-4 LIVE check (headline scalars + `csv_daily_returns` byte-identical pre/post re-derive) is a documented **ship-time operational step**, not a phase-close gate — the analytics-side core is fully verifiable in-code and in-test without a live worker. Perform the ship-time re-derive + live SC-4 check after Railway deploy, before starting Phase 102 live verification.

### Gaps Summary

No gaps. All 8 must-have truths are VERIFIED against the code (not the SUMMARY):
the second MTM pass runs and persists an additive `mark_to_market`-only object;
the honest gate degrades on the typed structural family while transient errors
propagate (bare `ValueError` correctly excluded from the catch tuple); the reason
survives the finalizer's wholesale rebuild present-only, non-promoting, and
composite-excluded; and SC-4 holds by construction (no cash key written, cash pins
untouched, 268 pin tests green with zero edits). The two dishonesty risks flagged
by the task — SC-4 and the transient-vs-structural boundary — were both scrutinized
adversarially and are airtight.

---

_Verified: 2026-07-12_
_Verifier: Claude (gsd-verifier)_
