---
phase: 232-okxtrades-an-okx-read-converts-or-refuses-a-non-usdt-bill-co
plan: 03
subsystem: analytics-service
tags: [okx, fetch_daily_pnl, vread-06, proof-01, non-usd]
status: complete
requires: ["232-01", "232-02"]
provides:
  - "daily_pnl_non_usd_okx: a nonzero OKX bill in a currency not stable under is_stable_value refuses the whole read (returns [])"
  - "the token named identically by daily_pnl_read_verdict, routers/cron.py::_fetch_degradation, READ_INCOMPLETE_TOKENS and _DAILY_PNL_REFUSAL_ORDER (permanent)"
affects: [232-04]
key-files:
  created:
    - analytics-service/tests/test_okxtrades_ccy.py
  modified:
    - analytics-service/services/exchange.py
    - analytics-service/services/job_worker.py
    - analytics-service/routers/cron.py
    - analytics-service/tests/test_daily_pnl_read_verdict.py
    - analytics-service/tests/test_derive_broker_dailies_dualmode.py
    - analytics-service/tests/test_cron_router.py
    - analytics-service/tests/test_exchange.py
decisions:
  - "Refusal returns [] explicitly after stamping the flag (plan 02's hand-off) instead of clearing daily_totals"
  - "Census keys: the code when it matches ^[A-Za-z0-9]{1,16}$, `blank` for an empty code, `malformed` otherwise; WARNING only, the flag value is True"
metrics:
  tasks: 3
  completed: 2026-11-24
actuals:
  tokens: 16000
  tasks: 3
  commits: 3
plan_head_before: 0cdf250c5c92b97b660a068510a52756d4ec3c0e
plan_head_after: fa7d917a6
---

# Phase 232 Plan 03: non-USD OKX bill refusal Summary

An OKX bill with a nonzero `pnl + fee` in a currency that is not a stable coin (blank or missing `ccy` included) now refuses the whole daily-P&L read by the closed token `daily_pnl_non_usd_okx`, named identically by the verdict, the trade sync and the derive (permanent on the first attempt); stable coins (USDT, USDC, DAI, any case) count at 1.0.

`commits: 3` is measured from the ledger at SUMMARY write (the three task commits); the SUMMARY commit follows.

## Commits

| Task | Commit | What |
|------|--------|------|
| 1 | 445131f01 | tracer + the refusal in `fetch_daily_pnl`, verdict reason, `_FETCH_NON_USD_FLAG` in the cron |
| 2 | bf111c75e | token in `READ_INCOMPLETE_TOKENS` and `_DAILY_PNL_REFUSAL_ORDER`; parity matrix 480 to 960; derive refusal test; cron FLAGS arm; seven currency arms |
| 3 | fa7d917a6 | `ccy` USDT on the three ccy-less bills of `test_okx_bill_dropped_on_non_digit_ts_logs_warning` |

## Environment

`analytics-service/.venv` bootstrapped in this worktree (git-ignored; the plan 02 venv was not present here): ccxt 4.5.89. mypy strict (CI command): `Success: no issues found in 142 source files`. Final affected set: the plan's command (30 test files, all existing; the three the plan lists that the census greps do not return, `test_derive_allocator_equity_job.py`, `test_okxtrades_cursor.py`, `test_writer_residual_parity.py`, are kept) gives `3347 passed, 1 skipped`. Before re-fixturing, the same run had exactly one failure (`test_okx_bill_dropped_on_non_digit_ts_logs_warning`, below).

## Tracer RED line on pre-fix code (verbatim)

```
E       AssertionError: a mixed-currency day was summed at face value: [{'exchange': 'okx', 'symbol': 'PORTFOLIO', 'side': 'buy', 'price': 9.5, 'quantity': 1, 'fee': 0, 'fee_currency': 'USDT', 'timestamp': '2026-11-19T00:00:00+00:00', 'order_type': 'daily_pnl'}]
FAILED tests/test_okxtrades_ccy.py::TestOkxNonUsdBillRefusedByName::test_tracer_a_mixed_currency_day_is_refused_by_name_never_summed
1 failed in 8.62s
```

## Design as built

