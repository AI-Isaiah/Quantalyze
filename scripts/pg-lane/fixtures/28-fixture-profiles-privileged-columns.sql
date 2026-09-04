-- Additive stand-ins for the five `profiles` columns that migration
-- 20260529150000_lock_profile_privileged_columns.sql NAMES but that no fixture
-- in front of it supplies: 01-fixture-core.sql gives profiles four columns,
-- 02-fixture-sanitize-tables.sql adds the ten sanitize_user writes, and
-- 12-fixture-profiles-is-admin.sql adds `is_admin`.
--
-- ⛔ WHY THEY ARE NOT OPTIONAL. That migration's §1b re-GRANTs UPDATE on an
-- EXPLICIT column allowlist and its §2 trigger tests an explicit privileged set.
-- A column-list GRANT names the columns by identifier, so a missing one is a
-- hard `42703 column "created_at" of relation "profiles" does not exist` at
-- apply time (MEASURED 2026-09-04) — the migration cannot be the object under
-- test on a table that does not carry its vocabulary.
--
-- Types are production's:
--   created_at             20260405061911_initial_schema.sql:15
--   manager_status         :13   allocator_status  :14
--   preferences_updated_at 20260407164606_perfect_match.sql:20
--   tenant_id              20260408113028_disclosure_and_tenancy.sql:94
-- The two *_status CHECK constraints are reproduced because the privileged-write
-- arms in `test_profiles_privileged_columns_locked.sql` write 'verified' to
-- them, and a stand-in that admitted any string would let one of those writes be
-- refused (or accepted) for a reason the real column would not.
--
-- Apply AFTER 02-fixture-sanitize-tables.sql. Never a second base:
-- 01-fixture-core.sql remains the only destructive fixture.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS preferences_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tenant_id              UUID,
  ADD COLUMN IF NOT EXISTS manager_status         TEXT NOT NULL DEFAULT 'newbie',
  ADD COLUMN IF NOT EXISTS allocator_status       TEXT NOT NULL DEFAULT 'newbie';

DO $fixture$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.profiles'::regclass
                    AND conname  = 'profiles_manager_status_check') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_manager_status_check
      CHECK (manager_status IN ('newbie', 'pending', 'verified'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.profiles'::regclass
                    AND conname  = 'profiles_allocator_status_check') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_allocator_status_check
      CHECK (allocator_status IN ('newbie', 'pending', 'verified'));
  END IF;
END
$fixture$;
