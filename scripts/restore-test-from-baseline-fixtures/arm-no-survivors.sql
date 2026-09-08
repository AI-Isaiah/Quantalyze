-- ============================================================================
-- ARM OVERLAY 19 (A1) — ZERO CENSUSED SURVIVORS, plus one cross-schema orphan.
--
-- Applied ON TOP OF old-test.sql by the self-test's `fresh_db <name>`.
--
-- ⛔ THE EMPTY CASE WAS THE UNOBSERVED ONE, AND IT WAS TOTAL. `build_transaction`
-- renders the censused survivor keys into the B2 closure as a text[] literal.
-- With no survivors it used to substitute `NULL::text`, so the closure compiled
-- to:
--
--     v_keys text[] := ARRAY[NULL::text]::text[];
--     ...
--     IF NOT (r.key = ANY (v_keys)) THEN RAISE EXCEPTION ...
--
-- `r.key = ANY (ARRAY[NULL])` is SQL NULL, not false, for EVERY r. `NOT NULL` is
-- NULL. plpgsql treats `IF NULL` as FALSE. So the closure never raised — and the
-- one guard standing between `DROP SCHEMA public CASCADE` and every cross-schema
-- dependent was silently off, in the branch nobody had a fixture for. The restore
-- COMMITTED with the dependents gone. (MEASURED on pg16; the failure is silent,
-- total, and only reachable when the survivor census comes back empty.)
--
-- ⚠️ THE EMPTINESS IS THE POINT, so this overlay REMOVES all three survivor
-- classes the base fixture carries rather than adding a fourth:
--   (a) the trigger on auth.users calling public.fx_survivor();
--   (b) the storage.objects policy calling public.fx_role();
--   (c) the realtime publication's membership row for public.fx_keep.
-- Nothing else about the database changes: `public` still holds the same tables,
-- the ledger still holds the fixture's four rows, the identity marker still says
-- TEST. The ONLY difference from a green restore is that survivors.keys is empty.
--
-- The orphan is the same shape arm 13 uses — a view in a non-public schema over a
-- public table, which the three hand-listed census classes cannot see and the
-- derived pg_depend closure names as `rule _RETURN on view analytics.v_leftover`.
-- With the closure working, the restore ABORTS and rolls back. Without it, this
-- overlay is the CASCADE-drop-and-commit that A1 describes.
-- ============================================================================

-- (a)
DROP TRIGGER on_auth_user_created ON auth.users;

-- (b)
DROP POLICY qualified_ref ON storage.objects;

-- (c) The publication OBJECT stays — it is schema-less and survives the DROP.
-- Only its membership row goes, which is the class the census reads.
ALTER PUBLICATION supabase_realtime DROP TABLE public.fx_keep;

-- The orphan the closure must name.
CREATE SCHEMA IF NOT EXISTS analytics;

CREATE VIEW analytics.v_leftover AS SELECT * FROM public.fx_keep;
