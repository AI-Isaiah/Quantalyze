---
phase: 219-accountemail-the-signed-in-account-shows-its-email-and-can-c
reviewed: 2026-11-19T16:40:58Z
depth: standard
files_reviewed: 18
files_reviewed_list:
  - supabase/migrations/20261119120000_sync_profile_email_from_auth.sql
  - supabase/migrations/down/20261119120000-rollback.sql
  - supabase/tests/test_profiles_email_sync.sql
  - supabase/schema/functions/sync_profile_email_from_auth.sql
  - scripts/baseline-content-drift-check.mjs
  - scripts/dump-sql-functions.ts
  - scripts/mutation-floors.mjs
  - src/__tests__/gate-family-meta.test.ts
  - src/__tests__/lint-sql-gates.test.ts
  - src/__tests__/mutation-annotation-parser.test.ts
  - src/__tests__/mutation-runner-floors.test.ts
  - src/components/auth/AccountEmailSection.tsx
  - src/components/auth/AccountEmailSection.test.tsx
  - src/components/auth/ProfileTabs.tsx
  - src/components/auth/ProfileTabs.test.tsx
  - src/app/(dashboard)/profile/page.tsx
  - src/app/auth/callback/route.test.ts
  - TODOS.md
findings:
  critical: 0
  high: 0
  medium: 1
  low: 5
  info: 2
  warning: 1
  total: 8
  necessity: 0
status: issues_found
---

# Phase 219: Code Review Report

## Round 1

**Reviewed:** 2026-11-19T16:40:58Z
**Depth:** standard
**Files Reviewed:** 18
**Status:** issues_found

### Summary

The diff is `b4cb7c4de..HEAD`, `.planning` excluded. The database half holds up. The trigger function is SECURITY DEFINER with a pinned search_path and a schema-qualified write. EXECUTE is revoked from PUBLIC, anon and authenticated. The single distinct-guard follows D-06, and the sanitize exemption is in place. The column revoke takes away a real column-level grant (20260529150000 section 1b), and the re-measured writer census shows no user-session writer of `profiles.email`: ProfileForm and OnboardingWizard never send it, partner-import uses the admin client, and analytics-service and e2e have no writer. Neither `profiles` trigger can abort Auth's transaction, because `reject_sentinel_writes` keys on current_user and `profiles_lock_privileged_cols` is limited to six other columns. The gate's ten arms each carry a twin that bites, and the census bumps (83 -> 84 files, 891 -> 901 arms, 110 -> 111 lint files, COMPARED_FLOOR 136 -> 137, a snapshot-only NAME_SET_RATCHET row) agree with each other. `[219-EXTRACTOR-UPDATE-OF]` is booked correctly.

The weak point is the UI flow's landing. Under double-confirm ("Secure email change", which local config sets to `double_confirm_changes = true` and which is Supabase's default), clicking the first confirmation link lands the signed-in user on an error page. RESEARCH A2 called this outcome [ASSUMED] and routed it to UAT. GoTrue's redirect code shows it will happen, so this review records it as a MEDIUM.

No CRITICAL or HIGH findings.

### Medium

#### MD-01: Double-confirm first click lands the signed-in user on `/login?error=Missing verification parameters` [user-facing]

**File:** `src/components/auth/AccountEmailSection.tsx:106` (the redirect target), `src/app/auth/callback/route.ts:108` (the fallthrough)
**Issue:** With "Secure email change" on, the first of the two confirmation links is a partial confirmation. GoTrue's `/verify` answers it with `prepRedirectURL(singleConfirmationAccepted, redirect_to, flowType)`. That sets only `message=Confirmation link accepted. Please proceed to confirm link sent to the other email` (as a query parameter under PKCE, which `@supabase/ssr`'s browser client uses, and as a fragment otherwise). It sets no `code` and no `token_hash`. The callback therefore reaches `loginRedirect(req, "Missing verification parameters")`, so a user whose first confirmation SUCCEEDED is sent to the login page with an error. That reads as "the change failed", and users stop before clicking the second link. Under double-confirm this happens on every change: it is the normal flow, not an edge case. The phase goal is a working confirm-by-email change, and this phase is the first to send users down that path, so it is a goal gap and not only a UAT note. (RESEARCH A2 and Pitfall 2 told the executor not to fix it speculatively. The GoTrue source removes the speculation; the PROD template and setting are still unread, per D-12.)
**Fix:** a narrow branch in the callback, placed before the final fallthrough. It is still safe, because it signs no one in and reuses `safeNext`:
```ts
const message = url.searchParams.get("message");
if (!code && !tokenHash && message) {
  const dest = new URL(safeNext, req.url);
  dest.searchParams.set("email_change", "partial");
  return NextResponse.redirect(dest);
}
```
The pending panel already tells the user to confirm at both addresses. Optionally, have the Account tab show a "first link accepted" line when `email_change=partial` is present. Add a route test for `?message=...&next=%2Fprofile%3Ftab%3Daccount` with no code.

