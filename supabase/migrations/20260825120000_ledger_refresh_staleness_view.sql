-- Migration: ledger_refresh_staleness — the read-only observability surface for
-- Phase 161.1 / LEDGER-03. 2026-08-25.
--
-- Why this migration exists
-- -------------------------
-- No recurring enqueuer reaches `strategy_analytics` for a ledger-backed venue
-- (deribit / sfox / mt5). The defect went unnoticed for weeks because every
-- timestamp a reader would naturally reach for KEPT MOVING while the analytics
-- themselves rotted. This view is the measuring instrument that cannot be fooled
-- that way: one row per ledger-backed strategy, with a freshness verdict keyed on
-- a column that only a real analytics run can advance.
--
-- This file changes NO row and starts NO work. It creates one IMMUTABLE parser
-- function and one view, both revoked from every non-service role. Merging it is
-- behaviour-neutral, which matters because supabase/migrations/** AUTO-APPLIES to
-- PROD on merge to main — there is no separate deploy step.
--
-- D-03 — why the verdict keys on max(date) inside returns_series
-- --------------------------------------------------------------
-- Every rejected candidate was measured, not assumed:
--
--   * `api_keys.last_sync_at` — advanced daily by key-scoped jobs even when zero
--     trades landed. This is the liar that hid the bug.
--   * `strategy_analytics.computed_at` — `sync_strategy_analytics_status` writes
--     `computed_at = now()` in ALL arms including the `failed` arm
--     (20260802120000 lines 342/398/421, superseding 20260710150000). It
--     reproduces the same lie one column over. That migration says so itself at
--     its lines 82 and 230 and calls it "the Phase 106 janitor bug".
--   * `strategy_analytics.computing_started_at` — the stuck-row reap anchor,
--     cleared to NULL on exit. Not a freshness signal.
--   * `strategy_analytics_series.computed_at` — no status transition moves it,
--     but it is a WRITE timestamp: it advances when a run completes even if that
--     run produced no new day. Exposed below as `series_written_at` for plan 02's
--     attempt cooldown, and deliberately NOT the verdict.
--
-- ADOPTED: `max((e->>'date')::date)` over `strategy_analytics.returns_series`.
-- The property required is not "exactly one writer" — it is "no writer that can
-- advance it without new data". Two writers exist and BOTH are real analytics
-- runs (D-03a): the single-key/CSV analytics runner, and `run_stitch_composite_job`
-- for composites. Neither is a status transition. `_stamp_strategy_analytics_failed`
-- and `sync_strategy_analytics_status` were both re-verified to leave
-- `returns_series` untouched, so a terminal failure cannot move this verdict.
--
-- The composite writer is load-bearing, not incidental: the only deribit strategy
-- in PROD is a composite, and `derive_broker_dailies` in strategy-mode resolves
-- its key through `strategies.api_key_id` and so structurally cannot serve one.
-- `stitch_composite` is the only thing that can advance a composite's series.
--
-- Staleness threshold — 4 days, and why it is a strict `>`
-- --------------------------------------------------------
-- Ledger dailies land one row per calendar day, but MT5 is a traditional venue
-- with no weekend bars. Walk the worst LEGITIMATE gap: Friday's bar carries date
-- F; Saturday and Sunday produce none; a public-holiday Monday produces none; the
-- next bar is Tuesday. A read on Tuesday BEFORE that day's derive has run sees F
-- at an age of exactly 4 days. So 4 is the largest age that is still healthy, and
-- the alert must fire only ABOVE it.
--
-- ⚠️ The plan text for this task derived the same constant from a Monday read
-- ("legitimately 3 days old"), which under-counts the gap by one day because it
-- stops before the holiday's own displacement lands. Same constant, different
-- comparison: keying `>=` off the plan's derivation would false-alarm every
-- holiday Tuesday. The value is pinned at both edges by
-- supabase/tests/test_ledger_refresh_staleness.sql (age 4 fresh, age 5 stale) so
-- it cannot drift silently in either direction.
--
-- Detection margin is wide regardless: the live ledger cohort sits at 21 and 36
-- days behind.
--
-- D-05 — this file is the SINGLE SQL home of the ledger venue set
-- ---------------------------------------------------------------
-- The literal array in `ledger_venue_set` below mirrors `_LEDGER_BACKED_SOURCES`
-- in analytics-service/services/ingestion/long_fetch.py (line 63). Plan 02's
-- fan-out SELECTs from this view and declares NO venues of its own; plan 05's
-- static drift gate pins this one array against that Python constant and fails CI
-- on divergence. A hand-copied mirror has drifted before — TS at 1 venue against
-- Python at 3 — and cost a funded MT5 account its publish path.
--
-- The one venue name this file must ALSO carry — the deferred venue whose
-- composites 20260825140000 skips — is declared in the SAME CTE as a subset
-- array, never re-typed at its point of use, and the STEP 3 DO block asserts it
-- is a member of the set above by reading BOTH back out of pg_get_viewdef. That
-- assertion is why `has_mt5_member` is not a hand-copied literal (WR-02).
--
-- ⛔ Scope the set off ledger-backed-ness, NEVER off absence from
-- `EXCHANGE_CLASSES`: deribit IS in `EXCHANGE_CLASSES`
-- (analytics-service/services/exchange.py:812), so an absence-scoped cohort
-- silently drops the one venue this whole pipeline was built for.
--
-- D-06 — venue resolves through BOTH link shapes
-- -----------------------------------------------
-- A multi-key composite has `strategies.api_key_id = NULL`, and a strategy with
-- `api_key_id` set is definitively single-key — the two are mutually exclusive
-- (finalize-wizard/route.ts:1177, 1388-1392). A view joining only `api_key_id` is
-- therefore blind to EVERY composite, and the only deribit strategy in PROD is a
-- composite. Simplifying this to a single-key join would make deribit invisible in
-- the very surface built to observe it; Arm D of the SQL gate fails if anyone does.
--
-- D-04 — the status success set is a PAIR
-- ----------------------------------------
-- All 5 live ledger rows are `complete_with_warnings`. A predicate written as
-- `status = 'complete'` marks every healthy ledger strategy broken.
--
-- Access control
-- --------------
-- The `public` schema in this project carries default privileges granting new
-- relations to `anon` and `authenticated`, and this view enumerates strategies
-- across every tenant (T-161.1-01). REVOKE from PUBLIC/anon/authenticated, GRANT
-- SELECT to service_role only, and `security_invoker = true` so the view never
-- becomes an RLS bypass on the base tables (T-161.1-05). The DO block asserts all
-- three at apply time.
--
-- Convention deviation (pre-documented so review does not re-litigate)
-- -------------------------------------------------------------------
-- Uses BEGIN/COMMIT and a session-level SET, matching the 150-of-231 repo
-- majority and both pg_cron janitor analogs (20260719120000, 20260720120000), per
-- project Rule 11. This file registers NO pg_cron schedule and none may ever be
-- added to it: the runbook forbids scheduling from a migration because auto-apply
-- plus a silently skipped worker deploy recreates the v1.11 wedge verbatim. The
-- scheduling call is deliberately NOT spelled out here — prose must never satisfy
-- or trip a mechanical gate, and plan 05's dormancy gate greps this whole file.

BEGIN;
SET lock_timeout = '5s';

-- --------------------------------------------------------------------------
-- STEP 1: the fail-toward-stale date parser
-- --------------------------------------------------------------------------
-- `returns_series` is JSONB written by the analytics runners; a corrupted or
-- hand-edited element must never break the view for every other reader
-- (T-161.1-04). The view pattern-filters elements before calling this, but a
-- regex is NOT sufficient on its own and the difference is not theoretical:
-- '2026-02-31' matches a four-two-two digit pattern exactly and still raises
-- (SQLSTATE 22008, measured). Only a guarded cast actually delivers "a garbage
-- element must not raise".
--
-- Returning NULL on a bad element drops it from the `max()`, which can only make
-- a row look STALER, never fresher. The two trapped conditions are named
-- explicitly rather than `WHEN others` so this can never swallow a query cancel,
-- an out-of-memory, or a permission error.
--
-- No caller-supplied trust surface: SECURITY INVOKER (the default), reads no
-- table, and is revoked from every non-service role.
CREATE OR REPLACE FUNCTION public.ledger_refresh_parse_series_date(p_text TEXT)
RETURNS DATE
LANGUAGE plpgsql
-- STABLE, not IMMUTABLE: `text::date` is DateStyle-dependent, so this is not a
-- pure function of its input and cannot honestly promise immutability. Today the
-- sole caller pre-filters with ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ and ISO-8601 parses
-- YMD regardless of DateStyle, so nothing is broken — but the function is
-- GRANT EXECUTE-ed to service_role, and a future second caller or an expression
-- index built on it would inherit an unsound promise. STABLE still permits
-- everything the current per-row LATERAL does.
STABLE
STRICT
SET search_path = public, pg_catalog
AS $$
BEGIN
  RETURN p_text::date;
EXCEPTION
  WHEN invalid_datetime_format OR datetime_field_overflow THEN
    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.ledger_refresh_parse_series_date(TEXT) IS
  'Phase 161.1 / LEDGER-03: parses one returns_series element date, returning '
  'NULL instead of raising on malformed input (22007) or an impossible calendar '
  'date such as 2026-02-31 (22008). A regex pre-filter alone does NOT cover the '
  'second case. NULL drops the element from the max(), so corruption can only '
  'make a strategy read STALER, never fresher. Used only by '
  'public.ledger_refresh_staleness.';

REVOKE ALL ON FUNCTION public.ledger_refresh_parse_series_date(TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ledger_refresh_parse_series_date(TEXT)
  TO service_role;

-- --------------------------------------------------------------------------
-- STEP 2: the view
-- --------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.ledger_refresh_staleness
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
-- STEP 3: self-verifying DO block
-- --------------------------------------------------------------------------
-- House style: RAISE EXCEPTION, never a silent NOTICE-skip. Mutates nothing.
DO $$
DECLARE
  v_opts      TEXT[];
  v_grants    INTEGER;
  v_rows      BIGINT;
  v_def       TEXT;
  v_venue_lit TEXT;
  v_defer_lit TEXT;
  v_flag_expr TEXT;
  v_venues    TEXT[];
  v_deferred  TEXT[];
BEGIN
  -- 1. the parser function landed
  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'ledger_refresh_parse_series_date'
  ) THEN
    RAISE EXCEPTION 'Migration 20260825120000: ledger_refresh_parse_series_date missing';
  END IF;

  -- 2. the view landed
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.views
     WHERE table_schema = 'public'
       AND table_name = 'ledger_refresh_staleness'
  ) THEN
    RAISE EXCEPTION 'Migration 20260825120000: ledger_refresh_staleness view missing';
  END IF;

  -- 3. security_invoker is ON — without it the view is an RLS bypass on
  --    strategies / api_keys / strategy_analytics for anyone who can read it.
  SELECT c.reloptions INTO v_opts
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'ledger_refresh_staleness';
  IF v_opts IS NULL OR NOT ('security_invoker=true' = ANY(v_opts)) THEN
    RAISE EXCEPTION 'Migration 20260825120000: ledger_refresh_staleness is not security_invoker=true (reloptions=%)', v_opts;
  END IF;

  -- 4a. zero catalogued grants for anon / authenticated (T-161.1-01)
  SELECT count(*) INTO v_grants
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public'
     AND table_name = 'ledger_refresh_staleness'
     AND grantee IN ('anon', 'authenticated', 'PUBLIC');
  IF v_grants <> 0 THEN
    RAISE EXCEPTION 'Migration 20260825120000: ledger_refresh_staleness still carries % grant(s) for anon/authenticated/PUBLIC', v_grants;
  END IF;

  -- 4b. and the same fact asked the way an attacker would — has_table_privilege
  --     resolves grants made to PUBLIC and via role inheritance, which the
  --     information_schema view above reports under a different grantee.
  IF has_table_privilege('anon', 'public.ledger_refresh_staleness', 'SELECT') THEN
    RAISE EXCEPTION 'Migration 20260825120000: role anon can still SELECT ledger_refresh_staleness (cross-tenant read)';
  END IF;
  IF has_table_privilege('authenticated', 'public.ledger_refresh_staleness', 'SELECT') THEN
    RAISE EXCEPTION 'Migration 20260825120000: role authenticated can still SELECT ledger_refresh_staleness (cross-tenant read)';
  END IF;

  -- 5. service_role CAN read it — a view nobody can query is not an
  --    observability surface, and the REVOKE above is broad enough to take this
  --    out by accident.
  IF NOT has_table_privilege('service_role', 'public.ledger_refresh_staleness', 'SELECT') THEN
    RAISE EXCEPTION 'Migration 20260825120000: service_role cannot SELECT ledger_refresh_staleness — the observability surface is unreadable';
  END IF;

  -- 6. WR-02 — the deferred venue is a MEMBER of the ledger venue set, and the
  --    flag column is computed from it rather than from a hand-typed name.
  --
  --    Gate 1 in analytics-service/tests/test_ledger_refresh_gates.py pins the
  --    `venues` array against `_LEDGER_BACKED_SOURCES` (the sole authority). It
  --    does not see the deferred name, so a rename of the venue token — or a
  --    sibling spelling — would satisfy gate 1 while `has_mt5_member` evaluated
  --    FALSE for every affected row, and 20260825140000's `has_mt5_member =
  --    FALSE` conjunct would stop excluding anything. That is a SILENT
  --    mishandling of the one venue that serialises on a single shared terminal
  --    registry, which is exactly what D-01 says must never happen.
  --
  --    Read back out of pg_get_viewdef, not out of this file's text: the
  --    property under test is what Postgres INSTALLED, and prose in a migration
  --    must never be able to satisfy a mechanical check.
  --
  --    ⛔ Do NOT satisfy this check by re-declaring the venue set here. There is
  --    exactly one array (D-05); this reads it back out of the catalogue.
  v_def := pg_get_viewdef('public.ledger_refresh_staleness'::regclass, true);
  v_venue_lit := substring(v_def FROM 'ARRAY\[([^\]]*)\] AS venues');
  v_defer_lit := substring(v_def FROM 'ARRAY\[([^\]]*)\] AS deferred_venues');
  v_flag_expr := substring(v_def FROM '([^\n]*) AS has_mt5_member');

  -- ANTI-VACUITY FLOOR (a): the extraction landed. A NULL here would make every
  -- assertion below pass over nothing. Fix the extraction; never drop the check.
  IF v_venue_lit IS NULL OR v_defer_lit IS NULL OR v_flag_expr IS NULL THEN
    RAISE EXCEPTION 'Migration 20260825120000: could not read venues=%, deferred_venues=%, has_mt5_member=% back out of pg_get_viewdef — the extraction is broken, so the drift assertions below prove NOTHING',
      coalesce(v_venue_lit, '<not found>'),
      coalesce(v_defer_lit, '<not found>'),
      coalesce(v_flag_expr, '<not found>');
  END IF;

  SELECT array_agg(m[1]) INTO v_venues
    FROM regexp_matches(v_venue_lit, '''([^'']*)''', 'g') AS m;
  SELECT array_agg(m[1]) INTO v_deferred
    FROM regexp_matches(v_defer_lit, '''([^'']*)''', 'g') AS m;

  -- ANTI-VACUITY FLOOR (b): a parse that came back with ONE venue would let the
  -- subset test below pass for the wrong reason. Three is the same count gate 1
  -- pins, and for the same stated reason; if the ledger venue set genuinely
  -- grows, both move in the same commit.
  IF coalesce(cardinality(v_venues), 0) <> 3
     OR coalesce(cardinality(v_deferred), 0) < 1 THEN
    RAISE EXCEPTION 'Migration 20260825120000: parsed % ledger venue(s) % and % deferred venue(s) % from the installed definition — expected 3 and at least 1. The parse is broken and the subset assertion would be vacuous',
      coalesce(cardinality(v_venues), 0), v_venues,
      coalesce(cardinality(v_deferred), 0), v_deferred;
  END IF;

  IF NOT (v_deferred <@ v_venues) THEN
    RAISE EXCEPTION 'Migration 20260825120000: DEFERRED-VENUE DRIFT — deferred_venues % is not contained in the ledger venue set %. The deferred name must be one of the ledger venues, or has_mt5_member reads FALSE for every row and the composite exclusion in 20260825140000 silently stops excluding. Change _LEDGER_BACKED_SOURCES (analytics-service/services/ingestion/long_fetch.py) FIRST, then both arrays here',
      v_deferred, v_venues;
  END IF;

  -- ...and the flag actually CONSUMES it. Without this, the subset above would
  -- guard a value nothing reads while has_mt5_member went back to a literal.
  IF position('deferred_venues' IN v_flag_expr) = 0
     OR position('''' IN v_flag_expr) > 0 THEN
    RAISE EXCEPTION 'Migration 20260825120000: has_mt5_member is computed as `%` — it must read lv.deferred_venues and contain no venue literal of its own (WR-02), or the subset assertion above guards a value the view does not use',
      btrim(v_flag_expr);
  END IF;

  -- 7. the view actually EXECUTES. A broken lateral, a bad cast or a mistyped
  --    column would otherwise sit latent until the first real read.
  SELECT count(*) INTO v_rows FROM public.ledger_refresh_staleness;
  RAISE NOTICE 'Migration 20260825120000: ledger_refresh_staleness applied; % ledger-backed strategies visible', v_rows;
END $$;

COMMIT;
