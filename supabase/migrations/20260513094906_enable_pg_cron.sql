-- Enable the pg_cron extension on the target database.
--
-- This file was restored to reconcile the test project's schema_migrations
-- table (qmnijlgmdhviwzwfyzlc), which had a row at version 20260513094906
-- named `121a_enable_pg_cron` with the body preserved in statements[] but no
-- matching local file. The row was originally inserted out-of-band before
-- migration 121 (retention_crons_safe) registers cron jobs that require the
-- extension.
--
-- Future `supabase db push` runs see matching version on both sides and skip
-- the DDL (idempotent — CREATE EXTENSION IF NOT EXISTS is a no-op when the
-- extension is already installed). On prod, this migration is also a no-op
-- because pg_cron is already enabled there too.
--
-- Mirrors the PR-Y2 mini pattern used by PR #174 for migration 092.

CREATE EXTENSION IF NOT EXISTS pg_cron;
