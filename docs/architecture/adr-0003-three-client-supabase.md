# ADR-0003: Three-client Supabase pattern (browser / server / admin)

## Status
Accepted (retroactively documenting existing decision)

## Context
The application interacts with Supabase through three distinct client
instantiations, each with different trust properties and authorization
surfaces. There is no guidance on "when to reach for the admin client,"
and the decision is made ad-hoc per PR. Every admin-client call site is
effectively an RLS bypass and must carry its own authorization check --
this is where bugs are most likely to land.

## Decision
Three Supabase clients exist, each with a specific purpose:

### 1. Browser client (`src/lib/supabase/client.ts`)
- Uses `createBrowserClient` from `@supabase/ssr`.
- Runs with the anon key in the browser.
- RLS applies via the user's JWT in the cookie.
- Used in client components for real-time or client-side reads.

### 2. Server client (`src/lib/supabase/server.ts`)
- Uses `createServerClient` from `@supabase/ssr` with a cookie bridge.
- Created per-request in Server Components and route handlers.
- Runs under the caller's JWT, so RLS applies.
- This is the default client for all server-side reads and writes.

### 3. Admin client (`src/lib/supabase/admin.ts`)
- Uses `createClient` directly with `SUPABASE_SERVICE_ROLE_KEY`.
- Bypasses ALL RLS policies.
- Every call site MUST be preceded by an app-level authorization check.

### Admin client usage categories
Every `createAdminClient()` call site must be classifiable into one of:

- **(a) Service-to-service operations**: Operations that run without a
  user context (cron jobs, webhooks, system-level writes).
- **(b) Column-level PII reads**: Reads gated at the GRANT level where
  the server client cannot access specific columns (e.g., profiles PII
  hidden by migration 020's REVOKE pattern).
- **(c) Cross-tenant seeds/admin tools**: Admin dashboard operations
  that intentionally read across tenant boundaries.
- **(d) Audit table writes**: Writes to audit/dispatch tables that
  require service-role access.

Any new `createAdminClient()` usage that does not fit these categories
requires a new ADR or an amendment to this one.

## Consequences

### Positive
- Makes the RLS bypass paths explicitly inventoried.
- Review becomes mechanical: any new `createAdminClient()` import is an
  immediate discussion point in code review.
- Clear mental model for which client to use in any given context.

### Negative
- Some reads (e.g., `strategy_analytics.daily_returns`) legitimately
  need admin access because of column-level REVOKEs. These must be
  enumerated and maintained.
- The admin client is imported across many files; tracking all call
  sites requires periodic audit.

## Evidence
- Browser client: `src/lib/supabase/client.ts` (lines 1-8).
- Server client: `src/lib/supabase/server.ts` (lines 1-27).
- Admin client: `src/lib/supabase/admin.ts` (lines 1-12).
- Admin client usage in scenarios: `src/app/(dashboard)/scenarios/page.tsx`.
- Admin client in email: `src/lib/email.ts` (line 2).
- Admin client in queries: `src/lib/queries.ts`.
- `withAdminAuth` wrapper: `src/lib/api/withAdminAuth.ts` (lines 1-31).
- Admin notification routes: `src/app/api/admin/notify-submission/route.ts`.
- Strategy verification: `src/app/api/verify-strategy/route.ts`.
