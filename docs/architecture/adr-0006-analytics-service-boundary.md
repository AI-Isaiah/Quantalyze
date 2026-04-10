# ADR-0006: Service boundary to the Python analytics service

## Status
Accepted (retroactively documenting existing decision)

## Context
The Next.js frontend communicates with a Python FastAPI analytics service
hosted on Railway. The service handles compute-intensive operations:
analytics computation, trade fetching, key validation/encryption, portfolio
optimization, strategy verification, and match engine recomputation.

The frontend currently talks to the analytics service from FOUR different
places with TWO different client abstractions. No contract is documented.
TypeScript types are not generated from the FastAPI OpenAPI schema, so a
field rename in Python can silently break the frontend until a server
component throws at runtime.

### Current call paths
1. **`src/lib/analytics-client.ts`** -- the canonical JS client. Wraps
   8 endpoints with typed functions. Uses `X-Service-Key` auth header and
   a 30-second timeout via `AbortSignal.timeout()`.
2. **Inline fetch in `portfolio-optimizer` route** --
   `src/app/api/portfolio-optimizer/route.ts` (lines 36-46) inlines its
   own fetch with the same headers but divergent error handling.
3. **Inline fetch in `warm-analytics` cron** --
   `src/app/api/cron/warm-analytics/route.ts` (lines 60-64) does its own
   `/health` fetch.
4. **Supabase pg_cron** -- `supabase/migrations/013_cron_heartbeat.sql`
   and `015_schedule_match_cron_hourly.sql` call the FastAPI service
   directly via `pg_net` with `X-Service-Key` from a Postgres GUC.
5. **Supabase Edge Function** --
   `supabase/functions/compute-trigger/index.ts` (lines 43-72) calls
   the analytics service from Deno.

## Decision
`src/lib/analytics-client.ts` is the single callsite for all
frontend-to-analytics-service communication. No route handler may inline
its own fetch to the analytics service.

### Contract elements
- **Auth**: `X-Service-Key` header. The service validates this against
  `SERVICE_KEY` env var on every request except `/health`.
- **Timeout**: 30 seconds (`ANALYTICS_TIMEOUT_MS`). No retry policy
  (fail-fast for user-facing requests).
- **Cold-start handling**: See ADR-0007 for warmup strategy.
- **Error handling**: Non-2xx responses are parsed as JSON when possible,
  with fallback to text. Timeout errors are distinguished from network
  errors.

### Non-JS paths (documented exceptions)
- **pg_cron to FastAPI**: Supabase pg_cron calls the service directly
  using `pg_net` HTTP extension. The secret is stored in a Postgres GUC
  (`current_setting('app.analytics_service_key')`), not in JS env vars.
  This is a separate path that the JS client does not mediate.
- **Supabase Edge Function**: `compute-trigger` calls the service from
  Deno. This is event-triggered (post-insert) and uses `ANALYTICS_SERVICE_KEY`
  from the Edge Function's env.

### Follow-up work
- Retrofit `portfolio-optimizer` route to use `analytics-client.ts`.
- Generate TypeScript types from the FastAPI OpenAPI schema to catch
  field renames at build time.

## Consequences

### Positive
- Single migration point for typed clients or OpenAPI-driven generation.
- Observability gets a single pinch point for all JS-side calls.
- Error handling is consistent across all frontend call sites.

### Negative
- The Supabase Edge Function and pg_cron bypasses remain as non-JS paths
  that must be called out explicitly.
- The `ANALYTICS_SERVICE_KEY` plaintext secret appears in every caller's
  env surface.

## Evidence
- Canonical client: `src/lib/analytics-client.ts` (lines 1-93).
- Inline bypass (optimizer): `src/app/api/portfolio-optimizer/route.ts`
  (lines 36-90).
- Inline bypass (warmup): `src/app/api/cron/warm-analytics/route.ts`
  (lines 60-64).
- Warmup module: `src/lib/warmup-analytics.ts` (lines 27-55).
- FastAPI service auth: `analytics-service/main.py` (lines 51-66).
- pg_cron to FastAPI: `supabase/migrations/013_cron_heartbeat.sql`
  (lines 162-176), `supabase/migrations/015_schedule_match_cron_hourly.sql`
  (lines 65-79).
- Edge Function: `supabase/functions/compute-trigger/index.ts` (lines 43-72).
