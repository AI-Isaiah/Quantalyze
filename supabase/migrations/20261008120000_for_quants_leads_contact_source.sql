-- Migration: for_quants_leads contact source — Phase 164.6.6.3.5 DOMAINONE (plan 03).
--
-- Why this migration exists
-- -------------------------
-- DOMAINONE gives the platform one /contact form (D-01). Its messages are stored
-- in the SAME table as the /for-quants "Request a call" leads: the founder CRM
-- already reads for_quants_leads, so sharing it is the smallest change.
--
-- That table carries for_quants_leads_email_day_uniq, UNIQUE on
-- (lower(email), UTC day) (migration 20260604120000, M-0324). For a retried
-- "Request a call" POST that is exactly right: the second insert raises 23505 and
-- the route treats it as an idempotent success. For a CONTACT message it is
-- wrong. A person who writes to us twice in one day would get `{ ok: true }` and
-- the second message would never be stored. UI-SPEC "Success means stored" makes
-- the opposite binding: a contact-form message is never deduplicated.
--
-- So this migration:
--   * adds `source` ('request_call' | 'contact_form', NOT NULL, DEFAULT
--     'request_call'), `topic` and `reference`, each with a named CHECK;
--   * re-creates for_quants_leads_email_day_uniq under the SAME name, restricted
--     to request_call rows (a partial predicate on `source`). A contact_form row is outside the index,
--     so two contact messages from one email on one day both insert, and a
--     contact_form row beside a request_call row for that email and day also
--     inserts. Two request_call rows still collide.
--
-- D-13 (founder): `firm` keeps NOT NULL. A contact message that names no firm
-- stores an empty string, written by the route (plan 04). No change to `firm`.
--
-- Caller impact
-- -------------
-- /api/for-quants-lead today inserts without `source`; the constant DEFAULT makes
-- every such insert a request_call row, so the route keeps working unchanged
-- until plan 04 starts writing contact_form rows. The 23505 handling there still
-- applies to request_call rows only.
--
-- Backwards compatibility
-- -----------------------
-- Every existing row becomes `request_call` through the constant DEFAULT. Adding
-- a NOT NULL column with a constant DEFAULT is metadata-only on PostgreSQL 11+
-- (no table rewrite). The new partial index covers a SUBSET of the old unique
-- set (every existing row is request_call), so it cannot fail to build on data
-- the old index already accepted. There is therefore NO backfill and NO data
-- step, and ⛔ deliberately no data-reading DO block: a block that RAISEs on an
-- unexpected count can refuse on the empty shared TEST database and block the
-- PROD deploy ([164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]). The self-check at the
-- foot reads the CATALOG only.
--
-- IMMUTABILITY: the day key stays ((created_at AT TIME ZONE 'UTC')::date), NOT
-- created_at::date. `timestamptz::date` is STABLE (its result depends on the
-- session TimeZone) and Postgres rejects it in an index expression; the
-- `AT TIME ZONE 'UTC'` form yields a plain timestamp via a fixed conversion, so
-- (… )::date is IMMUTABLE and indexable. lower(email) is defensive. The new
-- predicate `source = 'request_call'` compares a text column to a constant and is
-- IMMUTABLE too.
--
-- Access: RLS stays ON with ZERO policies and anon/authenticated stay revoked
-- (migration 20260411010107). The new columns inherit both. No grant change.

-- --------------------------------------------------------------------------
-- STEP 1: columns
-- --------------------------------------------------------------------------
ALTER TABLE for_quants_leads
  ADD COLUMN IF NOT EXISTS source    TEXT NOT NULL DEFAULT 'request_call',
  ADD COLUMN IF NOT EXISTS topic     TEXT,
  ADD COLUMN IF NOT EXISTS reference TEXT;

COMMENT ON COLUMN for_quants_leads.source IS
  'Which form wrote the row: request_call (the /for-quants Request-a-call modal; deduplicated per email per UTC day) or contact_form (the /contact form; never deduplicated). DEFAULT request_call so a writer that omits it stays a request_call writer. Phase 164.6.6.3.5 DOMAINONE.';
