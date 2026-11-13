# Phase 206: SESSIONLOOP - Research

**Researched:** 2026-11-10
**Domain:** Next.js 16 `proxy.ts` + `@supabase/ssr` session confirmation (one branch, one test file)
**Confidence:** HIGH (every claim below was read in the worktree this session; no external sources were needed)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** The fix goes in the proxy's signed-in bounce branch only, not in `/home`, not in `discovery/layout.tsx`, and not in any other page guard. Reason: every loop shape passes through that branch (WR-01-R3). A fix inside `/home` alone would leave the `/login?redirect=` shape looping. (orchestrator default, founder may revisit)
- **D-02:** Inside the branch, call `supabase.auth.getUser()`. Redirect, with the existing `safeRedirectPath(...) ?? ROLE_HOME_ROUTE` logic unchanged, only when it returns a user. When it returns a null user or an error, fall through and return `supabaseResponse`, so `/`, `/login`, `/signup` and `/forgot-password` render normally. The proxy does not clear cookies and does not call sign-out. (orchestrator default, founder may revisit)
- **D-03:** `getUser()` runs only inside that branch. The network round trip is paid only by cookie holders on the four bounced public routes (`/`, `/login`, `/signup`, `/forgot-password`). Every other route stays cookie-only, as it is today, including the `!session && !isPublicRoute` → `/login` gate. (orchestrator default, founder may revisit)
- **D-04:** No new Sentry reporting or logging in the proxy. The rendered page (marketing page or login form) is how the user recovers. (orchestrator default, founder may revisit)
- **D-05:** The test goes in `src/proxy.test.ts`, the existing proxy test file. With a session cookie present, it covers: `getUser` returns a null user on `/`, `/login` and `/login?redirect=/discovery/crypto-sma` (no redirect: 200, no `location`); `getUser` returns an error (same result, no redirect); `getUser` returns a user (the existing bounce still happens, to `ROLE_HOME_ROUTE` or to the safe `redirect` target). The test must go RED when the `getUser` confirmation is removed. Prove it by neutering the check, seeing RED, and restoring from a byte backup in the scratchpad. Existing proxy tests stay green. Their `@supabase/ssr` mocks that return a session will need a `getUser` stub. (orchestrator default, founder may revisit)

### Claude's Discretion
- How the `getUser` mock is shaped and shared across the existing session-mocking `describe` blocks, provided the existing assertions keep their meaning.
- The wording of the code comment at the branch. Follow the file's existing comment style: cite the phase and WR-01-R3.

### Deferred Ideas (OUT OF SCOPE)
- Clearing the stale cookie, or signing the user out, when the proxy sees a refused session. Excluded by D-02.
- Sentry or logging of refused sessions at the proxy. Excluded by D-04.
- The duplicate `!user` page guards (`/home`, `discovery/layout.tsx`, and others). They stay as they are.
</user_constraints>

<phase_requirements>
## Phase Requirements

No requirement IDs were assigned (TBD). The phase goal in ROADMAP is the acceptance spec: a revoked-but-unexpired cookie must not loop `/` ↔ `/home` or `/login?redirect=` ↔ `/discovery/...`.
</phase_requirements>

## Summary

The fix is a 6-line change inside the one `if` at `src/proxy.ts:169-177` plus test edits in `src/proxy.test.ts`. No dependency changes, no new files. The only `describe` in the test file that returns a session is `"authenticated user on marketing-exempt routes stays on the page"` (`src/proxy.test.ts:338-490`), and exactly **6 tests** inside it reach the bounce branch and will throw `TypeError: supabase.auth.getUser is not a function` until a `getUser` stub is added (list below). Everything else in the file is anonymous (`session: null`) and never reaches the branch.

`getUser()` never throws for the failure modes that matter. A revoked session (`session_not_found`), a banned/deleted user, an unreachable auth server and a missing access token all come back as `{ data: { user: null }, error }`. So the branch needs no `try/catch`: `const { data: { user } } = await supabase.auth.getUser()` and `if (user)` is sufficient, and the fall-through arm handles both the null-user and error cases with one condition.

