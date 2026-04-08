# Objection Handling — Top 10

**Audience:** the founder, rehearsing before the week-8 cap-intro partner
meeting and the allocator sessions in weeks 4-6.
**Format:** objection · what's behind it · answer · evidence · dodge-to-watch-for.

Practice each of these OUT LOUD before the partner meeting. Claude CEO's
operating principle: "you don't need scripted answers, you need scripted
questions that keep the conversation on rails."

---

## 1. "Allocators don't invest in unwrapped strategies."

**What's behind it:** the partner is skeptical that a disclosure-tier
model works without a regulated wrapper (UCITS, SMA, SPC).

**Answer:**
"Our institutional lane is for allocators who already invest in SMAs
directly. The manager retains custody — we provide analytics and
introduction, not fund administration. The accredited investor gate
and the custody disclosure shell cover the compliance surface. We're
not pretending this is for retirement money."

**Evidence:** `src/app/(dashboard)/discovery/layout.tsx` accredited
gate + `src/components/ui/Disclaimer.tsx` custody variant + legal
pages at `/legal/*`.

**Dodge-to-watch-for:** the partner pivots to "my LPs specifically
need a 40-Act wrapper." If so, the answer is "that's not our lane
today, but the verified data + matching engine work fine as a feeder
for a separately-structured product if a partner wants to build one."
Don't oversell a 40-Act retrofit we haven't designed.

---

## 2. "What's your LP pipeline? How do you actually get this in front of capital?"

**What's behind it:** the partner is evaluating whether Quantalyze has
demand-side traction or is asking them to supply all of it.

**Answer:**
"Short answer: we have ~10-20 existing allocators in the founder's
Telegram network, being migrated onto the platform during this month's
build. One of them will be on camera giving us a testimonial by week 6.
We're not asking you to supply ALL the LP demand. We're asking if a
pilot partnership with ONE of your allocators accelerates the week-6
testimonial into a week-12 committed allocation."

**Evidence:** the allocator testimonial video (captured week 6) + the
before/after metric (founder's time from 30 min → 5 min per allocator).

**Dodge-to-watch-for:** partner asks for specific named LPs in the
pipeline. The founder should disclose 2-3 real allocator names (with
permission) if the conversation is serious, or defer to "we'll share
the pipeline list under an NDA" if the partner is gatekeeping.

---

## 3. "Why should the manager give you X% of their fees?"

**What's behind it:** the partner is testing whether the revenue share is
fair or extractive, because the partner has to defend it to THEIR
managers too.

**Answer:**
"Because we reduced the manager's cost of customer acquisition from
$X of manual outbound per allocator meeting to $Y of a single
introduction email with a verified tear sheet attached. If the allocation
doesn't close, the manager pays nothing — this is purely success-based.
If the allocation closes, the manager pays less than they would pay a
placement agent or a prime desk for the same introduction, because the
data work we did is shared across all the managers on the platform."

**Evidence:** the term sheet draft §4 + §5 attribution rules.

**Dodge-to-watch-for:** partner tries to negotiate DOWN the manager's
share in exchange for UPPING the partner's share. Hold firm — the
split is fee-side (shared between Quantalyze + Partner), not manager-
side. The manager pays one number.

---

## 4. "How is this different from Darwinex / Interactive Brokers' strategy marketplace / prime-broker cap-intro?"

**What's behind it:** due diligence. The partner wants to know you've
done your homework and can defend positioning.

**Answer:** point them to `docs/pitch/competitive-landscape.md`.

Key one-liner: "Darwinex wraps the strategy and hides the manager;
we expose both. Prime desks only serve $500M+; we serve $20M-$500M.
IBKR is passive directory; we have the founder-ground-truth matching
layer and the revenue share already designed."

**Evidence:** competitive-landscape.md has a matrix.

**Dodge-to-watch-for:** partner cites a specific competitor we haven't
analyzed. Write it down, promise to come back with analysis within
48 hours, don't BS a comparison on the spot.

---

## 5. "Your data could be wrong. What if the exchange API returns stale data and a manager gets misrepresented?"

**What's behind it:** the partner's reputation is on the line if they
introduce an allocator to a manager whose Sharpe is printed as 2.1 but
is actually 0.8.

**Answer:**
"Every metric on the tear sheet carries a freshness badge: fresh if
recomputed within 12 hours, warm under 48, stale beyond that. If a
strategy's data is stale, the LP-facing surfaces show it as stale and
we have a Sentry alert that fires if any example strategy crosses
the threshold. The allocator sees exactly how old the data is.
Second, the data source is the exchange API, not the manager. The
manager cannot cherry-pick which trades to include — we read every
trade from read-only API credentials. Third, if something goes wrong,
the compliance disclaimer on every tear sheet explicitly says
'monitored via exchange API, analytics only, past performance does
not guarantee future results.'"

**Evidence:** `src/lib/freshness.ts` + `src/components/strategy/FreshnessBadge.tsx`
+ `src/components/ui/Disclaimer.tsx` custody variant.

**Dodge-to-watch-for:** partner asks for a SLA on data freshness. The
honest answer is "best effort, alert at 48h, human review at 72h." Don't
commit to "real time" — that's a future goal, not a Sprint-4-6 reality.

---

## 6. "What's stopping one of the incumbents from copying this?"

**What's behind it:** the partner is evaluating whether this is defensible
or whether they should wait for Darwinex / FXBlue / Goldman to build the
same thing.

**Answer:**
"Three things. First, the founder ground truth. The Match Queue
records the founder's KEEP / SKIP / Send Intro decisions as labeled
training data — by the time an incumbent catches up on the data
side, we'll have 500+ ground-truth labels to train against that
they don't have. Second, the partner-first revenue share. Goldman
can't do a 50/50 revenue share with a boutique cap-intro firm
because the economics of a prime desk don't fit that shape. Third,
the disclosure tier compliance shell is a design choice, not a
tech moat, but it takes 6-9 months to negotiate with legal and
we already did it. The moat is ~18 months, not permanent. By then
we need Year-1 allocator testimonials and a 20%+ hit rate, at which
point the moat is the brand."

**Evidence:** `supabase/migrations/011_perfect_match.sql` (match_decisions
schema for ground-truth), term-sheet-draft.md (partner-first economics),
migration 012 (disclosure tier).

**Dodge-to-watch-for:** partner asks "what happens if a bigger player
acquires you?" Don't speculate. "Right now we're focused on proving
the partnership model with you — acquisition is a bridge we'll cross
if we get there."

---

## 7. "What if the founder gets hit by a bus?"

**What's behind it:** key-person risk. The partner wants to know the
business isn't one founder with an Airtable.

**Answer:**
"Today, that's a real risk. The founder ground-truth layer in the
Match Queue is the bottleneck — if the founder stops triaging, the
algorithm's hit rate drops and the demo artifact goes stale. The
mitigation is the documented Match Queue runbook, the Eval Dashboard
that makes the algorithm's performance legible without founder
context, and the plan to hire a second triage operator at 30+
allocators on the platform. We're not pretending this is a solved
problem — it's the #1 operational risk we track."

**Evidence:** the runbook already exists, the Eval Dashboard exists
(`src/components/admin/MatchEvalDashboard.tsx`), and the hiring plan
is documented in TODOS.md.

**Dodge-to-watch-for:** partner pushes for a co-founder / COO hire
timeline. Commit to a timeline only you can hit.

---

## 8. "Your fees are too high / too low."

**What's behind it:** calibration. The partner is testing whether the
founder knows the market.

**Answer:**
"We benchmarked against prime-broker cap-intro desks (50-150bps/year
retainer + occasional success fees) and independent placement agents
(1-2% of first-year + residuals). Our proposed fee is on the lower
end of placement agent economics because the majority of the value
is in the verified data + matching layer, not the relationship.
We expect the partner to take a larger share of the split because
the LP trust is their scarce asset, and the term sheet §4 reflects
that by starting at 50/50 and allowing flip-to-25/75 in specific
attribution scenarios."

