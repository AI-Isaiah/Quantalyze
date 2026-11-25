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
--   L2  An expired lease is taken over by a new token; the old token's renew is false.
--   L3  A foreign release changes nothing; the holder's release frees the row (owner
--       NULL); a release by a token that lost the lease is refused.
--   L4  Renew is token-fenced and extends expires_at; a renew after the release is
--       false and leaves the row free.
--   L7  Distinct terminals are independent.
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

-- --------------------------------------------------------------------------
-- L2 - an expired lease is taken over, and the old token is then dead for renew.
-- RED-UNDER: drop the expiry disjunct (`OR l.expires_at <= now()`) from the DO UPDATE
--            WHERE condition of acquire_mt5_terminal_lease in
--            20261126120000_mt5_terminal_lease.sql. A lease whose holder crashed is
--            never free again: the second token's takeover is refused, which is this
--            arm's first raise.
-- RED-UNDER-M: {"arm":"L2","apply":[{"kind":"edit","file":"supabase/migrations/20261126120000_mt5_terminal_lease.sql","find":"      OR l.expires_at <= now()\n","replace":"","occurrences":1}]}
-- --------------------------------------------------------------------------
BEGIN;
DO $$
DECLARE
  v_digest text := encode(sha256(convert_to('230-L2', 'UTF8')), 'hex');
  v_a      uuid := gen_random_uuid();
  v_b      uuid := gen_random_uuid();
  v_held   boolean;
  v_take   boolean;
  v_renew  boolean;
  v_owner  uuid;
  v_err    text;
  v_msg    text;
BEGIN
  v_err := NULL; v_msg := NULL;
  BEGIN
    v_held := public.acquire_mt5_terminal_lease(v_digest, v_a, 'house', 'derive_broker_dailies', 60);
    -- now() is frozen inside one transaction: stage the crash by back-dating THIS arm's own row.
    UPDATE public.mt5_terminal_leases
       SET expires_at = now() - interval '1 second'
     WHERE terminal_digest = v_digest;
    v_take  := public.acquire_mt5_terminal_lease(v_digest, v_b, 'house', 'allocator_holdings', 60);
    v_renew := public.renew_mt5_terminal_lease(v_digest, v_a, 60);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF v_err IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (L2): SQLSTATE % from an acquire or a renew (%).', v_err, v_msg;
  END IF;
  IF v_held IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'TEST FAILED (L2): setup: the first acquire returned %, so the arm measured nothing.', v_held;
  END IF;
  IF v_take IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'TEST FAILED (L2): a second token acquiring an EXPIRED lease returned %; a crashed holder would wedge the terminal for good.', v_take;
  END IF;
  IF v_renew IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'TEST FAILED (L2): the displaced token renewing the lease returned %; a stale holder would keep extending a lease it no longer owns.', v_renew;
  END IF;
  SELECT owner_token INTO v_owner FROM public.mt5_terminal_leases WHERE terminal_digest = v_digest;
  IF v_owner IS DISTINCT FROM v_b THEN
    RAISE EXCEPTION 'TEST FAILED (L2): the owner after the takeover is % instead of the new token.', v_owner;
  END IF;
  RAISE NOTICE 'L2 OK: an expired lease was taken over and the old token cannot renew it.';
END $$;
ROLLBACK;

