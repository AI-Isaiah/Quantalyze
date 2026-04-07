# Partner Qualification Call — Script

> **Owner:** Founder
> **Length:** 30-45 min call + 60 min writeup + 30 min plan review = ~2 hours total
> **Output:** `partner-qualification-notes.md` filled in (gitignored — see below)
> **Decision:** Proceed with the 8-week plan, pivot the plan, or rewrite the plan around LP outbound
> **Why this exists:** Both adversarial CEO voices in the autoplan review converged on this as the single highest-leverage act before any 8-week build. The plan optimizes for a meeting that hasn't been qualified. Spend 2 hours qualifying the meeting before spending 8 weeks building for it.

> **⚠️ Before the call:** Copy the notes template to a local-only file (gitignored):
>
> ```bash
> cp docs/pitch/partner-qualification-notes.template.md docs/pitch/partner-qualification-notes.md
> ```
>
> Edit the bare `.md` file (not the `.template.md`). The filled-in notes contain partner-sensitive information and must never get pushed to the public repo.

---

## Pre-call prep (15 min)

**1. Re-read the plan's North Star** (`/Users/helios-mammut/.claude/plans/rosy-cuddling-teacup.md` §2):
> By end of week 6, one real allocator from the founder's existing Telegram network has completed the full flow on production... and recorded a 90-second video testimonial.

**2. Re-read the plan's audience priority table** (§3) — internalize that the cap-intro partner is now the *closing meeting* (P1), not the *proof artifact* (which is the testimonial, P0).

**3. Have these tabs open:**
- The current production app (logged in as founder)
- `/admin/match` showing the existing seeded queue (or, if not yet seeded, screenshots of the v0 admin UI)
- A blank `partner-qualification-notes.md` to type into during the call
- This script

**4. Mental frame:**
- This is NOT a sales call. You are diligencing the partner the same way they will diligence you.
- Cap-intro firms vary wildly in quality. The bottom half are people selling dreams to founders in exchange for free equity. You are checking whether this specific partner is real.
- The partner's existence is not a gift — it's an option you may or may not exercise.
- Your goal is to leave the call with a clear answer to "is this partner the right partner?"

---

## Call agenda (30-45 min)

### Open (3 min) — Set the frame
> "Thanks for taking the time. I want to be direct about what this call is. I've built a tool that automates the matching work I've been doing manually for the last X months. Before I invest 8 weeks finishing the demo, I want to make sure I'm building the right thing for the right partner. So I'd like to ask you 5 questions about how you'd actually use this — and at the end of the call we can both decide whether it makes sense to keep talking. Sound fair?"

### Question 1 (5-7 min) — Their criteria for new partnerships
> "When a new tech vendor or platform reaches out about partnering with your cap-intro practice, what are the 2-3 things you're checking before you'd consider a real conversation?"

**Listen for:**
- "I need to see traction" / "I need signed LPs" → high-risk signal: partner is gated on LP traction, not product
- "I need to see real allocators using it" → aligned: testimonial is the right artifact
- "I need to see a clean compliance posture" → aligned: institutional lane / accredited gate / disclaimers matter
- "I need to see X dollars of AUM committed" → critical: be honest, you have $0 committed
- "I need to see the team / your cap table" → soft: founder is the team, address openly

**Red flag:** Vague answers like "I just need to feel good about it" or "trust me, when I see it I'll know." This is partner sophistication signal — institutional cap-intro firms have explicit gates.

---

### Question 2 (5-7 min) — Their typical deal structure
> "When you do partner with a tech vendor or matching platform, what does a typical deal look like for you? Revenue share, retainer, equity, exclusivity? And what's your typical timeline from first call to signed terms?"

**Listen for:**
- Concrete percentages and structures → real dealmaker
- "It depends" with no examples → not a real dealmaker, or hasn't done this before
- "Equity only" → partner wants free options on you, not real economics
- "Retainer-driven" → they're a service business, not a partnership
- Timeline: weeks (real) vs months (institutional, fine) vs "as soon as you're ready" (vague, bad signal)

**Drop the term sheet draft on the table if the conversation goes here:**
> "I'm thinking about this as a take-rate model — X% of first-year management + performance fees on successful matched allocations, paid by the manager not the allocator. I have a 1-pager I'm working through. Would you want to look at it together at some point so I can shape it around what's actually fundable for you?"

---

### Question 3 (5-7 min) — What they're getting from existing tech
> "Before you take a meeting with me on this — what are you currently using for sourcing, screening, and tracking strategies? Backstop? Preqin? Spreadsheets? CRM? Internal team? What's working and what's frustrating about that today?"

