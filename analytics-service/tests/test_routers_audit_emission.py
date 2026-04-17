"""Router-level import contract for Task 7.1b audit emission.

Asserts each of the 4 Python cross-service emission sites has a
`log_audit_event` reference wired into the module namespace. This is
a lightweight smoke test — the behavioral test of the audit wrapper
itself lives in `test_audit.py`, and the end-to-end router tests
remain guarded by the existing router suites (test_portfolio_router_logic,
test_simulator_scoring, test_reconciliation).

What this test does catch
-------------------------
A developer removes `from services.audit import log_audit_event` from
a router module (or the Python wrapper file is moved/renamed) and the
compute path continues to succeed but no audit row ever fires. That
drift is silent from the user's perspective — this test surfaces it
at CI time with a clear "the Task 7.1b audit import is missing" error.

What this test does NOT cover
-----------------------------
Whether the log_audit_event call is actually reached at runtime.
That's covered by:
  - `test_audit.py` — the wrapper's fire-and-forget contract.
  - Source-grep review during PR review — a reviewer checking the
    diff can see the emission site immediately because of the stable
    `# Sprint 6 Task 7.1b — audit ...` comment block at each emission
    site.
  - Full end-to-end tests live in `tests/test_portfolio_router_logic.py`
    and friends (which stub out the audit wrapper to silence it);
    re-wiring every handler with a deep supabase mock would require a
    large test-infra investment for marginal coverage benefit.
"""

from __future__ import annotations

import sys
from unittest.mock import MagicMock


def _install_stubs():
    """Stub out heavy packages unavailable in the local test env."""
    stubs = [
        "slowapi",
        "slowapi.util",
        "ccxt",
        "ccxt.async_support",
    ]
    for name in stubs:
        if name not in sys.modules:
            sys.modules[name] = MagicMock()

    sys.modules["slowapi"].Limiter = MagicMock(return_value=MagicMock())
    sys.modules["slowapi.util"].get_remote_address = MagicMock()


_install_stubs()


def test_bridge_router_imports_log_audit_event():
    """routers/portfolio.py (bridge lives alongside optimizer here)
    imports log_audit_event so the emission at bridge.score_candidates +
    optimizer.run sites is wired.
    """
    from routers import portfolio

    assert hasattr(portfolio, "log_audit_event"), (
        "routers/portfolio.py must import log_audit_event to emit "
        "bridge.score_candidates and optimizer.run audit events"
    )


def test_simulator_router_imports_log_audit_event():
    from routers import simulator

    assert hasattr(simulator, "log_audit_event"), (
        "routers/simulator.py must import log_audit_event to emit "
        "simulator.run audit events"
    )


def test_job_worker_imports_log_audit_event():
    """services/job_worker.py hosts run_reconcile_strategy_job, which
    must emit reconcile.compare after the reconciliation_reports upsert.
    """
    from services import job_worker

    assert hasattr(job_worker, "log_audit_event"), (
        "services/job_worker.py must import log_audit_event to emit "
        "reconcile.compare audit events"
    )


def test_audit_wrapper_has_required_public_api():
    """services/audit.py is the cross-service emitter — the TS side and
    the Python side agree on the name and signature. This test locks in
    the public surface.
    """
    from services.audit import log_audit_event

    import inspect

    sig = inspect.signature(log_audit_event)
    params = list(sig.parameters.keys())

    assert params == [
        "user_id",
        "action",
        "entity_type",
        "entity_id",
        "metadata",
    ], (
        "log_audit_event public signature must be "
        "(user_id, action, entity_type, entity_id, metadata) — the TS "
        "side's logAuditEventAsUser (migration 058) expects this shape"
    )
