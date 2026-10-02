---
phase: 12-backend-metric-contracts
verified: 2026-04-28T00:00:00Z
status: human_needed
score: 16/17 must-haves verified
overrides_applied: 0
must_haves_verified: 16
must_haves_total: 17
requirement_ids_verified:
  - METRICS-01
  - METRICS-02
  - METRICS-03
  - METRICS-04
  - METRICS-05
  - METRICS-06
  - METRICS-07
  - METRICS-08
  - METRICS-09
  - METRICS-10
  - METRICS-11
  - METRICS-12
  - METRICS-13
  - METRICS-14
  - METRICS-16
  - METRICS-17
requirement_ids_deferred:
  - METRICS-15
deferred:
  - truth: "getStrategyDetail() uses path-extraction (metrics_json -> 'key') for above-the-fold scalars p95 < 50ms, and lazy-fetch RPC p95 < 200ms"
    addressed_in: "Phase 14a + Phase 14b"
    evidence: >
      ROADMAP.md SC#3b and SC#3c explicitly annotated: '3b … this is Phase 14a's job to assert;
      Phase 12 only ships the type contracts and storage layout' and '3c … also Phase 14b's job;
      Phase 12 ships the RPC + consumer'. REQUIREMENTS.md METRICS-15 checkbox stays unchecked:
      'Path-extraction half (replacing select *, strategy_analytics(*) in getStrategyDetail)
      remains Phase 14a's job — checkbox stays unchecked until both halves ship.'
  - truth: "Live deploy of phase12_deploy.py against production DB + 12-min queue-depth recording for SC#4"
    addressed_in: "Operator action (post-Phase-12 deploy gate)"
    evidence: >
      Plan 12-10 frontmatter: autonomous=false. STATE.md: 'Production-run portion deferred to
      operator/checkpoint:human-verify per autonomous=false plan frontmatter.' TODOS.md SC#4
      section present with probe template; results column shows 'pending — record after the
      12-min window closes.'
human_verification:
  - test: "Run Python parity test against golden fixture"
    expected: "pytest analytics-service/tests/test_metrics_parity.py → 5/5 pass; no scalar drift"
    why_human: "Requires Python venv with quantstats==0.0.81 + pyarrow==18.1.0 installed. Local py3.14 lacks compatible pyarrow wheel (WR-02 context). CI environment passes per STATE.md claim of 592/595 pass; verifier cannot run tests without compatible env."
  - test: "Run TS parity test against golden fixture"
    expected: "npx vitest run src/__tests__/metrics-parity.test.ts → 5/5 pass"
    why_human: "Requires Vitest + supabase env variables. STATE.md claims 2285/2285 TS tests pass but verifier cannot run tests standalone."
  - test: "Production deploy + queue-depth observation (SC#4)"
    expected: "compute_analytics queue depth never exceeds 50 for >10 min after phase12_deploy.py runs"
    why_human: "autonomous=false gate per Plan 12-10. Scripts exist and are well-formed; actual deploy against live Supabase + 12-min observation window is an operator action. TODOS.md SC#4 section has the recording template; results are unfilled."
---

# Phase 12: Backend Metric Contracts — Verification Report

**Phase Goal:** `metrics.py` produces every scalar and series the v0.17 7-panel UI needs — rolling Sortino/Vol/Greeks series, daily-returns grid, exposure & turnover series, full trade-table aggregations, 10 missing qstats scalars, log-returns series — written into already-declared JSONB columns + new `strategy_analytics_series` sibling table for heavy series, with parity-tested cross-runtime correctness, throttled backfill via priority enum, and JSONB row-size discipline.

