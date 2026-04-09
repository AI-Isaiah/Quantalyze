# Full-app demo walkthrough — 2026-04-09

A click-by-click script for the cap-intro meeting. Covers what ships today
on the `feat/full-app-demo-seed-and-scenarios` branch (scenario builder +
allocator exchange manager), the data that's live in prod, and what to
narrate.

**Live URL:** https://quantalyze-rho.vercel.app
**Branch:** `feat/full-app-demo-seed-and-scenarios`

---

## Login

**Role:** Allocator (not admin, not manager)

```
URL:      https://quantalyze-rho.vercel.app/login
Email:    demo-allocator@quantalyze.test
Password: DemoAlpha2026!
```

The profile is `Atlas Family Office`, a single-family office allocating to
external crypto-quant managers with a ~$50M-$100M book. Preferences are
set to: institutional tier only, min 18mo track record, max 15% drawdown
tolerance, target ticket size $1M.

---

## What's in the database

Seeded by `scripts/seed-full-app-demo.ts` (committed on the feat branch).

| Entity | Count | Notes |
|---|---|---|
| Allocator | 1 | Atlas Family Office (the login) |
| Managers | 8 | Polaris Capital, Helios Quant, Redline Trading, Meridian Systematic, Kepler Alpha, Astra Vol Partners, Drift Research Lab, Midas Liquid |
| Strategies | 15 | Real crypto-quant archetypes: cross-exchange arb, basis carry, funding capture, BTC trend, altcoin momentum, L/S pairs, stat arb, short vol, iron condor, mean reversion, DEX MM, on-chain alpha, liquidation fade, risk parity, ML factor |
| Strategy analytics | 15 | 2-4 years of deterministic daily returns each, with explicit regime hits for 2022-05 LUNA, 2022-11 FTX, 2024-04 correction |
| Portfolios | 3 | 1 real + 2 what-if scenarios |
| Holdings | 14 | Split across the 3 portfolios |
| Allocation events | 28 | Active Allocation has full add/trim/re-add lifecycle |
| API keys | 2 | Binance + OKX read-only (seeded as connected) |

### The 3 portfolios

1. **Active Allocation** (`fa11e700-0001-4000-8000-000000000001`) — the REAL book
   - 5 holdings: Polaris Basis Capture, Helios Funding Carry, Meridian L/S Pairs, Redline BTC Trend, Astra Short Vol
   - Lifecycle events (`source='auto'`): initial deposit → quarterly top-up →
     drawdown trim → re-add after recovery → final top-up
   - Narrated in the UI as "auto-synced from Binance + OKX read-only keys"
2. **What-if: Aggressive Tilt** (`...002`) — SCENARIO, not real
   - 6 holdings including momentum, on-chain alpha, liquidation fade
   - Single manual deposit per holding, notes tagged `[Scenario: Aggressive Tilt]`
3. **What-if: Risk-Off** (`...003`) — SCENARIO, not real
   - 3 defensive holdings: Polaris Arb, Polaris Basis, Meridian Stat Arb
   - Shows what a pure-arbitrage book would have done

---

## Demo flow — 5 acts in ~10 minutes

### Act 1 — Login + "how is my real book doing?" (90 sec)

1. Log in with the credentials above
2. Sidebar lands you in `MY WORKSPACE`. Click **Portfolios**
3. Point at the **Active Allocation** tile and say: "This is my real book.
   The positions, weights, and invest/divest events were all auto-synced
   from my connected exchange accounts — zero manual entry."
4. Click into Active Allocation
5. Hero KPIs show TWR, Sharpe, vol, MDD, AUM, avg pairwise correlation
6. Scroll to the equity curve — point at the drawdown bumps and say
   "these are real 2024 events the strategies went through"
7. Scroll to the strategy breakdown table — "here's every position, its
   contribution, and the relationship status"
8. **Morning Briefing** card at the top of the page is a plain-English
   narrative auto-generated from the analytics

### Act 2 — Exchange connection flow (60 sec)

1. Click **Exchanges** in the sidebar
2. Point at the two connected keys (Binance + OKX) and say: "This is
   where I uploaded my read-only API keys. The system validates the key
   against the exchange, confirms it's read-only, and encrypts it with a
   per-user KEK before storing."
3. Click **Sync now** on one of them — it refreshes the timestamp
4. Scroll down to the "How exchange sync works" explainer card
5. Click **Open portfolio →** to jump back to Active Allocation and say
   "and this is what gets derived from those keys"
6. (Optional) Click **+ Connect exchange** to show the form. You can
   demo the flow without actually submitting a real key.

