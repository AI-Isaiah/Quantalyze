# Competitive Landscape

**Audience:** the capital introduction partner, in the week-8 meeting.
**Purpose:** honest positioning against adjacent tools. Establish that we
know the space and that the partner is not an afterthought.

---

## The map

```
                     ┌─────────────────────────────┐
                     │     LP capital flow         │
                     └──────────────┬──────────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        │                           │                           │
        ▼                           ▼                           ▼
┌───────────────┐         ┌───────────────────┐       ┌──────────────────┐
│ Prime-broker  │         │ Capital intro     │       │ Direct (LP-to-   │
│ cap-intro     │         │ boutiques          │       │ manager)         │
│ desks          │        │ (e.g. partner)     │       │                  │
│ (Goldman, JPM) │        │                   │       │                  │
└───────┬───────┘         └─────────┬─────────┘       └────────┬─────────┘
        │                            │                          │
        │ Top 1% AUM only            │ Mid-market + niche       │
        │ 50bps-150bps/year retainer │ Relationship-driven      │
        │                            │ Under-tooled             │
        │                            │ ← Quantalyze lives here  │
        │                            │                          │
        ▼                            ▼                          ▼
┌────────────────────────────────────────────────────────────────────┐
│                 Retail-quant verified data surface                  │
│   TradeLink · Darwinex · FXBlue · STRATS · quants.space             │
│   ← Quantalyze competes for manager-side supply here                │
└────────────────────────────────────────────────────────────────────┘
```

---

## Category 1: prime-broker cap-intro desks

**Goldman, JPM, Morgan Stanley, UBS, Jefferies, Cowen, Marex, BTIG.**

- **What they do:** introduce institutional allocators to prime-brokered
  managers they serve as a bundled service on top of financing, execution,
  clearing, and custody.
- **Who they serve:** $500M+ AUM managers with existing prime relationships
  and institutional infrastructure.
- **Pricing:** bundled into the prime fee (effectively 0 at point of
  introduction, recovered on financing spreads).
- **Strength:** brand trust, LP relationships built over decades, regulatory
  wrapper already in place.
- **Weakness:** they do not touch the mid-market. A $20M-$200M manager
  without prime relationships cannot get an introduction no matter how
  good the track record is.

**Claude CEO's note:** these are NOT competitors to the partner. They are
potential channel partners. A prime-broker desk hearing about Quantalyze
should think "interesting way to find pre-qualified emerging-manager leads
for the second-tier side of my book." The cap-intro partner in our week-8
meeting is NOT competing against Goldman — they're competing against other
boutiques in their own tier.

**Quantalyze's position:** we are the data + introduction substrate the
prime desks WISH they had for their second-tier / emerging-manager book.
Long-term, a partnership with a prime desk is strategically valuable but
not day-1 critical.

---

## Category 2: capital intro boutiques

**The partner in our week-8 meeting is in this category.**

- **What they do:** LP relationship management + manager curation + last-mile
  introduction orchestration.
- **Who they serve:** mid-market managers ($20M-$500M AUM), family offices,
  boutique LPs, fund-of-funds.
- **Pricing:** typically 1-2% of first-year fees + residuals on long-term
  allocations. Some charge a retainer + success fee.
- **Strength:** deep LP trust, compliance shell, human relationships.
- **Weakness:** their diligence workflow is manual. Excel spreadsheets,
  PDF pitch decks, phone calls to references. Time-to-verified is days,
  not minutes. They look at maybe 20 managers a year, not 200.

**Quantalyze's position:** we are the data and matching layer under the
partner's existing LP trust. The partner keeps the relationship, Quantalyze
amplifies their diligence throughput 10x. Revenue share in §4 of the term
sheet reflects that the partner's relationship is the scarce resource.

**Not competing on:** LP trust, compliance, relationship management.
**Competing on** (but not replacing): deal flow quality and diligence speed.

---

## Category 3: direct LP-to-manager channels

**Allocator Forum, Context Summits, in-person LP conferences.**

- **What they do:** in-person introductions at ticketed events.
- **Who they serve:** managers who can afford the $10-30k ticket price.
- **Pricing:** ticket fee + occasional sponsorships.
- **Strength:** high-intent LP contact, compression of 3 months of coffee
  into 3 days.
- **Weakness:** one-shot. If the LP doesn't commit at the event, the
  relationship has no durable tooling to carry it forward. Exorbitant
  cost-per-conversation.

