# Feature Landscape — v0.17.0.0 Sprint 12 (KPI Parity & Discovery v2)

**Domain:** Allocator-facing strategy discovery + qstats-parity single-strategy detail
**Researched:** 2026-04-26
**Scope:** T7 (Discovery v2) + T8a (metrics.py extensions, BTC-only) + T8b (Single-Strategy v2 7-panel UI) ONLY. Manager Workspace / Inbox / Threads / Mandate / Activity log are **out of scope** (deferred to v0.18).
**Source hierarchy:** Codebase grep (HIGH) → qstats GitHub source `ranaroussi/quantstats/main` (HIGH) → Quants.Space marketing pages (LOW; auth-walled platform) → plan-as-drafted at `~/.claude/plans/strategy-teams-kpi-parity.md` (corroborated/refuted per finding).

---

## 0 · Audit corrections to plan-as-drafted

The plan claims Discovery v2 needs net-new schema and components. **Codebase grep refutes most of this**. Truth as of `main` @ v0.16.x:

| Plan claim | Reality on `main` | Source |
|---|---|---|
| "Add `strategies.is_example` flag" | **Already shipped** in migration 001 (line 64) | `supabase/migrations/001_initial_schema.sql:64` |
| "Add `user_watchlist` table" | **Already shipped** as `user_favorites` (migration 024) — no UI wired | `supabase/migrations/024_user_favorites.sql` |
| "Add view toggle (table\|grid) + StrategyCard renderer" | **Already shipped** — toggle in `StrategyFilters.tsx:368-384`, grid renderer in `StrategyGrid.tsx` | `src/components/strategy/StrategyFilters.tsx`, `StrategyGrid.tsx` |
| "Add Customize panel (General / Table columns)" | **Half-shipped** — `CustomizeModal` exists in `StrategyFilters.tsx:582-684` with Default view + Default sort + Hide examples. **Missing:** localStorage persistence, "Table columns" tab | `StrategyFilters.tsx:64-75`, `:582-684` |
| "Add Hide examples toggle" | **Already shipped** in toolbar + Customize modal | `StrategyFilters.tsx:325-334`, `:665-674` |
| "Add Sort dropdowns (Sort by + Sort order)" | **Already shipped** — both dropdowns in `StrategyFilters.tsx:336-361` | `StrategyFilters.tsx` |
| "Filter by team" using `strategies.organization_id` | NOT in current `StrategyFilters.tsx` advanced drawer | `StrategyFilters.tsx:425-544` |
| "Daily heatmap chart" | NOT shipped (only `MonthlyHeatmap`) | `src/components/charts/` |
| "Rolling Sortino" | NOT shipped — only rolling Sharpe (30/90/365d) computed | `metrics.py:65-69`, `:374-381` |
| "Rolling Volatility series" | NOT shipped — volatility is scalar only (`metrics.py:50`) | `metrics.py` |
| "Exposure series (intraday → daily)" | NOT shipped — exposure aggregates exist (mean/std/max gross/net) but not a time-series | `position_reconstruction.py:435-498` |
| "Turnover series" | NOT shipped — **zero references to "turnover" anywhere in `analytics-service/`** | `grep -rn turnover analytics-service/` → 0 results |
| "Trade-table aggregations (Trade Main / Mix / Position Main / R:R / SQN / expectancy)" | NOT shipped — `trade_count` is the only trade-level field; no SQN, no expectancy, no long/short segmentation, no maker/taker breakdown | `metrics.py`, grep across analytics-service |
| "Calmar already exists at metrics.py:53" | **TRUE** — verified line 53 | `metrics.py:53` |

**Net:** Discovery v2 (T7) is ~70% already built; only Watchlist UI wire-up + localStorage persistence + filter-by-org are net-new. T8a (metrics.py extensions) is the **real cost** of this milestone.

---

## 1 · qstats parity catalogue — verified gap analysis

