-- ============================================================================
-- api_keys.venue_account_id — a non-secret venue identity the client cannot set,
-- so re-connecting the same credentials cannot mint a second draft
-- (2026-08-12, Phase 154 / WIZCONT-02)
-- ============================================================================
--
-- ⛔⛔ DEPLOY ORDER — READ BEFORE MERGING. THIS MIGRATION MUST BE LIVE ON PROD
-- BEFORE THE VERCEL DEPLOYMENT THAT PASSES p_venue_account_id.
-- (Same hazard 20260811210000:6-26 documents, same remedy.)
--
-- Merging to `main` fires the Supabase auto-apply AND the Vercel build, with NO
-- ordering between them. Plan 154-06 makes /api/strategies/create-with-key call
-- create_wizard_strategy with a 12th named parameter. If that deployment wins
-- the race, PostgREST resolves the call against the 11-parameter function it
-- still has cached, does not find `p_venue_account_id`, and answers PGRST202 —
-- i.e. EVERY connect-a-key submit fails for the duration of the window, on the
-- wizard's only API path. Apply this migration FIRST (Supabase MCP
-- apply_migration), confirm green, and only then merge/promote the deployment.
-- The ordering cannot be enforced from inside this file.
--
-- ⛔ NEVER `supabase db push`. Apply to TEST (qmnijlgmdhviwzwfyzlc) via MCP
-- apply_migration and run supabase/tests/test_api_keys_venue_identity_uniq.sql
-- against it BEFORE the phase PR merges — merging supabase/migrations/** to
-- `main` AUTO-APPLIES to PROD (khslejtfbuezsmvmtsdn).
--
-- What this is for
-- ----------------
-- WIZCONT-02: re-connecting the SAME credentials from a context that has lost
-- the `wizard_session_id` localStorage token mints a duplicate strategy + a
-- duplicate encrypted api_keys row. The existing fence
-- (strategies_user_wizard_session_source_uniq + the RPC's 'wizdraft:' advisory
-- lock) keys on the token, so a token-less re-entry sails straight past it.
--
-- This migration adds the SECOND key that fence needs: the venue-confirmed,
-- NON-SECRET account identity. CONTEXT.md's locked decisions, honoured here:
--
--   * NARROW SCOPE. Only venues that already return a stable non-secret account
--     id at validation populate it. Today that is MT5 alone — the broker login,
--     probe-asserted by analytics-service/services/mt5_probe.py
--     assert_expected_login. Verified 2026-08-12: the ccxt adapter's
--     ValidationResult (analytics-service/services/ingestion/adapter.py:98-123)
--     carries NO account-identity field, so ccxt venues have none to stamp and
--     stay NULL. That residual is recorded, not papered over (154-06).
--
--   * FAIL TOWARD THE EXISTING ROW. The index REFUSES the duplicate INSERT
--     (23505); it never overwrites. A clobber would orphan strategy_keys
--     membership and synced history other strategies depend on.
--
--   * ⛔ NEVER A UNIQUE ON CIPHERTEXT. api_key_encrypted carries a PER-ROW
--     dek_encrypted + nonce, so two encryptions of one secret differ in every
--     byte and an index over that column would dedup exactly nothing while
--     looking like it did. The uniqueness target is the PLAINTEXT non-secret
--     identity, and nothing else. `api_key_encrypted` appears in this file ONLY
--     inside the re-based RPC body, never in an index expression.
--
--   * ADDITIVE FOR PHASE 156. CONNECT-REFACTOR will move this same api_keys
--     INSERT behind a service-role writer. Nothing here needs unpicking for
--     that: the 12th parameter is DEFAULT NULL so every existing caller is
--     unchanged, and the scrub trigger's allowlist already admits service_role.
--
-- What changes
-- ------------
--   1. api_keys.venue_account_id text, nullable. NULL means "this venue exposes
--      no stable non-secret account id" (every ccxt venue today) — it is the
--      normal, expected value, which is why the index is PARTIAL.
--
--      No GRANT and no REVOKE on the table, and none is needed: migration
--      20260410225608 revoked table-level SELECT on api_keys and granted back a
--      per-column allowlist, so a newly added column is simply never readable by
--      anon/authenticated. That is the correct posture — UI-SPEC forbids echoing
--      this value to the client. It is non-secret BY DEFINITION (a broker
--      account number, not a credential), but "non-secret" is not "publish it".
--
--   2. A pre-flight duplicate census over the new key, then the partial UNIQUE
--      index api_keys_user_exchange_venue_account_uniq.
--
--   3. A SECURITY INVOKER BEFORE INSERT scrub trigger, sibling to
--      api_keys_scrub_attested_venue.
--
--   4. create_wizard_strategy gains a 12th parameter and stamps the column.
--      ⚠️ DROP + CREATE, not CREATE OR REPLACE — see section 4's banner.
--
--   5. An ABORTING post-verify block, LAST.
--
-- Why the scrub trigger, and why NO coupling CHECK
-- ------------------------------------------------
-- ⭐ THE TRIGGER IS NOT OPTIONAL, and the reason is specific to what this column
-- is FOR. Its whole job is to make a duplicate connect COLLIDE. A caller who can
-- write it can therefore evade the dedup for free: supply a different
-- venue_account_id (or any invented string) on a direct client INSERT and the
-- partial UNIQUE never fires. That is precisely the
-- "column only a privileged writer may set" class that
-- scrub_client_supplied_attested_venue (20260811210000:515-546) exists for, so
-- it gets the same treatment: a sibling SECURITY INVOKER function with the same
-- current_user allowlist, and a BEFORE INSERT trigger.
--
-- ⛔ SECURITY INVOKER is load-bearing on the sibling for the same reason it is
-- on the original — under SECURITY DEFINER, current_user would be the function's
-- OWNER and the privileged check would always pass, making the trigger a silent
-- no-op (the prevent_profile_role_change bug, 20260529150000). Do not "fix" it.
--
-- The SECURITY DEFINER RPC's INSERT survives the scrub because a DEFINER body
-- runs as the function's owner, which is in the allowlist — post-verify (f)
-- asserts exactly that rather than assuming it, and for this migration that
-- check has TEETH IT DID NOT HAVE IN THE DONOR: see section 4.
--
-- ⚠️ NO COUPLING CHECK, deliberately. api_keys already carries
-- api_keys_attested_venue_matches_exchange (attested_venue IS NULL OR
-- attested_venue = exchange). That constraint exists because attested_venue is
-- an ATTESTATION OF THE SAME FACT as `exchange`, so the two disagreeing is
-- incoherent and forging one must cost you the other. venue_account_id has no
-- such twin: it is an identity WITHIN a venue, not a second opinion about which
-- venue. There is no column it must equal, and no invariant a CHECK could
-- express that is not already the index's job. Adding one would be cargo-culted
-- shape, not a constraint. ⛔ Both the existing CHECK and the existing
-- api_keys_scrub_attested_venue trigger are UNTOUCHED by this file.
--
-- ⚠️ TWO BEFORE INSERT TRIGGERS ON ONE TABLE. Postgres fires BEFORE ROW triggers
-- in alphabetical order by trigger name, so api_keys_scrub_attested_venue runs
-- before api_keys_scrub_venue_account_id. The order does not matter — each
-- clears a DIFFERENT column on NEW and returns NEW — but it is stated so a
-- future reader does not have to re-derive it. Post-verify (e) asserts BOTH are
-- attached, so this migration cannot silently displace the older one.
--
-- add_wizard_composite_key is NOT touched
-- ---------------------------------------
-- ⭐ TWIN-7 is satisfied by NOT touching it, and that is a decision, not an
-- omission. The composite path writes no venue identity: MT5 cannot be a
-- composite member (the stitch worker has no mt5 arm — ROADMAP 153.6 records it
-- as out of scope), and MT5 is the only venue with an identity to write. So the
-- composite RPC has nothing to stamp. Its api_keys INSERT leaves
-- venue_account_id NULL, the partial index excludes NULL, and the composite path
-- behaves exactly as it does today. If a syncable venue ever exposes a stable
-- account id AND becomes composite-eligible, re-base add_wizard_composite_key
-- VERBATIM on 20260811210000:418-512 — never on any earlier body.
--
-- Idempotency
-- -----------
-- ADD COLUMN IF NOT EXISTS; CREATE UNIQUE INDEX IF NOT EXISTS; the scrub function
-- is CREATE OR REPLACE; the trigger is DROPped-if-exists before CREATE; the RPC
-- DROP carries IF EXISTS so a re-run (where the 11-arg signature is already gone)
-- proceeds to the CREATE OR REPLACE rather than erroring. The census is a read.
-- There is no backfill: a new column is NULL everywhere, and NULL is the correct
-- value for every existing row — none of them was minted with a recorded venue
-- identity, and inventing one from ciphertext is impossible by construction.
-- ============================================================================

BEGIN;

SET lock_timeout = '3s';

-- ───────────────────────────────── 1. the column
ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS venue_account_id text;

COMMENT ON COLUMN public.api_keys.venue_account_id IS
  'Phase 154 / WIZCONT-02. NON-SECRET, venue-confirmed account identity for the '
  'credential in this row — the MT5 broker login today, which '
  'analytics-service/services/mt5_probe.py asserts against the gateway at '
  'validation time. It is an ACCOUNT NUMBER, not a credential: the secret half '
  'lives in api_key_encrypted and never comes near this column. ⛔ Written ONLY '
  'by privileged writers — the SECURITY DEFINER wizard RPC and service_role. A '
  'client-supplied value on a direct INSERT is scrubbed to NULL by the '
  'api_keys_scrub_venue_account_id BEFORE INSERT trigger, because a caller who '
  'could set this could evade the dedup it exists to enforce simply by inventing '
  'a different id. NULL is the NORMAL value and means "this venue exposes no '
  'stable non-secret account id at validation" — every ccxt venue today, whose '
  'ValidationResult carries no account-identity field at all. That is why '
  'api_keys_user_exchange_venue_account_uniq is PARTIAL: under a total index '
  'every NULL would collide and no user could hold two ccxt keys. ⛔ Never echo '
  'this value to the browser (UI-SPEC): non-secret is not the same as publish. '
  'It is not readable by anon/authenticated anyway — migration 20260410225608 '
  'revoked table-level SELECT on api_keys in favour of a per-column allowlist '
  'this column is not on.';

-- ─────────── 2. PRE-FLIGHT: the duplicate census the UNIQUE index presumes
-- ⭐ SATISFIED BY CONSTRUCTION ON DAY ONE, AND SAID SO RATHER THAN RELIED ON
-- SILENTLY. The column was created three statements ago, so every row in
-- api_keys — all of PROD's — carries NULL, and the partial index excludes NULL.
-- There is no population this can abort on at first apply.
--
-- It is here anyway for the case the header cannot rule out: a RE-APPLY, or an
-- apply onto a database where a previous partial run already populated the
-- column. In that world the census is the only thing standing between a
-- duplicate population and a CREATE UNIQUE INDEX that fails halfway with a bare
-- 23505 naming no rows. Form copied from
-- 20260728120000:135-166 — count, then RAISE EXCEPTION with an ERRCODE.
--
-- ⛔ It aborts. It is deliberately NOT the RAISE NOTICE shape of
-- 20260429063138:38-58 — a guard that cannot fail is this repo's own defect
-- class, and 20260811210000:567-577 says so at length.
DO $census$
DECLARE
  v_dups INT;
BEGIN
  SELECT count(*) INTO v_dups FROM (
    SELECT user_id, exchange, venue_account_id
      FROM public.api_keys
     WHERE venue_account_id IS NOT NULL
     GROUP BY user_id, exchange, venue_account_id
    HAVING count(*) > 1
  ) AS d;

  IF v_dups > 0 THEN
    RAISE EXCEPTION
      'Migration 20260812120000 ABORT: % duplicate (user_id, exchange, venue_account_id) group(s) already present, so CREATE UNIQUE INDEX api_keys_user_exchange_venue_account_uniq would fail. Resolve the duplicates manually — do NOT delete api_keys rows blindly, strategy_keys membership and synced history hang off them. Rolling back.',
      v_dups
      USING ERRCODE = 'unique_violation';
  END IF;

  RAISE NOTICE 'Migration 20260812120000 pre-flight OK: zero duplicate (user_id, exchange, venue_account_id) groups (% rows carry a non-NULL venue_account_id).',
    (SELECT count(*) FROM public.api_keys WHERE venue_account_id IS NOT NULL);
END
$census$;

-- ───────────────────────── 3. the partial UNIQUE backstop
-- Form: TRANSACTIONAL, not CONCURRENTLY — the house rule stated at
-- 20260728120000:101-108. CONCURRENTLY cannot run inside a transaction block
-- (25001), and a failed build leaves an INVALID index behind that enforces
-- nothing while still costing every writer. api_keys is a ~29-row table.
--
-- ⭐ user_id MUST LEAD. From test_wizard_session_idempotency.sql:66-68: a
-- non-tenant-leading unique index over a caller-influenced value is the C-08
-- cross-tenant leak — uniqueness scoped (exchange, venue_account_id) alone would
-- let one owner's INSERT collide with a DIFFERENT owner's row, which both leaks
-- the existence of that row and denies service to the second owner. Leading with
-- user_id makes the guarantee strictly per-tenant.
--
-- ⭐ PARTIAL, and the predicate is the load-bearing half. NULL is the normal
-- value here (every ccxt venue). Under a TOTAL unique index, PostgreSQL's
-- NULL-distinctness would technically still admit them — but the predicate is
-- what documents and enforces that the index governs only rows carrying a real
-- identity, and it keeps the index off the ~all-NULL majority. The SQL gate
-- asserts the predicate explicitly, because an index that lost it would look
-- present and correct while its meaning had changed.
CREATE UNIQUE INDEX IF NOT EXISTS api_keys_user_exchange_venue_account_uniq
  ON public.api_keys (user_id, exchange, venue_account_id)
  WHERE venue_account_id IS NOT NULL;

COMMENT ON INDEX public.api_keys_user_exchange_venue_account_uniq IS
  'Phase 154 / WIZCONT-02: at most one api_keys row per (user, venue, '
  'venue-confirmed account id). The DB half of "one fence, two keys" — the app '
  'fence in /api/strategies/create-with-key keys on wizard_session_id, this one '
  'keys on the credential identity, so a re-connect from a context that LOST the '
  'session token still dedups. CONTRACT: it FAILS TOWARD THE EXISTING ROW — the '
  'duplicate INSERT raises 23505 and the route resolves to the row already '
  'there. It must never be "resolved" by overwriting: the existing api_keys row '
  'carries strategy_keys membership and synced history other strategies depend '
  'on. PARTIAL because NULL means "this venue exposes no stable non-secret '
  'account id" (every ccxt venue today) and is the majority value. user_id LEADS '
  'deliberately — a non-tenant-leading unique index is the C-08 cross-tenant '
  'leak (see 20260726000225 and 20260728120000). ⛔ The uniqueness target is the '
  'PLAINTEXT identity, never api_key_encrypted: that column carries a per-row '
  'dek_encrypted + nonce, so two encryptions of one secret differ and an index '
  'over it would dedup nothing. Gate: '
  'supabase/tests/test_api_keys_venue_identity_uniq.sql.';

-- ───────────── 4. the scrub trigger: a client-supplied identity is not evidence
CREATE OR REPLACE FUNCTION public.scrub_client_supplied_venue_account_id()
RETURNS TRIGGER
LANGUAGE plpgsql
-- ⛔ SECURITY INVOKER (the default — stated explicitly) is LOAD-BEARING, and it
-- is the same trap as on the attested_venue sibling: under SECURITY DEFINER,
-- current_user would be this function's OWNER, the privileged check below would
-- ALWAYS pass, and the trigger would be a silent no-op. That is the bug that
-- made prevent_profile_role_change a no-op (20260529150000's header) and it is
-- why prevent_api_key_venue_change and scrub_client_supplied_attested_venue are
-- both INVOKER too. Do not change this line.
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
BEGIN
  -- Privileged writers keep whatever they supplied: the SECURITY DEFINER wizard
  -- RPC runs as the table owner, the analytics worker and the support/admin
  -- routes run as service_role, migrations run as postgres. Everyone else —
  -- every browser session, on every client INSERT path including a
  -- DELETE-then-re-INSERT round trip — lands NULL.
  --
  -- ⭐ service_role is in this list ON PURPOSE and it is what makes Phase 156
  -- (CONNECT-REFACTOR) a drop-in: when the api_keys INSERT moves behind a
  -- service-role writer, that writer's venue_account_id survives this trigger
  -- with no change to this function.
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  -- Scrub, do not refuse. Raising here would break the two live client INSERT
  -- paths (ApiKeyManager.tsx:254, StrategyForm.tsx:140) for a value they have no
  -- business setting and never send, and 153.6 D-02/D-03 keep those paths open
  -- on purpose. NULL is the honest answer: "no server-confirmed identity", which
  -- the partial index correctly declines to govern.
  NEW.venue_account_id := NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS api_keys_scrub_venue_account_id ON public.api_keys;
CREATE TRIGGER api_keys_scrub_venue_account_id
BEFORE INSERT
ON public.api_keys
FOR EACH ROW EXECUTE FUNCTION public.scrub_client_supplied_venue_account_id();

COMMENT ON FUNCTION public.scrub_client_supplied_venue_account_id() IS
  'Phase 154 / WIZCONT-02. NULLs a client-supplied api_keys.venue_account_id on '
  'INSERT so the WIZCONT-02 dedup index governs only server-confirmed '
  'identities. WITHOUT THIS the dedup is free to evade: a caller who can write '
  'the column supplies a different (or invented) id and the partial UNIQUE never '
  'fires. SECURITY INVOKER so current_user is the REAL caller — a DEFINER form '
  'would be a silent no-op. It scrubs rather than raises, because the client '
  'INSERT path stays open by design (153.6 D-02/D-03). Sibling of '
  'scrub_client_supplied_attested_venue (20260811210000); both are BEFORE INSERT '
  'on api_keys, they clear different columns, and their firing order is '
  'irrelevant.';

COMMENT ON TRIGGER api_keys_scrub_venue_account_id ON public.api_keys IS
  'Fires on every api_keys INSERT. Non-privileged callers cannot persist a '
  'venue_account_id; NULL then means "no server-confirmed identity", which the '
  'partial index api_keys_user_exchange_venue_account_uniq excludes. Companion '
  'to migration 20260812120000.';

-- ───── 5. create_wizard_strategy — re-based on 20260811210000, +1 parameter
--
-- ⛔⛔ DROP + CREATE, NOT `CREATE OR REPLACE`. THIS IS THE WHOLE REASON THIS
-- SECTION IS SHAPED THE WAY IT IS. CREATE OR REPLACE CANNOT CHANGE A FUNCTION'S
-- SIGNATURE — adding a parameter creates a SECOND OVERLOAD alongside the
-- 11-parameter original. PostgREST resolves rpc() calls by NAMED PARAMETERS, and
-- with two overloads a call naming the 11 shared parameters matches BOTH; it
-- answers PGRST203 ("could not choose the best candidate function"). That is not
-- a degraded path — it is EVERY connect-a-key submit failing, for every user,
-- on the wizard's only API path. Post-verify (c) asserts exactly ONE pg_proc row
-- survives, and the SQL gate asserts it again from the outside.
--
-- ⛔⛔ RE-BASED VERBATIM ON 20260811210000_api_keys_attested_venue.sql:306-411,
-- WHICH IS THE LATEST BODY. A repo-wide grep finds five prior definitions
-- (20260411103316, 20260513084844, 20260515114310, and — do NOT re-base on it —
-- 20260602190000, superseded by 20260811210000). Re-verified 2026-08-12 against
-- supabase/schema/functions/create_wizard_strategy.sql, the generated snapshot,
-- which names 20260811210000 as its source migration. Taking the superseded body
-- would SILENTLY REVERT the `attested_venue` stamp that shipped live in PR #675
-- — every wizard-minted key would land unattested, and every MT5 finalize would
-- answer a permanent KEY_SCOPE_CHECK_UNAVAILABLE. That is the B5b lesson, and it
-- is why post-verify (a) greps this body for `attested_venue` rather than
-- trusting that the re-base was done right.
--
-- EXACTLY TWO DELTAS from that body:
--   (i)  a trailing parameter `p_venue_account_id TEXT DEFAULT NULL`, and
--   (ii) `venue_account_id` in the api_keys INSERT column list, fed from it.
-- Everything else — the auth.uid() guards, the 'wizdraft:' advisory-lock fence,
-- the complete-draft replay, the attested_venue stamp, the strategies INSERT —
-- is byte-identical.
--
-- ⭐ `DEFAULT NULL` IS WHAT MAKES THIS ADDITIVE. Every existing caller — the TS
-- route at create-with-key/route.ts:409 (named params) and the four positional
-- callers in supabase/tests/ — keeps working untouched, because an omitted
-- trailing defaulted parameter resolves. 154-06 then starts passing it.
DROP FUNCTION IF EXISTS public.create_wizard_strategy(
  uuid, text, text, text, text, text, text, text, integer, text, uuid
);

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
  -- DEFINER body, which is the only kind of writer whose value survives the
  -- api_keys_scrub_attested_venue trigger.
  -- ⛔ p_exchange IS CALLER-SUPPLIED AND IS NOT VALIDATED HERE (CR-01). Both
  -- columns are written from that ONE parameter deliberately: the CHECK
  -- api_keys_attested_venue_matches_exchange requires it, so this INSERT
  -- cannot mint an attestation that disagrees with the routing label. If you
  -- ever add a separate p_attested_venue, or normalise one column and not the
  -- other, this INSERT will start failing — that is the constraint doing its
  -- job, not a bug to route around.
  --
  -- 154 / WIZCONT-02: venue_account_id is stamped here for the same structural
  -- reason — this DEFINER body is the only writer whose value survives the
  -- api_keys_scrub_venue_account_id trigger. ⛔ It is NOT coupled to p_exchange
  -- and must not be: it identifies an ACCOUNT WITHIN a venue, not the venue. It
  -- is NULL for every venue that exposes no stable non-secret account id, which
  -- is every ccxt venue today, and the partial index excludes those rows.
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
    p_exchange, p_venue_account_id
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

-- ⛔⛔ THE GRANTS MUST BE RE-ISSUED, AND THIS IS THE SHARP EDGE OF DROP+CREATE.
-- 20260811210000 could write "NO GRANT AND NO REVOKE ANYWHERE IN THIS FILE"
-- because CREATE OR REPLACE PRESERVES the existing ACL. DROP DESTROYS IT. A
-- freshly created function's default ACL grants EXECUTE to PUBLIC — so omitting
-- the REVOKE below would hand `anon` EXECUTE on a SECURITY DEFINER function that
-- writes api_keys and strategies. That is a privilege ESCALATION introduced by
-- the act of dropping, silently, with no error. Copied from 20260602190000:160.
-- Post-verify (b) asserts both polarities, and the SQL gate asserts them again.
REVOKE ALL ON FUNCTION public.create_wizard_strategy(
  uuid, text, text, text, text, text, text, text, integer, text, uuid, text
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_wizard_strategy(
  uuid, text, text, text, text, text, text, text, integer, text, uuid, text
) TO authenticated;

-- The COMMENT is likewise destroyed by DROP and re-stamped here.
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
  '154/WIZCONT-02: stamps venue_account_id from p_venue_account_id — the '
  'non-secret venue-confirmed account identity, NULL for venues that expose '
  'none, backstopped by api_keys_user_exchange_venue_account_uniq. ⛔ EXACTLY '
  'ONE OVERLOAD OF THIS FUNCTION MAY EXIST: PostgREST resolves rpc() by named '
  'parameters and answers PGRST203 if a second candidate appears, which breaks '
  'connect-a-key for every user. Add parameters by DROP + CREATE (with '
  're-issued grants), never by CREATE OR REPLACE. See migrations 031, 126, 127, '
  '20260602190000, 20260811210000, 20260812120000.';

-- ───────────── 6. POST-VERIFY: every check ABORTS, none is NOTICE-only
-- The 20260419140917 pre-flight/post-verify pairing, same posture as
-- 20260811210000:767-948. Environment-independent by construction: every one of
-- these holds on PROD, TEST, local and CI alike.
DO $verify$
DECLARE
  -- ⛔ A SECOND COPY of the allowlist in scrub_client_supplied_venue_account_id's
  -- body. Check (f) asserts every member appears in that body, so the two cannot
  -- silently drift — the two-copies-that-disagree shape is this repo's own
  -- recurring defect.
  c_privileged_roles CONSTANT TEXT[] := ARRAY['postgres', 'service_role', 'supabase_admin'];

  c_new_sig CONSTANT TEXT :=
    'public.create_wizard_strategy(uuid,text,text,text,text,text,text,text,integer,text,uuid,text)';

  v_cws_src    TEXT;
  v_overloads  INT;
  v_cws_owner  TEXT;
  v_scrub_src  TEXT;
  v_role       TEXT;
  v_idx_cols   TEXT[];
  v_idx_def    TEXT;
  v_idx_unique BOOLEAN;
  v_idx_partial BOOLEAN;
  v_trg_attested BOOLEAN;
  v_trg_venue    BOOLEAN;
BEGIN
  -- (c) FIRST, because everything below reads the function by its new signature
  --     and a surviving overload would make those reads ambiguous or wrong.
  --     EXACTLY ONE pg_proc row named create_wizard_strategy in public. Two
  --     means the DROP missed and PostgREST will answer PGRST203 to every
  --     connect-a-key call.
  SELECT count(*) INTO v_overloads
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'create_wizard_strategy';
  IF v_overloads <> 1 THEN
    RAISE EXCEPTION
      'Migration 20260812120000 failed: % overloads of create_wizard_strategy exist, expected exactly 1. PostgREST resolves rpc() by named parameters and answers PGRST203 when a call matches more than one candidate — connect-a-key would be broken for every user. The DROP of the 11-parameter signature did not take. Rolling back.',
      v_overloads;
  END IF;

  -- (a) the re-base did not take a stale body. Three canaries, each naming a
  --     guarantee an older definition would silently revert:
  --       wizdraft: + pg_advisory_xact_lock → the F6 idempotency fence,
  --       attested_venue                    → the PR #675 probe-gate stamp,
  --       p_venue_account_id                → this migration's own reason to exist.
  SELECT pg_get_functiondef(c_new_sig::regprocedure) INTO v_cws_src;

  IF v_cws_src NOT ILIKE '%pg_advisory_xact_lock%' OR v_cws_src NOT ILIKE '%wizdraft:%' THEN
    RAISE EXCEPTION
      'Migration 20260812120000 failed: create_wizard_strategy lost its wizdraft: advisory-lock fence — the re-base took a stale definition and F6 double-submit idempotency is gone. Rolling back.';
  END IF;
  IF v_cws_src NOT ILIKE '%attested_venue%' THEN
    RAISE EXCEPTION
      'Migration 20260812120000 failed: create_wizard_strategy no longer writes attested_venue — the re-base took a body older than 20260811210000 and silently reverted PR #675. Every wizard-minted key would be unattested and every MT5 finalize would answer a permanent KEY_SCOPE_CHECK_UNAVAILABLE. Rolling back.';
  END IF;
  IF v_cws_src NOT ILIKE '%p_venue_account_id%' OR v_cws_src NOT ILIKE '%venue_account_id%' THEN
    RAISE EXCEPTION
      'Migration 20260812120000 failed: create_wizard_strategy does not stamp venue_account_id, so the WIZCONT-02 dedup index would govern nothing. Rolling back.';
  END IF;

  -- (b) grants. ⛔ NOT inherited — DROP destroyed the old ACL and a fresh
  --     function defaults to EXECUTE for PUBLIC. This check is what proves the
  --     REVOKE/GRANT pair above actually ran and in the right order.
  IF NOT has_function_privilege('authenticated', c_new_sig, 'EXECUTE') THEN
    RAISE EXCEPTION
      'Migration 20260812120000 failed: authenticated does NOT have EXECUTE on the new create_wizard_strategy signature — connect-a-key is broken. Rolling back.';
  END IF;
  IF has_function_privilege('anon', c_new_sig, 'EXECUTE') THEN
    RAISE EXCEPTION
      'Migration 20260812120000 failed: anon HAS EXECUTE on create_wizard_strategy. DROP destroyed the original ACL and a new function grants EXECUTE to PUBLIC by default, so the REVOKE did not take — this is a privilege escalation on a SECURITY DEFINER function that writes api_keys. Rolling back.';
  END IF;

  -- (d) the index: present, UNIQUE, PARTIAL, and over the right columns in the
  --     right order. ⛔ The column list is read from pg_index, NOT by
  --     substring-matching indexdef — the index NAME contains every column name,
  --     so an ILIKE would report agreement even if a column were dropped
  --     (test_wizard_session_idempotency.sql:64-68 records that trap).
  SELECT i.indisunique, (i.indpred IS NOT NULL)
    INTO v_idx_unique, v_idx_partial
    FROM pg_index i
    JOIN pg_class c     ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'api_keys_user_exchange_venue_account_uniq';

  IF v_idx_unique IS NULL THEN
    RAISE EXCEPTION
      'Migration 20260812120000 failed: index api_keys_user_exchange_venue_account_uniq is absent — the WIZCONT-02 DB backstop does not exist. Rolling back.';
  END IF;
  IF NOT v_idx_unique THEN
    RAISE EXCEPTION
      'Migration 20260812120000 failed: api_keys_user_exchange_venue_account_uniq exists but is NOT UNIQUE, so it dedups nothing. Rolling back.';
  END IF;
  IF NOT v_idx_partial THEN
    RAISE EXCEPTION
      'Migration 20260812120000 failed: api_keys_user_exchange_venue_account_uniq is not PARTIAL. Without WHERE venue_account_id IS NOT NULL the index governs the all-NULL majority of api_keys, which is every ccxt key. Rolling back.';
  END IF;

  SELECT indexdef INTO v_idx_def
    FROM pg_indexes
   WHERE schemaname = 'public'
     AND tablename = 'api_keys'
     AND indexname = 'api_keys_user_exchange_venue_account_uniq';
  IF v_idx_def NOT ILIKE '%venue_account_id IS NOT NULL%' THEN
    RAISE EXCEPTION
      'Migration 20260812120000 failed: the index predicate is not (venue_account_id IS NOT NULL): %. Rolling back.',
      v_idx_def;
  END IF;

  SELECT array_agg(a.attname ORDER BY k.ord) INTO v_idx_cols
    FROM pg_index i
    JOIN pg_class c     ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
   WHERE n.nspname = 'public'
     AND c.relname = 'api_keys_user_exchange_venue_account_uniq';
  IF v_idx_cols IS DISTINCT FROM ARRAY['user_id', 'exchange', 'venue_account_id']::TEXT[] THEN
    RAISE EXCEPTION
      'Migration 20260812120000 failed: index must cover exactly (user_id, exchange, venue_account_id) in that order, got %. user_id MUST LEAD — a non-tenant-leading unique index over a caller-influenced value is the C-08 cross-tenant leak. Rolling back.',
      v_idx_cols;
  END IF;

  -- (e) BOTH scrub triggers are attached. The new one must exist, and this
  --     migration must not have displaced the older one.
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.api_keys'::regclass
       AND tgname = 'api_keys_scrub_venue_account_id'
       AND NOT tgisinternal
  ) INTO v_trg_venue;
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.api_keys'::regclass
       AND tgname = 'api_keys_scrub_attested_venue'
       AND NOT tgisinternal
  ) INTO v_trg_attested;

  IF NOT v_trg_venue THEN
    RAISE EXCEPTION
      'Migration 20260812120000 failed: the api_keys_scrub_venue_account_id BEFORE INSERT trigger is not attached — a client could supply its own venue_account_id and evade the dedup for free. Rolling back.';
  END IF;
  IF NOT v_trg_attested THEN
    RAISE EXCEPTION
      'Migration 20260812120000 failed: the pre-existing api_keys_scrub_attested_venue trigger is GONE — this migration displaced it and re-opened the 153.6 probe-gate bypass. Rolling back.';
  END IF;

  -- (f) THE COMPOSITION NOTHING ELSE PROVES, and it has real teeth HERE that it
  --     did not have in the donor. A SECURITY DEFINER body runs as its OWNER, so
  --     the scrub triggers' current_user test resolves against proowner. In
  --     20260811210000 the owner was INHERITED through CREATE OR REPLACE and
  --     could not change; THIS migration DROPS and re-creates the function, so
  --     the owner becomes whichever role applied the migration. If that role is
  --     outside the allowlist the failure is SILENT AND TOTAL: BOTH scrub
  --     triggers fire on the RPC's own INSERT, attested_venue AND
  --     venue_account_id both land NULL, every MT5 finalize answers a permanent
  --     KEY_SCOPE_CHECK_UNAVAILABLE, and the dedup governs nothing — while this
  --     migration reports success.
  SELECT pg_get_userbyid(proowner) INTO v_cws_owner
    FROM pg_proc WHERE oid = c_new_sig::regprocedure;

  IF NOT (v_cws_owner = ANY (c_privileged_roles)) THEN
    RAISE EXCEPTION
      'Migration 20260812120000 failed: create_wizard_strategy is owned by %, which the api_keys scrub triggers do not admit (allowed: %). DROP+CREATE re-owned the function to the applying role. Every key the wizard mints would have BOTH attested_venue and venue_account_id scrubbed to NULL. Rolling back.',
      v_cws_owner, array_to_string(c_privileged_roles, ', ');
  END IF;

  --     …and the allowlist compared against above is really the one the new
  --     trigger enforces. Without this, re-cutting the trigger's list while
  --     leaving c_privileged_roles behind would make (f) assert against a
  --     fiction and pass.
  SELECT pg_get_functiondef('public.scrub_client_supplied_venue_account_id()'::regprocedure)
    INTO v_scrub_src;
  FOREACH v_role IN ARRAY c_privileged_roles LOOP
    IF v_scrub_src NOT LIKE ('%''' || v_role || '''%') THEN
      RAISE EXCEPTION
        'Migration 20260812120000 failed: the venue_account_id scrub body does not name the role %, so the owner allowlist this post-verify checked is not the one actually enforced. Re-cut both together. Rolling back.',
        v_role;
    END IF;
  END LOOP;

  --     …and it is SECURITY INVOKER. A DEFINER form would make the trigger a
  --     silent no-op and every client-supplied identity would persist.
  IF EXISTS (
    SELECT 1 FROM pg_proc
     WHERE oid = 'public.scrub_client_supplied_venue_account_id()'::regprocedure
       AND prosecdef
  ) THEN
    RAISE EXCEPTION
      'Migration 20260812120000 failed: scrub_client_supplied_venue_account_id is SECURITY DEFINER, so current_user resolves to its OWNER, the privileged check always passes, and the trigger is a silent no-op. It must be SECURITY INVOKER. Rolling back.';
  END IF;

  RAISE NOTICE 'Migration 20260812120000 post-verify OK: venue_account_id column + partial UNIQUE (user_id, exchange, venue_account_id) present, exactly 1 create_wizard_strategy overload (owner %), fence + attested_venue + venue_account_id canaries intact, grants authenticated-yes/anon-no, both api_keys scrub triggers attached, new scrub is SECURITY INVOKER.',
    v_cws_owner;
END
$verify$;

COMMIT;
