---
status: awaiting_human_verify
trigger: "Password reset does not work (founder, 2026-11-26 ~15:01Z, quantalyze.xyz, Chrome/macOS). Submit on /reset-password shows the 'Open the password-reset link from your email' card; the new password is not set."
created: 2026-11-26T16:00:00Z
updated: 2026-11-26T19:00:00Z
---

## Current Focus

bug_class: Bohrbug (deterministic: reproduced at 15:01Z and 15:03Z with the same log pattern)
reasoning_checkpoint:
  hypothesis: "A signed-out user's /auth/callback?code=...&next=/reset-password is 307'd by the proxy's anon gate to /login?code=...&next=/reset-password, because /auth/callback is neither in PUBLIC_ROUTES nor exempted from that gate. The /login Server Component exchanges the code (spending it) but cannot set cookies, then redirects to /reset-password with no session, so updateUser fails locally."
  confirming_evidence:
    - "proxy() unit probe at origin/main b4abc4b1b: anon GET /auth/callback?code=pkce-code&next=/reset-password -> 307 https://quantalyze.xyz/login?code=pkce-code&next=/reset-password"
    - "PROD logs: pkce grant 200 from user agent node, then no PUT /auth/v1/user; /login page.tsx is the only other exchangeCodeForSession call site"
    - "Next 16.4.2 cookies.md: setting cookies is not supported during Server Component rendering; server.ts setAll swallows the throw"
  falsification_test: "If anon /auth/callback were not redirected, or if a PUT /auth/v1/user had appeared, the hypothesis would be wrong."
  fix_rationale: "Exempt the exact /auth/callback path from the anon gate so the route handler (where Next merges cookies() writes into the returned redirect via appendMutableCookies) runs for signed-out users and sets the session cookies. Keeps it out of PUBLIC_ROUTES so the signed-in bounce still never applies."
  blind_spots: "End-to-end browser run against PROD Auth not done here (needs a real recovery email); the cookie-merge leg is read from Next source, not executed."
  candidate_causes:
    - "code: proxy anon gate redirects /auth/callback (confirmed)"
    - "code: /login Server Component exchange drops cookies (contributing, confirmed by docs)"
    - "config: Supabase redirect allowlist / Site URL (eliminated: redirect_to honoured, 303 to the callback)"
    - "environment: stale or conflicting cookies after global logout (eliminated: second repro at 15:03Z had no logout in between)"
  and_gate: "yes: the failure needs the proxy redirect AND the /login exchange that spends the code without persisting it. The proxy redirect alone would leave the user on /login with an unspent code; the /login exchange alone is unreachable without the redirect. The fix removes the necessary first condition; the /login exchange is booked as a latent follow-up."
next_action: "PR #1373 (branch fix/reset-callback-anon-gate, v0.133.94.0): wait for green CI, mark READY; after merge and deploy the founder re-tests a signed-out reset in ONE browser."

## Symptoms

expected: After clicking the recovery email link, /reset-password accepts the new password (PUT /auth/v1/user), and the new password signs in.
actual: Submit shows ResetPasswordForm's noSession card; no PUT /auth/v1/user reaches Auth; sign-in with the new password returns invalid_credentials.
errors: Browser-side AuthSessionMissingError ("Auth session missing!") from supabase-js updateUser (inferred: matches /session/i and no PUT reached the server).
reproduction: Signed out (global logout of another account at 15:01:06), request reset on /forgot-password, click the email link, submit a new password on /reset-password.
started: Reproduced twice on 2026-11-26 (15:01Z and 15:03Z). Mechanism predates this session (see Evidence).

## Eliminated

- hypothesis: "(a) The callback's redirect response drops or hides the session cookies"
  evidence: "For the failing flow the route handler never ran (the proxy 307'd first). Separately, Next 16.4.2 app-route/module.js merges cookies() writes into the returned response (appendMutableCookies), and @supabase/ssr DEFAULT_COOKIE_OPTIONS are path=/, sameSite=lax, httpOnly=false."
  timestamp: 2026-11-26T16:20:00Z
- hypothesis: "(b) The proxy rewrites or clears cookies on /reset-password"
  evidence: "/reset-password is public and bounce-exempt; the proxy only returns supabaseResponse there and never deletes cookies. There was no session cookie to clear."
  timestamp: 2026-11-26T16:20:00Z
- hypothesis: "(c) Global logout left conflicting stale cookies"
  evidence: "The 15:03Z repro failed the same way with no logout in between; the anon proxy redirect is deterministic for any signed-out browser."
  timestamp: 2026-11-26T16:20:00Z
- hypothesis: "(d) PKCE code-verifier mishandling"
  evidence: "The pkce grant returned 200, so the verifier cookie was present and correct. It was read by the /login Server Component, which could not then persist the session."
  timestamp: 2026-11-26T16:20:00Z

## Evidence

