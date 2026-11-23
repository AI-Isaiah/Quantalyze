---
phase: 219-accountemail-the-signed-in-account-shows-its-email-and-can-c
plan: 06
subsystem: auth
tags: [next-route, supabase-auth, rate-limit, password-gate, gap-closure]
status: complete

requires:
  - phase: 219 plan 04
    provides: public.auth_user_has_password(p_user_id uuid) RETURNS boolean (service_role only)
  - phase: 219 plan 05
    provides: /auth/callback reads the email_change=confirmed marker on a failed exchange
provides:
  - "POST /api/account/email: withAuthLimited route (limiter email_change:<user id>) that verifies the current password before updateUser"
  - "wire contract statuses 200, 400 same_address / wrong_password / update_failed, 409 password_not_set, 502 verify_unavailable (plus the wrapper's 401, 403, 400 issues, 429, 503)"
  - "WRAPPER entry account/email/route.ts in limiter-ordering.test.ts; no-store allowlist entry (38 -> 39 routes)"
affects: [219-07 AccountEmailSection posts { email, password } here and routes a 409 to /reset-password]

plan_head_before: 199110c21a4f21edaadc8b4b446d26a199d57a7b
plan_head_after: 63e7bd9b9df8572db8f0ea06ad53ba07619b1461

actuals:
  tokens: 6200
  tasks: 2
  commits: 2

key-files:
  created:
    - src/app/api/account/email/route.ts
    - src/app/api/account/email/route.test.ts
  modified:
    - src/lib/api/limiter-ordering.test.ts
    - src/__tests__/no-store-coverage.test.ts

key-decisions:
  - "Password verified with signInWithPassword on a per-request @supabase/supabase-js client (persistSession, autoRefreshToken, detectSessionInUrl all false, no cookie adapter); the throwaway session is closed with signOut({ scope: \"local\" }) only"
  - "Only invalid_credentials reaches the has-password RPC; any other sign-in error, an RPC error or a non-boolean answer is a 502, never a wrong-password lie"
  - "emailRedirectTo origin comes from a local copy of resolveAppUrl (Origin ?? Referer, already validated by assertSameOrigin, then NEXT_PUBLIC_APP_URL, then localhost)"
  - "A missing NEXT_PUBLIC_SUPABASE_URL / ANON_KEY on the server answers 502 verify_unavailable with one log line (fail loud) rather than throwing"

requirements-completed: [GD-01, GD-02, GD-03, GD-05a]

duration: 25min
completed: 2026-11-20
---

# Phase 219 Plan 06: POST /api/account/email checks the current password before it sends the link Summary

The email change now goes through a server route that rate-limits by user id, proves the current password with Supabase Auth on a throwaway cookie-less client, tells a password-less account apart from a wrong password through `auth_user_has_password` (the caller's own id), and only then calls `updateUser` on the cookie-bound client with the `email_change=confirmed` marker. A wrong password sends no link.

## What changed

- `src/app/api/account/email/route.ts` (new): `withAuthLimited` POST (CSRF, getUser, approval gate, zod body `email` trimmed, `z.email()`, max 254 / `password` 1 to 1024, `maxBytes: 4096`, then `userActionLimiter` keyed `email_change:${user.id}`). Handler order: same-address check (trim, case-insensitive), password check on the verifier, has-password branch on `invalid_credentials`, `updateUser({ email }, { emailRedirectTo })`. Every local response carries `NO_STORE_HEADERS`. File doc comment records GD-01/02/03/05a, the GoTrue wrong-versus-absent-password ambiguity, GD-06a and the never-logged password.
- `src/app/api/account/email/route.test.ts` (new): 14 tests, one per behaviour line of the plan.
- `src/lib/api/limiter-ordering.test.ts`: `account/email/route.ts` in WRAPPER (no count pin exists there; `grep -anE 'toBe\([0-9]+\)'` over it matched nothing).
- `src/__tests__/no-store-coverage.test.ts`: allowlist entry, title and pin 38 -> 39, dated lineage comment.

## Evidence (tests can fail)

Task 1 RED, route absent, before any route code:

```
Error: Failed to resolve import "./route" from "src/app/api/account/email/route.test.ts". Does the file exist?
 Test Files  1 failed (1)
      Tests  no tests
```

Task 1 GREEN: `route.test.ts` 4 tests plus `limiter-ordering.test.ts`, 10 passed.

Task 1 neuter (wrong_password return removed so the true answer falls through to updateUser), backup `route.t1.bak` in the scratchpad:

```
× Test 2: wrong password answers 400 wrong_password and sends nothing
AssertionError: expected 200 to be 400 // Object.is equality
Tests  1 failed | 3 passed (4)
```
Restore `cp -p` then `cmp` exit 0, re-run green (10 passed). The first assertion to trip is the status (200 means updateUser ran and sent the link); the explicit `updateCalls` length assertion sits right after it.

Task 2 neuter (`hasPassword === false` made unreachable, so a password-less account answers wrong_password), backup `route.t2.bak`:

```
× Test 5: a password-less account is told to set a password, using only the getUser id
× Test 8: an account with no email skips the sign-in and lets the has-password answer decide
× Test 14: the 200, wrong_password and password_not_set answers are no-store
AssertionError: expected 400 to be 409 (x3)
Tests  3 failed | 11 passed (14)
```
Restore `cp -p` then `cmp` exit 0, re-run green.

Tests 5 to 14 passed on first run against the Task 1 route (they exercise branches Task 1 already implemented); no route defect was found and no test was loosened.

## Gates run (all in this worktree)

- `npx vitest run src/app/api/account/email/route.test.ts` : 14 passed.
- `npx vitest run` over route.test.ts, audit-coverage, no-store-coverage, limiter-ordering, admin-csrf-ratelimit-grep, rbac-matrix-unit, critical-regressions : 7 files, 322 tests passed. audit-coverage needed no pragma (the has-password RPC is a read).
- `npx tsc --noEmit` : no output.
- `npm run lint` : exit 0, 0 errors, 4 warnings, all in files this plan did not touch (`src/lib/factsheet/composite-read-path.ts`, `src/lib/queries.stale-analytics-detail.test.ts`, and two others pre-existing); none in the four files of this plan.
- Acceptance greps over code lines of route.ts: `scope: "local"` 1, `signOut()` 0, `persistSession: false` 1. `grep -ac 'account/email/route.ts'` is 1 in both census files, `MUST_STAMP_NO_STORE.length).toBe(39)` is 1.

## Deviations from Plan

None - plan executed exactly as written. Small implementation choices inside the plan's latitude: the no-email case is `!user.email` (supabase `User.email` is `string | undefined`, not only null), and a missing Supabase env answers 502 verify_unavailable.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register: the one new trust boundary (service-role has-password read about the caller's own id) is T-219-28. No auth.users / profiles write, no dashboard or Auth setting touched.

## Hand-off

- GD-06a (ship step, not code): CHANGELOG `### Notes` records that Supabase Auth's own `PUT /user` still accepts an email change from any valid session token; the PR body says the two-link flow still runs until the coordinator turns Secure email change OFF after merge.
- Plan 219-07: POST `{ email, password }` to `/api/account/email`; branch on `code`; a 409 `password_not_set` points to `/reset-password` (planner decision 6).
- Untested live: a real `signInWithPassword` against Supabase Auth and the real `updateUser` cookie/PKCE-verifier behaviour are mocked here; the coordinator's post-merge check covers them.

## Self-Check: PASSED

- FOUND: src/app/api/account/email/route.ts, route.test.ts
- FOUND commits: b8221b9f7 (feat), 63e7bd9b9 (test), both ancestors of HEAD
