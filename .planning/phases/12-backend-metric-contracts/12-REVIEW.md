---
phase: 12
status: issues_found
files_reviewed: 24
findings:
  critical: 0
  warning: 4
  info: 6
total: 10
reviewed: 2026-04-28
depth: standard
---

# Phase 12 — Code Review Report

**Reviewed:** 2026-04-28
**Depth:** standard
**Files Reviewed:** 24
**Status:** issues_found

## Summary

Phase 12 implementation is structurally sound and the previously-identified BLOCKERs (B-01, B-02), HIGHs (H-A1, H-B, H-C, H-D, H-E, H-F), and MEDIUMs (M-01..M-04, M-Grok-1, M-Grok-2) from `12-REVIEWS.md` are all faithfully implemented. The migrations 086/087 lock down `SECURITY DEFINER` + `SET search_path = public, pg_temp` (H-B), the sibling-table union has exactly 12 kinds (H-D), `weighted_risk_reward_ratio` ships as the 7th derived metric (H-F), `claim_compute_jobs_with_priority` lives in the claim path (METRICS-14), and `upsert_strategy_analytics_series_batch` (M-Grok-1) is wired into `analytics_runner.run_strategy_analytics`. Math correctness, type contracts, and parity gates check out.

Findings flagged below are (a) two pre-existing TS test fixture drifts that the orchestrator explicitly asked be flagged, (b) a `pyarrow`/runtime-dep gap that may break CI for the new fixture path, (c) a graceful-degradation gap in `analytics_runner` that still trips through to a hard 5xx on the success-path NAV upsert, plus six smaller info-level smells.

## Warnings

### WR-01: Pre-existing TS fixture drift in `MetricPanel.test.tsx` and `PositionsTab.test.tsx` — `TradeMetrics` shape mismatch

**Files:**
- `src/components/strategy/MetricPanel.test.tsx:118`
- `src/components/strategy/PositionsTab.test.tsx:31-42, 106-117`

**Issue:**
After Phase 12 / Plan 12-02 expanded `TradeMetrics` (`src/lib/types.ts:137-157`) to add the 7 derived keys (`expectancy`, `risk_reward_ratio`, `weighted_risk_reward_ratio`, `sqn`, `profit_factor_long`, `profit_factor_short`, `trade_mix`) and to require the position-level keys (`total_positions`, `open_positions`, `closed_positions`, `win_rate`, `avg_roi`, `avg_duration_days`, `long_count`, `short_count`, `best_trade_roi`, `worst_trade_roi`), the existing test fixtures were not updated:

- `MetricPanel.test.tsx:118` constructs `trade_metrics: { total_trades: 150, win_rate: 0.55 }` — `total_trades` is **not a key** on `TradeMetrics` (the contract uses `total_positions`); the rest of the required fields are absent. This compiles only because `makeAnalytics` casts via spread/override.
- `PositionsTab.test.tsx:31-42` builds a `trade_metrics` object missing every Phase 12 derived key (`expectancy`, `risk_reward_ratio`, `weighted_risk_reward_ratio`, `sqn`, `profit_factor_long`, `profit_factor_short`).

The `TradeMetrics` interface declares the derived keys as `number | null` (not optional), so strict TS should fail. These tests will silently break the moment `tsc --noEmit` is added to CI or a strict flag is enabled — and right now they encode an incorrect contract.

**Fix:**
Update both fixtures to match `TradeMetrics`: rename `total_trades` → `total_positions`, add the missing position-level keys, and explicitly set the 6 derived keys + optional `trade_mix` to `null`.

---

### WR-02: `pyarrow` is not pinned in `analytics-service/requirements.txt` — fixture loading will fail in clean CI

**File:** `analytics-service/requirements.txt`

**Issue:**
`tests/conftest.py:122` calls `pd.read_parquet(FIXTURES_DIR / "golden_252d_input.parquet")` for the new `golden_252d_input` fixture. `pandas.read_parquet` requires either `pyarrow` or `fastparquet`, and neither is declared in `requirements.txt` (the file pins only fastapi/uvicorn/quantstats/ccxt/pandas/numpy/pydantic/python-dotenv/httpx/slowapi/supabase/cryptography). The 12-09 wave note explicitly logged that the fixture regen used a user-site PEP-668 override — that's CI-fragile.

In a clean Railway/CI environment without `pyarrow` pre-installed, `test_metrics_parity_full` will fail at fixture load with `ImportError: Missing optional dependency 'pyarrow'`, which masks the actual parity gate.

