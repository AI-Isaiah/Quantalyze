# ADR-0008: Background job / cron architecture -- multiple mechanisms with defined roles

## Status
Proposed (decision needed to assign each mechanism a clear role)

## Context
Five places exist to schedule background work, using three different auth
patterns. No central registry documents "what runs on what schedule and
where." The team will not remember this architecture in 3 months without
codification.

### Current mechanisms

| # | Mechanism | Auth pattern | Example |
|---|-----------|-------------|---------|
| 1 | Vercel Cron -> Next route handler | Bearer `CRON_SECRET`, constant-time compare | `warm-analytics` |
| 2 | Vercel Cron -> Next route handler | Bearer `CRON_SECRET`, `!==` (NOT constant-time) | `alert-digest` |
| 3 | Supabase pg_cron -> FastAPI | `X-Service-Key` via Postgres GUC | match recompute |
| 4 | Supabase Edge Functions (Deno) | Supabase service-role JWT | `compute-trigger`, `notify-admin` |
| 5 | Python-side cron_sync | Triggered by Mechanism 3 | `analytics-service/routers/cron.py` |

### Problems
- `alert-digest` uses `!==` for CRON_SECRET comparison (timing-unsafe).
- `vercel.json` now declares cron schedules, but historically these were
  registered via the Vercel dashboard only.
- No single observability table covers all mechanisms (`cron_runs` only
  tracks Mechanism 3).

## Decision
Assign each mechanism a workload class:

1. **Infra health pings** (analytics warmup) -> Vercel Cron via
   `vercel.json`. Schedule: every 5 minutes.

2. **Cross-service orchestration** (match engine recompute, data sync) ->
   Supabase pg_cron calling FastAPI directly. Keeps secrets in DB GUCs,
   avoids routing through Vercel.

3. **Event-triggered compute** (post-insert triggers) -> Supabase Edge
   Functions. Already in place for `compute-trigger` and `notify-admin`.

4. **Time-based Next.js work** (alert digests, scheduled notifications) ->
   Vercel Cron via `vercel.json`.

5. **All paths** should log to a single observability table. Extend
   `cron_runs` (from migration 013) to accept entries from Vercel Cron
   handlers as well.

### Mandatory fixes
- Fix the `alert-digest` route to use constant-time comparison for
  `CRON_SECRET` (matching the `warm-analytics` pattern).
- Ensure all Vercel Cron schedules are declared in `vercel.json` (not
  registered out-of-band via the dashboard).

### Job inventory

| Job | Schedule | Mechanism | Handler |
|-----|----------|-----------|---------|
| Analytics warmup | */5 * * * * | Vercel Cron (1) | `/api/cron/warm-analytics` |
| Alert digest | 0 9 * * * | Vercel Cron (4) | `/api/alert-digest` |
| Match recompute | Hourly | pg_cron (3) | FastAPI `/api/match/cron-recompute` |
| Compute trigger | On insert | Edge Function (3) | `compute-trigger` |
| Admin notification | On event | Edge Function (3) | `notify-admin` |

## Consequences

### Positive
- Operators can answer "where does job X run?" from this document.
- Fixes the timing-unsafe CRON_SECRET comparison in alert-digest.
- Cron schedules are version-controlled in `vercel.json`.

### Negative
- Extending `cron_runs` to cover Vercel Cron handlers requires a new
  migration.
- Five mechanisms remain (inherent complexity of the three-provider
  topology from ADR-0017), but each now has a defined role.

## Evidence
- Vercel Cron (constant-time): `src/app/api/cron/warm-analytics/route.ts`
  (lines 30-35).
- Vercel Cron (timing-unsafe): `src/app/api/alert-digest/route.ts`
  (lines 19-24).
- pg_cron: `supabase/migrations/013_cron_heartbeat.sql` (lines 162-176),
  `supabase/migrations/015_schedule_match_cron_hourly.sql` (lines 65-79).
- Edge Functions: `supabase/functions/compute-trigger/index.ts`,
  `supabase/functions/notify-admin/index.ts`.
- Python cron: `analytics-service/routers/cron.py` (lines 148-281).
- `cron_runs` table: `supabase/migrations/013_cron_heartbeat.sql`.
- `vercel.json` crons block: `vercel.json` (lines 6-9).
