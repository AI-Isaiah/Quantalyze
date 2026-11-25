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
