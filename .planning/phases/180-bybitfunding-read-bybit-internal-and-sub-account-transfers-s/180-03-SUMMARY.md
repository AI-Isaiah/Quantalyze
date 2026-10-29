---
phase: 180-bybitfunding-read-bybit-internal-and-sub-account-transfers-s
plan: 03
subsystem: analytics-service / allocator history probe
tags: [bybit, probe, unified-transaction-log, gate-cause, funding-explanation, read-only]
requires: ["180-01", "180-02"]
provides:
  - "scripts/allocator_history_probe.py: the Unified-edge recorder (_UNIFIED_FLOW_KINDS, _TradeRecorder._recording_unified_log, unified_state), bybit_unified_state and its three counts, bybit_funding_explained, bybit_transfers_cause, _FLOW_SOURCE_REFUSAL"
  - "tests/test_allocator_history_probe.py: _StubVenueWithUnifiedLog and the recorder, explanation, cause and vocabulary tests"
affects: [180-04, 180-06, 180-07]
tech-stack:
  added: []
  patterns: ["recorder wraps the rebuild's own client method and re-raises the same object", "code-derived closed tokens beside a strict gate, never feeding it"]
key-files:
  created: []
  modified:
    - analytics-service/scripts/allocator_history_probe.py
    - analytics-service/tests/test_allocator_history_probe.py
key-decisions:
  - "D-01 mapping decided here: a Unified TRANSFER_IN row is the deposit kind, a TRANSFER_OUT row the withdrawal kind; direction comes from the requested type, never from the row's sign."
  - "Unified rows are recorded into the SAME per-kind list as the on-chain read, so every 173 per-kind field describes the Unified edge once plan 06's read is deployed."
  - "Any failure class that is not AuthenticationError, PermissionDenied or BadRequest reads read_incomplete, never flow_source_unreadable."
status: complete
commits: 3
plan_head_before: 555267feecee2889d93df3479cf699651c3ad274
plan_head_after: 5360f483f149f84fef7c6b5e810b05d04bc4b756
actuals:
  tokens: 21000
  tasks: 3
  commits: 3
metrics:
  completed: 2026-10-29
requirements-completed: [SC-1, SC-3]
---

# Phase 180 Plan 03: Unified-edge flows, the shut gate's cause and the funding explanation Summary

The probe now records the rebuild's Bybit flow read the way the rebuild will read it after this phase (the Unified transaction log: TRANSFER_IN is the deposit kind, TRANSFER_OUT the withdrawal kind), and every account record says in code why the Bybit transfer-depth gate is shut and whether the account's funding is explained.

## What was built

