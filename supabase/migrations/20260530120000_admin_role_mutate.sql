-- Migration: admin_role_mutate — the single atomic RBAC-mutation RPC (B4).
--
-- Cross-cutting refactor B4 (audit-2026-05-07): Atomic Admin RBAC RPC.
--
-- Why this migration exists
-- -------------------------
-- Correct admin-role mutation has to touch TWO stores atomically:
--   * profiles.is_admin            — the PRIMARY admin signal (migration 011),
--                                    the one the DB-side RLS policies reference.
--   * user_app_roles.role='admin'  — the additive join-table signal (migration
--                                    054), authoritative for the non-admin roles.
-- `isAdminUser` (src/lib/admin.ts) resolves admin = (is_admin = TRUE) OR (a
-- user_app_roles 'admin' row), and `withRole('admin')` delegates to it. The
-- last-admin lockout guard therefore has to count the **deduplicated UNION** of
-- both stores, and a revoke has to clear BOTH or it leaves a "ghost-admin"
-- (is_admin = TRUE with no row → still passes every gate).
--
-- Until now that entire contract lived inside ONE 1058-line hand-rolled route
-- (`src/app/api/admin/users/[id]/roles/route.ts`) across ~9 non-atomic
-- service-role round-trips guarded by a JS-side TOCTOU re-check. The
-- ghost-admin (NEW-C17-01) and double-counted-last-admin (H-02) bugs were
-- direct symptoms of that split being hand-maintained, and nothing structurally
-- stopped the next admin route from reintroducing the whole class.
--
-- What this RPC makes unrepresentable (closed by construction)
-- -----------------------------------------------------------
-- `admin_role_mutate(p_actor_id, p_target_id, p_role, p_action)` does the whole
-- mutation as one SECURITY DEFINER statement run under a per-target advisory
-- lock, inside a single transaction:
--   * dual-store write as one atomic unit          → no half-write → no ghost-admin
--   * dedup'd UNION last-admin count in the same txn → H-02 cannot recur
--   * pg_advisory_xact_lock on the target           → kills the JS TOCTOU window
--   * fresh actor authz (same union as isAdminUser) → demoted actor is rejected
--   * took-effect verify (post-mutation re-read)    → revoke_did_not_take is moot
-- The 660-line hand-rolled POST body collapses to ~40 lines that map SQLSTATEs
-- to HTTP and emit the (type-checked, TS-side) audit events. A future admin
-- route physically cannot mutate admin state any other way: EXECUTE is granted
-- to service_role only, and the lock/guard/atomicity live in the function.
--
-- Relationship to PR #357 (20260529150000_lock_profile_privileged_columns)
-- ------------------------------------------------------------------------
-- #357 hardened the WRITE-AUTHZ surface: it revoked client INSERT/UPDATE/DELETE
-- on profiles and added a SECURITY INVOKER trigger
-- (prevent_profile_privileged_change) that blocks any non-privileged caller from
-- writing is_admin/role/tenant_id/…. That trigger permits
-- current_user IN ('postgres','service_role','supabase_admin'). admin_role_mutate
-- is SECURITY DEFINER owned by postgres, so inside it current_user='postgres' →
-- the trigger lets its profiles.is_admin writes through. The two are
-- COMPLEMENTARY: #357 = "clients can't self-mutate privileges"; B4 = "admin
-- mutation is atomic + correct". Neither covers the other.
--
-- Reconciliation backfill
-- -----------------------
-- Before this RPC, a grant via the route inserted a user_app_roles row WITHOUT
-- flipping is_admin, so the two stores could drift. The backfill aligns EACH
-- store to the UNION (the set isAdminUser already treats as admin):
--   1. is_admin=TRUE  → ensure a user_app_roles 'admin' row  (closes ghost-admins)
--   2. user_app_roles 'admin' row → ensure is_admin=TRUE      (closes dead-flag drift)
-- Nobody gains or loses admin (the union is preserved); only the RLS-facing flag
-- is brought into line with the union. After this, the two stores agree, and the
-- RPC keeps them in lockstep on every future mutation.
--
-- Return contract (jsonb)
-- -----------------------
--   { outcome:          'granted' | 'revoked' | 'revoke_noop',
--     was_new_grant:    bool,    -- grant: did THIS call insert the row?
--     removed_rows:     int,     -- revoke: rows the DELETE removed
--     is_admin_changed: bool,    -- admin path: did the primary flag flip?
--     holds_role:       bool,    -- post-mutation: does target hold p_role?
--     took_effect:      bool,    -- grant→held / revoke→gone (false ⇒ caller 409s)
--     roles:            text[] } -- post-mutation user_app_roles set (matches the
--                                -- route's prior fetchUserRoles response shape)
--
-- SQLSTATE → HTTP map the route applies:
--   42501 insufficient_privilege  → 403 (actor-not-admin; hint=self_revoke_forbidden → self-revoke 403)
--   23514 check_violation         → 409 would_orphan_last_admin
--   P0002 no_data_found           → 404 user_not_found
--   22023 invalid_parameter_value → 400 (defensive; body is Zod-validated upstream)
--
-- The lint backstop ("no admin mutation outside this RPC", "no
-- createAdminClient+logAuditEvent co-occurrence") is deferred to B25.

BEGIN;
SET lock_timeout = '3s';

-- --------------------------------------------------------------------------
-- STEP 1: admin_role_mutate SECURITY DEFINER RPC
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_role_mutate(
  p_actor_id  UUID,
  p_target_id UUID,
  p_role      TEXT,
  p_action    TEXT
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_actor_is_admin   BOOLEAN;
  v_target_exists    BOOLEAN;
  v_role_is_admin    BOOLEAN := (p_role = 'admin');
  v_was_new_grant    BOOLEAN := FALSE;
  v_removed_rows     INT     := 0;
  v_was_is_admin     BOOLEAN := FALSE;
  v_is_admin_changed BOOLEAN := FALSE;
  v_surviving_admins INT;
  v_outcome          TEXT;
  v_holds_role       BOOLEAN;
  v_took_effect      BOOLEAN;
  v_roles            TEXT[];
BEGIN
  -- ── Parameter validation (22023 → 400; defensive — body is Zod-validated) ──
  IF p_actor_id IS NULL OR p_target_id IS NULL THEN
    RAISE EXCEPTION 'admin_role_mutate: p_actor_id and p_target_id are required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_action NOT IN ('grant', 'revoke') THEN
    RAISE EXCEPTION 'admin_role_mutate: p_action must be grant|revoke, got %', p_action
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- Keep this CHECK list in lockstep with user_app_roles.role (migration 054)
  -- and APP_ROLES (src/lib/auth.ts).
  IF p_role NOT IN ('admin', 'allocator', 'quant_manager', 'analyst') THEN
    RAISE EXCEPTION 'admin_role_mutate: p_role % is not a known app role', p_role
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ── Serialize every mutation on this target (closes the JS TOCTOU window).
  -- A xact-scoped advisory lock (auto-released at COMMIT/ROLLBACK) namespaced to
  -- this function so it never collides with another advisory-lock user. The
  -- last-admin count + the dual-store write below are now race-free against a
  -- concurrent grant/revoke on the same target. ──────────────────────────────
  PERFORM pg_advisory_xact_lock(hashtext('admin_role_mutate'), hashtext(p_target_id::text));

  -- ── Fresh actor authz — the SAME union isAdminUser uses (is_admin OR a
  -- user_app_roles 'admin' row). Re-checked inside the locked txn so an actor
  -- demoted after withRole('admin') ran is rejected here (defense-in-depth that
  -- also makes the JS fresh-client re-check redundant). ──────────────────────
  SELECT (
    EXISTS (SELECT 1 FROM profiles       WHERE id      = p_actor_id AND is_admin = TRUE)
    OR
    EXISTS (SELECT 1 FROM user_app_roles WHERE user_id = p_actor_id AND role    = 'admin')
  ) INTO v_actor_is_admin;
  IF NOT v_actor_is_admin THEN
    RAISE EXCEPTION 'admin_role_mutate: actor % is not an admin', p_actor_id
      USING ERRCODE = 'insufficient_privilege';  -- 42501 → 403
  END IF;

  -- ── Self-revoke of admin is forbidden — another admin must act. Matches the
  -- route's prior hard rail; hint lets the route pick the specific 403 message. ─
  IF p_action = 'revoke' AND v_role_is_admin AND p_actor_id = p_target_id THEN
    RAISE EXCEPTION 'admin_role_mutate: an admin cannot revoke their own admin role'
      USING ERRCODE = 'insufficient_privilege',  -- 42501 → 403
            HINT    = 'self_revoke_forbidden';
  END IF;

  -- ── Target must exist (mirror GET's 404 user_not_found contract). ──────────
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = p_target_id) INTO v_target_exists;
  IF NOT v_target_exists THEN
    RAISE EXCEPTION 'admin_role_mutate: target user % does not exist', p_target_id
      USING ERRCODE = 'no_data_found';  -- P0002 → 404
  END IF;

  -- Capture the primary-flag pre-state for the admin path (ghost-admin clear).
  IF v_role_is_admin THEN
    SELECT COALESCE(is_admin, FALSE) INTO v_was_is_admin FROM profiles WHERE id = p_target_id;
  END IF;

  IF p_action = 'grant' THEN
    -- Idempotent row insert. ROW_COUNT after ON CONFLICT DO NOTHING is 1 iff a
    -- row was actually inserted → that IS "was_new_grant" (no separate pre-read,
    -- and no TOCTOU on it — we hold the advisory lock).
    INSERT INTO user_app_roles (user_id, role, granted_by, granted_at)
    VALUES (p_target_id, p_role, p_actor_id, now())
    ON CONFLICT (user_id, role) DO NOTHING;
    GET DIAGNOSTICS v_removed_rows = ROW_COUNT;
    v_was_new_grant := (v_removed_rows = 1);

    -- Dual-store lockstep: an admin grant also asserts the primary flag, so a
    -- granted admin can never be a row-only admin. Non-admin grants leave
    -- is_admin alone (there is no profile flag for those roles).
    IF v_role_is_admin AND NOT v_was_is_admin THEN
      UPDATE profiles SET is_admin = TRUE WHERE id = p_target_id;
      v_is_admin_changed := TRUE;
    END IF;

    v_outcome := 'granted';

  ELSE  -- p_action = 'revoke'
    IF v_role_is_admin THEN
      -- Last-admin guard: count the DEDUP'd UNION of surviving admins across
      -- BOTH stores, excluding the target. UNION (not two summed counts) so a
      -- single survivor holding both signals counts once — the exact H-02 bug.
      SELECT COUNT(*) INTO v_surviving_admins FROM (
        SELECT id      AS uid FROM profiles       WHERE is_admin = TRUE  AND id      <> p_target_id
        UNION
        SELECT user_id AS uid FROM user_app_roles WHERE role     = 'admin' AND user_id <> p_target_id
      ) survivors;
      IF v_surviving_admins = 0 THEN
        RAISE EXCEPTION 'admin_role_mutate: refusing to revoke the last admin account'
          USING ERRCODE = 'check_violation',  -- 23514 → 409
                HINT    = 'would_orphan_last_admin';
      END IF;
    END IF;

    DELETE FROM user_app_roles WHERE user_id = p_target_id AND role = p_role;
    GET DIAGNOSTICS v_removed_rows = ROW_COUNT;

    -- Admin revoke also clears the primary flag — so a ghost-admin (is_admin
    -- TRUE, no row) is fully demoted even though the DELETE removed 0 rows.
    IF v_role_is_admin AND v_was_is_admin THEN
      UPDATE profiles SET is_admin = FALSE WHERE id = p_target_id;
      v_is_admin_changed := TRUE;
    END IF;

    -- No-op ⇔ nothing changed in EITHER store. For admin, clearing is_admin
    -- counts as a real revoke even with 0 rows removed.
    IF v_removed_rows = 0 AND NOT v_is_admin_changed THEN
      v_outcome := 'revoke_noop';  -- → 404 role_not_held (caller does NOT emit role.revoke)
    ELSE
      v_outcome := 'revoked';
    END IF;
  END IF;

  -- ── Took-effect verify: re-read inside the same txn (post-mutation reality). ─
  SELECT EXISTS (
    SELECT 1 FROM user_app_roles WHERE user_id = p_target_id AND role = p_role
  ) INTO v_holds_role;
  -- For admin the held-state must also reflect the primary flag.
  IF v_role_is_admin THEN
    v_holds_role := v_holds_role OR EXISTS (
      SELECT 1 FROM profiles WHERE id = p_target_id AND is_admin = TRUE
    );
  END IF;

  IF p_action = 'grant' THEN
    v_took_effect := v_holds_role;        -- after a grant the role should be held
  ELSIF v_outcome = 'revoked' THEN
    v_took_effect := NOT v_holds_role;    -- after a revoke the role should be gone
  ELSE
    v_took_effect := TRUE;                -- revoke_noop: nothing to take effect
  END IF;

  -- Post-mutation full role set — same shape the route's fetchUserRoles returned
  -- (user_app_roles only; the CHECK constraint already bounds role to AppRole).
  SELECT COALESCE(array_agg(role ORDER BY role), ARRAY[]::TEXT[])
    INTO v_roles
  FROM user_app_roles WHERE user_id = p_target_id;

  RETURN jsonb_build_object(
    'outcome',          v_outcome,
    'was_new_grant',    v_was_new_grant,
    'removed_rows',     v_removed_rows,
    'is_admin_changed', v_is_admin_changed,
    'holds_role',       v_holds_role,
    'took_effect',      v_took_effect,
    'roles',            to_jsonb(v_roles)
  );
END;
$$;

COMMENT ON FUNCTION public.admin_role_mutate(UUID, UUID, TEXT, TEXT) IS
  'Atomic admin RBAC mutation (B4). SECURITY DEFINER, service_role-only EXECUTE. '
  'Does the dual-store (profiles.is_admin + user_app_roles) write under a per-target '
  'pg_advisory_xact_lock with fresh actor authz, dedup-UNION last-admin guard, and '
  'took-effect verify — all in one transaction. Returns jsonb (see migration header). '
  'The ONLY sanctioned admin-mutation path; a future admin route must call this.';

REVOKE ALL ON FUNCTION public.admin_role_mutate(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_role_mutate(UUID, UUID, TEXT, TEXT) TO service_role;

-- --------------------------------------------------------------------------
-- STEP 2: reconciliation backfill — align each store to the admin UNION
-- --------------------------------------------------------------------------
-- Runs as the migration owner (postgres), so the prevent_profile_privileged_change
-- trigger (#357, SECURITY INVOKER) permits the is_admin writes. Both directions
-- only EXPAND a store toward the union — nobody's admin status changes.

-- Direction 1: ghost-admins (is_admin=TRUE, no row) → ensure the row.
INSERT INTO user_app_roles (user_id, role, granted_by, granted_at)
SELECT p.id, 'admin', NULL, now()
FROM profiles p
WHERE p.is_admin = TRUE
ON CONFLICT (user_id, role) DO NOTHING;

-- Direction 2: row-only admins (user_app_roles 'admin', is_admin not TRUE) →
-- bring the primary flag into line (these users are already admin via the
-- additive signal; this just makes the RLS-facing flag reflect it).
UPDATE profiles p
SET is_admin = TRUE
FROM user_app_roles uar
WHERE uar.user_id = p.id
  AND uar.role = 'admin'
  AND p.is_admin IS DISTINCT FROM TRUE;

-- --------------------------------------------------------------------------
-- STEP 3: self-verifying DO block
-- --------------------------------------------------------------------------
DO $$
DECLARE
  has_fn          BOOLEAN;
  authed_can_exec BOOLEAN;
  anon_can_exec   BOOLEAN;
  svc_can_exec    BOOLEAN;
  drift_count     INT;
BEGIN
  -- 1. Function exists, is SECURITY DEFINER, returns jsonb.
  SELECT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.proname = 'admin_role_mutate'
      AND p.prosecdef = TRUE
      AND pg_get_function_result(p.oid) = 'jsonb'
  ) INTO has_fn;
  IF NOT has_fn THEN
    RAISE EXCEPTION 'B4 migration failed: admin_role_mutate SECURITY DEFINER jsonb function missing';
  END IF;

  -- 2. EXECUTE granted to service_role only — never anon/authenticated/PUBLIC.
  SELECT has_function_privilege('authenticated',
    'public.admin_role_mutate(uuid,uuid,text,text)', 'EXECUTE') INTO authed_can_exec;
  SELECT has_function_privilege('anon',
    'public.admin_role_mutate(uuid,uuid,text,text)', 'EXECUTE') INTO anon_can_exec;
  SELECT has_function_privilege('service_role',
    'public.admin_role_mutate(uuid,uuid,text,text)', 'EXECUTE') INTO svc_can_exec;
  IF authed_can_exec THEN
    RAISE EXCEPTION 'B4 migration failed: admin_role_mutate still EXECUTEable by authenticated';
  END IF;
  IF anon_can_exec THEN
    RAISE EXCEPTION 'B4 migration failed: admin_role_mutate still EXECUTEable by anon';
  END IF;
  IF NOT svc_can_exec THEN
    RAISE EXCEPTION 'B4 migration failed: admin_role_mutate EXECUTE not granted to service_role';
  END IF;

  -- 3. Zero admin-store drift after reconciliation: the is_admin set and the
  --    user_app_roles 'admin' set must now be identical (symmetric difference 0).
  SELECT COUNT(*) INTO drift_count FROM (
    (SELECT id FROM profiles WHERE is_admin = TRUE
     EXCEPT
     SELECT user_id FROM user_app_roles WHERE role = 'admin')
    UNION ALL
    (SELECT user_id FROM user_app_roles WHERE role = 'admin'
     EXCEPT
     SELECT id FROM profiles WHERE is_admin = TRUE)
  ) d;
  IF drift_count > 0 THEN
    RAISE EXCEPTION 'B4 migration failed: % admin-store drift rows remain after reconciliation', drift_count;
  END IF;

  RAISE NOTICE 'B4 migration: admin_role_mutate installed + verified; admin stores reconciled (0 drift).';
END
$$;

COMMIT;
