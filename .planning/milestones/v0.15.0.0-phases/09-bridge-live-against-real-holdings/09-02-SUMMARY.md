---
phase: "09"
plan: "02"
subsystem: "analytics-engine-holdings-adapter"
tags:
  - python
  - fastapi
  - pandas
  - numpy
  - match-engine
  - pytest
  - engine-version
  - mandate-scoring
  - holding-flags
  - live-01
  - live-02

dependency_graph:
  requires:
    - "09-01 (match_batches.holding_flags JSONB column, match_decisions XOR schema)"
    - "analytics-service/services/match_engine.py score_candidates (unchanged)"
    - "allocator_holdings + allocator_equity_snapshots.breakdown (Phase 06/07 schema)"
  provides:
    - "reconstruct_symbol_returns() helper in equity_reconstruction.py"
    - "ENGINE_VERSION bumped to v2.1.0 (D-17 cache-invalidation seam)"
    - "FLAG_COMPOSITE_THRESHOLD = 50 constant in routers/match.py"
    - "_load_holding_portfolio_context() helper (sync def, warm-up gate)"
    - "_load_allocator_context() extended: merges portfolio_strategies + holdings pseudo-strategies"
    - "compute_holding_flags() helper: max_weight + correlation_ceiling + candidate-exists gate"
    - "match_batches.holding_flags JSONB persistence in _score_one_allocator"
    - "13 pytest tests (all plain def, no async)"
  affects:
    - "09-03 SSR layer (reads match_batches.holding_flags directly)"
    - "09-04 /compare parser (reuses reconstruct_symbol_returns)"
    - "All allocators: v2.0.0 batches invalidated on first post-ship cron run via ENGINE_VERSION mismatch"

tech_stack:
  added:
    - "pandas.Series.pct_change().dropna() for per-symbol return reconstruction"
    - "numpy rng for correlation test fixture (avoids NaN from constant-series edge case)"
  patterns:
    - "Sync def helpers called via asyncio.to_thread (finding f1 mandate preserved)"
    - "Latest-asof-per-(venue,symbol,holding_type) collapse mirroring TypeScript holdingsMap"
    - "30-day warm-up gate matching Phase 07 D-03 analog"
    - "TDD RED/GREEN/commit cadence per task"

key_files:
  created:
    - "analytics-service/tests/test_equity_reconstruction_phase09.py"
    - "analytics-service/tests/test_match_integration_phase09.py"
    - "analytics-service/tests/test_holding_flags_phase09.py"
  modified:
    - "analytics-service/services/equity_reconstruction.py"
    - "analytics-service/services/match_engine.py"
    - "analytics-service/routers/match.py"
    - "analytics-service/tests/test_match_engine.py"

decisions:
  - "reconstruct_symbol_returns: absent/zero days dropped (dropna, no forward-fill) per RESEARCH Pitfall 2"
  - "30-day warm-up gate: holdings with <30 daily returns excluded entirely from portfolio math (Phase 07 D-03 analog)"
  - "FLAG_COMPOSITE_THRESHOLD = 50 on 0..100 score scale (match_engine.py:787) resolves RESEARCH A3 / D-06"
  - "Correlation ceiling uses weighted rest-of-portfolio vector (all holdings except current) fed to _compute_corr_with_portfolio"
  - "compute_holding_flags: same full ranked candidates list passed to every holding slot; top-real-UUID + score>=50 gate gives deterministic per-holding selection"
  - "Identical constant returns series produce NaN correlation (zero stddev) — test fixture uses numpy rng with tiny noise instead"
  - "Pre-existing ruff violations (TOP_N_CANDIDATES, get_supabase in equity_reconstruction) are out of scope — deferred"

metrics:
  duration: "~19 minutes"
  completed: "2026-04-21T16:43:35Z"
  tasks_completed: 3
  files_changed: 7
---

# Phase 09 Plan 02: Engine Input-Layer Rewire — SUMMARY

**One-liner:** Holdings-sourced pseudo-strategies feed score_candidates via sync _load_allocator_context rewrite, per-symbol returns reconstructed from breakdown jsonb, holding_flags computed + persisted to match_batches, ENGINE_VERSION bumped to v2.1.0.

