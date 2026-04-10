# ADR-0017: Deployment topology -- Vercel (Next.js) + Railway (FastAPI) + Supabase (Postgres/Auth/Storage)

## Status
Accepted (retroactively documenting existing decision)

## Context
The application runs across three hosted providers with no self-hosting.
The topology is implicit -- discoverable only by reading env vars, config
files, and deployment manifests. Failure modes are asymmetric across
providers, and no diagram exists for incident response or onboarding.

## Decision
The deployment topology is a three-provider architecture:

### Provider roles

```
                    +------------------+
                    |     Vercel       |
                    |  (Next.js 16)    |
                    |  - App routes    |
                    |  - API handlers  |
                    |  - Cron triggers |
                    |  - CDN/Edge      |
                    +--------+---------+
                             |
              +--------------+--------------+
              |                             |
    +---------v---------+     +-------------v-----------+
    |     Railway        |     |       Supabase           |
    |   (FastAPI/Python) |     |  - Postgres (+ RLS)      |
    |  - Analytics       |     |  - Auth (Supabase Auth)   |
    |  - Match engine    |     |  - Storage                |
    |  - Key encryption  |     |  - pg_cron + pg_net       |
    |  - Portfolio opt.  |     |  - Edge Functions (Deno)  |
    +--------------------+     +---------------------------+
```

### Trust boundary
Three hostnames exist in the trust boundary, all wired via env vars:
- **Vercel URL**: `NEXT_PUBLIC_SITE_URL` (the user-facing hostname)
- **Railway URL**: `ANALYTICS_SERVICE_URL` (internal, not user-facing)
- **Supabase URL**: `NEXT_PUBLIC_SUPABASE_URL` (API + Auth + Storage)

### Failure mode table

| Provider down | Impact | Mitigation |
|---------------|--------|------------|
| **Supabase** | Everything fails -- auth, data reads, data writes | None; Supabase is the single point of failure |
| **Railway** | Match engine, sync, warmup, analytics computation fail. Read paths (dashboard, discovery) continue working with stale match data. | Warmup cron detects unhealthy state (ADR-0008). Graceful degradation in UI. |
| **Vercel** | Site is down. pg_cron jobs still run (Supabase -> Railway direct). | pg_cron continues match recomputation independently. |

### Explicit non-goals
- No self-hosting. All three providers are managed SaaS.
- No Kubernetes or container orchestration.
- No moving the FastAPI service into Next.js route handlers (compute
  requirements and Python ecosystem dependencies make this impractical).
- Single-region assumption: Vercel default region, Railway default region,
  Supabase project region. No multi-region or edge deployment.

## Consequences

### Positive
- Incident response has a diagram and failure-mode table.
- New contributors understand "what runs where" from this single document.
- Clear separation of concerns: Next.js for UI/API, Python for compute,
  Supabase for data/auth.

### Negative
- Supabase is a single point of failure with no mitigation.
- Cross-provider latency (Vercel -> Railway -> Supabase) adds up for
  compute-heavy operations.
- Three providers means three billing surfaces, three incident pages to
  monitor, three secret management UIs.

## Evidence
- Vercel config: `vercel.json` (lines 1-10).
- Railway config: `analytics-service/railway.toml`.
- Supabase migrations: `supabase/migrations/` directory.
- Tech stack documentation: `README.md` (lines 78-88).
- CI workflows: `.github/workflows/` directory.
- Env vars wiring: `.env.example` (lines 1-33).
- Service-to-service calls: `src/lib/analytics-client.ts` (ADR-0006).
- pg_cron direct calls: `supabase/migrations/013_cron_heartbeat.sql`,
  `supabase/migrations/015_schedule_match_cron_hourly.sql`.
