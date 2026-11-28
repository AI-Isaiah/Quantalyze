---
phase: 256-okxunitswitch
plan: 03
subsystem: analytics-service
tags: [okx, unit-switch, bills, fetch, side-channel, proof-01]
status: complete

requires:
  - phase: 256-01
    provides: services/unit_switch.py (UnitSwitch, CoinBillCensus, UnitSwitchResolver)
provides:
  - "services/exchange.py: keyword-only unit_switch on fetch_daily_pnl and fetch_all_trades"
  - "services/exchange.py: UnitSwitchRead, _LAST_UNIT_SWITCH_READ, get_and_clear_last_unit_switch_read"
  - "services/exchange.py: _LAST_OKX_CCY_SHARE, get_and_clear_last_okx_ccy_share"
  - "tests/test_okx_unit_switch_fetch.py: SC-4 both ways, the AST call-site pin, the live share tests"
affects: [256-04, 256-06]

plan_head_before: 663b5e0869e29ea23262793cc6eb7aaf5eae112f
plan_head_after: 42df85cd251728f2f14d260c80bd874252c8b6dc

# Actuals (#2632): chars/4 over the realized diff (exchange.py +208 lines, the new test file, 15 lines
# in test_okxtrades_ccy.py), about 30000 chars. commits is MEASURED from the per-plan ledger
# (git rev-list --count plan_head_before..plan_head_after); the SUMMARY commit that follows is not in
# that range.
actuals:
  tokens: 7500
  tasks: 3
  commits: 1

tech-stack:
  added: []
  patterns: ["ContextVar side channel drained by the caller, reset at the fetch entry seam (the DQ-flags idiom)", "opt-in keyword, default byte-identical refusal", "AST call-site pin with a self-test that proves the checker can fire"]

key-files:
  created:
    - analytics-service/tests/test_okx_unit_switch_fetch.py
  modified:
    - analytics-service/services/exchange.py
    - analytics-service/tests/test_okxtrades_ccy.py

key-decisions:
  - "The AST pin permits two sites, not one: run_derive_broker_dailies_job (the only ASKER) and fetch_all_trades in exchange.py (the definition-site FORWARDER, which passes the keyword on and asks nothing). The pin also asserts the forwarder is found, so the scan cannot pass vacuously."
  - "The census handed to the resolver upper-cases the code and uses fullmatch; a code with a trailing newline (which the Phase 232 regex .match accepts) is treated as unusable and refuses, never reaches the resolver."
  - "A coin bill whose ts will not parse (not str.isdigit) cannot be placed in either unit: with a resolver it refuses by daily_pnl_non_usd_okx and the resolver is not awaited."
  - "A blank or malformed ccy is tracked by a boolean set in the branch, not by the Counter key, because the literal ccy strings 'blank' and 'malformed' are valid codes under _OKX_CCY_CODE_RE and would collide with the census labels."
  - "On a resolver refusal the stored UnitSwitchRead carries the census and the token with EMPTY day maps; on a switch the stable_by_day is a sorted copy of daily_totals (equal to the returned records)."

requirements-completed: [SC-4, SC-7]

duration: about 1h
completed: 2026-11-27
---

# Phase 256 Plan 03: FETCH Summary

**The OKX bills read now books one switched coin's bills on a drained side channel when (and only when) the derive passes a `unit_switch` resolver; every other caller, every other coin and every unusable `ccy` still refuses with `daily_pnl_non_usd_okx`, and an AST test pins that nobody but the derive can ask.**

## What was built

- `fetch_daily_pnl(..., unit_switch: UnitSwitchResolver | None = None)` and `fetch_all_trades(..., unit_switch=...)` (forwarded unchanged), keyword-only, default `None`.
- In the OKX branch the loop that already counted non-stable bills now also keeps each regex-valid coin bill as (upper-case code, UTC day or `None`, signed `pnl + fee`). After the walk, `_okx_book_switched_coin` runs only when the census is non-empty AND a resolver was passed AND no counted code was blank or malformed. It builds the `CoinBillCensus` (code to first UTC day and count) and awaits the resolver ONCE.
  - `UnitSwitch` whose coin equals every counted code and with every coin day on or after `last_usd_day`: the census is cleared, `daily_totals` stays the stable P&L, a `UnitSwitchRead` is stored, one INFO line (`coin=%s coin_bills=%d coin_days=%d`, closed code and counts only) is logged, and the normal record loop runs.
  - `UnitSwitch` that does not cover every bill: refuse exactly as before; nothing stored.
  - A string: refuse as before and store a `UnitSwitchRead` with `refusal` set (`switch None`, empty day maps, census kept).
