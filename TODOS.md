# TODOS

> **Goal for the next session:** Finalize the product so it can be demoed to (a) an
> allocator, (b) a strategy team, and (c) a capital introduction team. Scope stays
> roughly where it is — fill the gaps, polish the rough edges, no new features.

## Demo Readiness — three audiences, three end-to-end paths

The match engine + portfolio intelligence + verified strategy directory all exist
in code. The gap is operational: nothing is wired up against real data, the cron
isn't scheduled, and there's no demo script. Everything in this section blocks
the next demo.

### P0 — Block the demo entirely

- [ ] **Apply migration 011 to staging Supabase** — `supabase/migrations/011_perfect_match.sql`. The runbook has the exact SQL: set `app.admin_email` first, then run the migration. Without this, the founder sees clean "Apply migration 011" error messages everywhere and the match queue cannot function. (Discovered during /qa, ISSUE-002.)
  - Verify after apply: `SELECT id, is_admin FROM profiles WHERE email = 'matratzentester24@gmail.com'` returns `is_admin = true`. If not, run the manual UPDATE from the runbook.
  - Verify the 5 new tables exist: `system_flags`, `allocator_preferences`, `match_batches`, `match_candidates`, `match_decisions`.
- [ ] **Apply migration 010 to staging Supabase** (also a P0 carry-over from the portfolio intelligence ship). Same Supabase instance — both 010 and 011 must be applied together so the portfolio dashboard and the match queue both work.
- [ ] **Seed demo data so the three audience paths actually have something to look at.** Without this, the match queue is permanently empty and the eval dashboard has 0 intros.
  - **Allocator path:** at least 2 allocator-role profiles (one cold-start with no portfolio, one with 2-3 strategies in a portfolio so personalized scoring works). Set a mandate archetype on each via the admin preferences editor.
  - **Strategy team path:** at least 5-8 published strategies with verified API keys + computed analytics + 3+ months of returns. The current example strategies (Stellar, Nebula, etc.) probably suffice if their data is fresh.
  - **Capital intro team path:** at least 1 historical `match_decisions` row with `decision='sent_as_intro'` AND an existing `contact_requests` row, so the eval dashboard's hit-rate calculation has at least one data point and the decision history collapsible isn't empty.
- [ ] **Trigger the first cron-recompute manually.** Hit `POST /api/admin/match/recompute` from the admin queue's "Recompute now" button for each seeded allocator. Verify each gets a `match_batches` row + 5-30 candidates. Take a screenshot of the queue with real data — this is the demo state.

### P0 — Deployment plumbing the demo depends on

- [ ] **Schedule the match engine cron.** Pick one of: Vercel cron block in `vercel.json`, Supabase pg_cron, or a GitHub Actions workflow that hits `POST /api/match/cron-recompute` daily at 01:00 UTC. Without this, the queue's "Computed Xh ago" timestamps go stale and the demo looks dead.
- [ ] **Verify the analytics service is reachable from the deployed Next.js.** `ANALYTICS_SERVICE_URL` and `ANALYTICS_SERVICE_KEY` must be set in Vercel env. Curl `/api/admin/match/eval` from production and confirm it returns a 200 or a clean schema-error 503, not a 502 / "Analytics service is not reachable."
- [ ] **Verify Puppeteer in production** for the existing factsheet PDF and the new portfolio PDF (`/api/portfolio-pdf/[id]`). Vercel doesn't ship Chromium by default; if it breaks, switch to `@sparticuz/chromium`. (Carry-over from portfolio intelligence ship.)

### P0 — Verification end-to-end

These are the smoke tests for each demo audience. Everything below has unit-test
coverage already; this is real-data verification on the deployed site.

