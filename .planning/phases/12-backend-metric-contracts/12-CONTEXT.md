# Phase 12: Backend Metric Contracts - Context

**Gathered:** 2026-04-27
**Status:** Ready for planning

<domain>
## Phase Boundary

`metrics.py` produces every scalar and series the v0.17 7-panel UI needs — rolling
Sortino/Volatility/Greeks series (3M/6M/12M), daily-returns grid, exposure series,
turnover series, full trade-table aggregations (Expectancy / R:R / SQN / PF
long/short / Trade Mix), 10 missing qstats scalars (Recovery Factor, Ulcer Index,
UPI, Kelly Criterion, Probabilistic Sharpe, Common Sense Ratio, CPC Index, Serenity
Index, R² vs BTC, Time-in-Market), and a log-returns series — written into
already-declared `metrics_json` JSONB column for medium scalars + a new
`strategy_analytics_series` sibling table for heavy series, with cross-runtime
parity-tested correctness, throttled backfill via `compute_jobs.priority` enum
(migration 086), and JSONB row-size discipline (p99.9 < 800kB).

**Out of scope** (deferred to other phases or v0.17.1):
- UI rendering of any of these metrics (Phase 14a/14b)
- Discovery v2 polish (Phase 13)
- Multi-benchmark correlation (ETH/SOL) — Sprint 13+ (UC#6 descope)
- Trade Mix maker/taker dimension if `is_maker` audit < 99% on any of 3 exchanges
  (descoped to v0.17.1 with TODOS.md entry; long/short-only ships as fallback)
- New Python deps (`scipy`, `statsmodels`, `pyfolio`) — pure additive on existing
  pandas + quantstats + numpy

</domain>

<decisions>
## Implementation Decisions

### Area 1: JSONB Schema Split

- **D-01:** **Heavy series → `strategy_analytics_series` sibling table; light
  scalars + above-the-fold series → `metrics_json`.**
  - **Sibling kinds:** `daily_returns_grid`, `rolling_sortino_3m`,
    `rolling_sortino_6m`, `rolling_sortino_12m`, `rolling_volatility_3m`,
    `rolling_volatility_6m`, `rolling_volatility_12m`, `rolling_alpha`,
    `rolling_beta`, `exposure_series`, `turnover_series`, `log_returns_series`
    (any series ≥252 points or 2D grid).
  - **`metrics_json` keys:** the 10 new qstats scalars (Recovery Factor, Ulcer
    Index, UPI, Kelly, Probabilistic Sharpe, Common Sense Ratio, CPC Index,
    Serenity Index, R² vs BTC, Time-in-Market) + above-the-fold series
    (`equity_series_1y`, sparkline) + all existing qstats scalars.
  - Aligns with research Pitfall 2 mitigation (1MB TOAST risk on 5y strategies).

- **D-02:** **Sibling table schema** =
  `strategy_analytics_series (strategy_id UUID FK ON DELETE CASCADE, kind TEXT,
  payload JSONB, computed_at TIMESTAMPTZ, PRIMARY KEY (strategy_id, kind))`.
  Single JSONB `payload` column per `kind`. Mirrors additive pattern at
  `analytics-service/services/analytics_runner.py:189-275`.

- **D-03:** **`kind` field naming** = snake_case 1:1 with the metrics_json key
  name (e.g., `rolling_sortino_3m`, `daily_returns_grid`, `exposure_series`).
  Direct identifier mapping; no prefix.

- **D-04:** **Lazy-fetch RPC contract** =
  `fetch_strategy_lazy_metrics(strategy_id UUID, panel_id TEXT) RETURNS JSONB`.
  `panel_id` is enum string matching the 7 panels: `overview`, `equity`,
  `drawdown`, `returns_dist`, `rolling`, `trades`, `exposure`. RPC LATERAL joins
  the sibling table and returns `{kind: payload}` map for that panel. Caller
  (Phase 14b) stays UI-shape, not DB-shape — adding sibling kinds doesn't break
  the consumer.

### Area 2: Backfill Orchestration & Kill-Switch

- **D-05:** **Priority enum on `compute_jobs`** = `low` / `normal` / `high`.
  Backfill = `low`, `sync_trades` = `normal`, manual force-recompute = `high`.
  Migration `086_compute_jobs_priority.sql` adds the enum column +
  partial index `WHERE priority IN ('normal','high')` so live jobs jump the
  backfill queue.

- **D-06:** **Throttle policy** = global cap of 5 backfill jobs/min across all
  workers when ANY `normal`/`high` job is queued; unthrottled when queue is idle
  of higher priorities. Implemented as `SELECT … FOR UPDATE SKIP LOCKED` guard
  in `analytics-service/services/job_worker.py` enqueuer (around `job_worker.py:1434-1460`).

- **D-07:** **>800kB p99.9 kill-switch UX** = Phase 12 deploy script runs
  `analyze_metrics_size.sql` post-deploy; if p99.9 ≥ 800kB it auto-migrates
  remaining heavy keys (`daily_returns_grid`, `rolling_*`) from `metrics_json` to
  the sibling table via one-shot `UPDATE`. STATE.md log entry on trigger. Env
  override `SKIP_KILL_SWITCH=1` for staged rollout. Triggers atomically in same
  deploy script run as migrations 086/087.

- **D-08:** **Existing-strategy migration on Phase 12 deploy** = eager
  re-enqueue **all published strategies** (~20) as `priority=low` immediately on
  deploy. Throttle (D-06) caps at 5/min so `sync_trades` never queues behind.
  ETA dashboard probe in success criterion #4 covers this; no
  `metrics_json_version` column needed (rejected lazy-on-view by cross-AI review).

### Area 3: Cross-Runtime Parity Fixture

- **D-09:** **Fixture source** = synthetic, deterministic random walk seeded
  `seed=42`, 252 trading days, calibrated profile (5% annualized vol, ~0.4 Sharpe,
  ~10% max DD, ~250 trades, ~50 positions). Stored at
  `analytics-service/tests/fixtures/golden_252d.parquet`. Byte-stable across env
  changes; no PII concerns.

- **D-10:** **Fixture storage format** = input series (prices, fills, positions)
  → parquet at `analytics-service/tests/fixtures/golden_252d_input.parquet`.
  Expected output (full `metrics_json` + sibling-table payloads keyed by `kind`)
  → JSON at `analytics-service/tests/fixtures/golden_252d_expected.json`. Both
  committed; regenerated via `python -m tests.fixtures.regen_golden`.

- **D-11:** **Parity tolerance** = hybrid:
  - Scalar keys (Sharpe, Sortino, the 10 new) → byte-identical JSON after both
    sides round to 12 significant digits.
  - Series values (`rolling_*`, `daily_returns_grid`, `equity_series_1y`, etc.)
    → 1e-9 relative epsilon (NaN==NaN, +0==-0).
  - Single `assertMetricParity()` helper in both `test_metrics_parity.py` (Python)
    and `metrics-parity.test.ts` (TS) enforces both rules.

- **D-12:** **CI gate scope** = ALL metrics — every key emitted by
  `compute_all_metrics()` (both `metrics_json` and sibling-table kinds). Fail-loud
  on any new key not present in expected JSON (forces the fixture to be regenerated
  on every metric add). Single fixture → O(1) CI cost.

### Area 4: Trade-Table Aggregations & is_maker Descope

- **D-13:** **Five derived trade metrics** — Expectancy, Risk:Reward Ratio,
  SQN (System Quality Number), Profit Factor (long), Profit Factor (short), plus
  Trade Mix. All land in `trade_metrics` JSONB. Each is a 1-line derivation in
  `_compute_volume_metrics`. Full qstats parity per user direction.

- **D-14:** **Trade Mix breakdown shape** = 2×2 cross — long/short × maker/taker
  → 4 buckets. Each bucket shape =
  `{count: int, total_notional: float, avg_holding_period_hours: float}`.
  Nested as
  `trade_metrics.trade_mix.{long_maker, long_taker, short_maker, short_taker}`.

- **D-15:** **`is_maker` audit + descope mechanics** — Phase 12 plan-phase opens
  with explicit Task 1 = audit SQL:
  ```sql
  SELECT exchange,
         COUNT(*) FILTER (WHERE is_maker IS NOT NULL)::float / COUNT(*) AS coverage
  FROM raw_fills
  WHERE exchange IN ('binance', 'okx', 'bybit')
  GROUP BY exchange;
  ```
  - **All 3 exchanges ≥ 99% coverage** → ship METRICS-10 + KPI-17 with full
    maker/taker breakdown.
  - **ANY 1 of 3 exchanges < 99%** → descope maker/taker dimension to v0.17.1,
    log to TODOS.md, ship METRICS-10 with long/short-only (2 buckets:
    `trade_mix.long`, `trade_mix.short`), parity test does NOT regress (expected
    JSON has the 4-bucket keys absent when descoped).
  - Deribit explicitly excluded by design — `analytics-service/services/exchange.py:325-334`
    confirms `fetch_raw_trades` does not dispatch to Deribit. Document as N/A in
    TODOS.md before plan-phase begins.

- **D-16:** **Trade-table column contract for Phase 14b consumption** =
  `trade_metrics` JSONB has FROZEN top-level keys with matching TS type in
  `src/lib/types.ts`. Phase 14b reads via `Strategy.trade_metrics?.expectancy`,
  etc. Adding new keys mid-Phase-14b requires a Phase 12 amendment plan. Frozen
  keys: `expectancy`, `risk_reward_ratio`, `sqn`, `profit_factor_long`,
  `profit_factor_short`, `trade_mix.{4 buckets}`, plus existing `total_trades`,
  `win_rate`, `avg_winning_trade`, `avg_losing_trade`, `largest_winning_trade`,
  `largest_losing_trade`.

### Claude's Discretion

- Internal helper naming inside `metrics.py` (e.g., `_rolling_sortino` vs
  `_compute_rolling_sortino`) — mirror the closest existing convention at
  `metrics.py:374` (`_rolling_sharpe`).
- Pytest fixture organization (one `conftest.py` per metric family vs one global) —
  Claude picks based on readability.
- Specific implementation language for kill-switch UPDATE (single statement vs
  cursor over rows) — Claude picks based on lock duration vs simplicity.
- Choice of LATERAL vs subquery vs `jsonb_object_agg` for the
  `fetch_strategy_lazy_metrics` RPC body — performance test against p95 < 200ms
  budget will decide.
- Window-day exact counts (3M = 63 vs 90 calendar; 6M = 126 vs 180; 12M = 252
  vs 365) — match existing `_rolling_sharpe` pattern at `metrics.py:374` (trading
  days, not calendar).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Plan & Roadmap

- `.planning/ROADMAP.md` §"Phase 12: Backend Metric Contracts" — goal, 17
  requirements (METRICS-01..17), 5 success criteria, complexity rationale.
- `~/.claude/plans/strategy-teams-kpi-parity.md` §T8a (Backend Metric Contracts) +
  §"Implementation sequence" — master plan source, dual-voice reviewed
  (CEO/Design/Eng/DX), 8 user challenges resolved, cross-AI revised 2026-04-26
  with 6 convergent fixes applied.
- `.planning/STATE.md` §"Milestone Summary (v0.17.0.0)" — wave structure, hard
  audit gates (3 of them: `is_maker` audit, METRICS-16 priority enum precedence,
  METRICS-17 sibling-table precedence + kill-switch).

### Research

- `.planning/research/SUMMARY.md` — synthesized 4-researcher findings: backend
  gap is real (T8a), Discovery is 70% built (T7), 5 critical pitfalls.
- `.planning/research/STACK.md` — zero new deps; `recharts` + `lightweight-charts` +
  `quantstats@0.0.81` + `pandas@2.2.3` + `numpy@2.2.4` already pinned.
- `.planning/research/PITFALLS.md` — 23-item registry; CRITICAL/HIGH ones to
  internalize: WCAG axis contrast (#1), JSONB row bloat (#2), backfill saturation
  (#3), daily heatmap perf (#4), `organization_id` NULL universally (#5),
  Sortino MAR consistency (#11), turnover-series contract (#19).
- `.planning/research/ARCHITECTURE.md` — additive-on-existing-infra approach;
  no new compute paths, no new top-level columns.

### Codebase Maps

- `.planning/codebase/STACK.md` — Python analytics stack (pandas, quantstats,
  numpy) + Vercel/Next.js stack confirmation.
- `.planning/codebase/CONVENTIONS.md` — naming, error-handling, additive-upsert
  patterns followed by `analytics-service/services/*`.

### Source Files (heavily referenced by plan-phase)

- `analytics-service/services/metrics.py:374` — `_rolling_sharpe` pattern to
  mirror for new rolling series.
- `analytics-service/services/metrics.py:351` — `_monthly_returns_grid_from_series`
  pattern to mirror for `daily_returns_grid`.
- `analytics-service/services/position_reconstruction.py:435-495` — exposure
  per-date arrays already collected; refactor to persist alongside aggregates.
- `analytics-service/services/analytics_runner.py:189-275` — additive upsert
  pattern for `metrics_json` (template for sibling-table writes).
- `analytics-service/services/job_worker.py:1434-1460` — `compute_jobs` queue
  dispatch by `kind`; throttle guard inserts here.
- `analytics-service/services/exchange.py:325-334` — `fetch_raw_trades` dispatch;
  confirms Deribit excluded by design from `is_maker` audit.
- `src/lib/types.ts:52, 88-117` — `Strategy.is_example` + `StrategyAnalytics.daily_returns`
  declared (the JSONB column already exists; Phase 12 starts populating it).
- `src/components/charts/chart-tokens.ts` — `CHART_AXIS_TICK = "#64748B"` is the
  WCAG-safe axis tick color (NOT consumed by Phase 12 backend, but Phase 14a/b
  will and Phase 12 must not regress chart-token defaults).

### Migrations

- `supabase/migrations/001_initial_schema.sql:64,92` — `is_example` +
  `daily_returns JSONB` declared (do NOT re-add).
- `supabase/migrations/006_organizations.sql:30` — `strategies.organization_id` FK
  declared (Phase 13 audit, not Phase 12).
- `supabase/migrations/024_user_favorites.sql:29-105` — watchlist table
  (Phase 13 reference, not Phase 12).
- New migrations to ship in Phase 12: **`086_compute_jobs_priority.sql`** (METRICS-16,
  D-05) — adds `priority` enum column + partial index. **`087_strategy_analytics_series.sql`**
  (METRICS-17, D-02) — sibling table.

### Cross-Runtime Parity (Phase 12 deliverable)

- New file: `analytics-service/tests/test_metrics_parity.py` — Python side parity check.
- New file: `src/__tests__/metrics-parity.test.ts` — TypeScript side parity check.
- New fixture: `analytics-service/tests/fixtures/golden_252d_input.parquet` (D-10).
- New fixture: `analytics-service/tests/fixtures/golden_252d_expected.json` (D-10).

### Cross-AI Review Inputs

- Cross-AI review (fresh Claude subagent + Grok-4-1-fast-reasoning, 2026-04-26)
  → APPROVE-WITH-REVISIONS, 6 convergent fixes applied.
  - Phase 14 split into 14a + 14b
  - METRICS-16 (priority enum) promoted to hard Phase 12 deliverable
  - METRICS-17 (sibling table) promoted to hard Phase 12 deliverable
  - `is_maker` audit scope reduced from 4 → 3 exchanges (Deribit by design)
  - Success criteria tightened (automated p99.9 + p95 + queue depth checks)
  - `organizations.is_public` conditional gate added for Phase 13 DISCO-03

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`_rolling_sharpe` at `metrics.py:374`** — direct template for
  `_rolling_sortino_3m/6m/12m`, `_rolling_volatility_3m/6m/12m`, `_rolling_alpha`,
  `_rolling_beta`. Same window-iteration shape, same NaN-handling.
- **`_monthly_returns_grid_from_series` at `metrics.py:351`** — direct template
  for `_daily_returns_grid_from_series`. Same axis layout, same NaN cells.
- **`compute_exposure_metrics` at `position_reconstruction.py:435-495`** —
  already collects per-date exposure arrays; currently aggregates and discards.
  Refactor to persist series alongside aggregates.
- **Additive upsert pattern at `analytics_runner.py:189-275`** —
  `INSERT … ON CONFLICT … DO UPDATE SET metrics_json = metrics_json || EXCLUDED.metrics_json`.
  Mirror for sibling-table writes.
- **Queue dispatch at `job_worker.py:1434-1460`** — kind-routed `compute_jobs`
  consumer. Add throttle guard here.
- **`compute_all_metrics()` orchestrator** in `metrics.py` — single entry point;
  extend to call new helpers in deterministic order.

### Established Patterns

- **JSONB additive shape** — never overwrite the whole `metrics_json`; always
  merge via `metrics_json || EXCLUDED.metrics_json`. Verified at
  `analytics_runner.py:189-211`.
- **Module-level constants for math invariants** — Pitfall 11 calls for
  `MAR = 0.0` at module top of `metrics.py` to keep Sortino consistent across
  invocations and across runtimes.
- **Trading-day windows (not calendar)** — existing `_rolling_sharpe` uses 252
  trading days = 1y. Mirror this for new rolling series (3M = 63, 6M = 126,
  12M = 252).
- **`SELECT … FOR UPDATE SKIP LOCKED`** for queue dequeue — already used in
  `job_worker.py`; extend the guard to enforce throttle when higher-priority
  jobs are present.
- **Migration numbering** — `supabase/migrations/0XX_*.sql` sequential; Phase 12
  ships 084 + 085.
- **Pytest fixtures in `analytics-service/tests/fixtures/`** — committed
  parquet/JSON; regenerated via explicit script (not auto-on-test-run).

### Integration Points

- **`metrics.py` ⟶ `analytics_runner.py`** — runner calls `compute_all_metrics()`,
  receives a `(metrics_json_dict, sibling_kinds_dict)` tuple post-Phase-12
  refactor (currently returns single dict).
- **`analytics_runner.py` ⟶ Postgres** — runner runs the additive upsert against
  `strategy_analytics.metrics_json` AND additionally upserts each
  `(strategy_id, kind, payload)` row into the new sibling table (one
  `INSERT … ON CONFLICT (strategy_id, kind) DO UPDATE` per kind).
- **`compute_jobs` ⟶ `job_worker.py`** — worker dequeues respecting the new
  priority enum + throttle. Backfill enqueuer rate-limited.
- **`getStrategyDetail()` (TS-side, `src/lib/queries.ts`) ⟶ Postgres path-extraction
  + RPC** — above-the-fold scalars read directly via `metrics_json -> 'cagr'`,
  etc.; lazy panels 4–7 read via `fetch_strategy_lazy_metrics(strategy_id, panel_id)`
  RPC. Phase 14a/14b consumers; Phase 12 ships the RPC + path-extraction-ready
  shape.
- **`raw_fills.is_maker`** — Phase 12 Task 1 audits coverage on
  Binance/OKX/Bybit; descope Trade Mix maker/taker per D-15 if any < 99%.
- **`src/lib/types.ts`** — Phase 12 commits the frozen TS contract for
  `trade_metrics` (D-16). Phase 14b consumes via this.

</code_context>

<specifics>
## Specific Ideas

- **17 METRICS-XX requirements** drive the deliverable list. METRICS-01..15 are
  the math + storage; METRICS-16 = priority enum; METRICS-17 = sibling table.
- **Cross-AI review applied 2026-04-26** — APPROVE-WITH-REVISIONS, 6 convergent
  fixes baked into the plan source and into the success criteria.
- **Wave structure (from STATE.md):** Phase 12 ships in Wave 1 in parallel with
  Phase 13 (independent code surfaces — Python analytics-service vs TypeScript
  Discovery). This phase blocks Phase 14a/14b.
- **Scoping:** This session runs Phase 12 only — pause before Phase 13. Branch:
  `feature/v0.17-sprint-12`.

</specifics>

<deferred>
## Deferred Ideas

- **Trade Mix maker/taker dimension** — descoped to v0.17.1 (with TODOS.md entry)
  if `is_maker` audit (D-15) < 99% on any of Binance/OKX/Bybit. Long/short-only
  (2 buckets) ships as fallback in Phase 12.
- **Discovery v2 polish (T7 / Phase 13)** — independent of Phase 12; ships in
  Wave 1 in parallel.
- **Single-Strategy v2 UI (T8b / Phase 14a + 14b)** — depends on Phase 12 sibling
  kinds + RPC. Wave 2 (14a) + Wave 3 (14b) sequential.
- **Multi-benchmark correlation (ETH/SOL)** — UC#6 descope; Sprint 13+ candidate.
  Requires new ingestion pipelines.
- **Manager Workspace, Inbox, Threads, Mandate doc, Activity log** — v0.18.0.0
  (strategy-teams-page).
- **Stress testing engine, Monthly performance commentary, Drawdown story card,
  Advanced portfolio optimizer** — beyond v0.17.

### Reviewed Todos (not folded)

None — `gsd-sdk query todo.match-phase 12` returned 0 matches.

</deferred>

---

*Phase: 12-backend-metric-contracts*
*Context gathered: 2026-04-27*
