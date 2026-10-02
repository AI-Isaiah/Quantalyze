-- Additive stand-in: `public.system_flags`. 20260407164606_perfect_match.sql:44-49
-- creates it in production; that migration cannot enter an apply list (it reads
-- auth.users, carries FKs onto `strategies`, and creates four unrelated tables
-- alongside this one), so this fixture mirrors its four columns EXACTLY —
-- key/enabled/updated_at/updated_by, same types, same PRIMARY KEY, same FK
-- target.
--
-- Read by 20260907130000_ledger_refresh_switch_to_system_flags.sql, whose two
-- fan-out bodies open on `SELECT sf.enabled ... WHERE sf.key =
-- 'ledger_refresh_enabled'` as their FIRST statement. Without this table that
-- read raises, the guard's handler leaves the value NULL and every positive arm
-- returns 0 — fail-closed is the CORRECT behaviour there, which is exactly why
-- its absence would be invisible: a gate measuring "0 enqueued" cannot tell
-- "the flag is off" from "the table is missing".
--
-- `updated_by UUID REFERENCES profiles(id)`: `profiles` exists from
-- 01-fixture-core.sql:16 (MEASURED — not fixture 02, which only ALTERs it), so
-- the FK resolves in every apply list that starts from the core fixture, which
-- is all of them.
--
-- NO SEED ROW. The migration seeds ('ledger_refresh_enabled', FALSE) itself with
-- ON CONFLICT DO NOTHING, and a row planted here would make the migration's own
-- apply-time assertion ("the seed row exists and is FALSE") pass on the
-- fixture's row rather than on the seed. It would also make the missing-row arm
-- — the C-03 rejection of the fail-OPEN default — untestable on the lane.
--
-- RLS is ENABLED with NO POLICIES, deliberately. The only lane reader is a
-- SECURITY DEFINER body whose owner is RLS-exempt (arm J of the ledger gates
-- asserts that exemption, and 20260825130000's own verification block RAISES
-- unless the owner is rolsuper OR rolbypassrls), so the read bypasses row
-- security by construction. Adding a policy here shadows nothing today but
-- could collide by name with a future migration's own (R7-fixture-shadows-policy)
-- while proving nothing that is under test.
--
-- ⛔ Never a second base: 01-fixture-core.sql remains the only destructive
-- fixture. This file creates one table and enables RLS on it; it drops nothing.
CREATE TABLE system_flags (
  key        TEXT PRIMARY KEY,
  enabled    BOOLEAN NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES profiles(id)
);

ALTER TABLE system_flags ENABLE ROW LEVEL SECURITY;
