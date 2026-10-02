---
phase: 132-smoothed-mtm-worker-persistence
verified: 2026-07-22T00:00:00Z
status: passed
score: 9/9 must-haves verified (4 truths, 3 artifacts, 2 key links)
overrides_applied: 0
re_verification: false
---

# Phase 132: smoothed_mtm Worker Persistence — Verification Report

**Phase Goal (SMTM-03):** The worker persists the `smoothed_mtm` daily series + scalars in BOTH routes (single-key + composite), keyed `KIND_SMOOTHED_MTM`, exposed as `metrics_json_by_basis.smoothed_mtm`; a SEPARATE smoothed-availability predicate OPENS the `unsmoothed_options_book` gate for smoothed WITHOUT mutating the `mark_to_market_available` gate / `MTM_REASON_OPTIONS` (MTM decision byte-identical).
**Verified:** 2026-07-22
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| 1 | Single-key options job persists smoothed_mtm series + `metrics_json_by_basis["smoothed_mtm"]` alongside the two existing bases | ✓ VERIFIED | Code: `job_worker.py:2637-2695` (third pass), `:4026-4036` (guarded `persist_basis_series(basis="smoothed_mtm")`), `:4086-4091` (by-basis dict). Tests (all GREEN, ran locally): `test_options_book_runs_third_smoothed_pass_same_anchor` (3 ledger calls, cash→mtm→smoothed on the SAME account_state, by-basis keys == {mark_to_market, smoothed_mtm}), `test_smoothed_series_persisted_via_smoothed_kind` (persist SPY intercepts the real call with `basis="smoothed_mtm"`, result≠None — wiring proven, not just presence) |
| 2 | Composite over an unsmoothed options book persists smoothed_mtm as AVAILABLE; availability by option-activity ALONE; per-leg failure fails the JOB loud, never closes the gate | ✓ VERIFIED | Code: `job_worker.py:5428-5432` (`smoothed_ok = smoothed_mtm_available(member_signals)` → `_reconstruct_all(PNL_BASIS_SMOOTHED_MTM)`), `:5582-5583` (by-basis), `:5782-5793` (guarded series persist). Tests GREEN: `test_options_composite_persists_smoothed_while_mtm_gated` (by-basis == {cash_settlement, smoothed_mtm}, mark_to_market ABSENT never null, `mtm_gated_reason == "unsmoothed_options_book"` UNCHANGED, smoothed ledger pass proven via build spy), `test_smoothed_composite_per_leg_failure_fails_job_loud` (LedgerValuationError on smoothed leg → FAILED permanent, NO by-basis object persisted). The harness does NOT patch either availability predicate — the REAL gate functions execute |
| 3 | Gate separation: predicate is SEPARATE, option-activity-only; MTM decision byte-identical | ✓ VERIFIED | `stitch_composite.py:331-351`: `smoothed_mtm_available` body is `return any(m.has_option_activity for m in members)` — consults nothing else. `git diff 107887d9~1..60800ee9 -- stitch_composite.py` shows ZERO deletions (purely additive) → `mark_to_market_available` (:312-328) and `MTM_REASON_OPTIONS` (:101) byte-identical. Unit tests GREEN: `test_smoothed_gate_options_active_is_available` (smoothed True while MTM == (False, MTM_REASON_OPTIONS)), `test_smoothed_availability_never_mutates_the_mtm_gate` (MTM tuple identical before/after), `test_smoothed_gate_mixed_ccxt_and_options_is_available` |
| 4 | SC-4: no-option keys/composites persist NO smoothed artifacts, writes byte-identical | ✓ VERIFIED | `test_perp_only_skips_smoothed_pass_sc4` (1 crawl only; persist SPY proves NO call with basis="smoothed_mtm"; by-basis NULL), `test_perp_only_composite_persists_no_smoothed_artifacts` (by-basis == {cash_settlement, mark_to_market}, no smoothed ledger pass). The ONE deleted block in `job_worker.py` across the whole phase diff is the by-basis assignment refactor — semantically byte-identical for non-options paths (empty dict → None, same as prior `else None`) |

