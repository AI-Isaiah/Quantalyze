# Cap-Intro Partner Demo Script

**Duration:** 15 minutes (12 minutes of demo, 3 minutes of buffer + Q&A).
**Audience:** the capital introduction partner, week 8.
**Goal:** book a follow-up meeting to discuss a 12-month pilot partnership
with revenue share. NOT to close the partnership on the first meeting.

**Prerequisite checklist:** see `docs/demos/pre-flight-checklist.md`. Run it
in the hour before the meeting.

---

## Setup (0:00-0:30)

- Laptop on wired internet. Phone in airplane mode.
- One browser window, one tab open to staging production. Zoom sharing that
  tab only (not the full desktop, so no Slack notifications leak).
- Physical term sheet draft printed and on the table (`docs/pitch/term-sheet-draft.md`).
- One-pager printed next to the term sheet (`docs/pitch/one-pager.md`).

**Opening line:** "Before I walk you through the product, I want to show you
something that matters more than any of the UI you're about to see."

---

## 0:30-2:00 — THE TESTIMONIAL

**Play the 90-second allocator video.**

Location: `docs/demos/allocator-testimonial.mp4` (captured in Sprint 6, T15.3).

Say nothing while it plays. Don't narrate, don't explain, don't apologize.
Let it breathe.

**After the video:** "This is why I'm here. {Allocator name} is a real
allocator in my existing network. They completed the full flow on production
and told me, on camera, that Quantalyze saved them hours of diligence on a
strategy they wouldn't have found on their own. Everything I'm about to show
you is how that happened."

---

## 2:00-4:00 — THE BEFORE/AFTER METRIC

Pull up `docs/demos/before-after.md` (Sprint 6, T16.2).

"Before Quantalyze, introducing a new manager to a new allocator looked like
this:" → screenshot of old workflow + "30 minutes per allocator."

"After Quantalyze, it looks like this:" → screenshot of admin Match Queue +
"5 minutes per allocator."

"That's a 6x speedup in the founder's workflow. That's what turned me from
a person who could serve 10 allocators a month into a person who can serve
60. But speedup alone isn't the product — the product is what ENABLES the
speedup."

---

## 4:00-7:00 — THE MATCH QUEUE WALKTHROUGH

Navigate to `/admin/match` on production.

**Explain the screen:** "This is my workspace. Every row is an allocator
I'm tracking. The triage view at the top surfaces the allocators that
need attention — stale candidates, new batches, or zero historical
decisions."

