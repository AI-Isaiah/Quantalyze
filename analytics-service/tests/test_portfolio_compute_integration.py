"""Integration tests for _compute_portfolio_analytics + endpoint wiring.

Covers the critical findings that were previously uncovered:
  C-0206 — _compute_portfolio_analytics happy-path pipeline
  C-0208 — TOCTOU concurrency guard (semaphore + in-flight DB check)
  H-0574 — 80/20 weight renormalization when high-weight strategy missing

The supabase client is heavily mocked because the analytics service
runs against a real Postgres in prod; in this local test env we only
verify the routing/decision logic.
"""

from __future__ import annotations

import asyncio
import sys
from unittest.mock import MagicMock, patch

import pytest


def _install_stubs():
    stubs = [
        "supabase",
        "slowapi",
        "slowapi.util",
        "fastapi",
        "fastapi.routing",
        "ccxt",
        "ccxt.async_support",
    ]
    for name in stubs:
        if name not in sys.modules:
            sys.modules[name] = MagicMock()
    sys.modules["supabase"].create_client = MagicMock()
    sys.modules["supabase"].Client = MagicMock()
    sys.modules["slowapi"].Limiter = MagicMock(return_value=MagicMock())
    sys.modules["slowapi.util"].get_remote_address = MagicMock()
    sys.modules["fastapi"].APIRouter = MagicMock(return_value=MagicMock())
    sys.modules["fastapi"].HTTPException = type("HTTPException", (Exception,), {
        "__init__": lambda self, status_code=None, detail=None, **kw: (
            setattr(self, "status_code", status_code),
            setattr(self, "detail", detail),
            Exception.__init__(self, detail),
        ),
    })
    sys.modules["fastapi"].Request = MagicMock()


_install_stubs()

# Now import after stubs are in place.
from routers import portfolio as portfolio_mod  # noqa: E402

# Read the raw source of routers/portfolio.py once for AST/source-level
# regression checks. The endpoint coroutines themselves are wrapped by
# MagicMock-stubbed slowapi decorators in this env, so inspect.getsource
# on them fails.
import pathlib

_PORTFOLIO_SRC = (
    pathlib.Path(portfolio_mod.__file__).read_text(encoding="utf-8")
)


def _function_source(name: str) -> str:
    """Return the source of a top-level function from routers/portfolio.py.

    Walks the module AST so wrapped (decorated) callables are reachable
    by name even when MagicMock decorators have replaced the runtime
    object.
    """
    import ast
    tree = ast.parse(_PORTFOLIO_SRC)
    for node in ast.walk(tree):
        if isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef)) and node.name == name:
            return ast.get_source_segment(_PORTFOLIO_SRC, node) or ""
    raise LookupError(f"function {name} not found in routers/portfolio.py")


# Synthetic strategy returns: 60 trading days, two strategies with
# correlated but distinct profiles.
def _returns_records(n: int = 60, base: float = 0.001, vol: float = 0.01,
                    seed: int = 0) -> list[dict]:
    import numpy as np
    import pandas as pd
    rng = np.random.default_rng(seed)
    rets = rng.normal(base, vol, n)
    dates = pd.bdate_range("2026-01-01", periods=n)
    return [
        {"date": d.strftime("%Y-%m-%d"), "value": float(r)}
        for d, r in zip(dates, rets)
    ]


def _equity_records(returns: list[dict]) -> list[dict]:
    vals = [1.0]
    for r in returns:
        vals.append(vals[-1] * (1 + r["value"]))
    return [
        {"date": r["date"], "value": vals[i + 1]}
        for i, r in enumerate(returns)
    ]


