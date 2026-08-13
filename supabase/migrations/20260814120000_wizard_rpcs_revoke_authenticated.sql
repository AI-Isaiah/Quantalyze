-- ═══════════════════════════════════════════════════════════════════════════
-- Phase 156 (CONNECT-REFACTOR) — Migration B of two. THIS IS THE SC1 CHANGE.
--
-- WHAT: withdraw `authenticated` EXECUTE from both wizard RPCs and narrow both
-- bodies to a `service_role`-only gate carrying ZERO auth.uid().
--
-- WHY HERE AND NOT IN THE ROUTE: PostgREST exposes every `public`-schema
-- function at /rest/v1/rpc/<name>. An ASVS V4 control enforced only in the Next
-- route is enforced only in the tier the caller can skip — the browser holds an
-- `authenticated` JWT and can POST the RPC directly. The GRANT layer is the one
-- door a browser cannot walk around.
--
-- ⚠️ THE IN-BODY GATE IS NOT MERELY DEFENCE-IN-DEPTH FOR A FUTURE RE-GRANT — IT
-- IS AN ACTIVE CONTROL TODAY, and getting this wrong is what hid a real
-- breakage. `auth.role()` reads `request.jwt.claims`, which is ORTHOGONAL to
-- which database role holds EXECUTE. Callers that hold EXECUTE by OWNERSHIP
-- rather than by GRANT — `postgres`, `supabase_admin`, migration sessions and
-- the psql SQL-test harness — sail straight past the REVOKE and land on this
-- gate. That is precisely why six `supabase/tests/**` call sites that invoke
-- these RPCs under an `authenticated` claim now refuse (see ⛔ (vi)); the
-- trigger analysis in ⛔ (vii) correctly found no trigger callers but did not
-- consider non-trigger owner-role ones.
--
-- PRECONDITION, AND IT WAS EVIDENCE NOT ASSUMPTION: Migration A
-- (20260813150106) shipped first, and both routes were observed calling the
-- service_role arm ON PRODUCTION before this file was authored —
-- `.planning/phases/156-.../156-LIVE-ACCEPTANCE.md`, status: pass, rows 1-5.
-- Row 3 recorded a single-key connect, row 4 a composite whose SECOND member
-- was minted by add_wizard_composite_key. That is why this REVOKE removes a
-- path our own code provably no longer takes.
--
-- ⛔ (i) RE-APPLY HAZARD (G7/G8) — NOW ARMED, NOT THEORETICAL.
--     `20260811210000:869-882` and `20260812083206:861-868` post-verify that
--     `authenticated` HAS EXECUTE on these functions. On an ordered fresh
--     replay they run BEFORE this file and pass. But RE-APPLYING EITHER OF
--     THEM AFTER THIS MIGRATION WILL ABORT with their own post-verify error.
--     That is an ordered migration history behaving correctly, not a defect —
--     do NOT soften those assertions and do NOT edit those files (invariant 11).
--     If you hit it, see `docs/runbooks/migration-failure.md`.
--
-- ⛔ (ii) `20260811210000_api_keys_attested_venue.sql` §1b (:225-290, incl. :277)
--     reads as if the connect-flow refactor is still deferred. It is SUPERSEDED
--     BY THIS FILE and must NEVER be edited — it is applied to PROD and TEST.
--
-- ⛔ (iii) THE HONEST CEILING — what this does NOT buy.
--     Any server route holding `createAdminClient()` can still pass ANY
--     p_user_id and ANY p_exchange. That is the standing service_role trust
--     boundary (ADR-0001/ADR-0003), identical to `log_audit_event_service`,
--     which the Python worker calls with a uid of its choosing. What changed is
--     precisely this and nothing more:
--         "any browser session can forge an attestation"
--       → "only our own server code can".
--     ⛔ Write the guarantee as "the venue is the one THIS SERVER OBSERVED a
--     successful read-only authentication at". NEVER write "the venue cannot be
--     forged" — that claim is false and would license removing the probe gate.
--
-- ⛔ (iv) IN-04, RESTATED ACCURATELY. These functions are SECURITY DEFINER owned
--     by `postgres`, so their bodies run as `postgres` — NOT as `service_role`.
--     The api_keys scrub triggers' `service_role` allowlist entry therefore
--     remains UNUSED by this phase: the stamps below survive because the writer
--     is the OWNER, not because the caller is service_role. This migration does
--     not become that entry's beneficiary and does not remove it.
--     ⚠️ `20260812083206:517` says the opposite — that the service_role allowlist
--     entry "is ON PURPOSE and it is what makes Phase 156 work". THIS PARAGRAPH
--     IS THE OPERATIVE ONE (Rule 7: pick one, say why). That file anticipated a
--     design in which the ROUTE inserts into api_keys directly under a
--     service-role client; Phase 156 did not take that design — it routes the
--     write through these SECURITY DEFINER functions, whose bodies run as
--     `postgres` and therefore match the 'postgres' allowlist entry. A reader
--     diffing the two is not looking at a regression.
--
-- ⛔ (v) WHERE THE OWNERSHIP CHECK NOW LIVES: NOT IN THE DATABASE.
--     The auth.uid() comparison is DELETED here, not relaxed. `p_user_id` is
--     `withAuth`'s getUser()-verified `user.id` (ADR-0022 layer 2), and the
--     GRANT layer is what makes trusting it sound: only our server can call
--     this at all. The surviving control is the route-level assertion in
--     src/app/api/strategies/create-with-key/route.test.ts and its composite
--     twin, plus the CONNECT-02b structural guard
--     (src/__tests__/phase-156-wizard-rpc-writer-guard.test.ts) which reds if
--     any wizard-RPC call site is bound from a user-scoped client.
--
-- ⛔⛔ (vi) THE `REVOKE` IN THIS FILE IS NOT DURABLE — AND THAT IS A CLASS.
--     `156-MEASUREMENTS.md` § A4 (measured, Wave 0): Supabase's `pg_default_acl`
--     for `public` functions granted by role `postgres` is
--         postgres=X  anon=X  authenticated=X  service_role=X
--     so EVERY function `postgres` creates in `public` is AUTOMATICALLY granted
--     EXECUTE to `anon` AND `authenticated`. This REVOKE takes effect when it
--     runs — and ANY FUTURE MIGRATION THAT `DROP`s AND RE-`CREATE`s EITHER
--     FUNCTION SILENTLY RE-GRANTS BOTH ROLES, with no error and nothing in the
--     diff to read.
--
--     ⚠️ Not hypothetical. `20260812083206` (three days before this phase) did
--     exactly a DROP + CREATE on create_wizard_strategy, and its post-verify at
--     :867 exists BECAUSE THE AUTHOR HIT THIS FOR `anon` — "DROP destroyed the
--     original ACL and a new function grants EXECUTE to PUBLIC by default, so
--     the REVOKE did not take."
--
--     ⛔ NOTHING IN THIS FILE CAN CLOSE IT. A post-verify runs ONCE, at apply,
--     on this migration; the migration that reopens the door is one nobody has
--     written yet.
--
--     ⭐ THE STANDING RULE, for whoever writes the next migration touching
--     either wizard RPC:
--         ANY migration that DROPs and re-CREATEs create_wizard_strategy or
--         add_wizard_composite_key MUST re-issue
--             REVOKE ALL ON FUNCTION … FROM PUBLIC, anon, authenticated;
--             GRANT EXECUTE ON FUNCTION … TO service_role;
--         in the same migration.
--     ⛔ THE DURABLE ENFORCEMENT DOES NOT EXIST YET. It is assertion **5h** in
--     `supabase/tests/test_api_keys_exchange_not_user_writable.sql`, specified by
--     `156-08-PLAN.md` Task 3, which must arm itself from `pg_get_functiondef`
--     rather than from any comment marker so it re-runs on every PR. As of this
--     migration's authoring that file's assertions stop at 5e and `5h` appears
--     nowhere in the repository.
--     ⛔ THEREFORE: this migration MUST NOT MERGE WITHOUT plan 08 (5f/5g/5h) AND
--     plan 09 in the SAME PR. Merging it alone both reddens `sql-tests` — six
--     existing gate call sites invoke these RPCs as `authenticated` and three
--     more pin `authenticated` as HAVING EXECUTE — and, because branch
--     protection is deferred on this repo, applies to PROD anyway. Without 5h
--     this phase closes the hole once and the next DROP+CREATE reopens it
--     silently — the instance-not-class failure Phase 153.6 was convened to end.
--
-- ⛔ (vii) INVARIANT 17 PRE-EMPTED — this file DOES contain
--     `REVOKE … FROM authenticated`, so here is the trigger analysis that shows
--     it breaks no DML path. MEASURED by grep over supabase/migrations/**:
--       * no trigger function PERFORMs or SELECTs either wizard RPC (zero hits
--         for `PERFORM .*_wizard_` / `FROM (create|add)_wizard`);
--       * `api_keys` carries `api_keys_scrub_attested_venue`,
--         `api_keys_scrub_venue_account_id` (both SECURITY INVOKER),
--         `api_keys_lock_exchange`, `api_keys_stamp_first_added` and
--         `api_keys_published_composite_delete_guard`;
--       * `strategies` carries `guard_wizard_draft_updates_trigger`,
--         `guard_strategies_publish_transition_trigger`,
--         `strategies_reject_sentinel` and
--         `trg_strategies_team_review_mark_guard`.
--     None of them invokes either function, so no INSERT/UPDATE/DELETE by any
--     role acquires a 42501 from this REVOKE. The only callers are the two Next
--     routes, which hold service_role.
--
-- CREATE OR REPLACE, never DROP+CREATE — see (vi) for exactly what DROP costs.
-- No signature changes: 12 args and 11 args, unchanged.
-- ═══════════════════════════════════════════════════════════════════════════


-- ────────────────── 1. create_wizard_strategy — service_role only
-- Re-based VERBATIM from supabase/schema/functions/create_wizard_strategy.sql
-- (source migration 20260813150106 = Migration A). The ONLY regions that differ
-- from that snapshot are the DECLARE block (v_auth_uid is DELETED) and the gate.
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
  v_key_id UUID;
  v_strategy_id UUID;
BEGIN
  -- ⭐ FINAL GATE (Phase 156 Migration B). Migration A's `authenticated` arm is
  -- DELETED. Only service_role may write a wizard draft.
  --
  -- Fail-closed wrapper carried from
  -- `20260515113753_log_audit_event_service_hardened.sql:130-160`: a malformed
  -- request.jwt.claims makes auth.role() RAISE rather than return NULL. NULL
  -- then fails the IS DISTINCT FROM test and is REFUSED.
  --
  -- ⛔ THE WIDTH OF THAT PRECEDENT IS REJECTED. log_audit_event_service admits
  -- `auth.role() IN ('authenticated','service_role')` at 20260515113753:148.
  -- `authenticated` is THE EXACT CALLER THIS PHASE EXISTS TO LOCK OUT; admitting
  -- it here would make this layer a permanent no-op, so that a future GRANT leak
  -- would pass BOTH layers. Carry that file's auth.role() choice, its fail-closed
  -- wrapper, its self-contained REVOKE/GRANT and its body canary. Reject its
  -- width. (156-PATTERNS.md §1; Rule 7 — pick one, say why, never average.)
  --
  -- ⛔ TRAP B — WHY auth.uid() IS ABSENT RATHER THAN RELAXED. `156-MEASUREMENTS.md`
  -- § A2 MEASURED auth.uid() IS NULL for a service_role client. So a "relaxed"
  -- comparison kept for safety — `IF v_auth_uid IS NOT NULL AND v_auth_uid <>
  -- p_user_id` — would be a PERMANENT SILENT NO-OP: the ownership check vanishes
  -- with no error, no 42501, and no test failure. Deleting it is HONEST; keeping
  -- a decorative one is the `_assert_owner` shape at 20260411144407:300-302 that
  -- this phase must not reproduce. Post-verify (e) below aborts the apply if the
  -- literal `auth.uid()` reappears in either body.
  --
  -- ⛔ TRAP C — NEVER current_user / session_user. Inside a SECURITY DEFINER body
  -- current_user is the OWNER, so a gate written on it ALWAYS PASSES — the bug
  -- that made `prevent_profile_role_change` a no-op (20260811210000:518-523,
  -- 20260411103316:313-321). session_user is `authenticator` for every PostgREST
  -- request. auth.role() reads the JWT claim, which is the thing we mean.
  BEGIN
    v_jwt_role := auth.role();
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  IF v_jwt_role IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'create_wizard_strategy: caller role (%) may not write wizard drafts',
      COALESCE(v_jwt_role, '<none>')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- auth.uid() is NULL under service_role, so p_user_id is the ONLY carrier of
  -- the owning identity and a NULL would silently mint an ownerless draft.
  -- Refuse it explicitly rather than let the FK or a later read decide.
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'create_wizard_strategy: p_user_id must not be NULL'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- F6 (H-0304/H-0311/H-0186): idempotency fence. Serialize concurrent calls
  -- carrying the same wizard_session_id on a transaction-scoped advisory lock
  -- (auto-released on commit/rollback; advisory locks are not subject to
  -- lock_timeout), then return any draft already created for this
  -- (user, session) instead of minting a duplicate strategies + api_keys pair.
  PERFORM pg_advisory_xact_lock(
    hashtext('wizdraft:' || p_user_id::text || ':' || p_wizard_session_id::text)
  );

  -- Only replay a COMPLETE draft (api_key_id present). If an orphaned draft
  -- exists for this session with a NULL api_key_id (its api_keys row was deleted
  -- out from under it via the ON DELETE SET NULL FK), do NOT hand back a NULL
  -- key — fall through so the INSERT trips strategies_user_wizard_session_uniq
  -- (23505 → the route's recoverable DRAFT_ALREADY_EXISTS 409) instead of
  -- returning a NULL api_key_id the route would reject with a permanent 500
  -- (red-team MEDIUM-1: route fence requires api_key_id; the two must agree).
  SELECT s.id, s.api_key_id
    INTO v_strategy_id, v_key_id
    FROM strategies s
   WHERE s.user_id = p_user_id
     AND s.wizard_session_id = p_wizard_session_id
     AND s.api_key_id IS NOT NULL
   LIMIT 1;

  IF v_strategy_id IS NOT NULL THEN
    RETURN QUERY SELECT v_strategy_id, v_key_id;
    RETURN;
  END IF;

  -- 153.6 / PARITY-04: attested_venue is stamped HERE, inside the SECURITY
  -- DEFINER body, which is the only kind of writer whose value survives the
  -- api_keys_scrub_attested_venue trigger.
  -- ⛔ p_exchange IS STILL CALLER-SUPPLIED AND STILL NOT VALIDATED HERE. Both
  -- columns are written from that ONE parameter deliberately: the CHECK
  -- api_keys_attested_venue_matches_exchange requires it, so this INSERT cannot
  -- mint an attestation that disagrees with the routing label.
  --
  -- ⭐ CR-01 STATUS UNDER MIGRATION B: CLOSED for the browser, BOUNDED for us.
  -- `authenticated` no longer holds EXECUTE (§3), so the direct-RPC path is shut
  -- and the only callers are our two routes, which pass the venue the server
  -- observed a successful read-only authentication at. The residual that REMAINS
  -- is the service_role trust boundary itself — see header ⛔ (iii). Do not read
  -- this as "the venue cannot be forged".
  --
  -- 154 / WIZCONT-02: venue_account_id is stamped here for the same structural
  -- reason. ⛔ It is NOT coupled to p_exchange and must not be: it identifies an
  -- ACCOUNT WITHIN a venue, not the venue. It is NULL for every venue that
  -- exposes no stable non-secret account id, which is every ccxt venue today,
  -- and the partial index excludes those rows.
  -- ⛔ Do not "fix" it by adding validation here — the value has no in-database
  -- oracle to check against, and a plausible-looking check would hide the residual.
  --
  -- ⭐ NORMALISED AT THE STAMP SITE: btrim, then blank → NULL. (1) Without btrim,
  -- ' 5551234' and '5551234' are DIFFERENT index keys, so a stray space from the
  -- form makes the dedup MISS entirely. (2) Without the NULLIF, an unset field
  -- arriving as '' would be stored as a non-NULL value the partial index governs,
  -- colliding two GENUINELY DIFFERENT accounts — api_keys_venue_account_id_nonblank
  -- would REFUSE that INSERT with 23514, which the wizard route has no handler
  -- for. Keep this expression and the CHECK in agreement.
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


-- ────────────────── 2. add_wizard_composite_key — service_role only
-- The single-key twin's gate, verbatim. ⛔ The two functions are ONE CONTRACT
-- WITH TWO ENTRY POINTS; 153.6 exists because a fix landed on one of them and
-- not the other, and the Phase 153 span verification found that class still open
-- on 2026-08-13. Change one, change both, in the same migration.
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
  v_key_id UUID;
  v_strategy_id UUID;
BEGIN
  -- See the single-key twin for the full rationale: fail-closed wrapper, the
  -- rejected width of the log_audit_event_service precedent, Trap B (why
  -- auth.uid() is ABSENT rather than relaxed — it is a permanent silent no-op
  -- under service_role) and Trap C (never current_user in a DEFINER body).
  BEGIN
    v_jwt_role := auth.role();
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  IF v_jwt_role IS DISTINCT FROM 'service_role' THEN
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
  -- untouched.
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

  -- ALWAYS mint a fresh encrypted api_keys row (this IS the per-key add).
  -- 153.6 / PARITY-04: attested_venue stamped from the caller-supplied
  -- p_exchange, exactly as in the single-key twin — and from the SAME parameter
  -- as `exchange`, which api_keys_attested_venue_matches_exchange requires.
  -- The CR-01 status recorded in §1 applies here unchanged.
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


-- ────────────────── 3. Privileges — THE SC1 CHANGE
-- Self-contained re-assertion for BOTH signatures, in the shape of
-- `20260515113753:200-205`. Every statement here is idempotent.
--
-- ⚠️ WHY `GRANT … TO service_role` IS RE-ISSUED even though Migration A issued
-- it: SELF-CONTAINMENT, not an outage guard. `156-MEASUREMENTS.md` § A4 measured
-- `service_role=X/postgres` on BOTH functions, on TEST and PROD, inherited from
-- `pg_default_acl` and granted by no migration at all — and
-- `REVOKE ALL … FROM authenticated` does not touch service_role's grant. This
-- file re-states it so it can be read without reading Migration A.
--
-- ⛔ The outage THIS file can actually cause is the opposite one: a REVOKE that
-- goes ONE ROLE TOO FAR. Post-verify (c) is that guard.
REVOKE ALL ON FUNCTION public.create_wizard_strategy(
  uuid, text, text, text, text, text, text, text, integer, text, uuid, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_wizard_strategy(
  uuid, text, text, text, text, text, text, text, integer, text, uuid, text
) FROM anon;
REVOKE ALL ON FUNCTION public.create_wizard_strategy(
  uuid, text, text, text, text, text, text, text, integer, text, uuid, text
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_wizard_strategy(
  uuid, text, text, text, text, text, text, text, integer, text, uuid, text
) TO service_role;

REVOKE ALL ON FUNCTION public.add_wizard_composite_key(
  uuid, text, text, text, text, text, text, text, integer, text, uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_wizard_composite_key(
  uuid, text, text, text, text, text, text, text, integer, text, uuid
) FROM anon;
REVOKE ALL ON FUNCTION public.add_wizard_composite_key(
  uuid, text, text, text, text, text, text, text, integer, text, uuid
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.add_wizard_composite_key(
  uuid, text, text, text, text, text, text, text, integer, text, uuid
) TO service_role;


-- ────────────────── 4. attested_venue column comment — the SC5 re-strengthening
-- ⛔⛔ THE 20260811210000 SUBSTRING BELOW IS LOAD-BEARING AND SO IS 20260814120000.
-- `test_api_keys_exchange_not_user_writable.sql:242-253` gates its ENTIRE 5a-5e
-- block on `col_description(...) LIKE '%20260811210000%'`. If a re-stamp drops
-- that 14-digit substring the whole block falls through to
-- `RAISE NOTICE 'SKIP (5)'` at :419-421 — a NOTICE, exit code 0, GREEN CI, and
-- ZERO COVERAGE on the assertions this phase exists to add. This re-stamp
-- PRESERVES 20260811210000 and ADDS 20260814120000, and the new marker is what
-- plan 08's 5f/5g key on, so the two cross-check each other.
--
-- ⚠️ THIS SECTION SITS BEFORE THE `DO $verify$` BLOCK DELIBERATELY.
-- `20260811210000:702-712` records the MEASURED failure of the other order:
-- "in the old order, a re-stamp with the marker removed COMMITTED while (d)
-- reported '20260811210000 marker preserved'."
COMMENT ON COLUMN public.api_keys.attested_venue IS
  'RPC-WRITTEN venue (migration 20260811210000; guarantee STRENGTHENED by '
  '20260814120000, Phase 156 Migration B). ⛔ READ THE GUARANTEE PRECISELY. '
  'What holds NOW: (1) this column is written ONLY by the two SECURITY DEFINER '
  'wizard RPCs — create_wizard_strategy and add_wizard_composite_key — (2) each '
  'writes THIS column and exchange from ONE parameter, so the two cannot '
  'disagree, pinned for every writer present and future by CHECK constraint '
  'api_keys_attested_venue_matches_exchange, and (3) since 20260814120000 those '
  'RPCs are invokable ONLY by service_role over PostgREST: authenticated and '
  'anon hold no '
  'EXECUTE, so a browser session can no longer POST /rest/v1/rpc/ directly and '
  'mint an attestation. The value is therefore THE VENUE THIS SERVER OBSERVED A '
  'SUCCESSFUL READ-ONLY AUTHENTICATION AT. ⛔ It is NOT "unforgeable": any '
  'server route holding a service-role client can still pass any value, which '
  'is the standing service_role trust boundary (ADR-0001/ADR-0003), not a '
  'defect this column can close — and note specifically that the scrub trigger '
  'allowlist INCLUDES service_role, so a service-role client doing a plain '
  'INSERT INTO api_keys writes this column UNSCRUBBED, which is why clause (1) '
  'is a statement about the BROWSER TIER and not a database-level invariant. '
  '⛔ THE REVOKE IS NOT SELF-ENFORCING — Supabase '
  'pg_default_acl re-grants anon and authenticated on any DROP + CREATE of '
  'either function (it bit 20260812083206 for anon); assertion 5h in '
  'test_api_keys_exchange_not_user_writable.sql is what fails CI if a later '
  'migration reopens it. A client-supplied value on a direct INSERT is scrubbed '
  'to NULL by the api_keys_scrub_attested_venue BEFORE INSERT trigger FOR anon '
  'AND authenticated CALLERS, so a DELETE + re-INSERT round trip cannot forge '
  'one from the browser tier; it does NOT stop a service-role direct INSERT. '
  'Read by '
  '/api/strategies/finalize-wizard as the SOLE input to the ASVS V4 '
  'scope-broadening probe gate: NULL means PROBE (fail-toward). Never fall '
  'back to api_keys.exchange — that fallback re-opens the bypass this column '
  'exists to close. Rows created before 2026-08-11T00:00Z were backfilled from '
  'exchange under a hand-typed census pin — the cutoff is a dated bound, NOT '
  '"everything older than the apply", so a row created between that instant and '
  'the apply lands NULL and is PROBED.';


-- ────────────────── 5. Function comments
-- ⚠️ p_venue_account_id is RESTATED, NOT CLOSED. Only the server can pass it
-- now (newly true). The value still has NO IN-DATABASE ORACLE (still false).
-- Do not silently upgrade that clause.
COMMENT ON FUNCTION public.create_wizard_strategy(
  uuid, text, text, text, text, text, text, text, integer, text, uuid, text
) IS
  'Atomic, idempotent api_keys + strategies (source=wizard, status=draft) '
  'insert. SECURITY DEFINER — guard_wizard_draft_updates allows the write via '
  'the current_user shift, and both api_keys scrub triggers admit the owner. F6: '
  'a per-(user, wizard_session_id) advisory lock + select-existing fence dedups '
  'double-submits to one draft (audit H-0304/H-0311/H-0186); '
  'strategies_user_wizard_session_source_uniq is the backstop. 153.6/PARITY-04: '
  'stamps attested_venue from p_exchange (the coupling CHECK '
  'api_keys_attested_venue_matches_exchange requires the two to agree). '
  '154/WIZCONT-02: stamps venue_account_id from p_venue_account_id, NORMALISED '
  'as NULLIF(btrim(...), '''') so a stray space cannot make the dedup miss and a '
  'blank field cannot become an identity. ⭐ 156/Migration B (20260814120000): '
  'SERVICE_ROLE ONLY — authenticated EXECUTE is REVOKED and the in-body gate is '
  'auth.role() IS DISTINCT FROM ''service_role''. There is NO auth.uid() check '
  'and its absence is deliberate: auth.uid() IS NULL under service_role, so a '
  'retained comparison would be a permanent silent no-op. Ownership is bound at '
  'the route (p_user_id is withAuth''s getUser()-verified user.id, ADR-0022). '
  '⛔ p_venue_account_id is STILL NOT VALIDATED here — only the server can pass '
  'it now, but the value has no in-database oracle, so it remains "what the '
  'server passed", not "what the venue confirmed". ⛔ EXACTLY ONE OVERLOAD OF '
  'THIS FUNCTION MAY EXIST: PostgREST resolves rpc() by named parameters and '
  'answers PGRST203 if a second candidate appears, which breaks connect-a-key '
  'for every user. Add parameters by DROP + CREATE (WITH RE-ISSUED GRANTS — see '
  'the migration header, pg_default_acl re-grants anon and authenticated on '
  'DROP), never by CREATE OR REPLACE. See migrations 031, 126, 127, '
  '20260602190000, 20260811210000, 20260812083206, 20260813150106.';

COMMENT ON FUNCTION public.add_wizard_composite_key(
  uuid, text, text, text, text, text, text, text, integer, text, uuid
) IS
  'Wizard composite per-key writer. ⭐ 156/Migration B (20260814120000): '
  'SERVICE_ROLE ONLY, the single-key twin''s gate verbatim — authenticated '
  'EXECUTE is REVOKED, the in-body gate is auth.role() IS DISTINCT FROM '
  '''service_role'', and there is NO auth.uid() check (it would be a permanent '
  'silent no-op under service_role). The two functions are ONE CONTRACT WITH '
  'TWO ENTRY POINTS and 153.6 exists because a fix landed on only one of them: '
  'change one, change both, in the same migration.';


-- ────────────────── 6. POST-VERIFY: every check ABORTS, none is NOTICE-only
-- ⚠️ AFTER §4/§5 deliberately — see the ordering note in §4.
DO $verify$
DECLARE
  v_create_sig CONSTANT TEXT :=
    'public.create_wizard_strategy(uuid,text,text,text,text,text,text,text,integer,text,uuid,text)';
  v_composite_sig CONSTANT TEXT :=
    'public.add_wizard_composite_key(uuid,text,text,text,text,text,text,text,integer,text,uuid)';
  v_create_def TEXT;
  v_composite_def TEXT;
  -- ⛔ COMMENT-STRIPPED COPIES. Every (d)/(e) substring test below runs against
  -- THESE, never against the raw definition. `pg_get_functiondef` reconstructs
  -- the body from `prosrc`, which stores the source VERBATIM — comments included
  -- — so a raw match is wrong in BOTH directions:
  --   * it FALSIFIES the absence test — the Trap B comment block above explains
  --     why auth.uid() must be absent and, in doing so, contains the literal
  --     string. Matching the raw definition would abort this migration's own
  --     apply on the strength of its own documentation.
  --   * it SATISFIES the presence tests — a body that dropped the attested_venue
  --     stamp, the advisory-lock fence or the gate while keeping its explanatory
  --     comment would pass. That is precisely the class Migration A shipped: a
  --     canary that passed on the exact stale re-base it existed to catch.
  -- ⚠️ The strip is line-comment only. It would also blank a `--` occurring
  -- inside a string literal; neither body contains one, and if one is ever added
  -- these assertions must be revisited rather than the strip widened blindly.
  v_create_code TEXT;
  v_composite_code TEXT;
  v_owner TEXT;
  v_comment TEXT;
BEGIN
  -- (a) THE SC1 ASSERTION: authenticated holds NO EXECUTE on either.
  IF has_function_privilege('authenticated', v_create_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'post-verify (a): authenticated STILL holds EXECUTE on create_wizard_strategy — the REVOKE did not take. If this migration DROPped and re-CREATEd the function, pg_default_acl re-granted it; see the header.';
  END IF;
  IF has_function_privilege('authenticated', v_composite_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'post-verify (a): authenticated STILL holds EXECUTE on add_wizard_composite_key — the REVOKE did not take.';
  END IF;

  -- (b) anon likewise.
  IF has_function_privilege('anon', v_create_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'post-verify (b): anon holds EXECUTE on create_wizard_strategy';
  END IF;
  IF has_function_privilege('anon', v_composite_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'post-verify (b): anon holds EXECUTE on add_wizard_composite_key';
  END IF;

  -- (c) ⛔ THE OUTAGE GUARD FOR THIS FILE. Its subject is a REVOKE that went ONE
  -- ROLE TOO FAR, NOT a missing GRANT: `156-MEASUREMENTS.md` § A4 measured
  -- service_role holding EXECUTE by default via pg_default_acl. If this fires,
  -- every connect-a-key is broken and the fix is to re-GRANT, not to retry.
  IF NOT has_function_privilege('service_role', v_create_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'post-verify (c): service_role lacks EXECUTE on create_wizard_strategy — a REVOKE went one role too far and connect-a-key is BROKEN';
  END IF;
  IF NOT has_function_privilege('service_role', v_composite_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'post-verify (c): service_role lacks EXECUTE on add_wizard_composite_key — a REVOKE went one role too far and connect-a-key is BROKEN';
  END IF;

  v_create_def := pg_get_functiondef(v_create_sig::regprocedure);
  v_composite_def := pg_get_functiondef(v_composite_sig::regprocedure);
  v_create_code := regexp_replace(v_create_def, '--[^\n]*', '', 'g');
  v_composite_code := regexp_replace(v_composite_def, '--[^\n]*', '', 'g');

  -- (d) STALE-RE-BASE CANARY. Each body must still carry its OWN advisory-lock
  -- space and the attested_venue stamp. A re-base onto a pre-20260812083206
  -- source would also drop the venue_account_id normalisation, so that is
  -- asserted on its load-bearing half (the bare column name is satisfiable by a
  -- comment; `NULLIF(btrim(` is not).
  IF v_create_code NOT LIKE '%wizdraft:%' THEN
    RAISE EXCEPTION 'post-verify (d): create_wizard_strategy lost its wizdraft: advisory-lock fence — stale re-base';
  END IF;
  IF v_composite_code NOT LIKE '%wizcomposite:%' THEN
    RAISE EXCEPTION 'post-verify (d): add_wizard_composite_key lost its wizcomposite: advisory-lock fence — stale re-base';
  END IF;
  IF v_create_code NOT LIKE '%attested_venue%' OR v_composite_code NOT LIKE '%attested_venue%' THEN
    RAISE EXCEPTION 'post-verify (d): a wizard RPC lost its attested_venue stamp — stale re-base';
  END IF;
  IF v_create_code NOT LIKE '%NULLIF(btrim(p_venue_account_id)%' THEN
    RAISE EXCEPTION 'post-verify (d): create_wizard_strategy lost the btrim/NULLIF normalisation at its venue_account_id stamp site — stale re-base onto a pre-20260812083206 body';
  END IF;

  -- (e) ⚠️ THIS POLARITY IS THE INVERSE OF MIGRATION A's (e). Migration A
  -- REQUIRED the auth.uid() comparison because its authenticated arm depended on
  -- it. Here auth.uid() must be ABSENT: under service_role it is NULL, so any
  -- retained comparison is a permanent silent no-op (Trap B). A reader diffing
  -- the two files will be tempted to "correct" this back — do not.
  IF v_create_code NOT LIKE '%auth.role()%' THEN
    RAISE EXCEPTION 'post-verify (e): create_wizard_strategy has no auth.role() gate';
  END IF;
  IF v_composite_code NOT LIKE '%auth.role()%' THEN
    RAISE EXCEPTION 'post-verify (e): add_wizard_composite_key has no auth.role() gate';
  END IF;
  IF v_create_code LIKE '%auth.uid()%' THEN
    RAISE EXCEPTION 'post-verify (e): create_wizard_strategy still contains auth.uid() — under service_role it is NULL, so a retained comparison is a permanent silent no-op. Delete it, do not relax it.';
  END IF;
  IF v_composite_code LIKE '%auth.uid()%' THEN
    RAISE EXCEPTION 'post-verify (e): add_wizard_composite_key still contains auth.uid() — under service_role it is NULL, so a retained comparison is a permanent silent no-op. Delete it, do not relax it.';
  END IF;
  -- (e2) The CODE-ONLY tell. `v_auth_uid` is the identifier a stale re-base onto
  -- a pre-Migration-B body drags back in, and it appears in no comment in either
  -- new body — so unlike the tests above it cannot be satisfied or falsified by
  -- prose, with or without the strip. Belt and braces for the assertion that
  -- carries this migration's whole point.
  IF v_create_code LIKE '%v_auth_uid%' THEN
    RAISE EXCEPTION 'post-verify (e2): create_wizard_strategy still declares or compares v_auth_uid — stale re-base onto a pre-Migration-B body';
  END IF;
  IF v_composite_code LIKE '%v_auth_uid%' THEN
    RAISE EXCEPTION 'post-verify (e2): add_wizard_composite_key still declares or compares v_auth_uid — stale re-base onto a pre-Migration-B body';
  END IF;

  -- (f) Both stay SECURITY DEFINER, owned inside the scrub triggers' allowlist.
  -- Re-asserts 20260811210000:891-912. A non-DEFINER body would have its stamps
  -- scrubbed to NULL and every finalize would answer PROBE.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE oid = v_create_sig::regprocedure AND prosecdef
  ) THEN
    RAISE EXCEPTION 'post-verify (f): create_wizard_strategy is not SECURITY DEFINER — its attested_venue stamp would be scrubbed to NULL';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE oid = v_composite_sig::regprocedure AND prosecdef
  ) THEN
    RAISE EXCEPTION 'post-verify (f): add_wizard_composite_key is not SECURITY DEFINER';
  END IF;
  SELECT pg_get_userbyid(proowner) INTO v_owner
    FROM pg_proc WHERE oid = v_create_sig::regprocedure;
  IF v_owner NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'post-verify (f): create_wizard_strategy owner (%) is outside the scrub-trigger allowlist', v_owner;
  END IF;
  SELECT pg_get_userbyid(proowner) INTO v_owner
    FROM pg_proc WHERE oid = v_composite_sig::regprocedure;
  IF v_owner NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'post-verify (f): add_wizard_composite_key owner (%) is outside the scrub-trigger allowlist', v_owner;
  END IF;

  -- (g) CONNECT-04: the coupling CHECK is present and validated. Without it the
  -- one-parameter stamp stops being enforceable.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'api_keys_attested_venue_matches_exchange'
       AND conrelid = 'public.api_keys'::regclass
       AND convalidated
  ) THEN
    RAISE EXCEPTION 'post-verify (g): api_keys_attested_venue_matches_exchange is absent or not convalidated';
  END IF;

  -- (h) ⛔ THE GATE-MARKER GUARD. Dropping either substring silently disarms a
  -- CI block that then reports SKIP with exit code 0.
  SELECT col_description(
           'public.api_keys'::regclass,
           (SELECT attnum FROM pg_attribute
             WHERE attrelid = 'public.api_keys'::regclass
               AND attname = 'attested_venue'
               AND NOT attisdropped)
         ) INTO v_comment;
  IF v_comment IS NULL OR v_comment NOT LIKE '%20260811210000%' THEN
    RAISE EXCEPTION 'post-verify (h): the attested_venue comment lost the 20260811210000 marker — test_api_keys_exchange_not_user_writable.sql would SKIP its entire 5a-5e block with exit code 0';
  END IF;
  IF v_comment NOT LIKE '%20260814120000%' THEN
    RAISE EXCEPTION 'post-verify (h): the attested_venue comment does not carry this migration id — plan 08 assertions 5f/5g key on it';
  END IF;

  RAISE NOTICE 'Migration 20260814120000 post-verify OK: authenticated and anon hold NO EXECUTE on either wizard RPC, service_role does, both bodies gate on auth.role() with ZERO auth.uid(), both remain SECURITY DEFINER inside the scrub allowlist, the coupling CHECK is validated, and the attested_venue comment carries BOTH the 20260811210000 gate marker and this migration id.';
END;
$verify$;
