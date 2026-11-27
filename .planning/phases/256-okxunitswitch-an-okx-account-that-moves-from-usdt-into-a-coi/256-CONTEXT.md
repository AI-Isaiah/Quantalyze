# Phase 256: OKXUNITSWITCH - Context

**Status:** booked 2026-11-27, not planned. Source: the diagnosed `okx-non-usd-native` debug session (2026-11-27).

## Founder decision (2026-11-27, AskUserQuestion, verbatim)

"USD before 11-15, BTC after" - how to report an OKX account whose P&L was in USDT and which then moved into spot BTC. Options offered: A convert each BTC bill to USD at the day's BTC close; B report in BTC for the whole history; C USD before the switch, the coin after; D keep the refusal. The founder chose C. An earlier chat ruling ("if they are reported in BTC, then just report them in BTC as well") assumed a coin-margined account, and the measurement showed this one is not.

## Measured (PROD, read only, marker query first; no ids recorded)

- One OKX account stored as 4 keys (identical balances on every sampled day). 7 derive jobs fail every night since 2026-11-24: 4 key-mode and 3 strategy-mode, `failed_final`, `error_kind=permanent`, `realized read incomplete (daily_pnl_non_usd_okx)`. The 3 strategy-mode jobs carry `read_refusal_kept_figures`, so the strategies sit at their last good figures. 11-16 to 11-24 ended `done`.
- The OKX bills read gave about 1300 bills; the non-USD census was `{'BTC': 11}`, every other bill USDT or zero-amount.
- History from holdings: a USDT wallet and a USDT-margined ETHUSDT swap from May to 11-12, an all-USDT account on 11-13 and 11-14, about three quarters moved into spot BTC on 11-15, almost all the rest on 11-21, about 99.7% BTC by value today. No coin-margined contract anywhere. Stored fills (to 2026-08-19) are all USDT-fee.
- OKX docs (GET /api/v5/account/bills): `ccy` is the account balance currency, `balChg` is in that `ccy`, `fee` is negative for a fee charged. The bills page does not state the spot fee currency; OKX's rule that the fee is charged in the currency received explains the 11 bills but is not proven from a raw bill.

## Cause

Phase 232-03's VREAD-06 (`_okx_non_usd_census` to `daily_pnl_non_usd_okx` to `return []`, in the OKX branch of `fetch_daily_pnl`, `analytics-service/services/exchange.py`) refuses the whole read on a non-stable `ccy` with a non-zero `pnl + fee`. 232-CONTEXT Q3 recorded this case. The native-unit machinery (`services/account_unit.py`, `api_key_nav_marks.native_unit`, BTCUSDVIEW's USD view in `services/native_to_usd.py`, `benchmark.read_btc_closes`) is one unit per key for the whole series, and no reader supports a series that switches unit.

## Deviation record

This reverses part of 232-03 (VREAD-06). Recorded at the 232-03 line in `ROADMAP.md`, in `232-CONTEXT.md` and here, per the deviation policy.

## For the planner

- The switch date is derived from data and never hard-coded. The founder's 11-15 is his reading of this account, a check and not an input.
- Research first: the raw OKX bills, to confirm the 11 bills are the BTC fees of the spot buys, reading the venue API docs too.
- Success criteria are in the ROADMAP section. They are not restated here.
