# Roadmap: Quantalyze

## Milestones

- ✅ **v0.14.0.0 Sprint 8: Bridge V2** — Phases 1–5 (shipped 2026-04-19) → [archive](milestones/v0.14.0.0-ROADMAP.md)
- ✅ **v0.15.0.0 Sprint 9: Demo-to-Production** — Phases 06–10 + 09.1 (shipped 2026-04-27) → [archive](milestones/v0.15.0.0-ROADMAP.md)
- ✅ **v0.16.0.0 Phase 11: Onboarding & Security Readiness** — Phase 11 (shipped 2026-04-27) → [archive](milestones/v0.16.0.0-MILESTONE-AUDIT.md)
- 🚧 **v0.17.0.0 Sprint 12: KPI Parity and Discovery v2** — Phases 12–14 (planning 2026-04-26; Phase 14 split into 14a + 14b post cross-AI review)

## Phases

<details>
<summary>✅ v0.14.0.0 Sprint 8: Bridge V2 (Phases 1–5) — SHIPPED 2026-04-19</summary>

- [x] Phase 1: Outcome Tracker (4/4 plans) — completed 2026-04-18
- [x] Phase 2: Mandate Profile Builder (2/2 plans) — completed 2026-04-18
- [x] Phase 3: Mandate-Aware Scoring Engine (2/2 plans) — completed 2026-04-18
- [x] Phase 4: Feedback Loop (1/1 plan) — completed 2026-04-19
- [x] Phase 5: Outcomes Dashboard (1/1 plan) — completed 2026-04-19

See `milestones/v0.14.0.0-ROADMAP.md` for full phase details, success criteria, and decisions.

</details>

<details>
<summary>✅ v0.15.0.0 Sprint 9: Demo-to-Production (Phases 06–10 + 09.1) — SHIPPED 2026-04-27</summary>

- [x] Phase 06: Allocator API Ingestion (4/4 plans) — completed 2026-04-21
- [x] Phase 07: Demo-Mode Purge (6/6 plans) — completed 2026-04-20
- [x] Phase 08: Connection Management and Notes (5/5 plans) — completed 2026-04-21
- [x] Phase 09: Bridge Live Against Real Holdings (4/4 plans) — completed 2026-04-21
- [x] Phase 09.1: Allocator Dashboard UI refresh (11/11 plans) — completed 2026-04-24
- [x] Phase 10: Scenario Builder and What-If (8/8 plans) — completed 2026-04-26

See `milestones/v0.15.0.0-ROADMAP.md` for full phase details, success criteria, and decisions. Audit: `milestones/v0.15.0.0-MILESTONE-AUDIT.md` (PASSED, 27/27 requirements). Integration: `milestones/v0.15.0.0-INTEGRATION-CHECK.md` (6/6 wiring PASS, 0 findings).

</details>

<details>
<summary>✅ v0.16.0.0 Phase 11: Onboarding & Security Readiness — SHIPPED 2026-04-27</summary>

- [x] Phase 11: Onboarding and Security Readiness (7/7 plans) — completed 2026-04-26

See `milestones/v0.16.0.0-MILESTONE-AUDIT.md` for full phase details, success criteria, and decisions (audit: PASSED, 6/6 ONBOARD-XX requirements).

</details>

## Phase Details

### 🚧 v0.17.0.0 Sprint 12: KPI Parity and Discovery v2 (Phases 12, 13, 14a, 14b)

**Milestone goal:** Every allocator-facing strategy surface (Discovery list + Single-Strategy detail) reaches **full qstats parity** in Quantalyze identity. Every metric `qs.reports.html()` produces — every scalar and every chart — has a Quantalyze equivalent rendered in DESIGN.md identity. Discovery v2 mirrors Quants.Space's IA (card/table toggle, Customize panel, Watchlist, hide-examples, sort dropdowns, filter-by-team).

