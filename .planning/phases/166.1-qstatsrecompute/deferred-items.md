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
