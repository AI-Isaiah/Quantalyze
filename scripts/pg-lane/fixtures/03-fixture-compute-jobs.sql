-- Additive stand-ins for the relations the compute-jobs queue migrations name
-- as DEPENDENCIES and no migration in the apply list creates. Column sets are
-- only what the code under test references — nothing else. Never a second base:
-- 01-fixture-core.sql is the only destructive fixture.

-- compute_jobs.portfolio_id REFERENCES portfolios(id)
-- (20260411144407_compute_jobs_queue.sql:109). 02-fixture-sanitize-tables.sql
-- creates `portfolios` for sanitize_user, which names only user_id/name/
-- description, so it carries no key for the FK to point at.
ALTER TABLE portfolios ADD COLUMN IF NOT EXISTS id UUID NOT NULL DEFAULT gen_random_uuid();
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.portfolios'::regclass AND contype = 'p'
  ) THEN
    ALTER TABLE portfolios ADD CONSTRAINT portfolios_pkey PRIMARY KEY (id);
  END IF;
END
$$;

-- strategy_keys.api_key_id REFERENCES public.api_keys(id)
-- (20260710120000_strategy_keys.sql:33). 02-fixture-sanitize-tables.sql creates
-- `api_keys` for sanitize_user, which names only user_id.
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS id UUID NOT NULL DEFAULT gen_random_uuid();
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.api_keys'::regclass AND contype = 'p'
  ) THEN
    ALTER TABLE api_keys ADD CONSTRAINT api_keys_pkey PRIMARY KEY (id);
  END IF;
END
$$;

-- strategy_analytics: named as a DEPENDENCY by the ledger-refresh migrations
-- (20260825120000 STEP 5 ALTERs it; the staleness view reads sa.computed_at /
-- computation_status / returns_series) and by their gates. Only the columns
-- those bodies name — the objects UNDER TEST are the real views and RPCs from
-- the migrations, never this table.
CREATE TABLE IF NOT EXISTS strategy_analytics (
  strategy_id          UUID PRIMARY KEY,
  computation_status   TEXT,
  computed_at          TIMESTAMPTZ,
  computing_started_at TIMESTAMPTZ,
  returns_series       JSONB
);

-- Columns the ledger-refresh staleness view names on api_keys / strategies.
-- Only the ones the view body and its gates read.
ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS exchange        TEXT,
  ADD COLUMN IF NOT EXISTS is_active       BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS sync_status     TEXT,
  ADD COLUMN IF NOT EXISTS disconnected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_sync_at    TIMESTAMPTZ;
ALTER TABLE strategies
  ADD COLUMN IF NOT EXISTS api_key_id UUID;

-- strategy_analytics_series: the staleness view LEFT JOINs it for the
-- daily_returns_grid write timestamp. Only the three columns it reads.
CREATE TABLE IF NOT EXISTS strategy_analytics_series (
  strategy_id UUID,
  kind        TEXT,
  computed_at TIMESTAMPTZ
);

-- Columns the ledger-refresh gates' own seed INSERTs name on api_keys.
ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS label             TEXT,
  ADD COLUMN IF NOT EXISTS api_key_encrypted TEXT;
