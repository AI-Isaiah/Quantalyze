---
phase: "219"
slug: accountemail-the-signed-in-account-shows-its-email-and-can-c
status: verified
threats_open: 0
asvs_level: 1
created: "2026-11-23"
---

# Phase 219 — Security

> Threat register verification for ACCOUNTEMAIL (shipped as PRs #1291 and #1299). Source: the `<threat_model>` blocks of 219-01..09-PLAN.md. Audited by gsd-security-auditor at ASVS 1, block_on high. SQL verified by reading migrations, gates, rollbacks and the PROD-applied baseline; SQL gates, vitest and the mutation runner were not re-run, and neuter/RED proofs are relayed from the plan SUMMARYs.

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Supabase Auth -> auth.users -> trigger -> public.profiles | confirmed email change copied by SECURITY DEFINER trigger | email |
| authenticated session -> public.profiles | column grants and RLS gate self-writes | profile fields |
| sanitize_user -> auth.users | GDPR erasure inside sanitize_in_progress GUC | email NULL |
| browser -> Auth / POST /api/account/email | new address and current password from a cookie session | credentials |
| route (service_role) -> database | has-password question about caller's own id | boolean |
| email link -> /auth/callback, Account tab | attacker-settable query (next, code, email_change) | URL params |
| PR -> CI census gates | floors/pins decide whether a deleted gate is noticed | repo state |
| user -> ResetPasswordForm | new password and emailed code | credentials |

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Evidence | Status |
|-----------|----------|-----------|----------|-------------|----------|--------|
| T-219-01 | Spoofing/Elevation | profiles.email self-set | high | mitigate | sync migration:130 REVOKE UPDATE(email); gate arms 4,5; baseline.sql:18923 | closed |
| T-219-02 | Elevation | sync fn search_path / direct call | medium | mitigate | migration:95-111; gate arms 7,8 | closed |
| T-219-03 | DoS | revoked EXECUTE vs GoTrue write | high | mitigate | gate arm 1b (test_profiles_email_sync.sql:138-174) | closed |
| T-219-04 | Tampering | sync vs GDPR erasure | high | mitigate | migration:99-101 GUC early return; arms 3a,3b | closed |
| T-219-05 | DoS | sync UPDATE aborting GoTrue txn | medium | mitigate | no unique on email; lock_timeout 3s (:85); PK update (:104) | closed |
| T-219-06 | Tampering | data-dependent migration | medium | mitigate | catalogue-only verify (:139-157); lint 0 NEW | closed |
| T-219-07 | Info disclosure | real addresses in gate | low | mitigate | only @quantalyze.test, random uuids | closed |
| T-219-08 | Tampering | open redirect via next | high | mitigate | auth/callback/route.ts:63-79,113; route.test.ts:103-126,147-237 | closed |
| T-219-09 | Spoofing | email change w/o proving new address | high | transfer | Supabase Auth confirm-by-email; route.ts:49-50 never writes auth.users | closed |
| T-219-10 | Info disclosure | derived profile.email shown | medium | mitigate | profile/page.tsx:121-122; ProfileTabs.test.tsx:366-381 | closed |
| T-219-11 | Info disclosure | enumeration via GoTrue message | low | accept | 219-RESEARCH.md:322; REVIEW GR1-IN-02 | closed |
| T-219-12 | Tampering/Repudiation | gate/arm deleted silently | medium | mitigate | mutation-floors.mjs FILES_FLOOR 85, ARMS_FLOOR 910; mutation-runner-floors.test.ts:766 | closed |
| T-219-13 | Tampering | census suppressed | medium | mitigate | WAIVED_CEILING 0; no allowlist row | closed |
| T-219-14 | Info disclosure | has-password RPC client-callable | high | mitigate | auth_user_has_password migration:68-69; arms 7a,7b; baseline.sql:18014-18015 | closed |
| T-219-15 | Info disclosure | answers about other user | medium | mitigate | migration:60 u.id filter; arm 2 | closed |
| T-219-16 | Elevation | DEFINER search_path | high | mitigate | migration:54-59; arms 5a,5b | closed |
| T-219-17 | Info disclosure | hash leaving DB | high | mitigate | RETURNS boolean (:51), hash only in EXISTS | closed |
| T-219-18 | DoS | data-reading verify block | medium | mitigate | to_regprocedure only (:80-88) | closed |
| T-219-19 | Tampering | open redirect, marker on failed exchange | high | mitigate | route.ts:99-106,122,169; tests D,E,F | closed |
| T-219-20 | Spoofing | crafted link claims change | medium | mitigate | route.ts:155-174; AccountEmailSection.tsx:248-256 | closed |
| T-219-21 | Elevation | failed exchange treated as signed in | high | mitigate | route.ts:119-131; proxy.ts:19,77-84 | closed |
| T-219-22 | Spoofing | stolen session changes email | high | mitigate | api/account/email/route.ts:147-150,225; Test 2 | closed |
| T-219-23 | Spoofing | password brute force | high | mitigate | withAuthLimited + userActionLimiter 5/60s (ratelimit.ts:97); Test 3 | closed |
| T-219-24 | Info disclosure | password in response/log | high | mitigate | route logs message/code only; Test 13 | closed |
| T-219-25 | Tampering | verifier touches user's session | high | mitigate | route.ts:140-156 no persistence, scope local; Tests 1,4 | closed |
| T-219-26 | Tampering | open redirect via emailRedirectTo | medium | mitigate | route.ts:86-98; csrf.ts:87-117 | closed |
| T-219-27 | Spoofing | Auth PUT /user accepts change w/o password | medium | accept | GD-06a founder-accepted 2026-11-20; CHANGELOG.md:35,80-81 | closed |
| T-219-28 | Info disclosure | probing others' password state | medium | mitigate | route.ts:184-186 id from getUser(); Test 5 | closed |
| T-219-29 | Info disclosure | password lingering in state | medium | mitigate | AccountEmailSection.tsx:174-180; T3,T4 | closed |
| T-219-30 | Spoofing | crafted ?email_change=confirmed | medium | mitigate | AccountEmailSection.tsx:248-256; T9-T11 | closed |
| T-219-31 | Repudiation | unsure if link sent | low | mitigate | AccountEmailSection.tsx:185-219 | closed |
| T-219-32 | Tampering | has-password gate removed | medium | mitigate | same floors as T-219-12; 219-08-SUMMARY:57 | closed |
| T-219-33 | Repudiation | drift hidden by allowlist | medium | mitigate | baseline-content-drift-check.mjs:342-349 | closed |
| T-219-34 | Info disclosure | password/code in logs | medium | mitigate | no console in ResetPasswordForm.tsx; R9 | closed |
| T-219-35 | DoS | reauthenticate() loop | medium | mitigate | ResetPasswordForm.tsx:77-137; R6,R7 | closed |
| T-219-36 | Elevation | stolen session sets password | medium | transfer | Auth nonce (GD-06b); 219-CONTEXT.md:329-332; CHANGELOG.md:26,83 | closed |
| T-219-SC | Tampering | dependency installs | high | accept | commits d4f93d474, b87eb7c07 change package.json version line only; banned packages absent | closed |

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-219-01 | T-219-11 | GoTrue wording passes through, behind verified password and per-user limiter | plan decision (RESEARCH) | 2026-11 |
| AR-219-02 | T-219-27 | Auth's own PUT /user still accepts change from a valid token; password gate guards only the app form (GD-06a) | founder | 2026-11-20 |
| AR-219-03 | T-219-SC | no package installed | plan | 2026-11 |

Transfers: T-219-09 and T-219-36 to Supabase Auth (confirm-by-email; reauthentication nonce).

## Non-blocking notes

- T-219-23 residual: GoTrue's sign-in limit is per caller IP (the app server), so the per-user 5/60s limiter is the only brute-force bound (~7,200 guesses/day, no lockout); `checkLimit` fails open on a store timeout (`src/lib/ratelimit.ts:570-600`). Mitigation present; recorded, not a blocker.
- Unregistered: `?password_set=1` (`ProfileTabs.tsx:192`, `AccountEmailSection.tsx:258-266`) renders "Your password is set." from the URL alone (review fix GR1-MD-02). Same class as T-219-30, states no identity, changes no state; low impact.
- csrf.ts:99-109 compares host only, not scheme (pre-existing).

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-11-23 | 37 | 37 | 0 | gsd-security-auditor (ASVS 1, block_on high) |

## Sign-Off

- [x] All threats have a disposition
- [x] Accepted risks documented
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set

**Approval:** verified 2026-11-23
