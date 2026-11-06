---
phase: 186-derivegaps-the-per-key-derive-refuses-a-truncated-or-failed
plan: 11
subsystem: analytics-service compose wiring
tags: [allocator-equity, failing-key, read-incomplete, departed-key, d-03, d-07, d-08, sc-4, sc-6]
status: complete

requires:
  - phase: 186-04
    provides: "gate: proceed; q-shared: book"
  - phase: 186-07
    provides: "compose_allocator_equity(failing_key_exit_by_key=...), payload failing_key_exits"
  - phase: 186-09
    provides: "READ_INCOMPLETE_KIND_PREFIX and the read_incomplete:<api_key_id> marker rows"
provides:
  - "services/job_worker.py: _load_read_incomplete_markers (marked_ids), the failing/marked exit through departed_end_by_key, failing_key_exit_by_key passed to the compose, the COMPOSE_INCOMPLETE exemption, the failing/marked inputs-without-returns drop"
  - "derive_refusal_rows.json legacy_blocking list; writer_residual_resolution.json cells with derive.failing_key_exits"
affects: [186-12, 186-14]

plan_head_before: 964206ce3d6841b97a07b21c8e31953d924b6464
plan_head_after: e93b77c220d542438fe6039270db2c7a3fa7e272
commits: 2

actuals:
  tokens: 13200
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns: [reuse the departed path for a new kind of exit, name-only side map beside it, retired token kept as a legacy enum member]

key-files:
  modified:
    - analytics-service/services/job_worker.py
    - analytics-service/services/allocator_equity_derive.py
    - analytics-service/tests/test_derive_allocator_equity_job.py
    - analytics-service/tests/test_derive_refusal_rows.py
    - analytics-service/tests/test_writer_residual_parity.py
    - analytics-service/tests/fixtures/derive_refusal_rows.json
    - analytics-service/tests/fixtures/writer_residual_resolution.json

key-decisions:
  - "D-03 (founder 2026-11-01) and D-08 (founder 2026-11-03) win over RESEARCH 'Gap 3 detail': a failing or marked key with a key_inputs row and no return day now LEAVES the compose and is named with day null, instead of keeping the blocking dropped_key. A WORKING unmarked key with inputs and no returns keeps dropped_key."
  - "D-07 (Discretion 3): the exit is the existing departed path (departed_end_by_key) on BOTH compose inputs, the primary and the no-capital fallback's stored copy. The compose got only the name."
  - "FAILING_KEY_SERIES_ENDED stays a DegradeReason member (stored PROD rows carry it until the daily recompute) but is no longer blocking and is never raised."

requirements-completed: [SC-4, SC-6]
---

# Phase 186 Plan 11: A failing or refused key affects only itself Summary

A single eligible key that is failing, or whose last derive was refused by name (a `read_incomplete:` marker), and whose series ends before the book's last return day now leaves the book on its last good day through the departed path and is named in `failing_key_exits`; no degrade reason is raised, so the rest of the curve stays trustworthy.

## What was built

- `_load_read_incomplete_markers` beside `_load_key_inputs`: `marked_ids` from `allocator_equity_derived` rows `like read_incomplete:%`. The orphan cleanup stays on `key_inputs:` rows only.
- The old `failing_series_ended_keys` count is replaced by the exit. Guards kept (single eligible member, counted, not already in `departed_end_by_key`, `len(_eligible_members) != 1` for shared groups). A failing or marked member ending before the book's last day goes into `departed_end_by_key` and into `no_capital_stored.departed_end` (so a re-compose after a no-capital refusal cannot re-admit it flat) and is named `(sync_failing | read_incomplete, last_return_day)`. A marked member reaching the last day stays in and is named with that day. One counts-only WARNING.
- `COMPOSE_INCOMPLETE`: a failing or marked key with neither returns nor `key_inputs` is exempt and named `day: null`. A WORKING unmarked one still refuses (backfill stays self-healing).
- Failing or marked key with a `key_inputs` row and no returns: dropped from the six per-key maps of BOTH compose inputs, named `day: null`, no `dropped_key`.
- The retired token's raise is removed from `degrade_reasons=[...]` and `failing_key_exit_by_key=failing_key_exit_by_key or None` is passed to the one `_compose` call that serves both composes.
- `FAILING_KEY_SERIES_ENDED` left `_BLOCKING_REASONS`; its comment says why it is kept (stored rows).

## The D-03 change to the 167.1.2.1.1 pin (named, not silent)

`test_sc2_failing_key_with_inputs_but_no_returns_raises_no_keyerror` pinned the blocking `dropped_key` for a failing key with inputs and no returns, and RESEARCH "Gap 3 detail" recommended keeping it. D-03 ("Only that key") and D-08 (founder 2026-11-03, "Leave the book, named") govern that population, so the test is rewritten as `test_sc2_failing_key_with_inputs_but_no_returns_leaves_the_book_and_is_named` and a WORKING unmarked key keeps `dropped_key` (`test_sc2_working_key_with_inputs_but_no_returns_keeps_dropped_key`).

## Tests

