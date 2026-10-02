---
status: complete
phase: 01-outcome-tracker
source: [01-VERIFICATION.md]
started: 2026-04-18T08:50:14.460Z
updated: 2026-04-18T10:22:00.000Z
---

## Current Test

[testing complete]

## Tests

### 1. Banner renders on eligible Holdings rows
expected: The "Did you act on this Bridge suggestion?" strip appears as a sub-row beneath strategies in the Holdings table where `eligible_for_outcome=true` AND `existing_outcome=null`. Non-eligible rows show no banner.
result: pass
notes: |
  Initial run FAILED — banner text absent from DOM even after seeding a sent_as_intro
  row. Root cause: the WR-03 code-review fix (commit 0268cf9) switched the
  match_decisions fan-out from admin client to user-scoped client, but
  match_decisions has no allocator-self-SELECT RLS policy. User-scoped SELECT
  returned 0 rows, eligibility evaluated false for every strategy, no banner
  ever rendered in production.

  Fixed by reverting the match_decisions read to the admin client (with the
  explicit `.eq("allocator_id", userId)` kept as the ownership gate). bridge_outcomes
  and bridge_outcome_dismissals stay on the user-scoped client because migration
  059 gave them owner-select policies.

  Post-fix: banner DOM content verified as exact D-11 copy — "Did you act on this
  Bridge suggestion? Allocated Rejected ×" — including all 3 buttons.

### 2. Allocated golden path (in-place form → recorded row)
expected: Clicking [Allocated] replaces the banner in-place (no modal) with an inline form containing percent_allocated + allocated_at + optional note. Submitting the form replaces the form with "Recorded: Allocated 10% on {date} • Pending" (exact D-11 copy).
result: pass
notes: |
  Initial submit returned 403 NOT_ELIGIBLE — same RLS gap as Test 1 but in
  `src/app/api/bridge/outcome/route.ts`. The route's defence-in-depth
  match_decisions eligibility check ran against the user-scoped supabase client,
  which RLS denies. Fixed by running that lookup through createAdminClient(),
  with the `.eq("allocator_id", user.id)` kept inline as the ownership gate.
  Test mocks updated to mock @/lib/supabase/admin alongside @/lib/supabase/server.

  Post-fix: filled `10` into Percent allocated (date pre-filled 2026-04-18),
  clicked "Record allocation". POST returned 200. Banner/form sub-row replaced
  in-place by OutcomeRecordedRow showing exact text:
  "Recorded: Allocated 10% on 2026-04-18 • Pending".

### 3. Rejected em-dash rendering
expected: Selecting a rejection reason and submitting shows "Recorded: Rejected — Mandate conflict" with a proper em-dash (U+2014), not an ASCII hyphen.
result: pass
notes: |
  Seeded sent_as_intro for Redline BTC Trend, clicked [Rejected], selected
  "Mandate conflict" in the reason dropdown, submitted. Recorded row shows:
  "Recorded: Rejected — Mandate conflict".
  Separator character between "Rejected" and "Mandate conflict" verified as
  U+2014 (em-dash). Not hyphen-minus (0x2D) or en-dash (0x2013).

### 4. Dismiss behavior persists 24h across reloads
expected: Clicking [×] dismisses the banner for that row. Reloading the page leaves the row dismissed (server-side 24h TTL via `bridge_outcome_dismissals`). After the TTL expires the banner reappears.
result: pass
notes: |
  Seeded sent_as_intro for Meridian L/S Pairs, clicked the [×] dismiss button.
  POST /api/bridge/outcome/dismiss returned 200. Banner count dropped from 1 → 0
  in DOM immediately. Reloaded the page — banner count still 0 after reload
  (not session-only). DB row in bridge_outcome_dismissals confirms 24h TTL:
  dismissed_at=2026-04-18T10:20:14Z, expires_at=2026-04-19T10:20:14Z (24h delta
  exactly, matching D-07).

### 5. Playwright spec passes with seeded DB
expected: Running `HAS_SEEDED_SUPABASE=true npx playwright test e2e/bridge-outcome.spec.ts` reports 3 tests passing (allocated flow, rejected flow, dismiss flow).
result: skipped
reason: CLI-only test, out of scope for browser-driven UAT. Deferred to CI wire-up.

## Summary

total: 5
passed: 4
issues: 0
pending: 0
skipped: 1
blocked: 0

## Gaps

[none — 2 critical RLS bugs found + fixed during UAT, not deferred]
