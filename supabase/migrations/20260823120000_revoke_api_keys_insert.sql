-- ============================================================================
-- Phase 160 / RANK-03 — withdraw client INSERT on public.api_keys
--
-- PR-2 OF TWO. THIS FILE MUST NOT SHIP IN THE SAME LANDING AS ITS REPLACEMENT
-- WRITER. PR-1 (v0.71.0.0) deployed the server-side persist arm in
-- `validate-and-encrypt` and converted all THREE browser INSERT sites
-- (ApiKeyManager, StrategyForm, AllocatorExchangeManager). Only after that
-- deploy soaked does this migration withdraw the grant those components used
-- to need. Merging supabase/migrations/** auto-applies to PROD, so bundling
-- the two would revoke the grant BEFORE the replacement was live — the exact
-- ordering failure the phase's deploy-first / revoke-second rule exists to
-- prevent (160-CONTEXT.md D-06).
--
-- WHAT THIS WITHDRAWS, AND WHAT IT DELIBERATELY DOES NOT
-- ------------------------------------------------------
-- Withdraws: INSERT on public.api_keys from anon + authenticated. One verb.
--
-- Leaves alone, on purpose:
--   * DELETE — still a LIVE browser path (`ApiKeyManager.tsx:352` disconnects a
--     key directly). Revoking it here would break disconnect-a-key. D-05 scopes
--     this phase to INSERT alone.
--   * SELECT / UPDATE — UPDATE was already withdrawn by 20260810120000; the
--     migration-027 SELECT column allowlist is what the converted components
--     re-read the new row through, so touching it would break the connect UI.
--   * RLS policies, the attested_venue scrub trigger, the
--     `attested_venue IS NULL OR attested_venue = exchange` CHECK — grants are
--     the lever here, not policy. RLS filters ROWS; this is a table-level verb.
--
-- DIRECTION ASYMMETRY (why a grant, not a policy — 20260813150106's rationale)
-- --------------------------------------------------------------------------
-- A row-level policy cannot express "no browser may create this row at all";
-- it can only filter which rows a permitted INSERT may write. The property we
-- want is the absence of the verb, so the verb is what we remove.
--
-- Idempotency: REVOKE is idempotent, and the comment re-stamp is guarded
-- against double-appending its own marker. Safe to re-run.
-- ============================================================================

BEGIN;

-- A grant change takes a brief ACCESS EXCLUSIVE-ish catalog lock. Bound the
-- wait rather than queue behind a long reader on a live table.
SET LOCAL lock_timeout = '3s';
-- ───────────────────── 1. CENSUS RE-RUN GUARD (D-03)
--
-- WHAT THIS PIN PROTECTS, STATED PRECISELY. The B-M1 census (2026-08-23, PROD
-- ref khslejtfbuezsmvmtsdn, committed as .planning/…/160-CENSUS.md) measured
-- ZERO un-attested api_keys rows — 31 rows total, newest 2026-08-21, all 31
-- carrying attested_venue = exchange. The pin asserts that THE MEASURED
-- POPULATION HAS NOT MOVED: that no un-attested row exists among rows created
-- BEFORE the census. A change there means this is not the database that was
-- censused (a restore, a different project, a backfill regression) and the
-- decision below rests on numbers that no longer describe it.
--
-- ⛔ WHY THE CUTOFF IS LOAD-BEARING, AND WHY ITS ABSENCE WAS A BUG. An earlier
-- draft of this file pinned un-attested rows across ALL time. That is the same
-- latent-outage shape 20260811210000:660-666 walked back, re-introduced with
-- teeth — and worse, it aborts on a condition PR-1 DELIBERATELY DESIGNS FOR.
-- `validate-and-encrypt/route.ts` says so in its own words: during the soak
-- window between the PR-1 deploy and this REVOKE, a stale browser tab still
-- running pre-conversion JS "sends the OLD body (no `persist` field at all) and
-- then performs its own client INSERT". The scrub trigger NULLs that row's
-- attestation, so ONE stale tab would abort the PROD auto-apply of a security
-- fix and send the operator hunting for an unconverted writer that does not
-- exist. Soak-window rows are EXPECTED; they are exactly what this REVOKE is
-- here to stop. So they are REPORTED, not enforced. The dated-cutoff idiom is
-- 20260811210000's own (its backfill was bounded the same way).
--
-- ⛔ WHY THIS CANNOT BE UNCONDITIONAL — MEASURED, NOT ASSUMED. On TEST
-- (qmnijlgmdhviwzwfyzlc, read 2026-08-23) api_keys holds ~3,540 rows of which
-- ~1,200 are un-attested: the e2e seed helpers insert as service_role and never
-- set attested_venue (`seed-test-project.ts`, the api_keys insert). An
-- unconditional assertion would abort every CI apply forever.
--
-- ⛔ THE DISCRIMINATOR IS TWO-SIDED, AND REFUSES TO GUESS. An earlier draft
-- treated "no PROD signature" as "therefore non-PROD", which is the wrong
-- default for a one-way door: disconnect-a-key is a hard DELETE, so the mt5
-- signature decays monotonically, and on a PROD whose mt5 rows had all been
-- disconnected the guard would take the lenient branch, print "this is a
-- non-PROD apply" ON PROD, and REVOKE anyway. Both branches now require
-- POSITIVE evidence — the census's own mt5 rows for PROD (4 rows across three
-- dates, measured), e2e-shaped seed rows for TEST/CI (3,530 of 3,544 measured;
-- PROD has 0) — and an unrecognised database ABORTS rather than guessing.
DO $census$
DECLARE
  -- Hand-typed from the census artifact. ONE declaration, several uses — a
  -- second inlined copy is how a re-cut produces an error that misreports its
  -- own pin (20260811210000:620 records that exact measured failure).
  c_pin_unattested CONSTANT INT    := 0;
  c_pin_total      CONSTANT INT    := 31;
  -- The census instant. PROD's newest row at census time was 2026-08-21, so the
  -- ENTIRE measured population sits strictly before this boundary.
  c_census_cutoff  CONSTANT TIMESTAMPTZ := TIMESTAMPTZ '2026-08-23 00:00:00+00';
  -- ⭐ ALL THREE mt5 creation dates on PROD, not just the two post-cutoff ones.
  -- MEASURED 2026-08-23: 4 mt5 rows — 2026-08-04 ×2 (the same date
  -- 20260811210000 pinned), 2026-08-13 ×1, 2026-08-21 ×1. Pinning all three
  -- means a fail-open needs the entire mt5 population to vanish, and it re-uses
  -- the precedent's own date so the two migrations agree on what PROD looks like.
  c_pin_dates      CONSTANT DATE[] :=
    ARRAY[DATE '2026-08-04', DATE '2026-08-13', DATE '2026-08-21'];

  v_total        INT;
  v_unattested   INT;   -- pre-cutoff: the ENFORCED population
  v_unatt_soak   INT;   -- post-cutoff: REPORTED (stale-tab soak-window rows)
  v_sig          INT;   -- PROD positive signature
  v_seed_sig     INT;   -- TEST/CI positive signature
  v_dates        TEXT := array_to_string(c_pin_dates, ', ');
BEGIN
  SELECT count(*) INTO v_total FROM public.api_keys;
  SELECT count(*) INTO v_unattested
    FROM public.api_keys
   WHERE attested_venue IS NULL AND created_at < c_census_cutoff;
  SELECT count(*) INTO v_unatt_soak
    FROM public.api_keys
   WHERE attested_venue IS NULL AND created_at >= c_census_cutoff;
  SELECT count(*) INTO v_sig
    FROM public.api_keys
   WHERE exchange = 'mt5'
     AND (created_at AT TIME ZONE 'UTC')::date = ANY (c_pin_dates);
  SELECT count(*) INTO v_seed_sig
    FROM public.api_keys WHERE label LIKE 'e2e-%';

  IF v_sig >= 1 THEN
    IF v_unattested <> c_pin_unattested THEN
      RAISE EXCEPTION
        'Migration 20260823120000 ABORT: the CENSUSED population moved (un-attested rows created before % : found %, pinned %). This is not drift from the soak window — those rows are counted separately and reported — so it means this database is not the one the 2026-08-23 B-M1 census measured, or the attestation backfill regressed. Re-run the census against khslejtfbuezsmvmtsdn and re-cut c_pin_unattested. Never soften this comparison to make an apply pass. Rolling back.',
        c_census_cutoff, v_unattested, c_pin_unattested
        USING ERRCODE = 'data_exception';
    END IF;
    -- ⛔ REPORTED, NEVER ENFORCED — both of these. The total, per
    -- 20260811210000:660-666 (api_keys is live and user-mutable; ONE key
    -- connected or deleted between census and merge must not abort a security
    -- fix). And the soak-window un-attested count, because a stale tab minting
    -- one is the DESIGNED behaviour this REVOKE terminates, not evidence of a
    -- missed writer. Both stay VISIBLE in the apply log.
    RAISE NOTICE 'Migration 20260823120000 pre-flight OK (PROD signature: % mt5 rows on [%]). Censused un-attested population matches the pin (%). Soak-window un-attested rows since %: % — reported, not enforced (stale tabs; this REVOKE is what stops them). Total api_keys % against a pinned % (delta %) — reported, not enforced.',
      v_sig, v_dates, v_unattested, c_census_cutoff, v_unatt_soak, v_total, c_pin_total, v_total - c_pin_total;
  ELSIF v_seed_sig >= 1 THEN
    RAISE NOTICE 'Migration 20260823120000 pre-flight: non-PROD apply confirmed by POSITIVE evidence (% e2e-shaped seed rows, no PROD census signature). total=%, un-attested=% (e2e seeds legitimately create un-attested rows). The strict census pin does not apply here; the structural post-verifies below still enforce on every database.',
      v_seed_sig, v_total, v_unattested + v_unatt_soak;
  ELSE
    -- ⛔ REFUSE TO GUESS. Neither signature present. Treating that as "non-PROD"
    -- is how a PROD whose mt5 keys were all disconnected silently loses its
    -- guard on a one-way door.
    RAISE EXCEPTION
      'Migration 20260823120000 ABORT: unidentified database — neither the PROD census signature (mt5 rows created on [%]) nor an e2e seed signature is present (total=%, un-attested=%). Refusing to guess which branch applies before withdrawing a grant that cannot be un-withdrawn without a counter-migration. If this IS PROD and the censused mt5 keys were disconnected, re-run the B-M1 census and re-cut c_pin_dates/c_pin_unattested together. Rolling back.',
      v_dates, v_total, v_unattested + v_unatt_soak
      USING ERRCODE = 'data_exception';
  END IF;
END
$census$;

-- ───────────────────── 2. THE WITHDRAWAL
-- Table-level, mirroring 20260810120000:104 with the verb changed. Exactly one
-- REVOKE statement in this file.
REVOKE INSERT ON public.api_keys FROM anon, authenticated;

-- ───────────────────── 3. COLUMN-COMMENT MARKER (the SQL gate's arming source)
--
-- `supabase/tests/test_api_keys_insert_not_client_writable.sql` and assertion
-- 5c of its sibling both arm on the substring `revoke_api_keys_insert`. The
-- re-stamp is an APPEND to the value read back from the catalogue, never a
-- rewrite: a rewrite once dropped an older migration's marker and silently
-- disarmed a whole assertion block (the sibling's 5a'/5a" regressions exist
-- because of it).
--
-- It also CORRECTS two sentences this phase falsified. Leaving them would make
-- the database's own documentation assert the forgeable-input design that
-- RANK-03/RANK-04 just removed.
DO $comment$
DECLARE
  v_old TEXT;
  v_new TEXT;
  c_stale_paths CONSTANT TEXT :=
    'but the value is still client-supplied at row creation on the two non-wizard INSERT paths (ApiKeyManager, StrategyForm), so a mislabelled row is possible.';
  c_stale_stamp CONSTANT TEXT :=
    'Input to the strategies.asset_class annualization stamp (√365 crypto vs √252 traditional) — that reader deliberately still uses this column (153.6 OQ-2, out of scope).';
  -- Short, distinctive probes for the POST-correction state, so a re-run is a
  -- no-op instead of an abort (see the guard below).
  c_repl_paths_probe CONSTANT TEXT := 'the browser holds no INSERT on this table at all';
  c_repl_stamp_probe CONSTANT TEXT := 'a NULL attestation SKIPS the write';
  -- The appended operational sentence needs its OWN sentinel: the first
  -- replace() already injects the migration filename, so keying the append on
  -- that filename made it dead code and the sentence never landed (MEASURED).
  c_append_sentinel  CONSTANT TEXT := 'Do not re-open client INSERT on this table.';
BEGIN
  SELECT col_description('public.api_keys'::regclass, attnum) INTO v_old
    FROM pg_attribute
   WHERE attrelid = 'public.api_keys'::regclass AND attname = 'exchange';

  IF v_old IS NULL THEN
    RAISE EXCEPTION
      'Migration 20260823120000 ABORT: api_keys.exchange carries no column comment to append to. The SQL gates arm on substrings of that comment, so appending to nothing would leave every negative assertion permanently dormant — a silently disarmed gate, not a passing one. Rolling back.'
      USING ERRCODE = 'data_exception';
  END IF;

  -- ⛔ FAIL LOUD ON A MISSED CORRECTION — BUT STAY RE-RUNNABLE. If a sentence we
  -- intend to replace is absent, some earlier migration already re-worded it and
  -- blindly appending would leave a stale claim standing while reporting success.
  --
  -- ⚠️ The naive form of this check (`stale absent ⇒ RAISE`) made the file
  -- NON-RE-RUNNABLE, which was MEASURED on a PG16 fixture: after a successful
  -- first apply both stale sentences are gone, so a second apply aborted here.
  -- That matters beyond tidiness — this file COMMITs explicitly, so if the CLI's
  -- schema_migrations version-row write failed after that COMMIT, `db push
  -- --include-all` would re-run the file and wedge permanently. So the condition
  -- is "neither the stale sentence NOR its replacement is present" — genuinely
  -- drifted prose still aborts; an already-corrected comment is a clean no-op.
  IF (position(c_stale_paths IN v_old) = 0
      AND position(c_repl_paths_probe IN v_old) = 0)
     OR (position(c_stale_stamp IN v_old) = 0
      AND position(c_repl_stamp_probe IN v_old) = 0) THEN
    RAISE EXCEPTION
      'Migration 20260823120000 ABORT: the api_keys.exchange comment contains neither the exact sentence(s) this migration corrects nor the corrected text it writes, so the correction would silently no-op and leave a falsified claim in the catalogue. Re-read the live comment and re-cut c_stale_paths / c_stale_stamp to match it. Rolling back.'
      USING ERRCODE = 'data_exception';
  END IF;

  v_new := replace(
    replace(v_old, c_stale_paths,
      'and as of migration 20260823120000_revoke_api_keys_insert the browser holds no INSERT on this table at all, so the value is now server-written on every path.'),
    c_stale_stamp,
    'NO LONGER the input to the strategies.asset_class annualization stamp: since Phase 160 (RANK-04) that stamp reads api_keys.attested_venue, and a NULL attestation SKIPS the write rather than defaulting to traditional/√252.');

  -- Idempotent, keyed on the APPENDED SENTENCE's own sentinel. ⚠️ Keying it on
  -- the migration filename was dead code: the replace() above already injects
  -- that filename, so the condition was never true and this sentence NEVER
  -- reached the catalogue (MEASURED). Post-verify 4e below now asserts it landed.
  IF position(c_append_sentinel IN v_new) = 0 THEN
    v_new := v_new ||
      ' Client INSERT was withdrawn at the table level by migration 20260823120000_revoke_api_keys_insert (Phase 160 / RANK-03); the server-side persist arm in validate-and-encrypt is the only writer. Do not re-open client INSERT on this table.';
  END IF;

  EXECUTE format('COMMENT ON COLUMN public.api_keys.exchange IS %L', v_new);
END
$comment$;

-- ───────────────────── 4. ABORTING POST-VERIFY
-- Runs on EVERY database, PROD or not — the structural claims are universal.
-- Any failure raises inside the open transaction, so the REVOKE rolls back.
DO $verify$
DECLARE
  v_comment TEXT;
BEGIN
  -- 4a. The verb is actually gone, for both browser roles.
  IF has_table_privilege('authenticated', 'public.api_keys', 'INSERT') THEN
    RAISE EXCEPTION 'Migration 20260823120000 POST-VERIFY FAILED: authenticated still holds INSERT on public.api_keys. Rolling back.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF has_table_privilege('anon', 'public.api_keys', 'INSERT') THEN
    RAISE EXCEPTION 'Migration 20260823120000 POST-VERIFY FAILED: anon still holds INSERT on public.api_keys. Rolling back.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 4b. ⭐ ANTI-OVERREACH. DELETE is a LIVE browser path; if this migration
  -- took it too, disconnect-a-key breaks in production. Assert we removed one
  -- verb, not a category.
  IF NOT has_table_privilege('authenticated', 'public.api_keys', 'DELETE') THEN
    RAISE EXCEPTION 'Migration 20260823120000 POST-VERIFY FAILED: authenticated lost DELETE on public.api_keys — this migration withdraws INSERT ONLY (D-05); ApiKeyManager disconnect would break. Rolling back.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 4b′. ⭐ THE ANTI-OVERREACH CHECK THAT MATTERS MOST, and the one an earlier
  -- draft omitted. After this REVOKE the persist arm of validate-and-encrypt is
  -- the ONLY writer of api_keys anywhere in the system, and it writes as
  -- service_role. If service_role lacked INSERT, this migration would leave
  -- connect-a-key broken for every tenant with no other door to fall back to.
  -- The sibling sql-test asserts this too, but that runs on TEST long after a
  -- PROD apply has already committed.
  IF NOT has_table_privilege('service_role', 'public.api_keys', 'INSERT') THEN
    RAISE EXCEPTION 'Migration 20260823120000 POST-VERIFY FAILED: service_role lacks INSERT on public.api_keys — the persist arm of validate-and-encrypt is now the ONLY writer and every connect-a-key would be broken. Rolling back.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 4c. The SELECT allowlist the converted components re-read the new row
  -- through is intact (migration-027 columns; spot-check two).
  IF NOT has_column_privilege('authenticated', 'public.api_keys', 'id', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.api_keys', 'exchange', 'SELECT') THEN
    RAISE EXCEPTION 'Migration 20260823120000 POST-VERIFY FAILED: authenticated lost SELECT on api_keys.id/exchange — the converted components re-fetch the minted row through that allowlist. Rolling back.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 4d. The marker landed AND the older markers survived the re-stamp.
  SELECT col_description('public.api_keys'::regclass, attnum) INTO v_comment
    FROM pg_attribute
   WHERE attrelid = 'public.api_keys'::regclass AND attname = 'exchange';

  IF v_comment NOT LIKE '%20260823120000_revoke_api_keys_insert%' THEN
    RAISE EXCEPTION 'Migration 20260823120000 POST-VERIFY FAILED: the revoke_api_keys_insert marker is absent from the api_keys.exchange comment — the SQL gates arm on it and would stay dormant. Rolling back.'
      USING ERRCODE = 'data_exception';
  END IF;
  IF v_comment NOT LIKE '%20260810120000%' THEN
    RAISE EXCEPTION 'Migration 20260823120000 POST-VERIFY FAILED: the re-stamp dropped the 20260810120000 marker, which gates the sibling test''s assertions 2/3 — they would SKIP with exit code 0 on a database they guard. Restore the substring. Rolling back.'
      USING ERRCODE = 'data_exception';
  END IF;
  -- 4e. The APPENDED operational sentence actually landed. 4d cannot detect its
  -- absence, because the marker substring it checks arrives via the replace()
  -- rather than the append — which is exactly how the append silently no-opped
  -- in an earlier draft while every other assertion stayed green.
  IF v_comment NOT LIKE '%Do not re-open client INSERT on this table.%' THEN
    RAISE EXCEPTION 'Migration 20260823120000 POST-VERIFY FAILED: the appended sentence "Do not re-open client INSERT on this table." is absent from the api_keys.exchange comment — the append silently no-opped and the catalogue carries no instruction against re-granting. Rolling back.'
      USING ERRCODE = 'data_exception';
  END IF;
  IF v_comment LIKE '%deliberately still uses this column%' THEN
    RAISE EXCEPTION 'Migration 20260823120000 POST-VERIFY FAILED: the stale OQ-2 sentence survived the correction — the catalogue would keep asserting the forgeable-input design RANK-04 removed. Rolling back.'
      USING ERRCODE = 'data_exception';
  END IF;

  RAISE NOTICE 'Migration 20260823120000 post-verify OK: INSERT withdrawn from anon+authenticated, DELETE and the SELECT allowlist intact, comment markers current.';
END
$verify$;

COMMIT;