Rewritten: `test_sc2_failing_single_key_ending_early_exits_the_book_and_is_named` (the oracle), `test_sc2_failing_key_recovering_composes_normally_and_names_nothing`, `test_sc2_failing_key_with_inputs_but_no_returns_leaves_the_book_and_is_named`. The old `..._blocks`, `..._raises_no_keyerror` names are gone.
New: `test_sc2_read_incomplete_working_key_exits_and_is_named`, `test_sc2_marked_key_that_reaches_the_books_last_day_stays_in_and_is_named`, `test_sc2_failing_key_never_derived_is_exempt_and_named_without_a_day`, `test_sc2_working_key_never_derived_still_refuses_the_compose`, `test_sc2_marked_key_with_inputs_but_no_returns_leaves_the_book_and_is_named`, `test_sc2_working_key_with_inputs_but_no_returns_keeps_dropped_key`, `test_sc2_lone_failing_never_derived_key_is_an_empty_refusal_not_a_curve`, `test_sc2_failing_key_exit_survives_the_no_capital_fallback_compose`, and `test_a_legacy_blocking_token_is_a_degrade_reason_that_is_no_longer_blocking`.

Oracle (hand-computed, independent of the compose): A failing, anchor 40,000, r = 0 on days 1 to 3; B working, anchor 60,000, r = +1% on days 1 to 5. After A leaves, the book is B, so days 4 and 5 read exactly +1.00% (within 1e-12), the curve is trustworthy, and A is named with day 3.

Fixtures: `derive_refusal_rows.json` `blocking` loses `failing_key_series_ended`, a new `legacy_blocking` list holds it (the precedence row naming it stays; the reader still maps a stored one). `writer_residual_resolution.json`: cell `sc2-failing-key-ends-two-days-early` is now `blocking_tokens: []`, trustworthy, reader `ready`, with `derive.failing_key_exits`; new cells `sc2-read-incomplete-working-key-exits` (key flag `read_incomplete: true`) and `sc2-failing-key-never-derived-is-named` (`days: 0`, `inputs: false`). The Python runner seeds the marker row and omits the inputs row accordingly and asserts the payload's `failing_key_exits` equals the cell's.

## RED evidence

- Task 1: `red-11-1.log`, 8 of the 13 sc2 tests FAILED on today's code (the oracle read 0.005952 instead of 0.01, `failing_key_exits` absent, `compose_incomplete` for the never-derived key, `dropped_key` for inputs-without-returns, the fallback compose lacking key-C). Neuter 1: the `departed_end_by_key[_member_id] = _member_last` line removed, 3 tests FAILED (oracle, read-incomplete, fallback), restored and `cmp` equal (`neuter-11-1.log`). Neuter 2: the `no_capital_stored.departed_end[...]` line removed, the fallback test alone FAILED, restored.
- Task 2: `red-11-2.log`, with the cells changed before the runner, the coverage test FAILED and the never-derived cell crashed the runner. Neuter: re-adding the token to `_BLOCKING_REASONS` failed the one-row-per-blocking-reason test and the new legacy test; restored byte-equal.

## Verification

- Plan targets plus every file importing the changed modules (`test_derive_allocator_equity_job.py`, `test_allocator_equity_failing_key_exit.py`, `test_allocator_equity_no_capital_exit.py`, `test_allocator_equity_departed.py`, `test_derive_refusal_rows.py`, `test_writer_residual_parity.py`): green.
- Full suite `python -m pytest -q -n auto --dist loadgroup` from `analytics-service/`: `13725 passed, 97 skipped, 0 failed`.
- CI mypy line, verbatim: `Success: no issues found in 131 source files`.

## Deviations from Plan

**1. [Rule 2 - note] Lone exempt key.** When EVERY counted key is exempt (a lone failing never-derived key), nothing is left to compose and the existing `compose_empty` refusal records (untrustworthy, no curve). Pinned by `test_sc2_lone_failing_never_derived_key_is_an_empty_refusal_not_a_curve`. No code beyond the plan.

**2. Backup naming.** The plan's `job_worker.11.bak` is the byte copy of the finished code used for the neuter `cmp`; the pre-change copy is `job_worker.11.orig` in `$DG_SP`.

Otherwise none: executed as written.

## Cross-runtime note for plan 186-12

Both shared JSON fixtures are read by TS tests (`src/lib/__tests__/derive-refusal-rows.test.ts`, `src/__tests__/accounttruth-census.test.ts`, `src/lib/__tests__/writer-residual-parity.test.ts`). They changed here; there is no node_modules in this worktree, so TS parity (a `legacy_blocking` mapping assertion, `derive.failing_key_exits`, and the new per-key cell fields `read_incomplete` and `inputs`) is plan 186-12's job. The census test iterates `blocking`, which no longer lists the token.

## Known Stubs

None.

## Threat Flags

None. The compose logs carry counts only (T-186-29); every exit and exemption is named (T-186-28); the exit runs on both compose inputs (T-186-27).

## Self-Check: PASSED

- FOUND commits 0f52be502 and e93b77c22 on agent-186-p11
- FOUND: the `failing_key_exit_by_key=` call in services/job_worker.py, `legacy_blocking` in derive_refusal_rows.json, `failing_key_exits` in writer_residual_resolution.json
- `grep -n 'len(_eligible_members) != 1'` still prints the shared-account guard
