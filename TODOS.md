# TODOS

> **Goal:** Finalize the product so it can be demoed to allocators, strategy teams, and capital
> introduction firms. The 8-week MVP plan was refined via /autoplan v2 (4-voice adversarial
> review) and lives at `~/.claude/plans/rosy-cuddling-teacup.md`.
>
> **2026-04-08 reframe (post Steps 3-5 walkthrough):** Sprints 1-5 are now code-complete
> on staging. The constraint is no longer code velocity — it's validation velocity. With
> CC+gstack giving ~14x code compression, the plan's 8-week arc can collapse to ~4 weeks
> IF the founder-action gates close on time. The first of those gates (Pre-Sprint 0 T0.1
> partner qualification call) just turned into a "show a working product" meeting rather
> than a "describe intent" meeting — a qualitatively different conversation that could
> make the cap-intro partner a distribution channel in week 1-2, not a closing gate in
> week 8. See `### Tomorrow` block below for the immediate ship list.

## Tomorrow — Cap-intro friend meeting sprint (2026-04-09)

**Context:** First live demo of the working product to a capital-intro friend. Qualification
call stakes, not the formal partnership close — but this meeting decides whether the plan
continues as-is or pivots around the friend's feedback. Bar: nothing breaks, one clear "wow"
moment (the partner-pilot CSV upload), and a structured set of 5 qualification questions.

**Plan for the session:** Land P0 batch first (demo cannot break), then stack P1 items in
order. If P1 items slip, P0 alone is already a strong meeting. Hard stop at 11pm — a rested
founder demoing a simpler product outperforms a tired founder demoing a fancier one.

### P0 — Tomorrow demo cannot break without these (~90 min CC time)

- [x] **T-0.1 Disclosure tier render guard.** Create `src/lib/strategy-display.ts` with a
  `displayStrategyName(strategy)` helper: return `codename` if present, else `name` if
  `disclosure_tier='institutional'`, else `'Strategy #' + id.slice(0,8)`. Replace every
  `codename || name` fallback: `AllocatorMatchQueue.tsx:538,621,896`,
  `CandidateDetail.tsx:41`, `SendIntroPanel.tsx:78`. **DONE criteria:** every seeded
  exploratory strategy (Helios, Orion, Pulsar, Quasar) shows a pseudonym in the admin queue.
  Verified by click-through. **Shipped PR #__ 2026-04-08 — helper + test + 5 call sites + API route `disclosure_tier` select.**
- [x] **T-0.2 Backfill codename on 4 seeded exploratory strategies.** In
  `scripts/seed-demo-data.ts`, set `codename` on the insert for Helios → `'Strategy H-42'`,
  Orion → `'Strategy O-17'`, Pulsar → `'Strategy P-88'`, Quasar → `'Strategy Q-03'`. Re-run
  seed with `SEED_CONFIRM_STAGING=true`. **DONE criteria:** REST probe
  `/strategies?select=name,codename&is_example=eq.true` shows 4 rows with codename populated.
  **Code shipped PR #__ 2026-04-08 — seed re-run is the ops follow-up.**
- [ ] **T-0.3 Persist `app.admin_email` on staging.** Run once in Supabase dashboard SQL
  editor: `ALTER DATABASE postgres SET app.admin_email = 'matratzentester24@gmail.com';`
  **DONE criteria:** dashboard returns `ALTER DATABASE`. No code change, just future-proofs
  migration 011's backfill for any DB restore. **Documented in PR #__ body 2026-04-08 as ops action required post-merge.**
- [ ] **T-0.4 Fix `_load_allocator_context` latent bugs in analytics match engine.**
  `analytics-service/routers/match.py:185-212`. Change `.select("strategy_id, weight,
  portfolio_id")` to `.select("strategy_id, current_weight, portfolio_id, allocated_amount")`.
  Replace `row.get("weight")` with `row.get("current_weight")`. Replace the
  `strategy_analytics.total_aum` sum with summing `portfolio_strategies.allocated_amount`
  from ps_rows directly. Redeploy Railway. **DONE criteria:** manual curl to
  `/api/match/recompute` with an allocator that has a portfolio returns 200 not 500.
  Requires T-0.5 to exist first for testing.
- [ ] **T-0.5 Seed one portfolio for ALLOCATOR_ACTIVE.** Add to `scripts/seed-demo-data.ts`
  after the strategy insert: create a `portfolios` row for `ALLOCATOR_ACTIVE` plus 3
  `portfolio_strategies` rows linking to 3 of the seeded institutional strategies (Alice,
  Marcus, Aurora), with `current_weight` and `allocated_amount` populated. Unblocks T-0.4
  testing AND turns the Active Allocator demo into a "here's personalized scoring" story
  instead of generic screening. **DONE criteria:** admin match queue for Active Allocator
  shows `mode='portfolio'` not `'screening'`, candidates ordered by correlation-with-portfolio.
