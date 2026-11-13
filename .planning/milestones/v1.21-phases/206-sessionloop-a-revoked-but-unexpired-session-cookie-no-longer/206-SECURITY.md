---
phase: 206
slug: sessionloop-a-revoked-but-unexpired-session-cookie-no-longer
status: SECURED
threats_total: 7
threats_closed: 7
threats_open: 0
asvs_level: 1
block_on: high
audit_depth: L2 (mitigation placement and threat-vector coverage checked, not grep presence only)
audited_at_sha: 3572b0e2a9f47f55bff3224260bc75521155ea19
audit_base: 448ad3b6d
created: 2026-11-11
---

# Phase 206 SESSIONLOOP - Security Audit

Scope: the threat register in `206-01-PLAN.md` (`<threat_model>`) verified against
`git diff 448ad3b6d..HEAD -- src/`, which is `src/proxy.ts` (one hunk, additions only) and
`src/proxy.test.ts`. Implementation files were read-only. Config note: `.planning/config.json`
carries no security block, so `asvs_level` is the GSD default (1) and `block_on` is the default
(`high`). Verification was done at L2 depth anyway (placement and vector, not just presence).

## Verdict

**SECURED.** 7/7 threats closed, 0 open (blocking), 0 open (non-blocking). No unregistered flags
from the SUMMARY. Two auditor observations are recorded under T-206-05 as informational and
non-blocking.

## Trust Boundaries

| Boundary | Description | Verified |
|----------|-------------|----------|
| browser cookie to proxy | The session cookie is client-held. `getSession()` decides on `expires_at` only (`node_modules/@supabase/auth-js/dist/main/GoTrueClient.js` `__loadSession`, `hasExpired`), so a revoked or forged but unexpired cookie still parses as a session | yes |
| proxy to Supabase auth server | `getUser()` is the revocation truth. Every `AuthError` comes back as `{ data: { user: null }, error }` (`GoTrueClient.js` `_getUser` catch block). Only a non-`AuthError` throws | yes |
| tracked text to the public repo | PLAN, SUMMARY, REVIEW, commit messages and the `src/` diff are published | yes |

## Threat Register

