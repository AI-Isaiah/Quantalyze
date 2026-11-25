-- ============================================================================
-- Phase 230 MT5NIGHTLY, plan 01 (MT5D-02): the cross-process MT5 terminal lease
-- ============================================================================
-- One lease row per MT5 terminal behind three token-fenced RPCs:
-- acquire_mt5_terminal_lease, renew_mt5_terminal_lease, release_mt5_terminal_lease.
--
-- THE TRACED CAUSE (230-DISCUSSION-LOG R-3). The MT5 terminal is ONE shared
-- process. Two Railway services drive it: the backfill worker (its nightly
-- derive_broker_dailies run) and the API process (the allocator holdings poll).
-- The in-process serializer, services/mt5_concurrency.py, is an asyncio.Lock per
-- process, so it serializes nothing ACROSS the two services. The two logged the
-- terminal into different accounts at the same time; the derive's MT5CONC-02
-- login bracket refused the read (nothing persisted), the job was retried as
-- transient, and the retry succeeded. That is the second attempt the nightly
-- record shows. Only the database is shared by both services.
--
-- THE DECISION. D-01 of the phase context, the founder's ruling "Database lease
-- (Recommended)": one lease row per terminal, with an expiry and an owner token,
-- taken by every MT5 terminal user. Plan 02 calls these RPCs from
-- mt5_terminal_lease; this migration makes them exist and changes no behaviour
-- until then.
--
-- DECISIONS.
--   DEC-01-A Release kills the token. Release sets owner_token = NULL and
--     expires_at = now() and KEEPS the row, so the last holder stays readable and
--     the cardinality stays one row per terminal. A renew that lands after the
--     release can never match, because renew requires owner_token = the caller's
--     token: a released lease cannot be resurrected for a TTL by a late renew.
--   DEC-01-B Same-token acquire is idempotent. A retried acquire whose answer was
--     lost succeeds, which is what lets the client retry and release a grant that
--     landed after its caller gave up.
--   DEC-01-C One statement under the row lock. Acquire is one INSERT ... ON
--     CONFLICT (terminal_digest) DO UPDATE ... WHERE <free or same token>, with
--     the granted/refused answer read from the row count. A concurrent first
--     insert blocks on the unique index and re-evaluates the WHERE on the
--     committed row, so two callers cannot both be granted.
--   DEC-01-D Rejected. A session advisory lock: PostgREST gives the client no
--     session that spans a multi-second hold. Moving MT5 holdings polls onto the
--     backfill worker and moving the holdings cron out of the derive window: both
--     rejected by the founder in D-01. A cron schedule for pruning: the table
--     holds one row per terminal and needs none.
--
-- THE CLOCK. Expiry is the database's now(). No client clock is ever written, so
-- the two services cannot disagree about when a lease ran out.
--
-- WHAT THIS DOES NOT TOUCH. No existing table, row or stored value changes (the
-- 155.2 freeze does not apply: D-01 puts this outside the window). Nothing is
-- scheduled. The table has no user column and no foreign key. No host, port,
-- login, server name or key id is written anywhere: the lease is keyed by a
-- sha256 digest of the terminal key, and the holder is an api_key_id or one of
-- four closed literals.
-- ============================================================================

SET LOCAL lock_timeout = '3s';

