---
phase: 180-bybitfunding-read-bybit-internal-and-sub-account-transfers-s
plan: 01
subsystem: analytics-service / allocator history probe
tags: [bybit, probe, funding-evidence, read-only, redaction]
requires: []
provides:
  - "scripts/bybit_funding_record.py: five Bybit evidence reads (on-chain deposits, internal deposits, withdrawals type 2, inter-account transfers, universal transfers) plus the key's master/sub and UTA flags, as counts, closed age buckets and closed state tokens"
  - "tests/_bybit_evidence.py: EvidenceBook, a Bybit-faithful double for the five asset GETs and query-api"
  - "the probe's account record carries bybit_evidence_members and 33 bybit_* funding keys, taken after the member's snapshot"
affects: [180-02, 180-03]
tech-stack:
  added: []
  patterns: ["record module spliced into the probe (as okx_chain_record)", "walk_paginated per window, newest window first, stop at first failure"]
key-files:
  created:
    - analytics-service/scripts/bybit_funding_record.py
    - analytics-service/tests/_bybit_evidence.py
    - analytics-service/tests/test_bybit_funding_record.py
  modified:
    - analytics-service/scripts/allocator_history_probe.py
    - analytics-service/tests/test_allocator_history_probe.py
key-decisions:
  - "Funding keys are spliced BEFORE the chain keys, not after (see Deviations): two existing pins hold the chain keys as the tail of ACCOUNT_RECORD_KEYS."
  - "A success row with an unreadable stamp makes that whole source malformed with field-absent counts; a stamp is never invented."
  - "Rows are counted once per id (an id-less row counts each time); a key-info flag is a boolean only when the answer is exactly a boolean."
status: complete
commits: 2
plan_head_before: 7342b74341de6b64571476cf29b5195295851827
plan_head_after: f20c1d6e1b66458ba0ad87a199de6fa133ac74a8
actuals:
  tokens: 13073
  tasks: 2
  commits: 2
metrics:
  completed: 2026-10-28
requirements-completed: [SC-1]
---

# Phase 180 Plan 01: Bybit funding evidence in the allocator history probe Summary

The probe now names how a Bybit account was funded, read-only: five evidence sources and the key's master/sub and UTA flags, printed per account as counts, closed age buckets and closed state tokens, with no id, amount or stamp leaving the process.

## What was built

- `analytics-service/scripts/bybit_funding_record.py` (new). `EVIDENCE_SOURCES` holds the five sources in docs order (`onchain_dep`, `internal_dep`, `withdraw_all`, `inter_xfer`, `universal_xfer`) with the plan's endpoint facts. Each source is read newest window first, one `walk_paginated` call per window (29-day windows for the three record endpoints, 7-day for the two transfer lists), stopping at its first failure. The windows already read keep their rows; `depth_bucket` says how far back the source answered. `FUNDING_KEYS` is 33 keys: `bybit_key_info_state`, `bybit_is_master`, `bybit_is_uta`, then six per source (`rows`, `older_365d`, `oldest_age_bucket`, `other_status_rows`, `depth_bucket`, `state`). Counts are field-absent unless a window was answered, so a failed source never reads as an empty one (D-03). `read_key_info` reads `isMaster` and `uta` strictly as booleans and keeps nothing else. A master-only source (`withdraw_all`) is not called when `isMaster` is exactly `false` and prints `not-master`. Each source runs under `EVIDENCE_SOURCE_TIMEOUT_S` (420.0), so a timeout is the state `Timeout` and the next source still runs. `INFLOW_SOURCE_NAMES` is exported for plan 03.
- `analytics-service/tests/_bybit_evidence.py` (new). `EvidenceBook` mirrors the vendor span rules (record endpoints under 30 days, transfer lists at most 7, else `ccxt.BadRequest`), newest-first rows, `min(limit, 50)` per page and an opaque offset cursor. It hard-codes the endpoint facts independently of the code under test. Effects: exception, `malformed`, `repeat`, `hang`.
- `analytics-service/scripts/allocator_history_probe.py`: the splice (`bybit_evidence_members` plus `FUNDING_KEYS`, validators, defaults), `_MemberResult.funding`, and `_bybit_funding_evidence`, called after the snapshot (`elapsed_s`) and the ordering read on the read arm, on the `ForcedRebuildRefusedError` arm (both returns), and on the generic arm only when `truncated`. Never after another failure; never for an OKX member.

## Tests

- New file `tests/test_bybit_funding_record.py`: 26 collected tests (the six named tests in the plan, plus a key-info-unreadable test, a malformed-page parametrization, an unreadable-stamp test, a sources/ordering test and a defaults/validators test).
- `tests/test_allocator_history_probe.py`: +7 collected (`test_a_bybit_members_onchain_deposit_evidence_reaches_the_account_record`, and `test_the_evidence_runs_after_the_snapshot_and_changes_no_member_outcome` x6 arms: read, refused, refused off-vocabulary, cut short, rejected by the venue, OKX member). The probe file went from 126 to 133 passing.
- Final run: `tests/test_bybit_funding_record.py tests/test_allocator_history_probe.py tests/test_okx_chain_record.py` -> 261 passed, 0 skipped.
- CI mypy line (verbatim, from `analytics-service/`): `Success: no issues found in 130 source files`. Probe and module mypy: `Success: no issues found in 2 source files`. Import check printed `splice-ok`. `grep -ac '_bybit_funding_evidence(' scripts/allocator_history_probe.py` prints 4 (definition, success, refusal, truncated).

