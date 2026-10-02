-- Test: allocator_equity_snapshots.pre_terminus_balance_unknown is persisted
-- (CL9 / NEW-C01-11). Guards migration
-- 20260529160000_allocator_equity_pre_terminus_flag.sql.
--
-- Background
-- ----------
-- On OKX 90-day terminus the equity replay starts from a zero baseline (the
-- funding deposit is outside the fetch window), so reconstructed rows carry
-- garbage absolute levels. The analytics worker stamps pre_terminus_balance_
-- unknown=true on those rows; the dashboard excludes flagged rows from
-- level-derived surfaces (equity curve / drawdown / TWR). This test pins the
-- column shape and the replace_allocator_equity_snapshots RPC's per-row
-- persistence (including the COALESCE-to-false backstop for a pre-deploy
-- worker whose payload omits the field).
--
-- Asserted invariants:
--   1. Column pre_terminus_balance_unknown exists, is boolean, NOT NULL,
--      default false.
--   2. The atomic replace RPC persists the per-row flag: true stays true,
--      false stays false, and a row OMITTING the field becomes false.
--
-- Test DB lag: the shared test DB tracks prod but lags main, so on a PR branch
-- the migration may not be applied yet. The assertions are gated on the column
-- being present (NOTICE skip otherwise) so the test becomes a hard regression
-- guard once the test DB catches up, without red-failing pre-apply. The
-- migration itself self-verifies on apply. Whole test rolls back.
--
-- ⭐ MACHINE-EXECUTABLE TWINS (phase 164.4, REDUNDER-BACKFILL). Each prose
-- RED-UNDER below carries an adjacent `RED-UNDER-M` object that
-- scripts/mutation-runner executes on every push: it mutates COPIES on a
-- throwaway pg-lane cluster, requires the FIRST `TEST FAILED (…)` to name that
-- arm, and restores GREEN. Schema: scripts/mutation-runner/GRAMMAR.md.
-- ⚠️ THE COLUMN AND THE RPC ARE LAST-DEFINED IN DIFFERENT MIGRATIONS, and each
-- twin targets whichever LAST defines the object it mutates: 20260529160000 is
-- the only definition of the pre_terminus_balance_unknown column, but
-- 20260602183000 (B5b) is the NEWEST `CREATE OR REPLACE` of
-- replace_allocator_equity_snapshots — it re-issues the whole body to add the
-- H-1186 advisory lock. Mutating the CL9 copy in 20260529160000 would be
-- overwritten by B5b two files later and prove nothing, so assertion 2's twin
-- targets B5b. On this lane the baseline prints NO `SKIP`: the apply list below
-- ends past 20260529160000, so the column is always present and both assertions
-- are enforced rather than skipped.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/20-fixture-app-role-helper.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","supabase/migrations/20260420213754_allocator_equity_snapshots.sql","supabase/migrations/20260527102050_replace_allocator_equity_snapshots.sql","supabase/migrations/20260529160000_allocator_equity_pre_terminus_flag.sql","supabase/migrations/20260602183000_b5b_api_key_delete_atomicity.sql"]}

BEGIN;

DO $$
DECLARE
  v_col_type     TEXT;
  v_col_nullable TEXT;
  v_col_default  TEXT;
  v_probe_alloc  UUID := gen_random_uuid();
  v_flag_true    BOOLEAN;
  v_flag_false   BOOLEAN;
  v_flag_omitted BOOLEAN;
  v_count        INTEGER;
