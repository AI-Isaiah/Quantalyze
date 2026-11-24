---
phase: 231-bybitreads-a-bybit-read-covers-every-coin-settle-type-window
plan: 01
subsystem: analytics-service Bybit reads (census and founder doc, docs only)
tags: [bybit, census, vread-05, planning]

requires:
  - phase: 231
    provides: CONTEXT, RESEARCH and PATTERNS (census seed, rulings OQ1 to OQ7)
provides:
  - "231-CENSUS.md: rows C01..C25 (C15a, C15b) and C27, each dispositioned and pinned; row grammar; probe-evidence list; C26 under Not a Bybit row"
  - "231-FOUNDER-VREAD05.md: evidence, three questions, allow-list steps, close rule; no address in the file"
affects: [231-02, 231-03, 231-04, 231-05, 231-06]

actuals:
  tokens: 5300
  tasks: 3
  commits: 3
plan_head_before: 7ee3a89488402b9719e3b5803ed6909997257853
plan_head_after: 319a63061615035e490e570a656105b9e78952f9

tech-stack:
  added: []
  patterns: ["census row = file::symbol, no line anchors, disposition form + pin (backticked if it resolves at HEAD, NEW(plan 0N) otherwise)"]

key-files:
  created:
    - .planning/phases/231-bybitreads-a-bybit-read-covers-every-coin-settle-type-window/231-CENSUS.md
    - .planning/phases/231-bybitreads-a-bybit-read-covers-every-coin-settle-type-window/231-FOUNDER-VREAD05.md
  modified: []

key-decisions:
  - "Census cites file::symbol only; no path:NNN anchor anywhere"
  - "C15a is pinned by the C14 pin (same reader), C03 and C04 by the two C01 pins (inheritance)"
  - "C27 (sync_funding timeout) is recorded with its code-derived mechanism as a hypothesis, not fixed (ruling OQ6)"

requirements-completed: []  # census and founder doc only: VREAD-01..05 close in plans 03 to 06 and the founder step, not here

status: complete
completed: 2026-11-23
---

# Phase 231 Plan 01: Venue-by-path census and VREAD-05 founder instructions Summary

The Bybit read census (27 rows, each with a disposition and a pin) and the VREAD-05 founder page now exist, written before any fix plan runs; no source or test file was touched.

## Accomplishments

- Task 1 (tracer, `9a7ed17b7`): `231-CENSUS.md` with the row grammar and three rows of three disposition kinds (C14 fix, C06 decided with existing pins, C27 decided after the probe). C27 carries the mechanism read from code: `run_sync_funding_job` takes `since_ms` from the newest stored `funding_fees.timestamp` via `_funding_since_from_cursor`; an empty table gives `None`, which `fetch_funding_bybit` walks as a 365-day default in seven-day windows over linear and inverse (2 x 53 = 106 sequential requests minimum) under the 180-second `sync_funding` entry of `TIMEOUT_PER_KIND`; the upsert runs only after the walk returns, so a timeout persists nothing and the next day restarts from `None`. Stated as a hypothesis until plan 02's probe and the orchestrator's `funding_fees` row count confirm it.
- Task 2 (`f52ab92a4`): rows C01..C25 (C15 split into C15a and C15b) and C27 completed; `## Rows that move with probe evidence` (C14, C18, C19, C23, C27 with their probe record keys); `## Not a Bybit row` (C26, the OKX equity call in `_live_reference`).
- Task 3 (`319a63061`): `231-FOUNDER-VREAD05.md` with the four required headings, three questions (choice, date, whether the allow-list still holds only the old entry), the Railway and Bybit steps with RESEARCH A3 as an unverified assumption, and the close rule `done` with `attempts = 1`.

## Pins replaced or chosen at collect time

All 19 distinct backticked pins resolve at HEAD under `python3 -m pytest --collect-only` (run from `analytics-service/`). Nothing the plan named failed to resolve. Where the plan or RESEARCH left a choice or carried an error:

- C23: RESEARCH named `TestBybitUnifiedFlowSource`; that class does not hold the pin. The census uses `tests/test_derive_broker_dailies_dualmode.py::TestBybitUnifiedTransfersAreFlows::test_unified_rows_replace_the_on_chain_reads_and_count_once` (the plan already carried the correction). `TestBybitUnifiedFlowSource` appears nowhere in the census.
- C18 window pin chosen: `tests/test_exchange.py::TestBybitDailyPnlStartTimePagination::test_default_lookback_at_least_60_days`.
- C24 pin chosen: `tests/test_exchange.py::TestFetchMarkPricesFailLoud::test_bybit_drops_unparseable_mark_price_with_warning`. `tests/test_fetch_mark_prices.py` only exercises OKX, so it is not used.
- C25 pin chosen: `tests/test_bybit_upnl_probe.py::test_run_end_to_end_prints_two_key_records_and_a_summary` (asserts the positions request `category=linear`, `settleCoin=USDT`).
- C17 shorthand pins (`::test_...` without a path) and C22's "pairing tests (355-527)" range were written as full node ids.

21 `NEW(plan 03..06): tests/` pins are named for later plans (acceptance asked for at least 14). Every NEW name was cross-checked against the plan that must create it (plans 03, 04, 05, 06 each contain the exact name). They do not resolve at HEAD by design.

## Verification

- Task 1, 2 and 3 automated commands print `CENSUS_TRACER_OK`, `CENSUS_OK` and `FOUNDER_DOC_OK`.
- `node scripts/verify-plan-anchors.mjs <plan>` exits 0 (10 claims checked).
- Acceptance greps: no `.py:NNN`-style anchor; `TestBybitUnifiedFlowSource` count 0; each of C14, C06, C27 present once.
- Note for later plans: the plan's automated commands use unquoted `$N` word splitting. Run them under bash (zsh does not split), otherwise pytest receives one multi-line argument and reports `no tests collected` with exit 0.

## Deviations from Plan

None - plan executed exactly as written.

## Hand-offs

- Plan 02 (probe): record keys named in the census must exist in its record vocabulary (`trade_window_verdict`, `trade_sweep_pages_max_in_window`, `inverse_closed_pnl_rows_30d`, `positions_open_inverse`, `funding_rows_inverse`, `deposit_verdict`, `funding_state`, `funding_read_s`, `funding_calls`). The census says "section D" for the funding seconds and calls; RESEARCH's own probe table has sections A to C, so plan 02 must add that section.
- Plan 05 creates `tests/test_bybitreads_census_pins.py` with the three `test_census_c18/c19/c27_*` names and fills the probe counts into C14, C18, C19, C23 and C27; its VREAD-05 checkpoint relays `231-FOUNDER-VREAD05.md`.
- C15a: the cursor gate in `run_sync_trades_job` is not edited here (ruling OQ5); plan 04 records the dependency for Phase 232.

## Known Stubs

None.

## Threat Flags

None. The files hold no address, key id, account number, PROD id, amount or home path (T-231-01 checks pass: IPv4, uuid, email and home-path greps all 0).

## Self-Check: PASSED

- FOUND: 231-CENSUS.md, 231-FOUNDER-VREAD05.md
- FOUND commits: 9a7ed17b7, f52ab92a4, 319a63061
