---
phase: 219-accountemail-the-signed-in-account-shows-its-email-and-can-c
plan: 05
subsystem: auth
tags: [next-route, supabase-auth, pkce, open-redirect, gap-closure]
status: complete

requires:
  - phase: 219 plan 02/03
    provides: /auth/callback code branch, message (first-link) branch, safeNextPath
provides:
  - "/auth/callback code branch: a failed exchangeCodeForSession whose safeNextPath-filtered next carries email_change=confirmed redirects to next; otherwise /login?error as before"
  - "private helper carriesEmailChangeConfirmed(safeNext, req) beside safeNextPath"
  - "GD-03 describe block, tests A to G, in src/app/auth/callback/route.test.ts"
affects: [219-06 emailRedirectTo builds the marker-bearing next, 219-07 ProfileTabs reads email_change]

plan_head_before: 170358da2092381874c9c1ebc26a1eba7e68a3ff
plan_head_after: fc0d6c2733a41196aea1fdf82ff79631f889a2f6

actuals:
  tokens: 3000
  tasks: 2
  commits: 2

key-files:
  created: []
  modified:
    - src/app/auth/callback/route.ts
    - src/app/auth/callback/route.test.ts

key-decisions:
  - "The marker is read from the value safeNextPath returned (parsed against req.url), never from the raw next parameter, so the marker cannot widen the open-redirect guard (T-219-19)"
  - "The helper is used by the code branch only; token_hash, message and missing-parameters branches are untouched"
  - "The marker-bearing next literal is inlined in tests A, C, E and G rather than shared through a constant, so each case is readable alone and the plan's grep gate counts four lines"

requirements-completed: [GD-03, GD-04]

duration: 20min
completed: 2026-11-20
---

# Phase 219 Plan 05: failed PKCE exchange with the email-change marker lands on next Summary

A late click on the final email-change link (GoTrue 422 flow_state_expired after Auth already completed the change) now lands on /profile?tab=account&email_change=confirmed instead of /login, so the proxy no longer bounces the signed-in user to the role home page. Every other failed exchange still lands on /login?error.

## What changed

- `src/app/auth/callback/route.ts`: new private `carriesEmailChangeConfirmed(safeNext, req)` beside `safeNextPath` (doc comment states the measured root cause and why it is safe), one `if` in the `if (code)` error path, and one sentence in the file header. `safeNextPath` is byte-identical to PLAN_BASE (the diff hunks sit at the header, after the function, and inside `GET`).
- `src/app/auth/callback/route.test.ts`: GD-03 describe block with A (failed exchange + marker lands on /profile), B (no marker still /login with the Supabase message), C (success keeps the marker), D (top-level marker only: /login), E (protocol-relative next with marker: /login, never evil.example, never /onboarding), F (marker value `partial` in next: /login), G (first-link message branch: exactly one `email_change` value, `partial`).

## Evidence (tests can fail)

PLAN_BASE `170358da2092381874c9c1ebc26a1eba7e68a3ff`.

Task 1, RED on the unedited tree (tests written first):

```
AssertionError: expected '/login' to be '/profile' // Object.is equality
 ❯ src/app/auth/callback/route.test.ts:256:26   (Test A; B and C passed)
```

Task 1 neuter: hand-edited the repo copy to `if (false && carriesEmailChangeConfirmed(...))`, Test A went RED with the same line (`Tests  1 failed | 20 passed (21)`), restored from the byte backup with `cp -p`, `cmp` exit 0, re-run `Tests  21 passed (21)`.

Task 2 neuter: hand-edited the helper call to read the RAW next (`url.searchParams.get("next") ?? ""`), Test E went RED:

```
× E: a marker inside a next that safeNextPath rejects still lands on /login, never off-site
AssertionError: expected '/onboarding' to be '/login' // Object.is equality
Tests  1 failed | 24 passed (25)
```

Restored from the byte backup with `cp -p`, `cmp` exit 0 (and byte-equal to the Task 1 backup), re-run `Tests  25 passed (25)`.

## Verification

- `npx vitest run src/app/auth/callback/route.test.ts`: 25 passed (25), including the pre-existing open-redirect, D-04 encoded-next and MD-01 message cases unchanged.
- `npx tsc --noEmit`: exit 0.
- `grep -ac 'email_change' src/app/auth/callback/route.ts`: 8 (gate: more than 4).
- `grep -ac 'email_change%3Dconfirmed' src/app/auth/callback/route.test.ts`: 4 (gate: at least 4).
- `git diff --name-only 170358da..HEAD`: only the two planned files.

## Deviations from Plan

None in behaviour. Two environment notes, neither a code deviation:

- The worktree had no `node_modules`; I symlinked the main checkout's (`node_modules`, gitignored, not committed) to run vitest and tsc.
- The per-plan commit ledger file under the git dir could not be written (the harness refuses writes outside the worktree), so `plan_head_before` is the PLAN_BASE hash recorded before the first edit and `commits: 2` was measured with `git rev-list --count 170358da..HEAD`.

Commit messages carry no attribution trailers, per the project rule (it overrides the generic attribution reminder).

## Known Stubs

None.

## Threat Flags

None. The change adds no endpoint, no session minting and no write; T-219-19 (open redirect) is covered by tests D and E, T-219-21 by construction (the branch calls nothing before the redirect), T-219-20 by plan 219-07's getUser() check.

## Manual UAT (founder, routed, D-12)

On TEST, request an email change, wait longer than the PKCE flow-state lifetime, click the final link while signed in: it should land on /profile?tab=account (needs plans 219-06 and 219-07). No Supabase dashboard or Auth setting was read or changed.

## Self-Check: PASSED

Files present: route.ts, route.test.ts, this SUMMARY. Commits `5520e490d` and `fc0d6c273` are ancestors of HEAD.
