---
phase: 230-mt5nightly-every-mt5-nightly-derive-ends-done-on-its-first-a
plan: 03
subsystem: analytics-service / MT5D-03 clock replay tooling
tags: [mt5, server-clock, dry-run, days-out, runbook, mt5d-03]
requires: []
provides:
  - "scripts/mt5offset_dry_run.py --days-out: per-ordinal moved return days, moved NAV-level days, legacy and target return-fold day lists (scratch only)"
  - "docs/runbooks/mt5-clock-replay.md: capture contract, sha-bound write review, one-shot command with fallback, quiet-window SELECTs, replay, attribution arithmetic, restart of both services"
affects: [230-10]
key-files:
  created:
    - docs/runbooks/mt5-clock-replay.md
  modified:
    - analytics-service/scripts/mt5offset_dry_run.py
    - analytics-service/tests/test_mt5offset_dry_run.py
key-decisions:
  - "DEC-03-A one fold per key (legacy 7200, rule us); a 10800 run is a control only"
  - "DEC-03-B the capture script is a contract in the runbook, never committed source"
  - "DEC-03-C no lease is taken by the capture; both services restarted afterwards"
  - "DEC-03-D fallback transport is the API service; if both ssh routes fail the coordinator stops and asks the founder"
requirements-completed: [MT5D-03]
status: complete
commits: 2
plan_head_before: 7d19de0d1d5923f1cae67543c64a7e892f73812e
plan_head_after: 6a9588874328da42e65231b5af63768af736a4a0
actuals:
  tokens: 40000
  tasks: 2
  commits: 2
---

# Phase 230 Plan 03: MT5D-03 replay tooling Summary

`mt5offset_dry_run` gains a scratch-only `--days-out` that hands the coordinator moved-day sets per ordinal while the report stays byte-identical and counts-only, and `docs/runbooks/mt5-clock-replay.md` carries the capture contract, the write review bound to a sha, the replay and the per-scope attribution procedure. Nothing here ran the capture, logged the terminal in, or touched PROD, TEST, Railway or the gateway.

## Tasks

| Task | Commit | Files |
|---|---|---|
| 1 Tracer: `--days-out` through the CLI | `9ac57ef4f` | analytics-service/scripts/mt5offset_dry_run.py, analytics-service/tests/test_mt5offset_dry_run.py |
| 2 Replay runbook | `6a9588874` | docs/runbooks/mt5-clock-replay.md |

The tracer feedback gate: the CLI test run (`dr.main` end to end, flag to file) re-ran green after the commit (20 passed), so the slice was verified end to end before Task 2.

## Verification

Tests (from `analytics-service/`, `.venv/bin/python -m pytest tests/test_mt5offset_dry_run.py -q -p no:cacheprovider`):

```
RED (new tests, flag absent):  4 failed, 16 passed      (argparse SystemExit: 2 on the unknown --days-out)
GREEN:                         20 passed in 5.13s
-k days_out:                   4 passed, 16 deselected
```

mypy (CI form): `Success: no issues found in 143 source files`. `node scripts/verify-plan-anchors.mjs` on the plan: `OK: 1 plan file(s), no stale claims.` Task 2 automated verify printed 2, 1, 2 and then no home-path or email match.

### PROOF-01 (neutered copies, byte backup `cp -p` to scratch, `cp` back, `cmp -s`)

Neuter A, the moved return list replaced by the moved level list (first attempt, before a flow-only key was asserted, did NOT bite: `20 passed`; the test was strengthened, see Deviations):

```
== neuter A
FAILED tests/test_mt5offset_dry_run.py::test_days_out_under_7200_and_us_moves_a_summer_flow_and_not_a_winter_one
1 failed, 19 passed in 22.58s
restored
== GREEN
20 passed in 5.13s
```

Neuter B, the days file written even without the flag:

```
== neuter B (days file written even without the flag)
FAILED tests/test_mt5offset_dry_run.py::test_the_report_is_byte_identical_with_and_without_days_out_and_no_file_appears_without_it
1 failed, 19 passed in 6.02s
restored
== GREEN
20 passed in 20.25s
```

## Synthetic dry run and attribution (counts and dates only)

Two synthetic keys (a July ledger with a closing trade stamped 02:30 broker time, and the winter fixture), folded with `--legacy-offset-s 7200 --rule us --days-out`:

```
| key | verdict | deals | moved deals | moved flow deals | moved days | flow deals without an instant | NAV-level days changed | return days changed | error class |
| mt5-key-1 | rebuild | 3 | 1 | 0 | 2 | 0 | 2 | 2 | - |
| mt5-key-2 | none | 4 | 0 | 0 | 0 | 0 | 0 | 0 | - |
Keys needing a forced rebuild: 1 of 2.   Keys not measured: 0 of 2.
exit=0
days file: mt5-key-1 moved_return_days ['2025-07-15', '2025-07-16']  moved_level_days ['2025-07-15', '2025-07-16']
           mt5-key-2 moved_return_days []                           moved_level_days []
```

