---
phase: 184-walletoffset-the-first-mark-offset-on-wallet-base-venues-is
round: 1
reviewed: 2026-11-01T15:20:10Z
reviewed_at_sha: 2e3142511cdcda85d12b87bf481ef6f6f1a238cc
diff_base: b1121aa7a
depth: deep
files_reviewed: 3
files_reviewed_list:
  - analytics-service/scripts/walletoffset_probe.py
  - analytics-service/tests/test_walletoffset_probe.py
  - analytics-service/tests/_okx_bills.py
findings:
  critical: 1
  warning: 2
  info: 9
  total: 12
severity_map:
  HIGH: 1
  MEDIUM: 2
  LOW: 6
  INFO: 3
status: issues_found
---

# Phase 184: Code Review Report (round 1)

**Reviewed:** 2026-11-01T15:20:10Z, at `2e3142511`, diff `b1121aa7a..HEAD -- . ':!.planning'`
**Depth:** deep (I traced every service function the probe calls: `fetch_daily_pnl`, `fetch_funding_okx`, `fetch_funding_bybit`, `walk_paginated`, `fetch_bybit_unified_flows`, `fetch_ccxt_transfers`, `_resolve_ccxt_flow_price_index`, `_cache_coingecko_prices`, `placed_flow_instants`, `read_key_marks`, `BudgetedExchange`, `ReadOnlySupabase`, `create_exchange`, `decrypt_credentials`)
**Files Reviewed:** 3
**Status:** issues_found

Severity tiers: HIGH is the BLOCKER tier (CR-), MEDIUM is WARNING (WR-), and LOW and INFO are listed under Info (IN-) with their tier in the title.

## Summary

Verdict on the four focus areas:

- **Write paths: none found.** The only database handle is `ReadOnlySupabase(get_supabase())`. Its table handle exposes `select` and nothing else. The one hidden write the call chain contains, `_cache_coingecko_prices`'s `token_price_history` upsert, hits the wrapper's `AttributeError` inside the helper's own `try` and is swallowed. OKX and Bybit `private_get_*` reads go through `BudgetedExchange`, which resolves GET names only. The raw client reaches only GET paths: ccxt `fetch_deposits` and `fetch_withdrawals`, `fetch_ohlcv`, Binance `fapi.../income`, and `close`. `create_exchange` has no side effects. No Sentry init is reachable from the probe's imports.
- **Leaks: none found on stdout or stderr.** `emit_record` validates every record against a closed vocabulary and checks it with `assert_sanitized`. Every per-key exception becomes a `(reason, class)` pair, and the message is never read. A run-level failure prints the type only. Logging is disabled before `run()`. The imported modules log nothing at import time. The planted-needle test is real, and its leaky-emitter control fails as it should.
- **Window and sums: correct against the chain for OKX and Bybit.** `[B, R]` is inclusive at both edges. That matches the chain's UTC-day bucketing for `ts == B` and `placed_flow_instants`' `<= read_at`. The OKX rule matches `fetch_daily_pnl`'s OKX branch plus `fetch_funding_okx`: same instTypes, type 8 dropped from trading, funding from type-8 `pnl`. The Bybit row formula is proven equal to `fetch_daily_pnl` by a parity test. **The Binance reader is dead in production (CR-01).**
- **Tests that can fail: mostly yes**, with two gaps. The fakes define a method name that real ccxt lacks, which is what hid CR-01. The OKX sum has no parity test against the chain (WR-01).

All 171 tests pass. `mypy --strict` on the probe is clean.

## Critical Issues

### CR-01 [HIGH]: the Binance reader calls a method that does not exist on a real ccxt client, so every marked Binance key prints `read_failed`/`other`

**File:** `analytics-service/scripts/walletoffset_probe.py:886` (and the docstring at `:50` and `:880-882`); test fake at `analytics-service/tests/test_walletoffset_probe.py:2551`

**Issue:** `_measure_binance` awaits `client.fapiPrivate_get_income(...)`. ccxt 4.5.89, the version pinned in `requirements.txt:33`, generates `fapiprivate_get_income` (all lower case) and `fapiPrivateGetIncome`. It does not generate the mixed-case name. Checked on the pinned venv: `hasattr(ccxt.async_support.binance(), "fapiPrivate_get_income")` is `False` (also `False` on `binanceusdm`), and the class has no `__getattr__`.

