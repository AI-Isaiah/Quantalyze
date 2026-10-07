-- Test for migration 20261008120000 — Phase 164.6.6.3.5 DOMAINONE, plan 03:
-- "success means stored" for the /contact form.
--
-- ROOT CAUSE the migration fixes: for_quants_leads_email_day_uniq (UNIQUE on
-- lower(email) + UTC day, migration 20260604120000) makes the route treat a
-- second same-email same-day insert as an idempotent success and skip it. That is
-- right for a retried "Request a call" POST and WRONG for a contact message: a
-- person who writes twice in one day gets `{ ok: true }` and the second message
-- is never stored. Contact messages share the lead table (D-01), so the index is
-- re-created under the SAME name, restricted to `source = 'request_call'`.
--
-- This file pins the invariants of that fix, structurally AND behaviourally.
-- pgTAP is not set up in this project, so assertions RAISE EXCEPTION on failure —
-- a clean run prints a NOTICE; a failed assertion aborts with a clear message.
--
-- WHAT THIS FILE WOULD REDDEN ON, stated so a future reader can check it still
-- would: the index dropped; the index made TOTAL again (the regression that would
-- hand every contact message a false success); the index losing UNIQUE or its
-- lower(email) / UTC-day key; the source CHECK dropped or widened; the topic CHECK
-- or the reference length CHECK dropped; source losing its NOT NULL or its
-- 'request_call' DEFAULT (the route in production still inserts without a source
-- until plan 04 ships, so that DEFAULT is what keeps every existing writer a
-- request_call writer). Section 4 is the BEHAVIOURAL half: it inserts real rows
-- and proves the index and the CHECKs actually fire, so none of the structural
-- assertions can pass vacuously against a constraint that exists and does nothing.
--
-- ⚠️ Only this file's OWN rows are inserted: every email carries a per-run random
-- token on the reserved example.com domain, and the whole behavioural block runs
-- inside a transaction that is ROLLED BACK. Nothing is left behind, so it is safe
-- on the local-stack `sql-tests` lane, and an assertion about "my rows" never
-- reads another run's rows (FANOUT-GLOBAL-01).
--
-- Usage:
--   psql "$DATABASE_URL" -f supabase/tests/test_for_quants_leads_contact_dedupe.sql
--
-- ⭐ MACHINE-EXECUTABLE TWINS (phase 164.4). Each prose RED-UNDER below an arm
-- carries an adjacent machine twin that scripts/mutation-runner executes: it
-- mutates COPIES on a throwaway pg-lane cluster, requires the FIRST
-- `TEST FAILED (…)` to name that arm, and restores GREEN. Schema:
-- scripts/mutation-runner/GRAMMAR.md. The line below declares what the lane
-- applies before this gate, DISCOVERED by iterating the lane (plan 164.6.6.3.5-03).
--
-- ⚠️ EVERY TWIN HERE IS A `sql` STEP. The migration's own self-check re-reads the
-- index predicate and the columns, so a migration EDIT would abort the apply and
-- never reach the gate; a `sql` step drifts the LIVE object after apply, which is
-- the state this gate exists to catch.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","supabase/migrations/20260411010107_for_quants_leads.sql","supabase/migrations/20260510182622_for_quants_leads_notify_markers.sql","supabase/migrations/20260604120000_for_quants_leads_email_day_unique.sql","supabase/migrations/20261008120000_for_quants_leads_contact_source.sql"]}

-- ===========================================================================
-- 1-3. STRUCTURAL: the index, the source CHECK, the column shape
-- ===========================================================================
DO $$
DECLARE
  v_idx_def    TEXT;
  v_idx_unique BOOLEAN;
  v_chk_def    TEXT;
  v_default    TEXT;
  v_nullable   TEXT;
