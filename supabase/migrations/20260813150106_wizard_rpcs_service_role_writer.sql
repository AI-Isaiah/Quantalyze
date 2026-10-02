-- ═══════════════════════════════════════════════════════════════════════════
-- Phase 156 (CONNECT-REFACTOR) — Migration A of two.
--
-- WHAT: both wizard RPCs accept a `service_role` caller, and `service_role` is
-- explicitly granted EXECUTE on both. `authenticated` KEEPS its grant and KEEPS
-- its full auth.uid() ownership check.
--
-- WHY: CR-01 remedy (a). `p_exchange` and `p_venue_account_id` are caller-
-- supplied and unvalidated inside these SECURITY DEFINER bodies, and today
-- `authenticated` holds EXECUTE — so a browser session can POST
-- /rest/v1/rpc/create_wizard_strategy directly and mint an api_keys row whose
-- attested_venue disagrees with the venue the server actually validated. The
-- remedy is to move the write behind a server-side writer that passes the
-- identity IT validated. This is 153.6's PARITY-04 `threat_flag: deferred-control`.
--
-- ⛔ (i) THIS FILE ALONE DOES NOT CLOSE CONNECT-01. It is deliberately ADDITIVE.
--     The follow-up migration `..._wizard_rpcs_withdraw_authenticated.sql`
--     (Phase 156 plan 07) is what withdraws `authenticated` EXECUTE and deletes
--     the `authenticated` arm below. Until it lands, a direct browser RPC call
--     still works exactly as it does today, with today's guarantees.
--
--     The split is bought by ONE direction, not two. MIGRATION-FIRST is the real
--     hazard: revoking `authenticated` EXECUTE while the old deploy is still
--     calling with the user-scoped client 42501s every connect-a-key for the
--     width of the merge window (CONTRIBUTING.md §2 — "the merge IS the apply" —
--     and the Vercel build fires on the SAME merge with NO ordering between
--     them). Deploy-first is not symmetric: `service_role` already holds EXECUTE
--     (see §3), so a new deploy calling with the admin client works before any
--     migration lands.
--
-- ⛔ (ii) THE TRANSITIONAL GATE'S ARMS ARE BRANCHED, NEVER UNIONED.
--     `service_role`  → proceed (the new writer; ownership is bound at the route).
--     `authenticated` → the EXISTING auth.uid() checks run UNCHANGED.
--     anything else / NULL → insufficient_privilege.
--
--     ⛔ The shape that must NOT be written is the flat union:
--         IF v_jwt_role NOT IN ('authenticated','service_role') THEN RAISE …
--     with the uid comparison deleted. That deletes the cross-user elevation
--     guard (T-88-03) for a role that STILL HOLDS EXECUTE for the whole PR-A
--     window — strictly worse than the residual this phase closes. A declaration
--     (`v_auth_uid UUID := auth.uid();`) is NOT a comparison; the comparison
--     `v_auth_uid <> p_user_id` is the guard, and post-verify (e2) below aborts
--     the apply if it is missing.
--
--     ⚠️ The width that `156-PATTERNS.md` §1 rejects in `log_audit_event_service`
--     is the FINAL body's width. That verdict is correct and stands — plan 07
--     installs the final, `service_role`-only body. A two-arm transitional gate
--     is not that shape.
--
-- ⛔ (iii) `20260811210000_api_keys_attested_venue.sql` §1b (:225-290, incl. :277)
--     reads as if Phase 156 is still deferred. It is SUPERSEDED BY THIS FILE and
--     must NEVER be edited — it is applied to PROD and TEST, and migration-reviewer
--     invariant 11 makes any edit an immediate CRITICAL.
--
-- ⛔ (iv) RE-APPLY HAZARD (G7/G8). `20260811210000:869-882` and
--     `20260812083206:861-868` post-verify that `authenticated` HAS EXECUTE.
--     After the follow-up migration withdraws it, re-applying either of those
--     files OUT OF ORDER would abort. That is the correct behaviour of an
--     ordered migration history, not a defect to route around — do not soften
--     those assertions.
--
-- ⛔ (v) IN-04, RESTATED ACCURATELY. These functions are SECURITY DEFINER owned
--     by `postgres`, so their bodies run as `postgres` — NOT as `service_role`.
--     The api_keys scrub triggers' `service_role` allowlist entry therefore stays
--     UNUSED by this phase: the stamps below survive because the writer is the
--     OWNER, not because the caller is `service_role`. This phase does not become
--     that entry's beneficiary and does not remove it.
--
-- CREATE OR REPLACE, never DROP+CREATE. `20260812083206:739-747` records why:
-- "DROP DESTROYS [the ACL]. A freshly created function's default ACL grants
-- EXECUTE to PUBLIC… That is a privilege ESCALATION introduced by the act of
-- dropping, silently, with no error." REPLACE also preserves the COMMENT and
-- keeps `test_api_keys_venue_identity_uniq.sql:41`'s signature pin valid.
-- No signature changes here: 12 args and 11 args, unchanged.
-- ═══════════════════════════════════════════════════════════════════════════


