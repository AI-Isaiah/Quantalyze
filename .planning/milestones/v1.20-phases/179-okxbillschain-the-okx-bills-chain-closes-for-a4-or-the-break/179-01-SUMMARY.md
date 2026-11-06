---
phase: 179-okxbillschain-the-okx-bills-chain-closes-for-a4-or-the-break
plan: 01
subsystem: analytics-service (OKX bills oracle diagnostic, allocator history probe)
tags: [okx, bills-archive, chain_break, probe, read-only, redaction]

requires:
  - phase: 172-okxanchor
    provides: the bills oracle (services/okx_opening_balance.py) whose chain_break token this plan makes explain itself
provides:
  - "When the bills oracle refuses an OKX member with chain_break, the probe's account record names the arm over every currency, the worst currency's closed class, the bill kinds, margin modes and position-level changes around each interior break, the relative residual bucket, the residual signature and whether the close only failed against the pre-walk cash"
  - "Wave 0 venue-reply fakes for the whole phase (tests/_okx_bills.py), additive and default-off"
affects: [179-02, 179-03, 173-rebuildgates]

actuals:
  tokens: 21249
  tasks: 3
  commits: 3
plan_head_before: 727f7863da8d4f9081c673b3f14f4c8d07261059
plan_head_after: eea9314df147c15c978ffbf8e660e8558ab19552

tech-stack:
  added: []
  patterns:
    - "GET-only counted venue wrapper (BudgetedExchange) as the single choke point under a hard call ceiling"
    - "Closed-grammar token lists validated by fullmatch regexes, counts capped at six digits"
    - "Pure analysis module plus a record module that owns every printing decision"

key-files:
  created:
    - analytics-service/services/okx_bills_chain.py
    - analytics-service/scripts/okx_chain_record.py
    - analytics-service/tests/test_okx_bills_chain.py
    - analytics-service/tests/test_okx_chain_record.py
  modified:
    - analytics-service/services/okx_opening_balance.py
    - analytics-service/scripts/allocator_history_probe.py
    - analytics-service/tests/_okx_bills.py
    - analytics-service/tests/test_allocator_history_probe.py

key-decisions:
  - "chain_diagnostic stays run when only the post-walk balance read fails: the analysis keys are measured, the failure is named by chain_failed_step close and the exception class. failed is reserved for an analysis that produced nothing."
  - "Residual signature reorder replaces the researched swapped_pair (see Deviations)."
  - "The record module merges with dict spreads, never dict update, so its source passes the same static write pin as the services module."

requirements-completed: [SC-1]