- `UnitSwitchRead` (frozen slots dataclass: `switch`, `refusal`, `census`, `stable_by_day`, `coin_by_day`), `_LAST_UNIT_SWITCH_READ` reset to `None` at the `fetch_daily_pnl` entry seam beside `_LAST_DQ_FLAGS.set({})`, drained by `get_and_clear_last_unit_switch_read()`.
- `fetch_okx_total_equity_and_upl_usd` records the live per-ccy share from the SAME `details` of the same single balance response into `_LAST_OKX_CCY_SHARE` (reset at entry, drained by `get_and_clear_last_okx_ccy_share()`); the 3-tuple return is untouched. Details with a ccy that does not fullmatch `_OKX_CCY_CODE_RE`, or an `eqUsd` that is non-finite, negative or unparseable, are dropped; no positive sum records nothing.
- Coin amounts never enter `daily_totals` or a `daily_pnl` record (records stay `fee_currency: "USDT"`).

## OKX v5 field semantics consulted

Read from the live OKX v5 docs page (Get bills details, 2026-11-27): `pnl` is "Profit and loss (excluding the fee)", `fee` is negative for a charge and positive for a rebate, both denominated in the bill's `ccy` (the account balance currency). That is why `pnl + fee` in the bill's own `ccy` is the right per-bill amount and why a spot sell's USDT-charged fee lands on the USDT bill (fixture g) and never in the coin census.

## Deviations from Plan

None that change behaviour. Judgement calls inside the plan's room, surfaced here (Rule 7):

1. **Zero-amount USDT legs produce zero-price records.** The plan's tracer text says the returned records "cover 11-10 and 11-12 only" while its fixture also lists zero-amount USDT legs on 11-14 and 11-20. The Phase 232 behaviour (a zero amount contributes 0 to `daily_totals`, which creates a day entry and a record with price 0, pinned by `test_a_zero_amount_bill_in_another_currency_is_counted_not_refused`) is unchanged, so the tracer asserts the four days 11-10, 11-12, 11-14, 11-20 with 9.0, 3.5, 0.0, 0.0. The 11-14 and 11-20 records are zero-priced stable days; no coin amount is in any record. `stable_by_day` equals those records.
2. **The AST pin names two permitted sites** (see key-decisions): the derive and the `fetch_all_trades` forwarder. The plan said "zero such calls is allowed at this plan"; the forwarder is a real call carrying `unit_switch=` inside exchange.py, so it needs its own named allowance. The derive site does not exist yet (plan 06).
3. **Tasks 1 and 2 landed in one commit** (`42df85cd2`), because the keyword and the equity-share channel live in the same file and the tracer's test file carries every arm. Task 3 changes no tracked file (it is the proof), so it has no commit.
4. **Trailers.** The orchestrator's rules say no AI attribution trailers (matches the founder's standing memory rule), which overrides the harness attribution reminder; the commit carries none.
5. **Environment:** the worktree has no `.venv`; pytest and mypy used the main checkout's Python 3.12 venv read-only. Iteration used `--noconftest -p no:cacheprovider`; the plan's verify set was run once with the repo conftest at the end.

## Verification

