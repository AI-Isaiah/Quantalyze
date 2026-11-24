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

> ⚠️ This is the **Python per-API-key 429 cooldown**, not the Vercel→Railway seam
> circuit breaker — for that different mechanism see [seam-breaker.md](./seam-breaker.md).

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

> **Since v0.52.0.0 this resolves itself within 16 hours — loudly.** A pg_cron
> job, `reap_strategy_analytics_stuck_computing`, runs every 15 minutes and
> terminalizes stranded rows. If you find a strategy sitting at
> `computation_status = 'failed'` with
> `computation_error = 'Analytics was interrupted before it could finish and did
> not recover. Retry the sync.'`, **no human and no route wrote that — the
> reaper did**, and the user's next action is the Retry button. See "The
> stuck-`computing` reaper" below for what it does and does not touch.

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

### The stuck-`computing` reaper (pg_cron, v0.52.0.0+)

`compute_jobs` has had a watchdog since Sprint 2. `strategy_analytics` did not —
a chain that died mid-flight left `computation_status = 'computing'` forever and
nothing in the system could notice. The reaper closes that.

- **Job:** `reap_strategy_analytics_stuck_computing`, pg_cron, `*/15 * * * *`.
- **Clock:** `strategy_analytics.computing_started_at`. NULL means "not currently
  computing". A `BEFORE UPDATE` trigger owns it at the table, so it measures the
  **whole job chain** (`process_key_long` → `sync_trades` →
  `derive_broker_dailies` → `compute_analytics_from_csv`), not the last hop. Do
  not reason about staleness from `computed_at` — the reaper never reads it.
- **Threshold:** 16 hours, derived (not guessed) from the chain-inclusive
  worst-case ceiling. The canonical copy is
  `STRATEGY_ANALYTICS_REAP_THRESHOLD` in
  `analytics-service/services/job_worker.py`; a CI drift gate fails if the SQL
  literal and that constant disagree. **Change it there first.**
- **Two arms per tick, each bounded to 25 rows:**
  1. `computing` + `computing_started_at IS NULL` → **starts the clock**. A NULL
     stamp is a writer bug, not a stranded job, so this arm never terminalizes;
     the ordinary threshold takes it from there on a later tick.
  2. `computing` + stamped older than 16 hours → **terminalizes** to `failed`
     with `computation_warned = FALSE`, the user-facing message above, and the
     stamp cleared.
- **Both arms require `NOT EXISTS` an active `compute_jobs` row** (`pending`,
  `running`, `done_pending_children`, `failed_retry`). A healthy in-flight chain
  always has one, so a live long job is never reaped. The 16 hours is
  defence-in-depth debounce on top of that check, not the primary safety.
- **The `LIMIT 25` is a blast-radius control, not a performance tweak**, and it
  is enforced by `WITH batch AS MATERIALIZED (…)` on both arms. That keyword is
  load-bearing: with a bare `IN (SELECT … FOR UPDATE)` subquery the planner
  nest-loops the subplan and re-applies the `LIMIT` per outer row, so the cap
  does not exist at runtime (measured: 26 of 26 reaped on a 25-row budget). Do
  not "simplify" it away, and never verify the bound by grepping for the `LIMIT`
  token — every static gate in phases 142 and 142.1 passed over exactly that
  defect.

Is it running, and is it doing anything?

```sql
-- Registered? (expect exactly one row, active, '*/15 * * * *')
SELECT jobid, jobname, schedule, active FROM cron.job
WHERE jobname = 'reap_strategy_analytics_stuck_computing';

-- Last 10 ticks and their outcome
SELECT status, start_time, return_message FROM cron.job_run_details
WHERE jobid = (SELECT jobid FROM cron.job
               WHERE jobname = 'reap_strategy_analytics_stuck_computing')
ORDER BY start_time DESC LIMIT 10;

-- Who is currently in the reaper's sights?
SELECT strategy_id, computing_started_at,
       (now() - computing_started_at) AS computing_for
FROM strategy_analytics
WHERE computation_status = 'computing'
ORDER BY computing_started_at NULLS FIRST;
```

Expected on a healthy system: a handful of rows with recent (minutes-old)
stamps, and **no NULL stamps**. A persistent NULL stamp means a `computing`
writer is not stamping — that is a code bug, and arm 1 is papering over it.
A backlog of rows older than 16 hours that are NOT being reaped means either the
job is unregistered, or those strategies still have an active `compute_jobs` row
(check Query 3 first — the watchdog problem is upstream of the reaper).

To behave-test the deployed body rather than trust it, run
`supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql` — it
`EXECUTE`s the real registered cron body. It is the only gate that does, and it
is what caught the missing bound.

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

