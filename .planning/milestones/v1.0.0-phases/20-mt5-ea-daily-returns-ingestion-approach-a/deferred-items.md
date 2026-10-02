# Phase 20 — Deferred Items (out-of-scope discoveries)

Logged by the 20-01 executor per the SCOPE BOUNDARY rule. NOT fixed in this
fixtures-only plan.

## Pre-existing test failures in `analytics-service/tests/test_main_worker.py`

Discovered during the Task 3 full-suite run (`pytest --cov-fail-under=80`).

- `TestLoopFailureIsolation::test_daily_enqueue_loop_initial_tick_failure_does_not_crash_and_exits_on_shutdown`
- `TestLoopFailureIsolation::test_daily_enqueue_loop_exits_on_shutdown`

**Failure:** `AssertionError: expected exactly one initial tick, got 0`.

**RESOLVED 2026-06-20 (root-caused — NOT a timing race).** The original
"async wall-clock timing race" hypothesis was wrong. Real cause: both
daily_enqueue tests patch `daily_enqueue_tick` but never mock
`_daily_enqueue_already_ran_today()`, which makes a REAL Supabase query and
returns True whenever a same-day `daily_loop` poll_positions row exists in the
test DB — skipping the gated initial tick (ticks=0). Non-hermetic; passed in CI
(no same-day row) but failed locally. The gate was added after the tests
(redteam-2026-05 W1) and they were never updated. Fix: stub the gate to False
in both tests (`_gate_not_run_today`) so they test loop isolation/shutdown, not
DB state. Production code unchanged (the gate is intentionally fail-safe).
test_main_worker.py now 41/41 green locally.

**Why out of scope:** Plan 20-01 adds only `test_mt5_golden_fixtures.py` and 14
CSV fixtures under `tests/fixtures/mt5/` — it touches zero production code and
zero worker code (verified: `git diff --name-only <my-2-commits> -- analytics-service/services/`
is empty; neither commit touches `main_worker.py` or the enqueue loop). The
failures reproduce consistently in isolation, so they are a pre-existing
condition on this branch's environment (Python 3.14 / local venv), not a flake
this plan introduced.

**Disposition:** Left untouched. Surface to the phase owner / a worker-loop
plan. The 80% coverage gate is unaffected (full suite still 88.33%).
