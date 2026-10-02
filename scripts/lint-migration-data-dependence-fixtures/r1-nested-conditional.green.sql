-- FIXTURE (green) - R1-variable-conditioned-raise, NESTED spelling, catalogue read.
--
-- Byte-for-byte the nesting of its red twin, with the only difference that
-- matters: the variable the outer conditional tests came from the CATALOGUE.
-- Nesting is not the refused property, so this one is allowed.
--
-- This file is a FIXTURE. It is never applied to any database.
BEGIN;

DO $fixture$
DECLARE
  v_rows INTEGER;
  v_mode TEXT;
BEGIN
  SELECT count(*) INTO v_rows FROM pg_catalog.pg_class WHERE relname = 'fx_ledger';
  v_mode := current_setting('server_version_num', true);

  IF v_rows = 0 THEN
    IF v_mode IS NOT NULL THEN
      RAISE EXCEPTION 'fixture: public.fx_ledger is absent from the catalogue';
    END IF;
  END IF;
END
$fixture$;

COMMIT;
