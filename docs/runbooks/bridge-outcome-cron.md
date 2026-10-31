# Bridge Outcome Cron Runbook

> **STATUS: Current (2026-06-04).** The repo runs on **Vercel Pro** with a
> 10-cron ceiling enforced by `src/__tests__/vercel-cron-limits.test.ts`; the
> sister runbook `docs/runbooks/vercel-cron-upgrade.md` is archived as stale.
> The pg_cron design choice for this job is deliberate — it is DB-side
> state-machine work, not a Next.js fetch. (audit-2026-05-07 M-1005: the prior
> body framing this job's pg_cron choice as a Vercel-Hobby 2-cron workaround
> was stale and has been corrected below.)

Operational guide for the `compute_bridge_outcome_deltas` daily cron job. See the
implementation plan at `.planning/phases/01-outcome-tracker/01-04-PLAN.md` and the
migration at `supabase/migrations/20260418074935_bridge_outcome_cron.sql`.

## Overview

- **What it does:** reads `bridge_outcomes` rows with `kind='allocated'` that are either
  un-computed (`delta_30d IS NULL`) or explicitly marked for recompute (`needs_recompute=TRUE`),
  measures each one on the right series for its source (see "What it computes": a strategy's
  `strategy_analytics.returns_series`, or, for a holding decision, the allocator's derived account
  returns), and writes realized 30/90/180-day deltas plus, for the strategy branches, an in-window
  estimate (when the allocation is less than 30 days old).
- **Who sees results:** allocators — delta values drive the D-12 label progression
  (`Pending` → `Estimated: +X.X% (Nd)` → `30-day: +X.X%` → `90-day` → `180-day`).
- **Phase 1 artifact:** migration `20260418074935_bridge_outcome_cron.sql`.

## Schedule

| Property | Value |
|----------|-------|
| Job name | `compute_bridge_outcome_deltas` |
| Scheduler | pg_cron (registered in migration 060) |
| Schedule | `0 3 * * *` — daily at 03:00 UTC |
| Runtime | seconds (JSONB-indexed; batch sizes are small until Phase 4 materializes historical allocations) |

**pg_cron only** — we do NOT use Vercel Cron for this job, by design rather than
by quota: this is DB-side state-machine work (reading `bridge_outcomes` and
writing deltas), not a Next.js fetch, so pg_cron is the natural home. The repo
runs on **Vercel Pro**; the cron-quota guardrail at
`src/__tests__/vercel-cron-limits.test.ts` enforces the 10-cron ceiling for the
*Vercel* crons, but bridge-outcome deltas live in pg_cron regardless of that
headroom.

## What it computes

For each `bridge_outcomes` row where `kind='allocated'` AND `allocated_at IS NOT NULL`, the batch
runs three branches. Which one a row takes depends on its `match_decisions` row.

### Strategy branch (`match_decision_id` NULL, or a decision with `original_strategy_id` set)

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

### Voluntary-add branch (`match_decisions.kind = 'voluntary_add'`)

Measured on the strategy's `returns_series` exactly as the strategy branch is (migration 080).

### Holding branch (decision with `original_holding_ref` set and `original_strategy_id` NULL)

The holding branch measures the **account**, not the symbol the decision named
(Phase 176 LEGACYRETIRE, decisions D-03 and D-05). For N = 30, 90 and 180:

```
delta_Nd = prod(1 + r_d) - 1     over the days d in (allocated_at, allocated_at + N]
```

where `r_d` is the flow-neutral daily return of the allocator's `allocator_equity_derived` row of
kind `equity_curve` (`payload.returns[]`, the same returns the factsheet KPIs read). The work is
done by `public.derived_account_return_over(allocator_id, allocated_at, N)`; the batch calls it
once per window.

A day with no entry in `returns` counts as no change, so the product runs over the returns that are
present. The derived curve leaves a day out under benign flags (for example
`missing_return_inside_coverage`), and a rule that needed every calendar day would leave nearly every
outcome Pending. A day whose return is -100% or worse compounds to -100%, not to NULL.

- **Per account.** Two holding decisions by the same allocator on the same day read the same
  number whatever symbol they named. Deposits and withdrawals do not count as performance.
