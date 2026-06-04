-- For-quants lead dedup — collapse same-email same-UTC-day submissions
-- (M-0324, audit-2026-05-07).
--
-- /api/for-quants-lead does a plain INSERT and fires exactly one founder email
-- per inserted row (via after()). With no uniqueness on the table, a dropped
-- response that the client retries — or two concurrent same-email POSTs — each
-- created a DUPLICATE lead row AND a duplicate founder email. The route's own
-- docblock already anticipated this dedup index ("UNIQUE (lower(email),
-- date_trunc('day', created_at)) lives in a migration owned by PR-5") but the
-- migration was never written. This is it.
--
-- After this migration the second same-email/same-day insert raises 23505; the
-- route treats 23505 as idempotent success and skips the second founder email
-- (see src/app/api/for-quants-lead/route.ts). Distinct UTC days are still
-- allowed — a firm can legitimately request a call again on a later day.
--
-- IMMUTABILITY: the day key is ((created_at AT TIME ZONE 'UTC')::date), NOT
-- created_at::date. `timestamptz::date` is STABLE (its result depends on the
-- session TimeZone) and Postgres rejects it in an index expression; the
-- `AT TIME ZONE 'UTC'` form yields a plain timestamp via a fixed conversion, so
-- (… )::date is IMMUTABLE and indexable. lower(email) is defensive: the route
-- already lowercases via the Zod schema, but a future direct service-role
-- insert might not.

-- --------------------------------------------------------------------------
-- STEP 1: dedup any pre-existing collisions to one survivor per
-- (lower(email), UTC-day) so the unique index below can build.
--
-- Survivor selection is CRM-aware: this table is the founder CRM, so a row a
-- human already actioned (processed_at set) must NOT be discarded in favour of
-- an earlier untouched duplicate. Ranking is therefore
-- `(processed_at IS NOT NULL) DESC, created_at, id` — keep any processed row,
-- else the earliest; the id tie-break gives a total order so even two rows with
-- byte-identical created_at (concurrent inserts in the same microsecond)
-- resolve to exactly one survivor.
--
-- Fail-loud: RAISE NOTICE the deleted count so a non-zero dedup is VISIBLE in
-- the apply log rather than silently erasing CRM rows. At pre-first-client
-- volumes this is expected to delete zero rows (the pre-fix route only created
-- dups via concurrent retries seconds apart, never processed in between), but
-- it MUST run for the index build to be safe. for_quants_leads is a leaf table
-- (nothing references it), so the delete cascades nowhere; and because the whole
-- migration runs in one transaction, an index-build failure rolls this DELETE
-- back — there is no half-applied state.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_deleted integer;
BEGIN
  WITH ranked AS (
    SELECT id,
           row_number() OVER (
             PARTITION BY lower(email), (created_at AT TIME ZONE 'UTC')::date
             ORDER BY (processed_at IS NOT NULL) DESC, created_at, id
           ) AS rn
    FROM for_quants_leads
  )
  DELETE FROM for_quants_leads
   WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted > 0 THEN
    RAISE NOTICE 'M-0324: deleted % pre-existing duplicate for_quants_leads row(s) before building the email/day unique index', v_deleted;
  END IF;
END $$;

-- --------------------------------------------------------------------------
-- STEP 2: the dedup unique index. Plain (non-CONCURRENT) build: this migration
-- runs inside a transaction (CREATE INDEX CONCURRENTLY is illegal in a txn) and
-- for_quants_leads is a low-volume marketing-leads table, so the brief
-- ACCESS EXCLUSIVE lock during the build is immaterial. IF NOT EXISTS keeps the
-- migration re-runnable.
-- --------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS for_quants_leads_email_day_uniq
  ON for_quants_leads (lower(email), ((created_at AT TIME ZONE 'UTC')::date));

COMMENT ON INDEX for_quants_leads_email_day_uniq IS
  'M-0324: dedups same-email same-UTC-day lead submissions, collapsing network-retry / double-submit duplicate rows and duplicate founder emails. Day key uses AT TIME ZONE UTC for immutability; lower(email) is defensive.';
