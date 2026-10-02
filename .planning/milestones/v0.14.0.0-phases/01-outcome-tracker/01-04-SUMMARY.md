---
phase: 01-outcome-tracker
plan: 04
subsystem: database/cron
tags: [postgres, pg_cron, supabase, migrations, delta-math, integration-test, runbook]

requires:
  - 01-01 (bridge_outcomes table + needs_recompute column + trigger)
provides:
  - compute_bridge_outcome_deltas() SECURITY DEFINER function live on production Supabase
  - extract_equity_at / extract_delta / extract_estimated helper functions
  - pg_cron job registered at 0 3 * * * on production Supabase
  - Live-DB integration test proving delta math correctness + idempotency + D-19 guard
  - Operational runbook docs/runbooks/bridge-outcome-cron.md
affects:
  - 01-03 (banner UI reads delta columns populated by this cron — Pending → labeled)
  - 01-05 (outcomes dashboard will surface delta values computed here)

tech-stack:
  added: []
  patterns:
    - "SECURITY DEFINER SQL function with SET search_path = public, pg_catalog (T-01-04-01 mitigation)"
    - "pg_cron extension-gated scheduling: IF EXISTS (pg_extension extname='pg_cron') ... ELSE RAISE NOTICE (local dev)"
    - "Cumulative equity math: extract_equity_at(series, anchor+N) / extract_equity_at(series, anchor) - 1 (NOT SUM daily returns)"
    - "Idempotent cron guard: WHERE kind='allocated' AND (delta_30d IS NULL OR needs_recompute=TRUE)"
    - "Observability via cron.job_run_details (not log_audit_event — pg_cron has NULL auth.uid())"
    - "Live-DB integration test with ignoreDuplicates for partial-index tables (match_decisions)"

key-files:
  created:
    - supabase/migrations/060_bridge_outcome_cron.sql
    - src/__tests__/bridge-outcome-cron.test.ts
    - docs/runbooks/bridge-outcome-cron.md
  modified: []

key-decisions:
  - "No log_audit_event from inside the cron function — pg_cron sessions have NULL auth.uid() which raises insufficient_privilege in migration 049's hardened version; cron observability via cron.job_run_details instead"
  - "COALESCE(c.d30, bo.delta_30d) in UPDATE — preserves existing realized deltas when a new window is not yet available; prevents overwriting 30d with NULL once it was populated"
  - "extract_estimated returns rows only for days_elapsed 1..29 — prevents the estimated label from reappearing after the 30-day realized window has populated"
  - "match_decisions seed uses insert with ignoreDuplicates because partial unique index (WHERE decision='sent_as_intro') cannot be targeted by PostgREST onConflict upsert"

requirements-completed: [OUTCOME-06, OUTCOME-07, OUTCOME-08]

duration: 65min
completed: 2026-04-18
---

# Phase 01 Plan 04: Bridge Outcome Cron Migration Summary

**Migration 060 ships 4 SQL functions + pg_cron schedule + self-verify; live-DB integration test proves cumulative equity math (5%/15%/30%) + idempotency + D-19 guard; runbook documents schedule, signals, deploy checklist, and 5 failure modes**

## Performance

- **Duration:** ~65 min
- **Started:** 2026-04-18T09:45:00Z
- **Completed:** 2026-04-18T10:05:00Z
- **Tasks:** 3 of 3 (Task 2 was DB-only — no source commit)
- **Files created:** 3 (migration, test, runbook)
- **Files modified:** 0

## Accomplishments

### Task 1: Migration 060 authored

`supabase/migrations/060_bridge_outcome_cron.sql` (293 lines):

- `public.extract_equity_at(series JSONB, target_date DATE) → NUMERIC` — SQL IMMUTABLE, indexes `returns_series` by date text key; returns NULL for 0 values (prevent divide-by-zero)
- `public.extract_delta(series JSONB, anchor DATE, days INT) → NUMERIC` — SQL IMMUTABLE, computes `(equity_at(anchor+N) / equity_at(anchor)) - 1`; cumulative equity math, not SUM of daily returns
- `public.extract_estimated(series JSONB, anchor DATE) → TABLE(bps NUMERIC, days INT)` — plpgsql STABLE, returns estimated delta in basis points for days_elapsed ∈ [1,29]
- `public.compute_bridge_outcome_deltas() → TABLE(updated_count INT, failed_count INT, batch_started_at TIMESTAMPTZ)` — SECURITY DEFINER, SET search_path, updates only `kind='allocated'` rows with `delta_30d IS NULL OR needs_recompute=TRUE`; clears `needs_recompute=FALSE` atomically
- pg_cron registration: `0 3 * * *` gated on `pg_extension extname='pg_cron'`; NOTICE in local dev
- REVOKE ALL + GRANT EXECUTE to service_role only (T-01-04-06)
- Self-verify DO block: asserts 4 functions + 1 cron entry; raises EXCEPTION on missing artifact
- `vercel.json` untouched

### Task 2: DB push applied (DB-only)

```
Applying migration 060_bridge_outcome_cron.sql...
NOTICE (00000): Scheduled compute_bridge_outcome_deltas at 03:00 UTC
NOTICE (00000): Migration 060 self-verify: 4 functions, 1 cron entries (or pg_cron absent)
Finished supabase db push.
```

Post-apply psql verification (via `npx supabase db query --linked`):

