# Strategy Team (Manager) Demo Script

**Duration:** 4 minutes.
**Audience:** a strategy manager considering publishing their strategy on
Quantalyze. Typically a person the founder already knows from the crypto
quant network — not a cold outbound target.
**Goal:** manager signs up, connects their exchange API (read-only),
publishes their strategy, and understands that the platform is the
institutional lane they've been locked out of by prime-broker cap-intro
desks.

---

## 0:00-0:30 — The frame

"Thanks for looking at this. Quick frame before I start clicking things:
Quantalyze is the verified strategy marketplace for managers in the
$20M-$500M AUM range who can't get on a prime-broker cap-intro desk
because the minimum is $500M. I'm not trying to sell you on a platform
— I'm trying to show you the institutional lane and see if it fits
your business."

---

## 0:30-1:30 — Sign up + exchange API

Navigate to `https://quantalyze.com`. Click "List your strategy."

Sign up with email + password. Land on onboarding.

**Fill in the manager profile form:**
- Display name, company, bio (1-2 sentences)
- Years trading, AUM range
- LinkedIn URL (optional but recommended for institutional tier)

**Explain:** "This is the manager-side profile. The bio, years trading,
and AUM range are ONLY shown to allocators if you opt into the
institutional disclosure tier — which we'll get to in a second. If
you stay in the exploratory tier, none of this leaks to anyone except
via the admin intro emails after you accept a request."

---

## 1:30-2:30 — Connect exchange API

Navigate to the strategy creation flow.

**Explain the exchange API step:**
"Quantalyze computes your analytics from your actual trades, not a
pitch deck. You generate a read-only API key on Binance / OKX / Bybit
and paste it here. We store it encrypted at rest (AES-128-CBC +
HMAC-SHA256 via Fernet, with the master key in environment config).
The key is read-only — we cannot place or cancel orders on your
account. We cannot see your deposits or withdrawals outside what the
exchange's bills API exposes."

**Click Validate.** Watch the validation flow — the platform hits the
exchange, confirms the key works, confirms the permissions are
read-only, and surfaces any errors inline.

"Once validated, the platform does an initial sync — pulls 90 days of
trades + daily PnL — and starts computing your analytics. First sync
is 30-90 seconds depending on exchange."

---

## 2:30-3:30 — Disclosure tier decision

Walk through the strategy edit form.

**The disclosure_tier dropdown:**
- **Institutional:** real name, bio, years trading, AUM range, LinkedIn
  are visible on `/discovery/[slug]/[strategy_id]`. Verified institutional
  lane badge. Cap-intro partner demos only surface institutional
  strategies.
- **Exploratory:** codename only. The manager's identity is disclosed
  to the allocator ONLY if the manager accepts an intro request.
  Pseudonymous until trust is earned.

**Explain the trade-off:** "Institutional is the right pick if you
already have an institutional track record and want allocators to see
your name and your story. Exploratory is the right pick if you're
testing the waters, don't have a ready bio, or want to see intro
requests before committing to disclosure. You can change tier anytime
via this same form."

**Recommend based on the specific manager:** for a named quant with
years of public track record, institutional. For a codename-only trader
who doesn't have a bio written, exploratory.

---

## 3:30-4:00 — Publish + what happens next

Click "Save" on the strategy. Status goes from draft → pending → (founder
reviews) → published.

**Explain the review step:** "I review every new strategy manually before
it goes live. I'm checking that the exchange API is returning real trades,
the track record is at least 3 months long, and the disclosure tier
matches what the manager said on the form. The review takes under 24
hours."

**Explain what the manager sees once published:**
- A notification when a new intro request comes in
- The ability to accept or decline each intro request
- The manager's email is never exposed in any public API response;
  allocators reach them only via the platform-mediated email
- Quarterly payouts via the partnership fee-share (per the term sheet
  draft) for each allocation that closes

---

## What NOT to show

- The admin Match Queue — it's the founder's workspace, not the manager's.
  Showing it makes the manager feel like a number instead of a person.
- The allocator `/recommendations` page — it's for allocators, and
  showing a manager which allocators are being recommended strategies
  like theirs feels transactional and reductive.
- The analytics service internals or the Python compute code.
- The revenue share percentages (point them at the term sheet draft if
  they ask; don't negotiate in the first conversation).

---

## FAQ — things managers always ask

**"What data do you keep?"**
Exchange API credentials (encrypted), the trades we pull daily via the
API, the computed analytics (TWR, Sharpe, Sortino, correlation,
drawdown), the strategy metadata you enter (name, category, description),
and the intro request history. We do NOT store personal identifying
information beyond what you enter on the profile form.

**"Can I be listed on multiple platforms?"**
Yes. Quantalyze is non-exclusive on the manager side in v1. If you're
on Darwinex or TradeLink or FXBlue, listing on Quantalyze too is fine
and expected.

**"What happens if my performance drops?"**
Nothing automatic — we show the current state honestly. The freshness
badge and the percentile rank update as new data comes in. If an
allocator has already committed, they see the same updates. The
platform's job is accurate data, not protection from it.

**"How much does it cost?"**
Nothing upfront. The cost is the revenue share — a percentage of the
first-year fees on any allocation that closes via a Quantalyze-sourced
introduction. See the term sheet draft (`docs/pitch/term-sheet-draft.md`)
for the structure. If you raise zero allocations through Quantalyze,
you pay zero.

**"How many allocators are on the platform?"**
Be honest. Right now: ~10-20 existing relationships being onboarded.
The platform is in the week-8 window of building for a cap-intro
partnership. First institutional allocator testimonials are being
captured as we speak. The honest answer is "this is the ground floor,
and the managers joining now are being featured in the testimonial +
demo materials that drive everything downstream."

---

## The close

"Low-pressure ask: can I have you on the platform by end of week with
one strategy published? I'll walk you through the API key generation
and the first sync personally. The only thing I need from you is the
decision on disclosure tier and 20 minutes of your time."
