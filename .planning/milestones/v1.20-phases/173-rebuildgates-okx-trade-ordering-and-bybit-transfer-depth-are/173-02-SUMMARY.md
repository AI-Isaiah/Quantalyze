---
phase: 173-rebuildgates-okx-trade-ordering-and-bybit-transfer-depth-are
plan: 02
subsystem: analytics-service / allocator history probe
tags: [bybit, transfers, deposits, withdrawals, probe, redaction, gate, python]

requires:
  - phase: 173-rebuildgates (plan 01)
    provides: the probe's okx_order_gate and the account/summary key plumbing this plan extends in the same two files
provides:
  - "deposits_older_365d and withdrawals_older_365d on every account record, counted per kind with the pooled field's cutoff and distinct-event rule; transfers_older_365d stays and equals their sum"
  - "seven corroboration fields (in-window totals, three closed age buckets, two ordering booleans) for the founder to judge at the checkpoint; they feed no gate"
  - "bybit_transfers_gate on every account record, derived in code by bybit_transfers_verdict from the two per-kind counts only"
affects: [173-03 operator checkpoint (reads bybit_transfers_gate and the evidence off the deployed probe)]

actuals:
  tokens: 5200
  tasks: 3
  commits: 3
plan_head_before: 885425959202cb8f326f937543ed276b46c84359
plan_head_after: 7183b24832f363ec0a227d6a2cd3df6ba01233dd

tech-stack:
  added: []
  patterns:
    - "gate verdict as a pure module-level function over per-kind counts, the pooled shortcut caught by a mutation"
    - "corroboration emitted as counts, closed buckets and booleans; ordering never a timestamp"

key-files:
  created: []
  modified:
    - analytics-service/scripts/allocator_history_probe.py
    - analytics-service/tests/test_allocator_history_probe.py

key-decisions:
  - "D-02 (founder 2026-10-28, '0 stays unmeasured'): bybit_transfers_gate is ok only when BOTH per-kind counts older than 365 days are at least 1 on a Bybit account with the full 730-day window; a pooled count never opens it"
  - "BYBIT_TRADE_TERMINUS_DAYS joins DEPLOYED_ER_NAMES so run() refuses before any decrypt against a rebuild module that lacks it"
  - "the gate does not depend on members_failed: a positive per-kind count is sound evidence even from a member that failed later (RESEARCH Pitfall 4)"

patterns-established:
  - "A deposit COUNT can double-count an id-less row two windows returned; 'at least one' stays sound, so only the gate threshold (>= 1) is relied on"

requirements-completed: [SC-2]

coverage:
  - id: D1
    description: "Every account record carries deposits and withdrawals older than 365 days separately; the pooled field is unchanged and equals their sum; a venue without transfer fetchers reads 0 and 0"
    requirement: "SC-2"
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_allocator_history_probe.py#test_transfer_events_older_than_365_days_are_counted_per_account"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_allocator_history_probe.py#test_a_venue_without_transfer_fetchers_reads_zero_old_transfers"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_allocator_history_probe.py#test_the_declared_vocabulary_is_the_rebuilds_own_refusal_tokens"
        status: pass
    human_judgment: false
  - id: D2
    description: "The corroboration evidence (in-window totals, three closed age buckets, two ordering booleans) reaches the record, carries no id, amount or timestamp, and refuses out-of-vocabulary values"
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_allocator_history_probe.py#test_fills_older_than_the_first_transfer_are_recorded_as_evidence"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_allocator_history_probe.py#test_the_transfer_evidence_keys_refuse_values_outside_their_vocabulary"
        status: pass
    human_judgment: false
  - id: D3
    description: "bybit_transfers_gate is strict: ok only with both kinds seen older than a year on a full Bybit window, unmeasured for one kind or none, not-applicable without a Bybit member or on a short window"
    requirement: "SC-2"
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_allocator_history_probe.py#test_the_bybit_transfers_verdict_needs_both_kinds_on_a_full_bybit_window"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_allocator_history_probe.py#test_one_kind_older_than_a_year_keeps_the_bybit_gate_unmeasured"
        status: pass
    human_judgment: false
  - id: D4
    description: "SC-2 on the live worker: a6's deployed probe record prints both per-kind counts, the evidence and a bybit_transfers_gate reading"
    verification: []
    human_judgment: true
    rationale: "Needs the deployed probe run on the Railway worker (plan 03, an operator checkpoint); whether a 0 is a depth finding or the funding route is the founder's judgment from the evidence"

duration: 30min
completed: 2026-10-28
status: complete
---

# Phase 173 Plan 02: Bybit transfer depth per kind, evidence and a strict gate Summary

**The allocator history probe now counts Bybit deposits and withdrawals older than 365 days per kind, records the corroboration evidence the founder judges, and prints a strict per-account `bybit_transfers_gate` that only both per-kind counts can open.**

## Performance

- **Duration:** about 30 min (approximate; the start time was not captured at spawn)
- **Tasks:** 3 (1 tracer, 2 auto TDD)
- **Files modified:** 2
- **Commits:** 3 task commits (measured from the persisted ledger)

## Accomplishments

