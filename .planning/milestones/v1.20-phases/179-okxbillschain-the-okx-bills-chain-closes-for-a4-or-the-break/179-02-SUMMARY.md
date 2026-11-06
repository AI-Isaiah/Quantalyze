---
phase: 179-okxbillschain-the-okx-bills-chain-closes-for-a4-or-the-break
plan: 02
subsystem: analytics-service (OKX bills oracle diagnostic, allocator history probe)
tags: [okx, bills-archive, chain_break, probe, read-only, redaction, call-ceiling]

requires:
  - phase: 179-okxbillschain
    provides: plan 01's arm, currency, kind, residual and close-race record (ChainReport, analyse_chain, BudgetedExchange, CHAIN_KEYS, measure_chain)
provides:
  - "One operator run of the probe now separates every D-02 candidate cause of an OKX chain_break: ordering and ties, the balance's own clock, a second walk (transient or structural), in-window bills below the walk's stop point, the 7-day /account/bills overlap and the type and instType presence sweep, all under the 120-call ceiling"
affects: [179-03, 173-rebuildgates]

actuals:
  tokens: 18566
  tasks: 3
  commits: 3
plan_head_before: cd2c7163f1c869786d2e583bf421614554892811
plan_head_after: 58e210076143055d59defc1778fba7f50cbf1de1

tech-stack:
  added: []
  patterns:
    - "Ordered venue groups over one counted GET-only budget; a ceiling leaves a group's keys at their defaults and sets chain_ceiling_hit, any other failure records class and step and stops"
    - "A second walk's verdict is its own key (chain_repeat_reason); the first reading's opening_unavailable_reason is never returned by the record module"
    - "Strict-less-than bucket edges for ages and lags, mirroring the residual buckets"

key-files:
  created: []
  modified:
    - analytics-service/services/okx_bills_chain.py
    - analytics-service/scripts/okx_chain_record.py
    - analytics-service/tests/test_okx_bills_chain.py
    - analytics-service/tests/test_okx_chain_record.py
    - analytics-service/tests/test_allocator_history_probe.py

key-decisions:
  - "The trail test counts one side of the multiset difference. Both multisets hold one entry per bill, so the unmatched starts always equal the unmatched ends; the plan's 'both at most 1' is the same condition and one count says both."
  - "A spent call budget in ANY group, the close group included, is chain_ceiling_hit True with the group's keys at their defaults and chain_failed_step none. Plan 01 recorded a spent budget in the close group as failed step close; plan 02's rule (a ceiling is the diagnostic stopping itself, not a venue failure) replaces it, and plan 01's test was updated to say so."
  - "On a non-ceiling failure chain_ceiling_hit stays field-absent: the run did not finish, so whether the ceiling would have been reached is unknown."
  - "A 7-day read or sweep that hits the ceiling still records what it read (partial counts, complete False) and stops the run."

requirements-completed: [SC-1]

