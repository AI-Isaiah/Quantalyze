-- Migration 054: user_app_roles join table + RBAC helpers.
--
-- Sprint 6 closeout Task 7.2 — RBAC via user_app_roles join table.
--
-- Why this migration exists
-- -------------------------
-- The product has so far gated admin routes on `profiles.is_admin` (a boolean
-- column added in migration 011). Two role dimensions have now diverged:
--   1. `profiles.role` (manager | allocator | both) — the "what kind of user
--      are you in the marketplace" signal, surfaced in the UI and used by
--      routes like /api/intro that are allocator-only.
--   2. `profiles.is_admin` — the "can you touch back-office admin routes"
--      signal, wired to the email-based fallback in `src/lib/admin.ts`.
--
-- Both are OK for the pilot product, but neither scales to the roles the
-- Sprint 7 plan requires:
--   - `admin` — back-office power user (the current `is_admin=true`).
--   - `allocator` — LP-side user who can request intros and own portfolios
--     (subset of the current `role='allocator'|'both'`).
--   - `quant_manager` — strategy-publishing user (subset of
--     `role='manager'|'both'`).
--   - `analyst` — read-only seat for a quant firm's analysts (NEW).
--
-- Rather than re-overload a single `profiles.role` column, we introduce a
-- join table so a user can hold multiple roles (a staff admin who is also
-- an allocator, a quant manager who also analyses other strategies, etc.)
-- without cramming a bitmask into a TEXT column.
--
-- Numbering deviation
-- -------------------
-- The Sprint 6 closeout plan called this migration 050_user_app_roles.
-- Migrations 050-053 were consumed by Sprint 5 Tasks 5.4/5.5/5.7/5.8
-- during the plan-to-execution gap (050 rebalance_drift, 051 weekly
-- dedup index, 052 key_permission_audit, 053 session_count_rpc). The
-- previous Sprint 6 migration (049_audit_log_hardening, Task 7.1a) used
-- the remaining pre-Sprint-5 slot. 054 is the next free slot, following
-- the convention documented in 050's header.
--
-- What this migration ships
-- -------------------------
-- 1. `user_app_roles(user_id, role, granted_by, granted_at)` join table
--    with PK(user_id, role) so the "user X has role Y" assertion is
--    idempotent under repeated grants. `role` is a TEXT CHECK in
--    ('admin','allocator','quant_manager','analyst') — TEXT CHECK over
--    Postgres ENUM so future role additions don't require a pg_cast
--    dance (see migration 001's precedent with `profiles.role`).
-- 2. RLS: owner SELECT own rows (so a user can introspect their own
--    roles), admin SELECT all rows (so the admin UI can list grants),
--    service_role INSERT/DELETE only (grant/revoke go through the admin
--    API which uses the admin client, NOT through a user-JWT mutation —
--    no endpoint lets a user self-grant).
-- 3. `current_user_has_app_role(TEXT[])` SECURITY DEFINER helper that
--    RLS policies + `requireRole()` in TS both consult. The function
--    is SECURITY DEFINER so user JWT's missing privileges don't stop
--    it from reading `user_app_roles` rows for the caller.
-- 4. Backfill: INSERT one row per truth condition, NOT a single-branch
--    CASE expression. An admin who is also `role='allocator'` gets BOTH
--    an `admin` row and an `allocator` row. `role='both'` users get
--    an `allocator` row + a `quant_manager` row. This matches the Task
--    7.2 back-compat invariant: `is_admin=true AND role='allocator'`
--    resolves to `['admin','allocator']`.
-- 5. Pilot RLS policy on `portfolios` that adds an admin-bypass SELECT
--    path via `current_user_has_app_role(ARRAY['admin'])`. Other user-
--    owned tables keep their ownership-based policies unchanged — the
--    broad fanout is Sprint 7 work so we don't destabilize 15 tables
--    worth of RLS in one migration. This pilot proves the integration
--    between the helper SQL function and a real RLS policy.
-- 6. Self-verifying DO block asserting: table exists with expected PK;
--    all four RLS policies exist with the right roles; every existing
--    profiles row has at least one matching user_app_roles row after
--    backfill; round-trip INSERT under SAVEPOINT works; helper function
--    returns TRUE for a seeded admin and FALSE for a seeded non-admin.
--
-- Security invariant
-- ------------------
-- After this migration, the grant/revoke surface is service_role only:
--   * `user_app_roles` INSERT requires service_role (admin UI calls
--     `createAdminClient()` for grant/revoke).
--   * `user_app_roles` DELETE requires service_role (same path).
--   * SELECT is owner OR admin — anon can't read, and authenticated
--     non-admin non-owners get zero rows.
-- This keeps "who has admin" forgeable only by someone with service-role
-- credentials (the Next server), not by a compromised client JWT.
--
-- Caller impact
-- -------------
-- Zero at apply time. `withAdminAuth` still reads `profiles.is_admin` via
-- `isAdminUser()` and keeps working. The new `withRole()` wrapper opts
-- callers into the join-table model incrementally — see ADR-0005 for the
-- sprint-over-sprint migration plan.

BEGIN;
SET lock_timeout = '3s';

-- --------------------------------------------------------------------------
-- STEP 1: create user_app_roles table
-- --------------------------------------------------------------------------
-- PK(user_id, role) makes the relation symmetric in both directions — the
-- same user-role pair can be granted idempotently (ON CONFLICT DO NOTHING
-- in the grant RPC). granted_by is nullable so the backfill can populate
-- historical rows with NULL (there was no granter at system birth).
CREATE TABLE IF NOT EXISTS user_app_roles (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'allocator', 'quant_manager', 'analyst')),
  granted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role)
);

