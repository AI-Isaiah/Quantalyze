-- ============================================================================
-- ROLLBACK for 20261104120000_drop_allocator_equity_snapshots.sql
-- Phase 176 LEGACYRETIRE, plan 13 (D-02).
-- ============================================================================
-- Manual, off the auto-apply path. What it undoes:
--   1. Re-creates public.allocator_equity_snapshots EMPTY: its columns and CHECKs,
--      primary key, descending-asof index, foreign key to auth.users, row level
--      security, the three policies, the table comments and the table grants, all
--      copied from supabase/schema/baseline.sql.
--   2. Re-creates the four dropped functions at their latest definitions, with
--      their ACL and comment: replace_allocator_equity_snapshots and
--      replace_allocator_equity_snapshots_window (20261028120000),
--      extract_symbol_value_at (20260421154030) and
--      enqueue_refresh_allocator_equity_for_all (20261021120000).
--   3. Restores the 20261028120000 body of public.delete_allocator_api_key(uuid,
--      boolean), i.e. with its Step 4 last-key cascade that deletes the allocator's
--      snapshot rows and its snapshot_rebuild_boundary row. Signature, SECURITY
--      DEFINER, search_path, lock_timeout and the ACL are the same in both versions.
--
-- ⚠️ NO ROW IS RESTORED. The drop destroyed the table's rows and this file creates
-- the table empty. The pre-drop row count was recorded, as counts only, in the
-- SUMMARY of plan 16; the rows themselves are not recoverable from this file. The
-- snapshot_rebuild_boundary rows the migration deleted from allocator_equity_derived
-- are not restored either.
--
-- ⚠️ THE REFRESH CRON IS NOT RE-CREATED. refresh-allocator-equity was unscheduled by
-- hand on PROD before this migration (plan 12) and is not a migration object. After
-- this rollback the fan-out function exists again but nothing calls it until the
-- `reschedule-refresh` form of the Phase 176 go-live runbook is run by hand.
--
-- ⚠️ THE MIGRATION LEDGER ROW IS LEFT IN PLACE. This file does not touch
-- supabase_migrations.schema_migrations, so after it runs the ledger still records
-- version 20261104120000 as applied while the schema no longer carries it, and
-- `supabase db push` will not re-apply the migration. To re-apply it, delete that
-- ledger row in the same change (or mark it reverted with
-- `supabase migration repair --status reverted 20261104120000` against the intended
-- database, after the marker query in CLAUDE.md names that database).
--
-- The DO block before the change is a catalogue-only PRECONDITION: it refuses, before
-- anything changes, on a database that still holds the table (so it carries nothing to
-- roll back). The DO block after the change is catalogue-only too and aborts the whole
-- rollback if the table or any of the four functions is missing. Neither reads a row.
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '3s';

-- ───────────── precondition — CATALOGUE ONLY, reads no row
DO $precondition$
BEGIN
  IF to_regclass('public.allocator_equity_snapshots') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback 20261104120000 refused: public.allocator_equity_snapshots already exists, so this database does not carry 20261104120000. Nothing was changed. Run the marker query in CLAUDE.md to see which database this is.';
  END IF;
END
$precondition$;

-- ───────────── 1. The table, empty, as the baseline carries it.

CREATE TABLE "public"."allocator_equity_snapshots" (
    "allocator_id" "uuid" NOT NULL,
    "asof" "date" NOT NULL,
    "value_usd" numeric NOT NULL,
    "breakdown" "jsonb",
    "reconstructed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "source" "text" DEFAULT 'exchange_primary'::"text" NOT NULL,
    "history_depth_months" integer,
    "pre_terminus_balance_unknown" boolean DEFAULT false NOT NULL,
    CONSTRAINT "allocator_equity_snapshots_history_depth_check" CHECK ((("history_depth_months" IS NULL) OR ("history_depth_months" > 0))),
    CONSTRAINT "allocator_equity_snapshots_source_check" CHECK (("source" = ANY (ARRAY['exchange_primary'::"text", 'coingecko_fallback'::"text", 'mixed'::"text"])))
);

ALTER TABLE "public"."allocator_equity_snapshots" OWNER TO "postgres";

ALTER TABLE ONLY "public"."allocator_equity_snapshots"
    ADD CONSTRAINT "allocator_equity_snapshots_pkey" PRIMARY KEY ("allocator_id", "asof");

CREATE INDEX "allocator_equity_snapshots_allocator_asof_desc_idx" ON "public"."allocator_equity_snapshots" USING "btree" ("allocator_id", "asof" DESC);

ALTER TABLE ONLY "public"."allocator_equity_snapshots"
    ADD CONSTRAINT "allocator_equity_snapshots_allocator_id_fkey" FOREIGN KEY ("allocator_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

ALTER TABLE "public"."allocator_equity_snapshots" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allocator_equity_snapshots_admin_select" ON "public"."allocator_equity_snapshots" FOR SELECT USING ("public"."current_user_has_app_role"(ARRAY['admin'::"text"]));

CREATE POLICY "allocator_equity_snapshots_owner_select" ON "public"."allocator_equity_snapshots" FOR SELECT USING (("allocator_id" = "auth"."uid"()));

CREATE POLICY "allocator_equity_snapshots_service_all" ON "public"."allocator_equity_snapshots" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));

COMMENT ON TABLE "public"."allocator_equity_snapshots" IS 'Per-allocator per-day reconstructed equity series. Written by FastAPI worker (service_role). Phase 07 / D-02. history_depth_months added per VOICES-ACCEPTED f9 to surface venue-specific warm-up copy.';

COMMENT ON COLUMN "public"."allocator_equity_snapshots"."history_depth_months" IS 'Per-venue retention cap in months at time of reconstruction. Binance=24, OKX=3 (trades) / 24 (OHLCV), Bybit=24. NULL for CoinGecko fallback. Used by getMyAllocationDashboard to compute minHistoryDepthMonths for venue-specific KpiStrip warm-up messaging.';

