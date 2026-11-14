---
phase: 211-syncjobs-trade-fetches-skip-nothing-and-failed-jobs-keep-the
plan: 01
subsystem: analytics-service
tags: [fetch-trades, resume-point, high-water, last_sync_at, tdd]

requires: []
provides:
  - "services/trade_resume.py: the one definition of the stored high-water rule (high_water_floor_iso, load_strategy_high_waters)"
  - "POST /fetch-trades seeds since_ms from the stored daily high-water, never api_keys.last_sync_at"
affects: [211-04 sync_trades job seed (calls the same helper), 167.1.2.2.2-SYNCTRADES-LASTSYNC-SEED]

actuals:
  tokens: 5700
  tasks: 2
  commits: 3
plan_head_before: fa3702bfb4c22cb57ed0b5afb52a359f17955af1
plan_head_after: 6d7073ede8372fecddeff80af5868dfaf1bb4e1e

tech-stack:
  added: []
  patterns:
    - "shared leaf module re-exported under the old private name (cron keeps _load_strategy_high_waters as a module global)"
    - "route-level RED-first test with a filtering fake trades table, span guard defeated by two rows more than 7 days apart"

key-files:
  created:
    - analytics-service/services/trade_resume.py
    - analytics-service/tests/test_fetch_trades_resume_seed.py
  modified:
    - analytics-service/routers/cron.py
    - analytics-service/routers/exchange.py

key-decisions:
  - "The stored high-water rule has ONE definition in services/trade_resume.py; cron.py imports load_strategy_high_waters as _load_strategy_high_waters so the cron_sync call site and every cron test are unchanged"
  - "_high_water_floor_iso is not re-imported into cron.py: it had no other caller there and no test patches it"
  - "fetch_trades calls the helper synchronously (the route reads Supabase synchronously everywhere else); the returned error string is not logged a second time because the helper logs and fails open itself"

requirements-completed: [SC-1, SC-4]

coverage:
  - id: D1
    description: "A user-triggered POST /fetch-trades with a fresh last_sync_at still asks the venue for trades from 00:00 UTC of the newest stored daily row (is_fill = false), ignoring a newer fill row"
    requirement: "SC-1"
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_fetch_trades_resume_seed.py#test_fresh_last_sync_at_still_reaches_back_to_the_stored_daily_day"
        status: pass
    human_judgment: false
  - id: D2
    description: "A failed high-water read and a strategy with no stored day both fetch the full reach (since_ms None), never the last_sync_at value"
    requirement: "SC-1"
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_fetch_trades_resume_seed.py#test_failed_high_water_read_fetches_full_reach_not_last_sync_at"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_fetch_trades_resume_seed.py#test_strategy_with_no_stored_day_fetches_full_reach_without_probing"
        status: pass
    human_judgment: false
  - id: D3
    description: "The route still writes last_sync_at and account_balance_usdt after the fetch; one shared definition of the rule with the cron suite passing unedited"
    requirement: "SC-4"
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_fetch_trades_resume_seed.py#test_route_still_writes_last_sync_at_and_balance_after_the_fetch"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_cron_router.py (181 tests, file unedited)"
        status: pass
    human_judgment: false

duration: 20min
completed: 2026-11-14
status: complete
---

# Phase 211 Plan 01: Route seed from the stored high-water Summary

**`POST /fetch-trades` now resumes from the strategy's stored daily high-water (newest `is_fill = false` row floored to 00:00 UTC, else full reach) through a single shared definition that the cron imports back, instead of the poll-overwritten `api_keys.last_sync_at`.**

## Performance

- **Duration:** about 20 min (start 2026-11-14T08:37Z, end 08:58Z)
- **Tasks:** 2 (Task 1 tracer, Task 2 auto), both TDD
- **Files:** 4 (2 created, 2 modified)

## Accomplishments

- `analytics-service/services/trade_resume.py` (new leaf, imports only `services.db`): `high_water_floor_iso` and `load_strategy_high_waters`, MOVED out of `routers/cron.py` with the query chain and the fail-open per-strategy mapping unchanged. The `logger.exception` text is now caller-neutral. The error string format `f"{sid}: {type(exc).__name__}: {exc}"` is unchanged.
- `routers/cron.py` imports `load_strategy_high_waters as _load_strategy_high_waters`; the `cron_sync` call site is untouched. `tests/test_cron_router.py` is unedited and green (181 passed).
- `fetch_trades` seeds `since_ms` from `load_strategy_high_waters(supabase, [req.strategy_id])`. The span-probe guard still runs only on a non-None seed, the post-fetch `last_sync_at` and `account_balance_usdt` write is kept, and the probe's `except` comment now says it keeps the stored seed (never `last_sync_at`) and degrades toward over-fetch.

## RED evidence (SC-4)

### On the unchanged route (Task 1, commit `29f80986c`)

Semantic assessment: the target test ran, reached the handler, and failed on the planned assertion for the planned reason (the seed read `last_sync_at`); no import, fixture or collection fault.