Additional plan must-have: `pre_mark_retention_option_days` → `complete_with_warnings` — ✓ VERIFIED: `job_worker.py:2691-2695` stamps `pre_mark_retention_option_dailies` via `NAV_TWR_GUARD_KEYS` (`nav_twr.py:188,:211`); `test_pre_mark_retention_stamps_complete_with_warnings` asserts the flag; `test_nav_twr.py:1470` closed-set pin includes the new key.

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `analytics-service/services/basis_series.py` | `KIND_SMOOTHED_MTM` + `_KIND_BY_BASIS` entry, no DDL | ✓ VERIFIED | `:118 KIND_SMOOTHED_MTM = "smoothed_mtm_daily_returns"`, `:124 "smoothed_mtm": KIND_SMOOTHED_MTM`. Only diff deletion = one comment line; derive/persist untouched. Round-trip test `test_smoothed_persist_roundtrips_via_batch_rpc` asserts the exact RPC payload keyed on the kind; `test_smoothed_persist_none_heals_via_delete` pins the heal path; `test_every_pnl_basis_has_a_kind_map_entry` is the generic enum↔kind sync pin over `_PNL_BASES` |
| `analytics-service/services/job_worker.py` | Third smoothed pass in BOTH routes | ✓ VERIFIED | Single-key: `:2637` pass, `:4032` persist, `:4090` by-basis. Composite: `:5415-5432` pass, `:5583` by-basis, `:5786-5791` persist. mypy --strict clean |
| `analytics-service/services/stitch_composite.py` | Separate smoothed availability decision bypassing MTM_REASON_OPTIONS | ✓ VERIFIED | `smoothed_mtm_available` at `:331`; zero-deletion diff |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | --- | --- | ------ | ------- |
| job_worker.py | basis_series.py | `persist_basis_series(basis="smoothed_mtm")` / KIND_SMOOTHED_MTM | ✓ WIRED | Single-key: persist SPY test proves invocation with a real result. Composite: real `persist_basis_series` executes against the fake client in `test_options_composite_persists_smoothed_while_mtm_gated` (harness patches neither derive nor persist); presence additionally pinned by `test_one_path_derive_basis_series_call_sites_unchanged` (call-site count 4→6) |
| job_worker.py | `strategy_analytics.metrics_json_by_basis` | by-basis dict gains `smoothed_mtm` key | ✓ WIRED | Asserted in both routes: `set(by_basis.keys()) == {"mark_to_market","smoothed_mtm"}` (single-key), `{"cash_settlement","smoothed_mtm"}` (composite), and `{"smoothed_mtm"}` when MTM degrades (`test_smoothed_persisted_when_mtm_degrades` — the phase's value proposition pinned directly) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Phase suites | `pytest test_mtm_single_key.py test_basis_series.py test_stitch_composite_job.py test_stitch_composite.py -q` | 176 passed | ✓ PASS |
| Other touched suites | `pytest test_nav_twr.py test_sfox_reconstruct.py test_cash_basis_series_sc4.py test_derive_broker_dailies_dualmode.py test_composite_headline_parity.py -q` | 164 passed | ✓ PASS |
| Full analytics suite | `pytest tests/ -q` | 4203 passed, 96 skipped, 3 failed | ✓ PASS (3 failures verified PRE-EXISTING: all in `test_equity_reconstruction.py`, OKX `private_get_account_balance` FakeExchange drift; file NOT in the phase diff, matches known local baseline) |
| Types | `mypy --strict --follow-imports=silent services/basis_series.py services/job_worker.py services/stitch_composite.py services/nav_twr.py` | Success: no issues in 4 files | ✓ PASS |

### Fail-Loud Discipline (money-path)

- Single-key: `test_smoothed_ledger_valuation_error_fails_job_loud` — smoothed crawl raises retention-straddle `LedgerValuationError` → job FAILED permanent, NO partial two-basis persist (prestamp absent). GREEN.
- Composite: `test_smoothed_composite_per_leg_failure_fails_job_loud` — per-leg failure → FAILED permanent, terminal `failed` stamp, no by-basis object. GREEN.

### Commit Verification

Claimed commits 107887d9, cad6a898, 60800ee9 all exist; `60800ee9` is an ancestor of HEAD (branch `feat/phase-83-smoothed-mtm`). Phase diff (107887d9~1..60800ee9): 13 files, +1070/−65; all 65 deletions are in test files except the single by-basis assignment refactor in job_worker.py and one comment line in basis_series.py.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| — | — | No TBD/FIXME/XXX/HACK/PLACEHOLDER markers in the phase diff | — | — |

### Observations (non-blocking)

1. ℹ️ **Composite smoothed SERIES persist executes in test but is not directly asserted.** The MTM route has `test_composite_mtm_routes_through_shared_derive_and_persists` (persist spy); no smoothed sibling exists. The composite series persist IS proven present (code read at `job_worker.py:5782-5793`), executed (runs unpatched against the fake in the options-composite test — a broken call would fail the test), and site-count-pinned (sfox pin 4→6). Deleting ONLY the composite series-persist block would however not turn any current assertion red (the by-basis scalar assertions would still pass). A spy-based sibling test would close this. Weak-coverage note, not a goal gap — SMTM-03's persistence contract is otherwise proven.
2. ℹ️ **Known limitation (documented in SUMMARY, consistent with SC-4):** guarded persist leaves a latent stale `smoothed_mtm_daily_returns` series row on an options→perp-only reconfiguration; the by-basis SCALAR heals via the wholesale write and the frontend (133) gates on the scalar. Benign; acceptable trade-off mandated by the SC-4 "no smoothed RPC on a no-option key" constraint.
3. ℹ️ **Founder-visible trade-off (accepted per plan objective / D-07):** retention-straddling options key hard-fails the WHOLE job on recompute. Pinned by both fail-loud tests. Operational signal, not a defect.

### Human Verification Required

None. Backend worker phase; all SMTM-03 clauses are programmatically verifiable and verified. No `<human-check>` blocks in the PLAN (all tasks auto with automated verify). Frontend rendering of the persisted basis is Phase 133's scope.

### Gaps Summary

No gaps. Every SMTM-03 clause is achieved in code and pinned by tests that were run green in this verification session (not taken from the SUMMARY): kind + map (real), third pass in both routes (real, spy-proven single-key, execution-proven composite), by-basis key in both routes (asserted), separate option-activity-only availability predicate (real function body read), MTM gate byte-identical (zero-deletion git diff, not narrative), fail-loud in both routes (asserted FAILED permanent), SC-4 (spy-proven no-artifact), warning stamp (asserted), mypy --strict clean, full suite green modulo 3 verified-pre-existing unrelated failures.

---

_Verified: 2026-07-22_
_Verifier: Claude (gsd-verifier)_
