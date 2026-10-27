-- ============================================================================
-- allocator_trade_reads / allocator_trade_read_windows: the place a resumable
-- trade read keeps what it has read between worker claims
-- (2026-10-30, Phase 171 READCEILING, plan 03; SC-1, D-02)
-- ============================================================================
--
-- What this is for
-- ----------------
-- An account above the trade-read ceiling used to be refused: the worker read its
-- trade history inside one run, and a book too large for that run was never
-- rebuilt. D-02 (founder 2026-10-27, "Resumable across runs") replaces the refusal:
-- the read position and what has been read are KEPT between runs, each run reads
-- within the existing crawl bound and defers instead of refusing, and a book of any
-- size eventually completes. Nothing is written to the allocator's history until the
-- read is complete. THIS migration is the storage half only: two tables, their value
-- rules, their access rules. Nothing writes to them until the analytics worker of
-- plan 07 deploys.
--
--   public.allocator_trade_reads         one STATE row per api key: grid origin,
--                                        read version, claim and stalled-claim
--                                        counters, the last job id, expiry.
--   public.allocator_trade_read_windows  the compact trades of each COMPLETE 7-day
--                                        window, as numbered chunks of at most 5,000
--                                        trades, each chunk with its own expiry.
--
-- Decisions inside D-02 (Claude's discretion, plan 03)
--   TR-1  What is persisted: the raw compact trades of each COMPLETE 7-day window,
--         positional arrays [timestamp_ms, symbol, side, amount, price, cost,
--         fee_cost] in read order, chunked at 5,000 trades per row so no single
--         request carries more than about 300 KB (the gateway body limit is
--         unmeasured, so the design never depends on it). A chunk count makes a
--         half-written window detectable.
--   TR-2  Service-role only (see the next section).
--   TR-3  Expiry: an expires_at column on both tables (7 days, written by the
--         worker) plus the worker's purges: at claim start, on a successful rebuild,
--         and an hourly sweep from the worker's watchdog loop, which is what removes
--         an idle key's expired rows. No database-scheduled job: this file schedules
--         nothing.
--   TR-4  Venue-agnostic names (allocator_trade_read*, window_*_ms, a venue column
--         with a CHECK to widen), so another venue can adopt the store without a
--         redesign; only 'bybit' is admitted now.
--   TR-5  read_version on both tables: a stored window is reused only by the same
--         read version, so a change to the positional layout or to what is kept can
--         never be read back as the old shape.
--   TR-6  last_job_id (no foreign key; an opaque marker) lets a NEW job start with a
--         fresh stalled-claims count while reusing the stored windows, which is what
--         makes a stall refusal a reason a later run can clear.
--   TR-7  The rollback renames the tables aside and keeps the rows (the keep-data
--         rule). The rows are transient, so a plain removal would also be defensible;
--         it is not chosen without the founder.
--
-- ⛔ SERVICE-ROLE ONLY, ON PURPOSE. D-02 said "owner/service-role". This file narrows
-- that to service-role only: nothing in the browser reads these rows, and an owner
-- policy would expose per-fill trade rows through PostgREST for no consumer. So there
-- is no owner policy, no allocator_id column, no trigger and no SECURITY DEFINER
-- function. service_role has BYPASSRLS, so neither enabling nor forcing row level
-- security can bound the worker (ADR-0001 / ADR-0003: the service_role trust boundary
-- is a role attribute, and a policy cannot gate it). The control is the table
-- privilege: row level security is enabled and forced with ZERO policies, anon and
-- authenticated hold no privilege at all, and service_role holds SELECT, INSERT,
-- UPDATE and DELETE (the counters move and the store is purged) and no TRUNCATE,
-- REFERENCES or TRIGGER. Key and account deletion still erase the rows: a
-- foreign-key cascade runs with the privileges of the table owner, so the SQL gate
-- proves the cascade for both tables and both paths (arms 3 and 4); it is not assumed.
--
-- ⛔ NO DATA CENSUS RUNS INSIDE THIS MIGRATION. Shared TEST holds PROD's catalogue
-- and none of its data, and a failed TEST apply blocks the PROD apply, so the verify
-- block below reads the catalogue only (to_regclass, pg_constraint). It reads no table
-- row. [164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]
--
-- ⛔ DEPLOY ORDER IS NOT ENFORCED. This file applies to TEST and then to PROD on merge
-- through Supabase Migrate, while Railway deploys the worker on green CI in a separate
-- path, so either can land first. An old worker never touches these tables. A new
-- worker that finds them absent reads without the store (the store-fault disposition
-- of plan 04 and the layer-1 fallback of plan 07) until they exist. Plan 12 records
-- the measured order. Nothing is backfilled here.
--
-- Transaction style: NO explicit transaction statements (migration-reviewer
-- invariant 14; Supabase wraps each migration). SET LOCAL lock_timeout applies to
-- that wrap.
--
-- Rollback (manual, off the auto-apply path; it KEEPS every stored row):
-- supabase/migrations/down/20261030120000-rollback.sql
-- ============================================================================

SET LOCAL lock_timeout = '3s';

-- --------------------------------------------------------------------------
-- STEP 1 - the state table: one row per api key.
-- --------------------------------------------------------------------------
CREATE TABLE public.allocator_trade_reads (
  api_key_id      UUID        PRIMARY KEY REFERENCES public.api_keys(id) ON DELETE CASCADE,
  venue           TEXT        NOT NULL,
  grid_origin_ms  BIGINT      NOT NULL,
  read_version    SMALLINT    NOT NULL,
  claims          INTEGER     NOT NULL DEFAULT 0,
  stalled_claims  INTEGER     NOT NULL DEFAULT 0,
  last_job_id     UUID,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  CONSTRAINT allocator_trade_reads_venue_chk
    CHECK (venue IN ('bybit')),
  CONSTRAINT allocator_trade_reads_counts_chk
    CHECK (claims >= 0 AND stalled_claims >= 0),
  CONSTRAINT allocator_trade_reads_version_chk
    CHECK (read_version > 0)
);

-- --------------------------------------------------------------------------
-- STEP 2 - the windows table: the compact trades of each COMPLETE 7-day window as
-- numbered chunks. The array rule is a CASE so the length is only taken of an array
-- (jsonb_array_length raises on any other JSON type, and a CHECK must answer false,
-- not raise a different error).
-- --------------------------------------------------------------------------
CREATE TABLE public.allocator_trade_read_windows (
  api_key_id      UUID        NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
  window_start_ms BIGINT      NOT NULL,
  chunk_index     INTEGER     NOT NULL,
  chunk_count     INTEGER     NOT NULL,
  window_end_ms   BIGINT      NOT NULL,
  read_version    SMALLINT    NOT NULL,
  n_trades        INTEGER     NOT NULL,
  trades          JSONB       NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (api_key_id, window_start_ms, chunk_index),
  CONSTRAINT allocator_trade_read_windows_span_chk
    CHECK (window_end_ms > window_start_ms),
  CONSTRAINT allocator_trade_read_windows_count_chk
    CHECK (n_trades BETWEEN 0 AND 5000),
  CONSTRAINT allocator_trade_read_windows_chunk_chk
    CHECK (chunk_count >= 1 AND chunk_index >= 0 AND chunk_index < chunk_count),
  CONSTRAINT allocator_trade_read_windows_array_chk
    CHECK (CASE WHEN jsonb_typeof(trades) = 'array' THEN jsonb_array_length(trades) = n_trades ELSE false END),
  CONSTRAINT allocator_trade_read_windows_version_chk
    CHECK (read_version > 0)
);

COMMENT ON TABLE public.allocator_trade_reads IS
  'Phase 171 READCEILING (D-02, TR-1..TR-7). One STATE row per API key for a resumable trade read: the grid origin, the read version, how many claims have run and how many of them stalled, the last job id (an opaque marker, no foreign key, so a new job can start with a fresh stalled-claims count while reusing the stored windows) and an expiry. SERVICE-ROLE ONLY by design: row level security is enabled and forced with no policy, anon and authenticated hold no privilege, service_role holds SELECT, INSERT, UPDATE and DELETE. Rows expire after 7 days (expires_at, written by the worker) and are purged by the worker at claim start, on a successful rebuild and by an hourly sweep; no database-scheduled job. Erased with the key and with the account through ON DELETE CASCADE.';

COMMENT ON TABLE public.allocator_trade_read_windows IS
  'Phase 171 READCEILING (D-02, TR-1..TR-7). The compact trades of each COMPLETE 7-day window of a resumable trade read, as numbered chunks of at most 5,000 trades (primary key api_key_id, window_start_ms, chunk_index; chunk_count says how many chunks the window has, so a half-written window is detectable). Each chunk carries its own expiry and the read version that wrote it; a stored window is reused only by the same read version. SERVICE-ROLE ONLY by design: row level security is enabled and forced with no policy, anon and authenticated hold no privilege, service_role holds SELECT, INSERT, UPDATE and DELETE. Erased with the key and with the account through ON DELETE CASCADE.';

COMMENT ON COLUMN public.allocator_trade_reads.api_key_id IS
  'The API key whose trade history is being read. ON DELETE CASCADE from api_keys (and from auth.users through profiles) IS the erasure path: do NOT add a delete-guard trigger. If one is ever added it MUST exempt current_setting(''quantalyze.sanitize_in_progress'', true) = ''on'' or it aborts account deletion.';

COMMENT ON COLUMN public.allocator_trade_reads.last_job_id IS
  'The compute job that last claimed this read. Opaque marker, deliberately NO foreign key: a job row may be purged while the stored windows are still wanted, and a different id here is what lets a new job start with a fresh stalled-claims count (TR-6).';

COMMENT ON COLUMN public.allocator_trade_read_windows.api_key_id IS
  'The API key the window was read for. ON DELETE CASCADE from api_keys (and from auth.users through profiles) IS the erasure path: do NOT add a delete-guard trigger. If one is ever added it MUST exempt current_setting(''quantalyze.sanitize_in_progress'', true) = ''on'' or it aborts account deletion.';

COMMENT ON COLUMN public.allocator_trade_read_windows.trades IS
  'A JSON array of positional arrays [timestamp_ms, symbol, side, amount, price, cost, fee_cost] in read order, exactly n_trades of them (allocator_trade_read_windows_array_chk). The positional order is part of read_version: changing it requires a new version, never a silent reinterpretation of stored rows.';

-- --------------------------------------------------------------------------
-- STEP 3 - row level security. Enabled and forced on both tables, and NO policy,
-- ON PURPOSE: no role but service_role (which bypasses RLS by attribute) may touch
-- these rows, so the empty policy set is the statement, and the grants in STEP 4
-- are the control.
-- --------------------------------------------------------------------------
ALTER TABLE public.allocator_trade_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.allocator_trade_reads FORCE ROW LEVEL SECURITY;
ALTER TABLE public.allocator_trade_read_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.allocator_trade_read_windows FORCE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------------
-- STEP 4 - grants. REVOKE everything first so the result does not depend on the
-- project's default privileges, then grant exactly what the worker needs, in one
-- statement.
-- --------------------------------------------------------------------------
REVOKE ALL ON TABLE public.allocator_trade_reads, public.allocator_trade_read_windows FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.allocator_trade_reads, public.allocator_trade_read_windows TO service_role;

-- ───────────── self-verify: CATALOGUE ONLY, passes on an empty database.
-- No row is read. Deliberately NOT asserted here: the grants, the row-level security
-- flags, the policies, the foreign keys' delete actions and the CHECK bodies. A verify
-- block that checked them would abort the apply of a mutated copy of this file, and
-- the SQL gate that mutates those lines needs that apply to succeed in order to go RED
-- on the behaviour instead.
DO $verify$
BEGIN
  IF to_regclass('public.allocator_trade_reads') IS NULL THEN
    RAISE EXCEPTION 'Migration 20261030120000 failed: public.allocator_trade_reads is missing';
  END IF;
  IF to_regclass('public.allocator_trade_read_windows') IS NULL THEN
    RAISE EXCEPTION 'Migration 20261030120000 failed: public.allocator_trade_read_windows is missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'allocator_trade_reads_pkey'
                    AND conrelid = 'public.allocator_trade_reads'::regclass
                    AND contype = 'p') THEN
    RAISE EXCEPTION 'Migration 20261030120000 failed: the primary key allocator_trade_reads_pkey is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'allocator_trade_read_windows_pkey'
                    AND conrelid = 'public.allocator_trade_read_windows'::regclass
                    AND contype = 'p') THEN
    RAISE EXCEPTION 'Migration 20261030120000 failed: the primary key allocator_trade_read_windows_pkey is missing';
  END IF;

  RAISE NOTICE 'Migration 20261030120000: public.allocator_trade_reads and public.allocator_trade_read_windows exist, each with its named primary key.';
END
$verify$;
