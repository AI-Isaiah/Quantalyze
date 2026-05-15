-- Migration 059: bridge_outcomes + bridge_outcome_dismissals tables
-- Sprint 8 Phase 1: Outcome Tracker — database foundation.
--
-- Why this migration exists
-- -------------------------
-- Bridge V2 closes the recommendation-feedback loop by recording what
-- allocators actually did after receiving a Bridge intro. Two new tables:
--   1. bridge_outcomes — stores the allocator's self-reported outcome
--      (allocated or rejected) for a specific strategy, with realized
--      30/90/180-day delta columns populated by a daily cron.
--   2. bridge_outcome_dismissals — TTL-based server-side snooze: when an
--      allocator clicks [×] on the inline banner, a row is inserted here
--      with expires_at = now() + 24h. The banner query filters these out.
--
-- Scope (D-08 through D-19, OUTCOME-01 through OUTCOME-08)
-- ---------------------------------------------------------
-- * Record + daily-cron delta target: two new tables, three-tier RLS,
--   a trigger that flips needs_recompute when pivot columns change, and
--   the four expected indexes per table.
-- * No pg_cron job or compute_bridge_outcome_deltas function — those
--   ship in migration 060 via Plan 01-04.
-- * No DELETE policy on bridge_outcomes — outcomes are append-only per
--   institutional-audit invariant. Corrective edits happen via owner
--   UPDATE (UPSERTed on the unique index). See RESEARCH.md §Pattern 1.
--
-- RLS summary
-- -----------
-- bridge_outcomes: owner-select, owner-insert, owner-update, admin-read.
--   No DELETE policy (append-only).
-- bridge_outcome_dismissals: owner-select, owner-insert, owner-delete,
--   admin-read. DELETE is permitted so the TTL row can be reaped if the
--   allocator explicitly records an outcome (clears the snooze).
--
-- NOTE: service_role bypasses RLS by default per ADR-0003. No explicit
-- service_role policy is needed on either table.

BEGIN;

-- --------------------------------------------------------------------------
-- STEP 1: bridge_outcomes table
-- --------------------------------------------------------------------------
-- Stores allocator self-reported outcome for a Bridge-introduced strategy.
-- One row per (allocator_id, strategy_id) — the unique index on Step 2
-- enforces this and enables idempotent UPSERTs (D-17 editable-by-owner).
CREATE TABLE IF NOT EXISTS bridge_outcomes (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- allocator who owns this outcome record (matches profiles.id per migration 011 convention)
  allocator_id          UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- strategy the outcome is recorded for (canonical single-column FK — never portfolio_strategies(strategy_id))
  strategy_id           UUID        NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  -- back-reference to the sent_as_intro match_decisions row; nullable because the
  -- intro may have been manually cleared but the outcome is still valid (A6)
  match_decision_id     UUID        REFERENCES match_decisions(id) ON DELETE SET NULL,
  -- D-08: two-value discriminator; drives which other columns are required
  kind                  TEXT        NOT NULL CHECK (kind IN ('allocated', 'rejected')),
  -- D-09: required for kind='allocated'; NULL for kind='rejected'
  percent_allocated     NUMERIC(5,2) CHECK (
    percent_allocated IS NULL
    OR (percent_allocated >= 0.1 AND percent_allocated <= 50)
  ),
  -- D-09: DATE (not TIMESTAMPTZ) — matches returns_series[].date text keys (RESEARCH Pitfall 2)
  allocated_at          DATE        CHECK (
    allocated_at IS NULL
    OR (allocated_at <= CURRENT_DATE AND allocated_at >= CURRENT_DATE - INTERVAL '365 days')
  ),
  -- D-10: required for kind='rejected'; TEXT + CHECK matches migration 011 pattern (not a Postgres ENUM)
  rejection_reason      TEXT        CHECK (
    rejection_reason IS NULL
    OR rejection_reason IN ('mandate_conflict','already_owned','timing_wrong','underperforming_peers','other')
  ),
  -- optional free-text note; max 2000 chars matching intro.message convention (A7)
  note                  TEXT        CHECK (note IS NULL OR char_length(note) <= 2000),
  -- cron output columns (NULL until compute_bridge_outcome_deltas populates them — Plan 01-04)
  delta_30d             NUMERIC,    -- realized 30-day delta (D-12)
  delta_90d             NUMERIC,    -- realized 90-day delta (D-12)
  delta_180d            NUMERIC,    -- realized 180-day delta (D-12)
  -- D-12: estimated partial-window delta in basis points (used for "Estimated: +X.X% (Nd)")
  estimated_delta_bps   NUMERIC,
  -- D-12: days of returns data available since allocated_at (0–29 for Estimated window)
  estimated_days        INT         CHECK (estimated_days IS NULL OR (estimated_days >= 0 AND estimated_days <= 180)),
  -- when the cron last wrote delta columns; NULL until first compute
  deltas_computed_at    TIMESTAMPTZ,
  -- D-16/D-17: set TRUE on every INSERT and on UPDATE when pivot columns change;
  -- cron resets to FALSE after successful per-row compute
  needs_recompute       BOOLEAN     NOT NULL DEFAULT TRUE,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- D-08/D-09/D-10 cross-field integrity enforced at DB level regardless of route Zod validation
  CONSTRAINT bridge_outcomes_kind_fields_valid CHECK (
    (kind = 'allocated' AND percent_allocated IS NOT NULL AND allocated_at IS NOT NULL AND rejection_reason IS NULL)
    OR
    (kind = 'rejected'  AND rejection_reason IS NOT NULL AND percent_allocated IS NULL AND allocated_at IS NULL)
  )
);

