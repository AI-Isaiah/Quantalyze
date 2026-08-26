-- ============================================================================
-- Migration: strategy_shares + generation-counter share RPCs (SHARE-01, SHARE-03)
-- Phase 164 / Plan 164-02
-- ============================================================================
-- The storage layer for the per-strategy factsheet share link. Adds:
--   (a) strategy_shares — ONE owner-scoped row per strategy holding a
--       monotonic `generation` counter and a `revoked_at` tombstone;
--   (b) create_strategy_share(p_strategy_id)  — atomic mint-or-reuse;
--   (c) revoke_strategy_share(p_strategy_id)  — atomic revoke (stamp + bump).
--
-- ⛔ TOKEN MODEL — D-02 (164-CONTEXT.md "#### Token model"). The share token is
-- `HMAC(SHARE_TOKEN_SECRET, strategy_id || generation)`, computed in Node. This
-- table stores (strategy_id, generation, revoked_at) and **NEVER a token, raw
-- or hashed**. That is the whole point of the design and the reason this table
-- deliberately diverges from `scenario_shares` (which stores a `token_hash`):
--   * Nothing secret sits at rest. A database leak, a backup, a support query
--     or a future RLS mistake yields a uuid, an integer and two timestamps —
--     never a working link.
--   * Reuse is a REQUIREMENT, and only a re-derivable token delivers it.
--     Hash-only storage makes the raw token unrecoverable, so every "Copy Link"
--     would mint a new link and silently break the recipient's existing one —
--     the founder-hit defect wearing a different hat.
--   * Revoke is ONE atomic increment: `generation = generation + 1` invalidates
--     every previously-copied link at once, and a double-revoke converges
--     naturally (0 rows affected → the route reads that as success, not error).
-- SQL cannot compute the HMAC (this repo enables no `pgcrypto digest`; only
-- gen_random_uuid() from pg13+ core), so — unlike the scenario spine — there is
-- **NO SECURITY DEFINER reader RPC here**. Token → strategy resolution happens
-- in Node on the service_role transport. Consequently anon needs EXECUTE on
-- nothing, and both functions below are SECURITY INVOKER. ⚠️ If any SECURITY
-- DEFINER function is ever added to this surface it takes the full
-- REVOKE/GRANT/`_assert_no_public_execute` treatment (mig 20260622120000 STEP 3).
--
-- ⛔ APPLY FLOW — this migration is applied by NOTHING at authoring time.
--   * TEST: hand-applied by a human at the Phase 164 plan 164-02 blocking
--     checkpoint (three reviewers first: migration-reviewer, rls-policy-auditor,
--     silent-failure-hunter). That hand-apply is the prerequisite for the
--     `sql-tests` CI lane — supabase/tests/test_strategy_shares_rls.sql is
--     EXPECTED RED until it happens (SKIP-01; see that file's header).
--   * PROD: applied AUTOMATICALLY by the Supabase Migrate workflow on
--     push-to-main. Merging this file IS the production deploy.
--   ⚠️ TWO CI GATES ARE DELIBERATELY RED between authoring and that hand-apply,
--   and both clear at it. Neither is a defect to work around:
--     1. supabase/tests/test_strategy_shares_rls.sql — RED by SKIP-01 design.
--     2. scripts/check-gdpr-export-coverage.ts (and the 5 assertions it fails
--        downstream in src/__tests__/gdpr-export-coverage-hook.test.ts, all one
--        root cause) — the hook greps THIS file, sees a new user-owned table and
--        demands a USER_EXPORT_TABLES entry; that entry is typed against
--        `keyof Database["public"]["Tables"]` in the GENERATED
--        src/lib/database.types.ts, which cannot know about a table that is
--        applied nowhere. Adding it early is a hard tsc error (MEASURED
--        2026-08-27: TS2322). Remedy is step 2 of the checkpoint: apply ->
--        regenerate types -> add the manifest + SANITIZE_PARITY_ALLOWLIST
--        entries together. Both sites carry a PENDING block spelling this out.
--        ⛔ Never silence it with an EXCLUDED_TABLES entry — that arm means
--        "not exportable" and would drop a user-owned table from every Art. 15
--        export, permanently and silently.
--   No `supabase db push` from the authoring plan. No rollback file: the
--   `supabase/migrations/down/` convention lapsed after 20260714090000 and
--   every 2026-08 migration ships without one; this migration follows the
--   live convention rather than reviving a dead one. Manual undo is
--   `DROP FUNCTION public.revoke_strategy_share(uuid), public.create_strategy_share(uuid);`
--   followed by `DROP TABLE public.strategy_shares;`.
--
-- HOUSE RULES OBSERVED
--   * `CREATE OR REPLACE FUNCTION`, never DROP+CREATE — a re-create re-applies
--     pg_default_acl and silently re-grants EXECUTE (it bit 20260812083206 for
--     `anon`; see 20260826130000 §(v)). Explicit REVOKE/GRANT below regardless.
--   * Re-base-on-latest-definition rule: satisfied VACUOUSLY. `grep -rn
--     "create_strategy_share\|revoke_strategy_share" supabase/migrations/`
--     returns nothing before this file — both are NEW names with no earlier
--     definition anywhere in the append-only migration history, so there is no
--     prior body to re-base against.
--   * `SET search_path = public, pg_temp` on both functions (the canon from
--     mig 87 H-B / mig 117), never `pg_catalog`.
--   * Both FKs are ON DELETE CASCADE (strategies, profiles), so `sanitize_user`
--     needs NO new arm — deleting a user drops their strategies and their
--     share rows with them.
--   * The phase-29 frozen-spine migration guard was NARROWED in the same commit
--     as this file (`src/__tests__/phase-29-frozen-spine-guards.test.ts`,
--     founder ruling D-05) so that `/scenario/i` still freezes the scenario
--     spine while this unrelated `strategy_shares` filename passes. ⛔ The
--     filename was deliberately NOT renamed to dodge the old substring.
-- ============================================================================

BEGIN;
SET lock_timeout = '3s';

-- --------------------------------------------------------------------------
-- STEP 1: strategy_shares table — the counter IS the row
-- --------------------------------------------------------------------------
-- Deliberate deviation from the scenario precedent: `scenario_shares` is
-- N-rows-per-scenario with a PARTIAL unique index (`UNIQUE (scenario_id) WHERE
-- revoked_at IS NULL`) because each mint stores a new hashed token. Under the
-- generation model there is nothing per-mint to store — the row IS the counter
-- — so the correct shape is a FULL `UNIQUE (strategy_id)` with
-- reactivate-in-place on re-share. Per-event history rides `logAuditEvent`
-- (the `scenario.share.revoke` precedent), not extra rows here.
CREATE TABLE strategy_shares (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id UUID        NOT NULL UNIQUE REFERENCES strategies ON DELETE CASCADE,
  created_by  UUID        NOT NULL REFERENCES profiles  ON DELETE CASCADE,
  generation  INTEGER     NOT NULL DEFAULT 1 CHECK (generation >= 1),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at  TIMESTAMPTZ
);

ALTER TABLE strategy_shares ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE strategy_shares IS
  'Phase 164 / SHARE-01, SHARE-03. ONE row per strategy carrying the share '
  'generation counter. ⛔ Stores NO token, raw or hashed (D-02): the link is '
  'HMAC(SHARE_TOKEN_SECRET, strategy_id || generation) derived in Node, so a '
  'leak of this table yields only a uuid, an int and timestamps. STATE '
  'MACHINE: (1) no row -> the strategy has never been shared; (2) row with '
  'revoked_at IS NULL -> a live link exists, and it is re-derivable from '
  'generation, so Copy Link returns the SAME url every time (SHARE-01 reuse); '
  '(3) row with revoked_at NOT NULL -> revoked, and generation has ALREADY '
  'been advanced past every link ever handed out, so all of them are dead '
  '(SHARE-03). Re-sharing clears revoked_at WITHOUT resetting generation, so '
  'the new link differs from every old one. generation is monotonic by '
  'construction: only revoke_strategy_share() writes it, and only as +1.';

COMMENT ON COLUMN strategy_shares.generation IS
  'Monotonic share generation. Feeds the Node-side HMAC as the second input; '
  'incrementing it is what makes revocation instantaneous for every '
  'previously-copied link. NEVER reset, NEVER decremented.';

COMMENT ON COLUMN strategy_shares.revoked_at IS
  'Soft-revoke tombstone. NULL = live. Rows are never DELETEd (a delete would '
  'reset generation to 1 on re-share and RESURRECT already-revoked links — see '
  'the REVOKE DELETE in STEP 2).';

-- Owner-only access, transposed from `scenario_shares_owner`.
--
-- ⭐ CR-01 OWNER-COHERENCE — the EXISTS clause is LOAD-BEARING, not decorative.
-- `created_by = auth.uid()` alone is NOT enough: it lets any authenticated user
-- mint a share row for ANY strategy_id, including another tenant's, because the
-- FK only checks that the strategy EXISTS — not that the caller owns it. Since
-- the recipient lane authorises exactly the strategy_id found in the matched
-- share row, a cross-tenant row would be a working link to someone else's
-- private factsheet. The EXISTS clause makes the DATABASE reject that at WITH
-- CHECK time; the route's own ownership probe is layer 1, this is layer 2, and
-- there is no layer 3 here (no SECURITY DEFINER read path exists to re-check
-- at read time), which is precisely why this clause must never be dropped.
-- `supabase/tests/test_strategy_shares_rls.sql` pins the rejection.
--
-- `TO authenticated` pins the policy to the role the request-scoped client
-- connects as; combined with the REVOKE in STEP 2, anon is dead at BOTH the
-- grant layer (42501) and the policy layer.
CREATE POLICY strategy_shares_owner ON strategy_shares
  FOR ALL
  TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.strategies s
      WHERE s.id = strategy_shares.strategy_id
        AND s.user_id = auth.uid()
    )
  );

