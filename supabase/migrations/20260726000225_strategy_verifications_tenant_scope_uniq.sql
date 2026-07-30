-- Migration: strategy_verifications wizard_session_id uniqueness -> TENANT-SCOPED
-- Phase 140.1 / PYAPI-01 (repair-programme finding C-08 - the only CRITICAL).
--
-- Why this migration exists
-- -------------------------
-- Migration 20260510173005_process_key_long_idempotency_drain.sql:83-84 created
--
--     CREATE UNIQUE INDEX strategy_verifications_wizard_session_id_unique_idx
--       ON strategy_verifications (wizard_session_id);
--
-- Single column. No WHERE. No tenant key. `wizard_session_id` is
-- CALLER-SUPPLIED (`routers/process_key.py:720` reads it out of `body.context`),
-- so that index made a caller-controlled value unique across the WHOLE PLATFORM.
--
-- >>> SUPERSEDING 20260510173005:72-73 EXPLICITLY <<<
-- That migration's own comment states: "Per migration 093 line 80,
-- wizard_session_id is UUID NOT NULL - plain UNIQUE INDEX (no partial WHERE
-- clause) is correct." The reasoning is sound about NULLability and WRONG about
-- tenancy: it settles whether a partial index is needed, then treats that as
-- settling the whole index shape. Uniqueness must be scoped to the tenant that
-- owns the row, and it was not. Anyone re-reading :72-73 in isolation will
-- conclude the single-column index is correct; it is not, and this migration is
-- the reason the tree no longer matches that comment.
--
-- Two consequences, one of which needs no attacker at all:
--
--   1. Availability / integrity - DETERMINISTIC. Tenant B submitting a
--      wizard_session_id tenant A already used gets 23505 on a LEGITIMATE
--      insert. The route's 23505 handler (`process_key.py:889`) then re-fetches
--      by wizard_session_id alone (`:895-901`) and returns tenant A's
--      verification_id / status / trust_tier to tenant B as if they were B's.
--   2. Confidentiality. An authenticated tenant who OBTAINS a foreign
--      wizard_session_id (screenshot, support ticket, shared URL, log line)
--      reads the victim's verification row on demand via the same path.
--
-- The correct shape
-- -----------------
-- `strategy_verifications` has NO user_id column (columns per
-- 20260501055202_strategy_verifications.sql:77-98). Tenancy is derived through
-- strategy_id -> strategies.user_id - exactly what this table's own owner RLS
-- policy dereferences (:118-124). So the tenant-scoped constraint available
-- without a schema addition is UNIQUE (strategy_id, wizard_session_id).
-- (Adding a user_id column + partial unique index was evaluated and rejected:
-- it needs a backfill, a NULL policy for teaser rows, and a change at EVERY SV
-- insert site - `process_key.py:868-882` AND `finalize_csv_strategy`
-- (20260716130500:316-319). Larger prod blast radius for the same guarantee.)
--
-- Teaser rows all anchor on TEASER_ANCHOR_STRATEGY_ID (`process_key.py:634`),
-- i.e. one shared strategy_id bucket. Harmless under the composite index: the
-- teaser mints a fresh uuid4 wizard_session_id per call (`:635`), so it cannot
-- collide by construction.
--
-- Form of this migration: TRANSACTIONAL, not CONCURRENTLY
-- -------------------------------------------------------
-- Measured before writing: PROD (khslejtfbuezsmvmtsdn) holds 20 rows in
-- strategy_verifications; TEST (qmnijlgmdhviwzwfyzlc) holds 0. 20260510173005's
-- own deploy note (:75-82) sets the decision rule - it built the original index
-- in <1s at then-current counts and said to split into a non-transactional
-- CREATE INDEX CONCURRENTLY migration only past ~1M rows. At 20 rows the
-- ACCESS EXCLUSIVE lock is held for microseconds, so the plain transactional
-- form applies and `SET lock_timeout = '3s'` bounds the worst case.
-- CONCURRENTLY is deliberately NOT used: it cannot run inside a transaction
-- block (25001) and a failed build leaves an INVALID index behind that enforces
-- nothing while still costing every write.
--
-- Ordering: CREATE the new index BEFORE dropping the old one. Reversing that
-- opens a window with NO uniqueness at all, in which a double-submit storm
-- writes duplicate rows that then block the new index build.
--
-- Name: strategy_verifications_strategy_wizard_session_uniq. The old name is
-- NOT reused - `CREATE UNIQUE INDEX IF NOT EXISTS <old name>` would be a silent
-- no-op against the OLD single-column definition, reporting success while
-- changing nothing. The STEP 3 self-verify block asserts the actual indexed
-- column list from pg_index, so even a name collision cannot pass silently.
--
-- Read-path note: after the drop there is no index on wizard_session_id ALONE.
-- The pre-migration query at `process_key.py:722-728` filters on that column
-- only, so it seq-scans until Plan 140.1-02 adds the strategy_id filter (which
-- the new index's leading column serves). At 20 rows this is immaterial;
-- `strategy_verifications_strategy_id_idx` (20260501055202) still covers the
-- factsheet / marketplace / admin join paths.
--
-- Manual rollback (no down/ file - only 26 of 229 migrations carry one):
--   BEGIN;
--     CREATE UNIQUE INDEX strategy_verifications_wizard_session_id_unique_idx
--       ON strategy_verifications (wizard_session_id);
--     DROP INDEX IF EXISTS strategy_verifications_strategy_wizard_session_uniq;
--   COMMIT;
-- That reinstates the cross-tenant collision and will turn
-- supabase/tests/test_strategy_verifications_wizard_session_tenant_scope.sql
-- RED (by design - that file is the gate).

BEGIN;

SET lock_timeout = '3s';

-- ==========================================================================
-- STEP 0 - PRE-FLIGHT: abort if duplicate (strategy_id, wizard_session_id)
-- ==========================================================================
-- Mirrors the M-1 block at 20260510173005:55-67, retargeted at the composite
-- key. Without it a CREATE UNIQUE INDEX failure inside BEGIN/COMMIT leaves a
-- partially-applied migration. Measured 0 duplicates on both PROD and TEST at
-- authoring time; this block is the guard against drift between then and apply.
DO $$
DECLARE
  v_dups INT;
BEGIN
  SELECT count(*) INTO v_dups FROM (
    SELECT strategy_id, wizard_session_id
      FROM strategy_verifications
     GROUP BY strategy_id, wizard_session_id
    HAVING count(*) > 1
  ) AS d;
  IF v_dups > 0 THEN
    RAISE EXCEPTION 'PYAPI-01 ABORT: % duplicate (strategy_id, wizard_session_id) pairs present; resolve manually before applying the composite UNIQUE INDEX', v_dups
      USING ERRCODE = 'unique_violation';
  END IF;
END $$;

-- ==========================================================================
-- STEP 1 - CREATE the tenant-scoped composite unique index (before any drop)
-- ==========================================================================
CREATE UNIQUE INDEX IF NOT EXISTS strategy_verifications_strategy_wizard_session_uniq
  ON strategy_verifications (strategy_id, wizard_session_id);

COMMENT ON INDEX strategy_verifications_strategy_wizard_session_uniq IS
  'Phase 140.1 / PYAPI-01 (C-08). Tenant-scoped wizard double-submit prevention. SUPERSEDES the single-column strategy_verifications_wizard_session_id_unique_idx and the reasoning at migration 20260510173005:72-73: wizard_session_id is caller-supplied, so a single-column unique index makes it unique platform-wide and lets one tenant''s id reject - and then leak - another tenant''s verification row. strategy_verifications has no user_id column; strategy_id is the tenant key (strategies.user_id, per the owner RLS policy at 20260501055202:118-124). Gate: supabase/tests/test_strategy_verifications_wizard_session_tenant_scope.sql.';

-- ==========================================================================
-- STEP 2 - DROP the mis-scoped single-column index
-- ==========================================================================
-- Must happen AFTER step 1. While it exists it enforces GLOBAL uniqueness on
-- wizard_session_id regardless of the new composite index, so leaving it in
-- place would make the whole migration inert.
DROP INDEX IF EXISTS strategy_verifications_wizard_session_id_unique_idx;

-- ==========================================================================
-- STEP 3 - Self-verifying DO block (mirrors 20260510173005 STEP 5)
-- ==========================================================================
DO $$
DECLARE
  v_cols    TEXT[];
  v_valid   BOOLEAN;
  v_old_cnt INT;
  v_uniq    INT;
BEGIN
  -- (a) new index exists, is unique, is VALID, and covers exactly the two
  --     columns in the right order. Asserting the column list (not just the
  --     name) is what makes the IF NOT EXISTS no-op trap unable to pass.
  SELECT array_agg(a.attname ORDER BY k.ord), bool_and(i.indisvalid AND i.indisunique)
    INTO v_cols, v_valid
    FROM pg_index i
    JOIN pg_class c     ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
   WHERE n.nspname = 'public'
     AND c.relname = 'strategy_verifications_strategy_wizard_session_uniq';

  IF v_cols IS DISTINCT FROM ARRAY['strategy_id', 'wizard_session_id']::TEXT[] THEN
    RAISE EXCEPTION 'PYAPI-01: strategy_verifications_strategy_wizard_session_uniq covers %, expected {strategy_id,wizard_session_id}', v_cols;
  END IF;
  IF v_valid IS NOT TRUE THEN
    RAISE EXCEPTION 'PYAPI-01: strategy_verifications_strategy_wizard_session_uniq is not a VALID UNIQUE index';
  END IF;

  -- (b) old single-column index gone
  SELECT count(*) INTO v_old_cnt FROM pg_indexes
   WHERE schemaname = 'public'
     AND tablename  = 'strategy_verifications'
     AND indexname  = 'strategy_verifications_wizard_session_id_unique_idx';
  IF v_old_cnt <> 0 THEN
    RAISE EXCEPTION 'PYAPI-01: old strategy_verifications_wizard_session_id_unique_idx still present - global uniqueness still enforced, migration is inert';
  END IF;

  -- (c) exactly ONE unique index now covers wizard_session_id
  SELECT count(*) INTO v_uniq
    FROM pg_index i
    JOIN pg_class c     ON c.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'strategy_verifications'
     AND i.indisunique
     AND EXISTS (
       SELECT 1 FROM unnest(i.indkey) AS k(attnum)
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
       WHERE a.attname = 'wizard_session_id'
     );
  IF v_uniq <> 1 THEN
    RAISE EXCEPTION 'PYAPI-01: expected exactly 1 unique index covering wizard_session_id, found %', v_uniq;
  END IF;

  RAISE NOTICE 'PYAPI-01: strategy_verifications uniqueness is now tenant-scoped (strategy_id, wizard_session_id); old single-column index dropped.';
END $$;

COMMIT;
