---
phase: 77-upnl-basis-reconciliation
verified: 2026-07-06T00:00:00Z
status: human_needed
score: 4/4 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Confirm Deribit `session_upl` field name on a live account with open positions"
    expected: "fetch_deribit_account_equity_and_upnl_usd returns a non-zero open_unrealized_usd; absent-field fallback stays 0.0 if the field is misnamed"
    why_human: "The field name `session_upl` is tagged [ASSUMED A1] in code — HIGH confidence from Deribit schema docs but not confirmed against a live LTP read at wiring time. No programmatic way to verify the ccxt response shape against a running Deribit account."
  - test: "Confirm a live OKX account with a material open position (|uPnL|/equity > 5%) shows `complete_with_warnings` on its factsheet after a derive run"
    expected: "factsheet computation_status is 'complete_with_warnings'; data_quality_flags.unrealized_pnl_in_anchor is true"
    why_human: "End-to-end promotion path (companion read → combine → post-combine recompute → pre-stamp → analytics_runner promotion predicate) crosses four async layers and a DB upsert; only a full derive run on a live material-wedge account confirms all handoffs"
---

# Phase 77: uPnL Basis Reconciliation — Verification Report

**Phase Goal:** The realized-vs-mark-to-market basis wedge is made explicit — backward roll realized-basis (`terminal_nav = anchor − open_unrealized_usd`), uPnL re-added only to the reported current NAV, material wedge (`|uPnL|/anchor > 5%`) flags `unrealized_pnl_in_anchor` (`complete_with_warnings`). VENUE-GATED: OKX/Deribit MTM subtract; Bybit/Binance realized → wedge 0.0. Per-day true-up DEFERRED (marks not retrievable). Requirement FLOW-04, SCs 1–4.
**Verified:** 2026-07-06
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC-1: OKX companion open-uPnL read from the SAME response (no new fetch); Deribit `session_upl` from the SAME summaries; Bybit/Binance structural 0.0 | VERIFIED | `exchange.py:2705–2809` `fetch_okx_total_equity_and_upl_usd` reads `data[0].upl` from the same `private_get_account_balance` object; `fetch_account_equity_and_upnl_usd` returns structural 0.0 for Bybit/Binance. `deribit_ingest.py:706–813` `_deribit_session_upl_to_usd` sums `session_upl` [ASSUMED A1] from the same summaries + same index_prices. Awaited-once test (`test_okx_upl_single_call_companion`) and Bybit/Binance structural-zero test confirmed. |
| 2 | SC-2: Roll terminal is realized-basis (`anchor − open_unrealized_usd`); derive path threads the wedge through combine without mutating stored equity; no step discontinuity | VERIFIED | `nav_twr.py:544` `terminal_nav = anchor - upnl`. `job_worker.py:2007–2109` both branches (deribit / ccxt) capture `open_unrealized_usd`; `combine_realized_and_funding(..., open_unrealized_usd=open_unrealized_usd)` at `:2203`. Test `test_material_wedge_does_not_mutate_stored_equity_scalar` asserts `account_balance == equity` (full, unmutated) and wedge only on `open_unrealized_usd` kwarg. `test_no_step_discontinuity_large_open_position` proves byte-identity to pre-reduced anchor. |
| 3 | SC-3: `\|uPnL\|/anchor > 5%` → `unrealized_pnl_in_anchor` + `complete_with_warnings` lifted end-to-end; immaterial → clean; dust/noise-guarded | VERIFIED | Core: `nav_twr.py:569` `if anchor > DUST_NAV_FLOOR and abs(upnl) / anchor > UNREALIZED_MATERIALITY_RATIO`. Post-combine recompute in `job_worker.py:2257–2263` using same constants imported from nav_twr. `analytics_runner.py:186` `DataQualityFlags.unrealized_pnl_in_anchor`; `:1761` lift loop; `:1848` promotion predicate; `:2177` broker CSV lift. Tests: `test_unrealized_pnl_in_anchor_materiality_boundary`, `test_status_guard_promotion_unrealized_pnl_in_anchor_lifts_and_promotes`, `test_csv_run_promotes_to_warnings_when_unrealized_pnl_prestamped`, `test_csv_run_stays_complete_without_unrealized_pnl_flag`. |
| 4 | SC-4: Bybit/Binance flow-less return byte-identical (no double-count); per-day true-up NOT implemented (source-scanned); realized-basis invariant in core docstring | VERIFIED | Source-scan test `test_no_historical_mark_no_perday_upnl_array` asserts no `unrealized.*Series`/`upnl.*iloc`/per-day loop in `nav_twr.py` and confirms the invariant phrases `"not retrievable on read-only keys"` and `"never spread across history"` exist in the source. `test_walletbalance_venue_wedge_zero_no_double_count` pins Bybit/Binance returns byte-identical with a load-bearing mutation partner. Invariant documented at `nav_twr.py:514–528`. |

