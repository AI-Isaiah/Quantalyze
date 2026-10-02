---
phase: 128-deribitfix-deribit-correction-classification-evidence-based
verified: 2026-07-19T21:22:23Z
status: passed
score: 4/4 must-haves verified
overrides_applied: 0
re_verification:
  # No previous VERIFICATION.md — initial verification
gaps: []
---

# Phase 128: DERIBITFIX — deribit `correction` classification (evidence-based) Verification Report

**Phase Goal:** A deribit account containing a `correction` txn-log entry ingests cleanly with correct equity — classified on EVIDENCE of what deribit `correction` means — while genuinely-unknown types keep failing loud.
**Verified:** 2026-07-19T21:22:23Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth (ROADMAP Success Criteria) | Status | Evidence |
|---|----------------------------------|--------|----------|
| 1 | Classification of `correction` made on RECORDED evidence (docs and/or real key3 ledger entry), never a guess; evidence + determination written down WITH the change (DERIBITFIX-01) | ✓ VERIFIED | `deribit_txn.py:608-649` carries a ⭐EVIDENCE block quoting the exact key3 row (`type=correction change=-3.2469e-4 BTC currency=BTC id=952844476 info.reason="2026-07-15 BTC-PERPETUAL funding calculation correction"`) + the determination (funding correction → realized cash via settlement) inline at the code, plus mirrored in CONTEXT/SUMMARY. |
| 2 | The blocked key3 account (the `correction`-bearing one) ingests without raising `LedgerValuationError`, equity correct for the classification (DERIBITFIX-01) | ✓ VERIFIED | `_correction_row()` models the key3 row VERBATIM (same change `-3.2469e-4`, same reason, same id). The native path — the exact layer the dogfood `LedgerValuationError` raised on — now ingests cleanly AND `assert_balance_identity` closes (`test_...native`, L612-641). USD path produces the correct realized (`test_...usd`, L584-609). |
| 3 | Regression fixture with a `correction`-bearing ledger proves ingest succeeds with correct equity — and FAILS without the fix (DERIBITFIX-02) | ✓ VERIFIED | Hand-derived money oracles pass; RED-proof re-executed: neuter `correction_is_trading→False` reddens BOTH funding tests (observed 2 failed). |
| 4 | A genuinely-unknown future txn type STILL raises `LedgerValuationError` — `correction` classified specifically, no silent absorption (DERIBITFIX-02) | ✓ VERIFIED | Reason gate scoped to `row_type == "correction"` at both aggregators (L1207, L1787) and in `_row_is_cash_bearing`/`_row_is_native_cash_bearing` (L696, L709). `test_correction_did_not_broaden...` (L695) proves `quorble`/`zzz_new_type` still fail loud on both paths while the funding correction succeeds. `correction` pinned OUT of both static sets (test L380-381). |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `analytics-service/services/deribit_txn.py` | Per-row `info.reason` gate + evidence block + wiring | ✓ VERIFIED | `_CORRECTION_TRADING_REASON_KEYWORDS`, `correction_is_trading`, `assert_correction_classifiable`, `_row_is_cash_bearing`, `_row_is_native_cash_bearing` all present and substantive; `correction` removed from `CASH_BEARING_TYPES`; disjointness asserts intact. mypy --strict clean. |
| `analytics-service/services/deribit_ingest.py` | Return-row count honors the new gate | ✓ VERIFIED | `total_return_rows` counts trading-reason corrections via `correction_is_trading` (L1112-1125); imports the gate (L52). |
| `analytics-service/tests/test_deribit_txn.py` | Hand-derived USD+native oracles + fail-loud guards | ✓ VERIFIED | 4 new correction tests + set-pin/ambiguous/native-unknown updates; all pass, RED-proven both directions. |

### Key Link Verification (the single gate honored by all 5 consumers)

| From (gate) | To (consumer) | Via | Status | Details |
|-------------|---------------|-----|--------|---------|
| `correction_is_trading` | USD aggregator `txn_rows_to_daily_records` | `_row_is_cash_bearing` + `assert_correction_classifiable` | ✓ WIRED | L1207-1214: non-trading nonzero → raises; zero → ignored; trading → summed. |
| `correction_is_trading` | native aggregator `txn_rows_to_native_daily` | `_row_is_native_cash_bearing` + `assert_correction_classifiable` | ✓ WIRED | L1787-1794: identical logic mirrored. |
| `correction_is_trading` | index planner `inverse_days_needing_index` | `_row_is_cash_bearing` | ✓ WIRED | L985-989: trading correction requests same-day index; non-trading returns False (fails in aggregator, not planner). |
| `correction_is_trading` | reconcile guard `assert_balance_identity` | `_row_is_native_cash_bearing` | ✓ WIRED | L1507-1512: trading correction on BOTH sides of Σ → identity closes, no false-fire. |
| `correction_is_trading` | ingest count `total_return_rows` | direct call | ✓ WIRED | `deribit_ingest.py:1120-1123`: C2 activity floor consistent with valuation. |

