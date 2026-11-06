---
phase: 191-refusalrace-the-derive-s-refusal-marker-and-a-sync-s-refresh
plan: 09
subsystem: testing
tags: [postgres, concurrency, psycopg, local-stack-lane, parity-pins, ci]
requires:
  - phase: 191-05
    provides: "mark_compute_job_kept_figures and retract_ledger_refresh_marker live on PROD"
  - phase: 191-06
    provides: "MARK_KEPT_FIGURES_RPC, READ_REFUSAL_KEPT_FIGURES_KEY"
  - phase: 191-07
    provides: "RETRACT_REFRESH_MARKER_RPC, RETRACTION_OUTCOMES"
provides:
  - "live two-connection race probe on the local-stack lane (both orders, control, PostgREST shapes, loopback guard)"
  - "python CI job exports LANE_DB_URL from the lane handoff (masked)"
  - "Python-to-SQL parity pins over the generated snapshots"
  - "TODOS [186-REFUSAL-MARKER-RMW-RACE] CORRECTED and CLOSED lines"
affects: [191-10]
tech-stack:
  added: []
  patterns: ["third connection polls pg_stat_activity for wait_event_type = Lock before the holder commits", "LANE_DB_URL as a separate name from TEST_SUPABASE_DB_URL so shared-TEST psycopg modules stay skipped"]
key-files:
  created:
    - analytics-service/tests/test_compute_job_metadata_merge_live.py
    - analytics-service/tests/test_compute_job_metadata_merge_parity.py
  modified:
    - .github/workflows/ci.yml
    - TODOS.md
key-decisions:
  - "The post-connect server check accepts loopback, NULL or a private address, not loopback or NULL only: a docker-published lane reports the container bridge address"
requirements-completed: []  # SC-3 and SC-2 are phase success criteria, not REQUIREMENTS.md ids
status: complete
completed: 2026-11-05
commits: 3
plan_head_before: 1b8be999fef9db0fb1eae50fe2950a0bf65e4bc9
plan_head_after: 14b26b6e65d5be448c632fb7451626cc9b884fa9
actuals:
  tokens: 9200
  tasks: 3
  commits: 3
---

# Phase 191 Plan 09: Live race probe, LANE_DB_URL export, parity pins, TODOS closure Summary

A two-connection probe now demonstrates, on a real PostgreSQL (the local-stack lane), that the two metadata merge functions keep every key when one blocks on the other's row lock, and the `python` CI job exports the lane DSN so CI runs that demonstration and cannot skip it.

live-probe: passed (local lane)

## What was built

- **Probe** `analytics-service/tests/test_compute_job_metadata_merge_live.py` (7 tests, no skips with the lane variables set):
  - Order 1 (marker holds, retraction blocked) and order 2 (retraction holds, marker blocked). Connection A keeps the row locked inside one function; connection B calls the other in a thread; a third connection polls `pg_stat_activity` until B's `wait_event_type` is `Lock` (fails after 10 s: race not exercised); A commits; B returns. Measured Lock waits: 0.057 s (order 1) and 0.063 s (order 2). Both orders end with exactly `read_refusal_kept_figures`, `refresh_marker_retracted`, the new `correlation_id`, `member_progress` and the claim-style `unified_backbone_at_claim`, and no `source`.
  - Control: the old read-then-replace (B reads, the marker commits, B writes the stale copy) loses the marker; the test raises if the marker survived.
  - PostgREST half through the services' own constants: unknown id answers `False` and `{"outcome": "no_row"}`; the seeded job answers `True` for the marker and a `retracted` dict for the retraction, with the row verified through psycopg. Includes the `PGRST202` -> `NOTIFY pgrst, 'reload schema'` -> retry-once path.
  - Gating: `LANE_DB_URL` unset skips locally and FAILS under `CI=true` (a test proves both); `SUPABASE_TEST_URL`/key unset and supabase-py missing also fail under CI. Loopback guard on `host` and `hostaddr` (refuses empty, mixed lists, look-alike names, remote hostaddr) with a can-fire test that needs no database; own rows only, deleted in `finally`.
