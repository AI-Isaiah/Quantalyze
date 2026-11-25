---
phase: 234-nocapital-a-no-capital-key-takes-one-named-path-and-a-transi
plan: 02
subsystem: allocator-equity-derive
tags: [nocap-01, nocap-03, proof-01, allocator, mt5, ledger-proof]
requires: [234-01]
provides:
  - LEDGER_PROOF_VENUES = frozenset({"mt5"}) beside FULL_HISTORY_VENUES (allocator_equity_derive.py)
  - NO_CAPITAL_REFUSAL_REASONS grows to ten tokens (negative_terminal, ledger_basis_absent, ledger_level_funded)
  - _no_capital_ledger_level pure helper and the apply-loop ledger gate (job_worker.py)
  - selection refusal of a stored terminal below -DUST_NAV_FLOOR on every venue
affects: [234-03, 234-04]
tech-stack:
  added: []
  patterns: [independent-proof gate per venue set, closed token set, hand-derived re-aimed fixtures]
key-files:
  created: []
  modified:
    - analytics-service/services/allocator_equity_derive.py
    - analytics-service/services/job_worker.py
    - analytics-service/tests/test_derive_allocator_equity_job.py
decisions:
  - "DEC-02-A: ledger_level = sum(composed flow_usd) + sum(composed pnl_usd) over the key's OWN key_inputs row (writer_basis_raw, never the stitched writer_basis_by_key); confirmed empty one-sidedly at level <= DUST_NAV_FLOOR; no basis or a non-finite total is no proof."
  - "DEC-02-B: the ledger proof runs BEFORE the D-10 bound; a key that passes the proof still meets D-10."
  - "DEC-02-C: LEDGER_PROOF_VENUES = {mt5}; Deribit is out (terminal reconciled to inception at write time)."
  - "DEC-02-D: a terminal below -DUST_NAV_FLOOR is refused at selection on every venue as negative_terminal; exactly -DUST_NAV_FLOOR passes that gate."
  - "DEC-02-E: tests whose subject is the MT5 exit got a hand-derived own basis summing to the stored terminal; tests whose subject is a venue-independent gate moved to a Deribit row, every number unchanged."
status: complete
commits: 2
plan_head_before: acf58fa0e940bfecfd76d342a7d91ea5d35949bb
plan_head_after: 14e5dd6a51565ff8f5270df10c2162a34ad83178
actuals:
  tokens: 7300
  tasks: 2
  commits: 2
---

# Phase 234 Plan 02: NOCAP-01 the MT5 ledger proof Summary

A funded MT5 key whose live balance reads zero for one tick no longer exits as no-capital: the exit on a `LEDGER_PROOF_VENUES` venue now needs the key's own stored deal ledger to sum at or below `DUST_NAV_FLOOR`, and a terminal below `-DUST_NAV_FLOOR` is never an exit on any venue. ROADMAP SC-1 holds and a test drives the transient zero.

## What was built

- **Task 1 (tracer, 25780ef5d):** `LEDGER_PROOF_VENUES` and the three tokens in `allocator_equity_derive.py`; `_no_capital_ledger_level(basis)` in `job_worker.py` right after `_no_capital_exit_consumes_only_dust`; the apply-loop gate before the D-10 call (venue read as `str(rows_by_id[_k].get("exchange") or "").strip().lower()`, level from `writer_basis_raw.get(_k)`); the selection `negative_terminal` refusal after the funded check. The tracer `test_no_capital_exit_mt5_transient_zero_over_a_funded_ledger_keeps_dropped_key` (hand-derived ledger 80000 - 20000 + 0 = 60000). Five MT5 exit tests re-fixtured with an own basis; four stays-dropped tests moved to Deribit; the closed-set pin moved to ten tokens.
- **Task 2 (14e5dd6a5):** tests for `ledger_basis_absent`, the boundary pair around `-DUST_NAV_FLOOR`, the `"MT5"` case, the Deribit scope, the gate-order case (a proved-empty margin call is still refused by D-10), `_no_capital_ledger_level` purity, and the `LEDGER_PROOF_VENUES` pin.

## Tracer RED on the plan-01 tree (before any implementation)

```
E  AssertionError: assert 'dropped_key' in ['classified_rotation', 'window_truncated']
FAILED tests/test_derive_allocator_equity_job.py::test_no_capital_exit_mt5_transient_zero_over_a_funded_ledger_keeps_dropped_key
1 failed, 164 deselected in 12.39s
```
The funded key exited (named rotation, no `dropped_key`), as RESEARCH probe 1 measured.

## Re-aimed fixtures (hand-derived, no expected curve value changed)

The five MT5 exit tests pass unchanged on their curves and exit tokens with these own bases: (1) flows {d0: +20000, d3: -20000}, P&L 0, ledger 0.0; (2) flows {d0: 4000}, P&L {0, -3200, -720}, ledger 80.0; (3) `_nc_mt5_withdrawal_book` as (1); (4) flows {d0: 1.5F, d3: 0.3F}, P&L {0, 0, 0, -F}, ledger 0.8F; (5) key-D flows {d0: 4000}, P&L {0, 0, 0, -3200, -720}, ledger 80.0. The four D-10/inception tests moved from `"mt5"` to `"deribit"` (venue string in both `_nc_candidate` and `_nc_payload`), each asserting its own token again (`consumes_more_than_dust` x3, `blocking_reason` x1). The Deribit tracer shape exits trustworthy with no field, as the plan expected.

## Verification

