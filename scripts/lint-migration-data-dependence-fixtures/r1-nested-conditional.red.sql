-- FIXTURE (red) - R1-variable-conditioned-raise, NESTED spelling.
--
-- The data-derived condition is the OUTER conditional and the RAISE sits one
-- level further in. The dependence is identical; only the indentation moved.
-- A refusal that only sees the raise at the block's top level is a refusal a
-- future author routes around by accident, which is why this spelling has its
-- own fixture rather than being assumed covered.
--
-- This file is a FIXTURE. It is never applied to any database.
BEGIN;

DO $fixture$
DECLARE
  v_rows INTEGER;
  v_mode TEXT;
BEGIN
  SELECT count(*) INTO v_rows FROM public.fx_ledger;
  v_mode := current_setting('server_version_num', true);

  IF v_rows = 0 THEN
    IF v_mode IS NOT NULL THEN
      RAISE EXCEPTION 'fixture: the ledger is empty at apply time';
    END IF;
  END IF;
END
$fixture$;

COMMIT;
