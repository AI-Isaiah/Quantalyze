-- ============================================================================
-- FIXTURE: a baseline-SHAPED dump. NOT the real one.
--
-- ⛔ WHY A FIXTURE AND NOT supabase/schema/baseline.sql. The real dump needs
-- `pg_net` and `supabase_vault`, and the throwaway pg-lane has neither, so the real
-- dump CANNOT replay there. Whether it replays on hosted TEST is what
-- `--mode preflight` measures — transactionally, against TEST itself, before
-- anyone decides. This file exists so the MECHANISM (drop, replay, re-create the
-- survivors, seed the ledger, assert the shape, commit or roll back) can be
-- observed end to end on a cluster nobody shares.
--
-- It keeps the real dump's SHAPE where the shape is load-bearing:
--   * the same SET preamble, INCLUDING `set_config('search_path', '', false)` —
--     which is why every survivor DDL the script captures must be schema-qualified;
--   * `CREATE EXTENSION ... WITH SCHEMA "extensions"` (baseline.sql:41);
--   * `CREATE TABLE IF NOT EXISTS "public"."x"` (baseline.sql:1304), which is the
--     line the publication refusal greps for;
--   * `ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";`
--     (baseline.sql:13668) — the ONE line class the script filters out. On hosted
--     Supabase that publication is owned by `supabase_admin` and `postgres` may not
--     reassign it; ON THE LANE THE STATEMENT WOULD SUCCEED, which is exactly why
--     the filter is asserted by COUNT and not by its effect;
--   * the schema GRANT lines (baseline.sql:13677-13680);
--   * `ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public"` — the
--     real dump carries 12 of these (4 grantees x 3 object types). ⚠️ NOTE THE
--     QUOTES around the schema identifier: a grep written `IN SCHEMA public`
--     matches zero lines and reads as "the dump omits these grants". Arm 18
--     needs the dump to RE-CREATE the default ACL, or its round-trip would be
--     a claim about a shape the fixture does not have.
--
-- Its measured shape — 2 CREATE TABLE lines, 1 CREATE POLICY line, 2 distinct
-- function names — is what the self-test's exact summary line pins.
-- ============================================================================

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";

COMMENT ON SCHEMA "public" IS 'standard public schema';

CREATE TABLE IF NOT EXISTS "public"."fx_keep" (
    "id" integer NOT NULL,
    "label" "text"
);

ALTER TABLE "public"."fx_keep" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."fx_other" (
    "id" integer NOT NULL,
    "payload" "text"
);

ALTER TABLE "public"."fx_other" OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."fx_survivor"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN NEW;
END
$$;

ALTER FUNCTION "public"."fx_survivor"() OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."fx_role"("p_role" "text") RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  SELECT "p_role" IS NOT NULL;
$$;

ALTER FUNCTION "public"."fx_role"("p_role" "text") OWNER TO "postgres";

ALTER TABLE ONLY "public"."fx_keep"
    ADD CONSTRAINT "fx_keep_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."fx_other"
    ADD CONSTRAINT "fx_other_pkey" PRIMARY KEY ("id");

ALTER TABLE "public"."fx_keep" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fx_keep_read" ON "public"."fx_keep" FOR SELECT USING (true);

ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";

GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

GRANT ALL ON TABLE "public"."fx_keep" TO "anon";
GRANT ALL ON TABLE "public"."fx_keep" TO "authenticated";
GRANT ALL ON TABLE "public"."fx_keep" TO "service_role";
GRANT ALL ON TABLE "public"."fx_other" TO "anon";
GRANT ALL ON TABLE "public"."fx_other" TO "authenticated";
GRANT ALL ON TABLE "public"."fx_other" TO "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT SELECT ON TABLES TO PUBLIC;