The cookie-refresh concern is confirmed not to get worse. The redirect arm already returns a fresh `NextResponse.redirect` that drops anything `getSession()` wrote to `supabaseResponse`; `getUser()` adds no new cookie writes on that arm (it reuses the session `getSession()` already loaded/refreshed). On the new fall-through arm the proxy returns `supabaseResponse`, so any cookie `getUser()` writes there is *kept*; in one case (`session_not_found`) the library itself clears the auth cookies, which is a free, un-asked-for improvement that D-02 does not forbid (the proxy code does not clear anything itself).

**Primary recommendation:** Insert `const { data: { user } } = await supabase.auth.getUser();` as the first statement of the existing branch, wrap the existing four-line redirect in `if (user) { ... }`, and in the test file add one shared `getUser` stub (default: returns a user) to the existing session `describe`'s `beforeEach`, plus a nested describe covering null user / error / user on the three URLs from D-05.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| "Is this visitor signed in?" for the bounce decision | Frontend Server (proxy) | API / Backend (Supabase auth `/user`) | Proxy runs before the page; it must agree with the page-level `getUser()` or the redirects ping-pong |
| Rendering `/`, `/login`, `/signup`, `/forgot-password` for a refused session | Frontend Server (RSC pages) | — | Pages already render without a user (`(marketing)/page.tsx:72-75` redirects only when `user` is truthy; login page renders `LoginForm`) |
| Revocation truth (session in `auth.sessions`) | API / Backend (Supabase GoTrue) | — | Only the auth server knows; the JWT alone cannot say |

## Standard Stack

No new packages. The phase uses what is installed. [VERIFIED: node_modules package.json, read this session]

| Library | Version | Purpose |
|---------|---------|---------|
| next | 16.4.2 | `proxy.ts` convention (renamed from middleware) |
| @supabase/ssr | 0.12.7 | `createServerClient` used in the proxy |
| @supabase/supabase-js / auth-js | 2.118.0 / 2.118.0 | `auth.getUser()` / `auth.getSession()` |
| vitest | 5.0.5 | proxy tests (`RUN v5.0.5`) |

**Package Legitimacy Audit:** not applicable. This phase installs nothing. No `npm install`.

## Architecture Patterns

### System Architecture Diagram

```
request ──> proxy()
              │  /api/cron/* ───────────────────────────────> NextResponse.next (unchanged)
              │
              ├─ createServerClient (cookie adapter: reads request.cookies,
              │                      writes request.cookies + supabaseResponse.cookies)
              ├─ getSession()  [cookie-only unless access token expired -> refresh]
              │
              ├─ !session && !isPublicRoute ──────────────────> redirect /login   (unchanged)
              │
              ├─ session && isPublicRoute && !api && !exempt     <== THE ONE BRANCH
              │       │
              │       ├─ NEW: getUser()  ──(network: GET /auth/v1/user)
              │       │        ├─ user  ──> redirect(safeRedirectPath(?redirect) ?? /home)  (existing code, unchanged)
              │       │        └─ null / error ──> fall through
              │       │
              └─ everything else / fall-through ──────────────> return supabaseResponse (200)
                                                                   └─ page renders; page getUser() = null
                                                                      -> marketing page / login form (no loop)
```

### The exact current branch (`src/proxy.ts:169-177`)
[VERIFIED: src/proxy.ts:169-177]
```ts
  if (session && isPublicRoute && !isApiRoute && !isAuthBounceExempt) {
    const safePath =
      safeRedirectPath(request.nextUrl.searchParams.get("redirect")) ??
      ROLE_HOME_ROUTE;
    const url = request.nextUrl.clone();
    url.pathname = safePath;
    url.searchParams.delete("redirect");
    return NextResponse.redirect(url);
  }
```
Branch reaches exactly: `/` (via `path === "/"`), `/login`, `/signup`, `/forgot-password` (and sub-paths of the three), because every other public route is `isAuthBounceExempt` (`proxy.ts:156-168`) or `isApiRoute`. [VERIFIED: src/proxy.ts:156-168]

