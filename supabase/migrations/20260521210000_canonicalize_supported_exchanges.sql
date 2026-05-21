-- Canonicalize strategies.supported_exchanges (QA 2026-05-21 ISSUE-004).
--
-- BEFORE this migration: create_wizard_strategy seeded the row with
-- `ARRAY[p_exchange]` — and `p_exchange` comes from the wizard's
-- ConnectKeyStep payload in lowercase ('bybit' / 'okx' / 'binance')
-- to satisfy the api_keys.exchange check constraint. The MetadataStep
-- chip group then compared selected entries case-sensitively against
-- the canonical EXCHANGES constant ('Bybit', 'OKX', 'Binance'), so on
-- resume the chip appeared unselected even though the array already
-- carried the lowercase form. The user clicked the chip, the canonical
-- form got appended, and the row landed as ['bybit', 'Bybit'] —
-- surfacing as duplicated copy on the review-and-submit, /strategies
-- list, and /strategy/[id] cards. Same trap hit ['Okx', 'OKX'] on the
-- existing Alpha Centauri + Phoenix Protocol rows (case-mismatched
-- canonical writes from the same chip group, before the JS-side
-- canonicalize landed).
--
-- AFTER: the JS-side canonicalizeExchangeList() helper (lib/constants)
-- normalizes the wizard load + save paths so new finalize submissions
-- persist a deduped canonical array. This migration backfills the
-- existing rows so the duplicated copy goes away on the next page load.
-- The migration is idempotent — array_distinct-after-canonicalize
-- collapses the duplicates and leaves clean arrays untouched.
--
-- Locked decision: only the four exchanges currently admitted by the
-- wizard ConnectKeyStep + EXCHANGES constant ('Binance', 'OKX',
-- 'Bybit') are canonicalized. Any other value (e.g. 'coinbase' for the
-- legacy 'Obsidian BTC/ETH Trend' seed row) is left as-is rather than
-- silently dropped, since this migration doesn't know whether 'coinbase'
-- is a typo or a forward-compat placeholder.

UPDATE public.strategies AS s
SET supported_exchanges = canonical.arr
FROM (
  SELECT
    s2.id,
    -- Dedupe + canonicalize. The trick: lower(unnest) groups
    -- ['bybit','Bybit'] under a single key 'bybit', then we pick the
    -- canonical form via CASE on the lower key. array_agg DISTINCT
    -- gives us the deduped output array. ORDER BY preserves a stable
    -- shape so a re-run wouldn't reshuffle the array.
    ARRAY(
      SELECT DISTINCT
        CASE lower(x)
          WHEN 'binance' THEN 'Binance'
          WHEN 'okx' THEN 'OKX'
          WHEN 'bybit' THEN 'Bybit'
          ELSE x  -- preserve unknown values (forward-compat / legacy)
        END
      FROM unnest(s2.supported_exchanges) AS x
      ORDER BY 1
    ) AS arr
  FROM public.strategies s2
  WHERE s2.supported_exchanges IS NOT NULL
    AND array_length(s2.supported_exchanges, 1) > 0
) AS canonical
WHERE s.id = canonical.id
  AND s.supported_exchanges IS DISTINCT FROM canonical.arr;