-- HOT-PATH index for the token lane's bounded scan (D-07). The recipient route
-- cannot locate the row from the token — nothing token-derived is stored and
-- the strategy id is not in the URL — so it scans ACTIVE share rows and
-- timingSafeEqual-compares each candidate. This partial index makes that an
-- index-only scan over exactly the live rows, and it is the same reasoning the
-- scenario migration used for its `scenario_shares_token_hash_idx`: the sole
-- public read path must not degrade into a seq scan over a table that only
-- grows (revoked rows are retained forever, never deleted).
-- ⚠️ D-07 REVISIT THRESHOLD: reconsider the O(1) locator variant above **1,000
-- active (revoked_at IS NULL) rows**. Today that count is 0.
CREATE INDEX strategy_shares_active_idx
  ON strategy_shares (strategy_id, generation)
  WHERE revoked_at IS NULL;

-- --------------------------------------------------------------------------
-- STEP 2: table grants — anon dead, and clients cannot DELETE
-- --------------------------------------------------------------------------
-- A fresh table inherits Supabase's default GRANT ALL to anon/authenticated.
-- There is NO public-read use case for this table: the recipient lane reads it
-- through `createAdminClient()` (service_role) in Node, exactly like
-- /scenario-share. Drop anon's grants entirely.
REVOKE ALL ON strategy_shares FROM PUBLIC, anon;

