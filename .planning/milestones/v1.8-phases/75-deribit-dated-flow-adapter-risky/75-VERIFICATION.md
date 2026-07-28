---
phase: 75-deribit-dated-flow-adapter-risky
verified: 2026-07-06T00:26:54Z
status: passed
score: 4/4 must-haves verified
overrides_applied: 0
re_verification: null
gaps: []
deferred: []
human_verification: []
---

# Phase 75: Deribit Dated-Flow Adapter (RISKY) — Verification Report

**Phase Goal:** Deribit external flows are DATED per-day and inverse-valued in-band from the txn-log; the F1 net-scalar anchor correction is DELETED; the shared ExternalFlow contract exists. Inverse BTC/ETH flows valued at same-day get_delivery_prices, fail-loud LedgerValuationError if absent (never 1.0/current/dropped). Count-once (flow feeds F_t only). Requirements FLOW-01, FLOW-02. ROADMAP SCs 1-4.
**Verified:** 2026-07-06T00:26:54Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `services/external_flows.py` defines the ONE dated-flow contract `ExternalFlow=(utc_day_iso, usd_signed)` — pure, positionally-unpackable drop-in for `day_raw, usd_raw = flow` in the core | ✓ VERIFIED | File exists (76 lines); `class ExternalFlow(NamedTuple): utc_day_iso: str; usd_signed: float`; only `import math` + `from typing import NamedTuple` (no ccxt/pandas/I/O); 9 self-tests pass including positional-unpack, named-field-access, and purity source-scan |
| 2 | `deribit_dated_external_flows_usd` emits a dated per-day `list[ExternalFlow]`; inverse BTC/ETH flows valued at same-day settlement index via `txn_change_to_usd` verbatim; fail-loud `LedgerValuationError` if no same-day index; `inverse_days_needing_index` extended to inverse `_EXTERNAL_FLOW_TYPES` rows (Finding C1) | ✓ VERIFIED | Function at `deribit_txn.py:529`; calls `txn_change_to_usd(row, fallback_index=fb)` at line 603 — no second inverse converter; `LedgerValuationError` raised when neither own nor supplemental index exists; C1 gate at line 505: `row_type not in CASH_BEARING_TYPES and row_type not in _EXTERNAL_FLOW_TYPES` covers both kinds of quiet-day inverse rows; 11 mutation-honest tests pass including `test_flow_unvaluable_fails_loud`, `test_c1_inverse_flow_quiet_day_needs_index`, `test_dated_external_flow_sign_and_event_time_value` |
| 3 | The F1 scalar anchor correction (`equity -= net_external_flow_usd`) is DELETED from `job_worker.py`; flows feed ONLY the core's `F_t` term via `external_flows=_completeness.dated_external_flows`; count-once preserved via `INFORMATIONAL_TYPES` | ✓ VERIFIED | `grep 'equity = equity - .*external_flow\|saw_unvalued_inverse_flow\|net_external_flow_usd' job_worker.py` returns zero active (non-comment) hits; `external_flows=external_flows` at job_worker.py:2014 threads the dated list; `_EXTERNAL_FLOW_TYPES ⊆ INFORMATIONAL_TYPES` (deribit_txn.py:325-346) structurally excludes flows from the realized sum; mutation-honest source-scan test (`test_f1_scalar_region_source_scan`) green |
| 4 | Both SC4 cases pinned end-to-end: sub-NAV pure-flow day → `r_t == 0` (complete); dominating withdrawal → `flow_dominated_guard` (NaN + complete_with_warnings), not a fabricated ±100% day | ✓ VERIFIED | `TestLtp068AcceptanceSubNavPureFlow::test_ltp068_sub_nav_pure_flow_yields_zero_return` PASSED — BTC withdrawal ExternalFlow valued at -0.5×42000=-21000 on actual UTC day, r_t≈0.0, no guard; `TestLtp068AcceptanceDominatingWithdrawal::test_ltp068_dominating_withdrawal_trips_flow_dominated_guard` PASSED — -2.0 BTC × 45000 = -90000 ≥ NAV_{t-1}=80000 → NaN + `flow_dominated_guard` + `complete_with_warnings`; dropped-flow mutation proof: cumulative returns differ with/without flow (0.008333 ≠ 0.010101) |

