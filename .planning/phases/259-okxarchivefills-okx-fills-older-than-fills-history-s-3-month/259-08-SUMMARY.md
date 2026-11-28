---
phase: 259-okxarchivefills-okx-fills-older-than-fills-history-s-3-month
plan: 08
subsystem: analytics-service / OKX archive fills (PROOF-01 proof and phase gate)
tags: [okx, archive, fills, neuter, proof-01, mypy, phase-gate]

requires:
  - phase: 259-01
    provides: "`_normalize_okx_fill` and its golden"
  - phase: 259-02
    provides: "the archive parser's trade cells"
  - phase: 259-03
    provides: "the chain and the job_worker seam"
  - phase: 259-04
    provides: "the mapper and the reconcile"
  - phase: 259-05
    provides: "the fills read path"
  - phase: 259-06
    provides: "the GET-first wait and the persisted apply count"
  - phase: 259-07
    provides: "the write, the legacy gate and the all-or-nothing order"
provides:
  - "SC-6 / PROOF-01: neuters N1 to N33, each with a RED on its named arm, a byte-identical restore and a GREEN, recorded verbatim below"
  - "the phase gate: `make typecheck` clean, `make test` at 95.08 percent coverage with 18 failures that are identical on the phase base, the scope checks and the anchor gate"
  - "the ship hand-over, including the CHANGELOG known-limits note for `259-ARCHIVE-QUARTER-CAP`"
affects: [259-09]

status: complete
commits: 0
plan_head_before: a94d7b7a3
plan_head_after: a94d7b7a3

actuals:
  tokens: 0         # chars/4 over the realized diff: this plan changes no tracked source or test (every neuter was restored byte-identically); the only artifact is this SUMMARY
  tasks: 3
  commits: 0        # MEASURED before this docs commit: git rev-list --count a94d7b7a3..HEAD printed 0; the SUMMARY commit that follows is docs-only

tech-stack:
  added: []
  patterns:
    - "neuter on a byte backup, `cp` restore, `cmp` proof, one neuter at a time, RED matched against the collected node id"

key-files:
  created: []
  modified: []

key-decisions:
  - "The harness lives only in the session scratchpad (`neuter.py`, `proof.sh`, `gen.py`, `proof-output.txt`); nothing of it is tracked. Its contract is the plan's: a RED counts only when a `FAILED <exact node id>` line exists (matched whole-line or followed by ` - `, so a prefix id cannot satisfy it), the restore is `cp` from a backup proven equal to `git show HEAD:<file>`, and a GREEN needs exit 0 with no FAILED line."
  - "No test needed strengthening: every named arm went RED on its neuter for the rule's own reason, so there is no `test(259-08)` commit."

requirements-completed: [SC-6, SC-1, SC-2, SC-3, SC-4]
---

# Phase 259 Plan 08: PROOF-01 neuters N1-N33 and the phase gate Summary

Every Phase 259 gate was shown to fail: 33 neuters of the fixed code, each turning its named arm RED with that arm's own assertion, each restored byte-identically with `cp` and `cmp`, each turning GREEN afterwards. The phase gate (mypy strict, the full analytics suite with the 80 percent floor, the scope checks, the anchor gate) is green except 18 `quantstats`-pin failures that fail identically on the phase base.

## Result

- 33 of 33 neuters: `RED_OK` on every named node id (43 `RED_OK` lines), `restore cmp exit=0` 33 times, `GREEN_OK` 33 times, 0 `_MISSING` lines.
- After the proof, `git status --porcelain -- analytics-service` printed nothing and each of the six neutered files is `cmp`-equal to its committed content (`cmp` against the `.post` backup, which was itself checked against `git show HEAD:<file>` before every neuter).
- No `git checkout`, `git restore` or `git stash` was used. No tracked file was changed by this plan.

## Findings about the proof (not defects)

