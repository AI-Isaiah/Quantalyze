# Phase 238 PR-2 — migration gates (plan 09 Task 2)

Date: 2026-11-26. Files audited at branch head `46bc55e76`:

- `supabase/migrations/20261126130000_strategy_analytics_computed_at_nullable.sql`
- `supabase/migrations/down/20261126130000-rollback.sql`
- No `supabase/tests` file was added by this phase.

Both auditors were dispatched by the plan 09 orchestrator (an executor has no Agent tool), in parallel, Sonnet at high effort, read-only. Their briefs stated plainly that `ALTER TABLE ... DISABLE TRIGGER` has no precedent in `supabase/migrations/`. They also stated that the migration role's permission for it is unproven until TEST `apply-test`, and they gave the plan 04 PROD counts: 11 failed rows with no figures (the backfill target), 7 failed rows with figures, 16 complete, 8 complete_with_warnings, 0 pending or computing. The table owner is `postgres`.

Fix rounds: **0**. Neither auditor reported a MEDIUM or higher finding.

## migration-reviewer — final verdict

> Verdict: CLEAN (0 CRITICAL, 0 HIGH, 0 MEDIUM, 0 LOW; 5 INFO).

Evidence the reviewer ran:

- `npx vitest run src/__tests__/nevercomputed-backfill-sql-exec.test.ts --maxWorkers=2` passed 17/17 on a throwaway socket-only cluster.
- `node scripts/lint-migration-data-dependence.mjs` reported 340 migrations, 83 allowlisted, 0 NEW.
- Template-artifact scan found 0 hits. The timestamp is newer than every migration on origin/main and collides with none.
- The migration has no BEGIN/COMMIT, no session-level SET and no CONCURRENTLY.
- It touches no policy, grant, SECDEF function or view.

INFO findings (recorded here only, per the TODOS rule (a)):

1. The DISABLE TRIGGER privilege is unproven locally, because the test cluster runs as a superuser. Disabling a named user trigger needs table ownership, and the owner is `postgres`. A refusal on TEST rolls back and blocks PROD, which is the safe direction.
2. STEP 1's ALTER COLUMN already holds ACCESS EXCLUSIVE until commit. So the DISABLE's SHARE ROW EXCLUSIVE adds no new wait, and the comment names the weaker lock.
3. A computing row with a NULL `computing_started_at` and no figures would be stamped `now()` by the stamp trigger. This is benign: PROD has 0 computing rows.
4. Branch hygiene: rebase from origin/main before the single CI run (the baseline re-dump landed after this branch forked).
5. Comment drift: the hold trigger's COMMENT in baseline.sql still says an INSERT keeps the column default. A COMMENT refresh can ride a later migration.

## rls-policy-auditor — final verdict

> RLS audit: 0 CRITICAL, 0 HIGH, 0 MEDIUM, 0 LOW. Leak scopes: [].
> Verdict: CLEAN (no MEDIUM+).

What the auditor verified:

- None of the three policies on `strategy_analytics` (`analytics_insert_deny`, `analytics_update_deny`, `analytics_read`) has a predicate on `computed_at`, so a NULL cannot make a row appear or disappear. The table has no FORCE RLS.
- The disabled hold trigger is not SECDEF and carries no authorization logic. The two other BEFORE UPDATE triggers are no-ops for the backfill.
- The DISABLE window exposes nothing. It runs under STEP 1's ACCESS EXCLUSIVE lock, the trigger enable state is transactional, and STEP 3 checks `tgenabled = 'O'`.
- Only two SQL readers read the column: `get_allocator_recommendations` passes it through a LEFT JOIN, and the `ledger_refresh_staleness` view shows it for information only. Both are NULL-safe.

INFO findings:

1. Same lock-comment point as migration-reviewer INFO-2.
2. The ownership point is acknowledged and fails safe.
3. The rollback has no row guard. `SET NOT NULL` fails loud, and the file documents `--single-transaction`. Run without that flag, a mid-way failure would leave the hold trigger disabled.
4. The status bridge can flip a backfilled NULL row to `complete` without stamping `computed_at` (by design since 20261023120000). The row then reads complete with a NULL date. This is a reader-side NULL-arm concern, covered by the plan 06 and plan 08 readers, and it is not a security issue.
5. Pre-existing and outside this diff: `get_allocator_recommendations` is SECDEF with `search_path = public` only. This migration does not make it worse.

## Still open after merge (not a review finding)

Read the `supabase-migrate.yml` `apply-test` log for the merge commit. Only the managed migration role can prove that `DISABLE TRIGGER` is permitted (RESEARCH A3).
