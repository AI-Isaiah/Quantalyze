-- Additive stand-ins for the api_keys columns `create_wizard_strategy` writes
-- (20260814120000:285-297). Apply AFTER 01/02/03 and BEFORE
-- 20260814120000_wizard_rpcs_revoke_authenticated.sql. Never a second base:
-- 01-fixture-core.sql remains the only destructive fixture.
--
-- WHAT IS SCAFFOLD AND WHAT IS UNDER TEST. The object under test in
-- test_csv_finalize_double_submit.sql Part 4 is the REAL
-- `create_wizard_strategy` body from 20260814120000 — specifically the two
-- columns Part 4a's vacuity fence reads back, `strategies.source` ('wizard')
-- and `strategies.wizard_session_id`, both of which 13-fixture-csv-finalize-fold
-- already supplies on the REAL `strategies` table. Everything THIS file adds is
-- api_keys secret-material scaffold that body's INSERT names and that NO arm in
-- any gate asserts on, so a stand-in here cannot make an arm unfalsifiable.
--
-- ⛔ WHY THE REAL 20260811210000_api_keys_attested_venue.sql IS NOT USED
-- INSTEAD. Measured on the lane 2026-09-04: with
-- 07-fixture-supabase-default-privileges.sql applied (which the fold's own list
-- needs), that migration's post-verify aborts —
-- `Migration 20260811210000 failed: anon acquired EXECUTE on a wizard RPC.
-- Rolling back.` — because Supabase's pg_default_acl re-grants anon on every
-- DROP + CREATE, exactly the footgun its own COMMENT documents. It defines
-- nothing this gate asserts on (its subject is the attested_venue CHECK and the
-- scrub trigger, both covered by test_api_keys_exchange_not_user_writable.sql),
-- so its columns are supplied additively rather than dragging an unrelated
-- self-verifying migration and its census pre-flight into this apply list.
ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS api_secret_encrypted  TEXT,
  ADD COLUMN IF NOT EXISTS passphrase_encrypted  TEXT,
  ADD COLUMN IF NOT EXISTS dek_encrypted         TEXT,
  ADD COLUMN IF NOT EXISTS nonce                 TEXT,
  ADD COLUMN IF NOT EXISTS kek_version           INTEGER,
  ADD COLUMN IF NOT EXISTS attested_venue        TEXT,
  ADD COLUMN IF NOT EXISTS venue_account_id      TEXT;

-- The gate calls create_wizard_strategy under a service_role JWT claim while
-- connected as the lane superuser, and reads api_keys back; 07's ALTER DEFAULT
-- PRIVILEGES are not retroactive to a table 02-fixture-sanitize-tables created.
GRANT ALL ON public.api_keys TO anon, authenticated, service_role;

-- The CHECK 20260814120000's post-verify (g) requires, copied VERBATIM from
-- 20260811210000:292-294 (the migration that owns it). It is scaffold here, not
-- an object under test: `create_wizard_strategy` writes attested_venue and
-- exchange from the SAME parameter, so it can never be the reason an arm reds.
-- Its own recurring gate is test_api_keys_exchange_not_user_writable.sql.
DO $constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.api_keys'::regclass
       AND conname  = 'api_keys_attested_venue_matches_exchange'
  ) THEN
    ALTER TABLE public.api_keys
      ADD CONSTRAINT api_keys_attested_venue_matches_exchange
      CHECK (attested_venue IS NULL OR attested_venue = exchange);
  END IF;
END
$constraint$;
