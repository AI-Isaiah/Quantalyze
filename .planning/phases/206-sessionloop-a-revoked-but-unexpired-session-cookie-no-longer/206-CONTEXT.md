# Phase 206: SESSIONLOOP — a revoked-but-unexpired session cookie no longer bounces between / and /home - Context

**Gathered:** 2026-11-10
**Status:** Ready for planning

<domain>
## Phase Boundary

A browser that holds a session cookie the auth server no longer accepts must not loop into
`ERR_TOO_MANY_REDIRECTS`. Two loop shapes exist today:

- `/` → (proxy) `/home` → (`src/app/home/page.tsx:43`, `!user`) `/` → …
- `/login?redirect=/discovery/crypto-sma` → (proxy) `/discovery/crypto-sma` → (`src/app/(dashboard)/discovery/layout.tsx:37-38`, `!user`) `/login?redirect=…` → …

Root cause: the proxy (`src/proxy.ts`) decides "signed in" from `supabase.auth.getSession()`,
which reads only the cookie. The pages decide from `supabase.auth.getUser()`, which asks the
auth server. The two disagree when the access token has not expired but the session was revoked
(global sign-out, admin ban or delete, `session_not_found`), or when the auth server is
unreachable.

This phase changes exactly one place: the proxy's signed-in bounce branch,
`if (session && isPublicRoute && !isApiRoute && !isAuthBounceExempt)` (`src/proxy.ts:169-177`).
That branch confirms the user with `getUser()` before redirecting. It also adds a proxy test that
fails on the loop. Nothing else changes: no page guards, no `/home`, no other proxy branch.

</domain>

<decisions>
## Implementation Decisions

The founder was not available for questions in this run. Each decision below is the
orchestrator's default, taken from WR-01-R3's recommended fix and the phase brief. The founder
may revisit any of them.

### Fix point
- **D-01:** The fix goes in the proxy's signed-in bounce branch only, not in `/home`, not in
  `discovery/layout.tsx`, and not in any other page guard. Reason: every loop shape passes
  through that branch (WR-01-R3). A fix inside `/home` alone would leave the
  `/login?redirect=` shape looping. (orchestrator default, founder may revisit)

### Behaviour when confirmation fails
- **D-02:** Inside the branch, call `supabase.auth.getUser()`. Redirect, with the existing
  `safeRedirectPath(...) ?? ROLE_HOME_ROUTE` logic unchanged, only when it returns a user. When
  it returns a null user or an error, fall through and return `supabaseResponse`, so `/`,
  `/login`, `/signup` and `/forgot-password` render normally. The proxy does not clear cookies and
  does not call sign-out. (orchestrator default, founder may revisit)

### Cost and scope
- **D-03:** `getUser()` runs only inside that branch. The network round trip is paid only by
  cookie holders on the four bounced public routes (`/`, `/login`, `/signup`,
  `/forgot-password`). Every other route stays cookie-only, as it is today, including the
  `!session && !isPublicRoute` → `/login` gate. (orchestrator default, founder may revisit)
- **D-04:** No new Sentry reporting or logging in the proxy. The rendered page (marketing page or
  login form) is how the user recovers. (orchestrator default, founder may revisit)

### Test
- **D-05:** The test goes in `src/proxy.test.ts`, the existing proxy test file. With a session
  cookie present, it covers:
  - `getUser` returns a null user on `/`, `/login` and `/login?redirect=/discovery/crypto-sma`:
    no redirect (200, no `location`).
  - `getUser` returns an error: same result, no redirect.
  - `getUser` returns a user: the existing bounce still happens, to `ROLE_HOME_ROUTE` or to the
    safe `redirect` target.

  The test must go RED when the `getUser` confirmation is removed. Prove it by neutering the
  check, seeing RED, and restoring from a byte backup in the scratchpad. Existing proxy tests stay
  green. Their `@supabase/ssr` mocks that return a session will need a `getUser` stub.
  (orchestrator default, founder may revisit)

### Claude's Discretion
- How the `getUser` mock is shaped and shared across the existing session-mocking `describe`
  blocks, provided the existing assertions keep their meaning.
- The wording of the code comment at the branch. Follow the file's existing comment style:
  cite the phase and WR-01-R3.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### The defect
- `.planning/phases/199-managerhome-each-role-lands-on-its-own-page-and-a-manager-has/199-REVIEW-R3.md` §WR-01-R3: loop shapes, when it happens, why the class is carried, and the recommended fix with a code sketch
- `.planning/ROADMAP.md` `### Phase 206`: locked goal ("only that branch changes")

### Code
- `src/proxy.ts`: lines 67-71 (`getSession`, cookie-only), 76-79 (`isPublicRoute`), 156-168 (`isAuthBounceExempt`), 169-177 (the bounce branch that changes)
- `src/proxy.test.ts`: the `@supabase/ssr` mock at ~101-109 and the session mocks at ~338-358 and later. Bounce tests around ~430-500, including `/forgot-password` and the safe-`redirect` cases.
- `src/app/home/page.tsx:43`: `if (!user) redirect("/")`, one half of loop shape 1
- `src/app/(dashboard)/discovery/layout.tsx:37-38`: `!user` → `/login?redirect=/discovery/crypto-sma`, one half of loop shape 2

### Framework
- `node_modules/next/dist/docs/` proxy guides. This Next.js version renamed middleware to `proxy`. Read them before writing proxy code (AGENTS.md).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `safeRedirectPath` (`@/lib/routing/role-home`) and `ROLE_HOME_ROUTE` (`@/lib/routing/default-route`): the existing bounce target logic. Reuse it unchanged inside the `if (user)` arm.
- The `supabase` client already built in `proxy()`, whose cookie adapter writes into `supabaseResponse`. `getUser()` on the same client needs no new wiring.

### Established Patterns
- Proxy comments cite the phase or review id that introduced each rule (e.g. "Phase 199 (CD-07)", "51-REVIEW"). Keep that convention.
- Tests re-mock `createServerClient` per `describe` with `vi.mocked(...).mockImplementation(() => ({ auth: { getSession } }))`. New tests follow it and add `getUser`.

### Integration Points
- Only `src/proxy.ts` (the one branch) and `src/proxy.test.ts`.
- Note for the researcher, not a scope change: the redirect response is a fresh `NextResponse.redirect`, so it does not carry cookies that `getSession`/`getUser` may have written to `supabaseResponse` during a token refresh. That is true today. Confirm the fix does not make it worse. Do not widen the phase to change it.

</code_context>

<specifics>
## Specific Ideas

WR-01-R3's sketch is the intended shape:

```ts
if (session && isPublicRoute && !isApiRoute && !isAuthBounceExempt) {
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    // existing safePath bounce
  }
  // else: fall through and render /, /login, ... (the stale cookie cannot loop)
}
```

</specifics>

<deferred>
## Deferred Ideas

- Clearing the stale cookie, or signing the user out, when the proxy sees a refused session.
  Excluded by D-02. A separate phase could take it if the founder wants it.
- Sentry or logging of refused sessions at the proxy. Excluded by D-04.
- The duplicate `!user` page guards (`/home`, `discovery/layout.tsx`, and others). They stay as
  they are. Once the proxy confirms before bouncing, they cannot loop.

</deferred>

---

*Phase: 206-sessionloop-a-revoked-but-unexpired-session-cookie-no-longer*
*Context gathered: 2026-11-10*
