---
phase: 173-rebuildgates-okx-trade-ordering-and-bybit-transfer-depth-are
plan: 01
subsystem: analytics-service / allocator history probe
tags: [okx, fills-history, ordering-gate, probe, redaction, python]

requires:
  - phase: 167.2.1.1.2.1-tradepages
    provides: the allocator history probe, the raw OKX fills-history ordering read and the okx-order gate wording (plan 06)
  - phase: 172-okxanchor
    provides: the anchor diagnostic and the closed forced-refusal vocabulary the probe prints
provides:
  - "a raw OKX fills-history ordering reading on every probe arm whose forced pass read OKX trades (read, refused under any token, or cut short), taken from the call snapshot before the anchor diagnostic"
  - "okx_order_failure_class and okx_members_with_trades on the account record; okx_order_readings, okx_members_with_trades and a code-derived okx_order_gate on the summary"
  - "runbook pre-flight P4 naming the probe's code-derived fields"
affects: [173-02 bybit transfer depth (same two files), 173-03 operator checkpoint, OKXBILLSCHAIN follow-up]

actuals:
  tokens: 6700
  tasks: 3
  commits: 3
plan_head_before: 4be15811a1865be299ed100b4d43af87659a19cb
plan_head_after: 8194ea988a3944f20ab7b485a861410c84f56364

tech-stack:
  added: []
  patterns:
    - "side measurement helper that never changes a member outcome: class-only failure, bounded by the crawl timeout"
    - "gate verdict as a pure module-level function, violated tested first, absent evidence never ok"

key-files:
  created: []
  modified:
    - analytics-service/scripts/allocator_history_probe.py
    - analytics-service/tests/test_allocator_history_probe.py
    - docs/runbooks/marksource-okx-history-correction.md

key-decisions:
  - "D-01 (founder 2026-10-28): the raw ordering read is taken for a REFUSED OKX member too, under any refusal token, so 173 measures ordering on a4 while a4's rebuild waits on OKXBILLSCHAIN"
  - "A raw read that raises is recorded by allow-listed class and leaves the member outcome alone; this also changes the success arm, where a raising raw read used to fail a member whose forced read succeeded"
  - "okx_order_gate is stricter than the carried TRADEPAGES wording: ok needs at least one OKX member with trades and a reading for every one, so an ok always satisfies the carried wording"

patterns-established:
  - "Take the type of a follow-up venue read from the pre-diagnostic call snapshot, never the live recorder list"

requirements-completed: [SC-1]

coverage:
  - id: D1
    description: "A refused OKX member carries one raw ordering reading from its forced pass's busiest instrument type, for an in-vocabulary refusal and for one outside the vocabulary, with the forced-pass counters unchanged"
    requirement: "SC-1"
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_allocator_history_probe.py#test_a_refused_okx_member_carries_an_ordering_reading"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_allocator_history_probe.py#test_the_refused_members_ordering_read_uses_the_forced_pass_instrument_type"
        status: pass
    human_judgment: false
  - id: D2
    description: "A raw ordering read that raises changes no member outcome and is recorded by allow-listed class only, never its message"
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_allocator_history_probe.py#test_a_raw_order_read_that_raises_leaves_the_refusal_and_names_its_class"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_allocator_history_probe.py#test_a_raw_order_read_that_raises_after_a_good_read_keeps_the_member_read"
        status: pass
    human_judgment: false
  - id: D3
    description: "Read, refused and cut-short OKX members take exactly one reading; Bybit members and OKX members that failed for any other class take none"
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_allocator_history_probe.py#test_a_truncated_okx_member_carries_an_ordering_reading"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_allocator_history_probe.py#test_no_raw_order_read_after_another_failure_or_on_a_bybit_member"
        status: pass
    human_judgment: false
  - id: D4
    description: "The summary's okx_order_gate is derived in code with violated first and absent evidence unmeasured, and the runbook P4 names the new fields"
    requirement: "SC-1"
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_allocator_history_probe.py#test_the_okx_order_verdict_puts_violated_first_and_absent_evidence_is_unmeasured"
        status: pass
      - kind: unit
        ref: "src/__tests__/marksource-okx-census-sql.test.ts (108 passed)"
        status: pass
    human_judgment: false
  - id: D5
    description: "SC-1 on the live worker: a4 prints one ordering reading and the deployed probe's summary reads okx_order_gate ok or violated"
    verification: []
    human_judgment: true
    rationale: "Needs the deployed probe run on the Railway worker (plan 03, an operator checkpoint); the raw GET's parameter form has never run live (RESEARCH A5)"