COMMENT ON TABLE bridge_outcomes IS
  'Allocator self-reported post-intro outcome for a Bridge-recommended strategy. '
  'One row per (allocator_id, strategy_id) enforced by unique index. '
  'Outcomes are editable by owner (D-17) and append-only from an audit perspective '
  '(no DELETE policy — corrective edits via UPSERT). '
  'Scope: D-08 through D-19, OUTCOME-01 through OUTCOME-08.';

COMMENT ON COLUMN bridge_outcomes.allocator_id IS
  'UUID matching profiles.id — the allocator who recorded this outcome. Never auth.users directly (migration 011 convention).';

COMMENT ON COLUMN bridge_outcomes.strategy_id IS
  'FK to strategies(id). Canonical single-column FK — never references portfolio_strategies(strategy_id) which has a composite PK.';

COMMENT ON COLUMN bridge_outcomes.match_decision_id IS
  'Nullable FK to match_decisions(id) (sent_as_intro row). ON DELETE SET NULL so deleting the intro record does not cascade-delete the outcome (A6).';

COMMENT ON COLUMN bridge_outcomes.kind IS
  'Discriminator: ''allocated'' or ''rejected''. Controls which other fields are required per bridge_outcomes_kind_fields_valid CHECK (D-08).';

COMMENT ON COLUMN bridge_outcomes.percent_allocated IS
  'Required when kind=''allocated''. Percentage of portfolio allocated to this strategy (0.1–50%, D-09). NULL when kind=''rejected''.';

COMMENT ON COLUMN bridge_outcomes.allocated_at IS
  'Required when kind=''allocated''. DATE (not TIMESTAMPTZ) to match returns_series[].date text keys and avoid timezone drift in delta math (RESEARCH Pitfall 2, D-09).';

COMMENT ON COLUMN bridge_outcomes.rejection_reason IS
  'Required when kind=''rejected''. Structured enum via TEXT CHECK for Phase 4 feedback engine attribution (D-10).';

COMMENT ON COLUMN bridge_outcomes.note IS
  'Optional allocator note. Max 2000 chars matching intro.message convention. Visible to admin via admin-read policy.';

COMMENT ON COLUMN bridge_outcomes.delta_30d IS
  'Realized 30-day performance delta vs allocated_at equity. NULL until cron computes (D-12, OUTCOME-06).';

COMMENT ON COLUMN bridge_outcomes.delta_90d IS
  'Realized 90-day performance delta. NULL until cron computes.';

COMMENT ON COLUMN bridge_outcomes.delta_180d IS
  'Realized 180-day performance delta. NULL until cron computes.';

COMMENT ON COLUMN bridge_outcomes.estimated_delta_bps IS
  'Estimated partial-window delta in basis points for the D-12 "Estimated: +X.X% (Nd)" label. NULL until cron computes.';

COMMENT ON COLUMN bridge_outcomes.estimated_days IS
  'Number of days of returns data available since allocated_at (0–180). Determines label tier in D-12 progression.';

COMMENT ON COLUMN bridge_outcomes.deltas_computed_at IS
  'Timestamp when compute_bridge_outcome_deltas() last successfully wrote deltas for this row.';

COMMENT ON COLUMN bridge_outcomes.needs_recompute IS
  'Flag set TRUE on INSERT and on UPDATE when allocated_at, percent_allocated, or kind changes (D-16/D-17). '
  'Cron guard: WHERE delta_30d IS NULL OR needs_recompute = TRUE (D-15, OUTCOME-07). '
  'Cron resets to FALSE after successful per-row compute.';

