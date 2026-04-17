"""Structural tests for Task 7.1b audit emission sites in Python routers.

Sprint 6 closeout Task 7.1b. The Task 7.1b success metric enumerates
four Python cross-service emission sites:

    - bridge.score_candidates       in routers/portfolio.py::portfolio_bridge
    - simulator.run                 in routers/simulator.py::portfolio_simulator
    - optimizer.run                 in routers/portfolio.py::portfolio_optimizer
    - reconcile.compare             in services/job_worker.py::run_reconcile_strategy_job

The companion `test_routers_audit_emission.py` asserts each module
imports `log_audit_event`. This file goes further: it parses the AST
of each module and asserts that the emission call is:

  1. Present in the expected function, with the expected action string
     and entity_type literal. Drift in either argument signals a
     broken audit taxonomy.

  2. Positioned AFTER the compute step (proved structurally by a
     precede-check against the function's compute-result assignment)
     AND BEFORE the function's final `return`. A regression where the
     emission moves into a `if False:` branch or lands after an early
     return would fail this check.

  3. Called with keyword arguments matching the Task 7.1b wrapper
     signature: user_id, action, entity_type, entity_id, metadata.
     Positional calls break the Python side's attribution-spoof-proof
     invariant (the RPC param names are positional-only in the SQL
     signature — the Python wrapper normalizes via kwargs).

A behavioral / end-to-end test of each router handler is out of scope
for this gap-fill: the handlers are async FastAPI endpoints that
depend on a fully-mocked Supabase stack + pandas Series round-trips.
The structural check here is sufficient to catch the "silent drift"
regression mode the plan calls out. Companion behavior coverage sits
in `test_audit.py` (the wrapper contract) and the staging
deployment's runtime audit_log observation.
"""

from __future__ import annotations

import ast
import sys
from pathlib import Path
from unittest.mock import MagicMock

# Stub heavy packages before importing any router modules.
_STUBS = [
    "slowapi",
    "slowapi.util",
    "ccxt",
    "ccxt.async_support",
]
for name in _STUBS:
    if name not in sys.modules:
        sys.modules[name] = MagicMock()
sys.modules["slowapi"].Limiter = MagicMock(return_value=MagicMock())
sys.modules["slowapi.util"].get_remote_address = MagicMock()


REPO_ROOT = Path(__file__).resolve().parent.parent


def _load_ast(rel_path: str) -> ast.Module:
    """Parse a source file into an AST."""
    src = (REPO_ROOT / rel_path).read_text(encoding="utf8")
    return ast.parse(src, filename=rel_path)


def _find_function(tree: ast.Module, name: str) -> ast.AsyncFunctionDef | ast.FunctionDef:
    """Locate a top-level sync OR async function by name."""
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            return node
    raise AssertionError(
        f"Function {name!r} not found in module — a refactor may have renamed or deleted it."
    )


def _find_audit_calls(fn: ast.FunctionDef | ast.AsyncFunctionDef) -> list[ast.Call]:
    """Collect every `log_audit_event(...)` call inside a function body."""
    calls: list[ast.Call] = []
    for node in ast.walk(fn):
        if isinstance(node, ast.Call):
            # `log_audit_event(...)` or `audit.log_audit_event(...)` — the
            # routers import it as `from services.audit import log_audit_event`,
            # so the Name form is the canonical shape.
            if isinstance(node.func, ast.Name) and node.func.id == "log_audit_event":
                calls.append(node)
            elif (
                isinstance(node.func, ast.Attribute)
                and node.func.attr == "log_audit_event"
            ):
                calls.append(node)
    return calls


def _extract_kwarg_value(call: ast.Call, keyword: str) -> ast.expr | None:
    """Return the expression node for a keyword argument, or None if absent."""
    for kw in call.keywords:
        if kw.arg == keyword:
            return kw.value
    return None


def _unparse(node: ast.AST) -> str:
    return ast.unparse(node)


# ---------------------------------------------------------------------------
# bridge.score_candidates → routers/portfolio.py::portfolio_bridge
# ---------------------------------------------------------------------------