BEGIN
  -- ----- 1. the dedup index still exists ------------------------------------
  -- RED-UNDER: DROP the LIVE for_quants_leads_email_day_uniq index. Without it a
  --            retried "Request a call" POST creates a second lead row and a
  --            second founder email again (M-0324). `sql` step: the migration
  --            self-check re-reads this index at apply time.
  -- RED-UNDER-M: {"arm":"1","apply":[{"kind":"sql","stmt":"DROP INDEX public.for_quants_leads_email_day_uniq"}]}
  SELECT i.indexdef, ix.indisunique
    INTO v_idx_def, v_idx_unique
    FROM pg_indexes i
    JOIN pg_class c ON c.relname = i.indexname
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = i.schemaname
    JOIN pg_index ix ON ix.indexrelid = c.oid
   WHERE i.schemaname = 'public'
     AND i.tablename = 'for_quants_leads'
     AND i.indexname = 'for_quants_leads_email_day_uniq';
  IF v_idx_def IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (1): for_quants_leads_email_day_uniq index is missing — a retried Request-a-call POST has no DB backstop';
  END IF;
  IF NOT v_idx_unique THEN
    RAISE EXCEPTION 'TEST FAILED (1): for_quants_leads_email_day_uniq must be UNIQUE, it dedups nothing otherwise: %', v_idx_def;
  END IF;

  -- ----- 2. ... and it is PARTIAL on request_call, not total ----------------
  -- RED-UNDER: drop the live index and re-create it WITHOUT the WHERE clause — the
  --            TOTAL form migration 20260604120000 shipped. This is the exact
  --            regression that gives a second same-day contact message a false
  --            `{ ok: true }` with nothing stored. Dropped and re-created in one
  --            `sql` step so arm 1 (index missing) is not the first failure.
  -- RED-UNDER-M: {"arm":"2","apply":[{"kind":"sql","stmt":"DROP INDEX public.for_quants_leads_email_day_uniq; CREATE UNIQUE INDEX for_quants_leads_email_day_uniq ON public.for_quants_leads (lower(email), ((created_at AT TIME ZONE 'UTC')::date))"}]}
  IF v_idx_def !~ 'WHERE \(?\(?source = ''request_call''::text\)?\)?$' THEN
    RAISE EXCEPTION 'TEST FAILED (2): for_quants_leads_email_day_uniq must be restricted to WHERE source = ''request_call'' — a TOTAL index turns a second same-day contact message into a silent success with nothing stored: %', v_idx_def;
  END IF;
  IF v_idx_def !~ 'lower\(email\)' OR v_idx_def !~ 'AT TIME ZONE ''UTC''' THEN
    RAISE EXCEPTION 'TEST FAILED (2): for_quants_leads_email_day_uniq lost its lower(email) / UTC-day key: %', v_idx_def;
  END IF;

  -- ----- 3. the source CHECK exists and names exactly the two sources -------
  -- RED-UNDER: DROP the live for_quants_leads_source_check constraint — any string
  --            becomes a valid `source`, and the partial index of arm 2 would
  --            silently stop governing rows spelled a third way.
  -- RED-UNDER-M: {"arm":"3","apply":[{"kind":"sql","stmt":"ALTER TABLE public.for_quants_leads DROP CONSTRAINT for_quants_leads_source_check"}]}
  SELECT pg_get_constraintdef(con.oid)
    INTO v_chk_def
    FROM pg_constraint con
   WHERE con.conrelid = 'public.for_quants_leads'::regclass
     AND con.conname = 'for_quants_leads_source_check';
  IF v_chk_def IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (3): for_quants_leads_source_check is missing — source accepts any string';
  END IF;
  IF v_chk_def !~ '''request_call''' OR v_chk_def !~ '''contact_form''' THEN
    RAISE EXCEPTION 'TEST FAILED (3): for_quants_leads_source_check must name request_call and contact_form: %', v_chk_def;
  END IF;

  -- ----- 3b. the other two CHECKs, and the column shape ---------------------
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.for_quants_leads'::regclass
                    AND conname = 'for_quants_leads_topic_check') THEN
    RAISE EXCEPTION 'TEST FAILED (3b): for_quants_leads_topic_check is missing — topic accepts any string';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.for_quants_leads'::regclass
                    AND conname = 'for_quants_leads_reference_len_check') THEN
    RAISE EXCEPTION 'TEST FAILED (3b): for_quants_leads_reference_len_check is missing — reference is unbounded';
  END IF;

  SELECT column_default, is_nullable
    INTO v_default, v_nullable
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'for_quants_leads'
     AND column_name = 'source';
  IF v_nullable IS DISTINCT FROM 'NO' THEN
    RAISE EXCEPTION 'TEST FAILED (3c): for_quants_leads.source must be NOT NULL (is_nullable = %)', v_nullable;
  END IF;
  IF v_default IS NULL OR v_default !~ 'request_call' THEN
    RAISE EXCEPTION 'TEST FAILED (3c): for_quants_leads.source must DEFAULT to request_call so every writer that omits it stays a request_call writer (default = %)', v_default;
  END IF;

  RAISE NOTICE 'PASS (structural): for_quants_leads_email_day_uniq is UNIQUE and partial on request_call; source/topic/reference CHECKs present; source NOT NULL DEFAULT request_call.';
END $$;

-- ===========================================================================
-- 4. BEHAVIOURAL: the index and the CHECKs actually FIRE
-- ===========================================================================
-- The cases, and the specific regression each one would catch:
--   (4a) two request_call rows, one email modulo case, one UTC day → 23505. The
--        retry/double-submit backstop the index exists for.
--   (4b) two contact_form rows, same email, same day → BOTH insert. Fails if the
--        index ever becomes total again: a contact message must never be dropped.
--   (4c) one contact_form and one request_call, same email, same day → BOTH insert.
--   (4d) source = 'newsletter' → 23514; topic = 'billing' → 23514; a 201-character
--        reference → 23514. Fails if the matching CHECK is dropped.
--   (4e) a row inserted WITHOUT `source` reads back request_call (the DEFAULT).
BEGIN;

DO $behavioural$
DECLARE
  v_run   TEXT := replace(gen_random_uuid()::text, '-', '');
  v_email TEXT;
  v_n     INT;
  v_src   TEXT;