- [ ] **Allocator path smoke test.** As a seeded allocator: log in → `/discovery/crypto-sma` → click into a strategy → click "Request intro" → submit → verify `contact_requests` row exists. Then visit `/preferences`, fill in mandate + ticket size, save, see the success state. Then visit the portfolio dashboard if the allocator has one.
- [ ] **Strategy team path smoke test.** As a seeded manager: log in → `/strategies` → click into one → see analytics + sync badge + verified state. Receive an intro request notification (the Founder triggers one from the admin queue against this manager). Verify the email arrives.
- [ ] **Capital intro team path smoke test (the founder's flow).** As admin: open `/admin/match` → see allocator list with triage signals → open one allocator → see two-pane queue with ranked candidates → click KEEP / SKIP to record decisions → click "Send intro →" on a candidate → submit the slide-out → verify both `contact_requests` AND `match_decisions` rows are created atomically → reload, verify the row shows SENT and grays out → open `/admin/match/eval` and confirm 1 intro shipped, 1 hit (or miss) recorded.
- [ ] **Run the Playwright suite on the deployed site:** `npm run test:e2e -- match-queue`. The 13 tests should all pass now that migration 011 is applied. (Carry-over from /ship; deferred until staging was ready.)

### P0 — Demo script + handoff materials

- [ ] **Write a 1-page demo script** for each of the three audiences. ~5 minutes per demo. Steps to click, talking points, what to emphasize, what NOT to show. Live in `docs/demos/` so anyone presenting (you, a sales person, an investor) has the same playbook. **DEFERRED BY USER until next session — flagged here so it doesn't slip.**
- [ ] **Capture a "before/after" screenshot pair** for the founder workflow: time-on-task with the old Telegram-driven matching vs. the new admin queue. Even rough numbers — "Sunday 30 minutes per allocator vs. Monday 5 minutes per allocator." This is the single most powerful number for the capital intro team demo.

### P1 — Polish that affects how the demo *looks*

These don't block the demo but they're the things an LP will notice in the first 30 seconds.

- [ ] **`/admin/match/[allocator_id]` mobile/tablet check.** Plan says "best on desktop" but founders often demo from a tablet. Verify the two-pane collapses cleanly to single-column at 768-1023px and the read-only mode renders below 768px.
- [ ] **Eval dashboard empty state polish.** Right now, with 0 historical intros, the dashboard shows "No intros shipped in the last 28 days." Add the founder onboarding tutorial card here too: "Once you ship 5+ intros from the queue, this dashboard will show your hit rate against the algorithm." Currently the page looks broken when empty.
- [ ] **Match queue index skeleton/loading state.** When the API is computing a recompute, the page should show a spinner or shimmer, not blank. Verify the loading state from Task 10.5 actually triggers in practice.
- [ ] **3 deferred design polish items from the 2026-04-07 audit:**
  - `PortfolioEquityCurve.tsx:14` — palette includes `#7C3AED` (purple, anti-pattern per DESIGN.md). Replace with the muted teal or a neutral.
  - `BenchmarkComparison.tsx:25,43` + `FounderInsights.tsx:44` — H3 uses `text-lg` (18px) instead of spec's 16px. Snap to spec.
  - `Sidebar.tsx:56` — "Quantalyze" logo text uses `font-bold` instead of `font-display` (Instrument Serif). Use the display font.
- [ ] **Apply DESIGN.md tokens to any remaining stragglers.** The dashboard had old Inter/teal in a few places before; the perfect-match UI used the new tokens but a fresh sweep with `/design-review` on the live site after migration 011 is applied would catch anything that drifted.
- [ ] **Mobile responsive check on all the portfolio intelligence pages** — only the landing page got tested at 375×812 in the prior /qa pass. Test: portfolio dashboard, management, documents, allocations hub, match queue index (desktop-only is OK on the detail page).

### P1 — Founder workflow improvements that pay off in the demo

- [ ] **Founder-led migration of existing Telegram/email clients** — the ~10-20 paying allocators the founder has today should have profile rows seeded so the demo isn't stretched on synthetic users. Even minimal (display_name, company, email, role='allocator', mandate_archetype) is fine; the founder can fill in `founder_notes` over time via the admin CRM editor.
- [ ] **Wire optimizer suggestions into the dashboard UI** — the `/api/portfolio-optimizer` endpoint already computes `optimizer_suggestions` and stores them in `portfolio_analytics.optimizer_suggestions`, but no frontend renders them. Build a `PortfolioOptimizer` panel showing the top 5 candidate strategies. **This is the allocator-facing complement to the founder-side match queue**, and it's already 80% built — just needs the React panel. High-leverage demo candy. (Carry-over from portfolio intelligence ship.)
- [ ] **"Run Optimizer" button in the dashboard** that POSTs to `/api/portfolio-optimizer`.

---

## User-deferred (DEFERRED BY YOU at decision points in this session)

These were live decisions you made — kept here so you can revisit them once the demo
is in front of real allocators.

- [ ] **Allocator-facing `/recommendations` page** (Approach B from the perfect-match plan). DEFERRED BY YOU at the autoplan premise gate when both Codex and the Claude subagent independently warned that exposing the algorithm directly would substitute for your founder-trust moat instead of amplifying it. You chose Approach D (founder-amplifier). Graduation criteria for revisiting: 20+ founder-shipped intros from the Match Queue + 5+ converted to actual allocations + algorithm hit rate > 40% over a rolling 4-week window.
- [ ] **`PerfectMatchPanel` widget on the portfolio dashboard** — same Approach B deferral. DEFERRED BY YOU.
- [ ] **Match score column on Discovery** — same Approach B deferral. DEFERRED BY YOU.
- [ ] **Save / dismiss / "show me more like this" feedback loop on the allocator side** — same Approach B deferral. DEFERRED BY YOU. Founder's thumbs up/down on the admin side is the v1 ground-truth signal.

## Carry-over from Portfolio Intelligence ship (P1)

- [ ] **Convert MigrationWizard 3-step DB write into a server transaction** — currently the wizard does 3 sequential client-side writes (portfolio_strategies upsert, allocation_events insert, relationship_documents insert). On partial failure the portfolio is left in an inconsistent state. Move to a single API route doing an RPC/transaction.
- [ ] **Generate target_weight column for portfolio_strategies** — migration 010 adds `current_weight` but the spec also envisioned `target_weight` for rebalancing. Decide if needed before alerts can fire on rebalance drift.
- [ ] **Auto-populate allocation_events from exchange API transfer history** — schema has the `source TEXT CHECK ('auto', 'manual')` column but the auto-detection logic in cron.py is not built yet.
- [ ] **Persist KEK securely** (Supabase Vault or KMS for production, currently `.env.local`).
- [ ] **`strategy_id` column for relationship_documents** — added in migration 010 but verify end-to-end via DocumentUpload after migration applies.
- [ ] **End-to-end smoke test with real Binance read-only API key** via the landing page verification form (submit → poll → results). Verify the form returns `verification_id`.
- [ ] **Trigger sample portfolio analytics computation end-to-end** on a portfolio with 2+ strategies. Verify TWR/MWR/correlation/attribution all populate correctly.
- [ ] **Verify cron-triggered alert digest** by setting `CRON_SECRET` env var and POSTing to `/api/alert-digest`.
- [ ] **Test the migration wizard** end-to-end after migration 010 is applied.

## Tech debt (P1, fix when touching the file)

- [ ] **CI Coverage Gate** — Python CI `--cov-fail-under=80` has been failing on every push for 5+ commits. `benchmark.py` (15%), `db.py` (54%), `encryption.py` (61%), and `exchange.py` (66%) are under-tested. Either lower the gate to 70% temporarily and create per-module TODOs, OR add tests to bring total above 80%. Reference: `.github/workflows/ci.yml`.
- [ ] **14 ESLint warnings** in pre-existing files (unused vars, missing useEffect deps, useCallback deps). Most are in `MobileNav`, `ApiKeyManager`, `OrganizationTab`, `RiskAttribution`, `StrategyHeader.test`. Clean up next time touching those files.
- [ ] **Move pre-existing factsheet PDF route to use `assertPortfolioOwnership`-style helper** — the factsheet route still has inlined ownership checks. Standardize on the helper introduced in /simplify pass.
- [ ] **Re-run /simplify on portfolio intelligence code** if more issues emerge (the redteam adversarial review only got 2 of 3 agents in the last pass — one hit a 529 overload).
- [ ] **Reconcile the proxy admin gate with `isAdminUser()`** — `src/proxy.ts` still bounces based on email-only (`ADMIN_EMAIL`). A future admin granted via `profiles.is_admin = true` but with a different email would be 307'd before the DAL check runs. Fix by either (a) JWT custom claim that encodes `is_admin`, or (b) removing the proxy's admin check entirely and relying on per-route `isAdminUser()`. Safe to defer until there's a second admin.
- [ ] **Drop the email-based admin gate** in `lib/admin.ts` and `withAdminAuth.ts` once `is_admin` is fully populated and verified across all admin pages. Currently runs as OR for backward compatibility (perfect-match plan Task 1.5).
- [ ] **OKX bills API:** verify data coverage for Spot vs Futures accounts.
- [ ] **Handle OKX bills-archive API** for history older than 3 months.

## Deferred (build on demand signal)

### P1.5
- Allocator preference weights (personalized ranking) — ship filters+presets first, build if >=3 allocators request different criteria weights.

### P2
- **Email notifications when a new high-score match appears** — needs delivery infrastructure decision (email vs in-app vs both). Defer pending allocator usage data on the v1 admin queue.
- **Manager-side "who was I recommended to" dashboard** — privacy-by-default in v1; revisit if managers ask.
- **Custom benchmark per allocator** (vs the BTC default) for the match engine — defer until allocators ask.
- **ML collaborative filtering for matching** — needs >500 historical intro requests to be useful. Until then, the rule-based engine + founder ground truth is correct. Re-evaluate when `match_decisions` has >500 rows.
- Organizations / teams (migration 006 drafted, don't build until customer asks).
- Redis / BullMQ (premature, compute is 15-30s).
- Billing / pricing tiers (needs pricing model defined with paying customers).
- Leaderboard / ratings (incentive design needed).
- Embeddable "Verified by Quantalyze" widget.
- Competitive analysis: quants.space, Darwinex, STRATS.io, TradeLink.pro, genieai.tech.
- Correlation/overlap analysis for portfolios.
- Monte Carlo simulation chart.
- Real-time monitoring dashboard.
- Dark mode (institutional = light mode).
- WCAG AA accessibility audit.
- Aggregate social proof on landing page improvements (exchange logos, testimonials).

### P3
- MAE/MFE analysis (FXBlue feature).
- Visual gauge scales for metrics (TradeLink feature).
- Multi-account strategy aggregation.
- Real-time WebSocket data sync.
- White-label verification API.

## Completed (this session, 2026-04-07)

- ~~**Perfect Match Engine v1** (founder-amplifier): admin-only Match Queue with triage list, two-pane detail (shortlist strip + ranked candidates + sticky detail pane), keyboard shortcuts (j/k/s/u/d/r), Send Intro slide-out with idempotent SECURITY DEFINER RPC, kill switch, eval dashboard. Migration 011 + Python `match_engine.py` + 24 unit tests + 8 Next.js admin API routes + 5 React components + runbook + Playwright E2E suite. Branch: `feat/perfect-match-engine`. PR: #10. Plan + full review trail at `docs/superpowers/plans/2026-04-07-perfect-match-engine.md`.~~
- ~~**3 critical bugs caught and fixed during /qa** on the same branch: kill-switch silent fallback when migration 011 missing (ISSUE-003), preferences server component crash when migration 011 missing (ISSUE-004), E2E test status code mismatch with proxy 307 redirect (ISSUE-001).~~

## Completed (prior session, 2026-04-06)

- ~~**Portfolio Intelligence Platform** (25 tasks, 5 phases): allocator-side portfolio dashboard with TWR/MWR analytics, correlation matrix, risk decomposition, attribution, optimizer, narrative summaries, allocation events, alerts, documents tab, PDF export, migration wizard, landing-page exchange verification flow. Migration 010 + 7 new analytics modules + 16 new frontend components + 7 new API routes. Branch: `feat/portfolio-intelligence`.~~
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
