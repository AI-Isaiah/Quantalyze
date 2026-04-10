# TODOS

> **Goal:** Make the portfolio management system Quantalyze's 10/10 demo hero
> for the next cap-intro / pilot-allocator meeting. Show allocators what is
> performing, what is underperforming, and where we can help them improve.
>
> **Horizon:** Two CC sessions of the 2026-04-08 size = ~12-14 PRs of coding
> capacity before the final product we show.
>
> **Format:** These are IDEAS, not a plan. The plan comes later. No file paths,
> no line numbers, no effort estimates. Just the shape of the thing.

---

## 🔴 HIGHEST PRIORITY

(Previous HIGHEST PRIORITY entry — the "Multistrategy Dashboard (allocator
overview page)" idea — shipped in v0.4.0.0 as the My Allocation restructure.
It evolved during /plan-design-review: instead of a new `/overview` page, the
existing `/allocations` was renamed to "My Allocation" and refocused on the
allocator's single real portfolio. The scope toggle became a Favorites panel
with a dashed "+ Favorites" overlay curve, and saved favorite combinations
land in the renamed "Test Portfolios" section. See CHANGELOG.md and the plan
file at `~/.claude/plans/adaptive-puzzling-yao.md`.)

### Follow-ups from the My Allocation restructure (v0.4.0.0)

These were flagged during `/plan-design-review` and `/plan-eng-review` but
intentionally deferred out of the restructure PR to keep scope tight:

- **STRATEGY_PALETTE colorblind + WCAG AA audit.** Pulled forward by the
  multi-line YTD chart on My Allocation, which makes palette quality more
  visible than the single-portfolio chart on `/portfolios/[id]`. Same concern
  the existing correlation heatmap has. File a tracking issue, audit the
  current palette against colorblind simulators + AA contrast against white.
- **Refactor `PortfolioKPIRow` to the shared-panel pattern.** It currently
  renders four separate `Card` components with centered content on
  `/portfolios/[id]` — the exact "3+ cards in a row" anti-pattern DESIGN.md
  rejects. The new `FundKPIStrip` in the portfolio components folder is the
  reference implementation. Refactor needs design sign-off on the detail
  page visual change.
- **Replace the hardcoded 10% "favorites sleeve"** in
  `computeFavoritesOverlayCurve` with the portfolio optimizer. The optimizer
  already exists (`/api/portfolio-optimizer`) but uses a different input
  shape — wire it through.
- **Favorites sorting/grouping** — v1 is `created_at DESC`. Tags, priority,
  Sharpe-sort, or category groups are all reasonable next moves.
- **Bulk toggle in the Favorites panel** — "toggle all on", "toggle all off".
- **Narrative tooltips on each KPI strip cell** — two sentences each: what
  it means, why it matters. Removes the need for the founder to narrate
  every metric by memory during the demo.
- **Partial unique index integration test** (real Postgres) — proves a
  second real-portfolio insert for the same user hits 23505. Currently
  covered only by the self-verifying `DO $$` block in migration 023 at
  migration time. Same for the `user_favorites` RLS policies.
- **`PortfolioEquityCurve` overlay regression test** — lightweight-charts
  mocking is non-trivial but the `overlayCurve` prop deserves a real test
  that asserts the dashed series is added when non-null and not added when
  null. Today it's protected by TypeScript defaults + lint.
- **Full e2e walkthrough** — `e2e/my-allocation.spec.ts` (Playwright) that
  logs in, lands on My Allocation, toggles a favorite, saves as test
  portfolio, verifies Test Portfolios picks it up, verifies /connections
  still works.

### My Allocation Dashboard -- Widgets Needing New Endpoints

Six widgets are wired into the grid but render placeholder UI because they
depend on data sources that don't exist yet. Listed by priority.

#### P2: Trading Activity Log (Widget 26)
- Needs: trades table query endpoint aggregating recent trades across strategies
- Blocked by: no trades API route for cross-strategy aggregation
- File: `src/app/(dashboard)/allocations/widgets/positions/TradingActivityLog.tsx`

