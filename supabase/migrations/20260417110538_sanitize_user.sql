-- Migration 055: sanitize_user RPC + data_deletion_requests.rejected_at columns
-- + gdpr-exports storage bucket.
--
-- Sprint 6 closeout Task 7.3 — Data retention + GDPR workflow (part 1 of 2).
--
-- Why this migration exists
-- -------------------------
-- Migration 012 shipped `data_deletion_requests` as a manual GDPR Art. 17 intake
-- table — the founder processed deletions out of band with a 30-day SLA. Task
-- 7.3 automates the destructive half: once an admin approves a deletion
-- request, `sanitize_user(p_user_id)` anonymizes the target user's PII
-- atomically. We do NOT hard-delete — GDPR permits anonymization, and the
-- anonymize-not-delete strategy preserves referential integrity (audit rows,
-- historical analytics, aggregate counters) while removing the personal
-- attribution.
--
-- Numbering deviation
-- -------------------
-- The Sprint 6 closeout plan called this migration 051_sanitize_user.sql.
-- Migrations 050-053 were consumed by Sprint 5 Tasks 5.4/5.5/5.7/5.8 during
-- the plan-to-execution gap, and 054 was used by Task 7.2 (user_app_roles).
-- 055 is the next free slot, following the convention documented in 050's
-- header + 049's + 054's.
--
-- What this migration ships
-- -------------------------
-- 1. `data_deletion_requests.rejected_at` + `rejection_reason` columns. Needed
--    by the admin approve/reject UI (Task 7.3). Existing migration-012 schema
--    has only `completed_at`; the reject path needs its own timestamp so
--    "pending" vs "rejected" can be distinguished without rehydrating
--    `notes`.
-- 2. `sanitize_user(p_user_id UUID)` SECURITY DEFINER RPC. Anonymize-only,
--    idempotent, service-role-gated. See the Per-table matrix block below.
-- 3. `gdpr-exports` Supabase Storage bucket (private) + path-based RLS. The
--    export route in Task 7.3 streams a signed URL from this bucket.
-- 4. Self-verifying DO block.
--
-- Per-table anonymize / cascade / preserve matrix
-- ===============================================
-- The RPC visits every table that references the target user. For each, we
-- pick ONE of:
--   - ANONYMIZE: NULL the PII columns, keep the row + its foreign-key shape
--     so audit trails and aggregated analytics survive.
--   - PURGE:     DELETE the row. Chosen when the row IS the PII (credentials,
--     private notes) or when leaving it behind would fail future RLS gates.
--   - PRESERVE:  leave the row untouched. Chosen when the row has no PII and
--     deleting would destroy audit continuity (`audit_log`, `contact_requests`,
--     `notification_dispatches`).
--
-- Table                   | Strategy     | Rationale
-- ------------------------|--------------|--------------------------------------
-- profiles                | ANONYMIZE    | NULL display_name, email, telegram, website,
--                         |              | linkedin, avatar_url, description, company,
--                         |              | bio, years_trading, aum_range. Keep id,
--                         |              | created_at. is_admin: UNTOUCHED (intentional
--                         |              | — see body comment at lines 269-271; sanitize
--                         |              | removes PII, not privileges). role kept as-is
--                         |              | (non-PII category label).
-- api_keys                | PURGE        | The row IS the credential. DEK + ciphertext
--                         |              | are the PII — no anonymization short of
--                         |              | DELETE is defensible.
-- strategies              | ANONYMIZE    | NULL name, description, codename,
--                         |              | public_contact_email, review_note, partner_tag.
--                         |              | Keep id, category_id, created_at, markets[],
--                         |              | aum, status. status: KEEP (intentional) —
--                         |              | sanitized strategies remain published with
--                         |              | name='[deleted strategy]' so historical
--                         |              | performance data stays queryable for allocators
--                         |              | who previously matched. Product confirmation
--                         |              | needed before Sprint 7 promotes any role
--                         |              | (analyst-view masking) that would benefit from
--                         |              | status='archived'. Drops raw_fills via the
--                         |              | trades purge below (trades cascade from
--                         |              | strategy).
-- trades (raw fills)      | ANONYMIZE    | NULL raw_data (JSON may contain exchange
--                         |              | account ids), exchange_order_id,
--                         |              | exchange_fill_id. Keeps price/qty/side rows
--                         |              | for strategy analytics continuity.
-- contact_requests        | PRESERVE     | Cross-party audit trail (allocator-manager
--                         |              | handshake). Both sides have a regulatory
--                         |              | interest in the record. allocator_id
--                         |              | preserved; the anonymized profiles row makes
--                         |              | the identity non-resolvable.
-- portfolios              | ANONYMIZE    | NULL name + description. Keep id + created_at
--                         |              | for audit continuity.
-- allocator_preferences   | PURGE        | Free-text `founder_notes` is staff-written
--                         |              | PII about the user; the whole row is
--                         |              | user-centric preference data.
-- match_batches           | PURGE        | User-specific scoring runs. No audit value
--                         |              | once the allocator is anonymized.
-- match_candidates        | CASCADE      | FK ON DELETE CASCADE from match_batches.
-- match_decisions         | PRESERVE     | Cross-party — references strategy. Anonymized
--                         |              | profiles row makes allocator_id non-
--                         |              | resolvable; contact_request_id already
--                         |              | preserved per the contact_requests decision.
-- investor_attestations   | PURGE        | Compliance attestation is personal. Once
--                         |              | the account is anonymized the attestation
--                         |              | can no longer be re-verified.
-- data_deletion_requests  | PRESERVE     | The intake rows ARE the audit trail for
--                         |              | the sanitize itself. Mark completed_at.
-- user_favorites          | PURGE        | Private watchlist data.
-- user_notes              | PURGE        | Private notes — plain text, high PII risk.
-- audit_log               | PRESERVE     | Append-only forensic record. Migration 049
--                         |              | revokes UPDATE/DELETE at the DB layer; the
--                         |              | RPC can't mutate these rows even if it
--                         |              | wanted to. The rows reference user_id, but
--                         |              | the anonymized profiles row makes the
--                         |              | user's identity non-resolvable.
-- user_app_roles          | PURGE        | Role assignments are auth-adjacent. Without
--                         |              | the purge, a re-created account with the
--                         |              | same auth.users.id (impossible today but
--                         |              | nothing in the schema forbids) would inherit
--                         |              | the prior grants.
-- organization_members    | PURGE        | Membership is authorization, not audit.
-- organizations           | ANONYMIZE    | Set created_by to NULL if applicable. Keep
--                         |              | the org itself — other members may still
--                         |              | exist.
-- organization_invites    | PURGE        | Pending invites sent BY the user are stale
--                         |              | after sanitize; those sent TO the user's
--                         |              | email are best-effort since we also null
--                         |              | profiles.email.
-- relationship_documents  | PRESERVE     | Cross-party; mirrors contact_requests
--                         |              | decision. uploaded_by remains but resolves
--                         |              | to an anonymized profile.
-- allocation_events       | PRESERVE     | Historical capital movement records. Tied
--                         |              | to portfolio, which is anonymized above.
-- portfolio_analytics     | PRESERVE     | Historical analytics snapshots.
-- portfolio_alerts        | PRESERVE     | Historical alert log.
-- weight_snapshots        | PRESERVE     | Historical.
-- position_snapshots      | PRESERVE     | Historical.
-- positions               | PRESERVE     | Historical.
-- funding_fees            | PRESERVE     | Historical.
-- reconciliation_reports  | PRESERVE     | Historical.
-- sync_checkpoints        | PRESERVE     | Ingestion bookkeeping.
-- compute_jobs            | PRESERVE     | Internal queue observability.
-- key_permission_audit    | PRESERVE     | Historical audit.
-- decks                   | SKIPPED — no user FK today. Migration 005 declares
--                         |  `decks(id, name, description, slug, created_at)` with
--                         |  no `created_by`/`user_id` column; decks are system-
--                         |  curated admin content, not user-authored. If a future
--                         |  migration adds a user FK, update this matrix + the
--                         |  sanitize_user body AND extend EXCLUDED_TABLES in
--                         |  scripts/check-gdpr-export-coverage.ts accordingly.
-- deck_strategies         | SKIPPED — no user FK today. Inherits decks' system-
--                         |  curated posture. If `decks` gains a user FK in a
--                         |  future migration, revisit this row too.
-- portfolio_strategies    | PRESERVE     | Link table, no PII.
-- notification_dispatches | PRESERVE     | Contains recipient_email but audit trail;
--                         |              | retention cron (migration 056) purges rows
--                         |              | >180d so stale PII doesn't accumulate.
-- verification_requests   | PURGE (by    | Legacy landing-page intake. Email column
--                         | email match) | holds the user's email. Purge rows where
--                         |              | email matches the target's email AT THE TIME
--                         |              | of sanitize (capture before the profiles
--                         |              | anonymize NULLs it).
--
-- Security invariant
-- ------------------
-- sanitize_user is SECURITY DEFINER so it bypasses RLS on the target tables.
-- EXECUTE is granted to service_role only — the admin approve/reject route
-- uses `createAdminClient()` to call this RPC. A compromised user JWT cannot
-- call this function (EXECUTE grants do not leak to authenticated) because
-- of the explicit REVOKE from PUBLIC, anon, authenticated.
--
-- Idempotency
-- -----------
-- The RPC probes for a sentinel (profiles.display_name = '[deleted]') before
-- doing work. A second call against an already-sanitized user is a no-op.
-- Every NULL-assignment is guarded with a WHERE to avoid re-doing work on a
-- re-run.
--
-- Return contract
-- ---------------
-- Returns BOOLEAN: TRUE when this invocation actually performed the
-- anonymize (first run — the sentinel probe flipped display_name to
-- '[deleted]'), FALSE when it was a no-op (the profile was already
-- sanitized, or no profiles row existed). Callers use this to distinguish
-- "first sanitize" from "re-run" in audit metadata — a much cleaner
-- contract than the prior `INT v_mutated_rows` counter which only
-- incremented on two of ~15 mutation statements and produced
-- forensically-useless "mutated_rows=0 or 1" values.

