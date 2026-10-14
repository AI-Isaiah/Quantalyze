-- Additive stand-in: `public.audit_log`. The dump declares it at
-- supabase/schema/baseline.sql ("public"."audit_log"); this fixture mirrors that
-- declaration EXACTLY (same seven columns, same types, same defaults, same
-- nullability, same primary key) and nothing else.
--
-- WHY IT IS NEEDED (Phase 167.1.2.1 RECONMARKER, plan 01, D-12). The migration
-- 20261014120000 adds public.backfill_api_keys_history_reconstructed_at(), which
-- reads the worker's `allocator.equity.reconstruct_*` audit events as the
-- evidence that survives compute_jobs retention. The function is LANGUAGE sql,
-- so PostgreSQL resolves audit_log when the function is CREATED, not when it is
-- called. A lane without this table therefore refuses the migration at apply,
-- and no arm of the gate runs. MEASURED, not assumed: none of the fan-out gates'
-- apply lists creates audit_log (the real migrations that do,
-- 20260407075303_portfolio_intelligence.sql and 20260417110539_retention_crons.sql,
-- drag in the portfolio and retention chains), and the only existing stand-in,
-- 38-fixture-commit-scenario-batch-hosts.sql, also creates an allocator_holdings
-- index and a REVOKE on _assert_no_public_execute that this gate has no use for.
--
-- NOT A COPY OF 38's TABLE. 38 declares `user_id UUID NOT NULL`; the dump
-- declares `"user_id" "uuid"` (nullable). This stand-in follows the dump.
-- `IF NOT EXISTS` makes a gate that applies both files safe in either order.
-- R6-fixture-shadows-fixture-table only fires on a gate that applies both, and
-- no gate does: if one ever does, the earlier file's narrower NOT NULL wins and
-- that gate must re-add the difference as the fixture-20 idiom does.
--
-- RLS, the immutability triggers and the retention policies are NOT reproduced.
-- The backfill is SECURITY INVOKER and the gate calls it as the database owner,
-- which is what the migration does too; an arm over this fixture proves the
-- backfill reads the right rows, not who may read audit_log on a hosted project.
--
-- ON SHARED TEST AND ON PROD the real table already exists. This file is never
-- applied there: like every entry under scripts/pg-lane/fixtures/, it exists
-- only inside scripts/pg-lane/run.sh's throwaway cluster.
--
-- Never a second base: 01-fixture-core.sql remains the only destructive fixture.
CREATE TABLE IF NOT EXISTS public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