**Fix:**
Pin pyarrow in `analytics-service/requirements.txt` (e.g. `pyarrow==18.1.0` — pick a version compatible with `pandas==2.2.3` / `numpy==2.2.4`).

---

### WR-03: `_load_position_time_series` failure misclassified under `position_metrics_failed` flag

**File:** `analytics-service/services/analytics_runner.py:539-561, 614-616`

**Issue:**
When `_load_position_time_series`'s `_fetch_snapshots` call raises (e.g., RLS regression on `position_snapshots`), the except handler at line 557 swallows the exception **but the failure is misclassified**. `data_quality_flags["position_metrics_failed"]` is set, but `position_snapshots` is a **different** failure surface than `reconstruct_positions` — both write the same flag. An operator reading the flag cannot distinguish "FIFO matching from raw fills failed" (positions table writes blocked) from "snapshot read for turnover/exposure_series failed" (raw_fills FIFO is fine, but exposure/turnover series can't be derived). That makes incident triage harder.

**Fix:**
Either split the position-side block into two separate try/excepts so the data_quality_flags can carry distinct keys (`position_reconstruction_failed`, `position_snapshots_unavailable`), OR concatenate distinct error messages onto the existing flag so the failure source is unambiguous.

---

### WR-04: `phase12_kill_switch.cutover_strategy` writes `metrics_json` non-atomically with the sibling-table upsert

**File:** `analytics-service/scripts/phase12_kill_switch.py:117-174`

**Issue:**
`cutover_strategy` issues two separate round-trips to Supabase:

1. `supabase.rpc("upsert_strategy_analytics_series_batch", …)` — atomic via the M-Grok-1 RPC (good).
2. `supabase.table("strategy_analytics").update({"metrics_json": m}).eq("strategy_id", …)` — separate round-trip, no transaction with step 1.

If step 1 succeeds and step 2 fails (network blip, Postgres restart, deploy-job killed mid-script), the strategy lands in a state where:
- The sibling table has the heavy keys.
- `metrics_json` STILL has the heavy keys.

Subsequent reads will double-count. The kill-switch contract says it's a one-way move — partial cutover violates that. The function docstring at line 117 even claims "Per-strategy atomic in two phases" but two separate round-trips are not atomic.

**Fix:**
Make the cutover atomic at the DB level by extending the `upsert_strategy_analytics_series_batch` RPC (or adding a sibling RPC `cutover_strategy_metrics_keys(strategy_id, kinds JSONB)`) to do BOTH the sibling-row inserts AND the `metrics_json` key-stripping inside one Postgres function body. As a smaller alternative: wrap the two calls in a "rollback-on-failure" guard.

---

## Info

### IN-01: `_safe_float` accepts `bool` and silently coerces to `0.0`/`1.0`

**File:** `analytics-service/services/metrics.py:69-77`

`_safe_float(True)` returns `1.0` because `bool` is a subclass of `int` in Python. `sanitize_metrics` excludes `bool` in the list-comprehension branch but the dict-recursion branch and the top-level scalar branch do not.

**Fix:** Add a `bool` early-return (return None or raise TypeError; never silently coerce).

---

### IN-02: `_log_returns_series` rounds at 4 decimals — same precision floor as `_finalize_rolling`

**File:** `analytics-service/services/metrics.py:569-576, 656-666`

D-11 specifies scalar parity at 12 sig digits, series parity at 1e-9. `_log_returns_series` routes through `_finalize_rolling`, which `round(float(v), 4)`. For very small returns this collapses information. Internally consistent (regen + parity test both round identically), so parity passes — but downstream Phase 14b consumers reading 4-decimal values for sub-bps moves lose precision unrecoverably. This was acknowledged as L-02 in `12-REVIEWS.md`.

**Fix:** Bump rounding to 6+ decimals (matches monthly/daily grids), OR document the precision floor in the docstring.

---

### IN-03: `metrics.py` `loss_streaks` includes flat days as losses

**File:** `analytics-service/services/metrics.py:264-271`

The `loss_streaks` calculation uses `~is_positive`, which buckets flat days (`return == 0`) as "losses". Pre-existing legacy code, not changed by Phase 12, but Phase 12 callers consume `consecutive_losses` directly.

**Fix (deferred):** Track only days where `returns < 0` for loss-streak counting. Out of Phase 12 scope.

---

### IN-04: `analytics_runner._load_position_time_series` silent fallback to gross-exposure NAV proxy is non-monotonic

**File:** `analytics-service/services/analytics_runner.py:130-143`

