# ADR-0009: Caching strategy -- force-dynamic by default, CDN cache for public demo only, no Cache Components

## Status
Accepted (retroactively documenting existing decision)

## Context
Next.js 16 introduced Cache Components (PPR, `'use cache'`, `cacheLife`,
`cacheTag`) as a major new feature. The team has made a deliberate choice
to NOT adopt these features. Every authenticated dashboard route is
`force-dynamic`, every query is per-request, and the only CDN cache is on
the public `/demo/*` surface.

This is a safe default for an application that handles exchange API keys
and attestation-gated data, but it is also a wholesale rejection of the
Next.js 16 caching model. Without documentation, a future contributor will
almost certainly "improve performance" by adding `'use cache'` to a route
and accidentally cache an auth-sensitive page.

## Decision

### Caching tiers

1. **Authenticated routes**: `force-dynamic` by default. No cross-request
   caching at any layer. Every request hits the database. This is mandatory
   for attestation-gated routes (`/discovery/*`, `/recommendations`).

2. **Public demo pages**: CDN cache via `Cache-Control: public, s-maxage=60,
   stale-while-revalidate=300` set in `next.config.ts` headers. The pages
   are still `force-dynamic` (to avoid ISR build-time crashes without
   `SUPABASE_SERVICE_ROLE_KEY`), but response-level headers let Vercel's
   edge CDN absorb traffic.

3. **Per-request dedupe**: `React.cache` is used for request-scoped
   deduplication (e.g., `getRealPortfolio` in `src/lib/queries.ts`). This
   is NOT a cross-request cache -- it prevents duplicate DB calls within
   a single render tree.

### Explicitly NOT adopted
- `'use cache'` directive
- `cacheLife` / `cacheTag`
- `unstable_cache`
- Partial Prerendering (PPR)

Adopting any of these features requires a new ADR that addresses:
- How auth-sensitive data is excluded from cached segments
- How attestation gates are preserved
- What invalidation strategy replaces `force-dynamic`

## Consequences

### Positive
- Prevents the most likely security regression in this codebase:
  accidentally caching an auth-sensitive page.
- Simple mental model: all authenticated routes are always fresh.
- Discovery layout comment (lines 4-8) explicitly warns about this risk,
  and this ADR makes the warning authoritative.

### Negative
- Leaves performance on the table. Every authenticated page load hits the
  database. Acceptable for v1 traffic volumes.
- Future scaling may require selective caching, which will need careful
  per-route analysis.

## Evidence
- CDN cache headers: `next.config.ts` (lines 4-23) -- `s-maxage=60,
  stale-while-revalidate=300` on `/demo/:path*` only.
- `force-dynamic` exports:
  - `src/app/(dashboard)/scenarios/page.tsx` (line 7)
  - `src/app/(dashboard)/discovery/layout.tsx` (line 9)
  - `src/app/(dashboard)/exchanges/page.tsx` (line 9)
  - `src/app/(dashboard)/recommendations/page.tsx` (line 13)
  - `src/app/demo/page.tsx` (line 38)
  - `src/app/demo/founder-view/page.tsx` (line 8)
  - `src/app/api/cron/warm-analytics/route.ts` (line 23)
- `React.cache` usage: `src/lib/queries.ts` (lines 488-500) --
  `getRealPortfolio` request-scoped dedupe.
- Zero Cache Component usage: grep for `'use cache'`, `unstable_cache`,
  `cacheLife`, `cacheTag` returns no matches.
