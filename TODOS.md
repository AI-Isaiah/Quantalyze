# TODOS

## Approved Plan: 10/10 Product (7 sprints, reviewed by Grok + CEO/Design/Eng pipeline)
Full plan: `~/.claude/plans/effervescent-discovering-goblet.md`

### Sprint 0: Observability + Legal Foundation
- [ ] **0A** Wire up Plausible analytics (env var exists, just needs script tag)
- [ ] **0B** Wire up Sentry error tracking (env var exists, needs SDK init)
- [ ] **0C** Add legal disclaimers to public pages + factsheet

### Sprint 1: Unbreak the Loops (P0)
- [ ] **1A** Open discovery to anonymous visitors (add `/discovery` to PUBLIC_ROUTES, create public layout)
- [ ] **1B** Email notifications via Resend (5 templates, wire into 3 API routes)
- [ ] **1C** Prominent share factsheet button (blue primary button, toast confirmation)

### Sprint 2: Trust & Clarity (P1) + Design System
- [ ] **2A** Strategy detail information hierarchy (collapsible sections, "Verified vs Self-Reported", Documents tab placeholder)
- [ ] **2B** Trust badges on strategy cards (exchange logo, sync time, freshness indicator)
- [ ] **2C** Discovery filters + saved presets (min Sharpe, max drawdown, track record, exchange, AUM, sort)
- [ ] **2D** Percentile ranks (global + per-category, hide if <5 strategies)
- [ ] **2E** Sync progress UX (step progress, elapsed time, estimate)
- [ ] **2F** Design system foundation (parallel — typography, spacing, color, chart tokens)

### Sprint 3: Depth
- [ ] **3C** Strategy health score (composite 1-100, admin-configurable weights)

### Sprint 4: Post-Intro Experience (Grok's #1 feedback)
- [ ] **3A** Allocator "My Allocations" hub (connected strategies, documents, aggregate metrics)
- [ ] **3B** Manager "My Investors" hub + founder notes (engagement visibility, triage tools)

### Sprint 5: Institutional Credibility
- [ ] **3D** Auto-generated PDF factsheet (Puppeteer + Recharts SVG, <1.5MB, <6s)
- [ ] **3E** Social proof enhancement (real aggregate stats, exchange logos)

### Sprint 6: Polish & Hardening
- [ ] **4A** Design review on live site (apply design tokens from 2F)
- [ ] **5A** E2E integration tests (full flow: signup → sync → discover → intro → email → My Allocations)
- [ ] **5B** API key re-validation on sync + CCXT version monitoring

### Sprint 7: Migration
- [ ] **5C** Founder-led migration of existing Telegram/email clients (manual, ~10-20 relationships)

## Deferred (build on demand signal)

### P1.5 — Build after client feedback
- **P1.5** Allocator preference weights (personalized ranking). Ship filters+presets first (2C), build if >=3 allocators request different criteria weights.

### P2 — No demand signal yet
- **P2** Organizations / teams (migration 006 drafted, don't build until customer asks)
- **P2** Redis / BullMQ (premature, compute is 15-30s)
- **P2** Billing / pricing tiers (needs pricing model defined with paying customers)
- **P2** Leaderboard / ratings (incentive design needed)
- **P2** Embeddable "Verified by Quantalyze" widget
- **P2** Competitive analysis: quants.space, Darwinex, STRATS.io
- **P2** Correlation/overlap analysis for portfolios
- **P2** Monte Carlo simulation chart
- **P2** Dark mode (institutional = light mode)
- **P2** WCAG AA accessibility audit

### P3 — Future
- **P3** MAE/MFE analysis (FXBlue feature)
- **P3** Visual gauge scales for metrics (TradeLink feature)
- **P3** Multi-account strategy aggregation
- **P3** Real-time WebSocket data sync
- **P3** White-label verification API

### Completed
- ~~Phase 1: Enable RLS on benchmark_prices~~ (migration 007)
- ~~Phase 1: KEK validation with canary check on startup~~ (encryption.py)
- ~~Phase 1: Benchmark cache freshness check (reject >48h)~~ (benchmark.py)
- ~~Phase 1: Fix OKX archive date filter + deduplication~~ (exchange.py)
- ~~Phase 1: Atomic trade sync with advisory lock RPC~~ (sync_trades function)
- ~~Phase 1: Fix initial capital heuristic (derive from balance)~~ (transforms.py)
- ~~Phase 2: Golden-data analytics accuracy test~~ (test_accuracy.py, 16 tests)
- ~~Phase 2: Exchange integration test harness~~ (test_exchange_harness.py, 28 tests)
- ~~Phase 2: Analytics format test (object vs array)~~ (analytics-format.test.ts, 8 tests)
- ~~Phase 2: E2E test specs for API key + sync flows~~ (Playwright)
- ~~Phase 3: Matching automation (status tracking, accept/decline, admin funnel)~~ (PendingIntros, AdminTabs, migration 008)
- ~~Phase 3: Landing page~~ (page.tsx with hero, trust badges, social proof)
- ~~Phase 3: Daily cron sync endpoint~~ (routers/cron.py)
- ~~Phase 3: Sync progress indicator~~ (SyncProgress.tsx)
- ~~Phase 3: Mobile strategy card fix~~ (StrategyGrid.tsx)
- ~~Phase 3: Admin approval data quality gate~~ (strategy-review/route.ts)
- ~~Phase 3: Fix landing page auth proxy~~ (proxy.ts, QA ISSUE-001)
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
