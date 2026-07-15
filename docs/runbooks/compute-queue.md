# Compute Queue Runbook

Operational guide for the `compute_jobs` durable queue introduced in
Sprint 2 Task 2.9. Use this page when you get a Sentry alert, when the
wizard is stuck, or when you need to understand queue health during a
deploy.

This is a setup recipe and incident-response reference, not a spec. For the
architecture see the ADRs
[`adr-0006-analytics-service-boundary`](../architecture/adr-0006-analytics-service-boundary.md)
and [`adr-0008-cron-architecture`](../architecture/adr-0008-cron-architecture.md),
plus the queue migration
`supabase/migrations/20260411144407_compute_jobs_queue.sql`.

> **Status: the `compute_jobs` queue is the ONLY production path.** It has been
> live in prod for months — the Python worker, the `enqueue_compute_job`
> RPC, the 10-minute watchdog reclaim, and the B5a/B5b claim-token fencing
> all shipped. `analytics-service/routers/process_key.py` is the dispatch.
> **As of Phase 106 (v0.42.x) the unified backbone is mandatory and the
> legacy in-process `after()` fallback is deleted.** The
> `USE_COMPUTE_JOBS_QUEUE` and `PROCESS_KEY_UNIFIED_BACKBONE` flags are
> **retired** — they are read nowhere; leaving them set (or flipping them)
> does nothing. There is no runtime rollback switch anymore: **rollback is
> `git revert` + redeploy** (see "Rollback procedure").

## What the queue is

A Postgres-backed compute queue that runs async jobs durably. The core
strategy-analytics kinds:

- `sync_trades` — fetch an exchange API key's trade history into
  `trades` (one job per exchange key)
- `compute_analytics_from_csv` — run metrics over a strategy's daily
  returns via the unified backbone (chained after sync_trades via fan-in).
  (The old trades-based `compute_analytics` kind was retired in Phase 106 —
  the `enqueue_compute_job` RPC now rejects it with `invalid_parameter_value`;
  the 45 historical rows are preserved for audit, so the kind CHECK still
  admits them.)
- `compute_portfolio` — run portfolio-level metrics when any member
  strategy's analytics complete

Plus cron/worker-seeded maintenance kinds (`sync_funding`,
`reconcile_strategy`, `poll_positions`, `derive_broker_dailies`, …).

Jobs survive Vercel function crashes, Railway cold starts, and
double-submit races. Retries happen automatically with exponential
backoff (`+30s`, `+2min`, then `failed_final`). The Railway worker's
60s watchdog loop (`reset_stalled_compute_jobs`) reclaims stuck jobs.

Jobs are idempotent: only one in-flight row per `(target, kind)` exists
at any moment, enforced by partial unique indexes.

## Prerequisites

- `pg_cron` extension enabled in Supabase (production and staging)
- `pg_net` extension enabled in Supabase
- `app.analytics_service_url` GUC set to the Railway worker URL
- `app.analytics_service_key` GUC set to the Railway service key
- The Railway worker (`python -m main_worker`) running — it self-polls and
  drains the queue (30s dispatch loop + 60s watchdog). There is no external
  tick cron or HMAC secret anymore.
- (`USE_COMPUTE_JOBS_QUEUE` is **retired** as of Phase 106 — `/api/keys/sync`
  and `/api/strategies/finalize-wizard` now enqueue into `compute_jobs`
  unconditionally; there is no in-process `after()` fallback to select.)

Verify each prerequisite by running the three observability queries below
against the staging DB.

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

Expected output: **empty**. The worker's 60s watchdog loop
(`reset_stalled_compute_jobs`) resets running-but-stuck jobs back to
`pending`. If this query returns rows, either the watchdog loop is broken
(worker down/crash-looping) or the worker is genuinely still processing a
very long job.

Manual override: call `SELECT reclaim_stuck_compute_jobs(interval '5
minutes');` to force a reclaim with a tighter window.

## Running the circuit breaker

When an exchange returns 429 the Python runner calls
`update_api_key_rate_limit(api_key_id)` which stamps
`api_keys.last_429_at = now()`. The per-exchange cooldown windows are the
`EXCHANGE_COOLDOWNS` dict in `analytics-service/services/job_worker.py`,
enforced by `_check_circuit_breaker`:

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

### Alert: jobs not draining / worker dispatch stalled

The queue is drained by the Railway worker (`analytics-service/main_worker.py`,
CMD `python -m main_worker`): a **30s dispatch loop**
(`claim_compute_jobs_with_priority`) and a **60s watchdog loop**
(`reset_stalled_compute_jobs`). The worker self-polls — there is no external
`/api/jobs/tick` endpoint or Vercel fallback cron anymore.

1. Check Railway: is the worker service up and not crash-looping? Its logs
   should show the dispatch/watchdog loops ticking.
2. Run Query 1. A climbing `pending` count with ~0 `running` means the
   dispatch loop is not claiming — the worker is down or stuck. Restart the
   Railway service.
3. If the worker is healthy but jobs still fail, it is downstream (DB
   connectivity, exchange API). Diagnose via Query 2.