**Score:** 4/4 truths verified

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `analytics-service/services/nav_twr.py` | `UNREALIZED_MATERIALITY_RATIO`; `unrealized_pnl_in_anchor` on `NavTWRMeta`; materiality computation + invariant docstring in `reconstruct_nav_and_twr` | VERIFIED | Line 72: `UNREALIZED_MATERIALITY_RATIO = 0.05`; line 121: `unrealized_pnl_in_anchor: bool` on `NavTWRMeta`; line 373: `_build_nav_meta` assignment; lines 514–528: invariant docstring; line 569: materiality gate. |
| `analytics-service/services/exchange.py` | `fetch_okx_total_equity_and_upl_usd`; `fetch_account_equity_and_upnl_usd` venue dispatch; `_okx_upl_or_zero` | VERIFIED | Lines 2690–2809. Existing `fetch_okx_total_equity_usd` and `fetch_account_equity_usd` delegate to new 3-tuple functions (byte-identical callers). |
| `analytics-service/services/deribit_ingest.py` | `fetch_deribit_account_equity_and_upnl_usd`; `_deribit_session_upl_to_usd`; `fetch_deribit_account_equity_usd` delegation | VERIFIED | Lines 706–834. Existing `fetch_deribit_account_equity_usd` delegates to new 3-tuple. |
| `analytics-service/services/job_worker.py` | 3-tuple companion reads; noise guard; wedge threaded into combine; post-combine recompute; `_BROKER_WARN_FLAGS` addition | VERIFIED | Lines 2007–2009 (deribit branch), 2108–2110 (ccxt branch), 2186–2191 (noise guard), 2201–2203 (combine call), 2257–2263 (post-combine recompute), 2425–2433 (`_BROKER_WARN_FLAGS`). |
| `analytics-service/services/analytics_runner.py` | `unrealized_pnl_in_anchor` on `DataQualityFlags`; lift loop; promotion predicate; CSV broker lift | VERIFIED | Lines 186, 1761, 1848, 2177. |
| `analytics-service/tests/test_nav_twr.py` | Wedge equivalence, no-step, materiality boundary, dust suppression, source-scan, reconcile-non-breach tests | VERIFIED | Lines 810–985: 6 targeted tests present and green. |
| `analytics-service/tests/test_exchange.py` | OKX single-call, negative-sign, missing-upl, Bybit/Binance zero, balance-error tests | VERIFIED | Lines 5672–5766: 5 tests. |
| `analytics-service/tests/test_job_worker_deribit.py` | Deribit session-uPnL, USD-family passthrough, missing-field fallback, failed-read, unvaluable-ccy tests | VERIFIED | Lines 228–326: 5 tests + `_FakeDeribitSummaries` stub. |
| `analytics-service/tests/test_job_worker.py` | Venue-gated threading, Bybit/Binance byte-identity, heuristic guard, dust guard, no-stored-scalar Q4 pin | VERIFIED | Lines 1865–2045: 6 tests. |
| `analytics-service/tests/test_analytics_runner.py` | run_strategy_analytics lift+promote, CSV broker-path promote, SC-4 stays-complete | VERIFIED | Lines 2469–5891: 3 targeted tests. |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `derive_broker_dailies` deribit branch | `combine_realized_and_funding(open_unrealized_usd=...)` | `fetch_deribit_account_equity_and_upnl_usd` → noise guard → combine | WIRED | `job_worker.py:2007–2203` |
| `derive_broker_dailies` ccxt else-branch | `combine_realized_and_funding(open_unrealized_usd=...)` | `fetch_account_equity_and_upnl_usd` → noise guard → combine | WIRED | `job_worker.py:2108–2203` |
| `meta.unrealized_pnl_in_anchor` | `strategy_analytics.data_quality_flags` | post-combine recompute + `_BROKER_WARN_FLAGS` pre-stamp | WIRED | `job_worker.py:2257–2263`, `:2432`, `:2435–2437` |
| `data_quality_flags.unrealized_pnl_in_anchor` | `computation_status = "complete_with_warnings"` | `analytics_runner` lift loop + promotion predicate + CSV broker lift | WIRED | `analytics_runner.py:1761`, `:1848`, `:2177` |
| `reconstruct_nav_and_twr` | realized-basis terminal | `terminal_nav = anchor - upnl` (nav_twr.py:544) | WIRED | `broker_dailies.py:157` threads to `nav_twr.py:504` |