I drove `_measure_binance` on a real `ccxt.async_support.binance` instance. It raises `AttributeError` before any network call, and `failure_token` maps that to `('read_failed', 'other')`.

The test fake `_BinanceVenue` defines `fapiPrivate_get_income` itself, so all Binance tests pass against a method that real ccxt does not have. Plan 03's coverage claim D2 ("A marked Binance key is measured from one futures-income read") is therefore false in production.

**Scenario:** a Binance key gets its first mark before plan 04 runs. The probe prints `k7 binance read_failed other`, sets `binance_state: unmeasured` and exits 1. The founder gets "Binance unmeasurable" for a reason in our own code, not at the venue, and `failure_class: other` does not say so. It fails closed (no invented number), which is why this is HIGH and not CRITICAL.

**Fix:** use the name ccxt generates, and pin the fake's names to real ccxt so a fake cannot invent a method again:

```python
# walletoffset_probe.py:886
reply = await client.fapiPrivateGetIncome(
    {"startTime": b_ms, "endTime": r_ms, "limit": BINANCE_INCOME_LIMIT}
)
```

```python
# tests: rename _BinanceVenue.fapiPrivate_get_income -> fapiPrivateGetIncome, and add:
def test_every_venue_method_the_probe_names_exists_on_real_ccxt() -> None:
    import ccxt.async_support as cx
    for cls, name in (
        ("binance", "fapiPrivateGetIncome"),
        ("okx", "private_get_account_bills_archive"),
        ("bybit", "private_get_v5_position_closed_pnl"),
        ("bybit", "private_get_v5_account_transaction_log"),
    ):
        assert hasattr(getattr(cx, cls), name), (cls, name)  # class attribute, no instance/session
```

Mutation check: put back `fapiPrivate_get_income` and the new test goes RED.

## Warnings

### WR-01 [MEDIUM]: the OKX sum restates the chain's rule but no test drives the chain's own OKX code on the same bills

**File:** `analytics-service/scripts/walletoffset_probe.py:475-523` (`okx_window_terms`); tests `analytics-service/tests/test_walletoffset_probe.py:549-605`

**Issue:** The docstring calls the OKX terms "the chain's own rule". The rule is copied from two places: `fetch_daily_pnl`'s OKX branch (`services/exchange.py:1442-1606`: instType loop SWAP/FUTURES/SPOT/MARGIN, `type == "8"` dropped, `pnl + fee`) and `fetch_funding_okx` (`services/funding_fetch.py:467-605`: type 8, `pnl`). Bybit has a parity test (`test_bybit_parity_with_fetch_daily_pnl`) that drives the real `fetch_daily_pnl`. OKX has none. Its tests compare the probe with hand-written literals, which pins the probe to itself.

Two real differences go unchecked:
- The chain selects bills by the instType *query filter*. The probe selects by each bill's own `instType` field.
- The chain adds a bill whose `pnl` is not finite as 0 and keeps going (`exchange.py:1580-1588`). The probe refuses the whole key.

**Scenario:** a later edit to the chain changes the funding-type set or the instType loop. The probe keeps printing the old quantity, every probe test stays green, and the founder decides from an offset that no longer matches the chain.

**Fix:** add `test_okx_parity_with_fetch_daily_pnl_and_fetch_funding_okx`. Serve one set of bills through a fake that honours `instType` and `type` query filters on both `private_get_account_bills` and `private_get_account_bills_archive` (the `OkxBillsArchive` helper already honours both). Include trade bills on each of the four instTypes, a type-8 USDT bill, an OPTION bill and a type-1 blank-instType bill. Run `fetch_daily_pnl(venue, since_ms=None)` plus `fetch_funding_okx(venue, "k1", None)`, sum the read day's totals, and assert they equal `trading_usd + funding_usd` from `okx_window_terms` on the same bills. Show it RED by swapping the type-8 branch into trading.

### WR-02 [MEDIUM]: `fetch_funding_bybit` silently drops malformed SETTLEMENT rows, so a Bybit key can print a funding sum missing rows, with nothing to show it

**File:** `analytics-service/scripts/walletoffset_probe.py:770-783` (consumer); dropping happens in `services/funding_fetch.py:762-786` and `:298-307`

**Issue:** The module docstring (`:43-45`) and threat T-184-08 say a reader never prints a partial sum. `fetch_funding_bybit` drops two kinds of row with only a log line, and logging is disabled for the run:
- a row with no `funding`/`change`/`cashFlow` field;
- a row whose `symbol` is blank, whose amount is not a Decimal, or whose `transactionTime` cannot be parsed. `_normalize_funding_row` returns `None` for these, and the row is counted only in a local `dropped[0]`.

