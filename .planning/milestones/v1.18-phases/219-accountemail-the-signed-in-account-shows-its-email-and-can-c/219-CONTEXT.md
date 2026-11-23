# Phase 219: ACCOUNTEMAIL — the signed-in account shows its email and can change it - Context

**Gathered:** 2026-11-19
**Status:** Ready for planning

<domain>
## Phase Boundary

A signed-in user can see which email their account uses and change it. The profile page's Account
tab shows the sign-in email, read from Supabase Auth on the server. A change goes through Supabase
Auth's own confirm-by-email flow (`supabase.auth.updateUser({ email }, { emailRedirectTo })`), and
the app never writes `auth.users` itself.

ROADMAP goal, verbatim: "A signed-in user can see which email their account uses and change it. The
account or settings page shows the signed-in email, and a change goes through Supabase Auth's own
confirm-by-email flow, never a direct write." Trigger: the founder's session 2026-11-19, where the
founder could not tell which email to sign in with in a private window. Founder decision 2026-11-19:
"Book a phase (Recommended)". That is the only founder decision; every decision below was taken
autonomously by the discuss agent or by the coordinating session (the "caller"), and is marked so.

The phase also carries the data-integrity half the discuss scout found: `profiles.email` is a
derived copy of the auth email that nothing keeps in step after signup, so one migration adds the
sync trigger (D-06) and, if proven safe, revokes the user-session write grant on that column (D-07).

Out of scope: any Supabase dashboard setting (D-12); showing the email in the sidebar or top bar
(D-03); changing the password or other auth factors; refactoring the email-sending routes to read
`auth.users` instead of `profiles.email`; applying anything to TEST or PROD by hand (D-10).

</domain>

<decisions>
## Implementation Decisions

Note on IDs: the smart-discuss template carries no `D-NN` ids. The caller asked for D-ids on this
phase so the plan, review and verification can cite each decision; they are used here on purpose.

### Discuss-scout findings that shaped the decisions (measured 2026-11-19 at b4cb7c4de)
- **F-1 No sync exists.** The only trigger on `auth.users` is `on_auth_user_created AFTER INSERT`
  (`handle_new_user`, `supabase/migrations/20260405061912_rls_policies.sql`). Confirmed on PROD
  through the Supabase MCP, marker query first: `pg_trigger` on `auth.users` returns that one row.
  No app code or SQL function writes `profiles.email` after signup except `sanitize_user` (sets it
  NULL) and the admin partner-import upsert (service_role, creates the row).
- **F-2 Consumers of `profiles.email`** that would keep the OLD address after a confirmed change:
  at least seven transactional send routes (`/api/intro`, `/api/intro-response`,
  `/api/admin/match/send-intro`, `/api/admin/strategy-review`, `/api/admin/allocator-approve`,
  `/api/admin/manager-approve`, `/api/admin/intro-request`), the admin pages, the
  `org_invites_read` / `org_invites_update` RLS policies (match `organization_invites.email`
  against `profiles.email`), and `sanitize_user`'s `notification_dispatches` purge.
- **F-3 PROD drift today**: count-only read, no addresses returned: 0 of 38 profiles differ from
  `auth.users.email` (case-insensitive) and 0 email changes are pending. No backfill is needed now.
- **F-4 Column-UPDATE grant finding**: on PROD `has_column_privilege('authenticated',
  'public.profiles', 'email', 'UPDATE')` is true and SELECT is false. The grant comes from
  `20260529150000_lock_profile_privileged_columns.sql` §1b (the "every non-privileged column" list),
  and the `profiles_self_update` policy lets a user update their own row. So a signed-in user can
  set their own `profiles.email` to any value, which the invite policies match on. Exploitability
  is NOT verified (the policy subquery reads a column `authenticated` cannot SELECT, which may make
  it error). Resolution path: D-07.

### Account tab UI
- **D-01** Host: the existing `/profile` page (`src/app/(dashboard)/profile/page.tsx`), inside the
  existing `ProfileTabs` "Account" tab (`account` key), above `DeleteAccountButton`. No new route.
  (auto-decided: the Account tab exists, is shown to every role, and today holds only the delete
  control; a new route would add a URL contract for no gain.)
