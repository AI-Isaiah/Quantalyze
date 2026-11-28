---
phase: 259-okxarchivefills-okx-fills-older-than-fills-history-s-3-month
plan: 05
subsystem: analytics-service / OKX archive fills job (read path)
tags: [okx, archive, fills, compute_jobs, calibrate, reconcile, bal-chain, mypy]

requires:
  - phase: 259-03
    provides: "`WRITE_BOUND_MARGIN_MS` (the one definition), `FILLS_APPLY_MODE`"
  - phase: 259-04
    provides: "`map_trade_bills`, `archive_census`, `reconcile_window`, `legacy_subset`, `FillsMapError`"
provides:
  - "`run_okx_archive_fills_job`: the fills modes' handler and read path; `fills_calibrate` runs every gate and writes nothing"
  - "a one-hunk lazy-import fork at the top of `run_okx_archive_rebuild_job`"
  - "`plan_fill_quarters`, the in-claim target discovery, the GET-only status reader, the stored-fill reader"
  - "`tests/_okx_archive_fills_fakes.py`: shared fakes for plans 05, 06 and 07"
affects: [259-06, 259-07, 259-08, 259-09]

status: complete
commits: 3
plan_head_before: 648819de24163ca162f5256549a1ac0f136174c6
plan_head_after: 24036e0b5074cfebf06f548767493a2c9ebeb38b

actuals:
  tokens: 21700       # chars/4 over the three new files (85680 chars) plus the fork diff (1145 chars)
  tasks: 2
  commits: 3

tech-stack:
  added: []
  patterns:
    - "a second exception type and finisher for stop classes the rebuild's pinned closed set must not learn"
    - "seams read off the imported job module at call time so one patch reaches both handlers"
    - "all targets evaluated, the first reconcile miss raised after every reading is in the result"

key-files:
  created:
    - analytics-service/services/okx_archive_fills.py
    - analytics-service/tests/_okx_archive_fills_fakes.py
    - analytics-service/tests/test_okx_archive_fills_job.py
  modified:
    - analytics-service/services/okx_archive_job.py

key-decisions:
  - "`fills_apply` runs the same read path and ends where `fills_calibrate` does (`info.outcome` `read_complete`) until plan 07 adds the write at the marked seam. The two plans must ship together: a `fills_apply` that ends DONE without a write would also start the chain's 14-day cooldown."
  - "The unread-span reason `over_cap` starts at max(lowest anchor, the 2021 Q1 cut start), not at the lowest anchor, so a pre-2021 anchor is named once (`pre_archive`) and not twice."
  - "An empty `fill_strategy_ids` list is `invalid_input` (it would narrow the targets to nothing), duplicates are collapsed."
  - "In override mode a run of derived quarters the operator did not request is one `not_requested` span from max(lowest anchor, run start) to min(run end, write bound)."
  - "A reconcile quarter that starts exactly at the write bound has role `reconcile`; one that also meets the write window is `write_reconcile`; an override quarter outside both is `out_of_window`."

requirements-completed: [SC-1, SC-2, SC-3]

coverage:
  - id: D1
    description: "A fills_calibrate job through dispatch reads two finished quarters, gates, maps, reconciles and ends DONE with one result write, zero trades upserts and zero APPLY calls"
    requirement: "SC-1"
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_okx_archive_fills_job.py::TestTracer::test_tracer_calibrate_end_to_end"
        status: pass
  - id: D2
    description: "Any reading other than finished-with-link stops archive_request_failed naming quarter and state, with no apply and no download"
    requirement: "SC-3"
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_okx_archive_fills_job.py::TestTracer::test_status_other_than_finished_never_applies"
        status: pass
  - id: D3
    description: "The legacy reading counts only stored rows inside read quarters; a calibrate reports unequal / absent_in_archive / unreadable and still ends DONE"
    requirement: "SC-2"
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_okx_archive_fills_job.py::TestTargetReadings::test_legacy_reading_counts_only_read_quarters"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_okx_archive_fills_job.py::TestTargetReadings::test_calibrate_reports_legacy_mismatch_without_stopping"
        status: pass
  - id: D4
    description: "A reconcile miss on any target and a broken bal chain each stop the whole read by name and write nothing"
    requirement: "SC-2"
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_okx_archive_fills_job.py::TestGatesStopTheWholeRead"
        status: pass
---

# Phase 259 Plan 05: Archive fills read path and fork Summary

