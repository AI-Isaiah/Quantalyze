---
phase: 206-sessionloop-a-revoked-but-unexpired-session-cookie-no-longer
plan: 01
subsystem: auth
tags: [supabase, nextjs-proxy, session, redirect-loop, vitest]

requires:
  - phase: 199-managerhome
    provides: the signed-in bounce branch and the role-home route that WR-01-R3 found looping
provides:
  - the proxy signed-in bounce branch confirms the session with getUser before redirecting
  - a refused-session test matrix, a confirmed-user arm and getUser scope pins in src/proxy.test.ts
affects: [proxy, login, home, landing]

requirements-completed: []

actuals:
  tokens: 1757
  tasks: 2
  commits: 2
plan_head_before: 448ad3b6db8af3f49399224c8104670eec4868ab
plan_head_after: b5b09d4769149264b6865bc084a846ccc9c97f2a
commits: 2

tech-stack:
  added: []
  patterns:
    - "cookie-only getSession for gating, getUser only where a redirect needs the auth server's confirmation"

key-files:
  created: []
  modified:
    - src/proxy.ts
    - src/proxy.test.ts

key-decisions:
  - "D-01 (orchestrator default, founder may revisit): fix only in the proxy signed-in bounce branch, not /home or the page guards"
  - "D-02 (orchestrator default, founder may revisit): getUser null user or error falls through and renders the public page; no cookie clearing and no sign-out in the proxy"
  - "D-03 (orchestrator default, founder may revisit): getUser runs only inside that branch; every other route stays cookie-only"
  - "D-04 (orchestrator default, founder may revisit): no new logging or Sentry in the proxy"
  - "D-05 (orchestrator default, founder may revisit): tests live in src/proxy.test.ts and go RED when the confirmation is removed"

duration: 12min
completed: 2026-11-10
status: complete
---

# Phase 206 Plan 01: SESSIONLOOP Summary

**The proxy's signed-in bounce now confirms the session with `supabase.auth.getUser()` and redirects only on a user, so a revoked-but-unexpired session cookie renders `/`, `/login`, `/signup` and `/forgot-password` instead of looping to ERR_TOO_MANY_REDIRECTS.**

## Performance

- **Duration:** about 12 min
- **Tasks:** 2 (1 tracer, 1 auto), both TDD
- **Files modified:** 2 source files (`src/proxy.ts`, `src/proxy.test.ts`)

## Accomplishments

- `src/proxy.ts`: one hunk inside the `session && isPublicRoute && !isApiRoute && !isAuthBounceExempt` branch. It awaits `supabase.auth.getUser()`, binds `data.user`, and wraps the existing five redirect statements (unchanged apart from indentation) in `if (user)`. A null user or an error falls through to `return supabaseResponse`. No import, no logging, no cookie operation, no try/catch.
- `src/proxy.test.ts`: a shared `getUser` spy defaulting to a confirmed user (so the six existing bounce executions keep their meaning), a refused matrix of 5 paths by 2 outcomes (10 cases), two confirmed-user tests, and five D-03 scope pins (113 to 130 tests).
- RED proof of the tests: a RED-first run before the fix, plus two neuters restored byte-identical.

## Task Commits

1. **Task 1 (tracer): refused session renders `/` through the real proxy()** - `914862015` (`fix(206)`)
2. **Task 2: matrix, confirmed arm, scope pins** - `b5b09d476` (test(206))

## Evidence

```
gc-206-baseline: proxy_tests=113 four_file_tests=174 proxy_sha256=ff7a393313ba2236f1bd7220092cbb002927ac1a7b2bca5af0b39f01c6ce169e
gc-206-red-first: failed=1 passed=113 total=114 case=/
gc-206-green-tracer: proxy_tests=114
gc-206-green: proxy_tests=130 four_file_tests=191
gc-206-neuter: mutation=confirm_always_true failed=10 passed=120 sha256_before=34502492f5b3cc52c46370d11ddef5a024e4b2867c2a345e85102a6fc056b2e2 sha256_after=34502492f5b3cc52c46370d11ddef5a024e4b2867c2a345e85102a6fc056b2e2 restored=identical
gc-206-neuter: mutation=confirm_hoisted_to_every_session failed=5 passed=125 sha256_before=34502492f5b3cc52c46370d11ddef5a024e4b2867c2a345e85102a6fc056b2e2 sha256_after=34502492f5b3cc52c46370d11ddef5a024e4b2867c2a345e85102a6fc056b2e2 restored=identical
gc-206-gates: tsc=clean eslint=clean proxy_diff_hunks=1 getuser_calls=1 changed_outside_planning=2
```