| Threat ID | Category | Severity | Disposition | Status | Evidence |
|-----------|----------|----------|-------------|--------|----------|
| T-206-01 | Denial of service (redirect loop on a refused cookie) | high | mitigate | CLOSED | `src/proxy.ts:180` awaits `supabase.auth.getUser()` inside the bounce branch (`:169`); `:181` `if (user) {` gates the redirect; a null user or error reaches `return supabaseResponse` (`:208`). Pinned by `src/proxy.test.ts:509-545` (`REFUSED_PATHS` x `REFUSED_OUTCOMES`, 10 cases, 200 + null `location` + one call). Independent neuter in a scratch copy of committed HEAD: `if (user) {` forced to `if (true) {` gives `10 failed \| 120 passed (130)`. Restored copy: `130 passed (130)`. `/home` redirects to `/` on a null user (`src/app/home/page.tsx:42-43`) and `/` now renders for a refused cookie, so neither loop shape can close. |
| T-206-02 | Elevation of privilege (fail-open fall-through when the auth server refuses or is unreachable) | low | mitigate | CLOSED | The arm is entered only under `session && isPublicRoute && !isApiRoute && !isAuthBounceExempt` (`src/proxy.ts:169`). Net of `PUBLIC_ROUTES` and the exemptions that set is `/`, `/login`, `/signup`, `/forgot-password` and their subpaths. Fall-through renders those public pages only, which an anonymous visitor reaches anyway (the `!session && !isPublicRoute` gate at `:81` does not guard them). The private-route gate at `:81` is untouched: `git diff -w 448ad3b6d..HEAD -- src/proxy.ts` has zero removed lines, one hunk. `git diff --name-only 448ad3b6d HEAD -- src/app` is empty. Page authority intact: `src/app/home/page.tsx:42-43` (`getUser`, then `redirect("/")`) and `src/app/(dashboard)/discovery/layout.tsx:35-39` (`getUser`, then redirect to login). Scope pins: `src/proxy.test.ts:576` (5 routes, `getUser` not called). |
| T-206-03 | Tampering (`?redirect=` open redirect on the confirmed arm) | medium | mitigate | CLOSED | `src/proxy.ts:182-184` `safeRedirectPath(request.nextUrl.searchParams.get("redirect")) ?? ROLE_HOME_ROUTE`, then `:185-188` clone, `url.pathname = safePath`, delete `redirect`, `NextResponse.redirect(url)`. Only `pathname` is assigned on a clone of the request URL, so the origin cannot change. `src/lib/routing/role-home.ts:45` accepts only a string matching `/^\/[a-z]/` (rejects `//host`, `/\host`, absolute URLs, uppercase start, non-strings). The five statements are unchanged apart from indentation (`git diff -w` removed-line count is 0). Tests: `src/proxy.test.ts:468-475` (three hostile cases) plus `:558` (same-origin, param dropped). Independent neuter: `safeRedirectPath(...)` replaced by the raw param gives `3 failed \| 127 passed (130)`, exactly the three hostile-redirect tests (absolute URL, backslash host, protocol-relative host). |
| T-206-04 | Tampering (`src/proxy.ts` left neutered after the mutation proof) | high | mitigate | CLOSED | `shasum -a 256 src/proxy.ts` and `git show HEAD:src/proxy.ts` both give `34502492f5b3cc52c46370d11ddef5a024e4b2867c2a345e85102a6fc056b2e2`, equal to the `sha256_before` and `sha256_after` of both `gc-206-neuter` lines in `206-01-SUMMARY.md`. `git diff --quiet HEAD -- src/proxy.ts src/proxy.test.ts` exits 0 and `git status --porcelain -- src` is empty. `grep -ac 'if (true)' src/proxy.ts` is 0 and `if (user) {` is at `:181`. `npx vitest run src/proxy.test.ts` at HEAD: `130 passed (130)`. My own neuters ran in a throwaway copy of `git archive HEAD` output, since deleted; no repo file was written. |
| T-206-05 | Denial of service (extra auth round trip, cost creep) | low | mitigate | CLOSED | Non-comment `supabase.auth.getUser()` count in `src/proxy.ts` is 1, at `:180`, inside the bounce branch only. Anonymous describes' mocks carry no `getUser`, so a signed-out call would throw (`src/proxy.test.ts` anonymous describes); five scope pins at `:576`. Independent neuter: an unconditional `getUser` for every request holding a session gave `17 failed \| 113 passed (130)` (my variant also double-calls on the bounced routes, so it fails more than the plan's Neuter B; the plan's exact `5 failed \| 125 passed` is recorded in the SUMMARY and was not re-run by me). See O-1 and O-2 below. |
| T-206-06 | Information disclosure (home or scratch path in tracked text) | low | mitigate | CLOSED | Scan of every `.md` under the phase directory and of `git diff 448ad3b6d..HEAD -- src` for a home-directory path shape, a scratch-directory path shape and the account name: zero hits (run before this file was written). The PLAN uses the `<user>` placeholder; the SUMMARY records the backup basename and hashes only. Commit messages `448ad3b6d..HEAD` carry no skip token and no attribution trailer. |
| T-206-SC | Tampering (npm/pip/cargo installs) | low | accept | CLOSED | `git diff --name-only 448ad3b6d HEAD -- package.json package-lock.json` is empty and the only non-planning files changed are `src/proxy.ts` and `src/proxy.test.ts`. Nothing installed. Logged below. |

## Accepted Risks Log

| ID | Risk | Rationale | Owner / date |
|----|------|-----------|--------------|
| T-206-SC | Supply-chain exposure from installs | The phase installs nothing; no package or lockfile change. The package-legitimacy gate does not apply. | Plan 206-01, 2026-11-10 |