`services/okx_archive_fills.py` is the handler for the two new modes of `okx_archive_rebuild`. A `fills_calibrate` job derives its targets and quarters in-claim, runs every gate (D-02 key and account checks, one GET status read per quarter, the one downloader, the bal chain over the files, the mapping, every target's reconcile and legacy reading) and ends DONE with one result block and no `trades` write and no archive request. `okx_archive_job.py` carries exactly one hunk: the fork at the top of `run_okx_archive_rebuild_job`.

## What was built

- **Fork** (`okx_archive_job.py`): inserted before `supabase = get_supabase()`, reads `metadata.mode`, lazily imports `run_okx_archive_fills_job` for the literals `fills_calibrate` and `fills_apply`. `MODES`, `ACCEPTED_MODES`, `STOP_CLASSES`, `_blank_result`, `_read_job_input` and the import block are untouched; `git diff -U0` against the phase base has one `@@` hunk.
- **Handler order** (the D-02 guarantee): validate input, `_check_keys` on the job key, targets, `_check_keys` on the targets, anchors and quarter plan, the nothing-to-read exit (before any decrypt), `_allocator_key_preflight`, `_check_account`, status reads, downloads, census, bal chain, mapping, per-target evaluation, one result write.
- **Targets**: non-archived strategies on connected OKX keys sharing the job key's non-blank `venue_account_id`, ordered by strategy id; disconnected siblings are counted in `info.targets_skipped_disconnected`; a blank stored uid stops `account_mismatch` before any decrypt.
- **Quarter plan**: `plan_fill_quarters` is pure. It returns the quarters to read (newest 4 of the derived set), the reconcile quarter, the over-cap quarters and the named spans (`over_cap`, `not_requested`, `pre_archive`, `unreachable`). Per target, `before_anchor` spans are added in the handler.
- **Status reader**: GET only, and it tells "no entry" (`data == []`) apart from drift. `_fills_quarter_step` accepts `finished` with a link and stops every other reading `archive_request_failed quarter=<tag> state=<state|no_entry>`.
- **Evaluation**: every target is evaluated before anything else happens; the legacy reading and `already_stored` / `would_insert` use only stored rows whose raw timestamp lies inside a read quarter's cut range (parsed on its own, so a row with a null price still reaches `unreadable`). The first reconcile miss is raised after all readings are in the result.
- **Fakes**: `tests/_okx_archive_fills_fakes.py` (a copy of the existing fakes plus a filtering, paging, ordering supabase and a `trades_dedup_fill`-emulating upsert with ignore and merge answers, `World.reclaim`, `install`, `job`) for plans 06 and 07.

## Verification (measured)

- `pytest tests/test_okx_archive_fills_job.py`: 25 passed. With the pinned archive suites (map, parse, job, apply, rebuild, reconcile, download, main_worker): 923 passed.
- `make typecheck` (mypy strict): no issues in 149 source files.
- `node scripts/verify-plan-anchors.mjs` on the plan: OK, 17 claims.
- `git diff -U0 <phase base> -- analytics-service/services/okx_archive_job.py | grep -c '^@@'` prints 1; the pinned test files are unchanged against the phase base.
- File-wide greps on `okx_archive_fills.py` for `_ApplyPacer`, `_apply_quarter_on_fresh_instance`, `aggregate_archive` and a module-level `WRITE_BOUND_MARGIN_MS` definition print nothing.
- Local neuters (byte backup in the session scratchpad, restored with `cp`, proven with `cmp`; plan 08 does the formal version):
  - `_inside_ranges` always True: `test_legacy_reading_counts_only_read_quarters` RED.
  - first reconcile miss not raised: `test_reconcile_miss_names_position_and_field_and_writes_nothing` RED.
  - nothing-to-read exit disabled: `test_nothing_to_read_never_decrypts` RED.
  - before-anchor span dropped: `test_before_anchor_span_named` RED.
  - bal-chain verification replaced by a canned pass: `test_broken_bal_chain_stops_before_any_mapping` RED.

## Deviations from Plan

**1. [Process] Task 2's RED-before-GREEN step was replaced by the neuter checks.** The per-target readings, spans and the nothing-to-read exit were built in Task 1's handler, so the Task 2 tests passed when first written. Task 1 itself followed RED (tests and fakes, commit `23c602379`) then GREEN (`25d6a8980`).

**2. [Minor] `over_cap` span start** is max(lowest anchor, 2021 Q1 cut start) rather than the lowest anchor (see key-decisions).

**3. [Minor] Extra arms beyond the plan**: seven `TestQuarterPlan` arms over `plan_fill_quarters` (plan 06 owns the quarter-plan arms and may add more), `test_reconcile_miss_names_position_and_field_and_writes_nothing` and `test_broken_bal_chain_stops_before_any_mapping` (T-259-16 mitigations that the plan assigned to later plans only by neuter).

**4. [Minor] `get_supabase` is read as `cast(Any, _archive_job).get_supabase()`**: mypy strict does not treat it as an export of `okx_archive_job`, and the tests patch it on that module, so the attribute must be read at call time.

**5. [Scope note] Rate-limit defers are not handled here** (plan 06's `_fills_defer`); a venue rate limit raised during a status read propagates to the dispatcher in this plan.

## Notes for plans 06 and 07

- `_fills_quarter_step(entry, reading)` is the branch plan 06 replaces; the `entry` already carries `role` and `applies` (0). `FILLS_MAX_APPLIES_PER_QUARTER` is defined. `_StatusReading.state is None` means OKX has no entry.
- The write seam is the comment `Plan 07 writes here` before the final `info.outcome` assignment in `run_okx_archive_fills_job`; `FILLS_STOP_CLASSES` already contains `fills_write_failed` and `fills_legacy_mismatch`. `strategies[i].inserted` is None until plan 07.
- The fake `FakeSupabase.upserts` records every executed upsert with `ignore_duplicates` and the rows PostgREST would return; `upsert_errors` models a write that fails midway.

## Known Stubs

None. The `fills_apply` write is a planned seam owned by plan 07, not a stub: `fills_apply` ends as a read until then (see key-decisions).

## Threat Flags

None. No new endpoint, auth path or schema change. T-259-12 (targets only from connected keys of the job key's account, uid checked per target before any archive call), T-259-14 (the link is fetched only through `_ingest_quarter`) and T-259-16 (bal chain and every reconcile before any write) are mitigated as planned.

## Commits

- `23c602379` test(259-05): fills job tracer arms and shared fakes (RED)
- `25d6a8980` feat(259-05): fills_calibrate read path and the fork that reaches it
- `24036e0b5` test(259-05): per-target readings, named spans, legacy mismatch reported in calibrate, gates that stop the whole read

## Self-Check: PASSED

- FOUND: analytics-service/services/okx_archive_fills.py, analytics-service/tests/_okx_archive_fills_fakes.py, analytics-service/tests/test_okx_archive_fills_job.py
- FOUND commits 23c602379, 25d6a8980, 24036e0b5 (ancestors of HEAD; `git rev-list --count 648819de2..HEAD` printed 3 before this file was added)
