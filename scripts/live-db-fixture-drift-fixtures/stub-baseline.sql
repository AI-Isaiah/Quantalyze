-- Stub catalogue for scripts/live-db-fixture-drift-census.mjs's --self-test.
-- Shapes only what the classifier needs (CREATE TABLE, CREATE OR REPLACE FUNCTION), same
-- register as the real supabase/schema/baseline.sql. Not applied anywhere; read as text only.

CREATE TABLE IF NOT EXISTS "public"."stub_table" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "known_col" "text" NOT NULL,
    CONSTRAINT "stub_table_known_col_check" CHECK (("known_col" <> ''::"text"))
);

ALTER TABLE "public"."stub_table" OWNER TO "postgres";

-- Two overloads of the same name, mirroring public.claim_compute_jobs_with_priority in the real
-- baseline (a 2-arg and a 5-arg definition). p_common sits in BOTH overloads; p_unique sits in
-- only the second, so a payload naming p_unique disambiguates and a payload naming only
-- p_common (or nothing at all) does not.
CREATE OR REPLACE FUNCTION "public"."stub_fn"("p_common" integer DEFAULT NULL::integer) RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- comment on purpose: admin.rpc("stub_fn") would be ambiguous, this line proves nothing runs
END;
$$;

CREATE OR REPLACE FUNCTION "public"."stub_fn"("p_common" integer DEFAULT NULL::integer, "p_unique" integer DEFAULT NULL::integer) RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
END;
$$;
