---
phase: 219-accountemail-the-signed-in-account-shows-its-email-and-can-c
verified: 2026-11-20T17:00:00Z
status: human_needed
score: 24/24 must-haves verified in code (20 original + 4 gap truths); live-service behavior is the human list
verified_at_sha: 2b45098080979e97337d76a2921fec6a8e2ef293
drift_subjects:
  - supabase/migrations/20261119120000_sync_profile_email_from_auth.sql
  - supabase/migrations/down/20261119120000-rollback.sql
  - supabase/tests/test_profiles_email_sync.sql
  - supabase/schema/functions/sync_profile_email_from_auth.sql
  - supabase/migrations/20261120120000_auth_user_has_password.sql
  - supabase/migrations/down/20261120120000-rollback.sql
  - supabase/tests/test_auth_user_has_password.sql
  - supabase/schema/functions/auth_user_has_password.sql
  - src/app/api/account/email/route.ts
  - src/app/api/account/email/route.test.ts
  - src/app/auth/callback/route.ts
  - src/app/auth/callback/route.test.ts
  - src/components/auth/AccountEmailSection.tsx
  - src/components/auth/AccountEmailSection.test.tsx
  - src/components/auth/ProfileTabs.tsx
  - src/components/auth/ResetPasswordForm.tsx
  - src/components/auth/ResetPasswordForm.test.tsx
  - src/app/(dashboard)/profile/page.tsx
  - scripts/mutation-floors.mjs
  - scripts/dump-sql-functions.ts
  - scripts/baseline-content-drift-check.mjs
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: "20/20 (4 gaps from the founder's live PROD test 2026-11-20)"
  gaps_closed:
    - "Password gate: the current password is verified server-side before any link is sent; wrong password sends nothing; password-less accounts are told to set a password first (GD-01, GD-02, GD-05a)"
    - "Single-link pending panel that still copes with Secure email change ON (GD-01, GD-04)"
    - "Late or failed final link lands on /profile?tab=account, done note comes from Auth only (GD-03, GD-04)"
    - "Reauthentication code path on /reset-password for Secure password change ON (GD-07)"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Password gate on TEST: sign in as a TEST user with a password, open /profile?tab=account, Change email with a WRONG current password, then with the RIGHT one."
    expected: "Wrong: inline 'That password is not right. Nothing was sent.' and NO mail arrives anywhere. Right: pending panel 'We sent a confirmation link to <new>' and a mail arrives. Auth logs show one PUT /user and one POST /token (password grant) from the server, none from the browser."
    why_human: "Needs real GoTrue, a mailbox and a browser; unit tests mock Supabase."
  - test: "Single link (GD-06b), only AFTER the coordinator flips 'Secure email change' OFF and 'Secure password change' ON post-deploy: change an email on TEST or PROD and watch both mailboxes."
    expected: "Exactly ONE mail, to the NEW address; no mail to the old address. Clicking it completes the change. Until the flip, the old two-link flow still runs and the first link lands on /profile?tab=account&email_change=partial with the 'confirmation was accepted' note."
    why_human: "Dashboard setting state and real mail delivery cannot be read from the repo (D-12: this phase changes no setting)."
  - test: "Late-click landing: request a change, wait longer than the PKCE flow-state expiry (about 10 minutes or more), then click the link while signed in as an admin."
    expected: "Lands on /profile?tab=account (NOT /login and NOT the admin dashboard). If Auth completed the change the tab says 'Your sign-in email is now <new>.' with <new> from getUser(); if it did not, the pending panel shows and no success line is shown."
    why_human: "Reproduces the 2026-11-20 PROD defect against real GoTrue timing; the route tests only prove the branch given a URL."
  - test: "Still signed in after an attempt: after a wrong-password attempt, a right-password attempt and a 429, reload /profile in the same browser."
    expected: "The browser session is unchanged (no sign-out, no new cookie swap). The server-side throwaway client used signOut scope local only."
    why_human: "Cookie and session behavior of the real hosted Auth, not observable in mocked tests."
  - test: "PKCE exchange success in auth logs: after a prompt click on the single link, read the Auth logs for that user (read-only, marker query first)."
    expected: "GET /verify 303 followed by POST /token grant_type=pkce returning 200, not 422 flow_state_expired. Records whether the verifier cookie set by the route handler's updateUser survives to the callback."
    why_human: "Proves the PKCE verifier cookie is still set when updateUser runs inside the route handler instead of the browser (review noted it by reading, not by measuring)."
  - test: "/reset-password reauthentication on TEST after 'Secure password change' is ON: sign in, wait until the session is older than 24 hours (or use an older session), open /reset-password, submit a new password."
    expected: "The form sends a code to the account email, shows 'Code from your email', and the code plus the same passwords sets the password; success lands on /profile?tab=account&password_set=1 with 'Your password is set.' A wrong or expired code shows 'That code is not right or has expired.' with a working 'Send a new code'. The recovery-link path (fresh session) never shows the code prompt."
    why_human: "Needs real GoTrue to emit reauthentication_needed, and a real mailbox for the nonce."
  - test: "Password-less 'Set a password' path: with an account created with NO password (partner-import style, email_confirm true), try Change email."
    expected: "The form shows 'This account has no password yet. Set a password first, then change your email.' with a 'Set a password' link (not the wrong-password line); the link opens /reset-password for this signed-in user, works (with the code step if the session is old), returns to the Account tab, and Change email then works."
    why_human: "Needs a real password-less auth user and the hosted function; unit tests mock the RPC."
  - test: "Expired-link landing: click the single link a second time, or a link older than the OTP expiry, while signed in."
    expected: "Lands on /profile?tab=account WITHOUT email_change=confirmed (GoTrue error redirect), showing Auth's real state, never a success claim and never the admin dashboard."
    why_human: "Needs real GoTrue error redirect parameters (error, error_code) for a pkce_ token."
  - test: "PROD Supabase Auth dashboard settings (read-only, change nothing): 'Confirm email', 'Secure email change', 'Secure password change', the Redirect URL allow-list and the 'Change email address' template (D-12)."
    expected: "The allow-list admits ${origin}/auth/callback?next=...; the template links back to /auth/callback; the values are recorded before and after the coordinator's post-deploy flip."
    why_human: "Dashboard settings are not code."
  - test: "TEST, after the email change completes: read profiles.email for the test user (count/compare only, marker query first)."
    expected: "profiles.email equals the new auth email, proving on_auth_user_email_updated fires under Auth's own role on a real GoTrue write and does not abort Auth's transaction."
    why_human: "GoTrue's own role cannot be impersonated in the pg-lane gate."
  - test: "Open /profile?tab=account at 375px width with a 254-character email, with the form open and with the pending panel."
    expected: "The address wraps with no horizontal scroll; the password field and the two buttons fit."
    why_human: "Visual layout."
  - test: "CI proofs on the PR head SHA (bound to the head SHA, expected check count): sql-tests local-stack boot replays 20261119120000 and 20261120120000 (baseline-replay line names both), FULL sql-mutation passes with the floors in scripts/mutation-floors.mjs, baseline-content-drift expected RED only for the two new function rows until the post-apply re-dump, and the migration rollback dry-run on TEST (LW-04 role ownership of auth.users) for 20261119120000."
    expected: "sql-tests and sql-mutation green; baseline-content-drift red only for the new-function rows (stale-baseline red counts as green per repo rule)."
    why_human: "Cannot be run in this verifier (no stack boot, no full mutation pass, no TEST/PROD access)."
