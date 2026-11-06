---
phase: 186-derivegaps-the-per-key-derive-refuses-a-truncated-or-failed
plan: 03
subsystem: analytics-service tooling
tags: [probe, read-only, bybit, okx, funding, unified-flows, sc-1, pairing]
status: complete

requires:
  - phase: 186-02
    provides: scripts/derivegaps_probe.py skeleton, GET-only recording view, Gap 1 section
provides:
  - "services/bybit_unified_flows.py: PAIRING_WINDOW_MS, FlowPairing, pair_onchain_with_unified (pure, no production caller)"
  - "scripts/derivegaps_probe.py: measure_bybit_flows (Gap 2), measure_funding_pairs and same_hour_pairs (Gap 4), per-key timings and the Bybit / funding summary aggregates"
affects: [186-04, 186-10]

plan_head_before: e0fee0a261de5fe9ff3005ba30ebdf5b6e74a11e
plan_head_after: 8454905a6a184697081fc7bdbf1fe77c36764ff2

actuals:
  tokens: 19200
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns: [one shared pure pairing rule, closed read-state tokens instead of failing the key, replies taken by position after the read starts]

key-files:
  created: []
  modified:
    - analytics-service/services/bybit_unified_flows.py
    - analytics-service/tests/test_bybit_unified_flows.py
    - analytics-service/scripts/derivegaps_probe.py
    - analytics-service/tests/test_derivegaps_probe.py

key-decisions:
  - "The overlap rule lives once, in the Unified-flows service module. The probe imports it, and a test replaces the service function with a spy and shows the probe's pair counts come from it."
  - "A failed flow or funding read is a closed state on the record (onchain_read_state, unified_read_state, funding_state), not a failed key, so a key's Gap 1 measurements survive a Gap 2 or Gap 4 failure. A spent call budget is still a refusal."
  - "Funding replies are the ones recorded after the funding read starts (positional offsets), not filtered by request type: the funding read is the only thing running in that interval."

duration: ~1h
completed: 2026-11-03
---

# Phase 186 Plan 03: Derivegaps probe, Gap 2 and Gap 4 sections Summary

**The SC-1 probe now measures, per Bybit key, the account type and how many on-chain deposit and withdrawal rows pair with a Unified TRANSFER row (through one pure pairing function in the service module), and, per OKX and Bybit key, how many same-hour funding legs, overlap duplicates and malformed rows the real funding fetchers meet, with per-key seconds for the D-06 budget split.**

deploy-fingerprint: derivegaps 0 1 68 71 5 4 okx,bybit,binance

## What was built

