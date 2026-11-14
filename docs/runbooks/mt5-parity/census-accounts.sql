WITH k AS (
  SELECT 'k' || row_number() OVER (ORDER BY ak.created_at, ak.id) AS key_ordinal,
         ak.id,
         ak.account_currency,
         (SELECT count(*)
            FROM public.api_keys o
           WHERE o.exchange = 'mt5'
             AND o.id <> ak.id
             AND o.venue_account_id = ak.venue_account_id) AS keys_sharing_login
    FROM public.api_keys ak
   WHERE ak.exchange = 'mt5'
),
mk AS (
  SELECT k.key_ordinal,
         bool_or(m.native_unit IS NOT NULL) AS native_unit_marked,
         min(m.mark_day) AS s_raw_marks,
         max(m.mark_day) AS last_mark_day,
         count(m.id) AS mark_count
    FROM k
    LEFT JOIN public.api_key_nav_marks m ON m.api_key_id = k.id
   GROUP BY k.key_ordinal
),
st AS (
  SELECT k.key_ordinal,
         count(s.id) AS strategies_linked,
         array_agg(s.status ORDER BY s.status) FILTER (WHERE s.id IS NOT NULL) AS strategy_statuses,
         array_agg(DISTINCT s.asset_class ORDER BY s.asset_class) FILTER (WHERE s.id IS NOT NULL) AS asset_classes,
         count(s.id) FILTER (WHERE s.status <> 'archived') AS live_n,
         (array_agg(s.id) FILTER (WHERE s.status <> 'archived'))[1] AS live_id
    FROM k
    LEFT JOIN public.strategies s ON s.api_key_id = k.id
   GROUP BY k.key_ordinal
),
an AS (
  SELECT st.key_ordinal,
         a.computed_at,
         a.computation_status,
         a.computation_warned,
         a.series_completeness,
         (a.data_quality_flags ->> 'marks_since')::date AS marks_since,
         (a.metrics_json ->> 'record_observations')::numeric AS record_observations,
         CASE WHEN jsonb_typeof(a.returns_series) = 'array' THEN a.returns_series
              WHEN jsonb_typeof(a.daily_returns) = 'array' THEN a.daily_returns
         END AS ser,
         CASE WHEN jsonb_typeof(a.returns_series) = 'array' THEN jsonb_array_length(a.returns_series) END AS returns_series_len,
         CASE WHEN jsonb_typeof(a.daily_returns) = 'array' THEN jsonb_array_length(a.daily_returns) END AS daily_returns_len,
         CASE WHEN jsonb_typeof(a.data_quality_flags) = 'object'
              THEN (SELECT array_agg(fk ORDER BY fk) FROM jsonb_object_keys(a.data_quality_flags) AS fk)
         END AS flag_keys
    FROM st
    JOIN public.strategy_analytics a ON a.strategy_id = st.live_id
   WHERE st.live_n = 1
),
ki AS (
  SELECT k.key_ordinal,
         e.payload,
         (e.payload ->> 'marks_since')::date AS marks_since,
         CASE WHEN jsonb_typeof(e.payload -> 'composed_day_pnl') = 'array'
              THEN e.payload -> 'composed_day_pnl' ELSE '[]'::jsonb END AS pnl_arr,
         CASE WHEN jsonb_typeof(e.payload -> 'composed_flows') = 'array'
              THEN e.payload -> 'composed_flows' ELSE '[]'::jsonb END AS flow_arr
    FROM k
    JOIN public.allocator_equity_derived e ON e.kind = 'key_inputs:' || k.id::text
),
idn AS (
  SELECT ki.key_ordinal,
         jsonb_array_length(ki.pnl_arr) AS identity_days,
         jsonb_array_length(ki.flow_arr) AS identity_flow_days,
         CASE
           WHEN (ki.payload ->> 'realized_terminal_usd') IS NULL THEN NULL
           WHEN jsonb_array_length(ki.flow_arr) = 0 THEN NULL
           ELSE (
             (ki.payload ->> 'realized_terminal_usd')::numeric
             - coalesce((SELECT sum((p ->> 'pnl_usd')::numeric) FROM jsonb_array_elements(ki.pnl_arr) AS p), 0)
             - (SELECT sum((f ->> 'flow_usd')::numeric) FROM jsonb_array_elements(ki.flow_arr) AS f)
           ) / nullif(
             abs((SELECT (f ->> 'flow_usd')::numeric
                    FROM jsonb_array_elements(ki.flow_arr) AS f
                   ORDER BY f ->> 'utc_day_iso'
                   LIMIT 1)),
             0)
         END AS identity_ratio
    FROM ki
),
rows_out AS (
  SELECT k.key_ordinal,
         NULL::bigint AS keys_examined,
         k.account_currency,
         coalesce(mk.native_unit_marked, false) AS native_unit_marked,
         st.strategies_linked,
         coalesce(st.strategy_statuses, '{}'::text[]) AS strategy_statuses,
         coalesce(st.asset_classes, '{}'::text[]) AS asset_classes,
         (SELECT count(*) FROM public.strategy_keys sk WHERE sk.api_key_id = k.id) AS strategy_key_windows,
         mk.s_raw_marks,
         ki.marks_since AS s_key_inputs,
         an.marks_since AS s_flags,
         coalesce(mk.s_raw_marks = ki.marks_since AND ki.marks_since = an.marks_since, false) AS s_agree,
         mk.mark_count,
         mk.last_mark_day,
         (an.ser -> 0 ->> 'date')::date AS first_return_date,
         (an.ser -> (-1) ->> 'date')::date AS last_return_date,
         an.returns_series_len,
         an.daily_returns_len,
         an.record_observations,
         (an.ser -> (-1) ->> 'date')::date - (an.ser -> 0 ->> 'date')::date AS record_span_days,
         an.computed_at,
         an.computation_status,
         an.computation_warned,
         an.series_completeness,
         k.keys_sharing_login,
         (ki.key_ordinal IS NOT NULL) AS key_inputs_present,
         coalesce(idn.identity_flow_days, 0) > 0 AS first_flow_present,
         idn.identity_ratio,
         idn.identity_days,
         idn.identity_flow_days,
         an.flag_keys,
         'unmeasured (155.1 reading owns it)'::text AS server
    FROM k
    LEFT JOIN mk ON mk.key_ordinal = k.key_ordinal
    LEFT JOIN st ON st.key_ordinal = k.key_ordinal
    LEFT JOIN an ON an.key_ordinal = k.key_ordinal
    LEFT JOIN ki ON ki.key_ordinal = k.key_ordinal
    LEFT JOIN idn ON idn.key_ordinal = k.key_ordinal
)
SELECT *
  FROM (
    SELECT * FROM rows_out
    UNION ALL
    SELECT 'all'::text,
           (SELECT count(*) FROM k),
           NULL::text,
           NULL::boolean,
           NULL::bigint,
           NULL::text[],
           NULL::text[],
           NULL::bigint,
           NULL::date,
           NULL::date,
           NULL::date,
           NULL::boolean,
           NULL::bigint,
           NULL::date,
           NULL::date,
           NULL::date,
           NULL::integer,
           NULL::integer,
           NULL::numeric,
           NULL::integer,
           NULL::timestamptz,
           NULL::text,
           NULL::boolean,
           NULL::text,
           NULL::bigint,
           NULL::boolean,
           NULL::boolean,
           NULL::numeric,
           NULL::integer,
           NULL::integer,
           NULL::text[],
           NULL::text
  ) u
 ORDER BY (u.key_ordinal = 'all'), length(u.key_ordinal), u.key_ordinal;
