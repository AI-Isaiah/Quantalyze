---
phase: "226"
slug: "mt5soak"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: true
wave_0_complete: true
created: "2026-11-23"
---

# Phase 226 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest (analytics-service) |
| **Config file** | analytics-service/pytest.ini / pyproject |
| **Quick run command** | `cd analytics-service && python3 -m pytest tests/test_mt5_soak.py -q` |
| **Full suite command** | the full-suite gate in every PLAN.md's Phase contract, built on `cd analytics-service && python3 -m pytest -q -rfE -p no:cacheprovider`. It tolerates only the xdist group test, and only while `python3` cannot import xdist (baseline at plan time: `1 failed, 15235 passed, 93 skipped`) |
| **Estimated runtime** | soak file: seconds; full suite: ~712 seconds (measured at plan time, serial, without `-x`; run in background mode) |

---

## Sampling Rate

- **After every task commit:** Run the task's named tests, then `cd analytics-service && python3 -m pytest tests/test_mt5_soak.py -q`
- **After every plan wave (every plan is its own wave):** Run the Phase contract's full-suite gate, in that plan's Task 3
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** under 60 seconds per task (soak file); ~712 seconds for the full suite at plan end

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 226-01-T1 | 01 | 1 | SOAK-01 | T-226-01, T-226-02, T-226-03 | unresolvable currency is INCONCLUSIVE; raw text never echoed; new keys sanitizer-safe | integration (tracer) | `cd analytics-service && python3 -m pytest "tests/test_mt5_soak.py::test_a_btc_account_reconciles_green_on_its_own_floors" "tests/test_mt5_soak.py::test_an_unresolved_account_currency_is_inconclusive" "tests/test_mt5_soak.py::test_an_unresolved_account_currency_exits_nonzero" -q`, then `cd analytics-service && python3 -m pytest tests/test_mt5_soak.py -q` | ✅ file, tests new | ⬜ pending |
| 226-01-T2 | 01 | 1 | SOAK-01 | — | N/A | integration | `cd analytics-service && python3 -m pytest "tests/test_mt5_soak.py::test_a_btc_series_usd_floors_would_pass_reds_on_btc_floors" "tests/test_mt5_soak.py::test_a_btc_first_day_is_judged_on_the_btc_residual_floor" "tests/test_mt5_soak.py::test_the_btc_level_tolerance_is_in_btc_not_one_dollar" "tests/test_mt5_soak.py::test_a_material_btc_wedge_is_not_green" -q`, then `cd analytics-service && python3 -m pytest tests/test_mt5_soak.py -q` | ✅ file, tests new | ⬜ pending |
| 226-01-T3 | 01 | 1 | SOAK-01 | T-226-02 | PROOF-01 arms SOAK01-a/b1/b2/c/d; full suite | negative control + regression | `git diff --quiet -- analytics-service/scripts/mt5_soak.py && cd analytics-service && python3 -m pytest tests/test_mt5_soak.py -q`, then the PROOF-01 row check and the full-suite gate, all verbatim in this task's verify | ✅ file, tests new | ⬜ pending |
| 226-02-T1 | 02 | 2 | SOAK-03 | T-226-04 | — | integration | `cd analytics-service && python3 -m pytest "tests/test_mt5_soak.py::test_a_deal_moved_one_utc_day_in_the_fold_reddens_attribution" "tests/test_mt5_soak.py::test_a_flow_moved_one_utc_day_in_the_fold_reddens_flow_attribution" "tests/test_mt5_soak.py::test_the_real_fold_and_the_walk_agree_day_by_day" -q`, then `cd analytics-service && python3 -m pytest tests/test_mt5_soak.py -q` | ✅ file, tests new | ⬜ pending |
| 226-02-T2 | 02 | 2 | SOAK-03 | T-226-05, T-226-06 | walk errors name the field, never the value; walk imports no production helper | unit (AST + hand-derived) | `cd analytics-service && python3 -m pytest "tests/test_mt5_soak.py::test_the_walk_imports_no_production_helper" "tests/test_mt5_soak.py::test_the_walk_type_sets_match_production" "tests/test_mt5_soak.py::test_the_walk_sums_swap_fee_and_commission_family_cash" "tests/test_mt5_soak.py::test_the_walk_books_credit_and_bonus_as_flows" "tests/test_mt5_soak.py::test_the_walk_buckets_on_the_fixed_server_offset" "tests/test_mt5_soak.py::test_the_walk_reads_a_datetime_time" "tests/test_mt5_soak.py::test_the_walk_rejects_bad_fields_naming_the_field_only" -q`, then `cd analytics-service && python3 -m pytest tests/test_mt5_soak.py -q` | ✅ file, tests new | ⬜ pending |
| 226-02-T3 | 02 | 2 | SOAK-03 | T-226-06 | PROOF-01 arms SOAK03-pnl/flow/indep; full suite | negative control + regression | `git diff --quiet -- analytics-service/scripts/mt5_soak.py && cd analytics-service && python3 -m pytest tests/test_mt5_soak.py -q`, then the PROOF-01 row check and the full-suite gate, all verbatim in this task's verify | ✅ file, tests new | ⬜ pending |
| 226-03-T1 | 03 | 3 | SOAK-02 | T-226-08 | timed set is the soak's own; fold disagreements are named | integration | `cd analytics-service && python3 -m pytest "tests/test_mt5_soak.py::test_a_flow_day_the_fold_failed_to_time_is_named" "tests/test_mt5_soak.py::test_a_day_the_fold_timed_and_the_walk_cannot_is_named" -q`, then `cd analytics-service && python3 -m pytest tests/test_mt5_soak.py -q` | ✅ file, tests new | ⬜ pending |
| 226-03-T2 | 03 | 3 | SOAK-02 | T-226-07, T-226-08 | an untrusted instant is no instant (day untimed) | unit (hand-derived) | `cd analytics-service && python3 -m pytest "tests/test_mt5_soak.py::test_the_walk_degrades_an_untrusted_flow_day_to_untimed" "tests/test_mt5_soak.py::test_the_walk_times_known_entries_commissions_and_midnight_flows" "tests/test_mt5_soak.py::test_the_walk_position_constants_match_production" "tests/test_mt5_soak.py::test_the_walk_imports_no_production_helper" -q`, then `cd analytics-service && python3 -m pytest tests/test_mt5_soak.py -q` | ✅ file, tests new | ⬜ pending |
| 226-03-T3 | 03 | 3 | SOAK-02 | T-226-08 | PROOF-01 arm SOAK02-timedset; full suite | negative control + regression | `git diff --quiet -- analytics-service/scripts/mt5_soak.py && cd analytics-service && python3 -m pytest tests/test_mt5_soak.py -q`, then the PROOF-01 row check and the full-suite gate, all verbatim in this task's verify | ✅ file, tests new | ⬜ pending |
| 226-04-T1 | 04 | 4 | SOAK-02 | T-226-09, T-226-10 | a timed day the derive got wrong never exits 0; NaN written as None | integration | `cd analytics-service && python3 -m pytest "tests/test_mt5_soak.py::test_a_small_nudge_on_a_timed_day_reddens_the_gate" "tests/test_mt5_soak.py::test_an_implausible_or_missing_timed_return_reddens_the_gate" "tests/test_mt5_soak.py::test_a_timed_day_the_walk_reads_as_nan_must_be_published_nan" "tests/test_mt5_soak.py::test_the_real_combiner_timed_days_are_verified_against_the_walk" -q`, then `cd analytics-service && python3 -m pytest tests/test_mt5_soak.py -q` | ✅ file, tests new | ⬜ pending |
| 226-04-T2 | 04 | 4 | SOAK-02 | T-226-09 | cohort walk hand-derived; PNL ratio drift-pinned | unit (hand-derived) | `cd analytics-service && python3 -m pytest "tests/test_mt5_soak.py::test_the_cohort_walk_matches_hand_derived_returns" "tests/test_mt5_soak.py::test_the_walk_pnl_dominance_ratio_matches_production" "tests/test_mt5_soak.py::test_the_walk_imports_no_production_helper" -q`, then `cd analytics-service && python3 -m pytest tests/test_mt5_soak.py -q` | ✅ file, tests new | ⬜ pending |
| 226-04-T3 | 04 | 4 | SOAK-02 | T-226-09 | PROOF-01 arms SOAK02-cohort/nan/finite; full suite | negative control + regression | `git diff --quiet -- analytics-service/scripts/mt5_soak.py && cd analytics-service && python3 -m pytest tests/test_mt5_soak.py -q`, then the PROOF-01 row check and the full-suite gate, all verbatim in this task's verify | ✅ file, tests new | ⬜ pending |
| 226-05-T1 | 05 | 5 | SOAK-02 | T-226-11 | a run certifying under half its days never exits 0 | integration + unit | `cd analytics-service && python3 -m pytest "tests/test_mt5_soak.py::test_a_run_certifying_under_half_its_days_is_not_green" "tests/test_mt5_soak.py::test_one_checked_day_among_two_hundred_is_not_green" "tests/test_mt5_soak.py::test_the_checked_share_boundary" -q`, then `cd analytics-service && python3 -m pytest tests/test_mt5_soak.py -q` | ✅ file, tests new | ⬜ pending |
| 226-05-T2 | 05 | 5 | SOAK-02 | T-226-12 | tiny-base NaN explained only by the soak's own reading | integration + unit | `cd analytics-service && python3 -m pytest "tests/test_mt5_soak.py::test_a_tiny_base_day_the_real_combiner_leaves_out_is_explained" "tests/test_mt5_soak.py::test_the_tiny_base_reading_is_hand_derived" "tests/test_mt5_soak.py::test_a_finite_value_on_a_tiny_base_day_reddens_the_gate" "tests/test_mt5_soak.py::test_the_walk_tiny_base_constants_match_production" "tests/test_mt5_soak.py::test_the_return_reading_uses_no_production_guard" "tests/test_mt5_soak.py::test_the_walk_imports_no_production_helper" -q`, then `cd analytics-service && python3 -m pytest tests/test_mt5_soak.py -q` | ✅ file, tests new | ⬜ pending |
| 226-05-T3 | 05 | 5 | SOAK-02 | T-226-11, T-226-12 | PROOF-01 arms SOAK02-share/tiny; phase PROOF-01 index; services/ and migrations untouched; full suite | negative control + regression | `git diff --quiet -- analytics-service/scripts/mt5_soak.py && cd analytics-service && python3 -m pytest tests/test_mt5_soak.py -q`, then the PROOF-01 row check, the phase row check, the services/ and migrations boundary check and the full-suite gate, all verbatim in this task's verify | ✅ file, tests new | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `analytics-service/tests/test_mt5_soak.py` exists (31 tests); new arms extend it

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| none — every behavior is unit-testable offline | | | |

*If none: "All phase behaviors have automated verification."*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (none: the soak test file exists)
- [x] No watch-mode flags
- [x] Per-task feedback latency under 60 s; the ~712 s full suite runs once per plan
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** planner-checked 2026-11-23 (revision 1). `status` stays `draft` until validate-phase sets `validated`.