duration: 35min
completed: 2026-10-28
status: complete
---

# Phase 173 Plan 01: OKX ordering read on every arm that read trades Summary

**The allocator history probe now takes its raw OKX fills-history ordering reading on read, refused and cut-short OKX members alike (from the forced pass's own call snapshot), records a failing raw read by class without changing any member outcome, and prints a code-derived `okx_order_gate` on the summary.**

## Performance

- **Duration:** about 35 min (approximate; the start time was not captured at spawn)
- **Tasks:** 3 (1 tracer, 2 auto TDD)
- **Files modified:** 3
- **Commits:** 3 task commits (measured from the persisted ledger)

## Accomplishments

- Root cause removed. The raw `private_get_trade_fills_history` read lived in `_read_member` after the anchored rebuild read, and a refusal is raised at the END of that read. A refused member (a4) therefore carried the whole forced pass in its call snapshot and no ordering reading, which is why `okx_order_readings` stayed 0. The read now lives in one helper, `_okx_order_reading`, called from the success, refusal and truncated arms of `_probe_member`.
- The helper takes the instrument type from the `calls` SNAPSHOT taken before `_anchor_diagnostic`. The advisory pass of the diagnostic re-wraps the same client, so the live recorder list would also hold it and could pick another type; a test with an advisory pass of 90 rows on `futures` against a forced pass of 5 rows on `swap` pins that. The raw read is not wrapped by the recorder, so `trade_calls`, `trades_read`, `first_page_rows` and `okx_passes_ended_full` stay at the forced pass's values.
- A raw read that raises is reduced to `classify_failure(exc)` and printed as `okx_order_failure_class`; its message is never read. Tests plant `4321.5`, `signature=abc123` and venue text in the exception and assert none reaches stdout or stderr.
- New record fields, all declared, validated and defaulted: account `okx_order_failure_class` and `okx_members_with_trades`; summary `okx_order_readings`, `okx_members_with_trades` and `okx_order_gate`.
- `okx_order_verdict(violations, ended_full, readings, members_with_trades)`: `violated` when violations or full-page stops are above 0 (tested first), `ok` only when at least one OKX member read trades and every one carries a reading, `unmeasured` otherwise. Stricter than the carried TRADEPAGES plan 06 wording, so whenever it says `ok` that wording holds.
- Module docstring item 4 and the READ-ONLY paragraph describe the new behaviour; runbook pre-flight P4 names `okx_order_readings`, `okx_members_with_trades` and `okx_order_gate` (one hunk inside the P4 bullet).

## Task Commits

1. **Task 1 (tracer): a refused OKX member carries its ordering reading** - `eee903595` (feat)
2. **Task 2: read, refused and cut-short members take the same read; other arms none** - `7561fec2e` (feat)
3. **Task 3: `okx_members_with_trades`, `okx_order_gate`, docstring and runbook P4** - `8194ea988` (feat)

The tracer feedback gate ran as the task's own `<verify>` (the three named tests, the whole probe test file, probe mypy, CI's mypy line, and the awaited-call count of 1) and passed before Task 2 started.

## Behaviour change on an existing path (intended, tested)

In the success arm, a raw ordering read that raises no longer fails a member whose forced read succeeded. The member stays read, `okx_order_readings` does not count it, and `okx_order_failure_class` carries the class. `read_elapsed_s` now excludes the raw read on every arm (it means the forced pass). Pinned by `test_a_raw_order_read_that_raises_after_a_good_read_keeps_the_member_read`.

## Verification

