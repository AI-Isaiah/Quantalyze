---
phase: 180-bybitfunding-read-bybit-internal-and-sub-account-transfers-s
plan: 04
subsystem: analytics-service / allocator history rebuild
tags: [bybit, unified-transaction-log, flows, pagination, read-only]
requires: ["180-03"]
provides:
  - "services/bybit_unified_flows.py: UNIFIED_FLOW_TYPES, BYBIT_LOG_PAGE_SIZE, UNIFIED_FLOW_PAGE_CAP, BybitUnifiedFlowReadError, normalise_unified_flow_row, fetch_bybit_unified_flows"
  - "tests/_trade_pages.py: unified_flow, UnifiedLogBook (repeat_cursor, wrong_type), install_unified_log"
  - "tests/test_bybit_unified_flows.py: 13 named tests (49 collected cases)"
affects: [180-06, 180-07]
tech-stack:
  added: []
  patterns: ["walk_paginated fan-out over log types in 7-day windows, cursor-authoritative, raising at the ceiling", "a Bybit-faithful test double over bybit_select"]
key-files:
  created:
    - analytics-service/services/bybit_unified_flows.py
    - analytics-service/tests/test_bybit_unified_flows.py
  modified:
    - analytics-service/tests/_trade_pages.py
key-decisions:
  - "D-01 read implemented as written: TRANSFER_IN is the deposit, TRANSFER_OUT the withdrawal; direction comes from the requested type, never the row's sign; the amount is the absolute value of change, else cashFlow; funding is never read."
  - "A page that returned rows and the cursor it was sent raises on the first repeat; an empty page ends its window before cursors are compared."
  - "Orchestrator reading 3: Earn, staking, bonus-transfer and PEF types are not flows in this phase; the module docstring states the limitation in the RESEARCH Q2.2 words."
status: complete
commits: 3
plan_head_before: 935b21058a25dcb496b4d7fcfcb0d87ce03b946e
plan_head_after: e6b100c1f13825ed283f41401784ad8caeb305f1
actuals:
  tokens: 26000
  tasks: 3
  commits: 3
metrics:
  completed: 2026-10-29
requirements-completed: [SC-2]
---

# Phase 180 Plan 04: The Unified-edge flow read Summary

The rebuild now has a Bybit flow reader over `GET /v5/account/transaction-log` (`accountType=UNIFIED`, types `TRANSFER_IN` and `TRANSFER_OUT`) that reads every page of every 7-day window and refuses by its own class instead of returning less than the venue holds. Plan 06 wires it into `_fetch_and_price_window`; this plan builds and proves it.

## What was built

- `services/bybit_unified_flows.py`: `fetch_bybit_unified_flows(exchange, since_ms, now_ms)` returns `(deposits, withdrawals)` as ccxt-transfer-shaped rows (exactly `id`, `type`, `currency`, `amount`, `timestamp`, `fee`; never `kind`, never `info`). It declares a `ProviderPaginationContract` (`inst_types=UNIFIED_FLOW_TYPES`, `window_max_days=7`, `stop_on_short_page=False`, `stuck_cursor_is_stop=False`, `on_ceiling="raise"`, `ceiling_exc=BybitUnifiedFlowReadError`) and drives it with `walk_paginated`. A venue exception is logged once (class plus `scrub_freeform_string` text) and re-raised as the same object. No `asyncio.sleep`.
- Refusals, all `BybitUnifiedFlowReadError` with static text (no venue text): a non-dict answer, a non-dict `result`, a non-list `list`, a non-string cursor, a row that is not an object, a row of another type, an unusable id, `transactionTime`, currency or amount, a non-finite amount, a cursor that did not advance on a page that returned rows, and a window past `UNIFIED_FLOW_PAGE_CAP`.
- Dedup per kind by id, first kept.
- `tests/_trade_pages.py`: `unified_flow(...)`, `UnifiedLogBook` (accountType UNIFIED, both bounds required, 7-day span via `bybit_select`, 50 a page, newest first, opaque cursor, `.calls`; options `repeat_cursor`, `wrong_type`) and `install_unified_log(...)`. `tests/test_trade_pages.py` still passes.
- Module docstring: D-01's reason, the replace-not-add rule, the vendor facts, the WR-04 discipline, D-02's scope, and the Earn limitation sentence (`grep -acF 'the 5x implausibility bound is the only backstop'` prints 1).

## Tests

