-- Phase 164.5.1.4 SYNCCURSOR — a per-STRATEGY trade-sync resume cursor.
--
-- Background.
--   `routers/cron.py::_sync_single_key` fans a single api_key out over every
--   strategy attached to it. It STORES per STRATEGY (`per_strategy_stored[sid]`)
--   but it RESUMES per KEY: the fetch window comes from
--   `parse_since_ms(key_row.get("last_sync_at"))`, and the epilogue advances
--   that one key-level column whenever the aggregate
--   `should_advance_cursor = (not trades) or synced_count > 0` holds, with
--   `synced_count = sum(per_strategy_stored.values())`.
--
--   The aggregation IS the defect. On a two-strategy key where strategy A
--   stores and strategy B raises, the key cursor still advances — past the very
--   window B failed on. B's trades for that window are never fetched again by
--   any later tick, so B is stranded permanently rather than transiently. The
--   same shape strands the recompute tail: a strategy whose
--   `derive_broker_dailies` enqueue failed is never re-driven, because the
--   cursor it would have been re-driven from has already moved.
--
--   No per-strategy sync state exists anywhere in the schema (measured, phase
--   164.5.1.4 CONTEXT Area 1), so the remedy needs new state. The binding
--   constraint is the KEY, not the container: it must not be per-api-key.
--   This file ships exactly that container and nothing more. It is INERT on
--   arrival: every strategy starts with NO ROW, which the read path is
--   required to treat as "fall back to the key-level cursor", i.e. today's
--   behaviour byte for byte.
--
-- Why a NEW TABLE rather than a column somewhere existing.
--   * NOT a column on `strategies`: `strategies_read`
--     (`20260405061912_rls_policies.sql`) is a PUBLIC-read policy
--     (`status = 'published' OR user_id = auth.uid()`), so any column added
--     there publishes internal sync state for every published strategy.
--   * NOT keyed on the api_key: `strategies` points at its key through a
--     mutable `ON DELETE SET NULL` foreign key, so a composite key would
--     strand this row the moment a strategy is re-pointed at another key.
--     The strategy is the stable axis; it is the whole primary key here.
--
-- WHAT THIS FILE DOES NOT DO
-- --------------------------
-- 1. It does NOT touch `api_keys.last_sync_at` or the `should_advance_cursor`
--    expression. Holding the whole key cursor on any partial failure starves
--    the SUCCEEDING strategies into permanent re-fetch — the symmetric defect,
--    and the reason C-0198 chose to advance. That expression stays as it is.
-- 2. It does NOT touch `api_keys.last_fetched_trade_timestamp` (migration 045).
--    Measured: that column is per-KEY. It splits the checkpoint by PURPOSE
--    (fetched vs stored), not by STRATEGY, so re-using it would reproduce this
--    very defect in a second column.
-- 3. It does NOT harmonise the two sync-cursor disciplines this repo runs.
--    `services/job_worker.py` advances through the fenced `advance_sync_cursor`
--    RPC under a claim token; `routers/cron.py` writes `api_keys.last_sync_at`
--    directly with no fence and never touches the fenced path at all. The
--    marker this table holds is written in the PLAIN DIRECT-WRITE style
--    `cron.py` already uses, deliberately, per CONTEXT Area 2 — harmonising the
--    two paths is a much larger change and is out of scope for this phase.
--    This item exists because a reviewer unfamiliar with the deliberate split
--    will reasonably ask why this write is not fenced; the answer belongs in
--    the file, not in the review thread.
-- 4. It registers NO scheduled job. There is no `cron.schedule(...)` here and
--    there must never be one: scheduling is a LIVE OP, never a migration
--    (CONTEXT Area 4).
--
-- Self-verify posture. Every assertion at the foot of this file reads CATALOGS
-- ONLY (`information_schema` / `pg_catalog`). It reads no pre-existing row and
-- counts nothing. Shared TEST holds PROD's catalogue and never its data, so a
-- data-dependent assertion can pass PROD and REFUSE TEST — and a refused TEST
-- apply BLOCKS the PROD apply (`[164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]`).