When `account_balance` is missing/zero, the function falls back to NAV = `sum(abs(positions))` per date. The docstring claims "self-consistent for any non-zero monotonic NAV proxy" but `sum(abs(positions))` is **not monotonic** when the strategy reduces exposure. If Phase 14b renders a `turnover_series` chart, days where the strategy de-grosses will show artificial spikes.

**Fix:** Update the docstring to drop the word "monotonic" and document the cross-day comparability caveat.

---

### IN-05: `phase12_kill_switch.HEAVY_KINDS` duplicates the canonical list from `metrics-parity-helper.ts EXPECTED_SIBLING_KINDS`

**Files:**
- `analytics-service/scripts/phase12_kill_switch.py:43-49`
- `src/lib/metrics-parity-helper.ts:23-36`

Three sources-of-truth exist now: this Python list, the TS Set, and the runtime `MetricsResult.sibling_kinds` keys. If a future kind is added (or removed), all three must be updated in lockstep.

**Fix:** Single source-of-truth pattern. Add a Python module `analytics-service/services/sibling_kinds.py` exporting `HEAVY_KINDS: tuple[str, ...]`. Optional — current state passes parity tests because all three are 1:1.

---

### IN-06: `daily_returns_grid` rounds to 6 decimals while `_finalize_rolling` rounds to 4 — divergent precision floors within the same sibling-kind family

**File:** `analytics-service/services/metrics.py:473-490, 569-576`

Both are sibling-table kinds carrying per-date `value` fields; the precision split makes byte-stable parity work only because Python and TS read from the SAME committed `golden_252d_expected.json`. Real-world Phase 14b consumers reading both kinds will see inconsistent precision in their UI.

**Fix:** Pick one floor (6 decimals matches monthly/daily grids; the 4-decimal rolling helpers should bump to match) and apply uniformly. Internal change; expected JSON regen needed.

---

## Verification of REVIEWS-mandated fixes (all confirmed present)

| Item | Status | Evidence |
|---|---|---|
| **B-01** (path b refactor) | confirmed | `analytics_runner.py:177-293` `_compute_derived_trade_metrics` exists; takes both volume + position dicts. |
| **H-A1** (regen positions/prices/NAV; `position_snapshots.mark_price` canonical) | confirmed | `analytics_runner.py:52-143` `_load_position_time_series` reads `position_snapshots.mark_price`. No `historical_prices` table reference anywhere. |
| **H-B** (`SET search_path = public, pg_temp`) | confirmed | Migration 086 line 103 + line 208 self-verify; Migration 087 lines 139, 215, 273+296 self-verify. |
| **H-C** (signed-zero / NaN parity) | confirmed | `test_metrics_parity.py:78-100` `_series_close` with `+0/-0` and `NaN==NaN` short-circuits. |
| **H-D** (no `equity_series_1y` in sibling) | confirmed | `types.ts:193-198` 12-element union; `metrics-parity-helper.ts:23-36` 12-element Set; migration 087 line 165 `'equity'` panel maps to `ARRAY['log_returns_series']` only. |
| **H-F** (`weighted_risk_reward_ratio`) | confirmed | `analytics_runner.py:226, 242-248`; `types.ts:151`; tests at `test_analytics_runner.py:422-437`. |
| **M-Grok-1** (atomic batch RPC) | confirmed | Migration 087 lines 208-231; `analytics_runner.py:668-682`; `phase12_kill_switch.py:154-162`. |
| **M-Grok-2** (scalar 1e-12 epsilon fallback) | confirmed | `test_metrics_parity.py:46-75` two-tier; unit test at line 215. |
| **M-01** (`TRADE_MIX_HAS_MAKER_TAKER` regex) | confirmed | `phase12_deploy.py:68` regex `TRADE_MIX_HAS_MAKER_TAKER\s*=\s*(true|false)`. |
| **M-02** (duplicate-job guard) | confirmed | `phase12_backfill_enqueue.py:35-48` pre-check + skip + literal phrase "existing pending compute_analytics jobs found". |
| **M-03** (SQL p999, no Python json approx) | confirmed | `phase12_kill_switch.py:65-96` `measure_p999_via_sql`; zero `len(json.dumps` references. |
| **METRICS-14 throttle** (in claim PATH not dispatch) | confirmed | `main_worker.py:112-116`; throttle in migration 086 RPC body lines 127-153. |
| **D-16 frozen contract** | confirmed | `metrics-parity-helper.ts:53-92` `FROZEN_TRADE_METRICS_KEYS`. |
