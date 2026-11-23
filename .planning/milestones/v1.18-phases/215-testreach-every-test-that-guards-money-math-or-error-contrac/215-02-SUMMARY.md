---
phase: 215-testreach-every-test-that-guards-money-math-or-error-contrac
plan: 02
subsystem: testing
tags: [pytest, psycopg, local-stack-lane, live-db, xdist, ci-python-job]
requires: []
provides:
  - "tests/live_db_dsn.py: one resolver (LANE_DB_URL only) and one set of loopback / server-address / stock-comment write guards for every psycopg live-DB module"
  - "24 live-DB cases in 7 modules (4 + 7 + 3 + 5 + 2 + 2 + 1) run on the CI python job's private lane; CI=true without the lane DSN fails by name, never skips"
  - "Pinned CANNOT_RUN_ON_LANE roster (7 entries with reasons) and an AST scan that no test module reads the shared-TEST DSN"
affects: [analytics-service/tests, src/__tests__/critical-regressions.test.ts, .github/workflows/ci.yml]
tech-stack:
  added: []
  patterns: ["resolve through one session fixture (live_db_dsn); connect through connect_live_db so the guards run before any write", "CI=true + missing lane value = pytest.fail, local = pytest.skip", "self-tests label the outcome (fail/skip/value) so a resolver that skips where it must fail reds the test instead of being reported as skipped"]
key-files:
  created:
    - analytics-service/tests/live_db_dsn.py
    - analytics-service/tests/test_live_db_dsn.py
    - analytics-service/tests/test_live_db_reach_roster.py
  modified:
    - analytics-service/tests/conftest.py
    - analytics-service/tests/test_compute_job_metadata_merge_live.py
    - analytics-service/tests/test_trigger_rls_audit.py
    - analytics-service/tests/test_csv_daily_returns_dualaxis_live.py
    - analytics-service/tests/test_csv_daily_returns_perkey_rls_live.py
    - analytics-service/tests/test_persist_csv_daily_returns_live.py
    - analytics-service/tests/test_resend_correlation_rls.py
    - analytics-service/tests/test_sync_trades_preserves_fills.py
    - analytics-service/tests/test_job_worker.py
    - src/__tests__/critical-regressions.test.ts
    - .github/workflows/ci.yml
key-decisions:
  - "No fallback to the shared-TEST DSN variable on any path (planner choice): the helper never reads it; SHARED_TEST_DSN_VAR exists only for the roster scan"
  - "The persist module's three runner cases get a lane client built from SUPABASE_TEST_URL / SUPABASE_TEST_SERVICE_KEY and patched into services.analytics_runner.get_supabase, unwrapped (census rule), so SUPABASE_URL is never exported"
  - "Cases that were red on the real lane schema were FIXED in place (stale since they never ran in CI), not rostered"
status: complete
completed: 2026-11-15
actuals:
  tokens: 21000
  tasks: 3
  commits: 3
plan_head_before: 1dc72cd816b3f80303e9817a846111473f9896d7
plan_head_after: 97c159b1e980cb6abb6688112dc6107b98bfcb54
---

# Phase 215 Plan 02: Live-DB cases run on the CI lane Summary

Seven psycopg modules (24 cases) that read only the shared-TEST DSN name, and so ran nowhere, now resolve `LANE_DB_URL` through one helper and run on the python job's private local-stack lane. Under `CI=true` a missing lane DSN fails by name; a local run without the lane skips; no path ever reads the shared-TEST variable.

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | SC-2 tracer: resolver, fixture, trigger RLS audit end-to-end | 76122eba1 | live_db_dsn.py, test_live_db_dsn.py, conftest.py, merge probe, test_trigger_rls_audit.py |
| 2 | SC-2 expansion: six modules, persist runner cases, repairs of cases that never ran | 62ecba213 | six modules plus test_live_db_dsn.py, test_trigger_rls_audit.py |
| 3 | SC-2 pins: sentinel, roster, CI tripwire correction, positive LANE_DB_URL pin | 97c159b1e | test_live_db_dsn.py, test_live_db_reach_roster.py, critical-regressions.test.ts, ci.yml |

## What changed

