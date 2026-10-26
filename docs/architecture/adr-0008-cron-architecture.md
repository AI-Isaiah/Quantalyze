# ADR-0008: Background job / cron architecture -- multiple mechanisms with defined roles

## Status
Proposed (decision needed to assign each mechanism a clear role)

> **CORRECTED 2026-10-10 (Phase 167.1.2.2.2):** current status is **Accepted in
> practice, never formally ratified.** The mechanisms below are the ones that run,
> with one exception: the Edge Function mechanism, which the doc-vs-live note under
> Evidence records as not deployed. The line above is kept as lineage. Statements
> in this document that proved false are corrected beside the sentence they
> correct, each with a dated `CORRECTED` note; no decision text has been removed.
> `src/__tests__/adr-0008.test.ts` fails while a known-false sentence stands
> without such a note.

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

> **CORRECTED 2026-10-10 (Phase 167.1.2.2.2) — mechanism 3's auth.** The row above
> says `X-Service-Key` comes from a Postgres GUC. It does not. The service key is
> read from Supabase Vault and the destination URL from `public.system_settings`
> (`analytics_service_url`), which the function re-tests against an allow-list
> before it posts anything. The pattern is set by
> `supabase/migrations/20260907120000_analytics_service_settings_and_vault_tick.sql`
> and hardened by `supabase/migrations/20260911120000_vault_tick_hardening.sql`.
> The app-GUC read pattern was retired, and `scripts/lint-app-guc.mjs` fences new
> migrations against it. The original row is kept as lineage.
>
> **CORRECTED 2026-10-10 (Phase 167.1.2.2.2) — mechanism 5's trigger.** The row
> above says `cron_sync` is triggered by mechanism 3. Nothing triggered it: no
> `cron.job` row, Vercel cron, workflow schedule or Railway cron ever called
> `/api/cron-sync`, so the live strategy keys it exists for went unsynced for up to
> 156 days while this document said the question was answered. Root cause:
> `.planning/debug/cron-sync-unscheduled.md`. It is now triggered by
> `public.cron_sync_tick()` on the pg_cron job `cron-sync-trades`, a mechanism 3
> job whose registration is made by the phase's go-live runbook
> (`docs/runbooks/cron-sync-go-live.md`) and never by a migration. Read `scripts/prod-prober/cron-manifest.json` to see whether the job
> is registered, not this sentence. The original row is kept as lineage.

### Problems
- `alert-digest` uses `!==` for CRON_SECRET comparison (timing-unsafe).
- `vercel.json` now declares cron schedules, but historically these were
  registered via the Vercel dashboard only.
- No single observability table covers all mechanisms (`cron_runs` only
  tracks Mechanism 3).

## Decision
Assign each mechanism a workload class:

1. **Infra health pings** (analytics warmup) -> Vercel Cron via
   `vercel.json`. Schedule: daily (`0 0 * * *`). Originally every 5 minutes;
   downgraded 2026-04-10 on the Hobby plan (see
   `docs/runbooks/vercel-cron-upgrade.md`). The per-request warmup in
   `src/lib/warmup-analytics.ts` is now the primary cold-start mitigation.

2. **Cross-service orchestration** (match engine recompute, data sync) ->
   Supabase pg_cron calling FastAPI directly. Keeps secrets in DB GUCs,
   avoids routing through Vercel.

   > **CORRECTED 2026-10-10 (Phase 167.1.2.2.2):** the secrets are not in DB GUCs.
   > The service key lives in Supabase Vault and the destination in
   > `public.system_settings`; see the correction under the mechanisms table. The
   > decision itself (pg_cron calling FastAPI directly) stands, and the sentence
   > above is kept as lineage.

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
| Analytics warmup | 0 0 * * * | Vercel Cron (1) | `/api/cron/warm-analytics` |
| Alert digest | 0 9 * * * | Vercel Cron (4) | `/api/alert-digest` |
| Match recompute | Hourly | pg_cron (3) | FastAPI `/api/match/cron-recompute` |
| Trade sync (`cron-sync-trades`) | 10 0 * * * | pg_cron (3) | FastAPI `/api/cron-sync`, called by `public.cron_sync_tick()` |
| Stuck-`computing` reaper | `*/15 * * * *` | pg_cron, **in-DB SQL** (no FastAPI hop) | `reap_strategy_analytics_stuck_computing` |
| Compute trigger | On insert | Edge Function (3) | `compute-trigger` |
| Admin notification | On event | Edge Function (3) | `notify-admin` |

> **CORRECTED 2026-10-10 (Phase 167.1.2.2.2) — the trade-sync row.** The inventory
> had no row for `/api/cron-sync`; the `cron-sync-trades` row is added above. The
> tick does not read every active key. It reads only connected keys that back an
> eligible strategy (4 on PROD when measured on 2026-10-09: 3 OKX, 1 Bybit). Three
> classes are excluded, each for a recorded reason. Disconnected keys: the user
> disconnected them but their credentials remain, so reading them would resume
> reading an account after its owner left. Connected allocator-only keys: there is
> no strategy to store trades for, so the tick would only overwrite the account
> balance and a second `last_sync_at` that the daily holdings poll owns. Revoked
> allocator-only keys: validation fails on every run and the key is never
> deactivated, so the `revoked` counter would read non-zero forever and poison any
> alarm built on it. The "Compute trigger" row above is historical: see the
> correction under Evidence.

