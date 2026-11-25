-- ==========================================================================
-- Phase 230 MT5NIGHTLY plan 01 (MT5D-02): the cross-process MT5 terminal lease.
--
-- WHAT IS UNDER TEST. public.mt5_terminal_leases and its three RPCs,
-- public.acquire_mt5_terminal_lease, public.renew_mt5_terminal_lease and
-- public.release_mt5_terminal_lease: one lease row per MT5 terminal, taken and
-- fenced by an owner token, with the database's now() as the only clock.
--
-- THE FAILURE IT CLOSES. The MT5 terminal is one shared process driven by two
-- Railway services, and the in-process asyncio lock serializes nothing across
-- them: the backfill worker's nightly derive and the API process's holdings poll
-- logged the terminal into different accounts at once, the derive's login bracket
-- refused the read, and the job was retried. The lease is the row both services
-- must hold before they touch the terminal.
--
-- HOW. Plain PL/pgSQL DO blocks, RAISE EXCEPTION on failure. pgTAP is NOT
-- installed. No psql meta-commands. Every arm is its own BEGIN ... ROLLBACK, so
-- nothing it seeds outlives it. Every digest is derived from the arm's own name,
-- so every assertion reads only that arm's own row. now() is frozen inside one
-- transaction, so an expiry is staged by back-dating the arm's own row with an
-- UPDATE scoped to its digest, never by sleeping. The calls under test sit inside
-- inner BEGIN ... EXCEPTION blocks that only capture the SQLSTATE where a raise is
-- the expected answer; the arm's RAISE comes AFTER the block (lint rule R1).
--
-- ARMS (file order is this order).
--   L1  A held terminal refuses a second token, and the same token re-acquiring is
--       granted and leaves the owner unchanged.
--
-- LAYERING NOTE. The migration's self-verify block asserts catalogue facts that
-- later arms also prove behaviourally. A twin that breaks one of them therefore
-- also stands down the self-verify clause that would abort the apply, so the gate
-- (not the apply) goes RED with the arm named.
--
-- PG-LANE SUBSTRATE (the apply list below): the core fixture, Supabase's default
-- privileges (so the migration's REVOKEs are falsifiable), then this migration.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","supabase/migrations/20261126120000_mt5_terminal_lease.sql"]}
-- ==========================================================================

-- --------------------------------------------------------------------------
-- L1 - one owner token at a time.
-- RED-UNDER: turn the WHERE condition of the DO UPDATE in acquire_mt5_terminal_lease
--            in 20261126120000_mt5_terminal_lease.sql into TRUE. A second token now
--            overwrites the held row and is granted: this arm's first raise.
-- RED-UNDER-M: {"arm":"L1","apply":[{"kind":"edit","file":"supabase/migrations/20261126120000_mt5_terminal_lease.sql","find":"   WHERE l.owner_token IS NULL\n      OR l.expires_at <= now()\n      OR l.owner_token = EXCLUDED.owner_token;","replace":"   WHERE TRUE;","occurrences":1}]}
-- --------------------------------------------------------------------------
BEGIN;
DO $$
DECLARE
  v_digest text := encode(sha256(convert_to('230-L1', 'UTF8')), 'hex');
  v_a      uuid := gen_random_uuid();
  v_b      uuid := gen_random_uuid();
  v_first  boolean;
  v_second boolean;
  v_again  boolean;
  v_owner  uuid;
  v_err    text;
  v_msg    text;
BEGIN
  v_err := NULL; v_msg := NULL;
  BEGIN
    v_first  := public.acquire_mt5_terminal_lease(v_digest, v_a, 'house', 'derive_broker_dailies', 60);
    v_second := public.acquire_mt5_terminal_lease(v_digest, v_b, 'house', 'allocator_holdings', 60);
    v_again  := public.acquire_mt5_terminal_lease(v_digest, v_a, 'house', 'derive_broker_dailies', 60);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF v_err IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (L1): SQLSTATE % from an acquire (%).', v_err, v_msg;
  END IF;
  IF v_first IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'TEST FAILED (L1): the first acquire of a free terminal returned %; nobody could ever take the terminal.', v_first;
  END IF;
  IF v_second IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'TEST FAILED (L1): a second token acquiring a terminal an unexpired token holds returned %; two processes would drive the one terminal at once.', v_second;
  END IF;
  IF v_again IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'TEST FAILED (L1): the holder re-acquiring its own lease returned %; a retried acquire whose answer was lost would be refused its own grant.', v_again;
  END IF;
  SELECT owner_token INTO v_owner FROM public.mt5_terminal_leases WHERE terminal_digest = v_digest;
  IF v_owner IS DISTINCT FROM v_a THEN
    RAISE EXCEPTION 'TEST FAILED (L1): the owner after the contest is % instead of the first holder; the refused token displaced it.', v_owner;
  END IF;
  RAISE NOTICE 'L1 OK: one token at a time; the same token re-acquires.';
END $$;
ROLLBACK;

DO $$ BEGIN
  RAISE NOTICE 'ALL 1 ARMS EXECUTED (L1): a terminal an unexpired token holds refuses a second token and re-grants the holder (L1). Phase 230 MT5D-02.';
END $$;