BEGIN
  SELECT data_type, is_nullable, column_default
    INTO v_col_type, v_col_nullable, v_col_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'allocator_equity_snapshots'
      AND column_name = 'pre_terminus_balance_unknown';

  IF v_col_type IS NULL THEN
    RAISE NOTICE 'SKIP: migration 20260529160000 not yet applied here (pre_terminus_balance_unknown column absent). Assertions enforce once the test DB catches up to prod.';
    RETURN;
  END IF;

  -- ---- (1) column shape ------------------------------------------------------
  -- RED-UNDER: drop `NOT NULL` from the ADD COLUMN in migration 20260529160000,
  --            leaving `BOOLEAN DEFAULT false`. The column still exists, is
  --            still boolean and still defaults to false — every other term of
  --            this assertion passes — but a nullable flag lets the worker
  --            write NULL, and `WHERE NOT pre_terminus_balance_unknown` then
  --            silently DROPS those rows from the dashboard's level-derived
  --            surfaces instead of flagging them. That is the failure this arm
  --            exists to catch, and only the is_nullable term sees it.
  -- ⚠️ LAYERED: the migration's own self-verify (a) asserts the same NOT NULL
  --    and would ABORT THE APPLY, so its `v_col_nullable <> 'NO'` guard must be
  --    neutered in the same mutation or this gate never runs. The guard edited
  --    is the MIGRATION's (`CL9 migration failed: …`), never this file's.
  -- RED-UNDER-M: {"arm":"1","apply":[{"kind":"edit","file":"supabase/migrations/20260529160000_allocator_equity_pre_terminus_flag.sql","find":"  ADD COLUMN IF NOT EXISTS pre_terminus_balance_unknown BOOLEAN NOT NULL DEFAULT false;","replace":"  ADD COLUMN IF NOT EXISTS pre_terminus_balance_unknown BOOLEAN DEFAULT false;","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260529160000_allocator_equity_pre_terminus_flag.sql","find":"  IF v_col_nullable <> 'NO' THEN","replace":"  IF FALSE THEN","occurrences":1}]}
  IF v_col_type <> 'boolean' THEN
    RAISE EXCEPTION 'TEST FAILED (1): pre_terminus_balance_unknown must be boolean, got %', v_col_type;
  END IF;
  IF v_col_nullable <> 'NO' THEN
    RAISE EXCEPTION 'TEST FAILED (1): pre_terminus_balance_unknown must be NOT NULL, got is_nullable=%', v_col_nullable;
  END IF;
  IF v_col_default IS NULL OR position('false' in lower(v_col_default)) = 0 THEN
    RAISE EXCEPTION 'TEST FAILED (1): pre_terminus_balance_unknown default must be false, got %',
      COALESCE(v_col_default, '<null>');
  END IF;
  RAISE NOTICE 'Assertion 1 OK: column boolean NOT NULL DEFAULT false.';

  -- ---- (2) RPC persists the per-row flag (true / false / omitted->false) ------
  -- RED-UNDER: in migration 20260602183000 (B5b — the NEWEST definition of
  --            replace_allocator_equity_snapshots, NOT the CL9 copy in
  --            20260529160000, which B5b overwrites two files later), replace
  --            the INSERT's `COALESCE(r.pre_terminus_balance_unknown, false)`
  --            projection with a literal `false`. Every row then persists
  --            false, so a worker that correctly flags an OKX-terminus replay
  --            has its flag silently discarded and the garbage absolute levels
  --            flow back into the equity curve / drawdown / TWR — the exact
  --            NEW-C01-11 regression. B5b's own self-verify only greps its
  --            prosrc for the STRING `pre_terminus_balance_unknown`, which the
  --            INSERT column list and the recordset declaration still contain,
  --            so the apply stays clean and this gate is what catches it.
  -- RED-UNDER-M: {"arm":"2","apply":[{"kind":"edit","file":"supabase/migrations/20260602183000_b5b_api_key_delete_atomicity.sql","find":"      COALESCE(r.pre_terminus_balance_unknown, false)","replace":"      false","occurrences":1}]}
  INSERT INTO auth.users (id, email)
    VALUES (v_probe_alloc, 'cl9t-' || v_probe_alloc::text || '@quantalyze.test')
    ON CONFLICT (id) DO NOTHING;

  SELECT replace_allocator_equity_snapshots(
    v_probe_alloc,
    '[{"asof":"2026-03-01","value_usd":10.0,"breakdown":{"USDT":10.0},"source":"exchange_primary","pre_terminus_balance_unknown":true},
      {"asof":"2026-03-02","value_usd":20.0,"breakdown":{"USDT":20.0},"source":"exchange_primary","pre_terminus_balance_unknown":false},
      {"asof":"2026-03-03","value_usd":30.0,"breakdown":{"USDT":30.0},"source":"exchange_primary"}]'::jsonb,
    3
  ) INTO v_count;
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'TEST FAILED (2): expected 3 inserted rows, got %', v_count;
  END IF;

  SELECT pre_terminus_balance_unknown INTO v_flag_true
    FROM public.allocator_equity_snapshots
    WHERE allocator_id = v_probe_alloc AND asof = DATE '2026-03-01';
  SELECT pre_terminus_balance_unknown INTO v_flag_false
    FROM public.allocator_equity_snapshots
    WHERE allocator_id = v_probe_alloc AND asof = DATE '2026-03-02';
  SELECT pre_terminus_balance_unknown INTO v_flag_omitted
    FROM public.allocator_equity_snapshots
    WHERE allocator_id = v_probe_alloc AND asof = DATE '2026-03-03';

  IF v_flag_true IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TEST FAILED (2): flagged row should persist true, got %', COALESCE(v_flag_true::text, '<null>');
  END IF;
  IF v_flag_false IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'TEST FAILED (2): unflagged row should persist false, got %', COALESCE(v_flag_false::text, '<null>');
  END IF;
  IF v_flag_omitted IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'TEST FAILED (2): row omitting the field should COALESCE to false, got %', COALESCE(v_flag_omitted::text, '<null>');
  END IF;

  RAISE NOTICE 'Assertion 2 OK: replace RPC persists per-row flag (true / false / omitted->false).';
END $$;

ROLLBACK;