The probe then sums what remains and prints `measured: true, partial: false`. OKX refuses a non-finite value as `malformed` (`:504-512`), and the Bybit closed-pnl path does the same (`:745-746`). Bybit funding is the one sum with no such refusal.

**Scenario:** one SETTLEMENT row in [B, R] arrives with a blank `symbol`. It is dropped, the key prints `pnl_funding_ratio` without it, and `partial` stays `false`.

**Fix:** keep the chain's quantity but make the drop visible. Read the transaction-log rows yourself through the budgeted view, as for closed P&L, and refuse `malformed` on any SETTLEMENT row in [B, R] that `_normalize_funding_row` would drop. Or, at minimum, compare the count of raw SETTLEMENT rows in [B, R] with `funding_rows_in_window` and raise `Unmeasurable("malformed")` when they differ. Add a test with a blank-symbol SETTLEMENT row in the window that expects `malformed`.

## Info

### IN-01 [LOW]: `non_stable_rows`, and so `partial`, counts bills that the chain sum would never include

**File:** `analytics-service/scripts/walletoffset_probe.py:497-503`
**Issue:** `non_stable += 1` runs before the instType check. A BTC type-1 transfer (instType blank) or a BTC OPTION bill marks the key `partial: true`, yet neither bill is in the chain's sum, so nothing was left out.
**Scenario:** a key with one in-window BTC transfer between its funding and trading accounts reads `partial: true`. The founder discounts a complete measurement.
**Fix:** move the stablecoin check below `if not is_funding and inst_type not in _OKX_CHAIN_INST_TYPES: continue`, and keep counting other-instrument bills in `other_inst`.

### IN-02 [LOW]: `keys_marked` counts a key whose marks could not be read

**File:** `analytics-service/scripts/walletoffset_probe.py:1008`, `:1020`
**Issue:** "Marked" is defined as `unmeasurable_reason != "no_mark"`. A key whose `read_key_marks` raised (`read_failed`) is therefore counted as marked, whether or not it has a mark.
**Fix:** document that `keys_marked` means "marked or unknown", or split out a `keys_marks_unread` count.

### IN-03 [LOW]: the docstrings say every Bybit `private_get_` call is counted, but the Bybit deposit and withdrawal record calls are not

**File:** `analytics-service/scripts/walletoffset_probe.py:85-88`, `:756-758`
**Issue:** `_window_flows` passes the unwrapped client to `fetch_ccxt_transfers`. On Bybit that function makes its own raw `private_get` deposit and withdrawal record calls (`services/ccxt_flow_fetch.py:171-181`), outside `KEY_CALL_CEILING`. These are reads, so this is not a write path.
**Fix:** correct the sentence, or wrap those calls too.

### IN-04 [LOW]: `deploy_fingerprint` cannot tell two builds apart if they share vocabulary sizes and the venue list

**File:** `analytics-service/scripts/walletoffset_probe.py:1203-1218`
**Issue:** The docstring says the fingerprint shows "the worker is shown to run the reviewed code". It hashes no logic. The CR-01 fix, for example, leaves it byte-identical: `walletoffset 0 1 27 30 14 binance,bybit,okx`. Plan 04's separate `deployed-commit` ancestry check is what actually covers staleness.
**Fix:** add `hashlib.sha256(Path(__file__).read_bytes()).hexdigest()[:12]` to the line, or soften the docstring and name the commit check as the control.

### IN-05 [LOW]: Bybit and Binance reads have no 429 retry, and plan 04 runs the probe beside a live worker on the same keys

**File:** `analytics-service/scripts/walletoffset_probe.py:704-705`, `:886`
**Issue:** Only the OKX walk goes through `_okx_bills_fetch_with_backoff`. A `RateLimitExceeded` on Bybit closed-pnl or Binance income becomes `read_failed`. That fails closed, but plan 04 step 4 runs the probe in the background next to `main_worker`, which can be crawling the same key. A rate-limit failure costs the founder another Railway redeploy cycle.
**Fix:** route those two calls through the same backoff helper, or note in plan 04 that the run should be retried on a `RateLimitExceeded` record.

### IN-06 [LOW]: no recency guard on Bybit and Binance, so a non-stable flow can be valued at an unclosed daily candle