#### P2: Trade Volume Over Time (Widget 27)
- Needs: same trades query as Widget 26, aggregated by day
- File: `src/app/(dashboard)/allocations/widgets/positions/TradeVolume.tsx`

#### P2: Exposure by Asset Class (Widget 28)
- Needs: position-level data from exchange APIs (current holdings per asset)
- Blocked by: exchange position data not currently fetched
- File: `src/app/(dashboard)/allocations/widgets/positions/ExposureByAsset.tsx`

#### P2: Net Exposure Over Time (Widget 29)
- Needs: historical position data aggregated over time
- File: `src/app/(dashboard)/allocations/widgets/positions/NetExposure.tsx`

#### P3: Allocation Over Time (Widget 18)
- Needs: historical weight snapshots (weight changes over time)
- Blocked by: no weight history in current schema
- File: `src/app/(dashboard)/allocations/widgets/allocation/AllocationOverTime.tsx`

#### P3: Notes Widget (Widget 38)
- Needs: user_notes storage (Supabase table or localStorage with sync)
- File: `src/app/(dashboard)/allocations/widgets/meta/NotesWidget.tsx`

---

## North star — the portfolio story a demo allocator should feel

When an allocator opens their portfolio dashboard in the demo, they should hit
three moments in sequence, in under 60 seconds:

1. **"Oh — this tells me what's working."** A glance shows which strategies
   are earning their weight and which aren't.
2. **"Wait — this told me something I didn't know."** An insight surfaces that
   the allocator couldn't have computed in their head. Correlation regime
   shift. Concentration creep. A strategy quietly underperforming its peer
   group.
3. **"And here's what I should DO about it."** A concrete, plain-English
   recommendation. Rebalance, trim, add — with an expected-outcome framing.

Every idea below is in service of one of those three moments. If an idea
doesn't reinforce one of them, it's probably bloat.

---

## Moment 1 — "What's working?" ideas

- **Winners & losers hero card.** Top 3 contributors and bottom 3 detractors
  to portfolio return over the last 30 / 90 / 365 days. Color-coded, no chart
  needed. Should be the first thing an allocator sees, not buried in a table.
- **Portfolio health score.** One 0-100 number combining Sharpe, drawdown
  recovery, correlation spread, capacity utilization. Gives the allocator one
  thing to react to before they dig into details.
- **Return attribution, trailing 90 days.** Which strategies drove returns,
  which dragged. We already have the attribution bar — it needs to be the
  opening move of the dashboard narrative, not a secondary panel.
- **Drawdown story card.** Not just "you beat BTC" but "you beat BTC on the
  way up (+18% vs +12%) AND on the way down (-5% vs -22% drawdown)." The
  drawdown half is what wins LP meetings.
- **Peer benchmark.** Anonymized comparison against other institutional
  allocators on the platform with similar mandates. "Your Sharpe is 1.4; the
  median L/S Equity Stat Arb mandate on Quantalyze is 0.9." Social proof on
  top of quant data — only Quantalyze has this because only Quantalyze has
  verified peer data.

## Moment 2 — "What I didn't know" ideas

- **"Biggest risk right now" sentence.** One plain-English call-out generated
  from the correlation matrix + concentration + drawdown signals. "55% of your
  portfolio trades on one exchange — that's counterparty concentration, not
  diversification." Or: "Your highest-Sharpe strategy is also your highest-
  drawdown — concentration risk masked as alpha."
- **Correlation regime change alert.** Rolling 30-day average pairwise
  correlation vs. prior 30. "Your portfolio was 0.12 correlated last month;
  it's 0.35 now. Aurora × Nebula flipped from -0.05 to +0.41." Detects the
  stealth regime shift most allocators don't notice until after a drawdown.
- **Underperformance detection.** "Stellar Neutral Alpha has trailed its
  market-neutral peer group by 4% over the last 8 weeks." Proactive, not
  something the allocator has to go fishing for.
- **Capacity health per strategy.** % of max_capacity allocated, surfaced as
  a gauge. A strategy at 90% of its cap is a flag — the allocator should know
  before they add a ticket.
