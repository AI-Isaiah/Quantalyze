<!-- /autoplan restore point: /Users/helios-mammut/.gstack/projects/AI-Isaiah-Quantalyze/main-autoplan-restore-20260409-082817.md -->

# Plan: Portfolio Management System — Cap-Intro Demo Hero

**Date:** 2026-04-09
**Branch:** main (work will land via feature branch `feat-portfolio-demo-hero` or direct PRs)
**Horizon:** 2 CC sessions × ~12-14 PRs ≈ 24-28 PRs of coding capacity
**Author:** Daisy (human) + Claude (autoplan scaffolding)
**Status:** ROUGH PLAN IN — awaiting /autoplan review pipeline

---

## Why this exists

A capital-introduction friend is coming in for a 30-45 min meeting. The goal is NOT to close a partnership but to walk out with (a) honest feedback, (b) 3 named allocator intros, and (c) agreement on a follow-up with one of those allocators in the room.

The demo itself is 10 minutes. The friend will **forward** the shareable URL to their colleagues after the meeting. The portfolio management system is what the forwarded URL should show — the thing that makes a cap-intro partner think "I can put this in front of my allocators on Monday".

TODOS.md says it plain: **"Make the portfolio management system Quantalyze's 10/10 demo hero for the next cap-intro / pilot-allocator meeting. Show allocators what is performing, what is underperforming, and where we can help them improve."**

The hero needs to land three moments in under 60 seconds:

1. **"Oh — this tells me what's working."** Glance → know which strategies are earning their weight.
2. **"Wait — this told me something I didn't know."** A genuine insight that the allocator couldn't have computed in their head.
3. **"And here's what I should DO about it."** A concrete, plain-English recommendation with expected outcome.

---

## What we already have (critical audit)

