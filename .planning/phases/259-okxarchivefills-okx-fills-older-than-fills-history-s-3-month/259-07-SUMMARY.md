---
phase: 259-okxarchivefills-okx-fills-older-than-fills-history-s-3-month
plan: 07
subsystem: analytics-service / OKX archive fills job (the write)
tags: [okx, archive, fills, trades, upsert, idempotency, all-or-nothing, legacy-mismatch, mypy]

requires:
  - phase: 259-06
    provides: "the GET-first wait; a `fills_apply` job reaches the write seam only with every quarter finished"
  - phase: 259-03
    provides: "`WRITE_BOUND_MARGIN_MS` (the one definition), `FILLS_APPLY_MODE`, `CHAIN_KIND`"
provides:
  - "`_write_fills`: the fills_apply write, the live upsert's literals, batches of 100, `inserted` per target"
  - "`_legacy_gate`: the permanent `fills_legacy_mismatch` stop, raised for all targets before any write"
  - "`tests/test_okx_archive_fills_apply.py`: write, rerun, cursor, dry-run, all-or-nothing, window-empty, write-failure and binding arms"
affects: [259-08, 259-09]

status: complete
commits: 4
plan_head_before: 15fda754e0757d3719fd1497e7abaddf487f7813
plan_head_after: 5b3d15465506748fe50c9daa9fc7928c062c321d

actuals:
  tokens: 9200        # chars/4 over the new test file (30334 chars) plus the added lines of the source file (6352 chars)
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns:
    - "every gate for every target precedes the one write; the write is a separate step the handler reaches only with the mapped fills in hand"
    - "the unique index is the idempotency arbiter: every window fill is sent on every run and `ignore_duplicates` makes the rerun a no-op"
    - "a docstring-stripped source binding, so a literal named in prose cannot keep a binding test green"

key-files:
  created:
    - analytics-service/tests/test_okx_archive_fills_apply.py
  modified:
    - analytics-service/services/okx_archive_fills.py

key-decisions:
  - "`_write_fills` takes the `_Prepared` plan and the mapped fills rather than a per-target evaluation object: plan 05 keeps no such object (the readings live in the result), and the write set is exactly `anchor <= row instant < write bound` over the mapped fills, the same predicate `_evaluate_targets` counts with."
  - "`_read_and_gate` now returns the mapped fills (or `_Waiting`) instead of None, so the write needs no second mapping pass."
  - "A `fills_apply` that writes ends `info.outcome` `applied`; `fills_calibrate` keeps `read_complete`."
  - "`inserted_before_failure` in the `fills_write_failed` detail is the TOTAL stored across targets so far (identical to the failing target's count for one target); each target's own count stays in `strategies[i].inserted`. A multi-target failure would otherwise understate what had landed."
  - "Every write-window fill is sent on every run, already-stored ones included, and the unique index absorbs them. That is what makes the retry after a failed batch need no resume state, and it is the live sync's own behaviour."

requirements-completed: [SC-1, SC-2, SC-3, SC-4]

coverage:
  - id: D1
    description: "fills_apply sends each target exactly its [anchor, write bound) fills through the live upsert (on_conflict key, ignore_duplicates, batches of 100), each row equal to the hand-typed fill plus strategy_id; fills before the anchor and in the reconcile window are never sent"
    requirement: "SC-1"
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_okx_archive_fills_apply.py::TestWrite::test_apply_writes_every_window_fill_once"
        status: pass
  - id: D2
    description: "A second fills_apply inserts zero rows and its legacy reading matches the rows the first run stored; no cursor or re-read-bound RPC is ever made; a calibrate never writes and reports would_insert equal to the apply's inserted"
    requirement: "SC-3"
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_okx_archive_fills_apply.py::TestWrite"
        status: pass
  - id: D3
    description: "Every gate failure (bal chain, header drift, five mapping stops, a reconcile miss on one target, a legacy mismatch on one target) writes nothing for any target and names its class"
    requirement: "SC-2"
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_okx_archive_fills_apply.py::TestAllOrNothing"
        status: pass
  - id: D4
    description: "An empty overlap still writes a proven SWAP read and records window_empty; a stored row in an unread span never trips the legacy stop; the quarters override and the over-cap and before-anchor spans are named on a DONE apply"
    requirement: "SC-2"
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_okx_archive_fills_apply.py::TestAllOrNothing::test_window_empty_still_writes_proven_swap"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_okx_archive_fills_apply.py::TestAllOrNothing::test_apply_ignores_stored_rows_in_unread_spans"
        status: pass
  - id: D5
    description: "A failed batch is the named transient fills_write_failed with inserted_before_failure and no exception text, a budget overrun is claim_budget_exceeded step=write, and the retry stores exactly the remaining rows once each; the live upsert literals, mode, kind, source literal, stop-class sets and the single margin definition are bound by tests"
    requirement: "SC-4"
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_okx_archive_fills_apply.py::TestWriteFailures"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_okx_archive_fills_apply.py::TestBindings"
        status: pass
