DROP SCHEMA IF EXISTS auth CASCADE;
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

CREATE TABLE auth.users (
  id          UUID PRIMARY KEY,
  instance_id UUID,
  email       TEXT,
  created_at  TIMESTAMPTZ,
  updated_at  TIMESTAMPTZ
);

CREATE TABLE profiles (
  id           UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  display_name TEXT,
  email        TEXT,
  role         TEXT
);

CREATE TABLE strategies (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES profiles ON DELETE CASCADE,
  name                TEXT,
  status              TEXT,
  strategy_types      TEXT[],
  subtypes            TEXT[],
  markets             TEXT[],
  supported_exchanges TEXT[]
);

-- Supabase-shaped auth.uid(): reads the request.jwt.claims GUC.
-- Supabase-shaped auth.uid(). ⚠️ NULLIF **before** the cast: a psql arm that
-- does set_config('request.jwt.claims', NULL, true) leaves the EMPTY STRING
-- behind, not NULL (measured), and ''::jsonb raises 22P02. Casting first cost a
-- run and looked exactly like a gate failure in SERVICE-ROLE 2b.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID
  LANGUAGE sql STABLE AS $$
    SELECT COALESCE(
             NULLIF(current_setting('request.jwt.claim.sub', true), ''),
             NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
           )::uuid
  $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
GRANT SELECT ON strategies, profiles TO authenticated;

CREATE OR REPLACE FUNCTION public._assert_no_public_execute(p_function_signature text)
 RETURNS void LANGUAGE plpgsql AS $function$
DECLARE v_oid OID; v_leaks INTEGER;
BEGIN
  v_oid := p_function_signature::regprocedure::oid;
  SELECT COUNT(*) INTO v_leaks
    FROM pg_proc p, LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
   WHERE p.oid = v_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE';
  IF v_leaks > 0 THEN
    RAISE EXCEPTION '_assert_no_public_execute: PUBLIC has EXECUTE on %', p_function_signature
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$function$;
