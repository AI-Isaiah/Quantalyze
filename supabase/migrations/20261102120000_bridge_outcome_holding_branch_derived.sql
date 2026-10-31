-- ============================================================================
-- bridge_outcome_holding_branch_derived: the holding branch of
-- public.compute_bridge_outcome_deltas() measures a bridge outcome on the ACCOUNT's
-- derived equity, and every stored holding outcome is recomputed once on that basis
-- (2026-11-02, Phase 176 LEGACYRETIRE, plan 02; SC-1; D-03, D-05, D-06)
-- ============================================================================
--
-- What this is for
-- ----------------
-- Until now the +30, +90 and +180 day outcome of a bridge decision that names a
-- holding was read per symbol, from the `breakdown` column of
-- public.allocator_equity_snapshots through public.extract_symbol_value_at. That table
-- is the legacy allocator equity curve and Phase 176 retires it: PR 3 drops it. This
-- migration is the database half of PR 1. After it, nothing in the daily bridge batch
-- reads the legacy table, which is a precondition of the drop.
--
--   D-03  "Derived account total" (founder 2026-10-31). The +30d and +90d outcome is
--         measured on the account's derived equity, not on the symbol's value from the
--         breakdown. This changes what the outcome means: it is a number about the
--         ACCOUNT, no longer about the holding the decision named.
--   D-05  "Compounded daily returns (Recommended)". The +30d, +90d and +180d bridge
--         outcome compounds the derived row's flow-neutral daily returns over the
--         window, so deposits and withdrawals do not count as performance. These are
--         the returns the factsheet KPIs read (consistent with
--         `[167.1.1-BRIDGE-DOLLAR-RATIO-RETURNS]`). A missing day gives NULL.
--         ⚠️ FIX ROUND 1 (2026-10-31) RELAXES THE LAST SENTENCE, on a PROD measurement.
--         Every trustworthy derived curve on PROD omits about 23% of its calendar days
--         (for example 188 returns over a 244-day span), because the compose leaves a day
--         out under benign flags such as missing_return_inside_coverage and
--         skipped_nonpositive_denominator while is_trustworthy stays true. "Any missing day
--         gives NULL" would have left nearly every holding outcome Pending for ever. The
--         rule is now: a day with no returns entry is no change, and the outcome is NULL
--         only when the curve does not COVER the window. See the helper paragraph below.
--         ⚠️ FIX ROUND 2 (2026-10-31, founder "At least one day") REFINES IT: a window the
--         curve spans but holds no well-formed return inside is NULL, not 0%, and only
--         well-formed YYYY-MM-DD dates count toward coverage. Stored outcomes are kept.
--   D-06  "Reset and recompute once (Recommended)". The PR 1 migration sets
--         `needs_recompute = TRUE` and NULLs the old deltas together, for the
--         holding-measuring outcome rows only, so every stored outcome ends up on the
--         new basis. This supersedes the line in D-03 that said "outcomes already
--         stored keep their values".
--
-- The window is the days (allocated_at, allocated_at + N] for N = 30, 90 and 180: the
-- allocation day is the base, so the first day that counts is the day after it. The
-- outcome is exp(sum(ln(1 + r))) - 1 over the `returns[].r` of the allocator's
-- allocator_equity_derived row of kind equity_curve. No outcome is a ratio of dollar
-- equity levels: a funded account would read as a gain.
--
-- The one helper, public.derived_account_return_over(uuid, date, integer), compounds the
-- returns that ARE present inside the window and treats a day with no returns entry as no
-- change. A day with 1 + r <= 0 (a total loss) compounds to -1, not NULL. It returns NULL
-- whenever a number would be invented: the curve does not cover the window (its first
-- returns date is after the first day of the window, or its last returns date is before
-- the last day of the window; only dates of the form YYYY-MM-DD count toward that), no
-- returns entry inside the window at all, a day present twice, the row not payload version 2 or not
-- is_trustworthy, an r that is not a JSON number, a compounded log beyond any real book, a
-- malformed payload, a NULL argument, p_days below 1. Dates are matched as TEXT against
-- the days the window names, never cast, so a malformed date text is an absent day, cannot
-- abort the batch for every other allocator and cannot extend the curve's coverage.
--
-- The CHECK window (a finding of this plan, measured from the CHECK, not assumed).
-- bridge_outcomes_allocated_at_check admits allocated_at IS NULL or a date inside
-- [CURRENT_DATE - 365 days, CURRENT_DATE]. PostgreSQL evaluates every CHECK on every
-- UPDATE of a row, so the holding UPDATE of a row aged past 365 days raises 23514 and
-- aborts the whole daily statement. A reset that NULLs deltas turns rows into candidates
-- that can age into it, so the holding candidates (and the D-06 reset below) take only
-- rows inside the window. The strategy and voluntary_add branches carried the same latent
-- abort (booked as 176-BRIDGE-CHECK-WINDOW-ABORT) and, since fix round 1, take the same
-- window conjunct, so one aged row there can no longer abort the statement and leave every
-- reset holding row Pending.
--
-- What is NOT changed from the latest definer, 20260426131718_match_decisions_kind_enum.sql:
-- the signature, SECURITY DEFINER, the pinned search_path, and the strategy and
-- voluntary_add branches apart from that one allocated_at window conjunct in each
-- candidate set. The holding branch's UPDATE keeps its COALESCE, needs_recompute and
-- deltas_computed_at lines. The holding branch still sets no estimated_* column.
--
-- Fix round 1 (2026-10-31), the holding branch only:
--   * A holding row stays a candidate until every window that has matured is filled: it is
--     also picked while delta_90d IS NULL and allocated_at is 91 or more days back, or
--     delta_180d IS NULL and allocated_at is 181 or more days back. Before, the row left the
--     candidate set for good once +30d landed (needs_recompute went FALSE), so +90d and
--     +180d were never filled for a decision younger than 90 days at its first measurement.
--     (Fix round 2 below fixes what the picked row then writes.)
--   * A row whose three new deltas are all NULL is not written (it stays needs_recompute
--     TRUE and keeps no deltas_computed_at) and is not counted as updated. It is counted in
--     the failed_count the function already returns.
--   * The D-06 reset reports the number of rows it cleared with a NOTICE (a count only).
--
-- Fix round 2 (2026-10-31, review round 2), the holding branch and the helper:
--   * WR-03. A stored delta is kept. The refill used to overwrite every stored delta with
--     the current derived curve's value, which NAVMTM restates, so an outcome the allocator
--     had already seen could change sign. Now a row with needs_recompute set is re-measured
--     (the new value wins, as the D-06 reset needs), and any other row takes the stored value
--     first: COALESCE(stored, new). A row picked again for a matured window is written,
--     counted in updated_count and stamped only when a previously NULL window actually filled.
--   * WR-02. The helper's coverage (first and last returns date) considers only dates of the
--     form YYYY-MM-DD, so a time-suffixed or stray malformed date can no longer span a window
--     the curve does not cover; and a window with no matched return inside it is NULL
--     (founder, "At least one day"), where it used to compound to an invented 0%.
--
-- Access. The helper is SECURITY INVOKER: allocator_equity_derived carries FORCE ROW
-- LEVEL SECURITY, so a direct caller would be held to the owner policy, and EXECUTE is
-- revoked from PUBLIC, anon and authenticated by full signature regardless. Its only
-- caller is the SECURITY DEFINER batch, which runs as the table owner.
--
-- ⛔ NO DATA CENSUS RUNS INSIDE THIS MIGRATION. Shared TEST holds PROD's catalogue and
-- none of its data, and a failed TEST apply blocks the PROD apply, so the verify block
-- below reads the catalogue only (pg_proc, pg_namespace, has_function_privilege,
-- to_regprocedure). The one data statement is the D-06 reset, an UPDATE that raises
-- nothing and touches zero rows on an empty database.
--
-- ⛔ DEPLOY ORDER. Merging supabase/migrations/** applies to TEST and then to PROD with
-- no human stop. The reset runs at that apply: every stored holding outcome shows
-- Pending until the next 03:00Z run of the compute_bridge_outcome_deltas cron
-- recomputes it on the derived basis.
--
-- Transaction style: NO explicit BEGIN/COMMIT. Supabase wraps each migration in an
-- implicit transaction (migration-reviewer invariant #14, the statement made in
-- 20260716090000). SET LOCAL lock_timeout applies to that wrap.
--
-- Rollback (manual, off the auto-apply path):
-- supabase/migrations/down/20261102120000-rollback.sql
-- ============================================================================

SET LOCAL lock_timeout = '3s';

-- ───────────── the helper
-- Schema-qualified CREATE: an unqualified CREATE OR REPLACE resolves against the
-- SESSION search_path and can mint a second function with default privileges.
CREATE OR REPLACE FUNCTION public.derived_account_return_over(
  p_allocator_id uuid,
  p_anchor       date,
  p_days         integer
)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public, pg_catalog
AS $func$
  WITH d AS (
    SELECT payload
      FROM public.allocator_equity_derived
     WHERE allocator_id = p_allocator_id
       AND kind = 'equity_curve'
       AND p_anchor IS NOT NULL
       AND p_days >= 1
       AND jsonb_typeof(payload) = 'object'
       AND payload->>'version' = '2'
       AND payload->'is_trustworthy' = 'true'::jsonb
       AND jsonb_typeof(payload->'returns') = 'array'
  ),
  want AS (
    SELECT to_char(p_anchor + i, 'YYYY-MM-DD') AS day
      FROM generate_series(1, p_days) AS g(i)
  ),
  got AS (
    SELECT e->>'date' AS day,
           CASE WHEN jsonb_typeof(e->'r') = 'number' THEN (e->>'r')::numeric END AS r
      FROM d, jsonb_array_elements(d.payload->'returns') AS e
  ),
  cov AS (
    SELECT min(day) AS first_day, max(day) AS last_day
      FROM got
     WHERE day ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  ),
  j AS (
    SELECT got.day AS got_day,
           got.r,
           CASE WHEN got.r > -1 THEN ln(1 + got.r) ELSE 0 END AS lg
      FROM want
      LEFT JOIN got ON got.day = want.day
  )
  SELECT CASE
           WHEN count(*) = p_days
            AND count(got_day) > 0
            AND NOT bool_or(got_day IS NOT NULL AND r IS NULL)
            AND (SELECT first_day FROM cov) <= to_char(p_anchor + 1, 'YYYY-MM-DD')
            AND (SELECT last_day FROM cov) >= to_char(p_anchor + p_days, 'YYYY-MM-DD')
            AND sum(lg) < 1000
           THEN CASE WHEN bool_or(r <= -1) THEN -1 ELSE exp(sum(lg)) - 1 END
         END
    FROM j
$func$;

COMMENT ON FUNCTION public.derived_account_return_over(uuid, date, integer) IS
  'Phase 176 LEGACYRETIRE (D-03, D-05): the account''s compounded flow-neutral return over the p_days days after p_anchor, from the returns of the allocator''s allocator_equity_derived equity_curve row. A day with no returns entry counts as no change; a day with 1 + r <= 0 compounds to -1. NULL when the curve does not cover the window (its first YYYY-MM-DD returns date is after p_anchor + 1 or its last before p_anchor + p_days), no returns entry falls inside the window, a day is repeated, the row is not version 2 and trustworthy, an r is not a number, or the payload is malformed. SECURITY INVOKER; its only caller is compute_bridge_outcome_deltas.';

-- ───────────── the re-based batch
-- Re-based on the LATEST definer, 20260426131718 (grep over supabase/migrations/*.sql
-- for FUNCTION public.compute_bridge_outcome_deltas: 20260418074935, 20260419061003,
-- 20260421154030, 20260426131718; the last is the newest). Only the holding CTEs change.

CREATE OR REPLACE FUNCTION public.compute_bridge_outcome_deltas()
RETURNS TABLE(updated_count INT, failed_count INT, batch_started_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $func$
DECLARE
  v_updated INT := 0;
  v_failed  INT := 0;
  v_started TIMESTAMPTZ := NOW();
BEGIN
  WITH
  -- ---------------- strategy branch (migration 073; fix round 1 adds the allocated_at window conjunct) ----------------
  strategy_candidates AS (
    SELECT
      bo.id,
      bo.allocated_at,
      sa.returns_series AS series
    FROM public.bridge_outcomes AS bo
    LEFT JOIN public.match_decisions md ON md.id = bo.match_decision_id
    JOIN public.strategy_analytics sa ON sa.strategy_id = bo.strategy_id
    WHERE bo.kind = 'allocated'
      AND bo.allocated_at IS NOT NULL
      AND bo.allocated_at >= (CURRENT_DATE - '365 days'::interval)
      AND (bo.delta_30d IS NULL OR bo.needs_recompute = TRUE)
      AND (
        bo.match_decision_id IS NULL
        OR (md.original_strategy_id IS NOT NULL AND md.original_holding_ref IS NULL)
      )
  ),
  strategy_computed AS (
    SELECT
      c.id,
      public.extract_delta(c.series, c.allocated_at, 30)  AS d30,
      public.extract_delta(c.series, c.allocated_at, 90)  AS d90,
      public.extract_delta(c.series, c.allocated_at, 180) AS d180,
      est.bps  AS est_bps,
      est.days AS est_days
    FROM strategy_candidates c
    LEFT JOIN LATERAL public.extract_estimated(c.series, c.allocated_at) AS est ON TRUE
  ),
  strategy_updated AS (
    UPDATE public.bridge_outcomes AS bo
    SET
      delta_30d           = COALESCE(c.d30,      bo.delta_30d),
      delta_90d           = COALESCE(c.d90,      bo.delta_90d),
      delta_180d          = COALESCE(c.d180,     bo.delta_180d),
      estimated_delta_bps = COALESCE(c.est_bps,  bo.estimated_delta_bps),
      estimated_days      = COALESCE(c.est_days, bo.estimated_days),
      needs_recompute     = FALSE,
      deltas_computed_at  = v_started
    FROM strategy_computed c
    WHERE bo.id = c.id
      AND bo.kind = 'allocated'
      AND (bo.delta_30d IS NULL OR bo.needs_recompute = TRUE)
    RETURNING bo.id
  ),
  -- ---------------- holding branch (Phase 176 LEGACYRETIRE, D-03 / D-05) ----------------
  -- Measured PER ACCOUNT, not per symbol: the +30, +90 and +180 day outcome compounds
  -- the account's flow-neutral daily returns (allocator_equity_derived, kind
  -- equity_curve, payload.returns) over (allocated_at, allocated_at + N] through
  -- public.derived_account_return_over. A window the derived curve does not cover is
  -- NULL. The candidate set and the UPDATE are as migration 073 had them, plus the
  -- allocated_at window conjunct below, plus (fix round 1) a matured-window refill: a
  -- row whose +30d landed is picked again while its +90d or +180d is NULL and old enough.
  holding_candidates AS (
    SELECT
      bo.id,
      bo.allocator_id,
      bo.allocated_at,
      hp.symbol
    FROM public.bridge_outcomes bo
    JOIN public.match_decisions md ON md.id = bo.match_decision_id
    LEFT JOIN LATERAL public.parse_holding_ref(md.original_holding_ref) hp ON TRUE
    WHERE bo.kind = 'allocated'
      AND bo.allocated_at IS NOT NULL
      AND (
        bo.delta_30d IS NULL OR bo.needs_recompute = TRUE
        OR (bo.delta_90d IS NULL AND bo.allocated_at <= (CURRENT_DATE - '91 days'::interval))
        OR (bo.delta_180d IS NULL AND bo.allocated_at <= (CURRENT_DATE - '181 days'::interval))
      )
      AND md.original_strategy_id IS NULL
      AND md.original_holding_ref IS NOT NULL
      AND hp.symbol IS NOT NULL
      -- bridge_outcomes_allocated_at_check admits only allocated_at inside
      -- [CURRENT_DATE - 365 days, CURRENT_DATE] and PostgreSQL re-checks it on EVERY
      -- UPDATE of a row, so touching a row aged past the window raises 23514 and
      -- aborts this whole statement for every allocator. Such a row is not a candidate.
      AND bo.allocated_at >= (CURRENT_DATE - '365 days'::interval)
  ),
  holding_computed AS (
    SELECT
      hc.id,
      public.derived_account_return_over(hc.allocator_id, hc.allocated_at, 30)  AS d30,
      public.derived_account_return_over(hc.allocator_id, hc.allocated_at, 90)  AS d90,
      public.derived_account_return_over(hc.allocator_id, hc.allocated_at, 180) AS d180
    FROM holding_candidates hc
  ),
  holding_updated AS (
    UPDATE public.bridge_outcomes AS bo
    SET
      delta_30d          = CASE WHEN bo.needs_recompute THEN COALESCE(hc.d30,  bo.delta_30d)  ELSE COALESCE(bo.delta_30d,  hc.d30)  END,
      delta_90d          = CASE WHEN bo.needs_recompute THEN COALESCE(hc.d90,  bo.delta_90d)  ELSE COALESCE(bo.delta_90d,  hc.d90)  END,
      delta_180d         = CASE WHEN bo.needs_recompute THEN COALESCE(hc.d180, bo.delta_180d) ELSE COALESCE(bo.delta_180d, hc.d180) END,
      needs_recompute    = FALSE,
      deltas_computed_at = v_started
    FROM holding_computed hc
    WHERE bo.id = hc.id
      AND bo.kind = 'allocated'
      AND (
        bo.delta_30d IS NULL OR bo.needs_recompute = TRUE
        OR (bo.delta_90d IS NULL AND bo.allocated_at <= (CURRENT_DATE - '91 days'::interval))
        OR (bo.delta_180d IS NULL AND bo.allocated_at <= (CURRENT_DATE - '181 days'::interval))
      )
      -- A row whose three new deltas are all NULL measured nothing: it is not written,
      -- so it stays needs_recompute TRUE, and holding_failed below counts it.
      AND (hc.d30 IS NOT NULL OR hc.d90 IS NOT NULL OR hc.d180 IS NOT NULL)
      -- A stored delta is kept. A row picked again only because a matured window is still
      -- NULL is written (and counted, and stamped) only when a NULL window actually filled;
      -- a row with needs_recompute set is re-measured, new value first.
      AND (
        bo.needs_recompute = TRUE
        OR (bo.delta_30d  IS NULL AND hc.d30  IS NOT NULL)
        OR (bo.delta_90d  IS NULL AND hc.d90  IS NOT NULL)
        OR (bo.delta_180d IS NULL AND hc.d180 IS NOT NULL)
      )
    RETURNING bo.id
  ),
  -- ---------------- voluntary_add branch (NEW — Phase 10 / H2) ----------------
  -- voluntary_add rows: md.kind='voluntary_add', original_* both NULL,
  -- strategy_id (the suggested strategy) NOT NULL. Match against
  -- strategy_analytics.returns_series the same way the strategy branch does — but
  -- gate on md.kind='voluntary_add' to be unambiguous and avoid double-counting
  -- bridge_recommended rows that the strategy branch already covers. Fix round 1 adds the
  -- allocated_at window conjunct (see the holding branch for why).
  voluntary_add_candidates AS (
    SELECT
      bo.id,
      bo.allocated_at,
      sa.returns_series AS series
    FROM public.bridge_outcomes AS bo
    JOIN public.match_decisions md ON md.id = bo.match_decision_id
    JOIN public.strategy_analytics sa ON sa.strategy_id = bo.strategy_id
    WHERE bo.kind = 'allocated'
      AND bo.allocated_at IS NOT NULL
      AND bo.allocated_at >= (CURRENT_DATE - '365 days'::interval)
      AND (bo.delta_30d IS NULL OR bo.needs_recompute = TRUE)
      AND md.kind = 'voluntary_add'
      AND md.strategy_id IS NOT NULL
      AND md.original_holding_ref IS NULL
      AND md.original_strategy_id IS NULL
  ),
  voluntary_add_computed AS (
    SELECT
      vc.id,
      public.extract_delta(vc.series, vc.allocated_at, 30)  AS d30,
      public.extract_delta(vc.series, vc.allocated_at, 90)  AS d90,
      public.extract_delta(vc.series, vc.allocated_at, 180) AS d180,
      est.bps  AS est_bps,
      est.days AS est_days
    FROM voluntary_add_candidates vc
    LEFT JOIN LATERAL public.extract_estimated(vc.series, vc.allocated_at) AS est ON TRUE
  ),
  voluntary_add_updated AS (
    UPDATE public.bridge_outcomes AS bo
    SET
      delta_30d           = COALESCE(c.d30,      bo.delta_30d),
      delta_90d           = COALESCE(c.d90,      bo.delta_90d),
      delta_180d          = COALESCE(c.d180,     bo.delta_180d),
      estimated_delta_bps = COALESCE(c.est_bps,  bo.estimated_delta_bps),
      estimated_days      = COALESCE(c.est_days, bo.estimated_days),
      needs_recompute     = FALSE,
      deltas_computed_at  = v_started
    FROM voluntary_add_computed c
    WHERE bo.id = c.id
      AND bo.kind = 'allocated'
      AND (bo.delta_30d IS NULL OR bo.needs_recompute = TRUE)
    RETURNING bo.id
  )
  SELECT
    (SELECT COUNT(*)::INT FROM strategy_updated) +
    (SELECT COUNT(*)::INT FROM holding_updated) +
    (SELECT COUNT(*)::INT FROM voluntary_add_updated),
    (SELECT COUNT(*)::INT FROM holding_computed hc
      WHERE hc.d30 IS NULL AND hc.d90 IS NULL AND hc.d180 IS NULL)
  INTO v_updated, v_failed;

  RETURN QUERY SELECT v_updated, v_failed, v_started;
END;
$func$;

COMMENT ON FUNCTION public.compute_bridge_outcome_deltas() IS
  'Daily batch: realized 30/90/180-day deltas for bridge_outcomes where '
  'kind=''allocated'' AND (delta_30d IS NULL OR needs_recompute=TRUE). '
  'Strategy and voluntary_add rows read strategy_analytics.returns_series through '
  'extract_delta; holding rows (Phase 176, D-03/D-05) compound the account''s '
  'flow-neutral derived returns through derived_account_return_over and take only '
  'allocated_at inside the bridge_outcomes_allocated_at_check window; all three '
  'branches take only that window. A holding row stays a candidate while its +90d '
  'or +180d is NULL and old enough, and is written only when a NULL window fills or '
  'needs_recompute is set: a stored delta is kept. '
  'Idempotent - re-run produces no changes once windows populate. '
  'A holding row whose three new deltas are all NULL is not written and is counted in failed_count.';

-- CREATE OR REPLACE keeps existing GRANTs, but this migration re-issues them with full
-- signatures so the ACL never depends on what an earlier definer left behind.
REVOKE ALL ON FUNCTION public.compute_bridge_outcome_deltas() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_bridge_outcome_deltas() TO service_role;

REVOKE ALL ON FUNCTION public.derived_account_return_over(uuid, date, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.derived_account_return_over(uuid, date, integer) TO service_role;

-- ───────────── D-06: the one-time reset onto the derived basis
-- A function, not an inline UPDATE, for the reason 20261014120000 gave for its backfill:
-- it can be called from a gate, with a count to assert on, and it stays after this
-- migration so a re-run is possible. It is idempotent in effect: it sets every holding
-- outcome inside the CHECK window to "not yet measured", and the next 03:00Z run of the
-- batch measures it again. OWNER ONLY: the migration and the gate run as the owner, and
-- no API role has any business wiping stored outcomes, so EXECUTE is revoked from
-- service_role too.
--
-- The population is the holding_candidates population of the re-based batch (the
-- decision names a parseable holding ref and no original strategy) minus its delta guard,
-- plus the window conjunct: any row the batch would measure on the derived basis,
-- whether or not it is measured on the old basis today. Strategy, voluntary_add,
-- rejected and legacy (match_decision_id NULL) rows are never touched. needs_recompute,
-- the three deltas and deltas_computed_at change TOGETHER, so a row is never left
-- half-reset: the batch's COALESCE(new, old) would otherwise keep an old per-symbol value
-- wherever the derived curve lacks a day.
CREATE OR REPLACE FUNCTION public.reset_holding_bridge_outcomes_to_derived_basis()
RETURNS integer
LANGUAGE sql
SET search_path = public, pg_catalog
AS $func$
  WITH u AS (
    UPDATE public.bridge_outcomes AS bo
       SET needs_recompute    = TRUE,
           delta_30d          = NULL,
           delta_90d          = NULL,
           delta_180d         = NULL,
           deltas_computed_at = NULL
      FROM public.match_decisions AS md
     WHERE md.id = bo.match_decision_id
       AND bo.kind = 'allocated'
       AND bo.allocated_at IS NOT NULL
       AND bo.allocated_at >= (CURRENT_DATE - '365 days'::interval)
       AND md.original_strategy_id IS NULL
       AND EXISTS (SELECT 1 FROM public.parse_holding_ref(md.original_holding_ref) AS hp
                    WHERE hp.symbol IS NOT NULL)
    RETURNING bo.id
  )
  SELECT count(*)::integer FROM u
$func$;

COMMENT ON FUNCTION public.reset_holding_bridge_outcomes_to_derived_basis() IS
  'Phase 176 LEGACYRETIRE (D-06): sets needs_recompute = TRUE and NULLs delta_30d, delta_90d, delta_180d and deltas_computed_at together for the holding-measuring bridge_outcomes rows inside the allocated_at CHECK window, so the next compute_bridge_outcome_deltas run measures them on the derived basis. Returns the row count. Owner only.';

REVOKE ALL ON FUNCTION public.reset_holding_bridge_outcomes_to_derived_basis() FROM PUBLIC, anon, authenticated, service_role;

-- The one call, after the re-based batch is in place. No cron statement, no raise. The
-- count of cleared rows is reported as a NOTICE (a count only, no id and no value), so
-- the apply log records how many outcomes were put back to "not measured".
DO $reset$
DECLARE
  v_cleared integer;
BEGIN
  v_cleared := public.reset_holding_bridge_outcomes_to_derived_basis();
  RAISE NOTICE 'Migration 20261102120000: the D-06 reset cleared % holding outcome row(s)', v_cleared;
END
$reset$;

-- ───────────── self-verify: CATALOGUE ONLY, passes on an empty database.
-- No row is read. Deliberately NOT asserted here: the formula lines (the compounding,
-- the every-day-matched and window conditions, the payload filters). A verify block that
-- checked them would abort the apply of a mutated copy of this file, and the SQL gate
-- that mutates those lines needs that apply to succeed in order to go RED on the
-- behaviour instead.
DO $verify$
DECLARE
  v_compute oid := to_regprocedure('public.compute_bridge_outcome_deltas()');
  v_helper  oid := to_regprocedure('public.derived_account_return_over(uuid,date,integer)');
  v_reset   oid := to_regprocedure('public.reset_holding_bridge_outcomes_to_derived_basis()');
  v_n       integer;
  v_secdef  boolean;
  v_cfg     text[];
  v_src     text;
  v_role    text;
BEGIN
  SELECT count(*) INTO v_n
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('compute_bridge_outcome_deltas', 'derived_account_return_over',
                       'reset_holding_bridge_outcomes_to_derived_basis');
  IF v_n <> 3 OR v_compute IS NULL OR v_helper IS NULL OR v_reset IS NULL THEN
    RAISE EXCEPTION 'Migration 20261102120000 failed: expected exactly one each of public.compute_bridge_outcome_deltas(), public.derived_account_return_over(uuid, date, integer) and public.reset_holding_bridge_outcomes_to_derived_basis()';
  END IF;

  SELECT p.prosecdef, p.proconfig, p.prosrc INTO v_secdef, v_cfg, v_src FROM pg_proc p WHERE p.oid = v_compute;
  IF NOT v_secdef THEN
    RAISE EXCEPTION 'Migration 20261102120000 failed: compute_bridge_outcome_deltas must be SECURITY DEFINER';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM unnest(COALESCE(v_cfg, ARRAY[]::text[])) c
                  WHERE regexp_replace(c, '\s', '', 'g') = 'search_path=public,pg_catalog') THEN
    RAISE EXCEPTION 'Migration 20261102120000 failed: compute_bridge_outcome_deltas does not pin search_path to public, pg_catalog';
  END IF;
  v_src := regexp_replace(v_src, '--[^\n]*', '', 'g');
  IF position('derived_account_return_over' IN v_src) = 0 THEN
    RAISE EXCEPTION 'Migration 20261102120000 failed: compute_bridge_outcome_deltas does not call derived_account_return_over';
  END IF;
  IF position('extract_symbol_value_at' IN v_src) > 0 THEN
    RAISE EXCEPTION 'Migration 20261102120000 failed: compute_bridge_outcome_deltas still reads the legacy per-symbol breakdown';
  END IF;

  SELECT p.prosecdef INTO v_secdef FROM pg_proc p WHERE p.oid = v_helper;
  IF v_secdef THEN
    RAISE EXCEPTION 'Migration 20261102120000 failed: derived_account_return_over must be SECURITY INVOKER';
  END IF;

  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_function_privilege(v_role, v_compute, 'EXECUTE') THEN
      RAISE EXCEPTION 'Migration 20261102120000 failed: anon or authenticated can EXECUTE compute_bridge_outcome_deltas';
    END IF;
    IF has_function_privilege(v_role, v_helper, 'EXECUTE') THEN
      RAISE EXCEPTION 'Migration 20261102120000 failed: anon or authenticated can EXECUTE derived_account_return_over';
    END IF;
  END LOOP;
  IF NOT has_function_privilege('service_role', v_compute, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_helper, 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20261102120000 failed: service_role cannot EXECUTE compute_bridge_outcome_deltas or derived_account_return_over';
  END IF;

  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF has_function_privilege(v_role, v_reset, 'EXECUTE') THEN
      RAISE EXCEPTION 'Migration 20261102120000 failed: an API role can EXECUTE reset_holding_bridge_outcomes_to_derived_basis, which is owner only';
    END IF;
  END LOOP;

  RAISE NOTICE 'Migration 20261102120000: compute_bridge_outcome_deltas is SECURITY DEFINER with a pinned search_path and calls derived_account_return_over, not the legacy breakdown; derived_account_return_over is SECURITY INVOKER; none of the three functions is executable by anon or authenticated; the D-06 reset function is owner only.';
END
$verify$;