---

# Phase 259 Plan 07: The fills_apply write and its gates Summary

`fills_apply` now writes. After every quarter is finished and every gate has passed for every target, `_write_fills` upserts each read target's archive fills in [anchor, write bound) with the literals the live fills ingestion uses, and the job ends `info.outcome` `applied`. Nothing is written unless every gate passed for every target, a rerun stores nothing, and the fills cursor is never touched.

## What was built

- **`_write_fills(supabase, prepared, mapped, result, budget)`** (`services/okx_archive_fills.py`): per target in position order, the mapped rows with `anchor <= row instant < write bound`, in batches of 100, each batch `table("trades").upsert([{"strategy_id": sid, **row} ...], on_conflict="strategy_id,exchange,exchange_fill_id", ignore_duplicates=True)` inside `_within(budget, db_execute(...), step="write")`. `len(resp.data)` is added to `strategies[i].inserted` after every batch; a non-list answer sets it to None and `info.inserted_count_unreadable`. A batch exception that is not cancellation or the budget's `_Stop` ends `fills_write_failed` with `position` and `inserted_before_failure` only; the exception class is logged, never its text.
- **`_legacy_gate(strategies)`**: after every target's reading and after a reconcile miss has had its chance, a `fills_apply` with any target whose `unequal + absent_in_archive + unreadable > 0` raises the permanent `fills_legacy_mismatch` (`position=<lowest> unequal= absent_in_archive= unreadable= targets=<k>`). `fills_calibrate` never reaches it.
- **Handler**: `_read_and_gate` returns the mapped fills or `_Waiting`; the write runs inside the same try block, so its stops go through `_finish_fills_stop`. The module docstring's mode paragraph no longer says the write is plan 07's.
- **Tests** (`tests/test_okx_archive_fills_apply.py`, 24 arms): `TestWrite` (4), `TestAllOrNothing` (6 named arms plus the mapping and legacy parametrisations, 15 cases in all), `TestWriteFailures` (3), `TestBindings` (2). The 150-bill Q3 override and the 2025 Q4 / 2026 Q1 files are built in-test; nothing was added to the committed fixtures.

## Verification (measured)

- `pytest tests/test_okx_archive_fills_apply.py`: 24 passed. With every Phase 259 module and the pinned archive suites, `test_main_worker.py` and `test_okxtrades_cursor.py`: 1080 passed.
- `make typecheck` (mypy strict): no issues in 149 source files. `ruff check --select F` on both files: clean.
- `node scripts/verify-plan-anchors.mjs` on the plan: OK (8 claims).
- The seven pinned test files are unchanged against the merge base (`git diff --quiet <merge-base> -- ...` exits 0); `okx_archive_job.py` and `job_worker.py` were not touched.
- `grep -n "async def _write_fills(" ...` prints one line; the upsert literals appear in `_write_fills`'s code.
- Local neuters (byte backup in the session scratchpad, restored with `cp`, proven with `cmp`; plan 08 does the formal version):
  - `ignore_duplicates=False`: `test_apply_second_run_inserts_nothing`, `test_apply_writes_every_window_fill_once`, `test_calibrate_never_writes`, `test_retry_after_batch_failure_completes_idempotently` and `test_write_literals_bind_the_live_upsert` RED.
  - legacy gate removed: all three `test_apply_stops_on_legacy_mismatch` cases RED.
  - lower bound dropped from the write set (writes before the anchor): `test_apply_writes_every_window_fill_once` and four more RED.
  - first reconcile miss not raised: `test_reconcile_miss_on_one_target_writes_nothing_for_any` RED.
  - `inserted_before_failure` forced to 0: `test_batch_failure_is_named_and_counted` RED.
  - batch slice of 50 instead of 100: `test_batch_failure_is_named_and_counted` and `test_retry_after_batch_failure_completes_idempotently` RED.
  - write also in `fills_calibrate`: `test_calibrate_never_writes` RED.
  - `_Stop` no longer excluded from the batch except: `test_write_past_claim_budget_is_transient` RED.