- [ ] **T-0.6 Schedule pg_cron (T1.5 from the plan).** Add `supabase/migrations/015_schedule_match_cron.sql`:
  first verify `pg_net` and `pg_cron` extensions enabled in Supabase dashboard → Database →
  Extensions, then `SELECT cron.schedule('match_engine_cron', '0 * * * *', $$ SELECT
  net.http_post('https://quantalyze-analytics-production.up.railway.app/api/match/cron-recompute',
  '{}', 'application/json', ARRAY[('X-Service-Key', '<key>')]::http_header[]) $$);`. Push via
  `supabase db push`. **DONE criteria:** `cron_runs` table has a fresh row from the hourly
  tick by demo time tomorrow.
- [ ] **T-0.7 Force-refresh all 3 allocator match batches right before sleep.** Curl POST
  `/api/match/recompute` with `{"allocator_id":"...","force":true}` for each of the 3 seeded
  allocators. Sets `computed_at = now()` so tomorrow's demo shows "Computed <12h ago" not
  "Computed 36h ago — stale." **DONE criteria:** admin queue shows fresh timestamps across
  all 3 allocators.

### P1 — The wow moments (~4-5 hrs CC time)

Each of these can ship independently. If a P1 item hits a wall, drop it and move to the
next. P0.1-0.7 + P1.1 alone is a stronger meeting than most founders bring.

- [ ] **T-1.1 Shareable public demo URL at `/demo`.** **This is the single most important
  deliverable after the P0s.** New route `src/app/demo/page.tsx` — server component loading
  ALLOCATOR_ACTIVE's seeded state (portfolio + recommendations + matches) via hard-coded UUID
  instead of `auth.uid()`. Renders a simplified combined `/recommendations` + `/portfolios/[id]`
  view. No accredited gate, no auth. Top banner: "Live demo — simulated data. [Sign up to
  build your own →]". Second route `src/app/demo/admin/page.tsx` loading the match queue for
  ALLOCATOR_ACTIVE, read-only, clearly labeled as founder view. Add both to `PUBLIC_ROUTES`
  in `src/proxy.ts`. **DONE criteria:** open `https://quantalyze.vercel.app/demo` and
  `/demo/admin` in an incognito window with no cookies, see the full flow with zero clicks.
  Send URL to yourself on Telegram, open on phone, must work. The friend meeting ends with
  "send me that link" — you already have the link.
- [ ] **T-1.2 Revenue simulator page at `/admin/partner-roi`.** One screen, four inputs:
  `partner_allocators` (default 50), `partner_managers` (default 200), `avg_ticket_size_usd`
  (default 5_000_000), `take_rate_pct` (default 15). Output: estimated intros/month =
  `allocators * 0.3 * hit_rate`, where hit_rate pulls from the eval dashboard math (or fake
  at 0.4 with a note if real data insufficient). Projected partner revenue = `intros *
  avg_ticket_size * 0.015 * take_rate_pct/100` (1.5% management fee assumption). Pure
  client-side math, no backend. **DONE criteria:** change the allocator count live during
  the meeting and the partner sees the revenue number update in real time.
- [ ] **T-1.3 Partner pilot flow — minimum viable sketch.** Do NOT build the full white-label.
  Build the STORY so the friend can visualize it:
  - New migration `016_partner_tag.sql` adding `partner_tag TEXT` nullable column to
    `profiles`, `strategies`, `contact_requests`, `match_batches`.
  - `src/app/admin/partner-import/page.tsx` — CSV upload form accepting rows of
    `(manager_email, strategy_name, disclosure_tier)` and `(allocator_email, mandate_archetype,
    ticket_size_usd)`.
  - `src/app/api/admin/partner-import/route.ts` — parses CSV, creates auth users via admin
    API, upserts profiles + (empty) strategies, tags all rows with the supplied `partner_tag`.
  - `src/app/admin/partner-pilot/[partner_tag]/page.tsx` — filters match queue + eval
    dashboard + contact_requests by partner_tag. Reuses existing components with a
    `?filter=partner_tag` query param.
  - **DONE criteria:** during the meeting, invent a sample CSV (3 managers, 5 allocators,
    5 strategies), upload it, and within 60 seconds the friend sees a filtered version of
    the match queue running against "their" data. This is the "I signed on Tuesday and had
    something to show my LPs by Friday" proof of CC velocity.

### P2 — Only if everything above lands with time to spare (~2-3 hrs)

- [ ] **T-2.1 One real dry run with you as the allocator.** 30 min of your time. Create a
  throwaway account on staging. Walk through: sign in → accredited gate → `/discovery` →
  click into a seeded institutional strategy → open tear sheet → request intro → verify
  email lands in your inbox. Every friction point becomes a 5-minute CC fix.
