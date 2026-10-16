-- ============================================================================
-- okx_archive_rebuild: the durable job kind and the one atomic write the OKX
-- quarterly-archive rebuild needs (2026-10-26, Phase 167.1.2.2.2.1 OKXHISTORY,
-- plan 01; SC-1, SC-2, SC-4, D-01, D-05, D-11, D-12)
-- ============================================================================
--
-- What this is for
-- ----------------
-- Two OKX strategies lost the days older than OKX's 3-month `bills-archive`
-- reach. TRADESYNC named those days in strategy_analytics.series_provenance
-- (`unrecovered_gaps`). OKXHISTORY rebuilds them from OKX's async quarterly
-- `bills-history-archive`, and the rebuilt days COUNT in headline metrics (D-07).
-- Rows that count without the public disclosure that they were rebuilt would be
-- an integrity defect, so rows and disclosure are written by ONE function in ONE
-- transaction, and that is all this migration adds.
--
-- 1. THE KIND. `okx_archive_rebuild` is admitted by THREE sites, all moved here
--    in one transaction and each re-based VERBATIM on the latest declaration
--    (20260717233529, verified the newest ADD CONSTRAINT for both CHECKs):
--      (a) the compute_job_kinds registry row (the compute_jobs.kind FK),
--      (b) compute_jobs_kind_check (the list CHECK; 16 kinds become 17),
--      (c) compute_jobs_kind_target_coherence (one new api_key arm).
--    Copying an older coherence definition would silently drop the
--    derive_broker_dailies api_key arm or the derive_allocator_equity allocator
--    arm and break every per-key derive; the verify block reads both back.
--
--    SC-1: the kind is api_key-scoped ONLY (api_key_id set; strategy_id,
--    portfolio_id, allocator_id NULL). The archive wait is hours long, and a
--    strategy-scoped job would flip a PUBLISHED strategy's computation_status to
--    `computing` for all of it through the status bridge. An api_key-scoped job
--    never reaches the bridge (mark_compute_job_done only calls it when the job
--    carries a strategy_id), so a published strategy is not touched by the wait.
--    A strategy-scoped insert of the kind is refused by the coherence CHECK.
--    No new in-flight index: compute_jobs_one_inflight_per_kind_api_key is
--    kind-agnostic and already allows one job in flight per (api_key_id, kind).
--
-- 2. THE FUNCTION. public.apply_okx_archive_rebuild(p_strategy_id, p_rows,
--    p_expected_gaps, p_expected_gaps_after) RETURNS jsonb, in this order:
--      - shape guards (22023), then the strategy_analytics row is locked FOR UPDATE;
--      - already-applied check (a re-run after success writes nothing and says so);
--      - compare-and-set: the stored unrecovered_gaps must equal p_expected_gaps
--        (P0001 gaps_changed), so a gap that moved since the caller read it is
--        never written over;
--      - containment (D-01): every row date lies inside a stored gap (22023
--        row_outside_gap), so the function can only fill days TRADESYNC named;
--      - INSERT ... ON CONFLICT (strategy_id, date) DO NOTHING RETURNING date
--        (D-12: a live-derived day always wins, byte-identical afterwards);
--      - the new gaps are the stored gap days that STILL have no csv_daily_returns
--        row, collapsed into inclusive islands, and they must equal the caller's
--        own p_expected_gaps_after (P0001 gaps_after_mismatch). A day the call did
--        not cover stays named in unrecovered_gaps and is never zero-filled
--        (TRADESYNC D-02);
--      - ONE UPDATE of series_provenance only, which sets unrecovered_gaps to the
--        narrowed array, appends one {from, to, source, recorded_at} object per
--        island of the days the INSERT actually RETURNED to reconstructed_ranges,
--        and preserves legacy_ranges and every other key. The appended ranges come
--        from the rows the database inserted, never from the caller's claim (D-05).
--    Any refusal raises, and the raise rolls the whole call back, INSERT included
--    (D-11: a refused call writes nothing).
--
--    `source` is the literal 'okx_bills_history_archive' inside the function and
--    never a parameter: it is the string the public reader pins (plan 05).
--
--    SECURITY INVOKER with EXECUTE for service_role only. The one caller is the
--    analytics worker on the service role, which already holds the table grants
--    and bypasses RLS, so INVOKER needs no escalation and its blast radius is the
--    grant itself. The function never raises SQLSTATE 40001: PostgREST re-runs a
--    transaction that raised it without bound (Phase 164.9.3.2), and refusals
--    here are final. Refusals use the house codes 22023 and P0001.
--
-- ⛔ NO DATA CENSUS RUNS INSIDE THIS MIGRATION. Shared TEST holds PROD's
-- catalogue and none of its data, and a failed TEST apply blocks the PROD apply,
-- so the verify block below reads the catalogue only (pg_constraint, pg_proc,
-- has_function_privilege). It verifies the kind through the constraint TEXT,
-- never through compute_job_kinds rows. Nothing is scheduled by this file.
--
-- ⛔ DEPLOY ORDER. Merging supabase/migrations/** applies to TEST and then to PROD
-- with no human stop. Nothing reads or enqueues the new kind until the worker
-- that handles it is deployed and an operator enqueues a job; an OLD worker that
-- claimed an unknown kind would fail it permanently rather than retry.
--
-- Rollback (manual, off the auto-apply path):
-- supabase/migrations/down/20261026120000-rollback.sql
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '3s';

-- ───────────────────────────── 1(a). registry row (idempotent; name is PK)
INSERT INTO compute_job_kinds (name) VALUES ('okx_archive_rebuild')
  ON CONFLICT (name) DO NOTHING;

-- ───────────────────────────── 1(b). compute_jobs_kind_check
-- 20260717233529's 16-kind array VERBATIM with 'okx_archive_rebuild' appended
-- (17 kinds; a strict superset, so no admitted in-flight row can fail the swap).
ALTER TABLE compute_jobs DROP CONSTRAINT IF EXISTS compute_jobs_kind_check;
ALTER TABLE compute_jobs ADD CONSTRAINT compute_jobs_kind_check CHECK (
  kind = ANY (ARRAY[
    'sync_trades'::text,
    'compute_analytics'::text,
    'compute_portfolio'::text,
    'poll_positions'::text,
    'sync_funding'::text,
    'reconcile_strategy'::text,
    'compute_intro_snapshot'::text,
    'rescore_allocator'::text,
    'poll_allocator_positions'::text,
    'reconstruct_allocator_history'::text,
    'refresh_allocator_equity_daily'::text,
    'process_key_long'::text,
    'compute_analytics_from_csv'::text,
    'derive_broker_dailies'::text,
    'stitch_composite'::text,
    'derive_allocator_equity'::text,
    'okx_archive_rebuild'::text            -- 2026-10-26: OKX quarterly-archive rebuild (api_key-scoped, hours-long wait)
  ])
);

COMMENT ON CONSTRAINT compute_jobs_kind_check ON compute_jobs IS
  'Simple list-form kind admission check. 2026-10-26: extended with okx_archive_rebuild (Phase 167.1.2.2.2.1 OKXHISTORY, the OKX quarterly bills-history-archive rebuild; api_key-scoped). Re-based on 20260717233529.';

-- ───────────────────────────── 1(c). compute_jobs_kind_target_coherence
-- 20260717233529's FULL definition VERBATIM (every existing arm byte-for-byte; the
-- strategy arm unchanged so src/__tests__/status-bridge-side-kinds-drift.test.ts,
-- which reads the NEWEST declaration of this CHECK, still parses it) plus ONE new
-- api_key arm for okx_archive_rebuild.
ALTER TABLE compute_jobs DROP CONSTRAINT IF EXISTS compute_jobs_kind_target_coherence;
ALTER TABLE compute_jobs ADD CONSTRAINT compute_jobs_kind_target_coherence CHECK (
  ((kind = 'compute_portfolio') AND (portfolio_id IS NOT NULL) AND (strategy_id IS NULL) AND (allocator_id IS NULL))
  OR ((kind = 'rescore_allocator') AND (allocator_id IS NOT NULL) AND (strategy_id IS NULL) AND (portfolio_id IS NULL))
  OR ((kind = ANY (ARRAY['sync_trades', 'compute_analytics', 'poll_positions', 'sync_funding', 'reconcile_strategy', 'compute_intro_snapshot', 'compute_analytics_from_csv', 'derive_broker_dailies', 'stitch_composite'])) AND (strategy_id IS NOT NULL) AND (portfolio_id IS NULL) AND (allocator_id IS NULL))
  OR ((kind = 'poll_allocator_positions') AND (api_key_id IS NOT NULL) AND (strategy_id IS NULL) AND (portfolio_id IS NULL) AND (allocator_id IS NULL))
  OR ((kind = 'reconstruct_allocator_history') AND (api_key_id IS NOT NULL) AND (strategy_id IS NULL) AND (portfolio_id IS NULL) AND (allocator_id IS NULL))
  OR ((kind = 'refresh_allocator_equity_daily') AND (api_key_id IS NOT NULL) AND (strategy_id IS NULL) AND (portfolio_id IS NULL) AND (allocator_id IS NULL))
  OR ((kind = 'derive_broker_dailies') AND (api_key_id IS NOT NULL) AND (strategy_id IS NULL) AND (portfolio_id IS NULL) AND (allocator_id IS NULL))
  OR ((kind = 'process_key_long') AND (strategy_id IS NOT NULL) AND (portfolio_id IS NULL) AND (allocator_id IS NULL) AND (api_key_id IS NULL))
  -- 2026-07-18 (Phase 115.1): allocator-scoped compose. Same target shape as
  -- rescore_allocator (allocator_id NOT NULL, all other targets NULL).
  OR ((kind = 'derive_allocator_equity') AND (allocator_id IS NOT NULL) AND (strategy_id IS NULL) AND (portfolio_id IS NULL) AND (api_key_id IS NULL))
  -- 2026-10-26 (Phase 167.1.2.2.2.1): api_key-scoped archive rebuild. strategy_id
  -- MUST be NULL (SC-1): a strategy-scoped job would flip a published strategy to
  -- `computing` for the whole archive wait.
  OR ((kind = 'okx_archive_rebuild') AND (api_key_id IS NOT NULL) AND (strategy_id IS NULL) AND (portfolio_id IS NULL) AND (allocator_id IS NULL))
);

COMMENT ON CONSTRAINT compute_jobs_kind_target_coherence ON compute_jobs IS
  'Kind<->target-type coherence. 2026-10-26: okx_archive_rebuild added as an api_key-scoped arm (api_key_id NOT NULL, every other target NULL), so the archive wait never flips a published strategy to computing. Preserves the derive_broker_dailies api_key arm and the derive_allocator_equity allocator arm from 20260717233529 - copying an older def would silently drop them.';

-- ───────────────────────────── 2. the atomic write
-- Schema-qualified CREATE: an unqualified CREATE OR REPLACE resolves against the
-- SESSION search_path and can mint a second function with default privileges.
CREATE OR REPLACE FUNCTION public.apply_okx_archive_rebuild(
  p_strategy_id         uuid,
  p_rows                jsonb,
  p_expected_gaps       jsonb,
  p_expected_gaps_after jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  -- The pinned provenance source (D-05). A literal, never a parameter.
  c_source       CONSTANT text := 'okx_bills_history_archive';
  -- A calendar date string: 1900..2999, ISO, fixed width. Calendar validity (a
  -- day that exists in its month) is checked separately, without casting, because
  -- a cast of 2026-02-30 raises 22008 and a refusal must name the input, not a
  -- datetime error.
  c_date_re      CONSTANT text := '^(19|2[0-9])[0-9]{2}-(0[1-9]|1[0-2])-[0-9]{2}$';
  v_n            integer;
  v_bad          integer;
  v_src          text;
  v_sp           jsonb;     -- stored series_provenance
  v_rtype        text;
  v_stored_raw   jsonb;     -- stored unrecovered_gaps entries (with recorded_at)
  v_stored       jsonb;     -- ... normalised to sorted [{from, to}]
  v_expected     jsonb;     -- p_expected_gaps, normalised
  v_expected_aft jsonb;     -- p_expected_gaps_after, normalised
  v_new_gaps     jsonb;     -- the narrowed gaps in stored form (recorded_at kept)
  v_new_norm     jsonb;     -- ... normalised to sorted [{from, to}]
  v_old_ranges   jsonb;
  v_new_ranges   jsonb;
  v_ranges_added integer;
  v_ins_dates    date[];
  v_ins_n        integer;
  v_now          text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
BEGIN
  -- ===== 1. NULL and type guards. Every guard is NULL-explicit: a three-valued
  --          comparison against a NULL argument is NULL, plpgsql takes the ELSE
  --          branch on a NULL condition, and the guard would silently pass.
  IF p_strategy_id IS NULL THEN
    RAISE EXCEPTION 'apply_okx_archive_rebuild: p_strategy_id is required (got NULL)'
      USING ERRCODE = '22023';
  END IF;
  IF p_rows IS NULL OR p_expected_gaps IS NULL OR p_expected_gaps_after IS NULL THEN
    RAISE EXCEPTION 'apply_okx_archive_rebuild: p_rows, p_expected_gaps and p_expected_gaps_after are all required (got NULL)'
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'apply_okx_archive_rebuild: p_rows must be a JSONB array, got %', jsonb_typeof(p_rows)
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_expected_gaps) <> 'array' THEN
    RAISE EXCEPTION 'apply_okx_archive_rebuild: p_expected_gaps must be a JSONB array, got %', jsonb_typeof(p_expected_gaps)
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_expected_gaps_after) <> 'array' THEN
    RAISE EXCEPTION 'apply_okx_archive_rebuild: p_expected_gaps_after must be a JSONB array, got %', jsonb_typeof(p_expected_gaps_after)
      USING ERRCODE = '22023';
  END IF;

  -- ===== 2. Size guards. At least one row (an empty call cannot be expressed
  --          through this function by contract), at most 1000.
  v_n := jsonb_array_length(p_rows);
  IF v_n < 1 OR v_n > 1000 THEN
    RAISE EXCEPTION 'apply_okx_archive_rebuild: p_rows must carry 1..1000 rows (got %)', v_n
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_expected_gaps) > 1000 OR jsonb_array_length(p_expected_gaps_after) > 1000 THEN
    RAISE EXCEPTION 'apply_okx_archive_rebuild: p_expected_gaps and p_expected_gaps_after may carry at most 1000 entries each (got % and %)',
      jsonb_array_length(p_expected_gaps), jsonb_array_length(p_expected_gaps_after)
      USING ERRCODE = '22023';
  END IF;

  -- ===== 3. Date validity of every row date and every caller gap bound. One
  --          query over the union so a refusal names the FIRST argument at fault.
  --          CASE keeps the evaluation order: the calendar check runs only for a
  --          string that already matched the shape.
  SELECT count(*), min(d.src) INTO v_bad, v_src
    FROM (
      SELECT 'p_rows' AS src,
             CASE WHEN jsonb_typeof(e) = 'object' AND jsonb_typeof(e -> 'date') = 'string' THEN e ->> 'date' END AS s
        FROM jsonb_array_elements(p_rows) e
      UNION ALL
      SELECT 'p_expected_gaps',
             CASE WHEN jsonb_typeof(e) = 'object' AND jsonb_typeof(e -> 'from') = 'string' THEN e ->> 'from' END
        FROM jsonb_array_elements(p_expected_gaps) e
      UNION ALL
      SELECT 'p_expected_gaps',
             CASE WHEN jsonb_typeof(e) = 'object' AND jsonb_typeof(e -> 'to') = 'string' THEN e ->> 'to' END
        FROM jsonb_array_elements(p_expected_gaps) e
      UNION ALL
      SELECT 'p_expected_gaps_after',
             CASE WHEN jsonb_typeof(e) = 'object' AND jsonb_typeof(e -> 'from') = 'string' THEN e ->> 'from' END
        FROM jsonb_array_elements(p_expected_gaps_after) e
      UNION ALL
      SELECT 'p_expected_gaps_after',
             CASE WHEN jsonb_typeof(e) = 'object' AND jsonb_typeof(e -> 'to') = 'string' THEN e ->> 'to' END
        FROM jsonb_array_elements(p_expected_gaps_after) e
    ) d
   WHERE NOT COALESCE(
           CASE WHEN d.s ~ c_date_re THEN
                  substr(d.s, 9, 2)::integer BETWEEN 1 AND
                    extract(day FROM (make_date(substr(d.s, 1, 4)::integer, substr(d.s, 6, 2)::integer, 1)
                                      + interval '1 month' - interval '1 day'))::integer
                ELSE false
           END, false);
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'apply_okx_archive_rebuild: % entries are not calendar dates in YYYY-MM-DD form or lack a date field (first argument at fault: %)', v_bad, v_src
      USING ERRCODE = '22023';
  END IF;

  -- ===== 4. daily_return: a JSON number inside the +/-10 fence that the CSV
  --          finalize path also applies to this table. A JSON number is always
  --          finite (jsonb cannot hold NaN or Infinity); the fence keeps an
  --          out-of-range value from surfacing later as a float cast error.
  SELECT count(*) INTO v_bad
    FROM jsonb_array_elements(p_rows) e
   WHERE NOT COALESCE(
           CASE WHEN jsonb_typeof(e -> 'daily_return') = 'number'
                THEN abs((e ->> 'daily_return')::numeric) <= 10
                ELSE false
           END, false);
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'apply_okx_archive_rebuild: % rows carry a daily_return that is not a finite number within +/-10', v_bad
      USING ERRCODE = '22023';
  END IF;

  -- ===== 5. No duplicate date inside one payload (it would raise 23505 on the
  --          unique index, a code that looks like a double submit).
  SELECT count(*) - count(DISTINCT e ->> 'date') INTO v_bad FROM jsonb_array_elements(p_rows) e;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'apply_okx_archive_rebuild: p_rows repeats a date (% duplicate rows)', v_bad
      USING ERRCODE = '22023';
  END IF;

  -- ===== 6. A caller gap must end on or after its start.
  SELECT count(*) INTO v_bad
    FROM (SELECT e FROM jsonb_array_elements(p_expected_gaps) e
          UNION ALL SELECT e FROM jsonb_array_elements(p_expected_gaps_after) e) g
   WHERE (g.e ->> 'from')::date > (g.e ->> 'to')::date;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'apply_okx_archive_rebuild: % caller gaps end before they start', v_bad
      USING ERRCODE = '22023';
  END IF;

  -- ===== 7. Lock the strategy_analytics row. Two concurrent calls for one
  --          strategy then run one after the other, and the second reads the gaps
  --          the first left (or loses the compare-and-set below).
  SELECT sa.series_provenance INTO v_sp
    FROM public.strategy_analytics sa
   WHERE sa.strategy_id = p_strategy_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'apply_okx_archive_rebuild: no strategy_analytics row exists for the given strategy'
      USING ERRCODE = '22023';
  END IF;

  -- The stored unrecovered_gaps. A non-array or absent value reads as empty, as
  -- the public reader does. A malformed ENTRY is refused: it cannot be reasoned
  -- about, and guessing would write over a record nobody can read.
  v_stored_raw := CASE WHEN jsonb_typeof(v_sp -> 'unrecovered_gaps') = 'array'
                       THEN v_sp -> 'unrecovered_gaps' ELSE '[]'::jsonb END;
  SELECT count(*) INTO v_bad
    FROM (
      SELECT CASE WHEN jsonb_typeof(e) = 'object' AND jsonb_typeof(e -> 'from') = 'string' THEN e ->> 'from' END AS s
        FROM jsonb_array_elements(v_stored_raw) e
      UNION ALL
      SELECT CASE WHEN jsonb_typeof(e) = 'object' AND jsonb_typeof(e -> 'to') = 'string' THEN e ->> 'to' END
        FROM jsonb_array_elements(v_stored_raw) e
    ) d
   WHERE NOT COALESCE(
           CASE WHEN d.s ~ c_date_re THEN
                  substr(d.s, 9, 2)::integer BETWEEN 1 AND
                    extract(day FROM (make_date(substr(d.s, 1, 4)::integer, substr(d.s, 6, 2)::integer, 1)
                                      + interval '1 month' - interval '1 day'))::integer
                ELSE false
           END, false);
  IF v_bad = 0 THEN
    SELECT count(*) INTO v_bad
      FROM jsonb_array_elements(v_stored_raw) e
     WHERE (e ->> 'from')::date > (e ->> 'to')::date;
  END IF;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'apply_okx_archive_rebuild: stored_gaps_malformed - % stored unrecovered_gaps entries are not valid ranges', v_bad
      USING ERRCODE = '22023';
  END IF;

  -- A reconstructed_ranges value that is present but not an array is refused, not
  -- overwritten: appending would destroy a record the reader may still need.
  v_rtype := jsonb_typeof(v_sp -> 'reconstructed_ranges');
  IF v_rtype IS NOT NULL AND v_rtype NOT IN ('array', 'null') THEN
    RAISE EXCEPTION 'apply_okx_archive_rebuild: stored reconstructed_ranges is a JSON %, not an array', v_rtype
      USING ERRCODE = '22023';
  END IF;
  v_old_ranges := CASE WHEN v_rtype = 'array' THEN v_sp -> 'reconstructed_ranges' ELSE '[]'::jsonb END;

  -- Normalise the three gap lists to sorted [{from, to}] so the comparisons below
  -- are order-insensitive and ignore recorded_at.
  v_stored := COALESCE((
    SELECT jsonb_agg(jsonb_build_object('from', e ->> 'from', 'to', e ->> 'to')
                     ORDER BY (e ->> 'from') COLLATE "C", (e ->> 'to') COLLATE "C")
      FROM jsonb_array_elements(v_stored_raw) e), '[]'::jsonb);
  v_expected := COALESCE((
    SELECT jsonb_agg(jsonb_build_object('from', e ->> 'from', 'to', e ->> 'to')
                     ORDER BY (e ->> 'from') COLLATE "C", (e ->> 'to') COLLATE "C")
      FROM jsonb_array_elements(p_expected_gaps) e), '[]'::jsonb);
  v_expected_aft := COALESCE((
    SELECT jsonb_agg(jsonb_build_object('from', e ->> 'from', 'to', e ->> 'to')
                     ORDER BY (e ->> 'from') COLLATE "C", (e ->> 'to') COLLATE "C")
      FROM jsonb_array_elements(p_expected_gaps_after) e), '[]'::jsonb);

  -- ===== 8. Already applied: every row date already has a csv_daily_returns row
  --          AND lies inside a stored reconstructed_ranges entry carrying THIS
  --          source. A re-run after success writes nothing and says so, with a
  --          status that cannot be mistaken for a refusal. Checked BEFORE the
  --          compare-and-set, because after a success the stored gaps have moved.
  --          Range bounds compare as text (fixed-width ISO sorts chronologically,
  --          COLLATE "C" removes any locale effect), so a malformed stored range
  --          is skipped rather than raising.
  SELECT count(*) INTO v_n
    FROM jsonb_array_elements(p_rows) e
   WHERE EXISTS (SELECT 1 FROM public.csv_daily_returns c
                  WHERE c.strategy_id = p_strategy_id AND c.date = (e ->> 'date')::date)
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_old_ranges) r
                  WHERE r ->> 'source' = c_source
                    AND (r ->> 'from') ~ c_date_re
                    AND (r ->> 'to') ~ c_date_re
                    AND (e ->> 'date') >= (r ->> 'from') COLLATE "C"
                    AND (e ->> 'date') <= (r ->> 'to') COLLATE "C");
  IF v_n = jsonb_array_length(p_rows) THEN
    RETURN jsonb_build_object('status', 'already_applied', 'inserted', 0, 'ranges_added', 0,
                              'gaps_before', v_stored, 'gaps_after', v_stored);
  END IF;

  -- ===== 9. Compare-and-set: the stored gaps must be the ones the caller read.
  IF v_stored IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'apply_okx_archive_rebuild: gaps_changed - the stored unrecovered_gaps (% ranges) differ from p_expected_gaps (% ranges); nothing was written',
      jsonb_array_length(v_stored), jsonb_array_length(v_expected)
      USING ERRCODE = 'P0001';
  END IF;

  -- ===== 10. Containment (D-01): every row date lies inside a stored gap. One
  --           row outside rolls the whole call back; the function can only fill
  --           days TRADESYNC named.
  SELECT count(*), min(e ->> 'date') INTO v_bad, v_src
    FROM jsonb_array_elements(p_rows) e
   WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_stored) g
                      WHERE (e ->> 'date')::date BETWEEN (g ->> 'from')::date AND (g ->> 'to')::date);
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'apply_okx_archive_rebuild: row_outside_gap - % rows lie outside every stored gap (earliest: %); nothing was written', v_bad, v_src
      USING ERRCODE = '22023';
  END IF;

  -- ===== 11. The rows. D-12: a day that already has a row keeps it untouched.
  --           RETURNING date is the ONLY source of the reconstructed ranges.
  WITH ins AS (
    INSERT INTO public.csv_daily_returns (strategy_id, date, daily_return)
    SELECT p_strategy_id, (e ->> 'date')::date, (e ->> 'daily_return')::double precision
      FROM jsonb_array_elements(p_rows) e
    ON CONFLICT (strategy_id, date) DO NOTHING
    RETURNING date
  )
  SELECT array_agg(ins.date ORDER BY ins.date), count(*) INTO v_ins_dates, v_ins_n FROM ins;

  -- ===== 12. The narrowed gaps: for each stored gap, the days that still have no
  --           row, collapsed into inclusive islands. recorded_at of the stored
  --           gap rides along. A day nothing covered stays named.
  WITH g AS (
    SELECT gx.gi,
           (gx.x ->> 'from')::date AS f,
           (gx.x ->> 'to')::date   AS t,
           gx.x -> 'recorded_at'   AS ra
      FROM jsonb_array_elements(v_stored_raw) WITH ORDINALITY AS gx(x, gi)
  ), days AS (
    SELECT g.gi, g.ra, g.f + s.n AS d
      FROM g CROSS JOIN LATERAL generate_series(0, g.t - g.f) AS s(n)
     WHERE NOT EXISTS (SELECT 1 FROM public.csv_daily_returns c
                        WHERE c.strategy_id = p_strategy_id AND c.date = g.f + s.n)
  ), isl AS (
    SELECT days.gi, days.ra, days.d,
           days.d - (row_number() OVER (PARTITION BY days.gi ORDER BY days.d))::integer AS grp
      FROM days
  ), spans AS (
    SELECT isl.gi, isl.ra, min(isl.d) AS f, max(isl.d) AS t FROM isl GROUP BY isl.gi, isl.ra, isl.grp
  )
  SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                   'from', to_char(spans.f, 'YYYY-MM-DD'),
                   'to', to_char(spans.t, 'YYYY-MM-DD'),
                   'recorded_at', spans.ra)) ORDER BY spans.f, spans.t), '[]'::jsonb)
    INTO v_new_gaps
    FROM spans;
  v_new_norm := COALESCE((
    SELECT jsonb_agg(jsonb_build_object('from', e ->> 'from', 'to', e ->> 'to')
                     ORDER BY (e ->> 'from') COLLATE "C", (e ->> 'to') COLLATE "C")
      FROM jsonb_array_elements(v_new_gaps) e), '[]'::jsonb);

  -- The caller computed the same thing on its own side. A difference means the
  -- two disagree about which days are covered, and the INSERT above rolls back
  -- with this raise (D-11).
  IF v_new_norm IS DISTINCT FROM v_expected_aft THEN
    RAISE EXCEPTION 'apply_okx_archive_rebuild: gaps_after_mismatch - the narrowed gaps (% ranges) differ from p_expected_gaps_after (% ranges); nothing was written',
      jsonb_array_length(v_new_norm), jsonb_array_length(v_expected_aft)
      USING ERRCODE = 'P0001';
  END IF;

  -- ===== 13. The reconstructed ranges: one per island of the days the INSERT
  --           returned. Nothing inserted, nothing appended.
  WITH ins AS (
    SELECT u.d, u.d - (row_number() OVER (ORDER BY u.d))::integer AS grp
      FROM unnest(COALESCE(v_ins_dates, ARRAY[]::date[])) AS u(d)
  ), spans AS (
    SELECT min(ins.d) AS f, max(ins.d) AS t FROM ins GROUP BY ins.grp
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
                   'from', to_char(spans.f, 'YYYY-MM-DD'),
                   'to', to_char(spans.t, 'YYYY-MM-DD'),
                   'source', c_source,
                   'recorded_at', v_now) ORDER BY spans.f), '[]'::jsonb),
         count(*)
    INTO v_new_ranges, v_ranges_added
    FROM spans;

  -- ===== 14. The ONE provenance write. jsonb_set touches only the keys named,
  --           so legacy_ranges and every other key survive; a NULL column starts
  --           from an empty object (the table CHECK wants an object or NULL).
  v_sp := jsonb_set(COALESCE(v_sp, '{}'::jsonb), '{unrecovered_gaps}', v_new_gaps, true);
  IF v_ranges_added > 0 THEN
    v_sp := jsonb_set(v_sp, '{reconstructed_ranges}', v_old_ranges || v_new_ranges, true);
  END IF;
  UPDATE public.strategy_analytics
     SET series_provenance = v_sp
   WHERE strategy_id = p_strategy_id;

  RETURN jsonb_build_object('status', 'applied', 'inserted', v_ins_n, 'ranges_added', v_ranges_added,
                            'gaps_before', v_stored, 'gaps_after', v_new_norm);
END;
$fn$;

REVOKE ALL ON FUNCTION public.apply_okx_archive_rebuild(uuid, jsonb, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_okx_archive_rebuild(uuid, jsonb, jsonb, jsonb)
  TO service_role;

COMMENT ON FUNCTION public.apply_okx_archive_rebuild(uuid, jsonb, jsonb, jsonb) IS
  'Phase 167.1.2.2.2.1 OKXHISTORY. The one atomic write of the OKX quarterly-archive rebuild: inserts the rebuilt csv_daily_returns rows (ON CONFLICT (strategy_id, date) DO NOTHING, so a live day always wins), narrows strategy_analytics.series_provenance.unrecovered_gaps to the gap days that still have no row, and appends reconstructed_ranges entries {from, to, source okx_bills_history_archive, recorded_at} derived from the rows the INSERT returned, in ONE transaction. Compare-and-set on the stored gaps (p_expected_gaps) and on the caller''s own narrowed gaps (p_expected_gaps_after). Returns {status applied|already_applied, inserted, ranges_added, gaps_before, gaps_after}. ERRCODE map: 22023 = malformed input, missing strategy_analytics row, a row outside every stored gap (row_outside_gap), malformed stored gaps (stored_gaps_malformed); P0001 = gaps_changed (compare-and-set) or gaps_after_mismatch. Never 40001 (PostgREST re-runs it without bound). Messages carry dates and counts only. SECURITY INVOKER; EXECUTE for service_role only.';

-- ───────────── 3. self-verify: CATALOGUE ONLY, passes on an empty database.
-- No row is read: the kind is verified through the constraint TEXT, never
-- through compute_job_kinds rows, and nothing here is data-dependent.
DO $verify$
DECLARE
  v_kind_check text;
  v_coherence  text;
  v_n          integer;
  v_oid        oid := to_regprocedure('public.apply_okx_archive_rebuild(uuid,jsonb,jsonb,jsonb)');
  v_secdef     boolean;
  v_cfg        text[];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_kind_check
    FROM pg_constraint
   WHERE conrelid = 'public.compute_jobs'::regclass AND conname = 'compute_jobs_kind_check';
  IF v_kind_check IS NULL OR position('okx_archive_rebuild' IN v_kind_check) = 0 THEN
    RAISE EXCEPTION 'Migration 20261026120000 failed: okx_archive_rebuild is not admitted by compute_jobs_kind_check';
  END IF;
  -- Re-base regression: every earlier arm of the list must survive.
  IF position('derive_broker_dailies' IN v_kind_check) = 0
     OR position('process_key_long' IN v_kind_check) = 0
     OR position('stitch_composite' IN v_kind_check) = 0
     OR position('derive_allocator_equity' IN v_kind_check) = 0 THEN
    RAISE EXCEPTION 'Migration 20261026120000 failed: a kind regressed out of compute_jobs_kind_check (re-base dropped it)';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_coherence
    FROM pg_constraint
   WHERE conrelid = 'public.compute_jobs'::regclass AND conname = 'compute_jobs_kind_target_coherence';
  IF v_coherence IS NULL OR position('okx_archive_rebuild' IN v_coherence) = 0 THEN
    RAISE EXCEPTION 'Migration 20261026120000 failed: the okx_archive_rebuild arm is missing from compute_jobs_kind_target_coherence';
  END IF;
  IF v_coherence NOT LIKE '%derive_broker_dailies%api_key_id IS NOT NULL%' THEN
    RAISE EXCEPTION 'Migration 20261026120000 failed: the derive_broker_dailies api_key arm regressed out of compute_jobs_kind_target_coherence (re-base dropped it)';
  END IF;
  IF position('process_key_long' IN v_coherence) = 0 THEN
    RAISE EXCEPTION 'Migration 20261026120000 failed: the process_key_long branch regressed out of compute_jobs_kind_target_coherence';
  END IF;
  IF position('stitch_composite' IN v_coherence) = 0 THEN
    RAISE EXCEPTION 'Migration 20261026120000 failed: stitch_composite regressed out of compute_jobs_kind_target_coherence';
  END IF;
  IF position('derive_allocator_equity' IN v_coherence) = 0 THEN
    RAISE EXCEPTION 'Migration 20261026120000 failed: the derive_allocator_equity allocator arm regressed out of compute_jobs_kind_target_coherence';
  END IF;

  -- The function: exactly one overload, the exact argument list.
  SELECT count(*) INTO v_n
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'apply_okx_archive_rebuild';
  IF v_n <> 1 OR v_oid IS NULL THEN
    RAISE EXCEPTION 'Migration 20261026120000 failed: expected exactly one public.apply_okx_archive_rebuild(uuid, jsonb, jsonb, jsonb), found % overloads', v_n;
  END IF;

  SELECT p.prosecdef, p.proconfig INTO v_secdef, v_cfg FROM pg_proc p WHERE p.oid = v_oid;
  IF v_secdef THEN
    RAISE EXCEPTION 'Migration 20261026120000 failed: apply_okx_archive_rebuild must be SECURITY INVOKER';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM unnest(COALESCE(v_cfg, ARRAY[]::text[])) c
                  WHERE regexp_replace(c, '\s', '', 'g') = 'search_path=public,pg_catalog') THEN
    RAISE EXCEPTION 'Migration 20261026120000 failed: apply_okx_archive_rebuild does not pin search_path to public, pg_catalog';
  END IF;

  -- The grantee set: service_role only.
  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20261026120000 failed: anon or authenticated can EXECUTE apply_okx_archive_rebuild';
  END IF;
  IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20261026120000 failed: service_role cannot EXECUTE apply_okx_archive_rebuild';
  END IF;

  RAISE NOTICE 'Migration 20261026120000: okx_archive_rebuild admitted by compute_jobs_kind_check and by the api_key arm of compute_jobs_kind_target_coherence (re-base regression clear); public.apply_okx_archive_rebuild(uuid, jsonb, jsonb, jsonb) is the only overload, SECURITY INVOKER, search_path pinned, EXECUTE for service_role only.';
END
$verify$;

COMMIT;