## Tasks Completed

| # | Task | Commit | Result |
|---|------|--------|--------|
| 1 | reconstruct_symbol_returns helper + ENGINE_VERSION v2.1.0 bump (TDD RED/GREEN) | f057cfc (RED) / 75fd8b4 (GREEN) | 5 tests GREEN |
| 2 | _load_holding_portfolio_context + _load_allocator_context merge + FLAG_COMPOSITE_THRESHOLD (TDD RED/GREEN) | 865c7c0 (RED) / dacd866 (GREEN) | 4 tests GREEN |
| 3 | compute_holding_flags + match_batches.holding_flags persistence (TDD RED/GREEN) | fa631bf (RED) / 7dedfa5 (GREEN) | 4 tests GREEN |

## Test Results

```
Test Files  3 new (passed) + 2 regression (passed)
Tests       13 new passed + 13 existing passed = 26 total
Duration    ~2s (all unit tests, no live DB)
```

| Suite | Tests | Result |
|-------|-------|--------|
| test_equity_reconstruction_phase09.py | 4/4 | PASS |
| test_match_integration_phase09.py | 4/4 | PASS |
| test_holding_flags_phase09.py | 4/4 | PASS |
| test_match_engine.py::test_engine_version_phase09_bump | 1/1 | PASS |
| test_match_integration.py (regression) | 5/5 | PASS |
| test_bridge_scoring.py (regression) | 8/8 | PASS |

## Implementation Details

### Task 1: reconstruct_symbol_returns + ENGINE_VERSION

`analytics-service/services/equity_reconstruction.py` — new `reconstruct_symbol_returns(snapshots, symbol)` function appended at end of file:
- Extracts `(asof, breakdown.get(symbol))` pairs from each snapshot
- Drops absent or zero values (RESEARCH Pitfall 2 — no forward-fill)
- Returns `pd.Series` via `pct_change().dropna()`, or `None` if <2 data points

`analytics-service/services/match_engine.py` — `ENGINE_VERSION` bumped `v2.0.0` → `v2.1.0` with Phase 09 annotation. `_should_skip_allocator` trigger #2 auto-invalidates all cached v2.0.0 batches on first cron run. `WEIGHTS_VERSION` unchanged per D-17.

### Task 2: Input-layer merge + warm-up gate

`analytics-service/routers/match.py` — two additions:

