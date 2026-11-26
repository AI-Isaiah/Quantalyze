---
phase: 230-mt5nightly-every-mt5-nightly-derive-ends-done-on-its-first-a
plan: 07
subsystem: analytics live-lane test
tags: [live-test, postgrest, mt5-terminal-lease, lane, mt5d-02]
requires:
  - phase: 230-01
    provides: the lease migration, the three lease RPCs, test_mt5_terminal_lease.sql
  - phase: 230-02
    provides: services/mt5_xlease.py (RPC name constants, _PostgrestXLeaseBackend, set_xlease_backend_for_tests)
provides:
  - "analytics-service/tests/test_mt5_xlease_live.py: four lane tests (answer shapes, 8-client exclusivity, expiry takeover, production client end to end)"
affects: [230-08]

plan_head_before: cb734580b09ff06fd441fe83464e6724fb758243
plan_head_after: d1aea72c43336e91df919ff3fe2e1a1d1e1b5d61

actuals:
  tokens: 3100
  tasks: 2
  commits: 1

key-files:
  created:
    - analytics-service/tests/test_mt5_xlease_live.py

key-decisions:
  - "DEC-07-A The live module warms PostgREST's schema cache once (module-scoped fixture, PGRST202 then NOTIFY pgrst reload through LANE_DB_URL, retry) because the lane replays the phase migration after PostgREST built its cache. The production backend has no such retry by design, so without the warm-up the end-to-end test would have read 'no lease row' instead of 'function missing'."

requirements-completed: [MT5D-02]
status: complete
---

# Phase 230 Plan 07: Live lane test of the MT5 terminal lease Summary

**Schema-gate substitution: no database push was run. The local-stack lane replayed the phase migration on the committed dump, and the SQL gates and the live test ran against it.**

⚠️ **Read this sentence with the load-limit deviation, because as executed locally it is NOT yet true.** The coordinator's load limit (recorded at the foot of 230-07-PLAN.md, 2026-11-25) forbade booting Docker and the local-stack lane on this machine. No lane was booted in this plan's run. The substitution sentence above describes what CI's `sql-tests` and `python` jobs do at the PR head SHA. It is NOT a transcript this plan produced. Nothing below claims otherwise.

## What was built

`analytics-service/tests/test_mt5_xlease_live.py` (one commit, `d1aea72c4`), adopted from the untracked draft the crashed session left behind, after review and two fixes. Four tests, each on a fresh random terminal digest, each asserting only about its own row:

- `test_rpc_answers_are_python_booleans`: acquire True then False for a second token; renew True then False for a foreign token; a foreign release is False and leaves the row held; the holder's release is True and frees it. Called through the module's own RPC name constants, `is True` / `is False`.
- `test_exactly_one_of_n_clients_wins_each_round`: 8 threads, 8 independent clients, 5 rounds, exactly one True per round, the winner releases, the row is freed.
- `test_a_one_second_lease_expires_and_is_taken_over`: ttl 1, sleep 1.5 s, a second token is granted, the first token's renew answers False.
- `test_the_production_client_holds_a_row_during_the_body`: `_PostgrestXLeaseBackend(client=<lane client>)` installed through `set_xlease_backend_for_tests` and restored after; inside `mt5_concurrency.mt5_terminal_lease(...)` the row has a UUID owner_token, after the body it is NULL.

Gating: unset lane variables skip locally and FAIL with `CI=true`; a non-loopback `SUPABASE_TEST_URL` host fails before any write. Under `-n auto --dist loadgroup` the module joins the `shared_test_db` xdist group by its `SUPABASE_TEST_URL` content sentinel (conftest `_DB_MODULE_SENTINELS`), so it does not race the other live modules on the one lane database.

## Review of the draft: what was wrong

1. **No schema-cache reload (real defect, would have failed on the lane).** The draft called `client.rpc(...)` directly. The lane replays the phase migration after PostgREST started, so the first call answers `PGRST202`; the metadata-merge live module handles this in `_rpc` with a `NOTIFY pgrst, 'reload schema'` through `LANE_DB_URL`. The draft had none. Fixed: `_rpc` (reload once, retry once) plus a module-scoped warm-up fixture (DEC-07-A). The reload fails loudly if `LANE_DB_URL` is unset, and refuses a non-loopback DSN through `_require_loopback_dsn`.
2. **mypy strict on the file failed (5 errors).** CI's mypy command covers `services/ routers/ models/` and the entrypoints, not `tests/`, so CI would not have caught it. Fixed anyway (`_lane_client` typed `-> Any` with the `_need_supabase` assertion).

Reviewed and kept unchanged: the `lane_backend` fixture's restore (correct against conftest's autouse granting default, which installs first and restores last), `ROW-ABSENT` sentinel versus a NULL owner_token, the `wrap_live_db_client` transport shim (rpc is a non-idempotent builder, so no retry on a write), holder `unattributed` and site `live_test` against the migration's CHECK constraints, and `asyncio_mode=auto` for the async test.

## Verification that ran locally (and what it proves)

Interpreter: `analytics-service/.venv/bin/python`.