---

# Phase 219: ACCOUNTEMAIL Verification Report (re-verification after gap closure)

**Phase Goal:** A signed-in user can see which email their account uses and change it. The account or settings page shows the signed-in email, and a change goes through Supabase Auth's own confirm-by-email flow, never a direct write.
**Verified:** 2026-11-20T17:00:00Z at `2b45098080979e97337d76a2921fec6a8e2ef293` (branch `gsd/phase-219-gap`)
**Status:** human_needed (every code-checkable truth verified; the remaining items need real GoTrue, a mailbox, a browser, or the post-deploy dashboard flip)
**Re-verification:** Yes, after gap closure. Previous status `gaps_found` with 4 gaps; all 4 closed in code, 0 regressions.

Decisions verified against: 219-CONTEXT `<gap_decisions>` GD-01 to GD-07 (GD-02 read with its dated CORRECTED note), GD-05a, GD-06a, GD-06b. Plans 219-04 to 219-09 and their SUMMARYs were read as claims, not evidence; everything below was checked in the code or re-run here.

## Gap closure (4 previous gaps, full 3-level check)

| # | Gap truth | Status | Evidence (verified in code and re-run) |
|---|-----------|--------|-------------------------------------------------------|
| 1 | Changing the email needs the CURRENT password, verified by Auth on the server before any link; wrong password sends nothing (GD-01, GD-02, GD-05a) | VERIFIED | `src/app/api/account/email/route.ts`: `withAuthLimited` consumes `userActionLimiter` keyed `email_change:${user.id}` after schema validation and BEFORE the handler; the handler runs `signInWithPassword` on a per-request `@supabase/supabase-js` client with `persistSession:false, autoRefreshToken:false, detectSessionInUrl:false`, no cookie adapter, then `signOut({scope:"local"})` on that throwaway client only. Every non-success path returns before `updateUser` (route.ts step 4); `updateUser` runs on the cookie-bound `@/lib/supabase/server` client with the same `emailRedirectTo`. Password is never in a log, response or thrown message (console calls log `code`/`status`/`message` of the error only). `AccountEmailSection.tsx` no longer imports any Supabase client; it POSTs `{email, password}` to the route and clears the password after every answer. Behavior-dependent, so tested: the route test file went RED when I neutered the gate in a byte backup (sign-in skipped, `invalidCredentials=false`): Tests 1, 2, 4, 5, 6, 7, 8, 14, 16 failed, then GREEN after `cmp`-verified restore. Test 2 asserts `updateUser` is not called on a wrong password. |
| 1b | Password-less accounts are told to set a password first (GD-05a) via a service_role-only SECURITY DEFINER has-password function in one migration; test RED without it | VERIFIED | Migration `20261120120000_auth_user_has_password.sql`: `public.auth_user_has_password(uuid)` LANGUAGE sql STABLE SECURITY DEFINER, `SET search_path = public, pg_catalog`, one `EXISTS` on `auth.users` with a non-empty `encrypted_password` (never NULL), `REVOKE ALL ... FROM PUBLIC, anon, authenticated`, `GRANT EXECUTE ... TO service_role`, no BEGIN/COMMIT, no data-reading DO block (`lint-migration-data-dependence`: 83 allowlisted, 0 NEW), rollback present in `down/`. The route calls it only after an `invalid_credentials` answer, with the id from the caller's own `getUser()`; a failing or non-boolean answer is a 502, never a "wrong password" lie. The UI shows the set-password message with a "Set a password" link to `/reset-password` (public, bounce-exempt for every signed-in role in `src/proxy.ts`). I ran the pg-lane gate: exit 0, closing notice naming arms 1 to 7b. Mutation runner on this file: 9 arms, `biting: 9`, `lane-invocations: 9`, every arm `RED (identity ok)`, `No defects in the narrowed scope`; tree clean afterwards. |
| 2 | Pending state is a single "confirm at <new address>" panel and still copes while Secure email change is ON (GD-01, GD-04) | VERIFIED | `AccountEmailSection.tsx` pending block: "We sent a confirmation link to <new>. You still sign in with <current> until you open it." plus the `email_change=partial` note (`FIRST_LINK_ACCEPTED`) kept for the rollout window; no checklist and no "both addresses" instruction. Component tests pass. |
| 3 | The final link lands on /profile?tab=account and says "Your sign-in email is now X", X read from auth.getUser() (GD-03, GD-04) | VERIFIED | `route.ts` emits `next=/profile?tab=account&email_change=confirmed`. `auth/callback/route.ts`: `carriesEmailChangeConfirmed` reads the already `safeNextPath`-filtered `safeNext` (never the raw param) for exactly `confirmed`; a failed `exchangeCodeForSession` with the marker redirects to `safeNext` (logging `error.code`/`status` only), any other failed exchange still goes to `/login`; a GoTrue `error`/`error_code` redirect with the marker lands on the Account tab with `email_change` deleted (never a success claim). The done note renders only when `!formOpen && !shownPending && emailChangeConfirmed && email`, where `email` and `pendingEmail` come from the server `auth.getUser()` (`profile/page.tsx`: `accountEmail={user.email}`, `pendingEmail={user.new_email}`); the marker alone never asserts success. Neutering `carriesEmailChangeConfirmed` to `false`: callback tests A, H, J, K, L went RED, GREEN after restore. Open-redirect guard unchanged (callback tests D/E/F pin top-level-param, off-site and wrong-value cases). |
| 4 | With Secure password change ON, a signed-in user with a session older than 24 h (including a password-less user) can still set a password on /reset-password (GD-07) | VERIFIED | `ResetPasswordForm.tsx`: on `updateError.code === "reauthentication_needed"` (matched on the error code, not message text) in the password step it calls `supabase.auth.reauthenticate()` once, shows the code input, and retries `updateUser({password, nonce: code.trim()})`; the code step never re-sends automatically and never falls back to an un-nonced call; "Send a new code" is the only resend; a session loss in the code step reaches the no-session panel; recovery-link path (`updateUser({password})`, fresh session) is unchanged. After success a signed-in user goes to `/profile?tab=account&password_set=1` and the tab shows "Your password is set." Neutering the reauth branch: R1, R2, R5, R6, R7, R8, R8b, R9, R10 went RED, GREEN after restore. |