- timestamp: 2026-11-26T16:02:00Z
  checked: PROD auth logs (coordinator, query_logs 14:30-15:10Z)
  found: recover with redirect_to=/auth/callback?next=/reset-password; /verify 303 to callback; POST /token?grant_type=pkce 200 from user agent node (provider_type recovery); no PUT /auth/v1/user afterwards; password grant 400 invalid_credentials. Same pattern again at 15:03Z.
  implication: The code exchange happened server-side and succeeded; the browser never had a session to send.

- timestamp: 2026-11-26T16:04:00Z
  checked: src/proxy.ts anon gate and PUBLIC_ROUTES; src/lib/routing/route-contract-manifest.ts /auth/callback entry
  found: /auth/callback is NOT in PUBLIC_ROUTES ("Not in PUBLIC_ROUTES by design", class exception). The gate `if (!session && !isPublicRoute)` redirects to /login via request.nextUrl.clone() with only pathname changed, so ?code=...&next=/reset-password is carried to /login. Nothing in the proxy exempts /auth/callback from the anon gate; the 'exception' class was only meant to keep it out of the authed bounce.
  implication: A signed-out user (the normal forgot-password user) never reaches the callback route handler.

- timestamp: 2026-11-26T16:05:00Z
  checked: src/app/(auth)/login/page.tsx (fd24d9190, 2026-04-05 "ISSUE-004 auto-exchange confirmation code on login page")
  found: The /login Server Component calls exchangeCodeForSession(params.code) and on success redirect(safeRedirectPath(next)) -> /reset-password. server.ts setAll wraps cookieStore.set in try/catch "Server component context".
  implication: This is the 'node' pkce grant in the logs. The exchange succeeds, burns the one-time code, and its session cookies are discarded.

- timestamp: 2026-11-26T16:06:00Z
  checked: node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md (Next 16.4.2)
  found: "Setting cookies is not supported during Server Component rendering. To modify cookies, invoke a Server Function from the client or use a Route Handler."
  implication: Confirms the swallowed-cookie leg: the /login exchange can never persist a session.

- timestamp: 2026-11-26T16:25:00Z
  checked: proxy() unit probe and new regression tests at origin/main b4abc4b1b
  found: anon /auth/callback?code=pkce-code&next=/reset-password -> 307 /login?code=pkce-code&next=/reset-password. New tests: 4 RED on main, GREEN with the fix; neutering the fix (false) gives the same 4 RED; a prefix match (startsWith("/auth")) gives 3 RED on the boundary tests; restored byte-equal (cmp) both times.
  implication: Proxy leg reproduced deterministically; the tests bite in both directions.

## Resolution

root_cause: "src/proxy.ts sent a signed-out request for /auth/callback to /login (the path is neither in PUBLIC_ROUTES nor exempted from the anon gate); /login's Server Component then exchanged the code, which spent it, but could not set the session cookies, and redirected to /reset-password with no session; updateUser failed locally with AuthSessionMissingError."
fix: "Exempt the exact path /auth/callback from the proxy's anon gate (isAuthCallbackRoute). PUBLIC_ROUTES unchanged, so the signed-in bounce still never applies."
oracle_type: specified (route contract: the session-minting route must be reachable without a session)
verification: "src/proxy.test.ts: 4 anon callback cases RED before, GREEN after; exact-path boundary cases (/auth, /auth/callbackx, /auth/callback/extra) still 307; signed-in /auth/callback stays. Adjacent suites 22 files / 556 tests green; tsc, eslint, check-route-contract OK."
files_changed: [src/proxy.ts, src/proxy.test.ts, src/lib/routing/route-contract-manifest.ts]
follow_up: "src/app/(auth)/login/page.tsx still exchanges ?code= in a Server Component, which spends a code and can never persist the session. Unreachable from the email flows after this fix; candidate for removal."
review: "Forked /code-review (high) on PR #1373: no MEDIUM+ in the diff. Pre-existing follow-ups: (1) /login ignores ?error= so a failed callback is silent; (2) PKCE recovery/signup links only work in the requesting browser (cross-device fails; ForgotPasswordForm comment wrongly says token_hash); (3) /login Server Component code exchange (above); (4) anon /auth/callback?code=garbage costs one GoTrue token call (not new). Nit: isAuthCallbackRoute is invisible to check-route-contract."
follow_up_pr: "PR #1375 (fix/reset-silent-failures, v0.133.95.0, stacked on #1373) fixes F1-F4: failed recovery link -> /reset-password?link=expired with logging; /login ?code= exchange removed; server.ts setAll logs; no-session card by name/code (incl. session_expired, refresh_token_*); ForgotPasswordForm logs and shows retry only on status 0 / over_request_rate_limit (not 429 email limit or 5xx, which only reach real accounts: enumeration)."
round2: "#1373 merged 4264e156 (v0.133.94.0). #1375 rebased onto b1eb7842 as one commit 6c4cfa06 (v0.133.96.0) with SFH round-2 fixes (4xx-only expired, ?link=error for 5xx/429/0, callback logging, /login fixed ?error= notice, setAll warn vs error, ForgotPasswordForm Sentry capture, ResetPasswordForm logging); CI 29/29 green."