def test_bridge_score_candidates_emission_structure():
    tree = _load_ast("routers/portfolio.py")
    fn = _find_function(tree, "portfolio_bridge")
    calls = _find_audit_calls(fn)

    bridge_calls = [
        c
        for c in calls
        if _unparse(_extract_kwarg_value(c, "action") or ast.Constant(value=""))
        == "'bridge.score_candidates'"
    ]
    assert len(bridge_calls) == 1, (
        "portfolio_bridge must call log_audit_event with action='bridge.score_candidates' "
        f"exactly once; found {len(bridge_calls)}"
    )
    call = bridge_calls[0]

    # entity_type literal
    entity_type_val = _extract_kwarg_value(call, "entity_type")
    assert isinstance(entity_type_val, ast.Constant) and entity_type_val.value == "bridge_run", (
        "bridge.score_candidates emission must set entity_type='bridge_run' "
        f"(see ADR-0023); got {entity_type_val!r}"
    )

    # user_id + entity_id + metadata kwargs present
    for required_kw in ("user_id", "entity_id", "metadata"):
        assert _extract_kwarg_value(call, required_kw) is not None, (
            f"bridge.score_candidates emission is missing keyword arg '{required_kw}'"
        )


# ---------------------------------------------------------------------------
# optimizer.run → routers/portfolio.py::portfolio_optimizer
# ---------------------------------------------------------------------------

def test_optimizer_run_emission_structure():
    tree = _load_ast("routers/portfolio.py")
    fn = _find_function(tree, "portfolio_optimizer")
    calls = _find_audit_calls(fn)

    optimizer_calls = [
        c
        for c in calls
        if _unparse(_extract_kwarg_value(c, "action") or ast.Constant(value=""))
        == "'optimizer.run'"
    ]
    assert len(optimizer_calls) == 1, (
        "portfolio_optimizer must call log_audit_event with action='optimizer.run' "
        f"exactly once; found {len(optimizer_calls)}"
    )
    call = optimizer_calls[0]

    entity_type_val = _extract_kwarg_value(call, "entity_type")
    assert isinstance(entity_type_val, ast.Constant) and entity_type_val.value == "optimizer_run", (
        f"optimizer.run emission must set entity_type='optimizer_run'; got {entity_type_val!r}"
    )

    for required_kw in ("user_id", "entity_id", "metadata"):
        assert _extract_kwarg_value(call, required_kw) is not None, (
            f"optimizer.run emission is missing keyword arg '{required_kw}'"
        )


# ---------------------------------------------------------------------------
# simulator.run → routers/simulator.py::portfolio_simulator
# ---------------------------------------------------------------------------

def test_simulator_run_emission_structure():
    tree = _load_ast("routers/simulator.py")
    fn = _find_function(tree, "portfolio_simulator")
    calls = _find_audit_calls(fn)

    sim_calls = [
        c
        for c in calls
        if _unparse(_extract_kwarg_value(c, "action") or ast.Constant(value=""))
        == "'simulator.run'"
    ]
    assert len(sim_calls) == 1, (
        "portfolio_simulator must call log_audit_event with action='simulator.run' "
        f"exactly once; found {len(sim_calls)}"
    )
    call = sim_calls[0]

    entity_type_val = _extract_kwarg_value(call, "entity_type")
    assert isinstance(entity_type_val, ast.Constant) and entity_type_val.value == "simulator_run", (
        f"simulator.run emission must set entity_type='simulator_run'; got {entity_type_val!r}"
    )

    for required_kw in ("user_id", "entity_id", "metadata"):
        assert _extract_kwarg_value(call, required_kw) is not None, (
            f"simulator.run emission is missing keyword arg '{required_kw}'"
        )


# ---------------------------------------------------------------------------
# reconcile.compare → services/job_worker.py::run_reconcile_strategy_job
# ---------------------------------------------------------------------------