- **Concentration creep warning.** "Your Marcus Okafor exposure was 22% last
  month; it's 31% now due to strong performance." A rebalance nudge without
  being preachy.
- **Monthly performance commentary.** Auto-generated plain-English paragraph.
  "In March, your portfolio returned 2.3%, beating BTC by 1.1%. Stellar drove
  60% of the gain; Aurora was flat; Nebula lost 0.3% from a brief drawdown
  in week 3." The LLM infra is already on the stack.
- **Stress test.** "What happens if BTC drops 30% over 2 weeks?" Simulate
  against the current portfolio using historical covariance. Output is a
  single drawdown number with a confidence band and a "would you survive
  this?" framing.

## Moment 3 — "What should I do?" ideas

- **"What we'd do in your shoes" narrative.** Reads the optimizer output and
  frames it as a 2-sentence recommendation. "If you trim Stellar by 10% and
  redistribute to Aurora + Nebula, expected Sharpe goes from 1.2 to 1.5 at
  equivalent drawdown. Here's why." The optimizer is 80% built — the framing
  is what's missing.
- **"Where would the next $5M go?"** Concrete dollar decision, not abstract
  weights. "We'd put $2M into Aurora, $2M into Orion from the exploratory
  lane, $1M into cash." This is the unique Quantalyze value prop: we tell
  you where the next dollar goes.
- **Rebalance to target.** If any strategy's current weight has drifted more
  than 5% from its target, surface a one-click "rebalance" action. Needs the
  target_weight column the schema was supposed to have.
- **"Show me a strategy that would diversify this."** Button-driven. Runs
  the optimizer in "add a strategy" mode and returns the top match from the
  full directory. The match engine's allocator-facing incarnation.
- **Side-by-side portfolio alternatives.** "Portfolio A: your current
  allocation. Portfolio B: our recommendation. Same risk, 20bps higher
  expected return. Here's what changed." A before/after comparison inside
  the dashboard itself.
- **"One thing to do this week."** A single recommended action, not a list.
  The weekly nudge that keeps the relationship alive between allocations.

---

## Ideas for making the demo narrative land

Not portfolio features. The scaffolding that makes the hero story hit.

- **Three seeded allocator personas with distinct stories.** "The
  concentrated winner" (2 strategies, high Sharpe, high concentration). "The
  over-diversified underperformer" (6 strategies, low correlation, mediocre
  return). "The balanced target" (4 strategies, positive alpha vs. BTC,
  healthy risk). The founder picks which persona to demo based on the
  prospect's own situation.
- **Narrative through-line.** Don't demo features, demo the story. "Meet
  Alice. Here's her portfolio. Here's where she's bleeding. Here's what we
  do about it. Here's the before/after outcome." The dashboard should feel
  like watching a story unfold, not browsing a control panel.
- **Live alert that fires during the demo.** Seeded so a "correlation spike
  detected" banner appears mid-walkthrough. Shows the platform is alive, not
  a static screenshot.
- **Sample portfolio PDF report.** The portfolio-pdf route exists but the
  demo needs a sample that looks like an LP report someone would actually
  forward to their investment committee. A one-click download at the end of
  the walkthrough, with a visible "This is what you'd send to your IC" label.
- **One-click "send this to my IC" export.** PDF or email with the hero
  cards + insights. Ends the demo with a concrete next step the allocator
  can actually take.
- **Narrative tooltips on every KPI.** Two sentences: what it means, why it
  matters. Helps the founder present without narrating every metric from
  memory, and gives the allocator a reason to hover.
- **Mobile-first portfolio dashboard.** If the friend opens the link on
  their phone, the hero cards must work on mobile. Desktop-first is the
  current state.

---

## Ideas worth deferring

Tempting but not the hero. Don't spend the two sessions on these unless the
above is complete.

- Custom benchmark per allocator (BTC is fine for v1).
- ML / collaborative filtering for the optimizer (needs historical data).
- Save / dismiss / feedback loop on the allocator side.
- Full white-label partner portal (CSV-upload sketch is enough).
- Manager-side "who was I recommended to" dashboard.
- Real-time WebSocket refresh (hourly cron is fine).
- Organizations / teams model.
- Dark mode.