**File:** `analytics-service/scripts/walletoffset_probe.py:1106`
**Issue:** `window_too_recent` applies to OKX only. A run on R's own UTC day prices a non-stable flow at the in-progress OHLCV candle (`_resolve_ccxt_flow_price_index`). The chain later values the same flow at the day's close. This is theoretical for the planned run, whose first marks are days old.
**Fix:** refuse `window_too_recent` for every venue when `run_at.date() <= read_at.date()`.

### IN-07 [INFO]: an unvalued flow throws away a measurable P&L part

**File:** `analytics-service/scripts/walletoffset_probe.py:643-644`
**Issue:** `flow_unvalued` makes the whole key unmeasurable. The docstring itself says the P&L part is what mis-states the base, and that part was already computed.
**Fix:** design choice; consider printing the P&L ratios and leaving `flow_ratio`/`offset_ratio` as `field-absent`.

### IN-08 [INFO]: unused constant, and an imprecise docstring

**File:** `analytics-service/scripts/walletoffset_probe.py:198`, `:31-32`
**Issue:** `_SHARED_ACCOUNT_KINDS` is never read. The docstring says a type-1 transfer is "summed nowhere". Code and chain both exclude it only because its instType is blank (the test uses `inst_type=""`). A type-1 bill with one of the four instTypes would be summed, as the chain would sum it.
**Fix:** delete the constant, and word the sentence by instType.

### IN-09 [INFO]: a `BaseException` escapes `main`

**File:** `analytics-service/scripts/walletoffset_probe.py:1229`
**Issue:** `except Exception` does not catch `asyncio.CancelledError`, which would print a full interpreter traceback to stderr. The traceback carries code lines and paths, and no ids, since `CancelledError` has no message.
**Fix:** `except BaseException` with the same type-only print, then re-raise `KeyboardInterrupt`/`SystemExit` if wanted.

## Out of phase scope: a pre-existing chain defect (HIGH, route to the founder, do NOT fix in this phase)

**Files:** `analytics-service/services/exchange.py:1658`, `analytics-service/services/funding_fetch.py:379` (also the call at `services/job_worker.py:7341`)

The chain itself calls `exchange.fapiPrivate_get_income(...)`, the same name that does not exist (see CR-01). On a real client:
- `fetch_daily_pnl`'s Binance branch hits the `AttributeError` inside its broad `except Exception`. It falls back to BTC/USDT spot trades and only sets `daily_pnl_binance_income_fallback`. Binance futures realized P&L therefore never reaches `daily_pnl`.
- `fetch_funding_binance` re-raises the error. The `derive_broker_dailies` call at `job_worker.py:7341` catches only `asyncio.TimeoutError`, so a Binance derive fails at its funding read.

This may explain the CONTEXT's "no Binance key has inputs yet". That is an inference, not measured.

`tests/test_exchange_harness.py:87,349,372,388` assign the same mixed-case attribute on mocks, which is why this was never caught. Fixing it changes published Binance numbers, so it is outside SC-3 for this phase. It needs its own phase and the founder's decision.

---

_Reviewed: 2026-11-01T15:20:10Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_


## Fix round 1

**Scope:** CR-01, WR-01, WR-02 only. The LOW and INFO items (IN-01 to IN-09) and the out-of-scope chain defect in `services/exchange.py` and `services/funding_fetch.py` are untouched; the chain defect is routed to the founder.

| Finding | Status | Commit |
|---|---|---|
| CR-01 | fixed | `fe8dd4315` |
| WR-01 | tests added, probe unchanged (parity holds) | `ec3708eb1` |
| WR-02 | fixed | `75c542b8c` |

**CR-01.** The probe now calls `client.fapiPrivateGetIncome` (the docstring too). The test fake `_BinanceVenue` uses the same name. New test `test_every_venue_method_the_probe_names_exists_on_real_ccxt` reads every `fapiPrivate*` and `private_get_*` call name out of the probe source and checks it, plus the OKX archive and the two Bybit names, against the real `ccxt.async_support` okx, bybit and binance classes. RED before the fix: the new test failed on `('binance', 'fapiPrivate_get_income')` and 19 Binance tests failed against the renamed fake. GREEN after.

