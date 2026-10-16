-- STAND-IN (lane-only): `public.match_decisions`, `public.bridge_outcomes`, their
-- enum, constraints, indexes, the sync trigger function and the sync trigger, in
-- their PRE-PHASE shape. Phase 164.9.3.1 FANINGRAPH, plan 03 (D-05, SC-2).
--
-- WHAT IT MIRRORS, by object name, from supabase/schema/baseline.sql (locate by
-- name, never by line: release PRs re-dump the file):
--   * type  public.match_decision_kind
--   * table public.match_decisions: its 12 columns, the decision CHECK and the
--     four kind CHECKs (match_decisions_kind_bridge_recommended_v2,
--     _voluntary_add, _voluntary_modify_v2, _voluntary_remove), the primary key,
--     the FKs to profiles (allocator_id, decided_by), strategies (strategy_id
--     ON DELETE CASCADE, original_strategy_id ON DELETE RESTRICT) and
--     contact_requests, and the three partial unique indexes uniq_match_dec_sent_per_pair,
--     uniq_match_dec_thumbdown_per_pair_holding, uniq_match_dec_thumbup_per_pair_holding
--   * table public.bridge_outcomes: its 19 columns, the EIGHT CHECKs
--     (allocated_at_check, estimated_days_check, kind_allocated, kind_check,
--     kind_rejected, note_check, percent_allocated_range_check,
--     rejection_reason_check), the primary key, the unique constraint
--     bridge_outcomes_allocator_match_decision_unique, and the three FKs
--     (allocator_id and strategy_id ON DELETE CASCADE, match_decision_id
--     ON DELETE SET NULL)
--   * index bridge_outcomes_legacy_per_strategy_holding_when_md_null in its OLD
--     key (allocator_id, strategy_id, COALESCE(original_holding_ref, ''))
--     WHERE match_decision_id IS NULL
--   * function public.bridge_outcomes_sync_holding_ref(), copied VERBATIM from
--     20260421154029_match_decisions_original_holding_ref.sql (the body, SECURITY
--     DEFINER and the locked search_path), schema-qualified
--   * trigger bridge_outcomes_sync_holding_ref_trigger,
--     BEFORE INSERT OR UPDATE OF match_decision_id
-- It declares them IN THE SHAPE THE DUMP HAS TODAY, so a gate that applies it and
-- then the migration under test sees exactly what that migration alters on a real
-- database: the OLD index and the OLD trigger function.
--
-- WHY IT IS NEEDED, and why the real migrations are not replayed. The creating
-- migrations (20260418060747_bridge_outcomes.sql,
-- 20260426131719_bridge_outcomes_relax_for_voluntary.sql and
-- 20260426131721_commit_scenario_batch_race_fix.sql) do not replay on the lane.
-- 38-fixture-commit-scenario-batch-hosts.sql records the reason (MEASURED
-- 2026-10-11): 20260426131721 needs bridge_outcomes, which needs the
-- perfect_match chain, whose match_batches CREATE is shadowed by
-- 02-fixture-sanitize-tables.sql's one-column stand-in (the
-- 16-fixture-user-notes-baseline.sql defect class). A gate that applies this file
-- must therefore NOT also list those three migrations (lint R5/R6).
--
-- WHAT IS DELIBERATELY NOT REPRODUCED, and why:
--   * Row level security and every policy on both tables (bridge_outcomes_insert_own,
--     _update_own, _select_own, _admin_read, match_dec_admin_all,
--     match_dec_service_all) and the table GRANTs. The gate that uses this file runs
--     as the database owner and asserts the cascade, not who may write. The
--     ownership contract of the trigger-owned column is asserted through the trigger,
--     which fires for every role.
--   * match_decisions_visibility_check (BEFORE INSERT) and the helper it calls: the
--     gate's arms are about the delete cascade, not about which allocator may see
--     which strategy.
--   * bridge_outcomes_set_updated_at_trigger and its function: nothing the gate
--     asserts reads updated_at.
--   * the FK match_decisions_candidate_id_fkey to match_candidates: no lane
--     stand-in for that table exists, and no arm sets candidate_id. The column is
--     declared, without the FK.
--   * the non-unique indexes (bridge_outcomes_allocator_recent,
--     bridge_outcomes_needs_recompute, bridge_outcomes_strategy_id, idx_match_dec_*,
--     match_decisions_allocator_original_strategy, match_decisions_original_holding_ref)
--     and every COMMENT: no arm depends on them.
--
-- The foreign keys reference public.profiles and public.strategies (fixture
-- 01-fixture-core.sql) and public.contact_requests (23-fixture-contact-requests.sql).
-- Apply this file AFTER both.
--
-- ON SHARED TEST AND ON PROD the real tables already exist. This file is never
-- applied there: like every entry under scripts/pg-lane/fixtures/, it exists only
-- inside scripts/pg-lane/run.sh's throwaway cluster. Every statement is
-- re-runnable (IF NOT EXISTS / CREATE OR REPLACE / DROP TRIGGER IF EXISTS).
--
-- Never a second base: 01-fixture-core.sql remains the only destructive fixture.