---

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|--------------------|--------|
| `nav_twr.reconstruct_nav_and_twr` | `open_unrealized_usd` | `exchange.fetch_account_equity_and_upnl_usd` (OKX `upl`) / `deribit_ingest.fetch_deribit_account_equity_and_upnl_usd` (`session_upl`) | Yes for OKX (live `data[0].upl`); ASSUMED for Deribit (`session_upl` field name) | FLOWING (OKX confirmed; Deribit assumed — see human check) |
| `job_worker.meta["unrealized_pnl_in_anchor"]` | post-combine recompute | `abs(open_unrealized_usd) / abs(equity) > UNREALIZED_MATERIALITY_RATIO` on noise-guarded values | Yes — real exchange wedge | FLOWING |
| `analytics_runner.computation_status` | `consumer_specific_flags` predicate | `data_quality_flags.unrealized_pnl_in_anchor` pre-stamped by job_worker | Real flag from live wedge | FLOWING |

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full analytics suite green at 3117 | `venv312/bin/python -m pytest -q --tb=no` | **3117 passed, 92 skipped** | PASS |
| Core materiality tests | `pytest tests/test_nav_twr.py -k "unrealized_pnl_in_anchor or wedge_equiv or no_step or no_historical_mark"` | All targeted tests included in 3117 | PASS |
| OKX venue-gated wedge tests | `pytest tests/test_exchange.py -k "okx_upl or upnl or wedge or zero"` | All 8 targeted tests included | PASS |
| Deribit session_upl tests | `pytest tests/test_job_worker_deribit.py -k "session_upl or upnl or wedge or fallback"` | All 5 targeted tests included | PASS |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| FLOW-04 | 77-01, 77-02, 77-03 | uPnL basis reconciliation — companion read + realized-basis terminal + materiality flag. Per-day true-up ONLY if marks retrievable (they are not) | SATISFIED | REQUIREMENTS.md marks FLOW-04 Complete. 77-01 core flag + 77-02 reads + 77-03 wiring all deliver. Realized-basis-intraday / MTM-at-endpoint invariant documented + source-scanned. |

---

## Focus Item 5: Duplicated Materiality Computation Consistency

The materiality flag is computed in two places due to the P74-pinned `transforms._merge_status_meta` boundary dropping the core-raised key.

**Place 1 — Core (`nav_twr.py:569`):**
```python
if anchor > DUST_NAV_FLOOR and abs(upnl) / anchor > UNREALIZED_MATERIALITY_RATIO:
```

**Place 2 — job_worker post-combine (`job_worker.py:2257–2262`):**
```python
if (
    open_unrealized_usd != 0.0
    and equity is not None
    and abs(equity) > DUST_NAV_FLOOR
    and abs(open_unrealized_usd) / abs(equity) > UNREALIZED_MATERIALITY_RATIO
):
```

**Agreement for positive equity (all normal cases):** IDENTICAL. Both import the same constants (`UNREALIZED_MATERIALITY_RATIO = 0.05`, `DUST_NAV_FLOOR = 1000.0`) from `nav_twr`. For positive equity, `abs(equity) > DUST_NAV_FLOOR` equals `equity > DUST_NAV_FLOOR`, and `abs(wedge) / abs(equity)` equals `abs(wedge) / equity`. The computations cannot disagree on the normal operating range.

**Theoretical divergence for negative-equity Deribit accounts (edge case only):**