COMMENT ON COLUMN for_quants_leads.topic IS
  'Contact-form topic (general, support, security, privacy). NULL for request_call rows. Mirrors CONTACT_TOPICS in src/lib/contact.ts; a parity test pins the two lists.';
COMMENT ON COLUMN for_quants_leads.reference IS
  'Contact-form pointer text: the strategy / draft / ref ids a page link carried, composed by parseContactPrefill in src/lib/contact.ts. NULL when none. At most 200 characters.';

-- --------------------------------------------------------------------------
-- STEP 2: named CHECKs (DROP IF EXISTS then ADD, so a re-run is idempotent)
-- --------------------------------------------------------------------------
ALTER TABLE for_quants_leads DROP CONSTRAINT IF EXISTS for_quants_leads_source_check;
ALTER TABLE for_quants_leads
  ADD CONSTRAINT for_quants_leads_source_check
  CHECK (source IN ('request_call', 'contact_form'));

ALTER TABLE for_quants_leads DROP CONSTRAINT IF EXISTS for_quants_leads_topic_check;
ALTER TABLE for_quants_leads
  ADD CONSTRAINT for_quants_leads_topic_check
  CHECK (topic IS NULL OR topic IN ('general', 'support', 'security', 'privacy'));

ALTER TABLE for_quants_leads DROP CONSTRAINT IF EXISTS for_quants_leads_reference_len_check;
ALTER TABLE for_quants_leads
  ADD CONSTRAINT for_quants_leads_reference_len_check
  CHECK (reference IS NULL OR char_length(reference) <= 200);

-- --------------------------------------------------------------------------
-- STEP 3: the dedup index, same name, now scoped to request_call rows
-- --------------------------------------------------------------------------
-- Plain (non-CONCURRENT) build: this migration runs inside a transaction (CREATE
-- INDEX CONCURRENTLY is illegal in one) and for_quants_leads is a low-volume
-- table, so the brief ACCESS EXCLUSIVE lock is immaterial.
DROP INDEX IF EXISTS for_quants_leads_email_day_uniq;
CREATE UNIQUE INDEX for_quants_leads_email_day_uniq
  ON for_quants_leads (lower(email), ((created_at AT TIME ZONE 'UTC')::date))
  WHERE source = 'request_call';

COMMENT ON INDEX for_quants_leads_email_day_uniq IS
  'M-0324, re-scoped by 164.6.6.3.5: dedups same-email same-UTC-day request_call submissions, collapsing network-retry / double-submit duplicate rows and duplicate founder emails. contact_form rows are outside the index on purpose: a contact message is never deduplicated. Day key uses AT TIME ZONE UTC for immutability; lower(email) is defensive.';

-- --------------------------------------------------------------------------
-- STEP 4: self-verifying DO block — catalog reads ONLY, no table data
-- --------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'for_quants_leads'
      AND indexname = 'for_quants_leads_email_day_uniq'
      AND indexdef ~ 'UNIQUE'
      AND indexdef ~ 'WHERE \(?\(?source = ''request_call''::text\)?\)?$'
  ) THEN
    RAISE EXCEPTION 'migration 20261008120000 failed: for_quants_leads_email_day_uniq is missing, not UNIQUE, or not restricted to source = request_call';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'for_quants_leads'
         AND column_name IN ('source', 'topic', 'reference')) <> 3 THEN
    RAISE EXCEPTION 'migration 20261008120000 failed: source / topic / reference columns not all present on for_quants_leads';
  END IF;
  IF (SELECT count(*) FROM pg_constraint
       WHERE conrelid = 'public.for_quants_leads'::regclass
         AND conname IN ('for_quants_leads_source_check',
                         'for_quants_leads_topic_check',
                         'for_quants_leads_reference_len_check')) <> 3 THEN
    RAISE EXCEPTION 'migration 20261008120000 failed: the three for_quants_leads CHECK constraints are not all present';
  END IF;
END $$;
