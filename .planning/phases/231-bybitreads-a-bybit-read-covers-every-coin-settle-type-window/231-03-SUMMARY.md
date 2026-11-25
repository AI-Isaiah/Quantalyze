---
phase: 231-bybitreads-a-bybit-read-covers-every-coin-settle-type-window
plan: 03
subsystem: analytics-service Bybit holdings poll (positions read)
tags: [bybit, positions, vread-02, proof-01, inverse, usdc, ccxt]

requires:
  - phase: 231
    provides: 231-CENSUS.md rows C09-C13, 231-PROBE-RESULT.md (positions-read linear_usdc=ok inverse=ok)
provides:
  - "services/positions.py: three-category Bybit position read (linear USDT, linear USDC, inverse), USD-correct inverse rows, raw-id symbols, raw limit and cursor read, BybitPositionReadRefused"
  - "tests/_bybit_real_markets.py: real ccxt Bybit markets from the recorded cassette and a venue-rule position-list book"
  - "tests/test_positions.py::TestBybitPositionCategories: the VREAD-02 gates"
affects: [231-04, 231-05, 231-06, 223, 232]

tech-stack:
  added: []
  patterns:
    - "per-category ccxt-first read with a raw cursor fallback, no swallow, so a failed category ships no rows"
    - "venue-rule fake (book) wired to both ccxt and raw entry points, with real ccxt markets built offline"

key-files:
  created:
    - analytics-service/tests/_bybit_real_markets.py
  modified:
    - analytics-service/services/positions.py
    - analytics-service/tests/test_positions.py
    - analytics-service/tests/test_upnl_venues.py

key-decisions:
  - "Inverse rows are computed from the raw v5 row on both paths (the ccxt position's info is that row), never from ccxt notional or unrealizedPnl"
  - "An empty raw page ends the walk; a repeated cursor refuses only when the page carries rows (the plan's wording)"
  - "USDT-linear stored symbols are untouched: the ccxt path keeps BTCUSDT and BTCUSDT-260925, the raw path keeps the venue id"

requirements-completed: [VREAD-02, PROOF-01]

status: complete
completed: 2026-11-23
actuals:
  tokens: 13400
  tasks: 3
  commits: 4
plan_head_before: a787159f99f2dbd76861504eacb14a093e8e63ee
plan_head_after: 3700418a3698faecd64d1ca352ab21276def4125
---

closes-todos: 167.2.1.1-BYBIT-POSITIONS-USDT-LINEAR-ONLY (VREAD-02)

# Phase 231 Plan 03: BYBITREADS positions (VREAD-02) Summary

The Bybit holdings poll now reads linear USDT, linear USDC and inverse positions, ccxt first with a per-category raw cursor fallback. USDC perps reach holdings under their raw id with their uPnL, and inverse rows carry `size_usd` and `unrealized_pnl` in USD at the payload's own mark.

## What changed

- `services/positions.py`:
  - `_BYBIT_POSITION_READS`, `BYBIT_POSITION_PAGE_LIMIT` (200), `BYBIT_POSITION_RAW_PAGE_CAP` (25), `BybitPositionReadRefused` (static reason texts) and two private helpers (`_read_bybit_positions_raw`, `_bybit_inverse_position`).
  - `_fetch_positions_bybit` loops the three reads. A category ships its ccxt rows only when they are present, below a full page and carry every critical field; any other category is read on the raw path with `limit` and `nextPageCursor`.
  - `_normalize_ccxt_position(s)` take a keyword `bybit_category`; `_parse_bybit_v5_positions` takes a keyword `category`. The Deribit, OKX and Binance arms are untouched.
- `tests/_bybit_real_markets.py`: `real_bybit_with_markets()` (async; real ccxt `fetch_future_markets` on the cassette's linear and inverse `instruments-info` replies, 652 and 26 symbols; the instance's low-level `fetch` raises), `BybitPositionBook` and `install_position_book` (wired to both `privateGetV5PositionList` and `private_get_v5_position_list`; category required, linear needs settleCoin or symbol, limit in [1, 200] default 20, `c<offset>` cursors, `refuse` raises `ccxt.PermissionDenied`, every call recorded with its entry point).
- `tests/test_positions.py`: `TestBybitPositionCategories` (30 collected cases from 12 test functions) and the flips below.

