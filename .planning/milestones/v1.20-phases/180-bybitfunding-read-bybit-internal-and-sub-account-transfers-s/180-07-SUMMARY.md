---
phase: 180-bybitfunding-read-bybit-internal-and-sub-account-transfers-s
plan: 07
subsystem: analytics-service / allocator history rebuild
tags: [bybit, unified-transaction-log, refusal-vocabulary, classifier, data-integrity]
requires: ["180-06"]
provides:
  - "services/equity_reconstruction.py: the refusal wrapper round fetch_bybit_unified_flows; the 17th token account_flow_source_unreadable in FORCED_REBUILD_ACCOUNT_REASONS"
  - "services/job_worker.py: classify_exception arm making BybitUnifiedFlowReadError permanent (static text)"
  - "docs/runbooks/marksource-okx-history-correction.md: B'3 rule 3 with 17 tokens"
affects: [180-08]
tech-stack:
  added: []
  patterns: ["closed refusal vocabulary moved in one commit (token, both len pins, raise-site scan, probe literal, runbook list)", "classifier arm in the Mt5GatewayMisconfigured shape"]
key-files:
  modified:
    - analytics-service/services/equity_reconstruction.py
    - analytics-service/services/job_worker.py
    - analytics-service/tests/test_reconstruct_force_rebuild.py
    - analytics-service/tests/test_bybit_two_year_window.py
    - analytics-service/tests/test_job_worker.py
    - docs/runbooks/marksource-okx-history-correction.md
key-decisions:
  - "D-03: a forced Bybit rebuild whose Unified flow read the venue refuses (AuthenticationError, PermissionDenied, BadRequest) or the reader refuses (BybitUnifiedFlowReadError) raises ForcedRebuildRefusedError(\"account_flow_source_unreadable\") from None and writes nothing; transient ccxt classes propagate as the same object."
  - "Orchestrator reading 2 (behaviour change): an UNFORCED Bybit rebuild whose Unified flows cannot be read fails PERMANENT with nothing written and does NOT fall back to the on-chain pair."
  - "The two-year guard stays above and outside the wrapped call, so a crawl begun before UTC midnight keeps account_key_read_failed."
status: complete
commits: 2
plan_head_before: 3cdeb565f6bdd353426cfd64ff8492e9ec97b093
plan_head_after: e3f4b92b389d4e41795d1f2de2c29f3a692805a8
actuals:
  tokens: 30000
  tasks: 2
  commits: 2
metrics:
  completed: 2026-10-29
requirements-completed: [SC-2]
---

# Phase 180 Plan 07: Refuse an unreadable Bybit flow source, forced and unforced Summary

A forced Bybit rebuild that cannot read its Unified flows now refuses by a closed, pinned name and writes nothing, an unforced one fails permanently instead of being retried, and a transient fault on the log stays retryable.

## What was built

- `services/equity_reconstruction.py`: the `fetch_bybit_unified_flows` call of `_fetch_and_price_window` sits in a `try` that catches only `ccxt.AuthenticationError`, `ccxt.PermissionDenied`, `ccxt.BadRequest` (the set `classify_exception` calls permanent) and `BybitUnifiedFlowReadError`. With `require_anchor` it raises the literal `ForcedRebuildRefusedError("account_flow_source_unreadable") from None` (static text, venue exception not chained); otherwise it re-raises unchanged. The two-year guard is above the `try`. The token is the 17th member of `FORCED_REBUILD_ACCOUNT_REASONS`; the comment block above the sets says "these 17 tokens" and carries a dated Phase 180 paragraph.
- `services/job_worker.py` (one import line, one classifier arm, one module-docstring table row, nothing else): `if isinstance(exc, BybitUnifiedFlowReadError): return ("permanent", str(exc)[:500])` directly after the `Mt5GatewayMisconfigured` arm. The docstring row names the class without the module path so plan 06's line-by-line scope pin (`test_only_the_rebuild_reads_the_unified_flows`) still holds; it passes.
- Runbook B'3 rule 3: 17 tokens; `account_flow_source_unreadable` joins "Record only, no re-run" (for these 9) with a note that it clears only when the key's permissions change; `account_key_read_stalled` joins "Re-enqueue ONCE" (for these 8).

## Behaviour change (orchestrator reading 2; for the CHANGELOG)

Unforced reconstruct when the Unified log cannot be read: fail loud as a PERMANENT error with nothing written; no fallback to the on-chain deposit/withdraw pair. The error reaches the job's generic arm and `classify_exception` calls it permanent for the ccxt permanent classes and for `BybitUnifiedFlowReadError` (a stalled cursor, a malformed answer, an unreadable row, the page ceiling), so the queue no longer retries a fault no retry can clear (about 210 requests per retry). `RateLimitExceeded`, `NetworkError` and `RequestTimeout` still retry. A Bybit key lacking the permission no longer gets the old on-chain-only first backfill.

## Runbook drift found and fixed

B'3 rule 3 said 15 tokens and listed 7 re-enqueue + 8 record-only, while the code already held 16: Phase 171's `account_key_read_stalled` was never added to the runbook (its own lineage comment says the handoff lists it with the re-enqueue-once tokens). Fixed together with the new token; `test_the_runbook_lists_every_refusal_token_once` now pins the runbook to the code (count, per-list counts, disjointness, union equals the set).

## Tests

