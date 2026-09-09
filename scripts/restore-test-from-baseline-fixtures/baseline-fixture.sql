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
--
-- ⭐ `fx_keep_kind_check` IS THE FIXTURE ANALOG OF `compute_jobs_kind_check`
-- (Phase 164.8.1, W1). The restore's in-transaction gate carries a second leg
-- beyond "no allowlisted reference table is empty": a CHECK constraint that
-- admits a kind the registry table does not carry is a PARTIAL replay, and on
-- the real database that pair is `compute_jobs_kind_check` over
-- `public.compute_job_kinds`.
--
-- ⚠️ CITE THE SHIPPED CONSTRAINT, NOT AN ARBITRARY MIGRATION. Nine migrations
-- name `compute_jobs_kind_check` and five of them re-declare it with
-- `ALTER TABLE compute_jobs ADD CONSTRAINT …`, so — the repo's re-base rule —
-- only the LATEST declaration is authoritative. MEASURED 2026-09-09: that is
-- supabase/migrations/20260717233529_allocator_equity_derived_surface.sql:140,
-- and the shipped shape is supabase/schema/baseline.sql:1334 with SIXTEEN kinds
-- (… 'stitch_composite', 'derive_allocator_equity'). The cite this comment
-- carried until 2026-09-09 —
-- 20260710130000_stitch_composite_kind.sql:53 — was SUPERSEDED and one kind
-- short. The registry column is `name`
-- (supabase/migrations/20260411144407_compute_jobs_queue.sql:86). Neither object
-- exists on this lane, so WITHOUT this constraint that leg would be a no-op here
-- and would pass vacuously forever — an invariant no arm exercises is decorative.
-- The seams `REFDATA_KIND_REGISTRY` / `REFDATA_KIND_REGISTRY_COL` /
-- `REFDATA_KIND_CHECK` point the leg at this constraint and at `public.fx_keep`'s
-- own `label` column, and arm 23 leg (c) makes it FIRE. It costs no CREATE TABLE
-- line, so the exact summary lines arms 9/12/18 pin are unchanged.
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
    "label" "text",
    CONSTRAINT "fx_keep_kind_check" CHECK (("label" = ANY (ARRAY['ref_a'::"text", 'ref_b'::"text", 'ref_c'::"text"])))
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

-- ⛔ FORCE, AND A READ-ONLY POLICY, BECAUSE THE REPLAY RELIES ON BYPASSING RLS.
-- The real target of the replay is `public.compute_job_kinds`, which is FORCE ROW
-- LEVEL SECURITY (supabase/schema/baseline.sql:9578) and whose ONLY policy is
-- `compute_job_kinds_read … FOR SELECT USING (true)` (baseline.sql:13012) —
-- MEASURED 2026-09-09. There is no INSERT policy, and FORCE removes the owner's
-- exemption, so the replayed INSERTs land only because the connecting role
-- bypasses RLS. Without FORCE here the fixture would carry a WEAKER shape than
-- production and the lane could never falsify that reliance; the restore's
-- in-transaction preamble now asserts it by name. `fx_keep_read` below is the
-- SELECT-only analog of `compute_job_kinds_read`, and it is the same one line
-- arms 9/12/18 already pin as `policies=1` — FORCE adds no policy and no table,
-- so those exact summary lines are unchanged.
ALTER TABLE ONLY "public"."fx_keep" FORCE ROW LEVEL SECURITY;

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
