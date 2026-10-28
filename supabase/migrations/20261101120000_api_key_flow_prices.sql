-- ============================================================================
-- api_key_flow_prices: the place a resolved at-instant price is kept, once, so a
-- moved Deribit flow is never re-read from the exchange
-- (2026-11-01, Phase 177 DERIBITFLOWS, plan 02; SC-3, D-04, D-05)
-- ============================================================================
--
-- What this is for
-- ----------------
-- A Deribit deposit or withdrawal that moved the mark is counted at the price of its
-- own instant (D-04): the open of the 1-minute {CCY}_USDC-PERPETUAL candle that
-- contains it. That candle is the perpetual's traded price, not Deribit's index. D-05
-- (founder 2026-10-28, "Refuse + store prices") says each resolved price is stored once
-- and reused on every later derive, so an old flow is never re-read from the exchange
-- and a derive never has to price a flow it priced before. THIS migration is the storage
-- half only: one table, its value rules, its access rule. Nothing writes to it until the
-- analytics worker of plan 03 deploys, and nothing is backfilled: the first derive after
-- deploy that moves a flow writes the rows it needs.
--
--   public.api_key_flow_prices   one row per (api key, instrument, candle minute): the
--                                candle open, the rule it was read under, when it was
--                                stored.
--
-- Decisions inside D-05 (the planner's call, plan 02)
--   FP-1  PER KEY, not global and not per owner. The set of stored minutes is the timing
--         of a user's deposits and withdrawals, so it must erase with the key and with
--         the account; every derive path already holds the key id.
--   FP-2  instrument stores what was read ({CCY}_USDC-PERPETUAL), minute_ms the candle's
--         tick (a multiple of 60000), price the candle open as NUMERIC, source a closed
--         set with one member (D-04), so a price stored under another rule is never
--         read as this one.
--   FP-3  Write-once is the GRANT (SELECT and INSERT to service_role only), and the
--         primary key is the arbiter of the worker's ON CONFLICT DO NOTHING. No other
--         index, no surrogate id, no expiry column, no cron.
--   FP-4  Not exported in the GDPR Art. 15 export: a derived cache of a public market
--         price, keyed by an api key only (the Phase 171 store is the precedent).
--   FP-5  No retention bound. Rows live until the key or account cascade removes them;
--         a time-to-live would bring back the re-read the store exists to avoid.
--   FP-6  The rollback renames the table aside and keeps every row (the keep-data rule).
--
-- ⛔ SERVICE-ROLE ONLY, ON PURPOSE. Nothing in the browser reads these rows, so there is
-- no owner policy, no user-owner column, no trigger and no function. service_role has
-- BYPASSRLS, so neither enabling nor forcing row level security can bound the worker
-- (ADR-0001 / ADR-0003: the service_role trust boundary is a role attribute, and a policy
-- cannot gate it). The control is the table privilege: row level security is enabled and
-- forced with ZERO policies, anon and authenticated hold no privilege at all, and
-- service_role holds SELECT and INSERT and nothing else.
--
-- ⛔ WRITE-ONCE IS A GRANT, NOT A POLICY. Because a policy cannot gate service_role, the
-- only way to make a stored price immutable for the worker is to withdraw UPDATE, DELETE
-- and TRUNCATE from it (the api_key_nav_marks precedent). The worker writes ON CONFLICT
-- DO NOTHING, which needs INSERT alone. Key and account deletion still erase the rows: a
-- foreign-key cascade runs with the privileges of the table owner, not of the caller, so
-- withdrawing DELETE from service_role does not block it. The SQL gate proves exactly
-- that (arm 6); it is not assumed.
--
-- ⛔ NO DATA CENSUS RUNS INSIDE THIS MIGRATION. Shared TEST holds PROD's catalogue and
-- none of its data, and a failed TEST apply blocks the PROD apply, so the verify block
-- below reads the catalogue only (to_regclass, pg_constraint). It reads no table row.
-- [164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]
--
-- ⛔ DEPLOY ORDER IS NOT ENFORCED. This file applies to TEST and then to PROD on merge
-- through Supabase Migrate, while Railway deploys the worker on green CI in a separate
-- path, so either can land first. An old worker never touches the table. A new worker
-- that finds it absent gets a database error on its read, which plan 04 turns into a
-- transient retry, so it never prices a flow without the store. Only derives that move
-- an INDEXED Deribit flow touch it.
--
-- Transaction style: NO explicit transaction statements (migration-reviewer
-- invariant 14; Supabase wraps each migration). SET LOCAL lock_timeout applies to
-- that wrap.
--
-- No function is replaced: no existing object is touched, so the re-base rule for a
-- replaced definition is met vacuously. delete_allocator_api_key needs no edit because
-- the cascade follows the key.
--
-- Rollback (manual, off the auto-apply path; it KEEPS every stored row):
-- supabase/migrations/down/20261101120000-rollback.sql
-- ============================================================================

SET LOCAL lock_timeout = '3s';

-- --------------------------------------------------------------------------
-- STEP 1 - the table: one row per (api key, instrument, candle minute). Every value
-- rule is a NAMED constraint so the SQL gate can say which one a refusal came from.
-- The price rule has both halves because a numeric NaN sorts above every number, so
-- a plain "greater than zero" test would admit it.
-- --------------------------------------------------------------------------
CREATE TABLE public.api_key_flow_prices (
  api_key_id  UUID        NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
  instrument  TEXT        NOT NULL,
  minute_ms   BIGINT      NOT NULL,
  price       NUMERIC     NOT NULL,
  source      TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (api_key_id, instrument, minute_ms),
  CONSTRAINT api_key_flow_prices_instrument_chk
    CHECK (instrument ~ '^[A-Z0-9]{2,10}_USDC-PERPETUAL$'),
  CONSTRAINT api_key_flow_prices_minute_chk
    CHECK (minute_ms > 0 AND minute_ms % 60000 = 0),
  CONSTRAINT api_key_flow_prices_price_chk
    CHECK (price NOT IN ('NaN', 'Infinity', '-Infinity') AND price > 0),
  CONSTRAINT api_key_flow_prices_source_chk
    CHECK (source IN ('deribit_perp_1m_open'))
);

COMMENT ON TABLE public.api_key_flow_prices IS
  'Phase 177 DERIBITFLOWS (D-04, D-05, FP-1..FP-5). One row per API key, perpetual instrument and candle minute: the open of the 1-minute {CCY}_USDC-PERPETUAL candle that contained a Deribit deposit or withdrawal which moved the mark, stored once and reused so an old flow is never re-read from the exchange. The candle is the perpetual''s traded price, not Deribit''s index. WRITE-ONCE: service_role holds SELECT and INSERT only (no UPDATE, DELETE or TRUNCATE), and the worker writes ON CONFLICT DO NOTHING. SERVICE-ROLE ONLY by design: row level security is enabled and forced with no policy, anon and authenticated hold no privilege, and no UI reads the rows. Per key, because the stored minutes are the timing of a user''s flows: erased with the key and with the account through ON DELETE CASCADE. Nothing is backfilled and the table is not part of the GDPR export (a derived cache of a public price keyed by an api key only).';

COMMENT ON COLUMN public.api_key_flow_prices.api_key_id IS
  'The API key whose derive needed the price. ON DELETE CASCADE from api_keys (and from auth.users through profiles) IS the erasure path: do NOT add a delete-guard trigger. If one is ever added it MUST exempt current_setting(''quantalyze.sanitize_in_progress'', true) = ''on'' or it aborts account deletion.';

COMMENT ON COLUMN public.api_key_flow_prices.minute_ms IS
  'The candle tick in epoch milliseconds: the START of the minute that contains the flow, always a multiple of 60000.';

COMMENT ON COLUMN public.api_key_flow_prices.price IS
  'The candle OPEN, in the quote currency of the instrument (USDC), as read from the exchange. It is the perpetual''s traded price, not Deribit''s index.';

COMMENT ON COLUMN public.api_key_flow_prices.source IS
  'The rule the price was read under; a closed set, today deribit_perp_1m_open. A price read under a different rule needs a new value here AND a wider primary key that includes this column (and the worker''s conflict target with it), never a second value stored beside the current key.';

-- --------------------------------------------------------------------------
-- STEP 2 - row level security. Enabled and forced, and NO policy, ON PURPOSE: no role
-- but service_role (which bypasses RLS by attribute) may touch these rows, so the empty
-- policy set is the statement, and the grants in STEP 3 are the control.
-- --------------------------------------------------------------------------
ALTER TABLE public.api_key_flow_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_key_flow_prices FORCE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------------
-- STEP 3 - grants. REVOKE everything first so the result does not depend on the
-- project's default privileges, then grant exactly what the worker needs, in one
-- statement.
-- --------------------------------------------------------------------------
REVOKE ALL ON TABLE public.api_key_flow_prices FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.api_key_flow_prices TO service_role;

-- ───────────── self-verify: CATALOGUE ONLY, passes on an empty database.
-- No row is read. Deliberately NOT asserted here: the grants, the row-level security
-- flags, the policies, the foreign key's delete action and the CHECK bodies. A verify
-- block that checked them would abort the apply of a mutated copy of this file, and
-- the SQL gate that mutates those lines needs that apply to succeed in order to go RED
-- on the behaviour instead.
DO $verify$
BEGIN
  IF to_regclass('public.api_key_flow_prices') IS NULL THEN
    RAISE EXCEPTION 'Migration 20261101120000 failed: public.api_key_flow_prices is missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'api_key_flow_prices_pkey'
                    AND conrelid = 'public.api_key_flow_prices'::regclass
                    AND contype = 'p') THEN
    RAISE EXCEPTION 'Migration 20261101120000 failed: the primary key api_key_flow_prices_pkey is missing';
  END IF;

  RAISE NOTICE 'Migration 20261101120000: public.api_key_flow_prices exists with its named primary key.';
END
$verify$;
