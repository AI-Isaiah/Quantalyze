# Phase 12: Backend Metric Contracts - Research

**Researched:** 2026-04-26
**Domain:** Python analytics-service (`metrics.py`) extension + Postgres queue/sibling-table migrations + cross-runtime parity contract
**Confidence:** HIGH (every claim grounded in file:line evidence; CONTEXT.md decisions D-01..D-16 are locked)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Heavy series → `strategy_analytics_series` sibling table; light scalars + above-the-fold series → `metrics_json`. Sibling kinds: `daily_returns_grid`, `rolling_sortino_3m`, `rolling_sortino_6m`, `rolling_sortino_12m`, `rolling_volatility_3m`, `rolling_volatility_6m`, `rolling_volatility_12m`, `rolling_alpha`, `rolling_beta`, `exposure_series`, `turnover_series`, `log_returns_series`. `metrics_json` keys: 10 new qstats scalars (Recovery Factor, Ulcer Index, UPI, Kelly Criterion, Probabilistic Sharpe, Common Sense Ratio, CPC Index, Serenity Index, R² vs BTC, Time-in-Market) + above-the-fold series (`equity_series_1y`, sparkline) + all existing qstats scalars.
- **D-02:** Sibling table schema = `strategy_analytics_series (strategy_id UUID FK ON DELETE CASCADE, kind TEXT, payload JSONB, computed_at TIMESTAMPTZ, PRIMARY KEY (strategy_id, kind))`. Single JSONB `payload` column per `kind`.
- **D-03:** `kind` field naming = snake_case 1:1 with the metrics_json key name.
- **D-04:** Lazy-fetch RPC = `fetch_strategy_lazy_metrics(strategy_id UUID, panel_id TEXT) RETURNS JSONB`. `panel_id` enum: `overview`, `equity`, `drawdown`, `returns_dist`, `rolling`, `trades`, `exposure`. RPC LATERAL joins sibling table; returns `{kind: payload}` map for that panel.
- **D-05:** Priority enum on `compute_jobs` = `low` / `normal` / `high`. Backfill = `low`, `sync_trades` = `normal`, manual force-recompute = `high`. Migration `086_compute_jobs_priority.sql` adds the enum column + partial index `WHERE priority IN ('normal','high')`.
- **D-06:** Throttle policy = global cap of 5 backfill jobs/min across all workers when ANY `normal`/`high` job is queued; unthrottled when queue is idle of higher priorities. Implemented via `SELECT … FOR UPDATE SKIP LOCKED` guard in `analytics-service/services/job_worker.py` enqueuer.
- **D-07:** >800kB p99.9 kill-switch UX = Phase 12 deploy script runs `analyze_metrics_size.sql` post-deploy; if p99.9 ≥ 800kB it auto-migrates remaining heavy keys (`daily_returns_grid`, `rolling_*`) from `metrics_json` to the sibling table via one-shot `UPDATE`. STATE.md log entry on trigger. Env override `SKIP_KILL_SWITCH=1` for staged rollout.
- **D-08:** Existing-strategy migration on Phase 12 deploy = eager re-enqueue **all published strategies** (~20) as `priority=low` immediately on deploy. Throttle (D-06) caps at 5/min so `sync_trades` never queues behind. No `metrics_json_version` column needed.
- **D-09:** Fixture source = synthetic, deterministic random walk seeded `seed=42`, 252 trading days, calibrated profile (5% annualized vol, ~0.4 Sharpe, ~10% max DD, ~250 trades, ~50 positions). Stored at `analytics-service/tests/fixtures/golden_252d.parquet`.
- **D-10:** Fixture storage format = input series (prices, fills, positions) → parquet at `analytics-service/tests/fixtures/golden_252d_input.parquet`. Expected output (full `metrics_json` + sibling-table payloads keyed by `kind`) → JSON at `analytics-service/tests/fixtures/golden_252d_expected.json`. Both committed; regenerated via `python -m tests.fixtures.regen_golden`.
- **D-11:** Parity tolerance = hybrid: scalar keys → byte-identical JSON after both sides round to 12 significant digits; series values → 1e-9 relative epsilon (NaN==NaN, +0==-0). Single `assertMetricParity()` helper in both `test_metrics_parity.py` (Python) and `metrics-parity.test.ts` (TS) enforces both rules.
- **D-12:** CI gate scope = ALL metrics — every key emitted by `compute_all_metrics()`. Fail-loud on any new key not present in expected JSON.
- **D-13:** Five derived trade metrics — Expectancy, Risk:Reward Ratio, SQN, Profit Factor (long), Profit Factor (short), plus Trade Mix. All land in `trade_metrics` JSONB. Each is a 1-line derivation in `_compute_volume_metrics`.
- **D-14:** Trade Mix breakdown shape = 2×2 cross — long/short × maker/taker → 4 buckets. Each bucket shape = `{count: int, total_notional: float, avg_holding_period_hours: float}`. Nested as `trade_metrics.trade_mix.{long_maker, long_taker, short_maker, short_taker}`.
- **D-15:** `is_maker` audit + descope — Phase 12 plan-phase opens with explicit Task 1 = audit SQL on Binance/OKX/Bybit. All 3 ≥ 99% → ship maker/taker. Any 1 < 99% → descope to v0.17.1, ship long/short-only (2 buckets). Deribit excluded by design (`exchange.py:325-334`).
- **D-16:** Trade-table column contract for Phase 14b consumption = `trade_metrics` JSONB has FROZEN top-level keys with matching TS type in `src/lib/types.ts`. Frozen keys: `expectancy`, `risk_reward_ratio`, `sqn`, `profit_factor_long`, `profit_factor_short`, `trade_mix.{4 buckets}`, plus existing aggregates.

### Claude's Discretion

- Internal helper naming inside `metrics.py` (e.g., `_rolling_sortino` vs `_compute_rolling_sortino`) — mirror the closest existing convention at `metrics.py:374` (`_rolling_sharpe`).
- Pytest fixture organization (one `conftest.py` per metric family vs one global) — Claude picks based on readability.
- Specific implementation language for kill-switch UPDATE (single statement vs cursor over rows) — Claude picks based on lock duration vs simplicity.
- Choice of LATERAL vs subquery vs `jsonb_object_agg` for the `fetch_strategy_lazy_metrics` RPC body — performance test against p95 < 200ms budget will decide.
- Window-day exact counts (3M = 63 vs 90 calendar; 6M = 126 vs 180; 12M = 252 vs 365) — match existing `_rolling_sharpe` pattern at `metrics.py:374` (trading days, not calendar).

### Deferred Ideas (OUT OF SCOPE)