**`FLAG_COMPOSITE_THRESHOLD = 50`** constant at module level (D-06 + RESEARCH A3: maps "composite ≥ 0.50" on [0,1] scale to score ≥ 50 on match_engine.py's 0..100 `final_score` scale).

**`_load_holding_portfolio_context(allocator_id)`** sync helper:
1. Fetches `allocator_holdings` DESC by asof, collapses to latest-per-`(venue, symbol, holding_type)` (mirrors TypeScript `holdingsMap` at queries.ts:791-795)
2. Fetches `allocator_equity_snapshots` ASC
3. For each collapsed holding: calls `reconstruct_symbol_returns`, applies 30-day warm-up gate (`len(series) < 30` → excluded)
4. Returns eligible holdings' pseudo-strategies, weights (value_usd/total), returns, aum, and `holdings_rows_eligible` list

**`_load_allocator_context(allocator_id)`** modified (stays sync, per finding f1):
- Merges portfolio_strategies + holding pseudo-strategies
- Renormalizes weights across combined set (D-16): `weight = value / combined_aum` for all entries
- Returns `_holdings_rows_eligible` as internal-use field for Task 3 consumption

### Task 3: compute_holding_flags + persistence

**`compute_holding_flags()`** sync helper in `routers/match.py`:
- Defense-in-depth: skips holdings absent from `portfolio_returns`
- `max_weight` breach: `value_usd / portfolio_aum > allocator_preferences.max_weight`
- `correlation_ceiling` breach: builds weighted rest-of-portfolio vector (excluding current holding), calls `_compute_corr_with_portfolio(rest_port, holding_series)`, checks > threshold
- Candidate-exists gate: picks highest-scoring real UUID (non-`holding:` prefix) from sorted `scored_candidates_by_slot[pseudo_id]`; `flagged = True` iff breaches non-empty AND `top_composite >= 50`
- Entry shape: `{holding_ref, value_usd, weight, breach_reasons[], top_candidate_strategy_id, top_candidate_composite, flagged}`

**`_score_one_allocator`** wired to call `compute_holding_flags` after `score_candidates` completes, using a `_ScoredProxy` adapter to expose `strategy_id`/`final_score` attributes. Result written into `batch_row["holding_flags"]` (JSONB column added by 09-01 Task 1).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Identical constant returns series produces NaN correlation**
- **Found during:** Task 3 GREEN — test_holding_flags_correlation_ceiling failure
- **Issue:** Test used `[0.01] * 40` (constant series). `pd.Series.corr()` with zero stddev produces NaN via numpy divide-by-zero. `_safe_float(NaN)` returns `None` → no breach detected.
- **Fix:** Changed test fixture to use `numpy.random.default_rng(42)` to generate normally distributed base signal + tiny noise (stddev ~0.02), giving correlation ≈ 0.99. Documents the constant-series NaN edge case in the deviation log.
- **Files modified:** `analytics-service/tests/test_holding_flags_phase09.py`
- **Commit:** 7dedfa5

**2. [Rule 2 - Unused variable] `holding_weights_raw` assigned but never used**
- **Found during:** Task 3 ruff run
- **Fix:** Removed the dead assignment (was a copy-paste error from the merge context block)
- **Files modified:** `analytics-service/routers/match.py`
- **Commit:** 7dedfa5

### Deferred Items (pre-existing, out of scope)

- `TOP_N_CANDIDATES` imported but unused in `routers/match.py` — pre-existing at base commit c6db2dd8
- `get_supabase` imported but unused in `equity_reconstruction.py` — pre-existing
- `exc` unused variable in `equity_reconstruction.py` — pre-existing

## Known Stubs

None. All implementation is fully wired:
- `reconstruct_symbol_returns` produces real returns from breakdown jsonb
- `compute_holding_flags` computes real breach detection + candidate gate
- `match_batches.holding_flags` JSONB column is populated on every `_score_one_allocator` call
- `ENGINE_VERSION = "v2.1.0"` triggers real cache invalidation on next cron run

## Threat Surface Scan

No new network endpoints, auth paths, or trust boundaries introduced. The two threat items from the plan's threat model are mitigated:

| T-09-02 | `_load_holding_portfolio_context` uses `.eq("allocator_id", allocator_id)` on both `allocator_holdings` and `allocator_equity_snapshots` — owner-scoped reads with RLS as primary defense |
| T-09-02-SPOOF | Pseudo-ids contain colons, never land in `match_candidates.strategy_id` (UUID column) — in-memory only |
| T-09-02-INJ | Venue/symbol/holding_type come from DB rows written only by the worker (service_role) |
| T-09-02-HOLDING-FLAGS | `match_batches` RLS (migration 011) is owner+admin+service_role — new JSONB column inherits the same policy |

## TDD Gate Compliance

Each task followed RED → GREEN → commit cadence:

| Task | RED commit | GREEN commit |
|------|-----------|--------------|
| 1 (reconstruct_symbol_returns + ENGINE_VERSION) | f057cfc | 75fd8b4 |
| 2 (_load_allocator_context merge + FLAG_COMPOSITE_THRESHOLD) | 865c7c0 | dacd866 |
| 3 (compute_holding_flags + persistence) | fa631bf | 7dedfa5 |

## Self-Check

Key files verified present:
- FOUND: analytics-service/services/equity_reconstruction.py
- FOUND: analytics-service/services/match_engine.py
- FOUND: analytics-service/routers/match.py
- FOUND: analytics-service/tests/test_equity_reconstruction_phase09.py
- FOUND: analytics-service/tests/test_match_integration_phase09.py
- FOUND: analytics-service/tests/test_holding_flags_phase09.py
- FOUND: analytics-service/tests/test_match_engine.py

Commits verified present: f057cfc, 75fd8b4, 865c7c0, dacd866, fa631bf, 7dedfa5

## Self-Check: PASSED
