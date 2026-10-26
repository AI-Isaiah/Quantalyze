-- ============================================================================
-- api_key_nav_marks: one marked-to-market NAV per key per UTC day, write-once
-- (2026-10-26, Phase 167.2.1.1.1 NAVMTM, plan 01; SC-1, SC-2, D-01, D-06, D-07,
-- D-11)
-- ============================================================================
--
-- What this is for
-- ----------------
-- No row today holds one key's NAV INCLUDING open profit for one day. The derive
-- keeps only the latest anchor per key and overwrites it, and the stored daily
-- returns are realized-basis. From the day NAVMTM deploys, every daily ingest
-- stores that figure here, together with the open profit itself and the exact
-- time it was read, and the derived curve and the strategy return series are
-- built on these marks from that day on. THIS migration is the storage half only:
-- the table, its access rules and its integrity checks. Nothing writes to it yet.
--
--   D-01  A new append-only table: one row per key per day holding NAV, open
--         profit, mark time, venue and owner. It is read by its owner only.
--   D-06  Write-once. The first writer of a day wins; rebuilds read marks and
--         never replace them. Key deletion follows the existing key-delete
--         cascade (both foreign keys below cascade).
--   D-07  Store the native amount and unit, the USD figure, and the close day
--         used to price it. The pricing rule itself stays with MARKSOURCE.
--   D-11  A run that writes the mark later the same UTC day (a retry at 05:00Z)
--         still writes it; marked_at records the real time.
--
-- Decisions inside D-01, D-06 and D-07 (Claude's discretion, plan 01)
--   NM-1  Columns. A surrogate identity key keeps the GDPR export's ORDER BY
--         fallback to id valid. api_key_id and allocator_id are NOT NULL and both
--         cascade. venue is a closed set. nav_usd and open_pnl_usd are NUMERIC
--         (dollars, reviewer invariant 7) and refuse NaN and the infinities.
--         marked_at is OUR fetch instant, not the venue's timestamp.
--   NM-2  Native semantics. A USD-family read (OKX, Bybit, Binance, sFOX, a
--         USD-unit MT5 account) stores native_unit 'USD' with the native amounts
--         equal to the USD ones and price_day NULL. A BTC-unit MT5 account stores
--         native_unit 'BTC', the native amounts and the close day used to price
--         them. Deribit is multi-currency, so one native number and one unit do
--         not exist: it stores native_unit, nav_native and open_pnl_native NULL
--         and a native_detail object (per-currency native equity and open profit
--         plus the usd_basis of the USD figures); see the column COMMENT.
--   NM-3  An index on (allocator_id, mark_day) serves the owner read; the unique
--         key serves the per-key reads.
--
-- THE LABEL (D-03 / D-11). mark_day labels the UTC day that just closed, and it is
-- a function of the read instant: (marked_at AT TIME ZONE 'UTC')::date - 1. So a
-- read at 00:10Z on the 2nd labels the 1st, and a retry any time later on the
-- 2nd still does. There is no time-of-day window; a row labelled any other day
-- is refused by the CHECK, so a drifted read can never be stored under the wrong
-- day. Rows are read in UTC whatever the session time zone.
--
-- ⛔ WRITE-ONCE IS A GRANT, NOT A POLICY. service_role has BYPASSRLS, so neither
-- ENABLE nor FORCE ROW LEVEL SECURITY can make this table append-only for the
-- worker, which is the only writer (ADR-0001 / ADR-0003: the service_role trust
-- boundary is a role attribute, and a policy cannot gate it). The control is the
-- table privilege: service_role holds SELECT and INSERT only, and UPDATE, DELETE
-- and TRUNCATE are revoked (the audit_log_hardening precedent). The first-writer
-- key is UNIQUE (api_key_id, mark_day); the worker writes ON CONFLICT DO NOTHING,
-- which needs INSERT alone. Key and account deletion still erase the marks: a
-- foreign-key cascade runs with the privileges of the table owner, not of the
-- caller, so withdrawing DELETE from service_role does not block it. The SQL gate
-- proves exactly that (arms 6 and 7); it is not assumed.
--
-- ⛔ NO DATA CENSUS RUNS INSIDE THIS MIGRATION. Shared TEST holds PROD's catalogue
-- and none of its data, and a failed TEST apply blocks the PROD apply, so the
-- verify block below reads the catalogue only (pg_class, pg_constraint,
-- pg_trigger, pg_proc). It reads no table row. [164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]
--
-- ⛔ DEPLOY ORDER. Merging supabase/migrations/** applies to TEST and then to PROD
-- with no human stop, BEFORE the worker that writes this table deploys. An old
-- worker never touches the table, so the order is safe. Marks start at deploy
-- (D-09): nothing is backfilled here and nothing may be read from position
-- history to invent an earlier mark.
--
-- Transaction style: NO explicit transaction statements (migration-reviewer
-- invariant 14; Supabase wraps each migration). SET LOCAL lock_timeout applies to
-- that wrap.
--
-- Rollback (manual, off the auto-apply path; it KEEPS every stored mark):
-- supabase/migrations/down/20261029120000-rollback.sql
-- ============================================================================

SET LOCAL lock_timeout = '3s';

-- --------------------------------------------------------------------------
-- STEP 1 - the table.
-- --------------------------------------------------------------------------
CREATE TABLE public.api_key_nav_marks (
  id               BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  api_key_id       UUID        NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
  allocator_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mark_day         DATE        NOT NULL,
  marked_at        TIMESTAMPTZ NOT NULL,
  venue            TEXT        NOT NULL,
  nav_usd          NUMERIC     NOT NULL,
  open_pnl_usd     NUMERIC     NOT NULL,
  nav_native       NUMERIC,
  open_pnl_native  NUMERIC,
  native_unit      TEXT,
  price_day        DATE,
  native_detail    JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT api_key_nav_marks_key_day_key
    UNIQUE (api_key_id, mark_day),
  CONSTRAINT api_key_nav_marks_label_chk
    CHECK (mark_day = (marked_at AT TIME ZONE 'UTC')::date - 1),
  CONSTRAINT api_key_nav_marks_venue_chk
    CHECK (venue IN ('okx', 'bybit', 'binance', 'deribit', 'mt5', 'sfox')),
  CONSTRAINT api_key_nav_marks_amounts_finite_chk
    CHECK (nav_usd NOT IN ('NaN', 'Infinity', '-Infinity')
       AND open_pnl_usd NOT IN ('NaN', 'Infinity', '-Infinity')
       AND (nav_native IS NULL OR nav_native NOT IN ('NaN', 'Infinity', '-Infinity'))
       AND (open_pnl_native IS NULL OR open_pnl_native NOT IN ('NaN', 'Infinity', '-Infinity'))),
  CONSTRAINT api_key_nav_marks_native_scalars_chk
    CHECK ((nav_native IS NULL) = (open_pnl_native IS NULL)
       AND (nav_native IS NULL) = (native_unit IS NULL)),
  CONSTRAINT api_key_nav_marks_native_unit_chk
    CHECK (native_unit IS NULL OR native_unit ~ '^[A-Z]{2,10}$'),
  CONSTRAINT api_key_nav_marks_price_day_chk
    CHECK (price_day IS NULL OR native_unit IS NOT NULL),
  CONSTRAINT api_key_nav_marks_native_detail_object_chk
    CHECK (native_detail IS NULL OR jsonb_typeof(native_detail) = 'object'),
  CONSTRAINT api_key_nav_marks_native_basis_chk
    CHECK (native_unit IS NOT NULL OR native_detail IS NOT NULL)
);

CREATE INDEX api_key_nav_marks_allocator_day_idx
  ON public.api_key_nav_marks (allocator_id, mark_day);

COMMENT ON TABLE public.api_key_nav_marks IS
  'Phase 167.2.1.1.1 NAVMTM (D-01, D-06, D-07, D-11). One row per API key per UTC day: that key''s marked-to-market NAV (equity INCLUDING open profit), the open profit itself, the exact read time, the venue and the owner. WRITE-ONCE: the first writer of a day wins (UNIQUE (api_key_id, mark_day), the worker writes ON CONFLICT DO NOTHING), and service_role holds SELECT and INSERT only, so a stored mark can never be changed or removed by the worker; key and account deletion still erase it through ON DELETE CASCADE. mark_day labels the UTC day that just closed: it equals (marked_at AT TIME ZONE ''UTC'')::date - 1, so a read any time on the following UTC day carries the same label. Owner-read-only through RLS. Marks start at deploy; nothing is backfilled (D-09).';

COMMENT ON COLUMN public.api_key_nav_marks.allocator_id IS
  'Owning allocator (= api_keys.user_id, enforced by the owner-coherence trigger). ON DELETE CASCADE from auth.users IS the GDPR sanitize path: do NOT add a delete-guard trigger. If one is ever added it MUST exempt current_setting(''quantalyze.sanitize_in_progress'', true) = ''on'' or it aborts account deletion.';

COMMENT ON COLUMN public.api_key_nav_marks.mark_day IS
  'The UTC day this mark closes (D-03): (marked_at AT TIME ZONE ''UTC'')::date - 1, enforced by api_key_nav_marks_label_chk.';

COMMENT ON COLUMN public.api_key_nav_marks.marked_at IS
  'The instant OUR worker read the equity (not the venue''s timestamp). A retry later the same UTC day records its real time (D-11).';

COMMENT ON COLUMN public.api_key_nav_marks.nav_usd IS
  'Marked-to-market NAV in USD, INCLUDING open profit.';

COMMENT ON COLUMN public.api_key_nav_marks.open_pnl_usd IS
  'Unrealized (open) profit in USD at the read; nav_usd minus open_pnl_usd is the realized-basis balance.';

COMMENT ON COLUMN public.api_key_nav_marks.native_unit IS
  'D-07 native unit of nav_native and open_pnl_native: ''USD'' for a USD-family read, ''BTC'' for a BTC-unit MT5 account; NULL for Deribit, whose figures are per currency in native_detail.';

COMMENT ON COLUMN public.api_key_nav_marks.price_day IS
  'D-07 the close day used to price a native amount into nav_usd; NULL when the native unit is USD and for Deribit, which is priced at its own index and no daily close.';

COMMENT ON COLUMN public.api_key_nav_marks.native_detail IS
  'D-07 multi-currency detail for Deribit: a JSON object with the native equity and open profit per currency, plus usd_basis = ''venue_index_at_marked_at'', the pricing basis of nav_usd and open_pnl_usd (each currency''s native amount priced at Deribit''s own index read at marked_at, no daily close, so price_day stays NULL). NULL for single-unit venues. Must be a JSON object.';

-- --------------------------------------------------------------------------
-- STEP 2 - owner coherence. A mark's denormalized allocator_id MUST equal the
-- owning api_keys.user_id, so a buggy writer or a later reassignment of the key
-- can never expose one user's NAV to another. Copy of
-- enforce_csv_daily_returns_owner_coherence (20260624120000), with this table's
-- name in every message; messages carry ids only, never an amount. The function
-- is SECURITY DEFINER because it must read api_keys regardless of the caller, and
-- pins search_path to public, pg_catalog (reviewer invariant 3). EXECUTE is
-- withdrawn from PUBLIC exactly as the csv precedent does and from nobody else:
-- the roles whose DML fires the trigger keep it (reviewer invariant 17).
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_api_key_nav_marks_owner_coherence()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_expected_owner UUID;
BEGIN
  SELECT user_id INTO v_expected_owner
    FROM public.api_keys
    WHERE id = NEW.api_key_id;
  IF v_expected_owner IS NULL THEN
    RAISE EXCEPTION
      'api_key_nav_marks.api_key_id (%) does not reference an existing api_keys row',
      NEW.api_key_id;
  END IF;
  IF NEW.allocator_id IS DISTINCT FROM v_expected_owner THEN
    RAISE EXCEPTION
      'api_key_nav_marks.allocator_id (%) must match api_keys.user_id (%) for api_key_id %',
      NEW.allocator_id, v_expected_owner, NEW.api_key_id;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_api_key_nav_marks_owner_coherence() FROM PUBLIC;

CREATE TRIGGER api_key_nav_marks_owner_coherence
  BEFORE INSERT OR UPDATE ON public.api_key_nav_marks
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_api_key_nav_marks_owner_coherence();

-- --------------------------------------------------------------------------
-- STEP 3 - row level security. Owner SELECT only; no anon policy; and no
-- authenticated write policy, ON PURPOSE (see the policy COMMENT). service_role
-- bypasses RLS by attribute and is bounded by the grants in STEP 4.
-- --------------------------------------------------------------------------
ALTER TABLE public.api_key_nav_marks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_key_nav_marks FORCE ROW LEVEL SECURITY;

CREATE POLICY api_key_nav_marks_owner_select ON public.api_key_nav_marks
  FOR SELECT
  TO authenticated
  USING (allocator_id = auth.uid());

COMMENT ON POLICY api_key_nav_marks_owner_select ON public.api_key_nav_marks IS
  'Owner-only SELECT: an authenticated user reads only its own marks. There is NO INSERT, UPDATE or DELETE policy for authenticated, and no policy for anon, BY DESIGN: the analytics worker is the sole producer through service_role, and the table privileges below withhold every write from every other role. Phase 167.2.1.1.1 / T-167.2.1.1.1-02.';

-- --------------------------------------------------------------------------
-- STEP 4 - grants. REVOKE everything first so the result does not depend on the
-- project's default privileges, then grant exactly what each role needs.
-- --------------------------------------------------------------------------
REVOKE ALL ON TABLE public.api_key_nav_marks FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.api_key_nav_marks TO authenticated;
GRANT SELECT, INSERT ON public.api_key_nav_marks TO service_role;

-- ───────────── self-verify: CATALOGUE ONLY, passes on an empty database.
-- No row is read. Deliberately NOT asserted here: the grants, the policy, the
-- foreign keys' delete actions, the CHECK bodies and the row-level security flags.
-- A verify block that checked them would abort the apply of a mutated copy of
-- this file, and the SQL gate that mutates those lines needs that apply to
-- succeed in order to go RED on the behaviour instead.
DO $verify$
DECLARE
  v_secdef boolean;
  v_cfg    text[];
BEGIN
  IF to_regclass('public.api_key_nav_marks') IS NULL THEN
    RAISE EXCEPTION 'Migration 20261029120000 failed: public.api_key_nav_marks is missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'api_key_nav_marks_key_day_key'
                    AND conrelid = 'public.api_key_nav_marks'::regclass
                    AND contype = 'u') THEN
    RAISE EXCEPTION 'Migration 20261029120000 failed: the first-writer unique key api_key_nav_marks_key_day_key is missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname = 'api_key_nav_marks_owner_coherence'
                    AND tgrelid = 'public.api_key_nav_marks'::regclass
                    AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'Migration 20261029120000 failed: the owner-coherence trigger api_key_nav_marks_owner_coherence is missing';
  END IF;

  SELECT p.prosecdef, p.proconfig INTO v_secdef, v_cfg
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'enforce_api_key_nav_marks_owner_coherence';
  IF v_secdef IS NOT TRUE THEN
    RAISE EXCEPTION 'Migration 20261029120000 failed: enforce_api_key_nav_marks_owner_coherence must be SECURITY DEFINER';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM unnest(COALESCE(v_cfg, ARRAY[]::text[])) c
                  WHERE regexp_replace(c, '\s', '', 'g') = 'search_path=public,pg_catalog') THEN
    RAISE EXCEPTION 'Migration 20261029120000 failed: enforce_api_key_nav_marks_owner_coherence does not pin search_path to public, pg_catalog';
  END IF;

  RAISE NOTICE 'Migration 20261029120000: public.api_key_nav_marks exists with its first-writer unique key and its owner-coherence trigger; the trigger function is SECURITY DEFINER with search_path public, pg_catalog.';
END
$verify$;