- With conftest, main venv: `tests/test_okx_unit_switch_fetch.py tests/test_okxtrades_ccy.py tests/test_daily_pnl_read_verdict.py tests/test_cron_router.py tests/test_okx_archive_job.py tests/test_unit_switch.py`: `1442 passed in 75.81s`. `test_cron_router.py` and `test_okx_archive_job.py` unchanged.
- `make typecheck` (mypy strict CI path set, `MYPY=` pointed at the main venv's mypy): `Success: no issues found in 147 source files`. `mypy tests/test_okx_unit_switch_fetch.py`: `Success: no issues found in 1 source file`.
- Acceptance: `grep -c unit_switch services/exchange.py` is well above 4; `def get_and_clear_last_unit_switch_read` 1; `def get_and_clear_last_okx_ccy_share` 1; the tracer asserts `coin_by_day == {"2026-11-14": -0.0012, "2026-11-20": -0.0009}` and the absence of the flag.

## PROOF-01

Byte backup with `cp`, neuter with a one-line replacement (`scratchpad/neuter.py` asserts the anchor is unique), run, restore with `cp`, `cmp` (silent), run GREEN. No `git checkout` / `restore` / `stash`. Runs below used `--noconftest -p no:cacheprovider`.

### Pre-fix RED (origin/main `exchange.py` swapped in from `git show HEAD~:` and restored byte-exact)

```
=== PRE-FIX RED (origin/main exchange.py) ===
FAILED ...::test_tracer_a_switched_coin_is_read_as_stable_pnl_with_the_coin_bills_on_the_side_channel
FAILED ...::test_without_the_keyword_the_same_bills_still_refuse_by_name
FAILED ...::test_a_bill_in_any_other_coin_still_refuses_even_beside_a_switched_one
FAILED ...::test_a_resolver_refusal_refuses_and_its_token_reaches_the_caller
FAILED ...::test_only_the_derive_may_pass_unit_switch
FAILED ...::TestLiveCcyShare::test_the_share_comes_from_the_same_balance_response
(and the remaining keyword / side-channel arms)
20 failed, 11 passed in 19.78s     <- includes tests/test_okxtrades_ccy.py: its default-keyword arm is GREEN pre-fix by design
=== cmp ===
(cmp silent: identical)
=== GREEN ===
31 passed in 15.44s
```

### Gate A, booking (neutered: the coin amount is also added into `daily_totals`)

```
=== GATE A RED (neutered: the coin amount is also added into daily_totals) ===
E         comparison failed. Mismatched elements: 2 / 4:
FAILED tests/test_okx_unit_switch_fetch.py::TestSwitchedCoinIsBookedOnlyWhenAsked::test_tracer_a_switched_coin_is_read_as_stable_pnl_with_the_coin_bills_on_the_side_channel
1 failed, 20 passed in 13.09s
=== cmp (must print nothing) ===
=== GATE A GREEN ===
.....................                                                    [100%]
21 passed in 11.75s
```

### Gate B, other-coin refusal (neutered: `if code != resolved.coin or day < ...` becomes `if day < ...`, so an ETH bill is booked)

```
=== GATE B RED (neutered: a code other than the switched coin no longer refuses) ===
FAILED tests/test_okx_unit_switch_fetch.py::TestSwitchedCoinIsBookedOnlyWhenAsked::test_a_bill_in_any_other_coin_still_refuses_even_beside_a_switched_one
1 failed, 20 passed in 14.12s
=== cmp (must print nothing) ===
=== GATE B GREEN ===
.....................                                                    [100%]
21 passed in 14.27s
```

### Gate C, call-site pin (neutered copy of `job_worker.py`: the sync_trades `fetch_all_trades` call gets `unit_switch=None`)

```
=== GATE C RED (neutered: sync_trades passes unit_switch=None) ===
E       AssertionError: only run_derive_broker_dailies_job may pass unit_switch to the OKX bills read (sync_trades, the cron tick and okx_archive_job keep refusing): [('services/job_worker.py', 'run_sync_trades_job', 2375)]
FAILED tests/test_okx_unit_switch_fetch.py::TestOnlyTheDeriveMayAsk::test_only_the_derive_may_pass_unit_switch
1 failed, 20 passed in 17.57s
=== cmp (must print nothing) ===
=== GATE C GREEN ===
.....................                                                    [100%]
21 passed in 16.51s
```

After all three gates `git status --short` was empty and `cmp` of `exchange.py` against the committed-state backup printed nothing, so no neutered byte was left in the tree. The AST checker is itself proven able to fire by `test_the_checker_flags_a_call_site_outside_the_derive` (a synthetic sync_trades-shaped call and a `**` splat are both found).

## Known Stubs

None.

## Threat Flags

None. T-256-07: the only new log line carries the closed coin code and two counts (no amount, bill id or venue string), and the ccy is fullmatched against `_OKX_CCY_CODE_RE` before it is kept. T-256-08: gate A proves a coin amount never enters `daily_totals`. T-256-09: the keyword defaults to `None` with the refusal path byte-identical, and gate C proves only the derive can ask. No new network endpoint, auth path or schema.

## Open items for later plans

- Plan 06 adds the derive's `unit_switch=` call inside `run_derive_broker_dailies_job`; the pin already permits exactly that site. The resolver it builds may also return `holdings_read_failed`, which `UnitSwitchRead.refusal` carries verbatim.
- The caller must drain `get_and_clear_last_unit_switch_read()` and `get_and_clear_last_okx_ccy_share()` on the statement after the await, as it does for the DQ flags; `asyncio.wait_for` on Python 3.12 runs the coroutine in the caller's context, the same assumption the DQ drain already makes.

## Self-Check: PASSED

- FOUND: analytics-service/tests/test_okx_unit_switch_fetch.py
- FOUND: `def get_and_clear_last_unit_switch_read` and `def get_and_clear_last_okx_ccy_share` in analytics-service/services/exchange.py
- FOUND commit 42df85cd2 (ancestor of HEAD)
