-- Additive stand-in: schema `net` and `net.http_post`, RECORDING the calls it
-- receives instead of merely resolving them. Phase 164.1.1 plan 01, Task 3.
--
-- WHY IT IS NEEDED. `public.prod_prober_cadence_check()`
-- (supabase/migrations/20260918120000_prod_prober_cadence.sql) fires
-- `net.http_post` on a stale tick. plpgsql resolves `net.http_post` at CALL
-- time, so the migration APPLIES on a net-less lane; what it cannot do there is
-- get PAST the call — the arm would die on a raw `undefined_function` /
-- `3F000` (schema "net" does not exist), naming no arm, and criterion 3 (the
-- alarm is OBSERVED, not merely inferred from a SQLSTATE) could not be proven
-- at all. `supabase/tests/test_analytics_service_settings_and_vault_tick.sql`
-- settled for exactly that SQLSTATE as its C1 arm's positive control (arm C1's
-- header, read in full) — this stand-in exists so THIS gate does not have to.
--
-- ⛔ PARAMETER NAMES AND DEFAULTS ARE pg_net's OWN — `url`, `body`, `params`,
-- `headers`, `timeout_milliseconds` — not a convenient subset. The function
-- under test calls `net.http_post(url := …, headers := …, body := …,
-- timeout_milliseconds := …)` with NAMED arguments, and Postgres resolves a
-- named-argument call against the CALLEE's declared parameter names. A
-- stand-in with different names would not be called at all — the arm would
-- then be measuring an overload-resolution failure while reporting on an
-- alarm. Real signature, from the pg_net extension:
--   net.http_post(url text, body jsonb DEFAULT NULL, params jsonb DEFAULT
--                 '{}'::jsonb, headers jsonb DEFAULT
--                 '{"Content-Type": "application/json"}'::jsonb,
--                 timeout_milliseconds int DEFAULT 5000) RETURNS bigint
--
-- WHAT IT DOES AND DOES NOT PROVE (the fixtures/ contract, run.sh:69-77). It is
-- the fixture author's MODEL of pg_net, not pg_net: it proves the caller built
-- the right url, path, header set and body — the arm reads `net._lane_posts`
-- back and asserts on those columns — and it proves NOTHING about pg_net's own
-- asynchrony, retry, queuing or response handling. `net._http_response` is
-- deliberately NOT modelled here: reading a response back is the `cron-obs`
-- prober arm's question against PROD, not this gate's — this gate proves the
-- REQUEST was built and sent, not what came back.
--
-- ⛔ NEVER APPLIED TO TEST OR PROD. Both carry the real `pg_net` extension; this
-- file would shadow it with a table that swallows every outbound call project-
-- wide. It exists only inside `scripts/pg-lane/run.sh`'s throwaway cluster,
-- reached only by gates that name it in their own RED-UNDER-SETUP, and is
-- destroyed by the lane's EXIT trap in every outcome (the
-- 32-fixture-vault-stand-in.sql:21-26 statement of the same contract).
--
-- Never a second base: 01-fixture-core.sql remains the only destructive
-- fixture. This file creates one schema, one recording table and one function;
-- it removes nothing.

CREATE SCHEMA IF NOT EXISTS net;

CREATE TABLE IF NOT EXISTS net._lane_posts (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  url                  TEXT NOT NULL,
  body                 JSONB,
  params               JSONB,
  headers              JSONB,
  timeout_milliseconds INTEGER,
  called_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION net.http_post(
  url                  TEXT,
  body                 JSONB DEFAULT NULL,
  params               JSONB DEFAULT '{}'::jsonb,
  headers              JSONB DEFAULT '{"Content-Type": "application/json"}'::jsonb,
  timeout_milliseconds INT DEFAULT 5000
) RETURNS BIGINT
LANGUAGE plpgsql
AS $lane_http_post$
DECLARE
  v_id BIGINT;
BEGIN
  INSERT INTO net._lane_posts (url, body, params, headers, timeout_milliseconds)
  VALUES (url, body, params, headers, timeout_milliseconds)
  RETURNING id INTO v_id;
  -- The real pg_net returns the QUEUED REQUEST's id, an ordinary-looking
  -- bigint whether or not the request ever lands — the exact async property
  -- `match_engine_cron_tick()`'s own comment names. Returning the recording
  -- row's own id keeps that shape: a caller reading the return value alone
  -- cannot tell this stand-in from the real extension.
  RETURN v_id;
END
$lane_http_post$;