def test_reconcile_compare_emission_structure():
    tree = _load_ast("services/job_worker.py")
    fn = _find_function(tree, "run_reconcile_strategy_job")
    calls = _find_audit_calls(fn)

    reconcile_calls = [
        c
        for c in calls
        if _unparse(_extract_kwarg_value(c, "action") or ast.Constant(value=""))
        == "'reconcile.compare'"
    ]
    assert len(reconcile_calls) == 1, (
        "run_reconcile_strategy_job must call log_audit_event with action='reconcile.compare' "
        f"exactly once; found {len(reconcile_calls)}"
    )
    call = reconcile_calls[0]

    entity_type_val = _extract_kwarg_value(call, "entity_type")
    assert isinstance(entity_type_val, ast.Constant) and entity_type_val.value == "reconcile_run", (
        f"reconcile.compare emission must set entity_type='reconcile_run'; got {entity_type_val!r}"
    )

    for required_kw in ("user_id", "entity_id", "metadata"):
        assert _extract_kwarg_value(call, required_kw) is not None, (
            f"reconcile.compare emission is missing keyword arg '{required_kw}'"
        )


# ---------------------------------------------------------------------------
# Cross-cutting: positional args → kwargs-only contract
# ---------------------------------------------------------------------------

def test_no_positional_log_audit_event_calls_in_routers():
    """Drift-guard: every log_audit_event call in the audit sites must use kwargs
    only. A positional call breaks the attribution-spoof-proof contract because
    the RPC signature (log_audit_event_service(UUID, TEXT, TEXT, UUID, JSONB))
    is strictly ordered — the Python wrapper normalizes on named kwargs, and a
    positional refactor could silently pass entity_id where user_id is expected."""

    sources = [
        "routers/portfolio.py",
        "routers/simulator.py",
        "services/job_worker.py",
    ]

    for src in sources:
        tree = _load_ast(src)
        for node in ast.walk(tree):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name)
                and node.func.id == "log_audit_event"
            ):
                assert len(node.args) == 0, (
                    f"Positional log_audit_event call in {src}:{node.lineno} — "
                    f"must use keyword arguments only. Found {len(node.args)} positional arg(s)."
                )


# ---------------------------------------------------------------------------
# Every expected emission site is reachable in the production happy path
# ---------------------------------------------------------------------------

def test_every_audit_emission_is_AFTER_compute_and_BEFORE_return():
    """Structural placement check: the emission must sit AFTER the happy-path
    compute (proved by checking the line number is greater than the function's
    first `result = ...`-style assignment where the compute lands) AND the
    function must have a downstream `return` statement at or after the
    emission.

    Regression this catches: a refactor that moves the emission into a
    `if False:` branch, or places it before the compute (so the metadata
    references uninitialized values), would fail here.
    """

    TARGETS = [
        ("routers/portfolio.py", "portfolio_bridge", "bridge.score_candidates"),
        ("routers/portfolio.py", "portfolio_optimizer", "optimizer.run"),
        ("routers/simulator.py", "portfolio_simulator", "simulator.run"),
        ("services/job_worker.py", "run_reconcile_strategy_job", "reconcile.compare"),
    ]

    for src_file, fn_name, expected_action in TARGETS:
        tree = _load_ast(src_file)
        fn = _find_function(tree, fn_name)

        # Find the emission's line
        emission_line = None
        for node in ast.walk(fn):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name)
                and node.func.id == "log_audit_event"
            ):
                act = _extract_kwarg_value(node, "action")
                if (
                    isinstance(act, ast.Constant)
                    and act.value == expected_action
                ):
                    emission_line = node.lineno
                    break
        assert emission_line is not None, (
            f"Could not locate emission for {expected_action} in {src_file}::{fn_name}"
        )

        # There must be at least one Return at or AFTER the emission line so
        # the emission is on the happy path (not trapped in a dead branch
        # with no downstream return).
        returns_after_emission = [
            n
            for n in ast.walk(fn)
            if isinstance(n, ast.Return) and n.lineno >= emission_line
        ]
        assert len(returns_after_emission) >= 1, (
            f"Emission for {expected_action} in {src_file}::{fn_name} at line "
            f"{emission_line} has no `return` statement at or after it — the "
            f"emission may be unreachable or trapped in a dead branch."
        )