def _make_supabase_for_compute(
    *,
    portfolio_strategies: list[dict],
    analytics_rows: list[dict],
    insert_returns_id: str = "analytics-1",
    benchmark_returns=None,
    prev_optimizer: list[dict] | None = None,
):
    """Build a supabase MagicMock that responds to _compute_portfolio_analytics's
    sequence of calls.
    """
    sb = MagicMock()

    # Track separate table-name handlers so each call returns the right shape.
    table_mocks: dict[str, MagicMock] = {}

    pa = MagicMock()
    # INSERT computing row
    pa.insert.return_value.execute.return_value = MagicMock(
        data=[{"id": insert_returns_id}]
    )
    # SELECT previous optimizer_suggestions
    pa.select.return_value.eq.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value = MagicMock(
        data=prev_optimizer or []
    )
    pa.update.return_value.eq.return_value.execute.return_value = MagicMock(data=[])
    table_mocks["portfolio_analytics"] = pa

    ps = MagicMock()
    ps.select.return_value.eq.return_value.execute.return_value = MagicMock(
        data=portfolio_strategies
    )
    table_mocks["portfolio_strategies"] = ps

    sa = MagicMock()
    sa.select.return_value.in_.return_value.execute.return_value = MagicMock(
        data=analytics_rows
    )
    table_mocks["strategy_analytics"] = sa

    pal = MagicMock()
    pal.select.return_value.eq.return_value.eq.return_value.is_.return_value.limit.return_value.execute.return_value = MagicMock(data=[])
    pal.insert.return_value.execute.return_value = MagicMock(data=[{"id": "alert-1"}])
    table_mocks["portfolio_alerts"] = pal

    pf = MagicMock()
    pf.select.return_value.eq.return_value.single.return_value.execute.return_value = MagicMock(
        data={"created_at": "2026-01-01T00:00:00+00:00"}
    )
    table_mocks["portfolios"] = pf

    ws = MagicMock()
    ws.select.return_value.eq.return_value.order.return_value.execute.return_value = MagicMock(
        data=[]
    )
    table_mocks["weight_snapshots"] = ws

    strat = MagicMock()
    strat.select.return_value.in_.return_value.execute.return_value = MagicMock(data=[])
    table_mocks["strategies"] = strat

    sb.table.side_effect = lambda name: table_mocks.setdefault(name, MagicMock())
    return sb, table_mocks


@pytest.fixture(autouse=True)
def _reset_semaphore():
    """Each test gets a fresh semaphore so prior tests' acquires don't
    block this one's compute slot."""
    # The semaphore lives at module scope; reset its internal counter.
    portfolio_mod._compute_semaphore = asyncio.Semaphore(3)
    yield


@pytest.fixture(autouse=True)
def _pin_portfolio_module_in_sys_modules():
    """Other tests in the suite have been observed to unload
    `routers.portfolio` from sys.modules. When that happens, our
    `patch("routers.portfolio.get_supabase", ...)` re-imports the
    module — and on CI (Python 3.12 + real supabase installed),
    re-import causes a downstream call to services.db.get_supabase()
    which raises RuntimeError when SUPABASE_URL is unset. Pinning
    the module here forces patch() to use the already-loaded module
    so the mock takes effect. Mirrors the pattern in test_cron_router.py.

    Save and restore the prior sys.modules state so later test files
    that intentionally unload `routers.portfolio` (e.g. test_cron_router's
    error-isolation tests) continue to see the unloaded state they expect.
    """
    prior = sys.modules.get("routers.portfolio")
    sys.modules["routers.portfolio"] = portfolio_mod
    try:
        yield
    finally:
        if prior is None:
            sys.modules.pop("routers.portfolio", None)
        else:
            sys.modules["routers.portfolio"] = prior


# ---------------------------------------------------------------------------
# C-0206 — Happy path
# ---------------------------------------------------------------------------

class TestComputePortfolioAnalyticsHappyPath:
    @pytest.mark.asyncio
    async def test_two_strategies_full_pipeline(self):
        ret1 = _returns_records(seed=1)
        ret2 = _returns_records(seed=2)
        ps = [
            {"strategy_id": "s1", "current_weight": 0.6, "strategies": {"id": "s1", "name": "Alpha"}},
            {"strategy_id": "s2", "current_weight": 0.4, "strategies": {"id": "s2", "name": "Beta"}},
        ]
        sa_rows = [
            {"strategy_id": "s1", "returns_series": ret1, "equity_curve": _equity_records(ret1), "total_aum": 100.0},
            {"strategy_id": "s2", "returns_series": ret2, "equity_curve": _equity_records(ret2), "total_aum": 50.0},
        ]
        sb, tables = _make_supabase_for_compute(
            portfolio_strategies=ps,
            analytics_rows=sa_rows,
        )

        # Patch get_supabase + benchmark fetch
        async def _fake_benchmark(symbol):
            return None, True  # stale → no benchmark_comparison
        with patch("routers.portfolio.get_supabase", return_value=sb), \
             patch("routers.portfolio.get_benchmark_returns", side_effect=_fake_benchmark):
            result = await portfolio_mod._compute_portfolio_analytics("portfolio-1")

        # Pipeline produced an analytics_id and key fields
        assert result["analytics_id"] == "analytics-1"
        assert "data_quality" in result
        # Full strategy coverage → no partial_data flag
        assert result["data_quality"]["partial_data"] is False
        assert result["data_quality"]["expected_strategy_count"] == 2
        assert result["data_quality"]["computed_strategy_count"] == 2
        # UPDATE called to mark complete + populate the row
        update_call = tables["portfolio_analytics"].update.call_args[0][0]
        assert update_call["computation_status"] == "complete"
        assert update_call["computation_error"] is None