- `services/exchange.py`: `from collections import Counter`, `is_stable_value` from `services.price_rule`, `_OKX_CCY_CODE_RE`. In the OKX loop the check sits after the type-8 drop and after the `_finite_float` malformed `continue`, once `pnl_val` is known: `pnl_val != 0.0 and not is_stable_value(str(bill.get("ccy") or ""))` adds to a local census and `continue`s. After the loop a non-empty census stamps `_record_dq_flag("daily_pnl_non_usd_okx", True)`, logs one WARNING with the census and bill count, and `return []`.
- `daily_pnl_read_verdict` names the token beside the income-fallback line.
- `routers/cron.py`: `_FETCH_NON_USD_FLAG` and its `_fetch_degradation` line.
- `services/job_worker.py`: one member in `READ_INCOMPLETE_TOKENS` (comment now says five reasons) and one in `_DAILY_PNL_REFUSAL_ORDER` after `daily_pnl_truncated_okx`; `_TRANSIENT_REFUSAL_TOKENS`, `_realized_refusal_token` and `run_sync_trades_job` untouched.

## PROOF-01 records (verbatim from the run's `proof.log`)

Each block: neuter applied to a copy of the final file, run, `cp` back from the byte backup, `cmp` (identical), run GREEN. Commands run from `analytics-service/` as `.venv/bin/python -m pytest <args> -q -p no:cacheprovider`.

