-- RED FIXTURE for R4-tgtype-bitmask-completeness (mechanism 4).
--
-- The arm claims a BEFORE INSERT OR UPDATE FOR EACH ROW trigger but tests only
-- bit 16 (UPDATE). Narrow the real trigger to `BEFORE UPDATE ON ...` and every
-- remaining term is still satisfied — tgtype still has bit 16 set — so the arm
-- stays GREEN through exactly the change it exists to catch. The INSERT half is
-- what stops a grant-bypassing role landing a fresh row at a starting
-- generation with a nonce of its own choosing, so its loss is the whole
-- delete-and-recreate resurrection family, silently.
--
-- Canonical bits: ROW=1, BEFORE=2, INSERT=4, DELETE=8, UPDATE=16, TRUNCATE=32.
DO $$
DECLARE
  row_cnt integer;
BEGIN
  SELECT count(*) INTO row_cnt
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.strategy_shares'::regclass
     AND NOT t.tgisinternal
     AND t.tgname = 'strategy_shares_monotonic_generation'
     AND (t.tgtype & 16) = 16;

  IF row_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (FIXTURE R4): expected exactly 1 BEFORE INSERT OR UPDATE FOR EACH ROW trigger named strategy_shares_monotonic_generation on strategy_shares, found %', row_cnt;
  END IF;
END $$;