- **NULL, never a guess.** The helper returns NULL when the derived row is missing, is not payload
  version 2, is not `is_trustworthy`, does not cover the window (its first `returns` date is after the
  first day of the window, or its last `returns` date is before the last day of it; only dates of the
  form `YYYY-MM-DD` count toward that), has no `returns` entry at all inside the window, repeats a day,
  or carries an `r` that is not a number. One return inside the window is enough to measure it. The
  delta then stays NULL and the UI reads Pending.
- **Later windows fill in later runs.** A holding row stays a candidate until every window that has
  matured is filled: it is also picked while `delta_90d` is NULL and `allocated_at` is 91 or more days
  back, or `delta_180d` is NULL and `allocated_at` is 181 or more days back. Values already written are
  kept: such a row is written (and counted in `updated_count`) only when a NULL window actually
  filled, and a later restatement of the curve does not change a stored outcome. Only a row with
  `needs_recompute = TRUE` (the D-06 reset, or someone setting it on purpose) is re-measured, with
  the new value winning.
- **A row that measured nothing.** If all three new deltas are NULL the row is not written (it stays
  `needs_recompute = TRUE`) and the run counts it in `failed_count`, not in `updated_count`.
- **No estimate.** The holding branch writes no `estimated_delta_bps` / `estimated_days`.
- **Window of candidates.** `bridge_outcomes_allocated_at_check` admits an `allocated_at` only inside
  `[CURRENT_DATE - 365 days, CURRENT_DATE]` and PostgreSQL re-checks it on every UPDATE, so a holding
  row older than 365 days is not a candidate (touching it would abort the whole batch for every
  allocator). The strategy and voluntary_add branches take the same window (fixed in the same
  migration, `176-BRIDGE-CHECK-WINDOW-ABORT` in `TODOS.md`); a row older than 365 days keeps whatever basis
  it already had.
- **Legacy table not read.** Nothing in the batch reads `allocator_equity_snapshots` or
  `extract_symbol_value_at` any more; PR 3 of the phase drops them.

### One-time reset of stored holding outcomes (D-06)

The migration `20261102120000_bridge_outcome_holding_branch_derived.sql` called
`public.reset_holding_bridge_outcomes_to_derived_basis()` once, at the apply. It set
`needs_recompute = TRUE` and NULLed `delta_30d`, `delta_90d`, `delta_180d` and `deltas_computed_at`
on every holding-measuring outcome whose `allocated_at` is inside the last 365 days, so no stored
number stays on the old per-symbol basis. The old per-symbol values were not kept.

- **What the allocator sees.** Those outcomes read **Pending** until the next 03:00Z run recomputes
  them. A row whose window the derived curve does not cover stays NULL, which is correct. The apply log
  carries the number of rows the reset cleared as a NOTICE (a count only).
- **Who can call the reset.** It is owner only: `EXECUTE` is revoked from PUBLIC, `anon`,
  `authenticated` and `service_role`, so it cannot be reached through PostgREST.
- **When it may be re-run.** Only when the holding rule itself changes basis again and every stored
  holding outcome must be recomputed. A re-run discards the computed holding numbers (the same NULLing
  as above) until the next 03:00Z run, so it is not a repair for a single bad row; for one row, set
  `needs_recompute = TRUE` on it instead.
- **Rollback.** `supabase/migrations/down/20261102120000-rollback.sql`, manual and off the auto-apply
  path.

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

A non-zero count after the cron's scheduled time is a signal the batch has issues. For the holding
branch a persistent non-zero share is expected where the derived curve does not cover a window (those
rows stay NULL by design); the read-only form `r3-bridge-holding` in
`docs/runbooks/legacyretire-go-live.md` splits the holding rows by what was computed, what still
awaits recompute and which rows sit outside the `allocated_at` CHECK window.

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
   -- Expect updated_count >= 0. failed_count counts holding rows that measured nothing this run
   -- (all three deltas NULL: no trustworthy derived curve covers the window); it is 0 when none exist.
   ```
6. Verify the Vercel cron-limit sentinel still green:
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