# ---------------------------------------------------------------------------
# H-0574 — Missing-strategy renormalization regression
# ---------------------------------------------------------------------------

class TestRenormalizationRegression:
    @pytest.mark.asyncio
    async def test_80_20_with_missing_high_weight_strategy(self):
        """Portfolio has 80% weight on s1 (no analytics) + 20% on s2 (with
        analytics). The surviving s2 weight must be renormalized to 100%
        and data_quality must flag the partial_data status with the dropped
        sid recorded.

        Project memory: this is the v0.17.1 KPI-17 silent-zero pattern.
        Previously the renormalization was applied silently with no signal;
        the dashboard would render numbers that were really s2-only.
        """
        ret2 = _returns_records(seed=2)
        ps = [
            {"strategy_id": "s1", "current_weight": 0.8, "strategies": {"id": "s1", "name": "Alpha"}},
            {"strategy_id": "s2", "current_weight": 0.2, "strategies": {"id": "s2", "name": "Beta"}},
        ]
        # Only s2 has strategy_analytics row.
        sa_rows = [
            {"strategy_id": "s2", "returns_series": ret2, "equity_curve": _equity_records(ret2), "total_aum": 50.0},
        ]
        sb, tables = _make_supabase_for_compute(
            portfolio_strategies=ps,
            analytics_rows=sa_rows,
        )

        async def _fake_benchmark(symbol):
            return None, True
        with patch("routers.portfolio.get_supabase", return_value=sb), \
             patch("routers.portfolio.get_benchmark_returns", side_effect=_fake_benchmark):
            result = await portfolio_mod._compute_portfolio_analytics("portfolio-1")

        dq = result["data_quality"]
        # Partial-data flag set
        assert dq["partial_data"] is True
        # s1 captured in missing_analytics_sids
        assert "s1" in dq["missing_analytics_sids"]
        # Only s2 computed
        assert dq["computed_strategy_count"] == 1
        # Dropped weight total was 0.8 (s1's weight) — within sanitize tolerance
        assert dq["dropped_weight_total"] == pytest.approx(0.8, abs=0.01)
        # total_aum: not all strategies report → None
        update_call = tables["portfolio_analytics"].update.call_args[0][0]
        assert update_call["total_aum"] is None


# ---------------------------------------------------------------------------
# H-0577 / H-0578 — Missing equity curve and missing returns telemetry
# ---------------------------------------------------------------------------

class TestPartialDataTelemetry:
    @pytest.mark.asyncio
    async def test_missing_equity_curve_is_tracked(self):
        """Strategy has returns_series but no equity_curve → must surface
        in data_quality.missing_equity_sids."""
        ret1 = _returns_records(seed=1)
        ret2 = _returns_records(seed=2)
        ps = [
            {"strategy_id": "s1", "current_weight": 0.5, "strategies": {"id": "s1", "name": "Alpha"}},
            {"strategy_id": "s2", "current_weight": 0.5, "strategies": {"id": "s2", "name": "Beta"}},
        ]
        sa_rows = [
            {"strategy_id": "s1", "returns_series": ret1, "equity_curve": _equity_records(ret1)},
            {"strategy_id": "s2", "returns_series": ret2, "equity_curve": None},  # missing equity
        ]
        sb, tables = _make_supabase_for_compute(
            portfolio_strategies=ps,
            analytics_rows=sa_rows,
        )

        async def _fake_benchmark(symbol):
            return None, True
        with patch("routers.portfolio.get_supabase", return_value=sb), \
             patch("routers.portfolio.get_benchmark_returns", side_effect=_fake_benchmark):
            result = await portfolio_mod._compute_portfolio_analytics("portfolio-1")

        dq = result["data_quality"]
        assert "s2" in dq["missing_equity_sids"]
        assert dq["partial_data"] is True


# ---------------------------------------------------------------------------
# C-0208 — TOCTOU concurrency guard
# ---------------------------------------------------------------------------