-- --------------------------------------------------------------------------
-- STEP 2: indexes on bridge_outcomes
-- --------------------------------------------------------------------------
-- Dedupe + UPSERT anchor: enforces one outcome per (allocator, strategy).
-- The ON CONFLICT clause in the POST /api/bridge/outcome route targets this index.
CREATE UNIQUE INDEX IF NOT EXISTS bridge_outcomes_unique_per_strategy
  ON bridge_outcomes (allocator_id, strategy_id);

-- Dashboard query ordering: allows efficient fetch of recent outcomes per allocator.
CREATE INDEX IF NOT EXISTS bridge_outcomes_allocator_recent
  ON bridge_outcomes (allocator_id, created_at DESC);

-- Partial index for cron: scans ONLY dirty rows, keeping the daily job
-- efficient as the table grows (OUTCOME-06 idempotent predicate support).
CREATE INDEX IF NOT EXISTS bridge_outcomes_needs_recompute
  ON bridge_outcomes (needs_recompute)
  WHERE needs_recompute = TRUE;

-- Cron JOIN anchor: compute_bridge_outcome_deltas joins against
-- strategy_analytics.strategy_id — this index covers that join (Plan 01-04).
CREATE INDEX IF NOT EXISTS bridge_outcomes_strategy_id
  ON bridge_outcomes (strategy_id);

-- --------------------------------------------------------------------------
-- STEP 3: updated_at + needs_recompute trigger
-- --------------------------------------------------------------------------
-- Mirrors migration 037's user_notes_set_updated_at trigger.
-- Extension: when UPDATE changes pivot columns (allocated_at, percent_allocated,
-- kind), the trigger also flips needs_recompute=TRUE and nulls out all delta
-- columns so the cron recomputes from scratch (D-16, D-17).
CREATE OR REPLACE FUNCTION bridge_outcomes_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  NEW.updated_at := now();
  IF TG_OP = 'UPDATE' AND (
       NEW.allocated_at       IS DISTINCT FROM OLD.allocated_at
       OR NEW.percent_allocated IS DISTINCT FROM OLD.percent_allocated
       OR NEW.kind              IS DISTINCT FROM OLD.kind
     ) THEN
    NEW.needs_recompute       := TRUE;
    NEW.delta_30d             := NULL;
    NEW.delta_90d             := NULL;
    NEW.delta_180d            := NULL;
    NEW.estimated_delta_bps   := NULL;
    NEW.estimated_days        := NULL;
    NEW.deltas_computed_at    := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bridge_outcomes_set_updated_at_trigger ON bridge_outcomes;
CREATE TRIGGER bridge_outcomes_set_updated_at_trigger
  BEFORE UPDATE ON bridge_outcomes
  FOR EACH ROW
  EXECUTE FUNCTION bridge_outcomes_set_updated_at();

-- --------------------------------------------------------------------------
-- STEP 4: three-tier RLS on bridge_outcomes
-- --------------------------------------------------------------------------
-- Owner-select + owner-insert + owner-update + admin-read.
-- NO DELETE policy — bridge_outcomes is append-only per institutional-audit
-- invariant (see RESEARCH.md §Pattern 1). Corrective records happen via
-- UPSERT on the unique index; the audit trail records both versions.
-- Service-role bypasses RLS implicitly (ADR-0003). OUTCOME-03 satisfied.
ALTER TABLE bridge_outcomes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bridge_outcomes_select_own ON bridge_outcomes;
CREATE POLICY bridge_outcomes_select_own ON bridge_outcomes FOR SELECT
  USING (allocator_id = auth.uid());

DROP POLICY IF EXISTS bridge_outcomes_insert_own ON bridge_outcomes;
CREATE POLICY bridge_outcomes_insert_own ON bridge_outcomes FOR INSERT
  WITH CHECK (allocator_id = auth.uid());

DROP POLICY IF EXISTS bridge_outcomes_update_own ON bridge_outcomes;
CREATE POLICY bridge_outcomes_update_own ON bridge_outcomes FOR UPDATE
  USING  (allocator_id = auth.uid())
  WITH CHECK (allocator_id = auth.uid());

DROP POLICY IF EXISTS bridge_outcomes_admin_read ON bridge_outcomes;
CREATE POLICY bridge_outcomes_admin_read ON bridge_outcomes FOR SELECT
  USING (public.current_user_has_app_role(ARRAY['admin']::text[]));

-- NOTE: No explicit service_role policy — service_role bypasses RLS by default
-- per ADR-0003. No DELETE policy — outcomes are append-only. OUTCOME-03 satisfied.