-- --------------------------------------------------------------------------
-- L3 - a foreign release changes nothing; the holder's own release frees the row;
--      after a takeover the old token's release is refused.
-- RED-UNDER: drop the token predicate (`AND owner_token = p_owner_token`) from the
--            UPDATE of release_mt5_terminal_lease in
--            20261126120000_mt5_terminal_lease.sql. Any token can now free any
--            lease: the foreign release reports true and frees the row, which is
--            this arm's first raise. (L1 and L2 never call release, so they stay
--            green; the stale-token release is asserted HERE and not in L2 for that
--            reason, so this twin, and not an earlier arm, is the first failure.)
-- RED-UNDER-M: {"arm":"L3","apply":[{"kind":"edit","file":"supabase/migrations/20261126120000_mt5_terminal_lease.sql","find":"         expires_at  = now()\n   WHERE terminal_digest = p_terminal_digest\n     AND owner_token = p_owner_token;","replace":"         expires_at  = now()\n   WHERE terminal_digest = p_terminal_digest;","occurrences":1}]}
-- --------------------------------------------------------------------------
BEGIN;
DO $$
DECLARE
  v_digest  text := encode(sha256(convert_to('230-L3', 'UTF8')), 'hex');
  v_a       uuid := gen_random_uuid();
  v_b       uuid := gen_random_uuid();
  v_held    boolean;
  v_foreign boolean;
  v_before  text;
  v_after   text;
  v_own     boolean;
  v_owner   uuid;
  v_retake  boolean;
  v_stale   boolean;
  v_owner2  uuid;
  v_err     text;
  v_msg     text;
BEGIN
  v_err := NULL; v_msg := NULL;
  BEGIN
    v_held := public.acquire_mt5_terminal_lease(v_digest, v_a, 'house', 'derive_broker_dailies', 60);
    SELECT l::text INTO v_before FROM public.mt5_terminal_leases l WHERE l.terminal_digest = v_digest;
    v_foreign := public.release_mt5_terminal_lease(v_digest, v_b);
    SELECT l::text INTO v_after FROM public.mt5_terminal_leases l WHERE l.terminal_digest = v_digest;
    v_own := public.release_mt5_terminal_lease(v_digest, v_a);
    SELECT owner_token INTO v_owner FROM public.mt5_terminal_leases WHERE terminal_digest = v_digest;
    v_retake := public.acquire_mt5_terminal_lease(v_digest, v_b, 'house', 'allocator_holdings', 60);
    v_stale := public.release_mt5_terminal_lease(v_digest, v_a);
    SELECT owner_token INTO v_owner2 FROM public.mt5_terminal_leases WHERE terminal_digest = v_digest;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF v_err IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (L3): SQLSTATE % from an acquire or a release (%).', v_err, v_msg;
  END IF;
  IF v_held IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'TEST FAILED (L3): setup: the first acquire returned %, so the arm measured nothing.', v_held;
  END IF;
  IF v_foreign IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'TEST FAILED (L3): a release with a token that does not hold the lease returned %; any process could free another process''s terminal.', v_foreign;
  END IF;
  IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'TEST FAILED (L3): a refused foreign release changed the row (before %, after %).', v_before, v_after;
  END IF;
  IF v_own IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'TEST FAILED (L3): the holder releasing its own lease returned %; the terminal could never be handed over.', v_own;
  END IF;
  IF v_owner IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (L3): after its holder released it the lease still carries owner token %; a late renew could resurrect it.', v_owner;
  END IF;
  IF v_retake IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'TEST FAILED (L3): a released lease was refused to the next token (returned %).', v_retake;
  END IF;
  IF v_stale IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'TEST FAILED (L3): the first holder''s release after the lease was handed on returned %; a stale holder could free the new holder''s lease.', v_stale;
  END IF;
  IF v_owner2 IS DISTINCT FROM v_b THEN
    RAISE EXCEPTION 'TEST FAILED (L3): after a stale release the owner is % instead of the new holder.', v_owner2;
  END IF;
  RAISE NOTICE 'L3 OK: a foreign release changed nothing, the own release freed the row, a stale release was refused.';
END $$;
ROLLBACK;

