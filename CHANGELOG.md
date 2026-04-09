# Changelog

All notable changes to Quantalyze will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to a 4-digit MAJOR.MINOR.PATCH.MICRO scheme so `/ship`
can bump without ambiguity.

## [0.2.0.0] - 2026-04-09

### Added
- Editorial hero for the public `/demo` page — one Instrument Serif headline, four Geist Mono numbers, one "Download IC Report" CTA. Verdict / Evidence / Action / Appendix layout replaces the old 9-card mosaic.
- Per-persona demo experience via `?persona=active|cold|stalled`, backed by a server-side enum lookup that rejects hostile input (including `__proto__`) and hardcodes allocator UUIDs.
- Insight strip: biggest-risk / regime-change / underperformance / concentration-creep sentences derived from `portfolio_analytics`. Never shows a composite score.
- Winners/losers strip: top 3 contributors and bottom 3 detractors from attribution, stable sort by strategy ID on ties.
- "What we'd do in your shoes" + "Where would the next $5M go?" recommendation narrative reading `optimizer_suggestions` directly.
- Counterfactual strip: "Had you allocated 12 months ago: portfolio +X% vs BTC +Y%".
- `/api/demo/portfolio-pdf/[id]` — new public PDF endpoint with HMAC-SHA256 signed tokens (30 min TTL), allowlist-gated to the 3 persona portfolios, shares the existing Puppeteer concurrency semaphore. The authenticated `/api/portfolio-pdf/[id]` is unchanged.
- `/api/cron/warm-analytics` — Vercel Cron handler (every 5 min) that pings the Python analytics service `/health` endpoint to keep cold-start latency off the forwarded-URL path. Accepts both GET (cron default) and POST (manual probe).
- `/portfolios/[id]` now wires 7 previously-orphaned chart components: `PortfolioEquityCurve`, `CorrelationHeatmap`, `AttributionBar`, `BenchmarkComparison`, `CompositionDonut`, `RiskAttribution`. Below-the-fold charts lazy-load via `next/dynamic`.
- Stale-fallback analytics: `getPortfolioAnalyticsWithFallback` fetches latest + latest-where-status=complete in parallel so a failed run renders last-good data with a stale badge instead of an error card.
- `<CardShell>` primitive with 4 states (loading / ready / stale / unavailable) for the authenticated dashboard. Cards never disappear — only their content does.
- `<MorningBriefing>` shared component between `/demo` (dek variant) and `/portfolios/[id]` (card variant).
- `portfolio-analytics-adapter`: strict typed adapter at the Supabase boundary. Defends against prototype-key poisoning from JSONB and rejects empty-string / boolean numeric coercion.
- `ResizeObserver` stub in `src/test-setup.ts` so chart components can render under vitest+jsdom.
- 4-digit VERSION file and CHANGELOG.md for clean version tracking.

### Changed
- `PortfolioAnalytics` TypeScript types corrected to match what `analytics-service/routers/portfolio.py` actually persists: `rolling_correlation` is now `Record<string, {date,value}[]>` (pair-keyed), `benchmark_comparison` is a single object (not a `Record`), `attribution_breakdown` and `risk_decomposition` use the real field names (`contribution` + `allocation_effect`; `marginal_risk_pct` + `standalone_vol` + `component_var` + `weight_pct`).
- `StrategyBreakdownTable` and the authenticated portfolio-pdf page drop dead reads on `attr.weight` / `attr.twr` — fields that never existed in the persisted payload. Weights now come from `portfolio_strategies.current_weight`, TWR from `strategy_analytics.cagr`.
- `/demo` rewrite preserves the existing two-batch match fallback chain (`batches[0] → batches[1]`) via an extracted, unit-tested `resolveDemoRecommendations` helper.
- Package version bumped from `0.1.0` to `0.2.0`.

### Fixed
- Pre-landing review catches (Codex adversarial + Claude checklist):
  - Cron route now exports GET + POST (was POST-only; Vercel Cron sends GET).
  - Demo PDF endpoint switched to `Cache-Control: no-store` so the CDN can't replay a response past the 30 min signed-token TTL.
  - Demo page now only signs a PDF token when the current persona has a seeded portfolio in the allowlist; no silent cross-wire to the active persona's report.
  - Warmup helper clears its timeout handle on the sync-throw path.

### Removed
- Portfolio Health Score card — killed before implementation per 4-signal cross-phase cross-model consensus (Claude + Codex, CEO + Design). Composite scores are a taste landmine for institutional LPs; the hero is now raw metrics with explicit provenance.
