-- KPI-17 follow-up: positions.duration_days from INTEGER to NUMERIC.
-- Sub-day-held positions used to int-truncate to 0 days
-- (`int(seconds/86400)` for any sub-day window). Storing fractional days
-- lets `round((close - open) / 86400, 4)` survive the upsert and produces
-- a non-zero avg_duration_days for intraday strategies. NUMERIC is a
-- super-type of INTEGER so existing readers that expect ints continue
-- to work; new readers can consume fractional days where it matters.

ALTER TABLE public.positions
  ALTER COLUMN duration_days TYPE NUMERIC USING duration_days::NUMERIC;

COMMENT ON COLUMN public.positions.duration_days IS
  'Days from opened_at to closed_at as NUMERIC (fractional days for sub-day holds). NULL while open. Computed on close.';
