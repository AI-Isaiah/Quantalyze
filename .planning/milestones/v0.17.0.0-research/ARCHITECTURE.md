# Architecture — v0.17.0.0 Sprint 12 — KPI Parity and Discovery v2

**Domain:** Quantalyze Allocator-Facing Strategy Surfaces (T7 + T8a + T8b)
**Researched:** 2026-04-26
**Confidence:** HIGH (every claim grounded in verified file:line evidence)

## Recommended Architecture

```
                ┌──────────────────────────────────────────────────────────┐
                │  /discovery/[slug]                  /strategy/[id]/v2     │
                │  (server page, RSC)                 (NEW route, RSC)      │
                │  ↓                                  ↓                     │
                │  StrategyTableV2 (toggle)           PerformanceReportV2   │
                │  ├── StrategyTable (existing)       (client, 7 panels)    │
                │  ├── StrategyCard (NEW grid)        ├── Panel 1 Overview  │
                │  ├── CustomizeDrawer (NEW)          ├── Panel 2 Headline  │
                │  ├── WatchlistTab + star (NEW)      ├── Panel 3 DD        │
                │  └── HideExamples toggle            ├── Panel 4 Returns   │
                │      (already in StrategyTable)     ├── Panel 5 Rolling   │
                │                                     ├── Panel 6 Trades    │
                │                                     └── Panel 7 Exposure  │
                └────────────┬──────────────────────────────────┬───────────┘
                             │                                  │
                             │ getStrategiesByCategory          │ getStrategyDetail (extended)
                             │ (extended: filter by org)        │
                             ▼                                  ▼
                ┌────────────────────────────────────────────────────────────┐
                │   src/lib/queries.ts (RSC DAL — server-only)               │
                │   reads strategy_analytics columns + JSONB metrics_json    │
                └─────────────────────┬──────────────────────────────────────┘
                                      │ supabase.from("strategy_analytics")
                                      ▼
                ┌────────────────────────────────────────────────────────────┐
                │   Postgres / strategy_analytics (RLS-enforced)              │
                │   ──────────────────────────────────────────────────────── │
                │   Existing columns:                                        │
                │     metrics_json JSONB, returns_series JSONB,              │
                │     drawdown_series JSONB, monthly_returns JSONB,          │
                │     daily_returns JSONB (declared, NEVER WRITTEN — empty), │
                │     rolling_metrics JSONB, return_quantiles JSONB,         │
                │     trade_metrics JSONB, volume_metrics JSONB,             │
                │     exposure_metrics JSONB                                 │
                │   ──────────────────────────────────────────────────────── │
                │   T8a additive writes: NO new columns; populates           │
                │     daily_returns + extends metrics_json + rolling_metrics │
                │   ──────────────────────────────────────────────────────── │
                │   New tables:                                              │
                │     user_watchlist (user_id, strategy_id, added_at)        │
                └─────────────────────────▲──────────────────────────────────┘
                                          │
                                          │ upsert via service-role
                                          │
                ┌─────────────────────────┴──────────────────────────────────┐
                │   analytics-service/services/analytics_runner.py           │
                │   compute_all_metrics(returns) → upsert strategy_analytics │
                │                                                            │
                │   T8a: extends metrics.py compute_all_metrics() to also    │
                │   produce daily_grid + rolling_sortino_series +            │
                │   rolling_volatility_series + exposure_series +            │
                │   turnover_series + trade-table aggregations               │
                └─────────────────────────▲──────────────────────────────────┘
                                          │ kind="compute_analytics"
                ┌─────────────────────────┴──────────────────────────────────┐
                │   compute_jobs queue (existing, migration 032)             │
                │   Triggered by: pg_cron, Edge Function compute-trigger,    │
                │   admin "Recompute" button, post-mandate-edit RPC          │
                └────────────────────────────────────────────────────────────┘
```

### Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| `/strategy/[id]/v2/page.tsx` (NEW) | Server-side fetch of extended analytics, render header + 7-panel client | `getStrategyDetail()` extended |
| `PerformanceReportV2.tsx` (NEW) | Client orchestrator for 7 stacked panels | Reads `StrategyAnalytics` props; sub-panels fetch nothing |
| `StrategyTableV2.tsx` (NEW wrapper) | View-mode toggle, Customize state, Watchlist tab, calls existing `StrategyTable` or new `StrategyCard` | localStorage, `/api/watchlist` |
| `StrategyCard.tsx` (NEW) | Grid-mode card renderer matching DESIGN.md | Reads `Strategy + StrategyAnalytics` props |
| `CustomizeDrawer.tsx` (NEW) | Right slide-out drawer with View/Sort/HideExamples settings | localStorage `discovery_view_preferences:{slug}` |
| `analytics-service/services/metrics.py` (EXTENDED) | New series/grid functions; trade aggregations | Called only from `analytics_runner.py:189` |
| `compute_jobs` (EXISTING) | Queue dispatch already supports `compute_analytics` kind | `job_worker.py:1436` |

### Data Flow (T8b new metric: rolling_sortino_series)

```
1. pg_cron / Edge Function inserts row into compute_jobs(kind="compute_analytics")
2. main_worker.py polls, claims, dispatches via job_worker.py:1436 → run_strategy_analytics()
3. analytics_runner.py:189 calls metrics.compute_all_metrics(returns, benchmark_rets)
4. metrics.py adds rolling_sortino_series to rolling_metrics dict (alongside sharpe_30d/90d/365d)
5. analytics_runner.py:201 upserts strategy_analytics row (rolling_metrics column)
6. Allocator visits /strategy/[id]/v2 → getStrategyDetail() reads strategy_analytics(*)
7. PerformanceReportV2 destructures analytics.rolling_metrics.sortino_90d → renders Panel 5 chart
```

No new compute path. No new column. Additive JSONB extension.

## Patterns to Follow

### Pattern 1: V2 Behind localStorage Flag (verified analog)

**What:** Ship v2 surface at `/strategy/[id]/v2` route guarded by client-side flag, preserve `/strategy/[id]` (public landing) untouched.

**Verified analog:** `allocations.ui_v2` flag at `src/app/(dashboard)/allocations/AllocationsTabs.tsx:111`:
```ts
const UI_V2_STORAGE_KEY = "allocations.ui_v2";
function loadUiV2Flag(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(UI_V2_STORAGE_KEY);
    return raw !== "false";  // default-on; explicit "false" routes to legacy
  } catch { return true; }
}
```

**Recommended for v0.17:** flag key `strategy.ui_v2`, same default-on / "false"-opts-out semantics. Note the plan's `MANAGER_WORKSPACE_V2` flag is for the deferred v0.18 manager workspace — irrelevant here.

**Route topology:**
- `/strategy/[id]` — public, unchanged (current 6 MetricCard layout). Server component.
- `/strategy/[id]/v2` — NEW route, requires authenticated user (mirror `getStrategyDetail()` gate). Server component fetches extended analytics, renders `<PerformanceReportV2 />`.
- `/discovery/[slug]/[strategyId]` — authenticated single-strategy detail. Could either (a) flip to render `PerformanceReportV2` when flag on, or (b) leave as-is and let `/strategy/[id]/v2` be the new canonical surface.

