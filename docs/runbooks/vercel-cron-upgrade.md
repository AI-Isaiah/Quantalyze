# Vercel Cron Upgrade — Path Back to a Single Scheduler

## Why this runbook exists

Quantalyze is currently on the Vercel Hobby plan. Hobby caps cron jobs at
**2 per project** and historically has required **daily-only schedules**.
When the project breaches either limit, Vercel rejects the deployment
config up front — `vercel.link/...` redirects to
`/docs/cron-jobs/usage-and-pricing`, the "Vercel" check on the PR goes
red, and no deployment is ever created. Production silently goes dark.

This happened twice already:

- **2026-04-10** (commit `7d0175c`) — `warm-analytics` was running every
  5 minutes. Fixed by downgrading to daily.
- **2026-04-16 → 2026-04-17** (PR 57, 58, 61) — Sprint 5 added
  `sync-funding` at `0 */4 * * *` and two new daily crons
  (`reconcile-strategies`, `cleanup-ack-tokens`). Total went 2 → 5.
  Production was dark from Sprint 4 until this runbook was written.

To unblock without paying, the 3 extra crons were relocated to the
Python worker (`analytics-service/main_worker.py`) via
`services/scheduled_tasks.py`. This runbook is the reverse playbook for
when the project upgrades to Vercel Pro.

## Current state (Hobby, 2 crons)

`vercel.json` holds only the crons that need Next.js to run:

| Cron                         | Schedule      | Purpose                                    |
|------------------------------|---------------|--------------------------------------------|
| `/api/cron/warm-analytics`   | `0 0 * * *`   | Ping the analytics service `/health` so the demo never cold-starts. |
| `/api/alert-digest`          | `0 9 * * *`   | Render + send daily allocator alert emails. |

`analytics-service/main_worker.py` runs three additional daily loops via
`_scheduled_daily_loop(...)`:

| Loop                    | Tick function                          | What it does                                                        |
|-------------------------|----------------------------------------|---------------------------------------------------------------------|
| `sync_funding`          | `enqueue_sync_funding_tick()`          | Enqueue `sync_funding` compute_job for every strategy with an active key on binance/okx/bybit. |
| `reconcile_strategies`  | `enqueue_reconcile_strategies_tick()`  | Enqueue `reconcile_strategy` compute_job for every strategy synced within the last 24h. |
| `cleanup_ack_tokens`    | `cleanup_ack_tokens_tick()`            | Delete `used_ack_tokens` rows older than 30 days.                    |

The original Next.js routes at `src/app/api/cron/{sync-funding,
reconcile-strategies, cleanup-ack-tokens}` **are still in place** so ops
can curl them for manual incident response with
`Authorization: Bearer $CRON_SECRET`. They are just no longer triggered
on a schedule.

## What changes on Pro

Vercel Pro lifts the cron cap to 40 jobs per project and allows
arbitrary schedules (down to `* * * * *`). Once billing flips:

1. **Add all 5 crons back to `vercel.json`.**

   ```json
   {
     "$schema": "https://openapi.vercel.sh/vercel.json",
     "framework": "nextjs",
     "buildCommand": "npm run build",
     "installCommand": "npm ci",
     "crons": [
       { "path": "/api/cron/warm-analytics",        "schedule": "0 0 * * *"   },
       { "path": "/api/alert-digest",               "schedule": "0 9 * * *"   },
       { "path": "/api/cron/sync-funding",          "schedule": "0 */4 * * *" },
       { "path": "/api/cron/reconcile-strategies",  "schedule": "30 3 * * *"  },
       { "path": "/api/cron/cleanup-ack-tokens",    "schedule": "0 3 * * 0"   }
     ]
   }
   ```

   Note: feel free to restore `sync-funding` to 4-hourly cadence — the
   1x/day cadence in the worker was a Hobby compromise, not a design
   choice. Check `analytics-service/services/funding_fetch.py` for the
   exchange rate-limit math before going below daily.

2. **Drop the three worker loops from `main()` in
   `analytics-service/main_worker.py`.** Remove these lines from the
   `asyncio.gather(...)` call:

   ```python
   _scheduled_daily_loop("sync_funding", enqueue_sync_funding_tick),
   _scheduled_daily_loop("reconcile_strategies", enqueue_reconcile_strategies_tick),
   _scheduled_daily_loop("cleanup_ack_tokens", cleanup_ack_tokens_tick),
   ```

   Also remove the imports at the top of the file and the
   `_scheduled_daily_loop` helper (the existing `daily_enqueue_loop`
   remains — it was never Vercel-related).

3. **Delete `analytics-service/services/scheduled_tasks.py` and
   `analytics-service/tests/test_scheduled_tasks.py`.** The Next.js
   routes are the canonical implementation.

4. **Relax or delete `src/__tests__/vercel-cron-limits.test.ts`.**
   Either flip `MAX_CRONS_ON_HOBBY` to the new ceiling (e.g. 40) and
   loosen the schedule regex, or delete the file outright.

5. **Redeploy.** First production deploy on Pro should include all 5
   crons; verify in the Vercel dashboard cron tab that each ran at the
   expected time within the first day.

## Decision criteria for staying split

If the project outgrows Hobby but stays partially off Vercel (e.g. cost
sensitivity, preference for colocated compute), keep the split:

- **Stays on Vercel:** crons that need the Next.js runtime (rendering
  email templates with React Email, hitting authenticated routes, using
  `createAdminClient` with Next.js env vars).
- **Moves to the worker:** crons that only enqueue compute_jobs or do
  plain SQL cleanup. These don't need Next.js and run better alongside
  the worker that processes the jobs they enqueue.

## Verifying the guardrail

`src/__tests__/vercel-cron-limits.test.ts` fails the build if anyone
exceeds 2 crons or adds a sub-daily schedule while still on Hobby.
Don't bypass it — update it deliberately when upgrading to Pro.
