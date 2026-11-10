---
phase: 206-sessionloop-a-revoked-but-unexpired-session-cookie-no-longer
verified: 2026-11-11T00:20:00Z
status: passed
score: 4/4 must-haves verified
verified_at_sha: 3572b0e2a9f47f55bff3224260bc75521155ea19
drift_subjects:
  - src/proxy.ts
  - src/proxy.test.ts
behavior_unverified: 0
overrides_applied: 0
---

# Phase 206: SESSIONLOOP Verification Report

**Phase Goal:** A revoked-but-unexpired session cookie no longer bounces between `/` and `/home` (or `/login?redirect=`). The proxy's signed-in bounce branch confirms the user with `getUser` before redirecting, the same check the pages use; only that branch changes.
**Verified:** 2026-11-11
**Status:** passed
**Re-verification:** No, initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Cookie present but `getUser()` returns null user (with or without an auth error): `/`, `/login`, `/login?redirect=...`, `/signup`, `/forgot-password` render 200 with no `location` header | VERIFIED | `src/proxy.ts` bounce branch now does `await supabase.auth.getUser()` and redirects only `if (user)`; otherwise falls through to `return supabaseResponse`. `REFUSED_CASES` (2 outcomes x 5 paths = 10 cases) in `src/proxy.test.ts` pass. Behavioral test exercises the invariant. |
| 2 | A confirmed user still bounces, target logic unchanged (`/` to `/home`; `/login?redirect=/discovery/crypto-sma` to that path with `redirect` dropped; hostile redirects fall back to role home) | VERIFIED | Diff vs merge base `2516d8b13` is exactly one hunk; the `safeRedirectPath(...) ?? ROLE_HOME_ROUTE`, three `url` lines and `NextResponse.redirect(url)` are moved verbatim inside `if (user)`. Pre-existing /login, /login?redirect=/compare, three hostile-redirect and /forgot-password tests pass with unchanged assertions; two new confirmed-user tests pass. |
| 3 | `getUser()` runs only inside the signed-in bounce branch (cookie-only everywhere else); proxy adds no cookie write/delete/sign-out and no reporting | VERIFIED | One non-comment `supabase.auth.getUser()` in `src/proxy.ts`; no import added; no logging in the added lines. D-03 pins (`/home`, `/for-quants`, `/factsheet/abc-123`, `/reset-password`, `/demo` with session: `getUser` not called) pass; anonymous describes' mocks carry no `getUser`, so any call there would throw. Test mock `auth` carries only `getSession` and `getUser`. |
| 4 | The tests can fail (D-05) | VERIFIED | Re-measured here. Neuter A (`if (true \|\| user)`, i.e. the pre-fix cookie-only behaviour): `10 failed \| 120 passed`, exactly the ten refused cases, matching the SUMMARY. A second neuter (extra `getUser()` for every session-holding request, placed before `isApiRoute`) also goes RED (17 failed); this is a different placement than the SUMMARY's Neuter B (5 failed) so the exact count of 5 was not reproduced, but the scope pins bite. `src/proxy.ts` restored by `cp -p` from a byte backup; sha256 before and after equal (`34502492...56b2e2`), `git diff --quiet HEAD -- src/proxy.ts` holds. |

**Score:** 4/4 truths verified (0 present, behavior-unverified). Truth 1 is behavior-dependent and has behavioral test evidence plus a RED neuter.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/proxy.ts` | Bounce branch confirms via `getUser()`, contains "Phase 206 (SESSIONLOOP, WR-01-R3)" | VERIFIED | Present, substantive, one hunk. |
| `src/proxy.test.ts` | Shared `const getUser = vi.fn()`, `REFUSED_CASES`, confirmed arms, D-03 pins | VERIFIED | All present in the "authenticated user on marketing-exempt routes" describe; 130 tests. |
| `206-01-SUMMARY.md` | gc-206 evidence lines | VERIFIED | Present; figures spot-checked above (130/191 counts, neuter A 10/120, sha equality). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| Bounce branch (`session && isPublicRoute && !isApiRoute && !isAuthBounceExempt`) | `supabase.auth.getUser()` on the same `createServerClient` instance | await inside the branch; redirect only when `user` truthy | WIRED | Same client whose cookie adapter writes into `supabaseResponse`. |
| Test describe | `@supabase/ssr` mock | `beforeEach` installs `auth { getSession, getUser }`, default confirmed user | WIRED | `getUser.mockReset()` then default resolved user each test. |

### Data-Flow Trace (Level 4)

Not applicable (no rendered data; the redirect decision keys on the real `getUser()` result).

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Proxy suite | `npx vitest run src/proxy.test.ts` | 130 passed | PASS |
| Proxy + dependent suites | `npx vitest run src/proxy.test.ts src/__tests__/role-home-call-sites.test.ts src/__tests__/check-route-contract.test.ts src/__tests__/trim-removed-surfaces.test.tsx` | 4 files, 191 passed | PASS |
| Types | `npx tsc --noEmit -p .` | exit 0, empty output | PASS |
| Lint | `npx eslint src/proxy.ts src/proxy.test.ts` | exit 0 | PASS |
| Neuter A RED | forced-true confirmation | 10 failed, 120 passed | PASS (test bites) |

### Probe Execution

None declared; SKIPPED.

### Requirements Coverage

Roadmap lists `Requirements: TBD`; the plan declares `requirements: []`. No orphaned requirements.

### Anti-Patterns Found

No TBD/FIXME/XXX in `src/proxy.ts`. Scope held: against merge base, only `src/proxy.ts` and `src/proxy.test.ts` change outside `.planning/`. The page guards (`src/app/home/page.tsx`, `src/app/(dashboard)/discovery/layout.tsx`) already use `getUser()` and are untouched. `206-REVIEW.md` is `status: clean` with 0 findings.

### Human Verification Required

None required. The loop shape is fully determined by the proxy's redirect decision, which is covered by unit tests. A live browser check against a genuinely revoked session was not run (no stack allowed here) and is not needed for the goal as stated.

Note (not a gap): whether the `@supabase/ssr` library itself clears cookies on `session_not_found` inside `getUser()` is library behavior the plan explicitly left unexercised (D-02 constrains only the proxy's own code).

### Gaps Summary

No gaps. The goal (the proxy no longer bounces a session the auth server refuses, confirmed users still bounce exactly as before, change confined to the bounce branch) is achieved in the code and demonstrated by tests that fail when the fix is removed.

---

_Verified: 2026-11-11_
_Verifier: Claude (gsd-verifier)_
