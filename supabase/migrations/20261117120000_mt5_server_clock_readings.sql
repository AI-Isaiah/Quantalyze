-- ============================================================================
-- mt5_server_clock_readings: the place every live MT5 server-clock reading is
-- kept, once, so the readings can show per key whether the broker clock matches
-- the configured rule and whether two keys share one server
-- (2026-11-17, Phase 155.1 SERVERCLOCK, plan 01; MT5-06, D-13, D-15, D-16)
-- ============================================================================
--
-- What this is for
-- ----------------
-- Inside every leased MT5 derive the worker takes one live server-clock reading: the
-- newest tick time across the terminal's visible Market Watch symbols, minus the
-- worker's UTC now, rounded to 900 seconds. It assesses that against the configured
-- clock (MT5_SERVER_TIME_RULE stays the only carrier, D-12) and persists the reading
-- here, for EVERY verdict, before it decides anything. A mismatch then refuses the
-- derive (D-01); an unmeasured reading (no fresh tick, a residual past the bound, an
-- unassertable repeated or skipped hour) is kept with its reason and refuses nothing
-- (D-10). THIS migration is the storage half only: one table, its value rules, its
-- access rule. Nothing writes to it until the analytics worker of this phase deploys,
-- and nothing is backfilled.
--
--   public.mt5_server_clock_readings   one row per live reading: which key, which job,
--                                      when, under which configured rule, the verdict
--                                      and its reason, the offsets and the residual, the
--                                      symbol counts, and a hash of the server label.
--
-- Decisions inside D-13..D-16 (the planner's call, plan 01)
--   SC-1  PER KEY. The readings are what criterion 4 compares per key (do MM2, MM3 and
--         FX-AI_V share one server), and a hard key delete or an account erasure removes
--         them through the foreign key's ON DELETE CASCADE. A soft disconnect keeps them
--         (keep data: disconnect, never delete).
--   SC-2  job_id carries NO foreign key. compute_jobs rows expire, and a reading must
--         outlive the job that took it.
--   SC-3  server_label_hash stores an UNSALTED SHA-256 of the normalised account server,
--         never the name (D-17). It is for per-key equality only and is never printed.
--   SC-4  Every value rule is a NAMED constraint, and the verdict, reason and rule sets
--         are the closed sets of services/mt5_server_clock.py and
--         services/mt5_server_clock_reading.py. A parity test in the analytics suite
--         reads this file and fails when either side drifts.
--   SC-5  newest_tick_age_s is expected minus raw: the tick's age PLUS any offset error.
--         In a mismatch row the two cannot be told apart, and the column says so.
--   SC-6  The rollback renames the table aside and keeps every row (the keep-data rule).
--         It is supabase/migrations/down/20261117120000-rollback.sql. The refusing trigger
--         below and the SQL gate supabase/tests/test_mt5_server_clock_readings.sql land
--         with it (plan 04 of this phase).
--   SC-7  measured_offset_s and expected_offset_s are BIGINT, not INTEGER. A tick time is
--         a wall-clock instant the broker sent, and D-19 forbids a plausibility bound, so
--         an absurd tick (about 68 years off the worker's now, or more) must still be
--         STORED as evidence rather than overflow a 32-bit column and fail the insert
--         on every retry of the derive.
--
-- ⛔ SERVICE-ROLE ONLY, ON PURPOSE. Nothing in the browser reads these rows (D-03, D-15),
-- so there is no owner policy and no user-owner column. service_role has BYPASSRLS, so
-- neither enabling nor forcing row level security can bound the worker (ADR-0001 /
-- ADR-0003). The control is the table privilege: row level security is enabled and
-- forced with ZERO policies, anon and authenticated hold no privilege at all, and
-- service_role holds SELECT and INSERT and nothing else.
--
-- ⛔ WRITE-ONCE IS A GRANT. Because a policy cannot gate service_role, the way to make a
-- reading immutable for the worker is to withdraw UPDATE, DELETE and TRUNCATE from it
-- (the api_key_flow_prices and api_key_nav_marks precedent).
--
-- ⛔ WRITE-ONCE IS ALSO A TRIGGER (D-14, D-20(c)). A grant does not bind the table owner
-- or any other BYPASSRLS role, so STEP 4 adds a BEFORE UPDATE OR DELETE row trigger that
-- refuses every UPDATE and every DIRECT DELETE whoever issues it. It lets the api_keys
-- foreign key cascade through, so a key delete, delete_allocator_api_key and an auth
-- user delete still erase the readings (the erasure path above). The cascade deletes its
-- child rows from inside the foreign key's own internal trigger, so the refusing trigger
-- runs NESTED there, while a direct DELETE runs it at the top level. The function tells
-- the two apart by the trigger depth and nothing else. A soft disconnect only sets
-- api_keys.disconnected_at, touches no reading row, and so needs no rule at all.
-- TRUNCATE is not a row event and is bound by the grant alone.
--
-- ⛔ NO DATA CENSUS RUNS INSIDE THIS MIGRATION. Shared TEST holds PROD's catalogue and
-- none of its data, and a failed TEST apply blocks the PROD apply, so the verify block
-- below reads the catalogue only (to_regclass). It reads no table row.
--
-- ⛔ DEPLOY ORDER IS NOT ENFORCED. This file applies to TEST and then to PROD on merge
-- through Supabase Migrate, while Railway deploys the worker on green CI in a separate
-- path, so either can land first. An old worker never touches the table. A new worker
-- that finds it absent gets a database error on its insert, which ends the derive FAILED
-- transient and heals once this migration lands: the readings are the evidence the
-- phase needs, so the insert is never tolerated as a skip.
--
-- Transaction style: NO explicit transaction statements (migration-reviewer
-- invariant 14; Supabase wraps each migration). SET LOCAL lock_timeout applies to
-- that wrap.
--
-- One new function is created (the trigger function) and none is replaced: no existing
-- object is touched, so the re-base rule for a replaced definition is met vacuously. delete_allocator_api_key needs no edit because
-- the cascade follows the key.
--
-- Rollback (manual, off the auto-apply path; it KEEPS every stored row):
-- supabase/migrations/down/20261117120000-rollback.sql.
-- ============================================================================

SET LOCAL lock_timeout = '3s';

-- --------------------------------------------------------------------------
-- STEP 1 - the table: one row per live reading. Every value rule is a NAMED
-- constraint so the SQL gate can say which one a refusal came from.
-- --------------------------------------------------------------------------
CREATE TABLE public.mt5_server_clock_readings (
  id                  BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  api_key_id          UUID        NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
  job_id              UUID,
  read_at             TIMESTAMPTZ NOT NULL,
  configured_rule     TEXT        NOT NULL,
  verdict             TEXT        NOT NULL,
  reason              TEXT,
  newest_tick_wall_ms BIGINT,
  raw_offset_s        NUMERIC,
  measured_offset_s   BIGINT,
  expected_offset_s   BIGINT,
  residual_s          NUMERIC,
  newest_tick_age_s   NUMERIC,
  symbols_visible     INTEGER,
  symbols_answered    INTEGER,
  server_label_hash   TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mt5_server_clock_readings_rule_chk
    CHECK (configured_rule IN ('eu', 'us', 'fixed')),
  CONSTRAINT mt5_server_clock_readings_verdict_chk
    CHECK (verdict IN ('match', 'mismatch', 'unmeasured')),
  CONSTRAINT mt5_server_clock_readings_reason_chk
    CHECK (reason IS NULL OR reason IN (
      'no_tick', 'tick_read_failed', 'residual_over_bound',
      'tick_time_out_of_range', 'expected_unassertable')),
  CONSTRAINT mt5_server_clock_readings_reason_verdict_chk
    CHECK ((verdict = 'unmeasured') = (reason IS NOT NULL)),
  CONSTRAINT mt5_server_clock_readings_offsets_chk
    CHECK (verdict = 'unmeasured'
           OR (measured_offset_s IS NOT NULL
               AND expected_offset_s IS NOT NULL
               AND ((verdict = 'match') = (measured_offset_s = expected_offset_s)))),
  CONSTRAINT mt5_server_clock_readings_hash_chk
    CHECK (server_label_hash IS NULL OR server_label_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT mt5_server_clock_readings_counts_chk
    CHECK ((symbols_visible IS NULL OR symbols_visible >= 0)
           AND (symbols_answered IS NULL OR symbols_answered >= 0))
);

CREATE INDEX mt5_server_clock_readings_key_read_at_idx
  ON public.mt5_server_clock_readings (api_key_id, read_at);

COMMENT ON TABLE public.mt5_server_clock_readings IS
  'Phase 155.1 SERVERCLOCK (MT5-06, D-13..D-17). One row per live MT5 server-clock reading taken inside a leased derive: the newest tick time across the visible Market Watch symbols minus the worker''s UTC now, rounded to 900 s, assessed against the configured clock rule. Inserted for every verdict (match, mismatch, unmeasured) before the derive decides anything; only a mismatch refuses the derive. WRITE-ONCE: service_role holds SELECT and INSERT only (no UPDATE, DELETE or TRUNCATE), and a BEFORE UPDATE OR DELETE trigger refuses every UPDATE and direct DELETE from any role while the api_keys cascade still erases. SERVICE-ROLE ONLY by design: row level security is enabled and forced with no policy, anon and authenticated hold no privilege, and no UI reads the rows. Per key: erased with the key and with the account through ON DELETE CASCADE, kept on a soft disconnect. Carries a hash of the account server label, never the name.';

COMMENT ON COLUMN public.mt5_server_clock_readings.api_key_id IS
  'The API key whose derive took the reading. ON DELETE CASCADE from api_keys (and from auth.users through profiles) IS the erasure path: a hard key delete or an account erasure removes the readings, while a soft disconnect keeps them. Any delete guard added later MUST let that cascade through.';

COMMENT ON COLUMN public.mt5_server_clock_readings.job_id IS
  'The compute_jobs row of the derive that took the reading. NO foreign key on purpose: compute_jobs rows expire and a reading outlives them.';

COMMENT ON COLUMN public.mt5_server_clock_readings.read_at IS
  'The worker''s UTC now, taken right after the tick-time crossing returned: the instant the offset was measured against.';

COMMENT ON COLUMN public.mt5_server_clock_readings.configured_rule IS
  'The configured clock the reading was assessed against: eu, us, or fixed (the fixed-offset form). MT5_SERVER_TIME_RULE stays the only carrier of the rule; the reading is never written back as configuration (D-12).';

COMMENT ON COLUMN public.mt5_server_clock_readings.reason IS
  'Why an unmeasured reading was not asserted: no_tick, tick_read_failed, residual_over_bound, tick_time_out_of_range or expected_unassertable. NULL exactly when the verdict is match or mismatch.';

COMMENT ON COLUMN public.mt5_server_clock_readings.newest_tick_wall_ms IS
  'The newest tick''s time_msc across the visible Market Watch symbols: the broker wall clock encoded as if it were UTC (the deal time encoding). NULL when no visible symbol answered or the tick read failed.';

COMMENT ON COLUMN public.mt5_server_clock_readings.raw_offset_s IS
  'The unrounded measured offset in seconds: newest tick wall time minus the worker UTC now.';

COMMENT ON COLUMN public.mt5_server_clock_readings.measured_offset_s IS
  'raw_offset_s rounded to the nearest 900 s.';

COMMENT ON COLUMN public.mt5_server_clock_readings.expected_offset_s IS
  'The configured clock''s offset at the newest tick''s wall instant. NULL in a repeated or skipped broker hour (unassertable, never a mismatch).';

COMMENT ON COLUMN public.mt5_server_clock_readings.residual_s IS
  'The rounding residual, measured_offset_s minus raw_offset_s. A residual past 5 s makes the reading unmeasured.';

COMMENT ON COLUMN public.mt5_server_clock_readings.newest_tick_age_s IS
  'expected_offset_s minus raw_offset_s: the newest tick''s age PLUS any offset error. In a mismatch row the two cannot be told apart.';

COMMENT ON COLUMN public.mt5_server_clock_readings.symbols_visible IS
  'How many visible Market Watch symbols a tick was asked of.';

COMMENT ON COLUMN public.mt5_server_clock_readings.symbols_answered IS
  'How many of those symbols returned a tick.';

COMMENT ON COLUMN public.mt5_server_clock_readings.server_label_hash IS
  'Unsalted SHA-256 hex of the normalised account server label (D-17). Equality-only: it shows per key whether two accounts share one server and is never printed or logged. NULL when the account carried no server.';

-- --------------------------------------------------------------------------
-- STEP 2 - row level security. Enabled and forced, and NO policy, ON PURPOSE: no role
-- but service_role (which bypasses RLS by attribute) may touch these rows, so the empty
-- policy set is the statement, and the grants in STEP 3 are the control.
-- --------------------------------------------------------------------------
ALTER TABLE public.mt5_server_clock_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mt5_server_clock_readings FORCE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------------
-- STEP 3 - grants. REVOKE everything first so the result does not depend on the
-- project's default privileges, then grant exactly what the worker needs, in one
-- statement.
-- --------------------------------------------------------------------------
REVOKE ALL ON TABLE public.mt5_server_clock_readings FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.mt5_server_clock_readings TO service_role;

-- --------------------------------------------------------------------------
-- STEP 4 - the refusing trigger (D-14, D-20(c)). service_role holds no UPDATE or DELETE
-- by grant (STEP 3), but a grant does not bind the table owner or a BYPASSRLS role, so
-- this row trigger refuses every UPDATE, and every DELETE that is not part of the
-- api_keys foreign key cascade, from ANY role.
--
-- Why the trigger depth is the test. The foreign key's ON DELETE CASCADE deletes the
-- child rows from inside the foreign key's internal trigger on api_keys, so when this
-- trigger fires for a cascaded row it is already one level deep (depth 2 or more),
-- through delete_allocator_api_key, the account sanitize path and an auth user delete
-- alike. A DELETE statement a role issues against this table directly fires it at the
-- top level (depth 1). Admitting a depth greater than one therefore admits exactly the
-- cascades.
--
-- Why quantalyze.sanitize_in_progress is NOT used here. api_keys' own delete guard
-- exempts that setting, but only the sanitize path sets it. Keyed on it alone, this
-- trigger would still refuse the cascade from delete_allocator_api_key (a user deleting
-- their own key, no sanitize in flight), and the depth rule already admits every
-- cascade, sanitize included. One rule, and no setting a caller could also set to
-- unlock a direct delete.
--
-- SECURITY INVOKER with a pinned search_path: the function reads no table, so it needs no
-- definer rights (the strategy_shares trigger precedent). Each raise is a check_violation
-- (23514) carrying a single literal message, so no row value is ever echoed.
-- --------------------------------------------------------------------------
CREATE FUNCTION public.enforce_mt5_server_clock_readings_write_once()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = public, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'mt5_server_clock_readings is write-once: a stored reading is never updated'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() > 1 THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'mt5_server_clock_readings is write-once: a stored reading is never deleted directly, only with its key'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.enforce_mt5_server_clock_readings_write_once() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER mt5_server_clock_readings_write_once
  BEFORE UPDATE OR DELETE ON public.mt5_server_clock_readings
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_mt5_server_clock_readings_write_once();

COMMENT ON FUNCTION public.enforce_mt5_server_clock_readings_write_once() IS
  'Phase 155.1 SERVERCLOCK (D-14, D-20(c)). Refuses every UPDATE and every direct DELETE of a stored server-clock reading from any role, the table owner and BYPASSRLS roles included. Admits a DELETE only when it runs nested inside the api_keys foreign key cascade (trigger depth greater than one), so a key delete, delete_allocator_api_key and an account erasure still erase the readings. SECURITY INVOKER: it reads no table.';

-- ───────────── self-verify: CATALOGUE ONLY, passes on an empty database.
-- No row is read. Asserted: the table, the trigger function and the trigger resolve by
-- name. Deliberately NOT asserted here: the grants, the row-level security flags, the
-- policies, the foreign key's delete action, the CHECK bodies and the trigger body. A verify
-- block that checked them would abort the apply of a mutated copy of this file, and
-- the SQL gate that mutates those lines needs that apply to succeed in order to go RED
-- on the behaviour instead.
DO $verify$
BEGIN
  IF to_regclass('public.mt5_server_clock_readings') IS NULL THEN
    RAISE EXCEPTION 'Migration 20261117120000 failed: public.mt5_server_clock_readings is missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                   JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public'
                    AND p.proname = 'enforce_mt5_server_clock_readings_write_once') THEN
    RAISE EXCEPTION 'Migration 20261117120000 failed: public.enforce_mt5_server_clock_readings_write_once() is missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname = 'mt5_server_clock_readings_write_once'
                    AND tgrelid = 'public.mt5_server_clock_readings'::regclass
                    AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'Migration 20261117120000 failed: trigger mt5_server_clock_readings_write_once is missing on public.mt5_server_clock_readings';
  END IF;

  RAISE NOTICE 'Migration 20261117120000: public.mt5_server_clock_readings and its write-once trigger exist.';
END
$verify$;
