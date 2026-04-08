# Cap-Intro Friend Meeting Script

**Duration:** 30-45 minutes (10 min demo, 20-30 min qualification + co-design).
**Audience:** a capital-introduction friend who runs their own firm.
**Goal:** NOT to close a partnership. The goal is to walk out with (a) honest feedback on what they actually need, (b) 3 named allocator intros they'll forward to you, and (c) agreement on a 30-min follow-up with one of those allocators in the room.
**Prerequisite checklist:** run `docs/demos/pre-flight-checklist.md` one hour before the meeting.

---

## Framing — the premise shift

This meeting is NOT a pitch to a closing gate. The friend is a potential **distribution channel**, not a prospect. Your job is not to convince — it's to collaborate. You're asking them to help you design the thing they'd actually use.

If you leave with a signed term sheet but no named allocator intros, you "won" the meeting and lost the pilot. If you leave with 3 named allocator intros and zero paperwork, you won the pilot and the partnership will follow on its own time.

**Mindset:** qualification over persuasion. Let them drive.

---

## 0:00-3:00 Opening (pick one)

### Option A — the warm observation
> "Before I walk you through anything, I want to tell you why I'm building this. [Sentence about the specific pain you watched an allocator go through that you can't unsee.] I'm going to show you 10 minutes of working product, then I want to spend the rest of our time asking you 6 questions. The questions are the point. The product is the context."

### Option B — the honest ask
> "I'm going to show you a working product for 10 minutes, then ask you 6 questions. I'm not selling you anything today. I'm trying to figure out if this is a product you'd actually want to distribute, and if the answer is no I'd rather know in 30 minutes than 3 months."

### Option C — the co-design invitation
> "Your firm has more context on what allocators actually need than I'll have in 6 months of building. I'm not here to pitch. I'm here to show you what I have, get your honest take on what's missing, and see if we can design something together that makes your workflow 10x faster. I have 6 questions prepared that are more important to me than the demo itself."

**Pick whichever matches your relationship with this friend.** If they're a skeptic, use B (disarms the pitch framing). If they're warm and bought-in, use C (makes them feel like a co-founder).

---

## 3:00-13:00 — The 10-minute demo

Follow `docs/demos/capintro-partner-script.md` for the click path. Hit these beats:

1. **Shareable URL already sent** (you Telegrammed it post-meeting yesterday OR 30 min after leaving; NOT before — pre-send is founder cosplay). Just reference it: "I sent you a link after our last exchange — you can forward it to your team, the data there is the same allocator state you're about to see."
2. **Testimonial video** (90 sec, play it, say nothing).
3. **Before/after metric** (30 min → 5 min per allocator, 6× speedup).
4. **Match Queue walkthrough** (keyboard shortcuts, Send Intro slide-out, "this is my workspace, every row is an allocator I'm tracking").
5. **Eval dashboard** (hit rate, "this is how I measure the algorithm against my ground truth").
6. **Institutional lane on Discovery** (real manager names, freshness badge, tear sheet).
7. **Term sheet on the table** (printed, referenced, NOT asked to sign).

Do NOT show:
- Partner ROI simulator unless they ask about unit economics
- Partner pilot CSV upload unless they ask "could I white-label this"
- Any of the Sprint 4-6 carry-over items

If they ask "what's your revenue model" → pull up `/admin/partner-roi`, type their allocator count, watch the number grow in real time.
If they ask "could you run this for my firm" → pull up `/admin/partner-import`, paste a made-up CSV, show them the filtered view appear in 60 seconds.

Keep your hands off the keyboard between the scripted beats. The temptation to wander into a cool subsystem is strong. Don't.

---

## 13:00-43:00 — The 6 qualification questions (the real meeting)

Keep a notebook open. Write verbatim. You will forget what they said within 48 hours without notes.

### Q1. What does your best week as a cap-intro look like?

