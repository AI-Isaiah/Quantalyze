WITH k AS (
  SELECT 'k' || row_number() OVER (ORDER BY ak.created_at, ak.id) AS key_ordinal,
         ak.id
    FROM public.api_keys ak
   WHERE ak.exchange = 'mt5'
),
span AS (
  SELECT k.key_ordinal,
         k.id,
         min(m.mark_day) AS first_mark_day
    FROM k
    JOIN public.api_key_nav_marks m ON m.api_key_id = k.id
   GROUP BY k.key_ordinal, k.id
),
fri AS (
  SELECT sp.key_ordinal,
         sp.id,
         d::date AS friday
    FROM span sp
   CROSS JOIN LATERAL generate_series(
           sp.first_mark_day::timestamp,
           ((now() AT TIME ZONE 'UTC')::date - 1)::timestamp,
           interval '1 day') AS d
   WHERE extract(isodow FROM d) = 5
),
per_key AS (
  SELECT f.key_ordinal,
         f.friday,
         (m.id IS NOT NULL) AS mark_present,
         CASE WHEN m.native_unit IS NOT NULL
              THEN m.open_pnl_native / nullif(m.nav_native, 0)
              ELSE m.open_pnl_usd / nullif(m.nav_usd, 0)
         END AS open_pnl_ratio,
         m.marked_at,
         (extract(epoch FROM m.marked_at - (date_trunc('day', m.marked_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')))::numeric / 3600 AS hours_after_utc_midnight
    FROM fri f
    LEFT JOIN public.api_key_nav_marks m ON m.api_key_id = f.id AND m.mark_day = f.friday
  UNION ALL
  SELECT k.key_ordinal,
         NULL::date,
         false,
         NULL::numeric,
         NULL::timestamptz,
         NULL::numeric
    FROM k
   WHERE NOT EXISTS (SELECT 1 FROM fri f WHERE f.key_ordinal = k.key_ordinal)
)
SELECT *
  FROM (
    SELECT p.key_ordinal,
           p.friday,
           p.mark_present,
           p.open_pnl_ratio,
           p.marked_at,
           p.hours_after_utc_midnight,
           NULL::bigint AS rows_examined
      FROM per_key p
    UNION ALL
    SELECT 'all'::text,
           NULL::date,
           NULL::boolean,
           NULL::numeric,
           NULL::timestamptz,
           NULL::numeric,
           count(*)
      FROM per_key
  ) u
 ORDER BY (u.key_ordinal = 'all'), length(u.key_ordinal), u.key_ordinal, u.friday;
