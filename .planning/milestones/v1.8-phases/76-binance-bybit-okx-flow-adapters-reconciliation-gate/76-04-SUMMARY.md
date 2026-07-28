---
phase: 76-binance-bybit-okx-flow-adapters-reconciliation-gate
plan: 04
subsystem: analytics
tags: [ccxt, external-flows, event-time-valuation, twr, dq-02, flow-coverage-terminus, status-lift, binance, bybit, okx, fail-loud]

# Dependency graph
requires:
  - phase: 76-01
    provides: "fetch_ccxt_transfers — the shared promoted ccxt deposit/withdrawal fetch path"
  - phase: 76-02
    provides: "ccxt_rows_to_dated_flows pure valuer + canonical PriceIndex key tuple[str,str]=(YYYY-MM-DD, UPPER ccy)"
  - phase: 76-03
    provides: "reconcile_flow_residual internal self-check + apply_flow_coverage_terminus + flow_coverage_terminus_day + per-venue retention constants + flow_coverage_incomplete NavTWRMeta key"
  - phase: 74-03
    provides: "the DataQualityFlags NAV-guard lift loop + complete_with_warnings promotion predicate this extends"
provides:
  - "services/job_worker.py ccxt else-branch wiring: fetch_ccxt_transfers → _resolve_ccxt_flow_price_index (reuses OHLCV/CoinGecko/token_price_history) → ccxt_rows_to_dated_flows → external_flows → combine_realized_and_funding at the deribit seam (FLOW-03 complete)"
  - "DQ-02 terminus gate applied POST-combine via apply_flow_coverage_terminus (transforms.py untouched; P74 byte-identity pins green) + flow_coverage_incomplete pre-stamp channel"
  - "analytics_runner status lift: flow_coverage_incomplete in DataQualityFlags + run_strategy_analytics guard-lift loop + predicate + run_csv_strategy_analytics read/preserve/promote (DQ-02 complete)"