- `tests/live_db_dsn.py` (new): the loopback / server-address / stock-comment guards MOVED from the metadata-merge probe (the probe imports them back, its four guard self-tests pass unchanged), plus `resolve_live_db_dsn`, `resolve_lane_postgrest` and `connect_live_db(dsn, autocommit=, row_factory=)`. The connection-time guards run on a tuple-row connection and the caller's `row_factory` is applied after they pass.
- `conftest.py`: session fixture `live_db_dsn` and the `"live_db_dsn"` content sentinel (dated comment), so the migrated modules stay in the `shared_test_db` xdist group now that they no longer contain the old name.
- Seven modules: module/class skip marker removed, `service_role_conn(live_db_dsn)` connects via `connect_live_db`, docstrings corrected. `test_job_worker.py::TestTradesIsFillRls` lost its class skip, in-body skip and env read (and the silent "psycopg not installed" skip, since the helper imports psycopg at module level).
- `test_trigger_rls_audit.py`: the claim call is scoped as its ownership comment demanded, using the 5-arg overload with `p_kind_include` bound as a Python list (`%s::text[]`), kind `compute_analytics`.
- `critical-regressions.test.ts`: existing regex kept, dated CORRECTED note appended, plus one positive `expect` that the python job exports `LANE_DB_URL` through `$GITHUB_ENV`.
- `ci.yml`: two comment sentences corrected (diff stat: 7 insertions, 2 deletions, every changed line a `#` comment; checked with a non-comment filter that printed nothing). No command, step name or `env:` changed. Nothing under `src/` or `scripts/` pins those sentences.

## Cases that were red on the real lane schema (found by a local lane boot) and how each was fixed

These modules had never run in CI, so their fixtures and pins had rotted against the current schema. All were fixed in place; none were rostered.

| Case | Cause | Fix |
| ---- | ----- | --- |
| `test_trigger_rls_audit` (api_keys inserts) | `encrypted_key` / `dek_encrypted` bytea columns no longer exist | insert `label` + `api_key_encrypted` |
| `test_trigger_rls_audit` (fixture cleanup, priority claim) | `compute_jobs` has no `user_id`; kind `analytics` is no longer a kind; the claim dedupes per target | one strategy per job, kind `compute_analytics`, cleanup through the user's strategies |
| `test_csv_daily_returns_dualaxis_live::test_per_key_row_missing_allocator_rejected` | the owner-coherence BEFORE trigger fires before the CHECK, so the CHECK is unreachable through INSERT | accept either refusal and pin the CHECK's existence and `allocator_id IS NOT NULL` text in `pg_constraint` |
| `test_persist_csv_daily_returns_live::test_no_redundant_index` | Phase 36 added `csv_daily_returns_allocator_date_idx` | added to the expected set with a dated note |
| `test_sync_trades_preserves_fills` fixture and `TestTradesIsFillRls` seed | `profiles.id` references `auth.users`, `display_name` NOT NULL | seed through `auth.users` (the auth trigger makes the profile), clean up via `auth.users` |
| `test_phase1_sync_trades_replaces_prior_summaries` | migration 20260510180535 deletes only the incoming payload's date range, so a disjoint second window no longer replaces | second payload uses the first's timestamp (overlapping window) |

Local lane outcome (best-effort evidence; lane booted with `scripts/local-stack/run.sh up`, values exported as the python job does, `CI=true`): the 24 migrated cases plus the merge probe ran `32 passed, 0 skipped, 0 failed`, twice in a row, with no rows left behind. The lane was torn down with `run.sh down` afterwards.

## Verification

- `tests/test_live_db_dsn.py` (15), `tests/test_live_db_reach_roster.py` (15), merge probe, `test_live_db_transport.py` (31, census intact): all pass locally under `env -u TEST_SUPABASE_DB_URL`; every migrated module exits 0 locally (skipping) and exits non-zero under `CI=true` with no lane variables; the "SILENT SKIP" loop printed nothing.
- `TestTradesIsFillRls -rs` locally: skipped with a reason naming `LANE_DB_URL`, not the old variable.
- Persist runner cases under `CI=true` with no lane variables: `3 errors`, output names `LANE_DB_URL`.
- Acceptance greps: `environ...TEST_SUPABASE_DB_URL` count 0 in all seven modules; `_require_loopback_dsn` defined 0 times in the probe and once in `live_db_dsn.py`.
- Full serial suite (`env -u TEST_SUPABASE_DB_URL`, no lane values): `1 failed, 14913 passed, 92 skipped`; the one failure is the known `test_xdist_group_is_real.py` (pytest-xdist absent locally).
- vitest: `critical-regressions.test.ts` + `local-stack-lane-wiring.test.ts` 243 passed; every other `src/__tests__/*.test.ts` that names `ci.yml` passes file by file.
- `git diff --stat origin/main -- supabase/migrations` prints nothing (SC-8). No analytics source changed, so the mypy strict command was not run.

## RED proofs (SC-9)

All made from byte backups in the scratchpad (`.../scratchpad/p215-02/`), restored and `cmp`-clean. No git checkout/restore/stash used.

