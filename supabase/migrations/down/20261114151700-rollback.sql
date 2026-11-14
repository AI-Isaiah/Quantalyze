-- ============================================================================
-- ROLLBACK for 20261114151700_ledger_staleness_closed_composites.sql
-- Phase 214 FRESHTRUTH, plan 02 (SC-3).
-- ============================================================================
-- Manual, off the auto-apply path: CI does not apply rollbacks, and nothing runs
-- this file unless a person does, after the marker query in CLAUDE.md has named
-- the database.
--
-- WHAT IT UNDOES. It restores public.ledger_refresh_staleness to the 11-column
-- view that 20260825120000_ledger_refresh_staleness_view.sql defined: the body is
-- that migration's CREATE statement verbatim, with its COMMENTs. A composite whose
-- member windows have all closed reads `series_behind` and stale again, and the
-- is_closed and closed_through columns are gone.
--
-- WHY IT IS A DROP AND A CREATE, NOT A CREATE OR REPLACE. CREATE OR REPLACE VIEW
-- can only APPEND columns. Restoring the 11-column view over the 13-column one
-- would error ("cannot drop columns from view"), so the view is dropped and
-- created again. Nothing depends on the view by OBJECT: the staleness gate and the
-- two fan-outs read it by name from inside plpgsql bodies, which Postgres
-- re-resolves at the next call, so the DROP needs no CASCADE and no caller change
-- first. The one cost is the window between the DROP and the CREATE, which is a
-- single transaction under a 3 s lock_timeout, so no reader sees the view missing.
--
-- WHY THE OPTIONS AND THE ACL ARE RESTATED. DROP VIEW takes the view's reloptions
-- and its ACL with it, and CREATE VIEW starts from the schema's default
-- privileges, which in this project grant new relations to anon and authenticated.
-- So `security_invoker = true`, the REVOKE and the GRANT are spelled again and the
-- DO block at the end asserts all three from the catalogue alone.
--
-- WHAT IT DELIBERATELY KEEPS. public.ledger_refresh_parse_series_date is untouched
-- (20261114151700 never redefined it), and so is every row in every table.
--
-- WHAT ROLLING BACK COSTS. The two composites that closed in April go back to
-- reading stale (`series_behind`), and the composite fan-out sees them as
-- candidates again whenever it is run; it stays unscheduled either way. No data
-- changes.
--
-- THE MIGRATION LEDGER ROW IS LEFT IN PLACE. This file does not touch
-- supabase_migrations.schema_migrations, so after it runs the ledger still records
-- version 20261114151700 as applied while the view is the old one. `supabase db
-- push` will therefore NOT re-apply the migration. To re-apply it, mark the version
-- reverted with `supabase migration repair --status reverted 20261114151700`
-- against the intended database, after the marker query in CLAUDE.md names that
-- database. Until then VAC-08's ledger check reports the version as present, which
-- is true of the ledger and false of the view.
-- ============================================================================

BEGIN;

SET lock_timeout = '3s';

DROP VIEW public.ledger_refresh_staleness;

