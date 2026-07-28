---
phase: 76-binance-bybit-okx-flow-adapters-reconciliation-gate
verified: 2026-07-06T00:00:00Z
status: human_needed
score: 4/4 must-haves verified (SC4 wallet-scope deferred per 76-05-CHECKPOINT.md)
overrides_applied: 0
human_verification:
  - test: "Binance SPOT vs USDⓈ-M wallet scope confirmation"
    expected: "Confirm whether the live Binance account holds capital in both SPOT and USDⓈ-M wallets; if so, anchor + PnL + flows must read the SAME combined pool; adjust exchange.py anchor read accordingly"
    why_human: "Cannot determine from code whether founder's Binance account is SPOT-only or SPOT+USDⓈ-M; requires live account roster examination"
  - test: "Bybit FUND / UNIFIED / CONTRACT wallet scope confirmation"
    expected: "Confirm whether anchor should cover FUND+UNIFIED+CONTRACT combined (or net them); a FUND→UNIFIED own-transfer inflates the UNIFIED anchor if anchor is UNIFIED-only"
    why_human: "Cannot determine from code which wallet pool the founder's Bybit account holds capital in; requires live account roster examination"
---

# Phase 76: Binance/Bybit/OKX Flow Adapters + Reconciliation Gate — Verification Report

**Phase Goal:** The three ccxt venues source dated external flows through one promoted-shared helper, each excluding own-wallet transfers, and a missing-flow reconciliation gate refuses to silently attribute a coverage gap to performance (the LTP068-inflation class at venue scope).
**Verified:** 2026-07-06
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `_fetch_transfers` promoted to shared `ccxt_flow_fetch.py` with zero behavior change; OKX/Bybit under-pagination fixed | VERIFIED | `services/ccxt_flow_fetch.py` exists with public `fetch_ccxt_transfers`; `equity_reconstruction.py:34` imports it; old `async def _fetch_transfers` absent; characterization pin GREEN (1 passed); pagination `len(page)<page_limit` break removed, cursor-advance termination proven by OKX 100/page + Bybit 50/page multi-page fixtures |
| 2 | `ccxt_rows_to_dated_flows` builds event-time valuation NEW: stablecoins→1.0, non-stables→same-UTC-day close, fail-loud if absent — no 1.0/current-price fallback for non-stables | VERIFIED | `services/ccxt_flows.py:191-203`: stablecoins branch sets `price=1.0`; non-stable branch calls `price_index.get((day, currency))` and raises `NavReconstructionError` if `None` — never falls back to 1.0 or current; purity source-scan test confirms no ccxt/pandas/network imports; mypy --strict clean |
| 3 | Per-venue own-transfer exclusion: Binance `internal is False`, Bybit raw `info.withdrawType=='0'`, OKX structural keep-all; one fixture/venue proving deposit-only becomes F_t | VERIFIED | `ccxt_flows.py:75-87` implements three distinct branches; `test_binance_own_transfer_excluded_only_deposit_survives`, `test_bybit_own_transfer_uses_raw_withdrawtype_not_internal`, `test_okx_structural_external_keeps_none_internal_rows` all GREEN; mutation-honesty verified (neutering each filter causes test to RED) |
| 4 | SC3 (DQ-02): `reconcile_flow_residual` (identity, tolerance max($1,1e-6·\|anchor\|)) + `apply_flow_coverage_terminus` (segments at terminus, refuses pre-terminus TWR, flags `complete_with_warnings`) + transient-vs-terminal. Wired in job_worker else-branch; status lifted through broker→CSV path | VERIFIED | `nav_twr.py:361-467`: both functions exist with correct tolerance; `nav_twr.py:511`: `reconcile_flow_residual` called inside `reconstruct_nav_and_twr` with reconstructed_start from rolled nav; `job_worker.py:2233-2242`: `apply_flow_coverage_terminus` applied post-combine; `analytics_runner.py:1742-1834`: `flow_coverage_incomplete` in DataQualityFlags + lift loop + `run_csv_strategy_analytics` preserves pre-stamp; transforms.py UNTOUCHED (0 lines changed across all 9 P76 commits); SC-4 stays `complete` confirmed by `test_csv_run_stays_complete_without_flow_coverage_flag` |
| 4a | SC4/wallet-scope: DEFERRED to P78 with DQ-02 residual as interim fail-loud net | VERIFIED | `76-05-CHECKPOINT.md` exists; explicitly records what needs founder confirmation (Binance SPOT/USDⓈ-M, Bybit FUND/UNIFIED); notes the DQ-02 residual makes wrong scope fail loud; action scheduled for Phase 78 acceptance gate |