**Authoritative source:** `https://raw.githubusercontent.com/ranaroussi/quantstats/main/quantstats/stats.py` (top-level `def`s) + `_plotting/wrappers.py` (chart functions) + `reports.py` (`metrics()` table contents).

### 1a · Scalar metrics (`qs.stats.metrics()` table)

| qstats metric | Computed in `metrics.py`? | Line# | Action for v0.17 |
|---|---|---|---|
| Cumulative Return / Total Return | ✅ | `:48` | reuse |
| CAGR | ✅ | `:49` | reuse |
| Volatility (annualized) | ✅ | `:50` | reuse |
| Sharpe | ✅ | `:51` | reuse |
| Sortino | ✅ | `:52` | reuse |
| Calmar | ✅ | `:53` | reuse |
| Max Drawdown | ✅ | `:54` | reuse |
| Max DD Duration (Longest DD Days) | ✅ | `:341-348` | reuse |
| Smart Sharpe | ✅ | `:149` | reuse |
| Smart Sortino | ✅ | `:152` | reuse |
| Omega | ✅ | `:127` | reuse |
| Skew | ✅ | `:141` | reuse |
| Kurtosis | ✅ | `:144` | reuse |
| VaR (1d, 95%) | ✅ | `:97-100` | reuse |
| CVaR / Expected Shortfall | ✅ | `:102-104` | reuse |
| MTD / YTD / 3M / 6M | ✅ | `:106-110`, `:93` | reuse |
| Best/Worst Day | ✅ | `:108-109` | reuse |
| Best/Worst Month | ✅ | `:113-114` | reuse |
| Avg Win / Avg Loss / Win-Loss Ratio | ✅ | `:158-167` | reuse |
| Payoff Ratio | ✅ | `:166-168` | reuse |
| Profit Factor | ✅ | `:170-171` | reuse |
| Gain/Pain Ratio | ✅ | `:130-132` | reuse |
| Tail Ratio | ✅ | `:134-136` | reuse |
| Gini | ✅ | `:122-124` | reuse |
| Risk of Ruin | ✅ | `:174-182`, `:310-338` | reuse |
| Consecutive Wins / Losses | ✅ | `:185-192` | reuse |
| Outlier Win/Loss Ratios | ✅ | `:242-249` | reuse |
| Alpha / Beta | ✅ | `:255-257` | reuse (BTC only) |
| Correlation | ✅ | `:258-260` | reuse (BTC only) |
| Information Ratio | ✅ | `:261-264` | reuse |
| Treynor Ratio | ✅ | `:265-267` | reuse |
| BTC rolling correlation 90d | ✅ | `:268-269` | reuse |
| **Recovery Factor** | ❌ | — | **MEDIUM — `qs.stats.recovery_factor`** (1 line) |
| **Ulcer Index / UPI** | ❌ | — | **MEDIUM — `qs.stats.ulcer_index`/`upi`** (2 lines) |
| **Common Sense Ratio / CPC Index** | ❌ | — | **LOW — `qs.stats.common_sense_ratio` / `cpc_index`** (2 lines, derivable) |
| **Serenity Index** | ❌ | — | **LOW — `qs.stats.serenity_index`** |
| **Kelly Criterion** | ❌ | — | **LOW — `qs.stats.kelly_criterion`** |
| **Probabilistic Sharpe Ratio** | ❌ | — | **LOW — `qs.stats.probabilistic_sharpe_ratio`** |
| **R²** | ❌ (vs benchmark) | — | **LOW — `qs.stats.r_squared`** |
| **Time in Market / Exposure (scalar %)** | ❌ | — | **MEDIUM — `qs.stats.exposure`** (used in qstats reports header) |

**Gap on scalars:** ~7 trivial 1-line additions (Recovery Factor, Ulcer Index, UPI, CPC, Serenity, Kelly, PSR, R², Time-in-Market). Each is `qs.stats.{name}(returns)` in `metrics.py` — **LOW complexity** as a batch.

### 1b · Series & charts

