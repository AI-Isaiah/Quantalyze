---
phase: 256-okxunitswitch
plan: 01
subsystem: analytics-service
tags: [okx, unit-switch, btc, pure-leaf, proof-01]
status: complete

requires:
  - phase: 164.6.6.2 BTCNATIVE
    provides: services/account_unit.py purity contract and the native_to_usd closes rule
provides:
  - "services/unit_switch.py: UnitSwitch, SplitPnl, derive_unit_switch, split_daily_pnl_at_switch, end_of_day_holdings_from_rows, UNIT_SWITCH_REFUSALS, COIN_LEAD_TOLERANCE_DAYS, COIN_MAJORITY_SHARE, PRICED_SWITCH_COINS, CoinBillCensus, EndOfDayHoldings, UnitSwitchResolver"
  - "tests/test_unit_switch.py: SC-1 fixtures and the split oracle"
affects: [256-02, 256-03, 256-04, 256-05]

plan_head_before: ac12c1e36d465635ff553e4e3b280e0658809645
plan_head_after: cb2577312bbe30efb69137b3cb6c9f0bbb1fc665

# Actuals (#2632): chars/4 over the two changed files (40933 chars). commits is MEASURED from the
# per-plan ledger (git rev-list --count plan_head_before..plan_head_after); the SUMMARY commit that
# follows is not in that range.
actuals:
  tokens: 10233
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns: ["pure leaf module beside account_unit.py (stdlib + typing + price_rule.is_stable_value)", "refusal by closed token set", "oracle literals written from CONTEXT, invariants computed from inputs"]

key-files:
  created:
    - analytics-service/services/unit_switch.py
    - analytics-service/tests/test_unit_switch.py
  modified: []

key-decisions:
  - "S = min(first coin bill day, first end-of-day coin-majority day); first coin return day = S + 1; no field is called switch_day"
  - "A coin bill dated S belongs to USD day S and is valued at S's stored close (reconciles CONTEXT VREAD-06 'on or after the switch day' with Boundary day) - flagged for the founder"
  - "From S + 1 the segment is measured in the coin: coin amounts keep native value, stable amounts are divided by their own day's close - flagged for the founder"
  - "A needed close that is missing, non-finite or not positive refuses by name and is never borrowed from a neighbour day"
  - "RESEARCH's undefined token stable_bill_before_unclear_state is NOT implemented (Rule 7, see below)"

requirements-completed: [SC-1, SC-2, SC-7]

duration: about 1h
completed: 2026-11-27
---

# Phase 256 Plan 01: Unit-switch seam Summary

**Pure leaf `services/unit_switch.py` that derives an OKX account's stable-to-coin switch day from bills census + end-of-day holdings (never a constant, a named refusal when the data cannot say) and splits daily P&L so every day lands in exactly one unit.**

## What was built

- `derive_unit_switch(census, end_of_day_holdings, live_share) -> UnitSwitch | str`. Founder-shaped fixture (all USDT through the end of 2026-11-13, about 75% BTC at the end of 11-14, about 99.7% at the end of 11-20, BTC bills first on 11-14) derives coin BTC, `last_usd_day` 2026-11-14, `first_coin_return_day` 2026-11-15. That matches the founder's "USD before 11-15, BTC after"; the one-day offset to the holdings `asof` 11-15 label is the clock convention (a row stamped `asof D` is the end of day D-1), not a disagreement. A second, differently shaped account (coin bills from 10-02, 40/55/80% BTC at the end of 10-02/03/04) derives `2026-10-02` / `2026-10-03`, so no date is a literal (grep `2026-11-1` in the module: 0).
- `end_of_day_holdings_from_rows`: spot rows only, `asof - 1`, summed per upper-cased symbol per day, unparseable rows skipped.
- `split_daily_pnl_at_switch(stable, coin, switch, closes) -> SplitPnl | str`.
- Refusal tokens the derive can return, each pinned by a named case: `no_coin_evidence`, `coin_bills_without_majority`, `two_coins`, `switch_back`, `ambiguous_boundary`, `holdings_unavailable`, `bills_precede_majority_beyond_tolerance`, `coin_without_price_source`. The split returns `switch_day_unpriced` and `coin_segment_unpriced`. All ten are in `UNIT_SWITCH_REFUSALS`; a parametrised test asserts every derive return is a `UnitSwitch` or a member.
- Imports: stdlib, typing, `services.price_rule.is_stable_value` only. No I/O, no logging, no venue text in any message.

## Deviations from Plan

None - plan executed exactly as written. Judgement calls inside the plan's room, surfaced here (Rule 7):

1. **`stable_bill_before_unclear_state` not implemented**, as the plan directs. Every case it could name is already `ambiguous_boundary` or `holdings_unavailable`. A test pins that it is not in the closed set.
2. **`no_coin_evidence` also covers an unusable census entry** (a coin that is not `[A-Z]{2,10}`, is a stable, or has an unparseable first day). The closed set has no "malformed census" token and the fetch builds the census from regex-valid non-stable `ccy`, so this is a defensive arm that names the nearest honest state (no usable coin evidence) rather than guessing.
3. **Bills-only key with some holdings** (holdings stable through their last day, live balance now in the coin): S is the bill day, and the majority cannot be earlier than the day after the last holdings day, so a bill more than 14 days before that refuses `bills_precede_majority_beyond_tolerance`. Not in the plan's fixture list; added as the same tolerance rule applied to a lower bound, with both sides tested.
4. **Zero amounts need no close** in the split (zero converts to zero either way), so a zero day with no close is not a refusal. Only a non-zero amount with an unusable close refuses.
5. **Two split rules for the founder** (planner decisions, recorded as the plan asked): (1) a coin bill dated S is a USD-day amount valued at S's close; (2) from S + 1 stable amounts are divided by that day's close into the coin. Both follow CONTEXT [Boundary day] "every day appears in exactly one return chain".
6. **Environment note, not a deviation of code:** the worktree has no `.venv`; the pytest and mypy runs used the main checkout's Python 3.12 venv read-only (no write outside the worktree). Iteration used `--noconftest` (the repo conftest adds about two minutes of unrelated session work); the plan's own verify command (with conftest) was run once at the end.