- **D-02** The displayed email comes from `supabase.auth.getUser()` on the server (the page already
  calls it), passed to the client component as a prop. NEVER from `profiles.email`: the auth email
  is the sign-in identity the founder could not find, and `profiles.email` is a derived copy.
  (auto-decided, settled under every option in the discuss report.)
- **D-03** No sidebar, top bar or header change. The sidebar shows no user identity today
  (`src/components/layout/`), and the goal names the account or settings page. (auto-decided:
  minimal scope; adding it later is additive.)
- **D-04** Change flow: a client component calls
  `supabase.auth.updateUser({ email: next }, { emailRedirectTo: `${window.location.origin}/auth/callback?next=/profile?tab=account` })`,
  following `ForgotPasswordForm.tsx`'s `window.location.origin` pattern. The confirmation lands on
  the existing `src/app/auth/callback/route.ts`, which already accepts `type=email_change` (OTP) and
  `code` (PKCE). The planner MUST verify that `next=/profile?tab=account` survives `safeNextPath`
  (it should: it starts with one `/` followed by a letter) and that the query string reaches the
  redirect intact; a test pins it. The value needs URL-encoding inside `emailRedirectTo` so the
  inner `?` is not read as a second query. (auto-decided: reuses the shipped callback and its
  open-redirect guard; no new route.)
- **D-05** Pending and error copy must be correct under EITHER "Secure email change" setting. After
  a successful `updateUser`, show a pending state naming the new address, for example: "Check
  [new address] for a confirmation link. Your sign-in email stays [current address] until you
  confirm. If asked, also confirm from your current address." On reload, the server reads
  `user.new_email` from `getUser()` and shows the same pending line while a change is outstanding.
  Errors show Supabase's message, except that a same-as-current email is caught client-side before
  the call. The final wording is fixed in UI-SPEC.md. (auto-decided: product copy, picked as the
  one wording true under both settings; reversible by editing strings.)

### Data integrity: `profiles.email` sync (one migration)
- **D-06** (caller decision, option (a)) Add an `AFTER UPDATE OF email ON auth.users` trigger whose
  function is SECURITY DEFINER with a pinned `search_path`. It sets `profiles.email = NEW.email`
  for `id = NEW.id` ONLY when `NEW.email IS DISTINCT FROM OLD.email`, and does nothing when
  `current_setting('quantalyze.sanitize_in_progress', true) = 'on'` (so it never fights
  `sanitize_user`, which sets `auth.users.email` NULL inside that GUC; see
  `20260827130000_sanitize_user_revoke_strategy_shares.sql`, the latest definition). Before
  writing, re-base on the LATEST `handle_new_user` (`20260520222848_lock_profile_role_at_signup.sql`)
  and `sanitize_user` definitions across all migrations. Follow repo migration conventions,
  including `scripts/lint-migration-data-dependence.mjs`: no new data-reading `DO`-block guard.
  The profiles `reject_sentinel_writes` and `profiles_lock_privileged_cols` triggers must not
  refuse this update (it touches only `email`). — **Reversibility:** costly — a trigger on
  `auth.users` is applied to PROD automatically on merge and is undone only by a further migration.
- **D-07** (caller decision) In the SAME migration, `REVOKE UPDATE (email) ON public.profiles FROM
  authenticated` ONLY IF it is proven, by grepping `src/` supabase-js calls and every RPC or SQL
  function that runs as the invoker, that no client or user-session path writes `profiles.email`.
  If any such writer exists, do NOT revoke; record it as a finding in the phase's REVIEW or
  VERIFICATION. Evidence at b4cb7c4de (the executor re-proves at HEAD): `ProfileForm.tsx` and
  `OnboardingWizard.tsx` update profiles without `email`; the only `email` writers are the
  service_role admin client (`/api/admin/partner-import`) and test helpers using the admin client,
  none of which use the `authenticated` grant. This is the resolution path for F-4. If revoked,
  `test_profiles_privileged_columns_locked.sql` and its pg-lane fixture
  (`scripts/pg-lane/fixtures/28-fixture-profiles-privileged-columns.sql`) must be checked for an
  assertion on the column-grant set. — **Reversibility:** costly — a privilege change on PROD,
  reverted only by a further migration.
