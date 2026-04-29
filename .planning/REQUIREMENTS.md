# Requirements — v0.17.0.0 Sprint 12 (KPI Parity and Discovery v2)

**Milestone goal:** Every allocator-facing strategy surface (Discovery list + Single-Strategy detail) reaches **full qstats parity** in Quantalyze identity. Every metric `qs.reports.html()` produces — every scalar and every chart — has a Quantalyze equivalent rendered in DESIGN.md identity. Discovery v2 mirrors Quants.Space's IA (card/table toggle, Customize panel, Watchlist, hide-examples, sort dropdowns, filter-by-team).

**Success gate (single E2E):** open `qs.reports.html()` for any 1-year daily series and our `/strategy/[id]/v2` side-by-side; **every metric named, every chart type present, no metric missing**, in our DESIGN.md identity (white card, accent series #1B6B5A, DM Sans / Geist Mono tabular-nums, no Plotly chrome). Plus axe-core green on Discovery v2 + Single-Strategy v2.

**Source:** derived from `~/.claude/plans/strategy-teams-kpi-parity.md` (CEO + Design + Eng + DX dual-voice review, 8 User Challenges resolved 2026-04-26) + parallel research outputs in `.planning/research/` (4 researchers + synthesis SUMMARY.md). Plan-fidelity mode = "input only, GSD re-derives" per user direction 2026-04-26. Optional scope **expanded per user direction "ship all panels, full quantstats"** — every qstats scalar and chart pulled into v0.17 scope; team-side workspace gets its own sprint as v0.18.0.0.

**Net session estimate:** ~8.0 sessions (Phase 12 backend 4.0, Phase 14a eager panels 2.0, Phase 14b lazy panels + Trade & Exposure 1.5, Phase 13 Discovery 0.5). Phase 14 split into 14a + 14b per cross-AI review 2026-04-26.

---

## v0.17.0.0 Requirements

### DISCO — Discovery v2 polish (Phase 13)

- [ ] **DISCO-01**: Allocator can star a strategy from any row or card on `/discovery/[slug]`; "My Watchlist" sub-tab appears alongside "All" with a count badge; star toggle is idempotent and survives reload (uses existing `user_favorites` schema from migration 024)
- [ ] **DISCO-02**: Customize prefs (Default view / Default sort / Hide examples) persist in localStorage keyed by `{auth.uid}:{slug}` (per-user, not per-slug only); cross-account leakage on shared machines is prevented
- [ ] **DISCO-03**: Allocator can filter strategies by team using existing `strategies.organization_id` foreign key — **gated on Phase 13-internal audit**. If `SELECT COUNT(*) FROM strategies WHERE organization_id IS NOT NULL AND status='published'` returns 0, defer UI to v0.18 and document in TODOS. If non-zero, ALSO ship migration `088_organizations_is_public.sql` (adds `is_public BOOLEAN DEFAULT false`); filter dropdown reads only orgs WHERE `is_public = true`. Default-false avoids leaking private/stealth fund names; managers opt-in via `/strategies/team` settings (deferred to v0.18 — managers can be flipped to public manually via admin during v0.17 if needed). Pitfall 18 mitigation.
- [ ] **DISCO-04**: Sparkline rendering on row + card uses single accent color for the entire trace (DESIGN.md DIFF-05 rule); never split green/red by daily return; fill color decided by final-value sign
- [ ] **DISCO-05**: `is_example=true` seed strategies are flagged via existing migration 001:64 column; default Customize "Hide examples" toggle ON; Phase 13 ships only data backfill `UPDATE strategies SET is_example = true WHERE id IN (<seed UUIDs>)` (no DDL)

### KPI — Single-Strategy v2 7-panel UI (Phase 14a + Phase 14b)

#### Phase 14a — Eager panels + identity baseline

- [x] **KPI-01
**: User opens `/strategy/[id]/v2` (or v1 with localStorage `strategy.ui_v2` flag toggling the swap); flag pattern mirrors production-validated `allocations.ui_v2` at `AllocationsTabs.tsx:111`
- [x] **KPI-02
**: Panel 1 — Overview cards row: Supported Exchanges / Types / Subtypes / Markets / Leverage / Avg DTO; data sourced from `strategies` row + `metrics_json` aggregates
- [x] **KPI-03
**: Panel 2 — Headline metrics 6-cell strip: Cumulative Return / CAGR / Sharpe / Sortino / Max DD / Vol; renders existing scalars from `metrics.py:48–54`
- [x] **KPI-04
**: Panel 2 — Equity vs BTC overlay with Cumulative ▾ / Underwater / Rolling Sharpe / Log Returns segmented control; **BTC overlay default-ON** (DIFF-03), uses existing `EquityCurve` + `DrawdownChart` + `RollingMetrics` wrapped in tab control
- [x] **KPI-05
**: Panel 3 — Full-width DrawdownChart + Worst 5 Drawdowns table (Started / Recovered / Drawdown % / Days); reuses existing `DrawdownChart` + `WorstDrawdowns`
- [x] **KPI-22
**: 7-panel single-page scrollable shell with placeholders for panels 4–7 (UC#7 DESIGN.md "data density > card density" deviation explicitly accepted); panels 4–7 lazy-mount via IntersectionObserver to keep TTI < 2s on 5y-history strategies. Phase 14a ships the shell + IntersectionObserver scaffold; placeholders for panels 4–7 show "Loading..." (bodies deferred to Phase 14b).
- [x] **KPI-23a
**: Per-panel partial-data state for panels 1–3 — strategies with <30/<90/<365 days of history show "Awaiting more data (need ≥X days)" copy on the affected panel/sub-panel; never crash; per-panel matrix documented in PR template (Pitfall 17 mitigation, panels 1–3 only).

#### Phase 14b — Lazy panels + Trade & Exposure

- [x] **KPI-06
**: Panel 4 — Returns Distribution: MonthlyHeatmap + DailyHeatmap + ReturnHistogram (with benchmark overlay) + ReturnQuantiles boxplot + YearlyReturns bar; layout-only for 4 of 5 components
- [x] **KPI-07
**: Panel 4 — DailyHeatmap (12mo × N years grid); SVG renderer for ≤365 cells, Canvas API single-draw fallback above 365 (Pitfall 4 mitigation); IntersectionObserver-deferred paint to keep TTI under budget
- [x] **KPI-08
**: Panel 5 — Rolling Sharpe with 3M / 6M / 12M toggle + BTC benchmark overlay; existing 30/90/365-day windows relabeled in UI
- [x] **KPI-09
**: Panel 5 — Rolling Volatility series with 3M / 6M / 12M toggle (NEW backend metric)
- [x] **KPI-10
**: Panel 5 — Rolling Sortino series with 3M / 6M / 12M toggle (NEW backend metric)
- [x] **KPI-11
**: Panel 5 — Rolling alpha / Rolling beta (rolling greeks) toggle (NEW backend metric)
- [x] **KPI-12
**: Panel 6 — Trade Main row: total / long / short / wins / losses / win rate (extends existing `trade_count` with side segmentation)
- [x] **KPI-13
**: Panel 6 — Position Main row: open / closed / long / short / win rate / avg duration (surfaces `position_reconstruction.py` aggregates)
- [x] **KPI-14
**: Panel 6 — Risk/Reward row: R:R, Weighted R:R, Profit Factor, Payoff Ratio, Long PF, Short PF, Expectancy `E = (W × Avg Win) − (L × Avg Loss)` (1-line derivations + 2 new aggregators)
- [x] **KPI-15
**: Panel 6 — SQN (Van Tharp System Quality Number) `sqn = (mean(R)/std(R)) × sqrt(min(N,100))`
- [x] **KPI-16
**: Panel 6 — Volume metrics row: gross volume, mean trade size, mean daily turnover, mean monthly turnover (aggregator over `raw_fills`)
- [x] **KPI-17
**: Panel 6 — Trade Mix maker/taker breakdown: long-entry maker/taker, short-entry maker/taker — **gated on Phase 12 `is_maker` flag audit on `raw_fills` across exchange handlers (Binance / OKX / Bybit — Deribit excluded by design: `analytics-service/services/exchange.py:325-334` confirms `fetch_raw_trades` does not dispatch to Deribit)**; if absent on any of the three, descope to v0.17.1 and document in TODOS
- [x] **KPI-18
**: Panel 7 — Net + Gross Exposure series (intraday → daily); persists per-date arrays from `position_reconstruction.compute_exposure_metrics()`
- [x] **KPI-19
**: Panel 7 — Turnover series (daily `abs(Δposition × price) / NAV`); depends on Sprint 3 position reconstruction NAV alignment
- [x] **KPI-20
**: Panel 7 — Correlation with BTC (single-series rolling 90d + scalar value); rendered as "Correlation with BTC" not "Correlation matrix" (multi-benchmark ETH/SOL deferred per UC#6)
- [x] **KPI-21
**: Panel 7 — Benchmark Greeks panel: alpha / beta / IR / treynor (existing scalars from `metrics.py:255-267`)
- [x] **KPI-23b
**: Per-panel partial-data state for panels 4–7 — strategies with <30/<90/<365 days of history show "Awaiting more data (need ≥X days)" copy on the affected panel/sub-panel; never crash; per-panel matrix documented in PR template (Pitfall 17 mitigation, panels 4–7 only).

### METRICS — Backend metric contracts (Phase 12)

- [x] **METRICS-01**: `_rolling_sortino(returns, window, mar=MAR)` added to `metrics.py` (line 391); module-level `MAR: float = 0.0` constant (line 15) per Pitfall 11; mirrors `_rolling_sharpe` shape AND `qs.stats.sortino` exact RMS downside math; cross-runtime parity verified at diff=1.11e-16 at window==period==90 (Plan 12-03)
- [x] **METRICS-02**: `_rolling_volatility(returns, window)` added (line 423); annualized via `std * sqrt(252)`; mirrors `qs.stats.volatility` on a rolling window (Plan 12-03)
- [x] **METRICS-03**: `_rolling_alpha` + `_rolling_beta` added (lines 434, 449); wrap `qs.stats.rolling_greeks` (BTC benchmark, window=90 default per UC#6); project alpha/beta column from returned DataFrame (Plan 12-03)
- [x] **METRICS-04**: `_daily_returns_grid_from_series(returns)` shipped in metrics.py (line 372); flat per-day list `[{date, value}, …]` mirroring `_monthly_returns_grid_from_series` template at metrics.py:351; rounds to 6 decimals; D-03 sibling-table storage shape (Plan 12-04)
- [x] **METRICS-05**: `compute_exposure_metrics()` refactored to persist `exposure_series: [{date, gross, net}]` alongside existing 6 aggregate keys (per-date arrays at lines 461-487 previously discarded); no caller breakage in analytics_runner.py (Plan 12-04)
- [x] **METRICS-06**: `compute_turnover_series(positions, prices, nav)` shipped in position_reconstruction.py with explicit Pitfall #19 docstring contract (`turnover = sum_over_symbols(abs(delta * price)) / nav`); T-12-04-02 mitigation via `if nav <= 0: turnover = 0.0` short-circuit (Plan 12-04)
- [x] **METRICS-07**: 7 derived trade metrics added — Expectancy, R:R, Weighted R:R, Long PF, Short PF + side-segmented Trade Main aggregator (Plan 12-05 ✅ 2026-04-28: `_compute_derived_trade_metrics` shipped via B-01 path b — NEW function in analytics_runner.py consumes both volume-side dict and extended position-side dict from reconstruct_positions; H-F weighted R:R formula `(avg_win × winners_count) / (|avg_loss| × losers_count)` honored)
- [x] **METRICS-08**: SQN function added (Van Tharp `mean(R)/std(R) × sqrt(min(N,100))`) (Plan 12-05 ✅ 2026-04-28: SQN computed inside `_compute_derived_trade_metrics` over per-trade R-multiples where R = realized_pnl / |avg_loss|; sample variance N-1 denominator; None when fewer than 2 trades or zero std)
- [x] **METRICS-09**: Volume aggregator over `raw_fills` — gross volume, mean trade size, mean daily turnover, mean monthly turnover (Plan 12-05 ✅ 2026-04-28: `_compute_volume_aggregator` shipped in analytics_runner.py; groups by `filled_at`/`created_at` date / month prefix)
- [x] **METRICS-10**: Trade Mix maker/taker aggregator over `raw_fills` — gated on `is_maker` flag audit on Binance / OKX / Bybit (Deribit excluded — `fetch_raw_trades` does not dispatch there); KPI-17 dependency. Audit resolved 2026-04-28 (Plan 12-01): TRADE_MIX_HAS_MAKER_TAKER=false → ship 2-bucket long/short fallback; maker/taker dimension deferred to v0.17.1. (Plan 12-05 ✅ 2026-04-28: `_compute_trade_mix(fills, has_maker_taker)` shipped in analytics_runner.py; branches off audit flag — 4-bucket happy path / 2-bucket fallback; T-12-05-04 mitigation skips fills missing is_maker in 4-bucket mode)
- [x] **METRICS-11**: `compute_qstats_scalars(returns, benchmark)` shipped in metrics.py with all 10 new scalars (recovery_factor, ulcer_index, upi, kelly_criterion, probabilistic_sharpe_ratio, common_sense_ratio, cpc_index, serenity_index, r_squared vs benchmark, time_in_market); each in try/except routed through `_safe_float` (mirrors metrics.py:97-138 pattern); fail-soft to None on qs failure or missing benchmark (Plan 12-04)
- [x] **METRICS-12**: `_log_returns_series(returns)` added (line 459); `np.log1p(returns)` routed through `_finalize_rolling`; same length as input (no window dropoff); powers EquityCurve "Log Returns" toggle in KPI-04 (Plan 12-03)
- [x] **METRICS-13**: Cross-runtime parity tests — pytest fixtures + Vitest equivalents on a golden 252-day fixture; assert byte-identical JSON between Python `metrics.py` output and JS-side parser (Plan 12-09 ✅ 2026-04-28: `regen_golden.py` + 3 fixture files (`golden_252d_input.parquet` + `golden_252d_input.json` + `golden_252d_expected.json`) + `test_metrics_parity.py` (Python math gate, 5/5 pass) + `metrics-parity-helper.ts` + `metrics-parity.test.ts` (TS schema gate per Reading A from RESEARCH.md §9.3, 5/5 pass). D-11 hybrid tolerance — scalars 12-sig-digit + 1e-12 epsilon fallback (M-Grok-2); series 1e-9 relative epsilon with NaN==NaN and +0==-0 (H-C). D-12 fail-loud on missing/extra keys. 12 sibling kinds (H-A1: exposure_series + turnover_series populated from simulated positions/prices/NAV; H-D: equity_series_1y excluded). H-F weighted_risk_reward_ratio in trade_metrics. TRADE_MIX_HAS_MAKER_TAKER=false → 2-bucket trade_mix per D-15)
- [x] **METRICS-14**: Throttled backfill strategy on Phase 12 deploy — reads METRICS-16 priority enum on `compute_jobs` (backfill=`low`, sync=`normal`); 5 jobs/min cap; live `sync_trades` cannot queue behind backfill (Pitfall 3 / Pitfall 10 mitigation). Throttled enqueuer in `job_worker.py` reads priority and caps backfill jobs at 5/min when both backfill and sync jobs are queued. _Plan 12-07 (✅ 2026-04-28) wired dispatch_tick to claim_compute_jobs_with_priority (migration 086). Plan 12-08 will mark backfill jobs as priority='low' so the claim path defers them when sync_trades is queued._
- [ ] **METRICS-15**: `getStrategyDetail()` reads scalars from `metrics_json -> 'key'` path-extraction; reads heavy series from `strategy_analytics_series` sibling table via LATERAL join (METRICS-17). Eager-fetch above-the-fold panels 1–3 scalars; lazy-fetch panels 4–7 series via `fetch_strategy_lazy_metrics(strategy_id, panel_id)` RPC (Pitfall 2 / Pitfall 5 mitigation against 1MB JSONB TOAST threshold). _Plan 12-08 (✅ 2026-04-28) shipped the TS-side consumer (`fetchStrategyLazyMetrics(strategyId, panelId)` + `LazyMetricsPanelId` type union in `src/lib/queries.ts`). Path-extraction half (replacing `select *, strategy_analytics(*)` in `getStrategyDetail`) remains Phase 14a's job — checkbox stays unchecked until both halves ship._
- [x] **METRICS-16**: Migration `086_compute_jobs_priority.sql` adds `priority TEXT CHECK (priority IN ('low','normal','high')) NOT NULL DEFAULT 'normal'` column on `compute_jobs`; partial index on `(priority, status, scheduled_for) WHERE status = 'queued'`; ADR-0023 audit taxonomy sync if needed; throttled enqueuer in `job_worker.py` reads priority and caps backfill jobs at 5/min when both backfill and sync jobs are queued. Pitfall 10 mitigation; required for METRICS-14.
- [x] **METRICS-17**: Migration `087_strategy_analytics_series.sql` creates `strategy_analytics_series (strategy_id UUID, kind TEXT, payload JSONB, computed_at TIMESTAMPTZ)` with PRIMARY KEY `(strategy_id, kind)`, partial index on `(strategy_id, kind) WHERE payload IS NOT NULL`, FK CASCADE on strategies. RLS mirrors `strategy_analytics`. Heavy series (`daily_returns_grid`, `exposure_series`, `turnover_series`, `rolling_*_series`) write to sibling table; medium scalars stay in `metrics_json`. Path-extraction in `getStrategyDetail()` joins LATERAL on the sibling table for panels 4–7. Replaces METRICS-15 path-extraction-only mitigation. Kill-switch: if Phase 12 deploy probes `pg_column_size > 800kB` at p99.9, emergency cutover migrates remaining heavy keys from `metrics_json` to sibling table — automated via Phase 12 deploy script. Pitfall 5 mitigation.

### DESIGN — Identity translation (cross-cutting, Phase 14a)

- [ ] **DESIGN-01**: Every chart in Single-Strategy v2 + Discovery v2 audited against DESIGN.md identity rules (white card #FFFFFF, accent #1B6B5A strategy series, muted #94A3B8 BENCHMARK STROKES ONLY — never as text; positive #16A34A, negative #DC2626; 1px gridlines #E2E8F0; no Plotly modebar; DM Sans 11px axis labels; Geist Mono 11px tabular-nums ticks)
- [x] **DESIGN-02
**: All numeric cells (KPI strip, table cells, axis ticks) use `font-variant-numeric: tabular-nums`; centralized in new `CHART_TICK_STYLE` token (Pitfall 14 — Recharts SVG `<text>` doesn't inherit `font-variant-numeric` from CSS class)
- [x] **DESIGN-03
**: DESIGN.md decisions log entry stamped at milestone close documenting UC#7 7-panel density-rule deviation; PR-template addition of per-chart identity checklist (Pitfall 13)

### A11Y — Accessibility verification (Phase 14a + Phase 14b)

- [x] **A11Y-01
**: All chart axis text uses `CHART_AXIS_TICK = #64748B` (4.85:1 contrast on white, passes WCAG AA); never `#718096` (3.94:1, fails AA) or `#94A3B8` (2.85:1, fails AA — reserved for benchmark strokes only); `tests/a11y/chart-contrast.test.ts` gates future palette swaps. **Phase 14a** (covers panels 1–3 + identity baseline).
- [ ] **A11Y-02**: axe-core integration tests added for `/discovery/[slug]` + `/strategy/[id]/v2`; tests must pass in CI on every PR. **Phase 14b** (covers all 7 panels once 14b lands the bodies).
- [ ] **A11Y-03**: Keyboard navigation verified on Customize drawer, Watchlist tab toggle, 7-panel scroll, and EquityCurve segmented control; focus order documented in DX. **Phase 14b** (covers full 7-panel scroll).

### CLEANUP — Bundle hygiene (Phase 14a)

- [x] **CLEANUP-01
**: `npm uninstall @nivo/boxplot` (~80KB gzipped saved); `ReturnQuantiles` is hand-rolled SVG with no dependency on the lib

---

## Future Requirements (deferred)

- **Manager Workspace + Inbox + Threads + Mandate doc + Activity log + Tear-sheet cron** — v0.18.0.0 (T0.5 / T1–T6 / T9 from the strategy-teams-kpi-parity plan)
- **Multi-benchmark correlation matrix (ETH/SOL)** — Sprint 13+; needs new `benchmarks_eth` / `benchmarks_sol` ingestion pipelines (`benchmark.py` rejects ETH/SOL with ValueError today)
- **Monte Carlo simulation panels** — qstats has them but defer; not in plan
- **Mobile-responsive polish** — Sprint 13+ (desktop-only acceptable for institutional product per PROJECT.md)

## Out of Scope (explicit exclusions with reasoning)

- **Manager Workspace IA** (5-tab, Inbox, Threads, Mandate doc, Activity log, Tear-sheet cron) — v0.18.0.0 milestone, not v0.17. Splitting keeps Sprint 12 focused on allocator-facing depth before manager-facing breadth.
- **Multi-benchmark (ETH/SOL) correlation matrix** — UC#6 descope; needs new ingestion pipeline. Renders Panel 7 correlation as "Correlation with BTC" instead.
- **Plotly dependencies / Plotly modebar / dark crypto-dark theme / yellow-lime accents** — DESIGN.md anti-features; we are explicitly NOT cloning Quants.Space's dark theme or Plotly chrome.
- **Sparkline split green/red coloring** — DIFF-05 rule; single-accent only.
- **LLM-generated commentary** — PROJECT.md constraint (no LLM). All commentary deterministic.
- **Mobile-responsive polish for `/strategy/[id]/v2`** — desktop-only acceptable.
- **Decorative animations** (bounce, scroll-triggered, framer-motion flourishes on KPI panels) — DESIGN.md "Minimal-functional only" motion rule.
- **Per-deck multi-strategy bundle editor** — PROJECT.md Out of Scope.
- **"Customize Table columns" tab in Customize panel** — defer; default columns are fine for v0.17. Anti-feature ANTI-14.
- **New top-level `mandate_fit` weight** — composed inside existing scoring engine.
- **Widget-count metric on the milestone gate** — success is the qstats parity side-by-side check and axe-core green, not "N widgets live".

## Migration disposition

| Migration | Decision | Why |
|-----------|----------|-----|
| 001 (`strategies.is_example`) | Reuse | Already declared at line 64; Phase 13 only needs data backfill `UPDATE strategies SET is_example=true WHERE id IN (<seed UUIDs>)` — no DDL |
| 001 (`strategy_analytics.daily_returns JSONB`) | Reuse | Column already declared at line 92, never populated; Phase 12 (METRICS-04) starts populating |
| 006 (`strategies.organization_id` FK) | Reuse | FK + index already shipped Sprint 6; DISCO-03 filter UI gated on Phase 13-internal audit |
| 024 (`user_favorites` table) | Reuse | Watchlist schema with full RLS; DISCO-01 wires UI |
| 026 (`is_org_member` SECURITY DEFINER) | Reuse | Recursion-safe RLS helper available if needed |
| NEW (Phase 12) | `086_compute_jobs_priority.sql` (priority enum + partial index) | Pitfall 10 mitigation; required for METRICS-14 throttled backfill |
| NEW (Phase 12) | `087_strategy_analytics_series.sql` (sibling-table for heavy series) | Pitfall 5 mitigation; replaces path-extraction-only fallback |
| NEW (Phase 12) | OPTIONAL: `metrics_json_version INT` on `strategy_analytics` | If METRICS-14 throttled backfill needs version-gating for re-enqueue logic. Decision pending Phase 12 plan-phase. |
| NEW (Phase 13, conditional) | `088_organizations_is_public.sql` (privacy gate) | Pitfall 18 mitigation; only ships if `organization_id` audit returns >0 published strategies |

**Net-new migrations expected:** 2–3 (one hard: priority enum; one hard: sibling-table for heavy series; one conditional: organizations.is_public gated by audit; one optional: metrics_json_version).

---

## Traceability

Coverage: **53 / 53** v0.17.0.0 requirements mapped (filled by gsd-roadmapper 2026-04-26; revised post cross-AI review 2026-04-26 — Phase 14 split into 14a + 14b, KPI-23 split into KPI-23a/KPI-23b, METRICS-16/17 added).

| Requirement | Category | Phase | Status |
|-------------|----------|-------|--------|
| DISCO-01 | DISCO | Phase 13 | Pending |
| DISCO-02 | DISCO | Phase 13 | Pending |
| DISCO-03 | DISCO | Phase 13 | Pending (gated on org-id audit; conditional migration 088_organizations_is_public.sql) |
| DISCO-04 | DISCO | Phase 13 | Pending |
| DISCO-05 | DISCO | Phase 13 | Pending |
| KPI-01 | KPI | Phase 14a | Pending |
| KPI-02 | KPI | Phase 14a | Pending |
| KPI-03 | KPI | Phase 14a | Pending |
| KPI-04 | KPI | Phase 14a | Pending |
| KPI-05 | KPI | Phase 14a | Pending |
| KPI-06 | KPI | Phase 14b | Pending |
| KPI-07 | KPI | Phase 14b | Pending |
| KPI-08 | KPI | Phase 14b | Pending |
| KPI-09 | KPI | Phase 14b | Pending |
| KPI-10 | KPI | Phase 14b | Pending |
| KPI-11 | KPI | Phase 14b | Pending |
| KPI-12 | KPI | Phase 14b | Pending |
| KPI-13 | KPI | Phase 14b | Pending |
| KPI-14 | KPI | Phase 14b | Pending |
| KPI-15 | KPI | Phase 14b | Pending |
| KPI-16 | KPI | Phase 14b | Pending |
| KPI-17 | KPI | Phase 14b | Pending (gated on is_maker audit Binance/OKX/Bybit; Deribit excluded) |
| KPI-18 | KPI | Phase 14b | Pending |
| KPI-19 | KPI | Phase 14b | Pending |
| KPI-20 | KPI | Phase 14b | Pending |
| KPI-21 | KPI | Phase 14b | Pending |
| KPI-22 | KPI | Phase 14a | Pending (shell + IntersectionObserver scaffold; bodies for panels 4–7 in 14b) |
| KPI-23a | KPI | Phase 14a | Pending (panels 1–3 partial-data) |
| KPI-23b | KPI | Phase 14b | Pending (panels 4–7 partial-data) |
| METRICS-01 | METRICS | Phase 12 | ✅ Complete 2026-04-28 (Plan 12-03): MAR + `_rolling_sortino` shipped in metrics.py; QS-mirror RMS downside formula; Pitfall 11 parity diff=1.11e-16 at window==period |
| METRICS-02 | METRICS | Phase 12 | ✅ Complete 2026-04-28 (Plan 12-03): `_rolling_volatility` shipped in metrics.py; std × sqrt(252) |
| METRICS-03 | METRICS | Phase 12 | ✅ Complete 2026-04-28 (Plan 12-03): `_rolling_alpha` + `_rolling_beta` shipped in metrics.py; wrap qs.stats.rolling_greeks(window=90) |
| METRICS-04 | METRICS | Phase 12 | ✅ Complete 2026-04-28 (Plan 12-04): `_daily_returns_grid_from_series` shipped in metrics.py; D-03 flat per-day shape mirroring monthly grid template |
| METRICS-05 | METRICS | Phase 12 | ✅ Complete 2026-04-28 (Plan 12-04): `compute_exposure_metrics` refactored to also emit `exposure_series: [{date, gross, net}]` alongside existing aggregates; no caller breakage |
| METRICS-06 | METRICS | Phase 12 | ✅ Complete 2026-04-28 (Plan 12-04): `compute_turnover_series` shipped with explicit Pitfall #19 docstring + T-12-04-02 zero-NAV short-circuit |
| METRICS-07 | METRICS | Phase 12 | ✅ Complete 2026-04-28 (Plan 12-05): `_compute_derived_trade_metrics` shipped via B-01 path (b) — NEW function in analytics_runner.py consumes both volume-side and extended position-side dicts; produces expectancy, risk_reward_ratio, weighted_risk_reward_ratio (H-F), profit_factor_long, profit_factor_short; reconstruct_positions extended with avg_winning_trade / avg_losing_trade / winners_count / losers_count / realized_pnl_per_trade |
| METRICS-08 | METRICS | Phase 12 | ✅ Complete 2026-04-28 (Plan 12-05): SQN computed inside `_compute_derived_trade_metrics` over per-trade R-multiples (R = realized_pnl / \|avg_loss\|); sample variance N-1 denominator; None when fewer than 2 trades or zero std (T-12-05-03 divisor guard) |
| METRICS-09 | METRICS | Phase 12 | ✅ Complete 2026-04-28 (Plan 12-05): `_compute_volume_aggregator(fills)` shipped in analytics_runner.py; produces gross_volume_usd, mean_trade_size_usd, daily_turnover_usd, monthly_turnover_usd; groups by `filled_at`/`created_at` date / month prefix |
| METRICS-10 | METRICS | Phase 12 | ✅ Complete 2026-04-28 (Plan 12-05): `_compute_trade_mix(fills, has_maker_taker)` shipped in analytics_runner.py; branches off D-15 audit flag — 4-bucket happy path / 2-bucket fallback (current production = 2-bucket per TODOS.md); T-12-05-04 mitigation skips fills missing is_maker in 4-bucket mode |
| METRICS-11 | METRICS | Phase 12 | ✅ Complete 2026-04-28 (Plan 12-04): `compute_qstats_scalars` shipped with all 10 scalars (recovery_factor, ulcer_index, upi, kelly_criterion, probabilistic_sharpe_ratio, common_sense_ratio, cpc_index, serenity_index, r_squared, time_in_market); per-call try/except routed through `_safe_float` |
| METRICS-12 | METRICS | Phase 12 | ✅ Complete 2026-04-28 (Plan 12-03): `_log_returns_series` shipped in metrics.py; np.log1p via _finalize_rolling; full-length output |
| METRICS-13 | METRICS | Phase 12 | ✅ Complete 2026-04-28 (Plan 12-09): `regen_golden.py` + 3 fixture files + `test_metrics_parity.py` (5/5) + `metrics-parity-helper.ts` + `metrics-parity.test.ts` (5/5). Python math gate (D-11 hybrid tolerance with M-Grok-2 epsilon fallback + H-C signed-zero/NaN handling); TS schema gate (Reading A per RESEARCH.md §9.3 — sibling-kind whitelist + D-16 frozen `trade_metrics` keys + dynamic sibling-count threshold via `EXPECTED_SIBLING_KINDS.size`); D-12 fail-loud on key drift; H-A1/H-D/H-F invariants enforced |
| METRICS-14 | METRICS | Phase 12 | ✅ Complete 2026-04-28 (Plan 12-07): dispatch_tick now calls claim_compute_jobs_with_priority (migration 086); throttle lives in claim path per RESEARCH.md §5d; Phase 12 SC#4 met. |
| METRICS-15 | METRICS / Phase 14a | Phase 12 + 14a | Partial — Plan 12-08 (✅ 2026-04-28) shipped consumer half (fetchStrategyLazyMetrics + LazyMetricsPanelId in src/lib/queries.ts); path-extraction half (getStrategyDetail rewrite) remains Phase 14a |
| METRICS-16 | METRICS | Phase 12 | ✅ Complete 2026-04-28 (Plan 12-02): migration 086_compute_jobs_priority.sql shipped to remote; claim_compute_jobs_with_priority RPC ready; consumer switch in Plan 12-07 |
| METRICS-17 | METRICS | Phase 12 | ✅ Complete 2026-04-28 (Plan 12-02): migration 087_strategy_analytics_series.sql shipped to remote (table + RLS deny-all + fetch_strategy_lazy_metrics + upsert_strategy_analytics_series_batch RPCs); consumer wiring in Plans 12-06/08/10 |
| DESIGN-01 | DESIGN | Phase 14a | Pending |
| DESIGN-02 | DESIGN | Phase 14a | Pending |
| DESIGN-03 | DESIGN | Phase 14a | Pending |
| A11Y-01 | A11Y | Phase 14a | Pending (panels 1–3 + identity baseline) |
| A11Y-02 | A11Y | Phase 14b | Pending (axe-core CI on all 7 panels) |
| A11Y-03 | A11Y | Phase 14b | Pending (keyboard nav across full 7-panel scroll) |
| CLEANUP-01 | CLEANUP | Phase 14a | Pending |

**Coverage breakdown by phase:**
- Phase 12 (Backend Metric Contracts): 17 REQs (METRICS-01..17)
- Phase 13 (Discovery v2 Polish): 5 REQs (DISCO-01..05)
- Phase 14a (Single-Strategy v2 — Eager Panels + Identity): 12 REQs (KPI-01..05 + KPI-22 + KPI-23a + DESIGN-01..03 + A11Y-01 + CLEANUP-01)
- Phase 14b (Single-Strategy v2 — Lazy Panels + Trade & Exposure): 19 REQs (KPI-06..21 + KPI-23b + A11Y-02 + A11Y-03)
- **Total: 53 / 53 REQs mapped — 100% coverage, no orphans, no duplicates.**

---

*v0.17.0.0 Sprint 12 — KPI Parity and Discovery v2*
*Generated 2026-04-26 from `~/.claude/plans/strategy-teams-kpi-parity.md` + research outputs in `.planning/research/`*
*Scope: full qstats parity (allocator-facing only) per user direction "ship all panels, full quantstats" 2026-04-26*
*Team-side workspace deferred to v0.18.0.0; multi-benchmark (ETH/SOL) deferred to Sprint 13+*
*Traceability filled by gsd-roadmapper 2026-04-26: Phase 12 ‖ Phase 13 (Wave 1) → Phase 14a (Wave 2 eager) → Phase 14b (Wave 3 lazy).*
*Revised 2026-04-26 post cross-AI review (fresh Claude + Grok-4-1-fast): 6 convergent fixes applied — Phase 14 split into 14a + 14b, is_maker audit rescoped to 3 exchanges, METRICS-16 (priority enum) + METRICS-17 (sibling table) promoted to hard deliverables, success criteria tightened with automated checks, organizations.is_public conditional gate added for DISCO-03.*
