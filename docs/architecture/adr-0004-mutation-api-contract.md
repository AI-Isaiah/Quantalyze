# ADR-0004: Mutation model -- REST-ish route handlers, not Server Actions; CSRF via Origin check; rate limits via Upstash

## Status
Accepted (retroactively documenting existing decision)

## Context
The team chose route handlers over Server Actions for all mutations. The
reasoning is to make CSRF defense, rate limiting, and Origin checks
first-class concerns that are visible in code review. However, coverage is
incomplete: some mutation routes lack CSRF checks, rate limits, or use
inconsistent auth patterns. There are THREE distinct patterns for "is the
caller authenticated": the `withAuth` wrapper, inline
`createClient()+getUser()`, and the proxy pre-check.

## Decision

### Mutation contract
All mutations MUST use REST-ish route handlers (`src/app/api/**/route.ts`),
not Server Actions. The request lifecycle for every mutation is:

```
proxy (optimistic session check)
  -> route handler entry
    -> CSRF: assertSameOrigin(req) [mandatory for all mutations]
    -> Auth: withAuth(handler) or withAdminAuth(handler) [mandatory]
    -> Rate limit: checkLimit() [mandatory for sensitive writes]
    -> Handler logic
```

### Specific rules

1. **Route handlers over Server Actions**: No `'use server'` directives.
   Mutations are explicit HTTP endpoints with standard request/response
   semantics.

2. **Mandatory `withAuth`/`withAdminAuth`**: All mutation handlers MUST use
   the wrapper pattern from `src/lib/api/withAuth.ts` or
   `src/lib/api/withAdminAuth.ts`. Inline `createClient()+getUser()` is
   deprecated for new routes.

3. **Mandatory `assertSameOrigin`**: All mutation handlers MUST call
   `assertSameOrigin(req)` from `src/lib/csrf.ts` as the first operation.
   The app relies on Supabase's SameSite=Lax cookie as primary CSRF
   defense; Origin/Referer validation is defense-in-depth.

4. **Rate limiting by route class**:
   - Sensitive writes (attestation, deletion, key operations): `userActionLimiter`
   - Public-IP endpoints (PDF generation): `publicIpLimiter`
   - Admin operations: `adminActionLimiter`

### Routes requiring retrofit
The following routes currently lack one or more contract elements:
- `/api/preferences` -- no CSRF check, no rate limit
- `/api/portfolio-optimizer` -- no CSRF check, no rate limit
- `/api/admin/match/*` routes -- inconsistent auth patterns
- `/api/verify-strategy` -- no CSRF check, no rate limit
- `/api/keys/*` -- no rate limit

## Consequences

### Positive
- Uniform contract for new mutations; a missing CSRF check becomes a
  review-visible omission.
- Makes it easier to add observability (e.g., Sentry) at a single layer.
- Explicit HTTP semantics make the API testable with standard tools.

### Negative
- Migration cost: approximately 15 existing routes need retrofitting to
  the full contract.
- Route handlers are more verbose than Server Actions for simple mutations.

## Evidence
- Mutation routes: `src/app/api/**/route.ts` (multiple files).
- Zero Server Actions: grep for `'use server'` returns no matches in `src/`.
- CSRF module: `src/lib/csrf.ts` (lines 38-68) -- Origin/Referer allowlist.
- CSRF usage: `src/app/api/attestation/route.ts` (line 18),
  `src/app/api/account/deletion-request/route.ts`.
- CSRF gaps: `/api/preferences`, `/api/portfolio-optimizer`,
  `/api/admin/match/*` routes have no `assertSameOrigin` call.
- Rate limiting: `src/lib/ratelimit.ts` (lines 1-101) -- three limiter
  tiers with graceful degradation.
- Auth wrapper: `src/lib/api/withAuth.ts` (lines 1-16) -- used by 10 routes.
- Admin auth wrapper: `src/lib/api/withAdminAuth.ts` (lines 1-31) --
  used by 3 routes.
- Alert digest non-constant-time compare:
  `src/app/api/alert-digest/route.ts` (lines 19-24) uses `!==` instead
  of timing-safe comparison.
