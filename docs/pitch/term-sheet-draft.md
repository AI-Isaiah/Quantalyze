# Term Sheet Draft — Quantalyze x Capital Intro Partner

**Status:** DRAFT. For discussion, not binding. Revised after first partner
conversation.

**Date drafted:** 2026-04-08
**Plan reference:** `~/.claude/plans/rosy-cuddling-teacup.md` §4 P-4

---

## 1. Parties

- **Quantalyze** — the verified strategy marketplace + analytics platform.
  Legal vehicle: [to confirm].
- **Partner** — capital introduction firm introducing allocator capital to
  managers surfaced via Quantalyze.

## 2. What the partner brings

- LP network and allocator relationships.
- Compliance shell (KYC/AML on allocators, reference checks).
- Last-mile meeting orchestration (calendar, call logistics, follow-up).
- Brand trust the platform does not yet have on its own.

## 3. What Quantalyze brings

- Verified strategy data: exchange-API-connected analytics, refreshed daily,
  with freshness + percentile + disclosure-tier disclosures baked in.
- Matching engine: rule-based scorer over allocator mandate ↔ strategy fit,
  powered by both the verified data and the founder's ground-truth from the
  Match Queue.
- Production surfaces: `/discovery` institutional lane, tear sheets (HTML +
  PDF), `/recommendations` (allocator view), admin Match Queue (founder view).
- Compliance shell: accredited investor gate, custody disclosures, legal
  pages, GDPR-aware account deletion intake.

## 4. Commercial structure

### Revenue share (PROPOSED)

**X% of first-year management + performance fees** on successfully matched
allocations, paid by the manager, split between Quantalyze and Partner.

**Default split:** 50/50. Adjustable based on who owned the relationship
before introduction (see §5).

**Calculation basis:**
- First-year management fee = target AUM × manager's annual management fee %
- First-year performance fee = a reasonable expectation of Year-1 performance
  × target AUM × manager's performance fee % (e.g., 10% expected return ×
  20% perf fee × AUM)
- Actual fees received are reconciled quarterly against the expectation.

### NOT subscription

Explicitly not a monthly SaaS fee for the partner or the allocator. The
allocator pays nothing for Quantalyze itself — the value is captured on the
manager side, where the fee flow originates.

## 5. Attribution rules

An allocation counts as a Quantalyze-originated introduction if ALL hold:

1. The allocator signed up on Quantalyze before the first introduction.
2. The strategy was surfaced to the allocator via the Quantalyze Match Queue
   (admin-side) or `/recommendations` (self-serve).
3. The allocation was committed within 180 days of the first Quantalyze
   introduction email between allocator and manager.

If any of these fail, the allocation is excluded from the revenue share.

**Conflict resolution:** if Partner already has an independent relationship
with the allocator OR the manager before the introduction, the relationship
goes to Partner and the split flips to 25/75 (Quantalyze/Partner). Partner
discloses existing relationships at the start of each engagement period.

## 6. Exclusivity

**NONE in v1.** Quantalyze retains the right to work with other capital
introduction firms and direct allocators.

After 12 months of partnership with a clear hit rate track record (see §9),
exclusivity in specific strategy categories (e.g., "Long/Short Crypto SMA")
can be negotiated separately.

## 7. Payment timing

Revenue share is paid quarterly, 45 days after the end of each calendar
quarter, against the fees actually collected by the manager in that quarter.

The manager signs a side-letter with Quantalyze during onboarding
acknowledging the fee split. Partner is copied.

## 8. Termination

Either party may terminate the partnership with 30 days' written notice.
Revenue share on introductions made BEFORE termination continues for 36
months from the date of each introduction.

No non-compete on termination.

## 9. Key metrics (for §6 exclusivity trigger)

**Both parties track these quarterly:**

- **Hit rate** — % of introductions that convert to committed allocations.
  Target: >= 20% by end of Year 1.
- **Time to first allocation** — days from first introduction email to
  signed subscription documents. Target: <= 60 days.
- **Allocator satisfaction** — 90-second video testimonial or written
  equivalent from at least one allocator per quarter.
- **Manager satisfaction** — quarterly check-in with each onboarded manager.
- **Average deal size** — weighted by the fee basis.

## 10. Open questions (for the partner conversation)

1. Partner's typical deal structure with other platforms — reference to
   calibrate the proposed split.
2. Partner's LP concentration — how diversified is the allocator network?
3. Minimum allocation size the partner is willing to broker.
4. Does the partner typically hold allocator capital in escrow, or is this
   a pure introduction service? (Affects custody disclosure language.)
5. Timeline for first pilot introduction — how quickly can we put one live
   allocator in front of one live Quantalyze-sourced strategy?

---

## How to use this document

1. Print this page. Bring it to the partner meeting physically.
2. Walk through sections 1-9 with the partner at the table.
3. Capture their reactions on section 10's open questions in the meeting
   notes (`docs/pitch/post-meeting-notes.md`, created after the call).
4. Iterate the draft over email in the week following the meeting.
5. DO NOT sign anything at the first meeting — Claude CEO voice was
   explicit about this. The term sheet is an anchor for the conversation,
   not a close.

## Redlines expected

Partners always redline:
- The split %age. Common counter: 40/60 Partner/Quantalyze.
- The 180-day attribution window. Common counter: 90 days.
- Exclusivity demands in §6. Hold firm until Year 1 metrics justify.
- §8 termination period. Common counter: 60 or 90 days.

Quantalyze's non-negotiables:
- §4 "not subscription" — the business model is fee-share, not rent-seeking.
- §5 attribution transparency — Quantalyze's data is the evidence base.
- §6 no exclusivity in v1 — the platform needs to serve multiple partners
  to reach scale.
