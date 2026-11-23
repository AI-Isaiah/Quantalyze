---
phase: 219-accountemail-the-signed-in-account-shows-its-email-and-can-c
plan: 07
subsystem: auth
tags: [account-tab, change-email, password-gate, gap-closure, client-component]
status: complete

requires:
  - phase: 219 plan 06
    provides: POST /api/account/email wire contract (200, 400 same_address / wrong_password / update_failed, 409 password_not_set, 502 verify_unavailable, 429)
  - phase: 219 plan 05
    provides: /auth/callback lands on /profile?tab=account with email_change=confirmed or partial
provides:
  - "AccountEmailSection posts { email, password } to /api/account/email and maps every wire-contract answer to a message"
  - "Current password field, set-a-password link to /reset-password, single-link pending copy, done note gated on Auth"
  - "ProfileTabs passes emailChangeConfirmed from email_change=confirmed"
  - "219-UI-SPEC.md Copywriting Contract, Interaction contract and States revised for GD-01, GD-04, GD-05a"
affects: [219 verification re-run, manual UAT routed to the founder (D-12)]

plan_head_before: 1d3ca1d10291ad5038b9ac5dfc8088cdf288bec7
plan_head_after: 89515a7d0055821f9eef0e970077ab869911a6a3

actuals:
  tokens: 11000
  tasks: 2
  commits: 2

key-files:
  modified:
    - src/components/auth/AccountEmailSection.tsx
    - src/components/auth/AccountEmailSection.test.tsx
    - src/components/auth/ProfileTabs.tsx
    - src/components/auth/ProfileTabs.test.tsx
    - .planning/phases/219-accountemail-the-signed-in-account-shows-its-email-and-can-c/219-UI-SPEC.md

key-decisions:
  - "A 200 counts as success only with a body of { ok: true }; a 200 with a non-JSON or malformed body falls to the fallback line rather than claiming a link was sent"
  - "Branching is on the body code (wrong_password, password_not_set, verify_unavailable, update_failed, same_address); 429 is keyed on status because the rate-limit body has no code"
  - "password_not_set puts focus on the New email input, wrong_password on the password field"
  - "The Set a password link uses font-semibold (weight 600) rather than ResetPasswordForm's font-medium, because the UI-SPEC bans new 500-weight markup"

requirements-completed: [GD-01, GD-04, GD-05a]

duration: 20min
completed: 2026-11-20
---

# Phase 219 Plan 07: the change-email form sends address and current password to the route Summary

The Account tab's change-email form now asks for the current password, POSTs `{ email, password }` to `/api/account/email` instead of calling Auth from the browser, shows one single-link pending state, tells a password-less account to set a password first, and shows `Your sign-in email is now {email}.` only when the URL marker is present and no pending address is shown.

## What changed

- `AccountEmailSection.tsx`: removed the `@/lib/supabase/client` import and the `updateUser` call. Added a `password` state and a second `Input` (`Current password`, type password, `name="current_password"`, `autoComplete="current-password"`, required, disabled while submitting, own ref; a `password` focus target). `handleSubmit` keeps the same-address guard, then `fetch`es the route and branches per the wire contract. The password state is cleared after every answer and on a thrown fetch. `password_not_set` renders a `role="alert"` line with `SET_PASSWORD_FIRST` and a next/link `Set a password` to `/reset-password`. The body is parsed defensively. The pending panel is `We sent a confirmation link to {new}. You still sign in with {email} until you open it.` (second sentence omitted when email is null). New optional prop `emailChangeConfirmed` renders `<p role="status" data-testid="account-email-confirmed">` only when `emailChangeConfirmed && !shownPending && email` and the form is closed. FIRST_LINK_ACCEPTED and its condition are unchanged.
- `ProfileTabs.tsx`: one added prop, `emailChangeConfirmed={searchParams.get("email_change") === "confirmed"}`.
- Tests: `AccountEmailSection.test.tsx` rewritten to the fetch contract (no `@/lib/supabase/client` mock; `vi.stubGlobal` fetch with `vi.unstubAllGlobals` in afterEach). T1 to T12 present, every previous state test kept in fetch form (loading/disabled, kept value, blank fallback, network error, focus, autoconfirm null, partial, MD-01, SF-01, long-text), plus a row per wire-contract answer (429, verify_unavailable, update_failed, same_address, 401, 403, 503, 400 without code, non-JSON). `ProfileTabs.test.tsx` gained T13 and two neighbours (marker with a pending address, partial marker).
- `219-UI-SPEC.md`: dated revision line; Copywriting Contract (PENDING replaced; rows for Current password, FIRST_LINK_ACCEPTED, CONFIRMED, SET_PASSWORD_FIRST, TOO_MANY and the four server-supplied strings; the "true under either setting" paragraph replaced by the single-link statement); Interaction contract (updateUser bullet replaced by the POST and the wire-contract mapping, confirmed-note rule); States rows `wrong-password`, `password-not-set`, `confirmed`; Component Inventory swapped `createClient` for the password `Input` and `Link`. All other sections untouched.

