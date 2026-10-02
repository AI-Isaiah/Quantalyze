-- Supabase's PROJECT BOOTSTRAP default privileges, reproduced so that a table a
-- REAL migration creates later in the apply list arrives with the same grants it
-- has in production. Apply this AFTER 01-fixture-core.sql (which drops schema
-- public) and BEFORE the migrations under test — ALTER DEFAULT PRIVILEGES is not
-- retroactive.
--
-- ⭐ WHY THIS IS NOT COSMETIC. A gate whose arms read "anon sees 0 rows" is
-- asserting that the migration's own `REVOKE ALL … FROM anon` bites. On a vanilla
-- cluster anon never had the grant, so that REVOKE is a no-op and the arm passes
-- for a reason unrelated to the migration — a vacuous PASS inside the vacuity
-- detector. Granting the bootstrap defaults first is what makes the REVOKE, and
-- therefore the arm, falsifiable on the lane.
--
-- Every migration this repo ships is written against a project that already has
-- these; see the same three statements reproduced in plan 164.4-00's stubbed-chain
-- probe 3 (`.planning/phases/164.4-…/164.4-00-FIXTURE-STRATEGY.md`).
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
