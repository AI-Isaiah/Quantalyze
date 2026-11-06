---
phase: 174-markpause-a-paused-marked-series-stops-re-crawling-and-keeps
plan: 02
subsystem: analytics-service
tags: [navmtm, nav-marks, refusal-record, allocator_equity_derived, owner-only]
requires: []
provides:
  - NAV_MARK_REFUSAL_KIND_PREFIX row family in allocator_equity_derived
  - owner-only record of a refused mark (token, first_seen_day, last_seen_day)
  - runbook readout of the refusal rows
affects: [analytics-service/services/job_worker.py, analytics-service/services/nav_marks.py]
tech-stack:
  added: []
  patterns: [additive never-raises helper beside _persist_refused_key_capture]
key-files:
  created:
    - analytics-service/tests/test_nav_marks_refusal_record.py
  modified:
    - analytics-service/services/nav_marks.py
    - analytics-service/services/job_worker.py
    - analytics-service/tests/test_derive_broker_dailies_dualmode.py
    - docs/runbooks/navmtm-chain-move-go-live.md
key-decisions:
  - "D-02 as decided: no migration; payload is token + two ISO label days only"
  - "key mode keeps its existing key_inputs nav_mark_refusal echo beside the new row"
requirements-completed: [SC-2, SC-3]
status: complete
commits: 3
plan_head_before: 2941b367ac3766dde17d4759882d35d7b24b6295
plan_head_after: 48ac01b4116110d90e8e2f59ea40fb2478ef11c6
actuals:
  tokens: 14000
  tasks: 3
  commits: 3
---

# Phase 174 Plan 02: Private refusal record Summary

A refused mark's token and the day the pause began are now kept in an owner-only
`allocator_equity_derived` row (`nav_mark_refusal:<api_key_id>`), never in public
`data_quality_flags`, with a lifecycle (first-seen kept, cleared on a stored or found mark), a
never-raises write, and a runbook readout whose query shape is pinned by a test.

## What changed

- `nav_marks.NAV_MARK_REFUSAL_KIND_PREFIX = "nav_mark_refusal:"`.
- `job_worker._record_nav_mark_refusal` (validates the token against `MARK_REFUSAL_TOKENS`, reads the
  existing row, keeps its `first_seen_day`, upserts `{token, first_seen_day, last_seen_day}` on
  `allocator_id,kind`) and `_clear_nav_mark_refusal` (delete). Both never raise: one WARNING with
  the exception class name only.
- `_write_nav_mark_for_this_derive`: records on the refusal branch with
  `mark_day_for(_mark_read_at)`; clears on both paths that yield a mark (W3 found-mark early return
  and the store branch). The ineligible-venue `(None, None)` return touches nothing. Return values
  are unchanged.
- Runbook section "Mark refusals (Phase 174)" with a `mark-refusals` form (marker column first,
  token/day fields and a count, no allocator id, no key id).

## Tasks and commits

| Task | Commit | What |
|---|---|---|
| 1 (tracer) | b731c0a73 | prefix constant, recorder/clearer, seam wiring, tracer test |
| 2 | eab3eb6dd | lifecycle, 17-token public-flag pin, key mode, failed-write tests |
| 3 | 48ac01b41 | runbook readout, its pin, one existing test adjusted |

## RED evidence

- Base RED (tracer, unchanged job_worker): `FAILED tests/test_nav_marks_refusal_record.py::test_a_refused_strategy_mark_is_recorded_privately`
  on `assert aed.refusals() == {...}` (`{}` found). Log: `red-at-base.log`.
- Drills, each on a byte backup of `job_worker.py` (or the runbook), restored and `cmp` exit 0:

| Drill | Neuter | Turned FAILED | cmp |
|---|---|---|---|
| A | drop the `first_seen_day` carry-over | `test_a_second_refusal_keeps_the_first_seen_day` | 0 |
| B | remove the clearer on the store branch | `test_a_stored_mark_clears_the_record`, `test_a_mark_found_already_stored_clears_the_record` | 0 |
| C | stamp the token into the strategy_analytics prestamp flags | all 17 `test_no_refusal_token_reaches_public_flags[*]` | 0 |
| D | recorder re-raises | `test_a_failed_record_write_does_not_change_the_derive` | 0 |
| E (extra) | remove only the W3 found-mark clear | `test_a_mark_found_already_stored_clears_the_record` | 0 |
| F | runbook prefix changed to `nav_mark_refusals:%` | `test_the_runbook_readout_selects_the_worker_prefix` | 0 |

- Parametrized public-flag cases collected: 17, equal to `len(MARK_REFUSAL_TOKENS)` (read, 17).

## Verification

- Quick run (refusal record + derive_apply + writer): 76 passed.
- Full analytics suite, final run: `12949 passed, 96 skipped, 1096 warnings in 653.73s`. The 96 skips
  are pre-existing; none are in this plan's files.
- CI mypy line verbatim: `Success: no issues found in 123 source files` (sources unchanged after this run).

## Deviations from Plan

**1. [Rule 1 - consequence of the change] Existing key-mode NAV-fault test adjusted**
- **Found during:** Task 3 full suite.
- **Issue:** `test_derive_broker_dailies_dualmode.py::TestNavReconstructionErrorPermanentCatch::test_nav_error_permanent_key_mode_no_stamp`
  asserted `capture["upserts"] == []`. Its mocked Binance exchange yields an unreadable mark, so the
  new private refusal note (written before the combine) is now one upsert.
- **Fix:** the assertion excludes the `nav_mark_refusal:` kind only; every other table must still be
  untouched. File not in the plan's `files_modified`.
- **Commit:** 48ac01b41

**2. Extra test beyond the plan:** `test_a_mark_found_already_stored_clears_the_record` (Bybit W3
found-mark path) with its own drill E, since the plan's drill B only covered the store branch.

**3. Environment:** one full-suite run hit `No space left on device` (host disk at 100%) and produced
38 ENOSPC errors plus one timing assertion; the affected files passed on rerun and a clean full run
is the one quoted above. Not caused by this plan.

## Notes for the orchestrator

- The `kind` prefix is matched with `LIKE 'nav_mark_refusal:%'`; `_` is a LIKE wildcard, harmless
  here.
- Every derive of an eligible key now issues one DELETE on `allocator_equity_derived` when it stores
  or finds a mark (as the plan specified). Healthy keys pay one extra no-op write call per derive.
- No SQL, migration, census, VERSION, CHANGELOG, STATE or ROADMAP change.

## Known Stubs

None.

## Threat Flags

None. T-174-05 to T-174-08 are mitigated and pinned (drills C, D, B, A/F).

## Self-Check: PASSED

Created/modified files exist; commits b731c0a73, eab3eb6dd and 48ac01b41 are ancestors of HEAD.