- `_UNIFIED_FLOW_KINDS` (`TRANSFER_IN` -> `deposits`, `TRANSFER_OUT` -> `withdrawals`) and `_UNIFIED_STATES` (`not-run`, `read`, `malformed`, every failure class). The probe does not import `services.bybit_unified_flows` (it does not exist until plan 04); the grep count of that name in the probe is 0.
- `_TradeRecorder` wraps `private_get_v5_account_transaction_log` when the client has it. A requested `type` outside the two flow types (the census, a funding SETTLEMENT read, no type) is awaited and returned untouched and records nothing. A flow type increments `unified_calls`, appends each row to both `transfers` and `unified`, and hands the same answer object back. A raised exception is classified by class (never by message), stored in `unified_failure` and re-raised bare (same object). A non-conforming answer, or a row with no id or no millisecond stamp, counts as malformed; a row whose `change` (else `cashFlow`) sign contradicts the requested type is counted in `unified_sign_mismatch` and never used.
- `_MemberResult` carries `unified`, `unified_state`, `unified_sign_mismatch`, filled from `_unified_snapshot(recorder)` taken beside `moved = list(recorder.transfers)` in all three arms of `_probe_member`.
- Seven contiguous account keys after `bybit_transfers_gate`: `bybit_unified_state`, `bybit_unified_in_rows`, `bybit_unified_out_rows`, `bybit_unified_sign_mismatch_rows`, `bybit_funding_explained`, `bybit_transfers_cause` (the gate itself is the first of the seven). Each is in the whitelist, validators, defaults and `_probe_account`.
- `bybit_funding_explained(...)`: `explained` when the Unified edge shows a TRANSFER_IN; `off_edge` when an INFLOW evidence source shows rows and the edge does not (RESEARCH Pitfall 2); `unexplained` (SC-1's "a source still unnamed") when the edge was read, trades were read and every INFLOW source is `read` or `not-master` with no row; `unmeasured` otherwise; `not-applicable` without a Bybit member. It feeds no gate.
- `bybit_transfers_cause(...)` (D-03), placed after `bybit_transfers_verdict`, which is byte-identical to its pre-plan body (verified by comparing the function's AST source against the plan's base commit). `_FLOW_SOURCE_REFUSAL = "account_flow_source_unreadable"` is the literal contract with plan 07.
- Docstring item 2 and the `_probe_account` corroboration comment now describe the Unified edge; the 2026-10-28 on-chain reading is kept as lineage, and every remaining "on-chain only" line names Phase 173 or 2026-10-28 on that same line.

## Tests

- `tests/test_allocator_history_probe.py`: 136 -> 184 collected, all passing. New named tests (plan list): `test_the_unified_log_rows_the_rebuild_reads_are_its_deposits_and_withdrawals`, `test_a_member_that_never_reads_the_unified_log_prints_not_run`, `test_a_unified_log_call_that_raises_is_named_and_reraised`, `test_a_malformed_unified_answer_is_named_and_handed_back_unchanged`, `test_a_unified_row_whose_sign_contradicts_its_type_is_counted`, `test_other_log_types_are_not_recorded`, `test_the_funding_explanation_is_derived_from_the_unified_edge_and_the_evidence` (19 hand-written rows), `test_the_bybit_transfers_cause_names_why_the_gate_is_shut` (19 rows), `test_a_shut_bybit_gate_prints_its_cause_and_the_funding_explanation`, `test_the_unified_keys_refuse_values_outside_their_vocabulary`. Extra: `test_the_funding_explanation_table_covers_every_token`, `test_the_bybit_transfers_cause_table_reaches_every_token`, `test_a_short_window_account_prints_not_applicable_for_both_derivations`.
- Final run: `tests/test_allocator_history_probe.py tests/test_bybit_funding_record.py tests/test_okx_chain_record.py tests/test_trade_pages.py tests/test_bybit_two_year_window.py` -> 373 passed, 0 skipped (1 pre-existing warning). `tests/test_okx_chain_record.py` is in every probe run: plan 01's key order (funding keys before the chain keys) is untouched.
- CI's mypy line, verbatim from `analytics-service/`: `Success: no issues found in 130 source files`. Probe and module mypy: `Success: no issues found in 2 source files`. Import check printed `cause-ok`; the lineage grep prints 0.
- The tracer test asserts neither "fake-transfer" nor any row stamp's digits reach stdout or stderr.
- The venv is the main checkout's (ccxt 4.5.85; the repo pins 4.5.88).

## Mutation checks

Each: byte backup with `cp -p`, neuter, named test RED, restore from the backup, `cmp` clean, whole files green (373 passed).

mutation-m1: red (`test_the_unified_log_rows_the_rebuild_reads_are_its_deposits_and_withdrawals`: `assert (2, 0) == (1, 1)` with `TRANSFER_OUT` mapped to `deposits`). restore: cmp clean
mutation-m2: red (`test_a_unified_log_call_that_raises_is_named_and_reraised`: `Failed: DID NOT RAISE PermissionDenied` with the wrapper returning None instead of re-raising). restore: cmp clean
mutation-m3: red (`test_the_funding_explanation_is_derived_from_the_unified_edge_and_the_evidence`: `assert 'unmeasured' == 'explained'` with the `explained` branch disabled). restore: cmp clean
mutation-m4: red (`test_the_bybit_transfers_cause_names_why_the_gate_is_shut`: `assert 'neither_older_365d' == 'flow_source_unreadable'` with the `_FLOW_SOURCE_REFUSAL` test dropped). restore: cmp clean
mutation-m5: red (`test_the_bybit_transfers_cause_names_why_the_gate_is_shut`: `assert 'none' == 'no_withdrawal_older_365d'` with the cause returning `none` when either count is at least 1). restore: cmp clean
mutation-m6: red (`test_the_bybit_transfers_cause_names_why_the_gate_is_shut`: `assert 'flow_source_unreadable' == 'read_incomplete'` on the transient rows, with every state other than `read` / `not-run` mapped to unreadable). restore: cmp clean

## Deviations from Plan

None - plan executed exactly as written. Two small points that are not deviations:

- The tests passed on first run, so the TDD red step was shown by the mutations (m1 to m6) rather than by a pre-implementation failing run.
- Task 1's tracer reader makes the TRANSFER_IN call twice (the plan's "four log calls": IN, IN, OUT, one census type), which also pins that an id read in two overlapping windows counts once.

## Known Stubs

None.

## Threat Flags

None. All new output goes through `ACCOUNT_RECORD_KEYS`, the validators and `emit_record`; the new surface is a wrapper over a GET method the rebuild already calls. No venue write, no new import of an untracked module.

## Notes for plans 04 to 07

- Plan 04 should pin the probe's `_UNIFIED_FLOW_KINDS` keys equal to its own `UNIFIED_FLOW_TYPES`; the probe holds the two literals itself and imports nothing from the rebuild.
- Plan 07's token-set test should assert `hp._FLOW_SOURCE_REFUSAL in er.FORCED_REBUILD_REFUSAL_REASONS`. Until it lands, `account_flow_source_unreadable` is not in the probe's emit vocabulary; `bybit_transfers_cause` is tested as a pure function and no record carries that refusal.
- Until plan 06's read is deployed, a deployed rebuild does not call the Unified log for flows, so `bybit_unified_state` reads `not-run` and the cause reads `read_incomplete` for a shut gate. That is the intended reading of "the Unified edge was never read", not a defect.
- `bybit_funding_explained` and `bybit_transfers_cause` open nothing; `summarize` and the summary gate are unchanged.

## Self-Check: PASSED

- FOUND: analytics-service/scripts/allocator_history_probe.py, analytics-service/tests/test_allocator_history_probe.py
- FOUND commits: 1758e4e21, 87ec85d12, 5360f483f (all ancestors of HEAD)
- STATE.md, ROADMAP.md, VERSION, package.json, CHANGELOG.md and TODOS.md untouched.
