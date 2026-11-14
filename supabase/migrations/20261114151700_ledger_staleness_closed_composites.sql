-- Migration: ledger_refresh_staleness — a composite whose member windows have
-- all closed reads CLOSED, not stale. Phase 214 FRESHTRUTH, plan 02 (SC-3),
-- 2026-11-14.
--
-- ⛔ OPS — THIS FILE AUTO-APPLIES. supabase/migrations/** applies to TEST first and
-- then to PROD on merge to main, with no human gate between the two (the
-- Production environment's reviewer was removed 2026-09-23). Every review this
-- migration needs happens BEFORE the merge. It changes no row and starts no work:
-- it re-defines one view and touches nothing that reads it.
--
-- Why this migration exists
-- -------------------------
-- A composite is stitched from members whose windows are declared in
-- strategy_keys. A member's window_end is EXCLUSIVE, so once every member has a
-- window_end and the latest of them has passed, the series cannot grow any more:
-- its last day is the day before that end, and nothing is left to fetch. The view
-- as 20260825120000 defined it still judged such a series by age alone, so a
-- composite that finished months ago read `series_behind` and stale for as long
-- as it existed. Two Deribit composites closed by 2026-04-30 had read stale for
-- 199 days when this phase measured them. A reading that cannot tell "stopped
-- because it is finished" from "stopped because something broke" is not a
-- freshness reading, and every operator who looked at it learned to ignore it.
--
-- This is a FORWARD migration, not an edit. 20260825120000 is the record of what
-- was applied to PROD and stays byte-for-byte as it was. The view is re-defined
-- here with CREATE OR REPLACE, and the rollback in
-- supabase/migrations/down/20261114151700-rollback.sql restores the 11-column
-- original. Postgres can only APPEND columns through CREATE OR REPLACE VIEW, so
-- the two new columns sit at the END and every existing column keeps its name,
-- type and position.
--
-- What changes
-- ------------
--   * A second lateral, `cl`, answers one question per strategy: is it closed?
--     It yields `is_closed` (never NULL) and `closed_through` (the last day a
--     closed strategy's series can carry, NULL otherwise).
--   * `is_closed` is true when the strategy has members, every member declares a
--     window_end, the latest window_end is today or earlier, and the series has
--     reached the day before that end. A single-key strategy has no members and
--     is never closed.
--   * Closed excuses exactly ONE reason, `series_behind`. The verdict and its
--     stale_reason branch each gain one conjunct and nothing else in them moves.
--
-- What does NOT change
-- --------------------
--   * `no_analytics_row`, `status_not_success` and `no_return_date` still read
--     stale on a closed composite: a closed window does not make a failed run, a
--     missing run or an empty series healthy.
--   * A composite with one open window, a series one day short of its end or a
--     window end in the future still reads `series_behind`.
--   * The composite fan-out is NOT touched and stays unscheduled. It selects on
--     `is_stale`, so it stops seeing a closed composite as a candidate with no
--     edit of its own. This file registers no schedule and names neither
--     fan-out: the static gates scan every file in this migration's timestamp
--     window raw, comments included, for the schedule verb and for both function
--     names.
--   * The venue arrays, the status pair, the parser function and every grant are
--     carried over exactly.
--
-- Why the WITH option and the grants are restated
-- -----------------------------------------------
-- CREATE OR REPLACE VIEW resets the view's WITH options to what the statement
-- states, so `security_invoker = true` must be spelled again or the view quietly
-- becomes an RLS bypass on strategies, api_keys and strategy_analytics for every
-- role that can read it (T-161.1-05). The ACL survives a replace, but a
-- migration that restates it can assert it, so the REVOKE and GRANT below are
-- repeated and the DO block at the end checks the result from the catalogue
-- alone.
--
-- Why the self-check reads only the catalogue
-- -------------------------------------------
-- TEST holds the schema and none of the data (supabase/schema/BASELINE.md), and
-- a failed TEST apply withholds the PROD apply. A block that counted view rows
-- and raised on the count would pass on PROD and refuse on TEST.
-- scripts/lint-migration-data-dependence.mjs refuses that shape at author time.
-- The block below reads pg_class, pg_namespace, pg_roles, pg_attribute,
-- aclexplode, has_table_privilege and pg_get_viewdef, and nothing else.
--
-- Needle hygiene
-- --------------
-- supabase/tests/test_ledger_refresh_staleness.sql and
-- supabase/tests/test_ledger_refresh_composite_arm.sql mutate COPIES of this file
-- and require each edit's find text to occur an exact number of times over its RAW
-- text. A comment that quotes one of those find strings raises the count and the
-- mutation reports `occurrence-mismatch` instead of biting. So the prose in this
-- file describes each condition and never pastes it, and the self-check builds
-- the one needle it needs by concatenation.

BEGIN;
SET lock_timeout = '5s';

-- --------------------------------------------------------------------------
-- STEP 1: the view
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
    OR (CURRENT_DATE - lr.last_return_date) > 4 AND NOT cl.is_closed
  )                                       AS is_stale,
  CASE
    WHEN sa.strategy_id IS NULL
      THEN 'no_analytics_row'
    WHEN sa.computation_status IS NULL
      OR sa.computation_status NOT IN ('complete', 'complete_with_warnings')
      THEN 'status_not_success'
    WHEN lr.last_return_date IS NULL
      THEN 'no_return_date'
    WHEN (CURRENT_DATE - lr.last_return_date) > 4 AND NOT cl.is_closed
      THEN 'series_behind'
    ELSE NULL
  END                                     AS stale_reason,
  -- <<< LEDGER_REFRESH_VERDICT_END
  -- Phase 214: appended AFTER the verdict region. CREATE OR REPLACE VIEW can only
  -- append columns, and these two are read-outs of the closed lateral below.
  cl.is_closed                            AS is_closed,
  cl.closed_through                       AS closed_through
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
CROSS JOIN LATERAL (
  -- Phase 214 / SC-3: is this strategy CLOSED? That is, does its declared window
  -- plan say the series is finished, and has the series reached the end of it?
  -- A strategy_keys window_end is EXCLUSIVE, so the last day a closed strategy can
  -- carry is the day BEFORE its latest window_end. Four conditions, one per line
  -- so each can be falsified alone:
  --   * the strategy has members at all (a single-key row has none, so it is
  --     never closed);
  --   * every member declares a window_end (one open window means the strategy is
  --     still active, whatever its series says);
  --   * the latest window_end is today or earlier (a future end is a plan, not a
  --     fact);
  --   * the series has reached the day before that end.
  -- Written ONCE, in the inner select. The outer select derives both columns from
  -- that single result, so no condition exists twice to drift apart.
  --
  -- An aggregate with no GROUP BY yields exactly one row even for a strategy with
  -- no members, so no row is dropped. The raw result is NULL, not FALSE, when
  -- the series is empty (a comparison with a NULL date), and the outer select
  -- turns that into FALSE, so is_closed is never NULL. A NULL would make the
  -- last disjunct of the verdict NULL for some row and the filter on
  -- is_stale in the fan-outs could then drop a stale row without any error.
  --
  -- Reads no write timestamp: member windows and the last day of the series only.
  SELECT
    COALESCE(c.closed_raw, FALSE)           AS is_closed,
    CASE
      WHEN c.closed_raw IS TRUE
        THEN c.max_window_end - 1
      ELSE NULL
    END                                     AS closed_through
  FROM (
    SELECT
      (
        count(*) > 0
        AND count(*) = count(sk.window_end)
        AND max(sk.window_end) <= CURRENT_DATE
        AND lr.last_return_date >= max(sk.window_end) - 1
      )                                     AS closed_raw,
      max(sk.window_end)                    AS max_window_end
    FROM public.strategy_keys sk
    WHERE sk.strategy_id = sv.strategy_id
  ) AS c
) AS cl
WHERE sv.exchanges && lv.venues;

COMMENT ON VIEW public.ledger_refresh_staleness IS
  'Phase 161.1 / LEDGER-03: one row per ledger-backed strategy (deribit/sfox/mt5, '
  'single-key AND composite) with a freshness verdict that a job status transition '
  'cannot fake. Read-only; service_role only; security_invoker. The venue array in '
  'its body is the single SQL home of the ledger venue set (D-05) and mirrors '
  '_LEDGER_BACKED_SOURCES in long_fetch.py. Phase 214: a composite whose member '
  'windows have all closed and whose series has reached the end of them reads '
  'is_closed = TRUE and is not stale for series_behind; every other stale reason '
  'is unchanged.';

COMMENT ON COLUMN public.ledger_refresh_staleness.is_stale IS
  'TRUE when ANY of: no strategy_analytics row; computation_status outside the '
  'success PAIR (complete, complete_with_warnings — D-04, all 5 live ledger rows '
  'are the latter); last_return_date NULL; last_return_date older than 4 days (the '
  'largest legitimate age given MT5 weekend + holiday gaps) AND the strategy is not '
  'closed (Phase 214). stale_reason names which one fired, so a fresh-but-failed '
  'row is visibly distinct from a healthy one.';

COMMENT ON COLUMN public.ledger_refresh_staleness.is_closed IS
  'Phase 214 / SC-3: TRUE when the strategy is a composite, every strategy_keys '
  'member declares a window_end, the latest window_end is today or earlier, and '
  'last_return_date has reached the day before that end (window_end is EXCLUSIVE). '
  'A closed strategy has nothing left to fetch, so its series ending is not a '
  'fault. Excuses ONLY the series_behind reason: a failed or missing analytics '
  'row, or an empty series, still reads stale. Never NULL. FALSE for every '
  'single-key strategy.';

COMMENT ON COLUMN public.ledger_refresh_staleness.closed_through IS
  'Phase 214 / SC-3: the last day a closed strategy''s series can carry, which is '
  'the day before its latest window_end. NULL whenever is_closed is FALSE.';

REVOKE ALL ON public.ledger_refresh_staleness FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ledger_refresh_staleness TO service_role;

-- --------------------------------------------------------------------------
-- STEP 2: self-verifying DO block — CATALOGUE ONLY
-- --------------------------------------------------------------------------
-- House style: RAISE EXCEPTION, never a silent NOTICE-skip. Mutates nothing and
-- reads no view or table ROWS (see the header).
--
-- It reads back only what no gate mutates: the option, the grants, the two venue
-- arrays, the two new columns and the presence of the excuse. It deliberately
-- does not read back the threshold, the status pair, the member conjuncts or the
-- coalesce, because a mutation that made THIS block abort would stop the gate
-- running at all and score as an unattributed failure instead of as the arm
-- biting.
DO $$
DECLARE
  v_opts      TEXT[];
  v_grants    INTEGER;
  v_def       TEXT;
  v_venue_lit TEXT;
  v_defer_lit TEXT;
  v_venues    TEXT[];
  v_deferred  TEXT[];
  v_cols      INTEGER;
BEGIN
  -- 1. the view is there and is still a view
  IF NOT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'ledger_refresh_staleness'
       AND c.relkind = 'v'
  ) THEN
    RAISE EXCEPTION 'Migration 20261114151700: ledger_refresh_staleness view missing';
  END IF;

  -- 2. security_invoker survived the replace (T-214-03). Without it the view
  --    reads its base tables as the OWNER and is an RLS bypass for any reader.
  SELECT c.reloptions INTO v_opts
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'ledger_refresh_staleness';
  IF v_opts IS NULL OR NOT ('security_invoker=true' = ANY(v_opts)) THEN
    RAISE EXCEPTION 'Migration 20261114151700: ledger_refresh_staleness is not security_invoker=true (reloptions=%)', v_opts;
  END IF;

  -- 3a. zero catalogued grants for PUBLIC (grantee oid 0), anon and
  --     authenticated. A NULL relacl means the default ACL, so it is expanded
  --     through acldefault rather than skipped.
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
    RAISE EXCEPTION 'Migration 20261114151700: ledger_refresh_staleness still carries % grant(s) for PUBLIC/anon/authenticated', v_grants;
  END IF;

  -- 3b. the same fact asked the way a reader would: has_table_privilege resolves
  --     grants made to PUBLIC and inherited through role membership.
  IF has_table_privilege('anon', 'public.ledger_refresh_staleness', 'SELECT') THEN
    RAISE EXCEPTION 'Migration 20261114151700: role anon can still SELECT ledger_refresh_staleness (cross-tenant read)';
  END IF;
  IF has_table_privilege('authenticated', 'public.ledger_refresh_staleness', 'SELECT') THEN
    RAISE EXCEPTION 'Migration 20261114151700: role authenticated can still SELECT ledger_refresh_staleness (cross-tenant read)';
  END IF;

  -- 4. service_role CAN read it. The broad REVOKE above could take this out by
  --    accident, and a view nobody can query is not an observability surface.
  IF NOT has_table_privilege('service_role', 'public.ledger_refresh_staleness', 'SELECT') THEN
    RAISE EXCEPTION 'Migration 20261114151700: service_role cannot SELECT ledger_refresh_staleness — the observability surface is unreadable';
  END IF;

  -- 5. both new columns exist (the replace appended them).
  SELECT count(*) INTO v_cols
    FROM pg_attribute at
    JOIN pg_class c ON c.oid = at.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'ledger_refresh_staleness'
     AND at.attnum > 0
     AND NOT at.attisdropped
     AND at.attname IN ('is_closed', 'closed_through');
  IF v_cols <> 2 THEN
    RAISE EXCEPTION 'Migration 20261114151700: expected the is_closed and closed_through columns on ledger_refresh_staleness, found % of 2', v_cols;
  END IF;

  -- 6. what Postgres INSTALLED: both venue arrays read back out of the catalogue
  --    (the same extraction 20260825120000 used, so the drift gates keep meaning
  --    one thing), and the excuse is present in the installed text. The needle is
  --    built by concatenation so this file holds no second copy of the verdict's
  --    own text.
  v_def := pg_get_viewdef('public.ledger_refresh_staleness'::regclass, true);
  v_venue_lit := substring(v_def FROM 'ARRAY\[([^\]]*)\] AS venues');
  v_defer_lit := substring(v_def FROM 'ARRAY\[([^\]]*)\] AS deferred_venues');
  IF v_venue_lit IS NULL OR v_defer_lit IS NULL THEN
    RAISE EXCEPTION 'Migration 20261114151700: could not read venues=% and deferred_venues=% back out of pg_get_viewdef — the extraction is broken, so the checks below prove NOTHING',
      coalesce(v_venue_lit, '<not found>'),
      coalesce(v_defer_lit, '<not found>');
  END IF;

  SELECT array_agg(m[1]) INTO v_venues
    FROM regexp_matches(v_venue_lit, '''([^'']*)''', 'g') AS m;
  SELECT array_agg(m[1]) INTO v_deferred
    FROM regexp_matches(v_defer_lit, '''([^'']*)''', 'g') AS m;
  IF coalesce(cardinality(v_venues), 0) <> 3
     OR coalesce(cardinality(v_deferred), 0) < 1
     OR NOT (v_deferred <@ v_venues) THEN
    RAISE EXCEPTION 'Migration 20261114151700: the installed venue arrays read back as % and % — expected three ledger venues containing the deferred one. The replace dropped or altered an array that every drift gate pins',
      v_venues, v_deferred;
  END IF;

  IF v_def !~ ('NOT\s+cl\.' || 'is_closed') THEN
    RAISE EXCEPTION 'Migration 20261114151700: the installed view definition does not carry the closed excuse, so a closed composite would still read stale';
  END IF;

  RAISE NOTICE 'Migration 20261114151700: ledger_refresh_staleness re-defined with is_closed and closed_through; ACL and security_invoker verified';
END $$;

COMMIT;