### Data-Flow Trace (Level 4)

| Concern | Result |
|---------|--------|
| Funding correction summed into realized on BOTH USD and native paths | ✓ FLOWING — `test_...usd` (483.7655) and `test_...native` (0.00967531 + reconcile) both pass; not one path only. |
| Capital/unrecognized reason fails loud on BOTH paths | ✓ FLOWING — `test_correction_capital_reason_fails_loud` asserts raise on `txn_rows_to_daily_records` AND `txn_rows_to_native_daily`; neuter→blanket reddens 5 tests. |
| Zero-change correction harmlessly ignored (no false fail-loud) | ✓ FLOWING — aggregators gate `assert_correction_classifiable` behind `change != 0.0`; `test_...unrecognized` asserts zero-change → `[]`/`{}`. |
| Double-count risk | ✓ NONE — `correction` is in neither `CASH_BEARING_TYPES` nor `INFORMATIONAL_TYPES` nor `_EXTERNAL_FLOW_TYPES`; handled solely by its own branch, counted once. |

### Behavioral Spot-Checks / Probe Execution

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Phase test suite | `pytest tests/test_deribit_txn.py tests/test_native_nav_sc4_identity.py -q` | 174 passed | ✓ PASS |
| Broader deribit regression | `pytest test_deribit_ingest/acceptance/ground_truth/equity_reconstruction -q` | 247 passed (pre-existing okx warnings only) | ✓ PASS |
| RED-proof: `correction_is_trading→False` | neuter + `pytest -k funding_reason_is_cash_bearing` | 2 failed (funding tests redden) | ✓ PASS |
| RED-proof: `correction_is_trading→True` (blanket) | neuter + `pytest -k "capital_reason or unrecognized"` | 5 failed (fail-loud guards redden) | ✓ PASS |
| Source restored after neuters | `git status --short analytics-service/` | clean (no diff) | ✓ PASS |
| Type gate (CI analytics gate) | `mypy --strict --follow-imports=silent deribit_txn.py deribit_ingest.py` | Success: no issues | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| DERIBITFIX-01 | 128-01 (SUMMARY) | Evidence-based classification, evidence written with the change | ✓ SATISFIED | Truths 1-2; evidence block at `deribit_txn.py:608-649`. |
| DERIBITFIX-02 | 128-01 (SUMMARY) | Regression fixture RED-without-fix + unknown type still fails loud | ✓ SATISFIED | Truths 3-4; RED-proven both directions; `quorble` guard passes. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | No TBD/FIXME/XXX or stub markers in modified files | none | Clean. Known Stubs: None (SUMMARY). |

### Human Verification Required

None. ROADMAP marks Phase 128 fully autonomous/buildable (no `human_needed` leg — deribit native-ledger ingest, no sFOX/ops dependency). Criterion 2's live-prod substance is covered by a fixture that models the exact key3 row verbatim (same change, reason, id) and exercises the exact native `assert_balance_identity` guard that raised in dogfood.

### Gaps Summary

None. All 4 ROADMAP success criteria are observably true in the codebase:
- The classification is made on the recorded key3 evidence, written down AT the code (not a guess).
- The founder's refined per-row `info.reason` gate is correctly implemented: a funding-reason correction is summed into realized cash on BOTH the USD and native paths; a capital-flavored / unrecognized / missing reason FAILS LOUD on BOTH paths; a zero-change correction is harmlessly ignored.
- The gate is scoped to `type == "correction"`, so a genuinely-unknown TYPE (`quorble`) independently still fails loud — no allow-list broadening, disjointness asserts intact.
- Money oracles are hand-derived (483.7655 USD / 0.00967531 BTC), not the impl's own formula asserted back; the native oracle additionally proves the reconcile identity closes.
- RED-proof re-executed in the verifier's own process, both directions, with source cleanly restored (no residual diff). 174 + 247 tests pass; mypy --strict clean.

---

_Verified: 2026-07-19T21:22:23Z_
_Verifier: Claude (gsd-verifier)_