RED-first detail: before `src/proxy.ts` was edited, the tracer case `null user, no error on /` failed with `AssertionError: expected 307 to be 200`, and the 113 existing tests stayed green.

Neuter A (`confirm_always_true`, the branch's `if (user) {` forced to `if (true) {`): the failing tests were exactly the ten refused cases:
- `null user, no error on /`, `/login`, `/login?redirect=/discovery/crypto-sma`, `/signup`, `/forgot-password`
- `null user with an auth error (revoked session or unreachable auth server) on /`, `/login`, `/login?redirect=/discovery/crypto-sma`, `/signup`, `/forgot-password`

Neuter B (`confirm_hoisted_to_every_session`, the in-branch call deleted and `getUser` awaited for every request that holds a session): the failing tests were exactly the five scope pins:
- `/home`, `/for-quants`, `/factsheet/abc-123`, `/reset-password`, `/demo`, each `with a session never asks the auth server (D-03)`

Backup basename: `206-proxy.ts.bak` (session scratchpad, outside the repo). Restore was `cp -p` from the backup, never `git checkout`, `git restore` or `git stash`. After each restore `git diff --quiet HEAD -- src/proxy.ts` held, and the restored sha256 equalled the sha256 recorded before the neuter, which equals the committed `src/proxy.ts`.

TDD gate compliance: the RED evidence was a real run (assertion failure, not a load error). The tracer test and the fix landed in one commit (`914862015`) because the plan defines the tracer as a single task, so there is no separate `test(206-01)` RED commit. The matrix commit `b5b09d476` is test-only.

## Files Created/Modified

- `src/proxy.ts` - the signed-in bounce branch confirms with `getUser()` (Phase 206 SESSIONLOOP, WR-01-R3)
- `src/proxy.test.ts` - shared `getUser` spy, refused matrix, confirmed arm, scope pins

## Decisions Made

D-01 to D-05 are the orchestrator defaults (founder may revisit), taken as written. Plan-level choices where RESEARCH and PATTERNS differed: the optimistic-session comment above `getSession()` is left untouched (one-hunk diff), a shared `const getUser = vi.fn()` replaces per-mock inline stubs, the optional null-user-no-error-field test is cut, and Neuter B moves the call to every session-holding request so its RED is confined to the scope pins.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. HEAD at start (`448ad3b6d`) was ahead of the plan's measurement HEAD (`2555c88ab`), and every baseline count (113, 174, sha256 `ff7a3933...`) matched anyway.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema change; the only new surface is the fail-open fall-through already covered by T-206-02 in the plan.

## User Setup Required

None - no external service configuration required.

## Flagged assumptions (unchanged from the plan)

- RESEARCH A1 (no double refresh when `getUser()` follows `getSession()` in one request) and A2 (the library may delete cookies on `session_not_found`) were not exercised live and are not asserted.
- The spec-less probe was skipped (the phase has no requirement IDs).

## Next Phase Readiness

Phase 206 has one plan; it is complete. Ready for verification and ship. No VERSION, CHANGELOG or package.json change was made here; the ship step owns those.

## Self-Check: PASSED

- `src/proxy.ts` and `src/proxy.test.ts` exist and are committed (`git status --porcelain -- src` empty).
- Commits `914862015` and `b5b09d476` are ancestors of HEAD.
- Vitest: `src/proxy.test.ts` 130 passed (130); four-file run 191 passed (191). tsc and eslint exit 0.