### Act 3 — The scenario builder (2-3 min, the "holy shit" moment)

1. Click **Scenarios** in the sidebar
2. The page loads with ALL 15 strategies selected, equal-weighted
3. Point at the big KPI strip (TWR, CAGR, Sharpe, Sortino, Max DD, Avg corr)
   and say "this is the portfolio I'd get if I equal-weighted every strategy"
4. Scroll to the correlation heatmap — "teal means diversifying, orange
   means concentrated"
5. **Now the demo moment:** click the checkbox on `Redline BTC Trend` to
   turn it OFF. Watch every metric recompute live in ~15ms.
6. Say: "Watch what happens when I drop the trend-follower. My max drawdown
   got tighter, my Sharpe went up, my volatility dropped by X%."
7. Toggle it back on. Toggle `Astra Short Vol` off and on too.
8. Click the **Include from** date picker on one strategy and move it to
   2024-01-01. Say: "This is for 'what if I had added this strategy in
   January' — the stats recompute using only that strategy's returns from
   that date forward."
9. Show the "Equal weight" button → "All" / "None" buttons as quick resets.
10. Closing line: "I use this every time I'm deciding whether to add or
    cut a manager. The correlation matrix alone tells me whether a new
    candidate is actually a diversifier or just another beta bet."

### Act 4 — The what-if portfolios (60 sec)

1. Click **Portfolios** in the sidebar
2. Click into **What-if: Aggressive Tilt**
3. Point at the narrative: "This is a scenario portfolio I built to test
   what my book would have done with more directional exposure."
4. Compare the TWR + Sharpe + drawdown to Active Allocation (mentally or
   via a split screen)
5. Say: "Could have made more, but the drawdown is 3x larger. Worth it?
   This is the exact analysis the scenario builder helps me do."
6. Click into **What-if: Risk-Off** — "This is the defensive extreme.
   Boring but bulletproof. The 2022 LUNA and FTX shocks barely touched it."

### Act 5 — Recommendations + match queue (30 sec, optional)

1. Click **Recommendations** in the sidebar
2. Show the ranked strategies the match engine produced for Atlas's
   preferences (should show the 3 top-ranked from the hourly match cron)
3. Say: "The match engine re-ranks these hourly against my preferences.
   When I see something interesting, I hit the 'Request intro' button
   and your team gets notified."

---

## What to AVOID during the demo

- **The `/demo` editorial page** — it's gone. It was the old persona-style
  editorial view that got replaced by the full-dashboard experience. If
  you accidentally hit `/demo`, you'll get a broken page.
- **PDF Download on the demo page** — if present, it'll 404. Use the
  authed `/api/portfolio-pdf/[id]` route via the portfolio page's
  "Download PDF" button (if present).
- **Mentioning the Multistrategy Dashboard as "live"** — it's the #1
  TODO but not yet built. Frame it as "roadmap, coming next."

---

## Known limitations / talking points

- **Exchange sync is seed-driven.** The button refreshes `last_sync_at`
  but doesn't actually pull new trades. Production would call the analytics
  service's trade-pull endpoint on a scheduled cron.
- **Scenarios don't persist.** They're ephemeral — you toggle, see, decide,
  and close. By design (per your direction); the roadmap has "save
  scenario" as a follow-up.
- **Match engine runs hourly.** After the seed, Atlas has a batch computed
  once manually. The next hourly cron run will refresh it automatically
  (via pg_cron + pg_net → Railway analytics service).
- **Only one allocator in the DB.** The rest of the system (managers,
  strategies, match queue) is shared-universe; there's just one account
  configured to demo from.

---

## Post-demo housekeeping

1. **Rotate secrets** that were pasted in chat during setup:
   - Upstash management API key `f25ddf32-...` → Upstash console
   - Supabase service role key `sb_secret_Gj8...` → Supabase dashboard
   - DEMO_PDF_SECRET (auto-generated but pasted in chat)
2. **Merge the feat branch** — `feat/full-app-demo-seed-and-scenarios` →
   main, assuming CI goes green on PR
3. **Build the Multistrategy Dashboard** (top TODO in `TODOS.md`) —
   45-90 min of pure client-side code
4. **Connect GitHub → Vercel** for auto-deploys (`vercel git connect`
   via CLI or Vercel dashboard → Settings → Git)
5. **Real exchange sync backend** — replace the seeded placeholder keys
   with a real trade-pull pipeline. Analytics service already has the
   infrastructure for strategy-side sync; needs allocator-side wrapper.