affects: [77-uPnL-wedge, DQ-02, FLOW-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "I/O price resolver reuses the existing OHLCV → cached token_price_history → CoinGecko source; day key via epoch_ms_to_iso_day aligns with the pure valuer's _row_utc_day (canonical PriceIndex key, no new fetcher)"
    - "DQ-02 terminus applied POST-combine on the returns Series (standalone helper), never threaded through transforms.py — the high-blast-radius shared path stays byte-identical"
    - "Coverage-gap flag crosses the broker→CSV factsheet boundary via a strategy_analytics pre-stamp that run_csv_strategy_analytics reads + preserves (a full upsert would otherwise wipe it)"
    - "WR-04 transient discipline: fetch_ccxt_transfers bubbles all but ccxt.NotSupported and _fetch_ohlcv_daily catches only ccxt.BadSymbol → a transient blip stays retryable, never a segment or a permanent truncation"

key-files:
  created: []
  modified:
    - analytics-service/services/job_worker.py
    - analytics-service/services/broker_dailies.py
    - analytics-service/services/analytics_runner.py
    - analytics-service/tests/test_job_worker.py
    - analytics-service/tests/test_analytics_runner.py

key-decisions:
  - "Bound the ccxt flow lookback to the venue's deposit-history retention (OKX 90d / Bybit 365d; Binance no cap → full history) so we never spin empty pre-inception 90-day windows and the DQ-02 terminus segments anything the return window extends before that retention"
  - "Realized basis only — open_unrealized_usd left at 0.0 (Phase 77 owns the uPnL wedge). The internal DQ-02 residual is self-consistent by construction, so an open-position account (uPnL in the anchor) reconciles without a spurious breach; proven by a dedicated acceptance test"
  - "The plan's status-lift line-refs (~:1704/~:1775) point at run_strategy_analytics, but the ccxt broker factsheet is compiled by run_csv_strategy_analytics reading csv_daily_returns — so the flag is PRE-STAMPED in derive_broker_dailies and the CSV run reads+preserves+promotes it, the only channel that makes flow_coverage_incomplete genuinely surface (documented deviation, Rule 2)"

patterns-established:
  - "FLOW-03 ccxt wire: else-branch mirrors the deribit branch seam exactly (external_flows initialized None → set from the pure valuer → threaded into combine → reconstruct_nav_and_twr does the ONE honest flow correction)"

requirements-completed: [FLOW-03, DQ-02]

# Metrics
duration: ~95min
completed: 2026-07-06
---

# Phase 76 Plan 04: ccxt Flow Wire + DQ-02 Gate Application Summary

**The binance/okx/bybit else-branch now sources event-time dated flows end-to-end (promoted fetch → I/O price resolver that reuses the existing OHLCV/CoinGecko/token_price_history source → pure event-time valuer → external_flows → the honest core at the deribit seam), applies the DQ-02 flow-coverage terminus POST-combine to refuse a retention-gap TWR, and lifts `flow_coverage_incomplete` through the broker→CSV factsheet pipeline to `complete_with_warnings` — FLOW-03 and DQ-02 are complete on all three ccxt venues.**

## Performance
- **Duration:** ~95 min
- **Completed:** 2026-07-06
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- **FLOW-03 complete:** the ccxt else-branch fetches deposits + withdrawals via the promoted `fetch_ccxt_transfers`, resolves each non-stable currency's same-UTC-day close through the EXISTING price source (no new fetcher), runs the pure `ccxt_rows_to_dated_flows`, and threads `external_flows` into `combine_realized_and_funding` at the exact seam the deribit branch uses. A mid-window deposit no longer silently inflates the TWR; own-transfers are excluded per venue (proven mutation-honest end-to-end).
- **DQ-02 complete:** `flow_coverage_terminus_day` derives the coverage terminus (OKX 90 / Bybit 365 / Binance None) from the retention-vs-return window; `apply_flow_coverage_terminus` NaNs the pre-terminus days POST-combine (transforms.py untouched → Phase 74 byte-identity pins stay green), refusing a fabricated return over the gap. `flow_coverage_incomplete` is pre-stamped and surfaced through `run_csv_strategy_analytics` → `complete_with_warnings`; a full-coverage account stays exact-string `complete` (SC-4).
- **Residual-activation safety verified:** an open-position account (uPnL in the anchor) reconciles on the realized basis (open_unrealized_usd defaulted 0.0) — the internal DQ-02 residual self-check does not spuriously breach.
- **Transient vs terminal pinned:** a transient transfer-fetch error bubbles retryable (never a segment, never a truncation); a structural `NavReconstructionError` stays permanent-failed and scrubbed at the existing seam.

## Task Commits
1. **Task 1: wire the ccxt else-branch (fetch → price resolver → pure valuer → core)** — `ddcbd0de` (feat)
2. **Task 2: apply the DQ-02 terminus gate post-combine + status lift + end-to-end acceptance** — `de3f0af4` (feat)

## Files Created/Modified
- `analytics-service/services/job_worker.py` — ccxt else-branch flow wiring (`fetch_ccxt_transfers` + `_resolve_ccxt_flow_price_index` I/O resolver + `ccxt_rows_to_dated_flows` → `external_flows`); retention-bounded lookback; POST-combine `apply_flow_coverage_terminus` with tz-naive-UTC `now`; `flow_coverage_incomplete` pre-stamp onto strategy_analytics.
- `analytics-service/services/broker_dailies.py` — docstring: ccxt venues now enumerate deposits/withdrawals (mid-window flows captured, no longer a flagged limitation); pre-terminus gap surfaced by DQ-02.
- `analytics-service/services/analytics_runner.py` — `flow_coverage_incomplete` added to `DataQualityFlags` + the 74-03 guard-lift loop + the `complete_with_warnings` predicate; `run_csv_strategy_analytics` reads the pre-stamp, preserves it, and promotes status.
- `analytics-service/tests/test_job_worker.py` — flow harness + 8 tests (same-day-close valuation, stablecoin-only no-price-source, per-venue own-transfer exclusion binance/bybit, OKX structural keep, retention-gap segmentation, transient-error retryable, open-position reconcile).
- `analytics-service/tests/test_analytics_runner.py` — 3 tests (run_csv promote on pre-stamp, SC-4 stays complete, run_strategy_analytics guard-lift of flow_coverage_incomplete).

## Decisions Made
- **Retention-bounded flow lookback** (see frontmatter) — efficient + lets the terminus segment the gap gracefully.
- **Realized basis, no uPnL wedge** — Phase 77 owns it; the residual is self-consistent so open positions reconcile.
- **Pre-stamp + CSV-run merge** as the coverage-flag channel across the broker→CSV boundary (documented deviation below).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Status lift wired through the ACTUAL broker→CSV factsheet path**
- **Found during:** Task 2 (status lift)
- **Issue:** The plan's status-lift line-refs (analytics_runner ~:1704/~:1775) point at `run_strategy_analytics`, which reads `returns_meta` from `trades_to_daily_returns_with_status` (the exchange-RECONSTRUCT path). But the ccxt broker factsheet is compiled by `run_csv_strategy_analytics` reading `csv_daily_returns` (derive_broker_dailies → CSV route). Extending only `run_strategy_analytics` would make the lift a no-op for real ccxt broker accounts — `flow_coverage_incomplete` would never surface, silently defeating DQ-02's entire purpose (a coverage gap must fail loud).
- **Fix:** In addition to extending the `run_strategy_analytics` guard-lift loop + predicate exactly as the plan asked (mirrors the NAV guard keys; consistent, low-risk), `derive_broker_dailies` PRE-STAMPS `flow_coverage_incomplete` onto `strategy_analytics.data_quality_flags` before enqueuing the CSV run, and `run_csv_strategy_analytics` READS + PRESERVES that flag (a full `_mark_complete` upsert would otherwise wipe it) and promotes `computation_status` to `complete_with_warnings`.
- **Files modified:** services/job_worker.py, services/analytics_runner.py
- **Verification:** `test_csv_run_promotes_to_warnings_when_flow_coverage_prestamped` (promote), `test_csv_run_stays_complete_without_flow_coverage_flag` (SC-4), `test_retention_gap_segments_and_flags_complete_with_warnings` (end-to-end pre-stamp) — all green; run_csv change caused zero regressions in the 130-test analytics_runner suite.
- **Committed in:** `de3f0af4` (Task 2 commit)

**2. [Rule 1 - Bug] tz-aware/tz-naive comparison in the terminus derivation**
- **Found during:** Task 2 (end-to-end retention-gap test)
- **Issue:** `flow_coverage_terminus_day(now_utc=datetime.now(timezone.utc))` compared a tz-AWARE `now` against the tz-NAIVE combined returns index (gap_fill_daily_returns → pd.date_range) → `TypeError: Cannot compare tz-naive and tz-aware timestamps`.
- **Fix:** Supply a tz-naive UTC `now` (`.replace(tzinfo=None)`) to match the naive returns index (76-03's pure helper is not modified — the caller owns tz coherence).
- **Files modified:** services/job_worker.py
- **Verification:** `test_retention_gap_segments_and_flags_complete_with_warnings` green.
- **Committed in:** `de3f0af4` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 missing-critical, 1 bug). **Impact:** both essential — the status-lift wiring is what makes DQ-02 genuinely surface on the real ccxt broker factsheet; the tz fix unblocks the segmentation path. No scope creep (both inside the declared job_worker.py + analytics_runner.py file set).

## Issues Encountered
- Existing `derive_broker_dailies` tests initially passed unchanged because an AsyncMock exchange yields empty transfers through the real `fetch_ccxt_transfers` windowing (MagicMock `__iter__` → `iter([])`), so no test-double breakage — the new I/O only needed explicit mocking in the NEW flow tests.

## Mutation-Honesty Verification (proven RED under mutation, restored GREEN)
- Neuter `apply_flow_coverage_terminus` → identity: `test_retention_gap_...` REDs (`pre-terminus days leaked into csv_daily_returns: ['2026-03-08', ...]`).
- Neuter `ccxt_flows._is_external` → keep-all: `test_ccxt_branch_excludes_own_transfer_end_to_end[binance]` + `[bybit]` RED (own-transfer leaks, 10000 → 7000).

## User Setup Required
None - no external service configuration required. (The `BROKER_DAILIES_VIA_FUNDING` kill-switch already gates the whole path; flows inherit it.)

## Next Phase Readiness
- **Phase 77 (uPnL wedge):** the realized basis is wired with `open_unrealized_usd` defaulted 0.0 at this seam — Phase 77 fills the realized/MTM split and threads the wedge so the residual tightens on open positions.
- **T-76-04-SCOPE (wallet-scope confirmation):** Binance SPOT-vs-USDⓈ-M / Bybit FUND-UNIFIED anchor-vs-flow-pool confirmation remains deferred to 76-05 / Phase 78 (the DQ-02 residual is the interim fail-loud net).

## Verification
- Full analytics suite (CI-3.12 venv312): **3083 passed / 92 skipped** (3072 baseline + 11 new; every Phase 73/74/75 byte-identity + acceptance pin stays GREEN).
- `test_job_worker.py`, `test_broker_dailies.py`, `test_analytics_runner.py`, `test_nav_twr.py` — all GREEN.
- `mypy --strict` clean on job_worker.py, broker_dailies.py, analytics_runner.py.

## Threat Flags
None new. T-76-04-GAP mitigated (retention terminus + mutation-proof segment); T-76-04-TRANS mitigated (transient fetch error stays retryable, structural NavReconstructionError stays permanent); T-76-04-SCOPE remains `transfer` (residual fail-loud net; wallet-scope confirmation deferred). No package installs (T-76-04-SC).

## Known Stubs
None.

## Self-Check: PASSED
- FOUND: analytics-service/services/job_worker.py (`_resolve_ccxt_flow_price_index`, `ccxt_rows_to_dated_flows`, `apply_flow_coverage_terminus`, pre-stamp)
- FOUND: analytics-service/services/analytics_runner.py (`flow_coverage_incomplete` in DataQualityFlags + lift + predicate + run_csv)
- FOUND: commit `ddcbd0de` (Task 1), `de3f0af4` (Task 2)

---
*Phase: 76-binance-bybit-okx-flow-adapters-reconciliation-gate*
*Completed: 2026-07-06*
