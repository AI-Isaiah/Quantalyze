-- ============================================================================
-- Lock api_keys against client UPDATE — `exchange` is not user-writable data
-- (2026-08-10, Phase 153.2 code review CR-01)
-- ============================================================================
--
-- Background — a security control the beneficiary could switch off
-- ----------------------------------------------------------------
-- `/api/strategies/finalize-wizard` runs the ASVS V4 scope-broadening probe on
-- every submit: it re-reads the connected key's LIVE permissions so a key that
-- was read-only at Connect and broadened to trade/withdraw before Submit is
-- caught. Phase 153.2-04 correctly made that probe branch on a per-venue
-- CAPABILITY (`venueSupportsScopeProbe`) rather than a venue name, because one
-- venue exposes no per-key scope endpoint at all and the probe there was a
-- permanent failure dressed as a network blip.
--
-- The capability lookup's INPUT, however, is `api_keys.exchange` — and that
-- column was writable by the row's own owner:
--
--   * 20260405061912_rls_policies.sql:22 —
--     `CREATE POLICY api_keys_owner ON api_keys FOR ALL USING (user_id = auth.uid())`.
--     `FOR ALL` includes UPDATE, and the policy constrains the ROW, not the
--     COLUMNS.
--   * 20260410225608_api_keys_column_revoke.sql (migration 027) revoked and
--     re-granted SELECT only. The table's inherited Supabase default
--     `GRANT ALL ON TABLE api_keys TO anon, authenticated` therefore still left
--     UPDATE in place. No `REVOKE UPDATE ON api_keys` existed anywhere in
--     supabase/migrations/, and no BEFORE UPDATE trigger existed on the table.
--   * 20260723172032_mt5_exchange_boundary_checks.sql widened
--     `api_keys_exchange_check` to ADMIT the probe-exempt venue, so the forged
--     value is a legal value of the constraint in production today.
--
-- Impact, in one sentence: a key's own owner could rewrite this column from
-- their browser session to a probe-exempt value, causing the submit-time
-- scope-broadening check to be skipped for a key it should have examined — so a
-- strategy could reach `pending_review` under a read-only-verified claim that
-- was false. Row CREATION was never the hole: /api/keys/validate-and-encrypt
-- refuses to mint ciphertext for a key it cannot confirm read-only. The
-- REWRITE was the hole, and rewriting needs UPDATE.
--
-- (The reproduction steps are deliberately not recorded in this public repo.
-- They are in the private session log for 2026-08-10 and may be restored here
-- once every deployed environment has this migration applied.)
--
-- The same rewrite also flips the `asset_class` annualization stamp
-- (√365 crypto vs √252 traditional) that finalize-wizard derives from this
-- column — a money-math boundary this repo pins elsewhere as one.
--
-- What changes
-- ------------
--   1. PRIMARY GATE — `REVOKE UPDATE ON api_keys FROM anon, authenticated`,
--      with NO re-grant. A bare column-level `REVOKE UPDATE (exchange)` is a
--      documented NO-OP against an existing table-level grant (the trap that
--      made migrations 012 and 017 silent no-ops, and the reason migrations 020,
--      027 and 20260529150000 all use REVOKE-then-GRANT-allowlist instead).
--
--      Why NO re-grant, unlike the profiles precedent: an audit of every
--      `from("api_keys")` call site in src/**, analytics-service/**, scripts/**
--      and e2e/** (2026-08-10) found ZERO user-scoped UPDATEs. The user-scoped
--      client only SELECTs (queries.ts, ApiKeyManager, AllocatorExchangeManager,
--      SyncProgress, SyncPreviewStep), INSERTs (ApiKeyManager, StrategyForm,
--      AllocatorExchangeManager) and DELETEs (ApiKeyManager). Every UPDATE in
--      the tree is either the Python analytics worker on the service-role client
--      (sync_status / last_sync_at / sync_error / cursors) or a SECURITY DEFINER
--      RPC that runs as the table owner and is therefore unaffected by grants:
--        - disconnect_allocator_api_key / reconnect_allocator_api_key (mig 075)
--        - advance_sync_cursor (20260602173710)
--        - the circuit-breaker clock RPCs (20260529170100)
--        - the compute-jobs queue RPCs (20260411144407 and successors)
--      There is no allowlist to grant back, so granting one would be
--      speculative surface. INSERT and DELETE are deliberately UNTOUCHED — both
--      are live client paths (connect a key / delete a key).
--
--   2. DEFENSE-IN-DEPTH — a SECURITY INVOKER `BEFORE UPDATE OF exchange`
--      trigger. SECURITY INVOKER is load-bearing: under SECURITY DEFINER,
--      `current_user` would be this function's owner and the privileged-caller
--      check would always pass — the exact bug that made
--      prevent_profile_role_change a no-op (see 20260529150000's header). It
--      backstops a future re-grant of table or column UPDATE, and it is the
--      signal the companion test keys on.
--
-- Residual, deliberately NOT closed here — CORRECTED 2026-08-11 (Phase 153.6 / D-04)
-- ----------------------------------------------------------------------------------
-- ⚠️ DOCUMENTARY CORRECTION ONLY. This file was applied to production on
-- 2026-08-10. Nothing below this line changes any SQL statement, and editing an
-- already-applied migration's COMMENTS has ZERO effect on any database. What is
-- corrected is the threat model this header stated — the original residual
-- argument rested on a claim that is FALSE, and a security migration whose
-- stated threat model is wrong is worse than one that says nothing.
--
-- ⛔ THE CLAIM THAT WAS WRONG. The original text argued that once client UPDATE
-- was gone a mislabelled row could no longer be restored to its true venue, so
-- the strategy's sync would fail permanently and no credible listing could
-- result — i.e. that a forged `exchange` was SELF-DEFEATING. It was not. (The
-- sentence is PARAPHRASED here rather than quoted, deliberately: leaving the
-- original wording in the file, even underneath a refutation, leaves the
-- falsehood greppable and quotable out of its own context.)
--
-- This migration touches UPDATE only: item 1's
-- own note and the self-verify at line 181 both say INSERT and DELETE are left
-- alone ON PURPOSE, because both are live client paths. So the forger never
-- needed to correct the row back. They could DELETE it and re-INSERT it with
-- whatever `exchange` they liked — the round trip, not the in-place rewrite.
-- 20260723172032 had already widened api_keys_exchange_check to ADMIT the
-- probe-exempt venue, so the forged value was a legal value of the constraint.
-- The route trip was therefore LIVE from this migration until 20260811210000,
-- which is why that migration exists.
--
-- THE CORRECTED RESIDUAL. `exchange` is still CLIENT-SUPPLIED at row creation on
-- the two non-wizard INSERT paths (ApiKeyManager.tsx:254, StrategyForm.tsx:140):
-- the browser calls /api/keys/validate-and-encrypt and then performs the
-- api_keys INSERT itself, so a crafted client can insert a venue that differs
-- from the one the server actually validated. What that buys the forger is a
-- SELF-TARGETED CONTROL BYPASS — mislabelling their OWN key to dodge the
-- submit-time scope-broadening probe on their OWN key. It is not a tenant leak
-- and not a data breach; what is lost is the assurance that a key read-only at
-- Connect had not been broadened to trade before Submit. Real for a product
-- selling verified performance; not a 3am page.
--
-- ✅ CLOSED ELSEWHERE, NOT HERE. 20260811210000_api_keys_attested_venue.sql
-- closes the bypass by removing this column's authority instead of removing the
-- client's ability to write it: the probe gate now reads
-- `api_keys.attested_venue`, which only the two SECURITY DEFINER wizard RPCs can
-- write and which a BEFORE INSERT trigger NULLs on every client INSERT. A
-- mislabelled `exchange` is now a cosmetic lie rather than a control bypass.
-- Moving the api_keys INSERT server-side remains the fuller fix and remains a
-- connect-flow refactor across three components — still not this fix's blast
-- radius. ⚠️ `exchange` also still feeds the strategies.asset_class
-- annualization stamp (√365 vs √252), and THAT reader is still forgeable; it is
-- tracked as 153.6 OQ-2 and is deliberately out of that phase's charter.
--
-- Idempotency
-- -----------
-- REVOKE is idempotent. The function is CREATE OR REPLACE and the trigger is
-- DROPped-if-exists before CREATE. Safe to re-run.
-- ============================================================================

-- ───────────────────────────── 1. PRIMARY GATE: revoke the blanket UPDATE
-- Table-level, because a column-level REVOKE cannot subtract a column from a
-- table-level grant. INSERT / DELETE / SELECT are intentionally left alone.
REVOKE UPDATE ON public.api_keys FROM anon, authenticated;

-- ───────────────────────── 2. DEFENSE-IN-DEPTH: SECURITY INVOKER venue lock
CREATE OR REPLACE FUNCTION public.prevent_api_key_venue_change()
RETURNS TRIGGER
LANGUAGE plpgsql
-- SECURITY INVOKER (the default — stated explicitly) is load-bearing: under
-- SECURITY DEFINER, current_user would be this function's owner and the
-- privileged-caller check below would ALWAYS pass, making the trigger a no-op.
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
BEGIN
  -- Privileged callers may rewrite the venue: the analytics worker and the
  -- support/admin routes run as service_role; migrations, backfills and every
  -- SECURITY DEFINER RPC run as the table owner.
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  IF NEW.exchange IS DISTINCT FROM OLD.exchange THEN
    RAISE EXCEPTION
      'api_keys.exchange is server-attested and cannot be changed from the client; it is the input to the submit-time scope-broadening check and to the asset_class annualization stamp.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS api_keys_lock_exchange ON public.api_keys;
CREATE TRIGGER api_keys_lock_exchange
BEFORE UPDATE OF exchange
ON public.api_keys
FOR EACH ROW EXECUTE FUNCTION public.prevent_api_key_venue_change();

COMMENT ON FUNCTION public.prevent_api_key_venue_change() IS
  'Defense-in-depth lock on api_keys.exchange (2026-08-10, review CR-01). '
  'SECURITY INVOKER so current_user is the real caller — a DEFINER form would '
  'be a no-op. Primary gate is the table-level UPDATE REVOKE in the same '
  'migration; this trigger backstops a future re-grant. exchange is the input '
  'to the finalize-wizard scope-broadening probe gate, so a client-writable '
  'value let a key owner switch an ASVS V4 control off for their own key.';

COMMENT ON TRIGGER api_keys_lock_exchange ON public.api_keys IS
  'Fires only on UPDATE OF exchange, so ordinary worker writes (sync_status, '
  'last_sync_at, cursors) never hit it. Companion to the table-level UPDATE '
  'REVOKE in migration 20260810120000.';

-- ⚠️ SUPERSEDED AT RUNTIME, left intact here on purpose (D-04, 2026-08-11).
-- The "Read by finalize-wizard as the input to the scope-broadening probe gate"
-- sentence below stopped being true when 20260811210000 moved that gate onto
-- api_keys.attested_venue; that later migration re-stamps this comment (keeping
-- the 20260810120000 marker the SQL test keys on). This statement is NOT edited,
-- because rewriting an applied migration's SQL rewrites history rather than the
-- database. Read the corrected residual in the header above.
COMMENT ON COLUMN public.api_keys.exchange IS
  'Venue label. SERVER-ATTESTED: table-level UPDATE is revoked from anon and '
  'authenticated (migration 20260810120000) and a SECURITY INVOKER trigger '
  'backstops it. Read by finalize-wizard as the input to the scope-broadening '
  'probe gate and to the asset_class annualization stamp — do not re-grant '
  'client UPDATE on this column.';

-- ───────────────────── 3. SELF-VERIFY (negative): no client UPDATE survives
-- Same self-verifying posture as migrations 020 / 027 / 20260529150000, which
-- exist specifically because a silent no-op REVOKE shipped twice before.
-- has_any_column_privilege is used rather than has_table_privilege: it answers
-- true for a table-level grant OR any surviving per-column grant, so a partial
-- leak cannot pass this check.
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_any_column_privilege(r, 'public.api_keys', 'UPDATE') THEN
      RAISE EXCEPTION
        'Migration 20260810120000 failed: role % still holds UPDATE on public.api_keys (table-level or per-column). Rolling back.',
        r;
    END IF;
  END LOOP;
END
$$;

-- ───────────────────── 4. SELF-VERIFY (positive): nothing else was taken away
-- An over-broad REVOKE here would silently break the connect-a-key and
-- delete-a-key flows, and would only surface on the next user action. Assert
-- the three privileges that MUST survive: INSERT, DELETE, and migration 027's
-- SELECT allowlist (spot-checked on the column this migration is about).
DO $$
BEGIN
  IF NOT has_table_privilege('authenticated', 'public.api_keys', 'INSERT') THEN
    RAISE EXCEPTION
      'Migration 20260810120000 failed: authenticated lost INSERT on api_keys — the connect-a-key flow is broken. Rolling back.';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.api_keys', 'DELETE') THEN
    RAISE EXCEPTION
      'Migration 20260810120000 failed: authenticated lost DELETE on api_keys — the delete-a-key flow is broken. Rolling back.';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.api_keys', 'exchange', 'SELECT') THEN
    RAISE EXCEPTION
      'Migration 20260810120000 failed: authenticated lost SELECT on api_keys.exchange — migration 027''s allowlist was clobbered. Rolling back.';
  END IF;
END
$$;