```
AssertionError: since_ms=1794549600000: expected 00:00 UTC of the newest DAILY row's day (1778112000000); the poll-written last_sync_at instant would be 1794549600000
```

### Task 2 cases on the pre-change seed (via N1 below)

Under the restored old seed, the failed-read case reads `since_ms=1794549600000` where `None` is expected, and the no-stored-day case reads `since_ms=1794549600000` where `None` is expected. The pre-change span probe also raised on the failed read and kept the `last_sync_at` seed (log line `fetch-trades clamp probe failed: PostgREST 503 simulated`).

### Neuter proofs

Both used a byte backup of `routers/exchange.py` in the scratchpad, an in-place edit of the one seed line, a pytest run, `cp` restore, `cmp` confirmation (CMP_CLEAN both times), and a GREEN rerun (4 passed).

- **N1, the seed.** Seed line restored to `parse_since_ms(key_data.get("last_sync_at"))`. 3 failed, 1 passed:
  - `test_fresh_last_sync_at_still_reaches_back_to_the_stored_daily_day`
  - `test_failed_high_water_read_fetches_full_reach_not_last_sync_at`
  - `test_strategy_with_no_stored_day_fetches_full_reach_without_probing`
  - `test_route_still_writes_last_sync_at_and_balance_after_the_fetch` stays GREEN by design: it pins the write, not the seed.
- **N2, the fallback direction (decision 3).** Seed changed to `parse_since_ms(<hw>) or parse_since_ms(key_data.get("last_sync_at"))`. 2 failed, 2 passed:
  - `test_failed_high_water_read_fetches_full_reach_not_last_sync_at` RED
  - `test_strategy_with_no_stored_day_fetches_full_reach_without_probing` RED
  - `test_fresh_last_sync_at_still_reaches_back_to_the_stored_daily_day` stays GREEN, which shows the suite tells the two properties apart.

## TDD Gate Compliance

RED `29f80986c` (`test(211-01)`), then GREEN `21af45cda` (`feat(211-01)`), then the edge-case commit `6d7073ede` (`test(211-01)`: cases that pass on the implementation and were proven RED by neuter). No refactor commit. `workflow.tdd_mode` is false in config, so `gsd_run check tdd-red-evidence` was not run; the semantic assessment above stands in.

## Task Commits

1. Task 1 RED: `29f80986c` test(211-01): add failing route test for the stored high-water seed
2. Task 1 GREEN: `21af45cda` feat(211-01): seed POST /fetch-trades from the stored high-water
3. Task 2: `6d7073ede` test(211-01): pin the failed-read, no-stored-day and write-kept edges of the route seed

## Verification run

- `pytest tests/test_fetch_trades_resume_seed.py tests/test_exchange_router_c0202.py tests/test_cron_router.py tests/test_limiter_route_coverage.py tests/test_raw_5xx_census.py`: 210 passed.
- Also `tests/test_job_worker.py` and three census suites: 153 passed, 1 skipped (pre-existing skip, not touched).
- `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`: Success, 139 source files.
- Acceptance greps: `trade_resume.py` defs = 2; `cron.py` old defs = 0; `cron.py` alias import = 1; old `last_sync_at` seed line in `exchange.py` = 0; new helper call in `exchange.py` = 1; `through to the original since_ms` = 0; `def test_` count = 4; `git diff --quiet -- analytics-service/tests/test_cron_router.py` exits 0; `grep -a "stored-high-water read failed" analytics-service/tests` prints nothing.
- `node scripts/verify-plan-anchors.mjs` on the plan: OK (11 claims) before any edit.

## Deviations from Plan

None - plan executed exactly as written. Notes that are not deviations:

- The `stubbed_exchange_router` fixture imports cleanly from `tests.test_exchange_router_c0202` (with `# noqa: F401`), so it was not copied.
- `python3 -m pytest` in the plan's verify blocks was run as `.venv/bin/python -m pytest` and `.venv/bin/mypy` from `analytics-service/` (the pinned venv).

## Issues Encountered

None.

## TODOS status (not edited here)

`167.1.2.2.2-SYNCTRADES-LASTSYNC-SEED` is HALF-closed by this plan: the route (`POST /fetch-trades`) only. Plan 04 closes the queued `sync_trades` job half (`run_sync_trades_job` in `services/job_worker.py`) by calling the same `load_strategy_high_waters`. The entry stays open until plan 04 lands. `167.1.2.2.2-LAST-FETCHED-TRADE-TS-AHEAD` is untouched. TODOS.md is owned by the ship step.

## Known Stubs

None.

## Threat Flags

None. T-211-01 is mitigated (seed from stored `is_fill = false` rows, pinned by N1). T-211-02 and T-211-03 accepted as planned.

## Self-Check: PASSED

- FOUND: analytics-service/services/trade_resume.py
- FOUND: analytics-service/tests/test_fetch_trades_resume_seed.py
- FOUND commits: 29f80986c, 21af45cda, 6d7073ede
