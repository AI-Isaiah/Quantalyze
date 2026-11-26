# API Coverage — Binance account fills read (ccxt 4.5.89 `binance.fetch_my_trades`)

> Full coverage by default. Opt-outs are explicit, reasoned decisions.

Scope: the capability surface of the one venue read this phase changes, `services/exchange.py::_fetch_raw_trades_binance`, which reaches Binance only through ccxt's `fetch_my_trades` (routes read in the installed ccxt source) plus the market metadata it needs to route a stored symbol. Venue rules are those quoted in 250-RESEARCH.md Q1.

| capability | decision | reason |
|---|---|---|
| fapi GET /fapi/v1/userTrades (USD-M futures, ccxt fapiPrivateGetUserTrades) | INTEGRATE | |
| dapi GET /dapi/v1/userTrades (COIN-M futures, ccxt dapiPrivateGetUserTrades) | INTEGRATE | |
| spot GET /api/v3/myTrades (ccxt privateGetMyTrades, 24-hour windows) | INTEGRATE | |
| startTime and endTime window parameters on every request | INTEGRATE | |
| limit parameter at the documented maximum of 1000 | INTEGRATE | |
| market metadata load before symbol routing (exchangeInfo through load_markets) | INTEGRATE | |
| venue symbol errors -1108, -1121, -20121 (ccxt BadSymbol) | INTEGRATE | |
| fromId paging | OPT-OUT | not needed: re-read pages inside the 1 h overlap do not count toward BINANCE_PAGE_CAP (orchestrator decision 2026-11-25, plan 250-06), so a capped symbol resumes past its cap without it; the venue also forbids fromId with startTime or endTime |
| margin GET /sapi/v1/margin/myTrades (ccxt sapiGetMarginMyTrades) | OPT-OUT | not needed: margin is not an ingested surface and the read never passes a margin mode |
| portfolio margin trade lists (ccxt papiGet UM, CM and margin trades) | OPT-OUT | not needed yet: create_exchange never sets the portfolioMargin option and PROD held no Binance key on 2026-11-25 |
| options GET /eapi/v1/userTrades (ccxt eapiPrivateGetUserTrades) | OPT-OUT | not needed: no options market is in the stored symbol set this read walks |
| tokenized stock trade history (ccxt sapiGetEquityTradeHistory) | OPT-OUT | not needed: no stock market is in the stored symbol set this read walks |