BEGIN;
SET lock_timeout = '3s';

-- --------------------------------------------------------------------------
-- STEP 1: data_deletion_requests rejected_at + rejection_reason
-- --------------------------------------------------------------------------
-- Existing schema (migration 012) has only id, user_id, requested_at,
-- completed_at, notes. Task 7.3's admin UI needs a distinct "rejected"
-- terminal state so the pending-queue listing is exact.
ALTER TABLE data_deletion_requests
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;
ALTER TABLE data_deletion_requests
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

COMMENT ON COLUMN data_deletion_requests.rejected_at IS
  'Set by an admin-reject event (Task 7.3). Mutually exclusive with completed_at at the application layer; both NULL means "pending".';
COMMENT ON COLUMN data_deletion_requests.rejection_reason IS
  'Optional admin rationale shown in the requester''s audit trail. Free-form TEXT.';

-- Supporting index for the admin pending-queue listing: filter out both
-- terminal states so the query scans only "pending" rows.
CREATE INDEX IF NOT EXISTS idx_deletion_requests_pending_v2
  ON data_deletion_requests (requested_at DESC)
  WHERE completed_at IS NULL AND rejected_at IS NULL;

-- --------------------------------------------------------------------------
-- STEP 2: gdpr-exports storage bucket
-- --------------------------------------------------------------------------
-- Private bucket; signed-URL access only. The export route in Task 7.3
-- writes a JSON blob to path `{user_id}/{ulid}.json` and returns a 1-hour
-- signed URL.
INSERT INTO storage.buckets (id, name, public)
VALUES ('gdpr-exports', 'gdpr-exports', false)
ON CONFLICT (id) DO NOTHING;