Not "what do you do" — what does a **GREAT** week look like? Listen for:
- Number of intros shipped
- Who initiated (them, the allocator, the manager)
- How long each conversation took
- What was the allocator's biggest pain they solved

This surfaces their self-model of "winning" and tells you which of your features maps to their actual wins.

### Q2. If I built the perfect tool for your firm in 6 weeks, what does it do that nothing else does today?

This is the design-partnership question. It asks them to describe the product you should ship, in their own words. You're not asking what they want — you're asking what would make them a **customer they can't stop telling their peers about**.

Listen for:
- A capability (not a feature) they'd mention unprompted
- A frustration with an existing tool they'd name
- A workflow step they hate enough to pay to eliminate

If they say "I don't know" → ask the concrete version: "Walk me through the worst 30 minutes of your week. What were you doing? What would have made those 30 minutes take 30 seconds?"

### Q3. What's the gap in the cap-intro market right now that nobody is filling?

This is the market-ceiling question. The best answer they can give is one you couldn't have predicted from outside their firm — something that makes you reframe what Quantalyze is.

Listen for:
- A customer segment they see nobody serving
- A price point that's too expensive everywhere
- A workflow that's still manual at every competitor
- A trust gap (who do LPs actually believe?)

If they describe a gap that matches what you're building — you have product-channel fit. If they describe a gap that's orthogonal — you have a pivot signal.

### Q4. What would make you walk away from this meeting saying "not interested"?

The disqualification question. Their answer tells you which of your assumptions you need to validate before you build anything else.

