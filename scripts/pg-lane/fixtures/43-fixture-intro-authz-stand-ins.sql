-- Additive stand-ins for the intro-authorization gate
-- (supabase/tests/test_contact_requests_insert_intro_authz.sql). Phase 204 INTROAUTH,
-- plan 01.
--
-- WHY IT IS NEEDED. The policy under test reads `public.investor_attestations`, and
-- the function under test is `public.send_intro_with_decision(...)`. On the lane,
-- 02-fixture-sanitize-tables.sql gives the attestation table a single `user_id`
-- column and no client grant, and nothing creates the function at all. This file
-- carries exactly what the real migration and the gate need to act on:
--   1. `investor_attestations.attested_at` and `.version`, the two columns the
--      gate seeds and the policy reads (the real table has both).
--   2. Row level security on that table plus a stand-in `attestations_self_read`
--      policy (USING (auth.uid() = user_id)) and a SELECT grant to `authenticated`.
--      The policy's EXISTS subquery runs with the CALLER's privileges, so without
--      the grant a legitimate caller would be refused at the grant layer, not by
--      the predicate. `anon` gets the same SELECT on the attestation table and on
--      `profiles`, as the real schema grants it: a NULL-uid session evaluates the
--      whole check, and without those grants it would be refused at the grant
--      layer with a table-permission message instead of by row level security.
--   3. A SECURITY DEFINER stand-in of the six-argument function whose ACL has the
--      shape the real function carried before migration 20261110150000: owner
--      default privileges to anon, authenticated and service_role through
--      07-fixture-supabase-default-privileges.sql, and PUBLIC revoked. The body is a
--      bare RETURN, because the ACL arms never run it past the privilege check.
--
-- WHAT IT DOES AND DOES NOT PROVE (the fixtures/ contract, run.sh). Every object
-- here is a STAND-IN: the fixture author's MODEL of the schema, not the schema. The
-- migration under test (the policy and the REVOKE) is real and is applied after this
-- file. It proves the DDL applies, the migration's verification block bites and the
-- gate's arms pass and can fail. It proves nothing about the real function body or
-- the real table's other constraints.
--
-- ORDER. Apply AFTER 02, 07, 12, 28 and 10: the function must be created after the
-- default-privileges fixture so its ACL starts from the client-role grants, and the
-- attestation table must already exist.
--
-- NEVER APPLIED TO TEST OR PROD. Both carry the real objects; this file would shadow
-- them. It exists only inside scripts/pg-lane/run.sh's throwaway cluster, reached
-- only by gates that name it in their own RED-UNDER-SETUP, and destroyed by the
-- lane's EXIT trap in every outcome.
--
-- Never a second base: 01-fixture-core.sql remains the only destructive fixture. This
-- file adds two columns, one policy, three grants and one function; it removes nothing.

ALTER TABLE public.investor_attestations
  ADD COLUMN IF NOT EXISTS attested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS version     TEXT        NOT NULL DEFAULT 'stand-in';

ALTER TABLE public.investor_attestations ENABLE ROW LEVEL SECURITY;

-- Mirrors the real policy of the same name (supabase/schema/baseline.sql).
CREATE POLICY attestations_self_read ON public.investor_attestations
  FOR SELECT USING (auth.uid() = user_id);

GRANT SELECT ON public.investor_attestations TO authenticated, anon;
GRANT SELECT ON public.profiles TO anon;

CREATE OR REPLACE FUNCTION public.send_intro_with_decision(
  p_allocator_id         uuid,
  p_strategy_id          uuid,
  p_original_strategy_id uuid,
  p_candidate_id         uuid,
  p_admin_note           text,
  p_decided_by           uuid
) RETURNS TABLE (contact_request_id uuid, match_decision_id uuid, was_already_sent boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $stand_in$
BEGIN
  RETURN;
END;
$stand_in$;

-- The baseline ACL shape: PUBLIC holds nothing, the three client roles hold EXECUTE
-- through the default privileges the function was just created under.
REVOKE ALL ON FUNCTION public.send_intro_with_decision(uuid, uuid, uuid, uuid, text, uuid) FROM PUBLIC;