1. **CI branch of the resolver** (`live_db_dsn.py`, `pytest.fail` replaced by `pytest.skip` under CI): `test_live_db_dsn.py` went `2 failed, 6 passed` (`test_ci_without_a_lane_dsn_fails_and_never_skips` and `test_ci_never_falls_back_to_shared_test`); restored, `cmp` clean, `8 passed`. A first attempt exposed that a skipping resolver made those self-tests report SKIPPED rather than FAILED, so the tests were rewritten to label the outcome (`_outcome()`), and the proof above is from the rewritten tests.
2. **Persist runner cases** (pre-change class skip on `not _worker_pipeline_env_present()` re-inserted, CI command from the plan): exit `0`, `3 skipped, 2 deselected`; restored, `cmp` clean: exit `1`, `2 deselected, 3 errors`.
3. **`test_resend_correlation_rls.py`** (module skip on a true condition re-inserted, `CI=true`, no lane): exit `0`, `2 skipped`; restored, `cmp` clean: exit `1`, `2 errors`.
4. **conftest sentinel** (`"live_db_dsn"` entry removed): `test_live_db_dsn_is_a_shared_db_sentinel` and `test_every_migrated_module_is_grouped_as_a_shared_db_module` FAIL (`2 failed, 13 passed`); restored, `cmp` clean, `15 passed`.
5. **Roster rot** (one entry renamed to a missing function): `test_every_roster_entry_names_a_test_that_still_exists` FAILS naming `test_sfox_client_live.py::test_sandbox_get_balance_history_RENAMED`; restored, `cmp` clean, `15 passed`.
6. **Shared-TEST read scan** (scratch test module with `os.environ.get("TEST_SUPABASE_DB_URL")`): `test_no_test_module_reads_the_shared_test_dsn` FAILS naming `test_zz_scratch_read.py: [2]`; scratch file deleted. The scanner also has red/green snippet self-tests for each read shape.
7. **critical-regressions positive pin** (`LANE_DB_URL=` regex pointed at a name the job does not export): vitest `1 failed, 180 passed` with the new message; restored, `cmp` clean, `181 passed`.
8. **ci.yml guard mutation** (`TEST_SUPABASE_DB_URL=oops` line added to the python job): the existing `it` FAILS (`exports TEST_SUPABASE_DB_URL`); ci.yml restored, `cmp` clean, `181 passed`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Cases red on the real lane schema (never ran in CI)**
- **Found during:** Task 2, local lane boot
- **Issue:** six distinct stale-fixture or stale-pin failures (table above)
- **Fix:** repaired each case in place; the plan's own instruction was "fix the case, or add a roster entry"
- **Files modified:** test_trigger_rls_audit.py, test_csv_daily_returns_dualaxis_live.py, test_persist_csv_daily_returns_live.py, test_sync_trades_preserves_fills.py, test_job_worker.py
- **Commit:** 62ecba213 (the trigger-audit repair landed here, not in Task 1's commit, because it was discovered only after the lane boot)

**2. [Rule 2 - Missing critical] `resolve_lane_postgrest` added to the helper, with self-tests**
- **Issue:** the persist runner cases needed the same CI-fails/local-skips/loopback rule for the PostgREST pair; duplicating it inside the module would have been a second, untested definition
- **Fix:** one function in `live_db_dsn.py`, covered in `test_live_db_dsn.py`
- **Commit:** 62ecba213

**3. [Rule 1 - Bug] Silent psycopg skip removed from `TestTradesIsFillRls`**
- A `try: import psycopg except ImportError: pytest.skip` would be a skip CI could hit silently; the helper's module-level import now makes a missing install error loudly. Commit 62ecba213.

### Plan-text corrections

- The plan named the test oracle "tests (a) and (f) FAIL" for the CI-branch neuter; that only holds once the self-tests label the outcome (see RED proof 1).
- Merge-probe guard messages were generalized from "test_compute_job_metadata_merge_live refuses to write" to "a live-DB test refuses to write" because the guards are now shared; nothing pins the old text.

## Auth Gates

None.

## Known Stubs

None.

## Items that can only be measured in CI

- The python job on the PR head SHA: 0 failed, and a skip count lower than the 3f29f1539 baseline of 68 by up to 24 (this plan) plus the other plans' deltas, read from the job's summary line.
- `tests/test_xdist_group_is_real.py` (needs pytest-xdist, absent locally): proves the `live_db_dsn` sentinel keeps the migrated modules in one `shared_test_db` worker under `-n auto --dist loadgroup`. The sentinel membership itself is pinned locally.
- Whether the CI lane's PostgREST schema cache and timing let the three persist runner cases (90 s poll window each) finish: they ran in about 5 s locally.

## Out-of-scope finding (orchestrator resolution 4, named only)

About 27 lane-gated cases appear not to run in CI (60 lane-gated locally, while CI skips only 33 fewer than local). No work was planned or done on it.

## Threat Flags

None. The new surface (`connect_live_db`, `resolve_lane_postgrest`) tightens the existing write boundary: loopback host, lane server address and stock database comment are required before any write, and the shared-TEST variable is never read.

## Self-Check: PASSED

- Files: live_db_dsn.py, test_live_db_dsn.py, test_live_db_reach_roster.py, ci.yml, critical-regressions.test.ts present and committed.
- Commits 76122eba1, 62ecba213, 97c159b1e are ancestors of HEAD; `git rev-list --count` from the plan ledger base = 3.