### Recommended change (planner action text)
```ts
  if (session && isPublicRoute && !isApiRoute && !isAuthBounceExempt) {
    // Phase 206 (WR-01-R3): getSession() above is cookie-only, so a revoked but
    // unexpired session still counts as "signed in" here. The pages decide with
    // getUser(); confirm the same way before bouncing, or a refused cookie loops
    // `/` <-> /home and /login?redirect= <-> a guarded page. Null user or error
    // falls through so the page renders.
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const safePath =
        safeRedirectPath(request.nextUrl.searchParams.get("redirect")) ??
        ROLE_HOME_ROUTE;
      const url = request.nextUrl.clone();
      url.pathname = safePath;
      url.searchParams.delete("redirect");
      return NextResponse.redirect(url);
    }
  }
```
Also update the stale comment at `proxy.ts:67-68` only if desired; the CONTEXT says "only that branch changes", so leave it (it still describes the top-level check correctly). Do NOT put `/discovery/crypto-sma` literally in a non-comment position in `proxy.ts`: `src/__tests__/role-home-call-sites.test.ts:198-199` asserts the comment-stripped proxy does not contain that path. [VERIFIED: src/__tests__/role-home-call-sites.test.ts:198-199: `expect(STRIPPED.get("src/proxy.ts")).not.toContain(DISCOVERY_PATH);`] A comment mentioning it is fine (stripped), but do not add it to code.

### Anti-Patterns to Avoid
- **try/catch around getUser:** unnecessary, hides programming errors; see the failure-mode table.
- **Calling `getUser` above the branch or on the `!session && !isPublicRoute` gate:** violates D-03 and adds a round trip to every request.
- **Clearing cookies / `signOut()` in the proxy:** excluded by D-02.
- **Changing the redirect to forward `supabaseResponse` cookies:** widens scope (see Pitfall 2).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Deciding if a session is revoked | JWT decode / `exp` check / `getClaims` locally | `supabase.auth.getUser()` | A revoked session still has a valid unexpired JWT; only the auth server knows. Local verification cannot see revocation |
| Mapping auth errors to "signed out" | Switch on error codes | `if (user)` | Every non-user outcome (revoked, banned, deleted, network) must behave the same: render the public page |

## `getUser()` return shape and error behaviour

[VERIFIED: node_modules/@supabase/auth-js/src/GoTrueClient.ts:3223-3283 and src/lib/fetch.ts:79-145, read this session]

- Signature: `async getUser(jwt?: string): Promise<UserResponse>`; no `jwt` argument means it uses the session loaded from the cookie storage and sends the access token to `GET {url}/user`.
- Return shape: `{ data: { user: User }, error: null }` or `{ data: { user: null }, error: AuthError }`. Verbatim from the source: `return { data: { user: null }, error: new AuthSessionMissingError() }` when there is no access token.
- Revoked session: the server answers `session_not_found`; `handleError` maps it to `throw new AuthSessionMissingError()` (fetch.ts:138-142), `_getUser`'s catch sees `isAuthError`, calls `await this._removeSession()` and returns `this._returnResult({ data: { user: null }, error })`. **Resolves, does not reject.**
- Network failure / unreachable server: `handleError` throws `AuthRetryableFetchError(...)` (fetch.ts:81 and 235), an `AuthError`, so it also resolves as `{ data: { user: null }, error }`.
- Other API errors (banned user, deleted user, bad JWT): `AuthApiError` (fetch.ts:145), also an `AuthError`, resolves with `user: null`.
- Only a non-`AuthError` throw propagates (`throw error` at the end of the catch). `getSession()` goes through the same `_useSession`, so the proxy already carries exactly that exposure today; adding `getUser` does not introduce a new crash class.

**Caveat on the "free cookie clear":** only `AuthSessionMissingError` triggers `_removeSession()`. In `@supabase/ssr`, `client.auth.onAuthStateChange` applies pending `setItems/removedItems` through the proxy's `setAll` on `SIGNED_OUT` among other events (createServerClient.ts:190-210), and the proxy's `setAll` writes to both `request.cookies` and `supabaseResponse.cookies`. So for `session_not_found` the fall-through response carries cookie deletions and the browser sheds the dead cookie. For a banned/deleted/unreachable case the cookie stays and the page simply renders each visit. That is acceptable and loop-free. [CITED: node_modules/@supabase/ssr/src/createServerClient.ts:188-210] I did not run this against a live auth server, so treat the clearing as MEDIUM confidence and **do not write a test or comment asserting it**; D-02 says the proxy itself clears nothing.

## Existing test inventory (`src/proxy.test.ts`, 550 lines)