-- ⛔ TOKEN-RESURRECTION GUARD. The RLS policy above is FOR ALL, which would
-- otherwise let an owner DELETE their own share row. That is not equivalent to
-- revoking: a DELETE discards the counter, so the next
-- create_strategy_share() inserts a fresh row at generation = 1 and every
-- token minted at generation 1 — including ones the owner explicitly REVOKED —
-- becomes valid again. Revocation must be irreversible, so no client role gets
-- DELETE. Soft-revoke (revoked_at + generation bump) is the only supported
-- un-share. FK cascades from strategies/profiles still work: referential
-- actions execute internally and do not consult the caller's privileges, so
-- `sanitize_user` and account deletion are unaffected. service_role keeps
-- DELETE for exactly those maintenance paths.
REVOKE DELETE ON strategy_shares FROM authenticated;

-- State the working grants explicitly rather than inheriting whatever
-- ALTER DEFAULT PRIVILEGES happens to be configured on the project — the
-- REVOKE above is only meaningful if the positive side is pinned too.
GRANT SELECT, INSERT, UPDATE ON strategy_shares TO authenticated;
GRANT ALL    ON strategy_shares TO service_role;

-- --------------------------------------------------------------------------
-- STEP 3: create_strategy_share(p_strategy_id) — atomic mint-or-reuse
-- --------------------------------------------------------------------------
-- ONE statement: insert the counter row, or reactivate the existing one. The
-- caller gets back the CURRENT generation and derives the token from it in
-- Node, so:
--   * strategy never shared -> row at generation 1 -> a fresh link;
--   * strategy already live -> the SAME generation -> the SAME link (SHARE-01
--     reuse: Copy Link is idempotent and never breaks the recipient's url);
--   * strategy revoked      -> revoked_at cleared, generation UNCHANGED at the
--     already-advanced value -> a link that differs from every revoked one.
--
-- Why an RPC rather than a client-side upsert (RESEARCH assumption A4): the
-- state machine — "never touch created_by or created_at on reactivation, never
-- touch generation on mint" — lives in ONE place instead of being re-derived
-- correctly by every future call site. `created_by` is sourced from auth.uid()
-- INSIDE the body and is never a parameter, so a forged owner is impossible.
--
-- SECURITY INVOKER (stated explicitly, not left to the default): this runs AS
-- THE CALLER, so `strategy_shares_owner` gates it — including the CR-01
-- owner-coherence EXISTS clause. A caller cannot mint for a strategy they do
-- not own through this RPC either; the WITH CHECK raises and the function's
-- implicit subtransaction rolls back. STABLE would be wrong here (this writes);
-- VOLATILE is correct and is the omitted default.
--
-- ON CONFLICT + RLS: on the DO UPDATE path Postgres evaluates the policy's
-- USING against the existing row and its WITH CHECK against the updated row.
-- A conflicting row belonging to another tenant therefore ERRORS rather than
-- being silently updated — no cross-tenant write, and the route surfaces a
-- generic failure rather than an existence oracle.
CREATE OR REPLACE FUNCTION public.create_strategy_share(p_strategy_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_generation INTEGER;
BEGIN
  IF p_strategy_id IS NULL THEN
    RAISE EXCEPTION 'create_strategy_share: p_strategy_id must not be NULL'
      USING ERRCODE = 'null_value_not_allowed';
  END IF;

  -- Atomic reactivate-or-insert. ⛔ generation is deliberately ABSENT from the
  -- DO UPDATE SET list: reactivation must NOT rewind the counter, or every
  -- previously revoked link would come back to life. created_by/created_at are
  -- likewise never rewritten — the row keeps its original provenance.
  INSERT INTO public.strategy_shares (strategy_id, created_by)
  VALUES (p_strategy_id, auth.uid())
  ON CONFLICT (strategy_id) DO UPDATE
    SET revoked_at = NULL
  RETURNING strategy_shares.generation INTO v_generation;

  RETURN v_generation;
END;
$$;

COMMENT ON FUNCTION public.create_strategy_share(UUID) IS
  'Phase 164 / SHARE-01. Atomic mint-or-reuse of a strategy share. Returns the '
  'CURRENT generation; the caller derives the token as '
  'HMAC(SHARE_TOKEN_SECRET, strategy_id || generation) in Node — nothing '
  'token-derived is ever stored. Idempotent while the share is live (the same '
  'generation returns the same url, which is what makes Copy Link reuse work). '
  'Reactivating a revoked share clears revoked_at WITHOUT rewinding generation, '
  'created_by or created_at, so revoked links stay dead. SECURITY INVOKER — '
  'RLS gates it as the caller and created_by is auth.uid() inside the body.';

-- --------------------------------------------------------------------------
-- STEP 4: revoke_strategy_share(p_strategy_id) — atomic stamp + bump
-- --------------------------------------------------------------------------
-- ⭐ THE INCREMENT MUST BE IN-STATEMENT. `generation = generation + 1` is
-- column arithmetic evaluated by the server against the row it is locking; a
-- client library cannot express it (it would have to SELECT the value, add one
-- and write it back — a read-modify-write whose lost update, under two
-- concurrent revokes, leaves the counter one short and a supposedly-revoked
-- link ALIVE). This RPC exists precisely to make the stamp and the bump one
-- indivisible act.
--
-- Returns the number of rows affected, NOT a boolean:
--   * 1 -> a live share was just revoked;
--   * 0 -> already revoked, or never shared. That is CONVERGENCE, not failure.
--     The route maps 0 to a 404 (matching the scenario revoke route, which
--     returns 404 rather than 403 so it is not an existence oracle) and the
--     client treats it as success — the caller's intent ("this link must be
--     dead") is satisfied either way.
--
-- Soft-revoke ONLY — never DELETE. See the REVOKE DELETE in STEP 2 for why a
-- hard delete would resurrect revoked tokens.
--
-- SECURITY INVOKER: the `strategy_shares_owner` USING clause scopes the UPDATE
-- to the caller's own rows, so another tenant's strategy_id matches 0 rows and
-- takes the indistinguishable 0-row exit.
CREATE OR REPLACE FUNCTION public.revoke_strategy_share(p_strategy_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rows INTEGER;
BEGIN
  IF p_strategy_id IS NULL THEN
    RETURN 0;   -- nothing to revoke; converges like any other miss
  END IF;

  UPDATE public.strategy_shares
     SET revoked_at = now(),
         generation = generation + 1
   WHERE strategy_id = p_strategy_id
     AND revoked_at IS NULL;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

COMMENT ON FUNCTION public.revoke_strategy_share(UUID) IS
  'Phase 164 / SHARE-03. Revokes a strategy share in ONE atomic statement: '
  'stamps revoked_at AND increments generation together, so every '
  'previously-copied link dies at the same instant and no read-modify-write '
  'race can leave the counter short. Returns the affected row count: 1 = just '
  'revoked, 0 = already revoked or never shared (CONVERGENCE — the route maps '
  'it to 404 and the client treats it as success). Soft-revoke only; rows are '
  'never deleted. SECURITY INVOKER — RLS scopes it to the caller''s own rows.';

-- --------------------------------------------------------------------------
-- STEP 5: function grants + PUBLIC-EXECUTE self-verify
-- --------------------------------------------------------------------------
-- Both RPCs are invoked by the authenticated owner only. anon must never reach
-- them (there is no anon lane in this design at all). REVOKE from PUBLIC/anon
-- as defense-in-depth against default-ACL drift, then GRANT to authenticated.
REVOKE ALL ON FUNCTION public.create_strategy_share(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_strategy_share(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_strategy_share(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_strategy_share(UUID) TO authenticated;

-- Self-verify with the mig-134 canon (CALL it; do NOT redefine the helper).
-- Aborts the apply if PUBLIC retained EXECUTE — a grant we cannot revoke is a
-- real CRITICAL and the apply MUST fail rather than ship a quiet leak.
DO $$
BEGIN
  PERFORM public._assert_no_public_execute('public.create_strategy_share(uuid)');
  PERFORM public._assert_no_public_execute('public.revoke_strategy_share(uuid)');
  RAISE NOTICE 'Migration 164-02: PUBLIC EXECUTE absence verified for create_strategy_share + revoke_strategy_share.';
END $$;

-- --------------------------------------------------------------------------
-- STEP 6: body-shape self-assert (defense-in-depth; mirrors mig 117 STEP 7)
-- --------------------------------------------------------------------------
-- The two properties this phase's security rests on are both invisible to a
-- "did it return 200" test and both FAIL SILENTLY if a future CREATE OR REPLACE
-- drops them:
--   (i)  revoke must INCREMENT generation (drop it and revocation becomes
--        cosmetic — revoked_at is stamped, the token still derives, every
--        "revoked" link keeps working);
--   (ii) mint must NOT assign generation (assign it and reactivation rewinds
--        the counter, resurrecting revoked links).
-- Assert both against pg_get_functiondef so the loosening fails the APPLY.
DO $$
DECLARE
  v_create TEXT;
  v_revoke TEXT;
  v_secdef BOOLEAN;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_create
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'create_strategy_share'
     AND pg_get_function_identity_arguments(p.oid) = 'p_strategy_id uuid';
  SELECT pg_get_functiondef(p.oid) INTO v_revoke
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'revoke_strategy_share'
     AND pg_get_function_identity_arguments(p.oid) = 'p_strategy_id uuid';

  IF v_create IS NULL OR v_revoke IS NULL THEN
    RAISE EXCEPTION 'Migration 164-02 verification failed: a share RPC is missing post-create (create present: %, revoke present: %)',
      (v_create IS NOT NULL), (v_revoke IS NOT NULL);
  END IF;

  -- (i) revoke increments the counter, in-statement.
  IF v_revoke !~* 'generation\s*=\s*generation\s*\+\s*1' THEN
    RAISE EXCEPTION 'Migration 164-02 verification failed: revoke_strategy_share lost the atomic `generation = generation + 1` bump — revocation would be COSMETIC and every revoked link would keep working';
  END IF;

  -- (i-b) ...and only over rows that are still live, so a double-revoke cannot
  -- keep inflating the counter (0 rows is the convergence contract).
  IF v_revoke !~* 'revoked_at\s+IS\s+NULL' THEN
    RAISE EXCEPTION 'Migration 164-02 verification failed: revoke_strategy_share lost the `revoked_at IS NULL` predicate — double-revoke would no longer converge at 0 rows';
  END IF;

  -- (i-c) soft-revoke only.
  -- `\M` (end of word), NOT `\m`, closes the anchor: `\m` after FROM demands
  -- the position be a word START, which it never is, and the arm would be
  -- silently vacuous.
  IF v_revoke ~* '\mDELETE\s+FROM\M' THEN
    RAISE EXCEPTION 'Migration 164-02 verification failed: revoke_strategy_share performs a DELETE — revocation must be a soft tombstone, or re-sharing resets generation and RESURRECTS revoked links';
  END IF;

  -- (ii) mint never writes generation.
  IF v_create ~* 'SET[^;]*\mgeneration\s*=' THEN
    RAISE EXCEPTION 'Migration 164-02 verification failed: create_strategy_share assigns `generation` — reactivation must never rewind the counter (revoked links would come back to life)';
  END IF;

  -- (iii) neither RPC is SECURITY DEFINER: RLS is the ownership wall here, and
  -- a DEFINER body would bypass the CR-01 owner-coherence WITH CHECK entirely.
  FOR v_secdef IN
    SELECT p.prosecdef
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('create_strategy_share', 'revoke_strategy_share')
  LOOP
    IF v_secdef THEN
      RAISE EXCEPTION 'Migration 164-02 verification failed: a strategy-share RPC is SECURITY DEFINER — it would bypass the strategy_shares_owner RLS policy that is the ONLY cross-tenant wall on this surface';
    END IF;
  END LOOP;

  -- (iv) search-path hardening present on both (pg_get_functiondef emits
  -- `SET search_path TO public, pg_temp`; accept TO or =).
  IF v_create !~* 'search_path\s*(=|TO)\s*''?public''?,\s*''?pg_temp''?'
     OR v_revoke !~* 'search_path\s*(=|TO)\s*''?public''?,\s*''?pg_temp''?' THEN
    RAISE EXCEPTION 'Migration 164-02 verification failed: a strategy-share RPC is missing SET search_path = public, pg_temp';
  END IF;

  RAISE NOTICE 'Migration 164-02: share RPC body-shape verified (atomic bump + live-only predicate + no delete + no generation rewind + INVOKER + search_path).';
END $$;

-- --------------------------------------------------------------------------
-- STEP 7: no-token-at-rest self-assert (D-02, threat T-164-07)
-- --------------------------------------------------------------------------
-- The single most important property of this table is a NEGATIVE one: it holds
-- no secret. A future ALTER that adds a `token`/`token_hash`/`secret` column
-- would reintroduce exactly the disclosure surface D-02 rejected, and nothing
-- else in the stack would notice. Pin the column set here so the APPLY of any
-- such migration is at least preceded by a deliberate edit of this assertion's
-- successor, and pin it again from supabase/tests/test_strategy_shares_rls.sql.
DO $$
DECLARE
  v_cols TEXT;
BEGIN
  SELECT string_agg(column_name, ',' ORDER BY column_name) INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'strategy_shares';

  IF v_cols IS DISTINCT FROM 'created_at,created_by,generation,id,revoked_at,strategy_id' THEN
    RAISE EXCEPTION 'Migration 164-02 verification failed: strategy_shares column set is "%", expected exactly "created_at,created_by,generation,id,revoked_at,strategy_id". ⛔ D-02: this table must NEVER hold a token, raw or hashed.', v_cols;
  END IF;

  RAISE NOTICE 'Migration 164-02: strategy_shares holds no token at rest (column set pinned).';
END $$;

COMMIT;
