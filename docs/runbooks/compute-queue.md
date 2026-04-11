# Compute Queue Runbook

Operational guide for the `compute_jobs` durable queue introduced in
Sprint 2 Task 2.9. Use this page when you get a Sentry alert, when the
wizard is stuck, or when you need to understand queue health during a
deploy.

This is a setup recipe and incident-response reference, not a spec. For
the full architecture see the plan at
`~/.claude/plans/lazy-hugging-raccoon.md` and migration 032.

> **⚠️ DO NOT flip `COMPUTE_QUEUE_ENABLED=true` until Round 2 ships.**
> Round 1 lands the SQL schema + RPCs + types + runbook only. The Python
> worker, the Next.js enqueue path, the Vercel fallback cron, and the
> `pg_try_advisory_xact_lock` double-execution guard all ship in Round 2.
> Until then, the queue exists but is intentionally dormant. Flipping the
> flag early would expose the watchdog-reclaim double-execution window
> that only the Round 2 advisory lock closes.

## What the queue is

A Postgres-backed compute queue that runs async jobs durably across
three kinds:

- `sync_trades` — fetch an exchange API key's trade history into
  `trades` (one job per exchange key)
- `compute_analytics` — run quantstats metrics over a strategy's
  `trades` (chained after sync_trades via fan-in)
- `compute_portfolio` — run portfolio-level metrics when any member
  strategy's analytics complete

Jobs survive Vercel function crashes, Railway cold starts, and
double-submit races. Retries happen automatically with exponential
backoff (`+30s`, `+2min`, then `failed_final`). A pg_cron watchdog
reclaims stuck jobs every 10 minutes.

Jobs are idempotent: only one in-flight row per `(target, kind)` exists
at any moment, enforced by partial unique indexes.

## Prerequisites

- `pg_cron` extension enabled in Supabase (production and staging)
- `pg_net` extension enabled in Supabase
- `app.analytics_service_url` GUC set to the Railway worker URL
- `app.analytics_service_key` GUC set to the Railway service key
- `COMPUTE_QUEUE_ENABLED` env var on Vercel:
  - `false` = /api/keys/sync uses the legacy `after()` path (rollback)
  - `true` = /api/keys/sync enqueues into compute_jobs (shipped state)
- `COMPUTE_QUEUE_HMAC_SECRET` env var (shared between Vercel fallback
  cron and Railway tick endpoint) for replay protection

Before flipping the flag on production, verify each prerequisite by
running the three observability queries below against the staging DB.

## Three observability queries (pin in Supabase Studio)

The queries you paste at 3am. Each one answers a different question in
under 10 seconds against normal traffic.

### Query 1 — current queue state

Answers: "Right now, how healthy is the queue?"

```sql
SELECT
  status,
  kind,
  exchange,
  count(*) AS rows
FROM compute_jobs
GROUP BY status, kind, exchange
ORDER BY status, kind, exchange;
```

Expected output on a healthy queue:
- Mostly `done` rows across kinds and exchanges
- Small `pending` count (a handful)
- 0–1 `running` rows per worker
- 0 `failed_final` rows

Red flags:
- `failed_final` count growing — real incident
- `running` count > 10 — watchdog isn't firing or workers are stuck
- `pending` count > 100 — tick endpoint is not draining the queue

### Query 2 — recent failures (last 24 hours)

Answers: "What broke in the last day, and is it transient or permanent?"

```sql
SELECT
  cj.strategy_id,
  cj.kind,
  cj.exchange,
  cj.attempts,
  cj.error_kind,
  cj.last_error,
  cj.updated_at
FROM compute_jobs cj
WHERE cj.status IN ('failed_retry', 'failed_final')
  AND cj.updated_at > now() - interval '24 hours'
ORDER BY cj.updated_at DESC;
```

Interpretation:
- `error_kind = 'transient'` with `attempts < 3` — it will retry on its
  own, no action needed
- `error_kind = 'transient'` with `attempts = 3` — gave up after 3
  tries. Manual retry from `/admin/compute-jobs` after you verify the
  underlying issue
- `error_kind = 'permanent'` — classified as unrecoverable (e.g.
  "Insufficient trade history", "Zero variance series"). Do NOT retry.
  Talk to the manager
- `error_kind = 'unknown'` — classifier didn't recognize the exception.
  Read the `last_error` text, decide, maybe file a classifier upgrade

### Query 3 — stuck jobs (watchdog sanity check)

Answers: "Is the watchdog doing its job?"

```sql
SELECT
  id,
  strategy_id,
  kind,
  exchange,
  claimed_at,
  claimed_by,
  attempts,
  (now() - claimed_at) AS stuck_for
FROM compute_jobs
WHERE status = 'running'
  AND claimed_at < now() - interval '10 minutes'
ORDER BY claimed_at;
```

Expected output: **empty**. The watchdog runs inside every tick and
resets running-but-stuck jobs back to `pending`. If this query returns
rows, either the watchdog is broken or the worker is genuinely still
processing a very long job.

Manual override: call `SELECT reclaim_stuck_compute_jobs(interval '5
minutes');` to force a reclaim with a tighter window.

## Running the circuit breaker

When an exchange returns 429 the Python runner calls
`update_api_key_rate_limit(api_key_id)` which stamps
`api_keys.last_429_at = now()`. The per-exchange cooldown windows live
in `analytics-service/services/jobs.py::get_circuit_breaker_window`:

- Bybit: 10 minutes
- Binance: 2 minutes
- OKX: 5 minutes

The runner reads `last_429_at` on every job start and skips any retry
that would fire within the cooldown window. The job stays in
`failed_retry` and picks up on the next tick after the window closes.

To check if a key is currently circuit-breaker-held:

```sql
SELECT id, exchange, label, last_429_at,
       (now() - last_429_at) AS since_429
FROM api_keys
WHERE last_429_at IS NOT NULL
  AND last_429_at > now() - interval '15 minutes'
ORDER BY last_429_at DESC;
```

## Incident response

### Alert: "Compute tick failed 3 times in a row"

Sentry fires this when the Railway `/api/jobs/tick` endpoint returns
5xx three ticks in a row (3 minutes of downtime).

1. Check Railway status — is the service up?
2. If up: check the compute-jobs-fallback Vercel cron at `*/5 * * * *`
   — it should be absorbing the failures with HMAC-verified retries to
   the Railway tick
3. If the fallback is also failing: the issue is deeper (Railway region
   outage, DB connectivity). Flip `COMPUTE_QUEUE_ENABLED=false` to fall
   back to the legacy `after()` path, then diagnose
4. If Railway is down and the fallback can't help: existing pending
   jobs stay safe in the table. Users see "Queued" in the wizard until
   Railway recovers. No data loss

### Alert: "More than 5 jobs in failed_final (24h)"

Sentry fires this when Query 2 would return 6+ `failed_final` rows.

1. Run Query 2 to see which jobs and why
2. Group by `exchange` and `error_kind`:
   - All one exchange, all `transient` → that exchange is having a bad
     day. Wait for recovery, then retry from `/admin/compute-jobs`
   - Mixed errors, all `permanent` → real problem with the underlying
     strategies (insufficient trades, zero variance). Talk to the
     managers
   - `error_kind = 'unknown'` → classifier gap. File a fix to
     `classify_exception` in `analytics-service/services/jobs.py`

### Stuck in `computing` forever (wizard)

The wizard `SyncPreviewStep` shows "Computing..." and never advances.

1. Open `/admin/compute-jobs`, filter to the user's strategy
2. If rows exist in `running` with `claimed_at > 10 minutes ago` →
   watchdog should reclaim them within 10 minutes. Wait.
3. If rows exist in `failed_retry` with `next_attempt_at` in the
   future → they will auto-retry. Wait.
4. If rows exist in `failed_final` → click Retry in the admin page
5. If no rows exist at all → the enqueue never happened. Check the
   Vercel log for `/api/keys/sync`. Check `COMPUTE_QUEUE_ENABLED` env
   var. Fall back to legacy by flipping the flag and having the user
   resubmit

## Rollback procedure

**Flag off**: one env var flip. New requests fall back to the legacy
`after()` path. Existing `compute_jobs` rows stay intact but aren't
processed by the `after()` path. They sit until the flag flips back.

```bash
vercel env rm COMPUTE_QUEUE_ENABLED production
vercel env add COMPUTE_QUEUE_ENABLED production <<< "false"
vercel --prod redeploy  # or wait for next auto-deploy
```

**Full queue drain** (only if the table itself is causing issues):

```sql
-- Audit first
SELECT status, count(*) FROM compute_jobs GROUP BY status;

-- Drain. No CASCADE: if a future table ever adds a FK pointing at
-- compute_jobs, this TRUNCATE should fail loudly rather than
-- silently truncating the dependent table at 3am.
TRUNCATE compute_jobs;
```

Safe because no referential data depends on queue history today, and
every strategy gets its next compute on the next user action.

**Watchdog too aggressive** (reclaim window is too short for genuine
long jobs):

```sql
-- Temporary override during an incident
SELECT reclaim_stuck_compute_jobs(interval '30 minutes');
```

Or for a permanent bump: edit migration 033's pg_cron schedule to pass
a larger interval. Ship a follow-up migration.

## Retry is idempotent

Clicking Retry twice on the same `failed_final` row does NOT cause
double-compute:

1. The retry endpoint calls `mark_compute_job_failed` with
   `p_error_kind='unknown'`, which resets the row to `failed_retry`
2. The partial unique index on `(strategy_id, kind) WHERE status IN
   ('pending','running','done_pending_children')` prevents a second
   in-flight row from being created
3. The second click either no-ops (if still in `failed_retry`) or
   silently returns the existing row id

So double-click is safe. You can also retry a job that is currently
processing elsewhere — the advisory lock inside the runner prevents
simultaneous processing of the same job id.

## Related files

- Migration: `supabase/migrations/032_compute_jobs_queue.sql`
- pg_cron schedule: `supabase/migrations/033_compute_jobs_cron.sql`
- Worker: `analytics-service/routers/jobs.py`,
  `analytics-service/services/jobs.py`
- Next.js enqueue helper: `src/lib/compute-queue.ts`
- Admin UI: `src/app/(dashboard)/admin/compute-jobs/page.tsx`,
  `src/components/admin/ComputeJobsTable.tsx`
- Wizard integration: `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx`
- Fallback cron: `src/app/api/cron/compute-jobs-fallback/route.ts`
