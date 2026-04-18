# Bridge Outcome Cron Runbook

Operational guide for the `compute_bridge_outcome_deltas` daily cron job. See the
implementation plan at `.planning/phases/01-outcome-tracker/01-04-PLAN.md` and the
migration at `supabase/migrations/060_bridge_outcome_cron.sql`.

## Overview

- **What it does:** reads `bridge_outcomes` rows with `kind='allocated'` that are either
  un-computed (`delta_30d IS NULL`) or explicitly marked for recompute (`needs_recompute=TRUE`),
  joins against `strategy_analytics.returns_series`, and writes realized 30/90/180-day
  deltas plus an in-window estimate (when the allocation is less than 30 days old).
- **Who sees results:** allocators — delta values drive the D-12 label progression
  (`Pending` → `Estimated: +X.X% (Nd)` → `30-day: +X.X%` → `90-day` → `180-day`).
- **Phase 1 artifact:** migration `060_bridge_outcome_cron.sql`.

## Schedule

| Property | Value |
|----------|-------|
| Job name | `compute_bridge_outcome_deltas` |
| Scheduler | pg_cron (registered in migration 060) |
| Schedule | `0 3 * * *` — daily at 03:00 UTC |
| Runtime | seconds (JSONB-indexed; batch sizes are small until Phase 4 materializes historical allocations) |

**pg_cron only** — we do NOT use Vercel Cron for this job. Vercel Hobby has a 2-cron cap
(`warm-analytics` + `alert-digest`); the sentinel
`src/__tests__/vercel-cron-limits.test.ts` fails CI on any third entry.
See `docs/runbooks/vercel-cron-upgrade.md` for the path to Vercel Pro if cron
capacity becomes a constraint.

## What it computes

For each `bridge_outcomes` row where `kind='allocated'` AND `allocated_at IS NOT NULL`:

```
delta_30d  = equity_at(allocated_at + 30d)  / equity_at(allocated_at) - 1
delta_90d  = equity_at(allocated_at + 90d)  / equity_at(allocated_at) - 1
delta_180d = equity_at(allocated_at + 180d) / equity_at(allocated_at) - 1
```