4. If the worker is down: existing pending jobs stay safe in the table — no
   data loss. Users see "Queued" until the worker recovers and drains them.
   (There is no flag-flip fallback anymore — the queue is the only path.
   Restart the Railway worker; do not attempt a runtime rollback.)

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
     `classify_exception` in `analytics-service/services/job_worker.py`

### Stuck in `computing` forever (wizard)

The wizard `SyncPreviewStep` shows "Computing..." and never advances.

1. Open `/admin/compute-jobs`, filter to the user's strategy
2. If rows exist in `running` with `claimed_at > 10 minutes ago` →
   watchdog should reclaim them within 10 minutes. Wait.
3. If rows exist in `failed_retry` with `next_attempt_at` in the
   future → they will auto-retry. Wait.
4. If rows exist in `failed_final` → click Retry in the admin page
5. If no rows exist at all → the enqueue never happened. For a wizard
   submission, check the Vercel log for
   `/api/strategies/finalize-wizard` (the `after()` block dispatches
   `enqueue_compute_job` for `sync_trades`; failures Sentry-escalate
   via `captureToSentry` with tag `route=finalize-wizard`,
   `step=sync_trades_enqueue`). For a manual "Sync now" click, check
   `/api/keys/sync`. If the enqueue RPC itself is failing, that is the
   incident — there is no legacy fallback to flip to; fix forward or
   `git revert` the offending deploy.

## Rollback procedure

**There is no runtime rollback flag anymore.** Phase 106 deleted the legacy
in-process `after()` path and the `USE_COMPUTE_JOBS_QUEUE` /
`PROCESS_KEY_UNIFIED_BACKBONE` switches — the durable queue is the only
compute path. Rollback is code revert + redeploy.

**Revert the CODE but KEEP the applied migrations.** A migration that already
ran on prod is recorded in `schema_migrations`; deleting its file makes
`supabase db push` fail with "remote migration versions not found in local",
which reddens the `supabase-migrate` job on main — and Railway silently skips
deploying red main, so the worker half of your rollback never lands, in the
exact emergency you needed it. So exclude the migration + its regenerated
function snapshot from the revert:

```bash
git revert -n <merge-commit-sha>                       # stage the revert, don't commit yet
git checkout HEAD -- supabase/migrations/ supabase/schema/functions/   # KEEP applied migrations + snapshot
npm run schema:functions                               # re-sync snapshot to the kept migration state
git add supabase/schema/functions/
git commit -m "revert: <what/why> (migrations retained — see compute-queue runbook)"
git push origin main                                   # Vercel + Railway auto-deploy the revert
```

The 106-06 RPC guard staying applied is harmless: ratified prod never enqueues
the retired `compute_analytics` kind, so the guard is dead weight, not a
regression. Existing `compute_jobs` rows are unaffected; the worker keeps
draining them. If the incident is worker/queue health (not a code deploy),
use the worker restart + observability queries above, not a rollback.

**Full queue drain** (only if the table itself is causing issues):

```sql
-- Audit first
SELECT status, count(*) FROM compute_jobs GROUP BY status;

-- Drain. No CASCADE: if a future table ever adds a FK pointing at
-- compute_jobs, this TRUNCATE should fail loudly rather than
-- silently truncating the dependent table at 3am.
TRUNCATE compute_jobs;
```

No referential data depends on queue history today. But the queue now
carries cron/worker-seeded maintenance jobs (e.g. `sync_funding`,
`reconcile_strategy`, `poll_positions`, broker dailies), not just
user-triggered computes — a `TRUNCATE` drops any in-flight backfill, which
is NOT restored by a user action; it waits for that job's next scheduled
tick (daily/cron). Drain only when the table itself is the problem, and
expect maintenance jobs to re-seed on their own schedule, not instantly.

**Watchdog too aggressive** (reclaim window is too short for genuine
long jobs):

```sql
-- Temporary override during an incident
SELECT reclaim_stuck_compute_jobs(interval '30 minutes');
```

Or for a permanent change: adjust the watchdog loop's stall threshold /
interval in `analytics-service/main_worker.py` and redeploy the worker.

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

- Queue + watchdog migrations:
  `supabase/migrations/20260411144407_compute_jobs_queue.sql` (queue, RPCs,
  `reclaim_stuck_compute_jobs`) and
  `20260412094449_compute_jobs_admin_and_defer.sql`
- Primary dispatch (Phase-19 unified backbone):
  `analytics-service/routers/process_key.py`
- Worker tick + circuit breaker: `analytics-service/routers/cron.py`,
  `analytics-service/services/job_worker.py`
- Next.js enqueue call sites (call the `enqueue_compute_job` RPC directly —
  there is no longer a central `src/lib` helper):
  - `src/app/api/strategies/finalize-wizard/route.ts` (`after()` block,
    H-0330 — fallback path for new strategies)
  - `src/app/api/keys/sync/route.ts` (manual "Sync now" button)
- Admin UI: `src/app/(dashboard)/admin/compute-jobs/page.tsx`,
  `src/components/admin/ComputeJobsTable.tsx`
- Wizard integration: `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx`
- Worker entrypoint: `analytics-service/main_worker.py` (the 3 asyncio loops)