All three byte-backed neuters were restored with `cmp` exit 0 and `git status` shows only the pre-existing uncommitted `.planning/STATE.md`.

## Original truths (regression check)

| # | Truth | Status | Note |
|---|-------|--------|------|
| G1 | The Account tab shows the signed-in email | VERIFIED | `profile/page.tsx` passes `user.email` from `auth.getUser()` to `ProfileTabs` then `AccountEmailSection` (`data-testid="account-email"`); tests pass. |
| G2 | A change goes through Supabase Auth's confirm-by-email flow, never a direct write | VERIFIED | The only write path is `supabase.auth.updateUser` in `route.ts` (server, cookie-bound client). No app code writes `auth.users` or `profiles.email`; the `REVOKE UPDATE (email)` migration still stands. The previous "exact updateUser args in the browser" check (2.8) now lives in the route test (marker `next`, trimmed address). |
| 1.1 to 1.9, 2.1 to 2.10, P1 to P4 | Trigger sync, sanitize exemption, no-EXECUTE fire, column revoke, UI states, focus handling, prohibitions | VERIFIED (regression) | The phase 219 original test files and the census files all pass at HEAD (below). The two prior migrations and the 10-arm gate are untouched by the gap work; the review recorded migration-reviewer and rls-policy-auditor CLEAN on `20261119120000`. P1 (no layout change) re-confirmed: `git diff 9ead080f0..HEAD --stat` shows no `src/components/layout/` file. P2 deviation (callback `route.ts` edited by MD-01) remains an accepted documented deviation. |