COMMENT ON COLUMN "public"."allocator_equity_snapshots"."pre_terminus_balance_unknown" IS 'CL9 / NEW-C01-11: true when this row was reconstructed against an unknown absolute baseline (OKX 90-day terminus clamped the funding deposit out of the fetch window), so its absolute equity level — and any drawdown / TWR derived from it — is unreliable. getMyAllocationDashboard excludes flagged rows from level-derived surfaces. Daily-refresh rows (today''s live mark) and all pre-existing rows are false. Written by the analytics worker (service_role) only.';

GRANT SELECT,INSERT,REFERENCES,DELETE,UPDATE ON TABLE "public"."allocator_equity_snapshots" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,UPDATE ON TABLE "public"."allocator_equity_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."allocator_equity_snapshots" TO "service_role";

-- ───────────── 2. The four functions, at their latest definitions.

-- replace_allocator_equity_snapshots: 20261028120000 (with the WR-01 boundary DELETE).
CREATE OR REPLACE FUNCTION public.replace_allocator_equity_snapshots(
  p_allocator_id UUID,
  p_rows         JSONB,    -- array of {asof, value_usd, breakdown, source, pre_terminus_balance_unknown}
  p_depth_months INTEGER   -- per WR-05: applied only to source='exchange_primary' rows
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '3s'
AS $$
DECLARE
  v_inserted INTEGER;
BEGIN
  -- H-1186: serialize against delete_allocator_api_key on the same per-allocator
  -- key so a concurrent last-key cascade cannot interleave with this replace.
  PERFORM pg_advisory_xact_lock(hashtext('alloc:' || p_allocator_id::text));

  -- 1. Purge — strictly scoped to this allocator.
  DELETE FROM public.allocator_equity_snapshots
    WHERE allocator_id = p_allocator_id;

  -- 1b. WR-01: the whole history was replaced, so a recorded rebuild seam names a
  --     jump that is no longer in the stored series. Clear it.
  DELETE FROM public.allocator_equity_derived rb
   WHERE rb.allocator_id = p_allocator_id
     AND rb.kind = 'snapshot_rebuild_boundary';

  -- 2. Insert the freshly replayed rows. jsonb_to_recordset projects the
  --    array; reconstructed_at uses the column DEFAULT (now()). The CASE on
  --    source mirrors persist_equity_snapshots' WR-05 per-row depth rule.
  --    CL9: pre_terminus_balance_unknown is projected too; COALESCE to false
  --    keeps a pre-deploy worker (payload omits the field) NOT-NULL-safe.
  WITH ins AS (
    INSERT INTO public.allocator_equity_snapshots (
      allocator_id, asof, value_usd, breakdown, source, history_depth_months,
      pre_terminus_balance_unknown
    )
    SELECT
      p_allocator_id,
      r.asof,
      r.value_usd,
      r.breakdown,
      r.source,
      CASE WHEN r.source = 'exchange_primary' THEN p_depth_months ELSE NULL END,
      COALESCE(r.pre_terminus_balance_unknown, false)
    FROM jsonb_to_recordset(COALESCE(p_rows, '[]'::jsonb)) AS r(
      asof                          DATE,
      value_usd                     NUMERIC,
      breakdown                     JSONB,
      source                        TEXT,
      pre_terminus_balance_unknown  BOOLEAN
    )
    ON CONFLICT (allocator_id, asof) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_inserted FROM ins;

  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_allocator_equity_snapshots(uuid, jsonb, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_allocator_equity_snapshots(uuid, jsonb, integer)
  TO service_role;

COMMENT ON FUNCTION public.replace_allocator_equity_snapshots(uuid, jsonb, integer) IS
  'Atomic sole-key equity-history replacement: per-allocator advisory-lock (H-1186) then DELETE all rows for p_allocator_id, DELETE the allocator''s snapshot_rebuild_boundary row from allocator_equity_derived (ACCTREBUILD review WR-01: the seam it named is gone with the wiped days), then INSERT p_rows in ONE transaction (E4/HIGH8). Serializes with delete_allocator_api_key on hashtext(''alloc:''||allocator). Per-row history_depth_months mirrors persist_equity_snapshots WR-05; persists pre_terminus_balance_unknown (CL9/NEW-C01-11, COALESCE to false). service_role only.';

-- replace_allocator_equity_snapshots_window: 20261028120000.
CREATE OR REPLACE FUNCTION public.replace_allocator_equity_snapshots_window(
  p_allocator_id uuid,
  p_rows         jsonb,     -- array of {asof, value_usd, breakdown, source, pre_terminus_balance_unknown}
  p_depth_months integer,   -- WR-05: applied only to source = 'exchange_primary' rows
  p_window_start date       -- the first day the payload replaces; older days are kept
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '3s'
AS $fn$
DECLARE
  v_inserted     integer;
  v_seam         date;
  v_unreproduced integer;
  v_bad          integer;
BEGIN
  -- ===== 1. NULL-explicit guards. A comparison against a NULL argument is NULL,
  --          plpgsql takes the ELSE branch on a NULL condition, and a guard
  --          written as `x <> y` would silently pass; each test below is spelled
  --          IS NULL or IS DISTINCT FROM so a NULL can never get through.
  IF p_allocator_id IS NULL THEN
    RAISE EXCEPTION 'replace_allocator_equity_snapshots_window: allocator_required'
      USING ERRCODE = '22023';
  END IF;
  IF p_window_start IS NULL THEN
    RAISE EXCEPTION 'replace_allocator_equity_snapshots_window: window_start_required'
      USING ERRCODE = '22023';
  END IF;
  -- Nested on purpose: plpgsql does not promise short-circuit evaluation, and
  -- jsonb_array_length raises on a non-array.
  IF p_rows IS NULL THEN
    RAISE EXCEPTION 'replace_allocator_equity_snapshots_window: rows_not_a_nonempty_array'
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'replace_allocator_equity_snapshots_window: rows_not_a_nonempty_array'
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'replace_allocator_equity_snapshots_window: rows_not_a_nonempty_array'
      USING ERRCODE = '22023';
  END IF;

  -- An element with no asof, or a JSON null asof (an element that is not an
  -- object has no asof either: `->` on a scalar is SQL NULL).
  SELECT count(*) INTO v_bad
    FROM jsonb_array_elements(p_rows) e
   WHERE (e -> 'asof') IS NULL OR jsonb_typeof(e -> 'asof') = 'null';
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'replace_allocator_equity_snapshots_window: row_asof_missing'
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_bad
    FROM jsonb_to_recordset(p_rows) AS r(asof date)
   WHERE r.asof < p_window_start;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'replace_allocator_equity_snapshots_window: row_before_window'
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*) - count(DISTINCT r.asof) INTO v_bad
    FROM jsonb_to_recordset(p_rows) AS r(asof date);
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'replace_allocator_equity_snapshots_window: duplicate_asof'
      USING ERRCODE = '22023';
  END IF;

  -- ===== 2. H-1186: serialize against delete_allocator_api_key and against
  --          replace_allocator_equity_snapshots on the same per-allocator key, so
  --          a concurrent last-key cascade cannot interleave with this replace.
  PERFORM pg_advisory_xact_lock(hashtext('alloc:' || p_allocator_id::text));

  -- ===== 3. D-02. The purge of the window and the check of what it purged are
  --          ONE statement: the days compared are the days the DELETE returned,
  --          not a read taken earlier. NOT EXISTS, never NOT IN, so a NULL can
  --          never hide a day. A day the payload does not carry raises, and the
  --          raise rolls the DELETE back with everything else.
  WITH del AS (
    DELETE FROM public.allocator_equity_snapshots s
     WHERE s.allocator_id = p_allocator_id
       AND s.asof >= p_window_start
    RETURNING s.asof
  )
  SELECT count(*) INTO v_unreproduced
    FROM del d
   WHERE NOT EXISTS (
           SELECT 1
             FROM jsonb_to_recordset(p_rows) AS r(asof date)
            WHERE r.asof = d.asof);
  IF v_unreproduced > 0 THEN
    RAISE EXCEPTION 'history_days_unreproduced' USING ERRCODE = 'P0001', DETAIL = v_unreproduced::text;
  END IF;

  -- ===== 4. Insert the rebuilt window. Re-based VERBATIM on the projection of
  --          replace_allocator_equity_snapshots (20260602183000): the seven
  --          columns, the WR-05 depth rule, and CL9's pre_terminus_balance_unknown
  --          with COALESCE to false. Dropping the CL9 column would silently revert
  --          NEW-C01-11 and re-expose the OKX-terminus garbage equity curve.
  WITH ins AS (
    INSERT INTO public.allocator_equity_snapshots (
      allocator_id, asof, value_usd, breakdown, source, history_depth_months,
      pre_terminus_balance_unknown
    )
    SELECT
      p_allocator_id,
      r.asof,
      r.value_usd,
      r.breakdown,
      r.source,
      CASE WHEN r.source = 'exchange_primary' THEN p_depth_months ELSE NULL END,
      COALESCE(r.pre_terminus_balance_unknown, false)
    FROM jsonb_to_recordset(p_rows) AS r(
      asof                          DATE,
      value_usd                     NUMERIC,
      breakdown                     JSONB,
      source                        TEXT,
      pre_terminus_balance_unknown  BOOLEAN
    )
    ON CONFLICT (allocator_id, asof) DO NOTHING
    RETURNING asof
  )
  SELECT count(*), min(asof) INTO v_inserted, v_seam FROM ins;

  -- ===== 5. D-03. The seam. A row older than the window that is still there is
  --          a kept day, and the first inserted day is where the rebuilt days
  --          begin (the payload may start after p_window_start). A seam already
  --          recorded is kept while it lies before this call's first inserted day
  --          and a stored day still precedes it: the earlier call's rebuilt days
  --          were kept, so the jump is still where that call put it.
  IF EXISTS (SELECT 1
               FROM public.allocator_equity_snapshots s
              WHERE s.allocator_id = p_allocator_id
                AND s.asof < p_window_start) THEN
    INSERT INTO public.allocator_equity_derived (allocator_id, kind, payload)
    VALUES (p_allocator_id, 'snapshot_rebuild_boundary',
            jsonb_build_object('boundary_date', to_char(v_seam, 'YYYY-MM-DD')))
    ON CONFLICT (allocator_id, kind)
    DO UPDATE SET payload = CASE
                    WHEN (allocator_equity_derived.payload ->> 'boundary_date')::date < v_seam
                     AND EXISTS (SELECT 1
                                   FROM public.allocator_equity_snapshots s
                                  WHERE s.allocator_id = p_allocator_id
                                    AND s.asof < (allocator_equity_derived.payload ->> 'boundary_date')::date)
                    THEN allocator_equity_derived.payload
                    ELSE EXCLUDED.payload
                  END,
                  computed_at = now();
  ELSE
    DELETE FROM public.allocator_equity_derived d
     WHERE d.allocator_id = p_allocator_id
       AND d.kind = 'snapshot_rebuild_boundary';
  END IF;

  RETURN v_inserted;
END;
$fn$;

REVOKE ALL ON FUNCTION public.replace_allocator_equity_snapshots_window(uuid, jsonb, integer, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_allocator_equity_snapshots_window(uuid, jsonb, integer, date)
  TO service_role;

COMMENT ON FUNCTION public.replace_allocator_equity_snapshots_window(uuid, jsonb, integer, date) IS
  'Phase 167.2.1.1.2 ACCTREBUILD. Replaces only the window of an allocator''s equity history, in ONE transaction under the per-allocator advisory lock (H-1186, key hashtext(''alloc:''||allocator), the same as replace_allocator_equity_snapshots): DELETE the allocator''s allocator_equity_snapshots rows with asof >= p_window_start, refuse if any DELETEd day is missing from p_rows (RAISE history_days_unreproduced, P0001, DETAIL a count; the raise rolls the DELETE back), INSERT p_rows (WR-05 depth rule, pre_terminus_balance_unknown persisted). Days older than the window are untouched. Records the seam as one allocator_equity_derived row, kind snapshot_rebuild_boundary, payload {boundary_date: YYYY-MM-DD} naming the first inserted day (an earlier recorded seam is kept while a stored day still precedes it), when an older day is kept, and deletes that row when none is. ERRCODE map: 22023 = malformed input (allocator_required, window_start_required, rows_not_a_nonempty_array, row_asof_missing, row_before_window, duplicate_asof); P0001 = history_days_unreproduced. Never 40001. SECURITY DEFINER; EXECUTE for service_role only.';

-- extract_symbol_value_at: 20260421154030. The baseline ACL grants anon, authenticated and
-- service_role and does not revoke PUBLIC, so none is revoked here.
CREATE OR REPLACE FUNCTION public.extract_symbol_value_at(
  p_allocator_id UUID,
  p_symbol       TEXT,
  p_asof         DATE
) RETURNS NUMERIC
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT NULLIF((breakdown ->> p_symbol)::NUMERIC, 0)
    FROM public.allocator_equity_snapshots
   WHERE allocator_id = p_allocator_id
     AND asof = p_asof
   LIMIT 1;
$$;

GRANT ALL ON FUNCTION public.extract_symbol_value_at(uuid, text, date) TO anon;
GRANT ALL ON FUNCTION public.extract_symbol_value_at(uuid, text, date) TO authenticated;
GRANT ALL ON FUNCTION public.extract_symbol_value_at(uuid, text, date) TO service_role;

COMMENT ON FUNCTION public.extract_symbol_value_at IS
  'Phase 09 / D-12. Reads per-symbol USD value on a given asof from '
  'allocator_equity_snapshots.breakdown jsonb. Returns NULL when symbol is absent '
  'OR when value is 0 (prevents divide-by-zero in holding delta computation). '
  'breakdown format: { "BTC": 50000, "ETH": 30000, ... } (Phase 07 D-02).';

-- enqueue_refresh_allocator_equity_for_all: 20261021120000.
CREATE OR REPLACE FUNCTION public.enqueue_refresh_allocator_equity_for_all()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_key   RECORD;
  v_book  RECORD;
  v_rkey  RECORD;
  v_today TEXT := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD');
  -- A reconstruct runs up to 30 minutes, and the first run after this
  -- migration applies must not flood the worker. The cap is soft at book
  -- granularity: splitting a book lets a sibling's first snapshot row strand
  -- the rest. Books beyond it drain on later runs (the cap is per call, and
  -- pg_cron calls once a day).
  v_bootstrap_cap CONSTANT integer := 25;
  v_bootstrap_enqueued integer := 0;
  v_boot_key uuid;
  -- Round-2 review SFH R2-1: TRUE only while the key v_boot_key is inside its own
  -- enqueue section (the inner BEGIN ... END below). The per-book handler counts an
  -- attempt only when it is TRUE, so an error raised anywhere else in the book
  -- (the cursor advancing, for one) is not blamed on a key.
  v_boot_in_enqueue boolean := FALSE;
  v_loop_state text;
  v_loop_msg   text;
  -- Phase 167.1.2.1 D-09: a key is enqueued at most this many times while its
  -- marker is still NULL. At the cap it stays owed, is not enqueued again and
  -- leaves one public.cron_runs row per run (see the count below the bootstrap
  -- sub-block). D-17: the fan-out counts, in the same inner block as the enqueue.
  v_reconstruct_attempt_cap CONSTANT integer := 5;
  v_capped integer;
  -- Round-1 review SFH F2: the error a handler is about to trace, captured before
  -- a nested block overwrites SQLSTATE and SQLERRM.
  v_trace_state text;
  v_trace_msg   text;
BEGIN
  IF NOT pg_try_advisory_lock(hashtext('daily_equity_refresh')) THEN
    RAISE NOTICE 'enqueue_refresh_allocator_equity_for_all: another run holds the lock; skipping';
    RETURN;
  END IF;

  BEGIN
    -- Phase 167.1.2.1 D-06: the comments below that say "zero-snapshot" are
    -- 20260928140000's text. The selection is now per OWED key (marker NULL,
    -- attempts under the cap, no reconstruct in flight) on any book, with or
    -- without snapshots; see the migration header.
    -- Phase 167.1.2 D-17: bootstrap a zero-snapshot book. Whole books, newest
    -- qualifying key first; never split a book across runs.
    -- ISOLATED (167.1.2-12 review SFH-02): this loop runs in its own
    -- sub-block. An error that escapes the per-book block below (the
    -- book-selection query itself, for one) rolls back every bootstrap
    -- enqueue of this run, logs a WARNING and falls through to the refresh
    -- loop, so a failure here never cancels the daily refresh of every
    -- allocator. That is safe by construction: a book whose reconstructs were
    -- rolled back is not bootstrapped, so the refresh loop still withholds its
    -- refresh.
    BEGIN
      FOR v_book IN
        SELECT bq.user_id AS owner_id
        FROM api_keys bq
        WHERE bq.is_active = TRUE
          AND bq.sync_status IS DISTINCT FROM 'revoked'
          AND coalesce(bq.sync_status, '') NOT IN ('sign_in_failed', 'error')
          AND bq.disconnected_at IS NULL
          AND lower(bq.exchange) <> 'deribit'
          AND NOT EXISTS (SELECT 1 FROM strategies bqs WHERE bqs.api_key_id = bq.id AND bqs.user_id = bq.user_id AND bqs.status <> 'archived')
          AND NOT EXISTS (SELECT 1 FROM strategy_keys bqsk JOIN strategies bqks ON bqks.id = bqsk.strategy_id WHERE bqsk.api_key_id = bq.id AND bqks.user_id = bq.user_id AND bqks.status <> 'archived')
          AND bq.history_reconstructed_at IS NULL
          AND bq.history_reconstruct_attempts < v_reconstruct_attempt_cap
          AND NOT EXISTS (SELECT 1 FROM compute_jobs bqj WHERE bqj.api_key_id = bq.id AND bqj.kind = 'reconstruct_allocator_history' AND bqj.status IN ('pending', 'running', 'done_pending_children', 'failed_retry'))
        GROUP BY bq.user_id
        ORDER BY max(bq.created_at) DESC, bq.user_id
      LOOP
        EXIT WHEN v_bootstrap_enqueued >= v_bootstrap_cap;
        -- ONE BOOK AT A TIME (167.1.2-12 review SFH-R2-03): any other error
        -- while enqueueing this book rolls back THIS book's enqueues only and
        -- the loop moves on to the next book, so one key whose enqueue fails
        -- every day cannot cancel every other book's bootstrap. The skipped
        -- book has no in-flight-or-done reconstruct row, so the refresh loop
        -- still withholds its refresh, and the next run takes it again.
        v_boot_key := NULL;
        v_boot_in_enqueue := FALSE;
        BEGIN
          FOR v_rkey IN
            SELECT rk.id AS api_key_id
            FROM api_keys rk
            WHERE rk.user_id = v_book.owner_id
              AND rk.is_active = TRUE
              AND rk.sync_status IS DISTINCT FROM 'revoked'
              AND coalesce(rk.sync_status, '') NOT IN ('sign_in_failed', 'error')
              AND rk.disconnected_at IS NULL
              AND lower(rk.exchange) <> 'deribit'
              AND NOT EXISTS (SELECT 1 FROM strategies rks WHERE rks.api_key_id = rk.id AND rks.user_id = rk.user_id AND rks.status <> 'archived')
              AND NOT EXISTS (SELECT 1 FROM strategy_keys rksk JOIN strategies rkks ON rkks.id = rksk.strategy_id WHERE rksk.api_key_id = rk.id AND rkks.user_id = rk.user_id AND rkks.status <> 'archived')
              AND rk.history_reconstructed_at IS NULL
              AND rk.history_reconstruct_attempts < v_reconstruct_attempt_cap
              AND NOT EXISTS (SELECT 1 FROM compute_jobs rkj WHERE rkj.api_key_id = rk.id AND rkj.kind = 'reconstruct_allocator_history' AND rkj.status IN ('pending', 'running', 'done_pending_children', 'failed_retry'))
            ORDER BY rk.created_at DESC, rk.id
          LOOP
            v_boot_key := v_rkey.api_key_id;
            v_boot_in_enqueue := TRUE;
            BEGIN
              PERFORM enqueue_compute_job(
                p_strategy_id     := NULL,
                p_kind            := 'reconstruct_allocator_history',
                p_idempotency_key := 'reconstruct-alloc-' || v_rkey.api_key_id::text || '-initial',
                p_api_key_id      := v_rkey.api_key_id
              );
              -- Phase 167.1.2.1 D-17: count the try HERE, in the same inner block as
              -- the enqueue. The handler below rolls this block back, so a lost
              -- race burns no attempt. A book that is rolled back by the book-level
              -- handler is counted there instead, once, on the key that failed.
              UPDATE public.api_keys SET history_reconstruct_attempts = history_reconstruct_attempts + 1 WHERE id = v_rkey.api_key_id;
            -- serialization_failure is the enqueue helper's lost-race signal
            -- (the winner already left the in-flight statuses). unique_violation
            -- cannot fire today (the helper inserts ON CONFLICT DO NOTHING) and
            -- is kept as belt. Either skips ONE key, never the run.
            EXCEPTION WHEN unique_violation OR serialization_failure THEN
              RAISE WARNING 'enqueue_refresh_allocator_equity_for_all: reconstruct enqueue skipped for api_key % (SQLSTATE %)', v_rkey.api_key_id, SQLSTATE;
            END;
            v_boot_in_enqueue := FALSE;
            v_bootstrap_enqueued := v_bootstrap_enqueued + 1;
          END LOOP;
        EXCEPTION WHEN OTHERS THEN
          -- v_boot_key is the key being enqueued, or NULL when the per-key
          -- query itself failed before the first key.
          RAISE WARNING 'enqueue_refresh_allocator_equity_for_all: the bootstrap of one book was rolled back and skipped; the other books continue (api_key %, SQLSTATE %)', v_boot_key, SQLSTATE;
          -- DURABLE TRACE (review SFH-R2-02, MIG-R2-01): a WARNING lives only
          -- in the server log, and pg_cron records the run as succeeded. One
          -- public.cron_runs row per skipped book, the sink the ledger fan-outs
          -- write their candidate_enqueue_failed rows to; row security lets
          -- only platform admins and service_role read it. Deliberately NOT
          -- wrapped: if the sink refuses this row, the error reaches the
          -- sub-block below, which rolls this run's bootstrap back and writes
          -- its own row, so a skip is never left with no trace at all.
          INSERT INTO public.cron_runs (cron_name, status, completed_at, error, metadata)
          VALUES ('equity_refresh_fanout', 'error', now(), 'bootstrap_book_skipped',
                  jsonb_build_object('function', 'enqueue_refresh_allocator_equity_for_all',
                                     'cause', 'bootstrap_book_skipped',
                                     'owner_id', v_book.owner_id,
                                     'api_key_id', v_boot_key,
                                     'sqlstate', SQLSTATE,
                                     'message', SQLERRM));
          -- Phase 167.1.2.1 round-1 review SFH F3: the rollback above took the
          -- book's attempt increments with it, so count the failed try HERE, once,
          -- on the key that was being enqueued. Round-2 review SFH R2-1: only when
          -- the error is that key's own. NOT counted: an error raised while the
          -- cursor advances (v_boot_in_enqueue is FALSE there), and a transient
          -- error that says nothing about the key: class 40 (deadlock_detected
          -- 40P01, serialization_failure, transaction_rollback), class 53
          -- (insufficient_resources) and lock_not_available 55P03. query_canceled
          -- 57014 never reaches this handler (WHEN OTHERS does not match it), it
          -- aborts the whole call, which counts nothing. Guarded: a count that
          -- raises must not reach the loop-level handler (it would roll back every
          -- other book's bootstrap); the skipped-book row above is then the trace.
          BEGIN
            IF v_boot_key IS NOT NULL AND v_boot_in_enqueue
               AND SQLSTATE NOT LIKE '40%' AND SQLSTATE NOT LIKE '53%' AND SQLSTATE <> '55P03' THEN
              UPDATE public.api_keys SET history_reconstruct_attempts = history_reconstruct_attempts + 1 WHERE id = v_boot_key;
            END IF;
          EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'enqueue_refresh_allocator_equity_for_all: the failed bootstrap try of one book could not be counted (SQLSTATE %)', SQLSTATE;
          END;
        END;
      END LOOP;
    EXCEPTION WHEN OTHERS THEN
      v_loop_state := SQLSTATE;
      v_loop_msg   := SQLERRM;
      RAISE WARNING 'enqueue_refresh_allocator_equity_for_all: the bootstrap loop failed and was rolled back; the refresh loop still runs (SQLSTATE %: %)', v_loop_state, v_loop_msg;
      -- DURABLE TRACE (review SFH-R2-02, MIG-R2-01), the same sink as the
      -- per-book row. Wrapped, unlike that row: this is the last handler
      -- before the refresh loop, and a sink that refuses this row too must
      -- not cancel the daily refresh of every allocator.
      BEGIN
        INSERT INTO public.cron_runs (cron_name, status, completed_at, error, metadata)
        VALUES ('equity_refresh_fanout', 'error', now(), 'bootstrap_loop_failed',
                jsonb_build_object('function', 'enqueue_refresh_allocator_equity_for_all',
                                   'cause', 'bootstrap_loop_failed',
                                   'sqlstate', v_loop_state,
                                   'message', v_loop_msg));
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'enqueue_refresh_allocator_equity_for_all: the bootstrap failure row could not be written (SQLSTATE %)', SQLSTATE;
      END;
    END;

    -- Phase 167.1.2.1 D-09: a key that still owes its history and has used its
    -- attempts is never enqueued again, so it must not go quiet. One durable
    -- public.cron_runs row per run, a COUNT only (no key or owner id), in the
    -- ledger fan-outs' sink. Wrapped: this is the last step before the refresh
    -- loop, and a sink or a read that refuses must not cancel the daily refresh
    -- of every allocator.
    BEGIN
      SELECT count(*) INTO v_capped
      FROM api_keys ck
      WHERE ck.is_active = TRUE
        AND ck.sync_status IS DISTINCT FROM 'revoked'
        AND coalesce(ck.sync_status, '') NOT IN ('sign_in_failed', 'error')
        AND ck.disconnected_at IS NULL
        AND lower(ck.exchange) <> 'deribit'
        AND NOT EXISTS (SELECT 1 FROM strategies cks WHERE cks.api_key_id = ck.id AND cks.user_id = ck.user_id AND cks.status <> 'archived')
        AND NOT EXISTS (SELECT 1 FROM strategy_keys cksk JOIN strategies ckks ON ckks.id = cksk.strategy_id WHERE cksk.api_key_id = ck.id AND ckks.user_id = ck.user_id AND ckks.status <> 'archived')
        AND ck.history_reconstructed_at IS NULL
        AND ck.history_reconstruct_attempts >= v_reconstruct_attempt_cap;
      IF v_capped > 0 THEN
        INSERT INTO public.cron_runs (cron_name, status, completed_at, error, metadata)
        VALUES ('equity_refresh_fanout', 'error', now(), 'history_reconstruct_capped',
                jsonb_build_object('function', 'enqueue_refresh_allocator_equity_for_all',
                                   'cause', 'history_reconstruct_capped',
                                   'count', v_capped));
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_trace_state := SQLSTATE;
      v_trace_msg   := SQLERRM;
      RAISE WARNING 'enqueue_refresh_allocator_equity_for_all: the capped-key count or its trace row failed; the refresh loop still runs (SQLSTATE %)', SQLSTATE;
      -- Round-1 review SFH F2: a WARNING lives only in the server log and pg_cron
      -- records the run as succeeded, so a count or a sink that fails every day
      -- would lose the capped-key signal silently. Leave a durable row of its own
      -- (a different error value, so a refused capped row does not refuse it),
      -- nested and guarded like the bootstrap loop's: the WARNING above stays the
      -- last resort, and a sink that refuses this row too must not cancel the
      -- daily refresh of every allocator.
      BEGIN
        INSERT INTO public.cron_runs (cron_name, status, completed_at, error, metadata)
        VALUES ('equity_refresh_fanout', 'error', now(), 'history_reconstruct_capped_trace_failed',
                jsonb_build_object('function', 'enqueue_refresh_allocator_equity_for_all',
                                   'cause', 'history_reconstruct_capped_trace_failed',
                                   'sqlstate', v_trace_state,
                                   'message', v_trace_msg));
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'enqueue_refresh_allocator_equity_for_all: the capped-key failure row could not be written (SQLSTATE %)', SQLSTATE;
      END;
    END;

    -- The refresh loop runs AFTER the bootstrap loop on purpose: its
    -- bootstrapped test reads the reconstruct rows the loop above just
    -- enqueued in this transaction, so a book taken this run is refreshed this
    -- run, and a book beyond the cap is refreshed only once a later run has
    -- enqueued its reconstructs. A reconstruct row counts only while it is in
    -- flight or done: a book whose only reconstruct ended failed_final is not
    -- bootstrapped, so no refresh row closes its zero-snapshot gate before the
    -- retry the loop above enqueues.
    FOR v_key IN
      SELECT ak.id AS api_key_id, ak.user_id
      FROM api_keys ak
      WHERE ak.is_active = TRUE
        AND ak.sync_status IS DISTINCT FROM 'revoked'
        AND ak.disconnected_at IS NULL  -- migration 075
        AND (
          EXISTS (SELECT 1 FROM allocator_equity_snapshots aes WHERE aes.allocator_id = ak.user_id)
          OR (
            NOT EXISTS (SELECT 1 FROM strategies aks WHERE aks.api_key_id = ak.id AND aks.user_id = ak.user_id AND aks.status <> 'archived')
            AND NOT EXISTS (SELECT 1 FROM strategy_keys aksk JOIN strategies akks ON akks.id = aksk.strategy_id WHERE aksk.api_key_id = ak.id AND akks.user_id = ak.user_id AND akks.status <> 'archived')
            AND NOT EXISTS (
              SELECT 1
              FROM api_keys bk
              WHERE bk.user_id = ak.user_id
                AND bk.is_active = TRUE
                AND bk.sync_status IS DISTINCT FROM 'revoked'
                AND coalesce(bk.sync_status, '') NOT IN ('sign_in_failed', 'error')
                AND bk.disconnected_at IS NULL
                AND lower(bk.exchange) <> 'deribit'
                AND NOT EXISTS (SELECT 1 FROM strategies bks WHERE bks.api_key_id = bk.id AND bks.user_id = bk.user_id AND bks.status <> 'archived')
                AND NOT EXISTS (SELECT 1 FROM strategy_keys bksk JOIN strategies bkks ON bkks.id = bksk.strategy_id WHERE bksk.api_key_id = bk.id AND bkks.user_id = bk.user_id AND bkks.status <> 'archived')
                AND bk.history_reconstructed_at IS NULL
                AND bk.history_reconstruct_attempts < v_reconstruct_attempt_cap
                AND NOT EXISTS (SELECT 1 FROM compute_jobs bkj WHERE bkj.api_key_id = bk.id AND bkj.kind = 'reconstruct_allocator_history' AND bkj.status IN ('pending', 'running', 'done_pending_children', 'failed_retry'))
            )
          )
        )
    LOOP
      BEGIN
        PERFORM enqueue_compute_job(
          p_strategy_id     := NULL,
          p_kind            := 'refresh_allocator_equity_daily',
          p_idempotency_key := 'daily-equity-' || v_key.api_key_id::text || '-' || v_today,
          p_api_key_id      := v_key.api_key_id
        );
      EXCEPTION WHEN unique_violation OR serialization_failure THEN
        RAISE WARNING 'enqueue_refresh_allocator_equity_for_all: refresh enqueue skipped for api_key % (SQLSTATE %)', v_key.api_key_id, SQLSTATE;
      END;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_advisory_unlock(hashtext('daily_equity_refresh'));
    RAISE;
  END;

  PERFORM pg_advisory_unlock(hashtext('daily_equity_refresh'));
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_refresh_allocator_equity_for_all() FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.enqueue_refresh_allocator_equity_for_all() TO service_role;

COMMENT ON FUNCTION public.enqueue_refresh_allocator_equity_for_all() IS
  'Daily cron fan-out for the per-allocator legacy equity store. Two arms, inside one advisory lock. (1) Reconstruct, first, in its own sub-block, one book per inner block (an error enqueueing one book rolls back and skips that book only; an error outside any book rolls back every reconstruct enqueue of the run; neither cancels the refresh; both are logged as a WARNING and as one public.cron_runs row, cron_name equity_refresh_fanout, error bootstrap_book_skipped or bootstrap_loop_failed): for every OWED qualifying key, one reconstruct_allocator_history job, on a book with or without snapshots. OWED (Phase 167.1.2.1 D-06) = api_keys.history_reconstructed_at IS NULL, history_reconstruct_attempts under 5 (D-09) and no reconstruct job pending, running, done_pending_children or failed_retry; qualifying = active, not revoked, sync_status not sign_in_failed or error, not disconnected, not linked to one of its owner''s non-archived strategies (strategies.api_key_id or strategy_keys, mirroring deriveStrategyLinkedKeyIds) and not Deribit. Each enqueue adds one to history_reconstruct_attempts in the same inner block (D-17), so a lost race burns no attempt; a book whose bootstrap raises is rolled back and its handler adds one attempt to the key that was being enqueued, so a book that keeps failing still reaches the cap, except that an error raised outside that key''s enqueue or a transient one (class 40, class 53, 55P03) counts nothing; the user RPC never counts. The job carries idempotency key reconstruct-alloc-<key>-initial, the RPC''s correlation label; dedupe is the in-flight partial unique index plus the owed predicate, not that key. Whole books, newest key first, stopping before a new book once 25 keys (v_bootstrap_cap) were enqueued this call. A qualifying key that is owed and at the cap (v_reconstruct_attempt_cap, 5) is not enqueued again; each run that finds one writes one public.cron_runs row, error history_reconstruct_capped, metadata carrying a count only, and a failure of that count or row is itself traced as error history_reconstruct_capped_trace_failed. (2) Refresh: one refresh_allocator_equity_daily job per eligible key (active, not revoked, not disconnected) whose owner has a snapshot row, or which is unlinked on a book where no qualifying key is owed, under the cap and out of flight (a capped key never withholds its book). A lost enqueue race (serialization_failure) skips one key with a WARNING. Phase 167.1.2.1 D-06, D-09, D-17; re-based on migration 20260928140000.';

-- ───────────── 3. delete_allocator_api_key as 20261028120000 defined it (with Step 4).
-- CREATE OR REPLACE keeps the existing ACL (authenticated and service_role), so none is re-issued.
CREATE OR REPLACE FUNCTION public.delete_allocator_api_key(
  p_api_key_id uuid,
  p_cascade_holdings boolean DEFAULT false
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '3s'                       -- M-1021: now applies to callers
AS $$
DECLARE
  v_owner              uuid;
  v_holdings_deleted   integer := 0;
BEGIN
  -- H-1186: serialize all per-allocator key-deletion + equity-replace work on
  -- one transaction-scoped advisory lock (auto-released on commit/rollback).
  -- replace_allocator_equity_snapshots takes the SAME key, so the worker's
  -- sole-key replace cannot interleave with this cascade. auth.uid() is the
  -- allocator id; follows the same pg_advisory_xact_lock(hashtext(...))
  -- convention as sync_trades (migration 20260406065011), keyed here on the
  -- allocator to match the worker's p_allocator_id key below.
  PERFORM pg_advisory_xact_lock(hashtext('alloc:' || auth.uid()::text));

  -- Step 1: verify caller owns the key (also covers "key does not exist"
  -- — SELECT returns NULL which fails the equality check below).
  SELECT user_id INTO v_owner FROM api_keys WHERE id = p_api_key_id;

  IF v_owner IS NULL OR v_owner <> auth.uid() THEN
    RAISE EXCEPTION 'delete_allocator_api_key: caller does not own api_key %', p_api_key_id
      USING ERRCODE = '42501';
  END IF;

  -- Step 2: cascade-delete holdings if requested. Without this, the
  -- api_keys DELETE below fails on the 23503 FK restrict from
  -- allocator_holdings (migration 066 STEP 1). Client handles that error.
  IF p_cascade_holdings THEN
    DELETE FROM allocator_holdings
    WHERE api_key_id = p_api_key_id
      AND allocator_id = auth.uid();
    GET DIAGNOSTICS v_holdings_deleted = ROW_COUNT;
  END IF;

  -- Step 3: delete the key.
  DELETE FROM api_keys WHERE id = p_api_key_id AND user_id = auth.uid();

  -- Step 4: last-key equity cascade (migration 077 semantics, M-1020 fix).
  -- Only wipe the equity series when the user explicitly asked for hard
  -- delete (cascade=true) AND they have no other keys left. Multi-key users
  -- keep their aggregated series intact.
  --
  -- M-1020: this is ONE statement — the NOT EXISTS key-presence check and the
  -- snapshot DELETE share a single statement snapshot, eliminating the TOCTOU
  -- window the prior `SELECT count(*); IF 0 THEN DELETE` had. A concurrent
  -- "Add Key" INSERT committing here is either visible to the NOT EXISTS
  -- (=> a sibling exists => no wipe) or not yet committed (=> this statement
  -- already ran, and the new key's reconstruct repopulates) — never a stale
  -- count=0 followed by a wipe of a now-multi-key series.
  IF p_cascade_holdings THEN
    DELETE FROM allocator_equity_snapshots
      WHERE allocator_id = auth.uid()
        AND NOT EXISTS (
          SELECT 1 FROM api_keys WHERE user_id = auth.uid()
        );

    -- WR-01: the snapshots the recorded rebuild seam separated are gone with the
    -- last key, so clear the seam record under the same key-presence test.
    DELETE FROM allocator_equity_derived ck
      WHERE ck.allocator_id = auth.uid()
        AND ck.kind = 'snapshot_rebuild_boundary'
        AND NOT EXISTS (
          SELECT 1 FROM api_keys WHERE user_id = auth.uid()
        );
  END IF;

  RETURN v_holdings_deleted;
END;
$$;

-- ───────────── verify — CATALOGUE ONLY, reads no row
DO $verify$
BEGIN
  IF to_regclass('public.allocator_equity_snapshots') IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261104120000 failed: public.allocator_equity_snapshots was not re-created';
  END IF;
  IF to_regprocedure('public.replace_allocator_equity_snapshots(uuid,jsonb,integer)') IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261104120000 failed: public.replace_allocator_equity_snapshots(uuid, jsonb, integer) is missing';
  END IF;
  IF to_regprocedure('public.replace_allocator_equity_snapshots_window(uuid,jsonb,integer,date)') IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261104120000 failed: public.replace_allocator_equity_snapshots_window(uuid, jsonb, integer, date) is missing';
  END IF;
  IF to_regprocedure('public.extract_symbol_value_at(uuid,text,date)') IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261104120000 failed: public.extract_symbol_value_at(uuid, text, date) is missing';
  END IF;
  IF to_regprocedure('public.enqueue_refresh_allocator_equity_for_all()') IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261104120000 failed: public.enqueue_refresh_allocator_equity_for_all() is missing';
  END IF;
  IF (SELECT position('allocator_equity_snapshots' IN p.prosrc) FROM pg_proc p
       WHERE p.oid = to_regprocedure('public.delete_allocator_api_key(uuid,boolean)')) = 0 THEN
    RAISE EXCEPTION 'Rollback 20261104120000 failed: delete_allocator_api_key does not name the table again';
  END IF;
  RAISE NOTICE 'Rollback 20261104120000: allocator_equity_snapshots re-created empty, its four functions and the 20261028120000 delete_allocator_api_key restored. No row was restored.';
END
$verify$;

COMMIT;
