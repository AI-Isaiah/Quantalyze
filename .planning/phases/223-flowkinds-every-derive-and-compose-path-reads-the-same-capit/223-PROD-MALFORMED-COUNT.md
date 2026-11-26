# Phase 223: the PROD malformed-row count (FLOWK-03, read-only)

**Read:** 2026-11-24, about 14:00 UTC, through the Supabase MCP, one query per call, SELECT only.
**Marker:** the database comment named PRODUCTION before any count was read.
**Writer age:** both places the flag lands were added by Phase 186 (v0.133.21.0, merged 2026-11-04,
commit `8f4523131`). A row computed before that date cannot carry the flag, so it is "not measured",
never "clean".

The flag is present-only. A clean re-read clears it, so the count is a reading of each key's or
strategy's LATEST derive, not a history.

## Where the flag can land

- Strategy mode: `strategy_analytics.data_quality_flags->>'daily_pnl_malformed_<venue>'`.
- Key mode: `allocator_equity_derived.payload->'daily_pnl_malformed'` on the `key_inputs:<api_key_id>` row.
- Only the ccxt realized reads in `services/exchange.py` stamp it: `okx`, `binance`, `bybit`.
  Deribit and MT5 rows are listed below for completeness and are not eligible.

## Key mode (`allocator_equity_derived`, kind `key_inputs:*`)

| venue | key_inputs rows | computed after 2026-11-04 | flagged | active keys |
|---|---|---|---|---|
| okx | 6 | 6 | 0 | 6 |
| bybit | 3 | 1 | 0 | 6 |
| binance | 0 | 0 | 0 | (none connected) |
| deribit (not eligible) | 8 | 8 | 0 | 9 |
| mt5 (not eligible) | 11 | 11 | 0 | 12 |

Per eligible key: every OKX key reads 0, and the one Bybit key with a post-186 derive reads 0.
**Not measured:** 2 Bybit `key_inputs` rows last computed before 2026-11-04 (the oldest dated
2026-07-20), and the Bybit active keys with no `key_inputs` row at all.

## Strategy mode (`strategy_analytics`, venue from the strategy's api key, else its source)

| venue | strategies | computed after 2026-11-04 | flagged |
|---|---|---|---|
| okx | 3 | 3 | 0 |
| bybit | 1 | 1 | 0 |
| mt5 (not eligible) | 11 | 11 | 0 |
| csv (not eligible) | 27 | 9 | 0 |
| wizard (not eligible) | 2 | 2 | 0 |

Total: 44 strategy rows, 0 carrying any key containing `daily_pnl_malformed`.

## Worker log (Railway, analytics service)

- Search: `"funding_fetch: dropped"` and `"malformed rows"` (the three funding fetchers' drop
  warnings) returned no line.
- The window this covers: the service's retained logs reach back to **2026-11-19 only**, the current
  deployment. That is a 5-day window, not a history. The filter was checked against a known line
  (`"sync_funding"`), which matched.

## Reading

On 2026-11-24 the count of `daily_pnl_malformed_<venue>` flags on PROD is **0 for every measured
key and strategy**. Two Bybit key rows and the Bybit keys with no derived row are not measured.
This reading goes to the founder for the FLOWK-03 ruling. No refusal of a malformed realized row is
switched on before that ruling is recorded (ROADMAP SC-2).