**Score:** 4/4 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `analytics-service/services/external_flows.py` | ExternalFlow NamedTuple contract (pure, no I/O) | ✓ VERIFIED | 76 lines; `ExternalFlow(utc_day_iso: str, usd_signed: float)` + `validate_flow_shape()`; imports: only `math` + `typing.NamedTuple` |
| `analytics-service/tests/test_external_flows.py` | Contract self-tests: positional unpack, named fields, purity | ✓ VERIFIED | 9 tests pass |
| `analytics-service/tests/fixtures/deribit_flow_fixtures.py` | 5 LTP068-shaped synthetic txn-log scenario builders + per-day BTC index constants | ✓ VERIFIED | Exports `linear_flow_day_rows`, `inverse_flow_day_with_index_rows`, `inverse_flow_day_without_index_rows`, `dominating_withdrawal_rows`, `pure_flow_no_trade_rows` + `BTC_INDEX_2026_03_14/16/17`, `REFERENCE_PRIOR_NAV_USD` |
| `analytics-service/tests/test_deribit_flow_fixtures.py` | Shape self-tests for the 5 fixtures | ✓ VERIFIED | Tests pass; sign/index conventions pinned |
| `analytics-service/services/deribit_txn.py` | `deribit_dated_external_flows_usd` + extended `inverse_days_needing_index` | ✓ VERIFIED | New function at line 529; C1 extension at line 505; reuses `txn_change_to_usd` (line 603); `ExternalFlow` imported from `services.external_flows` at line 52 |
| `analytics-service/tests/test_deribit_txn.py` | +13 mutation-honest dated-flow + C1 tests | ✓ VERIFIED | 62 total pass; 11 matched by C1/dated-flow pattern all PASSED |
| `analytics-service/services/deribit_ingest.py` | `CompletenessReport.dated_external_flows: list[ExternalFlow]`; crawl accumulation via `deribit_dated_external_flows_usd` | ✓ VERIFIED | `dated_external_flows` field present (line 537); crawl extends at lines 682-683; `deribit_dated_external_flows_usd` imported at line 40; `ExternalFlow` imported at line 44 |
| `analytics-service/tests/test_deribit_ingest.py` | +5 tests: dated crawl accumulation, C1 end-to-end, field swap, count-once | ✓ VERIFIED | 52 total pass |
| `analytics-service/services/job_worker.py` | F1 scalar deleted; `external_flows` threaded | ✓ VERIFIED | No F1 lines; `external_flows = _completeness.dated_external_flows` at line 1979; `external_flows=external_flows` at line 2014 |
| `analytics-service/tests/test_job_worker_deribit.py` | +5 tests: equity-unadjusted, flows-threaded, fail-loud, C2-floor, source-scan | ✓ VERIFIED | New file; 5 tests pass |
| `analytics-service/tests/test_derive_broker_dailies_dualmode.py` | SC4 LTP068 dual-case acceptance | ✓ VERIFIED | `TestLtp068AcceptanceSubNavPureFlow` + `TestLtp068AcceptanceDominatingWithdrawal` both PASSED (2 of 12 total) |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `deribit_txn.py::deribit_dated_external_flows_usd` | `deribit_txn.py::txn_change_to_usd` | Verbatim call with `fallback_index=fb` (line 603) | ✓ WIRED | Single honest valuation path confirmed; no second inverse converter |
| `deribit_txn.py::inverse_days_needing_index` | `_EXTERNAL_FLOW_TYPES` inverse rows | Gate at line 505: `row_type not in CASH_BEARING_TYPES and row_type not in _EXTERNAL_FLOW_TYPES` | ✓ WIRED | Finding C1 extension confirmed |
| `deribit_ingest.py` crawl loop | `deribit_txn.py::deribit_dated_external_flows_usd` | `deribit_dated_external_flows_usd(rows, supplemental_index=supplemental)` at lines 682-683 | ✓ WIRED | Same `supplemental` map (C1-widened) feeds both realized and dated-flow producers |
| `job_worker.py` combine call | `broker_dailies.py::combine_realized_and_funding` | `external_flows=external_flows` at line 2014; `external_flows` set from `_completeness.dated_external_flows` at line 1979 (Deribit branch only; `None` for other venues) | ✓ WIRED | Typed `list[ExternalFlow] | None` pre-initialized before the venue branch to avoid NameError on non-Deribit path |
| `ExternalFlow` contract | `deribit_txn.py` and `deribit_ingest.py` | `from services.external_flows import ExternalFlow` at deribit_txn.py:52 and deribit_ingest.py:44 | ✓ WIRED | Both consuming modules import the contract verbatim |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|--------------------|--------|
| `deribit_dated_external_flows_usd` | per-day USD bucket `by_day` | `txn_change_to_usd(row, fallback_index=fb)` over `_EXTERNAL_FLOW_TYPES` rows | Yes — real `change` values × real settlement indices; fail-loud on absent index | ✓ FLOWING |
| `CompletenessReport.dated_external_flows` | `dated_external_flows` accumulator | `deribit_dated_external_flows_usd` calls in crawl loop (lines 682-683) | Yes — each `(scope, currency)` crawl extends from real row data | ✓ FLOWING |
| `combine_realized_and_funding(external_flows=...)` | `external_flows` param | `_completeness.dated_external_flows` (job_worker.py:1979) | Yes — threaded from the crawl accumulator, not hardcoded | ✓ FLOWING |
| SC4 acceptance tests | ExternalFlow list | `deribit_dated_external_flows_usd(fixture_rows, supplemental_index=<known index>)` | Yes — asserts exact valued USD (change × same-day index) | ✓ FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| ExternalFlow contract self-tests | `pytest tests/test_external_flows.py -q` | 9 passed | ✓ PASS |
| C1 + dated-flow producer tests | `pytest tests/test_deribit_txn.py -k "c1 or dated_external_flow or days_needing_index" -v` | 11 passed | ✓ PASS |
| `test_flow_unvaluable_fails_loud` (fail-loud RISKY) | `pytest tests/test_deribit_txn.py -k "flow_unvaluable"` | 2 passed | ✓ PASS |
| SC4 LTP068 dual-case acceptance | `pytest tests/test_derive_broker_dailies_dualmode.py -k ltp068 -v` | 2 passed | ✓ PASS |
| Full analytics suite | `pytest --tb=no -q` | 3023 passed, 92 skipped in 34.08s | ✓ PASS |

