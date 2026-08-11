-- ============================================================================
-- api_keys.attested_venue — the SERVER-ATTESTED venue the probe gate can trust
-- (2026-08-11, Phase 153.6 / PARITY-04, cluster D)
-- ============================================================================
--
-- Calibration, stated once and honoured throughout: this is a SELF-TARGETED
-- CONTROL BYPASS. An owner mislabels their OWN key to dodge a probe on their
-- OWN key. It is not a tenant leak and not a data breach. What is lost is the
-- assurance that a key which was read-only at Connect had not been broadened
-- to trade/withdraw by the time it was submitted — serious for a product that
-- sells verified performance, not a 3am page.
--
-- Background — what 20260810120000 closed, and what it left open
-- --------------------------------------------------------------
-- /api/strategies/finalize-wizard runs the ASVS V4 scope-broadening probe on
-- every submit, and skips it for the ONE venue that exposes no per-key scope
-- endpoint. The skip's sole input is `api_keys.exchange`.
--
-- 20260810120000 removed table-level UPDATE from anon + authenticated and
-- added a SECURITY INVOKER BEFORE UPDATE trigger, which closed the REWRITE
-- path. It deliberately left INSERT and DELETE alone (its own line 181 warns
-- that an over-broad withdrawal would silently break connect-a-key and
-- delete-a-key). Those two are both live client paths — see
-- ApiKeyManager.tsx:254/:352 and StrategyForm.tsx:140.
--
-- So the round trip survived: DELETE the row, re-INSERT it with a forged
-- `exchange`. Both halves are still permitted, and 20260723172032 widened
-- api_keys_exchange_check to ADMIT the probe-exempt venue, so the forged value
-- is a legal value of the constraint today. 20260810120000's header claimed
-- the mislabelled row "can never be corrected back" and rested its
-- "self-defeating forgery" residual on that claim; the claim is false, and the
-- same commit as this migration corrects it (Phase 153.6 D-04).
--
-- The fix is NOT to lock the column down further (D-02/D-03: no new privilege
-- change on this table, and the label may stay client-writable). The fix is to
-- stop the probe gate trusting a client-writable column at all. The venue the
-- server itself validated already exists inside a privileged writer — the
-- wizard never performs a client INSERT, it calls the SECURITY DEFINER RPC
-- create_wizard_strategy(p_exchange, ...) (or the composite twin
-- add_wizard_composite_key) and the RPC does the api_keys INSERT itself. That
-- value was simply never stored where the probe could read it. This migration
-- stores it.
--
-- What changes
-- ------------
--   1. api_keys.attested_venue text, nullable. NULL is a meaningful value: it
--      means "no server attestation", and the gate's fail-toward rule turns
--      that into PROBE. ⛔ The read path must never fall back to `exchange`;
--      that fallback is the hole that never closes.
--
--      ⛔ NO GRANT AND NO REVOKE ANYWHERE IN THIS FILE, and none is needed
--      (D-02). Migration 027 (20260410225608) already revoked table-level
--      SELECT on api_keys and granted back a per-column allowlist, so a newly
--      added column is simply never readable by anon/authenticated — which is
--      the correct posture, because the client never needs to read it.
--      Table-level INSERT is untouched, so a client CAN supply the column;
--      item 4 is what makes that irrelevant. Function privileges are likewise
--      untouched: CREATE OR REPLACE FUNCTION preserves the existing ACL, so
--      the EXECUTE grants issued by 20260602190000 and 20260710180000 survive
--      items 2 and 3 unchanged — and the post-verify block asserts exactly
--      that rather than re-issuing them.
--
--   2. CREATE OR REPLACE create_wizard_strategy, re-based VERBATIM on the
--      LATEST definition — migration 20260602190000, lines 62-157 — with
--      EXACTLY two additions: `attested_venue` in the api_keys INSERT column
--      list and `p_exchange` in its VALUES. A repo-wide grep finds four
--      definitions (20260411103316, 20260513084844, 20260515114310,
--      20260602190000); the last is HEAD, re-verified 2026-08-11. (B5b lesson:
--      grep ALL migrations for the function name and re-base on the newest
--      body before CREATE OR REPLACE, or an older body is silently restored —
--      here that would revert the F6 advisory-lock idempotency fence.)
--
--   3. CREATE OR REPLACE add_wizard_composite_key, re-based VERBATIM on the
--      LATEST definition — migration 20260710180000, lines 53-141 — with the
--      same two additions. Grep finds exactly one definition; 20260712120000
--      only mentions the name in prose. Re-verified 2026-08-11.
--
--   4. A SECURITY INVOKER BEFORE INSERT trigger that NULLs a client-supplied
--      attested_venue. SECURITY INVOKER is load-bearing — see the trap comment
--      on the function itself.
--
--   5. A count-pinned PRE-FLIGHT census check, then a one-time backfill of
--      attested_venue from exchange, then an ABORTING post-verify block.
--
--   6. COMMENT ON COLUMN for the new column (it is also the marker the SQL
--      test's assertion 5 gates on), and a re-stamp of the `exchange` comment
--      whose "read by finalize-wizard as the input to the scope-broadening
--      probe gate" sentence becomes FALSE the moment this applies. ⛔ The
--      re-stamp PRESERVES the literal substring 20260810120000: it is the gate
--      marker for assertions 2 and 3 of
--      supabase/tests/test_api_keys_exchange_not_user_writable.sql, and
--      dropping it turns those assertions into silent SKIPs.
--
-- Why a backfill at all, and why it is not "trusting the column forever"
-- ---------------------------------------------------------------------
-- Pure fail-toward-probing with no backfill would break PROD today: the live
-- MT5 keys pre-date this phase, they would be probed, and an MT5 permissions
-- probe is the PERMANENT failure that 153.2-04 exists to prevent. Every
-- re-finalize of an MT5 draft would answer KEY_SCOPE_CHECK_UNAVAILABLE with no
-- remedy — a self-inflicted regression on this milestone's headline venue.
--
-- The backfill is a bounded, DATED snapshot. After it, the column stops being
-- an authority for every row created afterwards, and the residual is exactly
-- "rows that existed on 2026-08-11 and had ALREADY been forged". Client UPDATE
-- on `exchange` has been unavailable since 20260810120000, so a pre-phase
-- forgery required DELETE + re-INSERT, which leaves a detectable footprint
-- (api_keys.created_at later than the strategy that references the key). The
-- census pin is what converts "we trusted a column" into "we trusted 29
-- specific rows and wrote the number down".
--
-- Residual, deliberately NOT closed here
-- --------------------------------------
--   * `exchange` remains client-supplied at row creation on the two non-wizard
--     INSERT paths, and remains the input to the strategies.asset_class
--     annualization stamp (√365 crypto vs √252 traditional) — a money-math
--     boundary that is ALSO forgeable. That reader is deliberately OUT of this
--     phase's charter (153.6 OQ-2); flagged, not silently widened.
--   * The pre-phase rows described above.
--   * The probe's OUTCOME is not provable in SQL. This migration and the SQL
--     test prove the probe's INPUT is unforgeable; the TS half in
--     finalize-wizard/route.test.ts proves a forged row is PROBED. Neither
--     half alone discharges D-05.
--
-- Idempotency
-- -----------
-- ADD COLUMN IF NOT EXISTS; the CHECK constraint is added only if absent; both
-- RPCs and the trigger function are CREATE OR REPLACE; the trigger is
-- DROPped-if-exists before CREATE.
--
-- ⛔ THE BACKFILL IS NOT IDEMPOTENT BY VIRTUE OF ITS NULL PREDICATE, and the
-- earlier claim that it was ("the backfill is WHERE attested_venue IS NULL, so
-- a re-run writes nothing — safe to re-run") was FALSE from the moment the
-- trigger started working (153.6 code review WR-01). After first apply, every
-- non-privileged client INSERT lands attested_venue = NULL deliberately; an
-- unbounded re-run would sweep exactly those rows and set attested_venue =
-- exchange, i.e. retro-attest the forgeable label on the one population the
-- trigger exists to keep unattested. What actually makes a re-run safe is the
-- DATED CUTOFF on the backfill (section 6) — it is bounded to rows that predate
-- this migration, so a re-run cannot reach anything created since. Post-verify
-- (a) is bounded by the same cutoff, for the same reason: unscoped, it would
-- have encoded "no unattested row may exist" as an invariant and FORCED the
-- retro-attestation rather than surfacing it.
--
-- The census pre-flight is a read; it stays correct on a re-run because the
-- backfill does not change any row's `exchange`.
-- ============================================================================

BEGIN;

SET lock_timeout = '3s';

-- ───────────────────────────────── 1. the column
ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS attested_venue text;

-- ─────────────────── 2. create_wizard_strategy (re-based on 20260602190000)
-- Re-based VERBATIM on the LATEST definition, migration
-- 20260602190000_f6_wizard_session_idempotency.sql:62-157. The ONLY changes
-- are `attested_venue` in the api_keys INSERT column list and `p_exchange` in
-- its VALUES. Everything else — the auth.uid() guards, the 'wizdraft:'
-- advisory-lock idempotency fence, the complete-draft replay, the strategies
-- INSERT — is byte-identical to that body.
CREATE OR REPLACE FUNCTION create_wizard_strategy(
  p_user_id UUID,
  p_exchange TEXT,
  p_label TEXT,
  p_api_key_encrypted TEXT,
  p_api_secret_encrypted TEXT,
  p_passphrase_encrypted TEXT,
  p_dek_encrypted TEXT,
  p_nonce TEXT,
  p_kek_version INTEGER,
  p_placeholder_name TEXT,
  p_wizard_session_id UUID
)
RETURNS TABLE(strategy_id UUID, api_key_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
SET lock_timeout = '3s'
AS $$
DECLARE
  v_auth_uid UUID := auth.uid();
  v_key_id UUID;
  v_strategy_id UUID;
BEGIN
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'create_wizard_strategy called without an auth session'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_auth_uid <> p_user_id THEN
    RAISE EXCEPTION 'create_wizard_strategy: p_user_id (%) does not match auth.uid (%)',
      p_user_id, v_auth_uid
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- F6 (H-0304/H-0311/H-0186): idempotency fence. Serialize concurrent calls
  -- carrying the same wizard_session_id on a transaction-scoped advisory lock
  -- (auto-released on commit/rollback; advisory locks are not subject to
  -- lock_timeout), then return any draft already created for this
  -- (user, session) instead of minting a duplicate strategies + api_keys pair.
  -- A client double-click or browser retry now resolves to the SAME draft
  -- rather than two drafts + two encrypted-secret rows.
  PERFORM pg_advisory_xact_lock(
    hashtext('wizdraft:' || p_user_id::text || ':' || p_wizard_session_id::text)
  );

  -- Only replay a COMPLETE draft (api_key_id present). If an orphaned draft
  -- exists for this session with a NULL api_key_id (its api_keys row was deleted
  -- out from under it via the ON DELETE SET NULL FK), do NOT hand back a NULL
  -- key — fall through so the INSERT trips strategies_user_wizard_session_uniq
  -- (23505 → the route's recoverable DRAFT_ALREADY_EXISTS 409) instead of
  -- returning a NULL api_key_id the route would reject with a permanent 500
  -- (red-team MEDIUM-1: route fence requires api_key_id; the two fences must agree).
  SELECT s.id, s.api_key_id
    INTO v_strategy_id, v_key_id
    FROM strategies s
   WHERE s.user_id = p_user_id
     AND s.wizard_session_id = p_wizard_session_id
     AND s.api_key_id IS NOT NULL
   LIMIT 1;

  IF v_strategy_id IS NOT NULL THEN
    -- Idempotent replay: hand back the existing draft, no new rows.
    RETURN QUERY SELECT v_strategy_id, v_key_id;
    RETURN;
  END IF;

  -- 153.6 / PARITY-04: attested_venue is stamped HERE, inside the SECURITY
  -- DEFINER body, from the p_exchange the server itself validated at mint
  -- time. This is the ONLY kind of writer whose value survives the
  -- api_keys_scrub_attested_venue trigger.
  INSERT INTO api_keys (
    user_id, exchange, label,
    api_key_encrypted, api_secret_encrypted, passphrase_encrypted,
    dek_encrypted, nonce, kek_version, is_active,
    attested_venue
  )
  VALUES (
    p_user_id, p_exchange, p_label,
    p_api_key_encrypted, p_api_secret_encrypted, p_passphrase_encrypted,
    p_dek_encrypted, p_nonce, COALESCE(p_kek_version, 1), TRUE,
    p_exchange
  )
  RETURNING id INTO v_key_id;

  INSERT INTO strategies (
    user_id, api_key_id, name, status, source,
    strategy_types, subtypes, markets, supported_exchanges,
    wizard_session_id
  )
  VALUES (
    p_user_id, v_key_id, p_placeholder_name, 'draft', 'wizard',
    '{}', '{}', '{}', ARRAY[p_exchange],
    p_wizard_session_id
  )
  RETURNING id INTO v_strategy_id;

  RETURN QUERY SELECT v_strategy_id, v_key_id;
END;
$$;

-- ────────────────── 3. add_wizard_composite_key (re-based on 20260710180000)
-- Re-based VERBATIM on the LATEST definition, migration
-- 20260710180000_wizard_composite.sql:53-141, with the same two additions.
-- The DISTINCT 'wizcomposite:' advisory-lock space and the lazy composite-draft
-- creation are byte-identical to that body.
CREATE OR REPLACE FUNCTION public.add_wizard_composite_key(
  p_user_id UUID,
  p_exchange TEXT,
  p_label TEXT,
  p_api_key_encrypted TEXT,
  p_api_secret_encrypted TEXT,
  p_passphrase_encrypted TEXT,
  p_dek_encrypted TEXT,
  p_nonce TEXT,
  p_kek_version INTEGER,
  p_placeholder_name TEXT,
  p_wizard_session_id UUID
)
RETURNS TABLE(strategy_id UUID, api_key_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
SET lock_timeout = '3s'
AS $$
DECLARE
  v_auth_uid UUID := auth.uid();
  v_key_id UUID;
  v_strategy_id UUID;
BEGIN
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'add_wizard_composite_key called without an auth session'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_auth_uid <> p_user_id THEN
    RAISE EXCEPTION 'add_wizard_composite_key: p_user_id (%) does not match auth.uid (%)',
      p_user_id, v_auth_uid
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Idempotency fence for the DRAFT only (ONB-03: the per-KEY add proceeds).
  -- DISTINCT 'wizcomposite:' lock space so the single-key 'wizdraft:' fence is
  -- untouched. Serializes concurrent adds for this (user, session) so two calls
  -- resolve to ONE composite draft instead of two.
  PERFORM pg_advisory_xact_lock(
    hashtext('wizcomposite:' || p_user_id::text || ':' || p_wizard_session_id::text)
  );

  -- The composite draft is the (user, session) strategies row with a NULL
  -- api_key_id (the single-key link is NEVER set for a composite). If none
  -- exists yet, create it. A single-key draft for the same session (api_key_id
  -- set) does NOT match this predicate, so we fall through to INSERT and trip
  -- strategies_user_wizard_session_uniq (23505 → the route maps it loud).
  SELECT s.id
    INTO v_strategy_id
    FROM strategies s
   WHERE s.user_id = p_user_id
     AND s.wizard_session_id = p_wizard_session_id
     AND s.api_key_id IS NULL
   LIMIT 1;

  IF v_strategy_id IS NULL THEN
    -- Mirrors create_wizard_strategy's strategies INSERT column-for-column
    -- EXCEPT api_key_id, which is omitted so it stays NULL for the composite.
    INSERT INTO strategies (
      user_id, name, status, source,
      strategy_types, subtypes, markets, supported_exchanges,
      wizard_session_id
    )
    VALUES (
      p_user_id, p_placeholder_name, 'draft', 'wizard',
      '{}', '{}', '{}', ARRAY[p_exchange],
      p_wizard_session_id
    )
    RETURNING id INTO v_strategy_id;
  END IF;

  -- ALWAYS mint a fresh encrypted api_keys row (this IS the per-key add — the
  -- api_keys INSERT column list mirrors create_wizard_strategy verbatim).
  -- 153.6 / PARITY-04: attested_venue stamped from the server-validated
  -- p_exchange, exactly as in the single-key twin.
  INSERT INTO api_keys (
    user_id, exchange, label,
    api_key_encrypted, api_secret_encrypted, passphrase_encrypted,
    dek_encrypted, nonce, kek_version, is_active,
    attested_venue
  )
  VALUES (
    p_user_id, p_exchange, p_label,
    p_api_key_encrypted, p_api_secret_encrypted, p_passphrase_encrypted,
    p_dek_encrypted, p_nonce, COALESCE(p_kek_version, 1), TRUE,
    p_exchange
  )
  RETURNING id INTO v_key_id;

  RETURN QUERY SELECT v_strategy_id, v_key_id;
END;
$$;

-- ───────────── 4. the scrub trigger: a client-supplied value is not evidence
CREATE OR REPLACE FUNCTION public.scrub_client_supplied_attested_venue()
RETURNS TRIGGER
LANGUAGE plpgsql
-- ⛔ SECURITY INVOKER (the default — stated explicitly) is LOAD-BEARING, and
-- this is the trap to understand before "fixing" it: under SECURITY DEFINER,
-- current_user would be this function's owner and the privileged-caller check
-- below would ALWAYS pass, making the trigger a silent no-op. That is exactly
-- the bug that made prevent_profile_role_change a no-op (see 20260529150000's
-- header), and it is why prevent_api_key_venue_change is INVOKER too
-- (20260810120000:110-116). Do not change this line.
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
BEGIN
  -- Privileged writers keep whatever they supplied: the two SECURITY DEFINER
  -- wizard RPCs run as the table owner, the analytics worker and the
  -- support/admin routes run as service_role, and migrations/backfills run as
  -- postgres. Everyone else — every browser session, on every client INSERT
  -- path including a DELETE-then-re-INSERT round trip — lands NULL.
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  -- Scrub, do not refuse. Raising here would break the two live client INSERT
  -- paths (ApiKeyManager, StrategyForm) for a value they have no business
  -- setting, and D-02/D-03 keep those paths open on purpose. NULL is the
  -- honest answer: "no server attestation", which the probe gate reads as
  -- PROBE.
  NEW.attested_venue := NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS api_keys_scrub_attested_venue ON public.api_keys;
CREATE TRIGGER api_keys_scrub_attested_venue
BEFORE INSERT
ON public.api_keys
FOR EACH ROW EXECUTE FUNCTION public.scrub_client_supplied_attested_venue();

COMMENT ON FUNCTION public.scrub_client_supplied_attested_venue() IS
  'Phase 153.6 / PARITY-04. NULLs a client-supplied api_keys.attested_venue on '
  'INSERT so the finalize-wizard scope-broadening probe gate reads only values '
  'written by the two SECURITY DEFINER wizard RPCs. SECURITY INVOKER so '
  'current_user is the REAL caller — a DEFINER form would be a no-op. It '
  'scrubs rather than raises, because the client INSERT path stays open by '
  'design (153.6 D-02/D-03).';

COMMENT ON TRIGGER api_keys_scrub_attested_venue ON public.api_keys IS
  'Fires on every api_keys INSERT. Non-privileged callers cannot persist an '
  'attested_venue; NULL then means "unattested", which the probe gate treats '
  'as PROBE (fail-toward). Companion to migration 20260811210000.';

-- ───── 5. PRE-FLIGHT: the census pin (the backfill's premise, written down)
-- ⚠️ NO EXISTING MIGRATION PINS A HAND-TYPED COUNT OF *DATA* ROWS AND ABORTS ON
-- INEQUALITY. This block deliberately COMPOSES two conventions that do exist:
--   * the `IF v_x <> <hand-typed literal> THEN RAISE EXCEPTION ... USING
--     ERRCODE` shape from the SCHEMA-fact pins (20260501055202:321, :343;
--     20260420073003:882; 20260420213754:455), and
--   * the pre-flight-guard / post-verify pairing of 20260419140917:11-56,
--     where each half aborts and each ends with a NOTICE on success.
-- ⛔ It deliberately does NOT copy 20260429063138:38-58, the data backfill that
-- counts and only RAISE NOTICEs. That is the shape which cannot fail, and a
-- guard that cannot fail is this phase's own defect class.
--
-- TEST-APPLICABILITY. The pin is PROD-shaped, but this file also applies to the
-- shared TEST project and to local/CI databases, where the SQL test gate needs
-- it. A pin that aborted every non-PROD apply would leave assertion 5 skipping
-- forever. The discriminator is TWO-SIDED so that a PROD apply can never
-- SILENTLY take the lenient branch: the census signature (PROD's 2 mt5 rows,
-- one owner, both created 2026-08-04 UTC — a stable, public-safe fingerprint
-- carrying no key material) must be ABSENT before the strict pin is waived.
-- Residual, stated honestly: a PROD state in which BOTH censused mt5 rows were
-- deleted between the census and the apply is indistinguishable from TEST and
-- would skip the pin. Accepted — deleting both rows also breaks their
-- strategies' key links loudly, so it is not a quiet state.
DO $census$
DECLARE
  -- ⛔ THE PIN. MEASURED 2026-08-11 against khslejtfbuezsmvmtsdn (read-only,
  -- counts only, no key material): 29 rows total — deribit 13, okx 9, bybit 5,
  -- mt5 2. Both mt5 rows belong to ONE owner and were created 2026-08-04
  -- (11:37 and 14:20 UTC). These are HAND-TYPED literals on purpose: a count
  -- compared against its own derivation cannot fail. Re-cut them from a fresh
  -- measurement if the census has moved; never soften the comparison to make an
  -- apply pass.
  --
  -- ⚠️ c_pin_total is DELIBERATELY NOT AN ABORT CONDITION — see the NOTICE
  -- below. It is retained as the reference point the reported delta is measured
  -- against, so "the table grew by 4 since the census" stays legible in the
  -- apply log without being fatal. c_pin_mt5 is the one with teeth.
  --
  -- They are named CONSTANTs rather than literals inlined into the comparison
  -- because the abort message must report the pin it actually used. With a
  -- second hand-typed copy in the message text, re-cutting the comparison and
  -- forgetting the string produces an error that misreports its own pin —
  -- MEASURED on a local PG16 fixture 2026-08-11: mutating the comparison to 28
  -- while the message still said "29/2" aborted correctly but named the wrong
  -- number. One declaration, three uses.
  c_pin_total CONSTANT INT  := 29;
  c_pin_mt5   CONSTANT INT  := 2;
  c_pin_date  CONSTANT DATE := DATE '2026-08-04';

  v_total INT;
  v_mt5   INT;
  v_sig   INT;
BEGIN
  SELECT count(*) INTO v_total FROM public.api_keys;
  SELECT count(*) INTO v_mt5 FROM public.api_keys WHERE exchange = 'mt5';
  SELECT count(*) INTO v_sig
    FROM public.api_keys
   WHERE exchange = 'mt5'
     AND (created_at AT TIME ZONE 'UTC')::date = c_pin_date;

  -- ⛔ THE DISCRIMINATOR IS THE SIGNATURE, AND IT IS TESTED FIRST. v_sig >= 1
  -- means the censused probe-exempt rows are still present, i.e. this IS the
  -- database that was measured — so a PROD apply can never fall through to the
  -- lenient branch. That is the two-sided property, unchanged.
  IF v_sig >= 1 THEN
    -- ⭐ WHAT THE PIN ACTUALLY PROTECTS is the PROBE-EXEMPT population, not the
    -- table's size. `mt5` is the only venue with scopeProbeSupported: false
    -- (src/lib/closed-sets.ts VENUE_CAPABILITIES), so a backfilled deribit/okx/
    -- bybit/binance/sfox row is attested as its OWN non-exempt venue and is
    -- probed regardless — it cannot buy a skip, and therefore cannot weaken the
    -- backfill's argument. Only an unmeasured mt5 row can.
    IF v_mt5 <> c_pin_mt5 OR v_sig <> c_pin_mt5 THEN
      RAISE EXCEPTION
        'Migration 20260811210000 ABORT: probe-exempt census drift (found mt5=%, of which % carry the % signature; pinned mt5=%, all of them signed). An unmeasured probe-exempt row would be backfilled into a probe SKIP on trust this census never established. Re-measure public.api_keys against khslejtfbuezsmvmtsdn and re-cut the pinned literals before applying. Rolling back.',
        v_mt5, v_sig, c_pin_date, c_pin_mt5
        USING ERRCODE = 'data_exception';
    END IF;
    -- ⛔ THE TOTAL IS REPORTED, NEVER ENFORCED (153.6 migration review MIG-01).
    -- It was strict-equality once, and that was a latent outage: `api_keys` is
    -- live and user-mutable, so ONE key connected or deleted between the
    -- 2026-08-11 census and the merge would abort the PROD auto-apply of a
    -- security fix — for a number carrying no security value, since a non-exempt
    -- row is probed either way. The delta is surfaced so drift is still VISIBLE
    -- in the apply log.
    RAISE NOTICE 'Migration 20260811210000 pre-flight OK: the probe-exempt population matches the pin (% mt5 rows, all created %). Total api_keys observed % against a pinned % (delta %) — reported, not enforced.',
      v_mt5, c_pin_date, v_total, c_pin_total, v_total - c_pin_total;
  ELSE
    RAISE NOTICE 'Migration 20260811210000 pre-flight: census signature absent (found total=%, mt5=%; no mt5 row created %) — this is a non-PROD apply (TEST / local / CI). The strict census pin is not applicable here; the structural post-verifies below still enforce.',
      v_total, v_mt5, c_pin_date;
  END IF;
END
$census$;

-- ───────────────────────────── 6. the one-time backfill
-- A bounded, DATED snapshot, not an endorsement of the column. See the header
-- for why fail-toward-probing alone would break every PROD MT5 finalize, and
-- for the exact residual this leaves behind.
--
-- ⛔ THE DATED CUTOFF IS LOAD-BEARING, AND IT IS WHAT MAKES A RE-RUN SAFE
-- (153.6 code review WR-01). `WHERE attested_venue IS NULL` alone is only
-- harmless at the instant of first apply. From that moment on, EVERY
-- non-privileged client INSERT (ApiKeyManager, StrategyForm) deliberately lands
-- NULL — that is the scrub trigger working. An unbounded re-run would sweep
-- exactly that population and set attested_venue = exchange, blessing the
-- forgeable label on precisely the rows the trigger exists to keep unattested.
-- The cutoff bounds the sweep to rows that PREDATE this migration, so a re-run
-- writes nothing regardless of what has been inserted since.
--
-- ⛔ ONE DECLARATION, TWO USES. The same cutoff bounds post-verify (a) below.
-- Held in a transaction-local GUC rather than repeated as a literal, because a
-- verify whose cutoff drifted EARLIER than the backfill's would pass vacuously
-- — it would simply stop looking at the rows the backfill missed.
SET LOCAL quantalyze.attest_backfill_cutoff = '2026-08-11 00:00:00+00';

UPDATE public.api_keys
   SET attested_venue = exchange
 WHERE attested_venue IS NULL
   AND created_at < current_setting('quantalyze.attest_backfill_cutoff')::timestamptz;

-- ───────────── 7. POST-VERIFY: every check ABORTS, none is NOTICE-only
-- The other half of the 20260419140917 pairing, and the same self-verifying
-- posture as 20260810120000:161-201. Environment-independent by construction:
-- these hold on PROD, TEST, local and CI alike.
DO $verify$
DECLARE
  v_unattested INT;
  v_cws_src    TEXT;
  v_awck_src   TEXT;
  v_trg        BOOLEAN;
  v_exch_com   TEXT;
BEGIN
  -- (a) the backfill actually landed — SCOPED TO THE POPULATION IT CLAIMED
  --     (153.6 code review WR-01). This deliberately does NOT assert "no
  --     unattested row exists anywhere": that would encode the OPPOSITE of the
  --     intended steady state, in which every client INSERT after this
  --     migration lands NULL on purpose, and on a re-run it would FORCE the
  --     retro-attestation the dated cutoff above exists to prevent. The claim
  --     is narrower and true: every row that PREDATES the migration was
  --     covered. Same cutoff as the backfill, read from the same GUC.
  SELECT count(*) INTO v_unattested
    FROM public.api_keys
   WHERE attested_venue IS NULL
     AND created_at < current_setting('quantalyze.attest_backfill_cutoff')::timestamptz;
  IF v_unattested <> 0 THEN
    RAISE EXCEPTION
      'Migration 20260811210000 failed: % api_keys rows created before % still have a NULL attested_venue after the backfill — every one of them would be probed, and an MT5 row among them is a permanent KEY_SCOPE_CHECK_UNAVAILABLE. Rolling back.',
      v_unattested, current_setting('quantalyze.attest_backfill_cutoff');
  END IF;

  -- (b) neither re-base took a stale body. The advisory-lock fences are the
  --     canary: if a body arrived without one, an older definition was
  --     restored and the F6 / composite idempotency guarantee is gone.
  SELECT pg_get_functiondef(
    'public.create_wizard_strategy(uuid,text,text,text,text,text,text,text,integer,text,uuid)'::regprocedure
  ) INTO v_cws_src;
  SELECT pg_get_functiondef(
    'public.add_wizard_composite_key(uuid,text,text,text,text,text,text,text,integer,text,uuid)'::regprocedure
  ) INTO v_awck_src;

  IF v_cws_src NOT ILIKE '%pg_advisory_xact_lock%' OR v_cws_src NOT ILIKE '%wizdraft:%' THEN
    RAISE EXCEPTION
      'Migration 20260811210000 failed: create_wizard_strategy lost its wizdraft: advisory-lock fence — the re-base took a stale definition. Rolling back.';
  END IF;
  IF v_awck_src NOT ILIKE '%pg_advisory_xact_lock%' OR v_awck_src NOT ILIKE '%wizcomposite:%' THEN
    RAISE EXCEPTION
      'Migration 20260811210000 failed: add_wizard_composite_key lost its wizcomposite: advisory-lock fence — the re-base took a stale definition. Rolling back.';
  END IF;
  IF v_cws_src NOT ILIKE '%attested_venue%' OR v_awck_src NOT ILIKE '%attested_venue%' THEN
    RAISE EXCEPTION
      'Migration 20260811210000 failed: a wizard RPC does not write attested_venue, so every key it mints would be unattested and probed. Rolling back.';
  END IF;

  -- (c) the trigger is attached to api_keys and fires BEFORE INSERT.
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.api_keys'::regclass
       AND tgname = 'api_keys_scrub_attested_venue'
       AND NOT tgisinternal
  ) INTO v_trg;
  IF NOT v_trg THEN
    RAISE EXCEPTION
      'Migration 20260811210000 failed: the api_keys_scrub_attested_venue BEFORE INSERT trigger is not attached — a client could persist a forged attestation. Rolling back.';
  END IF;

  -- (d) P4 canary. The exchange column comment is re-stamped below, and the
  --     re-stamp MUST keep the 20260810120000 substring: it is the gate that
  --     arms assertions 2 and 3 of
  --     supabase/tests/test_api_keys_exchange_not_user_writable.sql. Dropping
  --     it would not fail that test — it would make it SKIP, which is worse.
  SELECT col_description(
           'public.api_keys'::regclass,
           (SELECT attnum FROM pg_attribute
             WHERE attrelid = 'public.api_keys'::regclass
               AND attname = 'exchange'
               AND NOT attisdropped)
         ) INTO v_exch_com;
  IF COALESCE(v_exch_com, '') NOT LIKE '%20260810120000%' THEN
    RAISE EXCEPTION
      'Migration 20260811210000 failed: the api_keys.exchange comment no longer names 20260810120000 — the SQL test gate that arms assertions 2 and 3 would silently start SKIPPING. Rolling back.';
  END IF;

  -- (e) the deliberate omission is verified rather than asserted in prose.
  --     This file issues no privilege statement of any kind (D-02); CREATE OR
  --     REPLACE FUNCTION preserves the existing ACL, and this is the check
  --     that proves items 2 and 3 did not disturb it.
  IF NOT has_function_privilege('authenticated',
        'public.create_wizard_strategy(uuid,text,text,text,text,text,text,text,integer,text,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated',
        'public.add_wizard_composite_key(uuid,text,text,text,text,text,text,text,integer,text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION
      'Migration 20260811210000 failed: authenticated lost EXECUTE on a wizard RPC — connect-a-key is broken. Rolling back.';
  END IF;
  IF has_function_privilege('anon',
        'public.create_wizard_strategy(uuid,text,text,text,text,text,text,text,integer,text,uuid)', 'EXECUTE')
     OR has_function_privilege('anon',
        'public.add_wizard_composite_key(uuid,text,text,text,text,text,text,text,integer,text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION
      'Migration 20260811210000 failed: anon acquired EXECUTE on a wizard RPC. Rolling back.';
  END IF;

  RAISE NOTICE 'Migration 20260811210000 post-verify OK: zero unattested rows, both RPC fences intact and stamping attested_venue, scrub trigger attached, 20260810120000 marker preserved, RPC privileges unchanged.';
END
$verify$;

-- ─────────────────────────── 8. the comments (one of them is a test gate)
COMMENT ON COLUMN public.api_keys.attested_venue IS
  'SERVER-ATTESTED venue (migration 20260811210000). Written ONLY by the two '
  'SECURITY DEFINER wizard RPCs, create_wizard_strategy and '
  'add_wizard_composite_key, from the venue the server itself validated at '
  'mint time. A client-supplied value is scrubbed to NULL by the '
  'api_keys_scrub_attested_venue BEFORE INSERT trigger, so a DELETE + '
  're-INSERT round trip cannot forge one. Read by '
  '/api/strategies/finalize-wizard as the SOLE input to the ASVS V4 '
  'scope-broadening probe gate: NULL means PROBE (fail-toward). Never fall '
  'back to api_keys.exchange — that fallback re-opens the bypass this column '
  'exists to close. Rows predating this migration were backfilled from '
  'exchange on 2026-08-11 under a hand-typed census pin (29 rows, 2 of them '
  'the probe-exempt venue).';

-- ⛔ THE 20260810120000 SUBSTRING BELOW IS LOAD-BEARING. It is the marker
-- test_api_keys_exchange_not_user_writable.sql:117-127 keys on to arm its
-- negative assertions; removing it turns them into silent SKIPs (153.6 P4).
-- What is REMOVED here is the sentence claiming this column is read by
-- finalize-wizard as the probe gate's input — true when 20260810120000 was
-- written, false from this migration onward.
COMMENT ON COLUMN public.api_keys.exchange IS
  'Venue LABEL, not an attestation. Client UPDATE was withdrawn at the table '
  'level by migration 20260810120000 and a SECURITY INVOKER trigger backstops '
  'it, but the value is still client-supplied at row creation on the two '
  'non-wizard INSERT paths (ApiKeyManager, StrategyForm), so a mislabelled row '
  'is possible. Input to the strategies.asset_class annualization stamp '
  '(√365 crypto vs √252 traditional) — that reader deliberately still uses '
  'this column (153.6 OQ-2, out of scope). NO LONGER the input to the '
  'finalize-wizard scope-broadening probe gate: since migration '
  '20260811210000 that gate reads api_keys.attested_venue. Do not re-open '
  'client UPDATE on this column.';

COMMIT;