-- Path-based RLS: owner can read their own exports by prefix, admins can
-- read all. Writes go through the service-role client (export route uses
-- createAdminClient), so no owner-insert policy is needed.
--
-- Policy names are idempotent — DROP IF EXISTS makes re-apply safe.
DROP POLICY IF EXISTS gdpr_exports_owner_read ON storage.objects;
CREATE POLICY gdpr_exports_owner_read ON storage.objects FOR SELECT
  USING (
    bucket_id = 'gdpr-exports'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS gdpr_exports_admin_read ON storage.objects;
CREATE POLICY gdpr_exports_admin_read ON storage.objects FOR SELECT
  USING (
    bucket_id = 'gdpr-exports'
    AND public.current_user_has_app_role(ARRAY['admin'])
  );

-- --------------------------------------------------------------------------
-- STEP 3: sanitize_user SECURITY DEFINER RPC
-- --------------------------------------------------------------------------
-- The function runs as postgres (OWNER), bypassing RLS on every target
-- table. EXECUTE is granted only to service_role — see STEP 4.
--
-- Idempotency strategy: the very first statement probes whether the
-- profile is already sanitized (display_name = '[deleted]'). If yes, the
-- function returns FALSE immediately — no error, no duplicate writes.
-- Every subsequent write also probes its own WHERE guard, so even a
-- partial prior run (e.g., process crashed between step 5 and step 6)
-- converges on the fully-sanitized state on re-run.
--
-- The function returns BOOLEAN: TRUE when this invocation did the
-- anonymize (first run — sentinel transitioned), FALSE when the profile
-- was already sanitized or absent. This is simpler and more honest than
-- the prior INT counter which only reflected two of the many mutation
-- statements and could not be trusted as a row-count signal.
CREATE OR REPLACE FUNCTION public.sanitize_user(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_already_sanitized BOOLEAN;
  v_target_email TEXT;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'sanitize_user: p_user_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Idempotency probe. The sentinel `[deleted]` is our state marker. A
  -- fresh profile cannot legitimately hold that display_name at signup
  -- because the name comes from the OAuth provider or an admin-set value.
  SELECT (display_name = '[deleted]') INTO v_already_sanitized
  FROM profiles WHERE id = p_user_id;

  IF v_already_sanitized IS NULL THEN
    -- No profiles row; user either never existed or auth.users row was
    -- hard-deleted elsewhere. Nothing to anonymize.
    RETURN FALSE;
  END IF;

  IF v_already_sanitized THEN
    -- Already fully sanitized. No-op. This is the re-run path.
    RETURN FALSE;
  END IF;

  -- Capture the email BEFORE we null it so verification_requests can
  -- still be matched by-email in STEP 3d below.
  SELECT email INTO v_target_email FROM profiles WHERE id = p_user_id;

  -- --------------------------------------------------------------------
  -- 3a. profiles — ANONYMIZE. Leave id, created_at, is_admin untouched
  -- (is_admin cannot be widened by sanitize; this is an authorization
  -- concern separate from PII). profiles.role stays as the category
  -- label (non-PII).
  -- --------------------------------------------------------------------
  UPDATE profiles SET
    display_name  = '[deleted]',
    company       = NULL,
    description   = NULL,
    email         = NULL,
    telegram      = NULL,
    website       = NULL,
    linkedin      = NULL,
    avatar_url    = NULL,
    bio           = NULL,
    years_trading = NULL,
    aum_range     = NULL
  WHERE id = p_user_id
    AND display_name IS DISTINCT FROM '[deleted]';

  -- --------------------------------------------------------------------
  -- 3b. api_keys — PURGE. The row IS the credential.
  -- --------------------------------------------------------------------
  DELETE FROM api_keys WHERE user_id = p_user_id;

  -- --------------------------------------------------------------------
  -- 3c. strategies — ANONYMIZE user-facing text. Keep the row so
  -- published-strategy discovery pages don't 404 (the strategy may have
  -- been bought, benchmarked, or referenced by allocators). The owner's
  -- identity is already anonymized at the profiles row.
  -- Also NULL partner_tag + public_contact_email so the strategy no
  -- longer routes messages to the departed user.
  -- --------------------------------------------------------------------
  UPDATE strategies SET
    name                 = '[deleted strategy]',
    description          = NULL,
    codename             = NULL,
    public_contact_email = NULL,
    partner_tag          = NULL,
    review_note          = NULL
  WHERE user_id = p_user_id
    AND name IS DISTINCT FROM '[deleted strategy]';

  -- --------------------------------------------------------------------
  -- 3c.i trades.raw_data — ANONYMIZE. The raw exchange JSON may contain
  -- account identifiers, API key labels, or other provider-side
  -- metadata. NULL it for every trade on strategies owned by the user.
  -- Also drop exchange-side order/fill ids.
  -- --------------------------------------------------------------------
  UPDATE trades SET
    raw_data          = NULL,
    exchange_order_id = NULL,
    exchange_fill_id  = NULL
  WHERE strategy_id IN (SELECT id FROM strategies WHERE user_id = p_user_id)
    AND (raw_data IS NOT NULL OR exchange_order_id IS NOT NULL OR exchange_fill_id IS NOT NULL);

  -- --------------------------------------------------------------------
  -- 3d. verification_requests — PURGE by email match. Legacy landing-
  -- page intake; the email column holds the target's email. Safe to
  -- purge even if the email matches multiple rows (same email over time).
  -- --------------------------------------------------------------------
  IF v_target_email IS NOT NULL THEN
    DELETE FROM verification_requests WHERE email = v_target_email;
  END IF;

  -- --------------------------------------------------------------------
  -- 3e. portfolios — ANONYMIZE.
  -- --------------------------------------------------------------------
  UPDATE portfolios SET
    name        = '[deleted portfolio]',
    description = NULL
  WHERE user_id = p_user_id
    AND name IS DISTINCT FROM '[deleted portfolio]';

  -- --------------------------------------------------------------------
  -- 3f. Per-user PURGE tables. Each row is user-private; nothing is
  -- gained by preserving them once the account is anonymized.
  -- --------------------------------------------------------------------
  DELETE FROM allocator_preferences WHERE user_id = p_user_id;
  DELETE FROM user_favorites        WHERE user_id = p_user_id;
  DELETE FROM user_notes            WHERE user_id = p_user_id;
  DELETE FROM investor_attestations WHERE user_id = p_user_id;
  DELETE FROM user_app_roles        WHERE user_id = p_user_id;
  DELETE FROM organization_members  WHERE user_id = p_user_id;

  -- Match-personalization rows: allocator-only rows are purged; the
  -- allocator's match_decisions stays to preserve the cross-party audit.
  DELETE FROM match_batches WHERE allocator_id = p_user_id;
  -- match_candidates cascades from match_batches (FK ON DELETE CASCADE).

  -- Organization invites SENT BY this user — the invited party can
  -- ignore the pending invite; we don't want a departed user to appear
  -- as an active inviter.
  DELETE FROM organization_invites WHERE invited_by = p_user_id;

  -- --------------------------------------------------------------------
  -- 3g. organizations created by this user. We SET created_by = NULL
  -- defensively so the historical org record survives without
  -- attribution.
  --
  -- Nullability caveat: migration 006 originally declared created_by as
  -- NOT NULL. Migration 057 relaxes that constraint — without 057 this
  -- UPDATE raises `not_null_violation` on the first sanitize against
  -- any user who ever created an org, and the deletion request is stuck
  -- in "pending" forever. Migrations 055 and 057 MUST land together for
  -- the GDPR flow to be sound end-to-end.
  -- --------------------------------------------------------------------
  UPDATE organizations SET created_by = NULL WHERE created_by = p_user_id;

  -- --------------------------------------------------------------------
  -- 3h. contact_requests + match_decisions — PRESERVE. Cross-party
  -- audit. No writes here — documented for the matrix completeness.
  -- --------------------------------------------------------------------

  -- --------------------------------------------------------------------
  -- 3i. audit_log — PRESERVE. Migration 049 revokes UPDATE/DELETE at
  -- the DB layer; the RPC CANNOT mutate these rows even if it tried
  -- (the REVOKE applies to the DEFINER owner's session too, for the
  -- service_role grantee).
  -- --------------------------------------------------------------------

  -- First-run path: the sentinel probe at the top confirmed the profile
  -- was not yet sanitized, and every mutation above has now executed.
  -- Return TRUE so the caller can record "was_first_run" in audit
  -- metadata (useful for distinguishing "real" sanitizes from idempotent
  -- re-plays in forensic review).
  RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION public.sanitize_user(UUID) IS
  'GDPR Art. 17 anonymize-not-delete RPC. SECURITY DEFINER. Idempotent. service_role-only EXECUTE. Returns TRUE on first-run anonymize, FALSE on re-run or missing profile. See migration 055 for the per-table matrix.';

REVOKE ALL ON FUNCTION public.sanitize_user(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sanitize_user(UUID) TO service_role;

-- --------------------------------------------------------------------------
-- STEP 4: self-verifying DO block
-- --------------------------------------------------------------------------
-- Asserts every artifact is present AND the RPC is callable (via pg_proc
-- probe, not a live call — calling sanitize_user with a sentinel user id
-- in a DO block would mutate nothing but would leave a rollback overhead
-- the other migrations in this family avoid).
DO $$
DECLARE
  has_rejected_at_col BOOLEAN;
  has_rejection_reason_col BOOLEAN;
  has_bucket BOOLEAN;
  has_owner_read_policy BOOLEAN;
  has_admin_read_policy BOOLEAN;
  has_fn BOOLEAN;
  authed_can_exec BOOLEAN;
  svc_can_exec BOOLEAN;
BEGIN
  -- 1. rejected_at column present
  SELECT EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'data_deletion_requests'
      AND column_name = 'rejected_at'
  ) INTO has_rejected_at_col;
  IF NOT has_rejected_at_col THEN
    RAISE EXCEPTION 'Migration 055 failed: data_deletion_requests.rejected_at column missing';
  END IF;

  -- 2. rejection_reason column present
  SELECT EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'data_deletion_requests'
      AND column_name = 'rejection_reason'
  ) INTO has_rejection_reason_col;
  IF NOT has_rejection_reason_col THEN
    RAISE EXCEPTION 'Migration 055 failed: data_deletion_requests.rejection_reason column missing';
  END IF;

  -- 3. gdpr-exports bucket present
  SELECT EXISTS(
    SELECT 1 FROM storage.buckets WHERE id = 'gdpr-exports'
  ) INTO has_bucket;
  IF NOT has_bucket THEN
    RAISE EXCEPTION 'Migration 055 failed: gdpr-exports storage bucket missing';
  END IF;

  -- 4. owner-read + admin-read policies on storage.objects
  SELECT EXISTS(
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'gdpr_exports_owner_read'
  ) INTO has_owner_read_policy;
  IF NOT has_owner_read_policy THEN
    RAISE EXCEPTION 'Migration 055 failed: gdpr_exports_owner_read policy missing';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'gdpr_exports_admin_read'
  ) INTO has_admin_read_policy;
  IF NOT has_admin_read_policy THEN
    RAISE EXCEPTION 'Migration 055 failed: gdpr_exports_admin_read policy missing';
  END IF;

  -- 5. sanitize_user function exists, is SECURITY DEFINER, and returns
  -- BOOLEAN (not INT — the BOOLEAN signature is the locked contract per
  -- the Sprint 6 code-review fix I4).
  SELECT EXISTS(
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.proname = 'sanitize_user'
      AND p.prosecdef = TRUE
      AND pg_get_function_arguments(p.oid) ILIKE '%uuid%'
      AND pg_get_function_result(p.oid) = 'boolean'
  ) INTO has_fn;
  IF NOT has_fn THEN
    RAISE EXCEPTION 'Migration 055 failed: sanitize_user(uuid) SECURITY DEFINER function missing or does not return boolean';
  END IF;

  -- 6. EXECUTE granted only to service_role (not authenticated / PUBLIC)
  SELECT has_function_privilege('authenticated', 'public.sanitize_user(uuid)', 'EXECUTE')
    INTO authed_can_exec;
  SELECT has_function_privilege('service_role', 'public.sanitize_user(uuid)', 'EXECUTE')
    INTO svc_can_exec;
  IF authed_can_exec THEN
    RAISE EXCEPTION 'Migration 055 failed: sanitize_user still EXECUTEable by authenticated';
  END IF;
  IF NOT svc_can_exec THEN
    RAISE EXCEPTION 'Migration 055 failed: sanitize_user EXECUTE not granted to service_role';
  END IF;

  RAISE NOTICE 'Migration 055: sanitize_user RPC + rejected_at columns + gdpr-exports bucket installed and verified.';
END
$$;

COMMIT;