**Why this matters:**
- If they say "I have Backstop and Preqin and a 4-person research team" → they don't need your product, they need a feature inside their existing stack. The partnership becomes "we license you data" or nothing.
- If they say "I do it all manually in spreadsheets" → aligned: you're solving their actual pain.
- If they say "my analyst does it all" → high-risk: their analyst is your competitor, not your customer. The analyst will protect their job.

**Listen for:** the word "frustrating." Any mention of pain. The pain is your wedge.

---

### Question 4 (5-7 min) — Their walk-away criteria
> "What would I have to show you in our next meeting that would make you walk away saying 'not interested'?"

**Why this matters:** Most founders never ask this. It surfaces what to AVOID showing in the demo. If they say "if it's just a fancy spreadsheet I'm out" — make sure the demo doesn't look like a spreadsheet. If they say "if you can't show real allocator usage" — that's confirmation the testimonial is the right North Star.

**Listen for:**
- Specific concrete things → real partner
- "Honestly nothing, I just need to like it" → vague, not real
- "If you don't have at least one real allocator in production" → CRITICAL — confirms the testimonial is the demo gate

---

### Question 5 (5-7 min) — The big honest one
> "Last question, and you can be totally direct with me on this. In the next 12 months, can you credibly direct $10M+ of LP capital into a platform like this? And — if I were to do everything right and you were to fully partner with me — what does month 6 look like for both of us?"

**Why this matters:** This is the test of partner reality. If they cannot credibly direct $10M+, you are spending 8 weeks on a meeting that, even in the best case, doesn't move your business. If they say "well, I'd hope to" — that's not a yes.

**Listen for:**
- Specific number + specific allocators they'd talk to → real
- "It depends on what you build" → soft yes, manageable
- "Hard to say without seeing more" → soft no, dangerous
- Anything vague → soft no, very dangerous

---

### Close (3 min) — The ask
> "This was helpful. Based on what you said, here's what I'd want to do: I want to spend the next 6 weeks getting one real allocator from my existing network onto the platform end-to-end and recording a short video of their experience. Then I want to come back to you in week 8 with that video as the centerpiece of the demo, plus a draft term sheet for us to discuss. Does that sound like the right next step, or is there something you'd want to see first?"

**Listen for:**
- "Yes, that's exactly right" → PROCEED with the plan
- "Yes but I'd also need X" → PROCEED with the plan + add X to the deliverables
- "Honestly I think you should focus on Y first" → PIVOT: reshape the plan around Y
- "Come back when you have signed LPs" → REWRITE: stop building, do LP outbound for 8 weeks

---

## Post-call (60 min) — The writeup

Open `partner-qualification-notes.md` and fill in every section. Be brutally honest about what the partner said vs what you wanted them to say. The notes are for your own decision-making, not for the partner — this is the one document where you tell yourself the truth.

---

## Plan review (30 min) — The decision

After the writeup, walk through the plan's §5 sprint table and ask yourself:
- Does Pre-Sprint 0's outcome change Sprint 1's gate? (Probably not.)
- Does it change Sprint 6's testimonial target? (Maybe — if the partner asked for 3 testimonials, plan accordingly.)
- Does it change Sprint 8's demo content? (Probably yes — bake in the partner's specific criteria.)
- Does it change the 8-week timeline? (Be honest with yourself.)

Then either:
- **PROCEED:** Mark Pre-Sprint 0 complete in TODOS.md. Move to Sprint 1 T1.0 (fix send-intro email dispatch — the highest-priority eng task).
- **PIVOT:** Edit `/Users/helios-mammut/.claude/plans/rosy-cuddling-teacup.md` directly to reshape Sprints 1-8 around the partner's actual criteria. Re-run /autoplan if the changes are large.
- **REWRITE:** Stop. Start a new plan around LP outbound. The 8-week build can wait until you have 2-3 signed LPs.

---

## Voice notes from the autoplan review

The 4-voice review converged on this exact call as the most leveraged act in the entire 8-week plan. Direct quote from the Codex CEO voice:

> The fatal assumption is that the partner will accept "before/after founder speedup + existing allocator base + eval dashboard hit rate" as sufficient proof if real LP traction is absent. If that is wrong, the demo dies.

And from the Claude CEO voice:

> The single highest-leverage recommendation: before any work on this plan begins, the founder spends 2 hours doing ONE thing — qualifying the cap-intro partner. If the founder gets clean answers, the plan should be rewritten around those answers, not around a hypothetical 10/10 demo.

This call is that 2 hours. Do it well, and the next 8 weeks are sharpened or saved.