**Score:** 4/4 truths verified (SC4 wallet-scope is a documented human_needed per the phase_goal note, not a gap)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `analytics-service/services/ccxt_flow_fetch.py` | Shared ccxt transfer-fetch I/O helper (fetch_ccxt_transfers) | VERIFIED | 113 lines; `fetch_ccxt_transfers` + `_rate_limit_sleep`; cursor-advance pagination; WR-04 discipline preserved |
| `analytics-service/services/ccxt_flows.py` | Pure ccxt event-time flow adapter (ccxt_rows_to_dated_flows) | VERIFIED | 208 lines; per-venue own-transfer filter + event-time USD valuation; PriceIndex alias; fail-loud on absent price |
| `analytics-service/services/nav_twr.py` | DQ-02 gate functions + per-venue constants | VERIFIED | `reconcile_flow_residual` (line 361), `flow_coverage_terminus_day` (line 410), `apply_flow_coverage_terminus` (line 437), `FLOW_TERMINUS_DAYS_BY_VENUE` (lines 83-87), `flow_coverage_incomplete` in NavTWRMeta (line 106) |
| `analytics-service/services/job_worker.py` | ccxt else-branch wiring + DQ-02 terminus post-combine + pre-stamp | VERIFIED | Lines 1945-2242: imports, fetch, price resolution, `ccxt_rows_to_dated_flows`, `apply_flow_coverage_terminus`, pre-stamp on strategy_analytics |
| `analytics-service/services/analytics_runner.py` | `flow_coverage_incomplete` in DataQualityFlags + guard-lift + CSV run promote | VERIFIED | Lines 179, 1742-1834, 2130-2160: flag declared, guard-lift loop, run_csv reads+preserves+promotes |
| `analytics-service/tests/test_exchange_pagination.py` | OKX 100/page + Bybit 50/page multi-page proofs | VERIFIED | 4 transfer pagination tests at lines 323-413; all GREEN |
| `analytics-service/tests/test_ccxt_flows.py` | 17 mutation-honest own-transfer + valuation proofs | VERIFIED | 15 test functions; per-venue own-transfer, stablecoin=1.0, same-day-close, fail-loud absent price, signs, collapse, schema-drift guards |
| `analytics-service/tests/test_nav_twr.py` | 14 DQ-02 mutation-honest tests | VERIFIED | 30 total tests (16 P73 baseline + 14 new); identity-residual holds-by-construction, dropped-flow RED, wallet-scope W3 RED, terminus NaN+flag, transient no-segment, meta lift |
| `analytics-service/tests/test_job_worker.py` | 8 end-to-end flow integration tests | VERIFIED | Lines 1451-1650: same-day-close valuation, stablecoin no-price-source, per-venue own-transfer (binance/bybit), OKX structural, retention-gap segment, transient retryable, open-position reconcile |
| `analytics-service/tests/test_analytics_runner.py` | 3 status-lift tests | VERIFIED | Lines 5680-5730: csv_run promotes on pre-stamp, csv_run stays complete without flag, run_strategy_analytics guard-lift |
| `.planning/phases/76-.../76-05-CHECKPOINT.md` | Wallet-scope deferral documented for Phase 78 | VERIFIED | Exists; explains Binance SPOT/USDⓈ-M + Bybit FUND/UNIFIED questions; safety net = DQ-02 residual |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `equity_reconstruction.py:34` | `ccxt_flow_fetch.fetch_ccxt_transfers` | `from services.ccxt_flow_fetch import _rate_limit_sleep, fetch_ccxt_transfers` | WIRED | Allocator consumer re-pointed; old `_fetch_transfers` absent |
| `job_worker.py:1945-1946` | `ccxt_flow_fetch.fetch_ccxt_transfers` + `ccxt_flows.ccxt_rows_to_dated_flows` | imports in ccxt else-branch | WIRED | Lines 2143-2160: fetch deposits+withdrawals, resolve price_index, call ccxt_rows_to_dated_flows |
| `job_worker.py:2172-2175` | `combine_realized_and_funding` | `external_flows=external_flows` param | WIRED | Same seam as deribit branch (line 2174 confirms) |
| `nav_twr.py:511` | `reconcile_flow_residual` | called inside `reconstruct_nav_and_twr` | WIRED | DQ-02 identity self-check fires on every reconstruction |
| `job_worker.py:2233-2242` | `apply_flow_coverage_terminus` | applied post-combine on returns Series | WIRED | Terminus gate applied; `flow_coverage_incomplete` meta propagated |
| `job_worker.py:2368-2375` | `strategy_analytics.data_quality_flags` | pre-stamp dict upsert | WIRED | Pre-stamps before CSV run so run_csv_strategy_analytics can read it |
| `analytics_runner.py:2154-2160` | status promotion | reads pre-stamped `flow_coverage_incomplete`, promotes to `complete_with_warnings` | WIRED | Verified by `test_csv_run_promotes_to_warnings_when_flow_coverage_prestamped` |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `ccxt_flows.py::ccxt_rows_to_dated_flows` | `price_index` (injected) | OHLCV/CoinGecko/token_price_history via `_resolve_ccxt_flow_price_index` in job_worker | Real daily-close prices from DB + exchange API | FLOWING |
| `nav_twr.py::reconcile_flow_residual` | `flows_by_day`, `daily_pnl`, `terminal_nav` | backward-rolled NAV (real DB data) | Self-consistent by construction; reddens on mutation | FLOWING |
| `analytics_runner.py::run_csv_strategy_analytics` | `flow_coverage_incomplete` | pre-stamped in `derive_broker_dailies` / `job_worker.py:2368-2375` | Real flag from retention-gap detection | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Characterization pin: allocator equity-reconstruction byte-identical across promotion | `pytest tests/test_equity_reconstruction.py -k byte_identical_across_transfers_promotion -q` | 1 passed | PASS |
| ccxt_flows 17-test suite | `pytest tests/test_ccxt_flows.py tests/test_exchange_pagination.py tests/test_nav_twr.py -q` | 63 passed in 1.63s | PASS |
| job_worker + analytics_runner suite | `pytest tests/test_job_worker.py tests/test_analytics_runner.py -q` | 231 passed, 1 skipped | PASS |
| Full analytics suite (3083 baseline claimed in 76-04-SUMMARY.md) | `pytest --tb=no -q` | 3083 passed, 92 skipped | PASS |
| mypy --strict on pure modules | `mypy --strict services/ccxt_flow_fetch.py services/ccxt_flows.py services/nav_twr.py` | Success: no issues found in 3 source files | PASS |
| mypy --strict on wiring files | `mypy --strict services/job_worker.py services/analytics_runner.py services/equity_reconstruction.py` | Success: no issues found in 3 source files | PASS |

