-- ═══════════════════════════════════════════════════════════════════════════
-- Phase 162 (HONEST) / plan 162-05 — D-162-3, the USE-EXISTING-KEY writer.
--
-- ⚠️⚠️ MERGING supabase/migrations/** TO `main` AUTO-APPLIES THIS FILE TO
-- PRODUCTION. There is no separate promotion step and branch protection is OFF
-- on this repo, so the moment this lands on main the function below exists on
-- PROD with the EXECUTE surface declared in §2. Review it on that basis: this
-- is a NEW SECURITY DEFINER writer at the tenant boundary, not a refactor.
--
-- WHAT: `create_wizard_strategy_for_key(p_user_id, p_api_key_id,
-- p_placeholder_name, p_wizard_session_id)` — mints a wizard DRAFT strategy
-- OVER an api_keys row the caller already owns.
--
-- WHY IT EXISTS: `my-strategies` renders an orphaned key ("No strategy yet")
-- whose only control is "Finish setup →", which reopens the wizard and lands on
-- `KEY_ORPHANED` — a refusal the user cannot act on, because releasing the
-- stored key is not something any surface we ship lets them do. The loop is
-- measured and recorded in `src/lib/wizardErrors.ts` (the `KEY_ORPHANED`
-- docblock). This function is the write that ends it.
--
-- ⛔⛔ (i) THE ONE PROPERTY THIS FUNCTION EXISTS TO HOLD: IT NEVER WRITES
--     `api_keys`. The orphan was CREATED by an `api_keys` INSERT whose sibling
--     draft was later deleted; re-INSERTing on the reuse path would mint a
--     SECOND encrypted row for credentials we already hold and trip the
--     venue-identity partial UNIQUE all over again — i.e. it would reproduce
--     the exact state it is being called to resolve (T-162-05-B).
--     ⭐ THE GUARANTEE IS STRUCTURAL, NOT REMEMBERED. This body contains no
--     INSERT targeting `api_keys` at all, so "reuse, never re-INSERT" is a
--     property of the text rather than of a branch condition someone must keep
--     taking. That is the whole reason a NEW function was written instead of
--     widening `create_wizard_strategy` with a reuse arm (decision `new-rpc`,
--     162-05-DECISION.md): inside the live writer the same guarantee degrades
--     to an `IF`, and the negative assertion in
--     `supabase/tests/test_create_wizard_strategy_for_key.sql` could no longer
--     be written at all.
--     ⭐ It also means `create_wizard_strategy` is BYTE-UNTOUCHED by this
--     phase — no CREATE OR REPLACE, no re-base across its eight historical
--     definitions, no blast radius on the live connect-a-key path.
--
-- ⛔ (ii) THE HONEST CEILING — T-162-05-E, ACCEPTED, NOT CLOSED.
--     `p_user_id` is a PARAMETER. This function verifies that the api_keys row
--     belongs to that uid; it CANNOT verify that the uid is the real caller.
--     Any server route holding `createAdminClient()` can pass any uid, which is
--     the standing `service_role` trust boundary (ADR-0001 / ADR-0003), stated
--     identically for `create_wizard_strategy` at
--     `20260814120000_wizard_rpcs_revoke_authenticated.sql` ⛔ (iii) and for
--     `log_audit_event_service`. Write the guarantee as "the key belongs to the
--     uid this server passed". NEVER write "the uid cannot be forged".
--     ⛔ Closing it would mean granting `authenticated` EXECUTE and reading
--     `auth.uid()` in-body — which forks the Migration-B invariant that wizard
--     writers are service-role-only, and makes this write reachable from a
--     browser, bypassing the route's orphan verification and refusal copy.
--     Phase 163 / SEC-03 is where that reclassification, if it happens, lands.
--
-- ⛔ (iii) TRAP C, CARRIED VERBATIM FROM THE TWIN: never `current_user` /
--     `session_user` in a SECURITY DEFINER body. `current_user` is the OWNER,
--     so a gate written on it ALWAYS PASSES (the bug that made
--     `prevent_profile_role_change` a no-op); `session_user` is `authenticator`
--     for every PostgREST request. `auth.role()` reads the JWT claim, which is
--     the thing we mean.
--
-- ⛔ (iv) TRAP B, CARRIED TOO: `auth.uid()` IS ABSENT RATHER THAN RELAXED.
--     156-MEASUREMENTS § A2 measured `auth.uid()` IS NULL under `service_role`,
--     so a "belt and braces" `IF auth.uid() IS NOT NULL AND auth.uid() <>
--     p_user_id` would be a PERMANENT SILENT NO-OP. Its absence is honest; a
--     decorative copy of it would be worse than nothing.
--
-- ⛔ (v) THE REVOKE IN §2 IS NOT SELF-ENFORCING. Supabase's `pg_default_acl`
--     for `public` functions created by `postgres` grants EXECUTE to `anon` and
--     `authenticated` automatically, so ANY future migration that DROPs and
--     re-CREATEs this function silently re-grants both, with nothing in the
--     diff to read (it bit `20260812083206` for `anon`). Use CREATE OR REPLACE.
--     If you must DROP, re-issue the whole of §2 in the same migration. The
--     durable enforcement is arm C of
--     `supabase/tests/test_create_wizard_strategy_for_key.sql`, which reads the
--     LIVE ACL on every PR and cannot be disarmed by editing prose here.
--
-- ⛔ (vi) THE api_keys INSERT REVOCATION IS UNAFFECTED.
--     `20260823120000_revoke_api_keys_insert.sql` withdrew client INSERT on
--     `api_keys`. This function adds no `api_keys` writer of any kind, so it
--     neither needs nor widens that surface.
--
-- ⭐ (vii) COMMENT-STRIP CANARY — DO NOT DELETE THIS LINE OR ITS TOKEN.
--     `pg_get_functiondef` RETURNS COMMENTS, so a SQL gate that greps the raw
--     definition for `p_user_id` is satisfied by PROSE and passes with the code
--     absent. The gate for this function therefore strips `--` comments before
--     every token match, and arm D proves the stripper actually ran by
--     requiring that this token — CANARY_162_05_PROSE_ONLY — which appears ONLY
--     inside comments in the body below, is ABSENT from the stripped text.
--     Delete the token from the body and arm D reds; delete the stripper and
--     arm D reds. Neither can rot silently.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL lock_timeout = '3s';

-- ────────────────── 1. the writer
CREATE OR REPLACE FUNCTION public.create_wizard_strategy_for_key(
  p_user_id UUID,
  p_api_key_id UUID,
  p_placeholder_name TEXT,
  p_wizard_session_id UUID
)
RETURNS TABLE(strategy_id UUID, api_key_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
SET lock_timeout = '3s'
AS $fn$
DECLARE
  v_jwt_role TEXT;
  v_exchange TEXT;
  v_strategy_id UUID;
BEGIN
  -- CANARY_162_05_PROSE_ONLY — see header (vii). This token lives in a comment
  -- and nowhere else in this body; the gate's arm D requires it to be GONE from
  -- the comment-stripped definition, which is what proves the stripper ran.

  -- ── gate 1: service_role only. Fail-closed wrapper carried from
  -- 20260515113753 and from the twin at 20260814120000: a malformed
  -- request.jwt.claims makes auth.role() RAISE rather than return NULL, and
  -- NULL then fails the IS DISTINCT FROM test and is REFUSED.
  BEGIN
    v_jwt_role := auth.role();
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  IF v_jwt_role IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'create_wizard_strategy_for_key: caller role (%) may not write wizard drafts',
      COALESCE(v_jwt_role, '<none>')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ── gate 2: auth.uid() is NULL under service_role, so p_user_id is the ONLY
  -- carrier of the owning identity and a NULL would make the ownership
  -- assertion below compare against nothing. Refuse it explicitly.
  IF p_user_id IS NULL OR p_api_key_id IS NULL THEN
    RAISE EXCEPTION 'create_wizard_strategy_for_key: p_user_id and p_api_key_id must not be NULL'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ── the idempotency fence, copied from create_wizard_strategy's discipline
  -- but keyed on the KEY rather than on the wizard session, and that difference
  -- is the point. The population this path serves LOST its localStorage session
  -- token (that is how the key was orphaned in the first place), so a
  -- session-keyed fence would let every retry mint another draft over the same
  -- key. A transaction-scoped advisory lock is auto-released on commit/rollback
  -- and is not subject to lock_timeout. DISTINCT 'wizreuse:' lock space so the
  -- 'wizdraft:' and 'wizcomposite:' fences are untouched.
  PERFORM pg_advisory_xact_lock(
    hashtext('wizreuse:' || p_user_id::text || ':' || p_api_key_id::text)
  );

  -- ── gate 3: THE OWNERSHIP ASSERTION. This is the in-database half of the
  -- T-162-05-A mitigation; the route's session-uid `.eq("user_id", …)` filter on
  -- the admin client and its user-scoped RLS re-read are the other two layers.
  -- Cross-tenant reuse requires all three to fail at once.
  --
  -- ⭐ `disconnected_at IS NULL` IS PART OF THE ASSERTION, NOT A NICETY.
  -- api_keys rows are RETAINED on disconnect (20260422101911) and every cron
  -- dispatcher deliberately SKIPS a soft-disconnected key, so a draft minted
  -- over one would be a strategy that silently never syncs — the exact defect
  -- the venue-identity fence's mirrored predicate exists to prevent.
  --
  -- ⭐ AND THE VENUE COMES OUT OF THE ROW, NOT OFF THE WIRE. create_wizard_strategy
  -- takes p_exchange from the caller because it is minting the api_keys row and
  -- has nowhere else to get it. Here the row already exists and carries the
  -- venue this server observed a successful read-only authentication at, so this
  -- function has NO venue parameter at all and cannot be handed a forged one.
  -- That is a strictly narrower surface than the twin's, by construction.
  SELECT k.exchange
    INTO v_exchange
    FROM api_keys k
   WHERE k.id = p_api_key_id
     AND k.user_id = p_user_id
     AND k.disconnected_at IS NULL;

  IF NOT FOUND THEN
    -- ⛔ ONE ANSWER FOR "not yours", "does not exist" and "disconnected",
    -- deliberately: three distinguishable refusals would be an ownership oracle
    -- for anyone holding the service key, and the route maps this SQLSTATE to a
    -- single refusal for the same reason.
    RAISE EXCEPTION 'create_wizard_strategy_for_key: no live api_keys row for this owner'
      USING ERRCODE = 'no_data_found';
  END IF;

  -- ── replay: an existing wizard draft over this key IS the answer. Returned
  -- before the connected check below, because a draft is a strategy and would
  -- otherwise be refused as "already connected" on the second call.
  SELECT s.id
    INTO v_strategy_id
    FROM strategies s
   WHERE s.user_id = p_user_id
     AND s.api_key_id = p_api_key_id
     AND s.source = 'wizard'
     AND s.status = 'draft'
   ORDER BY s.created_at ASC
   LIMIT 1;

  IF v_strategy_id IS NOT NULL THEN
    RETURN QUERY SELECT v_strategy_id, p_api_key_id;
    RETURN;
  END IF;

  -- ── gate 4: the CONNECTED refusal. Something already uses this key, so it is
  -- not an orphan and minting a second strategy over it would duplicate the
  -- user's own account across two strategies — the defect WIZCONT-02's fence
  -- exists to prevent, arriving through a different door.
  --
  -- ⭐ `strategy_keys` IS CHECKED TOO, AND THE ROUTE'S TWO-READ RESOLVER CANNOT
  -- SEE IT. A composite member key is linked through `strategy_keys`, while
  -- `strategies.api_key_id` stays NULL on the composite draft — so the route's
  -- `orphaned` measurement (both strategies reads empty) reports a live
  -- composite member as an orphan. That is a pre-existing property of that
  -- resolver, and it is why this assertion is here rather than only there: this
  -- is the last line before the INSERT.
  --
  -- ⛔ NEITHER EXISTS IS SCOPED TO p_user_id, deliberately. The key is already
  -- proven to belong to p_user_id above, so a row referencing it from any owner
  -- is either the same tenant's or a data fault — and in both cases the honest
  -- answer is "something holds this key", not "nothing does".
  IF EXISTS (SELECT 1 FROM strategies s WHERE s.api_key_id = p_api_key_id)
     OR EXISTS (SELECT 1 FROM strategy_keys sk WHERE sk.api_key_id = p_api_key_id)
  THEN
    RAISE EXCEPTION 'create_wizard_strategy_for_key: api key % is already held by a strategy', p_api_key_id
      USING ERRCODE = 'object_in_use';
  END IF;

  -- ── the write. Mirrors create_wizard_strategy's `strategies` INSERT
  -- column-for-column; the api_keys INSERT that sits above it there has no
  -- counterpart here and must never gain one (header ⛔ (i)).
  INSERT INTO strategies (
    user_id, api_key_id, name, status, source,
    strategy_types, subtypes, markets, supported_exchanges,
    wizard_session_id
  )
  VALUES (
    p_user_id, p_api_key_id,
    COALESCE(NULLIF(btrim(p_placeholder_name), ''), 'Untitled strategy'),
    'draft', 'wizard',
    '{}', '{}', '{}', ARRAY[v_exchange],
    p_wizard_session_id
  )
  RETURNING id INTO v_strategy_id;

  RETURN QUERY SELECT v_strategy_id, p_api_key_id;
END;
$fn$;


-- ────────────────── 2. Privileges — the SC1-shaped change for the new surface
-- Self-contained and idempotent, in the shape of 20260814120000 §3. ⚠️ The
-- GRANT to service_role is re-issued even though pg_default_acl already supplies
-- it, so this file can be read without reading that one.
REVOKE ALL ON FUNCTION public.create_wizard_strategy_for_key(uuid, uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_wizard_strategy_for_key(uuid, uuid, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.create_wizard_strategy_for_key(uuid, uuid, text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_wizard_strategy_for_key(uuid, uuid, text, uuid) TO service_role;


-- ────────────────── 3. Function comment
COMMENT ON FUNCTION public.create_wizard_strategy_for_key(uuid, uuid, text, uuid) IS
  'Phase 162 / D-162-3. Mints a wizard DRAFT strategy over an EXISTING api_keys '
  'row the caller already owns, so an orphaned key can be finished instead of '
  'being refused forever. ⛔ It NEVER writes api_keys — that is a property of '
  'this body''s text, not of a branch, and re-INSERTing there would reproduce '
  'the orphan it exists to resolve. service_role-only EXECUTE plus an in-body '
  'auth.role() gate plus an in-body ownership assertion joining api_keys.user_id '
  'to p_user_id and requiring disconnected_at IS NULL. ⛔ THE CEILING: p_user_id '
  'is a parameter, so this verifies that the key belongs to the uid the server '
  'passed — NOT that the uid is the real caller. That is the standing '
  'service_role trust boundary (ADR-0001/ADR-0003), accepted as T-162-05-E, not '
  'a defect this function can close. Recurring enforcement lives in '
  'supabase/tests/test_create_wizard_strategy_for_key.sql, which strips comments '
  'from pg_get_functiondef before every token match because that function '
  'returns comments and a prose-satisfied anchor would pass with the code gone.';


-- ────────────────── 4. Post-verify — aborts the APPLY if the shape is wrong
-- ⚠️ A migration DO block runs ONCE, at apply time, and never again. It is not a
-- substitute for the recurring gate; it exists so a broken apply fails here
-- rather than on the first production call.
DO $verify$
DECLARE
  v_oid  OID;
  v_def  TEXT;
  v_bare TEXT;
BEGIN
  SELECT p.oid INTO v_oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'create_wizard_strategy_for_key';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'post-verify (a): create_wizard_strategy_for_key was not created';
  END IF;

  IF has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'post-verify (b): authenticated holds EXECUTE on create_wizard_strategy_for_key — the REVOKE in §2 did not take (pg_default_acl re-grants on DROP+CREATE)';
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'post-verify (c): anon holds EXECUTE on create_wizard_strategy_for_key';
  END IF;
  IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'post-verify (d): service_role does NOT hold EXECUTE on create_wizard_strategy_for_key — the only sanctioned caller cannot call it';
  END IF;

  v_def := pg_get_functiondef(v_oid);
  -- ⚠️ COMMENT-STRIPPED before every token match below, for the reason in header
  -- (vii): pg_get_functiondef returns comments, and this file's comments discuss
  -- every token being asserted.
  v_bare := regexp_replace(v_def, '--[^\n]*', '', 'g');

  -- ⛔ TWO ARMS, and the FIRST one is what keeps this from silently disarming
  -- (Phase 162 review, F-5). MEASURED: with only the "did it strip" arm below,
  -- DELETING the canary comment from the function body applied GREEN — because
  -- that arm proves the stripper ran only when there was something to strip. It
  -- cannot tell "the stripper worked" from "there was nothing to strip", so the
  -- cheapest way to disarm arms (f)-(h) was to remove the canary. The recurring
  -- gate already had this right at supabase/tests/
  -- test_create_wizard_strategy_for_key.sql (arm D), which reads the RAW
  -- definition; this mirrors its shape so the apply-time check is as hard as
  -- the recurring one rather than a weaker echo of it.
  IF position('CANARY_162_05_PROSE_ONLY' IN v_bare) = 0
     AND position('CANARY_162_05_PROSE_ONLY' IN v_def) = 0 THEN
    RAISE EXCEPTION 'post-verify (e): the prose-only canary CANARY_162_05_PROSE_ONLY is absent from the RAW definition too, so this arm cannot tell "the comment stripper worked" from "there was nothing to strip" — and arms (f), (g) and (h) below lose the only evidence that they read CODE rather than COMMENTARY. Restore the canary comment in the function body (header ⛔ (vii))';
  END IF;
  IF position('CANARY_162_05_PROSE_ONLY' IN v_bare) > 0 THEN
    RAISE EXCEPTION 'post-verify (e): the comment stripper did not strip — the prose-only canary survived, so every token assertion below is satisfiable by comments';
  END IF;
  IF v_bare !~* 'insert\s+into\s+strategies' THEN
    RAISE EXCEPTION 'post-verify (f): the body does not INSERT INTO strategies — it writes nothing';
  END IF;
  IF v_bare ~* 'insert\s+into\s+(public\.)?api_keys' THEN
    RAISE EXCEPTION 'post-verify (g): the body INSERTs into api_keys. That is the ONE thing this function may never do (T-162-05-B) — it reproduces the orphan it exists to resolve';
  END IF;
  IF v_bare NOT LIKE '%auth.role()%' THEN
    RAISE EXCEPTION 'post-verify (h): the body lost its auth.role() gate';
  END IF;

  RAISE NOTICE 'post-verify passed: create_wizard_strategy_for_key is service_role-only, gated, and writes no api_keys row.';
END
$verify$;

COMMIT;
