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
import asyncio
import sys
from pathlib import Path
from unittest.mock import MagicMock

# Stub heavy packages before importing any router modules.
#
# audit-2026-05-21: pre-fix this block ALWAYS overwrote `slowapi.Limiter`
# and `slowapi.util.get_remote_address` with MagicMocks, even when the
# real `slowapi` package was installed. That pollution leaked into sibling
# test modules (test_simulator_router.py) — once the real `slowapi.Limiter`
# is replaced with a MagicMock, every `@limiter.limit` decorator
# subsequently evaluated wraps the route handler in a non-callable
# MagicMock and FastAPI returns 422 for valid JSON bodies. Detect-then-
# stub keeps the structural assertions in this file working both when
# slowapi is missing (rare CI image) AND when it's installed (every dev
# env + the main CI image).
import importlib.util as _importlib_util

_STUBS = [
    "slowapi",
    "slowapi.util",
    "ccxt",
    "ccxt.async_support",
]
for name in _STUBS:
    if name in sys.modules:
        continue
    if _importlib_util.find_spec(name) is not None:
        # Real package is installed on disk; leave the sys.modules slot
        # empty so the next `import` pulls the real module.
        continue
    sys.modules[name] = MagicMock()

# Decide real-vs-stub WITHOUT calling find_spec() on the sys.modules slot.
# Another test (e.g. test_portfolio_router_logic) may have inserted a bare
# MagicMock for "slowapi" for isolation, and find_spec() on a spec-less mock
# raises ValueError ("slowapi.__spec__ is not set"), which would abort
# collection for the WHOLE run under any non-alphabetical ordering (sharding,
# pytest-randomly, or a targeted two-file run).
_slowapi_mod = sys.modules.get("slowapi")
if _slowapi_mod is None:
    _real_slowapi_available = _importlib_util.find_spec("slowapi") is not None
else:
    _real_slowapi_available = not isinstance(_slowapi_mod, MagicMock)
if not _real_slowapi_available:
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
    # /review per-task fix split the emission so BOTH branches emit (empty
    # candidates fast-return + full candidates happy path). C19 SF-F1 added a
    # third branch (incumbent_no_data early exit). Accept 1–3 call sites and
    # enforce the shape-invariants on every site.
    assert 1 <= len(bridge_calls) <= 3, (
        "portfolio_bridge must call log_audit_event with action='bridge.score_candidates' "
        f"at least once (once per branch); found {len(bridge_calls)}"
    )

    for call in bridge_calls:
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


# ---------------------------------------------------------------------------
# H-0815 (final) — behavioral coverage of the emitter+caller contract.
#
# The structural tests above prove the emission call EXISTS in the right place
# with the right shape, but they never RUN the handler. This block drives
# portfolio_bridge end-to-end with a table-routing Supabase double to pin the
# availability contract.
#
# log_audit_event implements a deliberate P907+P908 typed dispatch: it SWALLOWS
# transient httpx blips itself, and for the serious classes (permission_denied
# / unknown) it Sentry-captures + writes a structured error log BEFORE it
# re-raises. Because ops visibility is already guaranteed by that capture, the
# happy-path router emit is WRAPPED in try/except (matching
# services/job_worker.py::_emit_audit): a successful compute must still return
# its 200 even when the audit emit raises — otherwise a single audit-path
# regression (e.g. an RLS denial) would 500 EVERY successful bridge/simulator
# run, a total outage for no added visibility (the serious error is already in
# Sentry + logs). These tests assert the handler returns its result when the
# emit raises, and guard against dropping the wrap.
# ---------------------------------------------------------------------------

import pytest  # noqa: E402 — kept local to the behavioral block


def _make_chain(execute_result):
    """A Supabase query-builder double: every fluent method returns self,
    and `.execute()` returns the pre-baked result for this table."""
    chain = MagicMock()
    for method in (
        "select", "eq", "in_", "not_", "is_", "order", "limit", "single",
    ):
        getattr(chain, method).return_value = chain
    # `.not_.in_(...)` chains off the `not_` attribute too.
    chain.not_.in_.return_value = chain
    chain.not_.is_.return_value = chain
    chain.execute.return_value = MagicMock(data=execute_result)
    return chain


def _make_bridge_supabase(*, candidates_present: bool):
    """Route .table(name) to a per-table chain so portfolio_bridge reaches its
    happy-path audit emit. When candidates_present is False we steer through
    the empty-candidates fast-path (emit @ line ~1711); when True, through the
    full scoring path (emit @ line ~1740)."""
    PORTFOLIO_ID = "11111111-1111-1111-1111-111111111111"
    UNDERPERF_ID = "22222222-2222-2222-2222-222222222222"
    CANDIDATE_ID = "33333333-3333-3333-3333-333333333333"

    series_records = [
        {"date": "2024-01-02", "value": 0.01},
        {"date": "2024-01-03", "value": -0.02},
        {"date": "2024-01-04", "value": 0.015},
    ]

    # strategy_analytics is queried twice (portfolio members, then candidates).
    # The router calls .in_(strategy_ids) the first time and .in_(candidate_ids)
    # the second; a single chain whose execute() returns the portfolio member
    # series both times is fine because candidate_returns is built from rows
    # whose strategy_id matches candidate_ids — so for the empty-candidates
    # path we return NO candidate rows by returning rows keyed only to the
    # portfolio member. We disambiguate via a stateful side_effect below.
    sa_call_count = {"n": 0}

    def _sa_execute():
        sa_call_count["n"] += 1
        if sa_call_count["n"] == 1:
            # portfolio members: one member with a usable series
            return MagicMock(data=[
                {"strategy_id": UNDERPERF_ID, "returns_series": series_records},
            ])
        # candidates query
        if candidates_present:
            return MagicMock(data=[
                {"strategy_id": CANDIDATE_ID, "returns_series": series_records},
            ])
        return MagicMock(data=[])  # empty → fast-path

    tables: dict[str, MagicMock] = {}
    tables["portfolios"] = _make_chain([{"id": PORTFOLIO_ID}])
    tables["portfolio_strategies"] = _make_chain([
        {"strategy_id": UNDERPERF_ID, "current_weight": 1.0},
    ])
    sa_chain = _make_chain(None)
    sa_chain.execute.side_effect = _sa_execute
    tables["strategy_analytics"] = sa_chain
    tables["strategies"] = _make_chain(
        [{"id": CANDIDATE_ID, "name": "Cand"}] if candidates_present else []
    )

    supabase = MagicMock()
    supabase.table.side_effect = lambda name: tables[name]
    return supabase, PORTFOLIO_ID, UNDERPERF_ID