BEGIN
  v_email := 'dedupe-' || v_run || '@example.com';

  -- ----- 4e. an insert that omits source is a request_call row --------------
  -- This is also the first request_call row of case 4a, so 4a exercises the
  -- DEFAULT path the production route takes today.
  INSERT INTO for_quants_leads (name, firm, email)
  VALUES ('dedupe test', 'dedupe firm', v_email);
  SELECT source INTO v_src FROM for_quants_leads WHERE lower(email) = lower(v_email);
  IF v_src IS DISTINCT FROM 'request_call' THEN
    RAISE EXCEPTION 'TEST FAILED (4e): a row inserted without source read back %, expected request_call', v_src;
  END IF;

  -- ----- 4a. a second request_call row, same email modulo case → 23505 ------
  -- ⛔ The RAISE below carries SQLSTATE P0001, NOT 23505, so the handler cannot
  -- swallow this file's own failure signal. Same trick in 4d.
  BEGIN
    INSERT INTO for_quants_leads (name, firm, email, source)
    VALUES ('dedupe test', 'dedupe firm', upper(v_email), 'request_call');
    RAISE EXCEPTION 'TEST FAILED (4a): a SECOND request_call row with the same lower(email) and UTC day was ADMITTED — for_quants_leads_email_day_uniq does not fire, so a retried POST makes a duplicate lead and a duplicate founder email';
  EXCEPTION WHEN unique_violation THEN
    NULL;  -- expected
  END;

  -- ----- 4b. two contact_form rows, same email, same day → BOTH admitted ----
  -- RED-UNDER: add a SECOND, TOTAL unique index on (lower(email), UTC day) under
  --            another name — the competing constraint a later migration could
  --            introduce while for_quants_leads_email_day_uniq itself still looks
  --            right. Sections 1-3 read only the named index and the CHECKs, so
  --            they stay GREEN and this behavioural arm is the first failure: the
  --            first contact_form row collides with the request_call row of 4e.
  -- RED-UNDER-M: {"arm":"4b","apply":[{"kind":"sql","stmt":"CREATE UNIQUE INDEX for_quants_leads_shadow_total_uniq ON public.for_quants_leads (lower(email), ((created_at AT TIME ZONE 'UTC')::date))"}]}
  BEGIN
    INSERT INTO for_quants_leads (name, firm, email, source, topic)
    VALUES ('contact one', '', v_email, 'contact_form', 'general');
    INSERT INTO for_quants_leads (name, firm, email, source, topic)
    VALUES ('contact two', '', v_email, 'contact_form', 'support');
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'TEST FAILED (4b): two contact_form rows with one email on one UTC day were REFUSED (23505) — a second contact message would be reported stored and silently dropped';
  END;

  SELECT count(*) INTO v_n
    FROM for_quants_leads
   WHERE lower(email) = lower(v_email) AND source = 'contact_form';
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (4b): expected both contact_form rows stored, found %', v_n;
  END IF;

  -- ----- 4c. contact_form + request_call, same email and day → both stored --
  -- The request_call row from 4e already exists next to the two contact rows, so
  -- reaching this point has proven it; this reads the totals back.
  SELECT count(*) INTO v_n FROM for_quants_leads WHERE lower(email) = lower(v_email);
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'TEST FAILED (4c): expected 1 request_call + 2 contact_form rows stored for one email and day, found %', v_n;
  END IF;

  -- ----- 4d. the CHECKs fire ------------------------------------------------
  BEGIN
    INSERT INTO for_quants_leads (name, firm, email, source)
    VALUES ('bad source', '', 'src-' || v_run || '@example.com', 'newsletter');
    RAISE EXCEPTION 'TEST FAILED (4d): source = ''newsletter'' was ADMITTED — for_quants_leads_source_check does not fire';
  EXCEPTION WHEN check_violation THEN
    NULL;  -- expected
  END;

  BEGIN
    INSERT INTO for_quants_leads (name, firm, email, source, topic)
    VALUES ('bad topic', '', 'top-' || v_run || '@example.com', 'contact_form', 'billing');
    RAISE EXCEPTION 'TEST FAILED (4d): topic = ''billing'' was ADMITTED — for_quants_leads_topic_check does not fire';
  EXCEPTION WHEN check_violation THEN
    NULL;  -- expected
  END;

  BEGIN
    INSERT INTO for_quants_leads (name, firm, email, source, topic, reference)
    VALUES ('long ref', '', 'ref-' || v_run || '@example.com', 'contact_form', 'general', repeat('x', 201));
    RAISE EXCEPTION 'TEST FAILED (4d): a 201-character reference was ADMITTED — for_quants_leads_reference_len_check does not fire';
  EXCEPTION WHEN check_violation THEN
    NULL;  -- expected
  END;

  RAISE NOTICE 'PASS (behavioural): a second same-day request_call row refused (23505); two contact_form rows and a contact_form beside a request_call row all stored; source/topic/reference CHECKs refuse bad values; an insert without source is a request_call row.';
END $behavioural$;

ROLLBACK;