coverage:
  - id: D1
    description: "Ordering and ties: billId-versus-ts inversions, same-ts links and breaks, closes under (ts, billId) and (ts, -billId), the order-independent trail, the gap estimate and break age buckets"
    requirement: SC-1
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_okx_bills_chain.py#test_a_tie_shows_same_stamp_links_and_closes_only_under_the_descending_id_order"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_okx_bills_chain.py#test_a_deleted_middle_bill_is_a_gap_while_a_clean_currency_still_has_a_trail"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_okx_chain_record.py#test_the_age_bucket_edges_are_exact"
        status: pass
    human_judgment: false
  - id: D2
    description: "Race and lag: the balance row's own uTime against the newest bill, and a second walk whose verdict is chain_repeat_reason and never overwrites the first reading's reason"
    requirement: SC-1
    verification:
      - kind: e2e
        ref: "analytics-service/tests/test_allocator_history_probe.py#test_a_chain_break_is_named_by_arm_and_currency_and_the_refusal_stands"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_okx_bills_chain.py#test_the_repeat_verdict_is_none_on_a_chain_that_holds"
        status: pass
    human_judgment: false
  - id: D3
    description: "In-window bills below the walk's stop point are counted (chain_below_stop, _ccys, _complete) by one begin-bounded page"
    requirement: SC-1
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_okx_bills_chain.py#test_in_window_bills_below_the_stop_point_are_counted_with_their_currencies"
        status: pass
    human_judgment: false
  - id: D4
    description: "The 7-day /account/bills store is read and compared with the walk (both, only in the 7-day store inside the walked range, after the walk, only in the archive, field mismatches, kinds, archive-behind bucket, complete flag)"
    requirement: SC-1
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_okx_bills_chain.py#test_a_seven_day_bill_missing_from_the_walk_inside_its_range_is_a_real_absence"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_okx_bills_chain.py#test_the_seven_day_read_uses_the_backoff_helper"
        status: pass
    human_judgment: false
  - id: D5
    description: "A type and instType presence sweep counts filters probed and filters that serve a bill the unfiltered walk never served, the hidden kinds and full (partial) pages; zero types from /account/subtypes is a count, never a pass"
    requirement: SC-1
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_okx_bills_chain.py#test_a_type_the_unfiltered_walk_never_served_is_hidden_and_named"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_okx_bills_chain.py#test_an_unrecognisable_subtypes_reply_is_zero_types_a_count_and_not_a_pass"
        status: pass
    human_judgment: false
  - id: D6
    description: "Every chain GET goes through BudgetedExchange under CHAIN_CALL_CEILING 120; a ceiling hit sets chain_ceiling_hit and the *_complete booleans false and never changes a verdict"
    requirement: SC-1
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_okx_chain_record.py#test_the_ceiling_stops_the_run_between_groups_and_never_changes_a_verdict"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_okx_chain_record.py#test_a_sweep_that_hits_the_ceiling_records_what_it_read_and_says_so"
        status: pass
    human_judgment: false
  - id: D7
    description: "The appended end-to-end test asserts all 57 chain keys of the a4-shaped fake through hp.run(), with the refusal, the oracle's token and the forced pass's counters unchanged"
    requirement: SC-1
    verification:
      - kind: e2e
        ref: "analytics-service/tests/test_allocator_history_probe.py#test_a_chain_break_is_named_by_arm_and_currency_and_the_refusal_stands"
        status: pass
    human_judgment: false

duration: about 75min
completed: 2026-10-28
status: complete
---

# Phase 179 Plan 02: OKX bills chain re-read and sweep Summary

**The probe's `chain_break` record now also tells ordering and ties, the balance's clock, a transient break from a structural one (a second walk), in-window bills below the walk's stop, the 7-day `/account/bills` overlap and any hidden bill kind or instType, in 57 `chain_*` keys, all through GET-only counted calls under a 120-call ceiling, without touching the refusal or the probe source.**

## Performance