## Phase 227 JOBLEDGER: attempt causes, claim renewal, first-hop sweep, readmit ceiling

Phase 227 changed what an operator can read about a failed job and how the watchdog treats a job
that is merely waiting. Five things to know, each with where to look.

### (a) Where a failed attempt's cause is read: `public.compute_job_attempt_failures`

`compute_jobs.last_error` and `error_kind` are cleared when a job is re-claimed (the M-1137 clear),
and the job row itself is pruned at 30 days (done) or 90 days (failed). The cause of a failed
attempt used to vanish with them. Since migration `20261124120000` every attempt that ends badly
writes one append-only row to `public.compute_job_attempt_failures`. There is no foreign key to
`compute_jobs`, so the row outlives the job row and both retention prunes.

Columns: `id`, `job_id`, `kind`, `strategy_id`, `api_key_id`, `portfolio_id`, `allocator_id`,
`exchange`, `job_created_at`,
`attempt` (the attempt number that failed), `claim_token`, `cause_class`, `error_kind`,
`error_text`, `worker_id`, `recorded_at`. Identity is `UNIQUE (job_id, claim_token, cause_class)`,
so a retried write cannot duplicate a row. All four owner columns are copied from the job row and
cascade, mirroring `compute_jobs`' own foreign keys: deleting the strategy, the key, the portfolio
or the allocator (`auth.users`) deletes its records, because `error_text` can name a broker
account. A `derive_allocator_equity` or `rescore_allocator` job carries only `allocator_id`, and a
`compute_portfolio` job only `portfolio_id`, so those two columns are what tie their records to an
owner. `allocator_id` is exported by the GDPR export manifest. Account erasure (`sanitize_user`)
anonymizes strategies, portfolios and `auth.users` in place, so those cascades do not fire on that
path; migration `20261124120700` makes `sanitize_user` delete the subject's records for all four
owner keys.

The four cause classes, and the code path that writes each:

| `cause_class` | What ended the attempt | Written by |
|---|---|---|
| `error` | the attempt raised and the worker reported it | `mark_compute_job_failed` (same transaction as the failure); `record_compute_job_attempt_error` when the worker lost its claim before the mark could land (55P03, or a late mark after the watchdog reset the row or the orphan terminalizer reaped it) |
| `watchdog_reset` | the watchdog found the running row older than its kind's threshold and reset it | `reset_stalled_compute_jobs` |
| `stall_reclaim` | a reclaim took a stuck running row back (it has no scheduled caller on PROD, so this is a manual call) | `reclaim_stuck_compute_jobs` |
| `orphan_reaped` | the hourly orphan terminalizer ended a running row as `failed_final` with `error_kind = 'orphaned'` (a worker died holding the claim) | the trigger `compute_jobs_record_orphan_reaped_attempt` (function `record_orphan_reaped_attempt`) |

Read order for one job is `attempt`, then `recorded_at`, then `id`. Read it in Studio (the
`postgres` role); `service_role` holds SELECT only, and `anon` and `authenticated` hold nothing.
`error_text` can quote a broker account, so read it in the session and never paste it into a
tracked file or a ticket. A read-only example by job id, causes and kinds only:

```sql
SELECT attempt, cause_class, error_kind, worker_id, recorded_at
FROM public.compute_job_attempt_failures
WHERE job_id = '<job uuid>'
ORDER BY attempt, recorded_at, id;
```

And the daily shape, counts only:

```sql
SELECT cause_class, count(*) AS attempts
FROM public.compute_job_attempt_failures
WHERE recorded_at > now() - interval '24 hours'
GROUP BY cause_class
ORDER BY cause_class;
```

There is no retention cron on this table in Phase 227; retention and the sanitize position are
routed to `/gsd-secure-phase`.

### (b) `claimed_at` of a waiting job is now renewed

The worker claims up to five jobs in one call and runs them one after another. Every claimed row
used to keep the `claimed_at` of the claim, so a job waiting in the batch behind slow batch-mates
aged until the watchdog reset it while the worker still held it in its list (the job then ran a
second time and its result was thrown away). Now the worker renews the claims of the jobs still
waiting, through `renew_compute_job_claims` (migration `20261124120200`), in two places: a fence
before each dispatch, and the heartbeat every 120 seconds while a job runs. The running job's own
`claimed_at` is never renewed.

What that changes in Query 3 above: `claimed_at` older than the threshold now means a job that is
**running** for that long, or a worker that stopped renewing (frozen or dead). A waiting job
behind a long batch-mate no longer shows up there. A row the watchdog took has its `claim_token`
cleared in the same statement, so its old worker can no longer renew it.