```
### N1: delete the census branch (`if pnl_val != 0.0 and not is_stable_value(_ccy):` -> `if False:`)
  cmd: pytest tests/test_okxtrades_ccy.py -k test_tracer_a_mixed_currency_day
  neuter exit=1
  RED> E       AssertionError: a mixed-currency day was summed at face value: [{'exchange': 'okx', 'symbol': 'PORTFOLIO', 'side': 'buy', 'price': 9.5, 'quantity': 1, 'fee': 0, 'fee_currency': 'USDT', 'timestamp': '2026-11-19T00:00:00+00:00', 'order_type': 'daily_pnl'}]
  RED> E       assert [{'exchange':...e': 9.5, ...}] == []
  RED> E         
  RED> E         Left contains one more item: {'exchange': 'okx', 'symbol': 'PORTFOLIO', 'side': 'buy', 'price': 9.5, ...}
  RED> E         Use -v to get more diff
  RED> FAILED tests/test_okxtrades_ccy.py::TestOkxNonUsdBillRefusedByName::test_tracer_a_mixed_currency_day_is_refused_by_name_never_summed
  RED> 1 failed, 8 deselected in 5.09s
  cp restore done; cmp: identical (exit 0, no output)
  GREEN> exit=0 1 passed, 8 deselected in 4.77s
### N2: move the currency check above the type-8 funding drop (inserted before `bill_type = ...`)
  cmd: pytest tests/test_okxtrades_ccy.py -k test_a_btc_funding_bill_is_dropped_before_the_currency_check
  neuter exit=1
  RED> E       AssertionError: assert {'daily_pnl_n...sd_okx': True} == {}
  RED> E         
  RED> E         Left contains 1 more item:
  RED> E         {'daily_pnl_non_usd_okx': True}
  RED> E         Use -v to get more diff
  RED> FAILED tests/test_okxtrades_ccy.py::TestOkxNonUsdBillRefusedByName::test_a_btc_funding_bill_is_dropped_before_the_currency_check
  RED> 1 failed, 8 deselected in 4.64s
  cp restore done; cmp: identical (exit 0, no output)
  GREEN> exit=0 1 passed, 8 deselected in 6.35s
### N3: drop the nonzero-amount conjunct (`if pnl_val != 0.0 and not is_stable_value(_ccy):` -> `if not is_stable_value(_ccy):`)
  cmd: pytest tests/test_okxtrades_ccy.py -k test_a_zero_amount_bill_in_another_currency_is_counted_not_refused
  neuter exit=1
  RED> E       AssertionError: assert {'daily_pnl_n...sd_okx': True} == {}
  RED> E         
  RED> E         Left contains 1 more item:
  RED> E         {'daily_pnl_non_usd_okx': True}
  RED> E         Use -v to get more diff
  RED> FAILED tests/test_okxtrades_ccy.py::TestOkxNonUsdBillRefusedByName::test_a_zero_amount_bill_in_another_currency_is_counted_not_refused
  RED> 1 failed, 8 deselected in 11.61s
  cp restore done; cmp: identical (exit 0, no output)
  GREEN> exit=0 1 passed, 8 deselected in 5.13s
### N4: remove the token from daily_pnl_read_verdict (two lines deleted)
  cmd: pytest tests/test_daily_pnl_read_verdict.py
  neuter exit=1
  RED> E       AssertionError: assert () == ('daily_pnl_non_usd_okx',)
  RED> E         
  RED> E         Right contains one more item: 'daily_pnl_non_usd_okx'
  RED> E         Use -v to get more diff
  RED> E       AssertionError: assert () == ('daily_pnl_non_usd_okx',)
  RED> E         
  RED> E         Right contains one more item: 'daily_pnl_non_usd_okx'
  RED> E         Use -v to get more diff
  cp restore done; cmp: identical (exit 0, no output)
  GREEN> exit=0 973 passed in 6.61s
### N5: record the census dict as the flag value (`_record_dq_flag("daily_pnl_non_usd_okx", True)` -> `..., dict(_okx_non_usd_census))`)
  cmd: pytest tests/test_okxtrades_ccy.py -k test_the_flag_carries_no_venue_text
  neuter exit=1
  RED> E       AssertionError: assert {'malformed': 1} is True
  RED> FAILED tests/test_okxtrades_ccy.py::TestOkxNonUsdBillRefusedByName::test_the_flag_carries_no_venue_text
  RED> 1 failed, 8 deselected in 5.01s
  cp restore done; cmp: identical (exit 0, no output)
  GREEN> exit=0 1 passed, 8 deselected in 4.53s
### N6: remove the token from routers/cron.py::_fetch_degradation (two lines deleted)
  cmd: pytest tests/test_cron_router.py tests/test_daily_pnl_read_verdict.py -k TruncatedWindow or parity or non_usd
  neuter exit=1
  RED> E           AssertionError: ('daily_pnl_non_usd_okx', [])
  RED> E           assert [] == ['daily_pnl_non_usd_okx']
  RED> E             
  RED> E             Right contains one more item: 'daily_pnl_non_usd_okx'
  RED> E             Use -v to get more diff
  RED> E       AssertionError: rows WERE returned (so `per_strategy_stored > 0` would have held) and the key still must not read healthy. Got {'key_id': 'live', 'strategy_id': 'strat-live', 'strategy_ids': ['strat-live'], 'exchange': 'okx', 'trades_fetched': 1, 'trades_stored': 1, 'per_strategy_stored': {'strat-live': 1}, 'balance_usdt': None, 'duration_s': 0.0, 'status': 'ok', 'trades_fetched_at_stamped': 1}
  RED> E       assert 'ok' == 'error'
  RED> E         
  cp restore done; cmp: identical (exit 0, no output)
  GREEN> exit=0 495 passed, 662 deselected in 4.92s
### N7: remove the token from READ_INCOMPLETE_TOKENS
  cmd: pytest tests/test_derive_broker_dailies_dualmode.py -k test_the_token_set_is_exactly_the_shipped_closed_set or test_okx_non_usd_refuses
  neuter exit=1
  RED> E       AssertionError: assert 'transient' == 'permanent'
  RED> E         
  RED> E         - permanent
  RED> E         + transient
  RED> E       AssertionError: assert frozenset({'b..._error', ...}) == frozenset({'b...ed_okx', ...})
  RED> E         
  RED> E         Extra items in the right set:
  RED> E         'daily_pnl_non_usd_okx'
  cp restore done; cmp: identical (exit 0, no output)
  GREEN> exit=0 2 passed, 107 deselected in 7.63s
### N8: add the token to _TRANSIENT_REFUSAL_TOKENS
  cmd: pytest tests/test_derive_broker_dailies_dualmode.py -k test_okx_non_usd_refuses
  neuter exit=1
  RED> E       AssertionError: assert 'transient' == 'permanent'
  RED> E         
  RED> E         - permanent
  RED> E         + transient
  RED> FAILED tests/test_derive_broker_dailies_dualmode.py::TestRealizedReadRefusedByName::test_okx_non_usd_refuses_the_key_permanently_and_writes_only_the_marker
  RED> 1 failed, 108 deselected in 4.60s
  cp restore done; cmp: identical (exit 0, no output)
  GREEN> exit=0 1 passed, 108 deselected in 4.62s
```

