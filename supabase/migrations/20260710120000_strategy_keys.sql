-- Phase 85 (v1.9 multi-key composite strategy): strategy_keys join table.
-- Requirements: COMP-01 (composite member-key persistence) + COMP-04 schema stub.
--
-- PURE ADDITIVE. This migration only CREATEs a new table / new function / new
-- trigger / new policy and ALTER ... ADD COLUMNs a nullable stub. It writes ZERO
-- existing rows, adds NO NOT-NULL / DEFAULT to any existing column, and leaves
-- strategies.api_key_id (the single-key link) UNTOUCHED — every existing
-- single-key strategy resolves its key exactly as today, byte-identically.
--
-- strategy_keys links one strategies row to N api_keys, each member carrying a
-- HALF-OPEN [window_start, window_end) DATE window and a seq ordinal. window_end
-- is EXCLUSIVE (COMP-02); NULL window_end = an open-ended / still-active window.
-- Precedence between members is by seq (Phase 86 overlap resolution) — overlaps
-- are NEVER silently averaged.
--
-- Owner-coherence is DB-enforced (defense-in-depth against BYPASSRLS service-role
-- writes): a SECURITY DEFINER BEFORE trigger asserts
-- owner_id == strategies.user_id == api_keys.user_id. RLS (owner_id = auth.uid())
-- is the load-bearing tenant gate for the authenticated client path.
--
-- No explicit BEGIN/COMMIT — Supabase wraps each migration in an implicit
-- transaction (migration-reviewer invariant #14). SET LOCAL lock_timeout applies
-- to that implicit wrap.

SET LOCAL lock_timeout = '3s';

-- 1. The join table. owner_id is a denormalized RLS gate (mirrors
--    csv_daily_returns.allocator_id) — a JOIN-free predicate that avoids coupling
--    to the strategies table, which is publicly readable when status='published'.
CREATE TABLE public.strategy_keys (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id  UUID NOT NULL REFERENCES public.strategies(id) ON DELETE CASCADE,
  api_key_id   UUID NOT NULL REFERENCES public.api_keys(id)   ON DELETE CASCADE,
  owner_id     UUID NOT NULL REFERENCES auth.users(id)        ON DELETE CASCADE,
  window_start DATE NOT NULL,
  window_end   DATE,
  seq          INTEGER NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- half-open [window_start, window_end): end is EXCLUSIVE, empty interval
  -- forbidden. Strict `>` (a `>=` here would be the off-by-one landmine).
  CONSTRAINT strategy_keys_window_order CHECK (window_end IS NULL OR window_end > window_start),
  CONSTRAINT strategy_keys_seq_nonneg   CHECK (seq >= 0)
);

-- 2. Distinct sequence per strategy (the monotone-sequence contract the wizard
--    validates in Phase 88). A key may legitimately hold two disjoint windows, so
--    NO (strategy_id, api_key_id) uniqueness — only (strategy_id, seq).
CREATE UNIQUE INDEX strategy_keys_strategy_seq_key ON public.strategy_keys (strategy_id, seq);
-- Fast owner-scoped read for the RLS gate.
CREATE INDEX strategy_keys_owner_idx ON public.strategy_keys (owner_id);
-- "members of a strategy, in sequence" reads (Phase 86 stitch).
CREATE INDEX strategy_keys_strategy_idx ON public.strategy_keys (strategy_id, seq);

COMMENT ON COLUMN public.strategy_keys.window_end IS
  'EXCLUSIVE end of the half-open [window_start, window_end) active window '
  '(COMP-02). NULL = open-ended / still-active window with no declared end.';
COMMENT ON COLUMN public.strategy_keys.seq IS
  'Member ordinal within the strategy. Precedence-by-seq ordering drives Phase 86 '
  'overlap resolution — overlaps are resolved by seq, never silently averaged.';

-- 3. Owner-coherence trigger (parity with enforce_csv_daily_returns_owner_coherence).
--    A user cannot attach ANOTHER tenant's api key: the denormalized owner_id MUST
--    equal api_keys.user_id, and the strategy owner MUST equal the api_key owner.
--    Fires for service-role writers too (BYPASSRLS skips RLS, NOT triggers).
CREATE OR REPLACE FUNCTION public.enforce_strategy_keys_owner_coherence()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_key_owner      UUID;
  v_strategy_owner UUID;
BEGIN
  SELECT user_id INTO v_key_owner      FROM api_keys   WHERE id = NEW.api_key_id;
  SELECT user_id INTO v_strategy_owner FROM strategies WHERE id = NEW.strategy_id;
  IF v_key_owner IS NULL THEN
    RAISE EXCEPTION
      'strategy_keys.api_key_id (%) does not reference an existing api_keys row',
      NEW.api_key_id;
  END IF;
  IF v_strategy_owner IS NULL THEN
    RAISE EXCEPTION
      'strategy_keys.strategy_id (%) does not reference an existing strategies row',
      NEW.strategy_id;
  END IF;
  -- Least-disclosure (ADR-0020): this fn is SECURITY DEFINER and reads api_keys /
  -- strategies past their owner-only RLS, so it MUST NOT echo the resolved owner
  -- ids (v_key_owner / v_strategy_owner) into the client-facing error — that would
  -- turn a failed INSERT into a per-tenant ownership-disclosure + existence oracle.
  -- Only caller-supplied NEW.* values may appear; keep the '%must match%' and
  -- '%cross-tenant%' arms distinct (pinned by test_strategy_keys_rls.sql).
  IF NEW.owner_id IS DISTINCT FROM v_key_owner THEN
    RAISE EXCEPTION
      'strategy_keys.owner_id (%) must match the owner of api_key_id %',
      NEW.owner_id, NEW.api_key_id;
  END IF;
  IF v_strategy_owner IS DISTINCT FROM v_key_owner THEN
    RAISE EXCEPTION
      'strategy_keys: strategy owner must match api_key owner — cross-tenant attach blocked';
  END IF;
  RETURN NEW;
END;
$function$;

-- Trigger function: never invocable via PostgREST RPC. Revoke from the API
-- roles too (not just PUBLIC) — matches the tenant-check trigger convention
-- (check_strategy_api_key_ownership, guard_wizard_draft_updates) and clears the
-- anon/authenticated SECURITY DEFINER-executable advisor.
REVOKE ALL ON FUNCTION public.enforce_strategy_keys_owner_coherence() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER strategy_keys_owner_coherence
  BEFORE INSERT OR UPDATE ON public.strategy_keys
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_strategy_keys_owner_coherence();

-- 4. RLS: owner-only access (parity with scenarios_owner). Both USING and
--    WITH CHECK keyed on the denormalized owner_id; TO authenticated; and REVOKE
--    all default grants from anon so anon is blocked at BOTH the grant and RLS
--    layers. Composite membership is private per-tenant data.
ALTER TABLE public.strategy_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY strategy_keys_owner ON public.strategy_keys
  FOR ALL
  TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

REVOKE ALL ON public.strategy_keys FROM anon;

-- 5. COMP-04 stub: additive NULLABLE per-basis metrics column on strategy_analytics.
--    No DEFAULT, no backfill, NO SET NOT NULL (a 23502 timebomb on existing rows).
--    NULL for every existing row; Phase 86 populates it at derive time.
ALTER TABLE public.strategy_analytics
  ADD COLUMN IF NOT EXISTS metrics_json_by_basis jsonb;

-- Additive-safe shape guard: NULL passes; a non-NULL value must be a JSON object.
ALTER TABLE public.strategy_analytics
  ADD CONSTRAINT strategy_analytics_metrics_by_basis_shape
  CHECK (metrics_json_by_basis IS NULL OR jsonb_typeof(metrics_json_by_basis) = 'object');

COMMENT ON COLUMN public.strategy_analytics.metrics_json_by_basis IS
  'NULLABLE stub for COMP-04 (Phase 86): per-basis metrics object keyed '
  'cash_settlement / mark_to_market. NULL for all existing rows (no backfill). '
  'Populated at derive time in Phase 86.';

-- 6. Self-verifying DO block — fail loud at apply if any structural element drifted.
DO $$
BEGIN
  -- (a) table exists
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'strategy_keys') THEN
    RAISE EXCEPTION 'strategy_keys table missing after migration';
  END IF;

  -- (b) all 8 columns exist with correct nullability
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'strategy_keys') <> 8 THEN
    RAISE EXCEPTION 'strategy_keys does not have exactly 8 columns after migration';
  END IF;
  IF (SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'strategy_keys' AND column_name = 'strategy_id') <> 'NO' THEN
    RAISE EXCEPTION 'strategy_keys.strategy_id must be NOT NULL';
  END IF;
  IF (SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'strategy_keys' AND column_name = 'api_key_id') <> 'NO' THEN
    RAISE EXCEPTION 'strategy_keys.api_key_id must be NOT NULL';
  END IF;
  IF (SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'strategy_keys' AND column_name = 'owner_id') <> 'NO' THEN
    RAISE EXCEPTION 'strategy_keys.owner_id must be NOT NULL';
  END IF;
  IF (SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'strategy_keys' AND column_name = 'window_start') <> 'NO' THEN
    RAISE EXCEPTION 'strategy_keys.window_start must be NOT NULL';
  END IF;
  IF (SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'strategy_keys' AND column_name = 'seq') <> 'NO' THEN
    RAISE EXCEPTION 'strategy_keys.seq must be NOT NULL';
  END IF;
  IF (SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'strategy_keys' AND column_name = 'window_end') <> 'YES' THEN
    RAISE EXCEPTION 'strategy_keys.window_end must be NULLABLE';
  END IF;

  -- (c) unique index on (strategy_id, seq) exists and is unique
  IF NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                 WHERE c.relname = 'strategy_keys_strategy_seq_key' AND i.indisunique) THEN
    RAISE EXCEPTION 'unique index strategy_keys_strategy_seq_key missing or not unique';
  END IF;

  -- (d) RLS policy exists
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'strategy_keys_owner'
                 AND polrelid = 'public.strategy_keys'::regclass) THEN
    RAISE EXCEPTION 'RLS policy strategy_keys_owner missing';
  END IF;

  -- (e) owner-coherence trigger exists
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'strategy_keys_owner_coherence'
                 AND tgrelid = 'public.strategy_keys'::regclass AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'owner-coherence trigger strategy_keys_owner_coherence missing';
  END IF;

  -- (f) COMP-04 stub column exists and is nullable
  IF (SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'strategy_analytics'
        AND column_name = 'metrics_json_by_basis') <> 'YES' THEN
    RAISE EXCEPTION 'strategy_analytics.metrics_json_by_basis missing or not nullable';
  END IF;

  -- (g) zero-disturbance: no existing row was backfilled
  IF EXISTS (SELECT 1 FROM public.strategy_analytics WHERE metrics_json_by_basis IS NOT NULL) THEN
    RAISE EXCEPTION 'strategy_analytics.metrics_json_by_basis is non-NULL on an existing row — unexpected backfill';
  END IF;

  -- (h) all pass
  RAISE NOTICE 'strategy_keys migration self-check passed (table + trigger + RLS + stub column intact, zero disturbance).';
END $$;