### Low (recorded here only; not booked in TODOS.md, per the 2026-11-14 rule)

#### LW-01: PKCE final click on another device or in an in-app browser shows an error although the change completed
**File:** `src/app/auth/callback/route.ts:86-90`
GoTrue applies the email change at `/verify`, before it redirects with `code`. `exchangeCodeForSession` then fails without the code-verifier cookie that `updateUser` set in the original browser, and the user lands on `/login?error=...` even though `auth.users.email` (and, through the trigger, `profiles.email`) has already changed. Fix: optional. On an exchange failure while `next` is `/profile?tab=account`, show neutral copy, e.g. "If you confirmed an email change, sign in again to see it."

#### LW-02: Pending copy and `sentPending` are wrong when the change applies at once
**File:** `src/components/auth/AccountEmailSection.tsx:103-119`, `:46`, `:53`
With mailer autoconfirm (local config `enable_confirmations = false`, or any project where an email change needs no confirmation), `updateUser` changes the email immediately. The panel still says "We sent a confirmation link to X ... You still sign in with X until you confirm". After `router.refresh()`, `email` is X, and `sentPending` (never cleared, and it takes precedence over the server's `pendingEmail`) keeps the panel up. Fix: read `data.user` from `updateUser`. Set `sentPending` only when `data.user?.new_email` is set; otherwise just `router.refresh()`. Clear `sentPending` once the `pendingEmail` prop arrives, or drop it in favour of the prop.

#### LW-03: Focus goes to `<body>` after a successful submit
**File:** `src/components/auth/AccountEmailSection.tsx:117-120`
The submit button unmounts, and the success path sets no `focusTarget`, so keyboard users lose their place. UI-SPEC defines focus returns for every other transition. The `role="status"` panel is also mounted already holding its content, and screen readers often do not announce a live region inserted with its text. Fix: set `focusTarget.current = "reopen"` before `setState("closed")`. Optionally keep an empty status container mounted and fill it.

#### LW-04: The rollback's `DROP TRIGGER ... ON auth.users` needs table ownership on hosted Supabase (unverified)
**File:** `supabase/migrations/down/20261119120000-rollback.sql:59`
CREATE TRIGGER needs only the TRIGGER privilege, but dropping an existing trigger needs ownership of `auth.users` (`supabase_auth_admin`). The forward migration's `DROP TRIGGER IF EXISTS` is safe because the trigger is absent at first apply, which skips the ownership check. The rollback runs while the trigger exists. If `postgres` is not a member of `supabase_auth_admin` on the hosted projects, the rollback fails with "must be owner of relation users". The single-transaction run means nothing half-applies. Fix: dry-run the rollback inside `BEGIN; ... ROLLBACK;` on TEST, or say in the header which role it needs.

#### LW-05: Supabase error messages pass straight to the user
**File:** `src/components/auth/AccountEmailSection.tsx:110`
For a target address that is already registered, GoTrue answers `email_exists` ("A user with this email address has already been registered"). A signed-in user can therefore test which addresses hold accounts. D-05 chose to show Supabase's message as-is, which is acceptable. Fix: optional. Map `error.code === "email_exists"` to neutral copy.

### Info

#### IN-01: No re-authentication before an email change
`src/components/auth/AccountEmailSection.tsx:103`. Anyone holding a live session (a shared machine, a stolen cookie) can start a change. With "Secure email change" off, confirming only the NEW address completes it, which is an account takeover. The PROD setting is unread (D-12). The UAT that RESEARCH item 3 already routes should record it.

#### IN-02: Outside the sanitize window, the trigger copies a NULL email
`supabase/migrations/20261119120000_sync_profile_email_from_auth.sql:99-101`. If an admin or Auth NULLs `auth.users.email`, `profiles.email` becomes NULL as well. This follows from the "derived copy" design. The note is here so the send routes' null handling is a known dependency.

---

_Reviewed: 2026-11-19T16:40:58Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Round 1: other reviewers (recorded by the orchestrator)

- **silent-failure-hunter:** 1 MEDIUM (user-facing), SF-01. In `src/components/auth/AccountEmailSection.tsx`, after a successful `updateUser`, `setSentPending(next)` runs without reading `data.user.new_email`. Also `shownPending = sentPending ?? pendingEmail` lets the local value beat the refreshed server prop. So when Auth applies the change immediately (autoconfirm; local `enable_confirmations = false`), or the change is confirmed in another tab, the panel says a link was sent when none exists. Same root as code-review LW-02; the higher rating (MEDIUM) is the one acted on. Minimal fix: set the pending email from `data.user?.new_email ?? null`, and stop the local value overriding a refreshed prop that shows no pending change.
- **migration-reviewer:** CLEAN (0 findings).
- **rls-policy-auditor:** CLEAN (0 findings). Advisory below the bar: whether the revoke closes the `org_invites_*` takeover depends on the hosted "Confirm email" / "Secure email change" settings (D-12 UAT).

## Fixes applied (round 1)

Scope: MD-01 and SF-01 only (the MEDIUM, user-facing findings). LOW and INFO findings (LW-01, LW-03 to LW-05, IN-01, IN-02) were not touched, per the standing rule. LW-02 shares SF-01's root and is closed by it.

| Finding | Commit | What changed |
|---|---|---|
| MD-01 | `e85621fd7` | `src/app/auth/callback/route.ts`: before the final fallthrough, a callback with a `message` and no `code` or `token_hash` redirects to the safe `next` path (through `safeNextPath`) with `email_change=partial`. `ProfileTabs` passes `firstLinkAccepted` (from that param) to `AccountEmailSection`, which shows one neutral `text-xs text-text-secondary` line under the pending panel, outside the live region. No-params still goes to `/login?error=Missing verification parameters` (existing test). |
| SF-01 | `095b8e33f` | `AccountEmailSection.tsx`: `sentPending` is set from `data.user?.new_email ?? null`, so no panel appears when Auth applied the change at once. A change in the server `email` or `pendingEmail` props clears `sentPending`, so the refreshed props win over the local stand-in. |

Verification: `npx vitest run` on `route.test.ts`, `AccountEmailSection.test.tsx`, `ProfileTabs.test.tsx`: 60 passed (52 before the round; 8 new, 2 existing success-path tests reworked to carry `new_email`). `npx tsc --noEmit` clean. `npm run lint`: 0 errors (4 pre-existing warnings, none in touched files).

Can fail: each new test was shown RED against the neutered fix (route branch disabled; note prop forced false; `new_email` ignored; props-reset removed), then the file was restored from a `cp -p` backup and `cmp` confirmed byte equality.

Residual, recorded and not fixed: the marker only works under PKCE, where GoTrue sends `message` as a query parameter. Without PKCE it arrives as a URL fragment, which the server never sees. The note's wording assumes the other confirmation is still awaited; it is true whenever GoTrue sends this message. The PROD "Secure email change" setting and template remain unread (D-12 UAT).

## Round 2 (re-review of the round 1 fixes)

**Reviewed:** 2026-11-19T17:50:00Z
**Depth:** standard
**Scope:** `git diff 907edaa96..HEAD -- src` (6 files: `src/app/auth/callback/route.ts`, `route.test.ts`, `src/components/auth/AccountEmailSection.tsx`, `AccountEmailSection.test.tsx`, `ProfileTabs.tsx`, `ProfileTabs.test.tsx`)
**Status:** MEDIUM+ clear. 0 critical, 0 high, 0 medium, 2 low, 2 info.
**Re-run:** `npx vitest run` on the three test files gives 60 passed, matching the fix notes.

### Round 1 findings

- **MD-01: RESOLVED.** `route.ts:113-117` handles a callback that carries a `message` and has no successful `code` or `token_hash` branch. It redirects to `safeNext` with `email_change=partial`. It does no exchange and no verify, so it signs no one in. The open-redirect guard still applies: `safeNext` is the same `safeNextPath` output both earlier branches use, and `route.test.ts` "keeps the open-redirect guard on the message-only branch" asserts a same-host `/onboarding` landing for `next=https://evil.example/phish`. One difference from the suggested shape: the branch tests only `message`. A request with `token_hash`, no `type` and a `message` now lands on `next` with the marker instead of `/login`. GoTrue never sends that, and the request signs no one in, so this is not a finding. The no-params fallthrough to `/login?error=Missing verification parameters` is unchanged and still tested.
- **SF-01 (and LW-02): RESOLVED.** `AccountEmailSection.tsx:131` sets `sentPending` from `data.user?.new_email ?? null`, so under autoconfirm no "We sent a confirmation link" panel appears. Lines 58-62 clear `sentPending` whenever the `email` or `pendingEmail` prop changes, so the refreshed server value (`page.tsx` passes `user.new_email`) replaces the local stand-in. That is React's documented "adjust state when a prop changes" pattern. The guard compares fields rather than object identity, so it settles after one extra render and cannot loop. Traced cases: autoconfirm (null, then the refresh brings the new email); X pending then submit Y (local Y, then prop Y clears it); X pending then resubmit X (local X, props unchanged, still X, which is consistent); confirmed in another tab (prop goes to null, which clears the local value). None leaves stale copy on screen.

### Copy truth under either "Secure email change" setting

- **ON:** the first link reaches the new branch. `user.new_email` is still set, because GoTrue keeps `email_change` until both links are confirmed. So the panel shows, and the note shows under it. Both texts are true.
- **OFF:** GoTrue sends no `message`. The single link completes the change and redirects with `code`, so the new branch and the note never trigger. The panel copy is the round 1 copy, which UI-SPEC already rated true under both settings.

### New findings (introduced by the fix)

#### R2-LW-01: The `email_change=partial` marker outlives the change it describes [LOW, user-facing copy]
**File:** `src/components/auth/ProfileTabs.tsx:190` (read), `:87` (tab switches copy every param), `src/components/auth/AccountEmailSection.tsx:136-138` (the submit keeps the URL)
**Issue:** The marker sits in the URL, and nothing removes it. Suppose a user lands from the first link on `/profile?tab=account&email_change=partial`, clicks **Use a different email** and submits Z. `router.refresh()` keeps the URL, so Z's new pending panel shows "Your confirmation was accepted. To finish the change, confirm the link sent to your other address." No link for Z has been clicked. Under double-confirm the user may then click only one of Z's two links and believe the change is done. The marker also survives a reload, a bookmark, and every tab switch (line 87 rebuilds the params from `searchParams.toString()`). The impact is narrow. It needs a re-submit in the same tab, and the panel's own copy still says to confirm at both addresses. So this is LOW.
**Fix:** after a successful submit, drop the marker instead of only refreshing, e.g. `router.replace("/profile?tab=account")` in place of `router.refresh()` when the marker is present. A `replace` to a new URL re-renders the server component, so it also covers the refresh. Alternatively, have `ProfileTabs` strip `email_change` when it rebuilds params.

#### R2-LW-02: The note's string is outside the approved Copywriting Contract [LOW, other]
**File:** `src/components/auth/AccountEmailSection.tsx:26-27`
**Issue:** UI-SPEC's Copywriting Contract (line 181 onward, checklist line 264, "every string exact") lists every string the section may render. The ui-checker approved that list. `FIRST_LINK_ACCEPTED` and its `text-xs text-text-secondary` line are new and not in it. The styling matches the helper-line row in the typography table, and the line sits outside the live region, as UI-SPEC line 112 asks for the button. So the visuals comply. Only the contract record is missing the string.
**Fix:** add the string and its condition (`?email_change=partial` while `pendingEmail` is set) to UI-SPEC's Copywriting Contract and to the `partial` row of its state table (line 246).

#### R2-IN-01: Anyone can trigger the marker [INFO]
**File:** `src/app/auth/callback/route.ts:113`
Any `?message=<anything>` link with no code reaches the branch. This adds nothing, because `/profile?tab=account&email_change=partial` could always be typed directly. The note renders only while the user's own `new_email` is set (`AccountEmailSection.tsx:210,236`), and its text is fixed, never the `message` value. So nothing is injected or reflected.

#### R2-IN-02: Whether GoTrue keeps `next` in the partial redirect is assumed, not measured [INFO]
**File:** `src/app/auth/callback/route.test.ts:129-143`
The route test builds a URL that holds both `message` and `next`. Whether GoTrue's `prepRedirectURL` keeps the `redirect_to` query (`next`) when it adds `message` under PKCE was not read in this review. If GoTrue replaced the query instead, the user would land on `/onboarding?email_change=partial`. That is still not an error page, but the note would not show. Together with round 1's fragment residual (non-PKCE), this belongs in the D-12 UAT: click the first link once on TEST and record the landing URL.

### Counts (round 2)

| Severity | Count |
|---|---|
| Critical / High / Medium | 0 |
| Low | 2 (R2-LW-01 user-facing copy, R2-LW-02 spec record) |
| Info | 2 |

LOW and INFO are recorded here only, per the 2026-11-14 rule. Nothing is booked in TODOS.md.

_Reviewed: 2026-11-19T17:50:00Z_
_Reviewer: Claude (gsd-code-reviewer), round 2_

### Round 2: silent-failure-hunter (recorded by the orchestrator)

None MEDIUM+. SF-01 confirmed resolved. LOWs noted (not fixed, by rule): the stale `email_change=partial` marker (same as R2-LW-01); no note when the first link is opened while signed out (proxy redirects to /login and drops the marker); the note can be triggered by a crafted link (same as R2-IN-01). migration-reviewer and rls-policy-auditor were not re-run: the fixer round did not touch the migration, its rollback or the gate.

**Review status: converged after 2 rounds, 0 open MEDIUM+.**


## Gap review round 1 (2026-11-20)

**Scope:** `git diff origin/main...HEAD -- . ':!.planning'` on `gsd/phase-219-gap` (23 files: plans 219-04..09). **Depth:** deep (cross-file: route → `withAuthLimited` → `withAuth`/approval gate, callback → `src/proxy.ts` bounce, Account-tab link → `/reset-password` → proxy). **Reviewer:** Claude (gsd-code-reviewer), gap round 1.

### Verified sound (focus items, each traced to the line)

- **Password never logged or returned.** `src/app/api/account/email/route.ts:168-174` logs only `code`/`status`; `:184-188` logs only the RPC message; no response body echoes `body.password`. Route Test 13 spies every console method. Client clears the password on every answer and on a thrown fetch (`AccountEmailSection.tsx:168,173`).
- **Verifier client never touches user cookies.** `route.ts:140-146` builds a plain `@supabase/supabase-js` client per request, `persistSession:false`, `autoRefreshToken:false`, `detectSessionInUrl:false`, no cookie adapter; it is closed with `signOut({ scope: "local" })` (`:154-156`), which revokes only the throwaway session (the global default would revoke the browser's too).
- **Rate limit before the password check.** `withAuthLimited.ts:213-220`: validate → `checkLimit` → handler. Key `email_change:${user.id}`. Route Test 3 asserts no sign-in on a limited request; Test 10 asserts a malformed body spends no token.
- **`updateUser` only after a verified password.** Every non-success sign-in path returns before `route.ts:213` (`updateUser`). The success path is the only fall-through.
- **Has-password RPC only on `invalid_credentials`, caller's own id.** `route.ts:163-164,178-182`; `p_user_id: user.id` from `getUser()`. The migration revokes PUBLIC/anon/authenticated and grants service_role only; the gate's arms 6/7a cover both directions.
- **Callback fallback is open-redirect safe.** `carriesEmailChangeConfirmed` receives `safeNextPath`'s return value, never the raw parameter (`callback/route.ts:120-124`); tests D/E/F pin top-level-param, off-site and wrong-value cases.
- **Done state only from Auth.** `AccountEmailSection.tsx:234` requires `!shownPending` and renders `email` from the server `getUser()`; the marker alone never asserts success.
- **PKCE verifier cookie.** `updateUser` runs on the cookie-bound server client from `@/lib/supabase/server` inside the Route Handler, so `setAll` writes the verifier cookie as the client-side call used to.
- **Approval gate.** `withAuthLimited` defaults `requireApproval: true`; pending users are already redirected off `/profile` by `(dashboard)/layout.tsx:42-43`, so the gate creates no dead-end.
- **ResetPasswordForm reauth flow has no loop.** One automatic `reauthenticate()` on `reauthentication_needed` in the password step only (`ResetPasswordForm.tsx:77`); the code step never re-sends and never falls back to an un-nonced call; session loss in the code step reaches the no-session panel (R10).

### Findings

#### GR1-MD-01: An expired, already-used or scanner-consumed email-change link still lands a signed-in user on the role home (admin dashboard) [MEDIUM, user-facing]
**File:** `src/app/auth/callback/route.ts:155` (fall-through), with `src/proxy.ts` bounce off `/login`
**Issue:** GD-03 fixed only the `code` branch (a SUCCESSFUL verify whose PKCE exchange fails). When GoTrue's `/verify` itself FAILS for a `pkce_` token, it redirects to `redirect_to` with `error`, `error_code` (for example `otp_expired`) and `error_description` as QUERY parameters and no `code`, `token_hash` or `message`. That reaches `loginRedirect(req, "Missing verification parameters")`; `/login` is public and not bounce-exempt, so the proxy's `getUser()` bounce sends the signed-in user to `ROLE_HOME_ROUTE`, and an admin lands on the admin dashboard. This is the exact symptom the founder reported, reached by common clicks: opening the link a second time, a mail security scanner (Outlook Safe Links and similar) prefetching the GET and consuming the token, or a link older than the OTP expiry. The marker that would route it correctly is already inside `next` (`EMAIL_CHANGE_NEXT`), but this branch never reads it, and no test covers a GoTrue error redirect.
**Fix:** before the final fall-through, reuse the existing predicate:
```ts
if (url.searchParams.get("error_code") || url.searchParams.get("error")) {
  if (carriesEmailChangeConfirmed(safeNext, req)) {
    const dest = new URL(safeNext, req.url);
    dest.searchParams.delete("email_change"); // never claim success from a failed verify
    return NextResponse.redirect(dest);
  }
  return loginRedirect(req, url.searchParams.get("error_description") ?? "Link is invalid or has expired");
}
```
The Account tab then shows the truth from `getUser()` (pending panel if the change did not complete, the new email if a first click already completed it). Add a route test with `?error=access_denied&error_code=otp_expired&next=<marker next>` asserting a `/profile` landing without `email_change=confirmed`, and one without the marker asserting `/login`.

#### GR1-MD-02: The GD-05a "Set a password" detour ends on the role home with no confirmation and no way back to the Account tab [MEDIUM, user-facing]
**File:** `src/components/auth/ResetPasswordForm.tsx:118`; pinned by `ResetPasswordForm.test.tsx` R2 and R9 (`toHaveBeenCalledWith("/login?reset=1")`)
**Issue:** a password-less user who follows the Account tab's "Set a password" link (`AccountEmailSection.tsx:36`) is signed in. On success the form pushes `/login?reset=1`; `updateUser({ password })` keeps the session, so the proxy bounces the signed-in user off `/login` to `ROLE_HOME_ROUTE` and `/home` redirects by role. The `reset=1` success note never renders, and the user is dropped on their dashboard (an admin on the admin dashboard) with no sign the password was set and no route back to finish the email change they started. The same push also means the recovery-link path never shows its `reset=1` note (pre-existing, but this phase now sends a new population through it, and the GD-07 tests pin the destination rather than the outcome).
**Fix:** after a successful `updateUser`, check `supabase.auth.getUser()`; when a user is signed in, push to `/profile?tab=account&password_set=1` (or a `next` passed by the Account-tab link through `/reset-password?next=…`, filtered with the same `safeNextPath` rule) and render a one-line "Your password is set." note there; keep `/login?reset=1` only for the signed-out case. Change R2/R9 to assert the signed-in destination, and add a test that a signed-out success still goes to `/login?reset=1`.

#### GR1-MD-03: GoTrue's sign-in rate limit does not apply "on top" per attacker; it is one shared budget keyed on the server's egress IP [MEDIUM, not user-facing; booking candidate]
**File:** `src/app/api/account/email/route.ts:147-150`; claim in 219-CONTEXT.md GD-02 ("GoTrue's own sign-in rate limit applies on top to `signInWithPassword`")
**Issue:** the verification runs server-side, so GoTrue sees the Vercel function's egress IP, not the caller's. Two consequences. (a) GoTrue's per-IP sign-in limit adds no per-attacker brute-force protection; the only bound on a stolen session is the Upstash 5/60 s per-user limit (7,200 guesses a day, no lockout). (b) Every user's email-change verification draws on the same per-IP sign-in budget. A few signed-in accounts sending 5 attempts a minute each can exhaust it, after which every user's correct password is answered `over_request_rate_limit` → `verify_unavailable` 502 ("Could not check your password") until the window passes. GD-02's text records the opposite, and a reviewer of the "Secure email change OFF" decision (GD-06a) may rely on that sentence.
**Fix:** correct GD-02's sentence (the per-user Upstash limiter is the only brute-force bound). Optionally add a second, longer-window per-user limiter for failed verifications only (for example 20 per hour, consumed when `invalid_credentials` comes back), so a stolen session cannot run 7,200 guesses a day and cannot drain the shared GoTrue budget. Record the shared-budget DoS as a known limit if no limiter is added.

#### LOW / INFO (recorded here only, per the 2026-11-14 rule; not booked)

- **GR1-LW-01** `route.ts:129-130,200-206` + route Test 8: an account with NO email and a password is told "That password is not right" although no password was checked. Unreachable today (no phone auth), but the response lies; a `no_email` code would be honest.
- **GR1-LW-02** `AccountEmailSection.tsx:131-136`: `closeForm` ("Keep current email") does not clear `password`, so the typed password stays in state and is pre-filled (masked) on reopen, contrary to the component's own header ("held in state only until the response arrives").
- **GR1-LW-03** `AccountEmailSection.tsx:192-205`: a 401 (session expired), 403 (CSRF/approval), 503 (limiter misconfig) or the wrapper's 400 schema error (zod `z.email()` rejects some addresses the browser's `type=email` accepts, for example `user@localhost`) all fall to "Could not send the confirmation link. Please try again.", which invites a retry that cannot succeed. A 401 should say to sign in again; a 400 without `code` should say the address is not valid.
- **GR1-LW-04** `callback/route.ts:122-124`: the marker path drops the exchange error silently. A `console.warn` with `error.code` would let PROD logs tell `flow_state_expired` (expected) from a missing-verifier or other failure.
- **GR1-LW-05** `ResetPasswordForm.tsx:100-110` (R7): on a non-nonce error in the code step (for example `weak_password`) the typed code is cleared although the nonce is likely still valid, so the user must re-read the email for the same code.
- **GR1-LW-06** `(auth)/reset-password/page.tsx`: a signed-in user arriving from the Account tab sees "Set a new password" and "Back to sign in"; the latter bounces them to the role home.
- **GR1-IN-01** migration `SET search_path = public, pg_catalog`: `public` ahead of `pg_catalog` lets a `public` object shadow a catalog name or operator if anyone ever gains CREATE on `public`. `SET search_path = ''` with the already schema-qualified `auth.users` is the stricter idiom. Not exploitable today (no CREATE on `public` for client roles).
- **GR1-IN-02** `route.ts:217-222`: `update_failed` passes GoTrue's message through (for example "A user with this email address has already been registered"), which confirms an address exists. Behind a verified password and the per-user limiter, so the enumeration value is small; it matches the pre-gap client behaviour.

### Test quality

Route tests can fail on the logic that matters: Test 2 proves no `updateUser` on a wrong password, Test 3 proves the limiter runs before sign-in, Test 5 proves the RPC uses the `getUser` id, Test 7 proves a non-credential error never becomes "wrong password". Callback tests D/E/F are real negative cases. The SQL gate's RED-UNDER arms bite the body, security mode, search_path and both grant directions. Gaps: no callback test for a GoTrue error redirect (GR1-MD-01); R2/R9 pin `/login?reset=1`, which encodes GR1-MD-02 instead of catching it.

### Counts (gap round 1)

| Severity | Count |
|---|---|
| Critical / High | 0 |
| Medium | 3 (GR1-MD-01 user-facing, GR1-MD-02 user-facing, GR1-MD-03 not user-facing) |
| Low | 6 |
| Info | 2 |

### Round 1 fixes (server)

| Finding | Fix | Commit |
|---|---|---|
| GR1-MD-01 | `src/app/auth/callback/route.ts`: GoTrue `error` / `error_code` redirect with the marker in the accepted `next` lands on `next` minus `email_change`; without the marker, unchanged | `2e7deef77` |
| SFH-M1 | same file: failed-exchange-with-marker path logs `error.code` / `error.status` only | `2e7deef77` |
| SFH-M2 | `src/app/api/account/email/route.ts`: `updateUser` failure logs code and status; status 429 gives HTTP 429, status >= 500 gives HTTP 502, others 400 | `d2c80136d` |
| SFH-M3 | same file: `createAdminClient()` plus rpc share one try/catch, message logged, existing `verify_unavailable` 502 | `d2c80136d` |

Each fix has a test that went RED against the pre-fix route and GREEN after restore (callback tests H, J, K, L; email route Tests 15, 16). Callback MD-01/M1 and email M2/M3 share a commit each because they share a route file and its test file.

### Round 1 fixes (client)

| Finding | Fix | Commit |
|---|---|---|
| GR1-MD-02 = SFH-M5 | `ResetPasswordForm.tsx`: after a successful `updateUser`, a user in the answer (`data.user`) goes to `/profile?tab=account&password_set=1`, none keeps `/login?reset=1`; `ProfileTabs.tsx` reads `password_set` and `AccountEmailSection.tsx` shows `Your password is set.` | `cd894a41e` |
| SFH-M4 = GR1-LW-03 | `AccountEmailSection.tsx`: 401 gives `Your session expired. Sign in again.`, 503 gives `Email change is unavailable right now. Please try again later.`; a 429 carrying `update_failed` (the server fixer's Auth 429) shows Auth's message, a 502 `update_failed` already did; 403 and a code-less 400 stay generic. UI-SPEC copy contract updated with a dated revision line | `080c32970` |

Each fix has a test that went RED when neutered and GREEN after restore from a byte backup (`ResetPasswordForm.test.tsx` happy path, R2, R9 now pin the Account-tab destination plus a signed-out `/login?reset=1` case; `ProfileTabs.test.tsx` and `AccountEmailSection.test.tsx` for the note and the status lines). The UI-SPEC edit rides in the second commit.

_Reviewed: 2026-11-20_
_Reviewer: Claude (gsd-code-reviewer), gap round 1_

## Gap review round 2 (2026-11-20)

**Scope:** fix diffs `git diff 6561e26a8..HEAD -- . ':!.planning'` (10 files: commits `2e7deef77`, `d2c80136d`, `cd894a41e`, `080c32970`; MD-03 as the GD-02 correction in `4e328cb8a`), read against the full gap diff `git diff origin/main...HEAD -- . ':!.planning'`. **Depth:** deep on the touched paths (callback → proxy bounce; email route → `withAuthLimited` 429/503 split → client status mapping; `/reset-password` → `/profile?tab=account`). **Reviewer:** Claude (gsd-code-reviewer), gap round 2.

### Round-1 MEDIUMs: verified fixed, each with a test that fails

| Finding | Verdict | Evidence |
|---|---|---|
| GR1-MD-01 (user-facing) | **Fixed** | `src/app/auth/callback/route.ts` final branch: `error` or `error_code` AND `carriesEmailChangeConfirmed(safeNext)` → `safeNext` with `email_change` deleted; reads the filtered `safeNext`, never the raw param, so the open-redirect guard still holds; without the marker it still goes to `/login`. Neutered the condition to `false` in a byte-backed copy: callback tests **H** and **J** went RED (2 failed / 30), GREEN after restore. |
| GR1-MD-02 (user-facing) | **Fixed** | `ResetPasswordForm.tsx` pushes `/profile?tab=account&password_set=1` when `updateUser` returns a user; `ProfileTabs.tsx` passes `password_set === "1"`; `AccountEmailSection.tsx` renders `Your password is set.` with `role="status"`. The Account tab has no `allocatorOnly`, so every role reaches it. Neutered the push back to `/login?reset=1`: 3 of 14 `ResetPasswordForm.test.tsx` tests went RED, GREEN after restore. |
| GR1-MD-03 (not user-facing) | **Resolved as recorded** | GD-02 carries a dated CORRECTED note: the per-user limiter is the only brute-force bound, and the shared per-IP GoTrue budget is recorded for the founder beside GD-06a. No limiter was added, which the fix allowed. |
| SFH-M1..M5 | **Fixed** | M1: the marker-path exchange failure logs `code`/`status` only. M2: `updateUser` failure logs code/status, 429 → 429, >= 500 → 502, else 400. The client shows Auth's text for a 429 `update_failed` and the generic code branch already covers 502. M3: `createAdminClient()` and the rpc share one try/catch → `verify_unavailable` 502, message only. M4: 401/503 copy, where 503 matches `withAuthLimited`'s misconfig split. M5 = MD-02. |

All five affected test files pass at HEAD: 127/127 (`npx vitest run` on the email route, callback, AccountEmailSection, ProfileTabs and ResetPasswordForm tests).

### New findings

No CRITICAL, HIGH or MEDIUM. Nothing in the fix diffs logs or returns the password, widens the redirect target set or changes the order "limiter, then password check, then `updateUser`".

#### LOW / INFO (recorded here only, per the 2026-11-14 rule; not booked)

- **GR2-LW-01** `ResetPasswordForm.tsx` push: `updateUser` needs a session and returns `data.user` on every success, so the `/login?reset=1` arm cannot be reached in practice. The "signed-out success" test pins a mock-only state. Recovery-link users now also land on the Account tab with the note. That is better than the old role-home bounce, but the `/login?reset=1` note is effectively retired, so say so rather than keep a dead arm.
- **GR2-LW-02** `AccountEmailSection.tsx` `passwordSet`: the note comes from the URL alone and survives a reload. That is harmless because it claims nothing about email state, but it is the one note on the tab that does not follow GD-04's "only Auth asserts" stance.
- **GR2-LW-03** `api/account/email/route.ts` status map: an `AuthRetryableFetchError` (network failure to GoTrue, `status` 0) maps to 400 `update_failed` with a raw fetch message, where 502 would be the honest code. The client still shows a retryable line.
- **GR2-IN-01** `auth/callback/route.ts` MD-01 branch: the user who arrives from a failed verify sees the Account tab's current state (the pending panel or the new email) with no line saying the link had expired or was already used. The state is correct and only the explanation is missing.
- **GR2-IN-02** `auth/callback/route.ts` SFH-M1 log: `flow_state_expired` is the expected outcome on this path (GD-03), so the `console.error` level will be routine noise in PROD logs. `warn` would separate it from real failures.

### Counts (gap round 2)

| Severity | Count |
|---|---|
| Critical / High | 0 |
| Medium | 0 |
| Low | 3 |
| Info | 2 |

**Converged:** no MEDIUM or higher remains in the gap code.

_Reviewed: 2026-11-20_
_Reviewer: Claude (gsd-code-reviewer), gap round 2_