---

## Tech debt that could visibly break the demo

Kept short on purpose. Only the things that would lose the partner's trust
if they surfaced during a live walkthrough.

- Puppeteer cold-start hang on portfolio PDF — no timeout guard. First PDF
  download of the day could hang the Vercel function.
- Analytics service Railway cold start on the first request of a session.
  Catch it with a pre-flight warm-up.
- Mobile layout breakage below 375px on the portfolio dashboard, never
  tested at that viewport.
- Eval dashboard empty-state copy reads "No intros shipped" for a fresh
  partner pilot — should read as a promise, not an apology.
- Correlation heatmap uses a color palette we haven't audited against
  DESIGN.md. Colorblind safety unchecked.

---

## Shipped (reference)

The cap-intro sprint on 2026-04-08 merged 9 PRs covering the disclosure-tier
render guard, the match engine allocator-context fix, the Active Allocator
portfolio seed, hourly match-engine cron, the `/demo` public shareable URL,
the partner ROI simulator, the partner-pilot CSV upload + filtered eval
dashboard, and the friend meeting script. Earlier work (Sprint 1-6
portfolio intelligence platform, perfect match engine, disclosure tier +
compliance shell, tear sheet, recommendations) is on `main` and documented
in git history.

The portfolio intelligence platform already includes: portfolio dashboard,
equity curve, composition donut, correlation heatmap, risk attribution,
attribution bar, benchmark comparison, founder insights, allocation
timeline, strategy breakdown table, the optimizer endpoint and component,
alerts list, documents tab, and PDF export. Most of the "Moment 1-3"
ideas above are re-framings of existing components, not greenfield builds.

---

## Open follow-ups from the `/simplify` reviews (2026-04-08)

Small cleanup debt the reviewers flagged on the cap-intro sprint PRs, kept
here so the next session can opportunistically close them.

- ~~`/api/demo/match` is a near-verbatim copy of `/api/admin/match`; extract a
  shared query helper.~~ **DONE in hardening PR 6** — extracted to
  `src/lib/admin/match.ts::getAllocatorMatchPayload`.
- `/demo/page.tsx` re-implements `formatPercent`, `formatNumber`,
  `formatCurrency`, and `extractAnalytics` instead of importing them from
  `lib/utils`.
- ~~`ensureAuthUser` in the partner-import route duplicates the seed script's
  user-exists handling — promote to a shared helper.~~ **DONE in hardening
  PR 6** — extracted to `src/lib/supabase/admin-users.ts::ensureAuthUser`.
  Seed script keeps its own inline handling (intentional — it has different
  "fixed-UUID idempotent" semantics that the shared strict-mode helper
  doesn't fit).
- ~~`ALLOCATOR_ACTIVE_ID` and the `^[a-z0-9-]+$` partner-tag regex are
  hard-coded in three files each.~~ **DONE in hardening PR 6** — extracted
  to `src/lib/demo.ts` and `src/lib/partner.ts`.
- ~~Four "left-border-accent" banners (filtered eval, read-only preview,
  partner pilot hero, partner import success) should be a `ScopedBanner`
  primitive so the trust-critical filter banner stays structurally in sync.~~
  **DONE in hardening PR 8** — extracted to
  `src/components/ui/ScopedBanner.tsx` with 4 tones (accent/neutral/warning/
  success) and 4 call sites consolidated. Filtered vs. unfiltered symmetry on
  the eval dashboard is now enforced at the component level.
- `useAnimatedNumber` rapid-change behavior: verify the tween doesn't
  degrade to a snap-to when the target updates every frame.
- `match_eval.py` N+1 query pattern: each intro triggers two sequential
  Supabase round-trips in `_find_strategy_rank_in_latest_batch_before`.
- Partner-import processes CSV rows sequentially — a 10-row CSV is 30-40
  round-trips. Batch-upsert profiles + strategies in one call per table.