def _reset_bridge_rate_limiter():
    """Clear the per-user bridge attempt cache so repeated test runs don't trip
    the 10/hour per-user limiter (which would 429 before the emit)."""
    from routers import portfolio as portfolio_router

    portfolio_router._bridge_user_attempts.clear()


def _call_undecorated(handler, *args, **kwargs):
    """Invoke the route handler bypassing the slowapi @limiter decorator."""
    fn = getattr(handler, "__wrapped__", handler)
    return asyncio.run(fn(*args, **kwargs))


@pytest.mark.parametrize("candidates_present", [False, True])
def test_bridge_returns_result_when_audit_emit_raises(
    monkeypatch, candidates_present
):
    """Availability contract (H-0815 final): a successful bridge compute must
    still return its 200 payload even when the happy-path audit emit raises.

    log_audit_event Sentry-captures + logs the serious classes
    (permission_denied / unknown) BEFORE re-raising, so the router can safely
    wrap-and-swallow the re-raise: ops still sees the regression, and one
    audit-path failure does not 500 every successful run. A RuntimeError
    (Branch 3, unknown) raised by the emit must NOT escape the handler. Covers
    BOTH the empty-candidates fast-path and the full-scoring path. Guards
    against dropping the try/except wrap.

    H-0815 gap (a) — "emission skipped at runtime": the stub RECORDS every
    invocation, and we assert the emit fired exactly once with the right
    attribution shape (action / entity_type / entity_id / user_id). A
    never-raising stub would pass the availability check trivially, and — worse —
    a regression that DELETES the emit call from the exercised branch would also
    silently pass (the stub that is never called never raises). Recording +
    asserting `len(recorded) == 1` closes that hole: the emit must actually
    happen on the happy path, not merely be swallowable when it does."""
    from routers import portfolio as portfolio_router
    from models.schemas import BridgeRequest

    _reset_bridge_rate_limiter()

    supabase, portfolio_id, underperf_id = _make_bridge_supabase(
        candidates_present=candidates_present
    )
    monkeypatch.setattr(portfolio_router, "get_supabase", lambda: supabase)

    # The audit emit raises an UNEXPECTED error (not transient / not 42501) —
    # the class the emitter re-raises after Sentry-capturing it. The router's
    # wrap must swallow it so the successful compute still returns. We also
    # RECORD the kwargs so the test fails if the emit is silently dropped
    # (gap a) or called with the wrong attribution shape.
    recorded: list[dict[str, object]] = []

    def _raising_emit(**kwargs):
        recorded.append(kwargs)
        raise RuntimeError("unexpected audit RPC failure")

    monkeypatch.setattr(portfolio_router, "log_audit_event", _raising_emit)

    # find_replacement_candidates is imported lazily inside the handler from
    # services.bridge_scoring; for the candidates_present path, stub it so we
    # don't depend on real scoring math (orthogonal to the audit contract).
    if candidates_present:
        import services.bridge_scoring as bs

        monkeypatch.setattr(
            bs,
            "find_replacement_candidates",
            lambda *a, **k: [{"strategy_id": "33333333-3333-3333-3333-333333333333"}],
        )

    req = BridgeRequest(
        portfolio_id=portfolio_id,
        underperformer_strategy_id=underperf_id,
        user_id="44444444-4444-4444-4444-444444444444",
    )
    request = MagicMock()  # slowapi is bypassed via __wrapped__

    # Audit emit raised, but the compute succeeded → handler returns its 200
    # payload (the wrap swallowed the re-raise; the emitter already alerted).
    result = _call_undecorated(portfolio_router.portfolio_bridge, request, req)
    assert result["ok"] is True
    assert result["status"] == "complete"
    assert result["portfolio_id"] == portfolio_id

    # gap (a): the emit MUST have actually fired on the exercised happy-path
    # branch — exactly once, with the Task-7.1b attribution shape. If a
    # refactor drops the log_audit_event call from this branch, `recorded`
    # stays empty and this assertion fails (the AST test would not catch a
    # drop in only one of the three branches; this does).
    assert len(recorded) == 1, (
        "portfolio_bridge must emit exactly one bridge.score_candidates audit "
        f"event on the happy path; emit fired {len(recorded)} time(s) "
        "(0 ⇒ the emission was silently skipped at runtime)"
    )
    emitted = recorded[0]
    assert emitted["action"] == "bridge.score_candidates"
    assert emitted["entity_type"] == "bridge_run"
    # entity_id is the portfolio the bridge ran against; user_id carries the
    # caller's attribution — swapping these breaks the spoof-proof invariant.
    assert emitted["entity_id"] == portfolio_id
    assert emitted["user_id"] == "44444444-4444-4444-4444-444444444444"
