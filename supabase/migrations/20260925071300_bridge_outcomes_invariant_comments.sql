-- ==========================================================================
-- Phase 164.9.1 (JOBRPCTRUTH), [164.9-LIVEDB-RESIDUE-RPC-AND-INTENT] item b,
-- decisions D-13 and D-15: the catalogue's own record of the bridge_outcomes
-- uniqueness invariant names the two constraints that enforce it today, and
-- stops naming an index migration 081 dropped.
--
-- THE WRITTEN ANSWER (D-13, recorded verbatim here, in the phase plan and in
-- the header of src/__tests__/match-decisions-xor-rls.test.ts):
--   the CURRENT bridge_outcomes uniqueness invariant is two-part —
--   (i) bridge_outcomes_allocator_match_decision_unique
--       UNIQUE (allocator_id, match_decision_id), one outcome per decision
--       (migration 081);
--   (ii) bridge_outcomes_legacy_per_strategy_holding_when_md_null, a PARTIAL
--       unique on (allocator_id, strategy_id, COALESCE(original_holding_ref, ''))
--       WHERE match_decision_id IS NULL (migration 083), restoring 072's
--       per-strategy guarantee only for rows whose decision was nulled out.
--   Two strategy-sourced outcomes for the same (allocator, strategy) under two
--   DIFFERENT decisions are ALLOWED by design; the old arm's 23505 expectation
--   described migration 072's world.
--
-- AUTHORITY, by file:
--   081 = 20260426131719_bridge_outcomes_relax_for_voluntary.sql
--         (dropped 072's per-strategy-holding index and ADDed CONSTRAINT
--         bridge_outcomes_allocator_match_decision_unique);
--   083 = 20260426131721_commit_scenario_batch_race_fix.sql
--         (CREATE UNIQUE INDEX bridge_outcomes_legacy_per_strategy_holding_when_md_null).
--
-- THE TWO STALE TEXTS REPLACED HERE (quoted, so the history stays readable):
--   TABLE comment, 20260418060747_bridge_outcomes.sql (migration 059):
--     'One row per (allocator_id, strategy_id) enforced by unique index.'
--     False since 072 widened the key to the holding axis, and false again
--     since 081 replaced it with the per-decision key.
--   COLUMN comment on original_holding_ref,
--   20260421154029_match_decisions_original_holding_ref.sql (migration 072):
--     'Enables the widened bridge_outcomes_unique_per_strategy_holding index.'
--     That index was dropped by 081. The PROD dump carries the same text, and
--     no later migration re-issued either comment (re-measured at execution:
--     grep -ln "COMMENT ON \(TABLE\|COLUMN\).*bridge_outcomes" supabase/migrations/*.sql
--     returned 059, 072 and 081 only, and 081 re-comments strategy_id alone).
--
-- WHY 081's OWN RATIONALE DOES NOT HOLD. 081 argued the per-decision key keeps
-- every guarantee the per-(allocator, strategy, holding) key gave, because each
-- decision has exactly one (allocator, strategy, holding) tuple. The inference
-- runs the wrong way. Migration 074
-- (20260421160102_match_decisions_widen_unique_holding.sql), with 011's
-- sent_as_intro index, keys match_decisions uniqueness PER DECISION VALUE:
-- separate partial indexes WHERE decision = 'thumbs_up', 'thumbs_down' and
-- 'sent_as_intro'. So one (allocator, strategy, holding) can carry several
-- decisions, and therefore several outcomes. The per-decision key is a
-- DIFFERENT invariant, not a stronger one. That is by design (D-13), and this
-- migration only makes the catalogue say so.
--
-- REVERSIBLE: comment-only. A later COMMENT restores any text. No function
-- body changes, so there is no `-- prod-body-ack:` line and no snapshot under
-- supabase/schema/functions/ moves.
--
-- Transaction style: NO explicit BEGIN/COMMIT. Supabase wraps each migration in
-- an implicit transaction, and SET LOCAL lock_timeout applies to that wrap.
-- This migration writes ZERO table data. Its DO block reads catalogs only
-- (D-07, [164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]): obj_description,
-- col_description over pg_attribute, to_regclass and pg_constraint. Every
-- RAISE format string below is a SINGLE literal (Phase 85 invariant #21).
--
-- ROUND-1 REVIEW CORRECTION (migration-reviewer LOW, 2026-09-25). The first
-- draft of the two comments below said the column "feeds" the md-NULL index and
-- that the md-NULL arm is one outcome per (allocator, strategy, HOLDING). The
-- sync trigger bridge_outcomes_sync_holding_ref() sets original_holding_ref to
-- NULL whenever match_decision_id IS NULL, so every md-NULL row it touches keys
-- as (allocator, strategy, ''). The comments now say that. D-13's written
-- answer above is unchanged: it quotes the index DEFINITION, which is correct.
--
-- Execution proof of the invariant itself is NOT this file. It is the live-DB
-- arms of src/__tests__/match-decisions-xor-rls.test.ts, which assert both
-- constraints by SQLSTATE AND by name.
-- ==========================================================================

SET LOCAL lock_timeout = '3s';

COMMENT ON TABLE public.bridge_outcomes IS
  'Allocator self-reported post-intro outcome for a Bridge-recommended strategy, '
  'or for a voluntary scenario decision (Phase 10). '
  'Uniqueness is two-part. (i) bridge_outcomes_allocator_match_decision_unique, '
  'UNIQUE (allocator_id, match_decision_id): one outcome per decision (migration 081). '
  '(ii) bridge_outcomes_legacy_per_strategy_holding_when_md_null, a partial UNIQUE on '
  '(allocator_id, strategy_id, COALESCE(original_holding_ref, '''')) WHERE match_decision_id IS NULL '
  '(migration 083), for rows whose decision was nulled out. The sync trigger writes NULL to original_holding_ref '
  'for every such row it touches, so that index is in effect one outcome per (allocator, strategy) among them. '
  'Two outcomes for the same (allocator, strategy) under two different decisions are allowed by design. '
  'Outcomes are editable by owner (D-17) and append-only from an audit perspective '
  '(no DELETE policy; corrective edits via UPSERT). '
  'Scope: D-08 through D-19, OUTCOME-01 through OUTCOME-08.';

COMMENT ON COLUMN public.bridge_outcomes.original_holding_ref IS
  'Phase 09 / finding f4. Denormalized mirror of match_decisions.original_holding_ref, '
  'populated by bridge_outcomes_sync_holding_ref_trigger on INSERT/UPDATE OF match_decision_id. '
  'NULL for strategy-sourced rows (original_strategy_id path). '
  'NULL when match_decision_id IS NULL (the trigger writes NULL for those rows). '
  'The md-NULL partial index bridge_outcomes_legacy_per_strategy_holding_when_md_null (migration 083) '
  'keys on COALESCE(original_holding_ref, ''''), but because the trigger nulls this column for md-NULL rows, '
  'that index is in effect per (allocator, strategy); a non-empty holding reaches it only through a direct '
  'UPDATE of this column that leaves match_decision_id unchanged. '
  'Rows with a decision are keyed by bridge_outcomes_allocator_match_decision_unique '
  '(migration 081), which does not read this column.';

DO $$
DECLARE
  v_table_comment  text;
  v_column_comment text;
BEGIN
  SELECT obj_description('public.bridge_outcomes'::regclass, 'pg_class')
    INTO v_table_comment;

  SELECT col_description('public.bridge_outcomes'::regclass, a.attnum)
    INTO v_column_comment
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.bridge_outcomes'::regclass
     AND a.attname = 'original_holding_ref'
     AND NOT a.attisdropped;

  -- NULL first, so a missing comment is named as missing, not as "lacks a name".
  IF v_table_comment IS NULL THEN
    RAISE EXCEPTION 'bridge-outcomes-invariant-comments: public.bridge_outcomes has no table comment after COMMENT ON TABLE';
  END IF;
  IF v_column_comment IS NULL THEN
    RAISE EXCEPTION 'bridge-outcomes-invariant-comments: public.bridge_outcomes.original_holding_ref has no column comment after COMMENT ON COLUMN';
  END IF;

  -- Presence: both current constraint names, in both comments.
  IF strpos(v_table_comment, 'bridge_outcomes_allocator_match_decision_unique') = 0
     OR strpos(v_table_comment, 'bridge_outcomes_legacy_per_strategy_holding_when_md_null') = 0 THEN
    RAISE EXCEPTION 'bridge-outcomes-invariant-comments: the bridge_outcomes table comment does not name both current uniqueness constraints';
  END IF;
  IF strpos(v_column_comment, 'bridge_outcomes_allocator_match_decision_unique') = 0
     OR strpos(v_column_comment, 'bridge_outcomes_legacy_per_strategy_holding_when_md_null') = 0 THEN
    RAISE EXCEPTION 'bridge-outcomes-invariant-comments: the original_holding_ref column comment does not name both current uniqueness constraints';
  END IF;

  -- Absence: the index migration 081 dropped is named by neither comment.
  IF strpos(v_table_comment, 'bridge_outcomes_unique_per_strategy_holding') > 0 THEN
    RAISE EXCEPTION 'bridge-outcomes-invariant-comments: the bridge_outcomes table comment still names the retired index dropped by migration 081';
  END IF;
  IF strpos(v_column_comment, 'bridge_outcomes_unique_per_strategy_holding') > 0 THEN
    RAISE EXCEPTION 'bridge-outcomes-invariant-comments: the original_holding_ref column comment still names the retired index dropped by migration 081';
  END IF;

  -- The two objects the comments name exist in the catalogue.
  IF to_regclass('public.bridge_outcomes_legacy_per_strategy_holding_when_md_null') IS NULL THEN
    RAISE EXCEPTION 'bridge-outcomes-invariant-comments: index public.bridge_outcomes_legacy_per_strategy_holding_when_md_null (migration 083) does not exist';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint c
     WHERE c.conrelid = 'public.bridge_outcomes'::regclass
       AND c.conname = 'bridge_outcomes_allocator_match_decision_unique'
       AND c.contype = 'u'
  ) THEN
    RAISE EXCEPTION 'bridge-outcomes-invariant-comments: unique constraint bridge_outcomes_allocator_match_decision_unique (migration 081) does not exist on public.bridge_outcomes';
  END IF;

  RAISE NOTICE 'bridge-outcomes-invariant-comments: the bridge_outcomes table comment and the original_holding_ref column comment name bridge_outcomes_allocator_match_decision_unique and bridge_outcomes_legacy_per_strategy_holding_when_md_null, neither names the retired index, and both named objects exist.';
END
$$;
