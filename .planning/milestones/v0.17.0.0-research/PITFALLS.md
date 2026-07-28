# Domain Pitfalls — v0.17.0.0 KPI Parity & Discovery v2

**Domain:** Allocator-facing strategy surfaces (Discovery list + 7-panel single-strategy detail) + backend metric extensions (`metrics.py`)
**Researched:** 2026-04-26
**Scope:** Pitfalls specific to ADDING T7 + T8a + T8b to the existing v0.15/v0.16 codebase. Plan's FM-1..FM-7 are referenced — not duplicated. New pitfalls plan does NOT cover are flagged with **NEW**.

---

## Critical Pitfalls

### Pitfall 1: `is_example` already exists — duplicate column risk **NEW**
- **What goes wrong:** Plan T1 says "Add `strategies.is_example` flag (new column)." It is NOT new. `001_initial_schema.sql:64` declares `is_example BOOLEAN NOT NULL DEFAULT false` and the codebase already filters with it (`src/components/strategy/StrategyTable.tsx:131`, `StrategyGrid.tsx:50`, `scenarios/page.tsx:46`, `lib/types.ts:52`, `mock-data.ts:74`). Writing a "new" migration creates a duplicate column or a no-op (`ADD COLUMN IF NOT EXISTS` survives but ships dead migration noise; the bare `ADD COLUMN` form errors).
- **Why it happens:** Plan reviewers (CEO/Design/Eng/DX) all missed the existing column because StrategyTable has the filter wired but the toggle is allocator-default-OFF (line 131 strips examples by default).
- **Consequences:** Wasted migration, confusion about which column governs the filter, possible RLS drift if the new migration rewrites the policy.
- **Prevention:** **Skip the column migration entirely.** T1 deliverables become: (a) verify default `is_example=false` on every existing strategy row (one-line `SELECT count(*) WHERE is_example IS NULL OR is_example = true`), (b) add an index `CREATE INDEX IF NOT EXISTS idx_strategies_is_example_published ON strategies(is_example) WHERE status = 'published'` if discovery query plans show seq scans, (c) confirm the Discovery v2 toggle persists user choice (default ON per plan = "hide examples").
- **Detection:** PR diff shows ALTER TABLE strategies ADD is_example → block. Eng reviewer must run `grep -n is_example supabase/migrations/001_initial_schema.sql` before approving the schema PR.
- **Severity:** CRITICAL (blocks T1, T7)
- **Phase to address:** Phase 1 — Migrations

### Pitfall 2: `strategies.organization_id` FK exists but has zero query consumers **NEW**
- **What goes wrong:** Migration 006 added `strategies.organization_id` and an index (006:30, 006:83). `grep organization_id src/lib/queries.ts` returns 0 hits. The plan (T7 "Filter-by-team using existing `strategies.organization_id`") assumes the column is populated and read — it is not. Currently every published strategy has `organization_id IS NULL` and the existing RLS predicate `organization_id IS NULL AND status = 'published'` is the actual public-read path.
- **Why it happens:** Sprint 6 shipped the schema for organizations but never wired it to strategy creation. The wizard does not write `organization_id`. The factsheet does not read it. The plan's "filter-by-team UI" exposes a column whose values are all NULL.
- **Consequences:** Discovery v2's filter-by-team dropdown shows zero entries (or a single "Unknown" bucket). The promised IA parity with Quants.Space is invisible. Quietly populating `organization_id` post-hoc opens a tenant-leak window: a strategy that was public (`org_id IS NULL`) becomes org-scoped (`org_id = X`) and disappears for non-X allocators.
- **Prevention:**
  1. **Backfill audit before T7:** count strategies with non-NULL `organization_id` (expect 0). Decision tree:
     - If 0 strategies have an org: defer filter-by-team UI to v0.18 (when Sprint 12 deferred Manager Workspace lands and managers actually pick an org during strategy edit). T7's "filter-by-team" gets removed from scope.
     - If non-zero: verify each public strategy is intentionally non-public; otherwise the RLS predicate just hid that strategy from anonymous discovery.
  2. **Do NOT auto-create organizations during T7 backfill.** Auto-assigning every strategy to a sole-member org breaks the public-read fallback (org_id IS NULL → status=published) without UI to undo it.
- **Detection:** A vitest assertion in `src/lib/queries.test.ts`: `expect(distinct organization_ids on published strategies).toBeOneOf([0, expected_org_count])`. Block PR if the count is non-zero AND no allocator-facing UI surfaces the org name (would hide strategies silently).
- **Severity:** CRITICAL (T7 scope)
- **Phase to address:** Phase 0 — Pre-T1 audit; if backfill empty, drop "Filter-by-team" from T7