**Verified:** 2026-04-28
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | compute_all_metrics() against the golden 252-day fixture produces every new series (rolling_sortino_3m/6m/12m, rolling_volatility_3m/6m/12m, rolling_alpha, rolling_beta, daily_returns_grid, exposure_series, turnover_series, log_returns_series) — no NULLs | ✓ VERIFIED | `golden_252d_expected.json` sibling section has all 12 kinds, all non-empty (min len=1, max len=252). Confirmed via direct JSON inspection. |
| 2 | compute_all_metrics() produces all 10 new qstats scalars — no NULLs | ✓ VERIFIED | `golden_252d_expected.json` inner `metrics_json.metrics_json` has all 10 keys (recovery_factor through time_in_market) with non-null float values. |
| 3 | Cross-runtime parity test asserts byte-identical JSON between Python and TS reader on the 252-day fixture; CI fails on any drift | ✓ VERIFIED (human confirm needed) | `test_metrics_parity.py` + `metrics-parity.test.ts` both exist. Python test implements D-11 hybrid tolerance (12-sig-digit + 1e-12 fallback per M-Grok-2; series 1e-9 + H-C signed-zero/NaN). TS test asserts EXPECTED_SIBLING_KINDS.size == 12 and equity_series_1y absent. STATE.md claims both pass. Human must confirm live test run. |
| 4 | pg_column_size(metrics_json) p99.9 < 800kB post-backfill; kill-switch automated via deploy script | ✓ VERIFIED (scripts) | `analyze_metrics_size.sql` uses `percentile_cont(0.999)` on `pg_column_size(metrics_json)`. `phase12_kill_switch.py` honors SKIP_KILL_SWITCH=1, reads p99.9 as CLI arg from deploy orchestrator (M-03 SQL-side measurement). WR-04 atomic dual-write via migration 088 `cutover_strategy_metrics_keys` RPC. Actual post-backfill measurement deferred to production deploy. |
| 5 | getStrategyDetail() path-extraction p95 < 50ms for above-the-fold scalars | DEFERRED → Phase 14a | ROADMAP SC#3b explicitly: 'this is Phase 14a's job to assert; Phase 12 only ships the type contracts and storage layout'. `getStrategyDetail` still uses `select *, strategy_analytics(*)` — this is intentional per plan. |
| 6 | Lazy-fetch RPC p95 < 200ms | DEFERRED → Phase 14b | ROADMAP SC#3c explicitly: 'also Phase 14b's job; Phase 12 ships the RPC + consumer'. |
| 7 | Live sync_trades does not queue behind backfill: migration 086 ships priority enum + claim RPC; queue depth probe documented | ✓ VERIFIED (scripts; deploy deferred) | Migration 086 has `priority TEXT CHECK(IN('low','normal','high')) DEFAULT 'normal'`, partial index `idx_compute_jobs_priority_pending`, and `claim_compute_jobs_with_priority` SECURITY DEFINER RPC with H-B `SET search_path = public, pg_temp`. `main_worker.dispatch_tick` (line 114) calls `claim_compute_jobs_with_priority`. TODOS.md SC#4 section with 12-min probe template exists. Actual deploy observation is operator-deferred per autonomous=false. |
| 8 | is_maker audit returns documented boolean per exchange; descope path documented | ✓ VERIFIED | TODOS.md has complete audit table: binance/okx/bybit all show 0 total fills (no production data yet) → TRADE_MIX_HAS_MAKER_TAKER = false. Deribit documented as N/A by design. 2-bucket long/short fallback ships. v0.17.1 follow-up documented. |

**Score:** 6/8 truths verified outright; 2 deferred to later phases (per explicit roadmap annotation); 2 human-needed for live test confirmation.

---

### Deferred Items

