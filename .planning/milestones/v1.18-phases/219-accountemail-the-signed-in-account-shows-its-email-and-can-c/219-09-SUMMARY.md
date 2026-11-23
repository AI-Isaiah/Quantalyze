---
phase: 219-accountemail-the-signed-in-account-shows-its-email-and-can-c
plan: 09
subsystem: auth
tags: [reset-password, reauthentication, nonce, gap-closure, client-component]
status: complete

requires:
  - phase: 219 plan 07
    provides: the `Set a password` link to /reset-password that a signed-in user with an old session follows
provides:
  - ResetPasswordForm reauthentication branch keyed on error.code (GD-07)
  - UI-SPEC copy contract for the /reset-password reauthentication strings
affects: [GD-06b post-deploy UAT]

key-files:
  modified:
    - src/components/auth/ResetPasswordForm.tsx
    - src/components/auth/ResetPasswordForm.test.tsx
    - .planning/phases/219-accountemail-the-signed-in-account-shows-its-email-and-can-c/219-UI-SPEC.md

decisions:
  - "The /session/i no-session panel is skipped only for errors whose code starts with `reauth`; an uncoded session error still shows the panel in both steps."
  - "A reauthenticate() send error in the password step is shown on the existing error line and the user's next submit retries the whole step."

requirements: [GD-07]
commits: 2
plan_head_before: d159c593d08f05b8840ce6cff520a32458807ec3
plan_head_after: c0390c59a0221c39ee4339bbacbc20bcc8a8f99b
actuals:
  tasks: 2
  commits: 2
---

# Phase 219 Plan 09: GD-07 reauthentication on /reset-password Summary

**/reset-password now handles `reauthentication_needed` (matched by `error.code`): it sends one emailed code via `reauthenticate()`, shows a code input, and retries `updateUser({ password, nonce })`; the recovery-link path is untouched.**

## What was built

- Task 1 (tracer, commit 5281d1558): step/code/notice state, the `reauthentication_needed` branch before the `/session/i` test, the nonce retry with the trimmed code, the code input (`name="reauth_code"`, `one-time-code`, `inputMode="numeric"`, no maxLength or pattern) and the CODE_SENT status line.
- Task 2 (commit c0390c59a): `reauthentication_not_valid` shows CODE_INVALID; any other code-step error shows its message (CODE_INVALID when blank); every failed retry empties the code and keeps the passwords; `Send a new code` (secondary Button, disabled while loading or resending) is the only send after the first automatic one; a failed first send shows the message or CODE_SEND_FAILED and the next submit retries the whole step; UI-SPEC gained the dated GD-07 line, the copy table and the Interaction bullet.

## Test evidence

RED before Task 1 (current form): `Tests 2 failed | 4 passed (6)` with R1 and R2 failing. R4 PASSED on the pre-change form: it is a **characterization test** (green before and after by design), not a skipped RED step. R3 is the success test's added assertions (no reauthenticate call, no `reauth_code` input), also green before and after.

RED before Task 2 (Task 1 form): `Tests 5 failed | 8 passed (13)` with R5, R6, R7, R8 and R8b failing. R9 (no console call exists) and R10 (the `/session/i` branch already runs in the code step) passed and are **regression guards**.

GREEN: `ResetPasswordForm.test.tsx` 13/13; with `no-email-in-copy.test.ts` 59/59.

Neuter proofs (backups under the session scratchpad, restored with `cp -p`):
- R1: changed the compared code literal to `reauthentication_neededX` -> R1 and R2 RED (`2 failed | 4 passed`); restore `cmp` exit 0; re-run green.
- R5: replaced a line in the code-step error branch with `setStep("password")` -> R5 and R7 RED (`2 failed | 11 passed`); restore `cmp` exit 0; re-run green.

## Gates

- `npx tsc --noEmit`: no output, clean.
- `npm run lint`: exit 0 (0 errors, 4 pre-existing warnings, none in ResetPasswordForm files).
- Greps: R1/R2/R4 titles 3; R5-R10 titles 6 (plus R8b); `reauthentication_needed` in code 1; `nonce` and `one-time-code` in code present; `reauthentication_not_valid` 1; `Send a new code` in code 2 (JSX only counts non-comment lines); `font-medium` in the form exactly 1 (the pre-existing `Request a new link`); `console` 0; `GD-07` in UI-SPEC 3; `Code from your email` in UI-SPEC 1.

## Deviations from Plan

None - plan executed exactly as written. One addition inside the plan's rules: R8b is a separate test for the blank-message CODE_SEND_FAILED case the R8 behavior text lists, so the R8 title grep still matches.

## Not verified (routed, not skipped)

Post-deploy UAT after the coordinator turns Secure password change ON (GD-06b): with a session older than 24 h, follow the Account tab's `Set a password` link, submit, enter the emailed code, land on `/login?reset=1`; record the message for a wrong code and which error GoTrue returns for an EXPIRED code (not provable from node_modules); confirm a fresh recovery link still sets a password with no code prompt. No Supabase setting was read or changed; nothing touched TEST or PROD.

## Known Stubs

None.

## Threat Flags

None. T-219-34 (R9), T-219-35 (R7 asserts no re-send; only the first refusal sends automatically) and T-219-36 (no un-nonced fallback after a failed nonce, R5/R7) are covered as planned.

## Self-Check: PASSED

Files found: ResetPasswordForm.tsx, ResetPasswordForm.test.tsx, 219-UI-SPEC.md. Commits 5281d1558 and c0390c59a are ancestors of HEAD.