-- ────────────────── 1. create_wizard_strategy (re-based on 20260812083206)
-- Re-based VERBATIM from supabase/schema/functions/create_wizard_strategy.sql,
-- whose `-- source migration:` header names 20260812083206 as the latest source.
-- The ONLY region that differs from that snapshot is the DECLARE/guard block.
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
  p_wizard_session_id UUID,
  p_venue_account_id TEXT DEFAULT NULL
)
RETURNS TABLE(strategy_id UUID, api_key_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
SET lock_timeout = '3s'
AS $$
DECLARE
  v_jwt_role TEXT;
  v_auth_uid UUID := auth.uid();
  v_key_id UUID;
  v_strategy_id UUID;
BEGIN
  -- ⭐ TRANSITIONAL TWO-ARM GATE (Phase 156 Migration A). Deleted by the
  -- follow-up migration, which leaves ONLY the service_role arm.
  --
  -- Read the role behind a fail-closed wrapper, carried from
  -- `20260515113753_log_audit_event_service_hardened.sql:130-160`: a malformed
  -- request.jwt.claims makes auth.role() RAISE rather than return NULL. NULL
  -- then falls to the ELSE arm and is REFUSED — strictly safer than a bare
  -- COALESCE, and it composes with one.
  --
  -- ⚠️ THE WRAPPER COVERS auth.role() ONLY. `v_auth_uid := auth.uid()` sits in
  -- DECLARE, which is evaluated BEFORE this block, so a malformed claims payload
  -- still raises uncaught there. That is pre-existing (the pre-156 bodies have
  -- the same DECLARE) and it fails CLOSED — the raise happens before any write —
  -- so it is an ugly error, not a hole. Do not "fix" it by moving the
  -- initialisation into the wrapper without checking what the routes map the
  -- resulting SQLSTATE to.
  --
  -- ⛔ auth.role(), never current_user and never session_user. Inside a SECURITY
  -- DEFINER body current_user is the OWNER, so a gate written on it always
  -- passes — the bug that made `prevent_profile_role_change` a no-op
  -- (`20260811210000:518-523`, `20260411103316:313-321`). session_user is
  -- `authenticator` for every PostgREST request.
  BEGIN
    v_jwt_role := auth.role();
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  IF v_jwt_role = 'service_role' THEN
    -- The Phase 156 writer. Ownership is bound at the route (p_user_id ===
    -- withAuth's user.id under a session the route authenticated), NOT here.
    -- ⛔ Do NOT add an auth.uid() check to this arm: `156-MEASUREMENTS.md` § A2
    -- MEASURED auth.uid() IS NULL for a service-role client, so any uid-based
    -- check here is a PERMANENT SILENT NO-OP — the `_assert_owner` shape at
    -- `20260411144407:300-302` this phase must not copy.
    NULL;
  ELSIF v_jwt_role = 'authenticated' THEN
    -- ⛔ UNCHANGED IN TEXT AND ERRCODE from the pre-156 body. This arm is the
    -- ENTIRE reason the merge window is safe: `authenticated` still holds
    -- EXECUTE (§3 deliberately does not revoke it), so the cross-user elevation
    -- guard T-88-03 must remain fully intact for it.
    IF v_auth_uid IS NULL THEN
      RAISE EXCEPTION 'create_wizard_strategy called without an auth session'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF v_auth_uid <> p_user_id THEN
      RAISE EXCEPTION 'create_wizard_strategy: p_user_id (%) does not match auth.uid (%)',
        p_user_id, v_auth_uid
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSE
    RAISE EXCEPTION 'create_wizard_strategy: caller role (%) may not write wizard drafts',
      COALESCE(v_jwt_role, '<none>')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Under the service_role arm auth.uid() is NULL, so p_user_id is the ONLY
  -- carrier of the owning identity and a NULL would silently mint an ownerless
  -- draft. Refuse it explicitly rather than let the FK or a later read decide.
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'create_wizard_strategy: p_user_id must not be NULL'
      USING ERRCODE = 'invalid_parameter_value';
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
  -- DEFINER body, which is the only kind of writer whose value survives the
  -- api_keys_scrub_attested_venue trigger.
  -- ⛔ p_exchange IS STILL CALLER-SUPPLIED AND STILL NOT VALIDATED HERE. Both
  -- columns are written from that ONE parameter deliberately: the CHECK
  -- api_keys_attested_venue_matches_exchange requires it, so this INSERT
  -- cannot mint an attestation that disagrees with the routing label. If you
  -- ever add a separate p_attested_venue, or normalise one column and not the
  -- other, this INSERT will start failing — that is the constraint doing its
  -- job, not a bug to route around.
  --
  -- ⭐ CR-01 STATUS UNDER MIGRATION A: the residual NARROWS but does not close.
  -- Once the deploy switches to the service-role writer, the value reaching
  -- p_exchange is the one the SERVER validated. But `authenticated` still holds
  -- EXECUTE for the width of this window, so the direct-RPC path is still open
  -- and the guarantee is still "trusted caller", not "enforced here". The
  -- follow-up migration is what makes the writer the ONLY caller.
  --
  -- 154 / WIZCONT-02: venue_account_id is stamped here for the same structural
  -- reason — this DEFINER body is the only writer whose value survives the
  -- api_keys_scrub_venue_account_id trigger. ⛔ It is NOT coupled to p_exchange
  -- and must not be: it identifies an ACCOUNT WITHIN a venue, not the venue. It
  -- is NULL for every venue that exposes no stable non-secret account id, which
  -- is every ccxt venue today, and the partial index excludes those rows.
  -- ⛔ Do not "fix" it by adding validation here — the value has no in-database
  -- oracle to check against, and a plausible-looking check would hide the residual.
  --
  -- ⭐ NORMALISED AT THE STAMP SITE: btrim, then blank → NULL. Two reasons, both
  -- load-bearing. (1) Without btrim, ' 5551234' and '5551234' are DIFFERENT index
  -- keys, so a stray space from the form makes the dedup MISS entirely and the
  -- duplicate this migration exists to stop sails through. (2) Without the
  -- NULLIF, an unset field arriving as '' (or '  ') would be stored as a non-NULL
  -- value the partial index governs, colliding two GENUINELY DIFFERENT accounts —
  -- api_keys_venue_account_id_nonblank would REFUSE that INSERT with 23514, which
  -- the wizard route has no handler for. Mapping blank → NULL means the wizard
  -- never has to hit its own CHECK: "no identity supplied" and "no identity
  -- exists" land on the same honest value. Keep this expression and the CHECK in
  -- agreement — if one gains a wider trim set, so must the other.
  INSERT INTO api_keys (
    user_id, exchange, label,
    api_key_encrypted, api_secret_encrypted, passphrase_encrypted,
    dek_encrypted, nonce, kek_version, is_active,
    attested_venue, venue_account_id
  )
  VALUES (
    p_user_id, p_exchange, p_label,
    p_api_key_encrypted, p_api_secret_encrypted, p_passphrase_encrypted,
    p_dek_encrypted, p_nonce, COALESCE(p_kek_version, 1), TRUE,
    p_exchange, NULLIF(btrim(p_venue_account_id), '')
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


-- ────────────────── 2. add_wizard_composite_key (re-based on 20260811210000)
-- Re-based VERBATIM from supabase/schema/functions/add_wizard_composite_key.sql.
-- The DISTINCT 'wizcomposite:' advisory-lock space and the lazy composite-draft
-- creation are preserved byte-for-byte. Same single-region change as §1.
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
  v_jwt_role TEXT;
  v_auth_uid UUID := auth.uid();
  v_key_id UUID;
  v_strategy_id UUID;
BEGIN
  -- ⭐ TRANSITIONAL TWO-ARM GATE — the single-key twin's, verbatim. The two
  -- functions are one contract with two entry points; 153.6 exists because a
  -- fix landed on one of them and not the other. Change one, change both.
  BEGIN
    v_jwt_role := auth.role();
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  IF v_jwt_role = 'service_role' THEN
    -- See the single-key twin: ownership is bound at the route, and an
    -- auth.uid() check in THIS arm would be a permanent silent no-op
    -- (`156-MEASUREMENTS.md` § A2 measured auth.uid() IS NULL here).
    NULL;
  ELSIF v_jwt_role = 'authenticated' THEN
    IF v_auth_uid IS NULL THEN
      RAISE EXCEPTION 'add_wizard_composite_key called without an auth session'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF v_auth_uid <> p_user_id THEN
      RAISE EXCEPTION 'add_wizard_composite_key: p_user_id (%) does not match auth.uid (%)',
        p_user_id, v_auth_uid
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSE
    RAISE EXCEPTION 'add_wizard_composite_key: caller role (%) may not write wizard drafts',
      COALESCE(v_jwt_role, '<none>')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'add_wizard_composite_key: p_user_id must not be NULL'
      USING ERRCODE = 'invalid_parameter_value';
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
  -- 153.6 / PARITY-04: attested_venue stamped from the caller-supplied
  -- p_exchange, exactly as in the single-key twin — and, exactly as there, from
  -- the SAME parameter as `exchange`, which the CHECK
  -- api_keys_attested_venue_matches_exchange requires (CR-01). The same
  -- narrows-but-does-not-close status recorded in §1 applies here unchanged.
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


-- ────────────────── 3. Privileges
-- Self-contained re-assertion, shaped on
-- `20260515113753_log_audit_event_service_hardened.sql:200-205`: state the whole
-- intended ACL here rather than depending on what an earlier migration left behind.
--
-- ⛔ THERE IS DELIBERATELY NO `REVOKE … FROM authenticated` IN THIS FILE.
-- That single absent statement — not the GRANT below — is what the two-migration
-- split buys. Revoking here IS the outage: the old deploy is still calling with
-- the user-scoped client for the width of the merge window, and every
-- connect-a-key would 42501. The follow-up migration is its entire content.
REVOKE ALL ON FUNCTION public.create_wizard_strategy(uuid,text,text,text,text,text,text,text,integer,text,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_wizard_strategy(uuid,text,text,text,text,text,text,text,integer,text,uuid,text) FROM anon;
REVOKE ALL ON FUNCTION public.add_wizard_composite_key(uuid,text,text,text,text,text,text,text,integer,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_wizard_composite_key(uuid,text,text,text,text,text,text,text,integer,text,uuid) FROM anon;

-- ⚠️ THESE TWO GRANTS ARE IDEMPOTENT NO-OPS AGAINST TODAY'S MEASURED ACL, and
-- they are written anyway. `156-MEASUREMENTS.md` § A4 MEASURED
-- `service_role=X/postgres` on BOTH functions, on TEST and on PROD, with no
-- drift — inherited from Supabase's `pg_default_acl` for `public` functions
-- granted by role `postgres` (`postgres=X anon=X authenticated=X service_role=X`),
-- which auto-grants on every function `postgres` creates. No migration granted it.
--
-- They are kept for EXPLICITNESS: they name the dependency this phase now has,
-- and they survive a future change to Supabase's default privileges.
--
-- ⛔ `156-RESEARCH.md` finding 3 claims the opposite — that `service_role` holds
-- no EXECUTE today, and that omitting these GRANTs would break every connect.
-- That is FALSIFIED BY MEASUREMENT. Do not re-derive it: a reader who does will
-- conclude the GRANT is the safety-critical statement in this file, and it is
-- not. The safety-critical property here is the ABSENCE of a REVOKE.
GRANT EXECUTE ON FUNCTION public.create_wizard_strategy(uuid,text,text,text,text,text,text,text,integer,text,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.add_wizard_composite_key(uuid,text,text,text,text,text,text,text,integer,text,uuid) TO service_role;


-- ────────────────── 4. Comments
-- ⛔ COMMENT ON COLUMN public.api_keys.attested_venue is NOT re-stamped here.
-- Its current text (`20260811210000:713-745`) is still ACCURATE while
-- `authenticated` holds EXECUTE, and every comment touch risks that file's
-- `LIKE '%20260811210000%'` gate marker. The column comment belongs to plan 07.
COMMENT ON FUNCTION public.create_wizard_strategy(uuid,text,text,text,text,text,text,text,integer,text,uuid,text) IS
  'Wizard single-key draft writer. Phase 156 Migration A: TRANSITIONAL two-arm role gate — a service_role caller proceeds (ownership bound at the route), an authenticated caller still passes the full auth.uid() ownership check, anything else is refused. authenticated STILL holds EXECUTE; the follow-up migration withdraws it and deletes that arm, which is what closes CONNECT-01. SECURITY DEFINER so the attested_venue/venue_account_id stamps survive the api_keys scrub triggers (the body runs as the OWNER, not as service_role).';
COMMENT ON FUNCTION public.add_wizard_composite_key(uuid,text,text,text,text,text,text,text,integer,text,uuid) IS
  'Wizard composite per-key writer. Phase 156 Migration A: same TRANSITIONAL two-arm role gate as its single-key twin, verbatim — the two functions are one contract with two entry points, and 153.6 exists because a fix landed on only one of them. authenticated STILL holds EXECUTE; the follow-up migration withdraws it.';


-- ────────────────── 5. Post-verify
-- ⚠️ THIS SECTION SITS AFTER §4 DELIBERATELY. `20260811210000:702-712` records
-- the MEASURED failure of the other order: a marker-dropping re-stamp COMMITTED
-- while the verify reported "marker preserved".
DO $verify$
DECLARE
  v_create_sig CONSTANT TEXT :=
    'public.create_wizard_strategy(uuid,text,text,text,text,text,text,text,integer,text,uuid,text)';
  v_composite_sig CONSTANT TEXT :=
    'public.add_wizard_composite_key(uuid,text,text,text,text,text,text,text,integer,text,uuid)';
  v_create_def TEXT;
  v_composite_def TEXT;
  v_owner TEXT;
BEGIN
  -- (a) service_role holds EXECUTE on both.
  -- ⚠️ HONEST FRAMING: per `156-MEASUREMENTS.md` § A4 this reads TRUE on a
  -- database where the GRANT was never written, because pg_default_acl already
  -- granted it. It PINS A STATE; it does NOT prove this file's statement ran.
  -- Nothing in PR A distinguishes the two, and nothing needs to. A state worth
  -- having is a state worth asserting.
  IF NOT has_function_privilege('service_role', v_create_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'post-verify (a): service_role lacks EXECUTE on create_wizard_strategy';
  END IF;
  IF NOT has_function_privilege('service_role', v_composite_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'post-verify (a): service_role lacks EXECUTE on add_wizard_composite_key';
  END IF;

  -- (b) authenticated MUST STILL hold EXECUTE. PR-A must not withdraw it early —
  -- that withdrawal is the follow-up migration's whole content, and doing it
  -- here is the merge-window outage this split exists to prevent.
  IF NOT has_function_privilege('authenticated', v_create_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'post-verify (b): authenticated lost EXECUTE on create_wizard_strategy — Migration A must NOT withdraw it';
  END IF;
  IF NOT has_function_privilege('authenticated', v_composite_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'post-verify (b): authenticated lost EXECUTE on add_wizard_composite_key — Migration A must NOT withdraw it';
  END IF;

  -- (c) anon must hold NOTHING.
  IF has_function_privilege('anon', v_create_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'post-verify (c): anon holds EXECUTE on create_wizard_strategy';
  END IF;
  IF has_function_privilege('anon', v_composite_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'post-verify (c): anon holds EXECUTE on add_wizard_composite_key';
  END IF;

  SELECT pg_get_functiondef(v_create_sig::regprocedure) INTO v_create_def;
  SELECT pg_get_functiondef(v_composite_sig::regprocedure) INTO v_composite_def;

  -- (d) STALE-RE-BASE CANARY. A re-base taken from an out-of-date source would
  -- silently revert the advisory-lock fence or the attested_venue stamp and
  -- commit clean. Shaped on `test_api_keys_venue_identity_uniq.sql:198-208`.
  IF v_create_def NOT LIKE '%wizdraft:%' THEN
    RAISE EXCEPTION 'post-verify (d): create_wizard_strategy lost its wizdraft: advisory-lock fence — stale re-base';
  END IF;
  IF v_create_def NOT LIKE '%attested_venue%' THEN
    RAISE EXCEPTION 'post-verify (d): create_wizard_strategy lost its attested_venue stamp — stale re-base';
  END IF;
  -- ⛔ THE TWO ASSERTIONS ABOVE ARE NOT SUFFICIENT ON THEIR OWN, and the gap is
  -- the exact stale re-base they exist to catch. The PREVIOUS single-key source
  -- (20260811210000) contains BOTH 'wizdraft:' AND 'attested_venue' — it just
  -- has no venue_account_id at all. A re-base onto that older body would pass
  -- (d) as written while silently dropping the WIZCONT-02 stamp and the
  -- btrim/NULLIF normalisation, reopening the duplicate-account hole the partial
  -- index exists to close.
  -- ⚠️ '%venue_account_id%' alone is COMMENT-SATISFIABLE — the in-body comment
  -- block names the column. The NULLIF(btrim( assertion is the code-only half
  -- and is the load-bearing one; keep both, and do not drop the second.
  IF v_create_def NOT LIKE '%venue_account_id%' THEN
    RAISE EXCEPTION 'post-verify (d): create_wizard_strategy lost its venue_account_id stamp — stale re-base onto a pre-20260812083206 body';
  END IF;
  IF v_create_def NOT LIKE '%NULLIF(btrim(p_venue_account_id)%' THEN
    RAISE EXCEPTION 'post-verify (d): create_wizard_strategy lost the btrim/NULLIF normalisation at its venue_account_id stamp site — stale re-base';
  END IF;

  IF v_composite_def NOT LIKE '%wizcomposite:%' THEN
    RAISE EXCEPTION 'post-verify (d): add_wizard_composite_key lost its wizcomposite: advisory-lock fence — stale re-base';
  END IF;
  IF v_composite_def NOT LIKE '%attested_venue%' THEN
    RAISE EXCEPTION 'post-verify (d): add_wizard_composite_key lost its attested_venue stamp — stale re-base';
  END IF;

  -- (e) Both bodies carry auth.role() AND auth.uid().
  -- ⚠️ THIS POLARITY IS THE OPPOSITE OF THE FOLLOW-UP MIGRATION'S. Here
  -- auth.uid() is REQUIRED to still be present, because the authenticated arm
  -- still needs it. Plan 07 requires its ABSENCE. Do not "fix" one to match the
  -- other — they are different migrations asserting different contracts.
  IF v_create_def NOT LIKE '%auth.role()%' OR v_create_def NOT LIKE '%auth.uid()%' THEN
    RAISE EXCEPTION 'post-verify (e): create_wizard_strategy must carry BOTH auth.role() and auth.uid() under Migration A';
  END IF;
  IF v_composite_def NOT LIKE '%auth.role()%' OR v_composite_def NOT LIKE '%auth.uid()%' THEN
    RAISE EXCEPTION 'post-verify (e): add_wizard_composite_key must carry BOTH auth.role() and auth.uid() under Migration A';
  END IF;

  -- (e2) ⭐ THE COMPARISON, NOT MERELY THE CALL — the flat-union tell.
  -- (e) above is FULLY SATISFIED by `v_auth_uid UUID := auth.uid();` with no
  -- comparison anywhere in the body. That is the flat union: shipped, with
  -- post-verify reporting success, and the cross-user elevation guard deleted
  -- for a role that still holds EXECUTE. So assert the COMPARISON and the
  -- BRANCH KEYWORD, and ABORT AT APPLY rather than commit such a body.
  -- ⚠️ Written UNROLLED, one assertion per function, never a loop over a
  -- signature array — the plan's slice grep counts these literals, and a loop
  -- satisfies the intent but not the count, and the count is what runs.
  -- ⚠️ The quotes are DOUBLED because this is a PL/pgSQL string literal. That is
  -- correct — do not "fix" it.
  IF v_create_def NOT LIKE '%v_auth_uid <> p_user_id%' THEN
    RAISE EXCEPTION 'post-verify (e2): create_wizard_strategy declares auth.uid() but never COMPARES it to p_user_id — that is the flat union, not the branched gate';
  END IF;
  IF v_create_def NOT LIKE '%ELSIF v_jwt_role = ''authenticated''%' THEN
    RAISE EXCEPTION 'post-verify (e2): create_wizard_strategy has no branched authenticated arm — the arms must be branched, never unioned';
  END IF;
  IF v_composite_def NOT LIKE '%v_auth_uid <> p_user_id%' THEN
    RAISE EXCEPTION 'post-verify (e2): add_wizard_composite_key declares auth.uid() but never COMPARES it to p_user_id — that is the flat union, not the branched gate';
  END IF;
  IF v_composite_def NOT LIKE '%ELSIF v_jwt_role = ''authenticated''%' THEN
    RAISE EXCEPTION 'post-verify (e2): add_wizard_composite_key has no branched authenticated arm — the arms must be branched, never unioned';
  END IF;

  -- (f) Both remain SECURITY DEFINER, owned inside the scrub trigger's
  -- allowlist. Re-asserts `20260811210000:891-912`. A body that stopped being
  -- DEFINER, or changed owner, would have its stamps scrubbed silently.
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_create_sig::regprocedure) THEN
    RAISE EXCEPTION 'post-verify (f): create_wizard_strategy is no longer SECURITY DEFINER';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_composite_sig::regprocedure) THEN
    RAISE EXCEPTION 'post-verify (f): add_wizard_composite_key is no longer SECURITY DEFINER';
  END IF;

  SELECT pg_get_userbyid(proowner) INTO v_owner FROM pg_proc WHERE oid = v_create_sig::regprocedure;
  IF v_owner NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'post-verify (f): create_wizard_strategy owner is outside the scrub-trigger allowlist';
  END IF;
  SELECT pg_get_userbyid(proowner) INTO v_owner FROM pg_proc WHERE oid = v_composite_sig::regprocedure;
  IF v_owner NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'post-verify (f): add_wizard_composite_key owner is outside the scrub-trigger allowlist';
  END IF;

  -- (g) CONNECT-04 — the venue-identity CHECK this phase must be seen not to
  -- have dropped. It is what makes attested_venue and exchange inseparable.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'api_keys_attested_venue_matches_exchange'
       AND conrelid = 'public.api_keys'::regclass
       AND convalidated
  ) THEN
    RAISE EXCEPTION 'post-verify (g): api_keys_attested_venue_matches_exchange is absent or not convalidated';
  END IF;
END;
$verify$;
