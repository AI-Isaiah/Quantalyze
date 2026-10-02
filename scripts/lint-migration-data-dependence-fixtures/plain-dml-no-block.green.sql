-- FIXTURE (green) - plain DML, no anonymous block at all.
--
-- The refusal is scoped to ANONYMOUS BLOCKS, because those are what execute at
-- APPLY time. A top-level idempotent seed carries no guard, raises nothing, and
-- cannot refuse on a data-empty TEST.
--
-- It also pins the scope from the other side: the block scan has to be what
-- finds a guard, not a bare grep for RAISE over the file, or every migration
-- carrying a function body would be swept in.
--
-- This file is a FIXTURE. It is never applied to any database.
BEGIN;

INSERT INTO public.fx_ledger (kind, label)
VALUES ('reference', 'a plain seed')
ON CONFLICT (kind, label) DO NOTHING;

COMMIT;