- `pair_onchain_with_unified(onchain_deposits, onchain_withdrawals, unified_deposits, unified_withdrawals, *, window_ms=PAIRING_WINDOW_MS) -> FlowPairing` in `services/bybit_unified_flows.py`. Deposits pair when the Unified row is at or after the on-chain row within 30 days; withdrawals when the on-chain row is at or after the Unified row within 30 days; same upper-cased currency and equal absolute amount (`math.isclose`, 1e-9). Greedy in time order, each Unified row used once, earliest eligible first. An unreadable row (no stamp, no amount, no currency) pairs with nothing and never raises. It is named in no other service module (checked by grep).
- `measure_bybit_flows(view, run_day)`: `read_key_info` for `bybit_is_uta` / `bybit_is_master`; the REAL `fetch_ccxt_transfers` (deposits then withdrawals) and `fetch_bybit_unified_flows` over the derive's own window (`flow_retention_floor("bybit", ...)` to now); closed states `onchain_read_state` (`complete | failed`) and `unified_read_state` (`complete | reader_error | venue_error`); eight flow counts; two signed 3-significant-figure net ratios against the anchor (stable coins only, deposits positive, withdrawals negative; the second over the on-chain rows the pairing did not match); `nonstable_flow_rows`; `flows_elapsed_s` and `unified_elapsed_s`.
- `measure_funding_pairs(view, venue, label)`: the REAL `fetch_funding_okx` / `fetch_funding_bybit` with `since_ms=None`; `funding_kept_rows` is the fetcher's return; `funding_raw_rows`, `funding_same_hour_distinct_pairs`, `funding_same_hour_same_id` and `funding_malformed_rows` come from the raw replies that read caused, with each raw row passed through the repo's own `_normalize_funding_row` under the fetcher's own argument mapping. State `complete | truncated | fetch_error`; counts are `field-absent` unless `complete`. Binance prints `field-absent` throughout and reads nothing.
- `same_hour_pairs(rows)`: `(groups with two or more distinct ids, groups with one id twice)` per (instrument, UTC hour).
- Vocabulary: key record 34 to 58 keys, summary 33 to 51. New summary aggregates: nine Bybit (`bybit_uta`, `bybit_non_uta`, `bybit_uta_unknown`, `bybit_onchain_rows`, `bybit_unified_rows`, `bybit_paired_rows`, `bybit_unpaired_onchain_rows`, `bybit_unified_reader_errors`, `bybit_max_flows_s`), `<okx|bybit>_funding_pairs`, `<okx|bybit>_funding_malformed`, `<okx|bybit>_max_funding_s`, and `<okx|bybit|binance>_max_nonrealized_s` (max over keys of equity + funding + flows + Unified seconds).
- The view now also resolves the camel-case implicit GETs (`privateGet...`, `publicGet...`, which `fetch_ccxt_transfers` uses for Bybit's deposit and withdraw records) and the two pure ccxt parsers it calls on those answers (`add_pagination_cursor_to_result`, `parse_transactions`, uncounted, no I/O). A camel-case POST still does not resolve (tested).

## For plan 186-04

- `g4-pairs` / `g1-malformed-rule`: copy `funding_same_hour_distinct_pairs` and `funding_malformed_rows` by name from the key records.
- The replace-against-union evidence (RESEARCH Pitfall 6) is `paired_*` against `unpaired_onchain_*` per Bybit key; the summary has the totals.
- Account-type counts (`bybit_uta`, `bybit_non_uta`, `bybit_uta_unknown`) split the MEASURED Bybit keys.
- `bybit_max_flows_s` is the maximum over Bybit keys of that key's on-chain plus Unified flow seconds.
- Probe call budget: the on-chain Bybit read costs about 26 windows' calls and the Unified read about 106, plus the funding walk (about 106 windows for Bybit), all inside the one 3000-call per-key ceiling.

## Verification

- `pytest tests/test_derivegaps_probe.py tests/test_bybit_unified_flows.py`: 83 + 59 passed (probe 40 to 83, unified flows 48 to 59). With `tests/test_funding_fetch.py`, `tests/test_walletoffset_probe.py`, `tests/test_job_worker.py` (an importer of the service module) and `tests/test_trade_pages.py`: 509 passed, 1 skipped (`tests/test_job_worker.py:4216`, live TEST database not configured, a skip that predates this plan).
- `mypy --strict ... scripts/derivegaps_probe.py`: Success, no issues found in 1 source file.
- CI mypy line (`services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`): Success, no issues found in 131 source files.
- Text pin over the probe (`private_post_|create_order|cancel_order|withdraw\\(|transfer\\(|\\.(insert|upsert|delete|rpc)\\(|enqueue`): prints nothing.
- `services/funding_fetch.py` unchanged (`git diff --quiet`); `pair_onchain_with_unified` named in `services/bybit_unified_flows.py` only.
- Tests seen RED first for every behavior. Three byte-backup mutations seen RED then restored: stable-coin filter off (5 probe tests fail), funding replies taken from position 0 (2 fail), pairing taking the latest Unified row instead of the earliest (1 fails).
- The probe was NOT run against any venue or database (plan 186-04 owns the run).

## Deviations from Plan

### Additive (no Rule 1-4 trigger; recorded because they enlarge the plan's list)

**1. Extra key `onchain_read_state`.** The plan names `unified_read_state` only. A venue failure in the on-chain reads would otherwise fail the whole key and discard its Gap 1 measurements, so the on-chain pair of reads gets the same closed-state treatment (`complete | failed`). It adds one key to the record.

**2. View extended (plan 186-02's `_GET_PREFIXES`, plus a new `_PURE_HELPERS`).** The plan's Task 1 did not list it, but the real `fetch_ccxt_transfers` Bybit branch calls `privateGetV5AssetDepositQueryRecord` (camel case), `add_pagination_cursor_to_result` and `parse_transactions`, none of which the plan-02 view resolved. Added `privateGet` / `publicGet` prefixes and the two pure helpers. Plan 02's SUMMARY invited exactly this extension.

**3. Summary scope.** `max_nonrealized_s` is emitted for all three venues (Binance: equity only); the funding aggregates only for OKX and Bybit, since Binance funding is Phase 187.

**4. Pairing keys on position, not only on id.** A row with no `id` is paired by position and counted paired, but it has no id to put in `matched_deposit_ids` or `matched_withdrawal_ids`. ccxt transfers always carry an id, so this edge is unreached today.

## Known limits

- The anchor is the USDT wallet balance the equity read takes (the Bybit realized-basis anchor, plan 186-02), so the net ratios are shares of that figure, not of mark-to-market equity.
- The Unified reader reads TRANSFER_IN / TRANSFER_OUT only (its own documented limitation); Earn, staking and bonus transfers are not in the overlap count.
- A funding read that ends `truncated` or `fetch_error` gives no counts for that key; the partial replies are not used.

## Known Stubs

None.

## Threat Flags

None. No endpoint, auth path or schema was added; every venue call goes through the GET-only view (T-186-06 mitigated: one pure function, one service module names it; T-186-07 mitigated: amounts appear only as 3-significant-figure ratios, ids, currencies and exception text stay in memory, `emit_record` refuses anything else, tests assert none of the planted amounts, currency codes or venue messages reach an output).

## Self-Check: PASSED

- FOUND: analytics-service/services/bybit_unified_flows.py (`def pair_onchain_with_unified`)
- FOUND: analytics-service/scripts/derivegaps_probe.py (`def same_hour_pairs`, `def measure_bybit_flows`, `def measure_funding_pairs`)
- FOUND commits: c045df945 (tracer), 59bdba191 (Gap 2), 8454905a6 (Gap 4)