## Mutation checks

Each: byte backup with `cp -p`, neuter, named test RED, restore from the backup, `cmp` clean, whole files green (261 passed).

- tracer (extra): the success arm passes `funding=None` instead of `funding=funding`: `test_a_bybit_members_onchain_deposit_evidence_reaches_the_account_record` red (`assert 'field-absent' == 3`). restore: cmp clean
- mutation-m1: red (`test_each_evidence_source_reads_its_own_endpoint_window_and_success_status[onchain_dep]`: `assert 6 == (3 + 1)` with the status filter dropped). restore: cmp clean
- mutation-m2: red (`test_a_source_the_key_cannot_read_is_a_state_never_a_count`: `assert 'read' == 'PermissionDenied'` when a raising source is recorded as `read` with an empty sink). restore: cmp clean
- mutation-m3: red (`test_a_master_only_source_is_not_called_for_a_sub_key`: 26 `withdraw_all` calls where `[]` was expected). restore: cmp clean
- mutation-m4: red (`test_the_evidence_runs_after_the_snapshot_and_changes_no_member_outcome[read-...]`: `assert 144500 == 0` for `read_elapsed_s` with the evidence moved above `elapsed_s = _elapsed()`). restore: cmp clean

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Funding keys spliced before the chain keys, not after**
- **Found during:** Task 2, running the plan's "After the plan" verification (`tests/test_okx_chain_record.py`).
- **Issue:** The plan says to splice the funding keys after `*okx_chain_record.CHAIN_KEYS`. Two existing pins (`test_the_chain_keys_are_the_tail_of_the_probes_record_keys`, `test_the_chain_vocabulary_is_fifty_nine_keys_and_the_tail_of_the_probe`) hold the chain keys as the tail of `ACCOUNT_RECORD_KEYS`, on purpose (Phase 173 edits the middle of the structures so the merges stay clean). The Task 1 commit followed the plan's order and broke those two pins; Task 1's own verify did not run that file.
- **Fix:** Placed `bybit_evidence_members` and `*FUNDING_KEYS` immediately before `*CHAIN_KEYS` in the key tuple, the validator dict and the defaults, with a comment. Two conflicting patterns, one picked: the existing, tested one. Record key order is whitelist order only; nothing reads it positionally.
- **Files modified:** `analytics-service/scripts/allocator_history_probe.py`
- **Commit:** f20c1d6e1 (so `dd08c4a8f` alone has those two OKX pins red; the pair is green together).

**2. [Plan detail, no behaviour change] Where an unreadable stamp is handled**
- The plan has `_source_values` raise `EvidenceShapeError` on a success row whose stamp is not an int or a string of digits. `measure_funding` catches that and re-derives the source's values as `malformed` with field-absent counts, so the exception never escapes and earlier windows of that source are not reported as trustworthy counts. Pinned by `test_a_success_row_without_a_readable_stamp_is_malformed_never_invented`.

Otherwise the plan was executed as written. Task 1's tracer gate (re-run of `<verify>` end to end) passed before expansion.

## Known Stubs

None.

## Threat Flags

None. All new surface is read-only GETs through the existing ccxt client, and every printed field passes `FUNDING_VALIDATORS` and `emit_record`. The tracer and unit tests assert that no `fake-transfer` id, stamp digits, `fake-userid` or `fake-parentuid` value reaches stdout, stderr or the result (plan 02 adds the fully populated leak test and the read-only pin on the new module).

## Notes for plans 02 and 03

- `SOURCE_STATES`, `KEY_INFO_STATES`, `EVIDENCE_PAGE_CAP` and `EVIDENCE_SOURCE_TIMEOUT_S` are module attributes read at call time, so tests lower them by `monkeypatch.setattr`.
- The Timeout case and the ceiling case (cap lowered to 3, and a repeated cursor) are already pinned here; plan 02's remaining work is the census, the leak test and the read-only pin on `bybit_funding_record.py`.
- The new module does not call a dict's update method and has no `withdraw(` or `transfer(` call, so plan 02's source pins can be applied to it as is.
- Existing Bybit probe tests whose stub venue lacks the evidence GETs now record a source state of `other` (an `AttributeError` classified by class); none of them asserts on the funding keys.

## Self-Check: PASSED

- FOUND: analytics-service/scripts/bybit_funding_record.py, analytics-service/tests/_bybit_evidence.py, analytics-service/tests/test_bybit_funding_record.py
- FOUND commits: dd08c4a8f, f20c1d6e1 (both ancestors of HEAD)
- STATE.md and ROADMAP.md untouched; VERSION, package.json, CHANGELOG.md and TODOS.md untouched.