-- The enum: swallow only duplicate_object, so a re-run is a no-op and any other
-- failure still aborts.
DO $$
BEGIN
  CREATE TYPE public.match_decision_kind AS ENUM (
    'bridge_recommended',
    'voluntary_remove',
    'voluntary_add',
    'voluntary_modify'
  );
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.match_decisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    allocator_id uuid NOT NULL,
    strategy_id uuid,
    candidate_id uuid,
    decision text NOT NULL,
    founder_note text,
    contact_request_id uuid,
    decided_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    original_strategy_id uuid,
    original_holding_ref text,
    kind public.match_decision_kind NOT NULL,
    CONSTRAINT match_decisions_decision_check CHECK ((decision = ANY (ARRAY['thumbs_up'::text, 'thumbs_down'::text, 'sent_as_intro'::text, 'snoozed'::text]))),
    CONSTRAINT match_decisions_kind_bridge_recommended_v2 CHECK (((kind <> 'bridge_recommended'::public.match_decision_kind) OR ((strategy_id IS NOT NULL) AND ((original_strategy_id IS NOT NULL) <> (original_holding_ref IS NOT NULL))))),
    CONSTRAINT match_decisions_kind_voluntary_add CHECK (((kind <> 'voluntary_add'::public.match_decision_kind) OR ((strategy_id IS NOT NULL) AND (original_holding_ref IS NULL) AND (original_strategy_id IS NULL)))),
    CONSTRAINT match_decisions_kind_voluntary_modify_v2 CHECK (((kind <> 'voluntary_modify'::public.match_decision_kind) OR ((original_holding_ref IS NOT NULL) AND (strategy_id IS NULL) AND (original_strategy_id IS NULL)))),
    CONSTRAINT match_decisions_kind_voluntary_remove CHECK (((kind <> 'voluntary_remove'::public.match_decision_kind) OR ((original_holding_ref IS NOT NULL) AND (strategy_id IS NULL) AND (original_strategy_id IS NULL)))),
    CONSTRAINT match_decisions_pkey PRIMARY KEY (id),
    CONSTRAINT match_decisions_allocator_id_fkey FOREIGN KEY (allocator_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
    CONSTRAINT match_decisions_contact_request_id_fkey FOREIGN KEY (contact_request_id) REFERENCES public.contact_requests(id),
    CONSTRAINT match_decisions_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.profiles(id),
    CONSTRAINT match_decisions_original_strategy_id_fkey FOREIGN KEY (original_strategy_id) REFERENCES public.strategies(id) ON DELETE RESTRICT,
    CONSTRAINT match_decisions_strategy_id_fkey FOREIGN KEY (strategy_id) REFERENCES public.strategies(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_match_dec_sent_per_pair
  ON public.match_decisions USING btree (allocator_id, strategy_id)
  WHERE (decision = 'sent_as_intro'::text);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_match_dec_thumbdown_per_pair_holding
  ON public.match_decisions USING btree (allocator_id, strategy_id, COALESCE(original_holding_ref, ''::text))
  WHERE (decision = 'thumbs_down'::text);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_match_dec_thumbup_per_pair_holding
  ON public.match_decisions USING btree (allocator_id, strategy_id, COALESCE(original_holding_ref, ''::text))
  WHERE (decision = 'thumbs_up'::text);

CREATE TABLE IF NOT EXISTS public.bridge_outcomes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    allocator_id uuid NOT NULL,
    strategy_id uuid,
    match_decision_id uuid,
    kind text NOT NULL,
    percent_allocated numeric(5,2),
    allocated_at date,
    rejection_reason text,
    note text,
    delta_30d numeric,
    delta_90d numeric,
    delta_180d numeric,
    estimated_delta_bps numeric,
    estimated_days integer,
    deltas_computed_at timestamp with time zone,
    needs_recompute boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    original_holding_ref text,
    CONSTRAINT bridge_outcomes_allocated_at_check CHECK (((allocated_at IS NULL) OR ((allocated_at <= CURRENT_DATE) AND (allocated_at >= (CURRENT_DATE - '365 days'::interval))))),
    CONSTRAINT bridge_outcomes_estimated_days_check CHECK (((estimated_days IS NULL) OR ((estimated_days >= 0) AND (estimated_days <= 180)))),
    CONSTRAINT bridge_outcomes_kind_allocated CHECK (((kind <> 'allocated'::text) OR ((percent_allocated IS NOT NULL) AND (allocated_at IS NOT NULL) AND (rejection_reason IS NULL) AND ((strategy_id IS NOT NULL) OR (match_decision_id IS NOT NULL))))),
    CONSTRAINT bridge_outcomes_kind_check CHECK ((kind = ANY (ARRAY['allocated'::text, 'rejected'::text]))),
    CONSTRAINT bridge_outcomes_kind_rejected CHECK (((kind <> 'rejected'::text) OR ((rejection_reason IS NOT NULL) AND (percent_allocated IS NULL) AND (allocated_at IS NULL) AND ((strategy_id IS NOT NULL) OR (match_decision_id IS NOT NULL))))),
    CONSTRAINT bridge_outcomes_note_check CHECK (((note IS NULL) OR (char_length(note) <= 2000))),
    CONSTRAINT bridge_outcomes_percent_allocated_range_check CHECK (((percent_allocated IS NULL) OR ((percent_allocated >= (0)::numeric) AND (percent_allocated <= (100)::numeric)))),
    CONSTRAINT bridge_outcomes_rejection_reason_check CHECK (((rejection_reason IS NULL) OR (rejection_reason = ANY (ARRAY['mandate_conflict'::text, 'already_owned'::text, 'timing_wrong'::text, 'underperforming_peers'::text, 'other'::text])))),
    CONSTRAINT bridge_outcomes_pkey PRIMARY KEY (id),
    CONSTRAINT bridge_outcomes_allocator_match_decision_unique UNIQUE (allocator_id, match_decision_id),
    CONSTRAINT bridge_outcomes_allocator_id_fkey FOREIGN KEY (allocator_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
    CONSTRAINT bridge_outcomes_match_decision_id_fkey FOREIGN KEY (match_decision_id) REFERENCES public.match_decisions(id) ON DELETE SET NULL,
    CONSTRAINT bridge_outcomes_strategy_id_fkey FOREIGN KEY (strategy_id) REFERENCES public.strategies(id) ON DELETE CASCADE
);

-- The OLD partial unique index: the object the cascade 23505 names.
CREATE UNIQUE INDEX IF NOT EXISTS bridge_outcomes_legacy_per_strategy_holding_when_md_null
  ON public.bridge_outcomes USING btree (allocator_id, strategy_id, COALESCE(original_holding_ref, ''::text))
  WHERE (match_decision_id IS NULL);

-- The OLD trigger function, VERBATIM from 20260421154029 (5b), schema-qualified.
CREATE OR REPLACE FUNCTION public.bridge_outcomes_sync_holding_ref()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.match_decision_id IS NOT NULL THEN
    SELECT original_holding_ref
      INTO NEW.original_holding_ref
      FROM match_decisions
     WHERE id = NEW.match_decision_id;
  ELSE
    NEW.original_holding_ref := NULL;
  END IF;
  RETURN NEW;
END;
$$;

-- The OLD trigger: BEFORE INSERT OR UPDATE OF match_decision_id.
DROP TRIGGER IF EXISTS bridge_outcomes_sync_holding_ref_trigger ON public.bridge_outcomes;
CREATE TRIGGER bridge_outcomes_sync_holding_ref_trigger
  BEFORE INSERT OR UPDATE OF match_decision_id ON public.bridge_outcomes
  FOR EACH ROW
  EXECUTE FUNCTION public.bridge_outcomes_sync_holding_ref();
