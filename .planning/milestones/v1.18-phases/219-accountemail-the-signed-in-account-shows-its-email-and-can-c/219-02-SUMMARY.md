---
phase: 219-accountemail-the-signed-in-account-shows-its-email-and-can-c
plan: 02
subsystem: auth-ui
tags: [account-tab, email-change, supabase-auth, updateUser, profile]
requires: []
provides:
  - "AccountEmailSection client component (email, pendingEmail) on the profile Account tab"
  - "ProfileTabs accountEmail and pendingEmail props (default null)"
  - "callback route pin: encoded next=/profile?tab=account survives safeNextPath on both branches"
affects:
  - src/components/auth/ProfileTabs.tsx
  - src/app/(dashboard)/profile/page.tsx
tech-stack:
  added: []
  patterns:
    - "browser Supabase client created inside the submit handler, never at render"
    - "focus targets found by data attribute because Button declares no ref"
key-files:
  created:
    - src/components/auth/AccountEmailSection.tsx
    - src/components/auth/AccountEmailSection.test.tsx
  modified:
    - src/components/auth/ProfileTabs.tsx
    - src/components/auth/ProfileTabs.test.tsx
    - src/app/(dashboard)/profile/page.tsx
    - src/app/auth/callback/route.test.ts
decisions:
  - "UI state is closed | editing | submitting; the pending state is derived (closed with a pending address), so a reload with new_email set lands in it with no extra state"
  - "Keep current email closes to the pending panel and refocuses Use a different email whenever a pending address is shown, so no separate 'opened from pending' flag is kept"
status: complete
completed: 2026-11-19
plan_base: befe706f0efb0d8b1cd017312cbb3e6153006504
commits: 2
plan_head_before: befe706f0efb0d8b1cd017312cbb3e6153006504
plan_head_after: 77a28beacf7e96725abb7531e972e96eb57a8992
actuals:
  tokens: 6500
  tasks: 2
  commits: 2
---

# Phase 219 Plan 02: Account tab sign-in email Summary

The Account tab of /profile now shows the server-read `auth.getUser()` email and changes it through `supabase.auth.updateUser` with an encoded `/auth/callback?next=/profile?tab=account` redirect, covering every UI-SPEC state, error fallback and focus rule.

PLAN_BASE (recorded before the first edit): `befe706f0efb0d8b1cd017312cbb3e6153006504`.

## What was built

- `AccountEmailSection` (client component): heading, helper, `data-testid="account-email"` value line, `Change email` button, change form, pending panel (`role="status"`), `Use a different email` ghost button outside the live region.
- `ProfileTabs`: optional `accountEmail` / `pendingEmail` props; account panel is `max-w-xl space-y-8` with the email section first and the deletion block under `border-t border-border pt-8`.
- `profile/page.tsx`: passes `user.email ?? null` and `user.new_email ?? null` from the `getUser()` result it already held. `profile.email` is never read for display.
- `route.test.ts`: two D-04 cases (PKCE `code` branch and `token_hash` + `type=email_change` branch) assert the full Location `http://localhost:3000/profile?tab=account`. `route.ts` is untouched.

## Tasks and commits

| Task | Name | Commit |
|------|------|--------|
| 1 (tracer) | server email -> Account tab -> updateUser with encoded redirect -> callback pin | efa8791a2 |
| 2 | every UI-SPEC state, same-address guard, error fallbacks, pending on reload, focus contract | 77a28beac |

Tracer gate: the Task 1 verify (three vitest files + `npm run typecheck`) was run end to end on the proven slice before Task 2 expanded it, and passed.

## Verification

- `npx vitest run src/components/auth/AccountEmailSection.test.tsx src/components/auth/ProfileTabs.test.tsx src/app/auth/callback/route.test.ts`: 3 files, 52 tests passed.
- `npm run typecheck`: no output, exit 0 (no TS2322; no ref on Button).
- `npm run lint`: 0 errors. 4 warnings, all in files this plan did not touch (`src/lib/factsheet/composite-read-path.ts`, `src/lib/queries.stale-analytics-detail.test.ts`); logged, not fixed.
- Acceptance greps: `AccountEmailSection email={accountEmail}` = 1; `new_email` in page.tsx = 1; non-comment `profile.email` in the two components = 0; `encodeURIComponent("/profile?tab=account")` = 1; `font-medium` = 0; `leading-` = 0; all 11 exact UI-SPEC strings present once each.
- `git diff --name-only befe706f0 -- src/app/auth/callback/route.ts src/components/layout src/components/ui/Button.tsx` prints nothing (D-03, D-11, Button untouched).

## Neutering checks (Rule 9: user-facing gates must be able to fail)

1. Redirect target. Byte backup (`cp -p`) to the scratchpad, changed `encodeURIComponent("/profile?tab=account")` to `encodeURIComponent("/profile")`:
   - RED line: `× calls updateUser once with the trimmed address and the encoded callback redirect` with `- "emailRedirectTo": ".../auth/callback?next=%2Fprofile%3Ftab%3Daccount"` vs `+ "emailRedirectTo": ".../auth/callback?next=%2Fprofile"` (`Tests 1 failed | 14 passed (15)`).
   - Restored with `cp -p`; `cmp` exit 0; re-run green (52 passed).
2. D-02 (profile.email never displayed). Byte backup of `ProfileTabs.tsx`, inserted `<p>{profile.email}</p>` after the section:
   - RED line: `× D-02: shows the auth email and never the derived profiles.email` (`Tests 1 failed | 20 passed (21)`).
   - Restored with `cp -p`; `cmp` exit 0; re-run green (21 passed).

## Deviations from Plan

None to scope. Judgment calls inside the plan:

- **TDD commits:** each task is one commit holding its tests and implementation. RED was observed by running the tests before the code existed (Task 1: `Failed to resolve import "./AccountEmailSection"`; Task 2: 10 failing tests), but no separate failing-test commit was made, because the plan asks for one commit per task and a RED-only commit would fail typecheck.
- **Task 1 component was restructured in Task 2:** Task 1 used a four-value `idle | editing | submitting | pending` enum; Task 2 replaced it with `closed | editing | submitting` plus a derived pending state. Same behaviour, less state.
- **Small additions beyond the listed behaviours** (all inside the UI-SPEC contract): the typed value is cleared after a successful send so `Use a different email` does not reopen prefilled with the old address; after a failed send focus returns to the input, because disabling it during `Sending link...` drops focus.
- **Commit ledger:** the first attempt to write `gsd-plan-head-before-219-02` was refused by the shell wrapper and written in a later call; its value is the PLAN_BASE above, which is also the measured base for `commits: 2`.
- **Disk-full event:** during `npm run lint` the volume holding `/tmp/claude-501` filled (ENOSPC), the first lint run failed on its cache write, and a following command was refused. Space reappeared (123 MiB free), lint was re-run in full and passed. Nothing was deleted by this agent. The user should know the disk is at 100%.

## Not verified here (routed to UAT per the plan)

- The 254-character wrap at 375px (only the `break-all` class is asserted).
- Double-confirm first-click landing and whether the Supabase redirect allow-list accepts a URL with a query string (RESEARCH A2, A3): TEST UAT after merge, D-12.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema surface; T-219-08 is mitigated by the two route tests, T-219-10 by the D-02 ProfileTabs test (shown RED under neutering).

## Self-Check: PASSED

- FOUND: src/components/auth/AccountEmailSection.tsx
- FOUND: src/components/auth/AccountEmailSection.test.tsx
- FOUND: efa8791a2 (ancestor of HEAD)
- FOUND: 77a28beac (ancestor of HEAD)