- **ci.yml** `python` job, "Lane handoff" step: reads `DB_URL` from the handoff with the same `sed` form, fails with `::error::` when empty, `::add-mask::` it, appends `LANE_DB_URL=%s` to `$GITHUB_ENV`, with a dated Phase 191 D-09 comment. This sits after `--assert-local-handoff`. The pytest step's `env:` is unchanged (`CI` only).
- **Parity** `analytics-service/tests/test_compute_job_metadata_merge_parity.py` (8 tests): the retraction snapshot's 2 marker lists equal `LEDGER_REFRESH_JOB_SOURCES`; both rpc-name constants equal their snapshot's `CREATE FUNCTION public.<name>(`; the 4 outcome words equal `RETRACTION_OUTCOMES`; a hand-typed `read_refusal_kept_figures` equals `READ_REFUSAL_KEPT_FIGURES_KEY` and appears in the marker function and the status bridge snapshots. Each pin has a widened or misspelled copy case.
- **TODOS.md** `[186-REFUSAL-MARKER-RMW-RACE]`: dated CORRECTED line (D-01) and CLOSED line (two functions, three writers, the gate and the probe as proofs; D-02's gap recorded as the unchanged known limit).

## Verification

| Check | Result |
|---|---|
| Probe on the lane, `LANE_DB_URL` + `SUPABASE_TEST_URL` + key exported | 7 passed, 0 skipped |
| RED proof: both functions replaced on the lane by read-then-replace bodies (SELECT metadata, then UPDATE from the copy) | 2 failed, 5 passed. Order 1 failed: final metadata lacked `read_refusal_kept_figures` (marker lost). Order 2 failed: `source` came back and the retraction keys were gone. Lock waits still observed, so the failure is the lost write, not a harness artifact. Control, PostgREST and guard tests unaffected |
| Restore | original definitions re-applied from a `pg_get_functiondef` backup; definitions byte-identical to the backup; probe 7 passed again |
| Probe with nothing exported | `CI` unset: 3 passed, 4 skipped. `CI=true`: 4 failed (the four DB-needing tests name the missing export), 3 passed |
| Parity + privilege modules | 16 passed |
| Parity neuter: `RETRACT_REFRESH_MARKER_RPC` misspelled in a byte-backed copy of `long_fetch.py` | `test_rpc_name_constants_equal_the_snapshots_function_names` FAILED (1 failed, 7 passed); restored, `cmp -s` silent, `git status` clean for that file |
| CI mypy line (verbatim, `analytics-service/`) | Success: no issues found in 132 source files |
| vitest: critical-regressions, local-stack-lane-wiring, ci-anti-skip-gate, ci-mypy-strict-surface | 4 files, 349 passed |
| vitest: supabase-migrate-test-first, prod-prober-wiring, test-restore-workflow-wiring, gate-family-meta, drift-check-scripts, contracts/ | 16 files, 1602 passed |
| vitest: verify-plan-anchors, ci-docs-path-filter, lint-migration-data-dependence, audit-coverage | 169 passed |
| `check-planning-hygiene` | OK |
| ci.yml YAML parse; `LANE_DB_URL=%s` present | OK |
| TODOS entry window check (CORRECTED, CLOSED, D-02, no uuid) | OK |

The lane was brought down after the proofs.

## Deviations from Plan

**1. [Rule 1 - Bug in the plan's design] Post-connect server check widened from "loopback or NULL" to "loopback, NULL or private"**
- **Found during:** Task 1, first lane run
- **Issue:** the plan asks the probe to require `inet_server_addr()` to be loopback or NULL. Measured on the booted lane: `inet_server_addr()` over the docker port mapping is the container's bridge address (a 172.x private address), never loopback, so the check as written would refuse the real lane and the probe could never run.
- **Fix:** `_server_addr_is_lane` accepts NULL, loopback or a private address; a public address is refused. The DSN host/hostaddr guard stays loopback-only and remains the primary control. Two tests cover this (docker-bridge accepted, public refused).
- **Files modified:** analytics-service/tests/test_compute_job_metadata_merge_live.py
- **Commit:** b3e13aa6d

No other deviations. No Rule 4 items.

## Auth gates

None.

## Known Stubs

None.

## Threat Flags

None. The new surface is the `LANE_DB_URL` export, covered by the plan's T-191-25..28 (loopback guard with a can-fire test, DSN masked before the `$GITHUB_ENV` write, fail-not-skip under CI, separate name from the shared-TEST secret).

## Notes for plan 191-10

The probe has a local-lane reading only. The `python` job's result for PR 2's head is the second, CI reading; 191-10 Task 0 records it as `live-probe-ci:`. A green `python` job means the race ran: the probe fails rather than skips under `CI=true`.

## Self-Check: PASSED

Created files exist (probe, parity module, this summary); commits `b3e13aa6d`, `f5c05cf48`, `14b26b6e6` are ancestors of HEAD.