- `tests/test_allocator_history_probe.py`: 99 passed (84 at the 173 base).
- `tests/test_allocator_history_probe.py tests/test_trade_pages.py tests/test_bybit_two_year_window.py`: 149 passed.
- Probe mypy (`scripts/allocator_history_probe.py`): `Success: no issues found in 1 source file`.
- CI's mypy line verbatim: `Success: no issues found in 127 source files`.
- `src/__tests__/marksource-okx-census-sql.test.ts` from the checkout root: 108 passed (the new P4 prose carries no uuid, home path or planning path). The temporary `node_modules` link was removed afterwards (`test ! -e node_modules` holds).
- Static pins stay green: `test_the_probe_source_calls_no_writer`, `test_the_probe_source_calls_no_venue_write`, `test_every_rebuild_name_the_probe_reads_is_declared` (no new `er.` attribute; `DEPLOYED_ER_NAMES` unchanged).
- Counts: `await _okx_order_reading(` 3, `private_get_trade_fills_history(` 1 (inside the helper), `okx_order_failure_class` 5, `okx_order_verdict(` 2 (definition and the `summarize` call).

## Mutation checks

Each neuter was applied to `analytics-service/scripts/allocator_history_probe.py`, the named test run and seen FAILING, then the file restored from a `cp -p` byte backup and compared with `cmp`; the whole file was run green afterwards. The m6 pair was applied after Task 3 on the final probe.

mutation-m1: red (test_a_refused_okx_member_carries_an_ordering_reading)
mutation-m2: red (test_the_refused_members_ordering_read_uses_the_forced_pass_instrument_type)
mutation-m3: red (test_a_raw_order_read_that_raises_leaves_the_refusal_and_names_its_class)
mutation-m4a: red (test_a_truncated_okx_member_carries_an_ordering_reading)
mutation-m4b: red (test_no_raw_order_read_after_another_failure_or_on_a_bybit_member)
mutation-m4c: red (test_no_raw_order_read_after_another_failure_or_on_a_bybit_member)
mutation-m6a: red (test_the_okx_order_verdict_puts_violated_first_and_absent_evidence_is_unmeasured)
mutation-m6b: red (test_one_raw_order_read_per_okx_member_on_its_busiest_inst_type)
restore: cmp clean

m1 = refusal arm passes `(None, "none")` instead of calling the helper. m2 = call moved after `_anchor_diagnostic` and fed the live recorder list. m3 = the helper's `except Exception` neutered so the raise escapes. m4a = truncated arm's helper call dropped. m4b = helper called for every exception class (fires on the auth case). m4c = the helper's `venue == "okx"` condition removed (fires on the Bybit cases). m6a = readings equality tested before the violated branch. m6b = every non-None `order` counted as a reading (the one-row answer, `field-absent`, then counts).

## Deviations from Plan

None - plan executed exactly as written.

Two small notes, neither a deviation: (1) the plan's truncated-arm test text named a Bybit site while the rebuild's typed sites are a closed set, so the Bybit truncated case uses the real typed site `bybit_segment_ceiling`; (2) in the `except Exception` arm the call and transfer lists became snapshot copies (`list(...)`) as the plan directed, so the awaited helper cannot see later appends.

## Issues Encountered

None that remain. One of the new tests first failed because it used a site token that is not in `er.TRUNCATED_READ_SITES` (the constructor raises `ValueError`, which the probe correctly reported as class `other`); fixed in the test before the Task 2 commit.

## Known Stubs

None.

## Threat Flags

None. The only new venue call is the existing raw GET moved into one helper (T-173-04); no new endpoint, auth path or schema.

## Notes for follow-ups

- The raw GET's parameter form (`instType`, `begin`, `end`, `limit` as strings) has never run live (RESEARCH A5). If OKX rejects it, the next live run prints a class in `okx_order_failure_class` and the gate stays `unmeasured`, not a false `ok`.
- `okx_members_with_trades` counts every OKX member whose forced pass read a trade, including one that then failed for a class that takes no reading (auth, network, timeout). Such a member keeps the gate `unmeasured` by construction.
- An existing comment in `test_a_truncated_bybit_read_names_the_window_ceiling_from_the_call_log` still says "the summary schema is unchanged"; the assertion beside it follows the declared keys and passes, only the comment is stale. Left alone as adjacent code.
- Plan 02 (Bybit half) edits the same two code files and runs after this plan.

## Self-Check: PASSED

- Files found: the probe, its test file and the runbook.
- Commits found as ancestors of HEAD: `eee903595`, `7561fec2e`, `8194ea988`.
- `grep -acE '^mutation-m[0-9a-z]+: red \(' ` on this file prints 8; `restore: cmp clean` present.