`src/lib/compute-state.ts` still describes `claimed_at` as stamped once at claim time. That
comment is out of date after this phase and is recorded here rather than edited.

### (c) The first-hop sweep (`public.first_hop_enqueue_sweep()`)

What it catches: a strategy finalized through the wizard whose first `sync_trades` enqueue dropped
(the finalize route enqueues in an `after()` side effect and nothing retried it). A candidate is a
strategy with an active connected key, no job of any status of its own and no in-flight job on its
key (the daily key-scoped derive and holdings-poll jobs the crons leave on every key do not count
once they have finished), no trades, no daily returns, no composite members and no analytics row
beyond `pending`.

- The sweep stamps `first_seen_at` in `public.first_hop_enqueue_retries` the first time it sees a
  candidate, and re-enqueues one `sync_trades` job only once that observation is more than **90
  minutes** old. Because it ticks hourly, a strategy is re-enqueued between 90 and about 150
  minutes after it first matches. A healthy new strategy, which has a job within seconds, never
  matches.
- **Once only.** A strategy is re-enqueued at most once, ever. A bad key is tried against an
  exchange once, not every hour.
- **The named state.** Only if that retry also ends without a result (every job of the strategy
  `failed_final`, analytics row absent or still `pending`) does the strategy read
  `computation_status = 'failed'` with the fixed sentence "Analytics has not started for this
  strategy: its first sync was never queued, and the automatic retry did not complete. Retry the
  sync, or contact support if this persists." A row already `failed` is never overwritten.
- **It fires only after registration.** The migration registers nothing. The hourly job is
  registered by `docs/runbooks/jobledger-go-live.md` Step 1, after merge. Until then a dropped
  first enqueue strands exactly as before.

### (d) The readmit-ceiling page

The reconcile sweep readmits a strategy that lost its worker and stops at three orphan markers,
after which the strategy silently drops out of the sweep. Now `record_reconcile_readmit_exhaustions()`
(migration `20261124120300`) writes one durable row per exhaustion to
`public.reconcile_readmit_exhaustions` (`strategy_id`, `generation_key`, `marker_count`,
`detected_at`, `paged_at`), and the worker's watchdog loop pages from it through `ops_alert` with
source `reconcile_readmit_ceiling` and cause `readmit_ceiling:<strategy uuid>`. It runs at most
once every five minutes and pages at most 25 rows a pass.

`paged_at` is stamped only after a delivered page, so an undelivered page leaves the row unpaged
and the next pass pages it again (at least once beats at most once for a stranded strategy). To
read the rows that have not been paged, counts and ids only:

```sql
SELECT strategy_id, marker_count, detected_at
FROM public.reconcile_readmit_exhaustions
WHERE paged_at IS NULL
ORDER BY detected_at;
```

A row that stays unpaged for more than a few minutes means the worker's reader is not running, or
no `ops_alert` channel is delivering; check the worker first, because the worker is also what runs
any readmit. A page does not clear itself: read the strategy's causes through (a), fix the cause,
and re-enqueue by hand.

### (e) The watchdog reset now bridges the strategy's analytics status

`reset_stalled_compute_jobs` used to flip a `running` row back to `pending` without telling the
analytics status bridge, so a strategy whose curated status sentence had been written was left
with no provenance, and the next bridge run replaced it with the generic one. Since migration
`20261124120100` the reset calls the bridge once per distinct (strategy, kind) it reset, and
`reclaim_stuck_compute_jobs` follows the same path. The reset also records its own
`watchdog_reset` row (see (a)).

## Related files

- Queue + watchdog migrations:
  `supabase/migrations/20260411144407_compute_jobs_queue.sql` (queue, RPCs,
  `reclaim_stuck_compute_jobs`) and
  `20260412094449_compute_jobs_admin_and_defer.sql`
- Stuck-`computing` reaper (three forward-only migrations, applied in order —
  each re-registers the same `cron.schedule` jobname, so only the last body
  runs): `20260802120000_strategy_analytics_stuck_computing_reaper.sql`
  (column, job, terminalize arm), `20260803120000_..._stamp_trigger_null_stamp_clock_start.sql`
  (the `BEFORE UPDATE` stamp trigger + the NULL-stamp clock-start arm), and
  `20260803130000_reaper_limit_bound_materialized_cte.sql` (restores the
  `LIMIT 25` bound). Threshold constant + job-chain topology:
  `analytics-service/services/job_worker.py`
  (`STRATEGY_ANALYTICS_REAP_THRESHOLD`, `JOB_CHAIN_FOLLOW_ON`). Behavioural
  gate: `supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql`
  (CI job `sql-tests`).
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