- `equity_at(date)` indexes `strategy_analytics.returns_series` JSONB by date text key.
- `returns_series` is a **cumulative equity curve** (`[{date, value}, ...]`), NOT
  period-over-period returns. Using `SUM(daily_return)` is incorrect and will silently
  produce wrong numbers (Phase 1 Research Pitfall #1).
- When the realized windows are not yet available (< 30 days of data since anchor), the
  function writes `estimated_delta_bps` + `estimated_days` for the D-12 Estimated label.
  The estimate fires when `days_elapsed ∈ [1, 29]`.

## Signals

### pg_cron job-run history (primary observability)

The cron function does NOT call `log_audit_event` — pg_cron runs under a session where
`auth.uid()` is NULL, which `log_audit_event` (migration 049) rejects with
`insufficient_privilege`. Instead, use pg_cron's native run-history table:

```sql
SELECT jobid, runid, job_pid, status, return_message, start_time, end_time
FROM cron.job_run_details
WHERE jobname = 'compute_bridge_outcome_deltas'
ORDER BY start_time DESC
LIMIT 14;
```

| Column | What to look for |
|--------|-----------------|
| `status` | `'succeeded'` — batch ran cleanly; `'failed'` — investigate `return_message` |
| `end_time - start_time` | batch duration; alert if > 60 seconds |
| `return_message` | SQL error text on failure |

Per-row correctness is verifiable via `bridge_outcomes.deltas_computed_at` — this
timestamp uniquely identifies which cron run produced which delta values. OUTCOME-08
mutation-auditing is fully covered by the per-row `logAuditEvent` in the POST route
(Plan 01-02) — the cron only writes derived delta columns, not new outcome records.

### Schedule presence

```sql
SELECT jobname, schedule, last_run_time
FROM cron.job
WHERE jobname = 'compute_bridge_outcome_deltas';
```

### Rows awaiting compute

```sql
SELECT COUNT(*)
FROM bridge_outcomes
WHERE kind = 'allocated'
  AND (delta_30d IS NULL OR needs_recompute = TRUE);
```

A non-zero count after the cron's scheduled time is a signal the batch has issues.

### Manual dry-run (safe — no side effects if no eligible rows)

```sql
SELECT * FROM public.compute_bridge_outcome_deltas();
-- Returns: updated_count INT, failed_count INT, batch_started_at TIMESTAMPTZ
```

## Deploy checklist

1. Apply migration: `npx supabase db push`
2. Confirm success NOTICEs in the output:
   ```
   NOTICE (00000): Scheduled compute_bridge_outcome_deltas at 03:00 UTC
   NOTICE (00000): Migration 060 self-verify: 4 functions, 1 cron entries
   ```
3. Confirm 4 functions on the live DB:
   ```sql
   SELECT proname FROM pg_proc p
   JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN (
       'extract_equity_at','extract_delta',
       'extract_estimated','compute_bridge_outcome_deltas'
     );
   -- Expect 4 rows
   ```
4. Confirm cron registered:
   ```sql
   SELECT jobname, schedule FROM cron.job
   WHERE jobname = 'compute_bridge_outcome_deltas';
   -- Expect 1 row: jobname=compute_bridge_outcome_deltas, schedule=0 3 * * *
   ```
5. Manual dry-run:
   ```sql
   SELECT * FROM public.compute_bridge_outcome_deltas();
   -- Expect updated_count >= 0, failed_count = 0
   ```
6. Verify Hobby cron sentinel still green:
   ```bash
   npm test -- src/__tests__/vercel-cron-limits
   ```

## Common issues

### pg_cron extension missing (local dev)

The migration DO block emits:
```
pg_cron extension not present — skipping schedule (local dev)
```
This is expected in local Supabase CLI setups without pg_cron. The migration applies
cleanly; delta functions exist and are callable, but no schedule is registered.

To compute deltas locally, invoke the function manually:
```sql
SELECT * FROM public.compute_bridge_outcome_deltas();
```

To enable pg_cron locally: Supabase local dev docs →
`supabase/config.toml` → enable the `pg_cron` extension.

### needs_recompute never clears

If rows keep ending up with `needs_recompute=TRUE` after the cron runs:

1. Check `cron.job_run_details` for the run — did it succeed?
2. The trigger in migration 059 flips `needs_recompute=TRUE` on every UPDATE to
   `allocated_at`, `percent_allocated`, or `kind`. Check whether an upstream upsert
   is firing in the same minute as the cron (race condition).
3. Confirm the trigger definition:
   ```sql
   \d+ bridge_outcomes
   ```
   The trigger should be `BEFORE UPDATE` and flip `needs_recompute=TRUE` only when
   the pivot columns change.

### returns_series shape drift

`extract_equity_at` expects entries of the form `{date:"YYYY-MM-DD", value:NUMERIC}`.
If `analytics-service` rewrites the shape (e.g. `{date, cumulative_equity}` or a
`{"series":[...]}` wrapper), the helpers will silently return NULL for every date and
all deltas will remain NULL.

To diagnose:

```sql
SELECT jsonb_typeof(returns_series), returns_series->0
FROM strategy_analytics
WHERE returns_series IS NOT NULL
LIMIT 1;
-- Expected: type='array', first element: {"date":"2026-01-01","value":1.0}
```

If the shape has drifted, update `extract_equity_at` in a follow-up migration to match
the new structure.

### Rejected rows receiving delta values

Should never happen — the `WHERE bo.kind = 'allocated'` guard appears in both the
`candidates` CTE and the UPDATE `WHERE` clause. If a rejected row has non-NULL delta
fields, diagnose:

```sql
SELECT id, kind, delta_30d, delta_90d, delta_180d
FROM bridge_outcomes
WHERE kind = 'rejected'
  AND (delta_30d IS NOT NULL OR delta_90d IS NOT NULL OR delta_180d IS NOT NULL);
```

Repair:

```sql
UPDATE bridge_outcomes
SET delta_30d           = NULL,
    delta_90d           = NULL,
    delta_180d          = NULL,
    estimated_delta_bps = NULL,
    estimated_days      = NULL,
    deltas_computed_at  = NULL
WHERE kind = 'rejected';
```

### Cron failure → allocators see Pending

Per D-14, any row where the cron did not produce deltas stays `Pending` in the UI.
No user-facing error is surfaced. Structured errors go to `cron.job_run_details`.
`needs_recompute` stays `TRUE` so next-day retry picks up the row automatically.

To force an immediate retry (no wait for 03:00 UTC):

```sql
SELECT * FROM public.compute_bridge_outcome_deltas();
```
