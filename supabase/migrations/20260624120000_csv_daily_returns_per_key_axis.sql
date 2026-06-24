-- Phase 35 (v1.2.1 scenario-tab-hardening): add a per-key axis to csv_daily_returns
-- so exchange API keys can carry their own daily-returns series (allocator per-key
-- dailies), resolving the strategy_id NOT NULL FK blocker WITHOUT synthetic strategy rows.
--
-- User decision 2026-06-24: ALTER the existing table (not a new dedicated table).
-- Annualization stays 252 (Phase 34); "365" elsewhere in this milestone is calendar
-- DENSITY only, not the annualization multiplier.
--
-- Strategy-scoped rows (the existing CSV-strategy dailies) are byte-unchanged: strategy_id
-- still drives the (strategy_id, date) uniqueness that persist_csv_daily_returns and the
-- worker upsert (on_conflict=strategy_id,date) and the paginated CSV reader depend on.
-- The recreated unique index is NON-partial on purpose: a partial unique index would raise
-- 42P10 on a bare ON CONFLICT (strategy_id, date). PG17 treats NULLs as DISTINCT by default,
-- so per-key rows (strategy_id NULL) never collide on the strategy index and strategy rows
-- (api_key_id NULL) never collide on the api_key index — each index enforces only its own
-- row-type. (Live shape verified against prod: 2185 rows, no triggers, no dependent views,
-- one SECDEF consumer `persist_csv_daily_returns` whose ON CONFLICT survives.)

BEGIN;

SET LOCAL lock_timeout = '3s';

-- 1. Drop the composite PK (strategy_id, date) — PK columns must be NOT NULL, and
--    strategy_id must become nullable for per-key rows.
ALTER TABLE public.csv_daily_returns DROP CONSTRAINT csv_daily_returns_pkey;

-- 2. strategy_id becomes nullable (per-key rows have no strategy).
ALTER TABLE public.csv_daily_returns ALTER COLUMN strategy_id DROP NOT NULL;

-- 3. Surrogate PK — the table no longer has a single natural key spanning both row-types.
--    Table is small (2185 rows) so the IDENTITY backfill rewrite is trivial.
ALTER TABLE public.csv_daily_returns ADD COLUMN id BIGINT GENERATED ALWAYS AS IDENTITY;
ALTER TABLE public.csv_daily_returns ADD CONSTRAINT csv_daily_returns_pkey PRIMARY KEY (id);

-- 4. Per-key axis: api_key_id (the key whose realized+funding dailies these are) and a
--    denormalized allocator_id (= api_keys.user_id at derive time) for a fast RLS owner gate,
--    mirroring allocator_holdings / allocator_equity_snapshots.
ALTER TABLE public.csv_daily_returns
  ADD COLUMN api_key_id   UUID REFERENCES public.api_keys(id) ON DELETE CASCADE,
  ADD COLUMN allocator_id UUID REFERENCES auth.users(id)      ON DELETE CASCADE;

-- 5. A row is EITHER a strategy daily OR a per-key daily — never both, never neither.
ALTER TABLE public.csv_daily_returns
  ADD CONSTRAINT csv_daily_returns_source_xor
  CHECK (num_nonnulls(strategy_id, api_key_id) = 1);

-- 6. Per-key rows MUST carry their owning allocator (required by the RLS owner policy).
ALTER TABLE public.csv_daily_returns
  ADD CONSTRAINT csv_daily_returns_per_key_allocator
  CHECK (api_key_id IS NULL OR allocator_id IS NOT NULL);

-- 7. Recreate the (strategy_id, date) uniqueness the CSV pipeline + paginated reader rely on.
--    NON-partial + NULLs-distinct: per-key rows do not collide here; the existing
--    on_conflict=strategy_id,date upsert still resolves to this index.
CREATE UNIQUE INDEX csv_daily_returns_strategy_date_key
  ON public.csv_daily_returns (strategy_id, date);

-- 8. Per-key uniqueness: one row per (api_key_id, date). NON-partial + NULLs-distinct:
--    strategy rows do not collide here; the per-key upsert uses on_conflict=api_key_id,date.
CREATE UNIQUE INDEX csv_daily_returns_api_key_date_key
  ON public.csv_daily_returns (api_key_id, date);

-- 9. RLS: add a per-key owner SELECT policy mirroring allocator_holdings. The existing
--    strategy-owner / admin / service-role policies are LEFT UNTOUCHED. Strategy rows have
--    NULL allocator_id (never match this new policy); per-key rows have NULL strategy_id
--    (never match the strategy-owner policy). Worker writes bypass RLS via the service role.
CREATE POLICY csv_daily_returns_allocator_owner_select
  ON public.csv_daily_returns
  FOR SELECT
  TO authenticated
  USING (allocator_id = auth.uid());