- **D-08** (caller decision) SQL self-tests under `supabase/tests` in the corpus idiom (SET ROLE,
  named RAISE arms, RED-UNDER annotations), covering: email change syncs; unchanged email does not
  write; sanitize GUC on → no sync; and, if D-07 revokes, `authenticated` cannot UPDATE
  `profiles.email`. Update every census a new file or arm moves (grep them all; at least
  `scripts/mutation-floors.mjs` FILES_FLOOR/ARMS_FLOOR, RED-UNDER annotations,
  `scripts/lint-sql-gates.mjs`, `scripts/lint-app-guc.mjs`, `src/__tests__/mutation-runner-floors.test.ts`,
  `src/__tests__/vac08-ledger-dispositions.test.ts`, `scripts/local-stack/sql-corpus-report.mjs`,
  `scripts/sql-gate-subset.mjs`, and the baseline replay marker read by
  `scripts/check-baseline-currency.mjs --replay-set`). The test must be shown able to fail: neuter
  the trigger, see RED, restore from a byte backup (never git checkout/restore/stash).
- **D-09** (caller decision) The review step adds migration-reviewer and rls-policy-auditor, both
  required clean before merge, alongside gsd-code-reviewer and silent-failure-hunter.
- **D-10** (caller decision) Nothing is applied to TEST or PROD by hand. `supabase-migrate.yml`'s
  apply-test then PROD apply on merge handles it. Because PROD now auto-applies once apply-test is
  green (no human gate), every migration review happens before merge.
- **D-11** (caller decision, reasoning) The ROADMAP goal's "never a direct write" refers to the
  auth email (`auth.users`). The trigger is the sync mechanism for the derived `profiles.email`
  copy, a database-side consequence of a change Supabase Auth itself confirmed. That is exactly
  why option (b), an app-side write to `profiles.email` in `/auth/callback`, stays ruled out: it
  would be an app write to the copy, would miss changes made outside the app (an admin editing the
  email in the Supabase dashboard), and under "Secure email change" the final confirming click may
  not pass through a session the app controls.

### Dashboard dependency
- **D-12** Supabase dashboard settings are NOT code and this phase changes none of them, on TEST or
  PROD: "Secure email change" (double confirm; local `supabase/config.toml` has
  `double_confirm_changes = true`, PROD value not read), Site URL and Redirect URL allow-list (must
  admit `${origin}/auth/callback?next=...`, already documented in the callback route header), and
  the "Change email address" email template. D-05 keeps the UI copy correct under either
  double-confirm setting. If the redirect allow-list rejects the URL, Supabase falls back to the
  Site URL; the plan records that as a manual UAT check, not a code path.

### Decided autonomously
- [Account tab UI] Q: "Where does the email live?" → Selected: "Profile page Account tab, above Delete account (D-01)" — moving a component between tabs is a local edit.
- [Account tab UI] Q: "Source of the displayed email?" → Selected: "auth.getUser() on the server (D-02)" — a prop source swap.
- [Account tab UI] Q: "Show the email in the sidebar or top bar too?" → Selected: "No (D-03)" — additive later.
- [Change flow] Q: "Which confirmation landing?" → Selected: "Existing /auth/callback with next=/profile?tab=account (D-04)" — the redirect path is one string.
- [Change flow] Q: "How is a pending change shown after reload?" → Selected: "Read user.new_email from getUser() server-side (D-05)" — display-only.
- [Tests] Q: "Test approach for the UI?" → Selected: "vitest component tests for the email section (render, same-email guard, updateUser args incl. encoded redirect, pending state, error) plus a callback route test for next=/profile?tab=account" — tests are local files.

### Claude's Discretion
- Component name and file (for example `src/components/auth/AccountEmailSection.tsx`), its exact
  layout, and whether the form opens inline or behind a "Change email" button, within UI-SPEC.md.