coverage:
  - id: D1
    description: "A refused OKX chain_break names its arm (none, interior, close, both) over every currency, how many currencies break each arm, and the worst currency as a closed class with a stable flag, end to end through hp.run()"
    requirement: SC-1
    verification:
      - kind: e2e
        ref: "analytics-service/tests/test_allocator_history_probe.py#test_a_chain_break_is_named_by_arm_and_currency_and_the_refusal_stands"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_okx_bills_chain.py#test_the_arm_and_counts_are_read_over_every_currency"
        status: pass
    human_judgment: false
  - id: D2
    description: "The close arm is re-read against a balance read after the walk, so a close that fails only against the pre-walk cash is counted (chain_close_matches_after) beside the currencies whose cash moved during the walk"
    requirement: SC-1
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_okx_bills_chain.py#test_a_close_that_only_fails_against_the_pre_walk_cash_counts_in_matches_after"
        status: pass
    human_judgment: false
  - id: D3
    description: "The forced path is unchanged: the oracle and probe change by added lines only, the member still refuses anchor_skipped_implausible and the oracle's own token is still printed"
    requirement: SC-1
    verification:
      - kind: e2e
        ref: "analytics-service/tests/test_allocator_history_probe.py#test_a_chain_break_is_named_by_arm_and_currency_and_the_refusal_stands"
        status: pass
      - kind: other
        ref: "TRACER_GATES_OK (git diff -U0 against the merge base removes no line from the oracle or the probe)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Every chain value is a count, a boolean, a closed token or field-absent; an out-of-vocabulary value is refused by key name and never by value; a seeded amount or ten-digit bill id never reaches stdout"
    requirement: SC-1
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_okx_chain_record.py#test_every_declared_key_refuses_a_value_outside_its_vocabulary"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_okx_chain_record.py#test_the_honest_record_prints_and_leaks_nothing"
        status: pass
    human_judgment: false
  - id: D5
    description: "The diagnostic's venue calls are GETs only, each counted under CHAIN_CALL_CEILING 120, and a failure inside it is recorded by exception class and step without discarding earlier keys"
    requirement: SC-1
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_okx_bills_chain.py#test_the_budget_resolves_get_methods_only"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_okx_chain_record.py#test_a_venue_error_after_the_walk_is_recorded_by_class_and_keeps_the_analysis"
        status: pass
    human_judgment: false
  - id: D6
    description: "Bill kinds, margin modes, position-level changes, residual size and residual signature of every interior break, as closed tokens and counts"
    requirement: SC-1
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_okx_bills_chain.py#test_each_break_has_one_signature"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_okx_chain_record.py#test_the_residual_bucket_edges_are_exact"
        status: pass
    human_judgment: false

duration: 70min
completed: 2026-10-28
status: complete
---

# Phase 179 Plan 01: OKX bills chain measurement Summary

**An OKX `chain_break` refusal now prints which arm broke over every currency, the worst currency's closed class, the bill kinds, margin modes, relative residual bucket and residual signature of each interior break, and whether the close only failed against the pre-walk cash, through GET-only counted venue calls, without changing the refusal.**

## Performance

