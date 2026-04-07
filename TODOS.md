# TODOS

## Next Up (high impact, ready to build)

### P0 — Portfolio Intelligence: Post-Merge Verification (carry-over from 2026-04-07 ship)
- [ ] **Apply migration 010 to staging Supabase** — `supabase/migrations/010_portfolio_intelligence.sql`. Creates 5 new tables (allocation_events, portfolio_analytics, portfolio_alerts, audit_log, verification_requests), extends portfolio_strategies + relationship_documents, RLS policies, and the `portfolio-documents` storage bucket.
- [ ] **End-to-end smoke test with real Binance read-only API key** via the landing page verification form (submit → poll → results). Verify the form returns `verification_id` (was a critical bug caught by /qa).
- [ ] **Trigger sample portfolio analytics computation end-to-end** on a portfolio with 2+ strategies. Verify TWR/MWR/correlation/attribution all populate correctly and the dashboard renders without errors.
- [ ] **Verify portfolio PDF export** generates a valid A4 PDF via `/api/portfolio-pdf/[id]` (Puppeteer route).
- [ ] **Verify cron-triggered alert digest** by setting `CRON_SECRET` env var and POSTing to `/api/alert-digest`.
- [ ] **Test the migration wizard** end-to-end: search for a published strategy, claim it with amount + date + notes, verify rows land in portfolio_strategies + allocation_events + relationship_documents.

### P0 — CI Coverage Gate (chronic, fix or relax)
- [ ] **Fix or relax the Python CI coverage gate** (`pytest --cov-fail-under=80`). Main has been failing this gate on every push for 5+ commits because `benchmark.py` (15%), `db.py` (54%), `encryption.py` (61%), and `exchange.py` (66%) are all under-tested. Total coverage is 74% after the portfolio intelligence branch (was 70% before). Either:
  - Lower the gate to 70% temporarily and create P1 TODOs for the under-tested modules, OR
  - Add tests for the 4 under-tested modules to bring total above 80%
  - Reference: `.github/workflows/ci.yml` (or wherever the python check is defined)

### P1 — Portfolio Intelligence: Production Hardening (carry-over)
- [ ] **Wire optimizer suggestions into the dashboard UI** — the `/api/portfolio-optimizer` endpoint computes `optimizer_suggestions` and stores them in `portfolio_analytics.optimizer_suggestions`, but no frontend component renders them yet. Build a `PortfolioOptimizer` panel showing the top 5 candidate strategies with corr/sharpe-lift/score metrics.
- [ ] **Wire `runPortfolioOptimizer` into the dashboard** — there's a "Run Optimizer" button somewhere obvious that POSTs to `/api/portfolio-optimizer`.
- [ ] **Convert MigrationWizard 3-step DB write into a server transaction** — currently the wizard does 3 sequential client-side writes (portfolio_strategies upsert, allocation_events insert, relationship_documents insert). On partial failure the portfolio is left in an inconsistent state. Move to a single API route doing an RPC/transaction.
- [ ] **Generate target_weight column for portfolio_strategies** — migration 010 adds `current_weight` but the spec also envisioned `target_weight` for rebalancing. Decide if we need it before alerts can fire on rebalance drift.
- [ ] **Auto-populate allocation_events from exchange API transfer history** — autoplan fix #4 said "Exchange as primary source of truth: Auto-detect deposits/withdrawals from exchange API transfer history. allocation_events are auto-populated, with manual entry as override only." The schema has the `source TEXT CHECK ('auto', 'manual')` column but the auto-detection logic in cron.py is not built yet.
- [ ] **Persist KEK securely** (Supabase Vault or KMS for production, currently .env.local)
- [ ] **Test puppeteer in production** — Vercel doesn't ship Chromium by default; verify the existing factsheet PDF and new portfolio PDF actually work in deployed env, or switch to `@sparticuz/chromium` + Vercel function.
- [ ] **Strategy_id column for relationship_documents was added in migration 010** but the API route doesn't accept/persist it explicitly through the upload form (DocumentUpload sends it, the API route accepts it). Verify end-to-end after migration applies.

### P1 — Tech Debt from /qa pass (2026-04-07)
- [ ] **14 ESLint warnings** remaining in pre-existing files (unused vars, missing useEffect deps, useCallback deps). Most are in `MobileNav`, `ApiKeyManager`, `OrganizationTab`, `RiskAttribution`, `StrategyHeader.test`. Clean up next time touching those files.
- [ ] **Move pre-existing factsheet PDF route to use `assertPortfolioOwnership`-style helper** — the factsheet route still has inlined ownership checks. Standardize on the helper introduced in /simplify pass.
- [ ] **The `redteam` adversarial review subagent agent type was attempted in /simplify** — only 2 of 3 review agents completed (one hit a 529 overload error). Re-run /simplify on portfolio intelligence code if more issues emerge.
- [ ] **Verify mobile responsive design** on all new portfolio pages (only landing page was screenshot-tested at 375×812 during /qa). Test: portfolio dashboard, management page, documents page, allocations hub.

### P1 — Design Polish
- [ ] Run /design-review on live site (http://localhost:3000) — visual audit + fix loop
- [ ] Apply design system tokens to all remaining components (some pages still have old Inter/teal)
- [ ] Compare live site against 3 HTML reference pages (landing, factsheet, discovery) at `~/.gstack/projects/AI-Isaiah-Quantalyze/designs/`
- [ ] **9 design findings from 2026-04-07 audit** — 6 high/medium were auto-fixed during /design-review. 3 polish items deferred:
  - PortfolioEquityCurve.tsx:14 — palette includes `#7C3AED` (purple/violet, borderline anti-pattern per DESIGN.md)
  - BenchmarkComparison.tsx:25,43 + FounderInsights.tsx:44 — H3 uses `text-lg` (18px) instead of spec's 16px
  - Sidebar.tsx:56 — "Quantalyze" logo text uses `font-bold` instead of `font-display` (Instrument Serif)

### P1 — Operational
- [ ] Founder-led migration of existing Telegram/email clients (manual, ~10-20 relationships)
- [ ] OKX bills API: verify data coverage for Spot vs Futures accounts
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

## Completed (this session, 2026-04-07)
- ~~**Portfolio Intelligence Platform** (25 tasks, 5 phases): allocator-side portfolio dashboard with TWR/MWR analytics, correlation matrix, risk decomposition, attribution, optimizer, narrative summaries, allocation events, alerts, documents tab, PDF export, migration wizard, landing-page exchange verification flow. Implements the GenieAI-inspired vision: allocators connect their exchange API keys, the platform auto-builds a unified dashboard across all their strategies. Migration 010 + 7 new analytics modules + 16 new frontend components + 7 new API routes. Branch: feat/portfolio-intelligence~~

## Completed (prior session, 2026-04-06)
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
