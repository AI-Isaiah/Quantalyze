# API Coverage — Deribit API v2 (Phase 177 DERIBITFLOWS)

> Full coverage by default. Opt-outs are explicit, reasoned decisions.

Scope of this phase: one public market-data read gives the price of a moved Deribit flow at the
flow's own minute (CONTEXT D-02 revisited, D-04, D-05). D-04 fixes the source: the `open` of the
`{CCY}_USDC-PERPETUAL` 1-minute candle that contains the flow, from the public
`get_tradingview_chart_data` endpoint with `resolution` 1. Every other capability is opted out with
its reason. "Used by another phase" means the repo already calls it for a different need; this phase
neither adds nor changes that call.

| capability | decision | reason |
|---|---|---|
| `public/get_tradingview_chart_data` (`resolution` 1, instrument `{CCY}_USDC-PERPETUAL`) | INTEGRATE | The at-instant price of a moved flow: the open of the 1-minute candle containing it (D-04). Plans 01 (reader, wiring) and 03 (stored once, reused). |
| `public/get_tradingview_chart_data` (other resolutions or instruments) | OPT-OUT | Out of scope: the phase needs only the 1-minute perpetual candle (D-04). The `1D` close on the same instrument is already used by another phase as a daily mark fill, unchanged here. |
| `public/get_index_chart_data` | OPT-OUT | Out of scope (D-04): the literal index is served at 1-minute steps only for the last 48 h (RESEARCH "Public probe"), so it cannot price an older flow; listed under CONTEXT Deferred Ideas. |
| `public/get_index_price` | OPT-OUT | Out of scope: current index only, no timestamp parameter, so it cannot price a past instant. Used by another phase (NAVMTM mark read at `marked_at`), unchanged. |
| `public/get_index` | OPT-OUT | Out of scope: deprecated current-index read, no timestamp parameter. |
| `public/get_index_price_names` | OPT-OUT | Not needed: the instrument name is derived from the currency code (`{CCY}_USDC-PERPETUAL`), never enumerated. |
| `public/get_supported_index_names` | OPT-OUT | Not needed: no index name is read in this phase (D-04 chose the perpetual candle). |
| `public/get_delivery_prices` | OPT-OUT | Out of scope: a daily 08:00Z delivery price, not an at-instant price. Used by another phase for the ledger's daily mark, unchanged. |
| `public/get_mark_price_history` | OPT-OUT | Out of scope: 5-minute and options-only; perpetuals return an empty list (RESEARCH "Alternatives Considered"). |
| `public/get_funding_rate_history` | OPT-OUT | Out of scope: hourly `index_price` rows, up to an hour stale, worse than the 1-minute candle (D-04). |
| `public/get_funding_rate_value` | OPT-OUT | Not needed: the phase prices a flow, it reads no funding. |
| `public/get_funding_chart_data` | OPT-OUT | Not needed: the phase reads no funding series. |
| `public/get_last_trades_by_instrument_and_time` | OPT-OUT | Out of scope: D-04 fixes the candle open as the price; reconstructing a price from raw trades is not the chosen rule. |
| `public/get_last_trades_by_instrument` | OPT-OUT | Out of scope: recent trades only, no historical instant. |
| `public/get_last_trades_by_currency_and_time` | OPT-OUT | Out of scope: same reason as the per-instrument trades read (D-04). |
| `public/get_last_trades_by_currency` | OPT-OUT | Out of scope: recent trades only. |
| `public/ticker` | OPT-OUT | Out of scope: current state only, cannot price a past instant. |
| `public/get_order_book` | OPT-OUT | Out of scope: current book only. |
| `public/get_order_book_by_instrument_id` | OPT-OUT | Out of scope: current book only. |
| `public/get_book_summary_by_currency` | OPT-OUT | Out of scope: current summary only. |
| `public/get_book_summary_by_instrument` | OPT-OUT | Out of scope: current summary only. |
| `public/get_instrument` | OPT-OUT | Not needed: the instrument name follows the repo's one suffix rule; a missing instrument is answered by the chart read itself (a structural no-data refusal, D-05). |
| `public/get_instruments` | OPT-OUT | Not needed: same reason as `public/get_instrument`. |
| `public/get_contract_size` | OPT-OUT | Not needed: the flow quantity is in coin, priced per coin; no contract arithmetic. |
| `public/get_currencies` | OPT-OUT | Not needed by this phase. Used by another phase (the ledger's currency universe), unchanged. |
| `public/get_expirations` | OPT-OUT | Not needed: no dated instrument is read. |
| `public/get_last_settlements_by_currency` | OPT-OUT | Out of scope: settlement prices are daily, not at-instant. |
| `public/get_last_settlements_by_instrument` | OPT-OUT | Out of scope: same reason. |
| `public/get_historical_volatility` | OPT-OUT | Not needed: no volatility input. |
| `public/get_volatility_index_data` | OPT-OUT | Not needed: no volatility input. |
| `public/get_trade_volumes` | OPT-OUT | Not needed: no volume input. |
| `public/get_apr_history` | OPT-OUT | Not needed: no yield input. |
| `public/get_rfqs` | OPT-OUT | Not needed: no RFQ data. |
| `public/get_combo_details`, `public/get_combo_ids`, `public/get_combos` | OPT-OUT | Not needed: no combo instruments are priced. |
| Supporting: `public/get_time`, `public/hello`, `public/status`, `public/test` | OPT-OUT | Not needed: the read goes through the existing ccxt client, which owns connection health. |
| Subscriptions: `public/subscribe`, `public/unsubscribe`, `private/subscribe`, `private/unsubscribe` and the rest of the subscription namespace | OPT-OUT | Out of scope: a nightly batch derive reads history over REST; no streaming. |
| Authentication and session: `public/auth`, `public/exchange_token`, `public/fork_token`, `private/logout`, heartbeat and cancel-on-disconnect | OPT-OUT | Not needed: the chart read is public and sends no credential. The key's existing authenticated crawl (another phase) is unchanged. |
| Account management (`private/get_account_summaries`, `private/get_positions`, subaccounts, API-key management, and the rest of the namespace) | OPT-OUT | Out of scope: the phase reads no account state. `private/get_account_summaries` and `private/get_subaccounts` are used by another phase, unchanged. |
| Account transaction log (`private/get_transaction_log`) | OPT-OUT | Not needed: the flow instants come from the crawl another phase already makes; this phase adds no read of it. |
| Trading (`private/buy`, `private/sell`, `private/edit`, `private/cancel*`, order and user-trade reads) | OPT-OUT | Explicitly out of scope: a read-only analytics service never trades. `private/get_user_trades_by_currency` is used by another phase, unchanged. |
| Combo books, block trades, block RFQ, mass quotes and market-maker protection | OPT-OUT | Explicitly out of scope: trading surfaces. |
| Wallet (`private/get_deposits`, `private/get_withdrawals`, `private/get_transfers`, `private/withdraw`, address management) | OPT-OUT | Out of scope: flow instants already come from the transaction log another phase crawls; this phase never moves funds. |