## Verification

- `cd analytics-service && python3 -m pytest tests/test_unit_switch.py tests/test_account_unit.py -x -q` (with the repo conftest, main venv 3.12): `106 passed in 83.23s` (74 here + the 32 `test_account_unit.py` tests, unchanged; `account_unit.py` not modified).
- `make typecheck` (mypy strict, CI path set, `MYPY=` pointed at the main venv's mypy): `Success: no issues found in 147 source files`. `mypy tests/test_unit_switch.py`: `Success: no issues found in 1 source file`.
- Acceptance greps: `def derive_unit_switch` 1, `def split_daily_pnl_at_switch` 1, `2026-11-1` in the module 0, `stable_bill_before_unclear_state` in the module 0, every derivable token has at least one assertion.

## PROOF-01 (each gate seen RED on a neutered copy, byte restore, GREEN)

Byte backup with `cp`, neuter with a one-line replacement, run, restore with `cp`, `cmp` (silent), run GREEN. No `git checkout` / `restore` / `stash`. Runs below used `--noconftest -p no:cacheprovider` for speed; the file under test is identical.

### Gate A - derive_unit_switch (neutered: S is always the first coin bill day, the `min` comparison dropped)

```
=== GATE A RED (neutered: S is always the first coin bill day) ===
FAILED tests/test_unit_switch.py::test_majority_before_the_first_bill_pins_s_to_the_majority_day
1 failed, 73 passed in 1.33s
=== cmp (must print nothing) ===
(cmp silent: identical)
=== GATE A GREEN ===
........................................................................ [ 97%]
..                                                                       [100%]
74 passed in 1.36s
```

That neuter only bites where the majority day precedes the first bill (the differently shaped account has the bill first, so it correctly passes under a bill-only rule). The opposite neuter (S is always the first majority day, the bill day ignored) bites the differently shaped, tolerance and gradual-mover arms:

```
=== GATE A2 RED (neutered: S is always the first majority day, the bill day is ignored) ===
FAILED tests/test_unit_switch.py::test_differently_shaped_account_derives_its_own_dates
FAILED tests/test_unit_switch.py::test_tolerance_boundary_is_inclusive_at_14_and_refuses_at_15
FAILED tests/test_unit_switch.py::test_a_gradual_mover_does_not_refuse - Asse...
3 failed, 71 passed in 2.71s
cmp exit: 0
74 passed in 1.32s
```

Together the two neuters pin both sides of `min(first_bill, first_majority)`.

### Gate B - split_daily_pnl_at_switch (neutered: rule (1), the coin bill dated S goes to `coin_by_day`)

```
=== GATE B RED (neutered: the coin bill dated S goes to coin_by_day) ===
E         comparison failed. Mismatched elements: 1 / 1:
FAILED tests/test_unit_switch.py::test_boundary_oracle_each_day_is_in_exactly_one_unit
FAILED tests/test_unit_switch.py::test_stable_and_coin_amounts_on_the_switch_day_sum_in_usd
FAILED tests/test_unit_switch.py::test_a_coin_amount_on_the_switch_day_with_no_close_refuses_by_name
FAILED tests/test_unit_switch.py::test_an_unusable_close_is_as_missing_as_an_absent_one[0.0]
FAILED tests/test_unit_switch.py::test_an_unusable_close_is_as_missing_as_an_absent_one[-1.0]
FAILED tests/test_unit_switch.py::test_an_unusable_close_is_as_missing_as_an_absent_one[nan]
FAILED tests/test_unit_switch.py::test_an_unusable_close_is_as_missing_as_an_absent_one[inf]
FAILED tests/test_unit_switch.py::test_a_zero_amount_needs_no_close - Asserti...
8 failed, 66 passed in 1.88s
cmp exit: 0
=== GATE B GREEN ===
74 passed in 0.91s
unchanged vs pre-proof: 0
```

The first FAILED line names the boundary oracle. The module was also byte-compared against the pre-proof backup after both gates (`cmp` exit 0).

Also seen RED before implementation (TDD): Task 1 against a skeleton returning `no_coin_evidence` (`17 failed, 1 passed`), Task 2 against the Task 1 implementation (`18 failed, 44 passed`), Task 3 against a skeleton split (`11 failed, 63 passed`).

## Known Stubs

None.

## Threat Flags

None. Fixtures use round illustrative values; no PROD id, amount or account figure is in tracked text (T-256-02). The coin code is fullmatched against `[A-Z]{2,10}` and no venue text reaches a message (T-256-01). A missing or ambiguous date refuses by name and the boundary oracle plus disjoint-union invariant pin one unit per day (T-256-03).

## Self-Check: PASSED

- FOUND: analytics-service/services/unit_switch.py
- FOUND: analytics-service/tests/test_unit_switch.py
- FOUND commits: c84c47882, 34dd07a1c, cb2577312 (all ancestors of HEAD)