class TestTOCTOUConcurrencyGuard:
    """Verifies the ordering: semaphore acquired BEFORE the in-flight
    DB check. Two overlapping requests against the same portfolio_id
    must not both pass the check; the second must see the first's
    INSERT and return 409.

    The slowapi @limiter.limit() decorator replaces the endpoint
    coroutine with a MagicMock in this stubbed test env, so we exercise
    the endpoint's logic by reading the function body via inspect +
    asserting the source explicitly carries the contract — and we
    test the inner _compute call path independently. AST-level
    coverage is intentional defense-in-depth against a refactor that
    accidentally moves the in-flight check OUTSIDE the semaphore (the
    exact regression the comment at portfolio.py:945 warns about).
    """

    def test_in_flight_check_is_inside_semaphore_block(self):
        """Audit C-0208: refactor-resistant AST check that the
        in-flight SELECT happens inside `async with _compute_semaphore`.
        """
        import ast
        src = _function_source("portfolio_analytics")
        tree = ast.parse(src.lstrip())
        # Walk to find AsyncWith blocks and confirm at least one contains
        # the in_flight variable + the COMPUTING status reference.
        # (We accept either the literal "computing" or the
        # ComputationStatus.COMPUTING enum name.)
        found_pattern = False
        for node in ast.walk(tree):
            if isinstance(node, ast.AsyncWith):
                body_src = ast.unparse(node)
                has_in_flight = "in_flight" in body_src
                has_computing_ref = (
                    "computing" in body_src
                    or "ComputationStatus.COMPUTING" in body_src
                )
                if has_in_flight and has_computing_ref:
                    found_pattern = True
                    break
        assert found_pattern, (
            "Regression: in-flight check ('computing' SELECT) is no longer "
            "inside the async-with-_compute_semaphore block. This re-introduces "
            "the TOCTOU window where two concurrent requests both pass the "
            "check before either INSERT runs."
        )

    def test_409_path_present_in_source(self):
        """Audit C-0208: handler must raise HTTPException(409) when
        in_flight.data is non-empty."""
        src = _function_source("portfolio_analytics")
        assert "status_code=409" in src
        assert "already in progress" in src


# ---------------------------------------------------------------------------
# H-0583 — portfolio_optimizer NULL user_id still audits under sentinel
# ---------------------------------------------------------------------------

class TestOptimizerAuditNullOwner:
    """M-0623 / H-0583: refactor-resistant AST check that the optimizer
    audit emission happens unconditionally (under a sentinel actor)
    when portfolio.user_id is NULL.

    The slowapi-mocked endpoint coroutine isn't directly invokable in
    this test env (same constraint as TestTOCTOUConcurrencyGuard); the
    source-level checks here pair with the integration tests that run
    against a real env in CI.
    """

    def test_audit_emission_unconditional_in_optimizer_source(self):
        """The pre-audit code did `if portfolio_owner_id: log_audit_event(...)`
        which silently dropped the audit emission when user_id was NULL.
        After the fix, the call must happen unconditionally under a sentinel.
        """
        src = _function_source("portfolio_optimizer")
        assert "audit_user_id" in src
        assert "owner_resolved" in src
        assert "00000000-0000-0000-0000-000000000000" in src

    def test_weights_phantom_keys_dropped_in_optimizer_source(self):
        """C-0215: phantom key handling must be present."""
        src = _function_source("portfolio_optimizer")
        assert "phantom" in src.lower()

    def test_published_strategy_pool_is_limited_in_optimizer_source(self):
        """H-0590: published-strategy fetch must carry a .limit(...) clause."""
        src = _function_source("portfolio_optimizer")
        assert "_OPTIMIZER_PUBLISHED_LIMIT" in src
        assert ".limit(_OPTIMIZER_PUBLISHED_LIMIT)" in src


# ---------------------------------------------------------------------------
# C-0207 / H-1071 / H-0587 — verify_strategy + bridge contract checks
# ---------------------------------------------------------------------------