Listen for:
- Compliance objections (custody, KYC, accreditation)
- Trust objections (they don't know the algorithm, they can't audit your picks)
- Economic objections (the math doesn't work at their scale)
- Personal objections (they don't want to introduce managers they can't vouch for)

Don't argue. Write it down. If they answer with one or two reasons, you now have your validation roadmap for the next 2 weeks.

### Q5. What's your typical deal structure today, and what would need to change for a partnership to make sense?

The economics question. Now that you have the printed term sheet on the table, ask how their existing deal structures work. Revenue share, fee split, attribution windows, exclusivity, no-exclusivity.

Listen for:
- Numbers that contradict the 1.5% mgmt fee assumption in your simulator
- Attribution windows longer than your 180-day assumption
- Exclusivity expectations (your term sheet draft is non-exclusive; is that a problem?)
- Payout cadences (monthly, quarterly, on close)

**Do NOT commit to changes in the room.** If they suggest a different structure, write it down and say "that's interesting — I want to think through the second-order effects. Can I come back to you in 48 hours with a response document?"

### Q6. Can you credibly intro 3 specific allocators to a product like this in the next 30 days?

The closing question. This is NOT the "can you direct $10M of LP capital" question from the original script — that framing is closing-stage, and the friend will recoil from it. This is the **pilot-ask** question.

Listen for:
- Names (write them down verbatim)
- Relationships (how they know each other, what the current state of conversation is)
- Constraints (one is traveling, one is in diligence on something else, one just passed on a similar firm)

**If they say yes with 3 names:** you have your pilot. Confirm the next step: "I'd like to propose one 30-minute follow-up in 2 weeks with one of those allocators on the call. Which of the 3 would be the shortest path to a first meeting?"

**If they say yes but hedge on names:** ask "who would you think about first? Just a first name is fine." Get one name, build from there.

**If they say no:** ask "what would have to be different for you to say yes in 6 months?" Write it down. That's your roadmap.

---

## 43:00-45:00 — The close

**The ask:** "Thank you. One follow-up to propose: a pilot with ONE of those allocators. The allocator signs up on Quantalyze, clears the accredited gate, and completes one full end-to-end flow. If the pilot goes well, we take the term sheet conversation into a longer follow-up. If it doesn't, we both know quickly and nobody has wasted a quarter."

**The written commitment:**
> "I'll send you a 1-page pilot proposal in a Google Doc within 48 hours. It'll have the 3 names you gave me (or blanks if you gave me one), the proposed timeline, and the structure we just discussed. You reply 'yes' or send edits. No signatures today."

**The warmth close:**
> "This was the most useful meeting I've had in [time period]. Thank you for being honest about Q4 especially. I'm going to think through [the specific objection they raised] tonight and come back to you in 48 hours with either a fix or an honest 'we're not there yet' answer."

---

## Post-meeting (within 2 hours of leaving)

1. **Write `docs/pitch/post-meeting-notes.md`** — reactions, asks, concerns, 3 names, disqualifier, next steps. Do this BEFORE you forget the specifics. Target: 30 minutes of focused writing while the conversation is still in your head.
2. **Send a thank-you email within 4 hours.** Include:
   - The pilot proposal in writing (or a commitment to send it in 48 hours with a specific time)
   - The 3 allocator names you discussed (so they can't rewrite history)
   - The specific thing they said you'd think about
3. **Send the post-meeting `/demo` URL** on Telegram 30 minutes after leaving. "Great talking — here's that link I mentioned so you can share with your team. Same data we walked through today."
4. **Update `docs/pitch/objection-handling.md`** with any new objections that surprised you. Future-you will thank present-you.
5. **Slack the outcome to your advisor or accountability partner.** One-line summary. No soft-selling your own result to yourself.
6. **Write the 1-page pilot proposal Google Doc tonight.** Send it tomorrow morning before you lose the momentum. Title: "Quantalyze × [Friend's Firm] — 6-week pilot proposal". Sections: (1) what we build for you in 6 weeks, (2) what you do, (3) economics, (4) 3 allocators, (5) timeline.

---

## Hard rules during the meeting

- **Don't commit to changes in the room.** If you and the friend agree on something, that's a RECOMMENDATION, not a decision. The friend has context you don't about their LPs, their compliance, their internal dynamics. Write it down, sleep on it, respond in 48 hours.
- **Don't narrate the demo.** Let the video and the screens do the work. Silence is a tool.
- **Don't apologize for rough edges.** If something's ugly, point at it directly and say "I'm building this in weeks, not quarters, so some of these screens are scaffolded. The match engine and the send-intro workflow are what I trust."
- **Don't answer questions you don't know the answer to.** Say "I don't know — I'll figure it out and get back to you in 48 hours." Then actually do it.
- **Don't bring more than the printed term sheet and one-pager to the table.** No laptop open on their side, no tablets, no screens. Make them look at you for the qualification half.

---

## If things go wrong

- **Staging is down mid-demo:** pull up the pre-recorded 2-minute screen capture from your phone. Don't apologize for 5 minutes. "The Railway service is having a moment — here's the same flow I was about to walk you through."
- **The testimonial video won't play:** read the key quote aloud from the printed transcript in your notebook.
- **The friend is cold:** check if they opened with an objection from `docs/pitch/objection-handling.md` that you have a prepared answer for. If they're cold on the math, walk them through the one-pager's "Why now" section. If they're cold on the product, skip to Q4 (the disqualification question) early — get to honesty faster.
- **The friend wants to close NOW:** don't. "I appreciate the enthusiasm — let me bring the pilot proposal to you in writing within 48 hours so we can both be sure we're signing up for the same thing."
- **The friend brings a colleague you weren't expecting:** treat the colleague as the real decision-maker. Re-do the intro for them, ask Q1-Q2 to both of them, and default to the colleague's questions first.

---

## Success metric

You didn't win this meeting if you walked out with a signed term sheet and no allocator names. You won this meeting if you walked out with:

- [ ] 3 specific allocator names written down
- [ ] The specific disqualifier they'd hit if the pilot failed
- [ ] A concrete answer to Q2 (what would make them a customer they can't stop telling their peers about)
- [ ] A 30-min follow-up scheduled in 2 weeks (or a clear reason why not)
- [ ] One thing the friend said that surprised you and changed how you think about the product

Write these 5 in the post-meeting notes. If you can't fill all 5, the meeting wasn't a failure, but it wasn't the win either.