## Additional Vectors Checked (requested, beyond the register)

| Vector | Result | Evidence |
|--------|--------|----------|
| Open redirect via `?redirect=` | Mitigated, `safeRedirectPath` still applied on the only redirect the branch can issue | T-206-03 row |
| Can a refused session reach anything it could not before? | No. The fall-through returns `supabaseResponse` for four public route families that anonymous visitors already reach. A refused cookie on a private route is handled exactly as before (`:81` gate, then page-level `getUser`) | T-206-02 row |
| Auth-check bypass through the new branch | None found. A user is bounced only on a truthy `data.user` from the auth server. `data` is always an object for `AuthError` outcomes (`GoTrueClient.js` `_getUser` catch: `{ data: { user: null }, error }`), so the destructure cannot throw on a refusal. A non-`AuthError` throw propagates as a 500 with no try/catch (fail loud, deliberate per the PLAN); it is not a fail-open path. The library may delete auth cookies on `session_not_found` (`_removeSession`) through the existing cookie adapter; that is library behaviour, not proxy code, and is unasserted (RESEARCH A2) | `src/proxy.ts:178-189`, `GoTrueClient.js` `_getUser` |
| Pre-existing weakness, unchanged | `getSession()` is cookie-only, so a crafted cookie still passes the `:81` private-route gate. The page-level `getUser()` guards are the authority and are untouched. Not widened by this phase | `src/proxy.ts:67-71`, `src/app` diff empty |
| Cookie loss on the confirmed redirect | Refreshed cookies written to `supabaseResponse` are not carried by the redirect response. Pre-existing, same shape as before the change (RESEARCH A1, not exercised live). Not made worse | `src/proxy.ts:185-188` |
| DoS cost of `getUser` on four routes | Low, bounded to cookie holders on `/`, `/login`, `/signup`, `/forgot-password`. See O-1, O-2 | T-206-05 row |

## Auditor Observations (informational, non-blocking, mapped to T-206-05)

- **O-1 (cookie-forged upstream call).** Because `getSession()` trusts `expires_at` alone, an
  anonymous client that sends a crafted session cookie with a future `expires_at` makes the proxy
  issue one upstream auth `user` request per hit on the four bounced routes. That is a 1:1 cost
  shift onto the auth server. The same cost already exists on every private route through the
  page-level `getUser()` guards, so this widens the route set, not the class. Reasoned from the
  `__loadSession` expiry logic, not exercised live. Severity low; below `block_on`. A rate limit
  on the four routes would bound it; none is required for this phase.
- **O-2 (no timeout on the call).** The `getUser()` call adds no abort or timeout. While the auth
  server is slow, cookie holders on the four routes wait on it (anonymous visitors never do).
  The login page depends on the auth server anyway, and the page-level guards already carry the
  same coupling. Severity low; below `block_on`. Not exercised live.

## Unregistered Flags

SUMMARY `## Threat Flags` reads "None", and no new endpoint, auth path, schema or import was
found (the added lines contain no import, logging, Sentry, sign-out, cookie operation or
try/catch). Unregistered flags: none.

## Items Verified By Me Versus Taken From The SUMMARY

- Re-run by me: `src/proxy.test.ts` at HEAD (130 passed); neuter A (10 failed, 120 passed);
  a hoist variant of neuter B (17 failed, 113 passed); the `safeRedirectPath` neuter
  (3 failed, the three hostile-redirect tests); the restored copy (130 passed); sha256 of the
  committed file; one-hunk and additions-only diff; page guards; home-path and trailer scans.
- Taken from the SUMMARY, not re-run: the plan's exact Neuter B count (`5 failed | 125 passed`),
  the four-file run (`191 passed`), `tsc` and `eslint` clean.
- Not exercised live (stated as assumptions in the PLAN): RESEARCH A1 (no double refresh) and
  A2 (library cookie deletion on `session_not_found`).

**threats_open:** 0