**Score:** 24/24 truths verified in code (20 original + 4 gap truths, gap 1b counted inside gap 1). `behavior_unverified: 0`: every behavior-dependent truth (gate before `updateUser`, marker landing on failed exchange, reauth nonce retry, has-password boolean and grants) has a passing behavioral test that I ran and neutered. The live-service behavior of those same paths is carried by the human list, not by presence.

## Prohibitions and security checks

| Check | Status | Evidence |
|-------|--------|----------|
| Password never logged, returned or placed in an error | VERIFIED | grep of `console.*` in the route finds only code/status/message of the error; route Test 13 spies every console method; client clears the password on every answer. |
| The has-password function cannot be probed by a client | VERIFIED | EXECUTE revoked from PUBLIC/anon/authenticated, granted to `service_role`; gate arms 6, 7a, 7b; id comes only from `getUser()`. |
| Callback cannot be an open redirect via the marker | VERIFIED | Predicate receives `safeNextPath`'s return value; tests D/E/F. |
| No dashboard or Auth setting changed (D-12) | VERIFIED | Diff touches no config; `supabase/config.toml` untouched. |
| Nothing applied to TEST/PROD by hand (D-10) | VERIFIED | I connected to neither; no task ran `db push`; local-stack and pg-lane only. |
| Review hand-off (D-09, recorded by the orchestrator) | VERIFIED (recorded) | migration-reviewer CLEAN and rls-policy-auditor CLEAN on `20261120120000_auth_user_has_password.sql` (not re-run here). 219-REVIEW.md: original review converged after 2 rounds; gap review converged after 2 rounds, round 2 reports no CRITICAL, HIGH or MEDIUM, and the three round-1 MEDIUMs (GR1-MD-01, GR1-MD-02 user-facing, GR1-MD-03 resolved as a recorded limit) have fixes with tests that fail when neutered. |

## Commands run by me, at HEAD `2b4509808`

