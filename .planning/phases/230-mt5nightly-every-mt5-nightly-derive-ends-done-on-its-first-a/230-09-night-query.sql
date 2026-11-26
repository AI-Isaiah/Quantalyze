WITH win AS (
  SELECT :'night_start'::timestamptz AS s, :'night_end'::timestamptz AS e
), mt5 AS (
  SELECT ak.id FROM public.api_keys ak WHERE ak.exchange = 'mt5'
), jobs AS (
  SELECT cj.id, cj.status, cj.attempts
    FROM public.compute_jobs cj, win
   WHERE cj.kind = 'derive_broker_dailies'
     AND cj.created_at >= win.s AND cj.created_at < win.e
     AND (
          cj.api_key_id IN (SELECT id FROM mt5)
       OR cj.strategy_id IN (SELECT st.id FROM public.strategies st WHERE st.api_key_id IN (SELECT id FROM mt5))
       OR cj.strategy_id IN (SELECT sk.strategy_id FROM public.strategy_keys sk WHERE sk.api_key_id IN (SELECT id FROM mt5))
     )
)
SELECT
  (SELECT count(*) FROM jobs) AS jobs,
  (SELECT count(*) FROM jobs WHERE status = 'done') AS done,
  (SELECT count(*) FROM jobs WHERE status = 'done' AND attempts = 1) AS done_first_attempt,
  (SELECT count(*) FROM jobs WHERE attempts > 1) AS second_attempts,
  (SELECT count(*) FROM jobs WHERE status <> 'done') AS not_done,
  (SELECT count(*) FROM public.compute_job_attempt_failures f WHERE f.job_id IN (SELECT id FROM jobs)) AS ledger_rows,
  (SELECT count(*) FROM public.compute_jobs pj, win
    WHERE pj.kind = 'poll_allocator_positions' AND pj.attempts > 1
      AND pj.created_at >= win.s AND pj.created_at < win.s + interval '2 hours'
      AND pj.api_key_id IN (SELECT id FROM mt5)) AS poll_second_attempts,
  (SELECT count(*) FROM public.mt5_terminal_leases l
    WHERE l.site IN ('derive_broker_dailies', 'sync_trades_balance', 'allocator_holdings', 'session_heal')) AS lease_job_class,
  (SELECT count(*) FROM public.mt5_terminal_leases l
    WHERE l.site IN ('validate_wizard', 'validate_worker', 'terminal_scrub', 'validation_liveness')) AS lease_validation_class;