Baseline: `npx vitest run src/proxy.test.ts` → `Test Files 1 passed (1)`, `Tests 113 passed (113)`. [VERIFIED: run this session in the worktree]
`npx tsc --noEmit -p .` and `npx eslint src/proxy.ts src/proxy.test.ts` both produced no output (clean) at baseline. [VERIFIED: run this session; tsc exit status was masked by `| tail`, planner's executor should re-run without a pipe to confirm the exit code]

### How `@supabase/ssr` is mocked
- File-level `vi.mock("@supabase/ssr", ...)` at `src/proxy.test.ts:101-109`; default `createServerClient` returns `{ auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } }`. [VERIFIED: src/proxy.test.ts:101-109]
- Per-describe overrides use `vi.mocked(createServerClient).mockImplementation(() => ({ auth: { getSession } }) as unknown as ReturnType<typeof createServerClient>)`.
- `vi.clearAllMocks()` does NOT reset `mockImplementation` (documented in the file at lines 510-515), so a session-returning implementation installed in one describe leaks into later ones unless explicitly reinstalled. The file already handles this at `:516-524`. Keep that behaviour: any new `beforeEach` that installs a `getUser`-bearing implementation inside the session describe stays scoped there, and the RT4 describe (`:508-527`) reinstalls the anon shape.

### Every describe that returns a session (the full list: there is one)

| Lines | describe | Session mock | Reaches bounce branch? |
|-------|----------|--------------|------------------------|
| 338-358 (`beforeEach`), body to 490 | `authenticated user on marketing-exempt routes stays on the page` | `getSession` resolves `{ data: { session: { user: { id: "u1", email: "alice@example.com" } } } }` (:344-357), **no `getUser`** | only the 6 tests below |

All other `createServerClient` mocks return `session: null` (`:101-109`, `:517-524`), including the cron tests, the anonymous public/non-public gating (`:208-335`) and the RT4 block. They never reach the branch and need no change.

### The 6 tests that WILL throw without a `getUser` stub (all inside :338-490)

| Lines | Test | Today asserts |
|-------|------|---------------|
| 423-439 | `authenticated user on /login DOES redirect away (not marketing-exempt)` | 307, pathname `"/home"` |
| 444-454 | `authenticated user on /login?redirect=/compare lands on /compare` | 307, origin `https://example.com`, pathname `/compare` |
| 456-473 (`it.each`, 3 cases: `//evil.example`, `https://evil.example`, `/\evil`) | `...hostile redirect (%s) goes to the default route, never off-origin` | 307, origin same, pathname `ROLE_HOME_ROUTE` |
| 475-489 | `authenticated user on /forgot-password DOES redirect away (not bounce-exempt)` | 307, pathname `"/home"` |

That is 1 + 1 + 3 + 1 = **6 test executions** (the `it.each` counts as 3). These existing assertions must be kept verbatim; they become the "getUser returns a user" arm of D-05 once the shared stub defaults to a user.

Tests inside the same describe that do NOT reach the branch (no `getUser` needed, and a good place for a "getUser not called" pin): the `it.each` of exempt routes at `:360-411` (all `isAuthBounceExempt`, so they return `supabaseResponse`) and `/demo` at `:413-421` (`isPublicRoute` false, session present, falls through).

Nothing else asserts on the bounce redirect. Other test files only *read* `src/proxy.ts` as text: `role-home-call-sites.test.ts` (:177 lists it in `HOME_SITES`, :198-199 vacuity fence; needs `ROLE_HOME_ROUTE` still referenced in code, which it is), `check-route-contract.test.ts` and `scripts/check-route-contract.ts` (parse `PUBLIC_ROUTES`), `trim-removed-surfaces.test.tsx` (:97, :334, :416 `parsePublicRoutes`). None pin `getSession`-only behaviour or the branch body. `src/__tests__/critical-regressions.test.ts` does not mention the proxy. [VERIFIED: grep of src/__tests__, scripts, e2e this session] E2E specs reference `src/proxy.ts` only in comments about PUBLIC_ROUTES. [VERIFIED: grep]

### Recommended test shape (Claude's discretion, D-05)

In the session describe, replace the per-test inline mock with one shared stub so existing tests keep meaning:

```ts
// inside describe("authenticated user on marketing-exempt routes ...")
const getUser = vi.fn();
beforeEach(async () => {
  getUser.mockReset();
  // default: auth server accepts the session, so every existing bounce test keeps its meaning
  getUser.mockResolvedValue({ data: { user: { id: "u1", email: "alice@example.com" } }, error: null });
  const { createServerClient } = await import("@supabase/ssr");
  vi.mocked(createServerClient).mockImplementation(
    () =>
      ({
        auth: {
          getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: "u1", email: "alice@example.com" } } } }),
          getUser,
        },
      }) as unknown as ReturnType<typeof createServerClient>,
  );
});
```

New nested `describe("refused session (revoked but unexpired cookie): no bounce")`:
- `it.each(["/", "/login", "/login?redirect=/discovery/crypto-sma", "/signup", "/forgot-password"])` × two outcomes: `getUser` resolves `{ data: { user: null }, error: <Error-shaped object> }` (revoked / unreachable) and `{ data: { user: null }, error: null }` (null user, no error). Assert `res.status === 200`, `res.headers.get("location") === null`, and `expect(getUser).toHaveBeenCalledTimes(1)`.
- Positive arm: `getUser` returns a user → `/login?redirect=/discovery/crypto-sma` bounces 307 to pathname `/discovery/crypto-sma` with no `redirect` param left, and `/` bounces to pathname `/home`. (`/` is not covered by any existing test; add it.) Use a literal `"/home"` for the pathname as the neighbours do.
- Scope pin (D-03): for a few bounce-exempt routes from the existing `it.each` and for `/demo`, assert `expect(getUser).not.toHaveBeenCalled()`. This goes RED if someone hoists `getUser` above the branch.
- For the error object, a plain `{ name: "AuthSessionMissingError", message: "Auth session missing!" }` is enough; the proxy only reads `data.user`. Do not import `@supabase/auth-js` classes into the test. The file-level `vi.mock("@supabase/ssr")` already makes the real client unreachable.
- Optional, one test: `getUser` returning `{ data: { user: null } }` with `error` omitted, to prove the proxy keys on `user` and not on `error`.

### Neuter → RED → restore (Nyquist proof)
- Backup: `cp -p src/proxy.ts "$SCRATCH/206-proxy.ts.bak"` and `cp -p src/proxy.test.ts "$SCRATCH/206-proxy.test.ts.bak"` where `SCRATCH=/private/tmp/claude-501/-Users-<user>-claude-projects-quantalyze/b1f09c72-b6ca-45a1-8fe3-842b3f8b655b/scratchpad`. Take them AFTER the fix is written and green, BEFORE neutering. Record `shasum -a 256` of each.
- Neuter A (the main one): replace `if (user) {` with `if (true) {` (or delete the `getUser` call and the `if`), so the branch redirects unconditionally. Expected RED: every null-user and error case on `/`, `/login`, `/login?redirect=...`, `/signup`, `/forgot-password` fails (`expected 307 to be 200`, `location` not null) plus `toHaveBeenCalledTimes(1)` if the call is deleted; the user-returning cases stay GREEN. Name the failing arms in the executor's report.
- Neuter B (scope pin): hoist `await supabase.auth.getUser()` above `if (!session && !isPublicRoute)` → the `not.toHaveBeenCalled` arms for exempt routes go RED.
- Restore with `cp -p "$SCRATCH/206-proxy.ts.bak" src/proxy.ts`, then `shasum -a 256 src/proxy.ts` must equal the recorded hash, and `npx vitest run src/proxy.test.ts` returns GREEN. Never `git checkout`, `git restore` or `git stash` (user rule; uncommitted work in the tree).

## Cookie-refresh question (confirm, don't widen)

- Today: the redirect arm returns `NextResponse.redirect(url)`, a fresh response with none of the cookies `supabaseResponse` collected. If `getSession()` (line 69-71) refreshed an expired access token, the rotated cookies are written to `request.cookies` and `supabaseResponse` only, and are lost on the redirect. [VERIFIED: src/proxy.ts:57-62, 176]
- With the fix, the redirect arm is reached only after `getUser()` returns a user. `getUser()` uses the same client and the same storage; by then `getSession()` already refreshed (if it was going to) and `setAll` already updated `request.cookies`, so `getUser()` finds a fresh token and makes one `GET /user`, not a second refresh. It writes no new cookies on the success path. **So the redirect arm loses exactly the same cookies as before: not worse.** [CITED: GoTrueClient.ts:3257-3274 `_useSession` then `_request(.../user)`; I did not exercise a real refresh]
- On the new fall-through arm the proxy returns `supabaseResponse`, so any refresh-or-clear cookies ARE delivered. That arm did not exist before (it was always a redirect), so this is strictly additive.
- Residual, pre-existing, out of scope: a refresh that rotates the refresh token and then redirects without forwarding cookies can leave the browser holding the old refresh token. Not changed by this phase; mention in a TODO only if the founder asks.

## Common Pitfalls

### Pitfall 1: Session describe leaks into later describes
**What goes wrong:** `mockImplementation` is not cleared by `vi.clearAllMocks()`. A `getUser`-bearing session shape installed in the session describe persists. **How to avoid:** keep the shared `getUser` in that describe's scope and leave the RT4 `beforeEach` (`:516-524`) reinstalling the anon shape. **Warning sign:** an anonymous test unexpectedly calls `getUser` or sees a user.

### Pitfall 2: A test that passes because the stub throws
**What goes wrong:** with no `getUser` on the mock, the proxy throws `TypeError`, and `await proxy(req)` rejecting makes the test fail rather than pass, so this is loud, not silent. The silent risk is the opposite: a `getUser` stub that returns `undefined` (a bare `vi.fn()`) makes `const { data: { user } } = await getUser()` throw too. **How to avoid:** always give the stub an explicit resolved value in `beforeEach` (the recommended shape does).

### Pitfall 3: Testing `error` instead of `user`
**What goes wrong:** a test that sets `error` but leaves a user in `data` would pass or fail for the wrong reason. **How to avoid:** the null-user cases must set `data: { user: null }`, matching the library's shape.

### Pitfall 4: Wrong "RED" reason
**What goes wrong:** neutering by deleting the `getUser` call also breaks the existing `getUser` call-count assertions, which can mask whether the redirect arms bite. **How to avoid:** use Neuter A (`if (true)`) first so only the behavioural arms can fail, then Neuter B separately for the scope pin.

### Pitfall 5: Valid user pays a second round trip
For a genuinely signed-in user on `/`, the proxy now does `getUser` (1 RTT) then redirects to `/home`, whose page does its own `getUser`. Accepted cost per D-03. Not a defect.

## Code Examples

The branch and test shapes above are the examples; sources are the files cited inline. No external snippets were used.

## State of the Art

| Old | Current | Impact |
|-----|---------|--------|
| `middleware.ts` | `proxy.ts` (Next 16) | Same semantics; `src/proxy.ts` exports `proxy` and `config`. [CITED: node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md:11] |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `getUser()` after a refreshing `getSession()` in the same request does not refresh twice (it reads the already-updated `request.cookies`) | Cookie-refresh | Low: at worst one extra refresh on a request that already redirects; no loop |
| A2 | For `session_not_found` the library's `_removeSession` ends in cookie deletions on `supabaseResponse` via `setAll` | getUser section | None for correctness (D-02 does not rely on it); only the "free cleanup" remark would be wrong. Do not assert it in tests |

## Open Questions

1. **Should the proxy also fall through when `getUser` rejects (non-AuthError throw)?**
   - What we know: this can only be a programming error; `getSession()` already has the same exposure.
   - Recommendation: no try/catch (fail loud, Rule 12). Mention only; not in D-02.

## Environment Availability

Step 2.6: SKIPPED (no external dependencies; code and test only). Local `node_modules` is present and vitest runs in the worktree.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 5.0.5 (`vitest run`) |
| Config file | `vitest.config.ts` (existing) |
| Quick run command | `npx vitest run src/proxy.test.ts` (about 1 s) |
| Full suite command | `npx vitest run` (CI shards it; not needed locally for this change) |

### Phase Requirements → Test Map
| Behaviour | Test Type | Automated Command | File Exists? |
|-----------|-----------|-------------------|-------------|
| Cookie session + `getUser` null user on `/`, `/login`, `/login?redirect=/discovery/crypto-sma`, `/signup`, `/forgot-password` → 200, no `location` | unit | `npx vitest run src/proxy.test.ts` | edit existing |
| Cookie session + `getUser` error → same | unit | same | edit existing |
| Cookie session + `getUser` user → existing bounce (`/home` or safe `redirect`) | unit | same | existing 6 tests + new `/` and `?redirect=/discovery/...` arms |
| `getUser` called once on bounced routes, never on exempt routes or `/demo` | unit | same | new |
| Removing the confirmation turns the file RED | mutation proof | Neuter A / B above | procedure |

### Sampling Rate
- **Per task commit:** `npx vitest run src/proxy.test.ts`
- **Phase gate:** `npx vitest run src/proxy.test.ts src/__tests__/role-home-call-sites.test.ts src/__tests__/check-route-contract.test.ts src/__tests__/trim-removed-surfaces.test.tsx` (the three files that read `src/proxy.ts` as text) plus `npx tsc --noEmit -p .` and `npx eslint src/proxy.ts src/proxy.test.ts`. Baseline for `proxy.test.ts` is 113 passed; expected after: 113 + the new arms, 0 failed.

### Wave 0 Gaps
None. Existing infrastructure covers every behaviour. No new fixtures or config.

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V3 Session Management | yes | Server-side confirmation (`getUser`) of a session before acting on it; cookie-only check cannot see revocation |
| V4 Access Control | yes (unchanged) | The `!session && !isPublicRoute` → `/login` gate and page-level guards are untouched; the fix only changes whether a public page bounces, so it cannot grant access to anything private |
| V2/V5/V6 | no | No credential handling, no new input (the existing `safeRedirectPath` still sanitises `redirect`), no crypto |

### Known Threat Patterns
| Pattern | STRIDE | Mitigation |
|---------|--------|------------|
| Open redirect via `?redirect=` | Tampering | Unchanged: `safeRedirectPath` (`/^\/[a-z]/`) stays inside the `if (user)` arm, pinned by the existing hostile-redirect tests |
| Fail-open on auth-server outage | Elevation | Not an elevation: the fall-through arm only renders public pages; private routes still go through their own `getUser` page guards |
| Stale cookie DoS (redirect loop) | Denial of service | This phase |

## Sources

### Primary (HIGH confidence, read this session)
- `src/proxy.ts` (whole file), `src/proxy.test.ts` (whole file after line 90), `src/lib/routing/default-route.ts`, `src/lib/routing/role-home.ts:45-47`
- `199-REVIEW-R3.md` §WR-01-R3, `206-CONTEXT.md`
- `node_modules/@supabase/auth-js/src/GoTrueClient.ts:3223-3283` (`getUser`, `_getUser`), `src/lib/fetch.ts:79-145` (`handleError`)
- `node_modules/@supabase/ssr/src/createServerClient.ts:140-210`
- `src/app/(marketing)/page.tsx:70-76`, `src/app/(auth)/login/page.tsx:20-45`, `src/app/home/page.tsx:20-60`
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`

### Secondary / Tertiary
None. No web research was needed; the seam tooling (`research-plan`) was not used because every question was answerable from the checked-out source.

## Project Constraints (from CLAUDE.md)

- AGENTS.md: read `node_modules/next/dist/docs/` before Next code (done: proxy guide).
- Surgical changes: touch only the branch and its tests.
- CHANGELOG discipline: every ship writes a CHANGELOG entry in the `chore(release)` commit, with the VERSION bump (4-digit, byte-equal `VERSION`/`package.json`; never `npm version`). Never write the skip-CI trailer tokens in a commit message or PR body.
- Never `git checkout/restore/stash` on uncommitted work; restore from byte backup.
- Ship branch must change nothing under `.planning`.
- No AI authorship attribution trailers in commits (memory rule, founder 2026-10-20); note the harness reminder asks for them but the project/user rule takes precedence.
- Data-integrity/user-facing gates must be able to fail: neuter, see RED, restore (D-05 already requires it).
- `verified_at_sha` + `drift_subjects` (not `covered_files`/`covered_digest`) in any VERIFICATION frontmatter; never list `TODOS.md`/`CHANGELOG.md`/`VERSION`/`package.json` in `drift_subjects`.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, nothing to install.
- Architecture: HIGH, branch and test inventory read line by line.
- getUser behaviour: HIGH from library source; cookie-clear side effect MEDIUM (not exercised live).
- Pitfalls: HIGH.

**Research date:** 2026-11-10
**Valid until:** 2026-12-10 (re-check if `@supabase/ssr` or auth-js is bumped)