- Migration filename and function name, following repo timestamp naming.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/components/auth/ForgotPasswordForm.tsx` and `ResetPasswordForm.tsx`: client components
  calling `createClient()` from `@/lib/supabase/client`, with `Input`, `Button`, loading text,
  `role="status"` success panel and `text-negative` error line. The pattern for the email form.
- `src/app/auth/callback/route.ts`: handles `code` and `token_hash`+`type=email_change`, with the
  `safeNextPath` open-redirect guard; its header documents the dashboard configuration.
- `src/components/auth/ProfileTabs.tsx`: the `account` TabsContent (`max-w-xl`, `DeleteAccountButton`).
- `src/app/(dashboard)/profile/page.tsx`: already calls `supabase.auth.getUser()`.

### Established Patterns
- Profile self-reads go through the admin client because of column REVOKEs on profiles
  (`profile.email` is NOT selectable by `authenticated`).
- Migrations: timestamped `supabase/migrations/YYYYMMDDHHMMSS_name.sql`, SECURITY DEFINER with
  `SET search_path`, EXECUTE hardening, CREATE OR REPLACE re-based on the latest definition.
  Deletion-cascade and sanitize-path guards exempt `quantalyze.sanitize_in_progress = 'on'`.
- SQL self-tests: `supabase/tests/test_*.sql`, run by `sql-tests` on a private local stack and by
  `sql-mutation` on a pg-lane cluster, with RED-UNDER annotations and mutation floors.

### Integration Points
- `ProfileTabs` account panel (new email section), `profile/page.tsx` (pass auth email and
  `new_email`), `/auth/callback` (landing after confirmation), one new migration, new
  `supabase/tests` file(s) and their censuses.

</code_context>

<specifics>
## Specific Ideas

- The founder's trigger case: in a private window they did not know which email to type on the
  login page. The Account tab answers that by showing the sign-in email plainly.
- Supabase's `email_change` confirmation lands at `/auth/callback`, which redirects to
  `/profile?tab=account`, where the new email now shows.

</specifics>

<deferred>
## Deferred Ideas

- Refactoring transactional send routes to read the auth email instead of `profiles.email` (made
  unnecessary by D-06).
- Showing the email in the sidebar or top bar (D-03).
- Whether the `org_invites_*` policies actually error for `authenticated` because they read a
  column it cannot SELECT (F-4 side question); not this phase's goal.

</deferred>

<gap_decisions>
## Gap decisions (2026-11-20, after the founder's live PROD test)

These ADD to D-01..D-12. Where one contradicts an earlier decision it says so; the earlier text is
kept as lineage. Earlier wording this supersedes: D-05's "copy must be correct under EITHER Secure
email change setting" still holds for rollout, but the TARGET flow is now single-link.

### Superseded first: the two-step checklist (recorded, then withdrawn the same day)
The first gap brief (founder, 2026-11-20: "this is awkward. Make it as steps. As I have clicked in
the [new address] email, you could mark that step as completed.") asked for a numbered two-step
checklist. It was never planned or built. The founder replaced it the same day (GD-01).

### GD-01 (founder, 2026-11-20, verbatim) — password gate, one link
"instead of sending two emails, ask for password for email change. and then only send to the new
email".
- The change-email form asks for the CURRENT password. A server route verifies it against Supabase
  Auth BEFORE it calls `updateUser`; a wrong password shows an inline error and sends nothing (a
  test proves `updateUser` is not called).
- Verification uses `signInWithPassword` on a separate client built with `persistSession: false`,
  `autoRefreshToken: false` and no cookie adapter, so the user's own session cookies are never
  read, swapped, refreshed or cleared. Measured 2026-11-20: the repo has no existing re-auth helper
  (`grep -rn "reauthenticate\|persistSession" src` hits nothing in app code; only scripts use
  `persistSession: false`). The password is never logged, returned, or put in an error or Sentry
  payload.
- After the gate passes, the same route calls `updateUser({ email }, { emailRedirectTo })` on the
  user's normal cookie-bound server client, so the PKCE verifier cookie is set exactly as before.
- One link: only the new address gets a link once the PROD dashboard's "Secure email change" is
  OFF ("Confirm email" stays ON). The founder flips it AFTER the PR merges; this phase changes no
  setting (D-12 stands). Until the switch is flipped, the old two-link flow still runs, and the
  existing `email_change=partial` path keeps handling the first link sensibly.
- The pending panel is a single "confirm at <new address>" state. No checklist.

### GD-02 Rate limiting / brute force (measured, not assumed)
`src/lib/ratelimit.ts` exports `userActionLimiter` (5 per 60 s) and `checkLimit`. The password
route checks it keyed by the signed-in user id BEFORE the password check, so a stolen session can
try at most 5 passwords a minute through this route. GoTrue's own sign-in rate limit applies on top
to `signInWithPassword`.
⛔ CORRECTED 2026-11-20 (gap review round 1, GR1-MD-03; the sentence above is kept as lineage):
GoTrue's sign-in limit is keyed on the CALLER'S IP, and here the caller is the app server, so it
adds no per-attacker protection; the per-user `userActionLimiter` (5 per 60 s, about 7,200 guesses a
day, no lockout) is the only brute-force limit on this route. All users also share the server's
per-IP sign-in budget, so heavy use could turn correct passwords into 502 `verify_unavailable` until
the window passes. Recorded for the founder alongside GD-06a; no longer-window limiter is added in
this gap. `checkLimit` fails closed in production when the limiter is unconfigured.

### GD-03 Root cause: the final link landed on the admin dashboard (measured on PROD logs)
PROD auth logs, user `832a1c45…`, 2026-11-20 (read-only, marker query first):
- 12:15:55 `PUT /user` (the change request, referer `/auth/callback?next=%2Fprofile%3Ftab%3Daccount`).
- 12:32:35 `GET /verify` 303 — first link (partial; landed on the Account tab with the note).
- 12:34:13 `GET /verify` with `user_modified` — the second link COMPLETED the change in Auth.
- 12:34:15 `POST /token grant_type=pkce` → **422 `flow_state_expired`** ("invalid flow state, flow
  state has expired").
GoTrue redirects a completed PKCE verify to `redirect_to?code=…`. Its PKCE flow state, created by
the `PUT /user` at 12:15:55, lives only a few minutes (GoTrue's flow-state expiry), so a link
clicked 18 minutes later always fails `exchangeCodeForSession`. `src/app/auth/callback/route.ts`
then sends the user to `/login?error=…`; the proxy (`src/proxy.ts`) bounces any signed-in user off
`/login` (public, not bounce-exempt) to `ROLE_HOME_ROUTE` = `/home`, which redirects by role, so an
admin lands on the admin dashboard. `next` was never lost: GoTrue carried it on both links. The
same failure hits the SINGLE link after GD-01 whenever it is clicked after the flow state expires,
so the fix is needed for the target flow too, and needs no dashboard change.
**Fix:** the change request's `next` carries an email-change intent marker
(`/profile?tab=account&email_change=confirmed`). In the callback's `code` branch, when the exchange
fails AND `safeNext` carries that marker, redirect to `safeNext` instead of `/login`. That is safe:
the failed exchange minted no session, the target is the same-origin path `safeNextPath` already
allows, and a signed-out user is sent to `/login` by the proxy as before. The Account tab then
reads the truth from `auth.getUser()`.

### GD-04 Done state comes from Auth, never from the URL
The "Your sign-in email is now X." note shows only when the page's server `auth.getUser()` reports
no pending `new_email`, and X is `user.email` from that same read. The `email_change=confirmed`
marker only says "the user arrived from the link"; it never asserts success by itself. If Auth
still reports a pending `new_email` (secure change still ON and only one link done), the pending
panel shows instead. `email_change=partial` keeps its existing note.

### GD-05 OPEN FOUNDER QUESTION: accounts without a password
Measured 2026-11-20: the app has no OAuth, no `signInWithOtp`, no invite-by-email sign-in. But
`src/lib/supabase/admin-users.ts` `ensureAuthUser` (used by `src/app/api/admin/partner-import`)
creates auth users with `email_confirm: true` and NO password, and seeds do the same. Such a user
can only get a session through the password-recovery link, which lands on `/reset-password`; one
who leaves that page without setting a password is signed in with no password. Design for them is
NOT guessed here. Interim behaviour: the gate refuses with the same inline wrong-password error,
sends nothing and does not crash; such a user can set a password through "Forgot password?" first.
Question for the founder: should password-less accounts be offered a different confirmation (for
example a link to the current address) or is "set a password first" the intended rule?

### GD-06 Known limit, recorded for the founder (not a design change)
The password gate guards the APP's form. Supabase Auth's own `PUT /user` endpoint still accepts an
email change from any valid session token without a password, and with "Secure email change" OFF
only the new address confirms. So a stolen session token used directly against Auth bypasses the
gate. Supabase offers reauthentication nonces for password changes, not email changes. Recorded so
the switch-off decision is taken knowing it.

### GD-05a (founder answer, 2026-11-20, verbatim: "Set a password first") — supersedes GD-05's interim behaviour
- A password-less account is NOT shown the wrong-password error. The form tells the user to set a
  password first and links to where a password can be set. Every email change stays
  password-checked; there is no other path.
- Telling the two apart (measured 2026-11-20): the GoTrue user object and its `identities` do NOT
  say whether a password exists (an admin-created `email_confirm: true` user also carries an
  `email` identity), and `signInWithPassword` answers "Invalid login credentials" for both cases.
  The only sound signal is `auth.users.encrypted_password`, which only the database can read. So
  this gap adds ONE migration: a `SECURITY DEFINER` boolean function that answers "does THIS user
  have a password" for a single user id, executable by `service_role` only (no `anon`, no
  `authenticated`), called by the server route with the id from the caller's own `getUser()`. It
  returns a boolean about the caller's own row and nothing else, so it leaks nothing about other
  users. Because it adds a migration, migration-reviewer and rls-policy-auditor must be clean
  (D-09) and the SQL gate corpus idiom applies (D-08).
- Where to set a password: the Security tab is allocator-only (`ProfileTabs.tsx` `allocatorOnly:
  true`), so the planner must check what a manager or admin can reach (for example
  `/forgot-password` or `/reset-password`) and link to a destination every role can use. Recorded
  as a planning check, not guessed here.

### GD-06a (founder answer, 2026-11-20, verbatim: "Turn it off anyway") — accepted risk
The founder heard GD-06's trade-off (a stolen session token can change the email directly against
Supabase Auth, and with "Secure email change" OFF only the new address confirms) and accepted it.
This goes in the CHANGELOG `### Notes`. After the PR merges and deploys, the coordinator turns
"Secure email change" OFF through the Supabase Management API (not the founder by hand; still
nothing in this phase changes a setting). Until then the old two-link flow still runs, and the PR
body says so.