## Commits

| Task | Commit | What |
|---|---|---|
| 1 tracer | c8af7cf2d | fixture module, three-category loop, USDC symbol, tracer and request-shape tests, fan-out flips |
| 2 RED | ce6d9d9bb | failing gates (25 of the 29 cases failed on the Task 1 code) |
| 2 GREEN | d93457cf9 | inverse USD helper, raw cursor read, refusals |
| 3 | 3700418a3 | census C12 poll-job test, raw `limit` assertions on the flipped reads |

## Tracer RED, on pre-fix code

The pre-fix `services/positions.py` was restored with `git show HEAD:<path>` (the commit before this plan's change), the tracer run, and the new file put back by `cp` with `cmp` IDENTICAL:

```
E       AssertionError: derivative rows: ['BTCUSDT']
E       assert {'BTCUSDT'} == {'BTCPERP', 'BTCUSDT'}
E         Extra items in the right set:
E         'BTCPERP'
1 failed in 45.09s
```

`test_every_category_is_requested_once_on_the_ccxt_path` on the same pre-fix code: `Right contains 2 more items, first extra item: {'settleCoin': 'USDC', 'limit': 200, 'category': 'linear'}`.

## PROOF-01 records (neuter, RED on the named arm, byte restore, GREEN)

Each neuter edited `services/positions.py` from a byte backup in `$SCRATCH` (a directory outside the repo); `cp` put the backup back and `cmp` was run; the test was then re-run. No `git checkout`, `restore` or `stash` was used.

### Gate 1: request shape (drop the USDC and inverse reads)
```
=== GATE 1 request shape (drop the USDC and inverse reads)
neutered: diff vs backup:
460,461d459
<     ("linear_usdc", {"settleCoin": "USDC"}, {"category": "linear", "settleCoin": "USDC"}),
<     ("inverse", {"subType": "inverse"}, {"category": "inverse"}),
RED run (exit 1):
E       AssertionError: assert [{'settleCoin...y': 'linear'}] == [{'settleCoin...'limit': 200}]
FAILED tests/test_positions.py::TestBybitPositionCategories::test_every_category_is_requested_once_on_the_ccxt_path
1 failed in 43.95s
cmp: IDENTICAL
GREEN run (exit 0):
1 passed in 33.26s
```
Under this neuter the tracer fails too (no USDC read, so no BTCPERP); the named test is the one asserted here by running it alone.

### Gate 2: units (return the inverse coin values unconverted)
```
=== GATE 2 units (return the inverse coin values unconverted)
neutered: diff vs backup:
98c98
<         "size_usd": size_base * mark,
---
>         "size_usd": size_base,
101c101
<         "unrealized_pnl": coin_pnl * mark if coin_pnl is not None else None,
---
>         "unrealized_pnl": coin_pnl,
RED run (exit 1):
E       assert 0.00166667 == 100.0002 ± 1.0e-07
FAILED tests/test_positions.py::TestBybitPositionCategories::test_inverse_position_size_and_upnl_are_usd_at_the_payload_mark[ccxt]
1 failed in 37.25s
cmp: IDENTICAL
GREEN run (exit 0):
2 passed in 24.17s
```

### Gate 3: symbol (restore the plain symbol strip for USDC)
```
=== GATE 3 symbol (restore the plain symbol strip for USDC)
neutered: diff vs backup:
348,349d347
<     if exchange_name == "bybit" and bybit_category == "linear_usdc":
<         symbol = str((pos.get("info") or {}).get("symbol") or symbol)
RED run (exit 1):
E       AssertionError: derivative rows: ['BTCUSDCC', 'BTCUSDT']
E       assert {'BTCUSDCC', 'BTCUSDT'} == {'BTCPERP', 'BTCUSDT'}
FAILED tests/test_positions.py::TestBybitPositionCategories::test_tracer_usdc_perp_reaches_holdings_as_btcperp_with_its_upnl
1 failed in 39.79s
cmp: IDENTICAL
GREEN run (exit 0):
1 passed in 37.15s
```

### Gate 4: raw limit and cursor (drop both, single page as before)
```
=== GATE 4 raw limit and cursor (drop both, single page as before)
neutered: diff vs backup:
482,485c482,483
<         params = {**raw_params, "limit": str(BYBIT_POSITION_PAGE_LIMIT)}
<         if cursor:
<             params["cursor"] = cursor
<         raw_response = await exchange.private_get_v5_position_list(params)
---
>         raw_response = await exchange.private_get_v5_position_list(dict(raw_params))
>         return _parse_bybit_v5_positions(raw_response, category=label)
RED run (exit 1):
E       AssertionError: first missing symbol: ['4USDT']
E       assert ['0GUSDT', '1...ATSUSDT', ...] == ['0GUSDT', '1...ATSUSDT', ...]
FAILED tests/test_positions.py::TestBybitPositionCategories::test_raw_fallback_sends_limit_and_follows_the_cursor_past_twenty_one_positions[default-200]
1 failed in 30.94s
cmp: IDENTICAL
GREEN run (exit 0):
2 passed in 20.68s
```
With the venue's default page of 20 the 21st symbol (by recorded-symbol order, `4USDT`) is the first one missing.

### Extra gates (RED run and byte restore; GREEN is the whole-file run below)
These cover the tests that were already green after Task 1 (propagation, USDT symbols) and the rest of Task 2.
```
=== GATE 5 propagation (swallow a failed category read)
RED run (exit 1):
FAILED tests/test_positions.py::TestBybitPositionCategories::test_a_failed_category_read_propagates_and_ships_no_rows
1 failed in 25.23s
cmp: IDENTICAL
=== GATE 6 stored USDT symbols (re-derive them from the raw id)
RED run (exit 1):
E       AssertionError: assert ['BTCUSDT', 'BTCUSDT-25SEP26'] == ['BTCUSDT', 'BTCUSDT-260925']
FAILED tests/test_positions.py::TestBybitPositionCategories::test_usdt_rows_keep_their_stored_symbol
1 failed in 26.43s
cmp: IDENTICAL
=== GATE 7 census C12 (plain symbol strip, poll job)
RED run (exit 1):
E       AssertionError: assert 'BTCUSDCC' == 'BTCPERP'
FAILED tests/test_positions.py::TestBybitPositionCategories::test_poll_positions_job_persists_the_usdc_row_with_the_corrected_symbol
1 failed in 20.36s
cmp: IDENTICAL
=== GATE 8 full ccxt page (ship the truncated ccxt page)
RED run (exit 1):
E       AssertionError: assert 200 == 205
FAILED tests/test_positions.py::TestBybitPositionCategories::test_a_full_ccxt_page_routes_the_category_to_the_raw_cursor_read
1 failed in 20.37s
cmp: IDENTICAL
=== GATE 9 page cap (return a list that did not end)
RED run (exit 1):
FAILED tests/test_positions.py::TestBybitPositionCategories::test_raw_page_cap_and_stuck_cursor_refuse_by_name
1 failed in 25.62s
cmp: IDENTICAL
=== GATE 10 stuck cursor (follow a repeated cursor)
RED run (exit 1):
E       AssertionError: assert 3 == 2
FAILED tests/test_positions.py::TestBybitPositionCategories::test_raw_page_cap_and_stuck_cursor_refuse_by_name
1 failed in 23.05s
cmp: IDENTICAL
=== GATE 11 string mark (no float conversion before usable_price)
RED run (exit 1):
FAILED tests/test_positions.py::TestBybitPositionCategories::test_raw_fallback_reads_a_string_mark_for_an_inverse_row
1 failed in 18.35s
cmp: IDENTICAL
```

## Flipped tests (flipped, never deleted; `git diff -U0` from the plan's start commit shows 0 removed `def test_` lines)

| Test | Old expectation | New expectation |
|---|---|---|
| `TestFetchPositionsBybitHappy::test_bybit_ccxt_complete` | `fetch_positions.return_value = BYBIT_CCXT_COMPLETE` for every call, one row | a params-dispatching exchange; same one row and values; ccxt called once per category in order; the two empty categories are re-read raw (USDC then inverse) |
| `TestFetchPositionsBybitFallback::test_bybit_fallback_to_v5` | one list and one raw page for every call; `assert_awaited_once` | the incomplete USDT category takes the raw page; raw awaited once per category (USDT, USDC, inverse), each carrying `limit` "200" |
| `TestBybitV5ReportedPnl::test_ccxt_none_still_routes_to_v5_and_v5_zero_is_a_real_zero` | `assert_awaited_once` | `await_count == 3`, each raw request carries `limit` "200"; the raw zero is still 0.0, not None |
| `test_upnl_venues.py::_fake_bybit` | one `AsyncMock` list for every `fetch_positions` call, no raw method | params-aware: no params or settleCoin USDT answer the positions, USDC and inverse answer empty; the raw method answers an empty page |
| `test_upnl_venues.py::test_holdings_bybit_spot_row_is_wallet_balance_and_derivative_row_carries_upnl` | one derivative row | same rows plus an assertion of one `fetch_positions` call per category |
| `TestFetchPositionsDeribit::test_non_deribit_malformed_still_fails_loud` | stub `_boom(pos, exchange_name)` | `_boom(pos, exchange_name, **_kwargs)`: the batch normalizer now forwards `bybit_category` by keyword; the assertion (non-Deribit propagates, Deribit skips) is unchanged |

`test_cross_path_bybit_reconstruct_equals_derive_plus_upnl_equals_holdings` needed no edit of its own: it went red on the old `_fake_bybit` and green on the flipped one.

## Measured facts for the record

- **Flat account call count:** three ccxt plus three raw calls per poll. The live key (PROBE-RESULT: 45 open linear USDT, 0 USDC, 0 inverse) costs three ccxt calls plus two raw reads for the empty USDC and inverse categories, plus one raw USDT read when any of its 45 positions has an exact-zero uPnL (ccxt nulls it).
- **User-visible change:** USDC-settled and inverse positions now appear in allocator holdings (and in their uPnL leg of AUM) and in strategy position snapshots (`position_snapshots`). USDT-linear rows are unchanged, with their stored symbols byte-identical.
- **ccxt request shapes, re-measured on the venv's ccxt 4.5.85** (CI pins 4.5.89): `{'settleCoin': 'USDT', 'limit': 200, 'category': 'linear'}`, `{'settleCoin': 'USDC', 'limit': 200, 'category': 'linear'}`, `{'category': 'inverse', 'limit': 200}`; identical to RESEARCH's 4.5.89 reading.
- **ccxt on an unusable inverse mark:** `markPrice` absent or blank makes ccxt's own `markPrice` None (the category falls to the raw path and refuses there); "0" and "-1" parse to numbers and the Bybit arm refuses; "nan" and "inf" make ccxt's `Precise` division raise `ValueError` before our helper sees the row, so those two are covered at the arm level and on the raw path, not through real ccxt. No try/except wraps ccxt.

## Open assumptions (still unverified against a live reply)

- **A1:** inverse `unrealisedPnl` and `positionValue` are coin-denominated. The probe found 0 open inverse positions on the live key, so no live inverse reply exists; the fixture follows Bybit's documented shape.
- **A5:** partly measured. The probe's `positions-read: linear_usdc=ok inverse=ok` shows the live key can read both lists, so no refusal semantics were needed beyond the plan's. A payload with rows has still not been read for either.
- **A9:** inverse `size` is in USD contracts. Same: no live inverse row has been read. The `size_usd` cross-check in the inverse test would expose a wrong unit on the first real reply.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fan-out flips pulled forward into the Task 1 commit**
- **Found during:** Task 1 (the five-file suite run after the loop change)
- **Issue:** the three-category loop reddened six existing tests (the three named in the plan, plus `test_non_deribit_malformed_still_fails_loud` and two in `test_upnl_venues.py`). Leaving them red until Task 3 would have left two commits with a failing suite.
- **Fix:** flipped them in the Task 1 commit (table above); Task 3 added the `limit` assertions that need Task 2, the poll-job test and the PROOF-01 records.
- **Commit:** c8af7cf2d

**2. [Plan shape] Task 2 split into a RED test commit and a feat commit**
- `tdd.md` requires a failing-test commit before the implementation. The two invariant tests (`test_a_failed_category_read_propagates_and_ships_no_rows`, `test_usdt_rows_keep_their_stored_symbol`) were already green on the Task 1 code because they pin properties it already has; gates 5 and 6 prove they can fail.
- **Commits:** ce6d9d9bb, d93457cf9

**3. [Interface] `real_bybit_with_markets()` is `async`**
- ccxt's market builder (`fetch_future_markets`) is a coroutine, so the helper is awaited. The market list is built once per session and copied per instance.

None of these changed what the plan decided. No architectural change, no auth gate.

## Decisions to know about

- An empty raw page ends the walk, even when it carries a cursor. A repeated cursor refuses only on a page with rows (the plan's wording). An empty page that echoes its cursor is therefore read as the end of the list.
- A non-numeric mark string on the raw path still raises `ValueError` (fail loud as before), not the named refusal.
- `fetch_allocator_holdings` keeps its existing handling: a retryable failure of any category gives spot rows only, no derivative rows (not a book with the USDT and USDC rows but no inverse), and the fixed `DERIVATIVE_FETCH_FAILED_NOTE` copy; a permanent one (`PermissionDenied`) re-raises. `run_poll_positions_job` fails the job. Neither file was edited.
- `estimate.tokens` was 95000 against 13400 actual (chars/4 over the 53 KB diff), because the tracer-first order left little rework.

## Gates run

- `tests/test_positions.py tests/test_upnl_venues.py tests/test_allocator_positions.py tests/test_upnl_venues_binance.py tests/test_nav_marks_bybit_uta.py` plus the other consumers of `fetch_positions` (`test_ana_recon_audit.py`, `test_allocator_positions_non_ccxt.py`, `test_bybit_upnl_probe.py`, `test_nav_marks_l4_read.py`, `test_price_rule.py`, `test_job_worker.py`): 673 passed, 1 skipped.
- CI's mypy command (`mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`, mypy 2.4.0): no issues in 142 source files.
- The six NEW(plan 03) node ids in `231-CENSUS.md` collect (8 cases) with exit 0.
- `node scripts/verify-plan-anchors.mjs` on this plan: 17 claims checked, no stale claims.
- No test deleted: 0 removed `def test_` lines from the plan's start commit to HEAD in the two edited test files.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema; the three reads are the same authenticated position-list call with different parameters. T-231-06 (marks pass `usable_price` after a fail-loud conversion) and T-231-07 (static refusal text, asserted digit-free) are implemented and pinned.

## Ship note

`TODOS.md` was not edited here (plans 03 and 04 share wave 2). The ship PR that carries this plan deletes the `167.2.1.1-BYBIT-POSITIONS-USDT-LINEAR-ONLY` entry, names it in its CHANGELOG entry, and fixes any live pointer to it.

## Self-Check: PASSED

- Files exist: `analytics-service/tests/_bybit_real_markets.py`, `analytics-service/services/positions.py`, `analytics-service/tests/test_positions.py`, `analytics-service/tests/test_upnl_venues.py`.
- Commits are ancestors of HEAD: c8af7cf2d, ce6d9d9bb, d93457cf9, 3700418a3.