- **Duration:** about 70 min
- **Completed:** 2026-10-28
- **Tasks:** 3 of 3 (Task 1 was a tracer; its end-to-end gate was re-run before Tasks 2 and 3 expanded it)
- **Files:** 4 created, 4 modified (all inside the plan's `files_modified`)

## Accomplishments

- Tracer: one path from the oracle through the pure analysis, the record vocabulary and the probe's `_measure_anchor`, proven by an appended end-to-end test through `hp.run()` on an a4-shaped fake (USDT interior break first in walk order, BTC close break that clears against a post-walk balance read).
- `services/okx_bills_chain.py`: `BudgetedExchange` (only `private_get_` names resolve, each call counted, the call over `CHAIN_CALL_CEILING` 120 refused before the venue sees it, so a 429 retry inside the existing backoff is counted), `analyse_chain` (pure, every currency, never stops at the first), `close_race`, `read_cash_after`.
- `scripts/okx_chain_record.py`: 24 `chain_*` keys with validators and field-absent defaults; closed currency vocabulary (`STABLECOINS`, BTC, ETH, OKB, other); closed `T.S.I:n` kind grammar and `M:n` margin grammar; exact `Decimal` residual bucket edges; `measure_chain` never raises and returns only `CHAIN_KEYS`.
- Wave 0 fakes for the whole phase in `tests/_okx_bills.py`, additive and default-off; every Phase 172 caller still passes untouched.
- Both new modules measure 100% line coverage; the CI mypy line passes (`Success: no issues found in 128 source files`, baseline 127 plus the new services module).

## Task 1 RED reason (before any implementation)

The appended test `test_a_chain_break_is_named_by_arm_and_currency_and_the_refusal_stands` failed with `assert 1 == 2` on `venue.balance_calls`: the refusal and the oracle's token already held, but no post-walk balance read existed and the record carried no `chain_*` keys. (The assertion was later moved after the chain keys so a neutered `walked` shows as `assert 'failed' == 'run'` on `chain_diagnostic`, see N10.)

## Mutations (neuter, see RED, restore from a byte backup, confirm with cmp, GREEN)

- mutation N10: RED tests/test_allocator_history_probe.py::test_a_chain_break_is_named_by_arm_and_currency_and_the_refusal_stands (`assert 'failed' == 'run'`, `walked=tuple(bills)` removed from the except arm); restored (cmp identical); GREEN
- mutation N3: RED tests/test_okx_bills_chain.py::test_a_close_that_only_fails_against_the_pre_walk_cash_counts_in_matches_after (also the e2e test); restored (cmp identical); GREEN
- mutation N7: RED tests/test_okx_bills_chain.py::test_the_diagnostic_module_is_get_only_and_writes_nothing (a string constant naming a POST implicit method added to the module); restored (cmp identical); GREEN
- mutation N8: RED tests/test_okx_chain_record.py::test_every_declared_key_refuses_a_value_outside_its_vocabulary (`chain_worst_ccy` validator accepts any string); restored (cmp identical); GREEN
- mutation N1: RED tests/test_okx_bills_chain.py::test_the_arm_and_counts_are_read_over_every_currency[interior-only] (and four more arm worlds; `_arm` returns "none"); restored (cmp identical); GREEN
- mutation N2: RED tests/test_okx_bills_chain.py::test_the_arm_and_counts_are_read_over_every_currency[both-on-two-currencies] (also the worst-currency and signature-sum tests; loop stops after the first broken currency); restored (cmp identical); GREEN
- mutation N5: RED tests/test_okx_chain_record.py::test_the_residual_bucket_edges_are_exact[rel1-lt_1e-12] (and four more edge cases; every edge shifted one decade); restored (cmp identical); GREEN

## Task Commits

1. **Task 1: end-to-end tracer** - `25fe230c3` (feat)
2. **Task 2: harden the slice, Wave 0 fakes** - `710e449f9` (test)
3. **Task 3: kinds, modes, residual size and signature** - `eea9314df` (feat)

**Plan metadata:** the commit that adds this file (docs).

## Files Created/Modified

- `analytics-service/services/okx_bills_chain.py` - GET-only budget, pure `analyse_chain`, close race
- `analytics-service/scripts/okx_chain_record.py` - record keys, validators, defaults, token grammars, `measure_chain`
- `analytics-service/services/okx_opening_balance.py` - `OkxOpeningReading.walked` filled on both return arms; `_parse_bill` keeps `subType`, `mgnMode`, `posBalChg` (9 added lines, none removed)
- `analytics-service/scripts/allocator_history_probe.py` - one import, three tail splices, docstring item 6, the chain block at the end of `_measure_anchor` (12 added lines, none removed)
- `analytics-service/tests/_okx_bills.py` - Wave 0 fakes
- `analytics-service/tests/test_okx_bills_chain.py`, `tests/test_okx_chain_record.py` - new
- `analytics-service/tests/test_allocator_history_probe.py` - one section appended at the end (byte-prefix of the merge-base file)

## Decisions Made

- `chain_diagnostic` is `run` when the analysis ran and only the post-walk read failed (the plan said "the analysis keys stay"; 179-02's full e2e also expects `run`). `failed` is for an analysis that measured nothing: empty `walked`, or a malformed balance row.
- The close-race `cash_moved` counts only currencies the walk saw, so a currency whose cash moved but which has no bill cannot inflate it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug in the plan's design] Residual signature `reorder` replaces `swapped_pair`**
- **Found during:** Task 3 (the plan itself orders this change)
- **Issue:** 179-RESEARCH's `swapped_pair` (two adjacent breaks whose residuals sum to zero) does not describe a real swap. Swapping two adjacent bills A (+a) and B (+b) between X and Y makes three consecutive breaks, `a`, `-a-b`, `b`, which sum to zero; two adjacent breaks never cancel for a genuine swap.
- **Fix:** a run of two or more consecutive breaks whose residuals sum to exactly zero counts every break in the run as `sig_reorder`; the key is `chain_sig_reorder`. A world built with `okx_bills_updated_in_order` (ids 1,3,2,4 against update order) yields exactly three reorder breaks.
- **Files modified:** services/okx_bills_chain.py, scripts/okx_chain_record.py, tests
- **Commit:** `eea9314df`

**2. [Rule 3 - Blocking] The record module avoids `dict.update`**
- **Found during:** Task 2 (writing the static write pin for the record module)
- **Issue:** `measure_chain` used `out.update(...)`, and the same `.update(` substring pin the oracle and probe use would have to be loosened for this module.
- **Fix:** merge with dict spreads. The probe's own `out = {**out, **...}` idiom.
- **Files modified:** scripts/okx_chain_record.py
- **Commit:** `710e449f9`

**Total deviations:** 2 auto-fixed (1 design correction ordered by the plan, 1 blocking). **Impact:** none on the verdict or on any record key outside this plan.

## Notes on the TDD sequence (fail loud)

- Task 1 and Task 3 were RED before implementation. Task 2's behaviours (budget, redaction, failure by class, close race, walked on both arms) were already implemented by the tracer, so those tests passed on first run; they were proven able to fail by mutations N3, N7 and N8 and by N10 on the tracer. The Wave 0 fakes did not exist before Task 2.
- A test in Task 3 (`test_two_adjacent_breaks_that_do_not_sum_to_zero_are_not_a_reorder`) failed first because my hand-derived world had a residual equal to its bill's own change (a double count). The expectation in the test was wrong, not the code; the world was changed to residuals 9 and 4 (neither equals its change), and the module was not touched.
- The first run of mutations N3, N7 and N8 was invalid (zsh does not word-split an unquoted variable, so pytest got one bad argument and nothing ran). All three files were restored by cmp, then the three mutations were redone with explicit arguments; the lines above are from the valid run.

## Issues Encountered

- The full analytics suite was not run serially: `pytest-xdist` is not installed locally (CI runs `-n auto --dist loadgroup`), and a serial run reached about 1% in several minutes, so it was stopped (my own processes only). In its place, every test file that mentions a changed module (51 files) ran: `2207 passed, 6 skipped`. The 6 skips are pre-existing and none is in a file this plan touched. CI remains the owner of the full-suite and `--cov-fail-under=80` gate.
- No PROD, TEST or Railway access, no SQL, no `--linked`; nothing outside `files_modified` changed except this file. STATE.md and ROADMAP.md untouched.

## Known Stubs

None.

## Threat Flags

None. The only new venue surface is one extra `GET /api/v5/account/balance` through the counted GET-only wrapper, already covered by T-179-03 and T-179-04.

## Next Phase Readiness

Plan 179-02 can append its groups to `measure_chain` (it already takes `opening_day`) and to `CHAIN_KEYS`, extend the appended e2e inside the Phase 179 section only, and reuse every Wave 0 fake. The e2e values it expects for plan 01's keys match what this plan measures on the shared world (`chain_break_kinds` `2.x.SPOT:1`, `chain_residual_bucket` `lt_1e-3`, `chain_close_residual_bucket` `ge_1e-1`, `chain_sig_other` 1), derived by hand in `test_the_new_keys_are_measured_values_on_the_seeded_break`.

## Self-Check: PASSED

- Created files exist: okx_bills_chain.py, okx_chain_record.py, test_okx_bills_chain.py, test_okx_chain_record.py (all FOUND).
- Commits `25fe230c3`, `710e449f9`, `eea9314df` are ancestors of HEAD.
- TRACER_GATES_OK conditions re-verified at the end: the oracle and probe diff against the merge base removes no line; the probe test file at the merge base is a byte prefix of the file now; `test_okx_opening_balance.py` and `test_okx_anchor_rule.py` are byte-identical to the merge base.
- `python3 -c 'import scripts.okx_chain_record as r; print(len(r.CHAIN_KEYS))'` prints 24.