| Check | Expected | Result |
|-------|----------|--------|
| `COUNT(*) FROM pg_proc WHERE proname IN (4 function names)` | 4 | **4** |
| `SELECT jobname, schedule FROM cron.job WHERE jobname='compute_bridge_outcome_deltas'` | 1 row @ `0 3 * * *` | **1 row** |
| `SELECT * FROM public.compute_bridge_outcome_deltas()` | `updated_count>=0, failed_count=0` | **updated_count=0, failed_count=0** (no bridge_outcomes rows yet) |

pg_cron is installed on production Supabase (confirmed by NOTICE "Scheduled… at 03:00 UTC").

### Task 3: Live-DB integration test + runbook

`src/__tests__/bridge-outcome-cron.test.ts` — 4 live-DB integration tests, all green:

| Test | Result |
|------|--------|
| delta_30d ≈ 0.05, delta_90d ≈ 0.15, delta_180d ≈ 0.30 on linear 1.00→1.30 curve | PASS (634ms) |
| kind='rejected' row untouched — delta fields remain NULL (D-19) | PASS (304ms) |
| Idempotency — second invocation returns updated_count=0 | PASS (303ms) |
| Re-flip needs_recompute=true triggers another update | PASS (901ms) |

`docs/runbooks/bridge-outcome-cron.md` — covers Overview, Schedule, Signals (pg_cron observability), Deploy checklist, 5 Common issues.

## Task Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 | `a568235` | feat(01-04): author migration 060 — 4 SQL functions + pg_cron + self-verify |
| Task 2 | DB-only | npx supabase db push — no source commit |
| Task 3 | `fdb78b0` | test(01-04): live-DB cron test + bridge-outcome-cron runbook |

## Files Created

| File | Purpose |
|------|---------|
| `supabase/migrations/060_bridge_outcome_cron.sql` | 4 SQL functions + pg_cron schedule + self-verify DO block |
| `src/__tests__/bridge-outcome-cron.test.ts` | Live-DB integration: math, D-19 guard, idempotency, needs_recompute lifecycle |
| `docs/runbooks/bridge-outcome-cron.md` | Runbook: schedule, signals, deploy checklist, 5 failure modes |

## Decisions Made

- No `log_audit_event` call from inside the cron function — pg_cron sessions have `NULL auth.uid()` which causes `insufficient_privilege` in the hardened `log_audit_event` from migration 049; observability via `cron.job_run_details` instead. OUTCOME-08 remains satisfied by the per-row audit emission in Plan 01-02's POST route.
- `COALESCE(c.d30, bo.delta_30d)` in the UPDATE — preserves previously computed realized deltas when a window is not yet available; prevents overwriting 90d/180d with NULL before those windows are populated.
- `extract_estimated` restricts to `days_elapsed ∈ [1, 29]` only — once the 30-day realized window is available, the estimated label does not reappear.
- Live-DB test uses `insert with ignoreDuplicates` for `match_decisions` — the partial unique index `uniq_match_dec_sent_per_pair` cannot be targeted by PostgREST's `onConflict` upsert syntax.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test seed missing required columns on `strategies` and `match_decisions`**

- **Found during:** Task 3 live-DB test run
- **Issue:** `strategies.user_id` is `NOT NULL` with no default; seed omitted it causing FK violation. `match_decisions.decided_by` is `NOT NULL` with no default; seed omitted it. `match_decisions` upsert with `onConflict` failed because the relevant unique constraint is a partial index (WHERE clause), which PostgREST cannot target.
- **Fix:** Added `user_id: allocatorId` to strategies upsert; added `decided_by: allocatorId` to match_decisions; changed match_decisions insert to use `ignoreDuplicates: true` instead of upsert.
- **Files modified:** `src/__tests__/bridge-outcome-cron.test.ts`
- **Commit:** `fdb78b0` (included in same commit as test authoring)

## db push Output

```
Applying migration 060_bridge_outcome_cron.sql...
NOTICE (00000): Scheduled compute_bridge_outcome_deltas at 03:00 UTC
NOTICE (00000): Migration 060 self-verify: 4 functions, 1 cron entries (or pg_cron absent)
Finished supabase db push.
```

Exit code: 0.

## HAS_LIVE_DB Test Results

`HAS_LIVE_DB=true` was available during this run (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from `.env.local`).

All 4 test cases passed against the live Supabase database.

## Sentinel Test Status

`npx vitest run src/__tests__/vercel-cron-limits.test.ts` — **2/2 PASS** (vercel.json unchanged, Hobby 2/2 cap maintained).

## Known Stubs

None — this plan is pure SQL functions, a live-DB integration test, and a runbook. No UI rendering paths.

## Threat Flags

No new trust boundaries introduced beyond those already modeled in the plan's threat register (T-01-04-01 through T-01-04-08):

- SECURITY DEFINER + SET search_path mitigates T-01-04-01
- Double `WHERE kind='allocated'` guard mitigates T-01-04-02; verified by live-DB test
- REVOKE ALL + GRANT EXECUTE to service_role mitigates T-01-04-06
- vercel.json untouched; cron-limits test remains green (T-01-04-07)
- Live-DB test asserts exact delta values (T-01-04-08)

## Self-Check: PASSED

- `supabase/migrations/060_bridge_outcome_cron.sql` — FOUND
- `src/__tests__/bridge-outcome-cron.test.ts` — FOUND
- `docs/runbooks/bridge-outcome-cron.md` — FOUND
- `.planning/phases/01-outcome-tracker/01-04-SUMMARY.md` — FOUND (this file)
- commit `a568235` (migration 060) — FOUND
- commit `fdb78b0` (test + runbook) — FOUND

---
*Phase: 01-outcome-tracker*
*Completed: 2026-04-18*
