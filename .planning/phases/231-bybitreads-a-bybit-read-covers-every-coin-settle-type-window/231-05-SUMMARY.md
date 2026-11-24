---
phase: 231-bybitreads-a-bybit-read-covers-every-coin-settle-type-window
plan: 05
subsystem: analytics-service Bybit reads (VREAD-04 verdict, census closure, VREAD-05 founder record)
tags: [bybit, census, vread-04, vread-05, proof-01]

requires:
  - phase: 231
    provides: 231-PROBE-RESULT.md, plans 03 and 04 SUMMARYs, 231-FOUNDER-VREAD05.md
provides:
  - "231-CENSUS.md closed: C23 verdict, probe counts in C14/C18/C19/C27, a Routed rows section"
  - "analytics-service/tests/test_bybitreads_census_pins.py: C18, C19, C27 pins"
  - "VREAD-05 founder record and the derive check after it"
affects: [231-06]

actuals:
  tasks: 3
  commits: 4
plan_head_before: 9dc6e71e4e756d3340f419f5abf25dd4fc593846

key-files:
  created:
    - analytics-service/tests/test_bybitreads_census_pins.py
  modified:
    - .planning/phases/231-bybitreads-a-bybit-read-covers-every-coin-settle-type-window/231-CENSUS.md
    - .planning/phases/231-bybitreads-a-bybit-read-covers-every-coin-settle-type-window/231-CONTEXT.md
    - .planning/ROADMAP.md

key-decisions:
  - "VREAD-04 undecided (0 on-chain rows): replace stays, no founder question"
  - "VREAD-05 founder answer recorded; the date is an upper bound derived from the derive record because the founder gave none"

requirements-completed: [VREAD-04, VREAD-05]

status: complete
completed: 2026-11-23
---

# 231-05 summary: VREAD-04 verdict, census closure, VREAD-05 record

vread04-verdict: undecided (no on-chain row on the measured window)
vread05-choice: static-ip-allowlisted
vread05-date: 2026-10-24
vread05-answer: "Allow-listed worker IP"
vread05-derive-after: done=31 attempts_gt1=1 ip_errors=0 since=2026-10-24
closes-todos: 186-BYBIT-ONCHAIN-DEPOSIT-UNVERIFIED (VREAD-04)
closes-todos: 167.1.2.2-BYBIT-STATIC-EGRESS (VREAD-05)

## VREAD-04
The probe ran on 2026-11-23 against one measured key.

| Reading | Value |
|---|---|
| On-chain deposits / withdrawals | 0 / 0 (read complete) |
| Unified in / out | 4 / 2 (read complete) |
| Paired, unpaired on-chain, near misses, unreadable | 0 each |

The action-table row is `undecided`. So nothing in the code changes, the flow source stays `replace`, and there is no `q-vread04` question. Zero on-chain rows is recorded as undecided, never as `replace_supported`.

## VREAD-05
- **The founder's answer** came on 2026-11-23, relayed by the coordinator because this agent has no AskUserQuestion: "Allow-listed worker IP". The founder bound the live key to the worker's static egress IP at Bybit, and there is no further founder step.
- **The date.** The founder gave none, so `vread05-date` is an upper bound derived from PROD, and the founder may correct it. The derive failed with IP errors on 2026-10-07 and 2026-10-08, and every derive since 2026-10-24 is done.
- **The derive check.** It is a counts-only MCP read on PROD, taken after the marker query named PRODUCTION. Since 2026-10-24 there are 31 derive_broker_dailies jobs for the one live key: 31 done, 0 IP errors, 1 with more than one attempt. Since 2026-11-23 there is 1 done.
- **Close rule:** at least one done job and `ip_errors=0`. It is met.

## Census closure (plan 05 Tasks 1 and 2: commits 50449b0be, 85faecf38)
- **C23:** the verdict token, the counts and the outcome `replace`. The pin is kept.
- **C14:** `trade-verdict: truncated`. The legacy shape gave 2 pages and 100 rows. The windowed shape gave 24201 rows, 17922 of them after week one. The sweep is incomplete, so 121 pages is a lower bound and the cap rule gives `cap-rule: input=field-absent cap=200`.
- **C18 and C19:** inverse closed-pnl over 30 days, inverse open positions and inverse funding rows are all 0. Zero exposure, so these are not routed.
- **C27:** the funding walk completes in 379 s with 1438 calls and 65522 rows, against a `sync_funding` budget of 180 s, and the table holds 0 rows. This confirms the plan 01 mechanism: the upsert runs only after the walk, so the table is never filled. It is not a venue refusal.
- **A new `## Routed rows` section** carries C27 and plan 04's `oq2-timing` (a first strategy sync may not fit the 900 s budget). Each owner is named in the phase report.

## Gates
- `tests/test_bybitreads_census_pins.py`: 3 passed. Together with `TestBybitUnifiedTransfersAreFlows`: 10 passed.
- SC1_OK: all 31 census pins collect.
- mypy strict (the CI command): no issues in 142 files.
- No service file changed: `git diff --quiet 9dc6e71e4 HEAD -- analytics-service/services` exits 0.

## PROOF-01 (each gate neutered, RED on its named arm, restored by `cp` from `$SCRATCH/<file>.bak` plus `cmp`, then GREEN)
1. **Replace pin, C23.** Neuter: a union with `fetch_ccxt_transfers` deposits in the Bybit arm of `run_derive_broker_dailies_job`.
   ```
   E       AssertionError: assert [('2026-11-16', 6234.0)] == [('2026-11-16', 5000.0)]
   FAILED tests/test_derive_broker_dailies_dualmode.py::TestBybitUnifiedTransfersAreFlows::test_unified_rows_replace_the_on_chain_reads_and_count_once
   ```
   CMP_OK, DIFF_CLEAN, 1 passed.
2. **C18 pin.** Neuter: an extra inverse closed-pnl request in `fetch_daily_pnl`.
   ```
   E       AssertionError: the Bybit closed-pnl read asked for ['inverse', 'linear']; census row C18 decides it is linear only (USDT and USDC perps) until an inverse rescale exists
   ```
   CMP_OK, DIFF_CLEAN, 1 passed.
3. **C19 pin.** Neuter: funding amount times 60000.0 in `funding_rows_to_daily_pnl_records`.
   ```
   E       AssertionError: a coin-denominated amount is summed at face value (C19); a conversion is the owner's flip
   FAILED tests/test_bybitreads_census_pins.py::test_census_c19_an_inverse_funding_amount_is_summed_at_face_value
   ```
   CMP_OK, DIFF_CLEAN, 1 passed.
4. **C27 pin.** Neuter: `default_lookback_days=7` in `fetch_funding_bybit`.
   ```
   E       AssertionError: a first Bybit funding walk sent 2 requests; census row C27 records at least 106 (two categories times 53 seven-day windows)
   FAILED tests/test_bybitreads_census_pins.py::test_census_c27_a_first_bybit_funding_walk_is_at_least_106_requests_under_a_180_second_budget
   ```
   CMP_OK, SERVICES_CLEAN, 1 passed.

## Deviations
- The founder questions were relayed by the coordinator rather than asked through AskUserQuestion.
- The VREAD-05 date was inferred from the derive record, as described above.
