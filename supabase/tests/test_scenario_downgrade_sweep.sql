-- Test for the F-4 memberKeyIds re-stamp sweep (CF-03, Phase 66 / Plan 66-02).
--
-- Proves the sweep in scripts/sweeps/f4-memberkeyids-restamp.sql INDEPENDENTLY
-- of prod state: (1) its discriminator flags exactly the downgraded-shape row
-- and neither genuine-v4 row, (2) its re-derive UPDATE stamps the gate-correct
-- eligible ids, and (3) genuine-v4 rows (including the blank-save memberKeyIds:[]
-- shape) are left byte-identical. The discriminator WHERE clause and the
-- jsonb_set UPDATE transform below are COPIED VERBATIM from the sweep script, so
-- CI proves the exact statements that will run against prod.
--
-- pgTAP is NOT installed in this project, so this uses the same plain PL/pgSQL
-- convention as the other supabase/tests/test_*.sql files: `DO $$ ... $$` blocks
-- with `RAISE EXCEPTION` on failure and `RAISE NOTICE` on assertion pass. No
-- pgTAP, and no psql backslash meta-commands. Under `psql -v ON_ERROR_STOP=1`
-- (what .github/workflows/ci.yml `sql-tests` runs) a failed assertion exits
-- non-zero and fails the job. Filename matches ci.yml's `test_*.sql` glob so the
-- job auto-discovers it against the persistent test project.
--
-- The fixture seeds:
--   - Allocator GT (gate TRUE): two eligible keys WITH per-key series, plus a
--     revoked key and a disconnected key (both WITH series) that must be
--     EXCLUDED from the stamped ids — proving the eligible predicate is mirrored,
--     not a naive is_active filter. Downgraded scenario -> expects memberKeyIds
--     = [the two eligible ids], sorted.
--   - Allocator GF (gate FALSE): one eligible key with NO series -> gate false.
--     Downgraded scenario -> expects memberKeyIds = [].
--   - Allocator NF (gate FALSE, WR-01 regression): one eligible key whose ONLY
--     csv_daily_returns rows are non-finite (NaN, +Infinity, -Infinity). The
--     runtime's buildPerKeyReturnsByApiKeyId drops every non-finite row, so this
--     key derives an EMPTY series -> gate false -> stamped []. A bare
--     `EXISTS (SELECT 1 ...)` has_series would (wrongly) see rows exist and stamp
--     the key's id — this case proves has_series now mirrors the finite filter.
--   - Allocator OLD (gate FALSE, CR-2 regression): one eligible key whose ONLY
--     csv_daily_returns rows are FINITE but older than the runtime's 730-day
--     fetch window (queries.ts:2577 bounds the series fetch with
--     .gte("date", now-730d) BEFORE the gate). Those rows are invisible to the
--     runtime, so the key derives an EMPTY series -> gate false -> stamped []. A
--     has_series EXISTS WITHOUT the 730-day date window would (wrongly) see the
--     finite rows and stamp the key's id — the time-axis analogue of the WR-01
--     finite-filter break. This case proves has_series now mirrors the window.
--   - Two GENUINE-v4 rows on allocator GT: memberKeyIds:[] (blank-save shape) and
--     memberKeyIds:["genuine-fixed-id"] (book-save shape) — both must survive the
--     sweep byte-identical (the discriminator keys on key PRESENCE, not the gate).
--   - One pre-v4 row (schema_version = 3) WITHOUT the key — must NOT be flagged
--     (the discriminator's schema_version >= 4 floor).
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_scenario_downgrade_sweep.sql

-- --------------------------------------------------------------------------
-- Defensive pre-clean. ON DELETE CASCADE chains auth.users -> profiles ->
-- {api_keys, scenarios} and api_keys -> csv_daily_returns, so deleting the
-- auth.users rows by email drops the whole seeded subtree.
-- --------------------------------------------------------------------------
DELETE FROM auth.users
  WHERE email IN (
    'test-f4-sweep-gate-true@quantalyze.test',
    'test-f4-sweep-gate-false@quantalyze.test',
    'test-f4-sweep-nonfinite@quantalyze.test',
    'test-f4-sweep-stale@quantalyze.test'
  );

DO $$
DECLARE
  -- Allocator GT (gate true)
  uid_gt        UUID := gen_random_uuid();
  k_gt1         UUID := gen_random_uuid();  -- eligible, has series
  k_gt2         UUID := gen_random_uuid();  -- eligible, has series
  k_gt_rev      UUID := gen_random_uuid();  -- is_active but sync_status='revoked' -> NOT eligible
  k_gt_disc     UUID := gen_random_uuid();  -- is_active but disconnected_at set    -> NOT eligible
  scen_gt_id    UUID;  -- downgraded, gate-true allocator
  scen_blank_id UUID;  -- genuine v4, memberKeyIds: []
  scen_pop_id   UUID;  -- genuine v4, memberKeyIds: ["genuine-fixed-id"]
  scen_v3_id    UUID;  -- schema_version 3, no key (must not flag)
  -- Allocator GF (gate false)
  uid_gf        UUID := gen_random_uuid();
  k_gf1         UUID := gen_random_uuid();  -- eligible, NO series -> gate false
  scen_gf_id    UUID;  -- downgraded, gate-false allocator
  -- Allocator NF (non-finite series only -> WR-01 regression)
  uid_nf        UUID := gen_random_uuid();
  k_nf1         UUID := gen_random_uuid();  -- eligible, ONLY non-finite rows -> empty runtime series -> gate false
  scen_nf_id    UUID;  -- downgraded, non-finite-series allocator
  -- Allocator OLD (finite rows only OUTSIDE the 730-day window -> CR-2 regression)
  uid_old       UUID := gen_random_uuid();
  k_old1        UUID := gen_random_uuid();  -- eligible, ONLY rows >730d old -> empty runtime series -> gate false
  scen_old_id   UUID;  -- downgraded, stale-series allocator
  -- Assertion scratch
  detect_cnt    INTEGER;
  expected_gt   JSONB;
  actual_gt     JSONB;
  actual_gf     JSONB;
  actual_nf     JSONB;
  actual_old    JSONB;
  blank_before  JSONB;
  pop_before    JSONB;
  v3_before     JSONB;
BEGIN
  -- ----- SEED (service role / superuser context — bypasses RLS) ----------

  -- Allocator GT: auth.users + profile.
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_gt, '00000000-0000-0000-0000-000000000000',
          'test-f4-sweep-gate-true@quantalyze.test', now(), now());
  -- The on_auth_user_created trigger pre-creates the profile row without a role,
  -- so DO UPDATE the role (mirrors test_scenarios_rls.sql).
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid_gt, 'f4 sweep gate-true', 'test-f4-sweep-gate-true@quantalyze.test', 'allocator')
  ON CONFLICT (id) DO UPDATE
    SET role = EXCLUDED.role, display_name = EXCLUDED.display_name;

  -- Four keys for GT. api_key_encrypted is NOT NULL; exchange CHECK is
  -- binance/okx/bybit; is_active defaults true.
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active, sync_status, disconnected_at)
  VALUES
    (k_gt1,     uid_gt, 'binance', 'gt eligible 1', 'enc', true, 'complete', NULL),
    (k_gt2,     uid_gt, 'bybit',   'gt eligible 2', 'enc', true, 'complete', NULL),
    (k_gt_rev,  uid_gt, 'okx',     'gt revoked',    'enc', true, 'revoked',  NULL),
    (k_gt_disc, uid_gt, 'binance', 'gt disconnected','enc', true, 'complete', now());

  -- Per-key csv_daily_returns series. The owner-coherence trigger requires
  -- allocator_id = api_keys.user_id and strategy_id NULL (num_nonnulls check).
  -- Give ALL four keys a series so the gate depends purely on ELIGIBILITY: the
  -- revoked + disconnected keys have series too, yet must be excluded.
  INSERT INTO csv_daily_returns (strategy_id, api_key_id, allocator_id, date, daily_return)
  VALUES
    (NULL, k_gt1,     uid_gt, DATE '2026-04-01', 0.001),
    (NULL, k_gt1,     uid_gt, DATE '2026-04-02', 0.002),
    (NULL, k_gt2,     uid_gt, DATE '2026-04-01', 0.003),
    (NULL, k_gt_rev,  uid_gt, DATE '2026-04-01', 0.004),
    (NULL, k_gt_disc, uid_gt, DATE '2026-04-01', 0.005);

  -- Downgraded row for GT: schema_version 4, draft WITHOUT the memberKeyIds key.
  INSERT INTO scenarios (allocator_id, name, draft, schema_version)
  VALUES (uid_gt, 'gt downgraded',
          '{"addedStrategies": [], "weightOverrides": {}}'::jsonb, 4)
  RETURNING id INTO scen_gt_id;

  -- Genuine v4 (blank-save shape): memberKeyIds present and empty.
  INSERT INTO scenarios (allocator_id, name, draft, schema_version)
  VALUES (uid_gt, 'gt genuine blank',
          '{"addedStrategies": [], "memberKeyIds": []}'::jsonb, 4)
  RETURNING id INTO scen_blank_id;

  -- Genuine v4 (book-save shape): memberKeyIds present and populated.
  INSERT INTO scenarios (allocator_id, name, draft, schema_version)
  VALUES (uid_gt, 'gt genuine populated',
          '{"addedStrategies": [], "memberKeyIds": ["genuine-fixed-id"]}'::jsonb, 4)
  RETURNING id INTO scen_pop_id;

  -- Pre-v4 row (schema_version 3) WITHOUT the key — must NOT be flagged.
  INSERT INTO scenarios (allocator_id, name, draft, schema_version)
  VALUES (uid_gt, 'gt legacy v3',
          '{"addedStrategies": []}'::jsonb, 3)
  RETURNING id INTO scen_v3_id;

  -- Allocator GF: one eligible key with NO series -> gate false.
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_gf, '00000000-0000-0000-0000-000000000000',
          'test-f4-sweep-gate-false@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid_gf, 'f4 sweep gate-false', 'test-f4-sweep-gate-false@quantalyze.test', 'allocator')
  ON CONFLICT (id) DO UPDATE
    SET role = EXCLUDED.role, display_name = EXCLUDED.display_name;
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active, sync_status, disconnected_at)
  VALUES (k_gf1, uid_gf, 'binance', 'gf eligible no-series', 'enc', true, 'complete', NULL);
  -- No csv_daily_returns rows for k_gf1 -> that eligible key has no series -> gate false.

  INSERT INTO scenarios (allocator_id, name, draft, schema_version)
  VALUES (uid_gf, 'gf downgraded',
          '{"addedStrategies": []}'::jsonb, 4)
  RETURNING id INTO scen_gf_id;

  -- Allocator NF (WR-01): one eligible key whose ONLY series rows are non-finite.
  -- daily_return is DOUBLE PRECISION with no finiteness CHECK, so NaN/±Infinity
  -- are storable. The runtime drops every non-finite row -> empty series -> gate
  -- false -> the downgraded row must be stamped [], NOT [k_nf1].
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_nf, '00000000-0000-0000-0000-000000000000',
          'test-f4-sweep-nonfinite@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid_nf, 'f4 sweep non-finite', 'test-f4-sweep-nonfinite@quantalyze.test', 'allocator')
  ON CONFLICT (id) DO UPDATE
    SET role = EXCLUDED.role, display_name = EXCLUDED.display_name;
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active, sync_status, disconnected_at)
  VALUES (k_nf1, uid_nf, 'binance', 'nf eligible nonfinite-only', 'enc', true, 'complete', NULL);
  -- ONLY non-finite rows for k_nf1 -> runtime keeps none -> empty series.
  INSERT INTO csv_daily_returns (strategy_id, api_key_id, allocator_id, date, daily_return)
  VALUES
    (NULL, k_nf1, uid_nf, DATE '2026-04-01', 'NaN'::float8),
    (NULL, k_nf1, uid_nf, DATE '2026-04-02', 'Infinity'::float8),
    (NULL, k_nf1, uid_nf, DATE '2026-04-03', '-Infinity'::float8);

  INSERT INTO scenarios (allocator_id, name, draft, schema_version)
  VALUES (uid_nf, 'nf downgraded',
          '{"addedStrategies": []}'::jsonb, 4)
  RETURNING id INTO scen_nf_id;

  -- Allocator OLD (CR-2): one eligible key whose ONLY csv_daily_returns rows are
  -- FINITE but older than the runtime's 730-day fetch window. The runtime bounds
  -- the series fetch with .gte("date", now-730d) (queries.ts:2577) BEFORE the
  -- gate, so these rows are invisible -> empty series -> gate false -> the
  -- downgraded row must be stamped [], NOT [k_old1]. Without the 730-day window
  -- on the sweep's has_series EXISTS, this key would (wrongly) count as
  -- has_series=true and stamp its id — the time-axis analogue of the WR-01 break.
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_old, '00000000-0000-0000-0000-000000000000',
          'test-f4-sweep-stale@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid_old, 'f4 sweep stale-series', 'test-f4-sweep-stale@quantalyze.test', 'allocator')
  ON CONFLICT (id) DO UPDATE
    SET role = EXCLUDED.role, display_name = EXCLUDED.display_name;
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active, sync_status, disconnected_at)
  VALUES (k_old1, uid_old, 'binance', 'old eligible stale-only', 'enc', true, 'complete', NULL);
  -- ONLY rows >730 days old for k_old1 -> outside the runtime window -> empty
  -- series. Values are finite so ONLY the date window (not the finite filter)
  -- can exclude them — this isolates the CR-2 window from the WR-01 finite fix.
  INSERT INTO csv_daily_returns (strategy_id, api_key_id, allocator_id, date, daily_return)
  VALUES
    (NULL, k_old1, uid_old, (CURRENT_DATE - INTERVAL '800 days')::date, 0.001),
    (NULL, k_old1, uid_old, (CURRENT_DATE - INTERVAL '801 days')::date, 0.002);

  INSERT INTO scenarios (allocator_id, name, draft, schema_version)
  VALUES (uid_old, 'old downgraded',
          '{"addedStrategies": []}'::jsonb, 4)
  RETURNING id INTO scen_old_id;

  -- Snapshot the genuine + v3 drafts BEFORE the sweep for byte-identity checks.
  SELECT draft INTO blank_before FROM scenarios WHERE id = scen_blank_id;
  SELECT draft INTO pop_before   FROM scenarios WHERE id = scen_pop_id;
  SELECT draft INTO v3_before    FROM scenarios WHERE id = scen_v3_id;

  RAISE NOTICE 'Seed OK: GT alloc=% (downgraded=%), GF alloc=% (downgraded=%)',
    uid_gt, scen_gt_id, uid_gf, scen_gf_id;

  -- ----- ASSERTION 1: discriminator flags EXACTLY the two downgraded rows ----
  -- (copied verbatim from the sweep DETECT section, scoped to the seeded set)
  SELECT count(*) INTO detect_cnt
  FROM scenarios
  WHERE schema_version >= 4
    AND NOT (draft ? 'memberKeyIds')
    AND id IN (scen_gt_id, scen_blank_id, scen_pop_id, scen_v3_id, scen_gf_id, scen_nf_id, scen_old_id);
  IF detect_cnt <> 4 THEN
    RAISE EXCEPTION
      'TEST FAILED (Assertion 1): discriminator flagged % seeded rows, expected 4 (the four downgraded rows)', detect_cnt;
  END IF;
  -- And specifically: it flags the three downgraded ids, and NEITHER genuine row,
  -- the blank-save row, NOR the pre-v4 row.
  IF NOT EXISTS (
    SELECT 1 FROM scenarios
    WHERE schema_version >= 4 AND NOT (draft ? 'memberKeyIds') AND id = scen_gt_id
  ) THEN
    RAISE EXCEPTION 'TEST FAILED (Assertion 1): GT downgraded row not flagged by discriminator';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM scenarios
    WHERE schema_version >= 4 AND NOT (draft ? 'memberKeyIds') AND id = scen_gf_id
  ) THEN
    RAISE EXCEPTION 'TEST FAILED (Assertion 1): GF downgraded row not flagged by discriminator';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM scenarios
    WHERE schema_version >= 4 AND NOT (draft ? 'memberKeyIds') AND id = scen_nf_id
  ) THEN
    RAISE EXCEPTION 'TEST FAILED (Assertion 1): NF downgraded row not flagged by discriminator';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM scenarios
    WHERE schema_version >= 4 AND NOT (draft ? 'memberKeyIds') AND id = scen_old_id
  ) THEN
    RAISE EXCEPTION 'TEST FAILED (Assertion 1): OLD downgraded row not flagged by discriminator';
  END IF;
  IF EXISTS (
    SELECT 1 FROM scenarios
    WHERE schema_version >= 4 AND NOT (draft ? 'memberKeyIds')
      AND id IN (scen_blank_id, scen_pop_id, scen_v3_id)
  ) THEN
    RAISE EXCEPTION 'TEST FAILED (Assertion 1): discriminator flagged a genuine-v4 or pre-v4 row (false positive)';
  END IF;
  RAISE NOTICE 'Assertion 1 OK: discriminator flags exactly the four downgraded rows.';

  -- ----- RUN THE SWEEP TRANSFORM (copied verbatim from the sweep RESTAMP) ----
  UPDATE scenarios s
  SET draft = jsonb_set(
    s.draft,
    '{memberKeyIds}',
    (
      SELECT CASE
        -- gate = eligible set non-empty AND every eligible key has a series
        -- (allActiveKeysHavePerKeyDailies, queries.ts:2205-2214)
        WHEN count(*) > 0 AND bool_and(ek.has_series)
          THEN COALESCE(
                 jsonb_agg(to_jsonb(ek.api_key_id::text) ORDER BY ek.api_key_id),
                 '[]'::jsonb
               )
        ELSE '[]'::jsonb
      END
      FROM (
        -- eligible keys for this allocator (isPerKeyDailiesEligibleKey,
        -- queries.ts:2241-2249), each tagged with whether it has a non-empty
        -- per-key csv_daily_returns series. has_series mirrors
        -- buildPerKeyReturnsByApiKeyId (queries.ts:2257-2271): count a row
        -- ONLY when the runtime keeps it — daily_return finite
        -- (Number.isFinite). Postgres treats NaN = NaN as TRUE, so the three
        -- non-finite float8 literals are excluded explicitly, not via x = x.
        SELECT
          k.id AS api_key_id,
          EXISTS (
            SELECT 1 FROM csv_daily_returns c
            WHERE c.api_key_id = k.id
              AND c.date >= ((now() AT TIME ZONE 'UTC')::date - INTERVAL '730 days')
              AND c.daily_return <> 'NaN'::float8
              AND c.daily_return <> 'Infinity'::float8
              AND c.daily_return <> '-Infinity'::float8
          ) AS has_series
        FROM api_keys k
        WHERE k.user_id = s.allocator_id
          AND k.is_active
          AND k.sync_status IS DISTINCT FROM 'revoked'
          AND k.disconnected_at IS NULL
      ) ek
    ),
    true   -- create_missing: the discriminator guarantees the key is absent
  )
  WHERE s.schema_version >= 4
    AND NOT (s.draft ? 'memberKeyIds');

  -- ----- ASSERTION 2: gate-true downgraded row stamped with eligible ids -----
  -- Expected = the sorted JSONB array of GT's eligible key ids (revoked +
  -- disconnected EXCLUDED). Recompute independently via the eligible predicate.
  SELECT COALESCE(jsonb_agg(to_jsonb(k.id::text) ORDER BY k.id), '[]'::jsonb)
  INTO expected_gt
  FROM api_keys k
  WHERE k.user_id = uid_gt
    AND k.is_active
    AND k.sync_status IS DISTINCT FROM 'revoked'
    AND k.disconnected_at IS NULL;

  SELECT draft -> 'memberKeyIds' INTO actual_gt FROM scenarios WHERE id = scen_gt_id;

  IF actual_gt IS DISTINCT FROM expected_gt THEN
    RAISE EXCEPTION
      'TEST FAILED (Assertion 2): GT downgraded memberKeyIds = %, expected % (gate-derived eligible ids)',
      actual_gt, expected_gt;
  END IF;
  -- Strong, independent shape checks: exactly the two eligible ids, and NEITHER
  -- the revoked NOR the disconnected key leaked in.
  IF jsonb_array_length(actual_gt) <> 2 THEN
    RAISE EXCEPTION
      'TEST FAILED (Assertion 2): GT memberKeyIds length = %, expected 2 eligible ids', jsonb_array_length(actual_gt);
  END IF;
  IF NOT (actual_gt @> to_jsonb(k_gt1::text) AND actual_gt @> to_jsonb(k_gt2::text)) THEN
    RAISE EXCEPTION 'TEST FAILED (Assertion 2): GT memberKeyIds missing an eligible key id';
  END IF;
  IF actual_gt @> to_jsonb(k_gt_rev::text) OR actual_gt @> to_jsonb(k_gt_disc::text) THEN
    RAISE EXCEPTION 'TEST FAILED (Assertion 2): GT memberKeyIds included a revoked/disconnected (ineligible) key';
  END IF;
  RAISE NOTICE 'Assertion 2 OK: gate-true row stamped with the sorted eligible ids only.';

  -- ----- ASSERTION 2b: gate-false downgraded row stamped [] ------------------
  SELECT draft -> 'memberKeyIds' INTO actual_gf FROM scenarios WHERE id = scen_gf_id;
  IF actual_gf IS DISTINCT FROM '[]'::jsonb THEN
    RAISE EXCEPTION
      'TEST FAILED (Assertion 2b): GF downgraded memberKeyIds = %, expected [] (gate false)', actual_gf;
  END IF;
  RAISE NOTICE 'Assertion 2b OK: gate-false row stamped [].';

  -- ----- ASSERTION 2c: non-finite-series-only key -> gate false -> stamped [] -
  -- WR-01 regression: k_nf1 is eligible and HAS csv_daily_returns rows, but every
  -- row is non-finite (NaN/±Infinity). The runtime drops them all -> empty series
  -- -> gate false. A bare `EXISTS (SELECT 1 ...)` has_series would see rows exist,
  -- flip the gate TRUE, and stamp [k_nf1] — which a runtime reopen would NEVER
  -- produce. The finite-filtered has_series must yield [] here.
  SELECT draft -> 'memberKeyIds' INTO actual_nf FROM scenarios WHERE id = scen_nf_id;
  IF actual_nf IS DISTINCT FROM '[]'::jsonb THEN
    RAISE EXCEPTION
      'TEST FAILED (Assertion 2c): NF downgraded memberKeyIds = %, expected [] (only non-finite rows -> empty runtime series -> gate false)', actual_nf;
  END IF;
  RAISE NOTICE 'Assertion 2c OK: non-finite-series-only key treated as no-series (stamped []).';

  -- ----- ASSERTION 2d: stale-series-only key (>730d) -> gate false -> stamped [] -
  -- CR-2 regression: k_old1 is eligible and HAS finite csv_daily_returns rows, but
  -- every row is older than the runtime's 730-day fetch window. The runtime never
  -- fetches them -> empty series -> gate false. Without the 730-day window on the
  -- sweep's has_series EXISTS, has_series would be TRUE (finite rows exist), flip
  -- the gate TRUE, and stamp [k_old1] — which a runtime reopen would NEVER produce.
  -- The date-windowed has_series must yield [] here.
  SELECT draft -> 'memberKeyIds' INTO actual_old FROM scenarios WHERE id = scen_old_id;
  IF actual_old IS DISTINCT FROM '[]'::jsonb THEN
    RAISE EXCEPTION
      'TEST FAILED (Assertion 2d): OLD downgraded memberKeyIds = %, expected [] (only >730d-old rows -> empty runtime series -> gate false)', actual_old;
  END IF;
  RAISE NOTICE 'Assertion 2d OK: stale-series-only key (>730d) treated as no-series (stamped []).';

  -- ----- ASSERTION 3: genuine + pre-v4 rows are byte-identical ---------------
  IF (SELECT draft FROM scenarios WHERE id = scen_blank_id) IS DISTINCT FROM blank_before THEN
    RAISE EXCEPTION 'TEST FAILED (Assertion 3): blank-save genuine row (memberKeyIds:[]) was mutated by the sweep';
  END IF;
  IF (SELECT draft FROM scenarios WHERE id = scen_pop_id) IS DISTINCT FROM pop_before THEN
    RAISE EXCEPTION 'TEST FAILED (Assertion 3): populated genuine row was mutated by the sweep';
  END IF;
  IF (SELECT draft FROM scenarios WHERE id = scen_v3_id) IS DISTINCT FROM v3_before THEN
    RAISE EXCEPTION 'TEST FAILED (Assertion 3): pre-v4 (schema_version 3) row was mutated by the sweep';
  END IF;
  RAISE NOTICE 'Assertion 3 OK: genuine-v4 (incl. blank-save) and pre-v4 rows untouched.';

  -- ----- ASSERTION 4: idempotency — a second run is a no-op -----------------
  -- After the first sweep both downgraded rows carry the key, so the
  -- discriminator matches nothing; capture the post-run drafts, re-run, compare.
  DECLARE
    gt_after  JSONB;
    gf_after  JSONB;
    gt_again  JSONB;
    gf_again  JSONB;
  BEGIN
    SELECT draft INTO gt_after FROM scenarios WHERE id = scen_gt_id;
    SELECT draft INTO gf_after FROM scenarios WHERE id = scen_gf_id;

    UPDATE scenarios s
    SET draft = jsonb_set(
      s.draft,
      '{memberKeyIds}',
      (
        SELECT CASE
          WHEN count(*) > 0 AND bool_and(ek.has_series)
            THEN COALESCE(
                   jsonb_agg(to_jsonb(ek.api_key_id::text) ORDER BY ek.api_key_id),
                   '[]'::jsonb
                 )
          ELSE '[]'::jsonb
        END
        FROM (
          SELECT
            k.id AS api_key_id,
            EXISTS (
              SELECT 1 FROM csv_daily_returns c
              WHERE c.api_key_id = k.id
                AND c.date >= ((now() AT TIME ZONE 'UTC')::date - INTERVAL '730 days')
                AND c.daily_return <> 'NaN'::float8
                AND c.daily_return <> 'Infinity'::float8
                AND c.daily_return <> '-Infinity'::float8
            ) AS has_series
          FROM api_keys k
          WHERE k.user_id = s.allocator_id
            AND k.is_active
            AND k.sync_status IS DISTINCT FROM 'revoked'
            AND k.disconnected_at IS NULL
        ) ek
      ),
      true
    )
    WHERE s.schema_version >= 4
      AND NOT (s.draft ? 'memberKeyIds');

    SELECT draft INTO gt_again FROM scenarios WHERE id = scen_gt_id;
    SELECT draft INTO gf_again FROM scenarios WHERE id = scen_gf_id;
    IF gt_again IS DISTINCT FROM gt_after OR gf_again IS DISTINCT FROM gf_after THEN
      RAISE EXCEPTION 'TEST FAILED (Assertion 4): second sweep run mutated an already-stamped row (not idempotent)';
    END IF;
  END;
  RAISE NOTICE 'Assertion 4 OK: re-running the sweep is a no-op (idempotent).';

  -- ----- POST-CONDITION: zero downgraded rows remain in the seeded set -------
  SELECT count(*) INTO detect_cnt
  FROM scenarios
  WHERE schema_version >= 4
    AND NOT (draft ? 'memberKeyIds')
    AND id IN (scen_gt_id, scen_blank_id, scen_pop_id, scen_v3_id, scen_gf_id, scen_nf_id, scen_old_id);
  IF detect_cnt <> 0 THEN
    RAISE EXCEPTION
      'TEST FAILED (post-condition): % downgraded rows remain after the sweep, expected 0', detect_cnt;
  END IF;
  RAISE NOTICE 'Post-condition OK: zero downgraded schema_version >= 4 rows remain.';

  -- ----- TEARDOWN -----------------------------------------------------------
  -- ON DELETE CASCADE chains auth.users -> profiles -> {api_keys, scenarios} and
  -- api_keys -> csv_daily_returns. One delete per allocator cleans the subtree.
  DELETE FROM auth.users WHERE id IN (uid_gt, uid_gf, uid_nf, uid_old);

  RAISE NOTICE 'All F-4 sweep assertions passed (discriminator + re-derive transform proven).';
END
$$;

-- --------------------------------------------------------------------------
-- Defensive post-clean. If an assertion above aborted with RAISE EXCEPTION the
-- seed rows would survive; run one more cleanup outside the DO block so
-- subsequent runs start clean.
-- --------------------------------------------------------------------------
DELETE FROM auth.users
  WHERE email IN (
    'test-f4-sweep-gate-true@quantalyze.test',
    'test-f4-sweep-gate-false@quantalyze.test',
    'test-f4-sweep-nonfinite@quantalyze.test',
    'test-f4-sweep-stale@quantalyze.test'
  );