CREATE VIEW public.ledger_refresh_staleness
WITH (security_invoker = true) AS
WITH ledger_venue_set AS (
  -- ⛔ D-05: the SINGLE SQL home of the ledger venue set. Mirrors
  -- `_LEDGER_BACKED_SOURCES` at analytics-service/services/ingestion/long_fetch.py:63.
  -- Plan 05's static drift gate fails CI if these diverge. Do NOT re-declare
  -- these venues anywhere else in SQL — plan 02's fan-out reads this view.
  --
  -- WR-02: `deferred_venues` is the SUBSET of that set whose composites the
  -- 20260825140000 arm must not enqueue (founder: "on mt5 no composites" — one
  -- shared terminal registry, analytics-service/services/mt5_concurrency.py).
  -- It is declared HERE, beside the set it has to be drawn FROM, so that
  -- `has_mt5_member` below spells no venue of its own, and STEP 3 check 6
  -- asserts the subset relation against the definition Postgres actually
  -- installed. Before that, this was the one hand-typed venue name in the phase
  -- that nothing compared against anything: a rename of the venue token would
  -- have left `has_mt5_member` silently FALSE for every affected row and turned
  -- the composite exclusion into a no-op.
  SELECT ARRAY['deribit', 'sfox', 'mt5']::TEXT[] AS venues,
         ARRAY['mt5']::TEXT[]                    AS deferred_venues
),
strategy_venue AS (
  -- D-06: union BOTH link shapes. `api_key_id` catches single-key strategies;
  -- `strategy_keys` catches composites, whose `api_key_id` is NULL.
  SELECT
    s.id AS strategy_id,
    EXISTS (
      SELECT 1 FROM public.strategy_keys sk WHERE sk.strategy_id = s.id
    ) AS is_composite,
    ARRAY(
      SELECT DISTINCT v.exchange
        FROM (
          SELECT ak.exchange
            FROM public.api_keys ak
           WHERE ak.id = s.api_key_id
          UNION ALL
          SELECT ak_m.exchange
            FROM public.strategy_keys sk_m
            JOIN public.api_keys ak_m ON ak_m.id = sk_m.api_key_id
           WHERE sk_m.strategy_id = s.id
        ) AS v
       WHERE v.exchange IS NOT NULL
       ORDER BY 1
    ) AS exchanges
  FROM public.strategies s
)
SELECT
  sv.strategy_id,
  sv.is_composite,
  sv.exchanges,
  (sv.exchanges && lv.deferred_venues)    AS has_mt5_member,
  sa.computation_status,
  sa.computed_at                          AS analytics_computed_at,
  sas.computed_at                         AS series_written_at,
  lr.last_return_date,
  (CURRENT_DATE - lr.last_return_date)    AS days_since_last_return,
  -- >>> LEDGER_REFRESH_VERDICT_BEGIN
  -- ⛔ Everything between these two markers is the freshness VERDICT. Plan 05's
  -- static gate scopes its negative assertions to exactly this region — the two
  -- rejected timestamps are legitimately SELECTed above as documented
  -- informational columns, so a whole-file grep would be a false positive. No
  -- write timestamp of any kind may appear below until the END marker.
  (
    sa.strategy_id IS NULL
    OR sa.computation_status IS NULL
    OR sa.computation_status NOT IN ('complete', 'complete_with_warnings')
    OR lr.last_return_date IS NULL
    OR (CURRENT_DATE - lr.last_return_date) > 4
  )                                       AS is_stale,
  CASE
    WHEN sa.strategy_id IS NULL
      THEN 'no_analytics_row'
    WHEN sa.computation_status IS NULL
      OR sa.computation_status NOT IN ('complete', 'complete_with_warnings')
      THEN 'status_not_success'
    WHEN lr.last_return_date IS NULL
      THEN 'no_return_date'
    WHEN (CURRENT_DATE - lr.last_return_date) > 4
      THEN 'series_behind'
    ELSE NULL
  END                                     AS stale_reason
  -- <<< LEDGER_REFRESH_VERDICT_END
FROM strategy_venue sv
CROSS JOIN ledger_venue_set lv
LEFT JOIN public.strategy_analytics sa
       ON sa.strategy_id = sv.strategy_id
LEFT JOIN public.strategy_analytics_series sas
       ON sas.strategy_id = sv.strategy_id
      AND sas.kind = 'daily_returns_grid'