**Evidence:** term-sheet-draft.md §4.

**Dodge-to-watch-for:** partner insists on a specific number they've
committed to other platforms. Ask what they've committed and under
what conditions — don't just agree. The partner's reference point is
valuable intel either way.

---

## 9. "What's your path to profitability?"

**What's behind it:** the partner wants to know they're not backing a
vanity project.

**Answer:**
"Revenue per allocation at our target split is $Y (based on 20bps
management + 20% perf × $Z average AUM × fee-share %). Break-even
requires N allocations per quarter. At N+1 allocations per quarter
we're covering infrastructure + founder salary. At 3N we're
funding a second triage operator. The path is slow but sticky —
allocations retain for 2-5 years based on boutique placement agent
benchmarks, so the CAC payback is fast and the LTV is long."

**Evidence:** build a simple spreadsheet for this before the meeting.
Don't walk in with a napkin.

**Dodge-to-watch-for:** partner asks what the founder is currently
drawing for salary / runway. Be honest: "I'm personally bootstrapped
for 12 months. The partnership revenue share IS my runway extension."

---

## 10. "Why you? Why now?"

**What's behind it:** the founder test. Can the person in the room
actually execute, or will the partner waste 12 months babysitting
someone who ships slowly?

**Answer:**
"I've been running a verified-strategy analytics pipeline for 18 months
already. The Portfolio Intelligence Platform and the Perfect Match
Engine both shipped in the last 14 days against adversarial review
from four different AI voices before any code was written. Sprint 1-3
demo-ready shipped with 31 new tests and a security review that caught
a real RLS bypass before merging. I'm shipping faster with AI than
most 5-person teams were shipping with humans in 2024. The question
isn't whether I can execute — it's whether the partner has an LP
willing to be the first recorded testimonial."

**Evidence:** PR list — #9 (Portfolio Intelligence), #10 (Perfect Match),
#12 (Sprint 1-3 demo-ready). All shipped with review trail + tests.

**Dodge-to-watch-for:** partner starts listing conditions the founder
must satisfy before the partnership. Capture them, don't commit on
the spot, follow up within 48 hours with a response document. The
partner is negotiating with themselves; stay patient.

---

## How to use this document

**Week before the meeting:** read it twice. Out loud.
**Day before:** practice the 3 answers you're least confident on
against someone else (founder friend, advisor, even a mirror).
**Morning of:** re-read only the "Dodge-to-watch-for" lines. That's
where the meeting actually happens.
**After:** capture the partner's actual objections + reactions in
`docs/pitch/post-meeting-notes.md` and update this doc with any new
objections that surprised you.