**SHELFWARE ALERT** — the portfolio intelligence platform was shipped in Sprint 1-6 (PR #9) and has many components built but **NOT WIRED IN ANYWHERE**:

- `src/components/portfolio/PortfolioEquityCurve.tsx` (137 lines, lightweight-charts)
- `src/components/portfolio/CorrelationHeatmap.tsx` (109 lines)
- `src/components/portfolio/AttributionBar.tsx` (50 lines, recharts)
- `src/components/portfolio/BenchmarkComparison.tsx` (88 lines)
- `src/components/portfolio/CompositionDonut.tsx` (91 lines)
- `src/components/portfolio/RiskAttribution.tsx` (84 lines)
- `src/components/portfolio/FounderInsights.tsx` (114 lines)
- `src/components/portfolio/PortfolioKPIRow.tsx` (53 lines — imported, works)
- `src/components/portfolio/StrategyBreakdownTable.tsx` (164 lines — imported, works)
- `src/components/portfolio/AlertsList.tsx` (89 lines — imported, works)
- `src/components/portfolio/PortfolioOptimizer.tsx` (296 lines — imported via dynamic)

`/portfolios/[id]/page.tsx` lines 174-189 still say `<p>Equity curve chart (Task 11)</p>` placeholder cards. The charts exist. They are just not mounted.

**Analytics backend is complete:**
- `analytics-service/routers/portfolio.py::compute_portfolio_analytics` produces the full payload: `correlation_matrix`, `attribution_breakdown`, `risk_decomposition`, `benchmark_comparison`, `portfolio_equity_curve`, `rolling_correlation`, `optimizer_suggestions`, `narrative_summary`.
- The data is persisted to `portfolio_analytics` JSONB columns.
- The columns exist in `src/lib/types.ts::PortfolioAnalytics`.

**The `/demo` route** (`src/app/demo/page.tsx`) is currently a simplified read-only view: portfolio holdings list + top 3 match recommendations. It does NOT use any of the chart components. It's hard-locked to `ALLOCATOR_ACTIVE_ID` (hardcoded UUID).

**Seed data** (`scripts/seed-demo-data.ts`, 614 lines) is deterministic (mulberry32 PRNG + fixed UUIDs) and already produces 8 strategies, 3 allocators, 1 seeded portfolio for `ALLOCATOR_ACTIVE`.

**Tests:** 25 Vitest unit tests exist; 7 Playwright E2E files exist. **ZERO cover `/demo` or the portfolio dashboard.** The smoke test only covers `/`, `/login`, `/signup`.

---

## What this plan changes (scope, concrete)

### PART A — Portfolio management data & hero cards (data → props)

Unlock the 3-moment story using data already in `portfolio_analytics`.

**Moment 1: "What's working?"** — derived cards
- **Winners & losers card**: top 3 contributors + bottom 3 detractors, 30/90/365-day toggle, computed from `attribution_breakdown`. Sorted by `contribution`. Color-coded `text-positive` / `text-negative`.
- **Portfolio health score (0-100)**: composite of `portfolio_sharpe`, `portfolio_max_drawdown` recovery, `avg_pairwise_correlation` spread, and an approximate "capacity utilization" (fallback = 1 if max_capacity isn't wired). A single number with a 1-sentence label ("Healthy" / "Concentration risk" / "Drawdown recovery"). Deterministic formula, documented in `src/lib/portfolio-health.ts`.
- **Drawdown story card**: side-by-side `portfolio_max_drawdown` vs BTC `benchmark_comparison.benchmark_twr`. Two sentences: "Beat BTC on the way up (+18% vs +12%) AND on the way down (-5% vs -22% drawdown)." Works from `benchmark_comparison`.
- **Peer benchmark card** (STRETCH): synthetic "peer median Sharpe" computed from seeded allocators. Only if we have 3+ seeded peer portfolios — else hide.

**Moment 2: "What I didn't know"** — insight sentences
- **"Biggest risk right now" sentence**: pure derivation. If `avg_pairwise_correlation > 0.5` → "Your portfolio is X% correlated on average — concentration risk masked as diversification." If `risk_decomposition` top strategy marginal_risk > weight * 1.4 → "Risk is concentrated in [X]: [Y]% of portfolio volatility on [Z]% of capital." If `portfolio_max_drawdown < -0.15` → "You're still [-X]% below peak — worth asking whether [top contributor] can carry the recovery." Deterministic template, no LLM call. Covered by `src/lib/portfolio-insights.ts` with unit tests.
- **Correlation regime change alert**: compute 30-day rolling average pairwise correlation vs prior 30-day. Analytics service already persists `rolling_correlation`. If current window > prior by >0.15 → "Your portfolio was X correlated last month; it's Y now." Otherwise → "Correlation regime stable." If data unavailable → hide (no empty state).
- **Underperformance detection**: a strategy whose TWR trails its own annualized vol band by >1 std → "[Strategy] has trailed its own baseline by [X]% over the last 8 weeks." Uses existing `attribution_breakdown.twr`. Hidden if no match.
- **Concentration creep warning**: compare `current_weight` vs `target_weight` (target_weight column does not exist — compute equal-weight as fallback for v1). If any weight drift >5pp → "Your [X] exposure was [Y]% last snapshot; it's [Z]% now." v1 fallback: use portfolio target = 1/N.
- **Monthly performance commentary**: already generated in `analytics-service/services/portfolio_optimizer.py::generate_narrative`. Already surfaced in `/portfolios/[id]/page.tsx` line 153-162. Promote to `/demo` page. No new backend.

**Moment 3: "What should I do?"** — recommendations framing
- **"What we'd do in your shoes" narrative**: reads `optimizer_suggestions` (already computed) and reframes top suggestion as 2 sentences with expected outcome. "Add [Strategy] at 10% to lift Sharpe from 1.2 to 1.4 with no drawdown increase." Hard-ignore empty/null suggestions.
- **"Where would the next $5M go?"**: dollar amounts (not weights). `$5M × suggestion_weight` for each of top 3 suggestions. Deterministic. 3-line list.
- **Rebalance to target**: hide for v1 (target_weight column doesn't exist). Leave as future work.
- **Stress test (STRETCH)**: "If BTC drops 30% over 2 weeks, your portfolio drops [X]% (CI band)." Uses `benchmark_comparison.beta` × BTC shock. Deterministic approximation; clearly labeled "historical-covariance estimate". STRETCH because it needs `beta` which may not be persisted; fall back to hiding.
- **Side-by-side alternatives**: hide for v1 (needs new optimizer endpoint that produces comparable before/after). NOT in scope.

### PART B — Wire everything into `/demo` (the forwarded URL)

Replace the simplified demo view with the full portfolio hero. Keep the current demo code as a fallback for match-engine recommendations (still valuable as a second section).

**New layout for `/demo`:**
```
[PageHeader: "Active Allocator LP — Live Portfolio Management"]

[Morning Briefing Card — narrative_summary]

[Hero Row]  (Moment 1)
├── Portfolio Health Score (big number, 0-100)
├── Winners & Losers (top 3 + bottom 3)
└── Drawdown Story (portfolio vs BTC)

[Insights Row]  (Moment 2)
├── Biggest Risk Right Now (plain-English sentence)
├── Correlation Regime (current vs prior 30d)
└── Underperformance Detection (or hidden)

[Charts Row]  (the actual chart components, finally)
├── PortfolioEquityCurve (3fr)
└── CorrelationHeatmap (2fr)

[Recommendations Row]  (Moment 3)
├── "What we'd do in your shoes" (narrative)
└── "Where would the next $5M go?" (dollar allocation)

[Strategy Breakdown Table]  (existing component, reused)

[Attribution Bar]  (finally wired)

[Top Matches — existing /demo content, demoted to secondary section]

[CTA: Send this to my IC (PDF download) | Sign up]
```

**Mobile-first:** Test at 375px. Hero row stacks to 3 rows. Charts adapt via ResponsiveContainer + lightweight-charts resize observer (already wired in the existing components).

**Narrative tooltips:** add a `NarrativeTooltip` primitive (hover card) on every KPI label explaining "what it means / why it matters". Reusable across KPI row cards.

### PART C — Real `/portfolios/[id]` dashboard finally wired up

This is the pre-existing shelfware problem. Fixing it:
1. Replace placeholder cards on lines 174-189 with real `<PortfolioEquityCurve>`, `<CorrelationHeatmap>`, `<AttributionBar>`, `<BenchmarkComparison>`.
2. Wire in `<CompositionDonut>`, `<RiskAttribution>`, `<FounderInsights>` at the bottom of the dashboard.
3. Keep existing `PortfolioKPIRow`, `StrategyBreakdownTable`, `AlertsList`, `PortfolioOptimizer`.

This work unblocks the authenticated-allocator flow for every pilot partner who signs up. It is ALSO demo-adjacent: if the friend clicks "Sign up" at the end of `/demo`, the first thing they land on is the real dashboard — which currently shows placeholder cards. That's a trust killer.

### PART D — Tests (the user's explicit ask: "enough tests that the app doesn't break mid demo")

Target: a fresh `npm run test && npm run test:e2e` at demo morning should flip red if any demo-critical path is broken.

**Playwright E2E (new files):**
- `e2e/demo-public.spec.ts` — hits `/demo` unauthenticated, asserts:
  - status 200
  - "Portfolio Health Score" present (with numeric value)
  - at least 1 winner and 1 detractor rendered
  - "Biggest Risk" sentence present and non-empty
  - "What we'd do in your shoes" present if optimizer_suggestions is non-empty
  - no console errors
  - Responsive at 375×667 (iPhone SE)
  - BackgroundLabel for "This is demo data" visible
- `e2e/demo-founder-view.spec.ts` — hits `/demo/founder-view` unauthenticated:
  - status 200
  - AllocatorMatchQueue renders
  - read-only banner visible
  - keyboard shortcuts DO NOT fire (forceReadOnly assertion)
- `e2e/portfolio-dashboard.spec.ts` — authenticated flow:
  - login → `/portfolios/{id}`
  - all 4 chart regions render (equity curve, correlation, attribution, benchmark)
  - strategy breakdown table has rows
  - optimizer card loads without hang
  - no console errors
- `e2e/portfolio-pdf.spec.ts` — PDF export cold start:
  - trigger `/api/portfolio-pdf/{id}`
  - response 200 with `Content-Type: application/pdf`
  - timeout guard: fails if >15s (surfaces the Puppeteer cold-start issue)

**Vitest unit (new files):**
- `src/lib/portfolio-health.test.ts` — health-score formula, 6 cases: healthy, concentrated, drawdown, low Sharpe, edge cases (all null, all zero), expected labels.
- `src/lib/portfolio-insights.test.ts` — Biggest Risk sentence generation, 8 cases covering each branch.
- `src/lib/winners-losers.test.ts` — sort/slice logic, toggle between 30/90/365, empty array, null contribution handling.
- `src/lib/regime-change.test.ts` — rolling correlation delta computation.

**CI:** the existing `.github/workflows` already runs vitest + playwright (from hardening PR 10). Verify `e2e/demo-public.spec.ts` runs without a logged-in user (critical — it must work in CI without auth seeding).

### PART E — Demo-breaking tech debt (from TODOS.md "Tech debt that could visibly break the demo")

1. **Puppeteer cold-start hang on portfolio PDF**: add a 15s timeout wrapper in `/api/portfolio-pdf/[id]/route.ts`. On timeout → return 504 + clear error message. Add a pre-flight warmup call on demo server boot.
2. **Analytics service Railway cold start**: add a warm-up fetch in `/demo` page load (fire-and-forget to `/health` on the analytics service) so the first real request lands warm.
3. **Mobile layout breakage below 375px**: verify all new cards in Part A/B fit at 320×568 (iPhone 5). Add a Playwright mobile viewport test.
4. **Eval dashboard empty-state copy**: "No intros shipped" → "Waiting for the first intro" (a promise, not an apology).
5. **Correlation heatmap color palette audit**: the current blue→orange gradient (lines 14-18 of CorrelationHeatmap.tsx) — audit against DESIGN.md and colorblind-safety. The accent color is `#1B6B5A` muted teal. Replace with a diverging teal→grey→burnt-orange that matches the design system and passes deuteranopia simulation.

### PART F — Seeded demo polish

1. **Three seeded allocator personas**: the seed script already creates 3 allocators (`ALLOCATOR_COLD`, `ALLOCATOR_ACTIVE`, `ALLOCATOR_STALLED`) but only `ACTIVE` has a portfolio. Add portfolios for `COLD` (over-diversified, 6 strategies, low correlation, mediocre) and `STALLED` (concentrated, 2 strategies, high Sharpe, high drawdown). Founder can pick which persona based on the prospect's situation.
2. **Seeded live alert**: add a `portfolio_alert` row with `triggered_at = now()` so a fresh-looking "correlation spike detected" banner appears on `/demo` during the walkthrough. The seed script should bump this timestamp on every run.
3. **Sample portfolio PDF**: generate a 1-click download link at the bottom of `/demo` that points to `/api/portfolio-pdf/{ACTIVE_PORTFOLIO_ID}` with a visible "This is what you'd send to your IC" label.
4. **Persona switcher** (STRETCH): a `?persona=cold|active|stalled` query param on `/demo` that flips `ALLOCATOR_ACTIVE_ID` to the right seed UUID. Founder can switch mid-demo.

---

## NOT in scope

- **Custom benchmark per allocator** (BTC only — TODOS defers)
- **ML / collaborative filtering optimizer** (needs historical data — TODOS defers)
- **Save / dismiss / feedback loop on allocator side** (TODOS defers)
- **Full white-label partner portal** (CSV sketch is enough — TODOS defers)
- **Manager-side "who was I recommended to"** dashboard (TODOS defers)
- **Real-time WebSocket refresh** (hourly cron is fine — TODOS defers)
- **Organizations / teams model** (TODOS defers)
- **Dark mode** (institutional finance is light mode — TODOS defers)
- **`target_weight` column migration** (concentration creep uses 1/N fallback for v1)
- **Side-by-side portfolio alternatives** (needs new optimizer endpoint — deferred)
- **Rebalance to target** (needs target_weight column — deferred)
- **Any cap-intro friend meeting script changes** (script is fine; the product is what needs to improve)
- **Match engine algorithm changes** (not in scope — existing hourly cron is fine)
- **Any changes to the authentication or allocator-signup flow** (not demo-critical)

---

## Rough sequencing (12-14 PRs)

Each bullet is a PR-sized chunk of ~4-8 files. Order matters: data → tests → UI → polish.

**Sprint 1 — Data primitives (first 4 PRs):**
1. `src/lib/portfolio-health.ts` + tests (health score formula)
2. `src/lib/portfolio-insights.ts` + tests (Biggest Risk / Regime / Underperf / Concentration)
3. `src/lib/winners-losers.ts` + tests (top 3 / bottom 3 from attribution)
4. `src/lib/regime-change.ts` + tests (rolling correlation delta)

**Sprint 2 — Hero cards (next 4 PRs):**
5. `<PortfolioHealthCard>` + `<WinnersLosersCard>` + `<DrawdownStoryCard>` + tests
6. `<InsightSentenceCard>` for Biggest Risk + Regime + Underperformance + tests
7. `<WhatWedDoCard>` + `<NextFiveMillionCard>` + tests
8. `<NarrativeTooltip>` primitive + KPI row integration

**Sprint 3 — /demo hero + dashboard wiring (next 4 PRs):**
9. `/demo/page.tsx` rewrite — wire all new cards, keep match recs as secondary
10. `/portfolios/[id]/page.tsx` — replace placeholder cards with real charts (PART C)
11. Persona switcher (query param) + seeded personas (cold/active/stalled portfolios)
12. Sample PDF download at `/demo` bottom + "Send this to my IC" CTA

**Sprint 4 — Tests + polish (last 4 PRs):**
13. `e2e/demo-public.spec.ts` + `e2e/demo-founder-view.spec.ts` + `e2e/portfolio-dashboard.spec.ts`
14. `e2e/portfolio-pdf.spec.ts` + Puppeteer cold-start timeout guard + analytics warmup
15. Correlation heatmap colorblind audit + mobile 320px tests + empty-state copy fixes
16. **Buffer PR**: any `/simplify` findings, polish, dogfooding fixes from QA pass

**Total:** 16 PRs — above the 12-14 estimate. If pressed, drop PR 16 (buffer) and PR 11 (persona switcher).

---

## Verification plan

- `npm run typecheck` clean at every PR
- `npm run lint` zero warnings at every PR
- `npm run test` green
- `npm run test:e2e` green (including new specs)
- Manual dogfood pass: `/demo` at 375/768/1280px before shipping
- Manual dogfood pass: `/portfolios/{ACTIVE_PORTFOLIO_ID}` with seed data
- `/qa` skill invocation after Sprint 4
- Final `/ship` per PR, culminating in a staging deploy the day before the friend meeting

---

## Open questions (surfaced for reviews)

1. Is the health score formula taste-defensible? Alternatives: Bloomberg BARS-style scorecard, composite percentile vs peer group, simple Sharpe-times-diversification.
2. Should we build the "persona switcher" at all? It adds 1 PR of scope but lets the founder tailor the demo. If we skip it, we need to pick ONE persona to lead with (probably `ACTIVE` since that's already seeded).
3. For Moment 2 "underperformance detection" — do we have enough data granularity? The attribution is trailing 90d; we don't have explicit peer-group benchmarks per strategy. v1 uses "trailed its own vol band" — is that credible to a sophisticated LP?
4. Puppeteer warmup strategy: pre-launch on first page load (cold path), or a cron-warmer that hits the endpoint every 5 min? The second is simpler but adds infra cost on Vercel.
5. Is testing `/portfolios/[id]` in Playwright worth the auth-seeding cost in CI? Alternative: keep dashboard testing as Vitest + jsdom against a mock analytics payload.

---

# PHASE 1 — CEO REVIEW (SELECTIVE EXPANSION, autoplan auto-decide)

**Mode:** SELECTIVE EXPANSION (autoplan override)
**Adversarial voices:** `[codex+subagent]` — Both ran successfully (Codex ran retroactively after user supplied API key).

## 0.5 CEO Dual Voices — consensus table

```
CEO DUAL VOICES — CONSENSUS TABLE  [codex+subagent]
═══════════════════════════════════════════════════════════════════════
  Dimension                           Claude   Codex   Consensus
  ──────────────────────────────────── ───────  ──────  ─────────────
  1. Premises valid?                   FAIL     FAIL    CONFIRMED FAIL
  2. Right problem to solve?           FAIL     FAIL    CONFIRMED FAIL
  3. Scope calibration correct?        FAIL     FAIL    CONFIRMED FAIL
  4. Alternatives sufficiently explored?FAIL    FAIL    CONFIRMED FAIL
  5. Competitive/market risks covered? FAIL     FAIL    CONFIRMED FAIL
  6. 6-month trajectory sound?         FAIL     FAIL    CONFIRMED FAIL
═══════════════════════════════════════════════════════════════════════
6/6 dimensions: BOTH MODELS AGREE plan has strategic blind spots.
THIS IS USER CHALLENGE TERRITORY per autoplan spec. Surfaced at final gate.
```

**All 6 dimensions have CROSS-MODEL CONSENSUS. The plan's direction is being challenged by both voices independently. This escalates 3 items from TASTE DECISIONS to USER CHALLENGES at the final gate.**

## CLAUDE SUBAGENT (CEO — strategic independence)

The subagent raised 7 findings:

**Finding 1 (Critical) — Optimizing the wrong moment.** The plan treats the forwarded URL as the conversion event. But cap-intro meetings produce outcomes from (a) what the friend tells allocators verbally, and (b) whether allocators click a forwarded link. 16 PRs invested in the artifact, zero in the verbal narrative. Allocators decide in Slack DMs, not in dashboards. *Fix:* 1 PR for a 90-second Loom on `/demo` top, 1 PR for a one-page "here's what to tell your allocators" brief. Cut 2 PRs of chart polish to make room.

**Finding 2 (Critical) — The forward premise is unverified.** "The friend will forward the URL" is stated as fact but has no evidence from prior cap-intro conversations. Cap-intro people make warm intros via email/calendar, not forwarded marketing links. If the friend doesn't forward, the entire hero is sunk cost. *Fix:* Before coding, ask the friend directly: "If you liked it, would you forward a URL or mention us by name?" If the answer is "mention by name", the hero is a quotable one-liner, not a dashboard.

**Finding 3 (High) — 6-month regret scenario.** In 6 months, the git log says: 16 PRs shipped. Friend forwarded to 3 colleagues. 2 never clicked. 1 scrolled 12 seconds, bounced. Zero allocators onboarded. Meanwhile zero cold emails sent to actual LPs. *Fix:* Instrument `/demo` with PostHog/Plausible. Define success as ≥3 sessions from forwarded URL within 14 days. If zero, the dashboard thesis is dead and the next sprint reframes around cold outreach.

**Finding 4 (High) — Health score is a taste landmine.** Sophisticated LPs hate composite scores — every weight is a political choice. "Health score: 73" on a forwarded URL makes Quantalyze look like Credit Karma for allocators, not institutional. The plan's Open Question #1 already flags this. Building it anyway despite flagging is the worst kind of plan. *Fix:* Kill the health score. Lead with the Drawdown Story card ("beat BTC on the way up AND on the way down") — that one claim is the hero.

**Finding 5 (High) — Dismissed alternatives were dismissed too cheaply.** "NOT in scope" rules out cap-intro script changes in one line. But 20 min of script rehearsal may yield more meeting quality than 16 PRs of dashboard polish. Also dismissed without analysis: (a) PDF-only hero (credit LPs read PDFs), (b) 2-min testimonial video, (c) FAQ doc answering the 10 questions allocators always ask. *Fix:* List 10 questions an allocator will ask after forwarding. Compare "dashboard answers N of 10" vs "PDF factsheet answers M of 10". If PDF ≥ 7, dashboard is secondary. Existing Puppeteer pipeline → 2 PRs to 10/10 factsheet vs 16 PRs to 6/10 dashboard.

**Finding 6 (Medium) — Competitive risk unmentioned.** Zero discussion of Nansen Portfolio, Dune, 21.co, Messari Enterprise institutional dashboards. If the friend has seen any of them, composition-donut + correlation-heatmap is table stakes. *Fix:* 30 min of competitive research. Find the one thing they DON'T do. Build that as the hero. Everything else is noise.

**Finding 7 (High) — 16 PRs is wrong calibration.** Cathedral scope on a shed problem. Parts C (authenticated dashboard wiring), F.1 (extra personas), and most of PART D (comprehensive test suite) are not demo-critical — they're engineering hygiene smuggled in under "demo hero". *Fix:* Target 6 PRs: (1) Drawdown Story + Winners/Losers, (2) wire into `/demo`, (3) warmup + PDF timeout guard, (4) 1 E2E smoke test for `/demo`, (5) factsheet PDF polish, (6) analytics instrumentation. Hold 10 PRs in reserve for post-meeting feedback.

**Bottom line (verbatim):** *"The plan is well-researched shelfware-rescue wearing a demo-hero costume."*

## CODEX SAYS (CEO — strategy challenge)

Codex delivered 9 findings:

**Finding 1 (Critical) — Plan optimizes for the wrong user.** It assumes "the friend will forward the link," but the stated success condition is 3 named allocator intros in a 30-45 min meeting. A richer dashboard does not cause that outcome. *Fix:* make the primary artifact an intro-conversion asset — one-screen thesis, one allocator case, one "why these 3 allocators" mapping, one forwardable memo/email. `/demo` is supporting proof, not the hero.

**Finding 2 (Critical) — Feature-parity theater.** Nansen/Messari/Dune already train the market to expect dashboards, charts, and exploratory analytics. If Quantalyze wins by "better dashboard," you lose. *Fix:* center the demo on the moat those tools do not naturally own — exchange-verified manager data, allocator-specific matching, and explainable "where the next $5M goes" with provenance.

**Finding 3 (Critical) — Fake/weakly-defensible metrics.** Synthetic peer benchmark, equal-weight target fallback, composite health score, seeded "live" alert, and vol-band underperformance will get torn apart by a sophisticated allocator. Once one metric smells made up, the whole platform loses trust. *Fix:* cut anything without real provenance. Show raw Sharpe, drawdown, concentration, correlation, and optimizer outputs only if you can explain the exact source.

**Finding 4 (High) — Forwarded-link premise under-argued.** Colleagues who receive a link later will give it 20 seconds with no narration. A dense portfolio dashboard is bad forwarded collateral. *Fix:* build a narrative-forward page or PDF with 3 claims, 3 proof points, and 1 recommended action. Treat the full dashboard as drill-down, not first impression.

**Finding 5 (High) — Scope incoherent relative to capacity.** `TODOS.md` says 12-14 PRs. The plan lands at 16 and includes `/demo`, authenticated dashboard cleanup, personas, PDF infra, cold-start mitigation, mobile hardening, color audit, and multiple E2Es. That is two projects plus housekeeping. *Fix:* cut to 6-8 PRs. Drop authenticated `/portfolios/[id]` work, persona switcher, PDF warmup, founder-view testing, and heatmap palette work from this cycle.

**Finding 6 (High) — 10x reframing dismissed too quickly.** For one meeting, concierge polish beats product breadth. A static but impeccable allocator case study will outperform a half-live system with cold starts, seeded alerts, and auth edges. *Fix:* freeze one canonical portfolio story, precompute analytics, harden one public route, ship one IC-forward PDF.

**Finding 7 (Medium) — Some scope choices will look foolish in 6 months.** A proprietary "health score" and equal-weight rebalance logic become instant legacy once real mandates, custom benchmarks, and target constraints exist. *Fix:* avoid invented abstractions now. Use explicit metrics and typed recommendation reasons that can survive future schema upgrades.

**Finding 8 (Medium) — Plan violates its own design brief.** `DESIGN.md` says utilitarian, minimal, numbers-first. The plan adds briefing cards, tooltips everywhere, live alerts, persona theatrics, and CTA clutter. *Fix:* compress the page to three rows only — verdict, evidence, action.

**Finding 9 (Medium) — Testing plan misallocated.** PDF cold-start checks and founder-view keyboard assertions are not the main meeting risk. The real risk is a public hero that looks busy, fake, or broken. *Fix:* one derivation unit-test suite, one public-route Playwright smoke/screenshot test, one seed-data integrity test.

## Cross-model consensus

| Concern | Claude subagent | Codex | Consensus strength |
|---------|-----------------|-------|--------------------|
| Wrong optimization target | Finding 1 (dashboard ≠ intros) | Finding 1 (dashboard ≠ intros) | **STRONG** — identical framing |
| Forwarded-URL premise weak | Finding 2 (unverified) | Finding 4 (under-argued) | **STRONG** |
| Dashboard is bad forwarded collateral | implied | Finding 4 (dense ≠ forward-friendly) | **STRONG** |
| Health score = taste landmine | Finding 4 (Credit Karma) | Finding 3 + 7 (fake + legacy) | **STRONG** — independent reasoning, same conclusion |
| 6-month regret scenario | Finding 3 | Finding 7 | **STRONG** |
| PDF factsheet alternative | Finding 5 (dismissed cheaply) | Finding 6 (concierge polish) | **STRONG** — same recommendation |
| Competitive risk vs Nansen/Messari | Finding 6 | Finding 2 | **STRONG** |
| 16 PRs miscalibrated → cut to 6-8 | Finding 7 (6 PRs) | Finding 5 (6-8 PRs) | **STRONG** — near-identical sizing |
| Synthetic peer benchmark + fake metrics | — | Finding 3 | Codex only (single signal) |
| DESIGN.md brief violation | — (Phase 2 subagent) | Finding 8 | CROSS-PHASE consensus (design subagent independently confirmed) |
| Testing plan misallocated | — | Finding 9 | Codex only (single signal) |

**Key takeaway:** 8 of 9 Codex findings align with the Claude subagent. Every substantive concern has cross-model agreement. This is the strongest possible signal that the plan's direction should be reconsidered — both independent voices, with NO shared context, arrived at the same conclusions.

**Per autoplan spec:** When both models agree the user's stated direction should change (merge, split, add, remove features/workflows), this is a **USER CHALLENGE**, not a taste decision. User Challenges go to the final approval gate with full context: what the user said, what both models recommend, why, what we might be missing, and the cost of being wrong.

## Escalated to USER CHALLENGES (final gate)

1. **USER CHALLENGE A — Scope calibration (16 PRs vs 6-8 PRs).** Both models independently say cut to 6-8 PRs.
2. **USER CHALLENGE B — Health score include/drop.** Both models independently say kill it (Claude: taste landmine; Codex: fake metric + legacy debt).
3. **USER CHALLENGE C — Hero framing (dashboard vs editorial/PDF).** Both models independently say the forwarded URL should be narrative-forward with 3 claims / 3 proofs / 1 action, not a dashboard.

These are presented at the final gate per autoplan's User Challenge protocol — with the user's original direction as the default, requiring the models to make the case for change.

## 0A. Premise Challenge

The Claude subagent surfaced premise concerns that need user confirmation. Naming them explicitly:

**Premise P1** — "The portfolio management system is what the friend will forward and their colleagues will click."
- Evidence cited in plan: none. It's stated as a goal in TODOS.md but not as an observation.
- Risk if wrong: 16 PRs of shelfware; zero conversion.
- Alternative framing: the friend meeting is a *conversation*, not a forwarded-URL event. What matters is what the friend SAYS about us, not what colleagues CLICK.

**Premise P2** — "The /demo URL needs to be a 10/10 dashboard to serve this goal."
- Evidence cited: TODOS.md header ("Make the portfolio management system Quantalyze's 10/10 demo hero for the next cap-intro / pilot-allocator meeting.") — that's the author's own goal, not external validation.
- Risk if wrong: sophisticated LPs may actively dislike the dashboard aesthetic (health score, gauges, color-coded cards).
- Alternative framing: the hero could be a 4-page PDF factsheet (existing Puppeteer pipeline), a 90-second testimonial video, or a one-pager "Here's what an allocator sees" document.

**Premise P3** — "We should spend most of the 24-28 PR budget on this feature."
- Evidence cited: TODOS.md "Horizon" section.
- Risk if wrong: we underinvest in cold outreach, script rehearsal, competitive differentiation.
- Alternative framing: 6 PRs on the demo hero, 6 PRs on a "how does this compare to Nansen/Messari" competitive brief, 6 PRs on LP cold outreach infra (templates, tracking, follow-up), 6 PRs of buffer.

**Premise P4** — "The demo must add NEW hero cards (Winners/Losers, Health Score, Biggest Risk)."
- Evidence cited: TODOS.md Moment 1/2/3 structure.
- Risk if wrong: the health score in particular is a taste landmine (Finding 4).
- Alternative framing: maybe the hero is ONE card ("Beat BTC on the way up AND on the way down") rather than nine.

**The premise gate is the non-auto-decided AskUserQuestion. It appears at the end of Phase 1.**

## 0B. Existing Code Leverage

Mapped every sub-problem to existing code:

| Sub-problem | Existing code | Status |
|-------------|---------------|--------|
| Portfolio holdings data | `analytics-service/routers/portfolio.py::compute_portfolio_analytics` | ✅ complete |
| Correlation matrix | `portfolio_analytics.correlation_matrix` JSONB | ✅ persisted |
| Attribution breakdown | `portfolio_analytics.attribution_breakdown` JSONB | ✅ persisted |
| Risk decomposition | `portfolio_analytics.risk_decomposition` JSONB | ✅ persisted |
| Benchmark (BTC) | `portfolio_analytics.benchmark_comparison` JSONB | ✅ persisted |
| Optimizer suggestions | `portfolio_analytics.optimizer_suggestions` JSONB | ✅ persisted |
| Equity curve | `portfolio_analytics.portfolio_equity_curve` JSONB | ✅ persisted |
| Narrative summary | `analytics-service/services/portfolio_optimizer.py::generate_narrative` | ✅ persisted to `narrative_summary` |
| Rolling correlation | `portfolio_analytics.rolling_correlation` JSONB | ✅ persisted (partial — need to verify) |
| Chart: equity curve | `src/components/portfolio/PortfolioEquityCurve.tsx` | ❌ orphaned (not imported) |
| Chart: correlation heatmap | `src/components/portfolio/CorrelationHeatmap.tsx` | ❌ orphaned |
| Chart: attribution bar | `src/components/portfolio/AttributionBar.tsx` | ❌ orphaned |
| Chart: benchmark comparison | `src/components/portfolio/BenchmarkComparison.tsx` | ❌ orphaned |
| Chart: composition donut | `src/components/portfolio/CompositionDonut.tsx` | ❌ orphaned |
| Chart: risk attribution | `src/components/portfolio/RiskAttribution.tsx` | ❌ orphaned |
| Founder insights UI | `src/components/portfolio/FounderInsights.tsx` | ❌ orphaned |
| KPI row | `src/components/portfolio/PortfolioKPIRow.tsx` | ✅ wired in `/portfolios/[id]` |
| Strategy breakdown table | `src/components/portfolio/StrategyBreakdownTable.tsx` | ✅ wired |
| Alerts list | `src/components/portfolio/AlertsList.tsx` | ✅ wired |
| Optimizer card | `src/components/portfolio/PortfolioOptimizer.tsx` | ✅ wired |
| PDF export | `src/app/portfolio-pdf/[id]/page.tsx` | ✅ complete |
| Seed data | `scripts/seed-demo-data.ts` | ✅ 614 lines, deterministic, 8 strategies, 3 allocators |
| Public /demo route | `src/app/demo/page.tsx` | ✅ simplified view (holdings + match recs) |
| Public /demo/founder-view | `src/app/demo/founder-view/page.tsx` | ✅ AllocatorMatchQueue read-only |

**Key finding:** 7 of 11 portfolio components are ORPHANED. The backend is complete. The wiring problem is purely frontend. This makes "boil the lake" cheap — no new backend work required for most of Part A/B.

**Bearing on 6-PR vs 16-PR debate:** wiring 7 orphaned components into `/demo` is mostly a single-file rewrite of `src/app/demo/page.tsx` plus ~4 new lib files for derived data. The true incremental cost of Parts A+B is closer to **4 PRs**, not the 8 in the sprint plan. The heavy cost is Parts C (dashboard wiring) + D (tests) + E (tech debt) + F (polish).

## 0C. Dream State Mapping

```
  CURRENT STATE                    THIS PLAN                  12-MONTH IDEAL
  ─────────────                    ─────────                  ──────────────
  /demo shows a static             /demo shows a full         /demo is a live, per-allocator,
  portfolio holdings list          portfolio management      interactive demo that re-renders
  + top 3 match recs               hero with 3 moments        when the friend adjusts a slider
                                   and 9-ish cards            ("what if we added $5M to X?")

  7 chart components sit           Charts wired in /demo      Charts are the skeleton;
  orphaned                         and /portfolios/[id]       insights ARE the hero

  /demo has no tests               E2E coverage gate          QA + canary on every deploy,
                                                              zero-defect demo mornings

  Demo flow is founder-            Multiple personas via      Self-service persona selector for
  memorized                        seed script                the friend to use live with allocators

  Demo breakage = silent           Breakage surfaces in CI    Demo canary runs every 15 min,
  failure                                                     pages the founder if anything drifts
```

**Dream state delta:** this plan moves us ~60% of the way to the 12-month ideal. Remaining ~40%: live interactivity (portfolio "what-if"), canary monitoring, self-service persona selector.

## 0C-bis. Implementation Alternatives (MANDATORY)

Three distinct approaches:

**APPROACH A: Full Boil-the-Lake (current plan, 16 PRs)**
- Summary: All 3 moments, all 9 hero cards, wire `/demo` + `/portfolios/[id]`, 4 new E2E specs, 4 new lib files with unit tests, tech debt + polish.
- Effort: L (~16 PRs × CC compression = ~4-6 hours wall-clock)
- Risk: Medium — scope creep, health-score taste landmine
- Pros: Complete story; unblocks authenticated dashboard; reusable primitives; tests catch future regressions
- Cons: Might ship shelfware if the friend doesn't actually forward the URL; health score is a taste risk; 16 PRs of eng hygiene disguised as "demo hero"
- Reuses: 7 orphaned components, full analytics backend, existing PDF pipeline

**APPROACH B: Surgical 6-PR Hero (subagent's proposal)**
- Summary: Drawdown Story card + Winners/Losers + wire into `/demo` + analytics instrumentation + factsheet PDF polish + warmup + 1 smoke test.
- Effort: S (~6 PRs × CC compression = ~2 hours wall-clock)
- Risk: Low-Medium — if the dashboard thesis is right, we leave hero potential on the table
- Pros: 10 PRs saved for post-meeting feedback; instrumented so we know if forwarding actually happens; factsheet PDF matches LP norms
- Cons: Orphaned components stay orphaned; dashboard wiring debt persists; no health score (correctly, per subagent Finding 4); `/portfolios/[id]` remains placeholder cards
- Reuses: Drawdown data, attribution, Puppeteer PDF pipeline

**APPROACH C: PDF-First Hero (dismissed alternative, reconsidered)**
- Summary: Treat the 4-page PDF factsheet as the hero. Polish `/api/portfolio-pdf/[id]` to look like a real LP report. `/demo` becomes a landing page with a big "Download IC report" button + a 30-sec teaser. Dashboard wiring deferred. Minimal tests.
- Effort: S (~4-5 PRs)
- Risk: Medium — if the friend actually wanted to show a dashboard to colleagues, we look under-built
- Pros: PDFs match how LPs already consume manager reports; Puppeteer pipeline exists; can be forwarded via email (not just URL); lower taste risk
- Cons: PDFs don't render on mobile links; no interactivity; looks less "product-forward" to a cap-intro friend who may want to demo something live
- Reuses: Existing Puppeteer pipeline, all analytics backend data

**RECOMMENDATION (autoplan auto-decide):** The 6 principles favor **APPROACH A (full boil-the-lake)** based on:
- **P1 Completeness**: Approach A is 10/10 complete; B is 6/10; C is 5/10
- **P2 Boil lakes**: 7 orphaned components ARE in the blast radius (they exist in this repo's `src/components/portfolio/`). Wiring them is the "fix everything in blast radius" call. Approach A does this; B and C don't.
- **P6 Bias toward action**: Approach A ships the complete thing in 2 sessions; Approach B leaves debt.

**BUT**: the subagent's Finding 4 (health score = taste landmine) and Finding 2 (forward premise unverified) are strong enough that the final approval gate should present this as a user challenge. The user has domain knowledge I don't: (a) whether the friend actually forwards URLs, (b) whether LPs tolerate composite scores. If Approach A ships and the friend hates the health score, we lose trust on a forwarded link — the worst outcome.

**Flag for final approval gate:**
- TASTE DECISION 1: Approach A (16 PRs) vs Approach B (6 PRs).
- TASTE DECISION 2: Include health score vs drop it (subagent Finding 4).

## 0D. SELECTIVE EXPANSION analysis

**Complexity check:** Plan touches ~30 files (new libs + new cards + rewrite of `/demo` + wiring `/portfolios/[id]` + 4 E2E specs + tech debt fixes). This exceeds the 8-file threshold. But most are new files (lower blast radius) and the wiring is mechanical (one-way imports, no cross-module coupling). Not actually a complexity smell.

**Minimum set that achieves the goal:**
1. 4 new lib files + tests (data primitives)
2. 6 new card components (3 moments)
3. `/demo/page.tsx` rewrite
4. `/portfolios/[id]/page.tsx` wiring (fixes shelfware, not optional given Finding 7)
5. 1 E2E spec for `/demo` (the minimum demo-break catcher)
6. Puppeteer timeout guard + analytics warmup

That's ~11 PRs. The 5 remaining ones (PR 11 persona switcher, PR 12 sample PDF + CTA, PR 13 expanded E2E, PR 15 colorblind/mobile, PR 16 buffer) are the SELECTIVE EXPANSION cherry-picks.

**Cherry-pick ceremony (auto-decided under autoplan):**

| # | Opportunity | Principle applied | Decision | Reason |
|---|-------------|-------------------|----------|--------|
| 1 | PR 11 — Persona switcher | P2 (blast radius) + P3 (pragmatic) | **ACCEPT** | 1 PR, in blast radius, lets the founder adapt the demo live — high leverage |
| 2 | PR 12 — Sample PDF download CTA | P1 (completeness) | **ACCEPT** | PDF pipeline exists; this is the "send to IC" moment from Moment 3 |
| 3 | PR 13 — Expanded E2E coverage | P1 (completeness) + user's explicit ask for tests | **ACCEPT** | The user explicitly asked for "enough tests the app doesn't break mid-demo" |
| 4 | PR 14 — Portfolio PDF E2E + Puppeteer timeout guard | P1 + TODOS.md demo-breaking tech debt | **ACCEPT** | Demo-breaking issue per TODOS.md |
| 5 | PR 15 — Colorblind audit + mobile 320px + copy fixes | P1 (completeness) + DESIGN.md alignment | **ACCEPT** | Small PR, high polish-to-effort ratio |
| 6 | PR 16 — Buffer PR | P6 (bias toward action) | **ACCEPT (soft)** | Keep as reserve; may not need it |

All expansions ACCEPTED under auto-decide. The subagent's "cut to 6 PRs" proposal is NOT auto-decided — it becomes a taste decision at the final gate because reasonable people could disagree.

## 0E. Temporal Interrogation

```
  HOUR 1 (foundations):     What does the implementer need to know?
  ─ The data primitives lib files MUST be pure functions, no I/O
  ─ Health score formula must be DOCUMENTED (even if rejected later)
  ─ /demo stays force-dynamic until we add a build-time env-var guard
  ─ Rolling correlation may not be persisted — verify before wiring the regime card

  HOUR 2-3 (core logic):    What ambiguities will they hit?
  ─ "target_weight" doesn't exist — fallback to 1/N (already documented)
  ─ "30 / 90 / 365 day" toggle requires attribution at all three horizons; the
    analytics service only persists 90-day today. Fallback: show 90d only for v1.
  ─ "peer benchmark" card depends on seeded peer portfolios — only COLD and
    STALLED personas exist stub-wise. Seed them or hide the card.
  ─ Health score needs a clear label per range — "Healthy", "Concentration risk",
    "Drawdown recovery". Edge cases: all null, all zero.

  HOUR 4-5 (integration):   What will surprise them?
  ─ /demo currently has 2-batch fallback logic (match batch A → B) — the rewrite
    must preserve that
  ─ The sidebar state / chromeless layout of /demo must not regress
  ─ PortfolioKPIRow expects analytics shape; if /demo fetches from a different
    endpoint we risk type mismatch
  ─ Mobile breakpoints: the chart components assume ResizeObserver, which works
    in jsdom? (Vitest tests may need a mock)

  HOUR 6+ (polish/tests):   What will they wish they'd planned for?
  ─ The e2e test needs to be resilient to seed data drift
  ─ The Puppeteer timeout guard should be testable without actually cold-starting
    the browser (mock chromium launch)
  ─ The Correlation Heatmap colorblind audit needs a "proof" artifact — a
    screenshot diff or a programmatic WCAG contrast check
```

**HUMAN scale vs CC+gstack scale:** Human team ~6 days; CC+gstack ~30-60 min per PR = ~8-16 hours wall-clock for the full 16-PR sprint.

## 0F. Mode selection

**Selected: SELECTIVE EXPANSION**

Context: Feature enhancement iterating on an existing system (portfolio intelligence platform exists; we're wiring orphaned components and adding insight cards on top). Default for this context is SELECTIVE EXPANSION. The user's "implement everything that makes sense" aligns with selective expansion (hold scope + cherry-pick additions).

Committed to SELECTIVE EXPANSION. Will NOT drift to REDUCTION despite subagent's Finding 7 (that's surfaced at the final gate as a taste decision).

**Approach selected under this mode:** APPROACH A (Full Boil-the-Lake). The taste decisions (A vs B, health score include/drop) are surfaced at the final gate.

---

## CEO Sections 1-11

### Section 1: Architecture Review

**ASCII dependency graph — new components vs existing:**
```
  ┌─────────────────────────────────────────────────────────┐
  │                    /demo page (rewrite)                 │
  └───────┬─────────┬─────────┬──────────┬────────┬────────┘
          │         │         │          │        │
  ┌───────▼──┐ ┌───▼────┐ ┌──▼─────┐ ┌──▼─────┐ ┌▼─────────┐
  │ Morning  │ │ Hero   │ │Insights│ │ Charts │ │ Recommen-│
  │ Briefing │ │ Row    │ │ Row    │ │ Row    │ │ dations  │
  └──────────┘ └──┬─────┘ └───┬────┘ └───┬────┘ └────┬─────┘
                  │           │          │           │
    ┌─────────────┼───────────┼──────────┼───────────┤
    │             │           │          │           │
  ┌─▼───────┐ ┌──▼────────┐ ┌─▼────────┐ │ ┌─────────▼───────┐
  │ Health  │ │ Winners/  │ │Insight   │ │ │"What we'd do"   │
  │ Score   │ │ Losers    │ │Sentence  │ │ │"Next $5M"       │
  │ (NEW)   │ │ (NEW)     │ │(NEW)     │ │ │(NEW)            │
  └─┬───────┘ └────┬──────┘ └────┬─────┘ │ └─────────┬───────┘
    │              │             │       │           │
    │              │             │       │           │
  ┌─▼──────────────▼─────────────▼───┐   │   ┌──────▼──────┐
  │  src/lib/portfolio-health.ts     │   │   │PortfolioOpt-│
  │  src/lib/winners-losers.ts       │   │   │imizer data  │
  │  src/lib/portfolio-insights.ts   │   │   │(existing)   │
  │  src/lib/regime-change.ts        │   │   └─────────────┘
  │  (all NEW — pure functions,      │   │
  │   no I/O, tested in Vitest)      │   │
  └──────────────────────────────────┘   │
                                         │
  ┌──────────────────────────────────────▼──────────────────┐
  │  Existing orphaned chart components (NOW WIRED):        │
  │  PortfolioEquityCurve  CorrelationHeatmap              │
  │  AttributionBar        BenchmarkComparison             │
  │  CompositionDonut      RiskAttribution                 │
  │  FounderInsights                                        │
  └──────┬──────────────────────────────────────────────────┘
         │
  ┌──────▼──────────────────────────────────────────────────┐
  │  Data source: portfolio_analytics JSONB                │
  │  (no backend changes)                                   │
  └──────────────────────────────────────────────────────────┘
```

**Data flow — 4 paths for the new /demo hero:**

```
  HAPPY PATH:
    admin.from(portfolios) → analytics → hero cards → rendered
  
  NIL PATH (allocator has no portfolio):
    → showDemoLoadingCard (already exists)
  
  EMPTY PATH (portfolio exists but zero holdings):
    → "Current portfolio" section hidden
    → Hero cards must handle `holdings.length === 0`:
      - Health score: "—" with "Add strategies to see your health"
      - Winners/Losers: "—" with explanation
      - Drawdown Story: hidden (no data)
      - Insights: hidden
      - Recommendations: hidden
  
  ERROR PATH (analytics computation_status === 'failed'):
    → StaleWarning banner (already exists in /portfolios/[id])
    → Hero cards render from last-good data with stale badge
    → New: stale badge per card, not just page-level
```

**Coupling concerns:** 
- The 4 new lib files are pure functions with no cross-coupling. No new global state. Good.
- The `/demo/page.tsx` rewrite imports ~15 components vs ~5 today. But all imports are one-way (card imports util), no reverse deps. Acceptable.
- `/portfolios/[id]/page.tsx` now imports the same chart components as `/demo`. One-way, no conflict.

**Scaling:** /demo is per-request today (force-dynamic). At 100x scale (1000 req/min), Supabase admin client becomes the bottleneck. Mitigation: the existing plan notes a future ISR + build-time-guard refactor — out of scope for this sprint. FLAG for TODOS.

**Single points of failure:**
- Analytics service (Railway) — if it's cold-started, hero renders with stale data. The warmup fix in PART E addresses this.
- Supabase — if rate-limited, /demo hangs. Existing Upstash rate limiting helps.
- Puppeteer — if cold-started, PDF export hangs. PART E timeout guard addresses this.

**Security architecture:**
- /demo is a PUBLIC route. New hero cards read from `portfolio_analytics` via admin client. Data is for `ALLOCATOR_ACTIVE_ID` only (hardcoded). No user input → no new attack surface.
- /portfolios/[id] is authenticated (exists). New chart wiring doesn't change auth boundaries.
- New lib files are pure — no SQL, no fetch, no user input parsing. Security surface = 0.

**Rollback posture:** Git revert. Each PR is independently revertible. No DB migrations. No feature flags needed (demo is on main or off — no partial state).

**Issues found in Section 1:**
- **Issue 1A (auto-decided, P5 explicit>clever):** The plan's new cards create a 5-level component tree on /demo. Consider a `<HeroSection>` primitive that groups the Hero Row cards. Decision: no — 5 cards directly in a `<div>` is simpler than a new abstraction. LOGGED.
- **Issue 1B (auto-decided, P2 boil lakes):** Should we add rolling-correlation persistence to the analytics service if it's not already there? Answer: verify first; if missing, add as a PR in the sprint. LOGGED.
- **Issue 1C (auto-decided, P1 completeness):** ScalingFlag → add to TODOS.md "future" list: "portfolio analytics caching layer for /demo ISR rehydration." LOGGED.

No architectural critical gaps. The plan is sound on architecture.

### Section 2: Error & Rescue Map

**CEO-scope error map** (engineering review will go deeper; this is strategic):

```
METHOD/CODEPATH                   | WHAT CAN GO WRONG                | EXCEPTION CLASS
──────────────────────────────────|──────────────────────────────────|─────────────────
computePortfolioHealth()          | all metrics null                 | returns null + label "No data"
                                  | division by zero (vol = 0)       | guarded → returns null
                                  | NaN in Sharpe                    | guarded → returns null
computeBiggestRisk()              | empty risk_decomposition         | returns null (card hidden)
                                  | malformed JSONB                  | caller try/catch → logs + hides
computeWinnersLosers()            | attribution_breakdown is null    | returns [] (card shows "No data")
                                  | all contributions = 0            | returns [] (card hidden)
computeRegimeChange()             | rolling_correlation is null      | returns null (card hidden)
                                  | <60 days of data                 | returns null (card hidden)
/demo page render                 | portfolio_analytics is null      | ComputingState (existing)
                                  | analytics.status === 'failed'    | StaleWarning (existing)
                                  | fetch throws                     | Next.js error boundary → 500
/api/portfolio-pdf                | Puppeteer cold start > 15s       | NEW: timeout wrapper → 504
                                  | Chromium launch fails            | NEW: error logged → 500 with msg
                                  | Memory pressure                  | Vercel hard limit → 502
Analytics service warmup          | /health 500                      | silent fail (fire-and-forget)
                                  | Railway cold start > 30s         | silent fail (fire-and-forget)
```

**EXCEPTION CLASS            | RESCUED? | RESCUE ACTION                       | USER SEES**
```
null returns from lib funcs  | Y        | Card hides or shows "No data"       | Empty state card
JSONB malformation           | Y        | try/catch in caller                 | Empty state card
Fetch throws                 | N ← GAP  | —                                   | Next.js 500 ← BAD
Puppeteer timeout            | N → Y    | NEW timeout wrapper                 | 504 + "PDF unavailable"
Chromium launch fail         | N → Y    | NEW error handler                   | 500 + "PDF export failed"
Analytics /health 500        | Y        | fire-and-forget                     | nothing (warmup silent)
```

**Critical gaps:**
- **GAP 2A (auto-decided, P1):** /demo page fetch error → Next.js error boundary. Fix: wrap the admin.from() calls in try/catch and render a fallback Card with "Demo data unavailable — refresh in a moment". Plan doesn't mention this. ADD to plan scope. LOGGED.
- **GAP 2B (auto-decided, P1):** Malformed JSONB in analytics data → card might crash. Fix: every lib function must return null on malformed input (defensive parse). LOGGED as a test requirement.

**Autoplan decisions:**
- Both gaps are auto-added to scope (P1 completeness, cost is minimal).

### Section 3: Security & Threat Model

**Attack surface analysis:**
- `/demo` is already public (PUBLIC_DEMO route). No new attack surface.
- `/api/portfolio-pdf/[id]` is already public-ish (admin client, bounded to demo allocator). Adding a timeout guard REDUCES attack surface (DoS via cold-start abuse).
- New lib functions are pure — no user input parsing.
- No new secrets.
- No new dependencies (we use existing lightweight-charts, recharts, `@upstash/ratelimit`).
- No new SQL writes.
- No new auth boundaries.

**Injection vectors:**
- The narrative_summary from `generate_narrative` in the analytics service is templated from trusted data (the portfolio's own analytics). No user input in the template. No XSS risk.
- Health score label is derived from numeric thresholds. No user input.
- The new `<WhatWedDoCard>` reads `optimizer_suggestions.strategy_name` — this IS user-controlled (manager's strategy name). It's rendered as `{name}` in JSX (escaped by React). No XSS. ✅

**Data classification:**
- No PII in the new cards.
- Portfolio holdings are DEMO data, not real allocator positions. No confidentiality concern.

**LLM prompt injection:**
- `generate_narrative` is NOT an LLM call — it's a Python template function. No prompt injection vector. ✅

**Issues found in Section 3:**
- **Issue 3A (auto-decided, P3 pragmatic):** Should we rate-limit `/demo` in case the forwarded URL goes viral? Existing Upstash rate limiter is wired for the main app. Decision: verify `/demo` is behind the existing rate limit middleware; if not, add it. LOGGED as an Eng review verify item.
- No other security gaps.

### Section 4: Data Flow & Interaction Edge Cases

**New data flows — 4-path tracing:**

```
PORTFOLIO ANALYTICS JSONB ──▶ LIB FUNCTION ──▶ CARD PROP ──▶ RENDER
         │                         │                 │           │
         ▼                         ▼                 ▼           ▼
      [null?]                  [catch?]           [empty?]    [mobile?]
      [stale?]                 [NaN?]             [truncate?] [narrow?]
      [malformed?]             [0-div?]           [overflow?] [overflow?]
```

**Every new lib function tests:** nil, empty, malformed, zero, NaN, Infinity.

**Interaction edge cases:**

```
INTERACTION                    | EDGE CASE                       | HANDLED?
───────────────────────────────|─────────────────────────────────|─────────
Health score card              | all metrics null                | ✅ "No data"
                               | single metric missing           | partial render
                               | extreme value (Sharpe = 50)     | clamped to [0, 100]
Winners/losers card            | fewer than 3 contributors       | show what we have
                               | negative winner (all losers)    | handled, just shows bottom 3
                               | ties at position 3              | stable sort, show first-by-id
                               | toggle 30/90/365 (only 90 exists)| disable 30 and 365 toggles v1
Drawdown story card            | benchmark_comparison null       | card hidden
                               | portfolio beat BTC on up BUT    | correct messaging
                                 not on drawdown                 |
Insight sentence card          | all 4 insight rules fail        | card hidden
                               | 2+ insights fire simultaneously | show highest severity
Regime change card             | rolling_correlation missing     | card hidden
                               | delta < 0.15                    | "Stable" message
Recommendations card           | optimizer_suggestions empty     | card hidden
                               | suggestion names missing        | hide individual row
Sample PDF button              | PDF endpoint 504 timeout        | error toast
                               | PDF endpoint 200 slow (>5s)     | spinner + disabled button
Persona switcher               | ?persona=invalid                | fallback to ACTIVE
                               | persona portfolio has zero      | show "Empty persona" warning
                                 strategies                      |
```

**Issues found in Section 4:**
- **Issue 4A (auto-decided, P1):** The 30/90/365 toggle on Winners/Losers needs 3 horizons of attribution data. Current backend only persists 90d. Fix: disable 30/365 toggles in v1 with a "coming soon" label. LOGGED. Add to TODOS: "multi-horizon attribution persistence".
- **Issue 4B (auto-decided, P1):** Persona switcher edge case: query param sanitization. Enforce allowed set `['cold', 'active', 'stalled']`, fall back to `active`. LOGGED.
- **Issue 4C (auto-decided, P1):** Mobile edge case: at 320px, the 3-card Hero Row must stack to 1 column. Existing breakpoints use `sm:` (640px) — new cards must use `sm:grid-cols-3` + mobile-first stacking. LOGGED as design section concern.

### Section 5: Code Quality Review

- **DRY:** The `formatPercent`, `formatNumber`, `formatCurrency` helpers are already in `@/lib/utils`. New cards must import from there, not re-implement. TODOS.md already flags `/demo` re-implementing some of these — this rewrite is a chance to fix that.
- **Naming:** `portfolio-health.ts`, `winners-losers.ts`, `portfolio-insights.ts`, `regime-change.ts` are clear.
- **Consistency with existing patterns:** all new card components should follow the existing `src/components/portfolio/` file structure (`"use client"` if interactive, server component otherwise; `Card` primitive wrapper; DM Sans for text, Geist Mono for numbers).
- **Over-engineering check:** avoid creating a `<HeroSection>` abstraction (Issue 1A above). 5 cards in a flex/grid is fine.
- **Under-engineering check:** lib functions must have documented units (returns `[0, 100]` or `null`, not raw floats).

**Issues found in Section 5:**
- **Issue 5A (auto-decided, P4 DRY):** `/demo` currently re-implements `formatPercent`, `formatNumber`, `formatCurrency`, and `extractAnalytics` (per TODOS.md existing debt). The rewrite must import from `@/lib/utils`. LOGGED.
- **Issue 5B (auto-decided, P5 explicit>clever):** Health score formula should be documented in a JSDoc block with a worked example, not left as opaque math. LOGGED.

### Section 6: Test Review (CEO level — Eng review will go deeper)

**New UX flows:**
- /demo landing → scroll through hero cards → download PDF → optional switch persona

**New data flows:**
- portfolio_analytics JSONB → lib function → card prop → render (for each of 4 lib files)

**New codepaths:**
- health score computation
- winners/losers sort
- biggest-risk sentence generation
- regime change delta

**New error/rescue paths:**
- Puppeteer timeout wrapper
- Analytics warmup failure (silent)
- Lib function null returns

**Test plan (CEO-level sanity check):**

```
COMPONENT                      | UNIT | INTEG | E2E | FAILURE | CHAOS
───────────────────────────────|──────|───────|─────|─────────|──────
portfolio-health.ts            | ✓    | —     | —   | ✓ null  | —
winners-losers.ts              | ✓    | —     | —   | ✓ empty | —
portfolio-insights.ts          | ✓    | —     | —   | ✓ null  | —
regime-change.ts               | ✓    | —     | —   | ✓ null  | —
HealthCard component           | ✓    | —     | ✓   | ✓       | —
WinnersLosersCard              | ✓    | —     | ✓   | ✓       | —
InsightSentenceCard            | ✓    | —     | ✓   | ✓       | —
RegimeChangeCard               | ✓    | —     | ✓   | ✓       | —
WhatWedDoCard                  | ✓    | —     | ✓   | ✓       | —
/demo page                     | —    | —     | ✓   | ✓ stale | —
/portfolios/[id] page (wired)  | —    | —     | ✓   | ✓ stale | —
/api/portfolio-pdf timeout     | ✓    | ✓     | ✓   | ✓       | ✓ cold-start
Analytics warmup               | —    | —     | —   | ✓ silent| —
Persona switcher               | —    | —     | ✓   | ✓       | —
```

The "chaos" column is almost empty. The Puppeteer cold-start IS the chaos test. That's acceptable given the scope.

**Flakiness risk:**
- E2E tests depending on seed data stability → LOW risk (seed is deterministic)
- E2E tests depending on time → NONE for /demo (no time-sensitive rendering)
- E2E tests depending on analytics service → MEDIUM risk (Railway could be cold-starting). Mitigation: the warmup fix in PART E.

**Test pyramid:** 4 new unit test files + 4-5 new E2E specs. Slightly E2E-heavy but necessary because the cards depend on real analytics JSONB shape. OK.

**Issues found in Section 6:**
- **Issue 6A (auto-decided, P1):** Eng review must produce the full test plan artifact (per autoplan spec). LOGGED as Phase 3 deliverable.
- No critical test gaps at the CEO level.

### Section 7: Performance Review

- **N+1 queries:** /demo currently does 3 parallel fetches (profile, batches, portfolio). The rewrite adds 1 more (portfolio_analytics). Still 4 round-trips, all parallel. No N+1.
- **Memory:** correlation_matrix is up to 10×10 = 100 floats. Attribution_breakdown is up to 8 rows. Rolling_correlation is ~60 points. All small. No pressure.
- **Caching:** /demo is force-dynamic per the existing comment. ISR is blocked on build-time env var guard (future work, noted).
- **Slow paths:** The slowest new codepath is the Puppeteer cold-start (2-8s). Timeout guard at 15s keeps the worst case bounded.
- **Database indexes:** no new queries.

**Issues found in Section 7:**
- **Issue 7A (auto-decided, P1):** Verify rolling_correlation is actually persisted; if not, add a short analytics-service PR to the sprint. LOGGED.
- No other perf issues.

### Section 8: Observability & Debuggability Review

**Observability gaps in the current plan:**
- No structured log on card-render-failure path
- No metric on /demo page-view count (the subagent's Finding 3 about analytics instrumentation)
- No alert on Puppeteer timeout
- No dashboard panel tracking /demo forwarded URL click-through

**Issues found in Section 8:**
- **Issue 8A (auto-decided, P1 + subagent Finding 3):** Add PostHog or Plausible instrumentation to /demo. This also addresses the subagent's concern about the forward premise. Adds 1 small PR. LOGGED, ADD TO SCOPE.
- **Issue 8B (auto-decided, P1):** Log Puppeteer timeouts with portfolio_id + elapsed_ms. LOGGED.
- **Issue 8C (auto-decided, P1):** Log analytics service warmup failures at `info` level (not `error` — they're silent by design). LOGGED.
- **Issue 8D (auto-decided, P1):** Every card component should log at `warn` level if its data is null/malformed (not crash). LOGGED.

### Section 9: Deployment & Rollout Review

- **Migrations:** None. All new work is frontend + a small analytics-service change (if rolling_correlation needs persistence).
- **Feature flags:** None needed — /demo is already public and independent. If a card breaks, revert the PR; no partial state.
- **Rollout order:** no dependencies between PRs except:
  - Lib files → card components → /demo page rewrite
  - Orphaned chart components → /portfolios/[id] wiring
- **Rollback:** git revert per PR.
- **Environment parity:** stage → prod. Seed data must be applied to staging before each PR merges (existing convention).
- **Post-deploy verification:** /demo returns 200, renders hero cards, PDF export works, founder-view loads.
- **Smoke tests:** e2e/demo-public.spec.ts runs in CI on every PR (existing CI config).

**Issues found in Section 9:**
- **Issue 9A (auto-decided, P6 bias to action):** Staging deploy cadence: the staging environment should be refreshed nightly with the latest seed. Verify this is working. LOGGED.
- No deployment blockers.

### Section 10: Long-Term Trajectory Review

- **Tech debt introduced:** Minimal. 4 new lib files (pure functions, testable) + 6 new card components (following existing patterns) = low debt.
- **Path dependency:** Wiring `/portfolios/[id]` unblocks ALL future allocator dashboard features. This is a net debt REDUCTION (fixes the shelfware problem).
- **Knowledge concentration:** All new code follows existing conventions. No new libraries. A new engineer reading this in 6 months sees the same structure they see everywhere.
- **Reversibility:** 5/5 (easily reversible — git revert).
- **The 1-year question:** In 12 months, will we regret any of this? Candidates for regret:
  1. Health score formula — if LPs hate it, we quietly remove the card. 1-PR revert.
  2. Persona switcher — if founder doesn't use it, dead code. 1-PR revert.
  3. Narrative tooltips — if users don't hover, low value. 1-PR revert.

None of these are structural regrets. All reversible.

**Issues found in Section 10:**
- **Issue 10A (auto-decided, P2 boil lakes):** Adding PostHog instrumentation (Issue 8A) creates a small dep (PostHog JS SDK). Verify it's not on the banned-packages list. LOGGED. (User CLAUDE.md bans axios, react-native-international-phone-number, etc. — PostHog is not on the list.)

### Section 11: Design & UX Review (UI scope detected — full pass)

This section overlaps with Phase 2 Design Review. CEO-level scan only.

- **Information architecture:** What does the user see first, second, third? 
  1. Portfolio name + morning briefing (grounding)
  2. Hero Row: health + winners/losers + drawdown story (Moment 1)
  3. Insights Row: biggest risk + regime change + underperformance (Moment 2)
  4. Charts Row: equity curve + correlation (evidence)
  5. Recommendations Row: "what we'd do" + "next $5M" (Moment 3)
  6. Strategy Breakdown Table (detail)
  7. Top Matches (existing /demo content, demoted)
  8. CTA: Send to IC + Sign up

That's ~8 vertical sections, roughly 3 viewports of scrolling on desktop. On mobile at 375px, ~10 viewports. That's A LOT. Consider collapsible sections below the hero row. LOGGED as a Phase 2 design review concern.

- **Interaction states:**

```
FEATURE                | LOADING         | EMPTY          | ERROR         | SUCCESS       | PARTIAL
───────────────────────|─────────────────|────────────────|───────────────|───────────────|──────────
Health score           | Skeleton        | "No data"      | "No data"     | 0-100 + label | "—"
Winners/losers         | Skeleton        | "No data"      | "No data"     | 6 rows        | <6 rows
Drawdown story         | Skeleton        | hidden         | hidden        | narrative     | hidden
Biggest risk           | Skeleton        | hidden         | hidden        | sentence      | hidden
Regime change          | Skeleton        | hidden         | hidden        | comparison    | "stable"
What we'd do           | Skeleton        | hidden         | hidden        | narrative     | hidden
Next $5M               | Skeleton        | hidden         | hidden        | 3 rows        | <3 rows
Equity curve           | chart Skeleton  | "No data" box  | "No data" box | chart         | partial
Correlation heatmap    | Skeleton        | "No data" box  | "No data" box | grid          | subset
Top matches            | existing        | existing       | existing      | existing      | existing
```

Most "empty" and "error" paths show the card hidden. That's a taste call — alternative is to show "no data" placeholders. Subagent's concern: the plan dances between "hide" and "show empty state" inconsistently. Decision (auto, P5 explicit>clever): establish a rule — if a card has zero data, hide it. If a card has partial data, render partial. Document in each lib function.

- **User journey coherence:** The 3-moment narrative is strong. The story flows. ✅
- **AI slop risk:** The plan explicitly names specific cards, not "a KPI dashboard". Low slop risk.
- **DESIGN.md alignment:** DM Sans body, Geist Mono numbers, Instrument Serif display, accent `#1B6B5A`. Colorblind audit on correlation heatmap is already in scope (PART E #5). ✅
- **Responsive intention:** Mobile-first at 375px is in scope (PART B). ✅
- **Accessibility basics:** Not explicitly in plan. Should be: keyboard nav on persona switcher, aria-label on cards, contrast on negative colors. LOGGED as Phase 2 concern.

**Issues found in Section 11:**
- **Issue 11A (auto-decided, P1 + subagent Finding 4):** Health score is a taste landmine — FLAG for final approval gate, NOT auto-decided.
- **Issue 11B (auto-decided, P5):** Collapsible sections below the hero row would reduce mobile scroll — LOGGED as Phase 2 design review concern.
- **Issue 11C (auto-decided, P1):** Accessibility pass not in scope — LOGGED as Phase 2 concern.
- **Issue 11D (auto-decided, P5):** Consistent empty-state rule (hide vs show placeholder) — LOGGED as Phase 2 concern.

Phase 2 will go deeper on all four.

---

## CEO Completion Summary

```
  +====================================================================+
  |            MEGA PLAN REVIEW — COMPLETION SUMMARY (CEO)             |
  +====================================================================+
  | Mode selected        | SELECTIVE EXPANSION (autoplan override)     |
  | System Audit         | 7 orphaned chart components; zero /demo tests |
  | Step 0               | 4 premises flagged; 3 approaches considered |
  | Section 1  (Arch)    | 3 issues found (1A,1B,1C) — all auto-decided |
  | Section 2  (Errors)  | 2 gaps mapped (2A,2B) — both auto-added     |
  | Section 3  (Security)| 1 verify item (3A) — rate limit check        |
  | Section 4  (Data/UX) | 3 edge cases (4A,4B,4C) — all auto-decided  |
  | Section 5  (Quality) | 2 issues (5A DRY, 5B docs) — auto-decided   |
  | Section 6  (Tests)   | Diagram produced; deferred to Eng review    |
  | Section 7  (Perf)    | 1 verify item (7A) — rolling_correlation    |
  | Section 8  (Observ)  | 4 gaps (8A-8D) — all auto-added to scope    |
  | Section 9  (Deploy)  | 1 verify (9A) — staging nightly refresh     |
  | Section 10 (Future)  | Reversibility: 5/5, debt: minimal           |
  | Section 11 (Design)  | 4 issues (11A-11D) — 11A flagged as taste   |
  +--------------------------------------------------------------------+
  | NOT in scope         | 12 items (see plan)                         |
  | What already exists  | written (table of 22 items)                 |
  | Dream state delta    | ~60% to 12-month ideal                      |
  | Error/rescue registry| 12 methods, 0 CRITICAL GAPS (2 FIXED)       |
  | Failure modes        | 0 CRITICAL GAPS                             |
  | TODOS.md updates     | 4 items proposed (see below)                |
  | Scope proposals      | 6 proposed, 6 accepted (selective expansion)|
  | CEO plan             | written (this section)                      |
  | Outside voice        | ran [subagent-only] — Codex rate-limited    |
  | Lake Score           | 18/20 recommendations chose complete option |
  | Diagrams produced    | 3 (arch, data flow, state coverage)         |
  | Stale diagrams found | 0                                           |
  | Unresolved decisions | 2 (taste decisions — final gate)            |
  +====================================================================+
```

## Unresolved Decisions (surfaced at final gate)

1. **TASTE DECISION 1 — Scope calibration:** 16 PRs (full boil-the-lake) vs 6 PRs (subagent proposal). User's stated direction is "everything that makes sense" which leans full, but the subagent argued forcefully that the dashboard thesis is unverified and we should hold 10 PRs in reserve. Both models would need to be consulted on user's actual intent. Since Codex is unavailable, this is the solo subagent's call, not a User Challenge — it goes to the taste-decision pile.

2. **TASTE DECISION 2 — Health score include/drop:** Current plan includes a 0-100 composite health score. Subagent Finding 4 argues LPs hate composite scores and it's a taste landmine. Author's own Open Question #1 already flagged the risk. User's domain knowledge (do sophisticated LPs tolerate composite scores?) is the deciding factor.

## TODOS.md candidates (proposed — final gate decides)

1. **Portfolio analytics caching / ISR refactor** — P3, depends on build-time env var guard. Unlocks /demo at 10x-100x traffic without per-request compute.
2. **Multi-horizon attribution (30/90/365 day)** — P3, requires analytics-service change. Unblocks the full Winners/Losers toggle story.
3. **Seeded PostHog events for /demo** — P1, 1-PR, DONE AS PART OF PR 8A (promoted to scope, no longer a TODO).
4. **Live portfolio what-if slider** — P3, dream-state delta item. "If I added $5M to Aurora, here's what happens" with live optimizer callback.

## Premise gate result

**User confirmed (2026-04-09):** Premises P1-P4 all hold. Proceed with Approach A (full 16-PR boil-the-lake). The two taste decisions (scope calibration 16 vs 6, health score include/drop) stay open but with user's lean toward "full plan + keep health score".

## Phase 1 → Phase 2 transition

> **Phase 1 complete.** Codex: [unavailable — rate-limited]. Claude subagent: 7 strategic findings, 4 premises challenged. Consensus: single-voice mode, 6/6 dimensions raised as concerns → presented at premise gate. User confirmed premises hold. 18 issues auto-decided across sections 1-11. 2 taste decisions reserved for final gate. Passing to Phase 2 (Design Review).

---

# PHASE 2 — DESIGN REVIEW (SELECTIVE EXPANSION design override, autoplan auto-decide)

**Adversarial voices:** `[codex+subagent]` — both ran (Codex retroactively with user API key)
**UI scope:** YES (8 new card components, /demo rewrite, /portfolios/[id] wiring, mobile viewport work)
**Initial overall design score:** 4.5/10 (Claude subagent), classification HYBRID (Codex)

## 0.5 Design Dual Voices — litmus scorecard

```
DESIGN LITMUS SCORECARD  [codex+subagent]
═══════════════════════════════════════════════════════════════════════
  Check                                    Claude   Codex   Consensus
  ─────────────────────────────────────── ───────  ──────  ─────────────
  1. Brand unmistakable in first screen?   NO       NO      CONFIRMED NO
  2. One strong visual anchor present?     NO       YES     DISAGREE
  3. Scannable by headlines only?          NO       NO      CONFIRMED NO
  4. Each section has one job?             NO       NO      CONFIRMED NO
  5. Are cards actually necessary?         NO       NO      CONFIRMED NO
  6. Motion improves hierarchy?            N/A      YES     codex-only YES
  7. Premium without decorative shadows?   YES      YES     CONFIRMED YES
  ─────────────────────────────────────── ───────  ──────  ─────────────
  Hard rejections triggered                3        2       (overlap 1)
═══════════════════════════════════════════════════════════════════════
```

**Hard rejections — both models:**
- **HR-1:** App UI made of stacked cards instead of layout (BOTH) — strongest consensus
- **HR-2 (Claude):** Generic SaaS card grid as first impression (the 3-up Hero Row — already fixed by FIX 1.1)
- **HR-3 (Codex):** Sections repeating same mood statement (Morning Briefing + insight strip + recommendations + winners/losers all narrate "here's what matters" in different wrappers)
- **HR-4 (Claude):** Implicit hard reject from the health score Credit Karma framing

**Key Codex-specific insights:**
1. Hero thesis ≠ product thesis — the editorial line is strong but doesn't tell you WHAT Quantalyze is. Add a one-line product descriptor beneath: "Exchange-verified allocator portfolio review with manager recommendations and IC-ready reporting."
2. Narrative duplication across Morning Briefing + insight strip + recommendations + winners/losers + top matches — cut hardest to 3 blocks: **Verdict / Evidence / Action**.
3. Components-before-composition — `<CardShell>` primitive + full dashboard wiring keep dragging toward stacked panels. Enforce ONE editorial page layout: full-width hero band, one shared evidence panel, one action panel, one secondary appendix.
4. **Health score is a trust leak** — institutional users will question the weighting logic and discount everything around it. KILL completely.
5. **CTA strategy unfocused** — "Send to IC PDF", "Founder view", "Sign up", top matches all compete. One primary CTA only: `Download IC Report`. Move Sign up + Founder view to a quiet footer.

**Codex verdict (verbatim):** *"Strong direction after the editorial inversion, but still too busy and too product-fragmented for a true cap-intro hero. Cut harder. One thesis, one proof block, one action."*

**Hard rejections triggered:**
1. **App UI made of stacked cards** (subagent Finding #5 + Pass 5): 9 cards ≈ dashboard-card-mosaic, violates DESIGN.md's Bloomberg/FactSet reference.
2. **Health score = Credit Karma gauge in disguise** (subagent Finding #4 + Pass 4): violates "typography and data do all the work" principle.
3. **3-column Hero Row is the 3-column feature grid** (subagent Finding #4): the AI slop anti-pattern DESIGN.md's decisions log explicitly calls out.

## CLAUDE SUBAGENT (design completeness — independent)

Subagent delivered a 4.5/10 initial score with findings across all 7 passes. Key verdict: **"The plan is research-strong, taste-weak."** Three changes to move to 8/10:

1. **Kill the health score.** Hero = one editorial drawdown claim in Instrument Serif + Geist Mono numbers.
2. **Invert the IA.** Editorial hero → shared-axis evidence panel → tight action list. Three views, not nine cards.
3. **Resolve 11 ambiguities before PR 5.** Static HTML mockup prevents 11 taste-drift PRs.

The 10/10 vision (subagent, verbatim): *"A forwarded URL lands on a colleague's iPhone SE. They see one serif sentence, one set of mono numbers, one 'download IC report' button, and nothing else until they scroll. They scroll. They see the evidence. They forward it again. The current plan builds a dashboard; the 10/10 product is an editorial page with a dashboard behind it."*

## 7-Pass Review (all passes, full depth)

### Pass 1: Information Architecture — 5/10 → 9/10 (after fixes)

**Gap:** 8 vertical sections = ~10 mobile viewports. Moment 1 (what's working) is NOT above the fold on 375×667. Health Score dominates; the drawdown claim (the single strongest hero asset) is buried third in the Hero Row.

**Auto-decided fixes (applied to plan):**

- **FIX 1.1** (auto, P2 boil lakes + subagent structural): Invert the IA. `/demo` above-the-fold becomes:
  ```
  ┌─────────────────────────────────────────┐
  │ PageHeader (chromeless, 48px)           │  ← 48px
  ├─────────────────────────────────────────┤
  │ HERO: ONE editorial line                │
  │   Instrument Serif 32/40px              │
  │   "Beat BTC on the way up.              │
  │    And on the way down."                │  ← 100px
  │                                         │
  │ HERO NUMBERS (Geist Mono, tabular):     │
  │   [Portfolio] +18%   |  [BTC] +12%      │
  │   [Drawdown] -5%     |  [BTC DD] -22%   │  ← 80px
  │                                         │
  │ Sticky CTA: [Send to IC PDF]            │  ← 48px
  └─────────────────────────────────────────┘
  Total: 276px — fits 375×667 iPhone SE above the fold
  ```
  Morning Briefing moves BELOW the hero (context, not headline).
- **FIX 1.2** (auto, P1 completeness): Re-order below the fold:
  1. Morning Briefing (narrative_summary) — DM Sans 14px, max 2 paragraphs
  2. Evidence panel — equity curve + correlation (shared axis, single card)
  3. Insights strip — Biggest Risk + Regime Change + Underperformance (one row of sentences, not cards)
  4. Recommendations — "What we'd do" + "Next $5M" (tight list, numbered)
  5. Strategy breakdown table
  6. Top matches (demoted — existing /demo content)
  7. Secondary CTA (Founder view + Sign up)
- **FIX 1.3** (auto, P5 explicit>clever): Hero Row (3-up) is REMOVED. Winners/Losers and Health Score decisions resolved as follows:
  - **Winners/Losers** → demoted to a 6-row strip BELOW the charts panel (context, not hero).
  - **Health Score** → TASTE DECISION — surfaced at final gate, see Unresolved below.

### Pass 2: Interaction State Coverage — 6/10 → 9/10

**Gaps from subagent:** loading skeletons not specified; "hide vs show empty" inconsistency causes CLS; stale-per-card badges undefined; analytics fetch error state missing; persona switcher transition state missing.

**Auto-decided fixes:**

- **FIX 2.1** (auto, P1 + CEO GAP 2A): Create `<CardShell>` primitive in `src/components/ui/CardShell.tsx` with 4 states: `loading`, `ready`, `stale`, `unavailable`. Fixed height (card never disappears). Rule: **cards never vanish; only their content does.** Add to DESIGN.md under Component Patterns.

  ```
  CardShell states (DM Sans body, Geist Mono numbers):
  ─ loading:     hairline skeleton matching card height, no shimmer animation
  ─ ready:       actual content
  ─ stale:       8×8 dot (bg: text-muted) + hover tooltip ("Last computed: {time}")
  ─ unavailable: "—" + caption ("Data unavailable") in text-muted
  ```

- **FIX 2.2** (auto, P1): Spec the full state table in the plan:

  ```
  CARD                  | LOADING    | EMPTY                  | ERROR                | SUCCESS      | STALE
  ─────────────────────|────────────|────────────────────────|──────────────────────|──────────────|────────
  Editorial Hero       | skeleton   | hidden if no analytics | retry + stale text   | numbers shown| stale dot
  Morning Briefing     | skeleton   | "No briefing yet"      | retry + stale text   | paragraph    | stale dot
  Winners/Losers       | skeleton   | "Add strategies" CTA   | "Data unavailable"   | 6 rows       | stale dot
  Biggest Risk strip   | skeleton   | hidden                 | hidden               | sentence     | stale dot
  Regime strip         | skeleton   | "Regime stable"        | hidden               | comparison   | stale dot
  Underperf strip      | skeleton   | hidden                 | hidden               | sentence     | stale dot
  What-we'd-do         | skeleton   | "Optimizer computing"  | "Data unavailable"   | narrative    | stale dot
  Next $5M             | skeleton   | hidden                 | hidden               | 3 rows       | stale dot
  Evidence panel       | skeleton   | "No data yet"          | "Charts unavailable" | charts       | stale dot
  Strategy table       | skeleton   | "Add strategies" CTA   | "Data unavailable"   | rows         | stale dot
  Top matches          | skeleton   | existing copy          | existing             | existing     | existing
  ```

- **FIX 2.3** (auto, P1 + CEO Issue 11D): Consistent rule — **insight strip items (Biggest Risk, Regime, Underperformance) hide individually when their rule fires no insight; the STRIP itself stays visible with a fallback "No unusual activity" sentence if all three hide**. Prevents strip vanishing.
- **FIX 2.4** (auto, P1): Persona switcher transition: use `Link` with `prefetch={true}` + a `<Skeleton>` overlay during navigation. Route change ≤500ms.

### Pass 3: User Journey & Emotional Arc — 7/10 → 9/10

**Gaps:** 5-year horizon is absent. "At inception" counterfactual missing.

**Auto-decided fixes:**

- **FIX 3.1** (auto, P1 + subagent fix): Add a one-line counterfactual strip below the editorial hero: **"Had you allocated 12 months ago: +X% vs BTC +Y%."** Derivable from `portfolio_equity_curve` + `benchmark_comparison`. Adds the 5-year horizon without a new chart. In scope.
- **FIX 3.2** (auto, P5): The insight sentences carry the 5-minute arc. Confirmed strong. No changes.

### Pass 4: AI Slop Risk — 4/10 → [TASTE DECISION PENDING] → 9/10 if fix applied

**Critical flags:**

- **Flag 4.1** (TASTE DECISION — final gate): Health Score 0-100 composite. Both Phase 1 and Phase 2 subagents independently flag this as taste landmine. NOT auto-decided. Presented at final gate.
- **Flag 4.2** (auto, P5 explicit>clever): The 3-up Hero Row is the 3-column feature grid anti-pattern. Already fixed by FIX 1.1 (inversion).
- **Flag 4.3** (auto, P5): No icons in card headers. Typography only. Add to DESIGN.md: "Card headers: text only. No icons. No colored decoration."
- **Flag 4.4** (auto, P5): No left-border-accent on any new card (TODOS.md already flagged this anti-pattern in the `ScopedBanner` consolidation). Existing `<ScopedBanner>` uses left-border-accent intentionally for filter banners — keep THAT usage, forbid the pattern elsewhere.

### Pass 5: Design System Alignment — 5/10 → 9/10

**Gaps from subagent:** "9-card dashboard mosaic" is dissonant with Bloomberg/FactSet reference. Instrument Serif not used in hero. `narrative_summary` as header-adjacent is wall-of-text risk.

**Auto-decided fixes:**

- **FIX 5.1** (auto, P1 + structural): Rewrite the `/demo` composition from "9 cards" to **"3 views divided by hairline dividers."**
  - View 1 = Editorial Hero (serif line + mono numbers + sticky CTA)
  - View 2 = Evidence (equity curve + correlation in one shared-axis panel)
  - View 3 = Action (recommendations as numbered list — NOT cards)
  Hairline dividers = `border-t border-border` (1px `#E2E8F0`). No card borders between views.
- **FIX 5.2** (auto, P1 + structural): Add to DESIGN.md (repo file — in scope as an edit, not a new file):
  ```
  ## Data density principle
  Data density > card density. Prefer tables and shared-axis panels over stacks of
  rounded cards. Reference: Bloomberg Terminal, FactSet.
  Rule: if 3+ cards share a row, ask whether it should be one panel with 3 columns
  instead. Cards are for interactive containers (Click, Hover) — not for visual
  grouping of metrics.
  ```
- **FIX 5.3** (auto, P5): Typography assignment:
  - Editorial hero line: Instrument Serif 32/40px (desktop) / 24/32px (mobile)
  - Numbers in hero: Geist Mono tabular-nums 24-40px
  - Morning Briefing body: DM Sans 14px, max 2 paragraphs (truncate at 180 chars, expand-on-click)
  - Insight sentences: DM Sans 14px medium weight (NOT serif — readable, not editorial)
  - Labels/captions: DM Sans 10-11px uppercase tracking-wider
  - Card headers: DM Sans 16px semibold
- **FIX 5.4** (auto, P1): Card borders: keep DESIGN.md default (1px `#E2E8F0`, 8px radius). But use hairline dividers BETWEEN views on /demo (not card borders around everything).

### Pass 6: Responsive & Accessibility — 3/10 → 9/10

**Critical gaps from subagent:** 320px not specified, correlation heatmap unreadable at 320px, no keyboard nav, no ARIA landmarks, no focus-visible, touch targets unspecced, no screen reader story, no contrast audit for `#DC2626`.

**Auto-decided fixes (all critical per subagent):**

- **FIX 6.1** (auto, P1 + critical): Add 320×568 (iPhone SE) as a first-class breakpoint. Hero editorial line reflows to 18/24px. Evidence panel collapses to summary stats only (no charts below 360px; "Show charts" disclosure instead).
- **FIX 6.2** (auto, P1 + critical): Correlation heatmap responsive strategy:
  - ≥1024px: full 10×10 grid
  - 640-1023px: top-5 most-correlated pairs grid
  - <640px: sorted list of "Your 3 most-correlated pairs" (text, no grid)
  - <360px: hidden (in "Show charts" disclosure)
- **FIX 6.3** (auto, P1 + critical): Keyboard navigation spec — added to plan:
  - `tab` order: Hero CTA → Morning Briefing expand → Evidence panel tabs → Insight strip → Recommendations → Strategy rows → Top matches → Footer CTAs
  - Focus-visible ring: 2px `#1B6B5A` outline offset 2px (accent color)
  - Escape closes any expanded tooltip
  - `Arrow` keys navigate within Strategy breakdown table
- **FIX 6.4** (auto, P1 + critical): ARIA landmarks —
  - `<section aria-labelledby="hero-title">` for the editorial hero (title has id=hero-title)
  - `<section aria-label="Evidence panel">` for the charts
  - `<section aria-label="Portfolio insights">` for the insight strip
  - `<section aria-label="Recommendations">` for action items
  - `role="list"` on the 6-row Winners/Losers strip
  - `aria-live="polite"` on stale badges so screen readers announce refresh
- **FIX 6.5** (auto, P1 + critical): Touch targets 44×44px minimum on: persona switcher buttons, PDF CTA, Morning Briefing expand, tooltip triggers. Visual size may be smaller; hit area pads to 44px.
- **FIX 6.6** (auto, P1 + critical): Contrast audit — `#DC2626` on `#FFFFFF` = 4.54:1 (passes AA for text). For loss-indicator bars (if any), add 3:1 UI contrast via added outline.
- **FIX 6.7** (auto, P1 + critical): Add VoiceOver smoke test to the verification plan: "navigate /demo with screen reader, confirm the editorial hero reads first, then numbers, then briefing, then evidence."
- **FIX 6.8** (auto, P1): Correlation heatmap colorblind audit (already in scope PART E). Verify deuteranopia simulation on the teal/grey/burnt-orange diverging palette. Ship a screenshot artifact.

### Pass 7: Unresolved Design Decisions — 2/10 → 9/10

**Subagent flagged 11 ambiguities. Auto-decisions:**

| # | Ambiguity | Auto-decision | Principle |
|---|-----------|---------------|-----------|
| 1 | NarrativeTooltip mechanics | Hover on desktop (300ms delay), tap-to-dismiss on mobile. Position: above trigger with 8px offset. Content: definition + why-it-matters (no formula). Dismiss: click outside or Escape. | P5 explicit |
| 2 | Persona switcher render | **Segmented control** with 3 buttons ("Cold", "Active", "Stalled"), top-right of PageHeader, 44px height, visible on /demo. Query param `?persona=cold\|active\|stalled` (default active). | P5 explicit |
| 3 | "Send to IC" PDF button location | **Sticky top-right of PageHeader** AND repeated at bottom as a full-width CTA on mobile. Desktop: top-right only. 8s loading state with spinner + "Generating PDF..." label. | P1 completeness |
| 4 | Morning Briefing length limit | 2 paragraphs max. 180-char truncate + "Read more" expand. | P5 explicit |
| 5 | Health Score visual | TASTE DECISION (final gate). If kept: small 24px number + DM Sans 14px label ("Healthy" / "Concentration risk" / "Drawdown recovery"). NO ring, NO gauge, NO Credit Karma. | TASTE |
| 6 | Winners/losers row format | `{strategy name}    +X.X% contribution` (no color bars, just sign + mono number). 6 rows. Winners top, losers bottom, divider between. | P5 explicit |
| 7 | Insight sentence typography | DM Sans 14px medium (readable, not editorial) | P5 subagent rec |
| 8 | Card border vs hairline | DESIGN.md default for cards (1px `#E2E8F0` + 8px radius) EXCEPT on /demo top-level views which use hairline dividers only | P1 + FIX 5.1 |
| 9 | Empty-state copy | "Add strategies to see {your winners/your risks/your drawdown story}" with CTA to discovery. Stale: "Last computed {time} ago." Unavailable: "Data unavailable — refresh in a moment." | P5 explicit |
| 10 | Stale badge visual | 8×8 rounded dot in text-muted (`#718096`), placed right of card header. Hover shows "Last computed: {ISO time}" tooltip. | P5 explicit |
| 11 | "Next $5M" render | Currency-first, right-aligned Geist Mono. Format: `$2.0M → Aurora Basis Trade` (3 rows). Single view, no cards. | P5 explicit |

All 10 of 11 ambiguities auto-decided. Only #5 (health score) reserved for final gate.

---

### Codex-derived additional fixes (cut harder)

After both voices ran, Codex added pressure to cut more aggressively. Auto-decisions:

- **FIX 1.4** (auto, P1 Codex + cross-phase): Add a one-line product descriptor under the editorial hero in DM Sans 14px text-secondary:
  > *"Exchange-verified allocator portfolio review with manager recommendations and IC-ready reporting."*
  This closes the "brand unmistakable" litmus gap without disrupting the editorial framing.

- **FIX 1.5** (auto, P2 boil lakes + P5 explicit>clever): Enforce the 3-block editorial layout on /demo:
  ```
  ┌─────────────────────────────────────────┐
  │ VERDICT BLOCK                           │
  │   Editorial hero line (Instrument Serif)│
  │   Product descriptor (DM Sans sec)      │
  │   Hero numbers (Geist Mono)             │
  │   Counterfactual strip ("Had you...")   │
  │   [Download IC Report] (primary CTA)    │
  ├─ hairline divider ────────────────────── │
  │ EVIDENCE BLOCK                          │
  │   Morning Briefing (2-line dek)         │
  │   Equity curve + correlation (shared)   │
  │   Winners/Losers (6-row strip)          │
  │   Insight strip (Biggest Risk + Regime  │
  │                  + Underperformance)    │
  ├─ hairline divider ────────────────────── │
  │ ACTION BLOCK                            │
  │   "What we'd do in your shoes" narrative│
  │   "Where next $5M goes" (3-row list)    │
  │   Strategy breakdown table              │
  ├─ hairline divider ────────────────────── │
  │ APPENDIX                                │
  │   Top matches (demoted from hero)       │
  │   Founder view link (footer)            │
  │   Sign up link (footer)                 │
  └─────────────────────────────────────────┘
  ```
  Three main blocks + appendix, each with one job. Top matches stays but is in the appendix below the fold — directly supports the "next $5M" story, so Codex Finding 5 applies with demotion not removal.

- **FIX 4.5** (auto, P5 + Codex Finding 5): CTA hierarchy simplified:
  - **Primary (desktop top-right + mobile bottom full-width):** `Download IC Report` — generates the portfolio PDF
  - **Secondary (footer only, small type):** `Founder view →` link
  - **Secondary (footer only, small type):** `Sign up` link
  - No tertiary CTAs. No "Sign up" repeated mid-page. No "Founder view" in the hero.

- **FIX 5.5** (auto, P5 + Codex Finding 3): `<CardShell>` primitive usage constrained. Use `<CardShell>` on the **authenticated** `/portfolios/[id]` dashboard where interactive cards make sense (Part C). Do NOT use `<CardShell>` on `/demo` — that page uses the 3-block editorial layout with hairline dividers and NO card borders on the block separators. This prevents /demo from drifting back into the stacked-cards antipattern.

- **FIX 5.6** (auto, P1 + DESIGN.md): Add to `DESIGN.md` the "Meeting hero" rule:
  > *"Meeting-hero pages (/demo, public forwarded URLs, one-screen thesis pages) use the 3-block editorial layout: Verdict / Evidence / Action, separated by hairline dividers. No card borders between blocks. This is the exception to the default Card primitive pattern. Reference: FactSet quarterly factsheet pages."*

- **FIX 9.1** (auto, P1 + Codex Finding 9): Test plan reallocation — Codex correctly flags that the real meeting risk is "a public hero that looks busy, fake, or broken", not PDF cold starts. Added to Phase 3 test plan: a Playwright **screenshot regression** test on `/demo` that diffs against a baseline snapshot. If the page shifts unexpectedly (e.g., because the analytics service returned null and a card hid when it shouldn't have), CI catches it before the friend sees it. The PDF cold-start test stays (it's a real risk) but is demoted from blocking gate to nightly cron.

With these Codex-derived fixes, **the updated overall design score is 9.5/10 after fixes** (up from 9/10 after Claude-only fixes). The remaining 0.5 is the Health Score TASTE DECISION that goes to the final gate.

## Design Completion Summary

```
  +====================================================================+
  |         DESIGN PLAN REVIEW — COMPLETION SUMMARY                    |
  +====================================================================+
  | System Audit         | DESIGN.md exists; UI scope = 8+ new cards  |
  | Step 0               | Initial 4.5/10; focus = IA + slop + a11y   |
  | Pass 1  (Info Arch)  | 5/10 → 9/10 (hero inversion applied)        |
  | Pass 2  (States)     | 6/10 → 9/10 (CardShell primitive added)    |
  | Pass 3  (Journey)    | 7/10 → 9/10 (counterfactual strip added)    |
  | Pass 4  (AI Slop)    | 4/10 → [taste pending] (health score flag)  |
  | Pass 5  (Design Sys) | 5/10 → 9/10 (3 views, not 9 cards)         |
  | Pass 6  (Responsive) | 3/10 → 9/10 (320px + a11y full spec)        |
  | Pass 7  (Decisions)  | 10 resolved, 1 deferred to final gate       |
  +--------------------------------------------------------------------+
  | NOT in scope         | unchanged (Phase 1 list still applies)      |
  | What already exists  | unchanged (CardShell is new primitive)      |
  | TODOS.md updates     | +1 (VoiceOver e2e)                          |
  | Approved Mockups     | 0 generated (skipped — gstack designer not  |
  |                      |   available; wire protocol not in scope)    |
  | Decisions made       | 31 design decisions added to plan           |
  | Decisions deferred   | 1 (health score — final gate)               |
  | Overall design score | 4.5/10 → 9/10 (after fixes, pending taste)  |
  +====================================================================+
```

## Phase 2 → Phase 3 transition

> **Phase 2 complete.** Codex: 5 findings (HYBRID classification, 2 hard rejections, 1 litmus DISAGREE). Claude subagent: 7-pass rating 4.5/10 → 9/10. After Codex-derived additional fixes: **9.5/10**. Consensus: dual-voice mode, 6/7 litmus checks CONFIRMED, both models independently concluded "cut harder". 38 design decisions auto-applied to plan. 1 taste decision (health score) ESCALATED to USER CHALLENGE B at the final gate. Passing to Phase 3 (Eng Review).

---

# PHASE 3 — ENG REVIEW (SELECTIVE EXPANSION, autoplan auto-decide)

**Adversarial voices:** `[codex+subagent]` — both ran successfully
**Scope:** 16 PRs (plus PR 0 for pre-work, see C1)

## 0.5 Eng Dual Voices — consensus table

```
ENG DUAL VOICES — CONSENSUS TABLE  [codex+subagent]
═══════════════════════════════════════════════════════════════════════
  Dimension                            Claude   Codex   Consensus
  ──────────────────────────────────── ───────  ──────  ─────────────
  1. Architecture sound?               YES*     YES*    CONFIRMED (with fixes)
  2. Test coverage sufficient?         NO       NO      CONFIRMED FAIL
  3. Performance risks addressed?      NO       N/A     Claude-only
  4. Security threats covered?         NO       NO      CONFIRMED FAIL
  5. Error paths handled?              NO       NO      CONFIRMED FAIL
  6. Deployment risk manageable?       YES      YES     CONFIRMED YES
═══════════════════════════════════════════════════════════════════════
3/6 dimensions: CONFIRMED FAIL — auto-fixes required pre-implementation.
2/6 dimensions: CONFIRMED PASS with caveats.
1/6 dimension: single-voice Claude flag on bundle bloat (auto-added).

*Both models agree architecture is sound AFTER the 3 critical fixes are applied.
```

## CLAUDE SUBAGENT (eng — independent review)

**3 CRITICAL, 6 HIGH, 6 MEDIUM findings:**

**C1 (Critical) — `rolling_correlation` shape mismatch.** `src/lib/types.ts:204` declares `{date, value}[]` but `analytics-service/services/portfolio_risk.py:23-40` returns `dict[pair_key, list[{date,value}]]` and `portfolio.py:276` persists that. The TS type is wrong and has been wrong since Sprint 6. PR 4 (`regime-change.ts`) would be written against the wrong type, ship, and silently render null. *Fix:* Add PR 0 — correct the type, aggregate across pairs for regime delta, document in Hour 1 interrogation.

**C2 (Critical) — ResizeObserver missing in jsdom.** `src/test-setup.ts` is one line. `PortfolioEquityCurve.tsx:81` uses `new ResizeObserver(...)`. Vitest tests for chart components will throw. *Fix:* Add `global.ResizeObserver = class {...}` to `src/test-setup.ts` as part of PR 0.

**C3 (Critical) — Two-batch fallback chain silently dropped.** `src/app/demo/page.tsx:148-166` has `batch[0] → batch[1]` fallback for empty match candidates. The plan rewrite doesn't preserve it explicitly. *Fix:* Move `fetchCandidatesForBatch` (lines 76-118) to `src/lib/demo-recommendations.ts` with a Vitest unit test for both paths. Lock as PR 9 constraint.

**H1 (High) — Test plan artifact path missing.** Recommendation: `docs/superpowers/plans/2026-04-09-portfolio-demo-hero-test-plan.md`. Must include seed UUID dependencies, seed drift handling, screenshot baseline location.

**H2 (High) — Existing tests need updates.** `e2e/smoke.spec.ts` needs `/demo` added; `e2e/full-flow.spec.ts` + `e2e/discovery.spec.ts` may hit lightweight-charts timeouts; `src/__tests__/analytics-format.test.ts` may break when `PortfolioAnalytics.rolling_correlation` type is fixed.

**H3 (High) — Migrations required: NONE.** Type fix is TS-only; JSONB column already exists. State explicitly: "No DB migrations."

**H4 (High) — Analytics warmup — what if it ALWAYS fails?** Need `try { void fetch(...).catch(()=>{}) } catch {}` wrapper in `src/lib/warmup-analytics.ts` with a test that confirms it never throws synchronously. Unhandled rejection in a Server Component aborts render in Next 16.

**H5 (High) — Persona input validation must be a lookup table.** `src/lib/personas.ts` with `const PERSONAS = { active, cold, stalled } as const`. Use `PERSONAS[param] ?? PERSONAS.active`. Vitest tests for `?persona=__proto__` and `?persona=<script>`.

**H6 (High) — 5th parallel fetch is sequential.** `getPortfolioAnalytics(portfolio.id)` needs `portfolio.id` from phase 1. New /demo has 2 sequential phases of parallel fetches: phase 1 = (profile, batches, portfolio); phase 2 = (holdings, analytics).

**M1 (Medium) — CardShell needs strict prop type + 4-state unit tests.**
**M2 (Medium) — 7 components into one page = bundle bloat.** Lazy-load below-fold charts via `next/dynamic` (same as existing PortfolioOptimizer on line 28 of `/portfolios/[id]/page.tsx`).
**M3 (Medium) — Partial JSONB data tests.** Every lib function must handle `{benchmark_comparison: null, rolling_correlation: {}, attribution_breakdown: [...]}`.
**M4 (Medium) — Add `tests/seed-integrity.test.ts`** that verifies seed produces 3 allocators, 8 strategies, 1 portfolio, ≥3 holdings.
**M5 (Medium) — Admin client boundary comment.** Top of new `src/app/demo/page.tsx`: "All Supabase reads on this page MUST be parameterized by a value in `PERSONAS`."
**M6 (Medium) — Extract `<MorningBriefing>` to shared component** to prevent duplication between /demo and /portfolios/[id].

## CODEX SAYS (eng — architecture challenge)

**2 CRITICAL, 4 HIGH, 2 MEDIUM findings:**

**C-Codex-1 (Critical) — The IC Report PDF CTA is impossible as specced.** Plan makes `Download IC Report` the primary public /demo CTA (Phase 2 FIX 4.5), but `/api/portfolio-pdf/[id]/route.ts:38` requires `supabase.auth.getUser()` AND line 42 calls `assertPortfolioOwnership`. A forwarded-URL viewer with no account will get 401. **VERIFIED** — I re-read the route file; both checks are present.
*Fix:* Create a SEPARATE demo-only PDF endpoint at `/api/demo/portfolio-pdf` that:
- Is allow-listed to the 3 seeded portfolio IDs only (`ACTIVE_PORTFOLIO_ID`, and new COLD/STALLED portfolio IDs)
- Uses a signed token via HMAC-SHA256 with a server-side secret to prevent arbitrary ID substitution
- Shares `launchBrowser` / `acquirePdfSlot` infrastructure with the existing route
- Rate-limited via existing `publicIpLimiter`
- Does NOT relax ownership checks on the existing authenticated route
This is the CRITICAL missing piece. Without this fix, the primary CTA 401s on the friend's forwarded URL.

**C-Codex-2 (Critical) — JSONB contract assumptions wrong in MULTIPLE places.** Not just `rolling_correlation` (which Claude C1 caught) — also `benchmark_comparison` and `risk_decomposition`. `types.ts:201` says `Record<string, {alpha, beta, info_ratio, tracking_error}>` but `portfolio.py:211-227` writes `{symbol, correlation, benchmark_twr, portfolio_twr, stale}`. Completely different fields. *Fix:* Broaden PR 0 into a typed adapter layer — `src/lib/portfolio-analytics-adapter.ts` that normalizes the raw JSONB into a strict internal type, with contract tests against fixture JSONB blobs captured from staging.

**H-Codex-3 (High) — "Stale fallback from last-good data" is not implemented.** `src/lib/queries.ts:373` (`getPortfolioAnalytics`) fetches only the latest row. `src/app/(dashboard)/portfolios/[id]/page.tsx:236` uses that single row. If the latest analytics row has `computation_status='failed'`, there's NO last-good row fetched. The plan assumed fallback; it doesn't exist. *Fix:* Extend the query to fetch `latest + latest-where-status=complete`, and the page chooses between them with a stale badge. This is a distinct PR (call it PR 10.5 or bundle into PR 10).

**H-Codex-4 (High) — Persona switcher introduces user input, but the plan's security section claimed "no user input."** VERIFIED — I re-read Phase 1 Section 3, it says "No user input → no new attack surface." That's now wrong. *Fix:* Claude H5 covers this with the lookup table. Add to Phase 1 Section 3: "CORRECTION: the persona query param is user input. Handled by server-side enum lookup in `src/lib/personas.ts`. No raw SQL or admin client key access from the param."

**H-Codex-5 (High) — Seed script does NOT create `portfolio_analytics` rows.** VERIFIED — `scripts/seed-demo-data.ts:521-549` creates portfolios and strategy memberships but never touches `portfolio_analytics`. The demo hero DEPENDS on `portfolio_analytics.attribution_breakdown`, `correlation_matrix`, etc. In the current world, a cold seed requires manually hitting `POST /api/admin/match/recompute` to get analytics — which the seed script's own `console.log` says. *Fix:* Add a post-seed step that either (a) generates deterministic `portfolio_analytics` JSONB fixtures directly (same mulberry32 PRNG), or (b) POSTs to `/api/portfolio-analytics/recompute` for each seeded portfolio. Recommend (a) — deterministic, no analytics service dependency. This is a new sub-PR (PR 11.5 or bundle into PR 11 personas).

**H-Codex-6 (High) — CI only runs `auth.spec.ts` + `smoke.spec.ts`.** VERIFIED — `.github/workflows/ci.yml:83` hardcodes `npx playwright test e2e/auth.spec.ts e2e/smoke.spec.ts`. The plan's new `e2e/demo-public.spec.ts` will be orphaned in CI unless added explicitly. *Fix:* Update the CI grep pattern to `e2e/auth.spec.ts e2e/smoke.spec.ts e2e/demo-public.spec.ts e2e/demo-founder-view.spec.ts`. Document that "demo-critical" specs must NOT depend on authenticated state (so CI can run without seed access).

**M-Codex-7 (Medium) — CardShell "cards never vanish" vs "hide empty cards" contradiction.** Phase 2 FIX 2.1 says "cards never disappear; only their content does" but Phase 2 FIX 2.3 says "insight strip items hide individually". *Fix:* Formalize one policy per surface. Editorial `/demo` uses stable block-level placeholders (no cards disappear, but block-level hiding is OK). Authenticated dashboard uses `CardShell` with persistent shells. Write it as a single rule in DESIGN.md.

**M-Codex-8 (Medium) — Warmup is operationally weak.** Fire-and-forget warmup on page load is cheap but unobservable. *Fix:* Move warmup to a **scheduled Vercel Cron** that pings the analytics service /health every 5 min. Add a dashboard metric. The page-load warmup stays as a backup (cheap insurance). Observe the SLO.

## Cross-model eng consensus

| Concern | Claude | Codex | Consensus |
|---------|--------|-------|-----------|
| rolling_correlation type wrong | C1 | part of C-Codex-2 | **CONFIRMED + BROADER** |
| JSONB contract wrong in 2+ places | partial (C1) | **C-Codex-2 (broader)** | Codex wider scope |
| IC PDF CTA auth-gated → 401 | — | **C-Codex-1 (CRITICAL)** | **Codex-only CRITICAL** |
| ResizeObserver jsdom gap | C2 | — | Claude-only |
| Two-batch fallback chain drop | C3 | — | Claude-only |
| Stale fallback not actually implemented | — | H-Codex-3 | Codex-only HIGH |
| Persona input validation | H5 | H-Codex-4 | **CONFIRMED** |
| Seed missing `portfolio_analytics` | — | **H-Codex-5** | **Codex-only CRITICAL-ish** |
| CI runs only auth+smoke | — | H-Codex-6 | Codex-only HIGH |
| 5th fetch sequential | H6 | — | Claude-only |
| Warmup operationally weak | H4 | M-Codex-8 | **CONFIRMED** |
| CardShell contradiction | M1 | M-Codex-7 | **CONFIRMED** |
| 7 components bundle bloat | M2 | — | Claude-only |
| Partial JSONB tests | M3 | — | Claude-only (reinforced by C-Codex-2) |
| Seed integrity test | M4 | — | Claude-only (Codex H-Codex-5 strengthens) |
| MorningBriefing component dup | M6 | — | Claude-only |

**Aggregate severity rollup:**
- **CRITICAL (must-fix):** 5 findings — C1, C2, C3, C-Codex-1, C-Codex-2
- **HIGH:** 10 findings — H1-H6 + H-Codex-3 through H-Codex-6
- **MEDIUM:** 8 findings — M1-M6 + M-Codex-7, M-Codex-8
- **Total eng findings:** 23

## ARCHITECTURE — Section 1

### Full dependency graph (with new components)

```
                          ┌─────────────────────────────────────────┐
                          │         /demo/page.tsx (rewrite)        │
                          │         SERVER COMPONENT                │
                          └────┬──────────┬──────────┬───────────┬─┘
                               │          │          │           │
                    ┌──────────▼──┐  ┌────▼─────┐  ┌▼──────┐  ┌─▼────────┐
                    │ personas.ts │  │ adapter  │  │ demo- │  │ warmup-  │
                    │ (NEW)       │  │ (NEW)    │  │ recomm │ │ analytics│
                    │ lookup table│  │ JSONB→TS │  │ (NEW)  │ │ (NEW)    │
                    └──────────┬──┘  └────┬─────┘  └────┬──┘ └──────┬───┘
                               │          │              │           │
                               │          │              │           │
                 ┌─────────────▼──────────▼──────────────▼───────────▼────┐
                 │  Pure derivation lib files (NEW, all tested)           │
                 │  portfolio-health.ts    winners-losers.ts              │
                 │  portfolio-insights.ts  regime-change.ts               │
                 └─────────────┬──────────────────────────────────────────┘
                               │
                 ┌─────────────▼──────────────────────────────────────────┐
                 │  React card components (NEW — presentational, RSC)     │
                 │  EditorialHero  MorningBriefing (shared)               │
                 │  WinnersLosersStrip  InsightStrip                      │
                 │  WhatWedDoCard  NextFiveMillionCard                    │
                 │  CounterfactualStrip                                   │
                 └─────────────┬──────────────────────────────────────────┘
                               │
                 ┌─────────────▼──────────────────────────────────────────┐
                 │  Evidence Panel (NEW, wraps existing orphaned charts)  │
                 │  PortfolioEquityCurve  CorrelationHeatmap              │
                 │  (client components via next/dynamic, shared ruler)    │
                 └────────────────────────────────────────────────────────┘

  PARALLEL RESOURCE:
  ┌────────────────────────────────────────────────────────────────────┐
  │  /api/demo/portfolio-pdf/[id]  (NEW — signed token, allowlist)     │
  │  ← Download IC Report CTA target                                   │
  └────────────┬───────────────────────────────────────────────────────┘
               │
   shares with ▼
  ┌────────────────────────────────────────────────────────────────────┐
  │  /api/portfolio-pdf/[id]  (EXISTING — auth-gated, UNCHANGED)       │
  │  ← Authenticated dashboard PDF target                              │
  └────────────────────────────────────────────────────────────────────┘

  SEED:
  ┌────────────────────────────────────────────────────────────────────┐
  │  scripts/seed-demo-data.ts (EXTENDED)                              │
  │  + deterministic portfolio_analytics rows for active/cold/stalled  │
  │  + helper: generatePortfolioAnalytics(seed) → JSONB                │
  └────────────────────────────────────────────────────────────────────┘

  CI:
  ┌────────────────────────────────────────────────────────────────────┐
  │  .github/workflows/ci.yml (EXTENDED)                               │
  │  + e2e/demo-public.spec.ts in the test list                        │
  │  + e2e/demo-founder-view.spec.ts in the test list                  │
  └────────────────────────────────────────────────────────────────────┘
```

### Scaling characteristics

At 10x traffic (100 concurrent /demo requests):
- Supabase admin client: 5 queries × 100 = 500 concurrent. Supabase can handle this.
- Puppeteer: the existing `acquirePdfSlot` semaphore limits concurrent PDF generation. At 100 concurrent IC Report clicks, 99 will queue. The rate-limited response (existing 429 path) handles this.
- Lightweight-charts: client-side, no server load.

At 100x (1000 req/min): Supabase admin becomes a bottleneck. The existing ISR refactor (already noted in plan) is the fix for this scale. Acceptable to defer.

## ERROR & RESCUE MAP (Section 2) — Eng depth

```
METHOD/CODEPATH                        | WHAT CAN GO WRONG                | EXCEPTION CLASS / RESULT
───────────────────────────────────────|──────────────────────────────────|──────────────────────────
portfolio-health.ts::computeScore      | all null inputs                  | returns null
                                       | NaN in Sharpe                    | guarded, returns null
                                       | division by zero                 | guarded, returns null
winners-losers.ts::compute             | attribution null                 | returns []
                                       | ties at rank 3                   | stable sort (deterministic)
portfolio-insights.ts::compute         | benchmark_comparison null        | hides drawdown insight
                                       | risk_decomposition empty         | hides concentration insight
regime-change.ts::compute              | rolling_correlation pair-keyed   | aggregates mean of pair deltas
                                       | <60 days of data                 | returns null
                                       | wrong JSONB shape                | returns null (defensive)
portfolio-analytics-adapter.ts         | unknown JSONB shape               | throws AdapterError (logged)
                                       | partial data                     | populates what's present
/demo server fetch                     | Supabase timeout                 | try/catch → stale fallback card
                                       | analytics null                   | hero stays, "computing" badge
                                       | all JSONB fields null            | hero stays, placeholder metrics
/api/demo/portfolio-pdf                | Puppeteer cold start > 15s       | 504 + Retry-After header
                                       | Chromium launch fails            | 500 + logged
                                       | ID not in allowlist              | 404 (no leak of valid IDs)
                                       | Signed token mismatch            | 401
                                       | Rate limit exceeded              | 429 (existing limiter)
warmup-analytics                       | fetch throws synchronously       | try/catch, never rejects
                                       | analytics /health 500            | logged info, no user impact
                                       | ANALYTICS_URL env unset          | logged warn, no user impact
CI demo-public spec                    | seed data drift                  | Vitest seed-integrity catches it first
                                       | screenshot regression            | Playwright screenshot diff
```

**GAPS REMAINING:** None after PR 0 + the auto-decisions above. Every new codepath has a rescue action. Original plan had 2 gaps; the eng review upgraded coverage.

## TEST DIAGRAM (Section 3 — mandatory)

```
NEW UX FLOWS:
  1. Land on /demo → see editorial hero → scroll to evidence → click Download IC Report
  2. Switch persona via query param → see different portfolio story
  3. Hit /demo/founder-view → see match queue read-only
  4. Hit /portfolios/[id] (authenticated) → see fully-wired dashboard
  5. Mobile viewport 320/375px → responsive reflow

NEW DATA FLOWS:
  A. portfolio_analytics JSONB → portfolio-analytics-adapter → typed PortfolioAnalytics
  B. Typed PortfolioAnalytics → 4 lib functions → card props
  C. Persona query param → lookup table → hardcoded UUID → admin fetch
  D. Signed token → verify → allow-listed portfolio ID → Puppeteer
  E. Page load → fire warmup → analytics /health (async, silent)

NEW CODEPATHS:
  - Health score formula (3 branches: healthy/concentration/drawdown)
  - Winners/losers sort (edge: ties, negatives, empty)
  - Biggest Risk rule engine (4 rules, 1 fires at a time)
  - Regime change delta (mean across pair series)
  - Underperformance detection (vol-band comparison)
  - Persona lookup (default + 3 valid values)
  - PDF endpoint signed token verification
  - Seed → portfolio_analytics generation

NEW BACKGROUND WORK:
  - Vercel Cron (every 5 min) → ping analytics /health (new cron.json entry)
  - Nightly PDF cold-start test (moved from blocking to cron)

NEW INTEGRATIONS / EXTERNAL CALLS:
  - New analytics adapter → Supabase portfolio_analytics JSONB read
  - New /api/demo/portfolio-pdf → Puppeteer → /portfolio-pdf/[id] print route
  - New warmup → analytics-service /health
  - New CI → seeded demo DB

NEW ERROR/RESCUE PATHS:
  - Adapter error (partial JSONB) → fallback to per-field nulls
  - PDF signed token mismatch → 401
  - Warmup sync throw → swallowed by try/catch
  - Seed drift → integrity test fails first
  - Stale fallback → last-good row selected
```

### Test coverage table

```
COMPONENT / CODEPATH               | UNIT | INTEG | E2E  | FAILURE         | CHAOS       | CI GATE
───────────────────────────────────|──────|───────|──────|─────────────────|─────────────|─────────
portfolio-health.ts                | ✓    | —     | —    | ✓ null, zero    | —           | ✓
winners-losers.ts                  | ✓    | —     | —    | ✓ empty, ties   | —           | ✓
portfolio-insights.ts              | ✓    | —     | —    | ✓ partial JSONB | —           | ✓
regime-change.ts                   | ✓    | —     | —    | ✓ wrong shape   | —           | ✓
portfolio-analytics-adapter.ts     | ✓    | ✓     | —    | ✓ malformed     | ✓ fuzz      | ✓
personas.ts                        | ✓    | —     | —    | ✓ __proto__     | —           | ✓
warmup-analytics.ts                | ✓    | —     | —    | ✓ sync throw    | —           | ✓
demo-recommendations.ts (extract)  | ✓    | —     | —    | ✓ both batches  | —           | ✓
EditorialHero component            | ✓    | —     | ✓    | ✓ null metrics  | —           | ✓
MorningBriefing (shared)           | ✓    | —     | ✓    | ✓ empty, long   | —           | ✓
WinnersLosersStrip                 | ✓    | —     | ✓    | ✓ empty         | —           | ✓
InsightStrip                       | ✓    | —     | ✓    | ✓ all hide      | —           | ✓
WhatWedDoCard                      | ✓    | —     | ✓    | ✓ empty         | —           | ✓
NextFiveMillionCard                | ✓    | —     | ✓    | ✓ empty         | —           | ✓
CardShell (authenticated)          | ✓    | —     | —    | ✓ all 4 states  | —           | ✓
/demo page                         | —    | —     | ✓    | ✓ stale, empty  | ✓ seed drift| ✓
/demo/founder-view                 | —    | —     | ✓    | ✓ read-only     | —           | ✓
/portfolios/[id] page (wired)      | —    | —     | ✓    | ✓ stale fallback| —           | ? (auth)
/api/demo/portfolio-pdf            | ✓    | ✓     | ✓    | ✓ 401 token     | ✓ cold start| ✓
seed-integrity.test.ts             | ✓    | ✓     | —    | ✓ drift         | —           | ✓
screenshot regression (e2e)        | —    | —     | ✓    | ✓ layout shift  | ✓           | ✓
CI: demo-public + demo-founder-view| —    | —     | ✓    | —               | —           | ✓
Nightly PDF cold-start cron        | —    | —     | ✓    | ✓ warm/cold     | —           | cron
```

**CI GATE** = runs on every PR to main.
The `? (auth)` on `/portfolios/[id]` reflects the long-standing CI seed-access problem. Acceptable — Vitest + jsdom + mock analytics covers this surface.

**Test plan artifact path:** `docs/superpowers/plans/2026-04-09-portfolio-demo-hero-test-plan.md` — written to disk alongside this plan.

## Eng auto-decisions (all 23 findings)

### CRITICAL — must-fix pre-PR-1

- **AUTO-DECISION E1** (C1): Add **PR 0** with: (a) fix `PortfolioAnalytics.rolling_correlation` type to `Record<string, {date, value}[]> | null`, (b) add `ResizeObserver` stub to `src/test-setup.ts`, (c) create `src/lib/portfolio-analytics-adapter.ts` with typed adapter + fixture tests. Must merge before PR 1.
- **AUTO-DECISION E2** (C2): Stub ResizeObserver in `src/test-setup.ts`. Line: `global.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} };`. Part of PR 0.
- **AUTO-DECISION E3** (C3): Extract `fetchCandidatesForBatch` to `src/lib/demo-recommendations.ts`. Unit tests for both `batches[0]` and `batches[1]` paths. Part of PR 9 spec.
- **AUTO-DECISION E4** (C-Codex-1): Create NEW `/api/demo/portfolio-pdf/[id]/route.ts`:
  - Allowlist: only `ACTIVE_PORTFOLIO_ID`, `COLD_PORTFOLIO_ID`, `STALLED_PORTFOLIO_ID` (new consts)
  - Signed token: HMAC-SHA256 with `DEMO_PDF_SECRET` server-side secret
  - Shares `acquirePdfSlot` + `launchBrowser` with existing route
  - Rate-limited via `publicIpLimiter`
  - Returns 401 on missing/invalid token, 404 on non-allowlisted ID
  - Does NOT modify `/api/portfolio-pdf/[id]` auth checks
  - The `/demo` page server component generates the signed URL with a short-TTL token per request
  This is a NEW PR — **PR 9.5** "Demo PDF endpoint with signed tokens". Must merge before PR 12.
- **AUTO-DECISION E5** (C-Codex-2): Expand PR 0 to cover `benchmark_comparison` and `risk_decomposition` shape corrections. The adapter normalizes ALL JSONB fields into strict types.

### HIGH — must-resolve before ship

- **AUTO-DECISION E6** (H1): Write test plan artifact to `docs/superpowers/plans/2026-04-09-portfolio-demo-hero-test-plan.md`. Include: seed UUIDs, screenshot baseline location, seed drift policy.
- **AUTO-DECISION E7** (H2): PR 13 adds `/demo` to `e2e/smoke.spec.ts`. Verify `full-flow.spec.ts` and `discovery.spec.ts` timeouts after PR 10.
- **AUTO-DECISION E8** (H3): Plan explicitly states: **"No DB migrations required. Type fixes are TS-only. Seed extensions use existing columns."**
- **AUTO-DECISION E9** (H4 + M-Codex-8): `src/lib/warmup-analytics.ts` with `try/catch/void`, never throws. Plus: add a Vercel cron in `vercel.json` that hits analytics /health every 5 min. Both layers, belt + suspenders.
- **AUTO-DECISION E10** (H5 + H-Codex-4): `src/lib/personas.ts` lookup table. Forbid raw indexing. Unit tests for hostile inputs. Phase 1 Section 3 corrected with a note.
- **AUTO-DECISION E11** (H6): PR 9 spec states: "2 sequential phases of parallel fetches. Phase 1 = (profile, batches, portfolio). Phase 2 = (holdings, analytics)."
- **AUTO-DECISION E12** (H-Codex-3): Extend `src/lib/queries.ts::getPortfolioAnalytics` to fetch latest + latest-where-status=complete. Page chooses with stale badge. Bundle into PR 10.
- **AUTO-DECISION E13** (H-Codex-5): Extend `scripts/seed-demo-data.ts` to generate deterministic `portfolio_analytics` rows for active/cold/stalled personas. Use mulberry32. New function `generatePortfolioAnalyticsJSONB(profile, seed)`. Part of PR 11 (persona seed).
- **AUTO-DECISION E14** (H-Codex-6): Update `.github/workflows/ci.yml:83` to include `e2e/demo-public.spec.ts` and `e2e/demo-founder-view.spec.ts`. Write these specs so they pass WITHOUT a seeded DB (they hit the public /demo route which uses hardcoded IDs). Bundle into PR 13.

### MEDIUM

- **AUTO-DECISION E15** (M1): CardShell strict TS prop type + 4-state unit test. Part of PR 5.
- **AUTO-DECISION E16** (M2): PR 10 uses `next/dynamic` for `RiskAttribution`, `FounderInsights`, `CompositionDonut`. Bundle size noted in PR description.
- **AUTO-DECISION E17** (M3): Partial JSONB tests mandatory for each lib function. Fixtures: `fixtures/portfolio-analytics/{complete,partial-null-benchmark,empty-rolling-corr,all-null}.json`.
- **AUTO-DECISION E18** (M4): Seed integrity test `src/__tests__/seed-integrity.test.ts`. Mocked Supabase client. Asserts deterministic fixtures.
- **AUTO-DECISION E19** (M5): Admin client boundary comment at top of `src/app/demo/page.tsx`.
- **AUTO-DECISION E20** (M6): Extract `<MorningBriefing>` to `src/components/portfolio/MorningBriefing.tsx`. Both /demo and /portfolios/[id] import from there.
- **AUTO-DECISION E21** (M-Codex-7): DESIGN.md rule added in FIX 5.6 already covers this — formalize "editorial pages use stable block-level placeholders; authenticated dashboard uses CardShell with persistent shells".

### Remaining Claude-only
- **AUTO-DECISION E22** (Claude H6): 2 sequential phases documented (same as E11 — no duplicate decision, just marker).
- **AUTO-DECISION E23** (Claude C3): fetchCandidatesForBatch extraction (same as E3).

## Revised PR sequence (17 PRs with PR 0 + PR 9.5)

**Sprint 0 — PRE-WORK (1 PR — must merge first):**
0. Type adapter layer + ResizeObserver stub + fixture-based contract tests

**Sprint 1 — Data primitives (4 PRs):**
1. `portfolio-health.ts` + tests
2. `portfolio-insights.ts` + tests  
3. `winners-losers.ts` + tests
4. `regime-change.ts` + tests (uses corrected `rolling_correlation` shape)

**Sprint 2 — Hero components (4 PRs):**
5. `EditorialHero` + `CounterfactualStrip` + `MorningBriefing` (shared) + `CardShell` + tests
6. `WinnersLosersStrip` + `InsightStrip` + tests
7. `WhatWedDoCard` + `NextFiveMillionCard` + tests
8. `warmup-analytics.ts` + `personas.ts` + Vercel cron config + tests

**Sprint 3 — /demo hero + dashboard wiring + PDF endpoint (5 PRs):**
9. `/demo/page.tsx` rewrite (uses demo-recommendations extract, 2-phase fetch, personas, adapter)
9.5. `/api/demo/portfolio-pdf/[id]` with signed token + allowlist (NEW, enables PR 12)
10. `/portfolios/[id]/page.tsx` wiring (all 7 orphaned components + lazy loading + stale fallback)
11. Seed: persona portfolios (cold/stalled) + `generatePortfolioAnalyticsJSONB` deterministic fixtures
12. Download IC Report CTA wired to /api/demo/portfolio-pdf with signed token

**Sprint 4 — Tests + CI + polish (5 PRs):**
13. E2E specs: `demo-public.spec.ts` + `demo-founder-view.spec.ts` + CI yaml update + screenshot baseline
14. `seed-integrity.test.ts` + Puppeteer timeout guard + nightly PDF cold-start cron
15. Colorblind audit + mobile 320px + accessibility pass (VoiceOver smoke test)
16. Polish: tooltips, stale badges, empty-state copy, `/simplify` findings from QA pass
17. Buffer (optional — may not need)

**Total:** 17 PRs (+ optional buffer). Up from the original 16. PR 0 and PR 9.5 are non-negotiable adds.

## NOT in scope (eng-specific, updates Phase 1 list)

Additional eng-specific deferrals:
- **Contract tests against staging JSONB captures** — nice to have, but fixture-based contract tests are sufficient for v1.
- **Fuzz testing on the adapter** — one-off fuzz suite is enough; continuous fuzzing deferred.
- **Full TypeScript strict nullness audit on portfolio types** — only the demo-critical types are corrected in PR 0.
- **Automated bundle-size regression gate** — add to TODOS.md (P3) instead of blocking.
- **Load testing /demo at 100 concurrent** — defer until real traffic exists.

## What already exists (eng verification)

Verified by reading the actual files:
- ✅ `/api/portfolio-pdf/[id]/route.ts` — auth + ownership gated (lines 38-44), Puppeteer semaphore + rate limit working (lines 23-30, 55)
- ✅ `src/lib/puppeteer.ts` — `launchBrowser`, `acquirePdfSlot`, `PDF_QUEUE_TIMEOUT_MESSAGE` all exist and are tested
- ✅ `src/lib/ratelimit.ts` — `publicIpLimiter`, `checkLimit`, `getClientIp` all exist (hardening PR 2)
- ✅ `src/lib/csrf.ts` — CSRF Origin/Referer defense (hardening PR 3) — applies to POST routes; GET PDF routes are CSRF-safe
- ✅ `src/lib/supabase/admin.ts` — `createAdminClient()` exists
- ✅ `scripts/seed-demo-data.ts` — 614 lines, deterministic, 3 allocators + 8 strategies + 1 portfolio. Does NOT create portfolio_analytics (eng H-Codex-5).
- ✅ `.github/workflows/ci.yml` — frontend + python + e2e jobs. e2e only runs `auth.spec.ts + smoke.spec.ts` (eng H-Codex-6).
- ❌ `src/lib/types.ts:204` — `rolling_correlation` type WRONG (eng C1). Verified.
- ❌ `src/lib/types.ts:200-201` — `benchmark_comparison` + `risk_decomposition` types also WRONG (eng C-Codex-2). Verified.
- ❌ `src/test-setup.ts` — one-line file, no ResizeObserver (eng C2). Verified.
- ❌ `src/lib/queries.ts::getPortfolioAnalytics` — fetches only latest row (eng H-Codex-3). Verified.

## Failure modes registry (updated)

```
CODEPATH                           | FAILURE MODE                 | RESCUED? | TEST? | USER SEES?        | LOGGED?
───────────────────────────────────|──────────────────────────────|──────────|───────|───────────────────|─────────
adapter.ts                         | malformed JSONB               | Y        | Y     | card placeholder  | Y warn
rolling_correlation pair-keyed     | aggregate across pairs        | Y        | Y     | regime sentence   | Y
IC PDF missing token               | 401                          | Y        | Y     | error toast       | Y
IC PDF non-allowlisted ID          | 404 (no leak)                 | Y        | Y     | "not found"       | Y
warmup fetch throws sync           | swallowed                     | Y        | Y     | nothing           | Y info
warmup /health 500                 | silent                        | Y        | —     | nothing           | Y info
seed drift                         | integrity test fails          | Y        | Y     | CI red            | Y
stale fallback (latest failed)     | use latest-complete row       | Y        | Y     | stale badge       | Y
persona __proto__ / hostile input  | default to active             | Y        | Y     | active persona    | Y warn
analytics computation_status=null  | treat as stale                | Y        | Y     | stale badge       | Y
CI: demo E2E on unseeded env       | public route, hardcoded IDs   | Y        | Y     | green             | Y
Puppeteer cold start > 15s         | 504 + Retry-After             | Y        | Y     | error toast       | Y
```

**Zero CRITICAL GAPS.** Every failure mode is rescued, tested, and user-visible.

## Eng Completion Summary

```
  +====================================================================+
  |            ENG PLAN REVIEW — COMPLETION SUMMARY                    |
  +====================================================================+
  | Adversarial voices   | codex+subagent (dual)                       |
  | System Audit         | 4 verified wrong types; 3 verified gaps     |
  | Step 0               | Scope challenged; approach sound w/ fixes   |
  | Section 1  (Arch)    | ASCII dependency graph + 5 issues resolved  |
  | Section 2  (Errors)  | 12 codepaths mapped, 0 critical gaps        |
  | Section 3  (Security)| 2 issues corrected (persona enum, demo PDF) |
  | Section 4  (Data)    | JSONB shape issues mapped, adapter added    |
  | Section 5  (Quality) | MorningBriefing DRY, lazy loading added     |
  | Section 6  (Tests)   | Full diagram + test plan artifact written   |
  | Section 7  (Perf)    | Bundle bloat flagged, lazy loading added    |
  +--------------------------------------------------------------------+
  | Total findings       | 23 (5 critical, 10 high, 8 medium)          |
  | Auto-decided         | 21 of 23                                    |
  | Escalated (taste)    | 0 (none reached final gate from Phase 3)    |
  | Pre-PR-1 blockers    | PR 0 (type adapter + ResizeObserver)        |
  | New PRs added        | PR 0 + PR 9.5 (demo PDF endpoint)           |
  | PR count             | 16 → 17 + optional buffer                   |
  | Test plan artifact   | docs/superpowers/plans/...-test-plan.md     |
  | Deployment           | no DB migrations, all backward-compatible   |
  | Reversibility        | 5/5 per PR                                  |
  +====================================================================+
```

## Phase 3 → Phase 4 (DX Review skip → Final Gate)

> **Phase 3 complete.** Codex: 8 findings (2 critical, 4 high, 2 medium). Claude subagent: 15 findings (3 critical, 6 high, 6 medium). Consensus: dual-voice mode, 3/6 dimensions CONFIRMED fail (auto-fixes applied), 2/6 CONFIRMED pass. 23 total eng findings — 21 auto-decided, 2 merged into existing TODO candidates. New PR 0 (type adapter + ResizeObserver) is a blocker for PR 1; new PR 9.5 (demo PDF endpoint with signed tokens) is a blocker for PR 12. Test plan artifact written. Passing to Phase 3.5 (DX Review — skip check).

---

# PHASE 3.5 — DX REVIEW (SKIPPED)

**Skip reason:** DX scope not detected. This plan is a product UI refresh for institutional crypto allocators. The USERS of this plan are allocators (business users), not developers. There are no new APIs, SDKs, CLIs, developer integration points, or developer docs in scope. The only developer-facing artifacts (test setup, CI config) are internal engineering hygiene, not DX surface.

No DX review performed. Phase 3.5 intentionally skipped per autoplan conditional-skip rule ("skip if no developer-facing scope detected").

---

# REVISION 1 (2026-04-09) — Challenge B accepted: kill the health score

**User decision at final gate:** Accept User Challenge B only. Keep User Challenges A (full scope) and C (editorial inversion already applied). **Kill the Portfolio Health Score card and all composite-score derivations.**

**Rationale:** 4-signal cross-phase cross-model consensus (Phase 1 CEO Claude + Codex, Phase 2 Design Claude + Codex) that composite scores are a taste landmine for institutional LPs. User acknowledged the signal strength.

## Changes to the plan (supersedes earlier Phase 1-3 content where conflicts)

### Code changes
- **DELETED from scope:** `src/lib/portfolio-health.ts` and its test file. No composite 0-100 scoring anywhere.
- **DELETED from scope:** `<PortfolioHealthCard>` component. The editorial hero does NOT include a Health Score card.
- **DELETED from scope:** Any "Healthy / Concentration risk / Drawdown recovery" label logic. Raw metrics only.
- **RETAINED:** `portfolio-insights.ts`, `winners-losers.ts`, `regime-change.ts` — none of these compute a composite score. They produce plain-English sentences from raw data with explicit provenance.
- **RETAINED:** The editorial hero numbers block. It shows RAW metrics: Portfolio TWR, BTC TWR, Portfolio max drawdown, BTC max drawdown. These are not a composite. Each number comes straight from `portfolio_analytics` with an explicit source.

### What replaces the Health Score in the layout
Nothing. The editorial hero is already complete without it:

```
┌─────────────────────────────────────────┐
│ VERDICT BLOCK                           │
│   Editorial hero line (Instrument Serif)│
│   "Beat BTC on the way up.              │
│    And on the way down."                │
│   Product descriptor (DM Sans sec)      │
│   HERO NUMBERS (Geist Mono, raw only):  │
│     Portfolio TWR: +18%  BTC: +12%      │
│     Portfolio DD:  -5%   BTC DD: -22%   │
│   Counterfactual: "Had you allocated    │
│     12 months ago: +X% vs BTC +Y%"      │
│   Sticky CTA: [Download IC Report]      │
└─────────────────────────────────────────┘
```

No composite number. No gauge. Just the 4 raw numbers and the editorial claim they support.

### PR sequence update (17 PRs → 16 PRs)

**Sprint 0 — PRE-WORK (1 PR — unchanged):**
0. Type adapter layer + ResizeObserver stub + fixture-based contract tests

**Sprint 1 — Data primitives (3 PRs, was 4):**
1. ~~`portfolio-health.ts` + tests~~ **REMOVED** (Challenge B accepted)
2. `portfolio-insights.ts` + tests  
3. `winners-losers.ts` + tests
4. `regime-change.ts` + tests

**Sprint 2 — Hero components (4 PRs — one component deleted):**
5. `EditorialHero` + `CounterfactualStrip` + `MorningBriefing` (shared) + `CardShell` + tests (~~`<PortfolioHealthCard>`~~ removed)
6. `WinnersLosersStrip` + `InsightStrip` + tests
7. `WhatWedDoCard` + `NextFiveMillionCard` + tests
8. `warmup-analytics.ts` + `personas.ts` + Vercel cron config + tests

**Sprint 3 — /demo hero + dashboard wiring + PDF endpoint (5 PRs — unchanged):**
9. `/demo/page.tsx` rewrite (with editorial hero, no health card)
9.5. `/api/demo/portfolio-pdf/[id]` with signed token + allowlist
10. `/portfolios/[id]/page.tsx` wiring (7 orphaned components + stale fallback)
11. Seed: persona portfolios + `generatePortfolioAnalyticsJSONB`
12. Download IC Report CTA wired to /api/demo/portfolio-pdf

**Sprint 4 — Tests + CI + polish (4 PRs, was 5):**
13. E2E specs: demo-public + demo-founder-view + CI yaml + screenshot baseline
14. seed-integrity test + Puppeteer timeout + nightly PDF cron
15. Colorblind audit + mobile 320px + accessibility pass + VoiceOver smoke test
16. Polish + /simplify findings
~~17. Buffer (optional)~~ **Absorbed into PR 16**

**Total: 16 PRs** (was 17). Net delta: −1 PR, no scope loss on non-health items.

### Design score revision
- **Pass 4 (AI Slop Risk):** 4/10 → **10/10** (composite score eliminated; editorial hero is now fully aligned with DESIGN.md's "typography and data do all the work" principle)
- **Overall design score:** 9.5/10 → **10/10** after Revision 1

### CEO review: Theme 1 resolution
Cross-phase Theme 1 ("Health Score is a trust leak — 4 signals") is **RESOLVED**. The composite score is eliminated. The underlying concern (fake/weakly-defensible metrics) is addressed by the broader "raw metrics with provenance" rule that now applies to all cards.

### Related ripple effects
- **Seeded live alert** (CEO Codex Finding 3, cross-phase Theme 3): REFRAMED. Instead of seeding a fresh `triggered_at` timestamp before the demo (fake), the seed script creates a REAL alert from a REAL correlation regime change in the seed data. The demo shows an alert that was genuinely generated from the seeded portfolio's behavior, not a timestamp-hack.
- **Peer benchmark card** (Phase 1 plan Moment 1): DROPPED from scope. It was already marked STRETCH and the synthetic-peer concern from Codex Finding 3 made it untenable without real peer data. Deferred to TODOS.md.
- **Concentration creep warning** (Phase 1 plan Moment 2): RESTRICTED. Uses 1/N fallback only — but labeled as "equal-weight baseline comparison" in the UI to make the approximation explicit. No more "target_weight drift" framing since we don't have target_weight.

### Updated Cross-Phase Themes
- ~~**Theme 1 — Health Score is a trust leak**~~ → **RESOLVED** (Revision 1)
- **Theme 2 — Dashboard vs editorial hero** → auto-applied in Phase 2
- **Theme 3 — Synthetic metrics vs provenance** → partially resolved (health score gone, peer benchmark dropped, seeded alert reframed). Remaining: concentration creep uses documented equal-weight fallback.
- **Theme 4 — Tests misallocated** → auto-applied in Phase 3

### Remaining taste decisions
None. All 3 original User Challenges are resolved:
- **Challenge A (scope):** User override — keep 16 PRs (was 17, -1 from health removal).
- **Challenge B (health score):** User accept — killed completely.
- **Challenge C (editorial hero):** Already auto-applied in Phase 2 structural fix; user did not revert.

### Phase 2 Design mini re-review (Revision 1)

After the health score removal, I ran a Phase 2 mini-check:

**7-pass re-scoring:**
- Pass 1 Information Architecture: 9/10 → **9/10** (unchanged)
- Pass 2 Interaction State Coverage: 9/10 → **9/10** (one fewer card to state-map)
- Pass 3 User Journey: 9/10 → **9/10** (unchanged)
- Pass 4 AI Slop Risk: flagged → **10/10** (taste landmine eliminated)
- Pass 5 Design System Alignment: 9/10 → **10/10** (DESIGN.md "typography + data" fully respected; no more gauge-adjacent pattern)
- Pass 6 Responsive & A11y: 9/10 → **9/10** (unchanged)
- Pass 7 Unresolved Decisions: 9/10 → **10/10** (Decision #5 "Health Score visual" is moot; 0 unresolved)

**Overall: 9.5/10 → 10/10 after Revision 1.** 0 remaining design issues.

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | CLEAR (PLAN via /autoplan) | 6 proposals, 6 accepted, 5 deferred, mode: SELECTIVE_EXPANSION, 0 critical gaps (all 3 User Challenges resolved) |
| Outside Voice | `/codex review` | Independent 2nd opinion | 3 | issues_found | CEO: 9 findings; Design: 5 findings; Eng: 8 findings. All cross-confirmed with Claude subagent. Source: codex+subagent. |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR (PLAN via /autoplan) | 23 issues (5 critical, 10 high, 8 medium), 0 critical gaps after PR 0 + PR 9.5 additions |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAR (PLAN via /autoplan) | score: 4.5/10 → 10/10, 39 decisions made |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | Skipped — no developer-facing scope (product is for allocators, not developers) |

- **CODEX:** All 3 Codex voices (CEO, Design, Eng) ran successfully (user provided API key after initial rate-limit). 22 total Codex findings; 20 overlapping with Claude subagent (strong cross-model consensus).
- **CROSS-MODEL:** 17 of 20 auto-decided findings had explicit cross-model agreement. 3 User Challenges raised at final gate (A scope, B health score, C hero framing). User accepted Challenge B (kill health score), overrode A+C (keep full scope, keep editorial inversion). Zero remaining disagreements.
- **UNRESOLVED:** 0 (Revision 1 resolved all 3 User Challenges; 0 critical gaps remaining; 0 deferred decisions).
- **VERDICT:** CEO + ENG + DESIGN CLEARED — ready to implement. Start with PR 0 (type adapter + ResizeObserver stub).




---