-- ==========================================================================
-- STEP 1: public.mt5_terminal_leases
-- ==========================================================================
-- Plain CREATE TABLE, not IF NOT EXISTS: the name is new, so a collision must fail loud.
CREATE TABLE public.mt5_terminal_leases (
  terminal_digest text        PRIMARY KEY,
  owner_token     uuid        NULL,
  holder          text        NOT NULL,
  site            text        NOT NULL,
  acquired_at     timestamptz NOT NULL,
  expires_at      timestamptz NOT NULL,
  CONSTRAINT mt5_terminal_leases_digest_chk
    CHECK (terminal_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT mt5_terminal_leases_holder_chk
    CHECK (
      holder IN ('house', 'validation', 'unknown', 'unattributed')
      OR holder ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ),
  CONSTRAINT mt5_terminal_leases_site_chk
    CHECK (site ~ '^[a-z_]{1,48}$')
);

COMMENT ON TABLE public.mt5_terminal_leases IS
  'Phase 230 MT5D-02 (migration 20261126120000): one row per MT5 terminal, the cross-process lease. Keyed by a sha256 digest of the terminal key, never the raw host:port. owner_token is the current holder''s token (NULL = free); holder is an api_key_id or one of the closed literals house, validation, unknown, unattributed; site is the lease site name (shape only). Free means owner_token IS NULL OR expires_at <= now(). Written only by acquire_mt5_terminal_lease, renew_mt5_terminal_lease and release_mt5_terminal_lease. service_role holds SELECT only.';

-- ==========================================================================
-- STEP 2: RLS and grants
-- ==========================================================================
-- RLS ENABLE, deliberately WITHOUT FORCE and with NO policy: every non-owner role is
-- refused by default, and the SECURITY DEFINER RPCs run as the table owner, which
-- bypasses RLS because the table is ENABLEd and not FORCEd.
ALTER TABLE public.mt5_terminal_leases ENABLE ROW LEVEL SECURITY;

-- Supabase default privileges hand new tables to anon, authenticated and service_role,
-- so everything is revoked first and the one positive grant is restated. service_role
-- keeps SELECT only (diagnostics); writes go through the RPCs.
REVOKE ALL ON TABLE public.mt5_terminal_leases FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.mt5_terminal_leases TO service_role;

-- ==========================================================================
-- STEP 3: acquire_mt5_terminal_lease
-- ==========================================================================
CREATE FUNCTION public.acquire_mt5_terminal_lease(
  p_terminal_digest text,
  p_owner_token     uuid,
  p_holder          text,
  p_site            text,
  p_ttl_s           integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_rows integer;
BEGIN
  IF p_terminal_digest IS NULL OR p_terminal_digest !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'acquire_mt5_terminal_lease: p_terminal_digest must be 64 lower-case hex characters'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_owner_token IS NULL THEN
    RAISE EXCEPTION 'acquire_mt5_terminal_lease: p_owner_token must not be NULL'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_ttl_s IS NULL OR p_ttl_s < 1 OR p_ttl_s > 900 THEN
    RAISE EXCEPTION 'acquire_mt5_terminal_lease: p_ttl_s must be between 1 and 900'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_holder IS NULL
     OR NOT (
       p_holder IN ('house', 'validation', 'unknown', 'unattributed')
       OR p_holder ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     ) THEN
    RAISE EXCEPTION 'acquire_mt5_terminal_lease: p_holder must be a closed literal or a canonical lower-case UUID'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_site IS NULL OR p_site !~ '^[a-z_]{1,48}$' THEN
    RAISE EXCEPTION 'acquire_mt5_terminal_lease: p_site must be 1 to 48 lower-case letters or underscores'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  INSERT INTO public.mt5_terminal_leases AS l
         (terminal_digest, owner_token, holder, site, acquired_at, expires_at)
  VALUES (p_terminal_digest, p_owner_token, p_holder, p_site, now(),
          now() + make_interval(secs => p_ttl_s))
  ON CONFLICT (terminal_digest) DO UPDATE
     SET owner_token = EXCLUDED.owner_token,
         holder      = EXCLUDED.holder,
         site        = EXCLUDED.site,
         acquired_at = CASE
                         WHEN l.owner_token IS NOT DISTINCT FROM EXCLUDED.owner_token
                           THEN l.acquired_at
                         ELSE now()
                       END,
         expires_at  = EXCLUDED.expires_at
   WHERE l.owner_token IS NULL
      OR l.expires_at <= now()
      OR l.owner_token = EXCLUDED.owner_token;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END
$function$;

COMMENT ON FUNCTION public.acquire_mt5_terminal_lease(text, uuid, text, text, integer) IS
  'Phase 230 MT5D-02. Takes the lease row for p_terminal_digest for p_ttl_s seconds (1 to 900) and returns true, or returns false when an unexpired lease is held by a different token. Free means owner_token IS NULL or expires_at <= now(). The same token re-acquiring is granted (idempotent). One INSERT ... ON CONFLICT DO UPDATE ... WHERE statement under the row lock; the expiry is the database now(). Bad input raises invalid_parameter_value (22023) with a fixed message that echoes no argument. service_role only.';

REVOKE ALL ON FUNCTION public.acquire_mt5_terminal_lease(text, uuid, text, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_mt5_terminal_lease(text, uuid, text, text, integer)
  TO service_role;

-- ==========================================================================
-- STEP 4: renew_mt5_terminal_lease
-- ==========================================================================
-- Matches on the token alone, regardless of expiry: an expired lease nobody has taken
-- is still renewable by its holder, and once anyone else takes the row the token no
-- longer matches. Because release NULLs the token (DEC-01-A), a renew that lands after
-- the release matches nothing.
CREATE FUNCTION public.renew_mt5_terminal_lease(
  p_terminal_digest text,
  p_owner_token     uuid,
  p_ttl_s           integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_rows integer;
BEGIN
  IF p_terminal_digest IS NULL OR p_terminal_digest !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'renew_mt5_terminal_lease: p_terminal_digest must be 64 lower-case hex characters'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_owner_token IS NULL THEN
    RAISE EXCEPTION 'renew_mt5_terminal_lease: p_owner_token must not be NULL'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_ttl_s IS NULL OR p_ttl_s < 1 OR p_ttl_s > 900 THEN
    RAISE EXCEPTION 'renew_mt5_terminal_lease: p_ttl_s must be between 1 and 900'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE public.mt5_terminal_leases
     SET expires_at = now() + make_interval(secs => p_ttl_s)
   WHERE terminal_digest = p_terminal_digest
     AND owner_token = p_owner_token;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END
$function$;

COMMENT ON FUNCTION public.renew_mt5_terminal_lease(text, uuid, integer) IS
  'Phase 230 MT5D-02. Moves expires_at to now() plus p_ttl_s seconds (1 to 900) for the row whose owner_token equals p_owner_token, and returns true iff a row matched. It matches regardless of expiry, but a row another token has taken, and a row its holder released (owner_token NULL), match nothing and return false. Bad input raises invalid_parameter_value (22023). service_role only.';

REVOKE ALL ON FUNCTION public.renew_mt5_terminal_lease(text, uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.renew_mt5_terminal_lease(text, uuid, integer)
  TO service_role;

-- ==========================================================================
-- STEP 5: release_mt5_terminal_lease
-- ==========================================================================
-- DEC-01-A: release clears the owner token and ages the row out, and keeps the row. A
-- foreign token matches nothing, so it changes nothing and returns false.
CREATE FUNCTION public.release_mt5_terminal_lease(
  p_terminal_digest text,
  p_owner_token     uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_rows integer;
BEGIN
  IF p_terminal_digest IS NULL OR p_terminal_digest !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'release_mt5_terminal_lease: p_terminal_digest must be 64 lower-case hex characters'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_owner_token IS NULL THEN
    RAISE EXCEPTION 'release_mt5_terminal_lease: p_owner_token must not be NULL'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE public.mt5_terminal_leases
     SET owner_token = NULL,
         expires_at  = now()
   WHERE terminal_digest = p_terminal_digest
     AND owner_token = p_owner_token;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END
$function$;

COMMENT ON FUNCTION public.release_mt5_terminal_lease(text, uuid) IS
  'Phase 230 MT5D-02. Frees the lease for p_terminal_digest when p_owner_token holds it: sets owner_token NULL and expires_at now(), keeps the row, and returns true. A token that does not hold the lease changes nothing and gets false. Because the token is cleared, a renew that lands after the release can never match. Bad input raises invalid_parameter_value (22023). service_role only.';

REVOKE ALL ON FUNCTION public.release_mt5_terminal_lease(text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_mt5_terminal_lease(text, uuid)
  TO service_role;

-- ───────────── self-verify: CATALOGUE ONLY, passes on an empty database.
-- No mt5_terminal_leases row is read or written. Asserted: each of the three
-- functions resolves under its exact signature and RETURNS boolean; each is
-- SECURITY DEFINER with the exact search_path pin; EXECUTE is held by neither PUBLIC,
-- anon nor authenticated and is held by service_role; the comment-stripped body of
-- release clears the owner token (DEC-01-A); the table has RLS on, no policy, no
-- privilege for a browser role, no write privilege for service_role, and the three
-- named CHECK constraints. The argument guards are deliberately NOT asserted here: the
-- gate's arms L5 and L8 own them behaviourally. Each clause that a mutated copy of
-- this file would trip has its own `IF ... THEN` line so the gate's mutation twins can
-- stand exactly that clause down and let the apply succeed, which is what lets the
-- gate, not the apply, go RED with the arm named.
DO $verify$
DECLARE
  v_sigs        text[] := ARRAY[
    'public.acquire_mt5_terminal_lease(text,uuid,text,text,integer)',
    'public.renew_mt5_terminal_lease(text,uuid,integer)',
    'public.release_mt5_terminal_lease(text,uuid)'
  ];
  v_sig         text;
  v_oid         oid;
  v_secdef      boolean;
  v_rettype     oid;
  v_cfg         text[];
  v_public_exec boolean;
  v_open_exec   boolean;
  v_body        text;
  v_tbl         oid := to_regclass('public.mt5_terminal_leases');
  v_rls         boolean;
  v_policies    integer;
  v_browser     boolean;
  v_svc_write   boolean;
  v_checks      integer;
BEGIN
  FOREACH v_sig IN ARRAY v_sigs LOOP
    v_oid := to_regprocedure(v_sig);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'Migration 20261126120000 failed: % is missing', v_sig;
    END IF;

    SELECT p.prosecdef, p.prorettype, p.proconfig
      INTO v_secdef, v_rettype, v_cfg
      FROM pg_proc p WHERE p.oid = v_oid;

    IF v_rettype IS DISTINCT FROM 'boolean'::regtype::oid THEN
      RAISE EXCEPTION 'Migration 20261126120000 failed: % does not RETURN boolean, so the caller cannot read granted or refused', v_sig;
    END IF;
    IF v_secdef IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'Migration 20261126120000 failed: % is not SECURITY DEFINER, so the worker role could not reach the lease table through it', v_sig;
    END IF;
    IF v_cfg IS NULL OR NOT ('search_path=public, pg_catalog' = ANY (v_cfg)) THEN
      RAISE EXCEPTION 'Migration 20261126120000 failed: % does not pin search_path to public, pg_catalog (proconfig=%), so a SECURITY DEFINER body is search-path-hijackable', v_sig, v_cfg;
    END IF;

    v_public_exec := EXISTS (
      SELECT 1
        FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
       WHERE p.oid = v_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE');
    IF v_public_exec THEN
      RAISE EXCEPTION 'Migration 20261126120000 failed: PUBLIC holds EXECUTE on %', v_sig;
    END IF;
    v_open_exec := has_function_privilege('anon', v_oid, 'EXECUTE')
                OR has_function_privilege('authenticated', v_oid, 'EXECUTE');
    IF v_open_exec THEN
      RAISE EXCEPTION 'Migration 20261126120000 failed: anon or authenticated holds EXECUTE on %, so a browser role could take, extend or free a terminal lease', v_sig;
    END IF;
    IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Migration 20261126120000 failed: service_role does not hold EXECUTE on %, so the workers cannot take the lease', v_sig;
    END IF;
  END LOOP;

  v_body := regexp_replace(regexp_replace(
              pg_get_functiondef(to_regprocedure('public.release_mt5_terminal_lease(text,uuid)')),
              '/\*.*?\*/', '', 'gs'), '--.*', '', 'gn');
  IF v_body IS NULL THEN
    RAISE EXCEPTION 'Migration 20261126120000 failed: the comment-stripped body came back NULL, so the body check below would pass without reading anything';
  END IF;
  IF v_body !~* '\yowner_token\s*=\s*NULL\y' THEN
    RAISE EXCEPTION 'Migration 20261126120000 failed: release_mt5_terminal_lease no longer clears owner_token, so a renew landing after the release could resurrect the lease (DEC-01-A)';
  END IF;

  IF v_tbl IS NULL THEN
    RAISE EXCEPTION 'Migration 20261126120000 failed: public.mt5_terminal_leases is missing';
  END IF;
  SELECT c.relrowsecurity INTO v_rls FROM pg_class c WHERE c.oid = v_tbl;
  IF v_rls IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Migration 20261126120000 failed: row level security is not enabled on public.mt5_terminal_leases';
  END IF;
  SELECT count(*)::integer INTO v_policies FROM pg_policy WHERE polrelid = v_tbl;
  IF v_policies <> 0 THEN
    RAISE EXCEPTION 'Migration 20261126120000 failed: public.mt5_terminal_leases carries % policy row(s); it must carry none', v_policies;
  END IF;
  v_browser := has_table_privilege('anon', v_tbl, 'SELECT, INSERT, UPDATE, DELETE')
            OR has_table_privilege('authenticated', v_tbl, 'SELECT, INSERT, UPDATE, DELETE');
  IF v_browser THEN
    RAISE EXCEPTION 'Migration 20261126120000 failed: anon or authenticated holds a privilege on public.mt5_terminal_leases';
  END IF;
  v_svc_write := has_table_privilege('service_role', v_tbl, 'INSERT, UPDATE, DELETE');
  IF v_svc_write THEN
    RAISE EXCEPTION 'Migration 20261126120000 failed: service_role holds a write privilege on public.mt5_terminal_leases; writes go through the RPCs only';
  END IF;
  SELECT count(*)::integer INTO v_checks
    FROM pg_constraint
   WHERE conrelid = v_tbl AND contype = 'c'
     AND conname IN ('mt5_terminal_leases_digest_chk', 'mt5_terminal_leases_holder_chk', 'mt5_terminal_leases_site_chk');
  IF v_checks <> 3 THEN
    RAISE EXCEPTION 'Migration 20261126120000 failed: % of the 3 named CHECK constraints exist on public.mt5_terminal_leases', v_checks;
  END IF;

  RAISE NOTICE 'Migration 20261126120000: mt5_terminal_leases (RLS on, no policy, no browser privilege, SELECT only for service_role, three CHECKs) and acquire/renew/release_mt5_terminal_lease (boolean, SECURITY DEFINER, pinned search_path) exist with EXECUTE for service_role only.';
END
$verify$;
