# API Coverage — Bybit V5 REST (read surface of the analytics service)

> Full coverage by default. Opt-outs are explicit, reasoned decisions. The phase census
> (`231-CENSUS.md`) carries the per-path detail and the pinning test for every row below.

| capability | decision | reason |
|---|---|---|
| `GET /v5/account/wallet-balance` (UNIFIED, every coin) | INTEGRATE | |
| `GET /v5/position/list` category linear, settleCoin USDT | INTEGRATE | |
| `GET /v5/position/list` category linear, settleCoin USDC | INTEGRATE | |
| `GET /v5/position/list` category inverse | INTEGRATE | |
| `GET /v5/position/list` category option | OPT-OUT | not needed yet: no option position is held or valued anywhere in the product |
| `GET /v5/execution/list` category linear (USDT and USDC contracts) | INTEGRATE | |
| `GET /v5/execution/list` category inverse | OPT-OUT | explicitly out of scope: inverse fills need a contractSize rescale before storage (census C17, pinned) |
| `GET /v5/execution/list` category spot | OPT-OUT | explicitly out of scope: spot fills are not read for strategies (census C17, pinned) |
| `GET /v5/execution/list` category option | OPT-OUT | not needed yet: no option strategy exists |
| `GET /v5/position/closed-pnl` category linear | INTEGRATE | |
| `GET /v5/position/closed-pnl` category inverse | OPT-OUT | not needed yet: decided on the probe's exposure counts and routed by name in the phase report (ruling OQ4, census C18) |
| `GET /v5/account/transaction-log` TRANSFER_IN and TRANSFER_OUT | INTEGRATE | |
| `GET /v5/account/transaction-log` SETTLEMENT (funding) | INTEGRATE | |
| `GET /v5/account/transaction-log` other types (bonus, Earn, interest) | OPT-OUT | explicitly out of scope: flow kinds are owned by Phase 223 |
| `GET /v5/asset/deposit/query-record` and `GET /v5/asset/withdraw/query-record` | INTEGRATE | |
| `GET /v5/market/tickers` | INTEGRATE | |
| `GET /v5/market/instruments-info` | INTEGRATE | |
| order create, amend and cancel | OPT-OUT | explicitly out of scope: the product is read-only and never trades |
| internal transfer and withdrawal | OPT-OUT | explicitly out of scope: the product never moves funds |
| API key and IP allow-list management | OPT-OUT | explicitly out of scope: a founder action only (VREAD-05); no agent changes key settings |
| WebSocket streams | OPT-OUT | not needed: every read is a scheduled poll |
