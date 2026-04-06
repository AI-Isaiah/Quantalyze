# TODOS

## Next Up (high impact, ready to build)

### P0 — GenieAI-Inspired: Allocator Portfolio Upload
- **Allocator-side API key upload**: Let allocators connect THEIR exchange accounts to track all strategies they're invested in
- When an allocator uploads a key linked to a strategy manager NOT on Quantalyze, the platform detects this and can reach out to that manager ("Your allocator is already tracking you")
- This flips the acquisition model: allocators pull managers in, not the other way around
- Unified portfolio dashboard across all connected strategies
- Reference: genieai.tech (AI-powered fund operations)
- **Run /office-hours to spec this out before building**

### P1 — Design Polish
- [ ] Run /design-review on live site (http://localhost:3000) — visual audit + fix loop
- [ ] Apply design system tokens to all remaining components (some pages still have old Inter/teal)
- [ ] Compare live site against 3 HTML reference pages (landing, factsheet, discovery) at `~/.gstack/projects/AI-Isaiah-Quantalyze/designs/`

### P1 — Operational
- [ ] Founder-led migration of existing Telegram/email clients (manual, ~10-20 relationships)
- [ ] OKX bills API: verify data coverage for Spot vs Futures accounts
- [ ] Persist KEK securely (Supabase Vault or KMS for production, currently .env.local)
- [ ] Handle OKX bills-archive API for history older than 3 months

## Deferred (build on demand signal)

### P1.5
- Allocator preference weights (personalized ranking) — ship filters+presets first, build if >=3 allocators request different criteria weights

### P2
- Organizations / teams (migration 006 drafted, don't build until customer asks)
- Redis / BullMQ (premature, compute is 15-30s)
- Billing / pricing tiers (needs pricing model defined with paying customers)
- Leaderboard / ratings (incentive design needed)
- Embeddable "Verified by Quantalyze" widget
- Competitive analysis: quants.space, Darwinex, STRATS.io, TradeLink.pro, genieai.tech
- Correlation/overlap analysis for portfolios
- Monte Carlo simulation chart
- Real-time monitoring dashboard
- Dark mode (institutional = light mode)
- WCAG AA accessibility audit
- Aggregate social proof on landing page improvements (exchange logos, testimonials)

### P3
- MAE/MFE analysis (FXBlue feature)
- Visual gauge scales for metrics (TradeLink feature)
- Multi-account strategy aggregation
- Real-time WebSocket data sync
- White-label verification API

## Completed (this session, 2026-04-06)
- ~~Portfolio Intelligence Task 1: Database migration 010_portfolio_intelligence.sql~~ v0.0.1.0 (2026-04-06)
- ~~Portfolio Intelligence Task 2: TypeScript types (src/lib/types.ts)~~ v0.0.1.0 (2026-04-06)
- ~~Portfolio Intelligence Task 3: Pydantic schemas (analytics-service/models/schemas.py)~~ v0.0.1.0 (2026-04-06)
- ~~Portfolio Intelligence Task 4: TWR/MWR computation module with TDD (analytics-service/services/portfolio_metrics.py + tests)~~ v0.0.1.0 (2026-04-06)
- ~~Sprint 0: Plausible analytics, Sentry error tracking, legal disclaimers~~
- ~~Sprint 1: Public discovery (/browse), email notifications (Resend), share factsheet button~~
- ~~Phase 2: Trust badges (SyncBadge), discovery filters (exchange + track record), percentile ranks, sync progress UX, info hierarchy~~
- ~~Phase 3: Health score, My Allocations hub (/allocations), My Investors hub (founder notes), social proof (real DB stats)~~
- ~~Phase 5: API key re-validation on cron sync, PDF factsheet (Puppeteer), E2E tests (Playwright)~~
- ~~Design: DESIGN.md created, design system applied (DM Sans + Instrument Serif + Geist Mono, muted teal #1B6B5A)~~
- ~~Design: 3 production HTML reference pages generated (landing, factsheet, discovery)~~

## Previously Completed
- ~~Phase 1: Security hardening + data correctness~~
- ~~Phase 3 (prior): Business loops — matching, landing page, cron sync~~
- ~~Deploy analytics service to Railway~~
- ~~Fix Supabase strategy_analytics returned as object not array~~
- ~~Fix daily PnL to percentage returns conversion~~
- ~~Fix OKX bills API instType parameter~~
- ~~Replace individual trade scanning with account-level PnL fetch (200+ → 4 calls)~~
- ~~Fix proxy redirecting authenticated API calls~~
- ~~Fix API key encryption KEK persistence~~
- ~~Fix signup trigger search_path~~
- ~~Fix email confirmation auto-login~~
- ~~Add anonymous strategy codenames, strategy types, data gate~~
- ~~Add admin sidebar link, Resync button, auto-sync on API key connection~~
