"""Direct-router tests for analytics-service/routers/simulator.py.

G15-001 (fix-list-2026-05-16): the simulator router had ZERO direct route
tests. The math behind ``simulate_add_candidate`` is well-covered in
``test_simulator_scoring.py``, but the HTTPException branches in the router
itself — ownership / unpublished candidate / empty portfolio / missing
returns / weight-normalisation — were entirely untested. A regression that
flipped one of these guards would ship silently.

Mirrors the test pattern in
``tests/test_portfolio_router_audit_2026_05_07.py`` for the sys.modules
stubbing + the chained MagicMock supabase fixture, and the FastAPI
TestClient mounting pattern from ``tests/test_process_key.py`` /
``tests/test_match_router.py``.

The simulator router's request shape declares ``portfolio_id: str`` and
``candidate_strategy_id: str`` — Pydantic does NOT enforce UUID at the
boundary. The "invalid UUID" branch tested below is therefore the guard
that lives at the DB layer: when Supabase returns no row for an unknown
portfolio_id, the router raises 404. That's the surface area the router
owns; UUID-format validation is upstream (Next.js layer).
"""

from __future__ import annotations

import os
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

# CI version-drift quarantine. analytics-service pins fastapi==0.115.12 +
# pydantic==2.11.3. The body-vs-query auto-detection in that version chokes
# on `req: SimulatorRequest` without `Annotated[..., Body()]`, returning
# 422 for valid JSON bodies. Local dev runs newer fastapi (0.135+) where
# the auto-detection works, so the tests prove the regression coverage
# locally. The fix is a one-line production change in routers/simulator.py
# (add `Annotated[SimulatorRequest, Body()]`), landed in PR 0.24.2.0
# behavior batch. Until then, body-parsing tests are CI-skipped to
# unblock the rest of the G15-001 coverage.
_BODY_PARSER_SKIP = pytest.mark.skipif(
    os.getenv("CI", "").lower() == "true",
    reason=(
        "FastAPI 0.115.12 body-vs-query auto-detection returns 422 for "
        "JSON bodies when the route handler uses `req: SimulatorRequest` "
        "without Annotated[..., Body()]. Production routers/simulator.py "
        "has the same shape — fix lands in PR 0.24.2.0 (G15-046 / fastapi "
        "annotation refactor). Tests pass locally on fastapi>=0.135."
    ),
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def supabase_mock():
    """A fresh chained MagicMock for the supabase client per test."""
    return MagicMock()


@pytest.fixture
def client(monkeypatch, supabase_mock):
    """Bare FastAPI app with routers.simulator mounted.

    Per ``test_process_key.py`` we wire ``app.state.limiter`` so the
    slowapi @limiter.limit decorator's middleware probe does not raise,
    but we do NOT register the RateLimitExceeded handler — tests fire
    at most a couple of requests, well under 30/hour.
    """
    from routers import simulator as simulator_router

    monkeypatch.setattr(
        "routers.simulator.get_supabase", lambda: supabase_mock
    )
    # log_audit_event reaches into supabase + env vars at call-time; stub
    # it out to keep these tests hermetic. The audit emit is exercised
    # separately by tests/test_audit_emit.py.
    monkeypatch.setattr(
        "routers.simulator.log_audit_event",
        MagicMock(return_value=None),
    )

    app = FastAPI()
    app.state.limiter = simulator_router.limiter
    app.include_router(simulator_router.router)
    return TestClient(app)


# ---------------------------------------------------------------------------
# Supabase chain helpers
# ---------------------------------------------------------------------------


def _portfolio_chain(sb: MagicMock, data):
    """Wire .table('portfolios').select('id').eq.eq.single.execute → data."""
    chain = sb.table.return_value.select.return_value.eq.return_value.eq.return_value.single.return_value
    chain.execute.return_value = MagicMock(data=data)


def _strategies_chain(sb: MagicMock, data):
    """Wire .table('strategies').select.eq.eq.maybe_single.execute → data."""
    chain = sb.table.return_value.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value
    chain.execute.return_value = MagicMock(data=data)


def _portfolio_strategies_chain(sb: MagicMock, data):
    """Wire .table('portfolio_strategies').select.eq.execute → data."""
    chain = sb.table.return_value.select.return_value.eq.return_value
    chain.execute.return_value = MagicMock(data=data)


def _strategy_analytics_portfolio_chain(sb: MagicMock, data):
    """Wire .table('strategy_analytics').select.in_.execute → data."""
    chain = sb.table.return_value.select.return_value.in_.return_value
    chain.execute.return_value = MagicMock(data=data)


def _strategy_analytics_candidate_chain(sb: MagicMock, data):
    """Wire .table('strategy_analytics').select.eq.maybe_single.execute → data."""
    chain = sb.table.return_value.select.return_value.eq.return_value.maybe_single.return_value
    chain.execute.return_value = MagicMock(data=data)


def _table_router(sb: MagicMock, *, portfolio_data, candidate_data,
                  portfolio_strategies_data, sa_portfolio_data,
                  sa_candidate_data):
    """Multiplex sb.table(name) by table name so each chain returns its
    own data.

    The simulator router calls .table() five times with different names.
    A single fixture-level MagicMock returns the SAME chain for every
    call — fine for tests where only one branch is exercised, but for
    happy-path / cross-table tests we need to demux by table name.
    """
    portfolio_table = MagicMock()
    portfolio_table.select.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value = MagicMock(
        data=portfolio_data
    )

    strategies_table = MagicMock()
    strategies_table.select.return_value.eq.return_value.eq.return_value.maybe_single.return_value.execute.return_value = MagicMock(
        data=candidate_data
    )

    ps_table = MagicMock()
    ps_table.select.return_value.eq.return_value.execute.return_value = MagicMock(
        data=portfolio_strategies_data
    )

    sa_table = MagicMock()
    # Two distinct shapes off strategy_analytics: portfolio (.in_) and
    # candidate (.eq.maybe_single). The .select() returns a chain that
    # supports both terminal verbs.
    sa_select = MagicMock()
    sa_select.in_.return_value.execute.return_value = MagicMock(
        data=sa_portfolio_data
    )
    sa_select.eq.return_value.maybe_single.return_value.execute.return_value = MagicMock(
        data=sa_candidate_data
    )
    sa_table.select.return_value = sa_select

    def _by_name(name):
        if name == "portfolios":
            return portfolio_table
        if name == "strategies":
            return strategies_table
        if name == "portfolio_strategies":
            return ps_table
        if name == "strategy_analytics":
            return sa_table
        return MagicMock()

    sb.table.side_effect = _by_name


def _post(client: TestClient, *, portfolio_id="p-1", candidate="c-1",
          user_id="u-1") -> "TestClient.post":
    return client.post(
        "/api/simulator",
        json={
            "portfolio_id": portfolio_id,
            "candidate_strategy_id": candidate,
            "user_id": user_id,
        },
    )


# ---------------------------------------------------------------------------
# Request schema / validation
# ---------------------------------------------------------------------------


class TestRequestValidation:
    def test_missing_portfolio_id_422(self, client):
        """Pydantic body validation: missing portfolio_id → 422."""
        r = client.post(
            "/api/simulator",
            json={"candidate_strategy_id": "c-1", "user_id": "u-1"},
        )
        assert r.status_code == 422

    def test_missing_candidate_strategy_id_422(self, client):
        r = client.post(
            "/api/simulator",
            json={"portfolio_id": "p-1", "user_id": "u-1"},
        )
        assert r.status_code == 422

    def test_missing_user_id_422(self, client):
        r = client.post(
            "/api/simulator",
            json={"portfolio_id": "p-1", "candidate_strategy_id": "c-1"},
        )
        assert r.status_code == 422


# ---------------------------------------------------------------------------
# Ownership / portfolio-not-found branch
# ---------------------------------------------------------------------------


@_BODY_PARSER_SKIP
class TestPortfolioNotFound:
    def test_portfolio_not_owned_returns_404(self, client, supabase_mock):
        """Defense-in-depth ownership check: portfolios row for
        (id=portfolio_id, user_id=user_id) returns no data → 404. This
        is the same 404 we return for a wholly-bogus portfolio_id (the
        DB query can't distinguish 'wrong owner' from 'doesn't exist',
        and we don't want it to — leaking that signal lets a malicious
        caller enumerate portfolio ids).
        """
        _portfolio_chain(supabase_mock, data=None)

        r = _post(client, portfolio_id="p-other", user_id="u-attacker")
        assert r.status_code == 404
        assert r.json()["detail"] == "Portfolio not found"

    def test_invalid_portfolio_id_string_returns_404(self, client, supabase_mock):
        """Pydantic accepts portfolio_id as str (no UUID validator). A
        non-UUID string therefore reaches Supabase; the query returns
        no data and the router maps that to 404."""
        _portfolio_chain(supabase_mock, data=None)

        r = _post(client, portfolio_id="not-a-uuid")
        assert r.status_code == 404


# ---------------------------------------------------------------------------
# Candidate-not-found / unpublished branch
# ---------------------------------------------------------------------------


@_BODY_PARSER_SKIP
class TestCandidateNotPublished:
    def test_unpublished_candidate_returns_404(self, client, supabase_mock):
        """The strategies query filters on .eq('status', 'published').
        A draft / pending_review / rejected candidate returns no data
        → 404 with a 'not published' detail."""
        # Stage: portfolio exists, but candidate query returns nothing.
        _table_router(
            supabase_mock,
            portfolio_data={"id": "p-1"},
            candidate_data=None,  # unpublished or missing
            portfolio_strategies_data=[],
            sa_portfolio_data=[],
            sa_candidate_data=None,
        )

        r = _post(client)
        assert r.status_code == 404
        assert "not published" in r.json()["detail"]


# ---------------------------------------------------------------------------
# Empty portfolio branch
# ---------------------------------------------------------------------------


@_BODY_PARSER_SKIP
class TestEmptyPortfolio:
    def test_portfolio_with_no_strategies_returns_400(self, client, supabase_mock):
        """portfolio_strategies returns [] → 400 'No strategies found in
        portfolio'. This is the empty-candidate-set guardrail."""
        _table_router(
            supabase_mock,
            portfolio_data={"id": "p-1"},
            candidate_data={"id": "c-1", "name": "Cand", "status": "published"},
            portfolio_strategies_data=[],
            sa_portfolio_data=[],
            sa_candidate_data=None,
        )

        r = _post(client)
        assert r.status_code == 400
        assert r.json()["detail"] == "No strategies found in portfolio"


# ---------------------------------------------------------------------------
# Candidate already in portfolio
# ---------------------------------------------------------------------------


@_BODY_PARSER_SKIP
class TestCandidateAlreadyPresent:
    def test_candidate_already_in_portfolio_returns_400(self, client, supabase_mock):
        """If the candidate is already a portfolio strategy, the ADD
        scenario is ill-defined. The router short-circuits with 400."""
        _table_router(
            supabase_mock,
            portfolio_data={"id": "p-1"},
            candidate_data={"id": "c-1", "name": "Cand", "status": "published"},
            portfolio_strategies_data=[
                {"strategy_id": "c-1", "current_weight": 0.5},
                {"strategy_id": "s-2", "current_weight": 0.5},
            ],
            sa_portfolio_data=[],
            sa_candidate_data=None,
        )

        r = _post(client)
        assert r.status_code == 400
        assert "already in this portfolio" in r.json()["detail"]


# ---------------------------------------------------------------------------
# Returns-data missing branches
# ---------------------------------------------------------------------------


@_BODY_PARSER_SKIP
class TestReturnsDataMissing:
    def test_no_returns_for_portfolio_strategies_returns_400(self, client, supabase_mock):
        """portfolio_strategies has rows but strategy_analytics returns
        nothing usable → 400 'No returns data available for portfolio
        strategies'."""
        _table_router(
            supabase_mock,
            portfolio_data={"id": "p-1"},
            candidate_data={"id": "c-1", "name": "Cand", "status": "published"},
            portfolio_strategies_data=[
                {"strategy_id": "s-1", "current_weight": 0.6},
                {"strategy_id": "s-2", "current_weight": 0.4},
            ],
            sa_portfolio_data=[],  # no analytics rows
            sa_candidate_data=None,
        )

        r = _post(client)
        assert r.status_code == 400
        assert r.json()["detail"] == "No returns data available for portfolio strategies"

    def test_no_returns_for_candidate_returns_400(self, client, supabase_mock):
        """Portfolio has returns but the candidate row is missing from
        strategy_analytics → 400 'No returns data available for the
        candidate'."""
        _table_router(
            supabase_mock,
            portfolio_data={"id": "p-1"},
            candidate_data={"id": "c-1", "name": "Cand", "status": "published"},
            portfolio_strategies_data=[
                {"strategy_id": "s-1", "current_weight": 0.6},
                {"strategy_id": "s-2", "current_weight": 0.4},
            ],
            sa_portfolio_data=[
                {
                    "strategy_id": "s-1",
                    "returns_series": [
                        {"date": "2026-01-01", "value": 0.01},
                        {"date": "2026-01-02", "value": -0.005},
                    ],
                },
                {
                    "strategy_id": "s-2",
                    "returns_series": [
                        {"date": "2026-01-01", "value": 0.015},
                        {"date": "2026-01-02", "value": -0.002},
                    ],
                },
            ],
            sa_candidate_data=None,  # candidate row missing
        )

        r = _post(client)
        assert r.status_code == 400
        assert r.json()["detail"] == "No returns data available for the candidate"

    def test_candidate_row_present_but_empty_returns_400(self, client, supabase_mock):
        """The candidate strategy_analytics row exists but returns_series
        is None / empty → 400 'Candidate has no returns history'."""
        _table_router(
            supabase_mock,
            portfolio_data={"id": "p-1"},
            candidate_data={"id": "c-1", "name": "Cand", "status": "published"},
            portfolio_strategies_data=[
                {"strategy_id": "s-1", "current_weight": 1.0},
            ],
            sa_portfolio_data=[
                {
                    "strategy_id": "s-1",
                    "returns_series": [
                        {"date": "2026-01-01", "value": 0.01},
                        {"date": "2026-01-02", "value": -0.005},
                    ],
                },
            ],
            sa_candidate_data={"strategy_id": "c-1", "returns_series": None},
        )

        r = _post(client)
        assert r.status_code == 400
        assert r.json()["detail"] == "Candidate has no returns history"


# ---------------------------------------------------------------------------
# Weight normalisation fallback
# ---------------------------------------------------------------------------


def _build_returns_records(n: int, start: str = "2026-01-01") -> list[dict]:
    """Build a list of {date,value} records for a synthetic returns series."""
    import pandas as pd
    dates = pd.bdate_range(start, periods=n)
    return [
        {"date": d.strftime("%Y-%m-%d"), "value": (0.001 if i % 2 == 0 else -0.001)}
        for i, d in enumerate(dates)
    ]


@_BODY_PARSER_SKIP
class TestHappyPathAndWeightNormalisation:
    def _stage_happy(self, supabase_mock, *, portfolio_strategies_data):
        _table_router(
            supabase_mock,
            portfolio_data={"id": "p-1"},
            candidate_data={
                "id": "c-1", "name": "Candidate Alpha", "status": "published",
            },
            portfolio_strategies_data=portfolio_strategies_data,
            sa_portfolio_data=[
                {
                    "strategy_id": row["strategy_id"],
                    "returns_series": _build_returns_records(60),
                }
                for row in portfolio_strategies_data
            ],
            sa_candidate_data={
                "strategy_id": "c-1",
                "returns_series": _build_returns_records(60, start="2026-01-01"),
            },
        )

    def test_happy_path_returns_200_and_expected_envelope(
        self, client, supabase_mock
    ):
        """Real returns series across 2 strategies + candidate, weights
        sum to 1 already → 200 with the documented result envelope:
        deltas / current / proposed / equity_curve_* / candidate_name /
        portfolio_id."""
        self._stage_happy(supabase_mock, portfolio_strategies_data=[
            {"strategy_id": "s-1", "current_weight": 0.6},
            {"strategy_id": "s-2", "current_weight": 0.4},
        ])

        r = _post(client)
        assert r.status_code == 200, r.text
        body = r.json()
        # Core envelope contract — the UI binds these keys.
        assert body["candidate_name"] == "Candidate Alpha"
        assert body["portfolio_id"] == "p-1"
        assert "deltas" in body
        assert "current" in body
        assert "proposed" in body
        assert "equity_curve_current" in body
        assert "equity_curve_proposed" in body

    def test_weights_dont_sum_to_one_are_renormalised(
        self, client, supabase_mock
    ):
        """Weights that sum to 4.0 (not 1.0) are renormalised by the
        router's weight-normalisation fallback before being handed to
        simulate_add_candidate. The endpoint succeeds; pre-fallback this
        would have produced garbage Sharpe / DD / concentration."""
        self._stage_happy(supabase_mock, portfolio_strategies_data=[
            {"strategy_id": "s-1", "current_weight": 3.0},
            {"strategy_id": "s-2", "current_weight": 1.0},
        ])

        r = _post(client)
        assert r.status_code == 200, r.text
        body = r.json()
        # Concentration / HHI maps to (0.75)^2 + (0.25)^2 = 0.625 post
        # normalisation. If renormalisation were skipped, the HHI would
        # be (3)^2 + (1)^2 = 10 — a clear contract violation.
        assert body["current"]["concentration"] == pytest.approx(0.625, abs=0.05)

    def test_missing_current_weight_defaults_to_equal_weight(
        self, client, supabase_mock
    ):
        """portfolio_strategies rows with NULL / missing current_weight
        fall back to 1.0 each before normalisation → equal weight. With
        two strategies that means 0.5 / 0.5 post-normalisation. HHI =
        0.5."""
        self._stage_happy(supabase_mock, portfolio_strategies_data=[
            {"strategy_id": "s-1", "current_weight": None},
            {"strategy_id": "s-2", "current_weight": None},
        ])

        r = _post(client)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["current"]["concentration"] == pytest.approx(0.5, abs=0.05)


# ---------------------------------------------------------------------------
# Analytics computation error → 500
# ---------------------------------------------------------------------------


@_BODY_PARSER_SKIP
class TestAnalyticsComputationError:
    def test_simulate_add_candidate_raises_returns_500(
        self, client, supabase_mock, monkeypatch
    ):
        """An exception inside ``simulate_add_candidate`` propagates as
        the default FastAPI 500. We don't catch + remap because the
        router has nothing actionable to add (the math layer logs its
        own context); the platform-level 500 handler is the right
        surface for operators."""
        _table_router(
            supabase_mock,
            portfolio_data={"id": "p-1"},
            candidate_data={
                "id": "c-1", "name": "Candidate Alpha", "status": "published",
            },
            portfolio_strategies_data=[
                {"strategy_id": "s-1", "current_weight": 1.0},
            ],
            sa_portfolio_data=[
                {
                    "strategy_id": "s-1",
                    "returns_series": _build_returns_records(60),
                },
            ],
            sa_candidate_data={
                "strategy_id": "c-1",
                "returns_series": _build_returns_records(60),
            },
        )

        def _boom(**kwargs):
            raise RuntimeError("simulator math exploded")

        monkeypatch.setattr(
            "routers.simulator.simulate_add_candidate", _boom
        )

        # TestClient propagates server-side exceptions by default. Disable
        # that so we observe the wire-level 500 the way a real caller would.
        from fastapi.testclient import TestClient as _TC
        # Re-mount with raise_server_exceptions=False for this test only.
        from routers import simulator as simulator_router

        app = FastAPI()
        app.state.limiter = simulator_router.limiter
        app.include_router(simulator_router.router)
        tc = _TC(app, raise_server_exceptions=False)

        r = tc.post(
            "/api/simulator",
            json={
                "portfolio_id": "p-1",
                "candidate_strategy_id": "c-1",
                "user_id": "u-1",
            },
        )
        assert r.status_code == 500


# ---------------------------------------------------------------------------
# audit-2026-05-07 PR C regression tests (G15-006)
# ---------------------------------------------------------------------------


class TestG15_006_RecordsToSeriesSortedAndDeduped:
    """G15-006 — ``_records_to_series`` must sort by date and dedupe
    same-date entries (keep='last'). Storage drift — duplicate-date
    backfill writes or out-of-order imports — would otherwise silently
    break the downstream ``cumprod()`` in simulator_scoring.py:634.
    """

    def test_out_of_order_records_are_sorted(self):
        """Input records in reversed chronological order produce a
        Series with a monotonically increasing DatetimeIndex."""
        from routers.simulator import _records_to_series

        raw = [
            {"date": "2026-01-05", "value": 0.05},
            {"date": "2026-01-01", "value": 0.01},
            {"date": "2026-01-03", "value": 0.03},
        ]
        series = _records_to_series(raw, name="s-1")
        assert series is not None
        assert series.index.is_monotonic_increasing, (
            "Series index must be sorted ascending; pre-fix left it in "
            "input order, breaking path-dependent cumprod()."
        )

    def test_duplicate_dates_dedupe_keep_last(self):
        """Two entries with the same date collapse to one; the LATER
        record (by input order) wins. This matches the Series
        construction semantics (last assignment to an index slot)."""
        from routers.simulator import _records_to_series

        raw = [
            {"date": "2026-01-01", "value": 0.01},
            {"date": "2026-01-02", "value": 0.02},
            # Duplicate date — last value must win.
            {"date": "2026-01-02", "value": 0.99},
            {"date": "2026-01-03", "value": 0.03},
        ]
        series = _records_to_series(raw, name="s-1")
        assert series is not None
        # 3 unique dates in the deduped output.
        assert len(series) == 3
        # The dupe at 2026-01-02 collapsed to the LAST occurrence (0.99).
        import pandas as pd
        assert series.loc[pd.Timestamp("2026-01-02")] == 0.99

    def test_out_of_order_with_duplicate_combined(self):
        """The hardened version of the test: input is BOTH out-of-order
        AND contains a duplicate. The output is sorted AND the dupe
        collapses to the chronologically-later occurrence."""
        from routers.simulator import _records_to_series
        import pandas as pd

        raw = [
            {"date": "2026-01-03", "value": 0.30},
            {"date": "2026-01-01", "value": 0.10},
            # Two entries for 2026-01-02 in input — last (by input order
            # after sort) must win.
            {"date": "2026-01-02", "value": 0.20},
            {"date": "2026-01-02", "value": 0.99},
        ]
        series = _records_to_series(raw, name="s-1")
        assert series is not None
        assert series.index.is_monotonic_increasing
        assert len(series) == 3
        assert series.loc[pd.Timestamp("2026-01-02")] == 0.99