-- --------------------------------------------------------------------------
-- STEP 5: bridge_outcome_dismissals table
-- --------------------------------------------------------------------------
-- TTL-based server-side snooze (D-05 through D-07).
-- When an allocator clicks [×] on the inline banner, one row is inserted here
-- with expires_at = now() + 24h. The banner eligibility query filters out rows
-- WHERE expires_at > now(). No cron pruning needed — the predicate at query
-- time already skips expired rows (RESEARCH §Don't-Hand-Roll).
CREATE TABLE IF NOT EXISTS bridge_outcome_dismissals (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  allocator_id UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- D-18: dedupe key is strategy_id, not match_candidate_id
  strategy_id  UUID        NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- D-07: 24-hour TTL; banner reappears at next login after expiry
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '24 hours'),
  CONSTRAINT bridge_outcome_dismissals_ttl_valid CHECK (expires_at > dismissed_at)
);

COMMENT ON TABLE bridge_outcome_dismissals IS
  'Server-side TTL dismissals for the Bridge outcome banner. '
  'One row per (allocator_id, strategy_id) — unique index enforces this (D-18). '
  'expires_at = dismissed_at + 24h (D-07). Banner eligibility query uses '
  'WHERE expires_at > now() to skip active dismissals; no purge cron needed.';

COMMENT ON COLUMN bridge_outcome_dismissals.strategy_id IS
  'Dedupe key per D-18: one dismissal per (allocator, strategy). FK to strategies(id), not match_candidate_id.';

COMMENT ON COLUMN bridge_outcome_dismissals.expires_at IS
  '24h TTL from dismissed_at (D-07). Banner query filter: WHERE expires_at > now().';

-- --------------------------------------------------------------------------
-- STEP 6: indexes on bridge_outcome_dismissals
-- --------------------------------------------------------------------------
-- Dedupe: one dismissal per (allocator, strategy).
CREATE UNIQUE INDEX IF NOT EXISTS bridge_outcome_dismissals_unique_per_strategy
  ON bridge_outcome_dismissals (allocator_id, strategy_id);

-- Supports the expires_at > now() predicate in the banner eligibility query.
CREATE INDEX IF NOT EXISTS bridge_outcome_dismissals_expires_at
  ON bridge_outcome_dismissals (expires_at);

-- --------------------------------------------------------------------------
-- STEP 7: three-tier RLS on bridge_outcome_dismissals
-- --------------------------------------------------------------------------
-- Owner-select + owner-insert + owner-delete + admin-read.
-- DELETE IS permitted here (D-06): allocator can clear a dismissal explicitly
-- (e.g., when they record an outcome, the route deletes the active dismissal).
ALTER TABLE bridge_outcome_dismissals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bridge_outcome_dismissals_select_own ON bridge_outcome_dismissals;
CREATE POLICY bridge_outcome_dismissals_select_own ON bridge_outcome_dismissals FOR SELECT
  USING (allocator_id = auth.uid());

DROP POLICY IF EXISTS bridge_outcome_dismissals_insert_own ON bridge_outcome_dismissals;
CREATE POLICY bridge_outcome_dismissals_insert_own ON bridge_outcome_dismissals FOR INSERT
  WITH CHECK (allocator_id = auth.uid());

DROP POLICY IF EXISTS bridge_outcome_dismissals_delete_own ON bridge_outcome_dismissals;
CREATE POLICY bridge_outcome_dismissals_delete_own ON bridge_outcome_dismissals FOR DELETE
  USING (allocator_id = auth.uid());

DROP POLICY IF EXISTS bridge_outcome_dismissals_admin_read ON bridge_outcome_dismissals;
CREATE POLICY bridge_outcome_dismissals_admin_read ON bridge_outcome_dismissals FOR SELECT
  USING (public.current_user_has_app_role(ARRAY['admin']::text[]));

-- --------------------------------------------------------------------------
-- STEP 8: self-verifying DO block
-- --------------------------------------------------------------------------
-- Mirrors migration 037 (lines 115-165) + migration 056 (lines 376-480).
-- Asserts both tables exist, all indexes exist, the trigger exists, RLS is
-- enabled on both tables, and all 8 named policies exist.
-- Any missing artifact raises EXCEPTION → transaction rollback.
DO $$
DECLARE
  v_rls_outcomes      BOOLEAN;
  v_rls_dismissals    BOOLEAN;
