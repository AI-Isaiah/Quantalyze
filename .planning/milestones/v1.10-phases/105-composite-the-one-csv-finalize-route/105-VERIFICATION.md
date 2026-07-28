---
phase: 105-composite-the-one-csv-finalize-route
verified: 2026-07-14T19:05:00Z
status: passed
score: 6/6 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: none
  previous_score: n/a
---

# Phase 105: Composite → the one CSV finalize route — Verification Report

**Phase Goal:** Cash stops being a bypass. Composite-cash + the CSV runner + the single-key seam all route through the shared `derive_basis_series`; cash SCALARS become a cache of a persisted cash series under the round-trip anti-divergence guard; and the Tier-2 collapses (#1 delete `_metrics_result_for`, #2 CSV inline swap, #5 collapse the two periods_per_year rules, #6 fold venue/denominator forks upstream) land — all under SC-4 byte-identity of every existing cash factsheet.

**Verified:** 2026-07-14T19:05:00Z
**Status:** passed
**Re-verification:** No — initial verification
**Commit range:** `4c23f94f..14098e62` on `gsd/v1.10-portfolio-intelligence-options-mtm` (HEAD = `14098e62`)

## Goal Achievement

### Observable Truths (the 6 invariants)

| # | Truth | Status | Evidence |
| --- | ------- | ---------- | -------------- |
| 1 | SC-4 byte-identity by construction on all cash surfaces; dual-run tests assert DICT-EQUALITY (never a tolerance); user-CSV-weekend fixture carries BOTH equality (vs sparse) and inequality (vs gap-fill) | ✓ VERIFIED | Runner inline compute at old :2318 GONE — `analytics_runner.py:2342` is now `derive_basis_series(returns, …, scalar_returns=returns, densify_policy="broker_nan" if _is_broker_sourced else "sparse")`; only out-of-scope stored-trades `compute_all_metrics(` at :1678 remains. `test_user_csv_weekend` (test_cash_basis_series_sc4.py:848) asserts `_metrics_json_equal(scalar, oracle_sparse)` AND `not _metrics_json_equal(scalar, oracle_filled)` AND `scalar["volatility"] != oracle_filled["volatility"]` — a degenerate fixture can't fake it. Comparator `_metrics_json_equal` (:820) = `json.dumps(sort_keys=True)` byte-identity, NaN-safe, no tolerance. Composite flagship (test_composite_headline_parity.py:470) asserts `cash == oracle` dict-equality. |
| 2 | `git grep _metrics_result_for` == 0 repo-wide | ✓ VERIFIED | `git grep _metrics_result_for \| wc -l` == **0** (code + comments + docstrings + tests). Confirmed twice (initial scan + final probe). |
| 3 | Round-trip anti-divergence guard VALID on all 3 surfaces incl. composite member-guard-NaN (`nan_dates` reconstruction), never weakened/skipped for composites | ✓ VERIFIED | `_roundtrip_recompute` (test_basis_series.py:73) reconstructs per `conventions["densify"]`: sparse verbatim / broker_nan dense-reindex / zero_fill `gap_fill+reinstate NaN at nan_dates` via union-reindex. Wired tests: `test_sparse_policy_roundtrip` (:659), `test_broker_nan_policy_roundtrip` (:672), `test_zero_fill_composite_guard_nan_roundtrip_flagship` (:688, falsifiable neuter `naive != r.metrics_json` at :720), `test_zero_fill_edge_guard_nan_roundtrip_union_reindex` (:723), `test_simple_active_denominator_roundtrip` (:741). Wired against REAL payloads at each surface: seam `test_cash_series_broker_nan_densify_tag_and_roundtrip` (test_cash_basis_series_sc4.py:396), composite flagship captures real `_cash_basis_result` (nan_dates==["2024-01-02"]). |
| 4 | D5 ordered-idempotent finalize: series + dailies persist BEFORE the DONE-bearing scalar/status flip on BOTH runner and composite; NO DDL | ✓ VERIFIED | Runner: `_persist_cash_series` (analytics_runner.py:2479) precedes `_mark_complete` (:2481); dailies are the READ input (:2212-2220), pre-existing. Composite: `_reconcile_full_delete` (:4550) → `_upsert_dailies` (:4561) → `_persist_cash_series` (:4740) → `_persist_mtm_series` (:4772) → `_write_headline_and_by_basis` (:4779, sets `computation_status: composite_status` = complete). Series/dailies all before the DONE flip. Phase diff touches ZERO migration/`.sql` files (only 3 source + 7 test files); `_PAYLOAD_SCHEMA_VERSION=2` is JSONB-additive (basis_series.py:103). |
| 5 | #5: `periods_per_year_for_asset_class` is THE selector AND the venue-blend disagreement check RETAINED as fail-loud PERMANENT assert (D4), not silently deleted | ✓ VERIFIED | `periods_per_year = periods_per_year_for_asset_class(strat_row.asset_class)` (job_worker.py:4257). Retained cross-check: `_venue_blend_periods` (:4271) with `if _venue_blend_periods != periods_per_year: await _stamp_failed(...) return DispatchResult(... error_kind="permanent")` (:4276-4290). `_COMPOSITE_DEGRADE_VENUES` kept as unknown-venue backstop. Tests: `-k periods` equality safety-pin + `test_traditional_asset_class_composite_fails_loud_retained_check`. |
| 6 | MED-1 (`shouldReadCashSettlementSeries`) + MED-2 (venue-agnostic `denominator_config` parse; ccxt-override echoes simple/active) both landed | ✓ VERIFIED | MED-1: `shouldReadCashSettlementSeries` (composite-read-path.ts:446) — genuine status-gate returning false unless status ∈ {complete, complete_with_warnings} AND cash_settlement is non-null non-array object. MED-2: parse hoisted branch-outer (job_worker.py:2131) BEFORE `if venue == "deribit":` (:2149), stamp helper renamed `_stamp_strategy_analytics_failed` (:2096); `test_cash_conventions_echo_ccxt_override` asserts exact `{365, simple, active, BTC, broker_nan}` echo with named neuter. |

**Score:** 6/6 truths verified

### Executor Deviation Scrutiny

| Deviation | Verdict | Evidence |
| --- | --- | --- |
| 105-04 DELETED `test_analytics_runner_series_only_boundary` (Phase-104 SC-2 guard) | ✓ INTENT-PRESERVING | The deleted test's own docstring stated `Kills: a premature Phase-105 cash-scalar reroute landing in analytics_runner.py` — Plan 105-04 IS that reroute, so it is obsolete-by-design, NOT a still-live invariant dropped to green the suite. Replaced by a comment (test_cash_basis_series_sc4.py) pointing at the three positive dual-run SC-4 fixtures. |
| 105-04 re-pointed :921/:981 patch targets to `services.basis_series.compute_all_metrics` + edited test_analytics_runner.py | ✓ BEHAVIOR-PRESERVING | Diff shows ONLY the patch-target string changed (`services.analytics_runner.compute_all_metrics`→`services.basis_series.compute_all_metrics`); zero `assert` lines altered. Correct: `compute_all_metrics` is now invoked from inside `derive_basis_series`, and `scalar_returns==returns` means the spy captures the identical conditioned series. Sibling test `test_csv_sibling_upsert_failure_keeps_complete_status` (test_analytics_runner.py:5544) still proves NEW-C02-06 — it scopes the RPC blip to the sibling call (`"cash_settlement" not in p_kinds` raises; cash persist succeeds) and asserts `result == {"status":"complete", …}`. The cash persist correctly must succeed (D5 fail-loud). |
| 105-05 changed "published"→"live" in source-scan test + updated four MTM call-count/stitch-index assertions | ✓ BEHAVIOR-PRESERVING | Source-scan guard `test_no_verification_or_publish_status_write_source_scan` (test_stitch_composite_job.py:2115) still asserts `"published" not in src` and `"verification_status" not in src`; the reword removed only a descriptive comment token ("live composite"/"live scalars"), production has no publish/verification write. MTM assertions: cash now shares `derive_basis_series`, so tests filter MTM by `"densify_policy" not in c.kwargs` (cash carries zero_fill/broker_nan; MTM omits densify — confirmed both MTM derives at job_worker.py:3049 and composite :4335 pass NO densify_policy → MTM byte-invisible per D1) and still assert `len(mtm_derives)==1` / `len(mtm_persists)==1`. Stitch-index 3→2 reflects cash reusing `stitched_cash` (no double-stitch) — the real collapse-#1 optimization, not a masked regression. |
| A3 seam guard `test_single_cash_settlement_persist_seam` bumped 1→2 | ✓ CORRECT | job_worker.py has 4 `basis="cash_settlement"` sites: result-bearing at `:3271` (run_derive_broker_dailies_job — single-key broker seam) and `:4736` (run_stitch_composite_job — composite seam); heals (`result=None`) at `:2075` and `:4373` (exempt). `total-heals==2` (test :745). `run_compute_analytics_job` (the 106 dark-path re-entry) contains NONE. Fix landed in `14098e62`. |

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | ----------- | ------ | ------- |
| `analytics-service/services/basis_series.py` | scalar_returns/densify_policy params, nan_dates, schema 1→2 | ✓ VERIFIED | kw-only params (:170-171), closed-set validation (:199), zero_fill nan_dates emission (:259-261), `_PAYLOAD_SCHEMA_VERSION=2` (:103), additive nan_dates payload key (:332). |
| `analytics-service/services/analytics_runner.py` | inline :2318 compute swapped for shared derive; cash series before scalar flip | ✓ VERIFIED | derive at :2342; `_persist_cash_series` (:2479) before `_mark_complete` (:2481); terminal heal-delete (:2670-2678). |
| `analytics-service/services/job_worker.py` | composite cash → shared derive; `_metrics_result_for` deleted; #5/#6/MED-2 | ✓ VERIFIED | composite cash derive :4335 (zero_fill, scalar_returns=gap_fill(stitched_cash), BTC); #5 selector :4257 + retained fail-loud :4276; MED-2 hoist :2131. |
| `src/lib/factsheet/composite-read-path.ts` | `shouldReadCashSettlementSeries` status-gate | ✓ VERIFIED | :446-461, DONE-gated cash-object predicate. |
| `.planning/.../105-FOLD-DECISION.md` | D6 decide-only, no DDL | ✓ VERIFIED | present; decide-only (105-02 SUMMARY). |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | --- | --- | ------ | ------- |
| runner CSV cash scalar | `derive_basis_series` | analytics_runner.py:2342 | ✓ WIRED | scalar_returns=returns, densify per source |
| composite cash scalar | `derive_basis_series` | job_worker.py:4335 | ✓ WIRED | scalar_returns=gap_fill(stitched_cash), zero_fill |
| single-key broker seam cash | `derive_basis_series` | job_worker.py:3248 | ✓ WIRED | scalar_returns=returns, broker_nan |
| persisted rows + conventions | round-trip scalar | `_roundtrip_recompute` per densify | ✓ WIRED | all 3 policies + composite flagship dict-equal |
| cash series persist | DONE flip (both surfaces) | series before status flip | ✓ WIRED | runner 2479<2481; composite 4740/4772<4779 |

### Behavioral Spot-Checks / Probe Execution

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| SC-4 core suites | `pytest tests/test_basis_series.py tests/test_cash_basis_series_sc4.py tests/test_stitch_composite_job.py tests/test_composite_headline_parity.py -q` | 125 passed | ✓ PASS |
| Runner + dualmode suites | `pytest tests/test_analytics_runner.py tests/test_csv_analytics_runner.py tests/test_derive_broker_dailies_dualmode.py -q` | 191 passed | ✓ PASS |
| `_metrics_result_for` grep-gate | `git grep _metrics_result_for \| wc -l` | 0 | ✓ PASS |
| No DDL in phase | `git diff --name-only 4c23f94f~1..14098e62 \| grep -iE 'migration\|\.sql'` | NONE | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ---------- | ----------- | ------ | -------- |
| BB-02 | 105-01/03/04/05 | Backbone unification — cash routed through shared derive_basis_series | ✓ SATISFIED | All three cash surfaces (runner CSV, single-key broker seam, composite) route through `derive_basis_series`; `_metrics_result_for` deleted; SC-4 dual-run byte-identity green. |

### Anti-Patterns Found

None. No debt markers (TBD/FIXME/XXX) introduced. Deleted test replaced with an explanatory comment naming its obsolescence rationale (not a silent drop). All heal-deletes are `result=None` (delete, never fabricate) and A3-exempt.

### Human Verification Required

None for the 105 gate. Per 105-VALIDATION.md: all phase behaviors have automated verification; 105 ships behind the existing flag, so prod SC-4 corroboration on live composites is a ship-time / 106-flip concern, not a 105 gate.

### Gaps Summary

No gaps. Every invariant is achieved BY CONSTRUCTION with falsifiable neuters, and every executor deviation is intent-preserving (obsolete-by-design deletion, mechanical patch re-point, behavior-preserving call-count filters isolating MTM from the now-shared cash derive, and a legitimate second honest cash seam). Full targeted suites green (316 tests), grep gate 0, zero DDL.

---

## Overall Phase Verdict

**PASS — the codebase achieves the phase goal.** Cash is no longer a bypass: the CSV runner (analytics_runner.py:2342), the single-key broker seam (job_worker.py:3248), and composite finalize (job_worker.py:4335) all route their cash SCALAR through the one shared `derive_basis_series`, with the scalar a cache of a persisted cash series conditioned byte-identically to legacy by construction (scalar_returns + densify_policy). The `_metrics_result_for` closure is deleted (grep-gate 0). The round-trip anti-divergence guard is valid across sparse/broker_nan/zero_fill including the composite member-guard-NaN flagship with a `nan_dates` reconstruction and a falsifiable drop-neuter. D5 ordered-idempotent finalize persists series+dailies before the DONE-bearing flip on both surfaces with zero DDL. #5 collapses to `periods_per_year_for_asset_class` while retaining the venue-blend disagreement as a fail-loud PERMANENT assert. MED-1 and MED-2 both landed. All four scrutinized executor deviations preserve intent and do not weaken any guard.

---

_Verified: 2026-07-14T19:05:00Z_
_Verifier: Claude (gsd-verifier)_
