# ADR-0018: Error handling -- no error boundaries, exceptions bubble to Next default

## Status
Proposed (decision needed to establish error handling strategy)

## Context
The application has no route-level error boundaries (`error.tsx`) and no
global error boundary (`global-error.tsx`). A Server Component throw
cascades to Next's default error surface, which in production shows a
generic error page and in development crashes the page. Error handling
patterns vary across the codebase with no consistent strategy.

### Current error handling patterns

**Pattern A -- Fail-closed in layout**: `src/app/(dashboard)/discovery/layout.tsx`
(lines 41-55) wraps the DB read in try/catch and renders the attestation
gate UI on failure. This is the most defensive pattern.

**Pattern B -- Silent fallback**: `src/app/page.tsx` (lines 7-24) returns
zeros for social-proof counts on failure. The user sees a working page
with incorrect data.

**Pattern C -- Route handlers log + 500**: `src/app/api/preferences/route.ts`
(lines 19-22) catches errors, logs to console, returns 500 JSON. Standard
for API routes.

**Pattern D -- Server Component throws propagate**: The code comment at
`src/lib/warmup-analytics.ts` (lines 11-17) warns "never throw -- Server
Components abort render on unhandled rejection in Next 16." This confirms
the team knows the risk but has not built the fallback layer.

### Risk
A single analytics DB hiccup during a dashboard page render crashes the
entire route. No branded error UI exists -- users see Next's default
error page or a white screen.

## Decision
**Open question -- the following elements must be decided:**

### 1. Route-level error boundaries
Add `error.tsx` at key route segments:
- `src/app/(dashboard)/error.tsx` -- branded error UI for all dashboard
  routes. Includes a "try again" button that calls `reset()`.
- `src/app/(auth)/error.tsx` -- branded error UI for auth flows.
- `src/app/global-error.tsx` -- last-resort boundary for root layout
  errors. Must be a client component that does NOT depend on the root
  layout's providers.

### 2. Server Component error policy
Codify when a server read should fail-closed vs fail-open:

| Scenario | Policy | Example |
|----------|--------|---------|
| Auth/attestation gate | Fail-closed (deny access) | Discovery layout |
| Social proof / vanity metrics | Fail-open (show fallback) | Landing page |
| User's own data | Fail-closed (show error boundary) | Portfolio page |
| Analytics computation | Fail-closed (show error boundary) | Scenarios page |

### 3. Route handler error policy
Standardize on Pattern C: catch at the handler level, log via the logger
abstraction (see ADR-0010), return structured JSON error with appropriate
status code. Never let an unhandled exception escape a route handler.

### 4. Logger integration
Error boundaries and catch blocks should report to the observability
layer chosen in ADR-0010. Until that decision is made, use `console.error`
with a standardized format that includes the route path and error type.

## Consequences

### Positive
- Users see branded error pages instead of white screens or Next defaults.
- The fail-closed vs fail-open policy prevents both silent data corruption
  (Pattern B) and unnecessary crashes.
- Error boundaries contain blast radius: a failing Server Component in
  `/scenarios` does not crash `/discovery`.

### Negative
- Adding error boundaries is net new code that must be maintained.
- The fail-closed vs fail-open distinction requires per-route judgment
  calls.
- Until ADR-0010 is resolved, error reporting remains console-only.

## Evidence
- Zero `error.tsx` files: no matches in `src/app/`.
- Zero `global-error.tsx` files: no matches in `src/app/`.
- Zero `unstable_rethrow` calls.
- Pattern A (fail-closed): `src/app/(dashboard)/discovery/layout.tsx`
  (lines 41-55).
- Pattern B (silent fallback): `src/app/page.tsx` (lines 7-24).
- Pattern C (log + 500): `src/app/api/preferences/route.ts` (lines 19-22).
- Pattern D (propagation warning): `src/lib/warmup-analytics.ts`
  (lines 11-17).
- Loading files exist (3 total) but no error files.