**Quantalyze's position:** complementary. Managers should still go to
these events. Quantalyze is how they nurture the allocators they meet
there — verified tear sheets, freshness badges, and an allocator-facing
`/recommendations` surface that stays live between events.

---

## Category 4: retail-quant verified-data platforms

**This is where the manager-side supply competition lives.**

### TradeLink.pro
- Verified strategy copy-trading for retail Binance + Bybit users.
- Strong on manager UX (leaderboards, social features).
- **Weakness:** retail-first. Leaderboard dynamics push managers toward
  showy short-term metrics (30-day returns) over institutional discipline
  (max drawdown, Sharpe, lockup). LPs read the metrics and see a casino.
- **Our difference:** Quantalyze is institutional-first. No leaderboard.
  Disclosure tier explicitly separates "serious" managers from
  "exploratory." Percentile ranks normalize against discipline, not
  flash.

### Darwinex
- Regulated asset manager that wraps retail strategies in a UCITS
  structure.
- Strong on the regulated wrapper side.
- **Weakness:** opaque to the allocator. The LP buys a Darwinex product
  but doesn't see the underlying manager's actual trades. No disclosure
  tier, no percentile rank, no founder ground truth.
- **Our difference:** Quantalyze is a marketplace, not a product. The LP
  sees the manager. The LP owns the relationship.

### FXBlue
- Verified FX + CFD track records via MT4/MT5 plugins.
- Strong on the pure data side — every tick is logged.
- **Weakness:** FX-only (no crypto, no equity, no multi-asset). No
  matching engine, no allocator surface, no introduction workflow. A
  manager uploads data, a website shows it, nothing else happens.
- **Our difference:** Quantalyze closes the loop to an actual introduction
  + an actual revenue share. FXBlue is upstream supply; Quantalyze
  captures the demand side too.

### STRATS.io
- Multi-asset verified track records with a focus on execution quality
  metrics.
- **Weakness:** quant-first, LP-hostile. The dashboards require a
  quant background to interpret. An allocator reading STRATS for the
  first time bounces.
- **Our difference:** our tear sheets are written for allocators, not
  for quants. DM Sans + Instrument Serif + percentile ranks + plain
  English commentary.

### quants.space
- Marketplace for quant strategies targeting retail and semi-professional
  traders.
- **Weakness:** scattered UX, no institutional gate, no founder ground
  truth layer.
- **Our difference:** discipline on audience, compliance shell, and
  founder amplification.

### genieai.tech
- AI-generated strategy backtesting + generative research.
- **Weakness:** no real trading history. Backtests only.
- **Our difference:** Quantalyze requires LIVE exchange-API trades.
  No hypothetical backtests in the institutional lane.

---

## Our unique unlock

No competitor combines ALL of:

1. **Verified live-trade data** (FXBlue has it, nobody else in this tier does).
2. **Institutional disclosure tier** (Darwinex has the wrapper, nobody else).
3. **Matching engine + founder ground truth** (nobody has this).
4. **Capital introduction partner revenue share** (nobody has this).
5. **Custody-clean compliance shell** (nobody in the retail-adjacent tier).

The cap-intro partner wins because Quantalyze is the only tool that
gives them ALL five at once.

---

## What each competitor would say about us

- **Prime desks:** "interesting, come back when you have $500M of committed
  LP capital routed through you." → Correct. We're not targeting prime.
- **Boutique cap-intro firms:** "the matching engine is interesting but
  the real game is LP trust and we already have that." → Partially
  correct. Our proposition is that matching + verified data speeds them
  up 10x, not that we replace them.
- **Darwinex:** "the disclosure tier is clever but allocators won't
  invest in unwrapped strategies." → We'd test this empirically with
  the allocator testimonial in week 6.
- **TradeLink:** "retail is a bigger TAM." → Correct, but institutional
  fee-per-dollar is 50x retail fee-per-dollar. We'd rather own the high-
  ticket end.
- **FXBlue:** "why didn't you just use our data?" → They're FX-only
  and don't have any matching layer. We could be a customer of FXBlue
  on the FX side if a partner asks for FX coverage specifically.

---

## Positioning statement (for the meeting)

*"Quantalyze is the verified data + matching substrate that sits under
the partner's existing LP trust. We're not replacing the partner — we're
making every hour the partner spends with an allocator 10x more useful.
The LP sees a curated short list with percentile-ranked metrics instead
of 20 PDFs. The manager sees a verified tear sheet instead of an
Excel file. The partner sees a pipeline of pre-verified deal flow
with the attribution transparency to get paid fairly."*