## Evidence (tests can fail)

Task 1 RED, on the pre-change component (the test file rewritten first):

```
Test Files  1 failed (1)
     Tests  22 failed | 9 passed (31)
  (T1, T2, T3, T4, T5, T6 and every submit-driven state test fail: no "Current password" field exists)
```

Task 1 GREEN: `Tests  31 passed (31)`.

Task 1 neuter, backup `AccountEmailSection.t3.bak` in the scratchpad. The `wrong_password` branch condition was changed to an unreachable code, so a wrong-password answer falls to the generic fallback line (it does not fall through to the success path as the plan sketched, because success is gated on `status 200 && ok === true`; the effect is the same, the message and the focus are lost):

```
× T3: a wrong password shows the server text in role=alert, keeps the address, empties and focuses the password field, shows no pending panel
Test Files  1 failed (1)
     Tests  1 failed | 30 passed (31)
```

Restore `cp -p`, `cmp` exit 0, re-run `31 passed (31)`.

Task 2 RED:

```
× T9: the marker with nothing pending shows the done note naming the server-read email
× T11: a stale marker is overtaken by a successful resubmit, which names the new pending address
× T7: the pending panel is the single-link sentence and never asks to confirm at the current address
× GD-04: ?email_change=confirmed with nothing pending shows the done note   (T13)
Tests  4 failed | 60 passed (64)
```

Task 2 GREEN: the two component/ProfileTabs files plus `no-email-in-copy.test.ts`, `Tests  110 passed (110)`.

Task 2 neuter, backup `AccountEmailSection.t10.bak` (the done note's `!shownPending` gate removed):

```
× GD-04: ?email_change=confirmed with a pending address shows the pending panel and no done note
× T10: the marker with a pending address shows the pending panel and NOT the done note
× T11: a stale marker is overtaken by a successful resubmit, which names the new pending address
Tests  3 failed | 61 passed (64)
```

Restore `cp -p`, `cmp` exit 0, re-run `110 passed (110)`.

## Gates run (all in this worktree)

- `npx vitest run src/components/auth/AccountEmailSection.test.tsx src/components/auth/ProfileTabs.test.tsx src/__tests__/no-email-in-copy.test.ts`: 3 files, 110 passed.
- `npx tsc --noEmit`: exit 0.
- `npm run lint`: exit 0, 0 errors, 4 warnings, all pre-existing in files this plan did not touch (`src/lib/factsheet/composite-read-path.ts`, `src/lib/queries.stale-analytics-detail.test.ts`, and two others). The planning-hygiene checks inside it pass.
- Acceptance greps over non-comment lines of `AccountEmailSection.tsx`: `createClient` 0, `/api/account/email` 1, `current-password` 1, `confirm that one too` 0, `Your sign-in email is now` 1. `grep -ac emailChangeConfirmed` on `ProfileTabs.tsx`: 1. `grep -ac 'Current password'` on the UI-SPEC: more than 1.
- `git diff --name-only 1d3ca1d10291ad5038b9ac5dfc8088cdf288bec7..HEAD` lists only the five files of this plan: nothing under `src/components/layout/`, no change to `src/app/(dashboard)/profile/page.tsx`. STATE.md and ROADMAP.md untouched.

## Deviations from Plan

None in scope. Two small notes: (1) the T3 neuter lands on the fallback line, not the success path, as explained above; (2) the plan's verify greps for T1 to T6 pass, but T1, T2, T5 and T6 also failed pre-change (22 failures, more than the T1, T3, T4 the plan expected) because the whole submit path needs the password field.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register. T-219-29 (password lingering) is covered by the clearing after every answer and asserted in T3, T4, the 429/server-code/fallback rows and the thrown-fetch row (field empty). T-219-30 (crafted marker) by T10 and T11. T-219-31 by every non-200 answer showing a message and the pending panel appearing only on a 200.

## Hand-off

- Manual UAT after merge is routed to the founder (D-12), as listed in the plan's `<verification>`: right and wrong password on TEST, the partial note then the confirmed note while Secure email change is ON, one link landing on the confirmed note after it is turned OFF, a password-less (partner-import) account reaching `/reset-password` signed in, and confirming the PKCE token exchange succeeded in the auth logs. Nothing in this plan touched a Supabase or TEST/PROD setting.
- The `UI Considerations` rows and the markup sketch in the UI-SPEC still say `updateUser` in two places (loading, error); the plan told this task to leave every other section unchanged, so they were left as written.

## Self-Check: PASSED

- FOUND: src/components/auth/AccountEmailSection.tsx, AccountEmailSection.test.tsx, ProfileTabs.tsx, ProfileTabs.test.tsx, 219-UI-SPEC.md
- FOUND commits: afd33a3f1 (Task 1), 89515a7d0 (Task 2), both ancestors of HEAD
