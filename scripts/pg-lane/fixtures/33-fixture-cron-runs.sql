-- Additive stand-in: `public.cron_runs`. 20260408113029_cron_heartbeat.sql:31-39
-- creates it in production (`CREATE TABLE IF NOT EXISTS cron_runs`, seven
-- columns); this fixture mirrors those seven columns EXACTLY — same names, same
-- types, same defaults, same PRIMARY KEY, same status CHECK.
--
-- WHY THE REAL MIGRATION CANNOT ENTER THE FAN-OUT APPLY LISTS, measured at HEAD
-- rather than assumed. 20260408113029 does not stop at the table. Immediately
-- after it, at :57-66, it declares two row-security policies, and policy
-- declaration RESOLVES its columns and functions at DECLARATION time — not at
-- read time, the way a plpgsql body resolves its own references:
--
--   * `cron_runs_admin_read` (:57-62) resolves `profiles.is_admin`. That column
--     reaches a lane only through scripts/pg-lane/fixtures/12-fixture-profiles-is-admin.sql,
--     which is in the TICK gate's apply list and in NEITHER fan-out list.
--   * `cron_runs_service_role` (:64-66) resolves `auth.role()`. That function
--     reaches a lane only through scripts/pg-lane/fixtures/15-fixture-auth-role.sql,
--     also absent from both fan-out lists.
--
-- The two fan-out lists are supabase/tests/test_ledger_refresh_fanout.sql:194
-- and supabase/tests/test_ledger_refresh_composite_arm.sql:206, both
-- `RED-UNDER-SETUP` lists. Appending 20260408113029 to either one aborts the
-- apply on 42703 before any arm runs, so the gate reports nothing and the run
-- reads as a harness fault rather than as the missing dependency it is. Hence a
-- stand-in, on the pattern 31-fixture-system-flags.sql established for exactly
-- this shape.
--
-- WHY IT IS NEEDED. The ledger fan-outs' dormancy instrument
-- (20260911130000_ledger_fanout_grantees_and_dormancy.sql) writes ONE counted
-- row into this table when a dormant tick has a cause nobody can otherwise see —
-- the activation row is absent or invisible, or its read raised. plpgsql
-- resolves `public.cron_runs` at CALL time, so that migration APPLIES on a lane
-- without this fixture; what it cannot do there is get PAST the instrument —
-- every dormant call would die on 42P01 naming no arm, and the arms that assert
-- the counted row would have nothing to read.
--
-- RLS is ENABLED with NO POLICIES, deliberately, and the omission is the same
-- one 31-fixture-system-flags.sql:27-33 argues. The only lane writer is a
-- SECURITY DEFINER body whose owner is RLS-exempt (arm J of the ledger gates
-- asserts that exemption, and 20260825130000's own verification block RAISES
-- unless the owner is rolsuper OR rolbypassrls), so the write bypasses row
-- security by construction. A policy declared here would shadow nothing today
-- but could collide by name with a future migration's own
-- (R7-fixture-shadows-policy, scripts/lint-sql-gates.mjs) while proving nothing
-- that is under test.
--
-- NO INDEX. 20260408113029:41-46 declares two, both for the 36h stale alert's
-- read path. Nothing on the lane reads this table through them, and a stand-in
-- that carries more than the objects under test invites the next reader to trust
-- it as a copy of production. It is not one.
--
-- NO SEED ROW, and no statement here writes one. Every arm that reads this table
-- asserts a count the FUNCTION UNDER TEST wrote in the gate's own transaction; a
-- row planted here would make those counts pass on the fixture's row.
--
-- ON SHARED TEST AND ON PROD the real table already exists — TEST's `public` was
-- rebuilt from supabase/schema/baseline.sql on 2026-09-08, catalogue included.
-- This file is never applied there: like every entry under
-- scripts/pg-lane/fixtures/, it exists only inside scripts/pg-lane/run.sh's
-- throwaway cluster, which listens on 127.0.0.1 and is destroyed by its EXIT
-- trap in every outcome (the 32-fixture-vault-stand-in.sql:21-26 statement of
-- the same contract).
--
-- WHAT IT DOES NOT PROVE (the fixtures/ contract, run.sh:69-77). It is the
-- fixture author's MODEL of the heartbeat table, not the table: it carries the
-- columns the instrument names and the CHECK that constrains them, and nothing
-- about who may READ the rows on a hosted project. An arm over this fixture
-- proves that the dormant branch writes a counted row carrying its cause. It
-- proves nothing about the two policies above.
--
-- Never a second base: 01-fixture-core.sql remains the only destructive fixture.
-- This file creates one table and enables row security on it; it removes
-- nothing.
CREATE TABLE cron_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cron_name TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'error')),
  error TEXT,
  metadata JSONB
);

ALTER TABLE cron_runs ENABLE ROW LEVEL SECURITY;