1. **Every RED is the arm's own assertion, never an import or fixture error.** A grep over all 33 RED logs for `ImportError`, `ModuleNotFound`, `fixture '`, `SyntaxError` and `NameError` printed nothing. The kinds of `E   ` line are: a whole-row equality diff (N1, N2, N11), the expected `FillsMapError` not raised (`DID NOT RAISE`: N4 to N9, N33), a named-field or class equality (N3, N10, N32), an outcome equality (`DONE` where `FAILED` was expected: N16, N21, N22, N27, N28, N30), a call or sleep count (N12, N13, N20, N25, N29), a write recorded where none is allowed (N14, N15, N23), a literal absent from the source (N14, N27), a value that leaked into a progress write or log (N24, N31), the retained tradeId lost (N26), a gate that let a call through (N19), and the injected `RuntimeError` escaping the seam (N17).
2. **N10 turned RED on the field `count`, not on `absent_in_stored`.** The neuter drops `miss("absent_in_stored")`; the reconcile's own `count` miss (archive length differs from stored length) is raised instead, so `test_reconcile_absent_in_stored` fails on `assert 'count' == 'absent_in_stored'`. That is the arm's named-field assertion firing, so the gate is proven (the plan 04 neuter also dropped `count`; with `count` kept, the named field is what the arm pins). Recorded rather than fixed: the arm cannot be satisfied by a reconcile that reports the miss under any other field.
3. **N17's RED line is `RuntimeError: chain read down`**: with the handler narrowed to `ValueError`, the chain's injected failure propagates out of `run_sync_trades_job`, which is exactly what the isolation arm forbids.
4. **Fixed neuter sites differ from the plan's wording only where the plan named the wrong function.** `_check_account` (N22) and the bal-chain call (N16) live in `_read_and_gate`, the legacy gate (N30) and the write-set key (N31) in `_evaluate_targets`, and the `fills_apply` guard around `_write_fills` (N15) in `run_okx_archive_fills_job`; the plan said "handler" for all of them. The neuters hit the named rule at its real site.
5. **N23** writes for every `read` target after each target's evaluation inside the per-target loop of `_evaluate_targets` (the handler's single write still follows). The arm sees upserts that precede a later target's reconcile miss and fails.
6. **N29** and **N12** use the pacer the real branches use (`pacer.apply(key_row, year, label)`), so the fake exchange counts real POSTs (`calls_of('private_post_account_bills_history_archive')` 6 where 3 are allowed; 2 where 0 are allowed).

## PROOF-01 output, verbatim (`proof-output.txt`, blank and elided diff filler lines removed)

Each block: the neuter header, `neutered occurrences=1`, one `RED_OK` per node id, the `E   ` and `FAILED` lines of the neutered run, `restore cmp exit=0`, `GREEN_OK`.

```
=== N1 analytics-service/services/exchange.py ===
neutered occurrences=1
RED_OK N1 tests/test_okx_normalize_fill_golden.py::TestLiveOkxFillsGolden::test_emitting_arm_is_the_literal_row[eth_linear_net]
RED_OK N1 tests/test_okx_normalize_fill_golden.py::TestNormalizeOkxFillDirect::test_helper_returns_the_golden_row_or_none[eth_linear_net]
RED_OK N1 tests/test_okx_archive_fills_map.py::test_map_one_fixture_bill_equals_expected_row
--- N1 E lines (pytest rc=1) ---
E       AssertionError: assert [{'exchange':...3000.5', ...}] == [{'exchange':...3000.5', ...}]
E         At index 0 diff: {'exchange': 'okx', 'symbol': 'ETHUSDTSWAP', 'side': 'buy', 'price': '3000.5', 'quantity': '3', 'fee': '-0.45', 'fee_currency': 'USDT', 'timestamp': '2026-07-01T12:00:00.123
E       AssertionError: assert {'exchange': ...'3000.5', ...} == {'exchange': ...'3000.5', ...}
E         Differing items:
E         {'quantity': '3'} != {'quantity': '0.3'}
E         {'cost': '9001.5'} != {'cost': '900.15'}
E       AssertionError: assert {'exchange': ...3150.75', ...} == {'exchange': ...3150.75', ...}
E         Differing items:
E         {'quantity': '6'} != {'quantity': '0.6'}
E         {'cost': '18904.50'} != {'cost': '1890.450'}
FAILED tests/test_okx_normalize_fill_golden.py::TestLiveOkxFillsGolden::test_emitting_arm_is_the_literal_row[eth_linear_net]
FAILED tests/test_okx_normalize_fill_golden.py::TestNormalizeOkxFillDirect::test_helper_returns_the_golden_row_or_none[eth_linear_net]
FAILED tests/test_okx_archive_fills_map.py::test_map_one_fixture_bill_equals_expected_row
restore cmp exit=0
GREEN_OK N1
=== N2 analytics-service/services/exchange.py ===
neutered occurrences=1
RED_OK N2 tests/test_okx_normalize_fill_golden.py::TestLiveOkxFillsGolden::test_emitting_arm_is_the_literal_row[eth_linear_net]
RED_OK N2 tests/test_okx_normalize_fill_golden.py::TestNormalizeOkxFillDirect::test_helper_returns_the_golden_row_or_none[eth_linear_net]
--- N2 E lines (pytest rc=1) ---
E       AssertionError: assert [{'exchange':...3000.5', ...}] == [{'exchange':...3000.5', ...}]
E         At index 0 diff: {'exchange': 'okx', 'symbol': 'ETHUSDTSWAP', 'side': 'buy', 'price': '3000.5', 'quantity': '0.3', 'fee': '-0.45', 'fee_currency': 'USDT', 'timestamp': '2026-07-01T12:00:00.1
E       AssertionError: assert {'exchange': ...'3000.5', ...} == {'exchange': ...'3000.5', ...}
E         Differing items:
E         {'timestamp': '2026-07-01T12:00:00.122000+00:00'} != {'timestamp': '2026-07-01T12:00:00.123000+00:00'}
FAILED tests/test_okx_normalize_fill_golden.py::TestLiveOkxFillsGolden::test_emitting_arm_is_the_literal_row[eth_linear_net]
FAILED tests/test_okx_normalize_fill_golden.py::TestNormalizeOkxFillDirect::test_helper_returns_the_golden_row_or_none[eth_linear_net]
restore cmp exit=0
GREEN_OK N2
=== N3 analytics-service/services/okx_archive_fills_map.py ===
neutered occurrences=1
RED_OK N3 tests/test_okx_archive_fills_map.py::test_map_subtype_sides[5]
--- N3 E lines (pytest rc=1) ---
E       AssertionError: assert 'buy' == 'sell'
E         - sell
E         + buy
FAILED tests/test_okx_archive_fills_map.py::test_map_subtype_sides[5] - Asser...
restore cmp exit=0
GREEN_OK N3
=== N4 analytics-service/services/okx_archive_fills_map.py ===
neutered occurrences=1
RED_OK N4 tests/test_okx_archive_fills_map.py::test_refuse_unknown_contract_size
--- N4 E lines (pytest rc=1) ---
E       Failed: DID NOT RAISE FillsMapError
FAILED tests/test_okx_archive_fills_map.py::test_refuse_unknown_contract_size
restore cmp exit=0
GREEN_OK N4
=== N5 analytics-service/services/okx_archive_fills_map.py ===
neutered occurrences=1
RED_OK N5 tests/test_okx_archive_fills_map.py::test_refuse_unproven_inst_type[SPOT]
--- N5 E lines (pytest rc=1) ---
E       Failed: DID NOT RAISE FillsMapError
FAILED tests/test_okx_archive_fills_map.py::test_refuse_unproven_inst_type[SPOT]
restore cmp exit=0
GREEN_OK N5
=== N6 analytics-service/services/okx_archive_fills_map.py ===
neutered occurrences=1
RED_OK N6 tests/test_okx_archive_fills_map.py::test_refuse_unmapped_trade_subtype
--- N6 E lines (pytest rc=1) ---
E       Failed: DID NOT RAISE FillsMapError
FAILED tests/test_okx_archive_fills_map.py::test_refuse_unmapped_trade_subtype
restore cmp exit=0
GREEN_OK N6
=== N7 analytics-service/services/okx_archive_fills_map.py ===
neutered occurrences=1
RED_OK N7 tests/test_okx_archive_fills_map.py::test_refuse_duplicate_trade_id
--- N7 E lines (pytest rc=1) ---
E       Failed: DID NOT RAISE FillsMapError
FAILED tests/test_okx_archive_fills_map.py::test_refuse_duplicate_trade_id - ...
restore cmp exit=0
GREEN_OK N7
=== N8 analytics-service/services/okx_archive_fills_map.py ===
neutered occurrences=1
RED_OK N8 tests/test_okx_archive_fills_map.py::test_reconcile_miss_quantity
--- N8 E lines (pytest rc=1) ---
E       Failed: DID NOT RAISE FillsMapError
FAILED tests/test_okx_archive_fills_map.py::test_reconcile_miss_quantity - Fa...
restore cmp exit=0
GREEN_OK N8
=== N9 analytics-service/services/okx_archive_fills_map.py ===
neutered occurrences=1
RED_OK N9 tests/test_okx_archive_fills_map.py::test_reconcile_miss_fee
--- N9 E lines (pytest rc=1) ---
E       Failed: DID NOT RAISE FillsMapError
FAILED tests/test_okx_archive_fills_map.py::test_reconcile_miss_fee - Failed:...
restore cmp exit=0
GREEN_OK N9
=== N10 analytics-service/services/okx_archive_fills_map.py ===
neutered occurrences=1
RED_OK N10 tests/test_okx_archive_fills_map.py::test_reconcile_absent_in_stored
--- N10 E lines (pytest rc=1) ---
E       AssertionError: assert 'count' == 'absent_in_stored'
E         - absent_in_stored
E         + count
FAILED tests/test_okx_archive_fills_map.py::test_reconcile_absent_in_stored
restore cmp exit=0
GREEN_OK N10
=== N11 analytics-service/services/okx_archive_fills_map.py ===
neutered occurrences=1
RED_OK N11 tests/test_okx_archive_fills_map.py::test_reconcile_equal_by_value
RED_OK N11 tests/test_okx_archive_fills_map.py::test_map_one_fixture_bill_equals_expected_row
--- N11 E lines (pytest rc=1) ---
E               services.okx_archive_fills_map.FillsMapError: fills_reconcile_miss
E       AssertionError: assert {'exchange': ...3150.75', ...} == {'exchange': ...3150.75', ...}
E         Differing items:
E         {'timestamp': '2026-09-03T08:00:00.122000+00:00'} != {'timestamp': '2026-09-03T08:00:00.123000+00:00'}
FAILED tests/test_okx_archive_fills_map.py::test_reconcile_equal_by_value - s...
FAILED tests/test_okx_archive_fills_map.py::test_map_one_fixture_bill_equals_expected_row
restore cmp exit=0
GREEN_OK N11
=== N12 analytics-service/services/okx_archive_fills.py ===
neutered occurrences=1
RED_OK N12 tests/test_okx_archive_fills_job.py::TestApplyBudget::test_apply_budget_zero_applies_when_finished
--- N12 E lines (pytest rc=1) ---
E       AssertionError: assert 2 == 0
E        +  where 2 = calls_of('private_post_account_bills_history_archive')
E        +    where calls_of = <tests._okx_archive_fills_fakes.World object at 0x119ebd400>.calls_of
FAILED tests/test_okx_archive_fills_job.py::TestApplyBudget::test_apply_budget_zero_applies_when_finished
restore cmp exit=0
GREEN_OK N12
=== N13 analytics-service/services/okx_archive_fills.py ===
neutered occurrences=1
RED_OK N13 tests/test_okx_archive_fills_job.py::TestApplyBudget::test_apply_budget_no_entry_persists_never_reapplies
--- N13 E lines (pytest rc=1) ---
E       AssertionError: applied once over every claim
E       assert 6 == 1
E        +  where 6 = calls_of('private_post_account_bills_history_archive')
E        +    where calls_of = <tests._okx_archive_fills_fakes.World object at 0x11ab2a2a0>.calls_of
FAILED tests/test_okx_archive_fills_job.py::TestApplyBudget::test_apply_budget_no_entry_persists_never_reapplies
restore cmp exit=0
GREEN_OK N13
=== N14 analytics-service/services/okx_archive_fills.py ===
neutered occurrences=1
RED_OK N14 tests/test_okx_archive_fills_apply.py::TestBindings::test_write_literals_bind_the_live_upsert
RED_OK N14 tests/test_okx_archive_fills_apply.py::TestWrite::test_apply_second_run_inserts_nothing
--- N14 E lines (pytest rc=1) ---
E           AssertionError: _write_fills drifted from the live write: ignore_duplicates=True
E           assert 'ignore_duplicates=True' in 'async def _write_fills(\n    supabase: Any,\n    prepared: _Prepared,\n    mapped: Sequence[MappedFill],\n    result:... inserted = None\n              
E       assert [5, 5] == [0, 0]
E         At index 0 diff: 5 != 0
FAILED tests/test_okx_archive_fills_apply.py::TestBindings::test_write_literals_bind_the_live_upsert
FAILED tests/test_okx_archive_fills_apply.py::TestWrite::test_apply_second_run_inserts_nothing
restore cmp exit=0
GREEN_OK N14
=== N15 analytics-service/services/okx_archive_fills.py ===
neutered occurrences=1
RED_OK N15 tests/test_okx_archive_fills_apply.py::TestWrite::test_calibrate_never_writes
--- N15 E lines (pytest rc=1) ---
E       AssertionError: assert [{'table': 't...': True, ...}] == []
E         Left contains 2 more items, first extra item: {'table': 'trades', 'rows': [{'strategy_id': '33333333-3333-4333-8333-333333333333', 'exchange': 'okx', 'symbol': 'ETH...DTSWAP', 'side': 'sell'
FAILED tests/test_okx_archive_fills_apply.py::TestWrite::test_calibrate_never_writes
restore cmp exit=0
GREEN_OK N15
=== N16 analytics-service/services/okx_archive_fills.py ===
neutered occurrences=1
RED_OK N16 tests/test_okx_archive_fills_apply.py::TestAllOrNothing::test_bal_chain_break_writes_nothing
--- N16 E lines (pytest rc=1) ---
E       AssertionError: assert <DispatchOutcome.DONE: 'done'> == <DispatchOutc...LED: 'failed'>
E         - failed
E         + done
FAILED tests/test_okx_archive_fills_apply.py::TestAllOrNothing::test_bal_chain_break_writes_nothing
restore cmp exit=0
GREEN_OK N16
=== N17 analytics-service/services/job_worker.py ===
neutered occurrences=1
RED_OK N17 tests/test_okx_archive_fills_chain.py::TestSeamIsolation::test_chain_exception_leaves_outcome_done
--- N17 E lines (pytest rc=1) ---
E               RuntimeError: chain read down
FAILED tests/test_okx_archive_fills_chain.py::TestSeamIsolation::test_chain_exception_leaves_outcome_done
restore cmp exit=0
GREEN_OK N17
=== N18 analytics-service/services/okx_archive_fills_chain.py ===
neutered occurrences=1
RED_OK N18 tests/test_okx_archive_fills_chain.py::TestCooldown::test_cooldown_ignores_calibrate
--- N18 E lines (pytest rc=1) ---
E       AssertionError: assert 'cooldown' == 'enqueued'
E         - enqueued
E         + cooldown
FAILED tests/test_okx_archive_fills_chain.py::TestCooldown::test_cooldown_ignores_calibrate
restore cmp exit=0
GREEN_OK N18
=== N19 analytics-service/services/job_worker.py ===
neutered occurrences=1
RED_OK N19 tests/test_okx_archive_fills_chain.py::TestSeamGating::test_seam_skips_failed_fills_read
--- N19 E lines (pytest rc=1) ---
E           AssertionError: Expected mock to not have been awaited. Awaited 1 times.
E       AssertionError: Expected mock to not have been awaited. Awaited 1 times.
E       pytest introspection follows:
E       Args:
E       assert (<tests.test_...at-259-chain') == ()
E         Left contains 3 more items, first extra item: <tests.test_okx_archive_fills_chain._FakeSupabase object at 0x11da6cb30>
FAILED tests/test_okx_archive_fills_chain.py::TestSeamGating::test_seam_skips_failed_fills_read
restore cmp exit=0
GREEN_OK N19
=== N20 analytics-service/services/job_worker.py ===
neutered occurrences=1
RED_OK N20 tests/test_okx_archive_fills_chain.py::TestTracer::test_chain_after_follow_on_enqueue
--- N20 E lines (pytest rc=1) ---
E       AssertionError: assert 2 == 1
E        +  where 2 = <built-in method count of list object at 0x11a3f0e40>('okx_archive_rebuild')
E        +    where <built-in method count of list object at 0x11a3f0e40> = ['okx_archive_rebuild', 'derive_broker_dailies', 'okx_archive_rebuild'].count
FAILED tests/test_okx_archive_fills_chain.py::TestTracer::test_chain_after_follow_on_enqueue
restore cmp exit=0
GREEN_OK N20
=== N21 analytics-service/services/okx_archive_fills.py ===
neutered occurrences=1
RED_OK N21 tests/test_okx_archive_fills_job.py::TestTargets::test_targets_same_account_connected_only
--- N21 E lines (pytest rc=1) ---
E       AssertionError: assert <DispatchOutc...LED: 'failed'> == <DispatchOutcome.DONE: 'done'>
E         - done
E         + failed
FAILED tests/test_okx_archive_fills_job.py::TestTargets::test_targets_same_account_connected_only
restore cmp exit=0
GREEN_OK N21
=== N22 analytics-service/services/okx_archive_fills.py ===
neutered occurrences=1
RED_OK N22 tests/test_okx_archive_fills_job.py::TestTargets::test_uid_mismatch_and_read_only[uid_mismatch]
RED_OK N22 tests/test_okx_archive_fills_job.py::TestTargets::test_uid_mismatch_and_read_only[not_read_only]
--- N22 E lines (pytest rc=1) ---
E       AssertionError: assert <DispatchOutcome.DONE: 'done'> == <DispatchOutc...LED: 'failed'>
E         - failed
E         + done
E       AssertionError: assert <DispatchOutcome.DONE: 'done'> == <DispatchOutc...LED: 'failed'>
E         - failed
E         + done
FAILED tests/test_okx_archive_fills_job.py::TestTargets::test_uid_mismatch_and_read_only[uid_mismatch]
FAILED tests/test_okx_archive_fills_job.py::TestTargets::test_uid_mismatch_and_read_only[not_read_only]
restore cmp exit=0
GREEN_OK N22
=== N23 analytics-service/services/okx_archive_fills.py ===
neutered occurrences=1
RED_OK N23 tests/test_okx_archive_fills_apply.py::TestAllOrNothing::test_reconcile_miss_on_one_target_writes_nothing_for_any
--- N23 E lines (pytest rc=1) ---
E       AssertionError: assert [{'table': 't...': True, ...}] == []
E         Left contains 4 more items, first extra item: {'table': 'trades', 'rows': [{'strategy_id': '33333333-3333-4333-8333-333333333333', 'exchange': 'okx', 'symbol': 'ETH...DTSWAP', 'side': 'sell'
FAILED tests/test_okx_archive_fills_apply.py::TestAllOrNothing::test_reconcile_miss_on_one_target_writes_nothing_for_any
restore cmp exit=0
GREEN_OK N23
=== N24 analytics-service/services/okx_archive_fills.py ===
neutered occurrences=1
RED_OK N24 tests/test_okx_archive_fills_job.py::TestWaitEdges::test_no_link_ts_or_amount_leaks
--- N24 E lines (pytest rc=1) ---
E           AssertionError: 'SECRET-PATH-3f9a' leaked into a progress write, defer or log
E           assert 'SECRET-PATH-3f9a' not in '[{"p_job_id...nt=None)None'
E             'SECRET-PATH-3f9a' is contained here:
E               e.test/dl/SECRET-PATH-3f9a/2026Q2.zip?sig=SECRET-QUERY-77c1
E             ?           ++++++++++++++++
E               INFO     services.okx_archive_job:okx_archive_job.py:977 okx_archive_rebuild: 2026-Q2 finished, link scheme=https host=archive.example.test
E               INFO     services.okx_archive_fills:okx_archive_fills.py:514 okx_archive_rebuild: status href=https://archive.example.test/dl/SECRET-PATH-3f9a/2026Q3.zip?sig=SECRET-QUERY-77c1
E               INFO     services.okx_archive_job:okx_archive_job.py:977 okx_archive_rebuild: 2026-Q3 finished, link scheme=https host=archive.example.test...
FAILED tests/test_okx_archive_fills_job.py::TestWaitEdges::test_no_link_ts_or_amount_leaks
restore cmp exit=0
GREEN_OK N24
=== N25 analytics-service/services/okx_archive_fills.py ===
neutered occurrences=1
RED_OK N25 tests/test_okx_archive_fills_job.py::TestWaitEdges::test_wait_never_sleeps_in_claim
--- N25 E lines (pytest rc=1) ---
E       AssertionError: the pacing sleeps once between two applies, not before the first
E       assert 5 == 2
E        +  where 5 = len([10.998028582995175, 10.999659833003534, 7200.0, 900, 900])
FAILED tests/test_okx_archive_fills_job.py::TestWaitEdges::test_wait_never_sleeps_in_claim
restore cmp exit=0
GREEN_OK N25
=== N26 analytics-service/services/okx_archive_files.py ===
neutered occurrences=1
RED_OK N26 tests/test_okx_archive_fills_parse.py::test_trade_bill_keeps_every_trade_cell
--- N26 E lines (pytest rc=1) ---
E       AssertionError: assert '' == '880000005'
E         - 880000005
FAILED tests/test_okx_archive_fills_parse.py::test_trade_bill_keeps_every_trade_cell
restore cmp exit=0
GREEN_OK N26
=== N27 analytics-service/services/okx_archive_fills.py ===
neutered occurrences=1
RED_OK N27 tests/test_okx_archive_fills_apply.py::TestWriteFailures::test_batch_failure_is_named_and_counted
RED_OK N27 tests/test_okx_archive_fills_apply.py::TestBindings::test_write_literals_bind_the_live_upsert
--- N27 E lines (pytest rc=1) ---
E       AssertionError: assert <DispatchOutcome.DONE: 'done'> == <DispatchOutc...LED: 'failed'>
E         - failed
E         + done
E           AssertionError: _write_fills drifted from the live write: , 100)
E           assert ', 100)' in 'async def _write_fills(\n    supabase: Any,\n    prepared: _Prepared,\n    mapped: Sequence[MappedFill],\n    result:... inserted = None\n                info["inserted
FAILED tests/test_okx_archive_fills_apply.py::TestWriteFailures::test_batch_failure_is_named_and_counted
FAILED tests/test_okx_archive_fills_apply.py::TestBindings::test_write_literals_bind_the_live_upsert
restore cmp exit=0
GREEN_OK N27
=== N28 analytics-service/services/okx_archive_fills.py ===
neutered occurrences=1
RED_OK N28 tests/test_okx_archive_fills_apply.py::TestWriteFailures::test_batch_failure_is_named_and_counted
--- N28 E lines (pytest rc=1) ---
E       AssertionError: assert <DispatchOutcome.DONE: 'done'> == <DispatchOutc...LED: 'failed'>
E         - failed
E         + done
ERROR    services.okx_archive_fills:okx_archive_fills.py:1155 okx_archive_rebuild: a fills write batch failed (RuntimeError)
FAILED tests/test_okx_archive_fills_apply.py::TestWriteFailures::test_batch_failure_is_named_and_counted
restore cmp exit=0
GREEN_OK N28
=== N29 analytics-service/services/okx_archive_fills.py ===
neutered occurrences=1
RED_OK N29 tests/test_okx_archive_fills_job.py::TestApplyBudget::test_apply_budget_three_quarters_six_claims
RED_OK N29 tests/test_okx_archive_fills_job.py::TestApplyBudget::test_apply_budget_zero_applies_when_ongoing[ongoing]
--- N29 E lines (pytest rc=1) ---
E       AssertionError: assert 6 == 3
E        +  where 6 = calls_of('private_post_account_bills_history_archive')
E        +    where calls_of = <tests._okx_archive_fills_fakes.World object at 0x11a7ae390>.calls_of
E       AssertionError: assert 2 == 0
E        +  where 2 = calls_of('private_post_account_bills_history_archive')
E        +    where calls_of = <tests._okx_archive_fills_fakes.World object at 0x11a783710>.calls_of
FAILED tests/test_okx_archive_fills_job.py::TestApplyBudget::test_apply_budget_three_quarters_six_claims
FAILED tests/test_okx_archive_fills_job.py::TestApplyBudget::test_apply_budget_zero_applies_when_ongoing[ongoing]
restore cmp exit=0
GREEN_OK N29
=== N30 analytics-service/services/okx_archive_fills.py ===
neutered occurrences=1
RED_OK N30 tests/test_okx_archive_fills_apply.py::TestAllOrNothing::test_apply_stops_on_legacy_mismatch[unequal]
RED_OK N30 tests/test_okx_archive_fills_apply.py::TestAllOrNothing::test_apply_stops_on_legacy_mismatch[absent_in_archive]
--- N30 E lines (pytest rc=1) ---
E       AssertionError: assert <DispatchOutcome.DONE: 'done'> == <DispatchOutc...LED: 'failed'>
E         - failed
E         + done
E       AssertionError: assert <DispatchOutcome.DONE: 'done'> == <DispatchOutc...LED: 'failed'>
E         - failed
E         + done
FAILED tests/test_okx_archive_fills_apply.py::TestAllOrNothing::test_apply_stops_on_legacy_mismatch[unequal]
FAILED tests/test_okx_archive_fills_apply.py::TestAllOrNothing::test_apply_stops_on_legacy_mismatch[absent_in_archive]
restore cmp exit=0
GREEN_OK N30
=== N31 analytics-service/services/okx_archive_fills.py ===
neutered occurrences=1
RED_OK N31 tests/test_okx_archive_fills_job.py::TestWaitEdges::test_no_link_ts_or_amount_leaks
--- N31 E lines (pytest rc=1) ---
E           AssertionError: '880000002' leaked into a progress write, defer or log
E           assert '880000002' not in '[{"p_job_id...nt=None)None'
E             '880000002' is contained here:
E               _trade": "880000002"}], "fingerprint": null}}]
E             ?           +++++++++
E               [{"p_job_id": "job-1", "p_defer_seconds": 3600, "p_reason": "okx_archive_rebuild: waiting fills quarters_ready=0/2", "p_claim_token": "tok-1"}, {"p_job_id": "job-1", "p_defer_seconds":
E               INFO     services.okx_archive_fills:okx_archive_fills.py:626 okx_archive_rebuild: 2026-Q2 apply existing=False ts_age_h=0
E               INFO     services.okx_archive_fills:okx_archive_fills.py:626 okx_archive_rebuild: 2026-Q3 apply existing=False ts_age_h=0...
FAILED tests/test_okx_archive_fills_job.py::TestWaitEdges::test_no_link_ts_or_amount_leaks
restore cmp exit=0
GREEN_OK N31
=== N32 analytics-service/services/okx_archive_fills_map.py ===
neutered occurrences=1
RED_OK N32 tests/test_okx_archive_fills_map.py::test_refuse_unproven_inst_type[INVERSE_SWAP]
--- N32 E lines (pytest rc=1) ---
E       AssertionError: assert 'unknown_contract_size' == 'unproven_inst_type'
E         - unproven_inst_type
E         + unknown_contract_size
FAILED tests/test_okx_archive_fills_map.py::test_refuse_unproven_inst_type[INVERSE_SWAP]
restore cmp exit=0
GREEN_OK N32
=== N33 analytics-service/services/okx_archive_fills_map.py ===
neutered occurrences=1
RED_OK N33 tests/test_okx_archive_fills_map.py::test_refuse_unreadable_trade_bill[blank_trade_id]
RED_OK N33 tests/test_okx_archive_fills_map.py::test_refuse_unreadable_trade_bill[nondigit_trade_id]
--- N33 E lines (pytest rc=1) ---
E       Failed: DID NOT RAISE FillsMapError
E       Failed: DID NOT RAISE FillsMapError
FAILED tests/test_okx_archive_fills_map.py::test_refuse_unreadable_trade_bill[blank_trade_id]
FAILED tests/test_okx_archive_fills_map.py::test_refuse_unreadable_trade_bill[nondigit_trade_id]
restore cmp exit=0
GREEN_OK N33
```

## Phase gate

### `make typecheck` (CI mypy strict)

```
.venv/bin/mypy --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py
Success: no issues found in 149 source files
typecheck rc=0
```

### `make test` (the CI argument string, coverage floor 80)

Tail:

```
TOTAL                                       35262   1736    95%
Required test coverage of 80% reached. Total coverage: 95.08%
=== 18 failed, 17845 passed, 107 skipped, 934 warnings in 215.94s (0:03:35) ====
make: *** [test] Error 1
```

The 18 failures, all local-only and none in a Phase 259 module or a pinned suite: 17 in `tests/test_metrics.py` (`test_fig03_*`, `test_rank05_quantstats_pin_is_still_0_0_86`) and 1 in `tests/test_qstats_gate.py` (`test_fig03_cvar_honours_prepare_returns_false`). **Cause:** the venv on this machine has `quantstats 0.0.81` while `requirements.txt` and `requirements-dev.txt` pin `quantstats==0.0.86`; the pin test asserts `'0.0.81' == '0.0.86'` and the inline-mirror arms read the older numerics. **Evidence it is not this phase:** `git diff --stat <phase base> -- analytics-service/tests/test_metrics.py analytics-service/tests/test_qstats_gate.py analytics-service/services/metrics.py analytics-service/requirements.txt` is empty, and running `tests/test_metrics.py tests/test_qstats_gate.py` from a detached worktree at the phase base (`9f0fb9e6a`, same interpreter) gave `18 failed, 360 passed` with a failing-id list that `diff`s IDENTICAL to this run's 18 (the temporary worktree was removed afterwards). CI installs the pinned 0.0.86, so this is a local environment mismatch; nothing was installed or changed here.

The 18 ids (all `tests/`-relative): `test_metrics.py::test_fig03_live_greeks_and_r_squared_on_a_strategy_gap_pair`; `test_metrics.py::test_fig03_live_psr_matches_mirror[benign_all_positive]`; `test_metrics.py::test_fig03_live_psr_matches_mirror[benign_mixed]`; `test_metrics.py::test_fig03_live_psr_matches_mirror[golden_returns]`; `test_metrics.py::test_fig03_live_psr_matches_mirror[golden_returns_with_nan_days]`; `test_metrics.py::test_fig03_live_rolling_alpha_matches_the_mirror`; `test_metrics.py::test_fig03_live_sortino_matches_the_skipna_count`; `test_metrics.py::test_fig03_serenity_is_the_historical_tail_not_the_parametric_default`; `test_metrics.py::test_fig03_stored_cvar_keeps_the_repo_floor_index_rule`; `test_metrics.py::test_fig03_time_in_market_is_the_unrounded_observed_exposure[fig03_gappy]`; `test_metrics.py::test_fig03_win_rate_is_nan_invariant`; `test_metrics.py::test_q166_parity_every_mirror_matches_live_quantstats[common_sense_ratio-golden_returns_with_nan_days]`; `test_metrics.py::test_q166_parity_every_mirror_matches_live_quantstats[serenity_index-benign_all_positive]`; `test_metrics.py::test_q166_parity_every_mirror_matches_live_quantstats[serenity_index-benign_mixed]`; `test_metrics.py::test_q166_parity_every_mirror_matches_live_quantstats[serenity_index-golden_returns]`; `test_metrics.py::test_q166_parity_every_mirror_matches_live_quantstats[serenity_index-golden_returns_with_nan_days]`; `test_metrics.py::test_rank05_quantstats_pin_is_still_0_0_86`; `test_qstats_gate.py::test_fig03_cvar_honours_prepare_returns_false`. Each is a `quantstats`-numerics or `quantstats`-pin arm (the `fig03`, `q166` mirror and `rank05` pin families).

### Scope checks (against `git merge-base HEAD origin/main` = `9f0fb9e6a8aa3f733d3dc1cee81a9a8e96a912ef`)

- Hunk counts: `exchange.py` 2, `job_worker.py` 1, `okx_archive_job.py` 1 (as required).
- `git diff --quiet <base> --` over the seven pinned suites (`test_okx_archive_parse`, `_job`, `_apply`, `_rebuild`, `_reconcile`, `_download`, `test_main_worker`) and the two committed fixtures (`q2_like.csv`, `q3_like.csv`): exit 0, byte-identical.
- `node scripts/verify-plan-anchors.mjs <259-08-PLAN.md>`: OK, 2 claims. `node scripts/verify-plan-anchors.mjs --pending`: OK, 10 plan files, 35 claims, no stale claims.

## Deviations from Plan

None to the neuter set or the gate. Two notes on method:

- **[Process] The harness ran as a driver list in the background** (`run_list.sh`, one `proof.sh` call per neuter, stop on the first failure), because the shared machine ran each pytest start in 30 to 60 seconds. Behaviour is the contract's, unchanged.
- **[Environment] `make test` is not fully green locally** for the quantstats reason above. Recorded, not silently skipped.

## Ship hand-over

**After merge (plan 09 writes the runbook; the orchestrator runs the PROD read, SC-5).** `docs/runbooks/okxarchivefills-backfill.md` (plan 09) is the procedure: marker query first, record fills before per strategy ordinal, one `fills_calibrate` through the product's own path and the written go/no-go rule on its result (a non-zero `unequal`, `absent_in_archive` or `unreadable` in the legacy reading is a no-go and the chain would stop the same way with `fills_legacy_mismatch`), then the backfill by enqueueing `sync_trades` per affected strategy (the chain enqueues the `fills_apply` job; the runbook's fallback is a direct `fills_apply` enqueue when the chain does not fire), record fills after per strategy, name every unrecovered span, and prove a second `fills_apply` inserts nothing (SC-3 on PROD). Every PROD write is authorized by the founder's standing instruction; the marker query comes first.

**CHANGELOG known-limits note the ship must carry (known gap `259-ARCHIVE-QUARTER-CAP`):** a fills job reads at most 4 archive quarters, the newest kept; older needed quarters are listed in `info.over_cap_quarters` and are reached only by a manual `fills_apply` job with a `quarters` override (runbook section "Quarters beyond the cap"); the automatic chain re-reads the same newest four after each 14-day cooldown (no apply cost while OKX still holds the files, 30 days after the last apply; up to one apply POST per quarter after that) and never walks back; quarter-walking is not built.

This plan edits no TODOS.md, CHANGELOG.md, VERSION or package.json; the ship step owns them. `TODOS.md` entries this phase closes are deleted in the ship PR and named in the CHANGELOG entry (project rule).

## Known Stubs

None. This plan adds no code.

## Threat Flags

None. No endpoint, auth path or schema change; T-259-21 (neutered source left in the tree) and T-259-22 (a vacuous RED) are mitigated as planned: every restore is `cp` plus `cmp` (33 lines of `restore cmp exit=0`), the tree ends clean, and every `RED_OK` is a whole-line match to a collected node id with the `E   ` line shown above.

## Commits

None for code. The only commit of this plan is this SUMMARY (docs).

## Self-Check: PASSED

- `git status --porcelain -- analytics-service` empty; all six neutered files `cmp`-equal to their backups of the committed content.
- 33 `restore cmp exit=0`, 33 `GREEN_OK`, 43 `RED_OK`, 0 `_MISSING` in `proof-output.txt`.
- `make typecheck` rc 0; hunk counts 2, 1, 1; pinned files and fixtures byte-identical to the phase base.