- Trade Mix maker/taker dimension (descoped to v0.17.1 if `is_maker` audit < 99% on any of Binance/OKX/Bybit; long/short-only 2-bucket fallback ships in Phase 12).
- Discovery v2 polish (T7 / Phase 13 — independent, ships in parallel).
- Single-Strategy v2 UI (T8b / Phase 14a + 14b — depends on Phase 12).
- Multi-benchmark correlation (ETH/SOL) — UC#6 descope; Sprint 13+ candidate.
- Manager Workspace, Inbox, Threads, Mandate doc, Activity log — v0.18.0.0.
- Stress testing engine, Monthly performance commentary, Drawdown story card, Advanced portfolio optimizer — beyond v0.17.
- New Python deps (`scipy`, `statsmodels`, `pyfolio`) — not needed; pure additive on existing pandas + quantstats + numpy stack.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| METRICS-01 | `_rolling_sortino_series(returns, windows=[63,126,252])` + module-level `MAR = 0.0` | Pattern template at `metrics.py:374` (`_rolling_sharpe`); pitfall #11 mitigation |
| METRICS-02 | `_rolling_volatility_series(returns, windows=[63,126,252])` | Same pattern; one-line vectorized pandas (`returns.rolling(window).std() * np.sqrt(252)`) |
| METRICS-03 | `_rolling_alpha_series` + `_rolling_beta_series` | Wrapper around `qs.stats.rolling_greeks` (BTC benchmark only per UC#6) |
| METRICS-04 | `daily_returns_grid(returns)` writes to sibling table (kind=`daily_returns_grid`) | Pattern template at `metrics.py:351` (`_monthly_returns_grid_from_series`) |
| METRICS-05 | `compute_exposure_metrics()` refactored to persist per-date arrays as series | `position_reconstruction.py:435-495` already collects, currently discards (lines 461-487) |
| METRICS-06 | `turnover_series` (daily `abs(Δposition × price) / NAV`) | Pitfall #19 mitigation — explicit docstring on contract |
| METRICS-07 | 5 derived trade metrics — Expectancy, R:R, Long PF, Short PF + side-segmented Trade Main | All 1-line derivations in `_compute_volume_metrics` (`analytics_runner.py:49`) |
| METRICS-08 | SQN (Van Tharp `mean(R)/std(R) × sqrt(min(N,100))`) | One pandas one-liner |
| METRICS-09 | Volume aggregator over `raw_fills` — gross volume, mean trade size, daily/monthly turnover | Aggregator over `trades WHERE is_fill=true` |
| METRICS-10 | Trade Mix maker/taker aggregator | `trades.is_maker` column exists (migration 039:47); audit-gated per D-15 |
| METRICS-11 | 10 new scalar metrics (Recovery Factor through Time-in-Market) | Each = `qs.stats.{name}(returns)` 1-liner |
| METRICS-12 | `log_returns_series` | One-line `np.log(1 + returns)` series; finalized via `_finalize_rolling`-style helper |
| METRICS-13 | Cross-runtime parity tests | New: `test_metrics_parity.py` + `metrics-parity.test.ts` against golden 252d fixture |
| METRICS-14 | Throttled backfill via priority enum + 5/min cap | Depends on METRICS-16 migration; throttle guard at `job_worker.py:1434-1460` |
| METRICS-15 | `getStrategyDetail()` reads scalars via path-extraction; heavy series via LATERAL join (sibling table) | Depends on METRICS-17; `src/lib/queries.ts:274-299` is the consumer |
| METRICS-16 | Migration `086_compute_jobs_priority.sql` — priority enum + partial index | Pattern: `032_compute_jobs_queue.sql` (full self-verifying DO block style) |
| METRICS-17 | Migration `087_strategy_analytics_series.sql` — sibling table + RLS | Per D-02 schema; mirror `024_user_favorites.sql` RLS shape |

</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Senior staff engineer standard**: simplicity-first, root-cause obsession, minimal diff surface area.
- **Skill routing**: Task management protocol applies — `/qa` after every UI fix; `/ship` to commit (never manual git commit).
- **Banned packages** (`src/__tests__/check-banned-packages.test.ts` enforced in CI):
  - `axios` → use native `fetch()` or `undici` (irrelevant for Phase 12 — pure Python work; banned-list check runs against `package.json` only).
  - `react-native-international-phone-number`, `react-native-country-select`, `@openclaw-ai/openclawai` — N/A for backend.
- **TDD mode**: Project default is plan-then-implement. CONTEXT.md notes: "Plans should mark business-logic tasks (metric helpers, throttle guard, RPC body, parity assertion) as `type: tdd` with RED→GREEN→REFACTOR sequencing."
- **AGENTS.md**: This is Next.js 16 (post-rename); `middleware.ts` → `proxy.ts`. **Phase 12 is backend-Python only — Next.js rules irrelevant**, but keep the AGENTS.md note in mind for any Phase 14 follow-up.
- **DESIGN.md**: Backend tasks should not regress chart-token defaults. Phase 12 doesn't touch UI but the JSON contract it ships is the visual contract for Phase 14.

---

## 1. Domain Summary

Phase 12 extends `analytics-service/services/metrics.py` so it produces **every scalar and series the v0.17 7-panel UI needs** — 3M/6M/12M rolling Sortino, Vol, and Greeks (alpha/beta) series; a daily-returns grid; per-date gross/net exposure and turnover series; full trade-table aggregations (Expectancy, R:R, SQN, PF long/short, Trade Mix maker/taker); 10 missing qstats scalars (Recovery Factor through Time-in-Market); and a log-returns series. **Heavy series go into a new `strategy_analytics_series` sibling table** (one row per `(strategy_id, kind)`) to keep `metrics_json` under the 1MB TOAST ceiling. A new `compute_jobs.priority` enum (`low`/`normal`/`high`) plus a 5-jobs/min throttle guard in `job_worker.py` ensures the post-deploy backfill of all ~20 published strategies cannot starve live `sync_trades`. A cross-runtime parity test (`test_metrics_parity.py` + `metrics-parity.test.ts`) gates every metric against a deterministic 252-trading-day fixture (`seed=42`). The whole phase is **pure-additive on existing infrastructure** — no new top-level columns on `strategy_analytics`, no new Python deps, no UI changes — and ships invisible value that unblocks Phase 14a/14b.

**Primary recommendation:** Mirror three existing patterns verbatim: `_rolling_sharpe` at `metrics.py:374` for every new rolling series; `_monthly_returns_grid_from_series` at `metrics.py:351` for `daily_returns_grid`; the additive upsert at `analytics_runner.py:189-211` for the new `(strategy_id, kind)` sibling-table writes. Open the phase with the **`is_maker` audit SQL (D-15)** on day one — its result branches the Trade Mix scope.

## 2. Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Rolling series math (Sortino/Vol/Greeks) | analytics-service (Python) | — | Pure pandas/numpy/quantstats; mirrors existing `metrics.py:374` |
| Daily/monthly returns grid construction | analytics-service (Python) | — | Pandas `.resample` + reshape; pattern at `metrics.py:351` |
| Exposure & turnover per-date series | analytics-service (Python) | — | Existing `position_reconstruction.py:435-495` already collects per-date arrays |
| Trade-table aggregations (Expectancy, SQN, PF L/S) | analytics-service (Python) | — | Aggregator over `trades` rows in `_compute_volume_metrics` (`analytics_runner.py:49`) |
| Trade Mix 2×2 maker/taker breakdown | analytics-service (Python) | DB (`trades.is_maker`) | Audit-gated; SQL aggregate over `raw_fills` filtered by `is_fill=true` |
| 10 new qstats scalars | analytics-service (Python) | — | Each is `qs.stats.{name}(returns)` one-liner |
| Sibling-table persistence | DB (Postgres) | analytics-service (Python writer) | New schema `087_strategy_analytics_series.sql`; upsert from `analytics_runner.py` |
| Priority-aware queue dispatch | DB (Postgres) | analytics-service (Python worker) | `086_compute_jobs_priority.sql` adds enum + index; `job_worker.py:1434-1460` throttle reads it |
| Throttle guard (5/min cap) | analytics-service (Python) | DB (`SELECT … FOR UPDATE SKIP LOCKED`) | Implemented in dispatcher; backfill rate limit when `normal`/`high` queued |
| Lazy-fetch RPC for panels 4–7 | DB (Postgres SECURITY DEFINER) | TS consumer (Phase 14b) | `fetch_strategy_lazy_metrics(strategy_id, panel_id)` LATERAL join |
| Path-extraction for above-the-fold scalars | TS consumer (`getStrategyDetail` at `queries.ts:274`) | DB (`metrics_json -> 'key'`) | Phase 14a consumer; Phase 12 ships the shape, not the consumer |
| Frozen TS contract for `trade_metrics` | TS types (`src/lib/types.ts`) | analytics-service (Python writer) | D-16 — Phase 14b reads via `Strategy.trade_metrics?.expectancy` etc. |
| Parity assertion (cross-runtime) | analytics-service (pytest) ‖ Vitest | shared fixture | `assertMetricParity()` helper in both runtimes against `golden_252d_expected.json` |
| `is_maker` coverage audit | DB (one-shot SQL) | TODOS.md write | Phase 12 day-1 audit; descope decision flows to D-15 |
| Kill-switch (>800kB p99.9) | analytics-service (deploy script) | DB (`pg_column_size`) | `analyze_metrics_size.sql` post-deploy; `SKIP_KILL_SWITCH=1` env override |

## 3. Implementation Approach

The work decomposes into seven sequential waves. Each wave can ship as one or more tasks; the planner will fold them into TDD RED→GREEN→REFACTOR sequencing.

### Wave A — Audit & schema foundation (must land first)

1. **Task 1: `is_maker` coverage audit (D-15).** Run the audit SQL on Binance/OKX/Bybit (Deribit excluded — `exchange.py:325-334` confirms). Document Deribit "N/A by design" in TODOS.md. Outcome branches D-15: all-three ≥ 99% → ship 4-bucket Trade Mix; any-one < 99% → descope to long/short-only (2 buckets). The branch is recorded in PLAN.md before any code lands.
2. **Migration `086_compute_jobs_priority.sql` (METRICS-16).** Adds `priority TEXT CHECK (priority IN ('low','normal','high')) NOT NULL DEFAULT 'normal'` to `compute_jobs`. Adds partial index `idx_compute_jobs_priority_high WHERE priority IN ('normal','high') AND status = 'pending'` so live jobs jump the queue. Self-verifying DO block matching `032_compute_jobs_queue.sql` style.
3. **Migration `087_strategy_analytics_series.sql` (METRICS-17).** Creates the sibling table per D-02. `RLS ENABLE`, deny-all for non-service-role, mirroring `compute_jobs_deny_all` at `032:233-237` (this is operational data; allocator-side reads go through the lazy-fetch RPC). FK ON DELETE CASCADE so archived strategies cleanly remove their series.

### Wave B — `metrics.py` core extensions

4. **Module-level `MAR = 0.0` constant.** Top of `metrics.py`, with docstring tying to Pitfall #11. Both `qs.stats.sortino(returns)` (which already uses MAR=0) and the new `_rolling_sortino` use this constant for cross-runtime consistency.
5. **`_rolling_sortino_series(returns, window)` + `_rolling_volatility_series(returns, window)`.** Mirror `_rolling_sharpe` at `metrics.py:374` exactly — same window guard, same `_finalize_rolling()` finalizer, same NaN handling. Loop over `[63, 126, 252]` (trading days, matching existing 1y=252 convention). Sortino divides rolling mean by downside std (`returns[returns < 0].rolling(window).std()`); Vol = `returns.rolling(window).std() * np.sqrt(252)`.
6. **`_rolling_alpha_series` + `_rolling_beta_series`.** Wrap `qs.stats.rolling_greeks(returns, benchmark, window)` for the 90d window (BTC only per UC#6). Format with `_finalize_rolling()`.
7. **`_daily_returns_grid_from_series(returns)`.** Direct mirror of `_monthly_returns_grid_from_series` at `metrics.py:351` — `.resample("D")` instead of `.resample("ME")`. Output shape: `[{date: "YYYY-MM-DD", value: float}]` flat array (matches D-01 sibling-kind contract better than the year/month nested dict; planner can decide).
8. **`_log_returns_series(returns)`.** One-liner: `np.log1p(returns)` finalized via `_finalize_rolling`-style helper.
9. **10 new qstats scalars (METRICS-11).** Each in a `try…except Exception: pass` block matching the existing pattern at `metrics.py:97-138`. Names: `recovery_factor`, `ulcer_index`, `upi`, `kelly_criterion`, `probabilistic_sharpe_ratio`, `common_sense_ratio`, `cpc_index`, `serenity_index`, `r_squared`, `time_in_market` (qstats `exposure`). All write into `metrics_json`.

### Wave C — Position-derived series (METRICS-05, METRICS-06)

10. **Refactor `compute_exposure_metrics()` (`position_reconstruction.py:435-495`).** The function already builds `gross_exposures: list[float]` and `net_exposures: list[float]` per date (lines 461-476) but only emits aggregates (lines 489-495). Add a parallel return path that emits `exposure_series` shape `[{date, gross, net}]` for sibling-table writes. The aggregates stay in `exposure_metrics` (existing column); the series goes to `(strategy_id, kind='exposure_series')` in the sibling table.
11. **`compute_turnover_series()` new function.** Per Pitfall #19 mitigation: explicit docstring `"daily turnover ratio = trade_volume_usd_today / nav_today"`. NAV alignment depends on Sprint 3 position reconstruction (already shipped). Output: `[{date, turnover}]` to `(strategy_id, kind='turnover_series')`.

### Wave D — Trade-table aggregations (METRICS-07, METRICS-08, METRICS-09, METRICS-10)

12. **Extend `_compute_volume_metrics()` at `analytics_runner.py:49`.** Add 4 derived scalars + Trade Mix per D-13/D-14:
    - `expectancy = (win_rate × avg_win) − ((1−win_rate) × |avg_loss|)` — derives from existing `metrics_json["avg_win"]` / `["avg_loss"]` / `["win_rate"]`.
    - `risk_reward_ratio = avg_win / |avg_loss|`.
    - `sqn = (mean(R)/std(R)) × sqrt(min(N,100))` over per-trade R-multiples.
    - `profit_factor_long`, `profit_factor_short` — `qs.stats.profit_factor` segmented by `side` partition over `trades` rows.
    - `trade_mix = {long_maker, long_taker, short_maker, short_taker}` (4 buckets) OR `{long, short}` (2 buckets) depending on D-15 audit outcome. Each bucket: `{count, total_notional, avg_holding_period_hours}`. Aggregator filters `WHERE is_fill = true` (the partial unique index at `migration 039:78` covers this).
13. **Frozen TS contract update (D-16).** Extend `TradeMetrics` interface in `src/lib/types.ts:137-148`: add `expectancy: number | null`, `risk_reward_ratio: number | null`, `sqn: number | null`, `profit_factor_long: number | null`, `profit_factor_short: number | null`, `trade_mix?: TradeMixBuckets`. Add new `TradeMixBuckets` interface with the 4-bucket-or-2-bucket discriminator. Phase 14b reads via these fields.

### Wave E — Sibling-table writes & lazy-fetch RPC

14. **Extend `compute_all_metrics()` return shape (`metrics.py:289-307`).** Currently returns one fat dict. Refactor to return `(metrics_json_dict, sibling_kinds_dict)` tuple. Sibling kinds dict: `{kind_name: payload, …}` for the 12 D-01 kinds. The current `metrics_json` keeps growing only with the 10 new scalars + above-the-fold series.
15. **Extend `analytics_runner.run_strategy_analytics()` upsert (`analytics_runner.py:200-211`).** After the existing `strategy_analytics` upsert, loop over the sibling-kinds dict and emit one `INSERT … ON CONFLICT (strategy_id, kind) DO UPDATE SET payload = EXCLUDED.payload, computed_at = now()` per kind into `strategy_analytics_series`. Atomic per-kind; the loop is inside the same transaction as the main upsert if the supabase-py client supports it (it does via `db_execute` lambda batching).
16. **`fetch_strategy_lazy_metrics(strategy_id UUID, panel_id TEXT)` RPC (D-04).** New SQL function, SECURITY DEFINER, in a Phase 12 migration footer or `087_strategy_analytics_series.sql`. Body: `CASE panel_id WHEN 'returns_dist' THEN jsonb_build_object('daily_returns_grid', (SELECT payload FROM strategy_analytics_series WHERE strategy_id = $1 AND kind = 'daily_returns_grid')) WHEN 'rolling' THEN …` etc. LATERAL join is one alternative; `jsonb_object_agg` over a kinds-by-panel mapping table is another. Performance test against p95 < 200ms decides (planner's discretion per CONTEXT.md).
17. **Panel-id → kind mapping table (in RPC SQL, not a real table).** `overview` → no series; `equity` → `equity_series_1y` + `log_returns_series`; `drawdown` → no series (already in `metrics_json.drawdown_episodes`); `returns_dist` → `daily_returns_grid`; `rolling` → 7 rolling kinds (3M/6M/12M Sortino + Vol + alpha + beta); `trades` → no series; `exposure` → `exposure_series` + `turnover_series`.

### Wave F — Throttle, kill-switch, backfill orchestration

18. **Throttle guard in `job_worker.py:1434-1460` dispatch path (METRICS-14).** The existing `claim_compute_jobs(p_batch_size=5, p_worker_id)` RPC call at `main_worker.py:99-102` returns up to 5 jobs ordered by `next_attempt_at`. Per D-06: when ANY `normal`/`high` job is queued, cap backfill (`priority='low'`) jobs at 5/min globally. Two implementation options:
    - **(a)** New SQL helper `claim_compute_jobs_with_priority(...)` that prefers `normal`/`high` and conditionally limits `low` based on a global counter table. Cleaner, atomic.
    - **(b)** Python-side guard in `dispatch_tick()` (`main_worker.py:88-116`): before claiming, do `SELECT count(*) FROM compute_jobs WHERE priority IN ('normal','high') AND status='pending'`; if non-zero, restrict `claim` batch to `normal`/`high` rows; else free-for-all.
    - Pick (a) for atomicity. Planner decides.
19. **`analyze_metrics_size.sql` + kill-switch (D-07).** New SQL script in `analytics-service/scripts/` (or `supabase/scripts/`): `SELECT percentile_cont(0.999) WITHIN GROUP (ORDER BY pg_column_size(metrics_json)) FROM strategy_analytics`. Phase 12 deploy script (separate file, not a migration) runs this. If `>800kB`: emergency cutover via single `UPDATE strategy_analytics SET metrics_json = metrics_json - 'rolling_sortino_3m' - 'rolling_sortino_6m' - … ` and equivalent inserts into the sibling table. Env override `SKIP_KILL_SWITCH=1` skips. STATE.md log entry on trigger.
20. **Eager re-enqueue all published strategies (D-08).** Phase 12 deploy script enqueues `compute_analytics` job for each `WHERE status = 'published'` with `priority='low'`. Wave A throttle ensures no `sync_trades` starvation.

### Wave G — Cross-runtime parity tests (METRICS-13)

21. **Fixture generation script: `analytics-service/tests/fixtures/regen_golden.py`.** Synthetic 252-trading-day random walk per D-09: `np.random.seed(42)`, calibrate to ~5% annualized vol / ~0.4 Sharpe / ~10% max DD / ~250 trades / ~50 positions. Write `golden_252d_input.parquet` (prices/fills/positions) + run through `compute_all_metrics()` → write `golden_252d_expected.json` (full `metrics_json` + sibling-table payloads keyed by `kind`).
22. **Python parity test: `analytics-service/tests/test_metrics_parity.py`.** Reads input parquet, runs `compute_all_metrics()`, calls `assertMetricParity(actual, expected)` where the helper enforces D-11 hybrid tolerance (12-sig-digit byte-identical for scalars, 1e-9 relative epsilon for series, NaN==NaN, +0==-0).
23. **TS parity test: `src/__tests__/metrics-parity.test.ts`.** Reads the same `golden_252d_expected.json`. **Important question for the planner:** Does the TS side need to *recompute* the metrics (proving Python ↔ TS parity), or just *consume* the pre-computed JSON (proving the JSON contract is stable)? Per CONTEXT.md D-12 "ALL metrics — every key emitted by `compute_all_metrics()`" reads as the latter (consumer-side schema gate). Planner clarifies before TS test scope is locked.
24. **Parquet reader on the TS side.** No existing precedent — open question (see Risk Register). Either: (a) ship `parquetjs` (or `apache-arrow`) as a devDep, (b) keep the TS side JSON-only and skip the parquet input, (c) generate a `golden_252d_input.json` companion alongside the parquet.

## 4. File-Level Deliverable Map

| File | Action | Closest existing analog | Why |
|------|--------|------------------------|-----|
| `analytics-service/services/metrics.py` | Extend | self (`_rolling_sharpe:374`, `_monthly_returns_grid_from_series:351`) | All math additions; `compute_all_metrics()` return shape refactored to tuple |
| `analytics-service/services/position_reconstruction.py` | Extend (`compute_exposure_metrics:435`) + new `compute_turnover_series()` | `compute_exposure_metrics` lines 461-476 (per-date arrays already collected) | Persist what's currently discarded |
| `analytics-service/services/analytics_runner.py` | Extend (`_compute_volume_metrics:49` + `run_strategy_analytics:189-275`) | self lines 200-211 (additive upsert) | New trade derivations + sibling-table loop upsert |
| `analytics-service/services/job_worker.py` | Extend (`dispatch:1446-1500` throttle hook) | self lines 1457-1486 (kind dispatch) | Priority-aware claim |
| `analytics-service/main_worker.py` | Possibly extend (`dispatch_tick:88-116` claim path) | self lines 98-103 (`claim_compute_jobs` RPC call) | If throttle option (a) chosen, swap to new RPC |
| `analytics-service/scripts/analyze_metrics_size.sql` | NEW | none — first SQL script in `analytics-service/` | Post-deploy size probe |
| `analytics-service/scripts/phase12_kill_switch.py` | NEW | none — first deploy-time Python script | Reads `analyze_metrics_size.sql`, runs cutover UPDATE |
| `analytics-service/scripts/phase12_backfill_enqueue.py` | NEW | `analytics_runner.run_strategy_analytics` (caller) | Enqueues `compute_analytics priority=low` for every published strategy |
| `analytics-service/tests/conftest.py` | Extend | self lines 1-83 (existing fixtures) | Add `golden_252d_input` + `golden_252d_expected` loaders |
| `analytics-service/tests/fixtures/regen_golden.py` | NEW | `match_engine_v2_golden.json` (existing committed-golden pattern) | Deterministic seed=42 fixture generator |
| `analytics-service/tests/fixtures/golden_252d_input.parquet` | NEW (committed binary) | `feedback_engine_v1_*_golden.json` (existing committed JSON goldens) | D-10 input fixture |
| `analytics-service/tests/fixtures/golden_252d_expected.json` | NEW (committed) | same | D-10 expected fixture |
| `analytics-service/tests/test_metrics_parity.py` | NEW | `test_metrics.py` (existing) | Python-side parity assertion |
| `analytics-service/tests/test_metrics.py` | Extend | self (existing per-metric unit tests) | Unit tests for new helpers (RED-first) |
| `analytics-service/tests/test_position_reconstruction.py` | Extend | self | Test exposure_series + turnover_series persistence |
| `analytics-service/tests/test_analytics_runner.py` | Extend | self | Test sibling-table upsert + new derived trade metrics |
| `analytics-service/tests/test_job_worker.py` | Extend | self | Test throttle guard + priority dispatch |
| `supabase/migrations/086_compute_jobs_priority.sql` | NEW | `032_compute_jobs_queue.sql` (queue creation, full self-verifying DO block) | Priority enum + partial index per D-05 |
| `supabase/migrations/087_strategy_analytics_series.sql` | NEW | `024_user_favorites.sql` (RLS shape) + `032:106-151` (table + DO block style) | Sibling table per D-02 + `fetch_strategy_lazy_metrics` RPC per D-04 |
| `src/lib/types.ts` | Extend (lines 137-148 — `TradeMetrics` interface) | self | D-16 frozen TS contract |
| `src/__tests__/metrics-parity.test.ts` | NEW | none — first TS-side parity check | TS-side parity gate (scope clarification needed — see Risk Register) |
| `src/__tests__/types-frozen-contract.test.ts` | NEW (optional) | none | Compile-time gate that `TradeMetrics` keys never silently drop |

**Files NOT modified by Phase 12** (downstream consumers — Phase 14a/14b territory):
- `src/lib/queries.ts` (`getStrategyDetail:274` — Phase 14a/14b extends to call new RPC)
- `src/components/strategy/PerformanceReport.tsx` (Phase 14a replaces with V2)
- Any chart component under `src/components/charts/` (Phase 14a recolors; Phase 14b adds DailyHeatmap)

## 5. Pattern Templates (verbatim excerpts)

The planner instructs the executor to mirror these patterns. Copy the shape, change the math.

### 5a. Pattern: `_rolling_sharpe` (`metrics.py:374-381`) — template for METRICS-01/02/03

```python
def _rolling_sharpe(returns: pd.Series, window: int) -> list[dict[str, Any]]:
    """Compute rolling annualized Sharpe using vectorized pandas rolling."""
    if len(returns) < window:
        return []
    roll_mean = returns.rolling(window).mean()
    roll_std = returns.rolling(window).std()
    return _finalize_rolling((roll_mean / roll_std) * np.sqrt(252))
```

**How to mirror for Sortino:**
```python
def _rolling_sortino(returns: pd.Series, window: int, mar: float = MAR) -> list[dict[str, Any]]:
    """Compute rolling annualized Sortino using downside std (MAR-floored).

    MAR sourced from module-level constant (Pitfall 11 mitigation).
    """
    if len(returns) < window:
        return []
    roll_mean = returns.rolling(window).mean()
    downside = returns.where(returns < mar, 0.0)
    roll_dstd = downside.rolling(window).std()
    return _finalize_rolling((roll_mean / roll_dstd) * np.sqrt(252))
```

**How to mirror for Volatility:**
```python
def _rolling_volatility(returns: pd.Series, window: int) -> list[dict[str, Any]]:
    """Annualized rolling volatility."""
    if len(returns) < window:
        return []
    return _finalize_rolling(returns.rolling(window).std() * np.sqrt(252))
```

**Why mirror exactly:** the existing helper already handles the `len < window → []` short-circuit, the `_finalize_rolling()` NaN/Inf scrubbing, and the `cap_data_points()` size limit. Re-implementing any of these introduces drift the parity test will catch.

### 5b. Pattern: `_monthly_returns_grid_from_series` (`metrics.py:351-361`) — template for METRICS-04

```python
def _monthly_returns_grid_from_series(monthly: pd.Series) -> dict[str, dict[str, float]]:
    """Year x Month grid from pre-computed monthly returns."""
    months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    grid: dict[str, dict[str, float]] = {}
    for date, val in monthly.items():
        year = str(date.year)
        month = months[date.month - 1]
        if year not in grid:
            grid[year] = {}
        grid[year][month] = round(float(val), 6)
    return grid
```

**How to mirror for daily:**
```python
def _daily_returns_grid_from_series(returns: pd.Series) -> list[dict[str, Any]]:
    """Flat per-day return list. Sibling-table kind = 'daily_returns_grid'.

    Output shape: [{date: 'YYYY-MM-DD', value: float}, …]
    Heat-map renderer (Phase 14b) reshapes into 12-month × N-year grid client-side.
    """
    return [
        {"date": d.strftime("%Y-%m-%d"), "value": round(float(v), 6)}
        for d, v in returns.items()
    ]
```

**Why a flat list, not a 2D grid:** the sibling table stores one JSONB payload per kind. A flat list serializes smaller (no repeated month-name strings), parses faster, and matches the per-date shape of every other series kind (`exposure_series`, `turnover_series`, `rolling_*`). Phase 14b's `<DailyHeatmap>` component pivots client-side. Planner decides — D-04 doesn't lock the on-wire shape, just the storage location.

### 5c. Pattern: Additive upsert (`analytics_runner.py:189-211`) — template for METRICS-15

```python
        # Compute all metrics
        metrics = compute_all_metrics(returns, benchmark_rets)

        # Build data quality flags
        data_quality_flags: dict | None = None
        if benchmark_stale or benchmark_rets is None:
            data_quality_flags = {
                "benchmark_unavailable": True,
                "benchmark_note": "Benchmark data unavailable. Alpha, beta, and correlation not computed.",
            }

        # Store results
        await db_execute(
            lambda: supabase.table("strategy_analytics").upsert(
                {
                    "strategy_id": strategy_id,
                    "computation_status": "complete",
                    "computation_error": None,
                    "data_quality_flags": data_quality_flags,
                    **metrics,
                },
                on_conflict="strategy_id",
            ).execute()
        )
```

**How to mirror for sibling-table writes** (Wave E task 15):
```python
        # Phase 12: compute_all_metrics now returns a tuple
        metrics, sibling_kinds = compute_all_metrics(returns, benchmark_rets)

        # ... existing strategy_analytics upsert (unchanged shape with `**metrics`) ...

        # Phase 12: sibling-table loop upsert — one row per kind
        for kind, payload in sibling_kinds.items():
            await db_execute(
                lambda k=kind, p=payload: supabase.table("strategy_analytics_series").upsert(
                    {
                        "strategy_id": strategy_id,
                        "kind": k,
                        "payload": p,
                        "computed_at": "now()",  # supabase-py renders this as a server-side now()
                    },
                    on_conflict="strategy_id,kind",
                ).execute()
            )
```

**Why a per-kind loop, not one batch:** each `(strategy_id, kind)` row has a different on_conflict surface; supabase-py's bulk upsert collapses on a shared conflict target. The loop is cheap (~12 round-trips per strategy, ~240 round-trips for full backfill of 20 strategies) and lets the throttle slow-path back-pressure naturally. Planner can promote to a single `INSERT … VALUES (…), (…), …` if the round-trip cost shows up in the p95 budget; for ~12 kinds it won't.

### 5d. Pattern: Queue dispatch (`job_worker.py:1446-1500`) — template for METRICS-14 throttle hook

```python
async def dispatch(job: dict) -> DispatchResult:
    """Route a claimed job to its per-kind handler, wrap in timeout, classify."""
    kind = job.get("kind")
    timeout = TIMEOUT_PER_KIND.get(kind, 5 * 60)

    if kind == "sync_trades":
        handler = run_sync_trades_job
    elif kind == "compute_analytics":
        handler = run_compute_analytics_job
    elif kind == "compute_portfolio":
        handler = run_compute_portfolio_job
    # ... 8 more handlers ...
    else:
        handler = None

    try:
        if handler is None:
            result = DispatchResult(
                outcome=DispatchOutcome.FAILED,
                error_message=f"Unknown job kind: {kind!r}",
                error_kind="permanent",
            )
        else:
            result = await asyncio.wait_for(handler(job), timeout=timeout)
    except Exception as exc:
        error_kind, sanitized = classify_exception(exc)
        result = DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_message=sanitized,
            error_kind=error_kind,
        )

    # ... UI status bridge call ...
    return result
```

**Important:** the throttle does NOT live in `dispatch()` — by the time `dispatch()` runs, the job is already claimed. The throttle must live in the **claim path** (`main_worker.py:88-116` `dispatch_tick()`). Two implementation choices per Wave F:

**Option (a) — DB-side priority claim (recommended):**
```sql
-- New RPC in 086_compute_jobs_priority.sql
CREATE OR REPLACE FUNCTION claim_compute_jobs_with_priority(
    p_batch_size INTEGER, p_worker_id TEXT
) RETURNS SETOF compute_jobs AS $$
    -- 1. If any 'normal'/'high' priority job is pending, claim ONLY those.
    -- 2. Otherwise, free-for-all (claim 'low' too).
    -- Uses SELECT FOR UPDATE SKIP LOCKED like the existing claim_compute_jobs.
$$;
```

**Option (b) — Python-side guard:**
```python
async def dispatch_tick(worker_id: str) -> None:
    supabase = get_supabase()

    # NEW: pre-check if any high-priority work is queued
    def _check_priority():
        return supabase.table("compute_jobs") \
            .select("id", count="exact") \
            .in_("priority", ["normal", "high"]) \
            .eq("status", "pending") \
            .execute()

    high_priority_count = (await db_execute(_check_priority)).count or 0

    if high_priority_count > 0:
        # Claim only normal/high — backfill (low) waits
        # (requires a new RPC variant, OR client-side filter post-claim then release)
        ...
    else:
        # Existing path — claim any 5
        ...
```

**Option (a) is cleaner** because the SKIP LOCKED semantics stay atomic. Planner picks; both achieve D-06. The 5/min cap on backfill is enforced by Wave G load-test, not by an explicit rate-limiter in code — at a `low`-priority claim batch of 5 jobs/tick × 12 ticks/min = 60 jobs/min worst case, 5/min is the floor when `normal`/`high` is queued.

## 6. Migration Deliverables

### 6a. `supabase/migrations/086_compute_jobs_priority.sql` (METRICS-16)

**Concrete skeleton** (planner expands; pattern follows `032_compute_jobs_queue.sql` self-verifying DO style):

```sql
-- Migration 086: compute_jobs.priority enum + partial index
-- Phase 12 / METRICS-16: priority-aware queue dispatch for backfill throttle
--
-- Why this migration exists
-- -------------------------
-- Phase 12 backfills `compute_analytics` for every published strategy on
-- deploy (~20 enqueues). Without priority awareness, live `sync_trades`
-- queues behind these, producing visible staleness for active allocators.
-- This migration adds a `priority` enum (low/normal/high) so the worker's
-- claim path can prefer 'normal' (sync_trades) and 'high' (manual force-
-- recompute) over 'low' (backfill).

BEGIN;

ALTER TABLE compute_jobs
  ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high'));

COMMENT ON COLUMN compute_jobs.priority IS
  'Dispatch priority. low = post-deploy backfill (throttled to 5/min when normal/high are pending). normal = live sync_trades + first-class compute_analytics. high = manual force-recompute. Read by claim_compute_jobs_with_priority(). See migration 086.';

-- Partial index: live (normal/high) jobs claim path. Skipping low rows
-- means SKIP LOCKED scans far fewer rows during throttled windows.
CREATE INDEX IF NOT EXISTS idx_compute_jobs_priority_pending
  ON compute_jobs (priority, next_attempt_at)
  WHERE priority IN ('normal','high') AND status = 'pending';

-- New claim RPC: prefers normal/high; falls back to low only when no
-- higher-priority work is pending. Mirrors claim_compute_jobs structure.
CREATE OR REPLACE FUNCTION claim_compute_jobs_with_priority(
    p_batch_size INTEGER, p_worker_id TEXT
) RETURNS SETOF compute_jobs
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_high_pending INTEGER;
BEGIN
    -- Validation matching claim_compute_jobs (032:541-558)
    IF p_batch_size IS NULL OR p_batch_size <= 0 OR p_batch_size > 1000 THEN
        RAISE EXCEPTION 'claim_compute_jobs_with_priority: invalid batch_size %', p_batch_size;
    END IF;

    -- Are any normal/high jobs pending?
    SELECT count(*) INTO v_high_pending
      FROM compute_jobs
     WHERE priority IN ('normal','high') AND status = 'pending'
       AND next_attempt_at <= now();

    RETURN QUERY
    UPDATE compute_jobs
       SET status = 'running', claimed_at = now(),
           claimed_by = p_worker_id, attempts = attempts + 1
     WHERE id IN (
       SELECT id FROM compute_jobs
        WHERE status = 'pending' AND next_attempt_at <= now()
          -- Throttle: if any normal/high pending, exclude low this tick
          AND (v_high_pending = 0 OR priority IN ('normal','high'))
        ORDER BY
          CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
          next_attempt_at
        LIMIT p_batch_size
        FOR UPDATE SKIP LOCKED
     )
     RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION claim_compute_jobs_with_priority FROM PUBLIC, anon, authenticated;

-- Self-verifying DO block (full version in planner; sketch here)
DO $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM information_schema.columns
    WHERE table_name = 'compute_jobs' AND column_name = 'priority') THEN
    RAISE EXCEPTION 'Migration 086: priority column missing';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE relname = 'idx_compute_jobs_priority_pending') THEN
    RAISE EXCEPTION 'Migration 086: partial index missing';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'claim_compute_jobs_with_priority') THEN
    RAISE EXCEPTION 'Migration 086: claim_compute_jobs_with_priority RPC missing';
  END IF;
  RAISE NOTICE 'Migration 086: priority enum + partial index + claim RPC installed.';
END $$;

COMMIT;
```

**Note on numbering collision:** Codebase has shipped `084_first_api_key_added_trigger.sql` and `085_stamp_first_bridge_surfaced.sql` already (verified via `ls supabase/migrations/`). **Phase 12 must use `086_compute_jobs_priority.sql` and `087_strategy_analytics_series.sql`**, OR rename per a renumbering policy. CONTEXT.md and ROADMAP.md both call it 084/085 — this is a planning-doc artifact. **Resolve before plan-phase locks numbering.** See Risk Register §9.1.

### 6b. `supabase/migrations/087_strategy_analytics_series.sql` (METRICS-17)

```sql
-- Migration 087: strategy_analytics_series sibling table + fetch_strategy_lazy_metrics RPC
-- Phase 12 / METRICS-17: heavy-series storage to avoid 1MB JSONB TOAST ceiling.

BEGIN;

CREATE TABLE IF NOT EXISTS strategy_analytics_series (
    strategy_id  UUID NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
    kind         TEXT NOT NULL,
    payload      JSONB NOT NULL,
    computed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (strategy_id, kind)
);

COMMENT ON TABLE strategy_analytics_series IS
  'Sibling table to strategy_analytics for heavy time-series payloads. One row per (strategy_id, kind). Kinds: daily_returns_grid, rolling_sortino_3m/6m/12m, rolling_volatility_3m/6m/12m, rolling_alpha, rolling_beta, exposure_series, turnover_series, log_returns_series. Avoids the 1MB TOAST decompression ceiling on strategy_analytics.metrics_json. See migration 087.';

CREATE INDEX IF NOT EXISTS idx_strategy_analytics_series_payload_present
  ON strategy_analytics_series (strategy_id, kind)
  WHERE payload IS NOT NULL;

-- RLS: deny-all for non-service-role. allocator-side reads go through the
-- fetch_strategy_lazy_metrics SECURITY DEFINER RPC below (which joins
-- strategies for visibility). Mirrors compute_jobs_deny_all (032:233-237).
ALTER TABLE strategy_analytics_series ENABLE ROW LEVEL SECURITY;
CREATE POLICY strategy_analytics_series_deny_all ON strategy_analytics_series
    FOR ALL USING (false) WITH CHECK (false);

-- D-04: lazy-fetch RPC. Returns {kind: payload} for the requested panel.
CREATE OR REPLACE FUNCTION fetch_strategy_lazy_metrics(
    p_strategy_id UUID, p_panel_id TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
    v_kinds TEXT[];
    v_visible BOOLEAN;
BEGIN
    -- Visibility check: does the calling user have access to this strategy?
    -- Mirrors getStrategyDetail / getPublicStrategyDetail visibility:
    --   published strategies visible to all; private strategies to owner.
    SELECT EXISTS(
        SELECT 1 FROM strategies
         WHERE id = p_strategy_id
           AND (status = 'published' OR user_id = auth.uid())
    ) INTO v_visible;

    IF NOT v_visible THEN
        RETURN jsonb_build_object();
    END IF;

    -- Map panel_id → applicable kinds (D-04 panel mapping)
    v_kinds := CASE p_panel_id
        WHEN 'overview' THEN ARRAY[]::TEXT[]
        WHEN 'equity' THEN ARRAY['equity_series_1y', 'log_returns_series']
        WHEN 'drawdown' THEN ARRAY[]::TEXT[]
        WHEN 'returns_dist' THEN ARRAY['daily_returns_grid']
        WHEN 'rolling' THEN ARRAY[
            'rolling_sortino_3m', 'rolling_sortino_6m', 'rolling_sortino_12m',
            'rolling_volatility_3m', 'rolling_volatility_6m', 'rolling_volatility_12m',
            'rolling_alpha', 'rolling_beta'
        ]
        WHEN 'trades' THEN ARRAY[]::TEXT[]
        WHEN 'exposure' THEN ARRAY['exposure_series', 'turnover_series']
        ELSE ARRAY[]::TEXT[]
    END;

    -- Return {kind: payload} object via aggregation
    RETURN COALESCE((
        SELECT jsonb_object_agg(kind, payload)
          FROM strategy_analytics_series
         WHERE strategy_id = p_strategy_id
           AND kind = ANY(v_kinds)
    ), jsonb_build_object());
END;
$$;

GRANT EXECUTE ON FUNCTION fetch_strategy_lazy_metrics TO authenticated, anon;

-- Self-verifying DO block (sketch)
DO $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM information_schema.tables
    WHERE table_name = 'strategy_analytics_series') THEN
    RAISE EXCEPTION 'Migration 087: strategy_analytics_series table missing';
  END IF;
  -- ... etc per 032 verification style ...
  RAISE NOTICE 'Migration 087: strategy_analytics_series + fetch_strategy_lazy_metrics RPC installed.';
END $$;

COMMIT;
```

## 7. Cross-Runtime Parity Test Scaffolding

### 7a. Existing test infrastructure (verified)

- **Python:** pytest configured at `analytics-service/pytest.ini` (`asyncio_mode = auto`, `testpaths = tests`). 41 existing test files including `test_metrics.py` (per-metric units), `test_position_reconstruction.py`, `test_analytics_runner.py`, `test_job_worker.py`. Conftest at `tests/conftest.py:1-83` ships seven shared fixtures (`golden_returns`, `zero_vol_returns`, `single_trade_returns`, `empty_returns`, `benchmark_returns`, `sample_trades`, more) — each is a `pd.Series` or `list[dict]` constructed with `np.random.seed(...)`.
- **Existing committed-fixture pattern:** `analytics-service/tests/fixtures/{feedback_engine_v1_*_golden.json, match_engine_v2_golden.json}` — JSON-only, hand-curated expected outputs for golden tests. **No parquet committed today.**
- **TS:** Vitest configured at `vitest.config.ts` (jsdom env, `src/test-setup.ts`). Cross-module integration tests live at `src/__tests__/` (canonical examples: `audit-coverage.test.ts`, `rbac-matrix.test.ts`).
- **No precedent for parquet readers on the TS side.** This is the load-bearing open question (see Risk Register §9.2).

### 7b. Recommended folder structure

```
analytics-service/tests/
├── conftest.py                          [EXTEND: add golden_252d_input/expected loaders]
├── test_metrics_parity.py               [NEW: METRICS-13 Python side]
├── test_metrics.py                      [EXTEND: per-metric unit tests for new helpers]
└── fixtures/
    ├── regen_golden.py                  [NEW: deterministic seed=42 generator]
    ├── golden_252d_input.parquet        [NEW: D-10 input — committed binary]
    ├── golden_252d_input.json           [NEW: D-10 input — JSON companion for TS-side]
    └── golden_252d_expected.json        [NEW: D-10 expected output — committed]

src/
├── __tests__/
│   └── metrics-parity.test.ts           [NEW: TS-side parity assertion]
└── lib/
    └── metrics-parity-helper.ts         [NEW: assertMetricParity(actual, expected) helper]
```

### 7c. Fixture regeneration script outline (`regen_golden.py`)

```python
"""Regenerate golden_252d_*.{parquet,json} fixtures.

Run via: `python -m tests.fixtures.regen_golden` (per CONTEXT.md D-10).

Invariants (D-09):
- np.random.seed(42)
- 252 trading days
- ~5% annualized volatility
- ~0.4 Sharpe
- ~10% max drawdown
- ~250 trades
- ~50 closed positions

Bytes-stable across env changes — runs entirely in NumPy/pandas/quantstats.
"""
from __future__ import annotations
import json
import numpy as np
import pandas as pd
from pathlib import Path
from services.metrics import compute_all_metrics

FIXTURES_DIR = Path(__file__).parent

def _build_input() -> dict:
    np.random.seed(42)
    n_days = 252
    dates = pd.bdate_range("2025-01-01", periods=n_days)
    # Calibrated random walk (~0.4 Sharpe, ~5% vol, ~10% max DD)
    base = np.random.normal(0.0008, 0.013, n_days)
    # Inject a controlled drawdown around day 120
    base[120:140] = np.random.normal(-0.005, 0.015, 20)

    returns = pd.Series(base, index=dates, name="returns")
    benchmark = pd.Series(np.random.normal(0.0003, 0.025, n_days), index=dates, name="BTC")

    # Synthetic fills + positions per D-09 calibration
    # ... (planner expands)
    return {"returns": returns, "benchmark": benchmark, "fills": [...], "positions": [...]}

def main() -> None:
    inp = _build_input()
    # Write input parquet (returns + benchmark only; fills/positions in separate parquet)
    pd.DataFrame({"returns": inp["returns"], "benchmark": inp["benchmark"]}).to_parquet(
        FIXTURES_DIR / "golden_252d_input.parquet"
    )
    # JSON companion for TS-side consumption
    (FIXTURES_DIR / "golden_252d_input.json").write_text(json.dumps({
        "returns": [{"date": d.strftime("%Y-%m-%d"), "value": float(v)} for d, v in inp["returns"].items()],
        "benchmark": [{"date": d.strftime("%Y-%m-%d"), "value": float(v)} for d, v in inp["benchmark"].items()],
        # ... fills, positions
    }, indent=2))

    # Compute expected output via the actual metrics path
    metrics, sibling_kinds = compute_all_metrics(inp["returns"], inp["benchmark"])
    expected = {"metrics_json": metrics, "sibling": sibling_kinds}
    (FIXTURES_DIR / "golden_252d_expected.json").write_text(json.dumps(expected, indent=2, sort_keys=True))

if __name__ == "__main__":
    main()
```

### 7d. Helper signatures

**Python (`tests/test_metrics_parity.py`):**
```python
def assertMetricParity(actual: dict, expected: dict) -> None:
    """D-11 hybrid tolerance enforcement.

    - Scalar keys (bool/int/float top-level) → byte-identical after rounding to 12 sig digits
    - Array values (rolling series, grids) → element-wise 1e-9 relative epsilon
    - NaN==NaN, +0==-0
    - Missing key in `actual` that's present in `expected` → fail
    - Extra key in `actual` not in `expected` → fail (D-12: forces fixture regen on every metric add)
    """
    ...
```

**TS (`src/lib/metrics-parity-helper.ts`):**
```typescript
export function assertMetricParity(
  actual: Record<string, unknown>,
  expected: Record<string, unknown>,
): void {
  // Same D-11 / D-12 contract as Python helper.
  // Scope question (Risk §9.3): does TS recompute the metrics, or only assert
  // the JSON contract is stable?
}
```

### 7e. Sampling rate (per Validation Architecture)

- **Per task commit:** `pytest analytics-service/tests/test_metrics_parity.py -x` (~5s)
- **Per wave merge:** Full Python suite (`pytest analytics-service/tests/ --cov-fail-under=80`) + Vitest TS suite (`npm test -- src/__tests__/metrics-parity.test.ts`)
- **Phase gate:** Both green; fixture has been regenerated (`python -m tests.fixtures.regen_golden`); diff vs prior fixture is the documented set of new keys.

## 8. Validation Architecture

### Test Framework

| Property | Python side | TS side |
|----------|------------|---------|
| Framework | pytest 7+ (`asyncio_mode = auto`) | Vitest `^4.1.2` |
| Config file | `analytics-service/pytest.ini` | `vitest.config.ts` |
| Quick run command | `pytest analytics-service/tests/test_metrics_parity.py -x` | `npm test -- src/__tests__/metrics-parity.test.ts` |
| Full suite command | `pytest analytics-service/tests/ --cov-fail-under=80` | `npm test` (full) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| METRICS-01 | Rolling Sortino series at 63/126/252 windows; MAR=0 consistent across windows | unit | `pytest analytics-service/tests/test_metrics.py::test_rolling_sortino_series -x` | ❌ Wave A0 |
| METRICS-02 | Rolling Volatility series at 3 windows; annualized via `× sqrt(252)` | unit | `pytest analytics-service/tests/test_metrics.py::test_rolling_volatility_series -x` | ❌ Wave A0 |
| METRICS-03 | Rolling alpha + beta series via `qs.stats.rolling_greeks` | unit | `pytest analytics-service/tests/test_metrics.py::test_rolling_greeks_series -x` | ❌ Wave A0 |
| METRICS-04 | `daily_returns_grid` written to sibling table on `compute_all_metrics()` | unit + integration | `pytest analytics-service/tests/test_analytics_runner.py::test_daily_grid_persisted -x` | ❌ Wave A0 |
| METRICS-05 | `compute_exposure_metrics` persists per-date series alongside aggregates | unit | `pytest analytics-service/tests/test_position_reconstruction.py::test_exposure_series_persisted -x` | ❌ Wave A0 |
| METRICS-06 | `turnover_series` matches `abs(Δposition × price) / NAV` per docstring contract | unit + parity | `pytest analytics-service/tests/test_metrics.py::test_turnover_series_contract -x` | ❌ Wave A0 |
| METRICS-07 | 5 derived trade metrics (Expectancy/R:R/SQN/PF L/PF S) computed from existing aggregates | unit | `pytest analytics-service/tests/test_analytics_runner.py::test_derived_trade_metrics -x` | ❌ Wave A0 |
| METRICS-08 | SQN = `(mean(R)/std(R)) × sqrt(min(N,100))` over per-trade R-multiples | unit | `pytest analytics-service/tests/test_analytics_runner.py::test_sqn -x` | ❌ Wave A0 |
| METRICS-09 | Volume aggregator: gross volume, mean trade size, daily/monthly turnover | unit | `pytest analytics-service/tests/test_analytics_runner.py::test_volume_aggregator -x` | ❌ Wave A0 |
| METRICS-10 | Trade Mix maker/taker buckets (audit-gated; descope path equally tested) | integration | `pytest analytics-service/tests/test_analytics_runner.py::test_trade_mix -x` | ❌ Wave A0 (skip if descoped) |
| METRICS-11 | 10 new scalars present in `metrics_json` on golden fixture | unit + parity | `pytest analytics-service/tests/test_metrics_parity.py::test_new_scalars -x` | ❌ Wave A0 |
| METRICS-12 | `log_returns_series` matches `np.log1p(returns)` shape | unit | `pytest analytics-service/tests/test_metrics.py::test_log_returns -x` | ❌ Wave A0 |
| METRICS-13 | Cross-runtime parity: golden 252d expected JSON byte-identical (scalars) + 1e-9 (series) | parity | `pytest analytics-service/tests/test_metrics_parity.py -x && npm test -- src/__tests__/metrics-parity.test.ts` | ❌ Wave A0 (RED first) |
| METRICS-14 | Throttle keeps `compute_analytics` queue depth ≤ 50 for >10min during rollout; backfill ≤ 5/min when normal/high pending | integration + load | `pytest analytics-service/tests/test_job_worker.py::test_priority_throttle -x` + manual queue-depth probe during deploy | ❌ Wave A0 |
| METRICS-15 | `getStrategyDetail()` path-extraction p95 < 50ms (above-the-fold scalars); RPC p95 < 200ms (panels 4–7) | latency probe | `npm test -- src/__tests__/metrics-parity.test.ts` (latency assertions) + manual prod probe | ❌ Wave A0 |
| METRICS-16 | Migration 086 applies; `compute_jobs.priority` exists with CHECK; partial index present; `claim_compute_jobs_with_priority` RPC SECURITY DEFINER | migration | `psql -f supabase/migrations/086_*.sql` + DO-block self-verify | ❌ Wave A0 |
| METRICS-17 | Migration 087 applies; `strategy_analytics_series` table + RLS deny-all + `fetch_strategy_lazy_metrics` RPC; `pg_column_size` p99.9 probe < 800kB post-backfill | migration + size assertion | `psql -f supabase/migrations/087_*.sql` + `psql -f analytics-service/scripts/analyze_metrics_size.sql` | ❌ Wave A0 |

### Sampling Rate

- **Per task commit:** Quick test for the modified component (e.g., adding `_rolling_sortino` runs only `test_metrics.py::test_rolling_sortino_series`).
- **Per wave merge:** Full Python pytest suite (`pytest --cov-fail-under=80`) + targeted Vitest (`npm test -- src/__tests__/metrics-parity.test.ts`).
- **Phase gate before `/gsd-verify-work`:**
  1. Both parity tests green.
  2. Migrations 084 + 085 self-verifying DO blocks pass apply.
  3. Post-deploy `analyze_metrics_size.sql` returns p99.9 < 800kB.
  4. Manual queue-depth probe during deploy window: `compute_analytics` depth ≤ 50 for >10min.
  5. `is_maker` audit SQL outcome documented in TODOS.md (D-15).
  6. `pytest --cov-fail-under=80` passes (existing CI gate).

### Wave 0 Gaps

- [ ] `analytics-service/tests/fixtures/regen_golden.py` — deterministic generator script (D-10)
- [ ] `analytics-service/tests/fixtures/golden_252d_input.parquet` — committed binary fixture
- [ ] `analytics-service/tests/fixtures/golden_252d_input.json` — JSON companion for TS-side
- [ ] `analytics-service/tests/fixtures/golden_252d_expected.json` — committed expected output
- [ ] `analytics-service/tests/test_metrics_parity.py` — Python parity assertion (RED first)
- [ ] `src/__tests__/metrics-parity.test.ts` — TS parity assertion (RED first; scope clarification needed)
- [ ] `src/lib/metrics-parity-helper.ts` — `assertMetricParity()` shared helper
- [ ] `analytics-service/scripts/analyze_metrics_size.sql` — p99.9 probe SQL
- [ ] `analytics-service/scripts/phase12_kill_switch.py` — D-07 cutover script
- [ ] `analytics-service/scripts/phase12_backfill_enqueue.py` — D-08 enqueue-all script
- [ ] Pytest fixtures: `golden_252d_input` + `golden_252d_expected` loaders in `conftest.py`

*(All gaps are net-new for Phase 12. None block Wave A; all required by Wave G test landing.)*

## 9. Pitfall Mitigations (verbatim from PITFALLS.md)

### Pitfall #2: `metrics_json` JSONB row bloat (HIGH)

**Verbatim mitigation (PITFALLS.md:65-73):**
> - **Use Postgres JSON path-extraction in the strategy fetch:** instead of `select metrics_json from strategy_analytics where id=$1`, use `select metrics_json -> 'rolling_sortino_3m' as rolling_sortino_3m, metrics_json -> 'daily_returns_grid' as daily_returns_grid, ...`. Postgres returns only the path-projected slice.
> - **Or split heavy series to a sibling table:** `strategy_analytics_series (strategy_id, kind, payload jsonb)` keyed by `(strategy_id, kind)` with `kind IN ('daily_grid','rolling_sortino_3m',...)`. Panels can then fetch lazy on-tab-switch instead of all-at-once.
> - Decision: panel-1 + panel-2 + panel-3 fetch eager (above-the-fold); panel-4..panel-7 lazy on scroll/tab.
> - **Detection:** Add `pg_column_size(metrics_json)` to a vitest live-DB probe; warn if > 800kB; fail if > 1.5MB.

**Maps to plan tasks:**
- Wave A task 3 (migration 085 sibling table) — implements the second bullet.
- Wave F task 19 (`analyze_metrics_size.sql` + kill-switch) — implements the detection bullet.
- Wave E tasks 14-17 (sibling-table writes + `fetch_strategy_lazy_metrics` RPC) — implements the lazy-fetch boundary.

### Pitfall #3: Backfill saturation on T8a deploy (HIGH)

**Verbatim mitigation (PITFALLS.md:128-133):**
> - **Throttled backfill:** enqueue at most 5 `compute_analytics` jobs per minute, prioritize live sync (e.g., add a `priority` enum on `compute_jobs`, default backfill to `low`, sync to `normal`).
> - **Lazy-on-first-view alternative:** add a `metrics_json_version INT DEFAULT 1` column on `strategy_analytics`; the v0.17 page check fetches metrics_json + version; if version < 2, kick off a recompute job in the background and render the panels with "computing… ETA 2 minutes" placeholders. New strategies are computed at the new version automatically. Existing strategies migrate on first view, not on deploy.
> - **Pick one path** before the milestone closes; document in TODOS.md.

**Maps to plan tasks (D-05/D-06/D-08 chose throttled-eager):**
- Wave A task 2 (migration 084 priority enum) — first bullet, schema half.
- Wave F task 18 (throttle guard in dispatch path) — first bullet, code half.
- Wave F task 20 (eager backfill enqueue script) — D-08 explicitly rejects lazy-on-view.
- "Pick one path": D-08 picked **throttled eager** (not lazy-on-view); document choice in PLAN.md and STATE.md, not TODOS.md.

### Pitfall #11: Sortino MAR floor convention drift (HIGH)

**Verbatim mitigation (PITFALLS.md:142-146):**
> - **Single source of truth in metrics.py:** define `MAR = 0.0` as a module constant; both `qs.stats.sortino(returns)` (which uses MAR=0 by default) AND a new `_rolling_sortino(returns, window, mar=MAR)` use the same value.
> - **Pytest cross-check:** `assert abs(metrics["sortino"] - rolling_sortino_3m[-1]) < 0.05` on a 90-day fixture (last rolling window converges to scalar over the full period when window == period).
> - Document the choice in `analytics-service/services/metrics.py` docstring.

**Maps to plan tasks:**
- Wave B task 4 (module-level `MAR = 0.0` constant) — first bullet.
- Wave B task 5 (`_rolling_sortino_series` mirrors pattern) — first bullet implementation.
- Wave G test cross-check at full-window (last bullet) — included in `test_metrics_parity.py`.
- Docstring on `MAR` constant referencing Pitfall #11 — second/third bullet.

### Pitfall #19: Turnover-series contract ambiguity (MEDIUM)

**Verbatim mitigation (PITFALLS.md:244-247):**
> - **Define the turnover-series contract explicitly:** "daily turnover ratio = trade_volume_usd_today / nav_today, with optional smoothing via rolling 7-day mean." Document in metrics.py docstring.
> - Add a Vitest equivalent (cross-runtime parity check per plan T8a) that confirms Python and TS implementations produce identical series on the same fixture.

**Maps to plan tasks:**
- Wave C task 11 (`compute_turnover_series` with explicit docstring) — first bullet.
- Wave G task 23 (TS-side parity assertion includes `turnover_series` per D-12) — second bullet.

### Pitfall #22: Vercel function bundle limit (LOW; cited in CONTEXT for awareness)

**Verbatim mitigation (PITFALLS.md:273):**
> Use `dynamic()` imports for panels 4–7 (per Pitfall 6's lazy-mount strategy). The dynamic import naturally creates a lazy chunk, keeping the page bundle small.

**Maps to plan tasks:** N/A for Phase 12 — this is a Phase 14 concern. Phase 12 ships the RPC contract; Phase 14a/14b consumes it via `dynamic()` imports.

**Note:** The phase-context file mentions Pitfall #22 in passing but PITFALLS.md actually lists "Vercel function bundle limit" as item #22 and "Cross-runtime drift" is not numbered — that's the broader METRICS-13 parity concern. The cross-runtime drift mitigation IS the parity test pair (Wave G).

## 9. Risk Register

### 9.1 Migration numbering collision (HIGH — must resolve before plan-phase locks)

**Issue:** Codebase has shipped `084_first_api_key_added_trigger.sql` and `085_stamp_first_bridge_surfaced.sql` (verified via `ls supabase/migrations/`). CONTEXT.md, ROADMAP.md, REQUIREMENTS.md, and STATE.md all refer to Phase 12's migrations as `086_compute_jobs_priority.sql` and `087_strategy_analytics_series.sql`.

**Impact:** Cannot apply the planned migrations as-numbered without a rename. Either every reference doc gets updated to 086/087 OR the existing 084/085 get renumbered (high blast radius, breaks deploy history).

**Resolution required:** Plan-phase task 0 should renumber Phase 12 migrations to **086_compute_jobs_priority.sql + 087_strategy_analytics_series.sql** and update all references in CONTEXT.md, REQUIREMENTS.md, ROADMAP.md, STATE.md, and inline plan tasks. Recommend NOT renumbering the already-shipped 084/085 (would invalidate audit trail).

### 9.2 Parquet on the TS side (HIGH — affects Wave G scope)

**Issue:** D-10 specifies parquet for the input fixture but no precedent exists for parquet readers in the TS test layer. `package.json` has neither `parquetjs` nor `apache-arrow`.

**Impact:** TS-side parity test cannot read the parquet input directly. Three resolution paths:
1. Ship `golden_252d_input.json` companion alongside the parquet (both committed; Python uses parquet, TS uses JSON). This is the recommended path — adds ~40KB to the repo for fidelity insurance.
2. Add `parquetjs` (or `apache-arrow`) as a devDep. Banned-package gate doesn't list these — should be safe, but adds ~500KB to dev install.
3. Skip the parquet altogether and use JSON for both runtimes. Simplest; loses the size/precision benefits of parquet.

**Recommendation: path (1).** Planner decides; impacts Task 21 scope.

### 9.3 TS-side parity test scope (HIGH — affects METRICS-13 done-ness)

**Issue:** D-12 says "ALL metrics — every key emitted by `compute_all_metrics()`." Two readings:

**Reading A (consumer-side schema gate):** TS test reads `golden_252d_expected.json`, asserts every key matches the typed `StrategyAnalytics` interface in `src/lib/types.ts`. Catches schema drift. Fast; doesn't require recomputing metrics in TS.

**Reading B (cross-runtime math gate):** TS test reads `golden_252d_input.{parquet,json}`, recomputes the metrics in TypeScript, diff vs `golden_252d_expected.json` with D-11 tolerance. Catches actual math drift. Requires a TS implementation of `compute_all_metrics()` — which DOESN'T EXIST and isn't in scope per D-01 (single source of truth = Python).

**Resolution:** Reading A is correct under D-01 (Python is the single math source; TS only consumes). The TS-side test is a JSON-shape gate, not a math gate. Phrase the parity contract as: "Python ↔ JSON contract is byte-stable (Python recomputes from input; TS verifies the JSON conforms to the typed contract and matches stored expected JSON)." Planner should document this explicitly in the test file.

### 9.4 Throttle implementation choice (MEDIUM — affects task count)

**Issue:** Wave F task 18 has two implementation options ((a) DB-side priority claim RPC; (b) Python-side guard). Option (a) is cleaner but requires extending migration 084 with a new RPC; option (b) keeps migration 084 minimal but adds Python complexity in the claim path.

**Recommendation:** Option (a). Rationale: SKIP LOCKED semantics stay atomic; one RPC call instead of two; existing `claim_compute_jobs` becomes the legacy path that callers can migrate off when ready.

### 9.5 `compute_jobs.priority` default for legacy rows (MEDIUM)

**Issue:** Migration 086 adds `priority TEXT NOT NULL DEFAULT 'normal'`. Existing rows (if any pending at deploy time) get `'normal'`. Backfill script (`phase12_backfill_enqueue.py`) explicitly enqueues with `priority='low'`. This is correct but worth checking: are any pending `compute_analytics` jobs at deploy time *backfill* jobs or *user-initiated*? If indistinguishable, treating them as `normal` is the safe default.

**Recommendation:** Run `SELECT count(*) FROM compute_jobs WHERE status IN ('pending','running')` immediately before deploy. If 0, no concern. If non-zero, pause sync_trades cron during the migration window (~5 min).

### 9.6 Sibling-table read path on Phase 14a (LOW — cross-phase dependency)

**Issue:** Phase 14a's eager panels (1-3) need `equity_series_1y` (above-the-fold per D-01). CONTEXT.md says it stays in `metrics_json` (light series), but if the 1y daily series exceeds ~30KB it pushes `metrics_json` toward the 800kB threshold faster.

**Recommendation:** Compute `equity_series_1y` as last-252-days from the full `returns_series` (which already lives in `strategy_analytics.returns_series`). Don't duplicate. Phase 12 simply adds path-extraction support; the storage column doesn't change.

### 9.7 `is_maker` audit timing (LOW — addressed by D-15)

**Issue:** Audit must happen on day 1 of plan-phase. If audit fails for any of three exchanges, Trade Mix descopes — but the parity expected JSON must reflect the descope (else CI fails on the missing 4-bucket keys).

**Recommendation:** `regen_golden.py` reads a config flag `TRADE_MIX_HAS_MAKER_TAKER` and emits the appropriate expected JSON shape. Both plan paths (full 4-bucket and 2-bucket fallback) tested in CI.

### 9.8 `compute_all_metrics()` tuple return shape — caller breakage (LOW)

**Issue:** Wave E task 14 changes the return type from `dict` to `tuple[dict, dict]`. Other callers may break. Verified callers: only `analytics_runner.run_strategy_analytics()` (line 189). Tests in `test_metrics.py` may also call directly.

**Recommendation:** Keep backward compat by returning a `MetricsResult` dataclass with `.metrics_json` and `.sibling_kinds` attributes (instead of a bare tuple). All callers updated atomically; the type change is opt-in via attribute access.

### 9.9 Kill-switch atomicity (LOW)

**Issue:** D-07 kill-switch UPDATE moves heavy keys from `metrics_json` to sibling table. If interrupted mid-strategy, some rows have keys in both places. Phase 14b consumers need to handle this gracefully.

**Recommendation:** Wrap the cutover in a single transaction per strategy (cursor-iterate, transaction-per-row). Slow but safe. Document in script comments.

### 9.10 Open question: Trade Mix `avg_holding_period_hours` derivation (LOW)

**Issue:** D-14 specifies the bucket shape includes `avg_holding_period_hours`. This requires fill-pair matching (entry → exit) on a per-side, per-maker-or-taker basis. `position_reconstruction.py` already does fill-pairing for the `trade_metrics.avg_duration_days` aggregate — extend that aggregator to emit per-bucket `avg_holding_period_hours = avg_duration_days × 24`.

**Recommendation:** Wave D task 12 adds the per-bucket aggregator. Confirm with planner that "holding period" = position open-to-close duration (not just entry-to-exit fill timestamp delta).

---

## RESEARCH COMPLETE
