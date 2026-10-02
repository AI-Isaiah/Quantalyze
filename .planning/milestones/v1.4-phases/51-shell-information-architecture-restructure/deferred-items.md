# Deferred items — Phase 51 (out-of-scope discoveries)

## 51-02 (route-contract guard)

### Latent: `/forgot-password` is NOT in PUBLIC_ROUTES (anon entry-point may 307→login)

**Found during:** Task 1 (classifying the 57 page routes against proxy.ts PUBLIC_ROUTES).

**Observation:** `/forgot-password` (the password-recovery entry-point, linked from
`/login` LoginForm.tsx:62 and ResetPasswordForm.tsx:72) is NOT a member of
`proxy.ts` `PUBLIC_ROUTES`. An anonymous visitor (no session) hitting
`/forgot-password` therefore matches the proxy session gate (`!session &&
!isPublicRoute`) and gets a 307→`/login`. That would make the "Forgot password?"
link from the login page bounce back to login for a logged-out user — the exact
persona that needs it. (The proxy test does NOT pin `/forgot-password` either
way, so this is unverified-at-runtime, not a regression I introduced.)

`/reset-password` is fine: the recovery email links to
`/auth/callback?next=/reset-password`, `/auth/callback` exchanges the recovery
`token_hash` and mints a recovery SESSION, so by the time the user lands on
`/reset-password` they are authenticated and pass the proxy gate.

**Why deferred (not fixed here):** Fixing this requires ADDING `/forgot-password`
(and arguably `/reset-password`) to `proxy.ts` `PUBLIC_ROUTES` — a runtime proxy
BEHAVIOR change. Plan 51-02 is a classification + lint-guard plan with an explicit
"do NOT move/modify any route" constraint; PUBLIC_ROUTES edits are scoped to the
move plans (51-04/51-05) or a dedicated fix. To keep the guard GREEN against the
CURRENT proxy reality, `/forgot-password` + `/reset-password` are classified
`exception` in ROUTE_CONTRACT_MANIFEST with notes documenting this exact flow +
the latent question, so the guard does not silently bless a wrong "public"
classification (which would require a PUBLIC_ROUTES edit) nor read as STALE.

**Suggested follow-up:** confirm the intended behavior — if `/forgot-password`
should be anon-reachable (it should), add it to `PUBLIC_ROUTES` in the same change
that adds the e2e canary (proxy.test.ts already has the public-route `it.each`
table to extend), then re-classify both to `public` and the guard's Rule 2 will
hold. Tracked here, NOT fixed in 51-02.