| qstats chart | Quantalyze component | Status | Action |
|---|---|---|---|
| `returns` (cumulative equity curve) | `EquityCurve.tsx` | ✅ shipped | reuse, add Cumulative ▾ / Underwater / Rolling Sharpe segmented control wrapper |
| `log_returns` | — | ❌ missing | **LOW** — toggle on EquityCurve |
| `drawdown` (underwater) | `DrawdownChart.tsx` | ✅ shipped | reuse |
| `drawdowns_periods` (worst-N table) | `WorstDrawdowns.tsx` | ✅ shipped | reuse |
| `monthly_heatmap` | `MonthlyHeatmap.tsx` | ✅ shipped | reuse |
| `yearly_returns` | `YearlyReturns.tsx` | ✅ shipped | reuse |
| `histogram` (returns distribution) | `ReturnHistogram.tsx` | ✅ shipped | reuse, add benchmark overlay |
| `distribution` (return quantiles boxplot) | `ReturnQuantiles.tsx` | ✅ shipped | reuse |
| `daily_returns` (per-day grid) | — | ❌ missing | **MED — `daily_returns_grid`** in `metrics.py` + new `<DailyHeatmap>` chart |
| `rolling_sharpe` series (3M/6M/12M) | `RollingMetrics.tsx` (30/90/365d) | ⚠ shipped under wrong window labels | rename keys → `sharpe_90d`/`sharpe_180d`/`sharpe_365d` and label as 3M/6M/12M in UI |
| `rolling_volatility` series | — | ❌ missing | **MED — `rolling_volatility_series`** (vectorized pandas, mirrors `_rolling_sharpe`) |
| `rolling_sortino` series | — | ❌ missing | **MED — `rolling_sortino_series`** (one window function; mirrors `_rolling_sharpe`) |
| `rolling_beta` (rolling greeks) | — | ❌ missing | **LOW — `qs.stats.rolling_greeks`** wrapped + finalized |
| `snapshot` (3-panel summary) | — | ❌ N/A | NOT in scope — Panel 2 already covers this |
| Monte Carlo (`montecarlo`, `montecarlo_distribution`) | — | ❌ missing | OUT OF SCOPE — not in plan, defer to post-v0.17 |

### 1c · Trade & position metrics (Panel 6 — qstats `trades` extension)

qstats core does not natively compute these — they require trade-level data (per-trade entries/exits/P&L). They were assumed by the plan based on `qs.reports.html(trades=...)` which **exists but is rarely used** because it requires the user to pass a trades dataframe explicitly.

| Panel 6 metric | Computed today? | Source data | Action |
|---|---|---|---|
| Total trades / long / short | ⚠ partial — `trade_count` exists | `analytics-service/services/job_worker.py:587` | extend trade aggregator to segment long/short |
| Wins / losses / win rate | ❌ as scalar; ✅ as % from returns | — | derive from existing trade table OR keep returns-based |
| Avg trade duration | ⚠ available — `avg_duration_days` in `position_reconstruction.py:104` | `position_reconstruction.py` | surface in metrics_json |
| Long-entry maker/taker, short-entry maker/taker (Trade Mix) | ❌ | requires fill-level `is_maker` flag in raw fills | **HIGH** — needs new aggregator over `raw_fills`; verify `is_maker` flag exists in ingested data first |
| Position Main: open / closed / long / short / win rate | ⚠ partial — closed positions in `position_reconstruction.py` | `position_reconstruction.py:60-130` | aggregate, surface in metrics_json |
| R:R (risk-reward), weighted R:R | ❌ | per-trade P&L distribution | **MED — `weighted_rr = sum(wins) / abs(sum(losses))`** (one liner) |
| Profit Factor, Payoff Ratio | ✅ | `metrics.py:166-171` | reuse |
| Long/Short profit factor (separate) | ❌ | requires trade-side segmentation | **MED — `pf_long`, `pf_short`** from trade aggregator |
| Expectancy `E = (W × Avg Win) − (L × Avg Loss)` | ⚠ derivable from `avg_win`/`avg_loss`/`win_loss_ratio` | `metrics.py:158-168` | **LOW — one-line derivation** |
| SQN (System Quality Number) — Van Tharp | ❌ | per-trade R-multiples | **MED — `sqn = (mean(R)/std(R)) × sqrt(min(N,100))`** (one function) |
| Volume metrics (gross volume, mean trade size) | ❌ | sum of fill quantities × prices | **MED — aggregate over `raw_fills`** |
| Mean daily / monthly turnover | ❌ — **zero "turnover" references in `analytics-service/`** | needs `daily_turnover = abs(Δposition × price) / NAV` per day | **HIGH — turnover_series** depends on Sprint 3 position reconstruction; non-trivial NAV alignment |