### Probe Execution

No declared probes for this phase. Step 7c: SKIPPED (no probe-*.sh files declared or conventional).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| FLOW-03 | 76-01 through 76-04 | Three ccxt venues source dated external flows through one shared fetch path, excluding own-transfers, event-time valued | SATISFIED | `fetch_ccxt_transfers` is the ONE shared path; `ccxt_rows_to_dated_flows` pure valuer; `job_worker.py` else-branch wired for binance/bybit/okx; own-transfer exclusion proven per-venue |
| FLOW-03 (wallet-scope leg) | 76-05-CHECKPOINT | Anchor + PnL + flows read same capital pool (Binance SPOT/USDⓈ-M, Bybit FUND/UNIFIED) | NEEDS HUMAN | Deferred to Phase 78; DQ-02 residual is interim fail-loud net |
| DQ-02 | 76-03, 76-04 | Reconciliation gate refuses to attribute coverage gap to performance | SATISFIED | `reconcile_flow_residual` wired in `reconstruct_nav_and_twr`; `apply_flow_coverage_terminus` applied post-combine; per-venue retention constants OKX 90/Bybit 365/Binance None; status lifted through broker→CSV path |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | — | No TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER markers found in phase-76 modified files | — | — |

### Human Verification Required

#### 1. Binance SPOT vs USDⓈ-M Wallet Scope

**Test:** Check the live Binance account roster. Determine whether the founder's Binance account holds capital in SPOT only, USDⓈ-M futures only, or both.
**Expected:** If capital is in one wallet only, no change needed. If in both, `exchange.py` anchor read must combine both pools so anchor, PnL, and flows all read the same capital.
**Why human:** Code cannot introspect the live account structure; the DQ-02 residual will fail loud if the scope is wrong, but the right fix requires the founder to confirm which wallets hold capital.

#### 2. Bybit FUND / UNIFIED / CONTRACT Wallet Scope

**Test:** Check the live Bybit account roster. Determine whether FUND, UNIFIED, and/or CONTRACT wallets all hold capital that the anchor, PnL, and flow history must cover.
**Expected:** If anchor already covers the right pool, no change needed. If FUND→UNIFIED own-transfers inflate the anchor, confirm whether the anchor must be expanded to FUND+UNIFIED or UNIFIED-only is correct.
**Why human:** Same reason — live account roster is opaque to code; DQ-02 residual is the fail-loud interim net until P78 confirms.

(Both items are deferred to Phase 78 acceptance gate per 76-05-CHECKPOINT.md. The DQ-02 residual ensures that if the wallet scope is wrong, the reconstruction raises `NavReconstructionError` rather than silently mis-attributing capital. This is a `human_needed`, NOT a gap — the deferred confirmation was designed into the phase from the start.)

### Gaps Summary

No code gaps. All four Success Criteria are satisfied in the codebase:

- **SC1:** `ccxt_flow_fetch.py` is the one shared fetch path; byte-identity pin GREEN; OKX/Bybit pagination bug fixed.
- **SC1/valuation:** `ccxt_flows.ccxt_rows_to_dated_flows` values non-stables at same-UTC-day close only — no 1.0/current fallback path exists.
- **SC2:** Per-venue own-transfer exclusion is mutation-honest and proven in fixtures for all three venues.
- **SC3 (DQ-02):** `reconcile_flow_residual` + `apply_flow_coverage_terminus` wired in the correct locations; status propagated through broker→CSV path; transforms.py untouched.
- **SC4:** Wallet-scope leg deliberately deferred to Phase 78 with a recorded checkpoint and a fail-loud interim net (DQ-02 residual). This is an `acceptable expected human_needed` per the phase_goal note.

The only items requiring human attention are the two wallet-scope confirmation questions at Phase 78. The DQ-02 residual makes a wrong scope produce a loud `NavReconstructionError` rather than silent inflation — so production is safe until the confirmation happens.

---

_Verified: 2026-07-06_
_Verifier: Claude (gsd-verifier)_
