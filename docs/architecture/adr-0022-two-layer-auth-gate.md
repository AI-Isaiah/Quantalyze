# ADR-0022: Route-level auth gating -- proxy optimistic, DAL authoritative

## Status
Accepted (retroactively documenting existing decision)

## Context
The application uses a two-layer authentication pattern recommended by
Supabase, but it is only documented in a code comment in `src/proxy.ts`
(lines 29-30). A new contributor may assume the proxy auth check is
authoritative and skip the `getUser()` call in a new route, creating a
silent authorization bypass on that specific route.

## Decision
Authentication uses a two-layer gate:

### Layer 1: Proxy (optimistic, fast-path)
`src/proxy.ts` calls `supabase.auth.getSession()`, which is a
cookie-only check with NO network call to Supabase Auth. This is
optimistic -- it trusts the JWT in the cookie without verifying it
against the server.

**Purpose**: Fast-path redirect to `/login` for unauthenticated users.
Prevents rendering authenticated pages for users with no session cookie.

**Trust level**: Optimistic. A crafted or expired JWT will pass this
check. This layer exists for UX (avoid rendering a page that will fail),
not for security.

### Layer 2: Server Component / Route Handler (authoritative)
Every Server Component and route handler calls `supabase.auth.getUser()`,
which makes a network call to Supabase Auth to verify the JWT. This is
the authoritative check.

**Purpose**: Verify the user's identity before accessing data. RLS
policies use `auth.uid()` from the verified JWT.

**Trust level**: Authoritative. The JWT is verified against Supabase Auth
servers. An invalid or expired JWT returns `null` for user.

### Invariant
Every non-public route MUST include a Layer 2 (`getUser()`) call. The
proxy check is NOT sufficient for authorization. Missing a `getUser()`
call in a new route is a security bug.

### Auth wrapper consolidation
For route handlers, use `withAuth` or `withAdminAuth` (see ADR-0004).
These wrappers encapsulate the `getUser()` call and return 401/403 on
failure.

For Server Components, call `getUser()` directly at the top of the
component and handle the null case (redirect or error boundary).

## Consequences

### Positive
- Surfaces the two-layer invariant so code reviews can enforce it.
- Makes the trust distinction explicit: proxy is UX, DAL is security.
- Consistent with Supabase's recommended architecture.

### Negative
- Every new page or route handler must repeat the `getUser()` call.
  There is no compile-time enforcement -- a missing call is a silent
  authorization bypass.
- The proxy layer adds latency (cookie parsing, JWT decoding) to every
  request, even for public routes.

## Evidence
- Proxy optimistic check: `src/proxy.ts` (lines 29-33) --
  `supabase.auth.getSession()` with comment marking it as optimistic.
- Proxy comment: `src/proxy.ts` (lines 29-30) -- "Authoritative
  getUser() should be called in server components/DAL."
- Layer 2 in dashboard layout: `src/app/(dashboard)/layout.tsx` (line 22).
- Layer 2 in allocations: `src/app/(dashboard)/allocations/page.tsx`
  (line 27).
- Layer 2 in discovery: `src/app/(dashboard)/discovery/layout.tsx`
  (line 32).
- `withAuth` wrapper: `src/lib/api/withAuth.ts` (lines 7-16) --
  encapsulates `getUser()` for route handlers.
