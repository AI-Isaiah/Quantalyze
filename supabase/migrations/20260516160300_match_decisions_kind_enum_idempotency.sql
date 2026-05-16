-- audit-2026-05-07 mitigation
-- Closes: H-0954 (pr-test-analyzer c9), H-0959 (silent-failure-hunter c8)
-- Source file: supabase/migrations/20260426131718_match_decisions_kind_enum.sql (was 080)
-- Issue:
--   H-0954: migration 080 is forward-only by design but has no rollback
--     or re-apply idempotency test. A partial apply leaves the type/
--     CHECKs in inconsistent state.
--   H-0959: the CREATE TYPE block swallows `duplicate_object` without
--     re-validating the four enum values. A prior partial apply with a
--     different value set (or a divergent dev branch / forensic snapshot)
--     passes the EXCEPTION trap silently and per-kind CHECK creations
--     succeed but every voluntary_X INSERT then fails at runtime with
--     `invalid input value for enum`.
--
-- Mitigation: probe the existing `match_decision_kind` type and
--   ASSERT all four required values are present. Three cases:
--     (a) Type is missing entirely — bootstrap with CREATE TYPE.
--     (b) Type exists with all 4 values — no-op (the canonical post-080 state).
--     (c) Type exists but missing one or more values — RAISE EXCEPTION
--         with a detailed runbook (operator must apply a separate
--         out-of-tx `ALTER TYPE ... ADD VALUE` migration, since
--         ADD VALUE cannot run inside a transaction block in PG ≥ 12
--         and Supabase's migration runner wraps files in transactions).
--
--   This is safer than silently ALTER-TYPE-ADD-VALUEing because:
--   (1) it avoids the "cannot run inside a transaction block" trap that
--       would abort the migration if Supabase wraps the file; (2) any
--       drift in enum cardinality is observable BEFORE per-kind CHECKs
--       are added (which would silently succeed on bad data per H-0959);
--   (3) operator gets a clear remediation step.
--
-- Re-apply safety: the probe + assertion is read-only on the canonical
-- post-080 state. Re-apply is a no-op once the enum is correct.

BEGIN;
SET lock_timeout = '5s';

-- --------------------------------------------------------------------------
-- STEP 1: bootstrap the enum if entirely missing
-- --------------------------------------------------------------------------
-- This branch only fires on a fresh DB where mig 080 has not yet applied
-- (e.g., a sibling branch or recovery snapshot). On the production
-- chain mig 080 ran 2026-04-26 so this is normally a no-op.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
     JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'match_decision_kind'
  ) THEN
    CREATE TYPE public.match_decision_kind AS ENUM (
      'bridge_recommended',
      'voluntary_remove',
      'voluntary_add',
      'voluntary_modify'
    );
    RAISE NOTICE 'audit-2026-05-07 H-0954: match_decision_kind enum created (was missing — mig 080 not in chain on this DB).';
  END IF;
END $$;

-- --------------------------------------------------------------------------
-- STEP 2: assert all four required values are present
-- --------------------------------------------------------------------------
-- Reads pg_enum + pg_type. Raises EXCEPTION if any value is missing.
-- The assertion runs after STEP 1 inside the same migration tx, so
-- the bootstrap CREATE TYPE (if it fired) is visible.
DO $$
DECLARE
  v_count   INTEGER;
  v_present TEXT[];
  v_missing TEXT[];
BEGIN
  SELECT array_agg(e.enumlabel ORDER BY e.enumsortorder), COUNT(*)
    INTO v_present, v_count
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
   WHERE n.nspname = 'public' AND t.typname = 'match_decision_kind';

  -- Compute the set difference: required minus present.
  SELECT ARRAY(
    SELECT v FROM unnest(ARRAY['bridge_recommended','voluntary_remove','voluntary_add','voluntary_modify']::text[]) v
     WHERE v <> ALL (COALESCE(v_present, ARRAY[]::text[]))
  ) INTO v_missing;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION
      'audit-2026-05-07 H-0954/H-0959: match_decision_kind is missing required value(s): %. Present: %. ' ||
      'Remediation: apply the following out-of-transaction (cannot run inside BEGIN/COMMIT): ' ||
      'ALTER TYPE public.match_decision_kind ADD VALUE IF NOT EXISTS ''<value>''; per missing value. ' ||
      'Then re-run this migration. Note: ADD VALUE is allowed inside a tx in PG >= 12 ONLY if the new value '||
      'is not USED in the same tx — Supabase migration runner wraps files, so apply via psql.',
      array_to_string(v_missing, ', '),
      array_to_string(COALESCE(v_present, ARRAY[]::text[]), ', ');
  END IF;

  IF v_count < 4 THEN
    RAISE EXCEPTION
      'audit-2026-05-07 H-0954/H-0959: match_decision_kind has only % value(s); expected at least 4. Present: %',
      v_count, v_present;
  END IF;

  RAISE NOTICE 'audit-2026-05-07 H-0954/H-0959: match_decision_kind has all 4 required values: %.', v_present;
END $$;

-- --------------------------------------------------------------------------
-- STEP 3: behavioral coverage assertion for the voluntary_add CTE branch
-- --------------------------------------------------------------------------
-- M-0822 (red-team): mig 080 STEP 9 assertion (g) checks
-- `pg_get_functiondef(p.oid) LIKE '%voluntary_add_candidates%'` — a
-- substring match that is satisfied by the comment block alone. Tighten
-- by requiring BOTH the CTE label AND a strong shape probe (the CTE
-- must be referenced in a non-comment context: an UPDATE/SELECT
-- statement from the CTE name).
DO $$
DECLARE
  v_body          TEXT;
  v_body_stripped TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_body
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'compute_bridge_outcome_deltas';

  IF v_body IS NULL THEN
    RAISE EXCEPTION 'audit-2026-05-07 M-0822: compute_bridge_outcome_deltas not installed';
  END IF;

  v_body_stripped := regexp_replace(v_body, '--[^\n]*', '', 'g');

  -- The CTE must be declared (`voluntary_add_candidates AS (`) AND
  -- consumed in a downstream stage (`FROM voluntary_add_candidates`
  -- or `FROM voluntary_add_computed`). Comment retention alone would
  -- not satisfy both probes.
  IF v_body_stripped !~* 'voluntary_add_candidates\s+AS\s*\(' THEN
    RAISE EXCEPTION
      'audit-2026-05-07 M-0822: compute_bridge_outcome_deltas missing voluntary_add_candidates CTE declaration (comment retention does not satisfy this probe).';
  END IF;

  IF v_body_stripped !~* 'FROM\s+voluntary_add_(candidates|computed)' THEN
    RAISE EXCEPTION
      'audit-2026-05-07 M-0822: compute_bridge_outcome_deltas voluntary_add CTE is declared but never consumed — branch is dead code.';
  END IF;
END $$;

COMMIT;
</content>
</invoke>
