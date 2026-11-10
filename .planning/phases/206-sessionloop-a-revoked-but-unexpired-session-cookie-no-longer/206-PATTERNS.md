# Phase 206: SESSIONLOOP - Pattern Map

**Mapped:** 2026-11-10
**Files analyzed:** 2 (both modified, both git-tracked)
**Analogs found:** 2 / 2 (analogs are inside the same files)

## File Classification

| Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `src/proxy.ts` (bounce branch, lines 169-177) | middleware | request-response | the branch itself plus the comment style at lines 119-123 | exact |
| `src/proxy.test.ts` (describe at 338-490 plus a new nested describe) | test | request-response | the same describe's `beforeEach` at 342-358 | exact |

## Pattern Assignments

### `src/proxy.ts` (middleware, request-response)

**Current branch** (lines 169-177), to wrap in `getUser()`:
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
Target shape: add `const { data: { user } } = await supabase.auth.getUser();` as the first statement. Wrap the existing five lines in `if (user) { ... }`. Otherwise fall through to line 179 onward, which returns `supabaseResponse`. The `supabase` client is in scope from line ~50 (its cookie adapter writes to `supabaseResponse`, lines 60-62).

Destructuring `data.user` throws only if `data` is null. supabase-js always returns `{ data: { user: null }, error }`. The tests should still mock the error case with `data: { user: null }`.

**Comment style to copy** (lines 119-123, and 67-68 for the cookie-only note):
```ts
  // Phase 199 (CD-07) — /home is the one server role-home redirect. It is public
  // so a signed-out visit reaches the page (which sends it to /) instead of a
  // proxy 307 to /login, and bounce-exempt so a signed-in GET stays on /home
  // ...
```
Write the new comment as `// Phase 206 (SESSIONLOOP, WR-01-R3) — ...`. It must say that getSession() is cookie-only, that page guards use getUser(), and that the bounce therefore confirms with getUser(). Without that confirmation a revoked cookie loops `/` <-> `/home` and `/login?redirect=` <-> `/discovery/...`. A null user or an error falls through, and the proxy does not clear cookies (D-02).

Also update the now-stale comment at lines 67-68 ("Authoritative getUser() should be called in server components/DAL"). This is optional. Add one clause rather than rewriting it (surgical change).

### `src/proxy.test.ts` (test, request-response)

**Mock pattern** (lines 342-358), the per-describe `beforeEach` to copy:
```ts
    beforeEach(async () => {
      const { createServerClient } = await import("@supabase/ssr");
      vi.mocked(createServerClient).mockImplementation(
        () =>
          ({
            auth: {
              getSession: vi.fn().mockResolvedValue({
                data: { session: { user: { id: "u1", email: "alice@example.com" } } },
              }),
            },
          }) as unknown as ReturnType<typeof createServerClient>,
      );
    });
```
Required edit: add `getUser: vi.fn().mockResolvedValue({ data: { user: { id: "u1", email: "alice@example.com" } }, error: null })` next to `getSession`. Without it, the existing bounce tests at 423-489 throw `getUser is not a function`.

The 4 existing bounce assertions (423-489: /login to /home, `?redirect=/compare`, 3 hostile redirects, /forgot-password) stay unchanged and keep their meaning. The top-level `vi.mock("@supabase/ssr")` at 101-109 has only `getSession` returning null. That is fine, because the signed-out path never reaches the branch.

**Redirect assertions to copy** (lines 431-438 and 449-453):
```ts
      expect(res.status).toBe(307);
      expect(new URL(res.headers.get("location")!).pathname).toBe("/home"); // literal, not ROLE_HOME_ROUTE
```
**No-redirect assertions to copy** (lines 408-409):
```ts
        expect(res.status).toBe(200);
        expect(res.headers.get("location")).toBeNull();
```

**New nested describe** goes inside the 338 describe (before its closing `});` at line 490). Re-mock `createServerClient` in its own `beforeEach`. Keep the getSession session stub and give `getUser` a per-test result, for example:
```ts
function mockStaleSession(getUserResult: unknown) { /* mockImplementation with getSession=session, getUser=vi.fn().mockResolvedValue(getUserResult) */ }
```
Cases to cover (D-05):
- `it.each(["/", "/login", "/login?redirect=/discovery/crypto-sma", "/signup", "/forgot-password"])` with `{ data: { user: null }, error: null }` expects 200 and no location.
- The same paths with `{ data: { user: null }, error: { message: "session_not_found" } }` expects 200 and no location.
- A user is returned: `/login` goes to `/home` (literal), and `/login?redirect=/discovery/crypto-sma` goes to `/discovery/crypto-sma`.
- Optionally assert `getUser` was called exactly once for a bounced path.

**Cleanup warning:** `describe` at 508 (RT4) re-installs the null-session mock in its own `beforeEach`, explained in its comment at 510-515. A new nested describe inside 338 leaks nothing into it, so there is nothing more to restore. Do not add `vi.clearAllMocks` there.

**RED proof (D-05):** back up `src/proxy.ts` to the scratchpad by bytes (`cp`), remove the `getUser` guard so the redirect is unconditional, run `npx vitest run src/proxy.test.ts` and expect the null-user and error cases RED. Then restore from the backup. Do not use git checkout/stash.

## Shared Patterns

- Phase or review ids are cited in comments (`Phase 199 (CD-07)`, `51-REVIEW`, `Phase 192 D-11`). Use `Phase 206 (SESSIONLOOP, WR-01-R3)`.
- Pin routing targets as string literals in tests (`"/home"`), never by comparing a constant with itself (comment at 436-437). `ROLE_HOME_ROUTE` is used only in the hostile-redirect test (471).
- The gotcha at 510-515: `vi.clearAllMocks()` does not reset `mockImplementation`, so every describe that needs a particular shape re-installs it.

## No Analog Found

None. Both files are modified in place.

## Metadata

**Analog search scope:** `src/proxy.ts`, `src/proxy.test.ts`
**Files scanned:** 2
**Pattern extraction date:** 2026-11-10