The runbook's section 7 command with a synthetic D202 (mt5-key-1 moved 2025-07-15, 2025-07-16, 2025-07-20; vanished 2025-07-02, 2025-07-03):

```
-- mt5-key-1
attributed_to_clock 2 observed_not_predicted 1 predicted_not_observed 0 vanished_present_in_target_fold 2 of 2
-- mt5-key-2 (vanished 2025-11-17, 2025-11-18, 2025-12-30)
attributed_to_clock 0 observed_not_predicted 0 predicted_not_observed 0 vanished_present_in_target_fold 0 of 3
```

(The second key's three dates are outside its ledger, hence 0 of 3.) Both synthetic.

## Write review (repeated from the runbook; reviewed at `9ac57ef4f4b96e0c3bb615f741b43e341781fd4a`)

Grep of every allowed module (plus `mt5_handover` and `mt5_probe`, which `mt5_read` imports) for `.insert(`, `.update(`, `.upsert(`, `.delete(`, `.rpc(`, `enqueue`, `record_mt5_terminal_handover`, `mt5_terminal_lease`: only comments and docstrings, the lease and handover definitions the script never calls, and one `cron_runs` insert inside `mt5_handover._insert_handover_row`, reachable only from `record_mt5_terminal_handover`.

| File | Symbol | What it writes |
|---|---|---|
| services/db.py | get_supabase | Nothing. The script's own select on api_keys is one SELECT |
| services/encryption.py | get_kek, decrypt_credentials | Nothing |
| services/mt5_validation.py | parse_mt5_credentials, mt5_venue_account_id | Nothing |
| services/mt5_client.py | Mt5Client.__init__ | An rpyc connection. No row |
| services/mt5_client.py | Mt5Client.login (+ _timed, emit_mt5_stage_event, _note_terminal_answered, _note_terminal_holder) | Terminal login (intended), a log line, in-process dict entries. No row |
| services/mt5_client.py | account_info, history_deals_get, server_tick_times, _materialize_rows | Read only |
| services/mt5_client.py | close -> _teardown_transport | Closes our rpyc socket |
| services/mt5_client.py | mt5_terminal_key | Nothing |
| services/mt5_probe.py | assert_expected_login, normalise_mt5_server | Nothing |
| services/mt5_read.py | read_mt5_deal_ledger, _settle_deal_history, log_mt5_poll_server_verdict | Read, sleep, log; one in-process dict entry; no row |
| services/mt5_handover.py | normalize_mt5_holder, SITE_DERIVE | Nothing; the recorder is defined, never called |
| services/mt5_concurrency.py | mt5_derive_read_bound_s and two constants | Nothing; imports the recorder, never calls mt5_terminal_lease |

The one difference from the 164.6.6.2.3-08 table: `read_mt5_deal_ledger` now takes a `holder` keyword (#1346); the script does not pass it. Plan 10 re-runs this review at its own head.

## Deviations from Plan

**1. [Rule 1 - Bug in the plan's fixture premise] A deposit alone never moves a RETURN day.** The plan said the summer fixture has a non-empty `moved_return_days`. The existing `_summer_key` holds only a deposit near midnight; folded under 7200 then `us` it moves two NAV-level days and zero return days (a flow is neutral to a return, the 164.6.6.2.3 contract). Added `_summer_close_key` (a closing trade stamped 02:30 broker time) for the return-day assertions, and the structural test now asserts both facts: a summer flow moves level days and no return days, a summer trade moves return days (`2025-07-15`, `2025-07-16`), the winter key moves nothing. The runbook's metric caveat records this for the coordinator: a return-day move is a trade's P&L crossing midnight; `moved_level_days` is the wider set. Commit `9ac57ef4f`.

**2. [PROOF-01 refinement] Neuter A first passed.** Level and return sets are identical for the trade key, so replacing one with the other was invisible; the flow-only key assertion (`moved_return_days == []`) was added and the neuter then went RED with the named test.

**3. Reviewed-at sha is the Task 1 commit, not the final head.** The review binds to `9ac57ef4f`, the commit whose module bodies were read; Task 2 touches no reviewed module. Plan 10 re-runs the review at its head. The runbook says the review table also names `server_tick_times` and `log_mt5_poll_server_verdict`, which predate #1346 but were not itemised in the precedent.

## Known Stubs

None.

## Threat Flags

None. `--days-out` writes ordinals and ISO dates only (test pins no id, login, server, amount or deal field in the file); the capture's start-command fallback that would log deals is refused in the runbook.

## Open items for the coordinator and plan 10

- Plan 10 materializes the capture script from runbook section 4 and re-runs the write review at its head.
- Section 6 step 2's second SELECT names `public.mt5_terminal_leases` (`owner_token`, `expires_at`) as given by the plan; confirm the names against the lease migration plan 01 lands before the coordinator runs it.

## Self-Check: PASSED

- FOUND: analytics-service/scripts/mt5offset_dry_run.py, analytics-service/tests/test_mt5offset_dry_run.py, docs/runbooks/mt5-clock-replay.md
- FOUND commits: 9ac57ef4f, 6a9588874 (this SUMMARY's own commit follows and is not counted in `commits`)
