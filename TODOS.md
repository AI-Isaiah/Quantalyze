# TODOS

## Discovery & Analytics
- **P1** Correlation/overlap analysis for portfolios (quants.space has this)
- **P1** Write E2E integration tests for full API key → sync → analytics → display chain
- **P2** Real-time monitoring dashboard for strategies
- **P2** Monte Carlo simulation chart
- **P3** MAE/MFE analysis (FXBlue feature)
- **P3** Visual gauge scales for metrics (TradeLink feature)

## API Key & Sync Flow
- **P1** Show sync progress indicator (syncing/computing/complete) in real-time on edit page
- **P1** OKX bills API: verify data coverage for Spot vs Futures accounts, test with different account types
- **P1** Persist KEK securely (currently in .env.local, needs Supabase Vault or KMS for production)
- **P2** Daily cron job to re-sync trades and recompute analytics automatically
- **P2** API key periodic re-validation (check if permissions changed on exchange)
- **P2** Handle OKX bills-archive API for history older than 3 months

## Organizations
- **P1** Organizations feature: teams sharing strategies, API keys, portfolios
  - `organizations`, `organization_members`, `organization_invites` tables (migration 006 drafted)
  - Profile page "Organizations" tab with create/invite/accept UI
  - Strategies become org-scoped
  - Shared API keys within org
- **P2** Organization billing/permissions tiers

## Strategy Management
- **P1** Strategies without data should not be publishable (submission gate exists, but admin can still approve manually via DB)
- **P2** Embeddable "Verified by Quantalyze" widget for external sites
- **P2** Leaderboard / ratings system
- **P3** Multi-account strategy aggregation
- **P3** Automated accreditation checks (KYC/AML)

## Infrastructure & Security
- **P1** Enable RLS on `benchmark_prices` table (prevents price data poisoning)
- **P1** Benchmark data: Binance is geo-blocked from Railway, CoinGecko needs API key. Need reliable BTC price source.
- **P2** Redis / BullMQ for heavy compute jobs (when compute >30s)
- **P2** Billing / pricing tiers (free tier first, monetize after PMF)
- **P3** Real-time WebSocket data sync

## Testing
- **P1** E2E test: API key submission → validate → encrypt → store → link to strategy
- **P1** E2E test: sync → fetch trades → compute analytics → display on page
- **P1** Integration test: Supabase PostgREST returns analytics as object vs array
- **P2** E2E test: CSV upload → trades inserted → analytics computed
- **P2** E2E test: strategy lifecycle (create → add data → submit → admin approve → published with stats)

## UX & Design
- **P1** Dark mode toggle
- **P1** Mobile strategy card layout fix (cramped on 375px)
- **P2** /design-review visual polish pass
- **P2** Accessibility audit (WCAG AA)
- **P3** White-label verification API
- **P3** Mobile app / PWA

## Marketing
- **P2** Aggregate social proof stats on landing page ($X AUM, N+ teams)
- **P2** Speed-to-allocation SLA messaging ("20 days avg")
- **P3** Landing page / marketing site

## Completed
- ~~Deploy analytics service to Railway~~ (deployed at quantalyze-analytics-production.up.railway.app)
- ~~Fix Supabase strategy_analytics returned as object not array~~ (extractAnalytics helper)
- ~~Fix daily PnL to percentage returns conversion~~ (transforms.py)
- ~~Fix OKX bills API instType parameter~~ (iterate SWAP/FUTURES/SPOT/MARGIN)
- ~~Replace individual trade scanning with account-level PnL fetch~~ (200+ API calls → 4)
- ~~Fix proxy redirecting authenticated API calls~~ (exclude /api/ from auth redirect)
- ~~Fix API key encryption KEK persistence~~ (stored in .env.local and Railway)
- ~~Fix signup trigger search_path~~ (handle_new_user SET search_path = public)
- ~~Fix email confirmation auto-login~~ (exchange code for session on login page)
- ~~Add anonymous strategy codenames~~ (36 fictional names dropdown)
- ~~Add strategy types Long-Only/Short-Only/Long-Short~~ (replaced Directional/Bidirectional)
- ~~Add data gate before strategy submission~~ (require API key or CSV)
- ~~Add admin sidebar link~~ (visible only for ADMIN_EMAIL match)
- ~~Add Resync button for connected keys~~
- ~~Add auto-sync on API key connection~~
- ~~Add default exchange from strategy to API key form~~