| Check | Result |
|-------|--------|
| `npx vitest run` on the email route, callback, AccountEmailSection, ProfileTabs, ResetPasswordForm tests plus `mutation-annotation-parser`, `mutation-runner-floors`, `gate-family-meta`, `lint-sql-gates`, `no-store-coverage`, `limiter-ordering`, `baseline-content-drift-allowlist` | 12 files, 489 tests, all passed |
| `npx tsc --noEmit` | no output (clean) |
| `npm run lint` | 0 errors; 4 warnings, all in files this phase did not touch (`composite-read-path.ts`, `queries.stale-analytics-detail.test.ts`, merged from main); route-contract, admin-manifest and planning-hygiene checks OK |
| `node scripts/mutation-runner/run.mjs --parse-only` | `No static defects`, `files 85/112` |
| `node scripts/lint-sql-gates.mjs` | `scanned 112 file(s); 0 finding(s), 0 measure-fail(s), 0 allowlist error(s)` |
| `npm run schema:functions:check` | `SQL function snapshot is current (136 functions)`; DRIFT-05 gate (a) agrees |
| `node scripts/lint-migration-data-dependence.mjs` | `83 refusal(s), 83 allowlisted, 0 NEW` |
| pg-lane gate: `scripts/pg-lane/run.sh --workdir <scratch> --apply fixtures 01, 02, 07 + the migration --gate supabase/tests/test_auth_user_has_password.sql` | exit 0; gate notice covers arms 1 to 7b |
| `node scripts/mutation-runner/run.mjs --file supabase/tests/test_auth_user_has_password.sql` (single file, not a full pass) | 9/9 arms `RED (identity ok)`, biting 9, no defects; working tree clean |
| Byte-backed neuters (callback marker check, route password gate, ResetPasswordForm reauth branch), restored with `cmp` | 23 tests RED across the three files, GREEN after restore |

Not run here (by design): full workspace vitest, a full `sql-mutation` pass, the local-stack boot (plan 04's SUMMARY reports it measured; CI `sql-tests` carries it again), any TEST or PROD access.

## Anti-Patterns Found

No `TBD`, `FIXME` or `XXX` in any changed source, migration or gate file. No stubs: the route, callback, form and reset form are substantive and wired (page to tabs to section to route; section link to `/reset-password`; route to RPC).

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `ResetPasswordForm.tsx` | The `/login?reset=1` arm is effectively unreachable (updateUser always returns a user); recovery-link users now also land on the Account tab with the note (GR2-LW-01) | LOW, recorded in REVIEW only | Behavior change for the recovery path, an improvement over the old role-home bounce; worth a glance during the reauth UAT item. |
| `AccountEmailSection.tsx` | `passwordSet` note comes from the URL alone (GR2-LW-02) | LOW, record only | Claims nothing about email state. |
| `api/account/email/route.ts` | `AuthRetryableFetchError` maps to 400 rather than 502 (GR2-LW-03) | LOW, record only | Client still shows a retryable line. |
| `219-UI-SPEC.md` | Copy contract revised and brought in line by plan 07 and the round 1 fixes | Info | No action. |

## Known limits carried forward (recorded, not gaps)

- GD-06a: the gate guards the app form only; Auth's own `PUT /user` still accepts an email change from any valid session token without a password, and with Secure email change OFF only the new address confirms. Accepted by the founder ("Turn it off anyway"); belongs in the CHANGELOG `### Notes` and the PR body at ship time (not yet written; the ship step owns it).
- GD-02 corrected: the per-user limiter (5 per 60 s, no lockout, about 7,200 guesses a day) is the only brute-force bound, and users share the server's per-IP GoTrue sign-in budget, so heavy use can produce 502 `verify_unavailable`.
- GD-06b: after deploy the coordinator flips Secure email change OFF and Secure password change ON through the Management API; this phase changes no setting. The human list above is ordered so the single-link and reauth items run AFTER that flip.

## Post-deploy record (2026-11-20, added by the records PR)

⭐ **The GD-06b after-deploy flip is DONE.** On 2026-11-20, after #1299 (merge `b87eb7c07`) shipped and its migration `20261120120000` applied to PROD, the coordinator set Supabase Auth on PROD through the Management API and read the values back:

| Auth config key | Read back |
|---|---|
| `mailer_secure_email_change_enabled` ("Secure email change") | `false` |
| `security_update_password_require_reauthentication` ("Secure password change") | `true` |
| `mailer_autoconfirm` | `false` ("Confirm email" stays on) |

This meets the precondition of the human items above that say "only AFTER the coordinator flips". It does not tick any of them. Status stays `human_needed`: the founder's live re-test of the one-link, password-gated email change is still owed. The "before" values of the dashboard-settings item were not recorded here, so that item stays open as written.

## Gaps Summary

No gaps. All four gap truths from the founder's live PROD test resolve to VERIFIED in code, each backed by a behavioral test that I ran and neutered to RED, plus a green pg-lane gate whose 9 arms all bite under the mutation runner. Status is `human_needed`, not `passed`, only because the human verification list above (real GoTrue, mailbox, browser, the post-deploy dashboard flip, PKCE exchange in the auth logs) cannot be proved by code or by this verifier's no-TEST/PROD access.

---

_Verified: 2026-11-20T17:00:00Z_
_Verifier: Claude (gsd-verifier)_
