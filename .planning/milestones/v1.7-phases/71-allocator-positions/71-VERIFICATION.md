---
phase: 71-allocator-positions
verified: 2026-07-05T00:00:00Z
status: passed
score: 3/3 must-haves verified
overrides_applied: 0
deferred:
  - truth: "Linear Deribit `size`=quote-ccy denomination is correct against real USDC/USDT LTP accounts (live end-to-end render on the Holdings panel)"
    addressed_in: "Phase 72"
    evidence: "ROADMAP Phase 72 'LTP Onboarding & Acceptance Verification' — 3 LTP accounts live as verified strategies behind hard acceptance gates. SUMMARY §Review-MEDIUM explicitly names P72 onboarding as the live acceptance gate. Unit fixtures verify the documented Deribit field semantics; only a live key can confirm real-account denomination."
---

# Phase 71: Allocator Positions Verification Report

**Phase Goal:** An allocator can connect a Deribit key and see their derivative positions — the last deliberate block is lifted.
**Verified:** 2026-07-05
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A Deribit allocator key no longer hits `DeribitNotSupportedError` (f3 Path-B lifted); spot returns `[]`, class deleted, sync completes with derivative rows | ✓ VERIFIED | `allocator_positions.py:150-152` — `if getattr(exchange,"id",None)=="deribit": return []` (no raise, before any network call). `grep` confirms no `DeribitNotSupportedError` class in `allocator_positions.py` (only a doc-comment + the test asserting `not hasattr`). `fetch_allocator_holdings` runs `_fetch_derivative_rows` in the try; spot is outside but returns `[]` for Deribit so cannot raise. Test `test_deribit_renders_derivatives_spot_deferred` proves warning=None, 1 derivative row, `fetch_balance.assert_not_called()`. Test `test_deribit_error_class_removed` asserts `not hasattr(ap,"DeribitNotSupportedError")`. |
| 2 | Deribit derivative positions render with inverse contracts normalized correctly; coin-settled classification single-sourced in `deribit_txn.classify_instrument_settlement`; inverse PnL coin→USD at index_price; one bad position doesn't drop the batch | ✓ VERIFIED | `positions.py:93-190` `_normalize_deribit_position` reads raw `info` (authoritative), branch dispatched at `_normalize_ccxt_position:200-201`. Settlement decided by `classify_instrument_settlement` (`positions.py:145-148`), which fail-louds on unknown coin-margined currency (`deribit_txn.py:128-133`). Inverse PnL = `floating_profit_loss × index_price` (`positions.py:154-163`), fail-loud when no usable index/mark. `_normalize_ccxt_positions:264-278` catches `ValueError` per-position and skips with a loud log — batch survives. Hand-computed fixtures assert exact values: inverse short size_base=0.2/size_usd=10000/uPnL=2500; linear USDC uPnL=120 pass-through (not ×index); option size_usd=250000/uPnL=500; zero filtered; index+mark=0 → ValueError; unknown coin → ValueError; `test_one_bad_position_does_not_drop_the_batch` → 1 good row survives. |
| 3 | Equity reconstruction for Deribit remains deliberately deferred (no Deribit equity leaks into the allocator equity curve) | ✓ VERIFIED | `equity_reconstruction.py:2493-2494` `run_refresh_allocator_equity_daily_job` skips `venue=='deribit'` holdings before the total/breakdown fan-in (guards the mixed-allocator leak). Reconstruct path skips `venue=='deribit'` at `:2147-2153` (emits audit, closes exchange, returns). `equity_reconstruction.DeribitNotSupportedError` retained (`:443`). Test `test_refresh_daily_excludes_deribit_derivatives` passes. |

**Score:** 3/3 truths verified