### GD-06b (founder decision, 2026-11-20) — both switches flip together after deploy
After this PR deploys, the coordinator turns "Secure email change" OFF and "Secure password
change" ON at the same time, both through the Supabase Management API. This phase changes no
setting itself (D-12). The PR body says both, beside the GD-06a switch-off note.

### GD-07 What "Secure password change" ON does to /reset-password and the GD-05a link (measured)
Evidence (Supabase docs, "Password security" → "Require reauthentication when changing password",
read 2026-11-20): "Users will need to be recently logged in to change their password without
requiring reauthentication. (A user is considered recently logged in if the session was created
within the last 24 hours.)" Otherwise `updateUser({ password })` is refused until a `nonce` from
`supabase.auth.reauthenticate()` (emailed to the user) is passed with it. The rule keys on the
SESSION's creation time; there is no exemption for an account with no password.
- Recovery link: `/auth/callback?type=recovery` mints a NEW session, so `/reset-password` reached
  from the email link is always inside the 24 h window. That path keeps working unchanged.
- Signed-in user whose session is older than 24 h (a refreshed session keeps its creation time),
  including a password-less partner-import user following the GD-05a "Set a password" link:
  `updateUser({ password })` returns the reauthentication-needed error. Today
  `src/components/auth/ResetPasswordForm.tsx` only special-cases messages matching `/session/i`,
  so it would print the raw error and dead-end; a signed-in user cannot use `/forgot-password`
  (the proxy bounces them). So this gap adds plan 219-09: on the reauthentication-needed error the
  form calls `reauthenticate()`, shows a code input, and retries `updateUser({ password, nonce })`.
  A test must fail without it.
- A password-less user can set a FIRST password this way: `reauthenticate()` sends the nonce to the
  account email, which every partner-import user has.
</gap_decisions>