**Net Panel 6 cost:** 4 LOW-complexity (expectancy, R:R, Long/Short PF, Trade Main segmentation), 3 MED (SQN, volume aggregator, daily heatmap), 2 HIGH (Trade Mix maker/taker — verify data availability first; turnover_series).

### 1d · Panel 7 (Exposure + Greeks + Correlation)

| Item | Status | Action |
|---|---|---|
| Exposure series (gross/net per day) | ❌ — only mean/std/max scalars | **HIGH** — extend `position_reconstruction.compute_exposure_metrics()` to emit per-date series alongside aggregates |
| Turnover series | ❌ | **HIGH** — see 1c |
| Correlation matrix (BTC vs strategy) | ✅ — single value at `metrics.py:260` + 90d rolling at `:269` | reuse; **DROP multi-benchmark per UC#6** (defer ETH/SOL to Sprint 13+) |
| Alpha / Beta / IR / Treynor | ✅ | `metrics.py:255-267`; surface in new `<BenchmarkGreeksPanel>` |
| Rolling Greeks (rolling alpha/beta) | ❌ | **LOW** — `qs.stats.rolling_greeks` |

---

## 2 · Table Stakes (must ship in v0.17 — institutional allocator expects)

Features allocators expect on a "verified track record" surface. Missing = product looks unfinished compared to qstats default report.