BEGIN

  -- ---- bridge_outcomes table ----
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'bridge_outcomes'
  ) THEN
    RAISE EXCEPTION 'Migration 059 failed: bridge_outcomes table missing';
  END IF;

  -- ---- bridge_outcome_dismissals table ----
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'bridge_outcome_dismissals'
  ) THEN
    RAISE EXCEPTION 'Migration 059 failed: bridge_outcome_dismissals table missing';
  END IF;

  -- ---- indexes on bridge_outcomes ----
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'bridge_outcomes_unique_per_strategy') THEN
    RAISE EXCEPTION 'Migration 059 failed: bridge_outcomes_unique_per_strategy index missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'bridge_outcomes_allocator_recent') THEN
    RAISE EXCEPTION 'Migration 059 failed: bridge_outcomes_allocator_recent index missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'bridge_outcomes_needs_recompute') THEN
    RAISE EXCEPTION 'Migration 059 failed: bridge_outcomes_needs_recompute index missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'bridge_outcomes_strategy_id') THEN
    RAISE EXCEPTION 'Migration 059 failed: bridge_outcomes_strategy_id index missing';
  END IF;

  -- ---- indexes on bridge_outcome_dismissals ----
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'bridge_outcome_dismissals_unique_per_strategy') THEN
    RAISE EXCEPTION 'Migration 059 failed: bridge_outcome_dismissals_unique_per_strategy index missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'bridge_outcome_dismissals_expires_at') THEN
    RAISE EXCEPTION 'Migration 059 failed: bridge_outcome_dismissals_expires_at index missing';
  END IF;

  -- ---- trigger on bridge_outcomes ----
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND c.relname = 'bridge_outcomes'
      AND t.tgname = 'bridge_outcomes_set_updated_at_trigger'
      AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'Migration 059 failed: bridge_outcomes_set_updated_at_trigger missing';
  END IF;

  -- ---- RLS enabled on bridge_outcomes ----
  SELECT relrowsecurity INTO v_rls_outcomes
    FROM pg_class
    WHERE relname = 'bridge_outcomes'
      AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
  IF NOT v_rls_outcomes THEN
    RAISE EXCEPTION 'Migration 059 failed: RLS not enabled on bridge_outcomes';
  END IF;

  -- ---- RLS enabled on bridge_outcome_dismissals ----
  SELECT relrowsecurity INTO v_rls_dismissals
    FROM pg_class
    WHERE relname = 'bridge_outcome_dismissals'
      AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
  IF NOT v_rls_dismissals THEN
    RAISE EXCEPTION 'Migration 059 failed: RLS not enabled on bridge_outcome_dismissals';
  END IF;

  -- ---- policies on bridge_outcomes ----
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'bridge_outcomes'
      AND policyname = 'bridge_outcomes_select_own'
  ) THEN
    RAISE EXCEPTION 'Migration 059 failed: bridge_outcomes_select_own policy missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'bridge_outcomes'
      AND policyname = 'bridge_outcomes_insert_own'
  ) THEN
    RAISE EXCEPTION 'Migration 059 failed: bridge_outcomes_insert_own policy missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'bridge_outcomes'
      AND policyname = 'bridge_outcomes_update_own'
  ) THEN
    RAISE EXCEPTION 'Migration 059 failed: bridge_outcomes_update_own policy missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'bridge_outcomes'
      AND policyname = 'bridge_outcomes_admin_read'
  ) THEN
    RAISE EXCEPTION 'Migration 059 failed: bridge_outcomes_admin_read policy missing';
  END IF;

  -- ---- policies on bridge_outcome_dismissals ----
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'bridge_outcome_dismissals'
      AND policyname = 'bridge_outcome_dismissals_select_own'
  ) THEN
    RAISE EXCEPTION 'Migration 059 failed: bridge_outcome_dismissals_select_own policy missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'bridge_outcome_dismissals'
      AND policyname = 'bridge_outcome_dismissals_insert_own'
  ) THEN
    RAISE EXCEPTION 'Migration 059 failed: bridge_outcome_dismissals_insert_own policy missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'bridge_outcome_dismissals'
      AND policyname = 'bridge_outcome_dismissals_delete_own'
  ) THEN
    RAISE EXCEPTION 'Migration 059 failed: bridge_outcome_dismissals_delete_own policy missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'bridge_outcome_dismissals'
      AND policyname = 'bridge_outcome_dismissals_admin_read'
  ) THEN
    RAISE EXCEPTION 'Migration 059 failed: bridge_outcome_dismissals_admin_read policy missing';
  END IF;

  RAISE NOTICE 'Migration 059: bridge_outcomes + bridge_outcome_dismissals installed and verified.';
END
$$;

COMMIT;