---

### Probe Execution

Step 7c: No declared probe scripts for this phase (RISKY valuation phase; verification via pytest suite, not shell probes). SKIPPED.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| FLOW-01 | 75-01-PLAN.md | One dated-flow contract `ExternalFlow = (utc_day_iso, usd_signed)` in new `services/external_flows.py` | ✓ SATISFIED | File exists, pure, positionally-unpackable, REQUIREMENTS.md checkbox "[x]" |
| FLOW-02 | 75-02/03/04-PLAN.md | Deribit dated flows, inverse valuation via `txn_change_to_usd`, F1 scalar deleted, VCR fixtures | ✓ SATISFIED | All code wired; 3023 tests pass; REQUIREMENTS.md checkbox still "[ ]" (tracking table stale — updated mid-phase after 75-02, not refreshed after 75-03/75-04) |

**FLOW-02 requirements tracking note:** The `REQUIREMENTS.md` checkbox for FLOW-02 remains `- [ ]` and the tracking table reads "In Progress" with a note referencing only 75-02. This is a stale update — the code in 75-03 and 75-04 fully completes FLOW-02. The checkbox should be `[x]` and the table entry updated to "Complete". This is a documentation gap, not a code gap. No blocker.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `services/deribit_txn.py` | 350-378 | Dead function `deribit_linear_external_flow_usd` — body retained after import removed from `deribit_ingest.py` and sole consumer (F1 block) deleted from `job_worker.py` | Info | Truly dead: no callers, no imports anywhere in `.py` files; only referenced in `docs/deribit-ingestion-design.md:71` (docs) and the new function's docstring as "superseded by." Deferred cleanup documented in 75-03 SUMMARY. Harmless. |

No unresolved debt markers (TBD/FIXME/XXX) found in any of the 11 files modified by this phase.

**ROADMAP SC2 naming note:** ROADMAP SC2 reads "`deribit_linear_external_flow_usd` emits a dated per-day list (no longer a net scalar)" but the implementation created a NEW function `deribit_dated_external_flows_usd` that supersedes the old one (per 75-02 SUMMARY: "Supersedes the linear-only scalar"). The ROADMAP wording is cosmetically stale. The functional intent is met and the verification focus's own SC2 specification correctly names `deribit_dated_external_flows_usd`. No impact on correctness.

---

### Human Verification Required

None. All phase 75 deliverables are verifiable programmatically (Python analytics service, pure functions, pytest suite).

---

## Gaps Summary

No gaps. All 4 ROADMAP Success Criteria are verified against the actual codebase:

- **SC1**: `services/external_flows.py` — exists, pure, correct NamedTuple contract, drop-in for the core.
- **SC2**: `deribit_dated_external_flows_usd` — exists, emits dated list, reuses `txn_change_to_usd` verbatim, fail-loud on missing index; Finding C1 extension confirmed.
- **SC3**: F1 scalar deleted (zero grep hits); `external_flows` threaded into `combine_realized_and_funding`; count-once via `INFORMATIONAL_TYPES` structurally intact.
- **SC4**: Both reconciled LTP068 cases pinned: sub-NAV → r_t==0 (complete), dominating → flow_dominated_guard (NaN + complete_with_warnings). Both mutation-honest.

Full analytics suite: **3023 passed, 92 skipped** — confirmed independently in CI-3.12 venv.

Non-blocking observations:
1. `REQUIREMENTS.md` FLOW-02 checkbox is stale "[ ]" — should be "[x]" after phase completion.
2. Dead `deribit_linear_external_flow_usd` body in `deribit_txn.py` — truly dead (no callers), deferred cleanup per documented decision.
3. ROADMAP SC2 uses old function name `deribit_linear_external_flow_usd` — cosmetic mismatch with implementation approach; intent fully met.

---

_Verified: 2026-07-06T00:26:54Z_
_Verifier: Claude (gsd-verifier)_