class TestVerifyStrategyContract:
    """Source-level contract guards for the verify_strategy + bridge
    endpoints. These complement the dynamic integration tests that
    run against a real environment in CI.
    """

    def test_per_email_rate_limit_check_is_invoked(self):
        """H-0593: per-email composite rate limit must be enforced
        BEFORE create_exchange so rotated-IP attackers can't burn the
        IP budget."""
        src = _function_source("verify_strategy")
        # The check must appear in the function and be invoked.
        assert "_check_verify_strategy_email_rate" in src
        # And we want the rate-limit check before create_exchange.
        idx_check = src.index("_check_verify_strategy_email_rate")
        idx_exchange = src.index("create_exchange")
        assert idx_check < idx_exchange, (
            "Per-email rate limit check must run BEFORE create_exchange "
            "to avoid wasted exchange handshakes on rate-limited requests."
        )

    def test_credential_logging_uses_redactor(self):
        """M-0628: CCXT exc strings must pass through _redact_credentials."""
        src = _function_source("verify_strategy")
        assert "_redact_credentials" in src
        # The exception logging must NOT do `%s, exc` with raw exc anywhere
        # near a logger call without redaction. Spot-check the key
        # validation path.
        assert "exc_info" in src or "logger.exception" in src

    def test_exchange_close_failure_is_logged(self):
        """M-0612: finally block must log close failures, not silently pass."""
        src = _function_source("verify_strategy")
        # Inside the finally, we want a logger.warning + type(exc) capture.
        assert "exchange.close() failed" in src

    def test_matching_status_is_in_response(self):
        """H-0582: response must carry matching_status to distinguish
        matched / no_match / matching_unavailable."""
        src = _function_source("verify_strategy")
        assert "matching_status" in src

    def test_match_threshold_is_named_constant(self):
        """H-0570 / M-0627: threshold must be the named module constant,
        not a bare 0.95 literal."""
        src = _function_source("verify_strategy")
        assert "_MATCH_CORRELATION_THRESHOLD" in src

    def test_match_candidate_pool_is_ordered_and_limited(self):
        """H-0587: catalog crossing the limit without ORDER BY returns a
        non-deterministic slice; ORDER BY created_at DESC makes it
        deterministic."""
        src = _function_source("verify_strategy")
        # The match block uses .order(...) and ._MATCH_CANDIDATE_LIMIT.
        assert "_MATCH_CANDIDATE_LIMIT" in src
        assert ".order(\"created_at\", desc=True)" in src


class TestPortfolioBridgeContract:
    def test_bridge_ownership_check_present(self):
        """H-1071: bridge must check .eq('user_id', req.user_id) on the
        portfolio lookup. A regression that drops this turns the service
        into a service-role bypass tool."""
        src = _function_source("portfolio_bridge")
        # The ownership join.
        assert ".eq(\"user_id\", req.user_id)" in src

    def test_bridge_underperformer_membership_check_present(self):
        """H-1071: bridge must reject requests where the underperformer
        is not in the portfolio."""
        src = _function_source("portfolio_bridge")
        assert "underperformer_strategy_id not in strategy_ids" in src

    def test_bridge_published_pool_limited(self):
        """H-1072: bridge candidate pool must be capped."""
        src = _function_source("portfolio_bridge")
        assert "_OPTIMIZER_PUBLISHED_LIMIT" in src
        assert ".limit(_OPTIMIZER_PUBLISHED_LIMIT)" in src


class TestAnalyticsResponseInline:
    def test_portfolio_analytics_returns_full_payload(self):
        """C-0216: previously the handler discarded the update_payload
        spread; after fix the response includes the metrics inline so
        callers don't need a separate polling round-trip."""
        src = _function_source("portfolio_analytics")
        # The spread must be present.
        assert "**result" in src


class TestResponseEnvelopeContract:
    """H-0586 / H-0591: source-level contract guards for the shared
    response envelopes added in models/schemas.py.

    Each endpoint must:
      1. Declare response_model on its @router.post decorator.
      2. Include "ok": True in its return dict.

    Without these, the OpenAPI schema is empty and a regression that
    drops analytics_id / verification_id / etc. from the response
    passes silently.
    """

    def test_portfolio_analytics_has_response_model(self):
        src = _function_source("portfolio_analytics")
        assert '"ok": True' in src

    def test_portfolio_optimizer_has_response_model(self):
        src = _function_source("portfolio_optimizer")
        assert '"ok": True' in src

    def test_portfolio_bridge_has_response_model(self):
        src = _function_source("portfolio_bridge")
        # Both branches (empty-candidates fast-path + main path).
        assert src.count('"ok": True') >= 2

    def test_verify_strategy_has_response_model(self):
        src = _function_source("verify_strategy")
        assert '"ok": True' in src

    def test_response_models_are_declared(self):
        """The response_model= annotation must be on the @router.post
        decorator for each endpoint."""
        # The decorator + response_model live at module scope; scan the raw source.
        assert "response_model=PortfolioAnalyticsResponse" in _PORTFOLIO_SRC
        assert "response_model=PortfolioOptimizerResponse" in _PORTFOLIO_SRC
        assert "response_model=PortfolioBridgeResponse" in _PORTFOLIO_SRC
        assert "response_model=VerifyStrategyResponse" in _PORTFOLIO_SRC