- `tests/test_bybit_unified_flows.py`: 49 collected cases, all passing, 13 named plan tests (the normalise and malformed-answer and venue-error tests are parametrized), plus two extras: `test_a_non_object_row_is_refused`, `test_an_integer_id_and_an_integer_stamp_are_read`.
- Final run: `tests/test_bybit_unified_flows.py tests/test_trade_pages.py tests/test_allocator_history_probe.py tests/test_bybit_funding_record.py tests/test_funding_fetch.py` -> 372 passed, 0 skipped (1 pre-existing warning).
- CI's mypy line, verbatim from `analytics-service/`: `Success: no issues found in 131 source files`.
- The tiling oracle in the windows test is computed in the test from `since` and `now`. The probe-coupling test wraps `hp._TradeRecorder` round the client before the read and sees one `deposits` and one `withdrawals` row with `unified_state() == "read"`. The pin test asserts `set(UNIFIED_FLOW_TYPES) == set(hp._UNIFIED_FLOW_KINDS)`, the kind mapping, and disjointness from `bybit_funding_record.CENSUS_LOG_TYPES` (this is plan 03's requested pin).
- The venv is the main checkout's (ccxt 4.5.85; the repo pins 4.5.88).

## Mutation checks

Each: byte backup with `cp -p`, neuter, named test RED, restore from the backup, `cmp` clean, whole file green (49 passed).

mutation-m1: red (`test_every_page_of_a_window_is_read`: `assert 50 == 120` with the callback returning `next_cursor=""`). restore: cmp clean
mutation-m2: red (`test_a_repeated_cursor_raises_and_stops_at_once`: regex `did not advance` did not match; the walk ran to `exhausted UNIFIED_FLOW_PAGE_CAP=200` with the stall raise disabled). restore: cmp clean
mutation-m3: red (`test_a_row_is_normalised_or_refused`: the TRANSFER_OUT `change "30"` and TRANSFER_IN `change "-7"` rows fail with the direction taken from the sign of `change`). restore: cmp clean
mutation-m4: red (`test_a_row_is_normalised_or_refused`: the `funding ""`/`funding "999"` rows fail with `funding` read before `change`). restore: cmp clean
mutation-m5: red (`test_a_row_of_another_type_is_refused`: DID NOT RAISE with the `type` equality check removed). restore: cmp clean
mutation-m6: red (`test_venue_errors_pass_through_unchanged[PermissionDenied]`, and the AuthenticationError and BadRequest cases: DID NOT RAISE with `ccxt.PermissionDenied` caught into an empty page). restore: cmp clean

## Deviations from Plan

None. Notes that are not deviations:

- The module was written in full first and then committed in the plan's three stages (the tracer without the stall check, the strict normalise, the dedup and the Earn sentence), so each commit is self-consistent. The tests passed on first run, so the red step was shown by the mutations rather than by a pre-implementation failing run.
- m2 is red on the regex (`did not advance`) and would also be red on the `<= 2` request count: with the stall raise disabled the walk reaches the ceiling after 200 requests. It is not red on a hang.
- `grep -c equity_reconstruction` on the module prints 1: a docstring mention of `services/equity_reconstruction.py`. The import pattern the plan forbids prints 0.

## Known Stubs

None.

## Threat Flags

None. The only new surface is a GET method the rebuild's client already exposes, read under the plan's threat register (T-180-10 to T-180-13 mitigated by m1 to m6).

## Notes for plans 05 to 07

- Plan 06 imports `fetch_bybit_unified_flows` into `_fetch_and_price_window` and must use its rows INSTEAD of the on-chain deposit and withdrawal reads for a Bybit account.
- Plan 07 maps `PermissionDenied`, `AuthenticationError` and `BadRequest` (they propagate as the same object) to `hp._FLOW_SOURCE_REFUSAL`; `BybitUnifiedFlowReadError` is a `RuntimeError` and is not one of them.
- The probe's `_UNIFIED_FLOW_KINDS` keys equal `UNIFIED_FLOW_TYPES` (pinned here); if a follow-up extends `UNIFIED_FLOW_TYPES`, the probe's literal and `_KIND_OF_TYPE` move with it and that test says so.

## Self-Check: PASSED

- FOUND: analytics-service/services/bybit_unified_flows.py, analytics-service/tests/test_bybit_unified_flows.py, analytics-service/tests/_trade_pages.py
- FOUND commits: 5d6af6b1a, 4b5eea21f, e6b100c1f (all ancestors of HEAD)
- `grep -acE '^mutation-m[0-9]+: red \('` on this file prints 6.
- STATE.md, ROADMAP.md, VERSION, package.json, CHANGELOG.md, TODOS.md and `services/equity_reconstruction.py` untouched.