**WR-01.** New test `test_okx_parity_with_fetch_daily_pnl_and_fetch_funding_okx` drives the real `fetch_daily_pnl` and `fetch_funding_okx` on one set of bills (four instTypes, two type-8 rows, an OPTION bill, a blank-instType transfer, a bill the day before) and compares the read day's totals with `okx_window_terms`. Parity holds, so the probe is not changed: selecting a bill by its own `instType` gives the chain's per-instType query set. Neutering the type-8 branch into trading turned it RED (10.95 vs 12.7), and adding OPTION to the instType set turned it RED (51.7 vs 12.7); both restored from a byte backup (`cmp` clean). One difference remains and is kept on purpose: a trading bill whose `pnl` or `fee` is not finite is dropped by `fetch_daily_pnl` with a warning, and refused as `malformed` by the probe. For a funding bill the chain's `fetch_funding_okx` keeps a `NaN` or `Infinity` `pnl` (`Decimal` parses both) and drops only a blank or unparseable one; the probe refuses all of them, so it prints no number either way. The refusal prints no number, and existing tests pin it. (Corrected in round 2, judgement call 5. "No finite input differs" was also wrong: see WR-03.)

**WR-02.** `_measure_bybit` hands `fetch_funding_bybit` a one-method view whose transaction-log call counts the rows each reply carries (through the budgeted view, so the call ceiling still applies). If that count differs from the number of rows the function returns, the key is `malformed`. The count covers every row read from B on, not only [B, R]: it needs no second copy of the chain's parse rule and can only over-refuse (a drop after R), which fails closed. New test `test_bybit_a_settlement_row_the_chain_drops_makes_the_key_malformed_never_a_clean_sum` (blank symbol, missing amount field) was RED (`measured` was true) and is GREEN.

**Gates (analytics-service, .venv):** full `pytest`: 14253 passed, 102 skipped. CI's mypy line: no issues in 131 source files. `mypy --strict` on the probe alone: clean. `tests/test_walletoffset_probe.py`: 175 passed.

## Round 2