- Wider allocator set (the plan's command): Task 1 888 passed (floor 888); Task 2 896 passed (floor 895).
- CI strict mypy after each task: `Success: no issues found in 143 source files`.
- `read_writer_basis` and `tests/fixtures/derive_refusal_rows.json` untouched; `test_derive_refusal_rows.py` green.
- `node scripts/verify-plan-anchors.mjs <plan>`: `OK: 1 plan file(s), no stale claims.`
- Acceptance greps (comment lines excluded): `LEDGER_PROOF_VENUES` in derive 1, `_no_capital_ledger_level` in job 2, `writer_basis_raw.get(` 1, the three new tokens in job 3, `LEDGER_PROOF_VENUES` in the test file 9.

## PROOF-01 transcripts (each arm: byte backup in the scratchpad, neuter, RED, `cp` back, `cmp -s` exit 0, GREEN)

### Task 1: `ledger_level_funded` refusal replaced by `pass`
```
RED:   E  AssertionError: assert 'dropped_key' in ['classified_rotation', 'window_truncated']
       FAILED tests/test_derive_allocator_equity_job.py::test_no_capital_exit_mt5_transient_zero_over_a_funded_ledger_keeps_dropped_key
       1 failed, 164 deselected in 10.73s
restore: cp job.t1.bak -> services/job_worker.py ; cmp -s exit 0
GREEN: 1 passed, 164 deselected in 10.02s
```

### Task 2 arm (a): `ledger_basis_absent` refusal replaced by `_nc_ledger_level = 0.0` (no basis treated as proved empty)
```
RED:   E  AssertionError: assert 'dropped_key' in ['classified_rotation', 'window_truncated']
       FAILED tests/test_derive_allocator_equity_job.py::test_no_capital_exit_mt5_without_its_own_basis_is_refused_as_ledger_basis_absent
       1 failed, 172 deselected in 11.02s
restore: cp job.t2.bak -> services/job_worker.py ; cmp -s exit 0
GREEN: 1 passed, 172 deselected in 9.84s
```
(A first neuter with a bare `pass` failed with a `TypeError` comparing None to float; that is a broken neuter, not the arm, so it was redone as above.)

### Task 2 arm (b): `negative_terminal` count replaced by `pass`
```
RED:   E  AssertionError: assert None == {'negative_terminal': 1}
       FAILED tests/test_derive_allocator_equity_job.py::test_no_capital_exit_a_terminal_one_cent_below_minus_the_dust_floor_is_refused
       1 failed, 172 deselected in 93.86s (0:01:33)
restore: cp job.t2.bak -> services/job_worker.py ; cmp -s exit 0
GREEN: 1 passed, 172 deselected in 91.82s (0:01:31)
```

### Task 2 arm (c): `.strip().lower()` dropped from the venue read
```
RED:   E  AssertionError: assert 'dropped_key' in ['classified_rotation', 'window_truncated']
       FAILED tests/test_derive_allocator_equity_job.py::test_no_capital_exit_mt5_venue_is_gated_whatever_its_case
       1 failed, 172 deselected in 75.91s (0:01:15)
restore: cp job.t2.bak -> services/job_worker.py ; cmp -s exit 0
GREEN: 1 passed, 172 deselected in 58.48s
```

### Task 2 arm (d), CONTROL not a gate: ledger gate moved after the D-10 call
```
neutered run (-k no_capital): 43 passed, 130 deselected in 44.62s
restore: cp job.t2.bak -> services/job_worker.py ; cmp -s exit 0
restored run: 43 passed, 130 deselected in 43.67s
```
As the plan predicted, the gate-order test still passes when the order flips, because both gates refuse a proved-empty margin call on D-10 first and a ledger-funded key on either. The order is a design decision (DEC-02-B), recorded here, not a pinned behaviour.

## Deviations from Plan

**1. [Rule 3 - Blocking] Closed-set pin moved to ten tokens in Task 1, not Task 2.** Task 1 adds the three tokens to `NO_CAPITAL_REFUSAL_REASONS`, so the pin test fails the moment the set changes; it was renamed `test_no_capital_refusal_reasons_are_the_ten_plan_01_and_02_tokens` in the same commit (25780ef5d).

**2. [Rule 1 - Bug] An unlisted fixture reached the new gate.** `test_no_capital_exit_refused_counts_each_key_once_on_its_own_route` carried key-H as an MT5 row with no basis expecting `consumes_more_than_dust`; it is now refused earlier as `ledger_basis_absent`. Moved to `"deribit"` with every number unchanged and its docstring says why (same re-aim as the plan's items 6 to 9, DEC-02-E). It asserts the same three tokens as before.

**3. TDD ordering for the negative-terminal pair.** The selection `negative_terminal` refusal and its token landed in the Task 1 commit alongside the other two tokens (the token set and its writers move together), so the pair was never RED on a pre-implementation tree. Its RED evidence is arm (b) above, a neuter of the shipped refusal. Task 2's commit is therefore test-only.

## Known Stubs

None.

## Threat Flags

None. The gate stores and logs only a closed token and a count; no USD figure, key id or day is written by it (T-234-08).

## Self-Check: PASSED

- Commits present: 25780ef5d, 14e5dd6a5 (`git rev-list --count acf58fa0..HEAD` = 2 before this SUMMARY commit).
- Modified files exist and match the plan's `files_modified`; `STATE.md`, `ROADMAP.md`, VERSION, package.json, CHANGELOG.md and TODOS.md untouched.