- New in `tests/test_reconstruct_force_rebuild.py`: `test_a_forced_bybit_read_whose_flow_source_is_unreadable_refuses_by_name` (7 cases: three ccxt classes plus the reader's four causes), `test_a_forced_bybit_job_on_an_unreadable_flow_source_fails_permanent_and_writes_nothing` (job level through `_assert_forced_rebuild_refused(..., crawled=False)`), `test_a_transient_flow_source_fault_is_not_a_refusal` (3), `test_an_unforced_bybit_read_hit_by_a_permission_error_propagates_it_unchanged`, `test_an_unforced_bybit_read_whose_flow_source_is_unreadable_fails_loud_and_writes_nothing` (5: PermissionDenied plus the reader's four causes, produced by the real reader through `install_unified_log(repeat_cursor / wrong_type)`, a non-dict answer and a lowered `UNIFIED_FLOW_PAGE_CAP`), `test_an_unforced_transient_flow_fault_still_retries` (3), `test_the_runbook_lists_every_refusal_token_once`. The closed-set pin now reads 17, asserts `hp._FLOW_SOURCE_REFUSAL in account` (plan 03's request) and that `hp.emit_record` accepts a record carrying it.
- `tests/test_bybit_two_year_window.py`: `test_the_two_year_refusal_adds_no_token` reads 17; new `test_the_two_year_guard_runs_before_the_flow_read_and_outside_its_refusal`.
- `tests/test_job_worker.py`: `test_a_bybit_unified_flow_read_error_is_permanent`.
- Task 1 verify (seven named tests and seven files): 421 passed. Task 2 (four files): 236 passed, 1 skipped (the existing `TEST_SUPABASE_DB_URL` live-DB test).
- CI's mypy line, verbatim from `analytics-service/`: `Success: no issues found in 131 source files`; the probe/module mypy line: `Success: no issues found in 2 source files`. The deployed import check prints exactly `0 17 True True True True True True`; `grep -acF 'ForcedRebuildRefusedError("account_flow_source_unreadable")'` prints 1; `isinstance(exc, BybitUnifiedFlowReadError)` appears once in `job_worker.py`.
- FULL analytics corpus, once, from `analytics-service/` (`-n auto --dist loadgroup -q -rs`): **13921 passed, 102 skipped, 0 failed**. The skips are the same 102 as plan 06's run (none added; all existing live-DB or TODO skips). Not run: the `--cov` phase-gate form with `--cov-fail-under=80`; CI's `python` job bound to the PR head SHA is the binding coverage reading. The venv is the main checkout's (ccxt 4.5.85; the repo pins 4.5.88).

## Mutation checks

Each: byte backup with `cp -p`, neuter, named test RED, restore from the backup, `cmp` clean, whole file green.

mutation-m1: red (`test_forced_rebuild_refusal_reasons_are_a_closed_set`: `tokens without a raise site: ['account_flow_source_unreadable']` with the token raised through a variable). restore: cmp clean
mutation-m2: red (`test_a_transient_flow_source_fault_is_not_a_refusal[RateLimitExceeded]` and `[NetworkError]` (RequestTimeout too): the caught tuple widened to `Exception`, the refusal replaced the propagated object). restore: cmp clean
mutation-m3: red (`test_the_two_year_guard_runs_before_the_flow_read_and_outside_its_refusal`: `ForcedRebuildRefusedError: forced rebuild refused (account_flow_source_unreadable)` with the guard moved inside the wrapped `try`). restore: cmp clean
mutation-m4: red (`test_the_runbook_lists_every_refusal_token_once`: `assert 9 == 8`, the record-only count against its token list, with the token removed from the list). restore: cmp clean
mutation-m5: red (`test_an_unforced_bybit_read_whose_flow_source_is_unreadable_fails_loud_and_writes_nothing[PermissionDenied]` and the four reader cases: the unforced message carried `forced rebuild refused (account_flow_source_unreadable)` with the raise made whatever `require_anchor` is). restore: cmp clean
mutation-m6: red (`test_an_unforced_bybit_read_whose_flow_source_is_unreadable_fails_loud_and_writes_nothing[non_dict_answer|repeated_cursor|wrong_type|page_ceiling]`: `error_kind='unknown'`, and `test_a_bybit_unified_flow_read_error_is_permanent`: `assert 'unknown' == 'permanent'` with the classifier arm deleted). restore: cmp clean

## Deviations from Plan

None to the code. Notes that are not deviations:

- The unforced PermissionDenied case asserts `permanent` but not the absence of the venue text: that text path is the existing ccxt arm of `classify_exception` (scrubbed only in the log), unchanged here. The static-text guarantee is asserted for the forced refusal and the reader's own error.
- m4's RED comes from the per-list count check (`9 == 8`); the union check would also fail.
- The Task 1 commit carries the forced tests, the pins and the runbook; the unforced tests were added in the Task 2 commit with the classifier arm, so each commit is green on its own.

## Known Stubs

None.

## Threat Flags

None. T-180-19, T-180-20, T-180-21, T-180-22 and T-180-31 are mitigated with m1 to m6 seen RED; T-180-23: the refusal text is static and `from None` drops the venue exception.

## Self-Check: PASSED

- FOUND: the six modified files; commits 1169ec2b5 and e3f4b92b3 are ancestors of HEAD.
- `grep -acE '^mutation-m[0-9]+: red \('` on this file prints 6.
- STATE.md, ROADMAP.md, VERSION, package.json, CHANGELOG.md, TODOS.md, `broker_dailies.py`, `okx_archive_job.py` and `scripts/` untouched; no migration.