**Success gate (single E2E):** open `qs.reports.html()` for any 1-year daily series and our `/strategy/[id]/v2` side-by-side; **every metric named, every chart type present, no metric missing**, in our DESIGN.md identity (white card, accent series #1B6B5A, DM Sans / Geist Mono tabular-nums, no Plotly chrome). Plus axe-core green on Discovery v2 + Single-Strategy v2.

**Wave structure (compresses 4 phases to 3 cycles):**
- Wave 1 (parallel — independent code surfaces; Python analytics-service vs TypeScript Discovery): Phase 12 (METRICS backend) ‖ Phase 13 (DISCO Discovery v2)
- Wave 2 (sequential — UI consumes Phase 12's new JSONB keys + sibling table): Phase 14a (eager panels 1–3 + identity baseline + 7-panel scrollable shell)
- Wave 3 (sequential after 14a): Phase 14b (lazy panels 4–7 — Returns Distribution / Rolling / Trade & Exposure / Greeks; axe-core CI; full keyboard nav)

**Net session estimate:** ~8.0 sessions (Phase 12: 4.0, Phase 13: 0.5, Phase 14a: 2.0, Phase 14b: 1.5).

- [x] **Phase 12: Backend Metric Contracts** — `metrics.py` extensions (rolling Sortino/Vol/Greeks series, daily_returns_grid, exposure_series, turnover_series, 7 derived trade metrics, SQN, volume aggregator, Trade Mix maker/taker (audit-gated, Binance/OKX/Bybit only — Deribit excluded), 10 new scalars, log_returns_series, cross-runtime parity tests, throttled backfill via `compute_jobs.priority` enum (METRICS-16, migration 086), heavy-series sibling table `strategy_analytics_series` (METRICS-17, migration 087), JSONB path-extraction)
- [ ] **Phase 13: Discovery v2 Polish** — Watchlist UI on `user_favorites`, per-user-keyed localStorage Customize prefs, filter-by-team (audit-gated; conditional migration 088 `organizations.is_public`), single-accent sparkline rule, `is_example=true` data backfill on seed strategies
- [ ] **Phase 14a: Single-Strategy v2 — Eager Panels + Identity** — `/strategy/[id]/v2` route + flag, 7-panel scrollable shell with placeholders for panels 4–7 (IntersectionObserver scaffold), eager bodies for Panels 1–3 (Overview / Headline+Equity / Drawdown), DESIGN.md identity audit, A11Y-01 chart-axis contrast token, partial-data states for panels 1–3, `@nivo/boxplot` cleanup
- [ ] **Phase 14b: Single-Strategy v2 — Lazy Panels + Trade & Exposure** — bodies for Panels 4–7 (Returns Distribution / Rolling / Trades / Exposure+Greeks), DailyHeatmap SVG/Canvas fallback, Trade Mix maker/taker (audit-gated close-out), partial-data states for panels 4–7, axe-core CI on full route, keyboard navigation across the full 7-panel scroll, automated chart-snapshot parity (Playwright pixel-diff ±2%)

### Phase 12: Backend Metric Contracts
**Goal:** `metrics.py` produces every scalar and series the v0.17 7-panel UI needs — rolling Sortino/Vol/Greeks series, daily-returns grid, exposure & turnover series, full trade-table aggregations, 10 missing qstats scalars, log-returns series — written into already-declared JSONB columns + new `strategy_analytics_series` sibling table for heavy series, with parity-tested cross-runtime correctness, throttled backfill via priority enum, and JSONB row-size discipline.
**Depends on:** Nothing (independent of Phase 13; foundation for Phase 14a/14b — must complete before Phase 14a panels can render).
**Requirements:** METRICS-01, METRICS-02, METRICS-03, METRICS-04, METRICS-05, METRICS-06, METRICS-07, METRICS-08, METRICS-09, METRICS-10, METRICS-11, METRICS-12, METRICS-13, METRICS-14, METRICS-15, METRICS-16, METRICS-17
**Success Criteria** (what must be TRUE):
  1. Calling `compute_all_metrics()` against the golden 252-day fixture produces every new series (`rolling_sortino_3m/6m/12m`, `rolling_volatility_3m/6m/12m`, `rolling_alpha`, `rolling_beta`, `daily_returns_grid`, `exposure_series`, `turnover_series`, `log_returns_series`) — heavy series stored in `strategy_analytics_series` (kind, payload), medium scalars in `metrics_json` — and all 10 new scalars (Recovery Factor, Ulcer Index, UPI, Kelly Criterion, Probabilistic Sharpe, Common Sense Ratio, CPC Index, Serenity Index, R² vs BTC, Time-in-Market) inside `metrics_json` — no NULLs.
  2. The cross-runtime parity test (`test_metrics_parity.py` + `metrics-parity.test.ts`) asserts byte-identical JSON between Python `metrics.py` output and the TS-side reader on the 252-day fixture; CI fails on any drift.
  3a. `pg_column_size(metrics_json)` p99.9 across all published strategies post-backfill < 800kB; CI runs `analyze_metrics_size.sql` weekly; if p99.9 ≥ 800kB at any strategy, kill-switch triggers (emergency cutover migrates remaining heavy keys from `metrics_json` to `strategy_analytics_series` sibling table — automated via Phase 12 deploy script).
  3b. `getStrategyDetail()` Postgres path-extraction (`metrics_json -> '<key>'`) p95 latency for above-the-fold scalars (CAGR / Sharpe / Sortino / Max DD / Vol / equity_series_1y) < 50ms.
  3c. Lazy-fetch RPC for panels 4–7 series (`fetch_strategy_lazy_metrics(strategy_id, panel_id)`) p95 < 200ms.
  4. Live `sync_trades` jobs do not queue behind backfill on Phase 12 deploy: migration `086_compute_jobs_priority.sql` ships the `priority` enum (`low`/`normal`/`high`) with partial index, the throttled enqueuer in `job_worker.py` reads priority and caps backfill jobs at 5/min when both backfill and sync jobs are queued, and a dashboard probe confirms `compute_analytics` queue depth never exceeds 50 for >10 min during the rollout window.
  5. The Phase 12-internal `is_maker` audit on `raw_fills` (Binance / OKX / Bybit handlers — Deribit excluded by design: `analytics-service/services/exchange.py:325-334` confirms `fetch_raw_trades` does not dispatch to Deribit, documented as N/A in TODOS.md before plan-phase begins) returns a documented boolean per exchange; if any of the three handlers lacks the flag, METRICS-10 + KPI-17 are descoped to v0.17.1 with a TODOS.md entry, and the parity test does not regress.
**Plans:** 10 plans
- [x] 12-01-PLAN.md — is_maker audit + D-15 branch decision (Wave 1) — completed 2026-04-28 (TRADE_MIX_HAS_MAKER_TAKER=false, 2-bucket fallback)
- [x] 12-02-PLAN.md — Migrations 086 + 087 + types regen + frozen TS contracts (Wave 2, BLOCKING schema push) — completed 2026-04-28 (D-16 frozen contract locked; H-B search_path hardening on all RPCs; H-D equity_series_1y omitted from sibling-kind union; H-F weighted_risk_reward_ratio in TradeMetrics)
- [ ] 12-03-PLAN.md — Rolling Sortino/Vol/Greeks + log returns helpers in metrics.py (Wave 3, TDD)
- [ ] 12-04-PLAN.md — Daily returns grid + exposure series persistence + turnover series + 10 qstats scalars (Wave 3, TDD)
- [ ] 12-05-PLAN.md — 5 derived trade metrics + volume aggregator + audit-gated Trade Mix (Wave 3, TDD)
- [ ] 12-06-PLAN.md — MetricsResult dataclass + sibling-table loop upsert in run_strategy_analytics (Wave 4)
- [ ] 12-07-PLAN.md — Switch dispatch_tick to claim_compute_jobs_with_priority (Wave 5, TDD)
- [ ] 12-08-PLAN.md — fetchStrategyLazyMetrics RPC consumer in queries.ts (Wave 5)
- [ ] 12-09-PLAN.md — regen_golden + 3 fixtures + Python + TS parity tests (Wave 6, TDD)
- [ ] 12-10-PLAN.md — analyze_metrics_size + kill-switch + backfill enqueue + deploy orchestrator (Wave 7)
**Complexity:** High — pure additive math but ships against a 1MB TOAST ceiling, requires throttled backfill orchestration via priority-enum migration, mounts a sibling-table for heavy series, and mounts a cross-runtime byte-identical contract.

### Phase 13: Discovery v2 Polish
**Goal:** `/discovery/[slug]` reaches IA parity with Quants.Space — Watchlist sub-tab, per-user-keyed Customize prefs in localStorage, single-accent sparkline rule, default "Hide examples" backed by a seed-row data backfill, and (audit-gated) filter-by-team with privacy gate via `organizations.is_public` — without touching the Python analytics service.
**Depends on:** Nothing (independent of Phase 12; ships in parallel).
**Requirements:** DISCO-01, DISCO-02, DISCO-03, DISCO-04, DISCO-05
**Success Criteria** (what must be TRUE):
  1. An allocator can star any strategy from any row or card on `/discovery/[slug]`; "My Watchlist" sub-tab appears alongside "All" with a count badge, the star toggle is idempotent under rapid double-click (PUT `/api/watchlist/[strategyId]`), and reload preserves the watched set on `user_favorites`.
  2. Customize prefs (Default view / Default sort / Hide examples) persist in `localStorage["discovery_view_preferences:{auth.uid}:{slug}"]` keyed by user; a Playwright spec proves login-as-A-then-login-as-B leaves no A-keys in B's localStorage.
  3. Sparklines on every Discovery row + card render with a single accent color across the trace — `#1B6B5A` when final value > 0, `#DC2626` when final value < 0, `#94A3B8` when zero — and a visual snapshot regression catches any future split-color reintroduction.
  4. The Phase 13-internal `organization_id` population audit (single SQL: `SELECT COUNT(*) FROM strategies WHERE organization_id IS NOT NULL AND status='published'`) is documented in TODOS.md; if the count is 0, DISCO-03 (filter-by-team UI) is explicitly deferred to v0.18 with a TODOS entry; if non-zero, migration `088_organizations_is_public.sql` ships (adds `is_public BOOLEAN DEFAULT false`), the dropdown reads only `WHERE is_public = true` (default-false avoids leaking private/stealth fund names; managers opt-in via `/strategies/team` settings deferred to v0.18; managers can be flipped to public manually via admin during v0.17 if needed), and surfaces only orgs whose strategies are visible to the allocator.
  5. Seed-fixture strategies have `is_example=true` after a data-only `UPDATE strategies SET is_example=true WHERE id IN (<seed UUIDs>)` migration and the Customize default is "Hide examples = ON" — a fresh allocator's first Discovery visit shows zero example strategies.
**Plans:** 4 plans (DISCO-03 deferred to v0.18 — see TODOS.md, audit returned count=0 on 2026-04-28)
- [ ] 13-01-PLAN.md — DISCO-01 Watchlist (StarToggle + WatchlistTabs + PUT /api/watchlist + getMyWatchlist + StrategyTable/Grid extensions + e2e/discovery-watchlist.spec.ts) (Wave 1)
- [ ] 13-02-PLAN.md — DISCO-02 Customize prefs (useDiscoveryPrefs hook + CustomizeDrawer right-edge slide-out + StrategyFilters cog swap + cross-account isolation Playwright) (Wave 2)
- [ ] 13-04-PLAN.md — DISCO-04 Sparkline single-accent rule (sparklineColor helper at the two call sites + visual regression Playwright) (Wave 3)
- [ ] 13-05-PLAN.md — DISCO-05 is_example backfill (data-only migration 089 + supabase db push gate + fresh-allocator E2E) (Wave 4)
**UI hint**: yes
**Complexity:** Low — schema is fully shipped (no DDL beyond a single data-only DML at migration 089), `CustomizeModal` and view-mode toggle exist; real work is Watchlist UI wire-up + localStorage scoping + sparkline-color call-site rule.

### Phase 14a: Single-Strategy v2 — Eager Panels + Identity
**Goal:** `/strategy/[id]/v2` (and flag-default-on at `/discovery/[slug]/[strategyId]`) ships the 7-panel scrollable shell + eager bodies for Panels 1–3 (Overview / Headline+Equity / Drawdown) in DESIGN.md identity, with placeholders for panels 4–7 lazy-mounted via IntersectionObserver but bodies deferred to Phase 14b. Identity baseline (chart contrast tokens, tabular-nums style, `@nivo/boxplot` removed) lands here so Phase 14b inherits a clean foundation.
**Depends on:** Phase 12 (eager panels read scalars from `metrics_json` + `equity_series_1y` via path-extraction; placeholders show "Loading..." until 14b fills bodies).
**Requirements:** KPI-01, KPI-02, KPI-03, KPI-04, KPI-05, KPI-22, KPI-23a, DESIGN-01, DESIGN-02, DESIGN-03, A11Y-01, CLEANUP-01
**Success Criteria** (what must be TRUE):
  1. Automated qstats fixture parity check passes — `analytics-service/tests/fixtures/golden_252d.json` runs through `metrics.py` AND `qs.reports.metrics()`; JSON canonicalized (sorted keys, ROUND_HALF_EVEN to 6 decimals); diff utility asserts every qstats scalar named in our output, with values within ε=1e-6 of qstats output. CI fails on any drift.
  2. WCAG-AA contrast verified on every chart axis text rendered in panels 1–3 — `tests/a11y/chart-contrast.test.ts` asserts `getContrastRatio(CHART_AXIS_TICK, "#FFFFFF") >= 4.5` and forbids `#94A3B8`/`#718096` as text fill on any axis label / tick / legend within `/strategy/[id]/v2`.
  3. The 7-panel scrollable shell renders with exactly 7 top-level `<section data-panel>` elements (`tests/visual/strategy-v2-panel-count.test.ts`); panels 1–3 show their full eager bodies (Overview cards / Headline + Equity vs BTC overlay / Drawdown + Worst 5 Drawdowns), panels 4–7 show "Loading..." placeholders mounted lazily via IntersectionObserver scaffold ready for Phase 14b body landing.
  4. Per-panel partial-data states render gracefully across history bands for panels 1–3 — Playwright spec covers 7-day / 30-day / 90-day / 365-day synthetic histories, asserts each of panels 1–3 shows its documented "Awaiting more data (need ≥X days)" copy or its full-data render, never crashes, and never hides a panel (preserves layout shape).
  5. `@nivo/boxplot` is removed from `package.json`; `npm run build` produces a smaller bundle (~80KB gzipped saved); DESIGN.md decisions log carries the UC#7 7-panel density-rule deviation entry; PR-template includes the per-chart identity checklist.
**Plans:** 6 plans
- [ ] 14a-01-PLAN.md — chart-tokens CHART_TICK_STYLE extension + EquityCurve DESIGN-01 hex audit (Wave 1)
- [ ] 14a-02-PLAN.md — getStrategyDetailV2 path-extraction + strategy-ui-v2-flag reader (Wave 1)
- [ ] 14a-03-PLAN.md — useLazyPanelMetrics hook + 7 strategy-v2 components (StrategyV2Shell + 6 panels/banner/control) (Wave 2)
- [ ] 14a-04-PLAN.md — /strategy/[id]/v2 route page.tsx + error.tsx (Wave 2)
- [ ] 14a-05-PLAN.md — vitest config + IntersectionObserver stub + 3 Vitest tests + Playwright partial-data spec (Wave 3)
- [ ] 14a-06-PLAN.md — @nivo/boxplot uninstall + DESIGN.md decisions log + .github/PULL_REQUEST_TEMPLATE.md (Wave 3)
**UI hint**: yes
**Complexity:** Medium — visual contract is unforgiving on the eager half + identity baseline; `is_maker`-gated Trade Mix sub-panel deferred to 14b; lazy scaffolding is the load-bearing piece.

### Phase 14b: Single-Strategy v2 — Lazy Panels + Trade & Exposure
**Goal:** Bodies for Panels 4–7 (Returns Distribution / Rolling Sharpe-Vol-Sortino-Greeks / Trades / Exposure+Greeks) land inside the Phase 14a scrollable shell, lazy-mounted via the IntersectionObserver scaffold. Trade Mix maker/taker close-out (audit-gated on Binance/OKX/Bybit `is_maker` flag), DailyHeatmap SVG/Canvas fallback, axe-core CI on the full route, full keyboard navigation, and automated chart-snapshot parity diff complete the qstats parity contract.
**Depends on:** Phase 12 (consumes new JSONB keys for rolling series + heavy-series sibling-table reads via `fetch_strategy_lazy_metrics(strategy_id, panel_id)`); Phase 14a (shell + IntersectionObserver scaffold + identity baseline must be live).
**Requirements:** KPI-06, KPI-07, KPI-08, KPI-09, KPI-10, KPI-11, KPI-12, KPI-13, KPI-14, KPI-15, KPI-16, KPI-17, KPI-18, KPI-19, KPI-20, KPI-21, KPI-23b, A11Y-02, A11Y-03
**Success Criteria** (what must be TRUE):
  1. Automated chart-snapshot parity passes — Playwright renders all 7 panels against the golden 252-day fixture; pixel-diff tolerance ±2% on sparkline / line-chart canvases; structural assertions verify each chart has 1 strategy series + ≤1 BTC benchmark series + correct identity tokens (CHART_AXIS_TICK = #64748B, accent = #1B6B5A). Visual regression baseline saved for v0.17.1 follow-ups.
  2. axe-core integration tests against `/discovery/[slug]` + `/strategy/[id]/v2` (full route — all 7 panels mounted) pass green in CI on every PR; keyboard navigation verified on Customize drawer, Watchlist tab toggle, full 7-panel scroll, and EquityCurve segmented control; focus order documented in DX.
  3. DailyHeatmap renders the 5y fixture in <300ms — Playwright `performance.measure()` budget asserts panel-4 mount-to-paint stays under threshold; SVG path used for ≤365 cells, Canvas API single-draw fallback above 365 cells, IntersectionObserver-deferred paint on panels 4–7 inherited from 14a scaffold.
  4. Per-panel partial-data states render gracefully across history bands for panels 4–7 — Playwright spec covers 7-day / 30-day / 90-day / 365-day synthetic histories, asserts each of panels 4–7 shows its documented "Awaiting more data (need ≥X days)" copy or its full-data render, never crashes, and never hides a panel (preserves layout shape inherited from 14a).
  5. The `is_maker` audit close-out is documented: if Binance + OKX + Bybit all populate the flag, KPI-17 Trade Mix maker/taker breakdown ships in panel 6; if any of the three lacks the flag, KPI-17 + METRICS-10 are descoped to v0.17.1 with a TODOS.md entry, and the panel-count gate (=7) does not regress (the Trade Mix sub-panel is hidden, not the entire panel).
**Plans:** 8 plans
- [ ] 14b-01-PLAN.md — useLazyPanelMetrics real-fetch extension + DailyHeatmap dual SVG/Canvas component (Wave 1 foundation)
- [ ] 14b-02-PLAN.md — Panel 4 ReturnsDistributionPanel wrapper + DESIGN-01 audit on 4 existing chart components (Wave 2)
- [ ] 14b-03-PLAN.md — Panel 5 RollingMetricsPanel + 3 new rolling sub-charts (Volatility / Sortino / AlphaBeta) + shared 3M/6M/12M window toggle (Wave 2)
- [ ] 14b-04-PLAN.md — Panel 6 TradeAndPositionPanel + TradeMixSubPanel (2-bucket only) + MetricCell primitive (Wave 2)
- [x] 14b-05-PLAN.md — Panel 7 ExposureAndGreeksPanel + NetGrossExposureChart + TurnoverChart + BenchmarkGreeksTable (Wave 2)
- [ ] 14b-06-PLAN.md — StrategyV2Detail extension + StrategyV2Shell wiring + Panel 2 segmented control unlock (Rolling Sharpe + Log returns) (Wave 3)
- [ ] 14b-07-PLAN.md — @axe-core/playwright install + 4 new Playwright specs (axe x2 / keyboard / chart-parity) + skip-link mechanism + partial-data spec extension (Wave 4)
- [ ] 14b-08-PLAN.md — strategy.ui_v2 flag flip OFF→ON + PR template Pitfall 17 partial-data matrix + DESIGN.md decisions log entry (Wave 4 — milestone-final commit)
**UI hint**: yes
**Complexity:** High — six chart-component wave (DailyHeatmap, Rolling 4-series, Trade & Position aggregations, Exposure series, Turnover series, BTC correlation) plus `is_maker`-gated Trade Mix close-out plus axe-core green; mount-to-paint budget is tight on the 5y fixture.

## Structural decision: 6-phase roadmap (Option B)

**Chosen:** Option B — split LIVE (Phase 09) and SCENARIO (Phase 10) into separate phases.

**Rationale:** SCENARIO is a net-new product surface (tabbed `/allocations`, client-side projection engine, commit-to-Bridge flow) with 9 REQs that materially exceed what a shared phase with LIVE (5 REQs) could absorb — a combined 14-REQ phase would be roughly 2× the average phase size in this milestone (INGEST 9, PURGE 7, MANAGE 6, ONBOARD 6). Splitting lets each phase run its own `/gsd-discuss-phase` → `/gsd-plan-phase` → ship cycle with its own PR under `branching_strategy: none`, and lets LIVE (Bridge wire-up, smaller and well-scoped) ship independently so SCENARIO can build on a proven live-holdings Bridge instead of a paper one.

**Trade-off accepted:** 6 phases instead of 5 means one additional discuss/plan cycle — but each phase is now a clean discrete unit of work rather than a grab-bag.

## Structural decision: 4-phase wave structure for v0.17.0.0 (Option B-prime, post cross-AI review)

**Chosen:** Phase 12 ‖ Phase 13 (parallel Wave 1) → Phase 14a (Wave 2 eager) → Phase 14b (Wave 3 lazy).

**Rationale (original 3-phase):** Phase 12 (METRICS backend, Python analytics-service) and Phase 13 (DISCO Discovery v2, TypeScript discovery surface) touch zero overlapping files — independent code surfaces, independent test cohorts. Running them in parallel compresses the estimate by 2 phase cycles. Phase 14 strictly depends on Phase 12 (UI consumes the new JSONB keys), so it ships in Wave 2.

**Rationale for Phase 14 split into 14a + 14b (cross-AI review 2026-04-26):** The original Phase 14 carried 30 REQs in one phase. Both reviewers (fresh Claude subagent + Grok-4-1-fast-reasoning) flagged this as too dense for a single GSD plan-phase cycle, with the lazy panels (4–7) being a natural cleavage point — they share the same mount infrastructure (IntersectionObserver scaffold) but are independent of the eager half (panels 1–3). Splitting unlocks: (a) early visible win on eager panels + identity baseline (Phase 14a, 12 REQs), (b) Trade Mix `is_maker` audit close-out moves to 14b where it doesn't block the visual baseline shipping, (c) automated parity diff tools can be built once and reused — Phase 14a uses qstats fixture parity (scalar-level), Phase 14b uses Playwright pixel-diff (chart-level), (d) axe-core CI on the full route runs against the complete 7-panel mount in 14b after both eager and lazy bodies are present.

**Per-phase REQ load (post-split):** Phase 12 owns 17 REQs (METRICS-01..17, +METRICS-16/17 promoted from optional to hard deliverable), Phase 13 owns 5 REQs (DISCO-01..05), Phase 14a owns 12 REQs (KPI-01..05 + KPI-22 + KPI-23a + DESIGN-01..03 + A11Y-01 + CLEANUP-01), Phase 14b owns 19 REQs (KPI-06..21 + KPI-23b + A11Y-02 + A11Y-03).

**Trade-off accepted:** 4 phases instead of 3 means one additional discuss/plan cycle — but each phase is a clean discrete unit, the split unlocks earlier visible delivery on eager panels, and the lazy bodies in 14b can ship without re-litigating the visual baseline. Net session estimate moves from 6.5 to 8.0 sessions (Phase 14: 2.0 → 3.5).

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Outcome Tracker | v0.14.0.0 | 4/4 | Complete | 2026-04-18 |
| 2. Mandate Profile Builder | v0.14.0.0 | 2/2 | Complete | 2026-04-18 |
| 3. Mandate-Aware Scoring Engine | v0.14.0.0 | 2/2 | Complete | 2026-04-18 |
| 4. Feedback Loop | v0.14.0.0 | 1/1 | Complete | 2026-04-19 |
| 5. Outcomes Dashboard | v0.14.0.0 | 1/1 | Complete | 2026-04-19 |
| 06. Allocator API Ingestion | v0.15.0.0 | 4/4 | Complete    | 2026-04-21 |
| 07. Demo-Mode Purge | v0.15.0.0 | 6/6 | Complete | 2026-04-20 |
| 08. Connection Management and Notes | v0.15.0.0 | 5/5 | Complete    | 2026-04-21 |
| 09. Bridge Live Against Real Holdings | v0.15.0.0 | 4/4 | Complete    | 2026-04-21 |
| 09.1. Allocator Dashboard UI refresh | v0.15.0.0 | 11/11 | Complete | 2026-04-24 |
| 10. Scenario Builder and What-If | v0.15.0.0 | 8/8 | Complete | 2026-04-26 |
| 11. Onboarding and Security Readiness | v0.16.0.0 | 7/7 | Complete | 2026-04-26 |
| 12. Backend Metric Contracts | v0.17.0.0 | 10/10 | Complete | 2026-04-28 |
| 13. Discovery v2 Polish | v0.17.0.0 | 0/? | Not started | — |
| 14a. Single-Strategy v2 — Eager Panels + Identity | v0.17.0.0 | 0/? | Not started | — |
| 14b. Single-Strategy v2 — Lazy Panels + Trade & Exposure | v0.17.0.0 | 0/8 | Not started | — |
