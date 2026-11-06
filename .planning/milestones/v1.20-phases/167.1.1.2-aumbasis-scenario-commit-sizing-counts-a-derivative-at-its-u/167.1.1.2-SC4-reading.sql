WITH latest AS (
  SELECT api_key_id, max(asof) AS asof FROM allocator_holdings GROUP BY api_key_id
), cur AS (
  SELECT h.* FROM allocator_holdings h JOIN latest l ON l.api_key_id = h.api_key_id AND l.asof = h.asof
), deriv_books AS (
  SELECT allocator_id FROM cur WHERE holding_type = 'derivative' GROUP BY allocator_id
), book AS (
  SELECT row_number() OVER (ORDER BY sum(value_usd) DESC) AS book_n,
         count(*) FILTER (WHERE holding_type='derivative') AS deriv_rows,
         count(*) FILTER (WHERE holding_type='derivative' AND unrealized_pnl_usd IS NULL) AS deriv_null_pnl,
         round(sum(value_usd) FILTER (WHERE holding_type IN ('spot','derivative')), 2) AS notional_aum_usd,
         round(coalesce(sum(value_usd) FILTER (WHERE holding_type='spot'),0)
             + coalesce(sum(unrealized_pnl_usd) FILTER (WHERE holding_type='derivative'),0), 2) AS equity_aum_usd,
         string_agg(DISTINCT venue, ',') FILTER (WHERE holding_type='derivative') AS deriv_venues,
         (SELECT count(*) FROM audit_log a WHERE a.user_id = c.allocator_id AND a.action='match.decision_record'
            AND a.metadata->>'source'='scenario_commit') AS past_commit_rows,
         (SELECT count(*) FROM audit_log a WHERE a.user_id = c.allocator_id AND a.action='match.decision_record'
            AND a.metadata->>'source'='scenario_commit' AND a.metadata ? 'size_at_decision_usd'
            AND jsonb_typeof(a.metadata->'size_at_decision_usd')='number') AS past_sized_rows
  FROM cur c WHERE c.allocator_id IN (SELECT allocator_id FROM deriv_books) GROUP BY c.allocator_id
)
SELECT jsonb_build_object(
  'current_deriv_rows', (SELECT count(*) FROM cur WHERE holding_type='derivative'),
  'current_deriv_null_pnl', (SELECT count(*) FROM cur WHERE holding_type='derivative' AND unrealized_pnl_usd IS NULL),
  'current_deriv_zero_pnl', (SELECT count(*) FROM cur WHERE holding_type='derivative' AND unrealized_pnl_usd = 0),
  'current_deriv_by_venue', (SELECT jsonb_object_agg(venue, n) FROM (SELECT venue, count(*) n FROM cur WHERE holding_type='derivative' GROUP BY venue) v),
  'all_history_deriv_rows', (SELECT count(*) FROM allocator_holdings WHERE holding_type='derivative'),
  'all_history_deriv_null_pnl', (SELECT count(*) FROM allocator_holdings WHERE holding_type='derivative' AND unrealized_pnl_usd IS NULL),
  'all_history_deriv_zero_pnl', (SELECT count(*) FROM allocator_holdings WHERE holding_type='derivative' AND unrealized_pnl_usd = 0),
  'position_snapshots_null_pnl', (SELECT count(*) FROM position_snapshots WHERE unrealized_pnl IS NULL),
  'position_snapshots_zero_pnl', (SELECT count(*) FROM position_snapshots WHERE unrealized_pnl = 0),
  'position_snapshots_rows', (SELECT count(*) FROM position_snapshots),
  'books_with_derivatives', (SELECT jsonb_agg(to_jsonb(b) ORDER BY b.book_n) FROM book b),
  'all_scenario_commit_rows_by_size_source', (SELECT jsonb_object_agg(coalesce(s,'<none>'), n) FROM (SELECT a.metadata->>'_size_source' s, count(*) n FROM audit_log a WHERE a.action='match.decision_record' AND a.metadata->>'source'='scenario_commit' GROUP BY 1) x)
) AS before_reading;