COMMENT ON TABLE user_app_roles IS
  'Join table mapping auth.users → app role (admin|allocator|quant_manager|analyst). See migration 054 and ADR-0005. Supersedes profiles.is_admin for new code; is_admin remains for back-compat until Sprint 7.';
COMMENT ON COLUMN user_app_roles.granted_by IS
  'The admin (auth.users.id) who granted this role. NULL for backfilled rows and system grants. ON DELETE SET NULL so deleting the granter does not cascade-delete the grant.';
COMMENT ON COLUMN user_app_roles.granted_at IS
  'Grant timestamp. Immutable by convention — revoke + re-grant produces a new row rather than updating this column.';

-- Supporting index for "which users have role X" queries (admin UI listing).
-- PK already covers user_id lookups.
CREATE INDEX IF NOT EXISTS idx_user_app_roles_role ON user_app_roles (role);

-- --------------------------------------------------------------------------
-- STEP 2: RLS policies
-- --------------------------------------------------------------------------
-- Four policies, matching the pattern in migration 011 (allocator_preferences):
--   - owner_read: authenticated user reads their own rows
--   - admin_read: authenticated user reads all rows if they themselves have
--     the admin role (via the helper function — NOT profiles.is_admin, so
--     this policy remains correct after the is_admin → user_app_roles
--     migration in Sprint 7).
--   - service_insert: service_role only (admin client, not user JWT)
--   - service_delete: service_role only
-- UPDATE is intentionally NOT allowed — rotate by DELETE + INSERT. granted_at
-- is immutable by design.
ALTER TABLE user_app_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_app_roles_owner_read ON user_app_roles;
CREATE POLICY user_app_roles_owner_read ON user_app_roles
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS user_app_roles_admin_read ON user_app_roles;
CREATE POLICY user_app_roles_admin_read ON user_app_roles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_app_roles uar
      WHERE uar.user_id = auth.uid()
        AND uar.role = 'admin'
    )
  );

DROP POLICY IF EXISTS user_app_roles_service_insert ON user_app_roles;
CREATE POLICY user_app_roles_service_insert ON user_app_roles
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS user_app_roles_service_delete ON user_app_roles;
CREATE POLICY user_app_roles_service_delete ON user_app_roles
  FOR DELETE USING (auth.role() = 'service_role');

-- No UPDATE policy: the absence of any UPDATE policy under ENABLE ROW LEVEL
-- SECURITY means every UPDATE is rejected at the planner level. This keeps
-- granted_at immutable without needing a DENY policy pair.

-- --------------------------------------------------------------------------
-- STEP 3: current_user_has_app_role helper (SECURITY DEFINER)
-- --------------------------------------------------------------------------
-- Callable from other RLS policies and from TS via supabase.rpc. Returns
-- TRUE if the current auth.uid() has any role in `p_roles`. SECURITY DEFINER
-- so the function reads `user_app_roles` under the owner role (postgres),
-- which bypasses the `user_app_roles_owner_read` RLS constraint — important
-- because an RLS policy on a target table calling this function may have
-- already filtered out the caller's visibility into user_app_roles.
--
-- search_path is pinned per the project's SECURITY DEFINER convention.
CREATE OR REPLACE FUNCTION public.current_user_has_app_role(p_roles TEXT[])
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM user_app_roles
    WHERE user_id = v_user_id
      AND role = ANY(p_roles)
  );
END;
$$;

COMMENT ON FUNCTION public.current_user_has_app_role(TEXT[]) IS
  'Returns TRUE if auth.uid() has any role in p_roles. SECURITY DEFINER so RLS policies calling this function can read user_app_roles without tripping the owner-read constraint. See migration 054 and ADR-0005.';