- Per-kind counts. `transfers_of_kind` filters the recorder's `(kind, id, timestamp)` tuples; `deposits_older_365d` and `withdrawals_older_365d` reuse `transfers_older_than` with the same cutoff, so no second dedupe exists. The pooled `transfers_older_365d` keeps its meaning and equals their sum (asserted).
- Evidence for D-02. `deposits_in_window`, `withdrawals_in_window`, `oldest_fill_age_bucket`, `oldest_deposit_age_bucket`, `oldest_withdrawal_age_bucket` (the existing closed `_WINDOW_AGE_BUCKETS`, via `window_age_bucket`) and `oldest_fill_before_oldest_deposit` / `oldest_fill_before_oldest_withdrawal` (boolean, `field-absent` when either side has no timestamp). A comment above the block says these feed no gate and that a 0 is not a depth finding (the rebuild's Bybit transfer read is on-chain only). The evidence test asserts neither a transfer id nor the deposit's millisecond value reaches stdout or stderr.
- Strict gate. `bybit_transfers_verdict(bybit_members, window_days, deposits_old, withdrawals_old)`: `not-applicable` unless a Bybit member is present and the window equals `er.BYBIT_TRADE_TERMINUS_DAYS` (730); `ok` only with both counts at least 1; else `unmeasured`. It takes no pooled count. WR-07 end to end: one deposit 500 days old and no withdrawal gives pooled 1 and the gate `unmeasured`.
- `BYBIT_TRADE_TERMINUS_DAYS` is in `DEPLOYED_ER_NAMES` (kept sorted), so an older deployed rebuild is refused before any decrypt.
- Module docstring item 2 rewritten for the per-kind counts, the evidence, the strict gate and what a 0 does and does not mean; the pooled field's lineage is kept.

## Task Commits

1. **Task 1 (tracer): per-kind counts reach the emitted record** - `9216e65d5` (feat)
2. **Task 2: the corroboration evidence reaches the record** - `a6698fc4b` (feat)
3. **Task 3: the strict `bybit_transfers_gate`, `DEPLOYED_ER_NAMES`, docstring** - `7183b2483` (feat)

The tracer feedback gate ran as Task 1's own `<verify>` (three named tests, the whole probe file, probe mypy, CI's mypy line, the `transfers_of_kind(` count of 3, and the key import check) and passed before Task 2 started.

## Verification

- `tests/test_allocator_history_probe.py tests/test_trade_pages.py tests/test_bybit_two_year_window.py`: 153 passed (probe file alone: 103, up from 99 after plan 01).
- Probe mypy (`scripts/allocator_history_probe.py`): `Success: no issues found in 1 source file`.
- CI's mypy line verbatim: `Success: no issues found in 127 source files`.
- Task 3 import check printed exactly `0 16 True True True True`.
- Static pins stay green: `test_the_probe_source_calls_no_writer`, `test_the_probe_source_calls_no_venue_write`, `test_every_rebuild_name_the_probe_reads_is_declared`.
- Phase-gate full suite from `analytics-service/` (`-n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-fail-under=80`): `13408 passed, 99 skipped, 1167 warnings in 111.34s`, total coverage 94.48%, exit 0. The 99 skips are environmental (no TEST Supabase project or DSN, no local-stack lane, `HAS_PY_ENV` unset, and two long-standing P1-TODO skips); none touches the probe. CI's `python` job bound to the PR head SHA is the binding reading.

## Mutation checks

Each neuter was applied to `analytics-service/scripts/allocator_history_probe.py`, the named test run and seen FAILING, then the file restored from a `cp -p` byte backup and compared with `cmp`; the whole file was run green afterwards. m5b and m8 were applied after Task 3 on the final probe.

mutation-m5a: red (test_transfer_events_older_than_365_days_are_counted_per_account)
mutation-m7: red (test_the_declared_vocabulary_is_the_rebuilds_own_refusal_tokens)
mutation-m5b: red (test_one_kind_older_than_a_year_keeps_the_bybit_gate_unmeasured)
mutation-m8: red (test_the_probe_source_calls_no_writer)
restore: cmp clean

m5a = the two kind literals swapped between the per-kind lines. m7 = `deposits_older_365d` removed from `ACCOUNT_RECORD_KEYS` with its default kept (40 tests went red, the named one among them). m5b = the gate fed the pooled sum for both counts. m8 = one comment line containing the rpc call text appended to the probe source.

## Deviations from Plan

None - plan executed exactly as written.

Two notes, neither a deviation: (1) two tiny private helpers, `_oldest_of` and `_fill_before`, sit beside the two plan-named pure helpers (`oldest_fill_ms`, `oldest_transfer_ms`) because the minimum-of-optional-stamps and the field-absent boolean are each used 3 and 2 times in `_probe_account`; (2) the per-kind counts are computed once into locals (`deposits_old`, `withdrawals_old`) and fed to both the record fields and the gate, so the gate cannot drift from the printed counts.

## Issues Encountered

None.

## Known Stubs

None.

## Threat Flags

None. No new venue call, endpoint, auth path or schema; every new field is an aggregation of data the probe already recorded (T-173-05, T-173-06, T-173-07 mitigated as planned).

## Notes for follow-ups

- A deposit COUNT can double-count an id-less row that two overlapping windows both returned (RESEARCH A3). The gate only needs "at least one", which stays sound; read the count as an upper bound.
- Plan 03's deployed import check expects the line `0 16 True True True True`; it holds on this checkout (see Verification).
- The stale comment noted in plan 01 ("the summary schema is unchanged") was left alone as adjacent code.

## Self-Check: PASSED

- Files found: the probe and its test file.
- Commits found as ancestors of HEAD: `9216e65d5`, `a6698fc4b`, `7183b2483`.
- `grep -acE '^mutation-m[0-9a-z]+: red \(' ` on this file prints 4; `restore: cmp clean` present.
