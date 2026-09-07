-- Additive stand-in: the `vault` schema, its `decrypted_secrets` view-shaped
-- relation, and `vault.create_secret`. On a real Supabase project these come
-- from the `supabase_vault` EXTENSION, which is created by
-- supabase/schema/baseline.sql:48 (`CREATE EXTENSION IF NOT EXISTS
-- "supabase_vault" WITH SCHEMA "vault"`) and by NO migration — MEASURED
-- 2026-09-07: `grep -rn 'vault\.' supabase/migrations/` is empty. The pg-lane
-- boots a vanilla PostgreSQL cluster with no Supabase extensions, so nothing in
-- any apply list can bring the schema into being.
--
-- WHY IT IS NEEDED. Phase 164.7's match-engine callable
-- (20260907120000_analytics_service_settings_and_vault_tick.sql) reads the
-- analytics service key with the idiom PROD's jobid 1 already runs:
-- `SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE
-- name = 'analytics_service_key'`. plpgsql resolves that at RUN time, so the
-- migration APPLIES on a vault-less lane; what it cannot do there is get PAST
-- the read — every call dies on 42P01 naming no arm. The arms this fixture
-- makes runnable are the two RAISE paths that convert an absent secret into a
-- LOUD failure instead of a null `X-Service-Key` header (TODOS CRON-DRIFT-01:
-- seven days of 401s behind a green cron history).
--
-- ⛔ NEVER APPLIED TO TEST OR PROD. Both carry the real `supabase_vault`
-- extension; this file would shadow an encrypted secret store with a plaintext
-- table. It exists only inside `scripts/pg-lane/run.sh`'s throwaway cluster,
-- which listens on 127.0.0.1 and is destroyed by its EXIT trap in every
-- outcome. Nothing in supabase/tests may apply it against $TEST_SUPABASE_DB_URL
-- — the gates run there WITHOUT any fixture at all.
--
-- ⚠️ WHAT IT DOES NOT PROVE (the fixtures/ contract, run.sh:69-77). It is the
-- fixture author's MODEL of Vault, not Vault: the real `decrypted_secrets` is a
-- VIEW over pgsodium-encrypted rows carrying
-- `id, name, description, secret, decrypted_secret, key_id, nonce, created_at,
-- updated_at`, and only the two columns the callable actually names are
-- reproduced. So an arm over this fixture proves the callable's CONTROL FLOW
-- around a present/absent secret. It proves nothing about encryption, about
-- which grants `postgres` holds on the real view, or about whether a SECURITY
-- DEFINER body may read it on a hosted project (RESEARCH A1, unmeasured).
--
-- ⚠️ `create_secret`'s parameter ORDER is the real one — (secret, name,
-- description), NOT (name, secret) — per supabase.com/docs/guides/database/vault
-- (`vault.create_secret('value', 'unique_name', 'description')`). A gate written
-- against this fixture therefore calls it identically on TEST, where the real
-- function answers. Getting the order wrong here would make every gate that
-- uses it silently store the NAME as the SECRET on the lane and fail only on the
-- shared database.
--
-- Never a second base: 01-fixture-core.sql remains the only destructive fixture.
CREATE SCHEMA IF NOT EXISTS vault;

CREATE TABLE IF NOT EXISTS vault.decrypted_secrets (
  name             TEXT PRIMARY KEY,
  decrypted_secret TEXT
);

CREATE OR REPLACE FUNCTION vault.create_secret(
  p_secret      TEXT,
  p_name        TEXT,
  p_description TEXT DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
AS $create_secret$
BEGIN
  INSERT INTO vault.decrypted_secrets (name, decrypted_secret)
  VALUES (p_name, p_secret)
  ON CONFLICT (name) DO UPDATE SET decrypted_secret = EXCLUDED.decrypted_secret;
  -- The real function returns the secret's uuid id. Nothing in this repo reads
  -- that return value, and this stand-in stores no id, so a fresh uuid is the
  -- honest answer: it satisfies the signature without pretending to be a handle
  -- that can be looked up again.
  RETURN gen_random_uuid();
END
$create_secret$;