-- --------------------------------------------------------------------------
-- L4 - renew is fenced by the token, and never resurrects a released lease.
-- RED-UNDER: let the renew UPDATE of renew_mt5_terminal_lease in
--            20261126120000_mt5_terminal_lease.sql also match a row whose owner
--            token is NULL (`AND (owner_token = p_owner_token OR owner_token IS NULL)`).
--            A renew landing after the release now re-leases the freed row for a
--            whole TTL with nobody holding it: this arm's first raise. (The release
--            that keeps the owner token is the same hazard from the other side; it
--            is caught earlier, by L3's owner-NULL check, so L3 owns it.)
-- RED-UNDER-M: {"arm":"L4","apply":[{"kind":"edit","file":"supabase/migrations/20261126120000_mt5_terminal_lease.sql","find":"     SET expires_at = now() + make_interval(secs => p_ttl_s)\n   WHERE terminal_digest = p_terminal_digest\n     AND owner_token = p_owner_token;","replace":"     SET expires_at = now() + make_interval(secs => p_ttl_s)\n   WHERE terminal_digest = p_terminal_digest\n     AND (owner_token = p_owner_token OR owner_token IS NULL);","occurrences":1}]}
-- --------------------------------------------------------------------------
BEGIN;
DO $$
DECLARE
  v_digest   text := encode(sha256(convert_to('230-L4', 'UTF8')), 'hex');
  v_a        uuid := gen_random_uuid();
  v_b        uuid := gen_random_uuid();
  v_held     boolean;
  v_exp0     timestamptz;
  v_own      boolean;
  v_exp1     timestamptz;
  v_foreign  boolean;
  v_exp2     timestamptz;
  v_rel      boolean;
  v_late     boolean;
  v_owner    uuid;
  v_err      text;
  v_msg      text;
BEGIN
  v_err := NULL; v_msg := NULL;
  BEGIN
    v_held := public.acquire_mt5_terminal_lease(v_digest, v_a, 'house', 'derive_broker_dailies', 60);
    SELECT expires_at INTO v_exp0 FROM public.mt5_terminal_leases WHERE terminal_digest = v_digest;
    v_own := public.renew_mt5_terminal_lease(v_digest, v_a, 300);
    SELECT expires_at INTO v_exp1 FROM public.mt5_terminal_leases WHERE terminal_digest = v_digest;
    v_foreign := public.renew_mt5_terminal_lease(v_digest, v_b, 900);
    SELECT expires_at INTO v_exp2 FROM public.mt5_terminal_leases WHERE terminal_digest = v_digest;
    v_rel := public.release_mt5_terminal_lease(v_digest, v_a);
    v_late := public.renew_mt5_terminal_lease(v_digest, v_a, 300);
    SELECT owner_token INTO v_owner FROM public.mt5_terminal_leases WHERE terminal_digest = v_digest;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF v_err IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (L4): SQLSTATE % from an acquire, renew or release (%).', v_err, v_msg;
  END IF;
  IF v_held IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'TEST FAILED (L4): setup: the first acquire returned %, so the arm measured nothing.', v_held;
  END IF;
  IF v_own IS DISTINCT FROM TRUE OR v_exp1 <= v_exp0 THEN
    RAISE EXCEPTION 'TEST FAILED (L4): the holder renewing its own lease returned % and moved expires_at from % to %; a long derive read would lose the terminal mid-read.', v_own, v_exp0, v_exp1;
  END IF;
  IF v_foreign IS DISTINCT FROM FALSE OR v_exp2 IS DISTINCT FROM v_exp1 THEN
    RAISE EXCEPTION 'TEST FAILED (L4): a renew with a token that does not hold the lease returned % and left expires_at at % (was %); a stranger could extend another process''s lease.', v_foreign, v_exp2, v_exp1;
  END IF;
  IF v_rel IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'TEST FAILED (L4): setup: the holder''s own release returned %, so the arm measured nothing.', v_rel;
  END IF;
  IF v_late IS DISTINCT FROM FALSE OR v_owner IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (L4): a renew that landed after the release returned % and left owner token %; the terminal would look held for a whole TTL with nobody using it.', v_late, v_owner;
  END IF;
  RAISE NOTICE 'L4 OK: renew is token-fenced and a late renew cannot resurrect a released lease.';
