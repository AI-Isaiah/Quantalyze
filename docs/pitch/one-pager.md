# Quantalyze — One Pager

**Verified strategies. Matched allocations. Trusted introductions.**

---

## Problem

Capital allocators spend 20-40 minutes per diligence touch verifying a
strategy manager's track record — chasing broker statements, piecing
together Excel files, interrogating unaudited screenshots. The high-friction
workflow means allocators look at fewer managers, managers spend more time
on PowerPoint than performance, and capital is slower to move than the
market moves.

Prime-broker cap-intro desks solved this at the top of the market for
$500M+ AUM managers. Everyone else — the 100-strategy mid-market of
verified-but-undiscovered operators — still runs on PDFs and trust.

## Solution

Quantalyze is the verified strategy marketplace for that mid-market.

1. **Verified data.** Managers connect exchange APIs read-only. We compute
   analytics from the actual trades, not a pitch deck. Every metric carries
   a freshness badge (fresh / warm / stale) and a percentile rank within
   its category.

2. **Disclosure tier.** Managers opt in to an "institutional" lane with
   real name, bio, years trading, AUM range, and LinkedIn, or stay in an
   "exploratory" lane with a codename until an allocator requests an
   introduction and the manager accepts. Allocators filter by tier in
   `/discovery`.

3. **Matching engine.** Rule-based scorer over allocator mandate
   (ticket size, volatility tolerance, strategy type) ↔ strategy fit
   (track-record length, AUM, Sharpe, drawdown, correlation to the
   existing portfolio). Runs daily on pg_cron, surfaces top candidates
   to the founder's Match Queue for triage.

4. **Founder amplifier.** The founder is the judgment layer on top of the
   algorithm. The Match Queue shows the algorithm's picks; the founder
   records KEEP / SKIP / Send Intro decisions per candidate. Send Intro
   dispatches a triple-party email with the verified tear sheet attached.
   The eval dashboard tracks the algorithm's hit rate against the
   founder's ground truth.

## Why now

- Retail quant tooling (TradeLink, Darwinex, FXBlue) validated the
  verified-data side. None of them closed the "verified → allocator → capital"
  loop.
- LPs are increasingly uncomfortable writing 8-figure checks based on
  screenshots. The Archegos post-mortem turned "verifiable exposure" from
  a nice-to-have into a default expectation.
- AI is making marginal data-analysis cost near-zero. A two-person team
  can now compute Sharpe, Sortino, correlation, attribution, and
  optimizer suggestions over 100 strategies in under 30 seconds.

## Proof artifact

**A 90-second video testimonial from one real allocator** (captured
week 6 of the 8-week demo-ready build). The allocator says on camera
that Quantalyze reduced their diligence time from hours to minutes and
gave them a match they wouldn't have found on their own.

The cap-intro partner demo in week 8 opens with that clip — not a
polished UI walkthrough. The video is the evidence. The walkthrough is
the invitation.

## Business model

Fee share with the capital introduction partner: X% of first-year
management + performance fees on successfully matched allocations, split
50/50 between Quantalyze and Partner, paid quarterly. See
`docs/pitch/term-sheet-draft.md`.

Allocators pay nothing. Managers pay via the fee stream they already owe
on the AUM they raise.

## Traction

- Perfect Match Engine shipped — admin Match Queue, 24 unit tests, Eval
  Dashboard, pg_cron-scheduled recompute. (PR #10.)
- Portfolio Intelligence Platform shipped — TWR/MWR analytics, correlation
  matrix, attribution, optimizer. (PR #9.)
- Sprint 1-3 demo-ready shipped — disclosure tier, accredited gate,
  institutional tear sheets, Freshness system, `/recommendations`.
- ~10-20 existing Telegram allocators already in the founder's network,
  being migrated onto the platform during Sprint 4-6.

## What we need from the partner

1. One pilot allocator willing to complete the full flow on production
   in exchange for being the first recorded testimonial (week 4-6).
2. 60 minutes per week for 6 weeks for founder-to-partner syncs during
   the build.
3. Feedback on the draft term sheet — what would need to change for the
   partner to commit to a 12-month pilot with Quantalyze as the data +
   matching layer?

## The ask

A follow-up meeting after the week-8 partner demo to discuss a 12-month
pilot partnership with revenue share. No commitment required at the
first conversation.

## Contact

Founder email: [founder@quantalyze.com]
Platform: https://quantalyze.com