### Pitfall 3: 11px chart axis labels at `#94A3B8`/`#718096` fail WCAG AA on white **NEW**
- **What goes wrong:** Plan Section 7 specifies "Axis labels DM Sans 11px `#718096` (text-muted)" and "ticks Geist Mono 11px tabular-nums." `chart-tokens.ts:11` exports `CHART_TEXT_MUTED = "#94A3B8"` AND `CHART_AXIS_TICK = "#64748B"`. Approximate contrast ratios on white (#FFFFFF):
  - `#94A3B8` on white ≈ **2.85:1** — FAILS AA (4.5:1) and FAILS even 3:1 large-text rule
  - `#718096` on white ≈ **3.94:1** — FAILS AA 4.5:1 (passes 3:1 large-text rule, but 11px is NOT large)
  - `#64748B` on white ≈ **4.85:1** — PASSES AA (this is the existing `CHART_AXIS_TICK` value, which RollingMetrics.tsx already uses)
- **Why it happens:** Plan author copied the plan's body palette `#718096` (text-muted) into a chart spec without checking that chart-tokens.ts already settled this with the darker `#64748B`. Duplicate-token risk.
- **Consequences:** A11y audits flag every chart axis. Quants.Space parity claim doesn't include accessibility; Quantalyze's "institutional credibility" positioning takes the hit. Phase 2 design review explicitly scored a11y as 2/10 and called this out.
- **Prevention:**
  - **Never use `#94A3B8` or `#718096` on chart backgrounds for text.** Use the existing `CHART_AXIS_TICK` (`#64748B`) for all 11px axis text.
  - Reserve `#94A3B8` exclusively for the BTC benchmark line color (where it's a stroke, not text — strokes don't need WCAG text contrast; they need 3:1 against adjacent colors per WCAG 1.4.11).
  - Add a vitest asserting `getContrastRatio(CHART_AXIS_TICK, "#FFFFFF") >= 4.5` and `getContrastRatio("#94A3B8", "#FFFFFF") >= 3.0` (so any future palette swap surfaces the failure). Pure JS WCAG calc is ~30 lines.
- **Detection:** `tests/a11y/chart-contrast.test.ts` — fail CI if any chart token fails the threshold.
- **Severity:** CRITICAL (a11y, design integrity)
- **Phase to address:** Phase 2 — UI panels (T8b)

### Pitfall 4: Daily heatmap (1825+ SVG cells) renders without a virtualization fallback
- **What goes wrong:** Plan FM-5 mentions "downsample if > 1825 cells, render as virtualized canvas" but does not specify the trigger or the canvas implementation. A naïve port of the existing `MonthlyHeatmap.tsx` pattern (CSS grid + Fragment-per-cell, ~56 LoC) to daily resolution will mount 1825+ DOM nodes per render. With React 19's compiler and ResponsiveContainer's debounced re-measurements, every browser-window resize re-runs the cell colorizer 1825x.
- **Why it happens:** Existing `MonthlyHeatmap` works at 12 cells × N years (max ~120 cells for a 10-year strategy) — a CSS-grid div-per-cell approach is performant. The plan extends "the same pattern" to daily without quantifying the 15× cell-count blow-up.
- **Consequences:** Strategy detail page TTI on a 5-year history strategy degrades to >1s on mid-tier mobile. Vercel CWV degrades. Allocators notice scroll-jank when the heatmap mounts during scroll.
- **Prevention:**
  - **Decision rule baked into component:** if `cellCount > 365` → render via Canvas API (`<canvas>` + 2D context, single draw). If `cellCount <= 365` → SVG/grid like existing `MonthlyHeatmap`.
  - For Canvas path, use `requestAnimationFrame`-batched draws and `IntersectionObserver` to defer paint until panel scrolls into viewport.
  - **Bundle weight:** a 60-line canvas implementation adds zero deps. Avoid importing a heatmap library (echarts is ~1MB, d3-scale-chromatic adds ~100kB) — Recharts and lightweight-charts are already in the bundle (package.json:29, 37).
- **Detection:** Playwright + `performance.measure()` budget. Threshold: panel-4 mount-to-paint < 300ms on 5-year fixture.
- **Severity:** HIGH (perf, T8b panel 4)
- **Phase to address:** Phase 2 — UI panels (T8b)

---

## High-Severity Pitfalls

### Pitfall 5: Selective extraction from `metrics_json` JSONB — parsing cost on stale large blobs
- **What goes wrong:** Plan T8a/T8b assumes 7 panels read from `strategy_analytics.metrics_json` (single JSONB column). Each new metric (`daily_returns_grid`, `rolling_sortino_series`, `rolling_volatility_series`, `exposure_series`, `turnover_series`) appends to this blob. After T8a ships, a 5-year-history strategy's `metrics_json` could approach 1–3MB serialized JSON (1825 daily-grid cells + 3 rolling series × 1825 points + exposure + turnover + correlation + 30+ scalar metrics + drawdown_episodes). Default Supabase row size guidance is "keep JSONB under 1MB to avoid TOAST decompression latency."
- **Why it happens:** Existing pattern in `metrics.py:289-307` returns one fat dict; existing JSONB column is the destination. New series double the size without prompting a structural review.
- **Consequences:** Single-strategy page TTFB goes up on the worst-case strategies (oldest with most history). Server-component fetch parses a 2MB blob to extract panel 1's six numeric scalars.
- **Prevention:**
  - **Use Postgres JSON path-extraction in the strategy fetch:** instead of `select metrics_json from strategy_analytics where id=$1`, use `select metrics_json -> 'rolling_sortino_3m' as rolling_sortino_3m, metrics_json -> 'daily_returns_grid' as daily_returns_grid, ...`. Postgres returns only the path-projected slice.
  - **Or split heavy series to a sibling table:** `strategy_analytics_series (strategy_id, kind, payload jsonb)` keyed by `(strategy_id, kind)` with `kind IN ('daily_grid','rolling_sortino_3m',...)`. Panels can then fetch lazy on-tab-switch instead of all-at-once. Trade-off: more queries, less parsing.
  - Decision: panel-1 + panel-2 + panel-3 fetch eager (above-the-fold); panel-4..panel-7 lazy on scroll/tab.
- **Detection:** Add `pg_column_size(metrics_json)` to a vitest live-DB probe; warn if > 800kB; fail if > 1.5MB.
- **Severity:** HIGH (perf, T8a/T8b)
- **Phase to address:** Phase 1 — Backend contracts (T8a)

### Pitfall 6: 7 simultaneous chart mounts blow through `lightweight-charts` reflow budget
- **What goes wrong:** Plan T8b mounts a single-page wall of: 1× EquityCurve (lightweight-charts), 1× DrawdownChart, 1× MonthlyHeatmap, 1× DailyHeatmap, 1× ReturnHistogram, 1× ReturnQuantiles, 1× YearlyReturns, 1× RollingSharpe, 1× RollingVolatility, 1× RollingSortino, 1× ExposureSeries, 1× TurnoverSeries, 1× ReturnsCorrelation. Mixed `lightweight-charts` (Canvas-based, single chart per `createChart()` call) + Recharts (SVG, ResponsiveContainer per chart). `EquityCurve.tsx:24-45` shows each `lightweight-charts` instance instantiates a ResizeObserver. 13 charts = 13 ResizeObservers + 13 ResponsiveContainer measurements on every viewport change.
- **Why it happens:** No mount-budget rule for the codebase. The dashboard parity work (Sprint 9.1 / Phase 09.1) has 50+ widgets but they're virtualized via react-grid-layout. The 7-panel single-strategy page has no equivalent virtualization.
- **Consequences:** First paint OK; subsequent resize/scroll triggers cascading re-measure → re-paint, especially on the lightweight-charts paths. Plotly modebar is intentionally absent (per plan) but the tab-switch latency between Discovery and Strategy detail will spike.
- **Prevention:**
  - **Lazy-mount panels 4–7 via IntersectionObserver.** Keep panels 1–3 eager (above-the-fold).
  - **Hoist a single ResizeObserver at the panel-container level** instead of per-chart.
  - For panels with toggle controls (Cumulative ▾ / Underwater / Rolling Sharpe), reuse a single `lightweight-charts` instance and swap data via `setData()` — do NOT remount the chart on toggle change. EquityCurve.tsx:74-97 already does this for benchmark toggle; extend the pattern.
  - **Bundle limit gate:** `du -sh .next/static` after build < 5MB; fail CI if delta > 500kB.
- **Detection:** Playwright trace recording on `/strategy/[id]/v2`; flag if total task time > 1.5s.
- **Severity:** HIGH (perf, T8b)
- **Phase to address:** Phase 2 — UI panels (T8b)

### Pitfall 7: localStorage `discovery_view_preferences:{slug}` leaks across accounts on shared machines
- **What goes wrong:** Plan T7 stores Customize panel settings (column visibility, default view, hide-examples toggle) in `localStorage` keyed by `discovery_view_preferences:{slug}`. On a shared workstation (allocator-and-spouse, family-office assistant-and-PM, two analysts on one machine), allocator-A's preferences persist after logout and allocator-B sees them on login. No scoping to `auth.uid()`.
- **Why it happens:** Plan says "saves to localStorage" without specifying the key shape. Existing dashboard parity (Phase 09.1) ships per-allocator-scoped localStorage for scenario drafts (per plan) but Discovery v2 inherits a category-keyed convention from the existing `StrategyFilters.tsx` ViewMode shape.
- **Consequences:** Cross-account view-state bleed. Not a security issue (no PII in column visibility), but a trust hit ("why is this list filtered? I didn't set that"). Worse: a previous allocator's "hide examples = OFF" persists for the new login → demo strategies leak in.
- **Prevention:**
  - **Key by user_id**: `discovery_view_preferences:{auth.uid}:{slug}`. Hash auth.uid via SHA-256 on the client before localStorage write to avoid leaking the UUID in DevTools.
  - **Clear on logout:** add a `clearDiscoveryPreferences()` call in the existing logout handler. The "logout sweeps localStorage" pattern already exists in the codebase (Sprint 9.1 scenario drafts).
  - **Server-side persistence opt-in for institutional users:** for users with `allocator_type IN ('Family Office', 'Fund-of-Funds', 'RIA')` (multi-device by default), persist Customize settings to `allocator_preferences.discovery_views_jsonb` (extension of existing column) so they sync across devices. localStorage is only a client-side cache.
- **Detection:** Playwright spec — login as A, set preferences, logout, login as B, assert localStorage is clean of A's keys.
- **Severity:** HIGH (UX, T7)
- **Phase to address:** Phase 1 — Discovery v2 (T7)

### Pitfall 8: Watchlist toggle race conditions on rapid star-click
- **What goes wrong:** Plan T7 introduces `user_watchlist (user_id, strategy_id, added_at)` with a star-icon toggle on each row + card. The natural pattern is optimistic update + POST `/api/watchlist` / DELETE `/api/watchlist/[strategyId]`. Rapid double-click (toggle ON → OFF in <200ms) creates two in-flight requests where one is INSERT and the other is DELETE. Without server-side de-dup, the table ends in a non-deterministic state depending on which DB write commits last.
- **Why it happens:** The pattern is common; the bug is not. `user_watchlist (user_id, strategy_id)` PRIMARY KEY catches the double-INSERT (unique violation), but the DELETE-without-row case returns 0 rows affected and the UI may show "added" while DB shows "removed."
- **Consequences:** Watchlist counter mismatches the actual watched-list count after rapid edits. Star icon flickers between states.
- **Prevention:**
  - **Idempotent server endpoint:** single `PUT /api/watchlist/[strategyId]` that accepts `{watched: boolean}` and uses `INSERT ... ON CONFLICT DO NOTHING` for true and `DELETE` for false. PUT is idempotent per HTTP spec.
  - **Client-side debounce:** 300ms debounce on star click before POST. Use existing `userActionLimiter` (5/min, src/lib references in CONCERNS.md) for DDoS protection.
  - **Optimistic UI with rollback on 4xx/5xx:** mark the star as "pending" (intermediate state) until server confirms; rollback on error. React 19's `useOptimistic` is the right primitive (already used elsewhere in the codebase per AGENTS.md guide).
- **Detection:** Playwright spec hammers the star with 10 clicks in 1s, asserts final DB state matches final UI state.
- **Severity:** HIGH (UX, T7)
- **Phase to address:** Phase 1 — Discovery v2 (T7)

### Pitfall 9: `user_watchlist` RLS predicate must be self-only OR pollute the table
- **What goes wrong:** Naïve `CREATE POLICY user_watchlist_self ON user_watchlist USING (user_id = auth.uid())` is correct for SELECT/INSERT/DELETE — but if a strategy is later archived (status → archived), the watchlist entry stays. The Discovery v2 list joins `user_watchlist → strategies` and shows a star next to strategies the allocator can no longer match against.
- **Why it happens:** Plan T1 schema for `user_watchlist` does not specify CASCADE behavior on `strategies` reference.
- **Consequences:** Allocator sees a "watched" strategy that's archived — they can't click into it (or the click 404s). Trust hit on the watchlist's reliability as a working-set tool.
- **Prevention:**
  - `strategy_id UUID REFERENCES strategies(id) ON DELETE CASCADE` — when a strategy is hard-deleted, watchlist entry vanishes.
  - For `archive` (soft-delete via `status='archived'`), explicitly join `WHERE strategies.status = 'published'` in the Discovery v2 list query so archived watched-items don't render.
  - Add a "Show archived watched strategies" toggle to surface them in a secondary section if the allocator wants to see them ("see what was archived after I starred it") — Plan optional, value-add.
- **Detection:** Migration test: archive a watched strategy; assert it disappears from the My Watchlist tab.
- **Severity:** HIGH (UX, T7)
- **Phase to address:** Phase 0 — Schema (T1)

### Pitfall 10: Backfill recompute saturates the Railway worker on milestone deploy
- **What goes wrong:** T8a adds 5+ new metric functions to `metrics.py`. Existing strategies (let's say ~20 published) need the metrics recomputed once T8a ships, so allocators see the new panels populated. Naïve approach: enqueue 20 `compute_analytics` jobs at deploy time. The Railway worker (per CONCERNS.md / `analytics-service/main_worker.py`) processes one job at a time per kind. Each `compute_analytics` job currently has a 20-minute watchdog. New T8a metrics likely add 30–60 seconds per strategy (rolling-window calculations on full history).
- **Why it happens:** No throttle on the post-deploy enqueue. The compute queue dashboard (Sprint 6) is observability, not gating.
- **Consequences:** All worker capacity goes to backfill for an hour after deploy; live `sync_trades` jobs queue behind it; allocators with active sync experience stale data; Bridge's `rescore_allocator` jobs delay.
- **Prevention:**
  - **Throttled backfill:** enqueue at most 5 `compute_analytics` jobs per minute, prioritize live sync (e.g., add a `priority` enum on `compute_jobs`, default backfill to `low`, sync to `normal`).
  - **Lazy-on-first-view alternative:** add a `metrics_json_version INT DEFAULT 1` column on `strategy_analytics`; the v0.17 page check fetches metrics_json + version; if version < 2, kick off a recompute job in the background and render the panels with "computing… ETA 2 minutes" placeholders. New strategies are computed at the new version automatically. Existing strategies migrate on first view, not on deploy.
  - **Pick one path** before the milestone closes; document in TODOS.md.
- **Detection:** post-deploy compute queue dashboard — alert if `compute_analytics` queue depth > 50 for >10 min.
- **Severity:** HIGH (ops, T8a)
- **Phase to address:** Phase 1 — Backend contracts (T8a)

### Pitfall 11: Sortino MAR floor convention drift between rolling-3M / rolling-6M / rolling-12M
- **What goes wrong:** Plan T8a mentions "rolling Sortino series mirroring rolling Sharpe windows (3M / 6M / 12M)." Sortino requires choosing a **minimum acceptable return (MAR)** — typically 0 (downside relative to zero) or risk-free rate (downside relative to alternative). Existing `metrics.py:52` uses `qs.stats.sortino(returns)` with quantstats default (MAR=0, no risk-free). For rolling Sortino, the same MAR=0 must apply across all windows for visual consistency.
- **Why it happens:** Sortino is one of those metrics where the MAR varies by author. quantstats default (MAR=0) is the path of least resistance. If the rolling Sortino implementation uses a different floor (e.g., risk-free rate from a different module), the line jumps when the panel toggles between scalar Sortino (Panel 2 headline) and rolling Sortino (Panel 5).
- **Consequences:** Panel 2 shows scalar Sortino = 1.82, Panel 5 last-window rolling Sortino = 2.41 — same strategy, same data, different number. Allocator distrusts the page.
- **Prevention:**
  - **Single source of truth in metrics.py:** define `MAR = 0.0` as a module constant; both `qs.stats.sortino(returns)` (which uses MAR=0 by default) AND a new `_rolling_sortino(returns, window, mar=MAR)` use the same value.
  - **Pytest cross-check:** `assert abs(metrics["sortino"] - rolling_sortino_3m[-1]) < 0.05` on a 90-day fixture (last rolling window converges to scalar over the full period when window == period).
  - Document the choice in `analytics-service/services/metrics.py` docstring.
- **Detection:** pytest fixture `tests/test_metrics_consistency.py::test_sortino_scalar_matches_rolling_at_full_window`.
- **Severity:** HIGH (correctness, T8a)
- **Phase to address:** Phase 1 — Backend contracts (T8a)

### Pitfall 12: `exposure_series` for spot-only / LP strategies has no underlying data **NEW**
- **What goes wrong:** Plan T8a `exposure_series` "depends on Sprint 3 position reconstruction." Position reconstruction requires fills + funding + a directional convention (long/short). Spot-only strategies (e.g., LP earn yield, market-making with delta-neutral net = 0) have non-zero positions that net to ~zero exposure; the chart line is flat at 0 with periodic spikes that look like data gaps. Strategies with no fills (legacy CSV-imported) cannot reconstruct positions at all.
- **Why it happens:** Plan assumes "every strategy has exposure data." Sprint 3 reconstructs from fills; not every strategy has fills.
- **Consequences:** Panel 7 renders blank or spiky for ~30% of strategies. Allocator perceives the strategy data as broken.
- **Prevention:**
  - **Per-strategy exposure-data check:** new `strategies.has_exposure_data BOOLEAN GENERATED ALWAYS AS (...) STORED` — true if at least 30 days of fills exist. Surface false as a panel-level "Exposure data unavailable for this strategy type" empty state.
  - **Strategy-type matrix:** for `strategy_types IN ('spot_arb', 'lp_yield', 'market_make_neutral')`, hide Panel 7's exposure subsection entirely (preserve turnover, correlation, greeks). Don't pretend.
  - Document in DESIGN.md decisions log under "Empty states for non-applicable panels."
- **Detection:** vitest spec on `<ExposurePanel data={...}/>` — render with empty array; assert empty-state copy renders.
- **Severity:** HIGH (UX, T8b panel 7)
- **Phase to address:** Phase 2 — UI panels (T8b)

### Pitfall 13: Identity translation drift — Plotly's chart-by-chart layouts seep into Recharts re-implementations
- **What goes wrong:** Plan Section 7 says "render via existing Recharts/lightweight-charts; no Plotly modebar." But qstats's `qs.reports.html()` produces Plotly figures with hardcoded layouts (e.g., monthly heatmap with green-to-red diverging palette, return histogram with 30 bins, drawdown chart with filled area). Direct port-by-eye replicates Plotly's defaults — including its dark-on-dark color choices and its tight subplot margins. The result fails DESIGN.md "Industrial/Utilitarian, FactSet not Bloomberg" positioning.
- **Why it happens:** When implementing 13 charts in 1.5 sessions (T8b budget), the cheap path is "open qstats, screenshot the chart, replicate." The expensive path is "decide what info each chart should communicate, design the chart from first principles in our identity."
- **Consequences:** Discovery v2's "FactSet over Bloomberg" identity gets diluted. Quants.Space parity becomes "Quants.Space's color scheme on a white background." DESIGN.md compliance is partial.
- **Prevention:**
  - **Per-chart identity checklist** before merge:
    - [ ] No Plotly default colors (e.g., #19CF86 emerald, #EF553B red — these don't appear in DESIGN.md)
    - [ ] Background `#FFFFFF` exclusively (Card surface)
    - [ ] Strategy series `#1B6B5A`; benchmark `#94A3B8` (stroke only); positive `#16A34A`; negative `#DC2626`
    - [ ] Axis tick text `#64748B` (passes WCAG; see Pitfall 3)
    - [ ] Geist Mono for ALL numbers; DM Sans for ALL labels
    - [ ] No tooltips with default Plotly white-on-black contrast — use `CHART_TOOLTIP_STYLE` token
    - [ ] No diverging palettes with more than 2 stops (existing MonthlyHeatmap uses 9 stops — acceptable as a heatmap exception; document)
  - **Source-control gate:** PR template adds the checklist; reviewer must check each box per chart.
- **Detection:** snapshot diff against a 30-day fixture per chart; visual regression suite (existing pattern: `e2e/demo-screenshot.spec.ts` baselines).
- **Severity:** HIGH (design integrity)
- **Phase to address:** Phase 2 — UI panels (T8b)

---

## Medium-Severity Pitfalls

### Pitfall 14: Geist Mono `tabular-nums` already wired — but only via `.font-metric` class **NEW**
- **What goes wrong:** Plan specifies "Geist Mono 11px tabular-nums ticks" on every chart. Existing `globals.css:133-135` defines `.font-metric { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }`. But Recharts' `tick={{...}}` style prop accepts `fontFamily` but NOT `fontVariantNumeric` — Recharts passes the object directly to `<text>` SVG elements, which read the CSS `font-feature-settings` + `font-variant-numeric` attribute differently than CSS classes resolve. Setting `fontFamily: CHART_FONT_MONO` alone gets you Geist Mono but NOT tabular-nums.
- **Why it happens:** The existing chart-tokens.ts uses `CHART_FONT_MONO` for fontFamily but doesn't set the variant. SVG `<text>` requires `fontVariantNumeric: "tabular-nums"` as a separate inline style.
- **Consequences:** Numbers like `1,234.56` and `987.65` align differently in axis labels, defeating the "tabular" alignment that's the whole point of choosing Geist Mono.
- **Prevention:** Add `CHART_TICK_STYLE` token to chart-tokens.ts: `{ fontSize: 11, fill: CHART_AXIS_TICK, fontFamily: CHART_FONT_MONO, fontVariantNumeric: "tabular-nums" }`. Use everywhere that currently spreads `{fontSize: 11, fill: ..., fontFamily: ...}`.
- **Detection:** Visual snapshot test on a chart with multi-digit ticks; assert digit columns align.
- **Severity:** MEDIUM (visual fidelity)
- **Phase to address:** Phase 2 — UI panels (T8b)

### Pitfall 15: Customize drawer settings — per-user (localStorage) vs per-account (server) ambiguity
- **What goes wrong:** Allocators access from multiple devices (laptop at office, mobile at home, tablet during travel). localStorage settings don't sync. Plan T7 says "saves to localStorage" without addressing the multi-device case.
- **Why it happens:** Single-device assumption from the desktop-first demo positioning.
- **Consequences:** Allocator customizes Discovery on laptop, opens it on mobile, finds default view. Friction. They give up and stop customizing.
- **Prevention:** See Pitfall 7's mitigation — institutional allocator types (`Family Office`, `Fund-of-Funds`, `RIA`) get server-side persistence in `allocator_preferences.discovery_views_jsonb`. Retail allocators (`HNW`, `Other`) keep localStorage-only.
- **Severity:** MEDIUM (UX, T7) — combines with Pitfall 7
- **Phase to address:** Phase 1 — Discovery v2 (T7)

### Pitfall 16: Sparkline color rule — single accent vs split positive/negative drift
- **What goes wrong:** Plan Section 6 (Discovery v2 identity translation): "Sparkline color: green/red split → `accent` for in-the-money, `negative` for losses." DESIGN.md: "Restrained color — 1 accent + 3 semantic + neutrals." A strategy with mixed positive/negative sub-segments becomes a multicolor zig-zag if the rule applies per-segment, OR a single-color line based on the final value if applied per-strategy. The plan doesn't specify.
- **Why it happens:** Implementation ambiguity; design review didn't catch.
- **Consequences:** Inconsistent sparkline appearance across rows. Allocator can't quickly compare two sparklines because the color codes differ.
- **Prevention:**
  - **Decision rule:** sparkline is single-color based on final return sign. Final value > 0 → `#1B6B5A` (accent). Final value < 0 → `#DC2626` (negative). Final value = 0 → `#94A3B8` (muted).
  - This matches the existing `Sparkline.tsx` convention (already in `src/components/charts/`); verify before T7 merge.
- **Detection:** Visual snapshot per row in Discovery list with mixed-return strategies.
- **Severity:** MEDIUM (visual consistency, T7)
- **Phase to address:** Phase 1 — Discovery v2 (T7)

### Pitfall 17: Partial-data state per panel — granularity unspecified
- **What goes wrong:** Plan Phase 2 design review flagged this as CRITICAL but the resolution was "TODO: a11y subsections." Strategies with <30 days of history can't render rolling-12M. <90 days can't render rolling-3M. <365 days can't render yearly heatmap rows. <1825 days can't render the full daily heatmap. Each panel needs a graceful degradation rule, NOT a hide-the-page-because-data-incomplete rule.
- **Why it happens:** Design review identified the gap; plan revision didn't enumerate per-panel rules.
- **Consequences:** New strategies (just-published, <30 days of fills) show a wall of "no data" placeholders. Wizard-generated strategies in their first month look broken.
- **Prevention:**
  - **Per-panel partial-data matrix** (added to T8b spec):
    - Panel 1 (Overview): always renders (uses strategy metadata, no history).
    - Panel 2 (Headline + Equity vs BTC): renders if ≥7 days; otherwise "Awaiting more data — minimum 7 trading days."
    - Panel 3 (Drawdown + Worst 5): renders if ≥30 days AND any drawdown episode exists. Otherwise: "No drawdown episodes recorded."
    - Panel 4 (Returns Distribution): Monthly heatmap renders if ≥1 full calendar month; Daily heatmap renders if ≥30 days; Histogram renders if ≥30 returns; Quantiles renders if ≥30 returns.
    - Panel 5 (Rolling): each window separately gates — 3M renders if ≥90, 6M ≥180, 12M ≥365.
    - Panel 6 (Trade & Position): renders if `trade_count >= 5`; otherwise "Trade-level metrics require ≥5 closed trades."
    - Panel 7 (Exposure + Turnover + Greeks): exposure subsection per Pitfall 12; turnover renders if any fills; greeks renders if benchmark overlap ≥30 days.
  - **Pick one display strategy:** prefer "Awaiting more data" copy over hide-the-panel. Hidden panels create visual jumps in the layout; copy preserves the layout shape.
- **Detection:** Playwright spec — render strategy with synthetic 7-day, 30-day, 90-day, 365-day histories; assert correct partial-data copy/render per panel.
- **Severity:** MEDIUM (UX, T8b)
- **Phase to address:** Phase 2 — UI panels (T8b)

### Pitfall 18: Filter-by-team UI exposes organization names publicly
- **What goes wrong:** Plan T7 "Filter-by-team" surfaces organization names in a dropdown on the public Discovery page. If any strategy belongs to a private/sensitive org (e.g., a stealth fund that doesn't want to be listed), the org name leaks via the filter dropdown even before the allocator clicks into the strategy.
- **Why it happens:** Filter dropdowns enumerate all distinct values in the filtered column. Privacy-by-default isn't built in.
- **Consequences:** Org name leak. Per Pitfall 2 this is moot until orgs are populated, but if T7 ships and orgs are populated later, the filter dropdown becomes the leak vector.
- **Prevention:**
  - Add `organizations.is_public BOOLEAN DEFAULT true` (or `discovery_visible BOOLEAN`). Filter dropdown reads only `WHERE is_public = true`.
  - Strategies with `organization_id` whose org has `is_public = false` show "Independent" or "Private team" in the discovery list (NOT the org name).
- **Detection:** Migration test asserts a private org's name is not selectable in the filter API endpoint.
- **Severity:** MEDIUM (privacy, T7)
- **Phase to address:** Phase 1 — Discovery v2 (T7) — gated on Pitfall 2's resolution

### Pitfall 19: Turnover series — daily aggregate vs rolling window contract ambiguity
- **What goes wrong:** Plan T8a `turnover_series`. quantstats does not produce a turnover series natively (turnover is `qs.reports.html()`'s "trade volume / NAV" daily). Plan says "use `qs.reports.html()` as the contract." But `qs.reports.html()` reports turnover as a SCALAR aggregate (mean daily turnover %), not a series. The Plan needs to define the series construction independently.
- **Why it happens:** Premise 3 corrected ("data exists partially") but the turnover-series shape was assumed to follow Sharpe's contract (rolling window).
- **Consequences:** T8a implementer picks an arbitrary contract (e.g., 30-day rolling sum of trade volume / NAV) and the panel renders something — but it's not "qstats parity" because qstats doesn't produce that series. Identity contract drifts.
- **Prevention:**
  - **Define the turnover-series contract explicitly:** "daily turnover ratio = trade_volume_usd_today / nav_today, with optional smoothing via rolling 7-day mean." Document in metrics.py docstring.
  - Add a Vitest equivalent (cross-runtime parity check per plan T8a) that confirms Python and TS implementations produce identical series on the same fixture.
- **Severity:** MEDIUM (correctness, T8a)
- **Phase to address:** Phase 1 — Backend contracts (T8a)

### Pitfall 20: 7-panel layout maintenance plan — DESIGN.md UC#7 deviation needs ongoing guard
- **What goes wrong:** UC#7 explicitly accepted the DESIGN.md "data density > card density" rule deviation for the 7-panel layout. Without an active maintenance plan, future contributors will drift toward more cards (each new metric = a new card; soon there are 12 panels not 7), or revert toward fewer panels (combining "for cleanliness," undoing the parity).
- **Why it happens:** Documented exceptions decay. Future PRs cite DESIGN.md and try to "clean up" the wall.
- **Consequences:** v0.18 or v0.19 sees a partial revert to dashboard-style cards, losing the qstats parity contract.
- **Prevention:**
  - **DESIGN.md decisions log entry** (already in plan ship criteria) — make it explicit: "7-panel single-strategy page is a deliberate density violation per UC#7 (2026-04-26). Adding a card to this page requires CEO sign-off; combining panels requires the same. The panel count is a parity contract with `qs.reports.html()`."
  - **Vitest gate:** `tests/visual/strategy-v2-panel-count.test.ts` — count rendered top-level `<section>` elements with `data-panel` attribute on `/strategy/[id]/v2`; assert exactly 7. Future PRs that add/remove panels must update the test, forcing the conversation.
  - Reference each panel section in code with a comment: `// Panel N (qstats parity contract — see plan T8b)`.
- **Detection:** CI gate via the panel-count test.
- **Severity:** MEDIUM (design integrity, ongoing)
- **Phase to address:** Phase 2 — UI panels (T8b) + ongoing

---

## Low-Severity Pitfalls

### Pitfall 21: Heatmap chart bundle size from echarts/d3-scale-chromatic accidental imports
- **What goes wrong:** Implementing daily heatmap, an LLM/contributor reaches for `echarts` (~1MB gzipped) or `d3-scale-chromatic` (~80kB) for a "polished" heatmap. The 0.17 milestone budget doesn't allow a 1MB+ delta on `/strategy/[id]/v2`.
- **Prevention:** lockfile diff in PR template; reject any new chart library beyond the existing `recharts`, `lightweight-charts`, `@nivo/boxplot` (already in package.json). Heatmap = native SVG/Canvas — see Pitfall 4.
- **Severity:** LOW
- **Phase to address:** Phase 2 — UI panels (T8b)

### Pitfall 22: Vercel function bundle limit on the strategy page
- **What goes wrong:** `/strategy/[id]/v2` is a Server Component. Server bundles in Next 16 have a 50MB gzipped limit on Vercel Pro (10MB on Hobby). 13 chart imports (Recharts + lightweight-charts + various) might push the page bundle over the Hobby limit if every chart is statically imported in the page module.
- **Prevention:** Use `dynamic()` imports for panels 4–7 (per Pitfall 6's lazy-mount strategy). The dynamic import naturally creates a lazy chunk, keeping the page bundle small.
- **Severity:** LOW (only matters on Hobby; codebase is on Pro per CONCERNS.md migration progression)
- **Phase to address:** Phase 2 — UI panels (T8b)

### Pitfall 23: BTC-only correlation messaging — "matrix" UI for one row
- **What goes wrong:** Plan T8a descopes multi-benchmark to BTC-only. Plan Section 7 Panel 7 still says "Returns Correlation matrix (strategy vs BTC vs ETH vs SOL)." Implementing a single-row "matrix" with one entry looks like a half-finished feature.
- **Prevention:** Render Panel 7 correlation as "Correlation with BTC" (one number, one rolling-correlation chart) — not a "matrix" UI. Defer the matrix shape to Sprint 13 when ETH/SOL ingestion lands. Document in TODOS.md.
- **Severity:** LOW (cosmetic, T8b panel 7)
- **Phase to address:** Phase 2 — UI panels (T8b)

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|---|---|---|
| Phase 0 — Pre-T1 audit | `is_example` already exists (P1); `organization_id` unpopulated (P2); UC#8 strategies.user_id consumer audit | Run grep audits BEFORE writing migrations |
| Phase 1 — Schema / T1 | `user_watchlist` cascade behavior (P9); `is_example` index (P1) | Add CASCADE; index `(is_example, status)` partial |
| Phase 1 — Discovery v2 / T7 | localStorage scope (P7); watchlist races (P8); team filter privacy (P18); sparkline color rule (P16) | Per-user localStorage key; idempotent PUT endpoint; org `is_public` flag; document sparkline rule |
| Phase 1 — Backend contracts / T8a | metrics_json bloat (P5); Sortino MAR convention (P11); turnover contract (P19); backfill saturation (P10) | Path-extract from JSONB; module-level MAR const; explicit turnover docstring; throttled or lazy backfill |
| Phase 2 — UI panels / T8b | Daily heatmap perf (P4); 7-panel mount perf (P6); chart contrast (P3); identity drift (P13); tabular-nums wiring (P14); partial data states (P17); exposure-data missing (P12); panel-count drift (P20) | Canvas fallback >365 cells; lazy-mount panels 4–7; CHART_AXIS_TICK token; per-chart identity checklist; CHART_TICK_STYLE token; per-panel matrix; strategy-type matrix; vitest panel-count gate |

---

## Sources

- Plan: `~/.claude/plans/strategy-teams-kpi-parity.md` (FM-1..FM-7 and Phase 1/2/3 review findings)
- `analytics-service/services/metrics.py` (411 lines, current implementation)
- `src/components/charts/` (10 components: lightweight-charts via EquityCurve; Recharts via RollingMetrics; CSS-grid via MonthlyHeatmap)
- `src/components/charts/chart-tokens.ts` (existing identity tokens — `CHART_AXIS_TICK = "#64748B"` is the safe choice, NOT `#94A3B8` or `#718096`)
- `supabase/migrations/001_initial_schema.sql:64` (`is_example` already declared)
- `supabase/migrations/006_organizations.sql` (organizations + strategies.organization_id, no consumers in queries.ts)
- `package.json` (recharts, lightweight-charts, @nivo/boxplot — no Plotly, no echarts)
- `DESIGN.md` (UC#7 density override; data-density principle)
- `.planning/codebase/CONCERNS.md` (Vercel cron tier, Hobby vs Pro, hand-maintained types)
- WCAG 2 contrast computations: manual (#94A3B8 ≈ 2.85:1, #718096 ≈ 3.94:1, #64748B ≈ 4.85:1 on white)

Sources:
- [WebAIM: Contrast and Color Accessibility — Understanding WCAG 2 Contrast and Color Requirements](https://webaim.org/articles/contrast/)
- [WCAG Color Contrast Ratios | WCAG Guidelines](https://www.accessibilitychecker.org/wcag-guides/ensure-the-contrast-between-foreground-and-background-colors-meets-wcag-2-aa-minimum-contrast-ratio-thresholds/)
