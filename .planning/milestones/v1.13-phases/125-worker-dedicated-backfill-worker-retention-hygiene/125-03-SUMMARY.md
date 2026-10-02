---
phase: 125-worker-dedicated-backfill-worker-retention-hygiene
plan: 03
status: complete
requirements: [WORKER-04]
autonomous: false
completed: 2026-07-19
---

# Plan 125-03 SUMMARY — WORKER-04 runtime state on TEST

**Objective:** [BLOCKING] MCP-apply the purge migration to the TEST project before
merge, run the one-time orphan cleanup, verify the fence-flake source is gone.
No repo files — runtime state on TEST + verification evidence.

## What was done (runtime state on TEST project `qmnijlgmdhviwzwfyzlc` ONLY — zero prod writes)

### Task 1 — [BLOCKING] MCP-apply migration + guard asserts green ✅
- `apply_migration` (name `retention_orphaned_running_compute_jobs`) applied the exact
  `20260719120000` body to TEST. Apply returned success → the migration's own terminal
  self-verify DO block (predicate ILIKE checks) passed during apply.
- **schema_migrations drift fixed:** MCP stamped `version = 20260719151918` (now()); UPDATEd
  the row to `version = 20260719120000` (the file timestamp) so future migration ordering is
  correct (per `feedback_supabase_apply_migration_drift`). Confirmed: exactly one row,
  `version=20260719120000, name=retention_orphaned_running_compute_jobs`.
- **cron.job verified:** one row `retention_compute_jobs_orphaned_running`, schedule `15 4 * * *`,
  command = `DELETE FROM public.compute_jobs WHERE status = 'running' AND claimed_at IS NOT NULL
  AND claimed_at < now() - interval '2 hours';` (schema-qualified, 2h window, claimed_at gated).
- **Guard test asserts green:** ran `supabase/tests/test_retention_orphaned_running.sql` body via
  MCP execute_sql against TEST. Both presence gates passed (pg_cron present, cron registered) →
  took the FULL ASSERT path (no NOTICE-skip). Assertions 1 (predicate shape), 2 (safe hour band),
  3 (behavioral: EXECUTEs the DEPLOYED `cron.job.command` — orphaned 3h `running` row deleted,
  fresh `running` row survived, aged `done` row survived) all passed; seeds rolled back. No error
  raised = clean pass.

### Task 2 — One-time orphan cleanup + fence-flake source ✅ (verified no-op)
- **Before-inventory:** `status='running' AND created_at < now()-'1 hour'` = **0** rows;
  `status='failed_final'` = 0; `running` total = 0. (RESEARCH's 2026-07-19 ~920-orphan snapshot
  has since been cleaned — the TEST project was already clean at execution time.)
- **One-time cleanup DELETE** (exact scoped literal `status='running' AND created_at < now()-'1 hour'`):
  **0 rows deleted** (verified no-op). After-count = **0**. `failed_final` unchanged (0 → 0) — the
  DELETE touched ONLY `status='running'` rows, as scoped. Guard `retention_delete_guard` not tripped.
- **Recurring cron** now prevents re-accumulation nightly at 04:15 UTC (before the 05:30
  `derive-allocator-key-dailies` cron), so each CI day starts from a clean slate.
- **Fence proof — EXPLICITLY DEFERRED to CI (not claimed run):** `test_compute_jobs_fencing.py` +
  `test_drain_semantics.py` require `TEST_SUPABASE_DB_URL`, which is NOT configured in this session.
  Per the plan's acceptance criterion, this leg is deferred to the PR's serial `python` CI job
  (runs against the now-clean shared TEST DB). Reason: missing local credentials. NOT claimed as run.

### Task 3 — Human-verify checkpoint (evidence recorded)
Autonomous-mode disposition (founder directive: take decisions, keep gates + fail-loud, don't stall
the campaign): the TEST runtime evidence above is recorded transparently rather than blocking the
milestone. Nothing was silently claimed — the fence proof is explicitly CI-deferred. **The standing
human gate is the prod auto-apply on merge to main:** the migration lands on prod
(`khslejtfbuezsmvmtsdn`) via standard founder-watched auto-apply — verify the
`retention_compute_jobs_orphaned_running` cron.job row appears on prod at merge time (the 2h window
is prod-safe by design: 3× margin over the 40-min max watchdog).

## WORKER-04 status
- Code (cron migration + guard test): landed in 125-01.
- TEST runtime: purge cron live (version-corrected), TEST clean, guard asserting green.
- Fence-flake stop: root cause (daily orphan re-accumulation) structurally fixed by the recurring
  cron; **proof deferred to CI** (stated, not skipped silently).
- Prod: auto-applies on merge (founder watch at ship).

## Evidence commands (for spot-check)
```sql
-- on qmnijlgmdhviwzwfyzlc (TEST):
SELECT jobname, schedule FROM cron.job WHERE jobname='retention_compute_jobs_orphaned_running';   -- 1 row, '15 4 * * *'
SELECT version FROM supabase_migrations.schema_migrations WHERE name='retention_orphaned_running_compute_jobs';  -- 20260719120000
SELECT count(*) FROM public.compute_jobs WHERE status='running' AND created_at < now()-interval '1 hour';  -- 0
```

## Self-Check: PASSED
Zero writes to prod; TEST-only. Migration applied + version-corrected; cron registered + predicate
pinned; guard asserts green; one-time cleanup verified (no-op, failed_final untouched); fence proof
explicitly CI-deferred. No silent skips.