CROSS JOIN LATERAL (
  -- T-161.1-04, guard 1: a set-returning function applied to a JSONB SCALAR
  -- raises, which would break the view for EVERY reader. Normalise anything that
  -- is not an array (including NULL, including a bare object) to an empty array
  -- inside the CASE, before `jsonb_array_elements` ever sees it.
  --
  -- T-161.1-04, guard 2: pattern-filter each element, then cast through the
  -- guarded parser. Both guards fail toward "stale" — never toward "fresh".
  --
  -- This is an aggregate with no GROUP BY, so it yields exactly one row even
  -- when the series is empty or absent. A strategy with no analytics row is
  -- therefore still VISIBLE here, reading stale, rather than vanishing.
  SELECT max(public.ledger_refresh_parse_series_date(e.elem ->> 'date'))
           AS last_return_date
    FROM jsonb_array_elements(
           CASE
             WHEN jsonb_typeof(sa.returns_series) = 'array' THEN sa.returns_series
             ELSE '[]'::jsonb
           END
         ) AS e(elem)
   WHERE jsonb_typeof(e.elem) = 'object'
     AND (e.elem ->> 'date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
) AS lr
WHERE sv.exchanges && lv.venues;

COMMENT ON VIEW public.ledger_refresh_staleness IS
  'Phase 161.1 / LEDGER-03: one row per ledger-backed strategy (deribit/sfox/mt5, '
  'single-key AND composite) with a freshness verdict that a job status transition '
  'cannot fake. Read-only; service_role only; security_invoker. The venue array in '
  'its body is the single SQL home of the ledger venue set (D-05) and mirrors '
  '_LEDGER_BACKED_SOURCES in long_fetch.py.';

COMMENT ON COLUMN public.ledger_refresh_staleness.exchanges IS
  'Sorted distinct venues of this strategy, resolved through BOTH strategies.api_key_id '
  '(single-key) and strategy_keys (composite). D-06: the two links are mutually '
  'exclusive, so resolving only one of them makes every composite invisible.';

COMMENT ON COLUMN public.ledger_refresh_staleness.analytics_computed_at IS
  'INFORMATIONAL ONLY — NOT the freshness verdict. sync_strategy_analytics_status '
  're-stamps strategy_analytics.computed_at = now() on EVERY job transition, '
  'including the failed arm, so it advances while the analytics rot. Keying '
  'staleness on this column is the Phase 106 janitor bug. See is_stale.';

COMMENT ON COLUMN public.ledger_refresh_staleness.series_written_at IS
  'INFORMATIONAL ONLY — NOT the freshness verdict. The write timestamp of this '
  'strategy''s daily_returns_grid sibling row. No status transition moves it, but '
  'it advances whenever a run COMPLETES even if that run produced no new day. '
  'This is the attempt-recency signal plan 02 uses for its refresh cooldown.';

COMMENT ON COLUMN public.ledger_refresh_staleness.last_return_date IS
  'THE freshness key (D-03): max date across strategy_analytics.returns_series. '
  'Written only by real analytics runs — the single-key/CSV runner and '
  'run_stitch_composite_job — and never by a status transition, so it advances if '
  'and only if a run persisted a later day. NULL when the series is absent, empty, '
  'or entirely malformed, which reads as stale.';

COMMENT ON COLUMN public.ledger_refresh_staleness.is_stale IS
  'TRUE when ANY of: no strategy_analytics row; computation_status outside the '
  'success PAIR (complete, complete_with_warnings — D-04, all 5 live ledger rows '
  'are the latter); last_return_date NULL; last_return_date older than 4 days (the '
  'largest legitimate age given MT5 weekend + holiday gaps). stale_reason names '
  'which one fired, so a fresh-but-failed row is visibly distinct from a healthy one.';

REVOKE ALL ON public.ledger_refresh_staleness FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ledger_refresh_staleness TO service_role;

-- --------------------------------------------------------------------------
-- Catalogue-only verification. Reads no view or table ROWS.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_opts   TEXT[];
  v_grants INTEGER;
  v_cols   INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'ledger_refresh_staleness'
       AND c.relkind = 'v'
  ) THEN
    RAISE EXCEPTION 'Rollback 20261114151700: ledger_refresh_staleness view missing after the re-create';
  END IF;

  -- security_invoker came back (the DROP took the option with it).
  SELECT c.reloptions INTO v_opts
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'ledger_refresh_staleness';
  IF v_opts IS NULL OR NOT ('security_invoker=true' = ANY(v_opts)) THEN
    RAISE EXCEPTION 'Rollback 20261114151700: ledger_refresh_staleness is not security_invoker=true (reloptions=%)', v_opts;
  END IF;

  -- zero grants for PUBLIC (grantee oid 0), anon and authenticated.
  SELECT count(*) INTO v_grants
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) AS a
   WHERE n.nspname = 'public'
     AND c.relname = 'ledger_refresh_staleness'
     AND (
       a.grantee = 0
       OR a.grantee IN (
         SELECT r.oid FROM pg_roles r WHERE r.rolname IN ('anon', 'authenticated')
       )
     );
  IF v_grants <> 0 THEN
    RAISE EXCEPTION 'Rollback 20261114151700: ledger_refresh_staleness carries % grant(s) for PUBLIC/anon/authenticated after the re-create', v_grants;
  END IF;
  IF has_table_privilege('anon', 'public.ledger_refresh_staleness', 'SELECT') THEN
    RAISE EXCEPTION 'Rollback 20261114151700: role anon can SELECT ledger_refresh_staleness (cross-tenant read)';
  END IF;
  IF has_table_privilege('authenticated', 'public.ledger_refresh_staleness', 'SELECT') THEN
    RAISE EXCEPTION 'Rollback 20261114151700: role authenticated can SELECT ledger_refresh_staleness (cross-tenant read)';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.ledger_refresh_staleness', 'SELECT') THEN
    RAISE EXCEPTION 'Rollback 20261114151700: service_role cannot SELECT ledger_refresh_staleness';
  END IF;

  -- the closed columns are gone: this restores the 11-column verdict.
  SELECT count(*) INTO v_cols
    FROM pg_attribute at
    JOIN pg_class c ON c.oid = at.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'ledger_refresh_staleness'
     AND at.attnum > 0
     AND NOT at.attisdropped
     AND at.attname IN ('is_closed', 'closed_through');
  IF v_cols <> 0 THEN
    RAISE EXCEPTION 'Rollback 20261114151700: % of the closed columns still exist on ledger_refresh_staleness', v_cols;
  END IF;

  RAISE NOTICE 'Rollback 20261114151700: ledger_refresh_staleness restored to the 11-column view; ACL and security_invoker verified';
END $$;

COMMIT;
