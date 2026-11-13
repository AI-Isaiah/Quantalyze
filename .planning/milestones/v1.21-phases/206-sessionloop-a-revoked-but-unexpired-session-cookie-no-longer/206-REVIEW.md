---
phase: 206-sessionloop-a-revoked-but-unexpired-session-cookie-no-longer
reviewed: 2026-11-11T00:10:00Z
depth: deep
files_reviewed: 2
files_reviewed_list:
  - src/proxy.ts
  - src/proxy.test.ts
findings:
  critical: 0
  warning: 0
  info: 0
  total: 0
  necessity: 0
status: clean
---

# Phase 206: Code Review Report

**Reviewed:** 2026-11-11T00:10:00Z
**Depth:** deep
**Files Reviewed:** 2
**Status:** clean (no MEDIUM or higher findings; LOW/INFO deliberately not listed, per the brief)

## Code review (gsd-code-reviewer)

Scope: `git diff 448ad3b6d..HEAD -- src/` (commits `914862015`, `b5b09d476`) in the worktree on
`feat/206-sessionloop`. Read against 206-CONTEXT.md D-01..D-05, 206-01-PLAN.md, 206-RESEARCH.md
and WR-01-R3. `npx vitest run src/proxy.test.ts`: 130/130 pass.

Also read: WR-01-R3 in `199-REVIEW-R3.md` (its loop shapes and triggers match section 1
below), the `206-01-PLAN.md` `must_haves.truths`, the worktree's `CLAUDE.md` and `AGENTS.md`
(byte-identical to the main checkout's), `node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md`,
and `necessity-review.md`. The proxy guide says proxy is "not intended for slow data fetching".
The one `GET /user` added here runs only for cookie holders on four routes, and the `/` page
already makes the same call with no timeout (`src/app/(marketing)/page.tsx:69-72`). It is below
the bar.

Necessity was assessed. The new branch guards a state that does occur (a revoked but unexpired
cookie, `session_not_found`), so it carries no necessity finding.

### No MEDIUM, HIGH or CRITICAL findings

The questions the brief asked, each answered from source:

**1. Every loop shape closed?** Yes. A refused cookie can only loop when one hop sends it
back to a bounced route (`/`, `/login`, `/signup`, `/forgot-password`) and the proxy sends it
out again. With the fix, the proxy redirects out of those four routes only after `getUser()`
returns a user. That is the same check the pages make, so for a refused session the cycle stops
at the bounced route.
- `/` ↔ `/home`: `/home` is bounce-exempt (`src/proxy.ts:124,160`) and refuses with
  `redirect("/")` (`src/app/home/page.tsx:43`). The proxy then falls through on `/`, and the
  marketing page's own `getUser()` (`src/app/(marketing)/page.tsx:69-76`) renders the page
  instead of redirecting. Closed.
- `/login?redirect=` ↔ guarded page: every server redirect to `/login...` in `src/app` is gated
  on `!user` (strategies/discovery layouts, admin pages, `/onboarding:25`,
  `/pending-approval:57`). The proxy falls through on `/login`, and the login page only
  redirects after a successful `exchangeCodeForSession` (`src/app/(auth)/login/page.tsx:27-34`).
  Closed.
- `/signup`, `/forgot-password`: their pages have no server auth redirect. The proxy falls
  through, so they cannot loop.
- `!session && !isPublicRoute` → `/login` (`src/proxy.ts:81-85`): unchanged. With a refused
  cookie, a guarded page takes one `!user` hop to `/login`, and `/login` now renders. No
  `requireRolePage` path redirects a valid user to a bounced route: its wrong-role arm goes to
  `roleSurfaceHome(role)`.
- Other cookie-only deciders. `grep -arn "getSession()" src --include='*.ts' --include='*.tsx'`
  minus tests finds one real call outside the proxy: `ForQuantsCtas.tsx:118`. It only picks a CTA
  label and never redirects. In client code, the only `router.push`/`router.replace` calls to a
  bounced route are `SignOutButton.tsx:26` (after `signOut()`) and `ResetPasswordForm.tsx:69`,
  and both are user actions. The only `onAuthStateChange` listener (`WizardClient.tsx:601`) sets a
  flag and does not navigate. No second cookie-only redirect exists that could keep a loop alive.

**2. Does `getUser()` throw?** Effectively no, so the missing `try/catch` is correct. In
`@supabase/auth-js` 2.118.0, `_getUser` (`GoTrueClient.ts:3247-3287`) catches every
`AuthError` and returns `{ data: { user: null }, error }`. `session_not_found` maps to
`AuthSessionMissingError` (`lib/fetch.ts`, `handleError`). A fetch rejection, a 5xx or a 52x
becomes `AuthRetryableFetchError`, a non-JSON body becomes `AuthUnknownError` or
`AuthRetryableFetchError`, and every one of those is an `AuthError`. All of these extend
`CustomAuthError`/`AuthError` and carry `__isAuthError`, so `isAuthError` holds
(`lib/errors.ts:50-52,93,134,290`). Only a non-`AuthError` throw propagates. The public wrapper
around `_getUser` matches `getSession()`'s (`GoTrueClient.ts:2875-2886` vs `3223-3245`): it awaits
`initializePromise`, and it takes `_acquireLock` only when a custom `lock` is configured, which
`@supabase/ssr` does not do. Both reach `_useSession`/`__loadSession`, so the `getSession()` call at
`src/proxy.ts:69-71` already carries the same exposure. `_removeSession()` runs inside the catch
(`GoTrueClient.ts:5265-5288`). It does storage removals into ssr's in-memory maps and then calls
`_notifyAllSubscribers('SIGNED_OUT')`, which ends in the proxy's `setAll`. `setAll` makes plain
cookie-jar writes, and nothing there plausibly throws. `throwOnError` defaults to `false` (`GoTrueClient.ts:212`)
and neither `proxy.ts` nor `@supabase/ssr` sets it.

**3. Cookie handling.**
- Calling `getUser()` writes no new cookies on the success path. `@supabase/ssr` server storage
  reads its pending `setItems` first (`ssr/src/cookies.ts:446-452`). So if `getSession()` already
  refreshed, `getUser()` sees the rotated token and makes one `GET /user` with no second refresh.
- The redirect arm (`src/proxy.ts:181-189`) still returns a fresh `NextResponse.redirect`, which
  drops any refresh cookies `getSession()` wrote to `supabaseResponse`. This is
  **pre-existing and unchanged**: the arm loses exactly the cookies it lost before. The fix adds
  no cookie write to this arm. What the next request does with the old refresh token was not
  verified against GoTrue, and it is out of scope by CONTEXT (Integration Points note).
- The fall-through arm is new and returns `supabaseResponse`, so the cookies the library writes
  there reach the browser. For `session_not_found`, `_getUser` calls `_removeSession()`, which
  fires `SIGNED_OUT` and makes `@supabase/ssr` apply the pending deletions through the proxy's
  `setAll` (`ssr/src/createServerClient.ts:188-210`). The cookie change is strictly additive, so
  nothing got worse. The code does not assert the clearing, which keeps it consistent with D-02.

**4. Do the tests encode intent and fail on regression?** Yes.
- The refused-session matrix asserts `200` with no `location` on all four bounced routes,
  including `/login?redirect=`, for both outcomes: null user, and null user with an error.
  Remove the `if (user)` and every case turns into a 307, so the suite goes RED. Remove the
  `getUser` call and `toHaveBeenCalledTimes(1)` goes RED.
- The confirmed-user arms compare against literals (`"/home"`, `"/discovery/crypto-sma"`), never
  against the constant, and assert that the `redirect` param is dropped.
- The D-03 scope pin: `getUser` is not called on the bounce-exempt routes when a session is
  present. Moving `getUser` above the branch also fails loudly in the anonymous describes,
  because their mocks have no `getUser` (`src/proxy.test.ts:101-109`).
- The shared stub is `mockReset` and then gets an explicit resolved value in `beforeEach`, which
  avoids the "bare `vi.fn()` returns undefined" pitfall named in RESEARCH Pitfall 2.

---

_Reviewed: 2026-11-11T00:10:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

## Silent-failure hunt (silent-failure-hunter)

No MEDIUM+ findings. Scope: `git diff 448ad3b6d..HEAD -- src/` (src/proxy.ts bounce branch, src/proxy.test.ts). One line of reasoning per area:

- getUser throwing vs returning error: auth-js `_getUser` (GoTrueClient.ts:3247) catches every AuthError (incl. AuthSessionMissingError, AuthApiError, AuthRetryableFetchError from a failed fetch) and RETURNS `{user:null, error}`; only a non-AuthError is rethrown. The proxy destructures `data.user` without a try/catch, so a non-AuthError throw would 500 `/`. Not MEDIUM: fetch failures are wrapped as AuthRetryableFetchError, so the rethrow path is theoretical, and `getSession()` just above has the same unguarded exposure (pre-existing, same failure class).
- Auth-server outage shows the login form/marketing page to a valid user: an outage returns AuthRetryableFetchError or AuthApiError, so user is null and the branch falls through (D-02, intended). Not stuck: the page-level guards already decide with getUser() and behave identically (/home sends to /, discovery sends to /login), so the proxy no longer disagrees with them. Silent by D-04; user-harm is limited to seeing the login form during an outage, where login would fail anyway. LOW.
- Recovery for a revoked session: for AuthSessionMissingError, auth-js calls `_removeSession()` itself, which writes expiring cookies via the proxy's `setAll` onto `supabaseResponse`, and the fall-through returns that response. So the stale cookie is in practice cleared by the library, not the proxy; the user self-heals. This makes the code comment ("proxy does not clear the cookie") slightly imprecise (LOW, comment only) and means the test mocks do not model cookie clearing. No data-integrity impact.
- Hang risk: the branch now awaits a network call on `/`, `/login`, `/signup`, `/forgot-password` for cookie holders, with no timeout, so a degraded auth server delays those pages instead of an instant 307. LOW: the destination pages (/home, guarded layouts) already pay the same getUser round trip, and D-03 scopes it to four routes.
- Token refresh on redirect: `NextResponse.redirect` in the confirmed-user branch does not carry cookies that `getUser` may refresh onto `supabaseResponse`. Pre-existing (getSession() already refreshes before the branch), not introduced by this diff, so out of scope.
- Test vacuity: the loop-case tests assert status 200, null `location`, and `getUser` called exactly once, across 5 paths x 2 outcomes. Removing the getUser confirmation makes them redirect (307), so they go RED; the confirmed-user tests pin literal `/home` and the redirect-param drop; D-03 tests assert `getUser` not called on exempt routes. The "unreachable auth server" label on the AuthSessionMissingError case is inaccurate (an outage yields AuthRetryableFetchError, never exercised), but both produce user:null, which is the only branch input that matters. LOW, no action needed.