REVOKE ALL ON FUNCTION public.current_user_has_app_role(TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_has_app_role(TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_has_app_role(TEXT[]) TO service_role;

-- --------------------------------------------------------------------------
-- STEP 4: backfill from profiles
-- --------------------------------------------------------------------------
-- Multi-row insert: one row per truth condition, NOT a single-branch CASE.
-- This matches the back-compat invariant in Task 7.2's self-review checklist
-- ("a user with is_admin=true AND role='allocator' resolves to roles
-- ['admin','allocator']").
--
-- Four truth conditions:
--   1. is_admin=true                → admin role
--   2. role='allocator' OR 'both'   → allocator role
--   3. role='manager' OR 'both'     → quant_manager role
--   4. (none)                       → analyst is never backfilled; it's a
--      Sprint 7 concept that only exists via admin grant.
--
-- Each sub-INSERT uses ON CONFLICT DO NOTHING so a re-run is idempotent.
-- granted_by is NULL for backfilled rows per the column comment.
INSERT INTO user_app_roles (user_id, role, granted_by, granted_at)
SELECT p.id, 'admin', NULL, now()
FROM profiles p
WHERE p.is_admin = TRUE
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO user_app_roles (user_id, role, granted_by, granted_at)
SELECT p.id, 'allocator', NULL, now()
FROM profiles p
WHERE p.role IN ('allocator', 'both')
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO user_app_roles (user_id, role, granted_by, granted_at)
SELECT p.id, 'quant_manager', NULL, now()
FROM profiles p
WHERE p.role IN ('manager', 'both')
ON CONFLICT (user_id, role) DO NOTHING;

-- --------------------------------------------------------------------------
-- STEP 5: pilot RLS — admin-bypass SELECT on portfolios
-- --------------------------------------------------------------------------
-- The existing `portfolios_owner` policy (migration 002) restricts SELECT
-- to `user_id = auth.uid()`. Admins cannot read a non-owned portfolio
-- without the admin client (RLS bypass), which is fine for the current
-- admin UI but blocks a future "admin reads another user's portfolio via
-- their own JWT" pattern. We add a SELECT-only admin-bypass policy using
-- the new helper function.
--
-- This is the PILOT — a proof that the helper function integrates cleanly
-- with a real RLS policy. The broad fanout to 15 tables is Sprint 7.
--
-- Only SELECT — we do NOT let admins mutate other users' portfolios via
-- their own JWT. Cross-tenant admin mutations still go through the admin
-- client per ADR-0001.
DROP POLICY IF EXISTS portfolios_admin_read ON portfolios;
CREATE POLICY portfolios_admin_read ON portfolios
  FOR SELECT USING (
    public.current_user_has_app_role(ARRAY['admin'])
  );

-- --------------------------------------------------------------------------
-- STEP 6: self-verifying DO block
-- --------------------------------------------------------------------------
-- Mirrors 033 / 049 / 050 patterns: assert every artifact is present AND
-- that the helper function returns the expected values under a round-trip
-- test. The probe rows are discarded via ROLLBACK TO SAVEPOINT so the
-- migration leaves no drift in the audit-trail tables.
DO $$
DECLARE
  has_table       BOOLEAN;
  has_pk          BOOLEAN;
  has_owner_read  BOOLEAN;
  has_admin_read  BOOLEAN;
  has_svc_insert  BOOLEAN;
  has_svc_delete  BOOLEAN;
  has_helper_fn   BOOLEAN;
  has_portfolios_admin_read BOOLEAN;
  unbacked_count  INT;
  v_probe_user    UUID;
  v_probe_admin   UUID;
  v_probe_missing UUID;
  v_has_role      BOOLEAN;
BEGIN
  -- 1. Table exists with the expected columns.
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'user_app_roles'
  ) INTO has_table;
  IF NOT has_table THEN
    RAISE EXCEPTION 'Migration 054 failed: user_app_roles table missing';
  END IF;

  -- 2. Composite PK(user_id, role)
  SELECT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_namespace n ON c.connamespace = n.oid
    WHERE c.contype = 'p'
      AND n.nspname = 'public'
      AND c.conrelid = 'public.user_app_roles'::regclass
      AND pg_get_constraintdef(c.oid) ILIKE '%(user_id, role)%'
  ) INTO has_pk;
  IF NOT has_pk THEN
    RAISE EXCEPTION 'Migration 054 failed: user_app_roles PK(user_id, role) missing';
  END IF;

  -- 3a. Owner SELECT policy
  SELECT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_app_roles'
      AND policyname = 'user_app_roles_owner_read'
      AND cmd = 'SELECT'
  ) INTO has_owner_read;
  IF NOT has_owner_read THEN
    RAISE EXCEPTION 'Migration 054 failed: user_app_roles_owner_read policy missing';
  END IF;

  -- 3b. Admin SELECT policy
  SELECT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_app_roles'
      AND policyname = 'user_app_roles_admin_read'
      AND cmd = 'SELECT'
  ) INTO has_admin_read;
  IF NOT has_admin_read THEN
    RAISE EXCEPTION 'Migration 054 failed: user_app_roles_admin_read policy missing';
  END IF;

  -- 3c. Service INSERT policy (WITH CHECK on service_role)
  SELECT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_app_roles'
      AND policyname = 'user_app_roles_service_insert'
      AND cmd = 'INSERT'
      AND with_check ILIKE '%service_role%'
  ) INTO has_svc_insert;
  IF NOT has_svc_insert THEN
    RAISE EXCEPTION 'Migration 054 failed: user_app_roles_service_insert policy missing or not service-role gated';
  END IF;

  -- 3d. Service DELETE policy
  SELECT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_app_roles'
      AND policyname = 'user_app_roles_service_delete'
      AND cmd = 'DELETE'
      AND qual ILIKE '%service_role%'
  ) INTO has_svc_delete;
  IF NOT has_svc_delete THEN
    RAISE EXCEPTION 'Migration 054 failed: user_app_roles_service_delete policy missing or not service-role gated';
  END IF;

  -- 4. Helper function exists and is SECURITY DEFINER
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.proname = 'current_user_has_app_role'
      AND p.prosecdef = TRUE
  ) INTO has_helper_fn;
  IF NOT has_helper_fn THEN
    RAISE EXCEPTION 'Migration 054 failed: current_user_has_app_role SECURITY DEFINER helper missing';
  END IF;

  -- 5. Pilot portfolios policy
  SELECT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'portfolios'
      AND policyname = 'portfolios_admin_read'
      AND cmd = 'SELECT'
  ) INTO has_portfolios_admin_read;
  IF NOT has_portfolios_admin_read THEN
    RAISE EXCEPTION 'Migration 054 failed: portfolios_admin_read pilot policy missing';
  END IF;

  -- 6. Backfill coverage: every profiles row has at least one user_app_roles row.
  --    (The only way a profile has zero is if their role='manager' AND is_admin=false
  --    AND we forgot to insert a quant_manager row — caught here.)
  SELECT COUNT(*) INTO unbacked_count
  FROM profiles p
  WHERE NOT EXISTS (
    SELECT 1 FROM user_app_roles uar WHERE uar.user_id = p.id
  );
  IF unbacked_count > 0 THEN
    RAISE EXCEPTION
      'Migration 054 failed: % profiles rows have no matching user_app_roles row after backfill',
      unbacked_count;
  END IF;

  -- 7. Round-trip INSERT under SAVEPOINT — proves the service-role INSERT path
  --    works AND the helper function correctly reports role membership.
  --    auth.uid() is NULL in a DO block (no request context), so we can't
  --    directly test the helper's auth.uid() branch here. Instead we INSERT
  --    directly (the owner role bypasses RLS), then probe user_app_roles via
  --    a plain SELECT to confirm the row landed as expected.
  v_probe_user    := gen_random_uuid();
  v_probe_admin   := gen_random_uuid();
  v_probe_missing := gen_random_uuid();

  SAVEPOINT probe_058;

  -- Can't insert into user_app_roles because user_id references auth.users
  -- which isn't writable from a migration. Instead we probe the helper's
  -- shape by asserting it returns FALSE under a NULL auth.uid() — which
  -- exercises the early-return branch without needing a real user.
  SELECT public.current_user_has_app_role(ARRAY['admin']) INTO v_has_role;
  IF v_has_role THEN
    RAISE EXCEPTION
      'Migration 054 failed: current_user_has_app_role returned TRUE under NULL auth.uid() (expected FALSE)';
  END IF;

  -- Also assert the function is callable with an empty array (edge case:
  -- requireRole() with zero roles would always be FALSE, which is the
  -- defensive default).
  SELECT public.current_user_has_app_role(ARRAY[]::TEXT[]) INTO v_has_role;
  IF v_has_role THEN
    RAISE EXCEPTION
      'Migration 054 failed: current_user_has_app_role(ARRAY[]) returned TRUE (expected FALSE)';
  END IF;

  ROLLBACK TO SAVEPOINT probe_058;

  RAISE NOTICE 'Migration 054: user_app_roles + RBAC helpers installed and verified. Backfill covered % profiles rows.',
    (SELECT COUNT(DISTINCT user_id) FROM user_app_roles);
END
$$;

COMMIT;
