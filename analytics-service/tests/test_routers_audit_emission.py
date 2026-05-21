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
    """Stub out heavy packages unavailable in the local test env.

    audit-2026-05-21: pre-fix this function ALWAYS overwrote
    `slowapi.Limiter` and `slowapi.util.get_remote_address` with
    MagicMocks, even when the real `slowapi` package was installed. That
    pollution leaked into sibling test modules (test_simulator_router.py)
    because Python caches modules in `sys.modules` — once the real
    `slowapi.Limiter` is replaced with a MagicMock, every `@limiter.limit`
    decorator subsequently evaluated wraps the route handler in a
    non-callable MagicMock and FastAPI's route registration returns 422
    for valid JSON bodies. The 12 simulator_router failures in CI's
    full-suite run all trace back here.

    Fix: detect whether each real package is installed BEFORE writing
    anything into sys.modules. If the real package is on disk we leave
    it alone — the real Limiter is what the routers were built against
    and what the sibling test fixture monkeypatches. We only stub when
    the package is genuinely missing.
    """
    import importlib.util

    stubs = [
        "slowapi",
        "slowapi.util",
        "ccxt",
        "ccxt.async_support",
    ]
    for name in stubs:
        # Already imported AND not a MagicMock stub installed by a prior
        # run of this function => real package, leave alone. The
        # find_spec() call returns the import-system view; if the
        # package is installed on disk, find_spec finds it even if the
        # module was never imported yet.
        if name in sys.modules:
            continue
        if importlib.util.find_spec(name) is not None:
            # Real package is installed but not yet imported — leave the
            # slot empty so subsequent `import` statements pull the real
            # module instead of our stub.
            continue
        sys.modules[name] = MagicMock()

    # Only overwrite Limiter / get_remote_address when there is no real
    # slowapi installation. If the real package is on disk, the existing
    # router code already imports the real Limiter and our routers'
    # `@limiter.limit` decorators work correctly — overwriting would
    # break sibling tests via sys.modules pollution.
    real_slowapi_available = importlib.util.find_spec("slowapi") is not None
    if not real_slowapi_available:
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