- **Duration:** about 75 min
- **Completed:** 2026-10-28
- **Tasks:** 3 of 3 (all `tdd="true"`, RED seen before implementation each time)
- **Files:** 5 modified (the plan's `files_modified`), none created; the probe source `scripts/allocator_history_probe.py` is unchanged by this plan

## Accomplishments

- Task 1: `analyse_chain` counts inversions, same-ts links and breaks, how many broken currencies close under (ts, billId) and (ts, -billId), the balance-multiset trail, the gap estimate and the break ages (against the newest STAMP of any bill, so an inversion cannot make an age negative). Ten new keys (34 in all).
- Task 2: `repeat_chain_verdict` replays the oracle's chain decision on a fresh balance row and a second walk without pricing; `balance_utimes`/`utime_race` compare the balance's clock with each currency's newest bill; `read_below_stop` counts in-window bills below the walk's smallest billId. `measure_chain` became ordered groups (close, repeat, below_stop) over one budget. Seven new keys (41 in all).
- Task 3: `read_recent_bills`, `recent_overlap`, `read_bill_types`, `sweep_hidden`, `_lag_bucket`, and two more groups (recent, sweep). Sixteen new keys (57 in all). The appended e2e asserts every key of the a4-shaped fake by looping over an expected dict whose key set must equal `CHAIN_KEYS`.
- Both modules measure 100% line coverage; the CI mypy line passes (`Success: no issues found in 128 source files`).

## Mutations (neuter, see RED, restore from a byte backup, confirm with cmp, GREEN)

- mutation N4: RED tests/test_okx_bills_chain.py::test_a_tie_shows_same_stamp_links_and_closes_only_under_the_descending_id_order (also the inversion, deleted-middle-bill and clean-world tests; 4 failed) with the trail's matching removed (`unmatched = sum(starts.values())`); restored (cmp identical); GREEN. See Deviations 1: the plan's literal "drop the ends side" is an equivalent mutation and cannot go RED.
- mutation N9: RED tests/test_okx_chain_record.py::test_the_returned_keys_are_a_subset_of_the_chain_keys, tests/test_okx_chain_record.py::test_a_full_run_records_each_group_and_no_ceiling_hit and tests/test_allocator_history_probe.py::test_a_chain_break_is_named_by_arm_and_currency_and_the_refusal_stands (the repeat group also returned `opening_unavailable_reason`; the e2e read "none" where it expects "chain_break"); restored (cmp identical); GREEN
- mutation N6: RED tests/test_okx_bills_chain.py::test_the_seven_day_read_uses_the_backoff_helper (`read_recent_bills` awaited the venue method directly instead of `_okx_bills_fetch_with_backoff`); restored (cmp identical); GREEN

## Task Commits

1. **Task 1: ordering, ties, topology, ages** - `8ad4a7c62` (feat)
2. **Task 2: second walk, balance clock, below-stop, ceiling groups** - `a41cb7457` (feat)
3. **Task 3: 7-day store, sweep, complete e2e** - `58e210076` (feat)

**Plan metadata:** the commit that adds this file (docs).

## Files Created/Modified

- `analytics-service/services/okx_bills_chain.py` - 412 added lines: the ordering/topology/age fields of `ChainReport`, `opening_ms`, `balance_utimes`, `utime_race`, `repeat_chain_verdict`, `BelowStop`/`read_below_stop`, `RECENT_PAGE_CEILING`, `SWEEP_INST_TYPES`, `RecentRead`/`read_recent_bills`, `RecentOverlap`/`recent_overlap`, `read_bill_types`, `Sweep`/`sweep_hidden`
- `analytics-service/scripts/okx_chain_record.py` - 33 new keys with validators and field-absent defaults, `_age_bucket`, `_lag_bucket`, `measure_chain` as five ordered groups with the ceiling rule
- `analytics-service/tests/test_okx_bills_chain.py`, `tests/test_okx_chain_record.py` - tests for every new function, bucket edge, stop rule and bad value
- `analytics-service/tests/test_allocator_history_probe.py` - only inside the Phase 179 section (`APPEND_ONLY_OK`): `_ChainVenue` gains `healed`, `recent`, `subtypes`; `_chain_break_world` returns a `_ChainWorld`; the e2e asserts all 57 keys

## Decisions Made

See `key-decisions` above. Each is recorded where the code reads it (docstrings), not only here.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug in the plan's design] The trail's "both at most 1" is one count, and mutation N4 as written is equivalent**
- **Found during:** Task 1, while choosing a mutation for N4
- **Issue:** the plan computes `unmatched_starts` and `unmatched_ends` and requires both at most 1. Both multisets hold one entry per bill, so the two totals are always equal. The plan's N4 ("count only `starts`, drop the ends side") therefore changes nothing and can never go RED.
- **Fix:** `_trail` computes the one count (`sum((starts - ends).values())`) and says why in its docstring. N4 was run as a different neuter that does bite: the matching against `ends` removed, which turned 4 tests RED.
- **Files modified:** services/okx_bills_chain.py
- **Commit:** `8ad4a7c62`

**2. [Rule 1 - Consequence of the plan's own rule] Plan 01's spent-budget test updated**
- **Found during:** Task 2
- **Issue:** plan 01's `test_a_spent_budget_is_a_recorded_close_failure_not_a_crash` asserted `chain_failed_step == "close"` for a ceiling of 0. Plan 02's rule says a ceiling in any group sets `chain_ceiling_hit` and leaves `chain_failed_step` at none.
- **Fix:** the test (renamed `test_a_spent_budget_is_a_recorded_ceiling_hit_not_a_crash`) asserts the new rule with a comment saying what moved. The venue still never sees the over-ceiling call.
- **Files modified:** tests/test_okx_chain_record.py
- **Commit:** `a41cb7457`

**3. [Rule 3 - Blocking] Plan 01's `chain_calls == 1` and `balance_calls == 2` assertions and a `len(CHAIN_KEYS)` pin moved**
- **Found during:** Tasks 2 and 3 (the plan orders the e2e change; the key-count pin is plan 01's)
- **Fix:** the e2e now asserts 14 calls and 3 balance reads (with a comment); `test_the_new_keys_are_measured_values_on_the_seeded_break` pins the key count at each task's total (34, 41, 57).

### Hand-derived e2e values

All 57 hand-derived values in the plan's Task 3 step 5 matched what the code measured; none needed correcting and no assertion was loosened. Four of my own test worlds (not the plan's e2e values) had wrong expectations on first run and were fixed on the TEST side after deriving them by hand: a `balChg` suffix typo, a missing bill whose id was above the walk's largest (so correctly not "hidden"), a page whose slot a walked bill took (99 hidden, not 100), and a hidden bill's subType (173, not blank). The module was not touched for any of them.

**Total deviations:** 3 (1 design correction in the plan, 1 consequence of the plan's own ceiling rule, 1 blocking pin update). **Impact:** none on any verdict or on any key outside this plan.

## Issues Encountered

- The full analytics suite was not run serially (`pytest-xdist` is not installed locally; CI runs `-n auto --dist loadgroup`; plan 01 recorded the same). In its place every test file that mentions a changed module ran: `tests/test_allocator_history_probe.py`, `test_ana_recon_audit.py`, `test_okx_anchor_rule.py`, `test_okx_bills_backoff.py`, `test_okx_bills_chain.py`, `test_okx_chain_record.py`, `test_okx_opening_balance.py`, `test_reconstruct_force_rebuild.py`: `423 passed`. CI remains the owner of the full-suite and `--cov-fail-under=80` gate.
- zsh does not word-split an unquoted variable, so the first attempt to pass a file list to pytest failed on one bad argument; every multi-file command above was re-run under `bash -c` with explicit arguments.
- No PROD, TEST or Railway access, no SQL, no `--linked`. STATE.md and ROADMAP.md untouched (the orchestrator owns them).

## Known Stubs

None.

## Threat Flags

None. The new venue surface is extra GETs (`/account/bills`, `/account/subtypes`, a second balance read, a second archive walk and 8 or more filtered archive pages) through the counted GET-only wrapper, covered by T-179-07 (ceiling 120, page ceiling 10, one page per sweep filter, 429s only through the backoff helper) and T-179-08 (digit codes of at most four characters, a closed instType set, counts capped at six digits, bad-value and leak tests including the amount "20007").

## Next Phase Readiness

Plan 179-03 (the founder's fix decision) can read, from one operator run: arm, currency class and bill kinds (plan 01); ordering and ties, gap or not, break ages, the balance clock, transient or structural (`chain_repeat_reason` beside the first reading's `chain_break`), bills below the walk's stop, the 7-day store's coverage and lag, and hidden types and instTypes. A call over the ceiling reads `chain_ceiling_hit true` and the affected `*_complete` false; a venue failure reads `chain_failed_step` and the exception class, and every earlier key stays.

## Self-Check: PASSED

- Modified files exist: okx_bills_chain.py, okx_chain_record.py, test_okx_bills_chain.py, test_okx_chain_record.py, test_allocator_history_probe.py (all FOUND).
- Commits `8ad4a7c62`, `a41cb7457`, `58e210076` are ancestors of HEAD; `git rev-list --count cd2c7163f..HEAD` was 3 at the time of the last code commit.
- `CHAIN_VOCAB_OK 57` and `APPEND_ONLY_OK` print; the 57 keys are the tail of `ACCOUNT_RECORD_KEYS`; `CHAIN_CALL_CEILING` is 120.
- `grep -ac importlib` prints 0 for both new test files; the probe source `scripts/allocator_history_probe.py` appears in no commit of this plan.
- Mutation lines N4, N9 and N6 above, each restored byte-identical by `cmp`.