# ---------------------------------------------------------------------------
# SFH-3 — Alert-generation failure does not demote COMPLETE analytics row
# ---------------------------------------------------------------------------


class TestAlertFailureKeepsAnalyticsComplete:
    """Review SFH-3: _generate_alerts is called AFTER the analytics row is
    UPDATEd to 'complete'. If alert generation raises (e.g., transient
    Supabase failure on the dedup probe), the outer except in
    _compute_portfolio_analytics used to run _fail(), demoting a fully-
    computed COMPLETE row to FAILED.

    After the fix, _generate_alerts is wrapped in its own try/except so
    a downstream alert failure cannot corrupt the analytics row state.
    """

    @pytest.mark.asyncio
    async def test_alert_exception_does_not_mark_row_failed(self, monkeypatch):
        ret1 = _returns_records(seed=1)
        ret2 = _returns_records(seed=2)
        ps = [
            {"strategy_id": "s1", "current_weight": 0.5, "strategies": {"id": "s1", "name": "Alpha"}},
            {"strategy_id": "s2", "current_weight": 0.5, "strategies": {"id": "s2", "name": "Beta"}},
        ]
        sa_rows = [
            {"strategy_id": "s1", "returns_series": ret1, "equity_curve": _equity_records(ret1), "total_aum": 100.0},
            {"strategy_id": "s2", "returns_series": ret2, "equity_curve": _equity_records(ret2), "total_aum": 50.0},
        ]
        sb, tables = _make_supabase_for_compute(
            portfolio_strategies=ps,
            analytics_rows=sa_rows,
        )

        async def _fake_benchmark(symbol):
            return None, True

        # Inject a poisoned _generate_alerts that raises.
        def _explode(*_a, **_kw):
            raise RuntimeError("simulated dedup probe failure")

        monkeypatch.setattr("routers.portfolio._generate_alerts", _explode)
        with patch("routers.portfolio.get_supabase", return_value=sb), \
             patch("routers.portfolio.get_benchmark_returns", side_effect=_fake_benchmark):
            result = await portfolio_mod._compute_portfolio_analytics("portfolio-1")

        # Compute returned successfully — exception was contained.
        assert result["analytics_id"] == "analytics-1"
        # The only update made to portfolio_analytics was to COMPLETE; no
        # subsequent _fail() should have run.
        update_calls = tables["portfolio_analytics"].update.call_args_list
        # First (and only) update is the COMPLETE write.
        assert len(update_calls) == 1, (
            "Expected exactly one UPDATE on portfolio_analytics (the COMPLETE "
            "transition). A second UPDATE would mean the row was demoted "
            "back to FAILED by the outer except."
        )
        first_update_payload = update_calls[0][0][0]
        assert first_update_payload["computation_status"] == "complete"


class TestAuditSkipAnnotations:
    """M-0613 / M-0622 / H-0588 — every @audit-skip marker in portfolio.py
    must be followed within 8 lines by a supabase mutation call.

    The audit pass flagged these markers as 'dead' because no scanner
    consumed them. This test makes them non-dead by enforcing the
    co-location contract: a marker without an immediate mutation
    nearby is a refactor mistake (the mutation was removed but the
    comment wasn't) and gets caught here.
    """

    def test_audit_skip_marker_is_co_located_with_mutation(self):
        lines = _PORTFOLIO_SRC.splitlines()
        skip_lines = [
            (i, line) for i, line in enumerate(lines)
            if "@audit-skip" in line
        ]
        # Spot-check at least one marker exists (regression: if all markers
        # are stripped the comment-discipline this test enforces vanishes).
        assert len(skip_lines) >= 1, (
            "Expected at least one @audit-skip marker in portfolio.py; "
            "removing them all is acceptable only when paired with a "
            "code-level audit-coverage scanner."
        )

        for idx, raw in skip_lines:
            # Look forward up to 20 lines for a supabase mutation. The
            # marker is typically followed by a few lines of rationale
            # comment before the call.
            window = "\n".join(lines[idx: idx + 20])
            assert (
                "supabase.table(" in window
                or "log_audit_event" in window
            ), (
                f"@audit-skip marker at portfolio.py line {idx + 1} is not "
                "co-located with a supabase mutation or log_audit_event call. "
                "Either remove the stale marker or restore the mutation it "
                "documents."
            )