Click into one seeded allocator (ideally the one from the testimonial if
they're on staging).

**Explain the two-pane:**
- Left rail: ranked candidates for this allocator's mandate
- Right pane: sticky detail for the selected candidate
- Top bar: preferences, recompute button, recent-recompute timestamp

**Press `?` to show the keyboard shortcut hint overlay.**
"This whole thing is keyboard-driven. j/k to move, u/d for keep/skip,
s to open the Send Intro panel. I can triage 20 candidates in under
90 seconds on a good day."

**Click "Send intro →" on the top candidate.**
The slide-out opens. Fill in a short founder note. Submit.

**Say:** "What just happened: (1) a contact_request row was inserted,
(2) a match_decisions row was recorded, both in one atomic transaction,
(3) two emails went out — one to the allocator with the manager's
identity block and the verified tear sheet link, one to the manager
with the allocator's mandate. I'm CC'd on both. The three-way thread
is seeded. From here, it's a normal email conversation."

---

## 7:00-9:00 — THE EVAL DASHBOARD

Navigate to `/admin/match/eval`.

"This is how I measure whether the algorithm is actually useful.
Every intro I ship is compared to the algorithm's ranking. If the
algorithm puts a strategy in the top 3 and I ship it, that's a hit.
If it puts it at rank 50 and I shipped it anyway, that's the algorithm
being wrong and me overriding it — and I want to know why."

Point at the hit rate number. "Today we're at X% hit rate over the
last 28 days, Y intros shipped."

"Within 6 months this dashboard is the feedback loop that tells me
when to retrain. It's also my answer to the question 'how do you know
this isn't just a random matching engine dressed up in a nice UI?'
The answer is: I measure it, and I'll show you the measurement."

---

## 9:00-11:00 — THE INSTITUTIONAL LANE

Navigate to `/discovery/crypto-sma` (or whichever category has the best
seeded data).

"This is what an allocator sees after signing in and clearing the
accredited gate. Strategies are filtered to the institutional lane by
default — real manager names, real bios, real LinkedIn. The exploratory
lane is separated for managers who want pseudonymity until an intro is
accepted."

Click into one institutional strategy.

**Point at the ManagerIdentityPanel:** "Real name. Bio. Years trading.
AUM range. LinkedIn link. Verified institutional lane badge."

**Point at the FreshnessBadge:** "Fresh, under 12 hours old, recomputed
by the daily cron job."

**Point at the PercentileRankBadge:** "78th percentile Sharpe within
Crypto SMA."

**Click "Download Tear Sheet":** "And this is the print-styled version
an allocator sends to their IC. Clean 8.5x11, all the metrics, custody
disclosure, risk block."

---

## 11:00-12:00 — THE TERM SHEET

Pick up the printed term sheet off the table. Put it in front of the
partner.

**Read §4 aloud, slowly:**
"X percent of first-year management + performance fees on successfully
matched allocations, paid by the manager, split 50/50 between
Quantalyze and Partner."

"I printed this because I wanted the conversation about our partnership
to be concrete, not hypothetical. I'm not asking you to sign anything
today. I'm asking: if I showed up next week with a pilot allocator and
a verified strategy, would this structure work for the way you do
business? And if not, what changes do we need to discuss?"

---

## 12:00-15:00 — Q&A

Let the partner drive. You have the objection handling doc in your head
(`docs/pitch/objection-handling.md`). If they hit one of the top 10
objections, you have answers.

**Critical mindset during Q&A:** Claude CEO's operating principle — if
you and another person agree on something in the room, that's a
RECOMMENDATION, not a DECISION. The partner has context you don't about
their LP relationships. If they want to change §4 splits or the 180-day
attribution window, DON'T commit in the room. Say "that's interesting,
I'd want to think through the second-order effects. Can I come back to
you in 48 hours with a response document?"

**The close:** "Thank you. I'd like to propose one follow-up: a pilot
with ONE of your allocators. The allocator signs up on Quantalyze,
clears the accredited gate, and completes one full end-to-end flow.
If the pilot goes well, we take the term sheet conversation into a
longer follow-up. If it doesn't, we both know quickly and nobody has
wasted a quarter."

---

## Post-meeting (within 2 hours of leaving)

1. Write `docs/pitch/post-meeting-notes.md` — partner reactions, asks,
   concerns, next steps. Do this BEFORE you forget the specifics.
2. Send a thank-you email within 4 hours. Include the pilot proposal
   in writing.
3. Update `docs/pitch/objection-handling.md` with any new objections
   that surprised you. Future-you will thank present-you.
4. Slack the outcome to your advisor / accountability partner.

---

## What NOT to show

These are in scope for the product but NOT in scope for the first partner
conversation:
- The optimizer panel on the portfolio dashboard (too technical, confuses
  the narrative)
- The analytics service internals (FastAPI, Python, cron heartbeat)
- The Python match engine code / weights / scoring breakdown
- The Sentry dashboard, Vercel logs, or any engineering observability
- The exploratory disclosure tier (this is NOT the lane the partner is
  investing in; showing it muddies the institutional story)
- The `/browse/*` public marketing surface (it's not the partner's journey)

If the partner asks about any of these, the answer is "happy to walk
through that in a technical follow-up. For now I want to stay focused
on what the allocator sees."

---

## If things go wrong

- **Staging is down:** have a pre-recorded 2-minute screen capture of the
  Match Queue in your phone's photos. Show that instead. Do NOT apologize
  for 5 minutes.
- **The testimonial video won't play:** have the transcript printed as a
  backup. Read the key quote aloud.
- **The partner is cold:** check if they brought objections from
  `docs/pitch/objection-handling.md` that you have answers for. If
  they're cold on the math, walk them through the one-pager's "Why now"
  section.
- **The partner wants to close NOW:** don't. "I appreciate the enthusiasm.
  Let me bring the pilot proposal to you in writing within 48 hours so we
  can both be sure we're signing up for the same thing."
