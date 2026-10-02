# 131 PATTERNS — current-code map for the smoothed_mtm third basis (2026-07-22)

All paths under `analytics-service/`. **No `smoothed`/`option_mtm`/`replay_option` scaffolding exists — all greenfield.** Two basis enums MUST stay in sync.

## Two basis enums (add `smoothed_mtm` to BOTH)
- `services/allocated_capital.py:56` — `_VALID_PNL_BASES = frozenset({"cash_settlement","mark_to_market"})` (config layer; validated at :158 and :230). Functions THREAD the string, don't switch on value → adding the member unblocks config only.
- `services/deribit_txn.py:848-853` — `PNL_BASIS_CASH_SETTLEMENT`(848)/`PNL_BASIS_MARK_TO_MARKET`(849)/`_PNL_BASES`(850-852)/`DEFAULT_PNL_BASIS`(853). Add `PNL_BASIS_SMOOTHED_MTM` + membership.

## deribit_txn.py (PURE — pandas/async-free; AST guard test_deribit_txn.py:980)
- `classify_instrument` :144 (option arm). `_NATIVE_OPTIONS_SUMMARY_TYPES` :816.
- `txn_rows_to_native_daily` :1728 — `use_mtm = pnl_basis==PNL_BASIS_MARK_TO_MARKET` :1798; summary handling :1847-1870; option trade/delivery :1926-1932 (coverage-gated `-commission`). Add `use_smoothed` branch: option rows FULL `change`, summary inert, merge ΔMTM (marks passed in by adapter).
- `assert_balance_identity` :1506 (branch at :1652). Smoothed adds cash-channel strict identity (all ccys) + book-channel anchor cross-check.
- **Greenfield pure fns to add here**: `replay_option_positions(rows)` (per-day signed positions from `position` field) + `option_mtm_daily(positions, marks)` (per-(day,ccy) ΔMTM + terminal_book, fail-loud on holes). Helpers that exist: `_summary_contribution`:1691, `_option_commission`:1709, `_summary_coverage_windows`:1384.

## deribit_ingest.py (async, pandas-ful)
- `build_deribit_native_ledger` :1759 — threads `pnl_basis` into `txn_rows_to_native_daily` :1808. Returns `(NativeLedger, CompletenessReport)`.
- `fetch_deribit_perp_daily_index` :597-691 — CLONE target for greenfield `fetch_deribit_option_daily_marks(exchange, instrument, *, oldest_day, newest_day, sleep, max_retries)`. Same public endpoint, same transient-retry→`DeribitTransientReadError`, same `{}`-on-structural-nodata, same tick→UTC-day dedupe. Take instrument verbatim + expiry-capped `newest_day`.
- `NativeLedger` (native_nav.py:207-242): `native_pnl: Mapping[str,pd.Series]`, `marks`, `native_flows`, `terminal_native_equity`, `terminal_upnl_native`, `full_history`. `CompletenessReport` (deribit_ingest.py:723): `has_option_activity`(:1820 via `deribit_raw_rows_have_option_activity`:787), `pre_coverage_option_days`, etc. Add `pre_mark_retention_option_days` warning bucket.
- `_build_dense_native_marks` :1611.

## basis_series.py (add a KIND — NO DDL, kind is unconstrained TEXT)
- `KIND_MTM_DAILY_RETURNS`:103, `KIND_CASH_SETTLEMENT`:110, `_KIND_BY_BASIS`:113-116. Add `KIND_SMOOTHED_MTM = "smoothed_mtm_daily_returns"` + map entry. `derive_basis_series`:181 / `persist_basis_series`:294 are basis-agnostic (no signature change).

## job_worker.py (add a THIRD pass in BOTH routes — after pure core proven)
- Single-key: pnl_basis at :2356-2357; MTM 2nd pass build :2543-2546; MTM `derive_basis_series`:3686; persist :3800-3801; by-basis `{"mark_to_market":...}`:3921.
- Composite (`run_stitch_composite_job`): gate `mark_to_market_available`:5123 (stitch_composite.py:312 → `unsmoothed_options_book` MTM_REASON_OPTIONS stitch_composite.py:101 — the gate smoothed_mtm OPENS); MTM reconstruct :5127; derive :5206-5216; by-basis :5311-5313; persist :5496-5500; final write `_write_headline_and_by_basis`:5435/5505.
- Frontend reads `strategy_analytics.metrics_json_by_basis.<basis>` → add `smoothed_mtm` key + the SegmentedControl third option (frontend, separate).

## Existing tests to extend (TDD)
`test_deribit_txn.py` (purity + native-daily + new replay/ΔMTM), `test_deribit_ingest.py` (option-marks fetch + missing_daily_marks), `test_mtm_single_key.py`, `test_stitch_composite_job.py`/`test_stitch_composite.py` (the `unsmoothed_options_book` gate), `test_basis_series.py`, `test_cash_basis_series_sc4.py` (SC-4 byte-identity), `test_native_nav_sc4_identity.py`, `test_zavara_acceptance.py`. NONE named test_smoothed*/test_option_mtm* exist yet.

## SC-4 (byte-identity) mechanism
Every new arm is CLASSIFICATION-gated (keys on option rows). Perp-only/USD-native ⇒ empty replay ⇒ NO marks fetched (assert on stub) ⇒ empty ΔMTM merge (no-op) ⇒ identical float ops ⇒ bit-identical. `native_options_session_upl` absent→0.0.