BEGIN;

SET LOCAL lock_timeout = '3s';

-- --------------------------------------------------------------------------
-- STEP 1: the container
-- --------------------------------------------------------------------------
-- Three columns and no more.
--   * `strategy_id` is the WHOLE primary key. No surrogate `id`: the primary
--     key already indexes the exact column the read path filters on and is the
--     conflict target the writer upserts against, so a secondary index would be
--     dead weight.
--   * No api-key column, as a column or as part of the key — see the header.
--   * No `updated_at` trigger. This table has exactly one writer (the cron
--     upsert), which sets the column in its own payload; installing a trigger
--     for a single-writer table buys nothing and adds a second thing to keep
--     correct. (`compute_jobs` has one because its rows mutate via many paths.)
-- ⭐ `IF NOT EXISTS` is KEPT, and arm 7 of the self-verify is what makes that
--    safe. This clause silently declines over a pre-existing table of a
--    DIFFERENT SHAPE, and shared TEST has unguarded writers (the developer CLI
--    and the browser SQL editor), so that state is reachable. The two variants
--    are NOT equally dangerous, and the difference was MEASURED on the lane:
--    * MISSING column — already loud without any arm. The `COMMENT ON COLUMN
--      ... .last_sync_at` statement below raises 42703 before the DO block runs.
--    * PRESENT column, WRONG TYPE OR WRONG NULLABILITY — the genuinely silent
--      one. The COMMENT succeeds, arms 1-6 all pass, and the migration commits
--      green. `last_sync_at TIMESTAMPTZ NOT NULL` is the worst case: it makes
--      state (2) unrepresentable, the consumer's upsert then raises 23502, its
--      fail-open branch swallows it, and the marker silently stays behind —
--      indistinguishable from the over-fetch that branch is designed to produce.
--    Arm 7 pins the exact column set, types and nullability and closes that
--    second variant. The clause is kept rather than dropped because this file is
--    deliberately RE-RUNNABLE and its own verify command applies it twice.
CREATE TABLE IF NOT EXISTS strategy_sync_cursors (
  strategy_id  UUID PRIMARY KEY REFERENCES strategies(id) ON DELETE CASCADE,
  last_sync_at TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE strategy_sync_cursors IS
  'Internal cron resume state: at most one row per strategy, recording where the trade sync got to for THAT strategy rather than for its api key. Sole writer is the analytics service cron fan out, through the service role client. No user facing consumer exists or is planned, which is why RLS here is deny all with no owner tier. See phase 164.5.1.4.';

COMMENT ON COLUMN strategy_sync_cursors.strategy_id IS
  'The whole primary key. Cascades on strategy deletion, so nothing is orphaned and no cleanup job is needed. Deliberately NOT composite: the strategy is the stable axis, while the key a strategy points at is mutable and nullable, so a composite key would strand this row on a re-point. See phase 164.5.1.4.';

-- ⚠️ The column name mirrors `api_keys.last_sync_at` byte for byte, and NOT the
-- `last_synced_trade_at` an earlier draft proposed. The value stored is wall
-- clock at sync time, exactly like the key-level column it falls back to — not
-- the maximum trade timestamp in the payload. A name containing "trade" invites
-- a future reader to derive it from the payload, which would silently diverge
-- from the one column it mirrors.
COMMENT ON COLUMN strategy_sync_cursors.last_sync_at IS
  'Wall clock at the moment this strategy was last fully synced, mirroring api_keys.last_sync_at in meaning. NOT the maximum trade timestamp in the payload. THREE STATES, and the first two are DIFFERENT: (1) NO ROW for this strategy means no per strategy information, so the consumer falls back to api_keys.last_sync_at, which is what makes this migration inert the moment it lands; (2) ROW PRESENT with a NULL value means this strategy must re fetch from the start of history; (3) ROW PRESENT with a timestamp means resume from there. The consumer MUST distinguish (1) from (2) by key MEMBERSHIP, never by a dictionary lookup that returns the same None for both. See phase 164.5.1.4.';

COMMENT ON COLUMN strategy_sync_cursors.updated_at IS
  'When this cursor row was last written. Set explicitly by the single writer in its own upsert payload; there is deliberately no trigger. See phase 164.5.1.4.';

-- --------------------------------------------------------------------------
-- STEP 2: RLS — deny all, no owner tier
-- --------------------------------------------------------------------------
-- ⭐ This is the narrower of two shipped precedents and it is taken on evidence.
--   * `allocator_holdings_service_all` (`20260420073003_allocator_holdings.sql`)
--     writes an explicit `auth.role() = 'service_role'` arm — but that table HAS
--     an owner-facing SELECT tier, so its service-role arm is one of three and
--     the intent it documents is "service_role IN ADDITION TO owners".
--   * `compute_jobs_deny_all` (`20260411144407_compute_jobs_queue.sql`) has no
--     owner tier at all, which is exactly this table's posture.
--   Both forms work only because service_role bypasses RLS by default
--   (ADR-0003, quoted in the allocator_holdings comment block). `USING (false)`
--   is the strictly narrower WRITTEN grant of the two, since the `auth.role()`
--   form would also admit any non-bypassing connection presenting that role
--   claim. Narrower wins for a table with zero user-facing consumers.
--
-- ⭐ A `REVOKE` IS taken below. An earlier draft of this file argued against one,
--    and that argument is WITHDRAWN because it misread both the precedent and
--    the gates it cited:
--    * `compute_jobs_deny_all` is cited above as this table's model, and the
--      model AS IT STANDS TODAY carries the REVOKE — M-0774 in
--      `20260516104201_compute_jobs_audit_2026_05_07_residual.sql` added
--      `REVOKE ALL ON TABLE compute_jobs FROM PUBLIC, anon, authenticated;`
--      precisely so a later `DROP POLICY` cannot re-expose the table. Citing the
--      2026-04 form while omitting the 2026-05 hardening is half a precedent.
--    * The vacuity those `*_rls.sql` gates warn about is READING A 42501 RAISED
--      BY THE GRANT LAYER AS PROOF THE DENY POLICY FIRED. The repo's own remedy
--      is a two-arm gate: `scripts/pg-lane/fixtures/07-fixture-supabase-default-
--      privileges.sql` restores the bootstrap grants inside the lane so the
--      policy arms stay falsifiable, and the grant layer gets its own separately
--      named arm. Neither gate says "do not ship the REVOKE".
--    Without it this table arrives carrying Supabase's bootstrap
--    `GRANT ALL ON TABLES TO anon, authenticated` (fixture 07 reproduces it
--    verbatim), leaving the policy as the SOLE layer.
--
-- ⛔ Deliberately NO `FORCE ROW LEVEL SECURITY`, and this is a DECISION, not an
--    omission. M-0773 took FORCE on `compute_jobs` to close the table-owner
--    bypass. The inverse cost is recorded in
--    `20260911130000_ledger_fanout_grantees_and_dormancy.sql`: FORCE is the
--    clause under which a SECURITY DEFINER reader degrades CLOSED AND SILENT.
--    This table has ZERO SECURITY DEFINER readers and zero owner-facing tiers,
--    so FORCE buys nothing here and carries a silent-failure mode.
--    ⭐ TRIGGER TO REVISIT: take FORCE the moment either an owner-facing policy
--    tier or a SECURITY DEFINER reader is added to this table.
ALTER TABLE strategy_sync_cursors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS strategy_sync_cursors_deny_all ON strategy_sync_cursors;
CREATE POLICY strategy_sync_cursors_deny_all ON strategy_sync_cursors
  FOR ALL
  USING (false)
  WITH CHECK (false);

COMMENT ON POLICY strategy_sync_cursors_deny_all ON strategy_sync_cursors IS
  'Service role only. Non service callers get zero rows and can write none. This table has NO owner facing tier, so the narrower USING (false) form is used rather than an explicit auth.role() arm; service_role bypasses RLS by default per ADR 0003. See phase 164.5.1.4.';

-- Defence in depth beneath the policy, matching M-0774 on compute_jobs. It
-- survives a future migration that DISABLEs RLS or drops this policy without
-- recreating it, and it is the only control reaching the RLS-EXEMPT verbs
-- (TRUNCATE, TRIGGER, REFERENCES). Referential actions run as the referencing
-- table's owner, so ON DELETE CASCADE from strategies still fires after it.
REVOKE ALL ON TABLE strategy_sync_cursors FROM PUBLIC, anon, authenticated;

-- ⛔ AND THE POSITIVE HALF, WHICH IS NOT OPTIONAL. An earlier draft of this file
--    took the REVOKE alone and justified it with "service_role is untouched — it
--    reaches the table by BYPASSRLS at the role level, not through this grant."
--    THAT SENTENCE WAS FALSE, and it was the entire reason the GRANT below was
--    omitted. `BYPASSRLS` is a ROW-level exemption; it confers NO object-level
--    privilege. service_role reaches this table solely through Supabase's
--    bootstrap `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES`,
--    which is keyed to the GRANTOR ROLE AND SCHEMA and applies only to tables
--    created by that role — something nothing in this file established or checked.
--
-- ⭐ THE PRECEDENT ALREADY ANSWERED THIS, and taking only its first half is the
--    same "half a precedent" error this file's STEP 2 block accuses its own
--    earlier draft of, repeated one layer down. M-0774 shipped the REVOKE in
--    `20260516104201_compute_jobs_audit_2026_05_07_residual.sql`; the VERY NEXT
--    compute_jobs migration, `20260516131500_compute_jobs_residual_apply.sql`,
--    shipped the correction — `GRANT ALL ON TABLE compute_jobs TO service_role`
--    plus a positive verifier, commented "Closes the loop on the M-0774 verifier
--    which only asserts the negative and never the positive".
--
-- ⚠️ AND compute_jobs IS AN EXACT PRECEDENT OF THIS SHAPE, not a SECDEF-only
--    table: MEASURED 2026-09-19, 102 direct `.table("compute_jobs")` call sites
--    in `analytics-service`. A direct PostgREST write as service_role needs a
--    real table privilege.
--
--    Without this GRANT, a drift in the bootstrap default-privileges posture
--    makes every marker write 42501 into the writer's fail-open branch —
--    permanently, and this table's whole purpose is that its writes land.
GRANT ALL ON TABLE strategy_sync_cursors TO service_role;

-- --------------------------------------------------------------------------
-- STEP 3: self-verifying DO block — CATALOGS ONLY
-- --------------------------------------------------------------------------
-- ⛔ Every arm below reads `information_schema` or `pg_catalog` and nothing
--    else. No arm reads the contents of a pre-existing row, counts rows against
--    a production condition, or inserts a throwaway row.
--
-- ⛔ The dummy-row functional probe that
--    `20260602173710_advance_sync_cursor_claim_token_fence.sql` uses is
--    REJECTED here, and the reason is structural rather than stylistic:
--    satisfying this table's foreign key needs a real `strategies` row, which
--    needs a `profiles` row, which needs an `auth.users` row. That is three
--    production inserts whose triggers and constraints the disposable lane
--    cannot model — a materially larger risk than the probe buys over a catalog
--    assertion, on a file whose failure mode is "blocks the PROD apply".
DO $$
DECLARE
  v_pk_cols     TEXT;
  v_rls_enabled BOOLEAN;
  v_polcmd      "char";
  v_cols        TEXT;
  v_priv        TEXT;
BEGIN
  -- 1. the relation exists in schema public
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'strategy_sync_cursors'
  ) THEN
    RAISE EXCEPTION 'Phase 164.5.1.4 failed: table public.strategy_sync_cursors was not created';
  END IF;

  -- 2. its primary key column set is exactly {strategy_id}
  SELECT string_agg(a.attname, ',' ORDER BY a.attname)
    INTO v_pk_cols
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid
     AND a.attnum = ANY (c.conkey)
   WHERE c.conrelid = 'public.strategy_sync_cursors'::regclass
     AND c.contype = 'p';
  IF v_pk_cols IS DISTINCT FROM 'strategy_id' THEN
    RAISE EXCEPTION 'Phase 164.5.1.4 failed: primary key of strategy_sync_cursors is (%), expected exactly (strategy_id). A composite or surrogate key is the stranding shape this phase exists to rule out.', COALESCE(v_pk_cols, '<no primary key at all>');
  END IF;

  -- 3. a foreign key strategy_id -> strategies exists and cascades on delete
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
     WHERE c.conrelid = 'public.strategy_sync_cursors'::regclass
       AND c.contype = 'f'
       AND c.confrelid = 'public.strategies'::regclass
       AND c.confdeltype = 'c'
       -- ⭐ and it is on strategy_id SPECIFICALLY. Without this conjunct the arm
       --    admits a cascading FK on some OTHER column while strategy_id itself
       --    carries none — the orphaning its own error message rules out.
       AND c.conkey = ARRAY[(
             SELECT a.attnum FROM pg_attribute a
              WHERE a.attrelid = c.conrelid AND a.attname = 'strategy_id'
           )]::smallint[]
  ) THEN
    RAISE EXCEPTION 'Phase 164.5.1.4 failed: strategy_sync_cursors has no ON DELETE CASCADE foreign key to strategies, so deleting a strategy would orphan its cursor row';
  END IF;

  -- 4. row level security is enabled on the relation
  SELECT relrowsecurity
    INTO v_rls_enabled
    FROM pg_class
   WHERE oid = 'public.strategy_sync_cursors'::regclass;
  IF NOT COALESCE(v_rls_enabled, FALSE) THEN
    RAISE EXCEPTION 'Phase 164.5.1.4 failed: row level security is not enabled on strategy_sync_cursors, so internal sync state would be reachable by browser clients';
  END IF;

  -- 5. the deny-all policy is present
  SELECT p.polcmd
    INTO v_polcmd
    FROM pg_policy p
   WHERE p.polrelid = 'public.strategy_sync_cursors'::regclass
     AND p.polname = 'strategy_sync_cursors_deny_all';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Phase 164.5.1.4 failed: policy strategy_sync_cursors_deny_all is missing from strategy_sync_cursors';
  END IF;

  -- 6. and it governs ALL commands, not merely SELECT
  --    A policy carrying this name but created FOR SELECT would satisfy arm 5
  --    while leaving INSERT/UPDATE/DELETE ungoverned, which is a real defect
  --    class rather than a hypothetical one. `polcmd` is a catalog code point
  --    ('*' = FOR ALL, MEASURED on the disposable lane), not deparsed text, so
  --    this arm cannot fail on a rendering difference between PostgreSQL major
  --    versions.
  --
  -- ⛔ Deliberately NOT asserted: that `pg_get_expr(polqual, polrelid)` renders
  --    as the string 'false'. It does render exactly that way (MEASURED on the
  --    lane, alongside polwithcheck), but the assertion would buy nothing — the
  --    qualifier could legitimately render differently across a PostgreSQL
  --    major, and the failure mode of such an arm is "blocks the PROD apply".
  --    The measurement is recorded; the assertion is not taken.
  --
  -- ⚠️ BE HONEST ABOUT WHAT THAT LEAVES UNCOVERED. An earlier draft justified the
  --    omission by claiming "the qualifier cannot drift without this file's
  --    CREATE POLICY being edited, which arm 5 already catches". That is FALSE:
  --    arm 5 matches on `polname` ALONE. Editing `USING (false)` to
  --    `USING (true)` in this file leaves the name and the command scope
  --    untouched, so arms 5 and 6 both pass and the migration commits green over
  --    a policy granting every row to every caller. Arms 5 and 6 pin the
  --    policy's NAME and its COMMAND SCOPE. Its QUALIFIER is pinned by nothing
  --    here — the REVOKE in STEP 2 is what keeps a qualifier regression from
  --    being a live exposure.
  IF v_polcmd IS DISTINCT FROM '*' THEN
    RAISE EXCEPTION 'Phase 164.5.1.4 failed: policy strategy_sync_cursors_deny_all has polcmd %, expected * (FOR ALL). A deny policy scoped to one command leaves the others ungoverned.', v_polcmd;
  END IF;

  -- 7. the payload columns exist with the right types AND the right nullability
  --    ⭐ `last_sync_at` being NULLABLE is the load-bearing half: it is what makes
  --    state (2) of the three-state contract — row present, value NULL, meaning
  --    "re-fetch from the start of history" — REPRESENTABLE at all. Against a
  --    NOT NULL column the consumer's upsert raises 23502, its fail-open branch
  --    swallows it, and the marker silently stays behind. 43 migrations in this
  --    repo already assert against information_schema.columns; still catalog
  --    only, so `row_count_assertions` stays 0.
  SELECT string_agg(c.column_name || ':' || c.data_type || ':' || c.is_nullable,
                    ',' ORDER BY c.column_name)
    INTO v_cols
    FROM information_schema.columns c
   WHERE c.table_schema = 'public'
     AND c.table_name = 'strategy_sync_cursors';
  IF v_cols IS DISTINCT FROM 'last_sync_at:timestamp with time zone:YES,'
                          || 'strategy_id:uuid:NO,'
                          || 'updated_at:timestamp with time zone:NO' THEN
    RAISE EXCEPTION 'Phase 164.5.1.4 failed: strategy_sync_cursors columns are (%), expected exactly last_sync_at nullable timestamptz, strategy_id non-null uuid, updated_at non-null timestamptz. A NOT NULL last_sync_at makes the re-fetch-from-start state unrepresentable.', COALESCE(v_cols, '<no columns at all>');
  END IF;

  -- 8. and service_role STILL HOLDS the privileges the writer needs. The REVOKE
  --    above only asserts the NEGATIVE (anon/authenticated/PUBLIC hold nothing);
  --    without this arm nothing checks that the role which actually writes the
  --    markers can still reach the table, which is the failure that would make
  --    this entire phase inert in production.
  -- ⭐ `has_table_privilege` rather than the precedent's `count(*)` over
  --    information_schema: it is catalog-only AND count-free, so this file's
  --    `row_count_assertions = 0` property — the thing keeping it clear of
  --    [164.8-DATA-DEPENDENT-MIGRATION-ESCAPE] — is preserved by construction
  --    rather than by argument.
  --
  -- ⚠️ MEASURED 2026-09-19, AND READ THIS BEFORE CONCLUDING THIS ARM IS VACUOUS.
  --    Deleting the GRANT above and applying WITHOUT fixture 07 reds this arm
  --    ("service_role lacks SELECT"). Applying the SAME mutant WITH
  --    `scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql` is
  --    GREEN, because that fixture issues `GRANT ALL ON TABLES TO anon,
  --    authenticated, service_role` itself and hands service_role the privilege
  --    the deleted statement would have. That is not vacuity — it is the fixture
  --    faithfully reproducing the bootstrap posture, which is the very posture
  --    this GRANT exists to survive the ABSENCE of. ⛔ Do not "prove" this arm
  --    toothless by mutating it under fixture 07.
  FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
    IF NOT has_table_privilege(
             'service_role', 'public.strategy_sync_cursors', v_priv
           ) THEN
      RAISE EXCEPTION 'Phase 164.5.1.4 failed: service_role lacks % on strategy_sync_cursors. BYPASSRLS is a ROW-level exemption and confers no object privilege, so without a table GRANT every marker write raises 42501 into the writer fail-open branch and the per-strategy cursor never persists.', v_priv;
    END IF;
  END LOOP;
END $$;

COMMIT;