-- 9b. Owner-coherence trigger — parity with allocator_holdings
--     (enforce_allocator_holdings_owner_coherence). DB-enforced defense-in-depth on the
--     tenant-isolation column: a per-key row's denormalized allocator_id MUST equal the
--     owning api_keys.user_id, so a buggy writer or a future api_keys.user_id reassignment
--     can never fork a per-key series under a stale allocator_id. The WHEN clause fires the
--     trigger ONLY for per-key rows (api_key_id IS NOT NULL) — the high-frequency strategy
--     CSV path pays zero trigger overhead.
CREATE OR REPLACE FUNCTION public.enforce_csv_daily_returns_owner_coherence()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_expected_owner UUID;
BEGIN
  -- Defensive (the trigger WHEN clause already gates on this): strategy rows are exempt.
  IF NEW.api_key_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT user_id INTO v_expected_owner
    FROM api_keys
    WHERE id = NEW.api_key_id;
  IF v_expected_owner IS NULL THEN
    RAISE EXCEPTION
      'csv_daily_returns.api_key_id (%) does not reference an existing api_keys row',
      NEW.api_key_id;
  END IF;
  IF NEW.allocator_id IS DISTINCT FROM v_expected_owner THEN
    RAISE EXCEPTION
      'csv_daily_returns.allocator_id (%) must match api_keys.user_id (%) for api_key_id %',
      NEW.allocator_id, v_expected_owner, NEW.api_key_id;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_csv_daily_returns_owner_coherence() FROM PUBLIC;

CREATE TRIGGER csv_daily_returns_owner_coherence
  BEFORE INSERT OR UPDATE ON public.csv_daily_returns
  FOR EACH ROW
  WHEN (NEW.api_key_id IS NOT NULL)
  EXECUTE FUNCTION public.enforce_csv_daily_returns_owner_coherence();

-- 10. Self-verifying DO block — fail loud if any structural element drifted.
DO $$
BEGIN
  IF (SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'csv_daily_returns'
        AND column_name = 'strategy_id') <> 'YES' THEN
    RAISE EXCEPTION 'csv_daily_returns.strategy_id is not nullable after migration';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'csv_daily_returns_pkey'
                   AND conrelid = 'public.csv_daily_returns'::regclass
                   AND pg_get_constraintdef(oid) = 'PRIMARY KEY (id)') THEN
    RAISE EXCEPTION 'csv_daily_returns surrogate PRIMARY KEY (id) missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'csv_daily_returns' AND column_name = 'api_key_id') THEN
    RAISE EXCEPTION 'csv_daily_returns.api_key_id column missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'csv_daily_returns' AND column_name = 'allocator_id') THEN
    RAISE EXCEPTION 'csv_daily_returns.allocator_id column missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'csv_daily_returns_source_xor'
                 AND conrelid = 'public.csv_daily_returns'::regclass) THEN
    RAISE EXCEPTION 'csv_daily_returns_source_xor check missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'csv_daily_returns_per_key_allocator'
                 AND conrelid = 'public.csv_daily_returns'::regclass) THEN
    RAISE EXCEPTION 'csv_daily_returns_per_key_allocator check missing';
  END IF;

  -- Both unique indexes must exist and be NON-partial (indpred IS NULL).
  IF (SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
      WHERE c.relname IN ('csv_daily_returns_strategy_date_key', 'csv_daily_returns_api_key_date_key')
        AND i.indisunique AND i.indpred IS NULL) <> 2 THEN
    RAISE EXCEPTION 'expected 2 NON-partial unique indexes (strategy_date + api_key_date)';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'csv_daily_returns_allocator_owner_select'
                 AND polrelid = 'public.csv_daily_returns'::regclass) THEN
    RAISE EXCEPTION 'per-key owner RLS policy missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'csv_daily_returns_owner_coherence'
                 AND tgrelid = 'public.csv_daily_returns'::regclass AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'owner-coherence trigger missing';
  END IF;

  -- Every existing row must still satisfy the XOR (strategy_id set, api_key_id null).
  IF EXISTS (SELECT 1 FROM public.csv_daily_returns WHERE num_nonnulls(strategy_id, api_key_id) <> 1) THEN
    RAISE EXCEPTION 'existing csv_daily_returns rows violate source_xor after migration';
  END IF;
END $$;

COMMIT;