| Command | Result |
|---|---|
| `pytest tests/test_mt5_xlease_live.py` with the lane variables unset | `4 skipped` (reason: "local-stack lane not configured (local dev)") |
| the same with `CI=true` | `4 errors`, each "Phase 230 lease live test cannot run: SUPABASE_TEST_URL / SUPABASE_TEST_SERVICE_KEY are unset in CI" (the gate can fail) |
| `pytest tests/test_mt5_xlease.py tests/test_mt5_concurrency.py tests/test_mt5_xlease_live.py` | `74 passed, 4 skipped in 116.69s` (the 4 skips are the live module) |
| `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` | `Success: no issues found in 144 source files` |
| `mypy --strict ... tests/test_mt5_xlease_live.py` | `Success: no issues found in 1 source file` |
| `node scripts/lint-sql-gates.mjs --self-test` | `lint-sql-gates self-test OK: 7 rules, red+green each.` |
| `node scripts/lint-sql-gates.mjs` | `scanned 122 file(s); 0 finding(s), 0 measure-fail(s), 0 allowlist error(s).` |
| `node scripts/lint-migration-data-dependence.mjs` | `corpus 339 migration(s), 421 anonymous block(s); 83 refusal(s), 83 allowlisted, 0 NEW.` |
| `node scripts/lint-app-guc.mjs --self-test` | `self-test OK: 4 finding kinds, red+green each` |
| `node scripts/lint-app-guc.mjs` | `app-guc: findings 0` |
| `npx tsx scripts/dump-sql-functions.ts --check` | `SQL function snapshot is current (145 functions).` (exit 0) |
| `node scripts/verify-plan-anchors.mjs --pending` | `claims: 56 checked; OK: 18 plan file(s), no stale claims.` |
| `node scripts/verify-plan-anchors.mjs <this plan>` (Task 1 step 0) | `claims: 4 checked; OK` |
| `npm run typecheck` | `tsc --noEmit`, exit 0, no output |
| `npm run lint` | exit 0 (all `[check-*]` lines OK, including planning-hygiene rules 6 and 7) |

**Logic check of the live module without a lane.** Because the real database could not be reached, the module's own logic was driven once against a throwaway in-memory fake of the three RPCs (a lock-guarded dict with the migration's acquire / renew / release semantics), including the production backend path through the real `mt5_terminal_lease`: `4 passed`. The fake file was deleted and is not committed. This proves the test's assertions, fixtures, threading and async plumbing are self-consistent. It proves NOTHING about the SQL, PostgREST, or the lane. Do not read it as lane evidence.

## NOT run locally (Rule 12), and what covers each in CI

| Not run | Why | Covered by |
|---|---|---|
| `bash scripts/local-stack/run.sh --check-currency`, `up`, `--assert-local-handoff`, `down`, `--assert-teardown` | load limit: no Docker, no lane | CI `sql-tests` boots the private lane and prints the `baseline-replay:` line, which must name `20261126120000_mt5_terminal_lease.sql`; each lane job runs the check-currency and handoff assertions |
| `psql ... -f supabase/tests/test_mt5_terminal_lease.sql` (`ALL 8 ARMS EXECUTED`) and the whole `supabase/tests/test_*.sql` corpus | needs the lane | CI `sql-tests` (its psql loop over the corpus) |
| the live module's 4 tests against PostgREST (pass count) | needs the lane | CI `python` job exports the lane as `SUPABASE_TEST_URL` / `SUPABASE_TEST_SERVICE_KEY` / `LANE_DB_URL` with `CI=true`, so the module FAILS rather than skips if it cannot run |
| the full `pytest -n auto --dist loadgroup --cov-fail-under=80` run, including the 80 percent coverage floor | load limit | CI `python` job |
| `npm test` (full vitest) | load limit | CI frontend vitest shards plus `frontend-coverage` |
| `node scripts/mutation-runner/run.mjs` (full) | load limit; plan 06 already took the clean full run and set the floors | CI `sql-mutation` |
| `npm run schema:functions` then `git diff --exit-code supabase/schema/functions` | needs a database; `dump-sql-functions.ts --check` (ran, exit 0) covers the mirror | CI |
| Task 2's second lane boot and Docker cleanup | no Docker was started, so there is nothing to clean up | n/a |

Acceptance criteria status: the file exists with 4 `def test_` entries (at least 4 required) and the plan-anchor claim passes. The criteria that name a lane transcript (baseline-replay line, assert-local-handoff, `ALL 8 ARMS EXECUTED`, corpus count, live pass count, `--assert-teardown`) are **UNMET locally and deferred to CI** by the coordinator's recorded deviation. Plan 08's ship must read them off the PR head SHA's `sql-tests` and `python` jobs and must not treat this plan as having produced them. No pass count is asserted for the live module anywhere in this file.

## Deviations from Plan

**1. [Coordinator deviation, recorded in the plan] Load limit.** Docker, the local-stack lane, full vitest, full pytest and the full mutation run were not executed. See the table above.

**2. [Rule 1 - Bug] The draft's missing PGRST202 handling** and **3. [Rule 3 - mypy]** are described under "Review of the draft".

No auth gates. No database write of any kind was made; the CLI linked to PRODUCTION was not invoked.

## Known Stubs

None.

## Threat Flags

None. The only new surface is a test module that refuses a non-loopback host before any write (T-230-19) and fails rather than skips in CI (T-230-20).

## Self-Check: PASSED

- `analytics-service/tests/test_mt5_xlease_live.py`: FOUND
- commit `d1aea72c4`: FOUND (ancestor of HEAD)