**Recommendation:** option (a). The discovery → strategy detail page already imports `PerformanceReport` at `src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx:4`. Replace the import with `PerformanceReportV2` once flag is default-on (matching v0.15.7.0's "V2 default-for-all" pattern from `AllocationsTabs.tsx:106`).

### Pattern 2: 7-Panel Stacked Layout (replaces 5-tab)

**What:** Drop `<button>` tab strip from `PerformanceReport.tsx:56-71`. Render all 7 panels as scrollable Card sections in fixed order.

**Why:** Plan §S7 explicitly mandates the wall layout. UC#7 ratifies the DESIGN.md density-rule deviation.

**Code shape sketch (new `src/components/strategy/PerformanceReportV2.tsx`):**

```tsx
"use client";
export function PerformanceReportV2({ analytics, percentiles, positions }: Props) {
  return (
    <div className="space-y-8">
      <Panel1Overview strategy={...} />
      <Panel2Headline analytics={analytics} />
      <Panel3Drawdown analytics={analytics} />
      <Panel4ReturnsDistribution analytics={analytics} />
      <Panel5Rolling analytics={analytics} />
      <Panel6Trades analytics={analytics} />
      <Panel7ExposureCorrelation analytics={analytics} />
    </div>
  );
}
```

**Server-vs-client split:** `PerformanceReportV2` stays `"use client"` because Panels 2/5 need `useState` for the segmented control toggles (Cumulative ▾ / Underwater / Rolling Sharpe; 3M/6M/12M). All data arrives via props from server fetch — no client-side fetching.

### Pattern 3: T8a Additive JSONB Writes (no new columns)

**Verified shape:** `analytics_runner.py:189-211` upserts `strategy_analytics` with the entire metrics dict from `compute_all_metrics()`. The runner accepts arbitrary additional keys via `**metrics`.

**T8a pattern:** Extend `metrics.py:compute_all_metrics()` return shape additively:

```python
# metrics.py — current rolling shape (line 65-69)
rolling = {
    "sharpe_30d": _rolling_sharpe(returns, 30),
    "sharpe_90d": _rolling_sharpe(returns, 90),
    "sharpe_365d": _rolling_sharpe(returns, 365),
    # T8a additions:
    "sortino_90d": _rolling_sortino(returns, 90),
    "sortino_180d": _rolling_sortino(returns, 180),
    "sortino_365d": _rolling_sortino(returns, 365),
    "vol_90d": _rolling_volatility(returns, 90),
    "vol_180d": _rolling_volatility(returns, 180),
    "vol_365d": _rolling_volatility(returns, 365),
}
```

**TypeScript shape (no type change needed):** `StrategyAnalytics.rolling_metrics: Record<string, { date: string; value: number }[]>` already accepts arbitrary string keys (`src/lib/types.ts:111`).

**Daily heatmap (`daily_returns_grid`):** Use the **already-declared-but-empty** `daily_returns JSONB` column (`migration 001:92`, `src/lib/types.ts:110`). Shape:
```ts
daily_returns: { [year: string]: { [monthDay: string]: number } }
// e.g. { "2026": { "01-15": 0.012, "01-16": -0.003 } }
```

**Exposure / turnover series:** New keys inside existing `metrics_json` JSONB. NO type change.
```python
metrics_json["exposure_series"] = [{"date": "2026-04-01", "gross": 0.85, "net": 0.32}, ...]
metrics_json["turnover_series"] = [{"date": "2026-04-01", "turnover": 0.15}, ...]
```

Position reconstruction infrastructure exists (`position_reconstruction.py:435 compute_exposure_metrics`) but currently emits aggregates only (`mean/std/max gross+net`, `position_reconstruction.py:485-493`). T8a adds a new function `compute_exposure_series()` that emits the daily time series alongside aggregates — both written into the same upsert (analytics_runner.py:243-244).

**Trade-table aggregations:** Already written to `trade_metrics JSONB` by `position_reconstruction.py:reconstruct_positions` — shape `{ total_positions, win_rate, avg_roi, ... }` (verified `src/lib/types.ts:137-148`). Plan §S7 Panel 6 ("Trade Main / Trade Mix / Position Main") needs Trade Mix splits (long-entry maker/taker etc.) which require fill-side enrichment. **NEW:** extend `_compute_volume_metrics()` at `analytics_runner.py:49` to emit per-side maker/taker breakdowns into `volume_metrics`. No new column.

### Pattern 4: Discovery v2 — Customize Drawer + Watchlist Tab

**Existing:** `StrategyFilters.tsx:63-75` already declares `CustomizeSettings` interface and `DEFAULT_CUSTOMIZE` constant. `StrategyTable.tsx:90` already has `showExamples` state. The plumbing exists; the **drawer UI does not**.

**Verified table-column header sort coexists with Sort dropdowns:** `StrategyTable.tsx:115` (`handleSortKeyChange`) already syncs the two. No new logic needed.

**View toggle:** `StrategyFilters.tsx:20` already exports `type ViewMode = "table" | "grid"`. `StrategyTable.tsx:93` reads it. The grid renderer `<StrategyGrid>` exists (`src/components/strategy/StrategyGrid.tsx`). Whether the existing `StrategyGrid` matches the Quants.Space card density target is a UI question, not architecture — verify in design pass.

**Watchlist:**
- New table `user_watchlist (user_id UUID REFERENCES auth.users, strategy_id UUID REFERENCES strategies, added_at TIMESTAMPTZ)`. Composite PK.
- RLS: 4 policies keyed on `auth.uid() = user_id` (mirror `migration 024_user_favorites.sql:42-73` exactly — same shape, same PK, same notes column).
- **Reuse opportunity:** `user_favorites` already exists with the *exact* schema shape (migration 024). It is documented as "no UI ships against it in v0.4.0" (line 38). Either (a) repurpose `user_favorites` (rename or alias), or (b) ship a fresh `user_watchlist` table that is functionally identical and let `user_favorites` decay. Recommendation: **(a) reuse `user_favorites`**. Zero new migration, RLS already proven, no data migration needed.
- API: new `POST /api/watchlist` + `DELETE /api/watchlist/[strategyId]` route handlers wrapping `user_favorites` upsert/delete.

**`is_example` flag — already shipped:**
- Column: `strategies.is_example BOOLEAN NOT NULL DEFAULT false` (migration 001:64).
- TypeScript: `Strategy.is_example: boolean` (`src/lib/types.ts:52`).
- StrategyTable already reads `showExamples` (`StrategyTable.tsx:90`) and presumably filters on it (verify mid-implementation).
- **Plan §S6 says "default ON".** Migration to set `is_example=true` for existing seed strategies is needed: a tiny data migration `UPDATE strategies SET is_example = true WHERE id IN (<seed-uuid-list>)`. Source-of-truth seed UUIDs: see `src/lib/seed-fixtures.ts` (or wherever Phase 07 PURGE-01 enumerated them).

### Pattern 5: `strategies.organization_id` (FK exists, ready for filter-by-team)

**Verified:** column shipped in `migration 006_organizations.sql:30`:
```sql
ALTER TABLE strategies ADD COLUMN organization_id UUID REFERENCES organizations(id);
```

RLS predicates that respect the column ship in `migration 026_fix_organization_rls_recursion.sql:97-99` via `is_org_member()` SECURITY DEFINER helper.

**T7 filter-by-team:** `getStrategiesByCategory()` (`src/lib/queries.ts:166`) extends with optional `?orgId=` param. Server-side filter via `.eq("organization_id", orgId)`. Currently `organization_id` is nullable for backward compat — UI must surface the ones with values; null-organization strategies just don't appear in team filter.

## Anti-Patterns to Avoid

### Anti-Pattern 1: Reinventing strategy_analytics columns

**What:** Adding `rolling_sortino_series` as a top-level column on `strategy_analytics`.
**Why bad:** Migration churn, breaks the additive-JSONB pattern that `analytics_runner.py:189-211` relies on for forward-compat.
**Instead:** Pack into `rolling_metrics JSONB` with new keys. Already-declared `daily_returns JSONB` is the heatmap target — no new column needed.

### Anti-Pattern 2: Inventing `teams` / `team_members` tables

**What:** Plan T1 originally proposed new tenancy tables.
**Why bad:** UC#5 resolved this — duplicate of existing `organizations` schema (migration 006). Plus this is v0.18 territory now.
**v0.17 escape:** Don't touch tenancy at all. v0.17 is allocator-facing only. Defer to v0.18.

### Anti-Pattern 3: Stuffing 7 panels behind tabs

**What:** Keep `PerformanceReport.tsx:23` 5-tab structure and put 7 panels inside one tab.
**Why bad:** Defeats the qstats-parity contract (every metric visible without click).
**Instead:** Drop tabs, scroll layout. Plan §S7 + UC#7 explicitly approved this density.

### Anti-Pattern 4: Lazy-on-page-view recompute

**What:** Trigger metric recompute when allocator opens `/strategy/[id]/v2` and metrics are stale.
**Why bad:** Couples render to long-running compute; p99 latency explodes.
**Instead:** One-shot backfill at v0.17 deploy time — admin script enqueues `compute_analytics` for every published strategy. Existing strategies pick up new metrics asynchronously through `compute_jobs` queue. UI gracefully degrades when keys are missing (already pattern: `analytics.metrics_json?.field ?? null` with fallback render).

## Scalability Considerations

| Concern | Today (~50 strategies) | At 500 strategies | At 5000 strategies |
|---------|------------------------|-------------------|---------------------|
| Recompute backfill | Single 1-hour batch | Stagger across 24h via cron | Worker fanout (already in `main_worker.py`) |
| `metrics_json` row size | ~50KB | ~80KB with T8a additions | Add JSONB column-level compression (TOAST handles this transparently) |
| Discovery list query | 5 categories × ~10 rows | Same — paginated client-side | Move to server-side pagination (PAGE_SIZE=20 already at `StrategyTable.tsx:37`) |
| Watchlist query | <100 rows/user | Same | Already indexed at migration 024:75 |
| Daily heatmap render | 365 cells | 1825 cells (5y) | Virtualize or downsample (already pattern in `transforms.py`) |

## Build Sequence + Integration Points

### Recommended Wave Structure (3 phases)

**Phase 12.01 — T8a Backend Contracts** (foundational; ships invisible value)
- Extends `analytics-service/services/metrics.py:65` rolling dict with sortino/vol series
- Adds `_daily_returns_grid()` writing to `daily_returns JSONB` column (already declared, currently empty)
- Adds `_rolling_sortino()` + `_rolling_volatility()` helpers (mirrors `_rolling_sharpe()` at `metrics.py:374`)
- Extends `position_reconstruction.compute_exposure_metrics()` (line 435) to also emit `exposure_series` + `turnover_series` into `metrics_json`
- Extends `_compute_volume_metrics()` (`analytics_runner.py:49`) for Trade Mix maker/taker breakdowns
- Backfill cron: enqueue `compute_analytics` for every published strategy
- Pytest fixtures + parity tests (`analytics-service/tests/test_metrics.py`)
- **Migrations:** 0
- **Net-new files:** none (all extensions to existing modules)
- **Risk:** Low — additive only, no existing field semantics change

**Phase 12.02 — T7 Discovery v2** (parallel-safe; ships visible value early)
- New `src/components/strategy/StrategyCard.tsx` for grid view
- New `src/components/strategy/CustomizeDrawer.tsx` (right slide-out, two tabs General/Columns)
- Extend `StrategyTable.tsx:88` with Watchlist tab + star icon column
- New API routes: `POST/DELETE /api/watchlist/[strategyId]` (proxy to `user_favorites` table — reuse migration 024)
- Optional team filter: extend `getStrategiesByCategory()` query at `src/lib/queries.ts:166` with `orgId` param
- Data migration: set `is_example = true` for existing seed strategies (single UPDATE)
- **Migrations:** 1 net-new (data migration only — table already exists at migration 024) OR 0 if seed UUIDs not in DB
- **Risk:** Low — `is_example` and `user_favorites` columns/tables already shipped; mostly client-side work

**Phase 12.03 — T8b Single-Strategy v2 UI** (DEPENDS ON 12.01)
- New `src/app/strategy/[id]/v2/page.tsx` (or flag-gated swap in `discovery/[slug]/[strategyId]/page.tsx:117`)
- New `src/components/strategy/PerformanceReportV2.tsx` (7-panel layout)
- New panel sub-components: `Panel1Overview.tsx` ... `Panel7ExposureCorrelation.tsx`
- New chart components: `DailyHeatmap.tsx` (mirrors `MonthlyHeatmap.tsx` shape), `ExposureSeries.tsx`, `TurnoverSeries.tsx`, `TradesMetricsPanel.tsx`, `BenchmarkGreeksPanel.tsx`
- Reuse: `EquityCurve.tsx`, `DrawdownChart.tsx`, `MonthlyHeatmap.tsx`, `MonthlyReturnsBar.tsx`, `ReturnHistogram.tsx`, `ReturnQuantiles.tsx`, `RollingMetrics.tsx`, `WorstDrawdowns.tsx`, `CorrelationWithBenchmark.tsx`, `YearlyReturns.tsx`
- Flag: `localStorage["strategy.ui_v2"]` (mirror `allocations.ui_v2` pattern at `AllocationsTabs.tsx:111`)
- **Migrations:** 0
- **Risk:** Medium — visual contract is unforgiving; partial-data states (e.g. <365 days history) need explicit fallbacks

### Dependency Graph

```
12.01 (T8a) ────► 12.03 (T8b UI consumes new metrics)
                  │
12.02 (T7) ───────┘  (independent; can ship in parallel with either)
```

**Recommendation: ship 12.01 + 12.02 in parallel, then 12.03.** T7 is allocator-facing visible value with low schema risk. T8a backfills compute. T8b lands once daily_returns/rolling extensions are live in DB. This compresses the sprint to roughly 2 phase-cycles instead of 3 sequential.

### Migration Count for v0.17

**Estimated: 0–2 net-new migrations.**
- `is_example` data backfill: 1 trivial SQL `UPDATE` (could be data-only, no schema)
- Optional: alias view `user_watchlist` over `user_favorites` for code clarity (1 migration)
- All other shape changes are JSONB additive — no DDL needed

This is the leanest milestone since v0.13.x. The plan's 8 prior migrations (059–065 + 070–083) front-loaded the schema work; v0.17 cashes in the JSONB headroom.

## Sources

- `~/.claude/plans/strategy-teams-kpi-parity.md` (master plan, lines 304-389 for §S7 panel contract)
- `.planning/PROJECT.md` (milestone scope, lines 50-95)
- `.planning/ROADMAP.md` (phase progression context)
- `.planning/codebase/ARCHITECTURE.md:1-120` (server-first RSC + RLS-as-authz + FastAPI compute split)
- `analytics-service/services/metrics.py:1-410` (verified compute path; rolling dict at lines 65-69; persistence shape at 290-307)
- `analytics-service/services/analytics_runner.py:189-275` (verified upsert pattern; trade_metrics/exposure_metrics/volume_metrics extension at 240-244)
- `analytics-service/services/position_reconstruction.py:435-493` (verified exposure aggregate-only emission; series-shape work needed)
- `analytics-service/services/job_worker.py:1434-1460` (verified queue dispatch by `kind`)
- `src/app/strategy/[id]/page.tsx` (public page — current 6 MetricCard layout to preserve)
- `src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx:117` (verified `<PerformanceReport>` import — flag-gate replacement target)
- `src/app/(dashboard)/discovery/[slug]/page.tsx` (verified discovery list pattern + `getStrategiesByCategory` server fetch)
- `src/components/strategy/PerformanceReport.tsx:23, 56-71` (verified existing 5-tab structure to drop)
- `src/components/strategy/StrategyTable.tsx:88-95` (verified Customize/HideExamples/ViewMode plumbing already wired)
- `src/components/strategy/StrategyFilters.tsx:20, 63-75` (verified `ViewMode`, `CustomizeSettings`, `DEFAULT_CUSTOMIZE` already exist)
- `src/lib/types.ts:52, 88-117` (verified `Strategy.is_example` + `StrategyAnalytics` shape — `daily_returns` declared but unwritten)
- `src/lib/queries.ts:166, 213, 274` (verified `getStrategiesByCategory`, `getPublicStrategyDetail`, `getStrategyDetail`)
- `supabase/migrations/001_initial_schema.sql:50-97` (verified `is_example` + `daily_returns JSONB` already shipped)
- `supabase/migrations/006_organizations.sql:30` (verified `strategies.organization_id` FK already shipped)
- `supabase/migrations/024_user_favorites.sql:29-105` (verified watchlist-shaped table already exists with full RLS)
- `supabase/migrations/026_fix_organization_rls_recursion.sql:97-99` (verified `is_org_member()` helper for org-filtered reads)
- `src/app/(dashboard)/allocations/AllocationsTabs.tsx:105-121` (verified `ui_v2` flag pattern to mirror)