Items not yet met but explicitly addressed in later milestone phases.

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | getStrategyDetail() path-extraction p95 < 50ms for above-the-fold scalars (SC#3b) | Phase 14a | ROADMAP.md SC#3b annotation: 'this is Phase 14a's job to assert; Phase 12 only ships the type contracts and storage layout.' `getStrategyDetail` intentionally still uses `select *, strategy_analytics(*)`. REQUIREMENTS.md METRICS-15 checkbox unchecked with note: 'Path-extraction half remains Phase 14a's job.' |
| 2 | Lazy-fetch RPC p95 < 200ms (SC#3c) | Phase 14b | ROADMAP.md SC#3c annotation: 'also Phase 14b's job; Phase 12 ships the RPC + consumer'. Phase 14b success criteria includes lazy panel performance assertions. |
| 3 | Production deploy run + queue-depth 12-min recording (SC#4 proof) | Operator gate | Plan 12-10 `autonomous: false`, deploy scripts exist and are well-formed. SC#4 section in TODOS.md has recording template. Actual execution deferred to operator. |

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `analytics-service/services/metrics.py` | MAR constant + 5 rolling helpers + MetricsResult dataclass + compute_all_metrics + _daily_returns_grid_from_series + compute_qstats_scalars + _log_returns_series | ✓ VERIFIED | All functions confirmed at lines 16, 20, 100, 473, 493, 588, 620, 631, 646, 656 |
| `analytics-service/services/analytics_runner.py` | _compute_derived_trade_metrics + _compute_volume_aggregator + _compute_trade_mix + _load_position_time_series + upsert_strategy_analytics_series_batch call | ✓ VERIFIED | Functions at lines 177, 296, 344; batch upsert at line 724; H-A1 positions_by_date logic at lines 57–143 |
| `analytics-service/services/position_reconstruction.py` | compute_exposure_metrics (with exposure_series) + compute_turnover_series | ✓ VERIFIED | exposure_series_records at line 506, compute_turnover_series at line 549, Pitfall #19 docstring at line 556, abs(delta * price) at line 591 |
| `analytics-service/main_worker.py` | dispatch_tick calls claim_compute_jobs_with_priority | ✓ VERIFIED | Line 114: `supabase.rpc("claim_compute_jobs_with_priority", ...)` |
| `supabase/migrations/086_compute_jobs_priority.sql` | priority enum + partial index + claim RPC + H-B search_path + self-verify DO block | ✓ VERIFIED | All grep checks pass: priority column, idx_compute_jobs_priority_pending, SECURITY DEFINER, SET search_path = public, pg_temp, REVOKE ALL FROM PUBLIC/anon/authenticated, RAISE EXCEPTION DO block |
| `supabase/migrations/087_strategy_analytics_series.sql` | sibling table + RLS deny-all + fetch_strategy_lazy_metrics + upsert_strategy_analytics_series_batch + H-B + H-D | ✓ VERIFIED | strategy_analytics_series table with ON DELETE CASCADE, strategy_analytics_series_deny_all policy, fetch_strategy_lazy_metrics with auth.uid() visibility check, equity panel = ARRAY['log_returns_series'] only (H-D), upsert_strategy_analytics_series_batch with GRANT TO service_role (M-Grok-1), SET search_path = public, pg_temp on both RPCs |
| `supabase/migrations/088_cutover_strategy_metrics_keys.sql` | atomic dual-write RPC for kill-switch (WR-04 long-term fix) | ✓ VERIFIED | cutover_strategy_metrics_keys SECURITY DEFINER RPC inserts into sibling table AND strips from metrics_json in one transaction, GRANT TO service_role, H-B hardening |
| `src/lib/types.ts` | TradeMetrics + TradeMixBuckets + StrategyAnalyticsSeriesKind + StrategyAnalyticsSeriesRow + LazyMetricsPayload frozen contracts | ✓ VERIFIED | expectancy, risk_reward_ratio, weighted_risk_reward_ratio (H-F), sqn, profit_factor_long, profit_factor_short at lines 149–155; TradeMixBucket/TradeMixBuckets at 163/176; StrategyAnalyticsSeriesKind at 193 (12 kinds, no equity_series_1y per H-D); StrategyAnalyticsSeriesRow at 200; LazyMetricsPayload at 212 |
| `src/lib/queries.ts` | fetchStrategyLazyMetrics(strategyId, panelId) + LazyMetricsPanelId type | ✓ VERIFIED | fetchStrategyLazyMetrics at line 348 calls supabase.rpc("fetch_strategy_lazy_metrics"); LazyMetricsPanelId type at line 318 |
| `analytics-service/tests/fixtures/regen_golden.py` | deterministic fixture regenerator (seed=42, 252 days) | ✓ VERIFIED | np.random.seed(42) at line 49; SEED=42 constant; 252-day profile |
| `analytics-service/tests/fixtures/golden_252d_input.parquet` | parquet input fixture | ✓ VERIFIED | File exists |
| `analytics-service/tests/fixtures/golden_252d_input.json` | JSON companion with fills/positions/prices/NAV | ✓ VERIFIED | File exists; parity test reads fills, trade_metrics_from_positions, positions_by_date, prices_by_date, nav_by_date from it |
| `analytics-service/tests/fixtures/golden_252d_expected.json` | expected output fixture (all 12 sibling kinds + 10 qstats scalars) | ✓ VERIFIED | Sibling section has all 12 kinds (len 1–252); inner metrics_json has all 10 qstats scalars; trade_mix is 2-bucket {long, short} per TRADE_MIX_HAS_MAKER_TAKER=false; weighted_risk_reward_ratio present (H-F) |
| `analytics-service/tests/test_metrics_parity.py` | Python math gate (D-11 hybrid tolerance + H-C + M-Grok-2) | ✓ VERIFIED | assertMetricParity at line 167; 12-sig-digit + 1e-12 fallback; series 1e-9 + signed-zero/NaN; 5 test functions |
| `src/__tests__/metrics-parity.test.ts` | TS schema gate (Reading A — EXPECTED_SIBLING_KINDS + H-D equity_series_1y absent) | ✓ VERIFIED | EXPECTED_SIBLING_KINDS = 12 kinds; assertMetricParity; equity_series_1y absent check; .toBe(EXPECTED_SIBLING_KINDS.size) assertion |
| `src/lib/metrics-parity-helper.ts` | Shared parity helper with EXPECTED_SIBLING_KINDS (12) + TRADE_MIX_HAS_MAKER_TAKER env read | ✓ VERIFIED | EXPECTED_SIBLING_KINDS has exactly 12 entries; H-D equity_series_1y excluded comment; TRADE_MIX_HAS_MAKER_TAKER env var at line 142 |
| `analytics-service/scripts/analyze_metrics_size.sql` | p99.9 probe using percentile_cont(0.999) on pg_column_size(metrics_json) | ✓ VERIFIED | percentile_cont(0.999) at line 21 as p999_bytes |
| `analytics-service/scripts/phase12_kill_switch.py` | SKIP_KILL_SWITCH=1 honored; reads p99.9 from CLI arg (M-03); uses atomic RPC (WR-04) | ✓ VERIFIED | SKIP_KILL_SWITCH check at line 181; p999 as CLI arg; cutover via cutover_strategy_metrics_keys RPC (WR-04) |
| `analytics-service/scripts/phase12_backfill_enqueue.py` | M-02 pre-check for pending compute_analytics before enqueueing; priority='low' | ✓ VERIFIED | M-02 pre-check at line 31–46; priority='low' at line 72 |
| `analytics-service/scripts/phase12_deploy.py` | M-01 TRADE_MIX_HAS_MAKER_TAKER propagation; M-03 SQL probe; M-02 backfill enqueue; queue-depth probe instructions | ✓ VERIFIED | M-01 regex at line 68; .env.test write at line 92; SQL probe at line 101; backfill enqueue at line 14; SC#4 queue monitoring at line 174 |
| `.planning/phases/12-backend-metric-contracts/TODOS.md` | is_maker audit table with real data; TRADE_MIX_HAS_MAKER_TAKER = false; Deribit N/A documented; SC#4 recording template | ✓ VERIFIED | Audit table has binance/okx/bybit with 0 fills (no production data); TRADE_MIX_HAS_MAKER_TAKER = false; Deribit N/A per exchange.py:325-334; SC#4 section at line 93 |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `compute_all_metrics()` | `strategy_analytics_series` sibling table | `MetricsResult.sibling_kinds` → `upsert_strategy_analytics_series_batch` RPC (M-Grok-1) | ✓ WIRED | analytics_runner.py line 720–727: `if metrics_result.sibling_kinds: supabase.rpc("upsert_strategy_analytics_series_batch", ...)` |
| `analytics_runner.run_strategy_analytics` | `_compute_derived_trade_metrics` | merge volume_metrics + trade_metrics_from_positions → trade_metrics JSONB (B-01) | ✓ WIRED | analytics_runner.py line 608: `derived = _compute_derived_trade_metrics(volume_metrics, trade_metrics_from_positions)` |
| `analytics_runner.run_strategy_analytics` | `compute_turnover_series` + `compute_exposure_metrics` | `positions_by_date` / `prices_by_date` / `nav_by_date` from `position_snapshots` + mark_price (H-A1) | ✓ WIRED | `_load_position_time_series` at analytics_runner.py line 57 queries position_snapshots using both size_usd and mark_price per migration 034 |
| `main_worker.dispatch_tick` | `claim_compute_jobs_with_priority` RPC (migration 086) | supabase.rpc call at line 114 | ✓ WIRED | `supabase.rpc("claim_compute_jobs_with_priority", {"p_batch_size": 5, "p_worker_id": worker_id})` |
| `src/lib/queries.ts:fetchStrategyLazyMetrics` | `fetch_strategy_lazy_metrics` RPC (migration 087) | supabase.rpc call | ✓ WIRED | Line 353: `supabase.rpc("fetch_strategy_lazy_metrics", {...})` |
| `phase12_kill_switch.cutover_strategy` | `cutover_strategy_metrics_keys` RPC (migration 088) | SECURITY DEFINER atomic dual-write (WR-04) | ✓ WIRED | kill_switch.py uses RPC for atomic sibling-table insert + metrics_json strip |
| `phase12_deploy.py` | TODOS.md TRADE_MIX_HAS_MAKER_TAKER | regex `TRADE_MIX_HAS_MAKER_TAKER\s*=\s*(true|false)` → .env.test (M-01) | ✓ WIRED | deploy.py line 68–92 reads TODOS.md, writes .env.test |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `golden_252d_expected.json` sibling section | all 12 series | `regen_golden.py` (np.random.seed(42)) | Deterministic synthetic data — correct for fixture | ✓ FLOWING |
| `analytics_runner.py` sibling_kinds | exposure_series, turnover_series | `_load_position_time_series` → `position_snapshots.mark_price` per migration 034 | Real DB query via `supabase.table("position_snapshots").select(...)` | ✓ FLOWING |
| `analytics_runner.py` trade_metrics | expectancy, risk_reward_ratio, weighted_risk_reward_ratio, sqn, profit_factor_long, profit_factor_short | `_compute_derived_trade_metrics(volume_metrics, trade_metrics_from_positions)` | Computed from `reconstruct_positions` (position-level data) + `_compute_volume_metrics` (fills data) | ✓ FLOWING |
| `analytics_runner.py` trade_mix | long/short buckets | `_compute_trade_mix(fills, has_maker_taker=False)` → TRADE_MIX_HAS_MAKER_TAKER env var | 2-bucket fallback per D-15 audit; real fills or empty list (graceful) | ✓ FLOWING |
| `src/lib/queries.ts:fetchStrategyLazyMetrics` | lazy series payload | `fetch_strategy_lazy_metrics` SQL RPC → `strategy_analytics_series` table | LATERAL join over sibling table; returns `jsonb_object_agg(kind, payload)` | ✓ FLOWING (schema confirmed; data presence requires deployed backfill) |

---

### Behavioral Spot-Checks

Step 7b: SKIPPED — analytics-service requires quantstats/pyarrow venv; no runnable entry point verifiable without environment setup. STATE.md documents 592/595 Python tests and 2285/2285 TS tests passing post-execution.

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Python test collection | `pytest --collect-only -q analytics-service/` | 595 collected | ✓ PASS |
| TypeScript type check | `npx tsc --noEmit` | 0 errors | ✓ PASS |
| Migration 086 key elements present | grep checks | claim_compute_jobs_with_priority + priority enum + H-B search_path | ✓ PASS |
| Migration 087 key elements present | grep checks | strategy_analytics_series + RLS deny-all + fetch/upsert RPCs + H-D equity panel | ✓ PASS |
| 12 sibling kinds in EXPECTED_SIBLING_KINDS | grep count | 12 | ✓ PASS |
| Golden fixture: all 12 sibling kinds non-empty | JSON inspection | All 12 present, len 1–252 | ✓ PASS |
| Golden fixture: 10 qstats scalars non-null | JSON inspection | All 10 present with float values | ✓ PASS |
| TRADE_MIX_HAS_MAKER_TAKER=false in TODOS.md | grep | Present | ✓ PASS |
| deploy.py TRADE_MIX regex matches TODOS.md | grep | Regex `TRADE_MIX_HAS_MAKER_TAKER\s*=\s*(true|false)` at line 68 | ✓ PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| METRICS-01 | 12-03 | `_rolling_sortino` + MAR=0.0 | ✓ SATISFIED | `metrics.py` line 16 (MAR), line 588 (_rolling_sortino). REQUIREMENTS.md [x]. |
| METRICS-02 | 12-03 | `_rolling_volatility` | ✓ SATISFIED | `metrics.py` line 620. REQUIREMENTS.md [x]. |
| METRICS-03 | 12-03 | `_rolling_alpha` + `_rolling_beta` via qs.stats.rolling_greeks | ✓ SATISFIED | `metrics.py` lines 631, 646. REQUIREMENTS.md [x]. |
| METRICS-04 | 12-04 | `_daily_returns_grid_from_series` flat per-day list | ✓ SATISFIED | `metrics.py` line 473. REQUIREMENTS.md [x]. |
| METRICS-05 | 12-04 | `compute_exposure_metrics` persists `exposure_series` | ✓ SATISFIED | `position_reconstruction.py` line 506 (exposure_series_records). REQUIREMENTS.md [x]. |
| METRICS-06 | 12-04 | `compute_turnover_series` with Pitfall #19 docstring | ✓ SATISFIED | `position_reconstruction.py` line 549 + Pitfall #19 docstring. REQUIREMENTS.md [x]. |
| METRICS-07 | 12-05 | 7 derived trade metrics including weighted_risk_reward_ratio (H-F) | ✓ SATISFIED | `analytics_runner.py` line 177 `_compute_derived_trade_metrics` with expectancy, risk_reward_ratio, weighted_risk_reward_ratio, sqn, profit_factor_long, profit_factor_short. REQUIREMENTS.md [x]. |
| METRICS-08 | 12-05 | SQN (Van Tharp mean(R)/std(R) × sqrt(min(N,100))) | ✓ SATISFIED | Inside `_compute_derived_trade_metrics`. REQUIREMENTS.md [x]. |
| METRICS-09 | 12-05 | Volume aggregator (gross volume, mean trade size, daily/monthly turnover) | ✓ SATISFIED | `analytics_runner.py` line 296 `_compute_volume_aggregator`. REQUIREMENTS.md [x]. |
| METRICS-10 | 12-05 | Trade Mix audit-gated 4-bucket/2-bucket via `_compute_trade_mix` | ✓ SATISFIED | `analytics_runner.py` line 344; TRADE_MIX_HAS_MAKER_TAKER=false → 2-bucket long/short ships. REQUIREMENTS.md [x]. |
| METRICS-11 | 12-04 | `compute_qstats_scalars` — 10 new scalars (recovery_factor through time_in_market) | ✓ SATISFIED | `metrics.py` line 493; golden fixture inner metrics_json has all 10 non-null. REQUIREMENTS.md [x]. |
| METRICS-12 | 12-03 | `_log_returns_series` via np.log1p | ✓ SATISFIED | `metrics.py` line 656. REQUIREMENTS.md [x]. |
| METRICS-13 | 12-09 | Cross-runtime parity tests + 3 fixtures | ✓ SATISFIED (human confirm) | regen_golden.py + golden_252d_{input.parquet,input.json,expected.json} + test_metrics_parity.py (Python) + metrics-parity.test.ts (TS) all exist. D-11 tolerances + H-C + M-Grok-2 + H-D + H-F all implemented. Live test run needs human confirmation. REQUIREMENTS.md [x]. |
| METRICS-14 | 12-07 | Throttled backfill via priority enum; dispatch_tick uses claim_compute_jobs_with_priority | ✓ SATISFIED | `main_worker.py` line 114 uses claim_compute_jobs_with_priority RPC from migration 086. REQUIREMENTS.md [x]. |
| METRICS-15 | 12-08 | `fetchStrategyLazyMetrics` RPC consumer (Phase 12 half); path-extraction in `getStrategyDetail` (Phase 14a half) | PARTIAL (deferred) | Phase 12 half: `fetchStrategyLazyMetrics` in queries.ts + `LazyMetricsPanelId` shipped. Phase 14a half: `getStrategyDetail` still uses `select *, strategy_analytics(*)` — intentionally deferred per ROADMAP SC#3b. REQUIREMENTS.md [ ] with explanation note. |
| METRICS-16 | 12-02 | Migration 086 priority enum + partial index + claim RPC | ✓ SATISFIED | Migration 086 verified. H-B search_path hardening on RPC. REQUIREMENTS.md [x]. |
| METRICS-17 | 12-02 | Migration 087 sibling table + RPCs + RLS | ✓ SATISFIED | Migration 087 + 088 verified. All RPCs have H-B hardening. REQUIREMENTS.md [x]. |

**Coverage:** 16/17 satisfied; METRICS-15 is partial (Phase 12 half shipped; Phase 14a half explicitly deferred in roadmap).

---

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `analytics-service/services/metrics.py` (multiple lines) | `return []` (short-circuit guards) | ℹ️ Info | These are intentional window-guard short-circuits (e.g., `if len(returns) < window: return []`) mirroring `_rolling_sharpe`. Not stubs — all serve data paths confirmed in the golden fixture. |
| `analytics-service/services/analytics_runner.py:100` | `return {}, {}, {}` | ℹ️ Info | Graceful-degradation return in `_load_position_time_series` when position_snapshots query returns no rows. WR-03 fix split the error surface into distinct `position_reconstruction_failed` and `position_snapshots_unavailable` flags. |
| `.planning/ROADMAP.md` inline plan checkboxes 12-03..12-10 | `[ ]` (unchecked) | ℹ️ Info | Known SDK quirk — `gsd-sdk roadmap update-plan-progress` regex doesn't match this inline format. Progress table at line 171 shows 10/10 complete. All 10 SUMMARY.md files exist. Not a blocker. |
| `TODOS.md` SC#4 section | `_pending — record after the 12-min window closes._` | ℹ️ Info | Expected: production deploy is operator-deferred per autonomous=false. Not a code defect. |

No blocker-level anti-patterns found.

---

### Human Verification Required

#### 1. Python Parity Test — Live Run

**Test:** In an environment with `python:3.12-slim` (matching Railway/CI), run:
```
cd analytics-service
pip install -r requirements.txt
pytest tests/test_metrics_parity.py -v
```
**Expected:** 5/5 tests pass (test_scalar_close_*, test_series_close_*, test_metrics_parity_full). No scalar drift. `assertMetricParity(actual, golden_252d_expected)` passes with D-11 tolerance.

**Why human:** Requires quantstats==0.0.81 + pyarrow==18.1.0 (WR-02 pinned). Local py3.14 venv lacks compatible pyarrow wheel. CI environment confirmed passing per STATE.md (592/595 total Python tests) but verifier cannot run tests without the correct environment.

---

#### 2. TS Parity Test — Live Run

**Test:** From project root with Supabase env vars set:
```
npx vitest run src/__tests__/metrics-parity.test.ts
```
**Expected:** 5/5 tests pass. `EXPECTED_SIBLING_KINDS.size == 12`. equity_series_1y absent from sibling kinds (H-D). Fixture JSON parses and all schema checks pass.

**Why human:** Requires Supabase env vars and Node environment. STATE.md documents 2285/2285 TS tests passing. Verifier cannot run Vitest standalone.

---

#### 3. Production Deploy + SC#4 Queue-Depth Observation

**Test:** Operator runs:
```
cd analytics-service
python -m scripts.phase12_deploy
```
Then observes `compute_analytics` queue depth for 12 minutes.

**Expected:** Queue depth never exceeds 50 for >10 consecutive minutes. TODOS.md SC#4 "Probe results" section filled in.

**Why human:** Plan 12-10 frontmatter `autonomous: false`. Deploy against live Supabase with production credentials. Requires human operator at the terminal for the 12-min observation window. TODOS.md SC#4 section exists with recording template.

---

### Gaps Summary

No blocking gaps. METRICS-15 is partially delivered as designed — Phase 12 ships the TS-side consumer (`fetchStrategyLazyMetrics`) and the RPC (`fetch_strategy_lazy_metrics`), while the `getStrategyDetail` path-extraction rewrite is explicitly deferred to Phase 14a per ROADMAP.md SC#3b annotation and REQUIREMENTS.md note. This is not a gap; it is intentional phase scoping.

All 4 code-review warnings (WR-01..WR-04) are resolved per 12-REVIEW-FIX.md:
- WR-01: TradeMetrics shape mismatch in pre-existing tests — fixed
- WR-02: pyarrow not pinned — pinned to 18.1.0 in requirements.txt
- WR-03: _load_position_time_series error misclassified — split into distinct error surfaces
- WR-04: non-atomic kill-switch cutover — migration 088 atomic dual-write RPC

Three items require human action before Phase 12 is fully closed:
1. Live Python parity test confirmation (STATE.md claims passing; needs live run)
2. Live TS parity test confirmation (STATE.md claims passing; needs live run)
3. Production deploy + SC#4 queue-depth 12-min observation (autonomous=false gate)

---

_Verified: 2026-04-28_
_Verifier: Claude (gsd-verifier)_