- [ ] **T-2.2 Backup static tour.** 6 annotated screenshots of the demo flow saved to
  `docs/demos/friend-meeting-backup.md`. Fallback if analytics service 502s mid-demo. Not
  for the primary demo — for the "if the internet dies, here's what you would have seen"
  recovery.
- [ ] **T-2.3 Meeting opener + qualification script.** Not code. `docs/demos/friend-meeting-script.md`
  with 3 possible opening lines (e.g., "I'm going to show you a working product for 10
  minutes, then ask you 5 questions. The questions are the point — the product is the
  context.") plus the 5 Pre-Sprint 0 T0.1 qualification questions verbatim from
  `~/.claude/plans/rosy-cuddling-teacup.md` §P-9: (1) What would you need to see to partner
  with us? (2) What's your typical deal structure? (3) What are you getting from your
  existing tech vendors today? (4) What would make you walk away from this meeting saying
  "not interested"? (5) Can you credibly direct $10M+ of LP capital into Quantalyze in the
  next 12 months?

### Hard rules for tomorrow's session

- P0 batch (T-0.1 through T-0.7) must land first. No exceptions. Broken demo > simpler demo.
- Every feature ships through `/ship` or at least tests + review. Do not shortcut the review
  loop to "save time." Time saved on review is time lost to mid-demo bugs.
- After each P1 item, redo end-to-end dry run. Fresh incognito window, real browser, real
  network.
- Deploy early, deploy often. Each P0/P1 is its own PR so broken deploys surface before
  stacked work builds on top.
- If any P1 item hits a wall, drop it and move on.
- Hard stop at 11pm or whenever head stops working.

### What the meeting looks like if everything above lands

1. A live, working, bug-free demo on staging with pg_cron ticking hourly.
2. A URL you send to the friend's Telegram BEFORE the meeting so they arrive with context.
3. A live revenue simulator where you type their actual allocator count and show them the
   math in real time.
4. A CSV upload flow where you say "give me 5 of your strategies and 5 of your allocators"
   and you do it in the meeting in under 2 minutes.
5. A backup story if any component breaks.
6. 5 structured questions that turn the meeting from pitch to qualification.

---

## Pre-Sprint 0 — Founder qualification + before-metric capture

**Status:** Templates delivered. Founder actions pending. Both must complete before Sprint 1.

- [x] **Templates committed** — `docs/pitch/partner-qualification-script.md`,
  `docs/pitch/partner-qualification-notes.template.md`,
  `docs/demos/before-metric.template.md` (filled-in versions are gitignored to keep
  partner-sensitive info out of the public repo).
- [ ] **T0.1 — Founder runs the partner qualification call (~2 hours).** Both adversarial CEO
  voices in the autoplan review converged on this as the single highest-leverage act before any
  8-week build. Script: `docs/pitch/partner-qualification-script.md`. Output:
  `docs/pitch/partner-qualification-notes.md` (gitignored — copy from `.template.md` first).
  - **PROCEED** outcome → start Sprint 1 with T1.0 (fix `src/app/api/admin/match/send-intro` —
    currently sends NO email)
  - **PIVOT** outcome → edit `~/.claude/plans/rosy-cuddling-teacup.md` directly + re-run /autoplan
  - **REWRITE** outcome → stop the 8-week build, start a new plan around LP outbound
- [ ] **T0.4 — Founder runs old workflow on 2 allocators end-to-end + times it.** Template:
  `docs/demos/before-metric.template.md`. Output: `docs/demos/before-metric.md` (gitignored).
  This is the NUMERATOR of the before/after metric — the "after" half gets captured in Sprint 6
  once the new admin queue runs on staging. Does NOT depend on any new code.

---

## Demo Readiness — three audiences, three end-to-end paths

The match engine + portfolio intelligence + verified strategy directory all exist
in code. The gap is operational: nothing is wired up against real data, the cron
isn't scheduled, and there's no demo script. Everything in this section blocks
the next demo.

### P0 — Block the demo entirely

- [x] **Apply migration 011 to staging Supabase** — applied via `supabase db push` 2026-04-08. All 5 match-engine tables present. Founder `is_admin = true` set manually via REST PATCH (migration's `app.admin_email` backfill requires `ALTER DATABASE postgres SET app.admin_email = 'matratzentester24@gmail.com';` before the push — not run yet, see P0 below).
- [x] **Apply migration 010 to staging Supabase** — applied via `supabase db push` 2026-04-08. Portfolio intelligence tables present.
- [x] **Seed demo data so the three audience paths actually have something to look at** — `scripts/seed-demo-data.ts` ran successfully 2026-04-08 against staging. Seeded: 7 auth users + 7 profiles (3 allocators: Cold Start Capital / Active Allocator LP / Stalled Diligence Fund, 4 managers: Alice Chen / Marcus Okafor / Helios Research / Pulsar Labs), 8 example strategies (4 institutional + 4 exploratory) with analytics, 1 historical match_decision + contact_request.
- [x] **Trigger the first cron-recompute manually** — all 3 allocators recomputed 2026-04-08. Each got a fresh `match_batches` row + 13 candidates in `match_candidates`, mode=screening, ~315ms per recompute.

### P0 — Discovered during Steps 3-5 demo staging (2026-04-08)

- [ ] **Disclosure tier data exposure: exploratory strategies leak real names.** Migration 012 defaults `strategies.disclosure_tier = 'exploratory'` for all new rows, and the shipped UI (`AllocatorMatchQueue`, `CandidateDetail`, `SendIntroPanel`, admin API joins) renders `codename || name`. Migration 014 now adds the `codename` column (nullable), but there is no backfill and no render-side guard: every pre-existing exploratory strategy with `codename IS NULL` shows its real name, defeating the disclosure_tier contract. Fix options: (a) backfill `codename` for existing exploratory strategies (`'Strategy ' || substring(id::text, 1, 8)` or similar), (b) change UI fallback to `codename ?? 'Strategy <short-id>'` when tier=exploratory, (c) change 012's default to `institutional` (new migration + backfill). Recommended: (b) + (a). Currently only the founder has real data on staging so impact is latent, but this must fix before any real manager publishes an exploratory strategy.
- [ ] **Persist `ALTER DATABASE postgres SET app.admin_email = '…';` on staging.** Migration 011's `is_admin` backfill was not run during the `db push` because `app.admin_email` was unset. Founder profile was patched manually via REST API (`is_admin = true`). For DB restore resilience, run this once in the Supabase SQL editor so any future migration replay or restore correctly flags admin: `ALTER DATABASE postgres SET app.admin_email = 'matratzentester24@gmail.com';`

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

- [x] **Write a 1-page demo script** for each of the three audiences. ~5 minutes per demo. Steps to click, talking points, what to emphasize, what NOT to show. Live in `docs/demos/` so anyone presenting (you, a sales person, an investor) has the same playbook. ✅ DONE (Sprint 6 Track 17) — 4 scripts: `docs/demos/capintro-partner-script.md`, `allocator-script.md`, `strategy-team-script.md`, `pre-flight-checklist.md`.
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

### P1 — Analytics match engine cleanup (discovered during 2026-04-08 staging)

- [ ] **Fix `_load_allocator_context` latent bugs in `analytics-service/routers/match.py` (lines 185-212).** Same root-cause class as the two bugs we shipped fixes for: (a) selects `portfolio_strategies.weight` but the actual column is `current_weight` (renamed in migration 010); (b) sums `strategy_analytics.total_aum` to compute `portfolio_aum`, but `total_aum` lives on `portfolio_analytics`, not `strategy_analytics` — and the right source is `portfolio_strategies.allocated_amount`. Only manifests when an allocator owns a portfolio (none of the 3 demo allocators do), so it's latent and not a demo blocker. Will 500 the moment an allocator with portfolios hits the match engine.
- [ ] **Chunk unbounded `strategy_ids` list in match engine SELECT.** `analytics-service/routers/match.py` `_load_candidate_universe` passes an unbounded list to `.in_("strategy_id", strategy_ids)`. PostgREST has a ~URL-length limit; at a few hundred strategies the request will silently truncate or 414, zeroing analytics for missed strategies and producing wrong match scores without any error. Chunk in batches of ~100 and merge the dicts.
- [ ] **Log swallowed datetime parse errors.** `analytics-service/routers/match.py` line 132 has `except (ValueError, AttributeError): pass` around the `start_date` → `track_record_days` parse. A malformed date silently zeros track record and biases the match engine toward low-track-record penalties. Add `logger.warning("match_engine: failed to parse start_date %s for strategy %s", ..., sid)` so it shows up in Railway logs.

### P1 — Founder workflow improvements that pay off in the demo

- [ ] **Founder-led migration of existing Telegram/email clients** — the ~10-20 paying allocators the founder has today should have profile rows seeded so the demo isn't stretched on synthetic users. Even minimal (display_name, company, email, role='allocator', mandate_archetype) is fine; the founder can fill in `founder_notes` over time via the admin CRM editor.
- [ ] **Wire optimizer suggestions into the dashboard UI** — the `/api/portfolio-optimizer` endpoint already computes `optimizer_suggestions` and stores them in `portfolio_analytics.optimizer_suggestions`, but no frontend renders them. Build a `PortfolioOptimizer` panel showing the top 5 candidate strategies. **This is the allocator-facing complement to the founder-side match queue**, and it's already 80% built — just needs the React panel. High-leverage demo candy. (Carry-over from portfolio intelligence ship.)
- [ ] **"Run Optimizer" button in the dashboard** that POSTs to `/api/portfolio-optimizer`.

---

## Sprint 4-6 founder action items (P0/P1 — cannot be done by AI)

These require founder action on a live staging environment, a Zoom call, a
phone, or human judgment. Code has shipped for everything else in Sprint 4-6.

### Sprint 4 Track 11 — First allocator onboarding (forcing function, P0)

- [ ] **T11.1** — Pick 1 allocator from your Telegram network who has a real
  mandate and is willing to be a design partner. Before-metric template:
  `docs/demos/before-metric.template.md`.
- [ ] **T11.2** — Schedule a 30-min Zoom: "I want to walk you through this
  in exchange for a recorded testimonial if you find it useful."
- [ ] **T11.3** — Allocator signs up on staging, hits the accredited gate,
  browses the institutional lane, opens a tear sheet, requests an intro on
  a seeded strategy. Use `docs/demos/allocator-script.md` as your script.
- [ ] **T11.4** — Record the session. Watch the recording. Note every friction
  point → create new P1 tasks for Sprint 5 fixes.
- [ ] **T11.5** — **EARLY WARNING SIGNAL:** if the allocator says "this doesn't
  save me time," STOP. Do NOT continue building Sprint 5. Rethink the product
  with the allocator's feedback before writing any more code.

### Sprint 4 Track 12 — E2E viewports (P1)

- [ ] **T12.1** — Run `npx playwright test match-queue.spec.ts` at viewports
  375, 768, 1024, 1280 on the deployed staging site. Commit any new
  responsive selectors the test finds.

### Sprint 5 Track 14 — Manual polish (P1)

- [ ] **T14.1** — Mobile responsive sweep on portfolio dashboard, management,
  documents, allocations. Use Chrome devtools device emulator + the browse
  skill for automated screenshots. Flag anything that breaks below 768px.
- [ ] **T14.2** — Convert MigrationWizard 3-step client write into a single
  API route with transaction. Carry-over from portfolio intelligence ship.
- [ ] **T14.7** — Run `/design-review` (or equivalent visual audit) on the
  live site after all Sprint 4-5 changes land. Target DESIGN.md compliance
  + 0 purples + correct typography everywhere.

### Sprint 6 Track 15 — Testimonial capture (THE NORTH STAR, P0)

- [ ] **T15.1** — Schedule 1-2 additional allocator sessions with Telegram
  contacts fitting different mandate archetypes.
- [ ] **T15.2** — Structured session: 10-min walkthrough (use allocator-script.md) →
  10-min allocator-driven exploration → 5-min testimonial interview.
  Prompts:
    1. What were you expecting before you saw this today?
    2. What surprised you — good or bad?
    3. Describe Quantalyze in one sentence to another allocator.
    4. Did this save you time vs. your current manager evaluation flow?
       If yes, how much?
    5. Would you want to keep using it?
- [ ] **T15.3** — Edit the best 90 seconds. Save to
  `docs/demos/allocator-testimonial.mp4` + transcript.
- [ ] **T15.4** — BACKUP: if no allocator agrees to a testimonial, capture
  a session recording (with permission) and pull written quotes for
  `docs/pitch/one-pager.md`. The video is the ceiling; written quotes are
  the floor.

### Sprint 6 Track 16 — Before/after metric finalization (P0)

- [ ] **T16.1** — Founder runs the "new workflow" (admin queue) on the same
  2 allocators from Pre-Sprint 0 T0.4. Times it. Screenshots it.
- [ ] **T16.2** — Result: `docs/demos/before-after.md` with both screenshots
  + headline number + narrative. Target: "30 min → 5 min per allocator, 6×
  speedup."
- [ ] **T16.3** — The before/after slide is the SECOND artifact in the
  cap-intro-partner demo (right after the testimonial video). See
  `docs/demos/capintro-partner-script.md` §2:00-4:00.

## User-deferred (DEFERRED BY YOU at decision points in this session)

These were live decisions you made — kept here so you can revisit them once the demo
is in front of real allocators.

- [ ] **Allocator-facing `/recommendations` page** (Approach B from the perfect-match plan). DEFERRED BY YOU at the autoplan premise gate when both Codex and the Claude subagent independently warned that exposing the algorithm directly would substitute for your founder-trust moat instead of amplifying it. You chose Approach D (founder-amplifier). Graduation criteria for revisiting: 20+ founder-shipped intros from the Match Queue + 5+ converted to actual allocations + algorithm hit rate > 40% over a rolling 4-week window.
- [ ] **`PerfectMatchPanel` widget on the portfolio dashboard** — same Approach B deferral. DEFERRED BY YOU.
- [ ] **Match score column on Discovery** — same Approach B deferral. DEFERRED BY YOU.
- [ ] **Save / dismiss / "show me more like this" feedback loop on the allocator side** — same Approach B deferral. DEFERRED BY YOU. Founder's thumbs up/down on the admin side is the v1 ground-truth signal.

## Carry-over from Sprint 1-3 demo-ready ship (P1)

These items were either user-deferred or security/maintainability findings flagged
during the /ship pre-landing review on 2026-04-08. The critical items were fixed
inline before merging; these are the follow-ups.

### Sprint 1-3 plan items NOT DONE (user-deferred at /ship time)

- [ ] **T4.2 — Strategy edit form: Manager Profile section + disclosure_tier dropdown**.
  Currently managers cannot set their own bio/years/aum/linkedin or pick the
  institutional vs exploratory tier from the UI — only via the seed script or
  direct Supabase admin. Demo workaround: founder seeds via T2.6 script. Real
  managers signing up post-demo will hit this gap immediately.
- [ ] **T5.6 — Per-strategy risk disclosure block on factsheet**: leverage, max
  drawdown, lockup, minimum-allocation, "past performance does not guarantee
  future results". The general Disclaimer + custody variant cover the platform
  shell, but per-strategy risk language is needed for the LP-facing pages.
- [ ] **T6.5 — Playwright visual regression for tearsheet**: dense + sparse
  strategies, fail build on >0.5% pixel diff. Sprint 7 test coverage track.
- [ ] **T7.4 — Sentry alert when an `is_example=true` strategy crosses into stale**.
  Demo integrity guardrail — without it the seeded data can drift mid-demo.

### Security follow-ups from Sprint 1-3 review (P1)

- [ ] **Rate-limit /api/attestation and /api/account/deletion-request**. Both
  POST routes have zero throttling — a logged-in user can spam 10k requests
  and (for deletion) trigger 10k founder emails, exhausting the Resend quota
  for the entire platform. Add Upstash rate limit (5 req/min/user) + DB-level
  guard ("don't insert duplicate pending deletion in the last 24h").
- [ ] **Rate-limit + dedup the public PDF routes**: `/api/factsheet/[id]/pdf`,
  `/api/factsheet/[id]/tearsheet.pdf`, `/api/portfolio-pdf/[id]`. Each call
  spawns ~150-200MB of Chromium with no concurrency cap. First newsletter
  with a tearsheet link OOMs the Vercel function. Add Upstash 5 req/min/IP +
  Vercel KV cache keyed by strategy_id + last computed_at.
- [ ] **Persisted email dispatch audit trail**. The send-intro Promise.allSettled
  fix (this PR) logs failures to console but there's no DB row recording
  whether the allocator/manager actually received the intro email. On a
  flaky Resend day the queue says "sent" and nobody knows the email never
  landed. Add `notification_dispatches` table written by `send()` with
  status/error/recipient columns.
- [ ] **Recommendations admin client defense-in-depth**. The recommendations
  page reads `match_candidates` via the service-role admin client filtered
  only by `batch.id`. The batch_id was loaded with `eq("allocator_id", user.id)`
  so today this is safe, but a future PR introducing shared batches or a debug
  param could leak another allocator's recommendations. Move to a SECURITY
  DEFINER function `get_allocator_recommendations(uuid)` that enforces the
  allocator scope in SQL, not TypeScript.
- [ ] **CSRF Origin/Referer checks** on `/api/attestation` and
  `/api/account/deletion-request`. Both rely on Supabase's SameSite=Lax cookie
  for CSRF protection; add Origin/Referer header validation as defense in
  depth at the top of each POST handler.
- [ ] **Puppeteer launch + page-default timeouts**. Wrap `browser.launch()` in
  a 10s `Promise.race` and call `page.setDefaultNavigationTimeout(15000)` +
  `page.setDefaultTimeout(15000)` in `lib/puppeteer.ts::launchBrowser()`. If
  Chrome cold-start hangs, the function currently hangs the entire Vercel
  lambda until the platform kills it.
- [ ] **Attestation upsert latent footgun**. `/api/attestation` uses
  `upsert(..., { onConflict: 'user_id', ignoreDuplicates: true })` without
  `.select().single()`. Adding `.select()` later would crash with
  "no rows returned" on the duplicate-skip path. Switch to explicit
  `.upsert(...).select('user_id, attested_at, version').single()` and add a
  test that double-POSTs.
- [ ] **Pre-existing `email` and `linkedin` exposure on profiles**. Migration 002
  policy `profiles_read_public USING (true)` makes `email` and `linkedin`
  globally readable to anyone with the anon key — pre-existing leak, not
  introduced by Sprint 1-3 (which fixed the new bio/years/aum/linkedin
  columns via column-level REVOKE). Apply the same column-level REVOKE
  pattern to `email` (and possibly `linkedin`) and migrate the few callers
  that select them to use the admin client.
- [ ] **Investor attestations CASCADE → archive-then-delete**. Today
  `investor_attestations.user_id` has `ON DELETE CASCADE`. In v1 the founder
  processes deletion requests manually and never hard-DELETEs profiles, so
  the cascade never fires — but the moment automatic deletion ships, the
  compliance audit trail (date/version/IP) vanishes. Add a separate
  `investor_attestations_archive` table and an archive-then-delete trigger,
  or change the FK to RESTRICT and document the manual archive step.

### Maintainability follow-ups from Sprint 1-3 review (P1)

- [ ] **Unify `ManagerIdentity` and `ManagerIdentityBlock` types**. Two parallel
  shapes with mismatched naming (snake_case vs camelCase, `linkedin` vs
  `linkedinUrl`). Pick one — likely drop `ManagerIdentityBlock` entirely and
  have email helpers consume `ManagerIdentity` directly.
- [ ] **Extract `loadManagerIdentityBlock(admin, strategyUserId)` into
  `lib/manager-identity.ts`**. The admin send-intro route + self-serve intro
  route both rebuild the same select+cast pattern. The new
  `loadManagerIdentity` helper in queries.ts already does this for the
  rendering surfaces — promote it to a shared module both API routes can
  consume.
- [ ] **Drop the `ManagerIdentityPanelForTearSheet` no-op wrapper** at
  `src/app/factsheet/[id]/tearsheet/page.tsx:361`. It forwards all props
  unchanged with no padding override despite the comment claiming otherwise.
  Either delete it or make it actually adjust the print-mode padding.
- [ ] **Recommendations match-candidate row cast**. The page mapping uses
  `Record<string, unknown>` + 8 `as Type` casts to work around Supabase's
  typed-query inference. Move the fetch into `lib/queries.ts` as
  `getRecommendationCandidatesForBatch(batchId)` with proper interfaces.

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

- [ ] **Raise Python CI coverage from 84% toward 90%.** The 80% gate cleared during the perfect-match merge with 18 smart tests. Remaining gaps are mostly in `services/exchange.py` (66%, would need ccxt mock harness extensions) and `services/portfolio_metrics.py` (78%). Optional next-pass items: `services/benchmark.py` 48-hour cache freshness gate, the CoinGecko fallback parser, and the `validate_key_permissions` per-exchange permission branches in `exchange.py`.
- [ ] **Wire the 5 SOLID Playwright `Match Queue — API admin gate` tests + `e2e/auth.spec.ts` + `e2e/smoke.spec.ts` into CI** as a separate job. Needs no auth, no DB, no migration 011. Roughly: `npx playwright install --with-deps chromium`, start `next start` against placeholder Supabase env vars, `npx playwright test --grep "API admin gate" e2e/auth.spec.ts e2e/smoke.spec.ts`. Skip the rest of `match-queue.spec.ts` until there's a seeded staging Supabase. Recommended in plan-eng-review's e2e investigation.
- [ ] **Tighten `validate_kek_on_startup` exception classification.** `services/encryption.py:31` catches `(ValueError, Exception)` which is just `Exception`. Replace with `cryptography.fernet.InvalidToken | ValueError | binascii.Error` so the error message points at the actual failure mode. Code smell, not a bug.
- [ ] **Add input validation to `compute_hit_rate_metrics`.** `services/match_eval.py:62-65` reads `intro["allocator_id"]`, `intro["strategy_id"]`, `intro["created_at"]` without defensive parsing — a malformed row from the DB raises `KeyError` and crashes the eval endpoint. Wrap with a try/except per intro and skip malformed rows with a structured log warning.
- [ ] **Document `cryptography.fernet` correctly.** The plan + service docstrings call this "AES-256-GCM" but Fernet is AES-128-CBC + HMAC-SHA256 (still authenticated, still cryptographically sound). Worth correcting in any compliance review or security audit. Not a security bug.
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

## Completed (2026-04-08, Sprint 4-6 demo-ready polish + docs)

- ~~**Sprint 4 Track 10 match queue polish**: drawer responsive Option B
  (read-only banner below md, existing two-pane layout below lg still
  usable), shimmer skeleton loading state replacing the text placeholder,
  eval dashboard onboarding card empty state with intros shipped counter
  + open-queue CTA, `?` keyboard shortcut hint modal (gated to body
  activeElement + isLg check), match queue index mandate-archetype
  dropdown filter alongside the existing search + status chips,
  DashboardChrome client wrapper that hides the sidebar on
  `/admin/match/[allocator_id]` for full-bleed usage. Decision history
  timeline was already present in the allocator detail pane and is
  unchanged.~~
- ~~**Sprint 5 Track 13 portfolio optimizer (service + UI)**: new
  `POST /api/portfolio-optimizer` route with ownership check, 60s
  AbortSignal timeout, 503/504 error mapping; analytics-service/routers/
  portfolio.py contract repair (`weight` → `current_weight` in 3 places,
  `is_published` → `status='published'`, strategy name hydration so the
  UI doesn't need a second round-trip); `PortfolioOptimizer.tsx` with
  all 5 states (empty, computing, empty-after-compute, stale banner,
  failed, success), Run Optimizer button that POSTs + router.refresh(),
  Add to Portfolio CTA linking to manage?add=X, lazy-loaded via
  `next/dynamic` below the fold of `portfolios/[id]/page.tsx`.~~
- ~~**Sprint 5 Track 14 polish**: RemoveStrategyButton on
  `portfolio/[id]/manage` with confirm modal + inline error handling;
  purple `#7C3AED` replaced with deeper teal `#0F766E` at the source
  in `lib/utils.ts::STRATEGY_PALETTE` (inherited by PortfolioEquityCurve,
  RiskAttribution, CompositionDonut); H3 sizes fixed from `text-lg`
  to `text-base` in BenchmarkComparison (2 places) and FounderInsights
  (2 places); Sidebar logo switched from `font-bold` to `font-display`
  (Instrument Serif) per DESIGN.md.~~
- ~~**Sprint 6 Track 17 demo scripts**: 4 markdown files in
  `docs/demos/` — capintro-partner-script (15 min, opens with
  testimonial video), allocator-script (6 min, ends with testimonial
  capture prompts), strategy-team-script (4 min manager onboarding),
  pre-flight-checklist (1-hour-before-demo verification flow with
  infrastructure + demo data + materials + environment sections).~~
- ~~**Sprint 6 Track 18 pitch artifacts**: 4 markdown files in
  `docs/pitch/` — term-sheet-draft (1-page partnership term sheet
  anchoring the partner conversation, with revenue share + attribution
  + 180-day window + no-exclusivity v1 + open questions), one-pager
  (problem/solution/why-now/proof-artifact/business-model/traction/ask),
  competitive-landscape (4 categories: prime desks, boutique cap-intros,
  direct LP channels, retail-quant platforms; positioning statement at
  the end), objection-handling (top 10 objections with answers, evidence,
  and dodge-to-watch-for lines).~~

## Completed (2026-04-08, Sprint 1-3 demo-ready ship)

- ~~**Sprint 1 plumbing** (T1.0 send-intro email dispatch with Promise.allSettled + email format validation, T1.5a migration 013 cron heartbeat + fail-loud schedule with secret resolved at execution time, T1.6 shared `lib/puppeteer.ts::launchBrowser()` across all 3 PDF routes via puppeteer-core + sparticuz/chromium, T1.8 `/api/factsheet` PUBLIC_ROUTES, T1.9 unified email domain to quantalyze.com with PLATFORM_NAME templating, T2.6 deterministic seed-demo-data.ts).~~
- ~~**Sprint 2 disclosure tier + compliance shell + tenancy pre-pay** (migration 012 with bio/years_trading/aum_range on profiles, disclosure_tier CHECK on strategies, nullable tenant_id on 5 tables, investor_attestations + data_deletion_requests tables; column-level REVOKE on the new sensitive columns from anon/authenticated to fix the legacy `profiles_read_public USING (true)` leak; manager identity dedup'd into `loadManagerIdentity()` helper using admin client; ManagerIdentityPanel + AccreditedInvestorGate + LegalFooter + DeleteAccountButton + custody Disclaimer variant; legal pages; force-dynamic + fail-closed try/catch on the discovery + recommendations gates).~~
- ~~**Sprint 3 tear sheet + freshness + percentile + Approach B stripped** (HTML tearsheet print-styled at `/factsheet/[id]/tearsheet`, PDF tearsheet route, shared `lib/freshness.ts::computeFreshness` with fresh<12h/warm<48h/stale≥48h plus clock-skew clamping, FreshnessBadge, PercentileRankBadge, `/recommendations` server component reading top-3 from match_batches with reasoning text, sidebar link).~~
- ~~**Pre-landing review fixes**: HTML escaping applied to all legacy email helpers (notifyManagerIntroRequest/notifyManagerApproved/notifyAllocatorIntroStatus/notifyFounderNewStrategy/notifyFounderIntroRequest/sendAlertDigest), `safeSubject()` strips CR/LF from subject lines, deletion-request route escapes user.email before founder notification, latest_cron_success() restricted to admin/service_role only, X-Service-Key resolved at cron execution time so the secret never lands in cron.job.command, queries.ts manager fetches use createAdminClient() so the column REVOKE doesn't break server-side reads, profile/page.tsx self-read uses admin client.~~
- ~~**29 new vitest tests**: 19 freshness boundary + clock-skew tests, 5 disclosure-tier redaction tests asserting profiles is queried via admin client only for institutional strategies and never queried for exploratory.~~

## Completed (2026-04-07)

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