END $$;
ROLLBACK;

-- --------------------------------------------------------------------------
-- L7 - distinct terminals are independent: releasing one never frees another.
-- RED-UNDER: replace the digest predicate of the UPDATE in
--            release_mt5_terminal_lease in 20261126120000_mt5_terminal_lease.sql with
--            `WHERE owner_token = p_owner_token`. A holder of two terminals under
--            one token releasing one now frees both: this arm's first raise.
-- RED-UNDER-M: {"arm":"L7","apply":[{"kind":"edit","file":"supabase/migrations/20261126120000_mt5_terminal_lease.sql","find":"         expires_at  = now()\n   WHERE terminal_digest = p_terminal_digest\n     AND owner_token = p_owner_token;","replace":"         expires_at  = now()\n   WHERE owner_token = p_owner_token;","occurrences":1}]}
-- --------------------------------------------------------------------------
BEGIN;
DO $$
DECLARE
  v_x      text := encode(sha256(convert_to('230-L7-x', 'UTF8')), 'hex');
  v_y      text := encode(sha256(convert_to('230-L7-y', 'UTF8')), 'hex');
  v_z      text := encode(sha256(convert_to('230-L7-z', 'UTF8')), 'hex');
  v_a      uuid := gen_random_uuid();
  v_b      uuid := gen_random_uuid();
  v_ax     boolean;
  v_ay     boolean;
  v_bz     boolean;
  v_rel    boolean;
  v_bx     boolean;
  v_owner  uuid;
  v_err    text;
  v_msg    text;
BEGIN
  v_err := NULL; v_msg := NULL;
  BEGIN
    v_ax := public.acquire_mt5_terminal_lease(v_x, v_a, 'house', 'derive_broker_dailies', 60);
    v_ay := public.acquire_mt5_terminal_lease(v_y, v_a, 'house', 'derive_broker_dailies', 60);
    v_bz := public.acquire_mt5_terminal_lease(v_z, v_b, 'house', 'allocator_holdings', 60);
    v_rel := public.release_mt5_terminal_lease(v_y, v_a);
    v_bx := public.acquire_mt5_terminal_lease(v_x, v_b, 'house', 'allocator_holdings', 60);
    SELECT owner_token INTO v_owner FROM public.mt5_terminal_leases WHERE terminal_digest = v_x;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF v_err IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (L7): SQLSTATE % from an acquire or a release (%).', v_err, v_msg;
  END IF;
  IF v_ax IS DISTINCT FROM TRUE OR v_ay IS DISTINCT FROM TRUE OR v_bz IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'TEST FAILED (L7): acquires of three distinct terminals returned % / % / %; a lease on one terminal blocked another.', v_ax, v_ay, v_bz;
  END IF;
  IF v_rel IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'TEST FAILED (L7): setup: releasing the second terminal returned %, so the arm measured nothing.', v_rel;
  END IF;
  IF v_bx IS DISTINCT FROM FALSE OR v_owner IS DISTINCT FROM v_a THEN
    RAISE EXCEPTION 'TEST FAILED (L7): after releasing a DIFFERENT terminal, taking the first one returned % and its owner is %; a release of one terminal freed another.', v_bx, v_owner;
  END IF;
  RAISE NOTICE 'L7 OK: distinct terminals are independent.';
END $$;
ROLLBACK;

DO $$ BEGIN
  RAISE NOTICE 'ALL 5 ARMS EXECUTED (L1,L2,L3,L4,L7): a terminal an unexpired token holds refuses a second token and re-grants the holder (L1); an expired lease is taken over and the old token cannot renew it (L2); a foreign release changes nothing, the own release frees the row and a stale release is refused (L3); renew is token-fenced and a late renew cannot resurrect a released lease (L4); distinct terminals are independent (L7). Phase 230 MT5D-02.';
END $$;