(The parenthetical neuter descriptions are the script's labels; the RED/GREEN lines are the run's own output. N6 and N7 show only the first eight failure lines; their `-k` selection was a shell-quoted `or` expression passed as one argument, the log prints it unquoted.)

## Records

closes-todos: 167.1.2.2.2.1-OKX-DAILY-PNL-MIXED-CCY (VREAD-06)
handoff-223: services/okx_archive_job.py::_check_live_realized_flags matches only daily_pnl_fetch_error and daily_pnl_truncated_okx, so with [] plus daily_pnl_non_usd_okx it proceeds on an empty live realized series; Phase 223 adds: if flags.get("daily_pnl_non_usd_okx"): raise _Stop("live_anchor_unusable", "live_realized=non_usd")
recorded: the composite member read never drains flags and reads [] as flat; out of v1.22 by founder ruling F-2 (186-COMPOSITE-MEMBER-READ-GAPS out of scope)
recorded: a spot-trading OKX key that pays fees in the base coin refuses by name (ruling Q3); no OKX spot key is stored on PROD
recorded: the daily row's fee_currency label stays USDT for a USDC or DAI day (unchanged)

## Re-fixtured tests (old to new expectation; none deleted)

| File / test | Old | New |
|---|---|---|
| `test_exchange.py::test_okx_bill_dropped_on_non_digit_ts_logs_warning` | bills B1..B3 carried no `ccy` | each carries `"ccy": "USDT"`; same assertions (malformed flag, two WARNINGs naming B2 and B3) |
| `test_exchange.py::test_okx_funding_bills_excluded_from_daily_pnl` | (plan 232-02 already added `ccy` USDT) | unchanged here |

The census greps and the plan's command found no other OKX bill that the refusal breaks. No file outside the plan's `<files>` was edited.

## Deviations from Plan

**1. [Process] Task 2 registration written before its tests went RED.** The `job_worker.py` registration and the matrix, derive and cron test edits were made in one pass, so those tests passed on first run. The RED evidence for the registration arms is the PROOF-01 neuters N4, N6, N7 and N8 (each goes RED naming the arm), which is the stronger proof; the tracer and the currency arms' pre-fix RED is the tracer record above plus N1..N3, N5. Same shape as plan 232-02 deviation 1.

**2. [Rule 3 - recorded] The venv was absent in this worktree** (the plan 232-02 summary describes one bootstrapped in its own worktree); bootstrapped again from the main checkout's interpreter, main's venv untouched.

**3. [Process] The `daily_totals` clear was replaced by an explicit `return []`** after the flag and the WARNING (plan 232-02's hand-off said the refusal must `return []` itself); behaviour identical, one fewer state to reason about.

## Known Stubs

None.

## Threat Flags

None. The flag value is the boolean True; venue currency codes reach only one WARNING line, by count, after a `^[A-Za-z0-9]{1,16}$` check (T-232-09, N5).

## Self-Check: PASSED

- `analytics-service/tests/test_okxtrades_ccy.py` exists (class `TestOkxNonUsdBillRefusedByName`, 1 match); commits 445131f01, bf111c75e, fa7d917a6 are ancestors of HEAD.
- Acceptance greps: `daily_pnl_non_usd_okx` in `exchange.py`, `job_worker.py` (2), `cron.py`, `test_cron_router.py`, `test_derive_broker_dailies_dualmode.py`; `== 480` 0 and `== 960` 1 in `test_daily_pnl_read_verdict.py`; the seven named currency tests present.
- `git diff --quiet 0cdf250c5 HEAD -- services/okx_archive_job.py services/funding_fetch.py` exits 0; no `job_worker.py` hunk names `run_sync_trades_job`; STATE.md and ROADMAP.md untouched.
- `node scripts/verify-plan-anchors.mjs` on this plan: `OK: 1 plan file(s), no stale claims.`
- Final files byte-identical to the pre-neuter backups after N8 (`cmp` per block); mypy strict clean; affected set `3347 passed, 1 skipped`.
