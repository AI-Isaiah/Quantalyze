# Deferred items — Phase 140.1.1

Out-of-scope discoveries logged during execution. **Not fixed** (SCOPE BOUNDARY:
only auto-fix issues directly caused by the current task's changes).

---

## D-1 — `test_process_key_auth_order.py::test_unset_internal_token_rejects_empty_bearer_with_500` fails under an ad-hoc `-k internal` selection

**Found during:** plan 04, Task 1 (running `pytest tests/ -q -k "internal"` as a
scoped regression check).

**Symptom:** `AssertionError: PYAPI-04d: with INTERNAL_API_TOKEN unset an EMPTY
bearer must …`

**Proven NOT caused by this plan.** Three observations, all first-hand:

1. The file passes in isolation: `pytest tests/test_process_key_auth_order.py -q`
   → **8 passed**.
2. The failure persists with this plan's edited file entirely removed from the
   selection: `pytest tests/ -q -k internal --deselect
   tests/test_status_contract_exchange_internal.py` → **1 failed / 22 passed**.
3. This plan's diff touches only `routers/internal.py`'s S-11 `except` arm and
   the handler docstring. The failing test exercises `main.py::_gate_process_key`,
   which never reaches `create_exchange`.

**Root cause (unverified, recorded for the owner):** a cross-test environment
leak — some test in the `-k internal` subset leaves `INTERNAL_API_TOKEN` set
without restoring it, and the subset ordering exposes it. The FULL suite is green
(the wave-2 gate in Task 3 confirms this), so the leaking restorer normally runs.

**Why deferred:** pre-existing, in a file this plan does not touch, and invisible
to CI (which runs the full suite, never a `-k` subset). Fixing it means auditing
`setenv` calls across the `internal`-matching files — a different change class
from PYAPIFIX-03.
