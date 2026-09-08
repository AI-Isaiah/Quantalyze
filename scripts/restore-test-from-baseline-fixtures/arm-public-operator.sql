-- ============================================================================
-- ARM OVERLAY 17 — an object in `public` of a class the derived census's
-- refclassid whitelist does NOT resolve.
--
-- Applied ON TOP OF old-test.sql by the self-test's `fresh_db <name>`.
--
-- ⛔ WHY A WHITELIST NEEDS A TRIPWIRE. The closure resolves a hand-listed set of
-- `classid` values to an owning schema. A whitelist is closed only if what it
-- EXCLUDES is measured EMPTY rather than assumed empty — and it is asserted on
-- the LIVE database, inside the transaction, because TEST can hold objects the
-- reviewed dump does not.
--
-- An operator is the cheapest member of the excluded set to create. Without the
-- emptiness assertion it is CASCADE-dropped with the schema and never
-- re-created, and nothing in the run says so.
-- ============================================================================

CREATE OPERATOR public.### (LEFTARG = integer, RIGHTARG = integer, FUNCTION = int4pl);
