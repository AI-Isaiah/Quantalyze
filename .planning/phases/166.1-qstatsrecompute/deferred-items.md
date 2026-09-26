# Phase 166.1 deferred items (out of scope, recorded, not fixed)

## From plan 166.1-01 (2026-09-26)

Two full-suite (`pytest -q -n auto`) failures, one per run, in files this plan does not touch.
Run 3 on the same tree was fully green (`6438 passed, 90 skipped`). Both pass when their file runs
alone.

1. `tests/test_limiter_identity.py::TestClassClosure::test_every_router_limiter_is_the_one_singleton`
   raised `AttributeError: module 'routers' has no attribute 'exchange'`. This is a test-ordering
   dependency under xdist: `tests/test_create_exchange_attribution.py` calls
   `evict_module("routers.exchange")`, which deletes the package attribute, and the limiter test
   reads `routers.exchange` without re-importing it when both land on the same worker in that
   order. Passes alone (`76 passed`). The mechanism is the one `tests/limiter_stub.py`
   `evict_module`'s docstring describes.
2. `tests/test_feedback_engine.py::test_lazy_import_not_triggered_at_module_load` hit its own 15 s
   `subprocess.run` timeout (`TimeoutExpired`) at a host load average of about 29 (shared machine,
   other agents running). Passes alone (`54 passed`).

Neither is a data-integrity or user-facing gate. Both are fix-or-drop flake candidates for
whoever next owns the Python test infrastructure.

## From plan 166.1-01b (2026-09-26)

Full-suite run 1 on the plan's final tree had 2 failures, both in files this plan does not touch;
run 2 on the same tree was fully green (`6444 passed, 90 skipped`), and both pass when their files
run alone (`154 passed`).

1. `test_limiter_identity` again: item 1 above, same `AttributeError`.
2. NEW: `tests/test_mt5_session_monitor.py::test_CRITERION_2_a_dark_reading_drives_the_heal_with_no_human_and_no_restart`
   failed `assert 'dark' in []` while the monitor logged that a tick "did not complete inside its own
   0.0s cadence", at a host load average of about 48. A wall-clock timing dependency under load, not a
   logic failure. Same disposition as the two above: fix-or-drop flake candidate.