## Deviations from Plan

**1. [Process] RED-before-GREEN was not followed.** The write and the gate were written before the arms (as in plans 05 and 06); the neuter checks above are the substitute evidence that each arm can fail. The code landed in two commits (write, then legacy gate) by reconstructing the first state, so the per-task commits match the plan's tasks.

**2. [Rule 1 - Test defect, found by neuter] The literal-binding arm read the docstring.** `_write_fills`'s own docstring names `ignore_duplicates=True`, so `test_write_literals_bind_the_live_upsert` stayed green with the code set to `False`. Fixed in `5b3d15465` by cutting the first triple-quoted block from both sources before searching; the neuter then turns it RED.

**3. [Minor] `_write_fills` signature** takes `(supabase, prepared, mapped, result, budget)`, not the plan's per-target evaluation type (see key-decisions).

**4. [Minor] `inserted_before_failure` is the total across targets** (see key-decisions); identical for the plan's one-target arm.

**5. [Minor] The 150-bill override is 145 generated bills** plus the fixtures' five write-window fills, so the write set is exactly 150 (batches of 100 and 50, as the plan's retry arm states). The generated bills carry zero `balChg`, `fee` and `pnl`, and every original Q3 billId is multiplied by 1000 so the new bills sort between billIds 910000011 and 910000012 (the chain runs in billId order).

## Notes for plans 08 and 09

- Neuter targets by name (plan 08): `test_apply_second_run_inserts_nothing`, `test_calibrate_never_writes`, `test_reconcile_miss_on_one_target_writes_nothing_for_any`, `test_bal_chain_break_writes_nothing`, `test_apply_stops_on_legacy_mismatch`, `test_write_literals_bind_the_live_upsert`, `test_batch_failure_is_named_and_counted`. The seams to neuter are `_legacy_gate`'s call in `_evaluate_targets`, the write-set predicate and the `ignore_duplicates` literal in `_write_fills`, and the `fills_apply` condition in the handler.
- Runbook (plan 09): a `fills_apply` result carries `info.outcome` `applied` and per-target `inserted` (None only for targets that were not read, or when the upsert answer was not a list, flagged by `info.inserted_count_unreadable`); the PROD after-count is the authority in that second case. A `fills_legacy_mismatch` is permanent and the chain's 14-day cooldown counts it, so the runbook's calibrate go/no-go and this stop are the same predicate.
- The quarters-override arm needed no extra quarter for the bal chain (Q2 alone has enough pairs), so the manual path works on one quarter.

## Known Stubs

None.

## Threat Flags

None. T-259-17 (writes only in `fills_apply`, only after every gate for every target), T-259-18 (the legacy stop instead of a silent keep), T-259-19 (named, counted, resumable failures), T-259-20 (no cursor RPC) and T-259-27 (the legacy gate precedes the write, unread spans excluded) are mitigated as planned and pinned by arms.

## Commits

- `46c18bb17` feat(259-07): fills_apply writes every window fill through the live upsert, a rerun stores nothing
- `36d9db9be` feat(259-07): all or nothing on every gate, with the fills_legacy_mismatch stop
- `e29676c62` test(259-07): named, resumable write failures and the cross-module bindings
- `5b3d15465` test(259-07): the literal binding reads code, not the docstring that names the literals

## Self-Check: PASSED

- FOUND: analytics-service/services/okx_archive_fills.py (`async def _write_fills(`), analytics-service/tests/test_okx_archive_fills_apply.py
- FOUND commits 46c18bb17, 36d9db9be, e29676c62, 5b3d15465 (ancestors of HEAD; `git rev-list --count 15fda754e..HEAD` printed 4 before this file was added)