**Reviewed:** 2026-11-01T15:39:01Z, at `1c7e59717`, delta `git diff 2e3142511..HEAD -- . ':!.planning'` (`fe8dd4315`, `ec3708eb1`, `75c542b8c`)
**Depth:** deep (re-traced `fetch_funding_bybit`, `walk_paginated`, `BudgetedExchange`, `fetch_daily_pnl`'s OKX branch, `fetch_funding_okx` and its `match_key` dedupe)
**Files reviewed:** `analytics-service/scripts/walletoffset_probe.py`, `analytics-service/tests/test_walletoffset_probe.py`

```yaml
round_2_findings:
  critical: 0
  warning: 1
  info: 2
  total: 3
round_2_status: issues_found
```

**Gates, re-run here:** `tests/test_walletoffset_probe.py` from `analytics-service/` with `.venv`: 175 passed. `mypy --strict scripts/walletoffset_probe.py`: no issues. No `fapiPrivate_get_income` remains except in the new test's docstring.

### Closure of round 1

- **CR-01: closed.** `walletoffset_probe.py:904` calls `client.fapiPrivateGetIncome`, the docstring at `:50` agrees, and the fake `_BinanceVenue` uses the same name. `hasattr` is `True` on both `ccxt.async_support.binance` (the class `create_exchange` maps at `services/exchange.py:829`) and `binanceusdm`.
- **CR-01 test fails on a wrong name: confirmed by mutation.** I replaced `_PROBE_SRC` in memory (no file touched) and called the test: original GREEN; `fapiPrivate_get_income` RED `('binance', 'fapiPrivate_get_income')`; `fapiPrivateGetIncomes` RED; Bybit `private_get_v5_position_closedpnl` RED; `private_get_v5_account_transactionlog` RED. The `any(n.startswith("fapi"))` guard stops the scan from going vacuous if the call stops matching the regex. See IN-11 for the one false RED.
- **WR-01: closed.** `test_okx_parity_with_fetch_daily_pnl_and_fetch_funding_okx` drives the real `fetch_daily_pnl` and `fetch_funding_okx`. Both are called with `since_ms=None`, so neither sends `begin`. The fixed 2026-10-27 bills therefore cannot fall out of a lookback later, and the test is not a time bomb. The fake honours the `instType` and `type` filters, so a chain that ignored them would count every bill four times and go RED. One divergence remains that the test cannot see (WR-03).
- **WR-02: closed.** I neutered the comparison (`if False:`) in a scratch copy of `analytics-service`. Both parameters of `test_bybit_a_settlement_row_the_chain_drops_makes_the_key_malformed_never_a_clean_sum` went RED, and the other 39 Bybit tests stayed green.

### WR-02's view: read-only, GET-only, budget, ids

- **GET-only and budget kept, and tighter than before.** Before, `fetch_funding_bybit` got the whole `BudgetedExchange`. Now it gets a `SimpleNamespace` with exactly one attribute, and that attribute calls `budgeted.private_get_v5_account_transaction_log`. That call still goes through `BudgetedExchange.__getattr__`, which applies the `private_get_` prefix check, the `calls` count and `CallCeilingReached`. `fetch_funding_bybit` reads no other attribute of the exchange. `ccxt.BadRequest` and `PermissionDenied` are module names, not exchange attributes.
- **The count matches the chain, row for row.** `walk_paginated` (`services/exchange_pagination.py:178-246`) neither dedupes nor filters. It runs `rows.extend(res.rows)` for every reply that returns. The inverse skip and every other failure raise inside `_counted_log` before it counts anything, so a skipped reply is in neither count. A reply with no `list` counts 0 on both sides. The probe's comparison is therefore exact, and only a row that `_fetch_page` drops can make the counts differ.
- **No id leak.** The closure only increments an int. `Unmeasurable("malformed")` carries no id. The chain's log lines, which do carry `symbol` and `id`, stay off because logging is disabled for the run, the same as in round 1.
- **Accepted, fail-closed:** the count covers rows from B to now, not only [B, R]. A row dropped after R therefore refuses a key whose window is clean. This was disclosed in fix round 1, and it can only refuse, never print a wrong number.

### Judgement call 5: acceptable

A bill whose `pnl` or `fee` is not finite refuses the key (`okx_window_terms:505-513`), and no number is printed. The chain's `fetch_daily_pnl` drops that bill using the same helper (`services/exchange.py:1604-1612`), so a probe that summed past it would print a number it could not vouch for. Refusing is the right side of T-184-08.

One correction to how the call was worded: the chain does not drop a non-finite **funding** bill. `fetch_funding_okx` parses `pnl` with `Decimal(str(...))` (`services/funding_fetch.py:279-305`), and `Decimal("NaN")` and `Decimal("Infinity")` parse, so the chain keeps that row. Only `""` and other unparseable strings are dropped. The probe refuses either way, so the decision stands. The chain keeping a NaN funding row is pre-existing and outside this phase.

### Warnings

#### WR-03 [MEDIUM]: OKX funding still differs from `fetch_funding_okx` when two type-8 bills share an instrument and a UTC hour, so the probe prints a funding sum the chain does not book

**File:** `analytics-service/scripts/walletoffset_probe.py:485-509` (`okx_window_terms`). Chain side: `services/funding_fetch.py:597-605` (dedupe by `match_key`), `:279-305` (blank symbol dropped), `:216-220` (`"okx": 1`-hour bucket). Test: `analytics-service/tests/test_walletoffset_probe.py` (`test_okx_parity_with_fetch_daily_pnl_and_fetch_funding_okx`, the two `funding(...)` rows).

**Issue:** `fetch_funding_okx` keeps one row per `match_key`, which is `strategy:okx:<normalized instId>:<1-hour bucket>`. It also drops a type-8 bill whose `instId` is blank. `okx_window_terms` adds every in-window stablecoin type-8 bill's `pnl` and has no matching rule. Fix round 1 says "No finite input differs", but two finite inputs do:
- two type-8 bills on the same `instId` in the same UTC hour, for example one funding charge per position in OKX long/short mode or cross plus isolated on one swap. The chain books one and the probe adds both.
- a type-8 bill with a blank `instId`. The chain drops it and the probe adds it.

The parity test gives its two funding bills different `instId`s, BTC-USDT-SWAP and ETH-USDT-SWAP, so it cannot see either case. This is the same class as WR-02: a probe that claims "the rows `fetch_funding_okx` books" prints a different quantity with `partial: false` and nothing to show it.

It was there at round 1 (`2e3142511`), so it was not introduced by the delta. Round 1 missed it, and fix round 1's parity claim overstates closure.

**Realism:** not measured. Whether any PROD OKX key holds two positions on one instrument has not been checked. The scenario needs one key with long/short mode or a cross and an isolated position on the same swap, holding both across a funding time in [B, R].

**Scenario:** an OKX key in long/short mode holds both legs of BTC-USDT-SWAP through the 08:00Z funding. Two type-8 bills arrive in one hour. The probe's `pnl_funding_ratio` includes both. The chain's funding includes one. The founder reads an offset that the chain would not produce.

**Fix:** make the probe refuse rather than print a sum the chain disagrees with, the same way WR-02 did. Do not re-implement the dedupe:

```python
# okx_window_terms, in the is_funding branch, before `funding += pnl`
key = (normalize_symbol("okx", bill.get("instId", "") or ""), int(bill["ts"]) // 3_600_000)
if not key[0] or key in funding_keys:
    raise Unmeasurable("malformed")  # fetch_funding_okx would drop or collapse this row
funding_keys.add(key)
```

Then add a parity-test case with two type-8 bills on one `instId` in one hour, and one with a blank `instId`, each expecting `malformed`. Show it RED without the guard. The cleaner alternative is the WR-02 shape: run `fetch_funding_okx` on the walked bills and compare row counts. The chain's dedupe itself, which collapses distinct real funding charges, is a pre-existing chain defect. Route it with the out-of-scope Binance item; do not fix it in this phase.

### Info

#### IN-10 [LOW]: the WR-02 count refuses on a row dropped after R

**File:** `analytics-service/scripts/walletoffset_probe.py:785-786`
**Issue:** already disclosed in fix round 1. It is listed here so it is tracked rather than buried in prose. The count spans B to now, so one malformed SETTLEMENT row after R refuses a key whose window is clean. It fails closed.
**Fix:** none required. Optionally, count only the raw rows whose `transactionTime` falls in [B, R]. That needs a second parse, which the fixer chose to avoid.

#### IN-11 [INFO]: the ccxt-name scan goes RED on the valid lower-case alias

**File:** `analytics-service/tests/test_walletoffset_probe.py:1606-1607`
**Issue:** ccxt also generates `fapiprivate_get_income`. If the probe used that valid name, the regex `fapiPrivate\w+` would not match it, and `any(n.startswith("fapi"))` would fail with an empty message. That is a false RED. It fails safe, but the cause is not obvious from the message.
**Fix:** make the regex case-insensitive (`(?i)\.(fapiprivate\w+|private_get_\w+)\(`), and add a message to the `any(...)` assertion.

### Out of phase scope (pre-existing, not from this delta)

`services/funding_fetch.py:905-929` upserts `funding_fees` with `on_conflict="match_key"` and `ignore_duplicates=True`. Two Bybit SETTLEMENT rows for one symbol in one hour, for example hedge-mode long and short legs, therefore collapse to one stored row, even though `fetch_funding_bybit` returns both and the probe sums both. I have not checked whether the derive reads the stored table or the fetch result. This is inference only. Route it with the WR-03 chain dedupe.

---

_Round 2 reviewed: 2026-11-01T15:39:01Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_


## Fix round 2

**Scope:** WR-03 only. IN-10 and IN-11 (LOW and INFO) and the out-of-scope chain dedupe are untouched; the chain dedupe is routed with the other out-of-scope chain defects.

| Finding | Status | Commit |
|---|---|---|
| WR-03 | fixed | `c48ebf274` |

**WR-03.** `okx_window_terms` now refuses the key as `malformed` when a stablecoin funding (type 8) bill has a blank `instId`, or when a second one lands on the same instrument and UTC hour as an earlier one in the window. The key is `(normalize_symbol("okx", instId), ts // 3_600_000)`, the same helper and the same one-hour bucket `fetch_funding_okx` uses for its `match_key`, so the probe reuses the chain's own rule and re-implements nothing. A blank `instId` is whatever `normalize_symbol` returns empty for (`""` and `" "` both). The one existing test whose type-8 bill had no `instId` (the chain drops such a bill) now gives it one through the new `_funding_bill` helper.

Tests: `test_okx_a_funding_bill_with_a_blank_inst_id_makes_the_key_malformed` (two parameters, `""` and `" "`) and `test_okx_two_funding_bills_on_one_instrument_in_one_hour_make_the_key_malformed`. RED with the guard neutered (`if False:`): 3 failed (both blank parameters and the collision test), 175 passed. Restored from a byte backup with `cp`, `cmp` clean. GREEN after: 178 passed.

**Gates (analytics-service, .venv):** full `pytest`: 14256 passed, 102 skipped. CI's mypy line: no issues in 131 source files. `mypy --strict` on the probe alone: clean.

---

_Fixed: 2026-11-01_
_Fixer: Claude (gsd-code-fixer)_