> **CHANGED 2026-10-26 (Phase 167.2.1.1.1 NAVMTM) — the trade-sync schedule and
> what the tick enqueues.** D-03 moved the daily chain to just after 00:00 UTC so
> that every stored account mark sits on the UTC day boundary and labels the day
> that just closed: `refresh-benchmark` (Vercel) at 00:05Z, `cron-sync-trades` at
> 00:10Z, `derive-allocator-key-dailies` at 00:40Z, in that order. The row above
> previously read `30 4 * * *`. The schedule lives in PROD `cron.job` and in the
> committed manifest `scripts/prod-prober/cron-manifest.json`; the live move is an
> operator step (`docs/runbooks/navmtm-chain-move-go-live.md`) and the manifest is
> re-captured by the prober after it, never edited by hand. D-02: the tick now
> enqueues a derive for every eligible strategy of a key whose fetch was not
> degraded, not only those that stored new trades, so every eligible strategy of a
> healthy key is derived daily and its mark is written. The exclusions in the
> correction above are unchanged. Until the live move the job still runs at its old
> time and this row describes the committed intent.

> The reaper (added v0.52.0.0) is a **sixth shape** the five mechanisms above do
> not describe: pg_cron running SQL directly in the database, with no service
> call and therefore no auth pattern at all. It terminalizes `strategy_analytics`
> rows stranded in `computing` past a 16-hour threshold. It is deliberately
> in-DB — the failure it repairs is "the worker died", so routing its repair
> through the worker would make it unreachable exactly when it is needed. Note
> this also means it writes **no `cron_runs` row**; observability is
> `cron.job_run_details`. See [`docs/runbooks/compute-queue.md`](../runbooks/compute-queue.md)
> § "The stuck-`computing` reaper". This inventory is a partial snapshot — the
> prod project carries 8 registered pg_cron jobs.
>
> **CORRECTED 2026-10-10 (Phase 167.1.2.2.2):** that count is stale and no number is
> restated here. The registered pg_cron jobs are the `jobs` array of the committed
> manifest `scripts/prod-prober/cron-manifest.json`, which is re-captured whenever
> a job is registered or removed. Count it there. The sentence above is kept as
> lineage.

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
- pg_cron: `supabase/migrations/20260408113029_cron_heartbeat.sql` (lines 162-176),
  `supabase/migrations/20260408215026_schedule_match_cron_hourly.sql` (lines 65-79).
- pg_cron (in-DB SQL, no service hop):
  `supabase/migrations/20260803130000_reaper_limit_bound_materialized_cte.sql`
  — the currently-registered `reap_strategy_analytics_stuck_computing` body,
  superseding the registrations in `20260802120000` and `20260803120000`.
- Edge Functions: `supabase/functions/compute-trigger/index.ts`,
  `supabase/functions/notify-admin/index.ts`.
  > **⚠ Doc-vs-live drift (flagged 2026-06-20, tech-debt #13):** these two
  > functions are described above as in-production infrastructure, but a live
  > check of the prod project found **zero deployed edge functions** and **no
  > DB trigger / migration invokes them** (no `net.http_post`, no `functions/v1`
  > reference anywhere in `supabase/migrations/`). The source files are kept (a
  > prior dead-code pass deferred them for exactly this reason), but the
  > deployment described here is not currently live. Resolve before relying on
  > this path: either (re)deploy + wire the invocation, or retire this section
  > and the source if the compute/notify paths now run elsewhere (the Railway
  > self-polling worker + `analytics-service/routers/cron.py` cover compute).
  >
  > **CORRECTED 2026-10-10 (Phase 167.1.2.2.2):** the `compute-trigger` source was
  > removed in v0.42.1.0 (Phase 106, Stage B legacy/dark-path cutover), so the
  > `supabase/functions/compute-trigger/index.ts` citation above points at a file
  > that no longer exists. Only `notify-admin` source remains in the tree. The
  > citation is kept as lineage, and the "Compute trigger" inventory row is
  > historical.
- Python cron: `analytics-service/routers/cron.py` (`cron_sync` at lines 297-688).
- Python cron (corrected 2026-10-10, Phase 167.1.2.2.2): `analytics-service/routers/cron.py`,
  the `cron_sync` route, cited by symbol because the line range above rotted as the
  route grew. Called by `public.cron_sync_tick()`, defined by the migration whose
  filename ends `_cron_sync_tick.sql` under `supabase/migrations/`.
- `cron_runs` table: `supabase/migrations/20260408113029_cron_heartbeat.sql`.
- `vercel.json` crons block: `vercel.json` (lines 6-9).