| # | Feature | Complexity | REQ-ID category | Notes |
|---|---|---|---|---|
| TS-01 | Discovery: Watchlist UI (star toggle on row + card, "My Watchlist" sub-tab on `/discovery/[slug]`) | **MED** | `DISCO-WATCHLIST` | Schema (`user_favorites`) already exists; needs UI wire-up + sub-tab + count badge + RPC routes |
| TS-02 | Discovery: localStorage persistence for Customize prefs (`discovery_view_preferences:{slug}`) | **LOW** | `DISCO-PERSIST` | Hook into existing `CustomizeModal`; one `useEffect` + `localStorage.setItem`/`getItem` |
| TS-03 | Discovery: filter-by-team using `strategies.organization_id` | **LOW** | `DISCO-FILTER-TEAM` | Add to `AdvancedFilters` + `StrategyFilters.tsx` advanced drawer |
| TS-04 | Single-Strategy v2 page route `/strategy/[id]/v2` (or replace v1) | **LOW** | `STRAT-V2-ROUTE` | New route; reuse `getPublicStrategyDetail` |
| TS-05 | Panel 1 — Overview cards (exchanges / types / subtypes / markets / leverage / avg DTO) | **LOW** | `STRAT-OVERVIEW` | Pull from `strategies` row + `metrics_json`; `<OverviewCards>` component |
| TS-06 | Panel 2 — Headline metrics 6-cell strip (Cum / CAGR / Sharpe / Sortino / Max DD / Vol) | **LOW** | `KPI-HEADLINE` | All metrics already in `analytics`; just renderer |
| TS-07 | Panel 2 — Equity vs BTC overlay with Cumulative/Underwater/Rolling Sharpe segmented control | **MED** | `KPI-EQUITY-OVERLAY` | Wrap existing `EquityCurve` + `DrawdownChart` + `RollingMetrics` in tab control |
| TS-08 | Panel 3 — DrawdownChart full-width + Worst 5 DDs table | **LOW** | `KPI-DRAWDOWN` | Both components exist; layout-only |
| TS-09 | Panel 4 — Returns Distribution (existing components in v0.17 layout) | **LOW** | `KPI-DISTRIBUTION` | All 4 charts exist (MonthlyHeatmap, ReturnHistogram, ReturnQuantiles, YearlyReturns); layout-only |
| TS-10 | Panel 4 — DailyHeatmap chart (NEW) | **MED** | `KPI-DAILY-HEATMAP` | Backend: `daily_returns_grid` in `metrics.py`. Frontend: new `<DailyHeatmap>` (cell-grid SVG, color-by-return, downsample if >1825 cells) |
| TS-11 | Panel 5 — Rolling Sharpe with 3M/6M/12M toggle + BTC overlay | **LOW** | `KPI-ROLL-SHARPE` | `RollingMetrics.tsx` already has 30/90/365 — relabel windows |
| TS-12 | Panel 5 — Rolling Volatility series with 3M/6M/12M toggle | **MED** | `KPI-ROLL-VOL` | Backend `rolling_volatility_series` (3 windows). Frontend extension of `RollingMetrics` or new component |
| TS-13 | Panel 5 — Rolling Sortino series with 3M/6M/12M toggle | **MED** | `KPI-ROLL-SORTINO` | Backend `rolling_sortino_series`. Mirror Sharpe path |
| TS-14 | Panel 6 — Trade Main / Position Main rendering (existing data) | **LOW** | `KPI-TRADE-MAIN` | Surface existing `trade_count`, win/loss, durations |
| TS-15 | Panel 6 — Expectancy + R:R + SQN + Long/Short PF (NEW computations) | **MED** | `METRICS-TRADE-NEW` | Add to `metrics.py` (5 derived metrics) |
| TS-16 | Panel 7 — Benchmark Greeks panel (alpha / beta / IR / treynor / corr) | **LOW** | `KPI-BENCH-GREEKS` | All exist in `metrics_json`; renderer-only |
| TS-17 | Cross-runtime parity check (pytest fixtures + Vitest equivalents) | **MED** | `METRICS-PARITY-TESTS` | One golden 252-day fixture, run through metrics.py + JS-side parser; assert byte-identical JSON |
| TS-18 | DESIGN.md identity translation on every chart (white card, accent series, DM Sans, Geist Mono tabular-nums, no Plotly modebar, 1px gridlines) | **MED** | `DESIGN-IDENT` | Audit each chart; centralize chart-token contract in `chart-tokens.ts` (already exists) |
| TS-19 | Tabular-nums everywhere on Discovery + Single-Strategy (font-variant-numeric: tabular-nums) | **LOW** | `DESIGN-TABULAR` | CSS class on every numeric cell; already partially applied via `font-metric` |
| TS-20 | Partial-data state — strategies with <12mo history can't render Rolling 12M / Daily Heatmap | **MED** | `STRAT-PARTIAL` | Per-panel "Insufficient history (need ≥365d)" empty state; must not crash |

**Total: ~6.5 LOW / ~9 MED / ~0 HIGH for table-stakes.** Aligns with the plan's T7 + T8a + T8b session count (3.5 sessions for T8a, 1.5 for T8b, 0.5 for T7). Plan slightly underestimated T7 because schema work is mostly done, so polish + watchlist UI is the remaining cost.

---

## 3 · Differentiators (Quantalyze-specific edge — NOT in Quants.Space)

What makes our v0.17 better than a literal Quants.Space clone:

| # | Differentiator | Complexity | REQ-ID | Why it matters |
|---|---|---|---|---|
| DIFF-01 | Institutional typography (Instrument Serif display + DM Sans body + Geist Mono tabular-nums) | **already shipped** | — | DESIGN.md identity. Quants.Space uses generic sans-serif. Our serif display in strategy header + monospace tabular numbers reads as "FactSet over crypto-dark". Already in `DESIGN.md`. |
| DIFF-02 | High-contrast accessibility (WCAG-AA on text-muted `#718096` axis labels — verified ~4.6:1 already in DESIGN.md decisions log 2026-04-11) | **LOW** | `A11Y-CONTRAST` | Promote out of "buffer" per Phase 2 design review. Verify all 7 panels with axe-core in CI. |
| DIFF-03 | BTC-overlay default-ON in Equity chart (not behind a toggle) | **LOW** | `KPI-BTC-DEFAULT` | Allocator's first read is "alpha vs hold-BTC". Default-on signals confidence in the strategy. |
| DIFF-04 | Manager identity translation in single-strategy header (institutional/exploratory tier from `ManagerIdentityPanel.tsx` carried into v2) | **already shipped** | `STRAT-IDENTITY` | Reuse existing component. Quants.Space has no equivalent disclosure-tier mechanism. |
| DIFF-05 | Sparkline coloring uses **single accent color** for entire trace, NOT split green/red by daily return (DESIGN.md identity) | **LOW** | `DESIGN-SPARKLINE` | Quants.Space splits into green-up / red-down ticks (visual noise). Single-accent line + faint fill reads as financial-report-grade. |
| DIFF-06 | Verified-via-API checkmark badge in row + card (already shipped via `VerifiedBadge`) | **already shipped** | — | `StrategyTable.tsx:276-281`, `StrategyGrid.tsx:49`. Quants.Space has verification but doesn't surface per-row consistency. |
| DIFF-07 | Bridge "Simulate Impact" button on each row (already shipped, Sprint 6 feature) | **already shipped** | — | `SimulateImpactButton`. Unique to Quantalyze, not in Quants.Space. |
| DIFF-08 | Inline private notes on strategy detail (`StrategyNoteCard`, multi-scope notes from Phase 08) | **already shipped** | — | Allocator markdown notes per strategy. Quants.Space has no equivalent. |
| DIFF-09 | HealthScore badge in card view (Sprint-specific freshness signal) | **already shipped** | — | `HealthScore` component shows analytics freshness; institutional allocators want to see "is this data current". |
| DIFF-10 | 7-panel single-page layout (vs. tabs) so the entire qstats catalog scrolls | **MED** | `KPI-LAYOUT` | User Challenge UC#7: explicitly accepts DESIGN.md "data density > card density" rule deviation. Document in DESIGN.md decisions log. |

**Net:** 6 of 10 differentiators are **already shipped** — they just need to carry through to the v2 single-strategy page. Real net-new differentiator work is DIFF-02 (a11y verification), DIFF-03 (default-on BTC overlay), DIFF-05 (sparkline coloring), DIFF-10 (7-panel layout). All MED-or-lower.

---

## 4 · Anti-features (must NOT ship in v0.17 even if Quants.Space has them)

Per DESIGN.md and User Challenge UC#7 override, the following are explicitly out:

| # | Anti-feature | Why excluded | Detection in code review |
|---|---|---|---|
| ANTI-01 | Dark theme / Plotly default crypto-dark background | DESIGN.md line 52: "Dark mode: Not planned. Institutional finance is light mode." | Any chart with `bg-[#1A1A1E]` or similar dark CSS — fail review |
| ANTI-02 | Plotly modebar (zoom/pan/reset/save tools floating over chart) | DESIGN.md component patterns — no decorative chrome. Specified in plan S7 line 388: "no Plotly modebar" | Search for `modeBarButtonsToRemove` or Plotly imports — fail review |
| ANTI-03 | Bright yellow/lime accent colors (Quants.Space's signature) | DESIGN.md: accent is `#1B6B5A` muted teal only | `#FFD700`, `#FFEA00`, lime tints — fail review |
| ANTI-04 | Glassy / blurred / translucent card chrome | DESIGN.md: 1px `#E2E8F0` border + subtle `0 1px 3px rgba(0,0,0,0.04)` shadow only | `backdrop-blur`, `bg-white/30`, `bg-gradient-to-` on cards — fail review |
| ANTI-05 | Sparklines colored split green/red by daily return | DIFF-05 — single accent color trace. Quants.Space splits, we don't | Sparkline component should not branch fill by `value < 0` |
| ANTI-06 | Mobile-responsive polish for strategy detail | Out of scope (PROJECT.md context). Desktop-only acceptable | Don't waste sessions adding `sm:` / `md:` breakpoints to v2 panels |
| ANTI-07 | Multi-benchmark correlation matrix (ETH/SOL) | Descoped per UC#6 — needs new ingestion pipeline (Sprint 13+) | If `multi_benchmark_correlation_matrix` appears in metrics.py — wrong sprint |
| ANTI-08 | LLM-generated commentary on strategies | PROJECT.md constraint: "All commentary deterministic, no LLM" | Any OpenAI/Anthropic SDK import in this milestone — fail review |
| ANTI-09 | Decorative animations (bounce, scroll-triggered, gradients) | DESIGN.md motion: "Minimal-functional only" | `framer-motion` flourishes on KPI panels — fail review |
| ANTI-10 | Manager Workspace, Inbox, Threads, Mandate doc, Activity log, Tear sheet cron | Deferred to v0.18 per PROJECT.md "Out of scope" | Any code under `/strategies/inbox/*`, `/strategies/team/*`, `/strategies/mandate/*` — fail scope gate |
| ANTI-11 | Monte Carlo simulation panels (qstats has them) | Not in plan; deferred — high complexity, low-priority for institutional discovery | Any `montecarlo*` import from qstats — fail scope |
| ANTI-12 | New benchmark ingestion pipelines | UC#6 — BTC-only for v0.17 | Any new `benchmarks_eth` / `benchmarks_sol` table — out of scope |
| ANTI-13 | Per-deck multi-strategy bundle editor | PROJECT.md Out of Scope | — |
| ANTI-14 | "Customize Table columns" tab in Customize panel (deferred — complexity for negligible value) | Plan mentions it but scope-creep risk | Default columns are fine for v0.17 |

---

## 5 · Feature dependencies

```
T8a metrics.py extensions → T8b Single-Strategy v2 UI panels
     ↓                             ↓
TS-10/11/12/13/15 (backend)   TS-04/05/06/07/08/09/14/16
                                   ↓
                            TS-17 parity tests
                                   ↓
                            TS-18 design identity audit

T7 Discovery v2 (independent of T8a/b):
  TS-01 Watchlist UI ─→ TS-03 Filter by team ─→ TS-02 localStorage persistence
       ↓                                            ↓
       Reuse user_favorites schema                  Customize modal extension
```

**Critical path:** T8a (3 sessions per plan) blocks T8b (1.5 sessions). T7 (0.5) ships independently and can be commit-1 on the feature branch.

---

## 6 · MVP recommendation (if cuts needed mid-sprint)

Priority order if 9.5 sessions becomes 6:

1. **Cut Panel 6 trade-mix maker/taker** (TS-15 partial — drop SQN, drop volume aggregator; keep expectancy + R:R + Long/Short PF since they're 1-line derivations)
2. **Cut TS-10 DailyHeatmap** — non-essential, MonthlyHeatmap already in Panel 4
3. **Cut TS-12/TS-13 rolling Vol/Sortino** — keep rolling Sharpe relabel only (TS-11). Document as v0.17.1 follow-up
4. **Defer TS-17 parity tests to v0.17.1** — manual snapshot diff is acceptable for first ship
5. **NEVER cut:** TS-01 Watchlist (table-stakes, schema is already paid), TS-04-09 panel layout (90% is rendering existing data), TS-18 DESIGN.md identity (gate)

**MVP minimum:** TS-01, TS-02, TS-04 through TS-09 (existing data layouts), TS-11, TS-14, TS-16, TS-18, TS-19, TS-20, DIFF-02, DIFF-03, DIFF-05. **~7 LOW + 4 MED = ship-ready in 5 sessions.**

---

## 7 · Confidence assessment

| Area | Confidence | Source |
|---|---|---|
| qstats catalogue (1a, 1b) | **HIGH** | Direct GitHub source pull from `ranaroussi/quantstats/main/quantstats/{stats,reports,_plotting}.py` |
| metrics.py gap analysis (line numbers) | **HIGH** | Read tool against `analytics-service/services/metrics.py` |
| Discovery v2 already-shipped audit | **HIGH** | Read tool against `StrategyFilters.tsx`, `StrategyTable.tsx`, `StrategyGrid.tsx`, migration 001/024 |
| Trade/position metric availability | **HIGH** | grep across `analytics-service/`; "turnover" → 0 results, `trade_count` field-only |
| Quants.Space feature inventory | **LOW** | Platform is auth-walled at `platform.quants.space`; only marketing copy at `quants.space` accessible. **The plan's "Quants.Space mirror" feature list (customize panel structure, sub-tabs, hide-examples) is the user directive's interpretation, not independently verifiable from public sources.** Recommend: when implementing T7, if unsure about a specific Quants.Space affordance, default to DESIGN.md identity rules and skip the feature rather than guess. |
| DESIGN.md identity rules | **HIGH** | Read tool against project DESIGN.md |
| Anti-features list | **HIGH** | Direct mappings from DESIGN.md + UC overrides |

**Overall confidence: HIGH on backend gap (T8a) + Discovery already-shipped audit. LOW on specific Quants.Space UI features that are not in publicly-accessible pages (the user's directive is authoritative as project intent, not as evidence).**

---

## Sources

- [quantstats stats.py — full function catalog](https://raw.githubusercontent.com/ranaroussi/quantstats/main/quantstats/stats.py)
- [quantstats _plotting/wrappers.py — chart functions](https://raw.githubusercontent.com/ranaroussi/quantstats/main/quantstats/_plotting/wrappers.py)
- [quantstats reports.py — metrics() table contents](https://raw.githubusercontent.com/ranaroussi/quantstats/main/quantstats/reports.py)
- [Quants.Space marketing — features](https://quants.space/#features) (no platform access)
- Project files (HIGH confidence):
  - `/Users/helios-mammut/claude-projects/quantalyze/analytics-service/services/metrics.py`
  - `/Users/helios-mammut/claude-projects/quantalyze/analytics-service/services/position_reconstruction.py`
  - `/Users/helios-mammut/claude-projects/quantalyze/src/components/strategy/StrategyFilters.tsx`
  - `/Users/helios-mammut/claude-projects/quantalyze/src/components/strategy/StrategyTable.tsx`
  - `/Users/helios-mammut/claude-projects/quantalyze/src/components/strategy/StrategyGrid.tsx`
  - `/Users/helios-mammut/claude-projects/quantalyze/src/components/strategy/PerformanceReport.tsx`
  - `/Users/helios-mammut/claude-projects/quantalyze/src/components/strategy/ManagerIdentityPanel.tsx`
  - `/Users/helios-mammut/claude-projects/quantalyze/src/app/strategy/[id]/page.tsx`
  - `/Users/helios-mammut/claude-projects/quantalyze/src/app/(dashboard)/discovery/[slug]/page.tsx`
  - `/Users/helios-mammut/claude-projects/quantalyze/supabase/migrations/001_initial_schema.sql` (line 64 — is_example)
  - `/Users/helios-mammut/claude-projects/quantalyze/supabase/migrations/024_user_favorites.sql` (watchlist schema)
  - `/Users/helios-mammut/claude-projects/quantalyze/DESIGN.md`
  - `/Users/helios-mammut/.claude/plans/strategy-teams-kpi-parity.md` (plan provenance, partially refuted by codebase grep)