The core uses `anchor > DUST_NAV_FLOOR` (no `abs()`), which is False for any negative anchor. job_worker uses `abs(equity) > DUST_NAV_FLOOR`, which is True for large-magnitude negative equity. Consequently, a Deribit account with, say, equity = −5000 and a non-zero wedge would:
- Core: `−5000 > 1000` → False → flag NOT raised
- job_worker: `abs(−5000) = 5000 > 1000` → True → ratio check proceeds → flag COULD fire

**Gating to Deribit only:**
- OKX: `fetch_okx_total_equity_and_upl_usd` returns `(eq if eq > 0 else None)` — non-positive equity gates to None → noise guard forces wedge = 0.0 → early exit on `open_unrealized_usd != 0.0`
- Bybit/Binance: structural 0.0 wedge → early exit on `open_unrealized_usd != 0.0`
- Deribit: `deribit_equity_to_usd` CAN return a negative value (sum of coin equities for an underwater account)

**Practical impact:**
- Negative-equity Deribit accounts are deeply distressed; they would already have `negative_nav_guard` set by DQ-01.
- The divergence causes OVER-WARNING (a spurious `unrealized_pnl_in_anchor` on an already-flagged account), not missed warnings. No false-clean result is possible.
- For the materiality threshold (ratio check), the denominator divergence (`anchor` vs `abs(equity)`) only matters for negative equity; for negative equity, the core's `abs(upnl) / anchor` (negative denominator → negative ratio → never > 0.05) ensures the core never fires, while job_worker can.

**Classification: WARNING (not BLOCKER)** — the two computations agree exactly for all positive-equity scenarios (the only operational range for OKX, Bybit, Binance; and the normal range for Deribit). The divergence is bounded to negative-equity Deribit accounts, which are already severely flagged.

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `exchange.py` | 1925 | `TODO G12.B.8` | Info | Pre-existing; references a formal follow-up item; not in 77-modified paths |
| `job_worker.py` | 1081 | `TODO G12.A.6` | Info | Pre-existing; references a formal follow-up item; not in 77-modified code paths |
| `deribit_ingest.py` | 713, 734, 765 | `[ASSUMED A1]` | Warning | Deribit `session_upl` field name is HIGH-confidence but not live-confirmed; safe 0.0 fallback prevents fabricated data; requires human verification |

No TBD, FIXME, or XXX markers found in any file modified by phase 77.

---

## Human Verification Required

### 1. Deribit `session_upl` Field Name

**Test:** On a live Deribit account (e.g., LTP-series with open positions), trigger a `derive_broker_dailies` job and inspect the returned `open_unrealized_usd`. Alternatively, call `fetch_deribit_account_equity_and_upnl_usd` on a live Deribit exchange object and print the wedge.

**Expected:** `open_unrealized_usd` is non-zero and reasonable (matches the sum of session unrealized PnL from the Deribit UI). If the field is misnamed, the wedge silently falls back to 0.0 (safe, never fabricated) but the materiality flag will never fire on live accounts.

**Why human:** The field name `session_upl` comes from the Deribit account-summary schema ([ASSUMED A1]); no live LTP fixture captures the raw `get_account_summaries` response with open positions. Cannot verify programmatically in the codebase.

### 2. End-to-End Factsheet Promotion on Live Material-Wedge Account

**Test:** On a live OKX account where `|uPnL| / equity > 5%` at the time of the derive run, verify that the factsheet shows `computation_status = "complete_with_warnings"` and `data_quality_flags.unrealized_pnl_in_anchor = true` after the run completes.

**Expected:** The factsheet promotes to `complete_with_warnings` and the flag is visible in the DQ flags panel (or data_quality_flags JSONB column).

**Why human:** The end-to-end DQ bridge spans five layers (companion read → noise guard → combine → post-combine recompute → pre-stamp → analytics_runner promotion predicate → factsheet render). Full promotion is only demonstrable on a real derive run with a live material-wedge account; unit tests exercise each layer in isolation.

---

## Gaps Summary

No gaps. All 4 ROADMAP success criteria are verified against the codebase. The `human_needed` status reflects two items requiring live-account confirmation (Deribit `session_upl` field name and end-to-end factsheet promotion), not any code correctness gap.

---

_Verified: 2026-07-06_
_Verifier: Claude (gsd-verifier)_