### Deferred Items

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | Live end-to-end acceptance of a real Deribit key rendering correctly on the Holdings panel, incl. the linear USDC/USDT `size`=quote-ccy denomination against real accounts | Phase 72 | ROADMAP Phase 72 "LTP Onboarding & Acceptance Verification" (hard acceptance gates). SUMMARY §Review-MEDIUM explicitly defers the linear-denomination live check to P72 onboarding. P71 unit fixtures verify the documented field semantics; PnL pass-through is correct regardless of denomination. |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `analytics-service/services/allocator_positions.py` | Deribit spot returns `[]`, error class removed, sync completes | ✓ VERIFIED | `_fetch_spot_rows:138-152`; error class gone; derivative path unchanged and reused. |
| `analytics-service/services/positions.py` | Deribit-aware inverse normalizer + per-position skip | ✓ VERIFIED | `_normalize_deribit_position:93`; branch at `:200`; batch-skip at `:253`. |
| `analytics-service/services/deribit_txn.py` | Single-source settlement classifier, fail-loud | ✓ VERIFIED | `classify_instrument_settlement:105-134` shared by ledger + position normalizer. |
| `analytics-service/services/equity_reconstruction.py` | Refresh + reconstruct skip venue=='deribit' | ✓ VERIFIED | Refresh guard `:2493`; reconstruct guard `:2147`; deferral class kept `:443`. |
| `src/lib/notes/scope-ref.ts` | Scope regex admits `-`/`_` Deribit instrument symbols | ✓ VERIFIED | `HOLDING_SCOPE_RE` widened `[A-Z0-9]+` → `[A-Z0-9_-]+`; still rejects `/`, `:`, lowercase. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `_normalize_deribit_position` | `deribit_txn.classify_instrument_settlement` | import + call | ✓ WIRED | `positions.py:145` import, `:148` call; single source for coin-vs-USD. |
| `_normalize_ccxt_position` | `_normalize_deribit_position` | Deribit branch | ✓ WIRED | `positions.py:200-201`; linear/other exchanges untouched. |
| `_fetch_derivative_rows` | `fetch_positions` → normalized rows | reuse | ✓ WIRED | `allocator_positions.py:243`; maps size_base/size_usd/uPnL into holdings. |
| `_normalize_ccxt_positions` | per-position ValueError skip | try/except | ✓ WIRED | `positions.py:266-275`; one bad instrument does not abort the batch. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Targeted Deribit suite (positions inverse/linear/option/zero/guards, allocator spot-deferred + class-removed, settlement classifier, equity refresh exclusion) | `pytest tests/test_positions.py::TestFetchPositionsDeribit tests/test_allocator_positions.py -k deribit... tests/test_deribit_txn.py -k settlement tests/test_equity_reconstruction.py::test_refresh_daily_excludes_deribit_derivatives` (CI py3.12 venv) | 10 passed, 57 deselected | ✓ PASS |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | No TBD/FIXME/XXX/HACK/PLACEHOLDER in any modified source | — | Clean |

### Human Verification Required

None blocking for Phase 71. The live-key end-to-end render is intentionally the Phase 72 acceptance gate (see Deferred Items) and does not gate this phase's goal — the three code-structural success criteria are each verified in source with passing, hand-computed tests.

### Gaps Summary

No gaps. All three success criteria are directly observable in the codebase (not just SUMMARY claims):

1. The f3 Path-B block is genuinely lifted at the source — Deribit spot returns `[]` before any network call, the `allocator_positions.DeribitNotSupportedError` class is deleted, and `fetch_allocator_holdings` completes with derivative rows. Proven by `test_deribit_renders_derivatives_spot_deferred` (warning=None, derivative row present, `fetch_balance` never called).
2. Deribit inverse normalization is implemented from the raw authoritative `info` fields with coin→USD PnL at index_price, single-sourced coin-vs-USD classification (fail-loud on unknown coin), and per-position skip so one anomalous instrument cannot hide the rest. Hand-computed fixtures assert the exact normalized numbers.
3. Deribit equity stays deferred on both the reconstruct and the daily-refresh paths, closing the mixed-allocator leak; the reconstruction deferral class is retained.

The only residual is the live-account acceptance (real Deribit key, real USDC/USDT denomination on the Holdings panel), which the roadmap and summary both assign to Phase 72's hard acceptance gates — correctly deferred, not a P71 gap.

---

_Verified: 2026-07-05_
_Verifier: Claude (gsd-verifier)_
